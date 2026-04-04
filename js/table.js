/**
 * IFC Table widget — two tabs (Elements / Property Sets), toolbar with search,
 * sortable headers with unified dropdown (sort / filter / color-by),
 * pagination, column visibility dropdown, resize handle, export actions.
 */

import { categoricalPalette, gradientPalette, esc } from "./color-palette.js";

const fmtNum = (v, decimals = 2) => {
  const n = parseFloat(v);
  if (isNaN(n)) return "\u2013";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

/* ── State ── */

let elementsData = [];
let psetsData = [];
let activeTab = "elements";
let onElementRowClick = null;
let container = null;
let tableOpen = false;

// Elements tab state
let eSortField = "expressID";
let eSortAsc = true;
let eSearch = "";
let ePage = 1;
let ePageSize = 50;

// PropSets tab state
let pSortField = "expressID";
let pSortAsc = true;
let pSearch = "";
let pPage = 1;
let pPageSize = 50;

// Filter state: { columnKey: Set<allowedStringValues> }
let eFilters = {};
let pFilters = {};

// Color-by state (one column at a time, any tab)
let colorByConfig = null;
// { tab:"elements"|"psets", key:string, mode:"categorical"|"gradient", palette:Map<string,string> }

let onColorByChange = null;

// 3D filter sync
let sync3D = true;
let onFilterChange = null;

// Track document-level listeners for cleanup on re-render
let docListeners = [];
function addDocListener(event, fn) {
  document.addEventListener(event, fn);
  docListeners.push({ event, fn });
}
function removeAllDocListeners() {
  for (const { event, fn } of docListeners) {
    document.removeEventListener(event, fn);
  }
  docListeners = [];
}

/* ── Column definitions ── */

const ELEMENT_COLS = [
  { key: "expressID", label: "ID", cls: "col-e-id", numeric: true },
  { key: "GlobalId", label: "GlobalId", cls: "col-e-gid" },
  { key: "Name", label: "Name", cls: "col-e-name" },
  { key: "Type", label: "Type", cls: "col-e-type" },
  { key: "Level", label: "Level", cls: "col-e-level" },
  { key: "Space", label: "Space", cls: "col-e-space" },
  { key: "Tag", label: "Tag", cls: "col-e-tag" },
];

const PSET_COLS = [
  { key: "expressID", label: "ID", cls: "col-ps-id", numeric: true },
  { key: "ElementName", label: "Element", cls: "col-ps-el" },
  { key: "PSetName", label: "PSet Name", cls: "col-ps-pset" },
  { key: "Property", label: "Property", cls: "col-ps-prop" },
  { key: "Value", label: "Value", cls: "col-ps-val" },
];

function activeCols() {
  return activeTab === "elements" ? ELEMENT_COLS : PSET_COLS;
}

function activeData() {
  return activeTab === "elements" ? elementsData : psetsData;
}

function activeFilters() {
  return activeTab === "elements" ? eFilters : pFilters;
}

/* ── Public API ── */

export function initTable(el, { onElementSelect } = {}) {
  container = el;
  onElementRowClick = onElementSelect || null;
  renderEmptyState();
}

export function onColorBy(callback) {
  onColorByChange = callback;
}

let onLegendVisibilityChange = null;
export function onLegendChange(callback) {
  onLegendVisibilityChange = callback;
}

export function onFilter(callback) {
  onFilterChange = callback;
}

/** Programmatically set a column filter (called from dashboard chart clicks) */
export function setFilter(column, values) {
  // Only works on elements tab for now
  if (values && values.length > 0) {
    eFilters[column] = new Set(values.map(String));
  } else {
    delete eFilters[column];
  }
  ePage = 1;
  if (activeTab !== "elements") {
    activeTab = "elements";
    container?.querySelectorAll(".tbl-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.tab === "elements");
      t.setAttribute("aria-selected", t.dataset.tab === "elements");
    });
    container?.querySelector("#ttab-elements")?.classList.toggle("active", true);
    container?.querySelector("#ttab-psets")?.classList.toggle("active", false);
    updateColumnsDropdown();
  }
  renderActiveTab();
  updateHeaderIndicators("e");
  fireFilterChange();
}

/** Programmatically apply color-by from external source (dashboard charts) */
export function applyColorByColumn(column, valueToColor) {
  const data = elementsData;
  const palette = new Map(Object.entries(valueToColor));

  const expressIDsByValue = new Map();
  data.forEach((row) => {
    const v = String(row[column] ?? "");
    if (!expressIDsByValue.has(v)) expressIDsByValue.set(v, []);
    expressIDsByValue.get(v).push(row.expressID);
  });

  colorByConfig = { tab: "elements", key: column, mode: "categorical", palette };

  if (onColorByChange) {
    onColorByChange({
      column,
      mode: "categorical",
      valueToColor: palette,
      expressIDsByValue,
    });
  }

  renderActiveTab();
  updateHeaderIndicators("e");
  updateLegend();
}

export function resetColorBy() {
  if (colorByConfig) {
    colorByConfig = null;
    if (onColorByChange) onColorByChange(null);
    renderActiveTab();
    updateHeaderIndicators(activeTab === "elements" ? "e" : "ps");
  }
  updateLegend();
}

