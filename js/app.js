import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { IFCLoader } from 'web-ifc-three';
import * as WebIFC from 'web-ifc';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { initTable, populateTable, highlightRow, toggle as toggleTable, onColorBy, onLegendChange, onFilter, resetColorBy } from './table.js';
import { cssColorToHex, esc } from './color-palette.js';
import { initDashboard, refreshDashboard } from './dashboard.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const container = document.getElementById('viewer-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);

const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
camera.position.set(0, 10, 20);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
dirLight.position.set(10, 20, 10);
scene.add(dirLight);

const grid = new THREE.GridHelper(100, 100, 0x444444, 0x555555);
scene.add(grid);
const axes = new THREE.AxesHelper(5);
scene.add(axes);

const ifcLoader = new IFCLoader();
let ifcModel = null;
let isEngineInitialized = false;

const highlightMaterial = new THREE.MeshLambertMaterial({
    color: 0xff3333,
    transparent: true,
    opacity: 0.8,
    depthTest: false
});

let currentSelection = { subset: null };

async function initIFCEngine() {
    if (isEngineInitialized) return;
    ifcLoader.ifcManager.setWasmPath("https://unpkg.com/web-ifc@0.0.66/");
    await ifcLoader.ifcManager.applyWebIfcConfig({
        COORDINATE_TO_ORIGIN: true,
        USE_FAST_BOOLS: true
    });
    ifcLoader.ifcManager.setupThreeMeshBVH("https://unpkg.com/three-mesh-bvh@0.5.23/build/index.module.js");
    isEngineInitialized = true;
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}
animate();

// Resize renderer when viewer-area changes (window resize OR table toggle)
function resizeRenderer() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
}

new ResizeObserver(resizeRenderer).observe(container);

const ELEMENT_CATEGORIES = [
    WebIFC.IFCWALL, WebIFC.IFCWALLSTANDARDCASE, WebIFC.IFCSLAB,
    WebIFC.IFCWINDOW, WebIFC.IFCDOOR, WebIFC.IFCCOLUMN, WebIFC.IFCBEAM,
    WebIFC.IFCFURNISHINGELEMENT, WebIFC.IFCBUILDINGELEMENTPROXY, WebIFC.IFCROOF,
    WebIFC.IFCSTAIR, WebIFC.IFCRAILING, WebIFC.IFCMEMBER, WebIFC.IFCCOVERING,
    WebIFC.IFCFLOWTERMINAL, WebIFC.IFCFLOWSEGMENT
];

const tablePanel = document.getElementById('table-panel');
const tblToggleBtn = document.getElementById('tbl-toggle');

initTable(tablePanel, {
    onElementSelect: (expressID) => selectElementById(expressID),
});

tblToggleBtn.addEventListener('click', () => { toggleTable(); syncTableButton(); });

const controlsPanel = document.getElementById('controls-panel');
const rightPanel = document.getElementById('right-panel');
const tbControls = document.getElementById('tb-controls');
const tbTable = document.getElementById('tb-table');
const tbDashboard = document.getElementById('tb-dashboard');
const controlsClose = document.getElementById('controls-close');

let controlsOpen = true;
let dashboardOpen = false;

function syncTableButton() {
    const open = tablePanel.classList.contains('open');
    tbTable.classList.toggle('active', open);
}

function setControlsOpen(open) {
    controlsOpen = open;
    controlsPanel.classList.toggle('hidden', !open);
    tbControls.classList.toggle('active', open);
}

function setDashboardOpen(open) {
    dashboardOpen = open;
    rightPanel.classList.toggle('open', open);
    tbDashboard.classList.toggle('active', open);
    // After transition, tell Gridstack to recalculate column widths
    if (open) {
        rightPanel.addEventListener('transitionend', function onEnd() {
            rightPanel.removeEventListener('transitionend', onEnd);
            window.dispatchEvent(new Event('resize'));
        });
    }
}

tbControls.addEventListener('click', () => setControlsOpen(!controlsOpen));
tbTable.addEventListener('click', () => { toggleTable(); syncTableButton(); });
tbDashboard.addEventListener('click', () => setDashboardOpen(!dashboardOpen));
controlsClose.addEventListener('click', () => setControlsOpen(false));
document.getElementById('dashboard-close').addEventListener('click', () => setDashboardOpen(false));

