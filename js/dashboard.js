/**
 * Dashboard module — Gridstack.js grid with Chart.js widgets.
 * Reads data from window.__ifcViewerData (set by app.js after model load).
 */

import { setFilter, applyColorByColumn } from "./table.js";
import { categoricalPalette, esc } from "./color-palette.js";

const STORAGE_KEY = "ifc-viewer-dashboard";

const WIDGET_TYPES = {
  metric: { label: "Metric Card", defaultW: 1, defaultH: 1 },
  bar:    { label: "Bar Chart",   defaultW: 2, defaultH: 3 },
  donut:  { label: "Donut Chart", defaultW: 2, defaultH: 3 },
  table:  { label: "Summary Table", defaultW: 2, defaultH: 3 },
};

const DEFAULT_LAYOUT = [
  { type: "donut",  config: { column: "Type", label: "Elements by Type" },                    pos: { x: 0, y: 0, w: 2, h: 4 } },
  { type: "metric", config: { column: "Type", filterType: "", label: "Total Elements" },      pos: { x: 0, y: 4, w: 2, h: 1 } },
];

let grid = null;
let widgets = [];
let idCounter = 0;
let initialized = false;

/* ── Public API ── */

export function initDashboard() {
  document.getElementById("add-widget-btn")?.addEventListener("click", showAddWidgetDialog);

  const rp = document.getElementById("right-panel");
  if (rp) {
    rp.addEventListener("transitionend", () => {
      if (rp.classList.contains("open") && !initialized) {
        initGrid();
      }
      resizeAllCharts();
    });
  }
}

function initGrid() {
  if (initialized) return;
  if (typeof GridStack === "undefined") return;

  grid = GridStack.init({
    column: 2,
    cellHeight: 90,
    margin: 6,
    float: false,
    animate: true,
    disableOneColumnMode: true,
  }, "#gs-grid");

  initialized = true;

  const saved = loadLayout();
  const layout = saved || DEFAULT_LAYOUT;

  // Batch-add without saving on each widget
  for (const item of layout) {
    addWidget(item.type, item.config, item.pos, true);
  }
  saveLayout();
  grid.on("change", saveLayout);
}

export function refreshDashboard() {
  if (!initialized) return;
  for (const w of widgets) {
    renderWidgetContent(w);
  }
}

/* ── Widget management ── */

function addWidget(type, config, pos, skipSave) {
  const id = `gs-w-${idCounter++}`;
  const typeDef = WIDGET_TYPES[type] || WIDGET_TYPES.metric;
  const gridPos = pos || { x: 0, y: 999, w: typeDef.defaultW, h: typeDef.defaultH };
  const hasChart = type === "bar" || type === "donut";

  const contentHtml = `
    <div class="gs-widget-header">
      <span class="gs-widget-title">${esc(config.label || type)}</span>
      <span class="gs-widget-actions">
        ${hasChart ? `<button class="gs-widget-color" data-wid="${id}" title="Color 3D model" aria-label="Apply colors"><i class="fa-solid fa-fill-drip"></i></button>` : ""}
        <button class="gs-widget-edit" data-wid="${id}" title="Edit widget" aria-label="Edit widget"><i class="fa-solid fa-gear"></i></button>
        <button class="gs-widget-remove" data-wid="${id}" title="Remove" aria-label="Remove widget"><i class="fa-solid fa-xmark"></i></button>
      </span>
    </div>
    <div class="gs-widget-body" id="${id}-body"></div>
  `;

  const added = grid.addWidget({
    id,
    x: gridPos.x,
    y: gridPos.y,
    w: gridPos.w,
    h: gridPos.h,
    content: contentHtml,
  });

  const w = { id, type, config, chart: null, el: added, palette: null };
  widgets.push(w);

  // Button handlers
  const container = added || document;
  container.querySelector?.(`.gs-widget-remove[data-wid="${id}"]`)?.addEventListener("click", (e) => {
    e.stopPropagation();
    removeWidget(id);
  });
  container.querySelector?.(`.gs-widget-color[data-wid="${id}"]`)?.addEventListener("click", (e) => {
    e.stopPropagation();
    colorFrom(w);
  });
  container.querySelector?.(`.gs-widget-edit[data-wid="${id}"]`)?.addEventListener("click", (e) => {
    e.stopPropagation();
    showWidgetModal(w);
  });

  renderWidgetContent(w);
  if (!skipSave) saveLayout();
  return id;
}