/* ── Color legend panel ── */

function updateLegend() {
  const panel = document.getElementById("color-legend");
  if (!panel) return;

  if (!colorByConfig) {
    panel.innerHTML = `
      <div class="color-legend-empty">
        <i class="fa-solid fa-fill-drip"></i>
        <span>No colors applied. Use the <i class="fa-solid fa-filter"></i> column filter to color by attribute.</span>
      </div>
    `;
    if (onLegendVisibilityChange) onLegendVisibilityChange(false);
    return;
  }

  const data = colorByConfig.tab === "elements" ? elementsData : psetsData;
  const counts = getUniqueValues(data, colorByConfig.key);

  const col = (colorByConfig.tab === "elements" ? ELEMENT_COLS : PSET_COLS)
    .find((c) => c.key === colorByConfig.key);
  const colLabel = col ? col.label : colorByConfig.key;

  const entries = [...colorByConfig.palette.entries()];

  panel.innerHTML = `
    <div class="color-legend-header">
      <div>
        <div class="color-legend-title">Color by</div>
        <div class="color-legend-col">${esc(colLabel)}</div>
      </div>
      <button class="color-legend-clear" id="legend-clear" title="Clear colors">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
    <div class="color-legend-body">
      ${entries
        .map(
          ([val, color]) =>
            `<div class="color-legend-item">
              <span class="color-legend-swatch" style="background:${color}"></span>
              <span class="color-legend-label" title="${esc(val)}">${esc(val || "(empty)")}</span>
              <span class="color-legend-count">${counts.get(val) || 0}</span>
            </div>`
        )
        .join("")}
    </div>
  `;

  if (onLegendVisibilityChange) onLegendVisibilityChange(true);

  panel.querySelector("#legend-clear").addEventListener("click", () => resetColorBy());
}

function renderEmptyState() {
  container.innerHTML = `
    <div class="tbl-empty-state">
      <div class="tbl-empty-icon"><i class="fa-solid fa-cube"></i></div>
      <div class="tbl-empty-title">No data loaded</div>
      <div class="tbl-empty-msg">Open an IFC file or load the sample model to explore elements and properties.</div>
    </div>
  `;
}

export function populateTable(elements, psets) {
  elementsData = elements || [];
  psetsData = psets || [];
  ePage = 1;
  pPage = 1;
  eSearch = "";
  pSearch = "";
  eFilters = {};
  pFilters = {};
  resetColorBy();
  activeTab = "elements";
  renderShell();
  renderActiveTab();
  initResizeHandle();
  if (!tableOpen) toggle();
}

export function highlightRow(expressID) {
  if (!container) return;
  switchToTab("elements");
  clearAllActiveRows();
  const row = container.querySelector(`tr[data-eid="${expressID}"]`);
  if (row) {
    row.classList.add("row-active");
    row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

export function isOpen() {
  return tableOpen;
}

export function toggle() {
  tableOpen = !tableOpen;
  container.classList.toggle("open", tableOpen);
  const btn = document.getElementById("tbl-toggle");
  if (btn) {
    const arrow = btn.querySelector(".tbl-toggle-arrow");
    arrow.className = `fa-solid ${tableOpen ? "fa-chevron-down" : "fa-chevron-up"} tbl-toggle-arrow`;
  }
}

/* ── Internal ── */

function clearAllActiveRows() {
  if (!container) return;
  container
    .querySelectorAll("tr.row-active")
    .forEach((r) => r.classList.remove("row-active"));
}

function switchToTab(tabName) {
  if (!container || activeTab === tabName) return;
  activeTab = tabName;
  container.querySelectorAll(".tbl-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === activeTab);
    t.setAttribute("aria-selected", t.dataset.tab === activeTab);
  });
  container
    .querySelector("#ttab-elements")
    ?.classList.toggle("active", activeTab === "elements");
  container
    .querySelector("#ttab-psets")
    ?.classList.toggle("active", activeTab === "psets");
  updateColumnsDropdown();
  renderActiveTab();
}

/* ── Filter pills ── */

function renderFilterPills() {
  const el = container?.querySelector("#tbl-filter-pills");
  if (!el) return;

  const filters = activeTab === "elements" ? eFilters : pFilters;
  const cols = activeCols();
  const keys = Object.keys(filters);

  if (keys.length === 0) {
    el.innerHTML = "";
    return;
  }

  let html = keys.map((key) => {
    const col = cols.find((c) => c.key === key);
    const label = col ? col.label : key;
    const values = [...filters[key]];
    const display = values.length <= 2
      ? values.map((v) => esc(v || "(empty)")).join(", ")
      : `${values.length} values`;
    return `<span class="filter-pill" data-filter-key="${esc(key)}">
      <span class="filter-pill-label">${esc(label)}: ${display}</span>
      <button class="filter-pill-x" data-filter-key="${esc(key)}"><i class="fa-solid fa-xmark"></i></button>
    </span>`;
  }).join("");

  html += `<button class="filter-pill filter-pill--reset" id="filter-reset-all">
    <i class="fa-solid fa-xmark"></i> Reset All
  </button>`;

  el.innerHTML = html;

  // Per-filter remove
  el.querySelectorAll(".filter-pill-x").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = btn.dataset.filterKey;
      const f = activeTab === "elements" ? eFilters : pFilters;
      delete f[key];
      if (activeTab === "elements") ePage = 1; else pPage = 1;
      renderActiveTab();
      updateHeaderIndicators(activeTab === "elements" ? "e" : "ps");
      fireFilterChange();
    });
  });

  // Reset all
  el.querySelector("#filter-reset-all")?.addEventListener("click", () => {
    if (activeTab === "elements") { eFilters = {}; ePage = 1; }
    else { pFilters = {}; pPage = 1; }
    renderActiveTab();
    updateHeaderIndicators(activeTab === "elements" ? "e" : "ps");
    fireFilterChange();
  });
}