// Right panel resize handle
const rpHandle = document.getElementById('rp-resize-handle');
rpHandle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    rpHandle.setPointerCapture(e.pointerId);
    rpHandle.classList.add('dragging');
    rightPanel.style.transition = 'none';
    const startX = e.clientX;
    const startW = rightPanel.getBoundingClientRect().width;

    function onMove(ev) {
        const delta = startX - ev.clientX;
        const newW = Math.min(600, Math.max(200, startW + delta));
        rightPanel.style.width = newW + 'px';
        window.dispatchEvent(new Event('resize'));
    }
    function onUp() {
        rpHandle.classList.remove('dragging');
        rightPanel.style.transition = '';
        rpHandle.removeEventListener('pointermove', onMove);
        rpHandle.removeEventListener('pointerup', onUp);
        rpHandle.removeEventListener('lostpointercapture', onUp);
    }
    rpHandle.addEventListener('pointermove', onMove);
    rpHandle.addEventListener('pointerup', onUp);
    rpHandle.addEventListener('lostpointercapture', onUp);
});

// When color legend appears, auto-open the dashboard panel
onLegendChange((visible) => {
    if (visible && !dashboardOpen) {
        setDashboardOpen(true);
    }
});

// Init dashboard
initDashboard();

// Shared data for dashboard
window.__ifcViewerData = { elements: [], psets: [] };

const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');

function showLoading(msg = 'Loading...') {
    loadingText.textContent = msg;
    loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
    loadingOverlay.classList.add('hidden');
}

const colorSubsets = [];
const materialCache = new Map();

function getOrCreateMaterial(hexColor) {
    if (materialCache.has(hexColor)) return materialCache.get(hexColor);
    const mat = new THREE.MeshLambertMaterial({
        color: hexColor,
        transparent: true,
        opacity: 0.85,
        depthTest: true,
    });
    materialCache.set(hexColor, mat);
    return mat;
}

let lastColorConfig = null;
let currentFilteredIDs = null; // Set of visible IDs when filter is active

function applyColorSubsets(config) {
    lastColorConfig = config;
    clearColorSubsets();
    if (!config || !ifcModel) return;

    for (const [value, ids] of config.expressIDsByValue) {
        // If filter is active, only color the visible elements
        const filteredIds = currentFilteredIDs
            ? ids.filter(id => currentFilteredIDs.has(id))
            : ids;
        if (filteredIds.length === 0) continue;

        const cssColor = config.valueToColor.get(value);
        const hex = cssColorToHex(cssColor);
        const material = getOrCreateMaterial(hex);
        const subset = ifcLoader.ifcManager.createSubset({
            modelID: ifcModel.modelID,
            ids: filteredIds,
            material,
            scene,
            removePrevious: false,
        });
        colorSubsets.push({ material, subset });
    }
}

function clearColorSubsets() {
    if (!ifcModel) return;
    for (const { material } of colorSubsets) {
        ifcLoader.ifcManager.removeSubset(ifcModel.modelID, material);
    }
    colorSubsets.length = 0;
}

onColorBy(async (config) => {
    try {
        if (config) showLoading('Applying colors...');
        await new Promise(r => setTimeout(r, 30));
        applyColorSubsets(config);
    } catch (err) {
        console.error('Color apply error:', err);
    } finally {
        hideLoading();
    }
});

// Ghost filtered-out elements so they're visible but faded; non-ghosted elements stay interactive
const ghostMaterial = new THREE.MeshLambertMaterial({
    color: 0xcccccc,
    transparent: true,
    opacity: 0.1,
    depthTest: true,
});
const visibleFilterMaterial = new THREE.MeshLambertMaterial({
    color: 0xdddddd,
    transparent: false,
});
let ghostSubset = null;
let visibleSubset = null;
let filterActive = false;

function applyFilterSubsets(filterData) {
    clearFilterSubsets();
    if (!filterData || !ifcModel) return;

    filterActive = true;
    currentFilteredIDs = new Set(filterData.visibleIDs);

    // Hide the original model
    ifcModel.visible = false;

    // Show filtered-in elements with original-like material
    if (filterData.visibleIDs.length > 0) {
        visibleSubset = ifcLoader.ifcManager.createSubset({
            modelID: ifcModel.modelID,
            ids: filterData.visibleIDs,
            material: visibleFilterMaterial,
            scene,
            removePrevious: true,
        });
    }

    // Ghost filtered-out elements (not clickable)
    if (filterData.hiddenIDs.length > 0) {
        ghostSubset = ifcLoader.ifcManager.createSubset({
            modelID: ifcModel.modelID,
            ids: filterData.hiddenIDs,
            material: ghostMaterial,
            scene,
            removePrevious: true,
        });
        if (ghostSubset) ghostSubset.raycast = () => {};
    }

    // Re-apply color subsets with only visible IDs
    if (lastColorConfig) applyColorSubsets(lastColorConfig);
}