function removeWidget(id) {
  const w = widgets.find((w) => w.id === id);
  if (w?.chart) w.chart.destroy();
  if (w?.el && grid) grid.removeWidget(w.el);

  widgets = widgets.filter((w) => w.id !== id);
  saveLayout();
}

/* ── Render ── */

function renderWidgetContent(w) {
  const body = document.getElementById(`${w.id}-body`);
  if (!body) return;

  const data = getData();
  if (data.length === 0) {
    body.innerHTML = `<span style="color:var(--tbl-text-muted);font-size:11px;">No data</span>`;
    return;
  }

  switch (w.type) {
    case "metric": renderMetric(body, w.config, data); break;
    case "bar":    renderBar(body, w, data); break;
    case "donut":  renderDonut(body, w, data); break;
    case "table":  renderTable(body, w.config, data); break;
  }
}

/* ── Metric ── */

function renderMetric(el, config, data) {
  const col = config.column || "Type";
  const filterVal = config.filterType || "";
  const count = filterVal
    ? data.filter((r) => String(r[col] ?? "").toLowerCase().includes(filterVal.toLowerCase())).length
    : data.length;

  el.classList.add("gs-widget-body--metric");
  el.innerHTML = `
    <div class="gs-metric-value">${count}</div>
    <div class="gs-metric-label">${esc(config.label || config.filterType)}</div>
  `;
}

/* ── Bar chart ── */

function renderBar(el, w, data) {
  if (w.chart) w.chart.destroy();

  const groups = groupBy(data, w.config.column);
  const sorted = [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const colors = categoricalPalette(sorted.length);

  // Store palette for color-splash
  w.palette = {};
  sorted.forEach(([k], i) => { w.palette[k] = colors[i]; });

  el.style.position = "relative";
  el.innerHTML = '<canvas style="position:absolute;inset:0;width:100%;height:100%"></canvas>';
  const ctx = el.querySelector("canvas").getContext("2d");

  const defaultBg = [...colors];
  const fadedBg = colors.map((c) => c.replace("70%", "30%"));
  w.selectedIndex = -1;

  function updateBarSelection(chart, idx) {
    const ds = chart.data.datasets[0];
    if (idx < 0) {
      ds.backgroundColor = [...defaultBg];
      ds.borderWidth = 0;
      ds.borderColor = "transparent";
    } else {
      ds.backgroundColor = defaultBg.map((c, i) => i === idx ? c : fadedBg[i]);
      ds.borderWidth = defaultBg.map((_, i) => i === idx ? 2 : 0);
      ds.borderColor = defaultBg.map((c, i) => i === idx ? c : "transparent");
    }
    chart.update("none");
  }

  w.chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: sorted.map(([k]) => truncate(k || "(empty)", 18)),
      datasets: [{
        data: sorted.map(([, v]) => v),
        backgroundColor: defaultBg,
        borderRadius: 3,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } } },
        y: { ticks: { font: { size: 10 } } },
      },
      onClick: (_evt, elements) => {
        if (elements.length === 0 || elements[0].index === w.selectedIndex) {
          w.selectedIndex = -1;
          setFilter(w.config.column, null);
          updateBarSelection(w.chart, -1);
          return;
        }
        const idx = elements[0].index;
        w.selectedIndex = idx;
        setFilter(w.config.column, [sorted[idx][0]]);
        updateBarSelection(w.chart, idx);
      },
    },
  });
}

/* ── Donut chart ── */