/* ── Filter helpers ── */

function applyFilters(data, filters) {
  const keys = Object.keys(filters);
  if (keys.length === 0) return data;
  return data.filter((row) => {
    for (const key of keys) {
      const val = String(row[key] ?? "");
      if (!filters[key].has(val)) return false;
    }
    return true;
  });
}

function getUniqueValues(data, key) {
  const counts = new Map();
  for (const row of data) {
    const v = String(row[key] ?? "");
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return counts; // Map<string, number>
}

/* ── Shell ── */

function renderShell() {
  // Cleanup old document listeners before rebuilding
  removeAllDocListeners();
  closeHeaderDropdown();

  container.innerHTML = `
    <div class="tbl-resize-handle" id="tbl-resize-handle" title="Drag to resize"></div>
    <div class="tbl-inner">
      <div class="tbl-toolbar">
        <div class="tbl-tabs" role="tablist">
          <button class="tbl-tab active" data-tab="elements" role="tab" aria-selected="true">Elements</button>
          <button class="tbl-tab" data-tab="psets" role="tab" aria-selected="false">Property Sets</button>
        </div>
        <div class="tbl-search">
          <i class="fa-solid fa-magnifying-glass tbl-search-icon"></i>
          <input type="text" id="tbl-search-input" placeholder="Search..." autocomplete="off">
          <button class="tbl-search-clear" id="tbl-search-clear" type="button" hidden>
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div class="tbl-filter-pills" id="tbl-filter-pills"></div>
        <div class="tbl-actions">
          <button class="tbl-action-btn tbl-sync3d-btn active" id="sync3d-btn" title="Sync filters with 3D viewer">
            <i class="fa-solid fa-cube"></i> Sync 3D
          </button>
          <div class="tbl-dropdown">
            <button class="tbl-action-btn" id="col-dropdown-btn">
              <i class="fa-solid fa-table-columns"></i> Columns <i class="fa-solid fa-chevron-down fa-xs"></i>
            </button>
            <div class="tbl-dropdown-menu" id="col-dropdown-menu">
              <div class="tbl-dropdown-header">Show columns</div>
              <div class="tbl-dropdown-toggles">
                <button class="tbl-toggle-btn" id="col-all">All</button>
                <button class="tbl-toggle-btn" id="col-none">None</button>
              </div>
              <div id="col-list"></div>
            </div>
          </div>
          <div class="tbl-dropdown">
            <button class="tbl-action-btn" id="export-dropdown-btn">
              <i class="fa-solid fa-download"></i> Export <i class="fa-solid fa-chevron-down fa-xs"></i>
            </button>
            <div class="tbl-dropdown-menu" id="export-dropdown-menu">
              <button class="tbl-dropdown-item" id="tbl-export-xlsx"><i class="fa-solid fa-file-excel"></i> Excel (.xlsx)</button>
              <button class="tbl-dropdown-item" id="tbl-export-csv"><i class="fa-solid fa-file-csv"></i> CSV</button>
            </div>
          </div>
        </div>
      </div>
      <div class="tbl-tab-content active" id="ttab-elements">
        <div class="tbl-scroll" id="el-scroll">
          <table class="tbl-table" id="el-table">
            <thead><tr id="el-header"></tr></thead>
            <tbody id="el-body"></tbody>
          </table>
        </div>
        <div class="tbl-pagination" id="el-pagination"></div>
      </div>
      <div class="tbl-tab-content" id="ttab-psets">
        <div class="tbl-scroll" id="ps-scroll">
          <table class="tbl-table" id="ps-table">
            <thead><tr id="ps-header"></tr></thead>
            <tbody id="ps-body"></tbody>
          </table>
        </div>
        <div class="tbl-pagination" id="ps-pagination"></div>
      </div>
    </div>
  `;

  // Tab switching
  container.querySelectorAll(".tbl-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      activeTab = tab.dataset.tab;
      container.querySelectorAll(".tbl-tab").forEach((t) => {
        t.classList.toggle("active", t.dataset.tab === activeTab);
        t.setAttribute("aria-selected", t.dataset.tab === activeTab);
      });
      container
        .querySelector("#ttab-elements")
        .classList.toggle("active", activeTab === "elements");
      container
        .querySelector("#ttab-psets")
        .classList.toggle("active", activeTab === "psets");
      const input = container.querySelector("#tbl-search-input");
      input.value = "";
      container.querySelector("#tbl-search-clear").hidden = true;
      eSearch = "";
      pSearch = "";
      updateColumnsDropdown();
      renderActiveTab();
    });
  });

  // Search
  let debounce = null;
  const searchInput = container.querySelector("#tbl-search-input");
  const searchClear = container.querySelector("#tbl-search-clear");
  searchInput.addEventListener("input", () => {
    searchClear.hidden = !searchInput.value;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (activeTab === "elements") {
        eSearch = searchInput.value.toLowerCase().trim();
        ePage = 1;
      } else {
        pSearch = searchInput.value.toLowerCase().trim();
        pPage = 1;
      }
      renderActiveTab();
    }, 200);
  });
  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    searchClear.hidden = true;
    eSearch = "";
    pSearch = "";
    ePage = 1;
    pPage = 1;
    renderActiveTab();
    searchInput.focus();
  });

  // Sync 3D toggle
  const sync3dBtn = container.querySelector("#sync3d-btn");
  sync3dBtn.addEventListener("click", () => {
    sync3D = !sync3D;
    sync3dBtn.classList.toggle("active", sync3D);
    fireFilterChange();
  });

  // Columns dropdown
  setupDropdown("col-dropdown-btn", "col-dropdown-menu");
  container
    .querySelector("#col-all")
    .addEventListener("click", () => toggleAllCols(true));
  container
    .querySelector("#col-none")
    .addEventListener("click", () => toggleAllCols(false));

  // Export dropdown
  setupDropdown("export-dropdown-btn", "export-dropdown-menu");
  container
    .querySelector("#tbl-export-xlsx")
    .addEventListener("click", () => exportData("xlsx"));
  container
    .querySelector("#tbl-export-csv")
    .addEventListener("click", () => exportData("csv"));

  // Build headers
  renderHeaders("el-header", ELEMENT_COLS, "e");
  renderHeaders("ps-header", PSET_COLS, "ps");
  updateColumnsDropdown();

  // Close header dropdown on outside click
  addDocListener("click", (e) => {
    if (!e.target.closest(".th-dropdown") && !e.target.closest(".th-dd-btn")) {
      closeHeaderDropdown();
    }
  });
}