function clearFilterSubsets() {
    if (!ifcModel) return;
    if (visibleSubset) {
        ifcLoader.ifcManager.removeSubset(ifcModel.modelID, visibleFilterMaterial);
        visibleSubset = null;
    }
    if (ghostSubset) {
        ifcLoader.ifcManager.removeSubset(ifcModel.modelID, ghostMaterial);
        ghostSubset = null;
    }
    if (filterActive) {
        ifcModel.visible = true;
        filterActive = false;
        currentFilteredIDs = null;
        // Re-apply full color subsets (unfiltered)
        if (lastColorConfig) applyColorSubsets(lastColorConfig);
    }
}

onFilter(async (filterData) => {
    try {
        if (filterData) showLoading('Syncing 3D view...');
        await new Promise(r => setTimeout(r, 20));
        applyFilterSubsets(filterData);
    } catch (err) {
        console.error('Filter sync error:', err);
    } finally {
        hideLoading();
    }
});

const statusDiv = document.getElementById('status');
const exportBtn = document.getElementById('export-btn');
const sampleBtn = document.getElementById('sample-btn');
const propPanel = document.getElementById('prop-panel');
const propContent = document.getElementById('prop-content');

window.closePropPanel = () => {
    propPanel.classList.add('hidden');
    // Clear highlighting
    if (currentSelection.subset && ifcModel) {
        ifcLoader.ifcManager.removeSubset(ifcModel.modelID, highlightMaterial);
        currentSelection.subset = null;
    }
};

function setStatus(msg, type='loading') {
    statusDiv.classList.remove('hidden');
    if(type === 'loading') {
        statusDiv.innerHTML = `<div class="loader"></div>${msg}`;
        statusDiv.classList.remove('bg-green-50', 'text-green-700', 'bg-red-50', 'text-red-700');
        statusDiv.classList.add('bg-blue-50', 'text-blue-700');
    } else if(type === 'success') {
        statusDiv.innerHTML = `<i class="fa-solid fa-check-circle mr-2"></i>${msg}`;
        statusDiv.classList.remove('bg-blue-50', 'text-blue-700');
        statusDiv.classList.add('bg-green-50', 'text-green-700');
    } else {
        statusDiv.innerHTML = `<i class="fa-solid fa-exclamation-circle mr-2"></i>${msg}`;
        statusDiv.classList.remove('bg-blue-50', 'text-blue-700');
        statusDiv.classList.add('bg-red-50', 'text-red-700');
    }
}

async function loadModel(url) {
    if(ifcModel) {
        lastColorConfig = null;
        currentFilteredIDs = null;
        clearColorSubsets();
        clearFilterSubsets();
        // Dispose cached materials
        for (const mat of materialCache.values()) mat.dispose();
        materialCache.clear();
        resetColorBy();
        scene.remove(ifcModel);
        ifcLoader.ifcManager.removeSubset(ifcModel.modelID, highlightMaterial);
        ifcModel = null;
        window.closePropPanel();
    }

    setStatus(`Initializing Engine & Parsing...`, 'loading');
    showLoading('Loading IFC model...');
    exportBtn.disabled = true;
    sampleBtn.disabled = true;

    try {
        await initIFCEngine();

        showLoading('Parsing geometry...');
        ifcModel = await ifcLoader.loadAsync(url);
        scene.add(ifcModel);

        // Auto-center camera
        const box = new THREE.Box3().setFromObject(ifcModel);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);

        controls.target.copy(center);
        camera.position.set(center.x + maxDim, center.y + maxDim / 2, center.z + maxDim);
        camera.lookAt(center);
        controls.update();

        // Extract elements + property sets for table
        showLoading('Extracting element data...');
        setStatus('Extracting element data...', 'loading');
        const { elements, psets, totalCount } = await extractTableData(ifcModel.modelID);

        populateTable(elements, psets);
        syncTableButton();
        window.__ifcViewerData = { elements, psets };
        refreshDashboard();
        hideLoading();

        setStatus(`<b>Loaded!</b><br/>~${totalCount} Elements`, 'success');
        exportBtn.disabled = false;
        sampleBtn.disabled = false;

    } catch(err) {
        hideLoading();
        console.error("IFC Loading Error:", err);
        setStatus("Error: " + (err.message || "Failed to load"), 'error');
        sampleBtn.disabled = false;
    }
}

