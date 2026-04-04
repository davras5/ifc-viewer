import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { IFCLoader } from 'web-ifc-three';
import * as WebIFC from 'web-ifc';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { initTable, populateTable, highlightRow, toggle as toggleTable } from './table.js';

// --- Setup BVH ---
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// --- 1. Three.js Scene Setup ---
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

// --- 2. IFC Loader & Init Logic ---
const ifcLoader = new IFCLoader();
let ifcModel = null;
let isEngineInitialized = false;

// Selection Material (Red highlight)
const highlightMaterial = new THREE.MeshLambertMaterial({
    color: 0xff3333,
    transparent: true,
    opacity: 0.8,
    depthTest: false
});

let currentSelection = {
    modelID: null,
    id: null,
    subset: null
};

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

// --- 3. Animation Loop ---
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

// --- IFC element categories (shared by stats + table extraction) ---
const ELEMENT_CATEGORIES = [
    WebIFC.IFCWALL, WebIFC.IFCWALLSTANDARDCASE, WebIFC.IFCSLAB,
    WebIFC.IFCWINDOW, WebIFC.IFCDOOR, WebIFC.IFCCOLUMN, WebIFC.IFCBEAM,
    WebIFC.IFCFURNISHINGELEMENT, WebIFC.IFCBUILDINGELEMENTPROXY, WebIFC.IFCROOF,
    WebIFC.IFCSTAIR, WebIFC.IFCRAILING, WebIFC.IFCMEMBER, WebIFC.IFCCOVERING,
    WebIFC.IFCFLOWTERMINAL, WebIFC.IFCFLOWSEGMENT
];

// --- Init table ---
const tablePanel = document.getElementById('table-panel');
const tblToggleBtn = document.getElementById('tbl-toggle');

initTable(tablePanel, {
    onElementSelect: (expressID) => selectElementById(expressID),
});

tblToggleBtn.addEventListener('click', toggleTable);

// --- 4. UI Logic ---
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

// --- 5. Main Loading Logic (Reusable) ---
async function loadModel(url) {
    if(ifcModel) {
        scene.remove(ifcModel);
        ifcLoader.ifcManager.removeSubset(ifcModel.modelID, highlightMaterial);
        ifcModel = null;
        window.closePropPanel();
    }

    setStatus(`Initializing Engine & Parsing...`, 'loading');
    exportBtn.disabled = true;
    sampleBtn.disabled = true;

    try {
        await initIFCEngine();

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
        setStatus('Extracting element data...', 'loading');
        const { elements, psets, totalCount } = await extractTableData(ifcModel.modelID);

        populateTable(elements, psets);

        setStatus(`<b>Loaded!</b><br/>~${totalCount} Elements`, 'success');
        exportBtn.disabled = false;
        sampleBtn.disabled = false;

    } catch(err) {
        console.error("IFC Loading Error:", err);
        setStatus("Error: " + (err.message || "Failed to load"), 'error');
        sampleBtn.disabled = false;
    }
}

// --- Extract IFC data for table ---
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

// --- Select element by expressID (from table row click) ---
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

// --- 5a. Event Listeners ---

// Local File
document.getElementById('file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if(!file) return;
    const url = URL.createObjectURL(file);
    await loadModel(url);
});

// Sample Model (EMBEDDED GENERATOR)
sampleBtn.addEventListener('click', async () => {
    setStatus("Generating Sample Model...", 'loading');
    sampleBtn.disabled = true;
    exportBtn.disabled = true;

    // Minimal valid IFC file content to prevent network/CORS errors
    const ifcString = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('Sample.ifc','2023-11-20',('User'),('Org'),'IFC text editor','IFC text editor','None');
FILE_SCHEMA(('IFC2X3'));
ENDSEC;
DATA;
#1=IFCPROJECT('0j1k2l3m4n5o6p7q8r9s0t',#2,'Default Project',$,$,$,$,(#10),#3);
#2=IFCOWNERHISTORY(#4,#5,$,.ADDED.,$,$,$,1700494444);
#3=IFCUNITASSIGNMENT((#6,#7,#8,#9));
#4=IFCPERSON($,'User','Defined',$,$,$,$,$);
#5=IFCORGANIZATION($,'Organization',$,$,$);
#6=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#7=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);
#8=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);
#9=IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.);
#10=IFCSITE('0j1k2l3m4n5o6p7q8r9s0u',#2,'Default Site',$,$,#11,$,$,.ELEMENT.,(0,0,0),(0,0,0),0.,$,$);
#11=IFCBUILDING('0j1k2l3m4n5o6p7q8r9s0v',#2,'Default Building',$,$,#12,$,$,.ELEMENT.,(0,0,0),(0,0,0),0.,$,$);
#12=IFCBUILDINGSTOREY('0j1k2l3m4n5o6p7q8r9s0w',#2,'Level 1',$,$,#13,$,$,.ELEMENT.,0.);
#13=IFCWALLSTANDARDCASE('0j1k2l3m4n5o6p7q8r9s0x',#2,'Sample Wall',$,$,#14,#19,$,.STANDARD.);
#14=IFCLOCALPLACEMENT($,#15);
#15=IFCAXIS2PLACEMENT3D(#16,#17,#18);
#16=IFCCARTESIANPOINT((0.,0.,0.));
#17=IFCDIRECTION((0.,0.,1.));
#18=IFCDIRECTION((1.,0.,0.));
#19=IFCPRODUCTDEFINITIONSHAPE($,$,(#20));
#20=IFCSHAPEREPRESENTATION(#11,'Body','SweptSolid',(#21));
#21=IFCEXTRUDEDAREASOLID(#22,#23,#17,2.5);
#22=IFCRECTANGLEPROFILEDEF(.AREA.,'Wall Profile',$,4.,0.3);
#23=IFCAXIS2PLACEMENT3D(#16,#17,#18);
ENDSEC;
END-ISO-10303-21;`;

    try {
        // Convert string to blob, then to file URL
        const blob = new Blob([ifcString], { type: 'text/plain' });
        const file = new File([blob], "Sample.ifc");
        const url = URL.createObjectURL(file);

        await loadModel(url);
    } catch (err) {
         console.error("Sample Gen Error:", err);
         setStatus("Error: " + err.message, 'error');
         sampleBtn.disabled = false;
    }
});

// --- 6. Improved Selection (Single Click with Drag Detection) ---
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
    const name = props.Name && props.Name.value ? props.Name.value : 'Unnamed Element';
    const type = props.constructor.name.replace('Ifc', '').toUpperCase();

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

        html += `<div class="flex justify-between border-b border-gray-100 py-1">
            <span class="text-gray-500">${key}</span>
            <span class="font-medium text-gray-800 text-right truncate pl-2 max-w-[150px]" title="${displayVal}">${displayVal}</span>
        </div>`;
    }
    propContent.innerHTML = html;
}

// --- 7. Optimized Export Logic (Time-Sliced) ---
// Helper to let UI breathe
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

            // --- 1. CRASH FIX: Time-Sliced Loop ---
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