function setupDropdown(btnId, menuId) {
  const btn = container.querySelector(`#${btnId}`);
  const menu = container.querySelector(`#${menuId}`);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    container.querySelectorAll(".tbl-dropdown-menu.show").forEach((m) => {
      if (m !== menu) m.classList.remove("show");
    });
    menu.classList.toggle("show");
  });
  addDocListener("click", (e) => {
    if (!e.target.closest(`#${menuId}`) && !e.target.closest(`#${btnId}`)) {
      menu.classList.remove("show");
    }
  });
}

/* ── Headers ── */

let activeHeaderDropdown = null; // { th, dropdown, colDef, prefix }

function renderHeaders(rowId, cols, prefix) {
  const row = container.querySelector(`#${rowId}`);
  row.innerHTML = cols
    .map(
      (c) =>
        `<th class="${c.cls} sortable" data-key="${c.key}" data-prefix="${prefix}">
      <span class="th-sort-area">
        <span class="th-label">${esc(c.label)}</span>
        <i class="fa-solid fa-sort sort-icon"></i>
        <span class="th-color-dot" hidden>\u25CF</span>
      </span>
      <button class="th-dd-btn" title="Filter &amp; Color" data-key="${c.key}">
        <i class="fa-solid fa-filter"></i>
      </button>
    </th>`
    )
    .join("");

  // Left area click → sort
  row.querySelectorAll(".th-sort-area").forEach((area) => {
    area.addEventListener("click", (e) => {
      e.stopPropagation();
      const th = area.closest("th");
      const key = th.dataset.key;
      if (prefix === "e") {
        if (eSortField === key) eSortAsc = !eSortAsc;
        else { eSortField = key; eSortAsc = true; }
      } else {
        if (pSortField === key) pSortAsc = !pSortAsc;
        else { pSortField = key; pSortAsc = true; }
      }
      renderActiveTab();
      updateSortIndicators(rowId, key, prefix === "e" ? eSortAsc : pSortAsc);
    });
  });

  // Filter button click → open dropdown
  row.querySelectorAll(".th-dd-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const th = btn.closest("th");
      const key = th.dataset.key;
      const colDef = cols.find((c) => c.key === key);
      openHeaderDropdown(th, colDef, prefix);
    });
  });
}

function closeHeaderDropdown() {
  if (activeHeaderDropdown) {
    activeHeaderDropdown.dropdown.remove();
    activeHeaderDropdown = null;
  }
}