async function extractTableData(modelID) {
    const elements = [];
    const psets = [];

    for (const cat of ELEMENT_CATEGORIES) {
        const items = await ifcLoader.ifcManager.getAllItemsOfType(modelID, cat, true);
        for (const el of items) {
            const typeName = el.constructor.name.replace('Ifc', '');
            elements.push({
                expressID: el.expressID,
                GlobalId: el.GlobalId?.value ?? '',
                Name: el.Name?.value ?? '',
                Type: typeName,
                Tag: el.Tag?.value ?? '',
            });

            try {
                const propSets = await ifcLoader.ifcManager.getPropertySets(modelID, el.expressID, true);
                for (const ps of propSets) {
                    if (!ps.HasProperties) continue;
                    const psetName = ps.Name?.value ?? 'Unknown';
                    for (const prop of ps.HasProperties) {
                        if (!prop.Name?.value || !prop.NominalValue) continue;
                        let val = prop.NominalValue.value;
                        if (typeof val === 'number') val = parseFloat(val.toFixed(3));
                        psets.push({
                            expressID: el.expressID,
                            ElementName: el.Name?.value ?? '',
                            PSetName: psetName,
                            Property: prop.Name.value,
                            Value: val,
                        });
                    }
                }
            } catch (_) { /* skip */ }
        }
    }

    return { elements, psets, totalCount: elements.length };
}

function selectElementById(expressID) {
    if (!ifcModel) return;

    if (currentSelection.subset) {
        ifcLoader.ifcManager.removeSubset(ifcModel.modelID, highlightMaterial);
    }

    currentSelection.subset = ifcLoader.ifcManager.createSubset({
        modelID: ifcModel.modelID,
        ids: [expressID],
        material: highlightMaterial,
        scene: scene,
        removePrevious: true,
    });

    // Show properties
    ifcLoader.ifcManager.getItemProperties(ifcModel.modelID, expressID).then(showProps);
}


document.getElementById('file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if(!file) return;
    const url = URL.createObjectURL(file);
    await loadModel(url);
    URL.revokeObjectURL(url);
});

sampleBtn.addEventListener('click', async () => {
    setStatus("Loading sample model...", 'loading');
    sampleBtn.disabled = true;
    exportBtn.disabled = true;

    try {
        await loadModel("assets/Ifc4_Revit_ARC.ifc");
    } catch (err) {
         console.error("Sample Load Error:", err);
         setStatus("Error: " + err.message, 'error');
         sampleBtn.disabled = false;
    }
});

const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true;
const mouse = new THREE.Vector2();

let isDragging = false;
let mouseDownTime = 0;
const clickThresholdMs = 200; // Time threshold to distinguish click vs hold
const dragThresholdPx = 5; // Pixel movement threshold

let startX = 0;
let startY = 0;

window.addEventListener('pointerdown', (e) => {
    isDragging = false;
    mouseDownTime = Date.now();
    startX = e.clientX;
    startY = e.clientY;
});

window.addEventListener('pointermove', (e) => {
    if (Date.now() - mouseDownTime > clickThresholdMs ||
        Math.abs(e.clientX - startX) > dragThresholdPx ||
        Math.abs(e.clientY - startY) > dragThresholdPx) {
        isDragging = true;
    }
});

window.addEventListener('pointerup', async (event) => {
    // If we dragged/rotated, do NOT select
    if(isDragging) return;
    if(!ifcModel) return;
    // Only raycast clicks inside the 3D viewer
    if(!container.contains(event.target)) return;

    // --- Raycasting Logic ---
    const rect = container.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObject(ifcModel);

    if(intersects.length > 0) {
        const faceIndex = intersects[0].faceIndex;
        const geometry = intersects[0].object.geometry;
        const id = ifcLoader.ifcManager.getExpressId(geometry, faceIndex);

        if(currentSelection.subset) {
             ifcLoader.ifcManager.removeSubset(ifcModel.modelID, highlightMaterial);
        }

        currentSelection.subset = ifcLoader.ifcManager.createSubset({
            modelID: ifcModel.modelID,
            ids: [id],
            material: highlightMaterial,
            scene: scene,
            removePrevious: true
        });

        const props = await ifcLoader.ifcManager.getItemProperties(ifcModel.modelID, id);
        showProps(props);
        highlightRow(id);
    } else {
        window.closePropPanel();
    }
});

