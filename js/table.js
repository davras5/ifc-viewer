/**
 * IFC Table widget — two tabs (Elements / Property Sets), toolbar with search,
 * sortable headers, pagination, column visibility dropdown, resize handle,
 * export actions (Excel / CSV).
 */

/* ── Helpers ── */

const esc = (s) => {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
};

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

/* ── Column definitions ── */

const ELEMENT_COLS = [
  { key: "expressID", label: "ID", cls: "col-e-id", numeric: true },
  { key: "GlobalId", label: "GlobalId", cls: "col-e-gid" },
  { key: "Name", label: "Name", cls: "col-e-name" },
  { key: "Type", label: "Type", cls: "col-e-type" },
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

/* ── Public API ── */

export function initTable(el, { onElementSelect } = {}) {
  container = el;
  onElementRowClick = onElementSelect || null;
  renderEmptyState();
}

function renderEmptyState() {
  container.innerHTML = `
    <div class="tbl-empty-state">
      <i class="fa-solid fa-cube"></i>
      <span>No model loaded \u2014 open an IFC file or load the sample to see data here.</span>
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

/* ── Shell ── */

function renderShell() {
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
        <div class="tbl-actions">
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
        <div class="tbl-scroll">
          <table class="tbl-table" id="el-table">
            <thead><tr id="el-header"></tr></thead>
            <tbody id="el-body"></tbody>
          </table>
        </div>
        <div class="tbl-pagination" id="el-pagination"></div>
      </div>
      <div class="tbl-tab-content" id="ttab-psets">
        <div class="tbl-scroll">
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
}

function setupDropdown(btnId, menuId) {
  const btn = container.querySelector(`#${btnId}`);
  const menu = container.querySelector(`#${menuId}`);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    // Close other dropdowns
    container.querySelectorAll(".tbl-dropdown-menu.show").forEach((m) => {
      if (m !== menu) m.classList.remove("show");
    });
    menu.classList.toggle("show");
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(`#${menuId}`) && !e.target.closest(`#${btnId}`)) {
      menu.classList.remove("show");
    }
  });
}

/* ── Headers ── */

function renderHeaders(rowId, cols, prefix) {
  const row = container.querySelector(`#${rowId}`);
  row.innerHTML = cols
    .map(
      (c) =>
        `<th class="${c.cls} sortable" data-key="${c.key}" data-prefix="${prefix}">
      ${esc(c.label)} <i class="fa-solid fa-sort sort-icon"></i>
    </th>`
    )
    .join("");

  row.querySelectorAll("th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      if (prefix === "e") {
        if (eSortField === key) eSortAsc = !eSortAsc;
        else {
          eSortField = key;
          eSortAsc = true;
        }
      } else {
        if (pSortField === key) pSortAsc = !pSortAsc;
        else {
          pSortField = key;
          pSortAsc = true;
        }
      }
      renderActiveTab();
      updateSortIndicators(
        rowId,
        key,
        prefix === "e" ? eSortAsc : pSortAsc
      );
    });
  });
}

function updateSortIndicators(rowId, activeKey, asc) {
  const row = container.querySelector(`#${rowId}`);
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
        `${el.expressID} ${el.GlobalId} ${el.Name} ${el.Type} ${el.Tag}`.toLowerCase();
      return s.includes(eSearch);
    });
  }

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
      .map(
        (row) =>
          `<tr data-eid="${row.expressID}" tabindex="0">
        ${ELEMENT_COLS.map((c) => `<td class="${c.cls} ${c.numeric ? "num" : ""}">${fmtCell(row[c.key], c.numeric)}</td>`).join("")}
      </tr>`
      )
      .join("");
  }

  // Row click
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

  // Re-apply hidden columns
  container
    .querySelectorAll("#col-list input[type='checkbox']")
    .forEach((cb) => {
      if (!cb.checked) toggleCol(cb);
    });
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
      .map(
        (row) =>
          `<tr data-eid="${row.expressID}" tabindex="0">
        ${PSET_COLS.map((c) => `<td class="${c.cls} ${c.numeric ? "num" : ""}">${fmtCell(row[c.key], c.numeric)}</td>`).join("")}
      </tr>`
      )
      .join("");
  }

  // Row click → highlight element in 3D
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