function openHeaderDropdown(th, colDef, prefix) {
  // Close existing
  closeHeaderDropdown();

  const data = activeData();
  const filters = activeFilters();
  const uniqueValues = getUniqueValues(data, colDef.key);
  const sortedValues = [...uniqueValues.keys()].sort();
  const currentFilter = filters[colDef.key];
  const isColorActive =
    colorByConfig && colorByConfig.tab === activeTab && colorByConfig.key === colDef.key;
  const currentMode = isColorActive ? colorByConfig.mode : "none";

  const dropdown = document.createElement("div");
  dropdown.className = "th-dropdown";
  dropdown.addEventListener("click", (e) => e.stopPropagation());

  dropdown.innerHTML = `
    <div class="th-dd-section">
      <div class="th-dd-title">Filter</div>
      <input type="text" class="th-dd-filter-search" placeholder="Search values...">
      <div class="th-dd-toggles">
        <button class="tbl-toggle-btn th-select-all">All</button>
        <button class="tbl-toggle-btn th-clear-all">Clear</button>
      </div>
      <div class="th-dd-filter-list">
        ${sortedValues
          .map((v) => {
            const checked = !currentFilter || currentFilter.has(v);
            return `<label class="th-dd-check" data-value="${esc(v)}">
              <input type="checkbox" ${checked ? "checked" : ""} data-val="${esc(v)}">
              <span class="th-dd-check-label">${esc(v || "(empty)")}</span>
              <span class="th-dd-check-count">${uniqueValues.get(v)}</span>
            </label>`;
          })
          .join("")}
      </div>
    </div>
    <hr class="th-dd-divider">
    <div class="th-dd-section">
      <div class="th-dd-title">Color by</div>
      <label class="th-dd-radio"><input type="radio" name="hd-color" value="none" ${currentMode === "none" ? "checked" : ""}> None</label>
      <label class="th-dd-radio"><input type="radio" name="hd-color" value="categorical" ${currentMode === "categorical" ? "checked" : ""}> Categorical</label>
      ${colDef.numeric ? `<label class="th-dd-radio"><input type="radio" name="hd-color" value="gradient" ${currentMode === "gradient" ? "checked" : ""}> Gradient</label>` : ""}
      <div class="th-dd-color-preview" id="hd-color-preview"></div>
      <button class="th-dd-apply-btn" id="hd-apply-color">Apply colors</button>
    </div>
  `;

  // Position dropdown using fixed positioning; flip up if no space below
  document.body.appendChild(dropdown);
  const thRect = th.getBoundingClientRect();
  dropdown.style.position = "fixed";
  dropdown.style.left = thRect.left + "px";
  dropdown.style.zIndex = "9999";

  const ddHeight = dropdown.offsetHeight;
  const spaceBelow = window.innerHeight - thRect.bottom;
  if (spaceBelow < ddHeight && thRect.top > ddHeight) {
    dropdown.style.bottom = (window.innerHeight - thRect.top + 2) + "px";
  } else {
    dropdown.style.top = (thRect.bottom + 2) + "px";
  }

  activeHeaderDropdown = { th, dropdown, colDef, prefix };

  // --- Filter handlers ---
  const filterList = dropdown.querySelector(".th-dd-filter-list");
  const filterSearch = dropdown.querySelector(".th-dd-filter-search");

  filterSearch.addEventListener("input", () => {
    const q = filterSearch.value.toLowerCase();
    filterList.querySelectorAll(".th-dd-check").forEach((lbl) => {
      const v = lbl.dataset.value.toLowerCase();
      lbl.style.display = v.includes(q) ? "" : "none";
    });
  });

  dropdown.querySelector(".th-select-all").addEventListener("click", () => {
    filterList.querySelectorAll('input[type="checkbox"]').forEach((cb) => (cb.checked = true));
    commitFilter(colDef.key, prefix, filterList, sortedValues);
  });
  dropdown.querySelector(".th-clear-all").addEventListener("click", () => {
    filterList.querySelectorAll('input[type="checkbox"]').forEach((cb) => (cb.checked = false));
    commitFilter(colDef.key, prefix, filterList, sortedValues);
  });

  filterList.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener("change", () => {
      commitFilter(colDef.key, prefix, filterList, sortedValues);
    });
  });

  // --- Color handlers ---
  const colorRadios = dropdown.querySelectorAll('input[name="hd-color"]');
  const colorPreview = dropdown.querySelector("#hd-color-preview");

  function updateColorPreview() {
    const mode = dropdown.querySelector('input[name="hd-color"]:checked').value;
    if (mode === "none") {
      colorPreview.innerHTML = "";
      return;
    }
    const MAX_PREVIEW = 10;
    const vals = sortedValues.slice(0, MAX_PREVIEW);
    const colors =
      mode === "categorical"
        ? categoricalPalette(sortedValues.length)
        : gradientPalette(sortedValues.length);
    colorPreview.innerHTML = vals
      .map(
        (v, i) =>
          `<span class="th-dd-swatch"><span class="th-dd-swatch-box" style="background:${colors[i]}"></span>${esc(v || "(empty)")}</span>`
      )
      .join("");
    if (sortedValues.length > MAX_PREVIEW) {
      colorPreview.innerHTML += `<span class="th-dd-swatch-more">+${sortedValues.length - MAX_PREVIEW} more</span>`;
    }
  }

  colorRadios.forEach((r) => r.addEventListener("change", updateColorPreview));
  updateColorPreview();

  dropdown.querySelector("#hd-apply-color").addEventListener("click", async () => {
    const btn = dropdown.querySelector("#hd-apply-color");
    const mode = dropdown.querySelector('input[name="hd-color"]:checked').value;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Applying...';
    // Yield to let the UI update before heavy work
    await new Promise((r) => setTimeout(r, 20));
    await applyColorBy(colDef, mode, prefix, sortedValues);
    closeHeaderDropdown();
  });
}