function showProps(props) {
    propPanel.classList.remove('hidden');
    const name = esc(props.Name && props.Name.value ? props.Name.value : 'Unnamed Element');
    const type = esc(props.constructor.name.replace('Ifc', '').toUpperCase());

    let html = `
        <div class="mb-3">
            <div class="font-bold text-lg text-blue-800 leading-tight">${name}</div>
            <div class="text-[10px] bg-blue-100 text-blue-800 px-2 py-0.5 rounded inline-block mt-1">${type}</div>
        </div>`;

    for(const key in props) {
        const val = props[key];
        if(!val || typeof val === 'function' || val === null) continue;
        if(key === 'expressID' || key === 'type') continue;

        let displayVal = val.value !== undefined ? val.value : val;
        if(typeof displayVal === 'number') displayVal = Math.round(displayVal * 100) / 100;
        const safeVal = esc(String(displayVal));
        const safeKey = esc(key);

        html += `<div class="flex justify-between border-b border-gray-100 py-1">
            <span class="text-gray-500">${safeKey}</span>
            <span class="font-medium text-gray-800 text-right truncate pl-2 max-w-[150px]" title="${safeVal}">${safeVal}</span>
        </div>`;
    }
    propContent.innerHTML = html;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

exportBtn.addEventListener('click', async () => {
    if(!ifcModel) return;
    setStatus("Preparing export...", 'loading');

    const categories = [
        WebIFC.IFCPROJECT, WebIFC.IFCSITE, WebIFC.IFCBUILDING, WebIFC.IFCBUILDINGSTOREY, WebIFC.IFCSPACE,
        WebIFC.IFCWALL, WebIFC.IFCWALLSTANDARDCASE, WebIFC.IFCSLAB, WebIFC.IFCROOF, WebIFC.IFCWINDOW,
        WebIFC.IFCDOOR, WebIFC.IFCCOLUMN, WebIFC.IFCBEAM, WebIFC.IFCSTAIR, WebIFC.IFCRAILING,
        WebIFC.IFCMEMBER, WebIFC.IFCCOVERING, WebIFC.IFCFURNISHINGELEMENT, WebIFC.IFCFLOWTERMINAL,
        WebIFC.IFCFLOWSEGMENT
    ];

    const wb = XLSX.utils.book_new();
    let totalSheets = 0;

    try {
        for (const category of categories) {
            const elements = await ifcLoader.ifcManager.getAllItemsOfType(ifcModel.modelID, category, true);
            if (elements.length === 0) continue;

            const categoryName = elements[0].constructor.name.replace('Ifc', '');
            let sheetData = [];

            // Yield every 50 items to keep UI responsive
            for (let i = 0; i < elements.length; i++) {
                // Every 50 items, pause for 10ms to let UI update
                if (i % 50 === 0) {
                    setStatus(`Exporting ${categoryName}: ${Math.round((i/elements.length)*100)}%`, 'loading');
                    await sleep(10);
                }

                const el = elements[i];
                let row = {
                    'ID': el.expressID,
                    'GlobalID': el.GlobalId ? el.GlobalId.value : '',
                    'Name': el.Name ? el.Name.value : ''
                };

                try {
                    const psets = await ifcLoader.ifcManager.getPropertySets(ifcModel.modelID, el.expressID, true);
                    for (const pset of psets) {
                        if (pset.HasProperties) {
                            for (const prop of pset.HasProperties) {
                                if (prop.Name && prop.Name.value && prop.NominalValue) {
                                    const psetName = pset.Name && pset.Name.value ? pset.Name.value : 'Unknown';
                                    const propName = prop.Name.value;
                                    let propVal = prop.NominalValue.value;
                                    if (typeof propVal === 'number') propVal = parseFloat(propVal.toFixed(3));
                                    row[`${psetName}.${propName}`] = propVal;
                                }
                            }
                        }
                    }
                } catch (err) { /* ignore */ }

                sheetData.push(row);
            }

            const ws = XLSX.utils.json_to_sheet(sheetData);
            const safeSheetName = categoryName.substring(0, 31);
            XLSX.utils.book_append_sheet(wb, ws, safeSheetName);
            totalSheets++;
        }

        if(totalSheets === 0) throw new Error("No architectural data found to export.");

        setStatus("Finalizing file...", 'loading');
        await sleep(50); // One last breath
        XLSX.writeFile(wb, "IFC_Export_Safe.xlsx");

        setStatus(`Success! Exported ${totalSheets} sheets.`, 'success');

    } catch(e) {
        console.error(e);
        setStatus(`Export failed: ${e.message}`, 'error');
    }
});
