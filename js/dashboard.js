/**
 * Dashboard module — Gridstack.js grid with Chart.js widgets.
 * Reads data from window.__ifcViewerData (set by app.js after model load).
 */

import { setFilter, applyColorByColumn } from "./table.js";

const STORAGE_KEY = "ifc-viewer-dashboard";

const WIDGET_TYPES = {
  metric: { label: "Metric Card", defaultW: 1, defaultH: 1 },
  bar:    { label: "Bar Chart",   defaultW: 2, defaultH: 3 },
  donut:  { label: "Donut Chart", defaultW: 2, defaultH: 3 },
  table:  { label: "Summary Table", defaultW: 2, defaultH: 3 },
};

const DEFAULT_LAYOUT = [
  { type: "donut",  config: { column: "Type", label: "Elements by Type" }, pos: { x: 0, y: 0, w: 2, h: 4 } },
  { type: "metric", config: { filterType: "Wall", label: "Walls" },       pos: { x: 0, y: 4, w: 1, h: 1 } },
  { type: "metric", config: { filterType: "Slab", label: "Slabs" },       pos: { x: 1, y: 4, w: 1, h: 1 } },
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
    cellHeight: 70,
    margin: 6,
    float: false,
    animate: true,
    disableOneColumnMode: true,
  }, "#gs-grid");

  grid.on("change", saveLayout);
  initialized = true;

  const saved = loadLayout();
  const layout = saved || DEFAULT_LAYOUT;

  for (const item of layout) {
    addWidget(item.type, item.config, item.pos);
  }
}

export function refreshDashboard() {
  if (!initialized) return;
  for (const w of widgets) {
    renderWidgetContent(w);
  }
}

/* ── Widget management ── */

function addWidget(type, config, pos) {
  const id = `gs-w-${idCounter++}`;
  const typeDef = WIDGET_TYPES[type] || WIDGET_TYPES.metric;
  const gridPos = pos || { x: 0, y: 999, w: typeDef.defaultW, h: typeDef.defaultH };
  const hasChart = type === "bar" || type === "donut";

  const contentHtml = `
    <div class="gs-widget-header">
      <span>${esc(config.label || type)}</span>
      <span class="gs-widget-actions">
        ${hasChart ? `<button class="gs-widget-color" data-wid="${id}" title="Color 3D model"><i class="fa-solid fa-palette"></i></button>` : ""}
        <button class="gs-widget-remove" data-wid="${id}" title="Remove"><i class="fa-solid fa-xmark"></i></button>
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

  renderWidgetContent(w);
  saveLayout();
  return id;
}

function removeWidget(id) {
  const w = widgets.find((w) => w.id === id);
  if (w?.chart) w.chart.destroy();

  // Find the grid item containing the remove button for this widget
  const btn = document.querySelector(`[data-wid="${id}"]`);
  const el = btn?.closest(".grid-stack-item");
  if (el && grid) grid.removeWidget(el);

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
  const count = data.filter((r) =>
    r.Type && r.Type.toLowerCase().includes(config.filterType.toLowerCase())
  ).length;

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
  const colors = makePalette(sorted.length);

  // Store palette for color-splash
  w.palette = {};
  sorted.forEach(([k], i) => { w.palette[k] = colors[i]; });

  el.style.position = "relative";
  el.innerHTML = '<canvas style="position:absolute;inset:0;width:100%;height:100%"></canvas>';
  const ctx = el.querySelector("canvas").getContext("2d");

  w.chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: sorted.map(([k]) => truncate(k || "(empty)", 18)),
      datasets: [{
        data: sorted.map(([, v]) => v),
        backgroundColor: colors,
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
        if (elements.length === 0) { setFilter(w.config.column, null); return; }
        const idx = elements[0].index;
        const value = sorted[idx][0];
        setFilter(w.config.column, [value]);
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
  const colors = makePalette(sorted.length);

  // Store palette for color-splash
  w.palette = {};
  sorted.forEach(([k], i) => { w.palette[k] = colors[i]; });

  el.style.position = "relative";
  el.innerHTML = '<canvas style="position:absolute;inset:0;width:100%;height:100%"></canvas>';
  const ctx = el.querySelector("canvas").getContext("2d");

  w.chart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: sorted.map(([k]) => truncate(k || "(empty)", 16)),
      datasets: [{
        data: sorted.map(([, v]) => v),
        backgroundColor: colors,
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
        if (elements.length === 0) { setFilter(w.config.column, null); return; }
        const idx = elements[0].index;
        const value = sorted[idx][0];
        setFilter(w.config.column, [value]);
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
  el.style.overflowY = "auto";
}

/* ── Add Widget dialog ── */

function showAddWidgetDialog() {
  // Close existing
  const existing = document.querySelector(".add-widget-overlay");
  if (existing) { existing.remove(); return; }

  const overlay = document.createElement("div");
  overlay.className = "add-widget-overlay";
  overlay.innerHTML = `
    <div class="add-widget-dialog">
      <h3><i class="fa-solid fa-plus"></i> Add Widget</h3>
      <label>Widget type</label>
      <select id="aw-type">
        ${Object.entries(WIDGET_TYPES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("")}
      </select>
      <label>Column / Filter</label>
      <input id="aw-value" type="text" placeholder="e.g. Type, Wall, Slab..." value="Type">
      <div class="add-widget-dialog-actions">
        <button class="aw-cancel">Cancel</button>
        <button class="aw-add">Add</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Close on overlay background click
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector(".aw-cancel").addEventListener("click", () => overlay.remove());
  overlay.querySelector(".aw-add").addEventListener("click", () => {
    const type = overlay.querySelector("#aw-type").value;
    const value = overlay.querySelector("#aw-value").value.trim() || "Type";

    let config;
    if (type === "metric") {
      config = { filterType: value, label: value };
    } else {
      config = { column: value, label: `${WIDGET_TYPES[type].label}: ${value}` };
    }

    addWidget(type, config);
    overlay.remove();
  });
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

function makePalette(n) {
  const colors = [];
  for (let i = 0; i < n; i++) {
    const hue = (i * 360 / n) % 360;
    colors.push(`hsl(${Math.round(hue)}, 70%, 55%)`);
  }
  return colors;
}

function resizeAllCharts() {
  for (const w of widgets) {
    if (w.chart) w.chart.resize();
  }
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function truncate(s, max) {
  return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
}