function commitFilter(key, prefix, filterList, allValues) {
  const checked = new Set();
  filterList.querySelectorAll('input[type="checkbox"]:checked').forEach((cb) => {
    checked.add(cb.dataset.val);
  });

  const filters = prefix === "e" ? eFilters : pFilters;

  if (checked.size === allValues.length) {
    delete filters[key];
  } else {
    filters[key] = checked;
  }

  if (prefix === "e") ePage = 1;
  else pPage = 1;

  renderActiveTab();
  updateHeaderIndicators(prefix);
  fireFilterChange();
}

/* ── 3D filter sync ── */

function fireFilterChange() {
  if (!onFilterChange) return;
  if (!sync3D) {
    onFilterChange(null); // clear 3D filter
    return;
  }

  // Always use elements data for 3D filtering
  const data = elementsData;
  const filters = eFilters;
  const filterKeys = Object.keys(filters);

  if (filterKeys.length === 0) {
    onFilterChange(null); // no filters active
    return;
  }

  const allIDs = new Set(data.map((r) => r.expressID));
  const visibleIDs = new Set();
  const hiddenIDs = new Set();

  for (const row of data) {
    let passes = true;
    for (const key of filterKeys) {
      const val = String(row[key] ?? "");
      if (!filters[key].has(val)) { passes = false; break; }
    }
    if (passes) visibleIDs.add(row.expressID);
    else hiddenIDs.add(row.expressID);
  }

  onFilterChange({ visibleIDs: [...visibleIDs], hiddenIDs: [...hiddenIDs] });
}

/* ── Color-by logic ── */

async function applyColorBy(colDef, mode, prefix, sortedValues) {
  if (mode === "none") {
    colorByConfig = null;
    if (onColorByChange) await onColorByChange(null);
    renderActiveTab();
    updateHeaderIndicators(prefix);
    updateLegend();
    return;
  }

  const data = activeData();
  const uniqueVals = sortedValues || [...getUniqueValues(data, colDef.key).keys()].sort();

  let valsForPalette = uniqueVals;
  if (mode === "gradient" && colDef.numeric) {
    valsForPalette = [...uniqueVals].sort((a, b) => parseFloat(a) - parseFloat(b));
  }

  const colors =
    mode === "categorical"
      ? categoricalPalette(valsForPalette.length)
      : gradientPalette(valsForPalette.length);

  const palette = new Map();
  valsForPalette.forEach((v, i) => palette.set(v, colors[i]));

  const expressIDsByValue = new Map();
  data.forEach((row) => {
    const v = String(row[colDef.key] ?? "");
    if (!expressIDsByValue.has(v)) expressIDsByValue.set(v, []);
    expressIDsByValue.get(v).push(row.expressID);
  });

  colorByConfig = {
    tab: activeTab,
    key: colDef.key,
    mode,
    palette,
  };

  if (onColorByChange) {
    await onColorByChange({
      column: colDef.key,
      mode,
      valueToColor: palette,
      expressIDsByValue,
    });
  }

  renderActiveTab();
  updateHeaderIndicators(prefix);
  updateLegend();
}

/* ── Header indicators ── */

function updateHeaderIndicators(prefix) {
  const rowId = prefix === "e" ? "el-header" : "ps-header";
  const row = container.querySelector(`#${rowId}`);
  if (!row) return;

  const filters = prefix === "e" ? eFilters : pFilters;
  const tab = prefix === "e" ? "elements" : "psets";

  row.querySelectorAll("th.sortable").forEach((th) => {
    const key = th.dataset.key;

    // Highlight filter button when filter or color is active
    const ddBtn = th.querySelector(".th-dd-btn");
    if (ddBtn) {
      const hasFilter = !!filters[key];
      const hasColor = colorByConfig && colorByConfig.tab === tab && colorByConfig.key === key;
      ddBtn.classList.toggle("active", hasFilter || hasColor);
    }

    // Color dot indicator (next to label)
    const colorDot = th.querySelector(".th-color-dot");
    if (colorDot) {
      colorDot.hidden = !(colorByConfig && colorByConfig.tab === tab && colorByConfig.key === key);
    }
  });
}

function updateSortIndicators(rowId, activeKey, asc) {
  const row = container.querySelector(`#${rowId}`);
  if (!row) return;
  row.querySelectorAll("th.sortable").forEach((th) => {
    const icon = th.querySelector(".sort-icon");
    if (th.dataset.key === activeKey) {
      icon.className = `fa-solid ${asc ? "fa-sort-up" : "fa-sort-down"} sort-icon active`;
    } else {
      icon.className = "fa-solid fa-sort sort-icon";
    }
  });
}