function renderDonut(el, w, data) {
  if (w.chart) w.chart.destroy();

  const groups = groupBy(data, w.config.column);
  const sorted = [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const total = data.length;
  const colors = categoricalPalette(sorted.length);

  // Store palette for color-splash
  w.palette = {};
  sorted.forEach(([k], i) => { w.palette[k] = colors[i]; });

  el.style.position = "relative";
  el.innerHTML = '<canvas style="position:absolute;inset:0;width:100%;height:100%"></canvas>';
  const ctx = el.querySelector("canvas").getContext("2d");

  const donutDefault = [...colors];
  const donutFaded = colors.map((c) => c.replace("70%", "30%"));
  w.selectedIndex = -1;

  function updateDonutSelection(chart, idx) {
    const ds = chart.data.datasets[0];
    if (idx < 0) {
      ds.backgroundColor = [...donutDefault];
      ds.offset = 0;
      ds.borderWidth = 1;
      ds.borderColor = "var(--color-surface)";
    } else {
      ds.backgroundColor = donutDefault.map((c, i) => i === idx ? c : donutFaded[i]);
      ds.offset = donutDefault.map((_, i) => i === idx ? 12 : 0);
      ds.borderWidth = donutDefault.map((_, i) => i === idx ? 3 : 1);
      ds.borderColor = donutDefault.map((c, i) => i === idx ? "#fff" : "rgba(255,255,255,.3)");
    }
    chart.update("none");
  }

  w.chart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: sorted.map(([k]) => truncate(k || "(empty)", 16)),
      datasets: [{
        data: sorted.map(([, v]) => v),
        backgroundColor: donutDefault,
        borderWidth: 1,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "55%",
      plugins: {
        legend: { display: true, position: "bottom", labels: { font: { size: 9 }, boxWidth: 10 } },
        tooltip: {
          callbacks: {
            label: (tip) => `${tip.label}: ${tip.raw} (${((tip.raw / total) * 100).toFixed(1)}%)`,
          },
        },
      },
      onClick: (_evt, elements) => {
        if (elements.length === 0 || (elements[0] && elements[0].index === w.selectedIndex)) {
          w.selectedIndex = -1;
          setFilter(w.config.column, null);
          updateDonutSelection(w.chart, -1);
          return;
        }
        const idx = elements[0].index;
        w.selectedIndex = idx;
        setFilter(w.config.column, [sorted[idx][0]]);
        updateDonutSelection(w.chart, idx);
      },
    },
  });
}

/* ── Summary table ── */