/* ── Columns dropdown ── */

function updateColumnsDropdown() {
  const list = container.querySelector("#col-list");
  const cols = activeCols();
  list.innerHTML = cols
    .map(
      (c) =>
        `<label class="tbl-dropdown-check">
      <input type="checkbox" checked data-column="${c.cls}"> ${esc(c.label)}
    </label>`
    )
    .join("");

  list.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener("change", () => toggleCol(cb));
  });
}

function toggleCol(checkbox) {
  const cls = checkbox.dataset.column;
  const show = checkbox.checked;
  container
    .querySelectorAll(`.${cls}`)
    .forEach((el) => (el.style.display = show ? "" : "none"));
}

function toggleAllCols(showAll) {
  container
    .querySelectorAll("#col-list input[type='checkbox']")
    .forEach((cb) => {
      cb.checked = showAll;
      toggleCol(cb);
    });
}

/* ── Render active tab ── */

function renderActiveTab() {
  if (activeTab === "elements") renderElements();
  else renderPsets();
}

/* ── Elements tab ── */

function renderElements() {
  let data = [...elementsData];

  if (eSearch) {
    data = data.filter((el) => {
      const s =
        `${el.expressID} ${el.GlobalId} ${el.Name} ${el.Type} ${el.Level} ${el.Space} ${el.Tag}`.toLowerCase();
      return s.includes(eSearch);
    });
  }

  data = applyFilters(data, eFilters);

  const col = ELEMENT_COLS.find((c) => c.key === eSortField);
  data.sort((a, b) => {
    let va = a[eSortField] ?? "";
    let vb = b[eSortField] ?? "";
    if (col?.numeric) {
      va = parseFloat(va) || 0;
      vb = parseFloat(vb) || 0;
    }
    if (va < vb) return eSortAsc ? -1 : 1;
    if (va > vb) return eSortAsc ? 1 : -1;
    return 0;
  });

  const total = data.length;
  const totalPages = Math.max(1, Math.ceil(total / ePageSize));
  if (ePage > totalPages) ePage = totalPages;
  const start = (ePage - 1) * ePageSize;
  const page = data.slice(start, start + ePageSize);

  const body = container.querySelector("#el-body");
  if (total === 0) {
    body.innerHTML = `<tr><td colspan="${ELEMENT_COLS.length}" class="tbl-empty">
      <i class="fa-solid fa-magnifying-glass"></i> No matching elements
    </td></tr>`;
  } else {
    body.innerHTML = page
      .map((row) => {
        return `<tr data-eid="${row.expressID}" tabindex="0">
        ${ELEMENT_COLS.map((c) => `<td class="${c.cls} ${c.numeric ? "num" : ""}"${cellColorStyle(row, c)}>${fmtCell(row[c.key], c.numeric)}</td>`).join("")}
      </tr>`;
      })
      .join("");
  }

  body.querySelectorAll("tr[data-eid]").forEach((tr) => {
    tr.addEventListener("click", () => {
      const id = parseInt(tr.dataset.eid, 10);
      clearAllActiveRows();
      tr.classList.add("row-active");
      if (onElementRowClick) onElementRowClick(id);
    });
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        tr.click();
      }
    });
  });

  renderPagination(
    "el-pagination",
    ePage,
    totalPages,
    total,
    ePageSize,
    "elements",
    (p) => { ePage = p; renderElements(); },
    (s) => { ePageSize = s; ePage = 1; renderElements(); }
  );

  container
    .querySelectorAll("#col-list input[type='checkbox']")
    .forEach((cb) => {
      if (!cb.checked) toggleCol(cb);
    });

  updateHeaderIndicators("e");
  renderFilterPills();
}

/* ── PropSets tab ── */

function renderPsets() {
  let data = [...psetsData];

  if (pSearch) {
    data = data.filter((row) => {
      const s =
        `${row.expressID} ${row.ElementName} ${row.PSetName} ${row.Property} ${row.Value}`.toLowerCase();
      return s.includes(pSearch);
    });
  }

  data = applyFilters(data, pFilters);

  const col = PSET_COLS.find((c) => c.key === pSortField);
  data.sort((a, b) => {
    let va = a[pSortField] ?? "";
    let vb = b[pSortField] ?? "";
    if (col?.numeric) {
      va = parseFloat(va) || 0;
      vb = parseFloat(vb) || 0;
    }
    if (va < vb) return pSortAsc ? -1 : 1;
    if (va > vb) return pSortAsc ? 1 : -1;
    return 0;
  });

  const total = data.length;
  const totalPages = Math.max(1, Math.ceil(total / pPageSize));
  if (pPage > totalPages) pPage = totalPages;
  const start = (pPage - 1) * pPageSize;
  const page = data.slice(start, start + pPageSize);

  const body = container.querySelector("#ps-body");
  if (total === 0) {
    body.innerHTML = `<tr><td colspan="${PSET_COLS.length}" class="tbl-empty">
      <i class="fa-solid fa-magnifying-glass"></i> No matching properties
    </td></tr>`;
  } else {
    body.innerHTML = page
      .map((row) => {
        return `<tr data-eid="${row.expressID}" tabindex="0">
        ${PSET_COLS.map((c) => `<td class="${c.cls} ${c.numeric ? "num" : ""}"${cellColorStyle(row, c)}>${fmtCell(row[c.key], c.numeric)}</td>`).join("")}
      </tr>`;
      })
      .join("");
  }

  body.querySelectorAll("tr[data-eid]").forEach((tr) => {
    tr.addEventListener("click", () => {
      const id = parseInt(tr.dataset.eid, 10);
      clearAllActiveRows();
      tr.classList.add("row-active");
      if (onElementRowClick) onElementRowClick(id);
    });
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        tr.click();
      }
    });
  });

  renderPagination(
    "ps-pagination",
    pPage,
    totalPages,
    total,
    pPageSize,
    "properties",
    (p) => { pPage = p; renderPsets(); },
    (s) => { pPageSize = s; pPage = 1; renderPsets(); }
  );

  container
    .querySelectorAll("#col-list input[type='checkbox']")
    .forEach((cb) => {
      if (!cb.checked) toggleCol(cb);
    });

  updateHeaderIndicators("ps");
  renderFilterPills();
}

/* ── Row swatch (left border color when color-by is active) ── */

function cellColorStyle(row, colDef) {
  if (!colorByConfig || colorByConfig.tab !== activeTab || colorByConfig.key !== colDef.key) return "";
  const val = String(row[colDef.key] ?? "");
  const color = colorByConfig.palette.get(val);
  if (!color) return "";
  return ` style="background:${color}; color:#fff; font-weight:600"`;
}

/* ── Pagination ── */

function renderPagination(
  elId,
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  label,
  onPageChange,
  onPageSizeChange
) {
  const el = container.querySelector(`#${elId}`);
  const startN = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endN = Math.min(currentPage * pageSize, totalItems);

  el.innerHTML = `
    <div class="tbl-pg-info">${startN}\u2013${endN} of ${totalItems} ${label}</div>
    <div class="tbl-pg-nav">
      <button class="tbl-pg-btn pg-prev" ${currentPage <= 1 ? "disabled" : ""}>
        <i class="fa-solid fa-chevron-left"></i>
      </button>
      <span class="tbl-pg-current">Page ${currentPage} of ${totalPages}</span>
      <button class="tbl-pg-btn pg-next" ${currentPage >= totalPages ? "disabled" : ""}>
        <i class="fa-solid fa-chevron-right"></i>
      </button>
    </div>
    <div class="tbl-pg-size">
      Rows
      <select class="pg-size-select">
        ${[25, 50, 100].map((s) => `<option value="${s}" ${s === pageSize ? "selected" : ""}>${s}</option>`).join("")}
      </select>
    </div>
  `;

  el.querySelector(".pg-prev")?.addEventListener("click", () => {
    if (currentPage > 1) onPageChange(currentPage - 1);
  });
  el.querySelector(".pg-next")?.addEventListener("click", () => {
    if (currentPage < totalPages) onPageChange(currentPage + 1);
  });
  el.querySelector(".pg-size-select")?.addEventListener("change", (e) =>
    onPageSizeChange(parseInt(e.target.value, 10))
  );
}

/* ── Resize handle ── */

function initResizeHandle() {
  const handle = container.querySelector("#tbl-resize-handle");
  if (!handle) return;

  const MIN_H = 120;
  const MAX_FRAC = 0.7;

  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("dragging");
    container.style.transition = "none";
    const startY = e.clientY;
    const startH = container.getBoundingClientRect().height;

    function onMove(ev) {
      const delta = startY - ev.clientY;
      const maxH = window.innerHeight * MAX_FRAC;
      container.style.height =
        Math.min(maxH, Math.max(MIN_H, startH + delta)) + "px";
    }

    function onUp() {
      handle.classList.remove("dragging");
      container.style.transition = "";
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("lostpointercapture", onUp);
    }

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("lostpointercapture", onUp);
  });
}

/* ── Export ── */

function exportData(format) {
  const cols = activeCols();
  const data = activeTab === "elements" ? elementsData : psetsData;
  const sheetName = activeTab === "elements" ? "Elements" : "PropertySets";

  if (format === "csv") {
    const header = cols.map((c) => c.label).join(",");
    const rows = data.map((row) =>
      cols
        .map((c) => {
          let v = row[c.key] ?? "";
          v = String(v).replace(/"/g, '""');
          return `"${v}"`;
        })
        .join(",")
    );
    const csv = [header, ...rows].join("\n");
    downloadBlob(csv, `IFC_${sheetName}.csv`, "text/csv");
  } else {
    const sheetData = data.map((row) => {
      const obj = {};
      cols.forEach((c) => (obj[c.label] = row[c.key] ?? ""));
      return obj;
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, `IFC_${sheetName}.xlsx`);
  }
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ── Cell formatter ── */

function fmtCell(val, numeric) {
  if (val === null || val === undefined || val === "") return "\u2013";
  if (numeric) return fmtNum(val, 2);
  return esc(String(val));
}