function renderTable(el, config, data) {
  const groups = groupBy(data, config.column);
  const sorted = [...groups.entries()].sort((a, b) => b[1] - a[1]);
  const total = data.length;

  el.style.overflowY = "auto";
  el.innerHTML = `
    <table style="width:100%;font-size:10px;border-collapse:collapse;">
      <thead><tr style="border-bottom:1px solid var(--tbl-border);">
        <th style="text-align:left;padding:2px 4px;color:var(--tbl-text-muted);">${esc(config.column)}</th>
        <th style="text-align:right;padding:2px 4px;color:var(--tbl-text-muted);">Count</th>
        <th style="text-align:right;padding:2px 4px;color:var(--tbl-text-muted);">%</th>
      </tr></thead>
      <tbody>
        ${sorted.map(([k, v]) => `
          <tr style="border-bottom:1px solid #f0f0f0;">
            <td style="padding:2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px;" title="${esc(k)}">${esc(k || "(empty)")}</td>
            <td style="text-align:right;padding:2px 4px;">${v}</td>
            <td style="text-align:right;padding:2px 4px;color:var(--tbl-text-muted);">${((v / total) * 100).toFixed(1)}%</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

/* ── Widget config modal (add + edit) ── */

const COLUMNS = [
  { key: "expressID", label: "ID" },
  { key: "GlobalId", label: "GlobalId" },
  { key: "Name", label: "Name" },
  { key: "Type", label: "Type" },
  { key: "Tag", label: "Tag" },
];

function showWidgetModal(editWidget) {
  const existing = document.querySelector(".add-widget-overlay");
  if (existing) existing.remove();

  const isEdit = !!editWidget;
  const curType = isEdit ? editWidget.type : "metric";
  const curConfig = isEdit ? editWidget.config : {};

  const overlay = document.createElement("div");
  overlay.className = "add-widget-overlay";
  overlay.innerHTML = `
    <div class="add-widget-dialog">
      <h3><i class="fa-solid fa-${isEdit ? "gear" : "plus"}"></i> ${isEdit ? "Edit" : "Add"} Widget</h3>

      <label for="aw-type">Widget type</label>
      <select id="aw-type" ${isEdit ? "disabled" : ""}>
        ${Object.entries(WIDGET_TYPES).map(([k, v]) =>
          `<option value="${k}" ${k === curType ? "selected" : ""}>${v.label}</option>`
        ).join("")}
      </select>

      <div id="aw-fields"></div>

      <div id="aw-preview" class="aw-preview"></div>

      <div class="add-widget-dialog-actions">
        <button class="aw-cancel">Cancel</button>
        <button class="aw-add">${isEdit ? "Save" : "Add"}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const fieldsEl = overlay.querySelector("#aw-fields");
  const previewEl = overlay.querySelector("#aw-preview");
  const typeSelect = overlay.querySelector("#aw-type");

  function renderFields() {
    const type = typeSelect.value;
    const data = getData();
    const colOptions = COLUMNS.map((c) =>
      `<option value="${c.key}">${esc(c.label)}</option>`
    ).join("");

    if (type === "metric") {
      const selCol = curConfig.column || "Type";
      const selVal = curConfig.filterType || "";
      fieldsEl.innerHTML = `
        <label for="aw-label">Label</label>
        <input id="aw-label" type="text" value="${esc(curConfig.label || "")}" placeholder="e.g. Walls">

        <label for="aw-column">Column</label>
        <select id="aw-column">
          ${COLUMNS.map((c) =>
            `<option value="${c.key}" ${c.key === selCol ? "selected" : ""}>${esc(c.label)}</option>`
          ).join("")}
        </select>

        <label for="aw-value">Value (filter match)</label>
        <select id="aw-value">
          <option value="">All (total count)</option>
        </select>

        <label for="aw-agg">Aggregation</label>
        <select id="aw-agg">
          <option value="count" selected>Count</option>
        </select>
      `;

      const colSelect = fieldsEl.querySelector("#aw-column");
      const valSelect = fieldsEl.querySelector("#aw-value");
      const labelInput = fieldsEl.querySelector("#aw-label");

      function populateValues() {
        const col = colSelect.value;
        const uniqueVals = [...new Set(data.map((r) => String(r[col] ?? "")))].sort();
        valSelect.innerHTML =
          `<option value="">All (total count)</option>` +
          uniqueVals.map((v) =>
            `<option value="${esc(v)}" ${v === selVal ? "selected" : ""}>${esc(v || "(empty)")}</option>`
          ).join("");
        updatePreview();
      }

      function updatePreview() {
        const col = colSelect.value;
        const val = valSelect.value;
        const count = val
          ? data.filter((r) => String(r[col] ?? "") === val).length
          : data.length;
        const label = labelInput.value || val || "Total";
        previewEl.innerHTML = `<span class="aw-preview-num">${count}</span> <span class="aw-preview-label">${esc(label)}</span>`;
      }

      colSelect.addEventListener("change", () => {
        populateValues();
        if (!labelInput.value || labelInput.dataset.auto === "1") {
          labelInput.value = valSelect.value || colSelect.selectedOptions[0]?.text || "";
          labelInput.dataset.auto = "1";
        }
      });
      valSelect.addEventListener("change", () => {
        updatePreview();
        if (!labelInput.value || labelInput.dataset.auto === "1") {
          labelInput.value = valSelect.value || "Total";
          labelInput.dataset.auto = "1";
        }
      });
      labelInput.addEventListener("input", () => {
        labelInput.dataset.auto = "0";
        updatePreview();
      });

      populateValues();
    } else {
      const selCol = curConfig.column || "Type";
      fieldsEl.innerHTML = `
        <label for="aw-label">Label</label>
        <input id="aw-label" type="text" value="${esc(curConfig.label || "")}" placeholder="e.g. Elements by Type">

        <label for="aw-column">Group by column</label>
        <select id="aw-column">
          ${COLUMNS.map((c) =>
            `<option value="${c.key}" ${c.key === selCol ? "selected" : ""}>${esc(c.label)}</option>`
          ).join("")}
        </select>
      `;

      const colSelect = fieldsEl.querySelector("#aw-column");
      const labelInput = fieldsEl.querySelector("#aw-label");

      colSelect.addEventListener("change", () => {
        if (!labelInput.value || labelInput.dataset.auto === "1") {
          labelInput.value = `${WIDGET_TYPES[type].label}: ${colSelect.selectedOptions[0]?.text || ""}`;
          labelInput.dataset.auto = "1";
        }
      });
      labelInput.addEventListener("input", () => { labelInput.dataset.auto = "0"; });

      previewEl.innerHTML = "";

      if (!curConfig.label) {
        labelInput.value = `${WIDGET_TYPES[type].label}: ${colSelect.selectedOptions[0]?.text || "Type"}`;
        labelInput.dataset.auto = "1";
      }
    }
  }

  typeSelect.addEventListener("change", () => {
    // Reset config for new type
    curConfig.label = "";
    curConfig.column = "Type";
    curConfig.filterType = "";
    renderFields();
  });

  renderFields();

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay.querySelector(".aw-cancel").addEventListener("click", () => overlay.remove());

  overlay.querySelector(".aw-add").addEventListener("click", () => {
    const type = typeSelect.value;
    const label = fieldsEl.querySelector("#aw-label")?.value.trim();
    const column = fieldsEl.querySelector("#aw-column")?.value || "Type";

    let config;
    if (type === "metric") {
      const filterType = fieldsEl.querySelector("#aw-value")?.value || "";
      config = { column, filterType, label: label || filterType || "Total" };
    } else {
      config = { column, label: label || `${WIDGET_TYPES[type].label}: ${column}` };
    }

    if (isEdit) {
      editWidget.config = config;
      editWidget.type = type;
      // Update header label
      const titleEl = editWidget.el?.querySelector(".gs-widget-title");
      if (titleEl) titleEl.textContent = config.label;
      renderWidgetContent(editWidget);
      saveLayout();
    } else {
      addWidget(type, config);
    }
    overlay.remove();
  });
}

function showAddWidgetDialog() {
  showWidgetModal(null);
}

/* ── Persistence ── */

function saveLayout() {
  if (!grid) return;
  const items = widgets.map((w) => {
    const node = w.el?.gridstackNode;
    const pos = node
      ? { x: node.x, y: node.y, w: node.w, h: node.h }
      : { x: 0, y: 0, w: 1, h: 1 };
    return { type: w.type, config: w.config, pos };
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function loadLayout() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    // Validate: must be a non-empty array of objects with type
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed[0].type) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    // Migrate: ensure all configs have column field
    for (const item of parsed) {
      if (item.config && !item.config.column) item.config.column = "Type";
    }
    return parsed;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

/* ── Color splash from chart ── */

function colorFrom(w) {
  if (!w.palette || !w.config.column) return;
  applyColorByColumn(w.config.column, w.palette);
}

/* ── Helpers ── */

function getData() {
  return window.__ifcViewerData?.elements || [];
}

function groupBy(data, key) {
  const counts = new Map();
  for (const row of data) {
    const v = String(row[key] ?? "");
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return counts;
}

function resizeAllCharts() {
  for (const w of widgets) {
    if (w.chart) w.chart.resize();
  }
}

function truncate(s, max) {
  return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
}
