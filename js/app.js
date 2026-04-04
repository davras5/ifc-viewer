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
    ifcLoader.ifcManager.setWasmPath("https://unpkg.com/web-ifc@0.0.77/");
    await ifcLoader.ifcManager.applyWebIfcConfig({
        COORDINATE_TO_ORIGIN: true,
        USE_FAST_BOOLS: true
    });
    ifcLoader.ifcManager.setupThreeMeshBVH("https://unpkg.com/three-mesh-bvh@0.5.23/build/index.module.js");
    isEngineInitialized = true;
}

// Keyboard navigation (WASD + arrows)
const keysPressed = new Set();
let moveSpeed = 0.3;

window.addEventListener('keydown', (e) => {
    // Don't capture keys when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    keysPressed.add(e.key.toLowerCase());
});
window.addEventListener('keyup', (e) => {
    keysPressed.delete(e.key.toLowerCase());
});

const _moveDir = new THREE.Vector3();
const _sideDir = new THREE.Vector3();

function applyKeyboardMovement() {
    if (keysPressed.size === 0) return;

    // Get camera forward direction (projected to horizontal plane)
    camera.getWorldDirection(_moveDir);
    _moveDir.y = 0;
    _moveDir.normalize();

    // Side direction (perpendicular)
    _sideDir.crossVectors(camera.up, _moveDir).normalize();

    let moved = false;

    // Forward/back: W/S or ArrowUp/ArrowDown
    if (keysPressed.has('w') || keysPressed.has('arrowup')) {
        camera.position.addScaledVector(_moveDir, moveSpeed);
        controls.target.addScaledVector(_moveDir, moveSpeed);
        moved = true;
    }
    if (keysPressed.has('s') || keysPressed.has('arrowdown')) {
        camera.position.addScaledVector(_moveDir, -moveSpeed);
        controls.target.addScaledVector(_moveDir, -moveSpeed);
        moved = true;
    }

    // Strafe left/right: A/D or ArrowLeft/ArrowRight
    if (keysPressed.has('a') || keysPressed.has('arrowleft')) {
        camera.position.addScaledVector(_sideDir, moveSpeed);
        controls.target.addScaledVector(_sideDir, moveSpeed);
        moved = true;
    }
    if (keysPressed.has('d') || keysPressed.has('arrowright')) {
        camera.position.addScaledVector(_sideDir, -moveSpeed);
        controls.target.addScaledVector(_sideDir, -moveSpeed);
        moved = true;
    }

    // Up/down: Q/E
    if (keysPressed.has('q')) {
        camera.position.y -= moveSpeed;
        controls.target.y -= moveSpeed;
        moved = true;
    }
    if (keysPressed.has('e')) {
        camera.position.y += moveSpeed;
        controls.target.y += moveSpeed;
        moved = true;
    }
}

function animate() {
    requestAnimationFrame(animate);
    applyKeyboardMovement();
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
    WebIFC.IFCFLOWTERMINAL, WebIFC.IFCFLOWSEGMENT, WebIFC.IFCOPENINGELEMENT,
    WebIFC.IFCPLATE, WebIFC.IFCCURTAINWALL,
    WebIFC.IFCBUILDINGSTOREY, WebIFC.IFCSPACE
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

// Viewer toolbar
const viewerToolbar = document.getElementById('viewer-toolbar');
const tbViewerTools = document.getElementById('tb-viewer-tools');
const vtMaterial = document.getElementById('vt-material');
const vtGrid = document.getElementById('vt-grid');
const vtPan = document.getElementById('vt-pan');

function setViewerToolbarOpen(open) {
    viewerToolbar.classList.toggle('hidden', !open);
    tbViewerTools.classList.toggle('active', open);
}

tbViewerTools.addEventListener('click', () => {
    setViewerToolbarOpen(viewerToolbar.classList.contains('hidden'));
});
document.getElementById('vt-close').addEventListener('click', () => {
    setViewerToolbarOpen(false);
});

// View modes: 0=solid, 1=IFC materials, 2=xray, 3=wireframe
let materialMode = 1;
const materialModeIcons = ['fa-swatchbook', 'fa-fill-drip', 'fa-eye', 'fa-border-none'];

function applyMaterialMode() {
    if (!ifcModel) return;
    const mat = ifcModel.material;
    const applyTo = Array.isArray(mat) ? mat : [mat];

    // Modes: 0=solid, 1=IFC materials, 2=xray, 3=wireframe
    for (const m of applyTo) {
        switch (materialMode) {
            case 0: // Solid (default gray)
            case 1: // IFC materials (subsets handle the color, base stays solid)
                m.transparent = false;
                m.opacity = 1;
                m.wireframe = false;
                m.depthWrite = true;
                break;
            case 2: // X-ray
                m.transparent = true;
                m.opacity = 0.3;
                m.wireframe = false;
                m.depthWrite = false;
                break;
            case 3: // Wireframe
                m.transparent = false;
                m.opacity = 1;
                m.wireframe = true;
                m.depthWrite = true;
                break;
        }
        m.needsUpdate = true;
    }

    // Update button icon
    const icon = vtMaterial.querySelector('i');
    icon.className = `fa-solid ${materialModeIcons[materialMode]}`;
    vtMaterial.classList.toggle('active', materialMode !== 0);
}

// IFC material color subsets
const ifcMaterialSubsets = [];
let ifcMaterialsLoaded = false;

async function extractAndApplyMaterials(modelID) {
    clearIfcMaterialSubsets();
    ifcMaterialsLoaded = false;

    try {
        const materialColorMap = new Map();

        // Step 1: Build surface style → color map
        const surfaceStyleIds = await ifcLoader.ifcManager.getAllItemsOfType(modelID, WebIFC.IFCSURFACESTYLE, false);

        const styleColorMap = new Map(); // surfaceStyleID → {r,g,b}
        for (const ssId of (surfaceStyleIds || [])) {
            const ss = await ifcLoader.ifcManager.getItemProperties(modelID, ssId, false);
            const innerRefs = ss?.Styles || [];
            for (const ref of innerRefs) {
                const inner = await ifcLoader.ifcManager.getItemProperties(modelID, ref.value, false);
                const rgb = await extractRgb(modelID, inner?.SurfaceColour);
                if (rgb) {
                    // Extract transparency (0=opaque, 1=fully transparent in IFC)
                    let t = inner?.Transparency;
                    if (t && typeof t === 'object') t = t.value;
                    rgb.transparency = (typeof t === 'number' && t > 0) ? t : 0;
                    styleColorMap.set(ssId, rgb);
                    break;
                }
            }
        }
        // Step 2: Build material → color via IfcMaterialDefinitionRepresentation
        const matDefRepIds = await ifcLoader.ifcManager.getAllItemsOfType(modelID, WebIFC.IFCMATERIALDEFINITIONREPRESENTATION, false).catch(() => []);

        for (const mdrId of (matDefRepIds || [])) {
            const mdr = await ifcLoader.ifcManager.getItemProperties(modelID, mdrId, false);
            const matRef = mdr?.RepresentedMaterial?.value;
            if (!matRef) continue;

            const representations = mdr?.Representations || [];
            for (const repRef of representations) {
                const rep = await ifcLoader.ifcManager.getItemProperties(modelID, repRef.value, false);
                const items = rep?.Items || [];
                for (const itemRef of items) {
                    const item = await ifcLoader.ifcManager.getItemProperties(modelID, itemRef.value, false);
                    // This should be an IfcStyledItem with Styles
                    const styles = item?.Styles || [];
                    for (const sRef of styles) {
                        // Could be IfcPresentationStyleAssignment or direct IfcSurfaceStyle
                        const color = await resolveColor(modelID, sRef.value);
                        if (color) { materialColorMap.set(matRef, color); break; }
                    }
                    if (materialColorMap.has(matRef)) break;
                }
                if (materialColorMap.has(matRef)) break;
            }
        }

        // Fallback: if no MaterialDefinitionRepresentation, try matching by name
        if (materialColorMap.size === 0 && styleColorMap.size > 0) {
            // Fallback: match materials to surface styles by name
            const materialIds = await ifcLoader.ifcManager.getAllItemsOfType(modelID, WebIFC.IFCMATERIAL, false);
            const styleNameColorMap = new Map();
            for (const [ssId, color] of styleColorMap) {
                const ss = await ifcLoader.ifcManager.getItemProperties(modelID, ssId, false);
                const name = ss?.Name?.value ?? '';
                if (name) styleNameColorMap.set(name, color);
            }
            for (const matId of (materialIds || [])) {
                const mat = await ifcLoader.ifcManager.getItemProperties(modelID, matId, false);
                const matName = mat?.Name?.value ?? '';
                if (matName && styleNameColorMap.has(matName)) {
                    const color = { ...styleNameColorMap.get(matName) };
                    // Heuristic: force transparency for glass/glazing materials
                    const ln = matName.toLowerCase();
                    if (color.transparency === 0 && (ln.includes('glass') || ln.includes('glazing') || ln.includes('transparent') || ln.includes('glas'))) {
                        color.transparency = 0.6;
                    }
                    materialColorMap.set(matId, color);
                }
            }
            for (const matId of (materialIds || [])) {
                const mat = await ifcLoader.ifcManager.getItemProperties(modelID, matId, false);
                // Try getMaterialsProperties for HasRepresentation
                const hasRep = mat?.HasRepresentation;
                if (hasRep) {
                    for (const repRef of (Array.isArray(hasRep) ? hasRep : [hasRep])) {
                        const repId = repRef?.value ?? repRef;
                        if (!repId) continue;
                        const rep = await ifcLoader.ifcManager.getItemProperties(modelID, repId, false);
                        const reps = rep?.Representations || [];
                        for (const rRef of reps) {
                            const r = await ifcLoader.ifcManager.getItemProperties(modelID, rRef.value, false);
                            for (const iRef of (r?.Items || [])) {
                                const si = await ifcLoader.ifcManager.getItemProperties(modelID, iRef.value, false);
                                for (const sRef of (si?.Styles || [])) {
                                    const color = await resolveColor(modelID, sRef.value);
                                    if (color) { materialColorMap.set(matId, color); break; }
                                }
                                if (materialColorMap.has(matId)) break;
                            }
                            if (materialColorMap.has(matId)) break;
                        }
                    }
                }
            }
        }

        if (materialColorMap.size === 0 && styleColorMap.size === 0) return;

        // Step 3: Map elements to colors via IfcRelAssociatesMaterial
        const colorToIds = new Map();
        const matRelIds = await ifcLoader.ifcManager.getAllItemsOfType(modelID, WebIFC.IFCRELASSOCIATESMATERIAL, false);

        for (const relId of (matRelIds || [])) {
            const rel = await ifcLoader.ifcManager.getItemProperties(modelID, relId, false);
            const matUsageRef = rel?.RelatingMaterial?.value;
            if (!matUsageRef) continue;

            let color = await resolveMaterialColor(modelID, matUsageRef, materialColorMap);
            if (!color) continue;

            const key = `${color.r},${color.g},${color.b},${color.transparency ?? 0}`;
            const elements = rel?.RelatedObjects || [];
            for (const elRef of elements) {
                if (!colorToIds.has(key)) colorToIds.set(key, []);
                colorToIds.get(key).push(elRef.value);
            }
        }

        if (colorToIds.size === 0) return;

        // Exclude IfcOpeningElement IDs — voids should not be rendered as material subsets
        const openingIds = new Set(
            await ifcLoader.ifcManager.getAllItemsOfType(modelID, WebIFC.IFCOPENINGELEMENT, false).catch(() => [])
        );
        if (openingIds.size > 0) {
            for (const [key, ids] of colorToIds) {
                colorToIds.set(key, ids.filter(id => !openingIds.has(id)));
            }
        }

        // Step 4: Create subsets per color
        for (const [key, ids] of colorToIds) {
            const [r, g, b, t] = key.split(',').map(Number);
            const hex = (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
            const opacity = 1 - (t || 0);
            const isTransparent = opacity < 0.95;
            const mat = new THREE.MeshLambertMaterial({
                color: hex,
                transparent: isTransparent,
                opacity,
                depthWrite: !isTransparent,
                side: isTransparent ? THREE.DoubleSide : THREE.FrontSide,
            });

            const subset = ifcLoader.ifcManager.createSubset({
                modelID,
                ids,
                material: mat,
                scene,
                removePrevious: false,
            });
            ifcMaterialSubsets.push({ material: mat, subset });
        }

        ifcMaterialsLoaded = true;

        // Show/hide based on current material mode
        const showMats = materialMode === 1;
        ifcMaterialSubsets.forEach(({ subset }) => { if (subset) subset.visible = showMats; });

    } catch (err) {
        console.warn('Material extraction failed:', err);
    }
}

async function resolveColor(modelID, styleId) {
    try {
        const style = await ifcLoader.ifcManager.getItemProperties(modelID, styleId, false);
        const typeName = style?.constructor?.name ?? '';

        if (typeName.includes('SurfaceStyle') && !typeName.includes('Rendering') && !typeName.includes('Shading')) {
            for (const isRef of (style.Styles || [])) {
                const inner = await ifcLoader.ifcManager.getItemProperties(modelID, isRef.value, false);
                const innerType = inner?.constructor?.name ?? '';
                if (innerType.includes('SurfaceStyleRendering') || innerType.includes('SurfaceStyleShading')) {
                    return await extractRgb(modelID, inner.SurfaceColour);
                }
            }
        }

        if (typeName.includes('PresentationStyleAssignment') || typeName.includes('PresentationStyle')) {
            for (const asRef of (style.Styles || [])) {
                const color = await resolveColor(modelID, asRef.value);
                if (color) return color;
            }
        }

        if (typeName.includes('Rendering') || typeName.includes('Shading')) {
            return await extractRgb(modelID, style.SurfaceColour);
        }
    } catch (_) { /* skip */ }
    return null;
}

async function resolveMaterialColor(modelID, matId, colorMap, visited = new Set()) {
    if (visited.has(matId)) return null; // circular reference protection
    visited.add(matId);

    if (colorMap.has(matId)) return colorMap.get(matId);

    const obj = await ifcLoader.ifcManager.getItemProperties(modelID, matId, false);

    // IfcMaterialLayerSetUsage → ForLayerSet → IfcMaterialLayerSet
    if (obj?.ForLayerSet?.value) {
        return resolveMaterialColor(modelID, obj.ForLayerSet.value, colorMap, visited);
    }

    // IfcMaterialLayerSet → MaterialLayers[] → Material
    if (obj?.MaterialLayers) {
        for (const ref of obj.MaterialLayers) {
            const layer = await ifcLoader.ifcManager.getItemProperties(modelID, ref.value, false);
            if (layer?.Material?.value && colorMap.has(layer.Material.value)) {
                return colorMap.get(layer.Material.value);
            }
        }
    }

    // IfcMaterialProfileSet / IfcMaterialProfileSetUsage → MaterialProfiles[] → Material
    if (obj?.ForProfileSet?.value) {
        return resolveMaterialColor(modelID, obj.ForProfileSet.value, colorMap, visited);
    }
    if (obj?.MaterialProfiles) {
        for (const ref of obj.MaterialProfiles) {
            const profile = await ifcLoader.ifcManager.getItemProperties(modelID, ref.value, false);
            if (profile?.Material?.value && colorMap.has(profile.Material.value)) {
                return colorMap.get(profile.Material.value);
            }
        }
    }

    // IfcMaterialConstituentSet → MaterialConstituents[] → Material
    if (obj?.MaterialConstituents) {
        for (const ref of obj.MaterialConstituents) {
            const constituent = await ifcLoader.ifcManager.getItemProperties(modelID, ref.value, false);
            if (constituent?.Material?.value && colorMap.has(constituent.Material.value)) {
                return colorMap.get(constituent.Material.value);
            }
        }
    }

    // IfcMaterialList → Materials[]
    if (obj?.Materials) {
        for (const ref of obj.Materials) {
            if (colorMap.has(ref.value)) return colorMap.get(ref.value);
        }
    }

    return null;
}

async function extractRgb(modelID, colourRef) {
    if (!colourRef) return null;

    // If it's a Handle/reference, resolve it first
    if (colourRef.value !== undefined && colourRef.Red === undefined) {
        try {
            colourRef = await ifcLoader.ifcManager.getItemProperties(modelID, colourRef.value, false);
        } catch (_) { return null; }
    }

    const r = colourRef.Red?.value ?? colourRef.Red ?? null;
    const g = colourRef.Green?.value ?? colourRef.Green ?? null;
    const b = colourRef.Blue?.value ?? colourRef.Blue ?? null;
    if (r === null || g === null || b === null) return null;
    return { r, g, b };
}



function clearIfcMaterialSubsets() {
    if (!ifcModel) return;
    for (const { material } of ifcMaterialSubsets) {
        ifcLoader.ifcManager.removeSubset(ifcModel.modelID, material);
        material.dispose();
    }
    ifcMaterialSubsets.length = 0;
    ifcMaterialsLoaded = false;
}

// View mode dropdown
const vtMaterialMenu = document.getElementById('vt-material-menu');

vtMaterial.addEventListener('click', (e) => {
    e.stopPropagation();
    vtMaterialMenu.classList.toggle('show');
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('#vt-material-menu') && !e.target.closest('#vt-material')) {
        vtMaterialMenu.classList.remove('show');
    }
});

vtMaterialMenu.querySelectorAll('.vt-dropdown-item').forEach((btn) => {
    btn.addEventListener('click', () => {
        materialMode = parseInt(btn.dataset.mode, 10);

        // Update active state in menu
        vtMaterialMenu.querySelectorAll('.vt-dropdown-item').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        // Show/hide IFC material subsets
        if (materialMode === 1 && ifcMaterialsLoaded) {
            ifcMaterialSubsets.forEach(({ subset }) => { if (subset) subset.visible = true; });
        } else {
            ifcMaterialSubsets.forEach(({ subset }) => { if (subset) subset.visible = false; });
        }

        applyMaterialMode();
        vtMaterialMenu.classList.remove('show');
    });
});

vtGrid.addEventListener('click', () => {
    const active = vtGrid.classList.toggle('active');
    grid.visible = active;
    axes.visible = active;
});

vtPan.addEventListener('click', () => {
    if (fpsMode) exitFpsMode();
    const active = vtPan.classList.toggle('active');
    if (active) {
        controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    } else {
        controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    }
});

// First-person navigation mode
const vtFps = document.getElementById('vt-fps');
let fpsMode = false;
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const FPS_LOOK_SPEED = 0.002;

function enterFpsMode() {
    fpsMode = true;
    vtFps.classList.add('active');
    vtPan.classList.remove('active');
    controls.enabled = false;
    container.requestPointerLock();
}

function exitFpsMode() {
    fpsMode = false;
    vtFps.classList.remove('active');
    controls.enabled = true;
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    if (document.pointerLockElement) document.exitPointerLock();
    // Re-sync orbit target to where we're looking
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    controls.target.copy(camera.position).addScaledVector(dir, 10);
}

vtFps.addEventListener('click', () => {
    if (fpsMode) { exitFpsMode(); } else { enterFpsMode(); }
});

// Exit FPS on Escape or pointer lock loss
document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && fpsMode) {
        exitFpsMode();
    }
});

// Mouse look in FPS mode
document.addEventListener('mousemove', (e) => {
    if (!fpsMode || !document.pointerLockElement) return;

    euler.setFromQuaternion(camera.quaternion);
    euler.y -= e.movementX * FPS_LOOK_SPEED;
    euler.x -= e.movementY * FPS_LOOK_SPEED;
    euler.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, euler.x));
    camera.quaternion.setFromEuler(euler);
});

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

    // Re-apply color-by subsets with only visible IDs
    if (lastColorConfig) applyColorSubsets(lastColorConfig);

    // Hide IFC material subsets during filtering (they cover all elements, not just filtered)
    ifcMaterialSubsets.forEach(({ subset }) => { if (subset) subset.visible = false; });
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
        // Restore IFC material subsets if in materials mode
        if (materialMode === 1 && ifcMaterialsLoaded) {
            ifcMaterialSubsets.forEach(({ subset }) => { if (subset) subset.visible = true; });
        }
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
    if (fpsMode) exitFpsMode();

    if(ifcModel) {
        lastColorConfig = null;
        currentFilteredIDs = null;
        clearColorSubsets();
        clearFilterSubsets();
        clearIfcMaterialSubsets();
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

        // Reset material mode to solid on new model
        materialMode = 1;
        applyMaterialMode();

        // Auto-center camera
        const box = new THREE.Box3().setFromObject(ifcModel);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);

        controls.target.copy(center);
        camera.position.set(center.x + maxDim, center.y + maxDim / 2, center.z + maxDim);
        camera.lookAt(center);
        controls.update();

        // Scale WASD speed to ~0.5% of model dimension per frame
        moveSpeed = Math.max(0.05, maxDim * 0.005);

        // Extract elements + property sets for table
        showLoading('Extracting element data...');
        setStatus('Extracting element data...', 'loading');
        const { elements, psets, totalCount } = await extractTableData(ifcModel.modelID);

        populateTable(elements, psets);
        syncTableButton();
        window.__ifcViewerData = { elements, psets };
        refreshDashboard();

        // Extract and apply IFC material colors
        showLoading('Applying materials...');
        await extractAndApplyMaterials(ifcModel.modelID);

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
    // Build storey map: elementExpressID → storey name
    const storeyMap = new Map();

    try {
        const rels = await ifcLoader.ifcManager.getAllItemsOfType(modelID, WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE, true);
        for (const rel of rels) {
            const structure = rel.RelatingStructure;
            if (!structure) continue;
            let sp;
            try { sp = await ifcLoader.ifcManager.getItemProperties(modelID, structure.value); }
            catch (_) { continue; }
            const sType = sp?.constructor?.name ?? '';
            if (!sType.includes('Storey') && !sType.includes('BuildingStorey')) continue;
            const sName = sp?.Name?.value ?? '';
            for (const ref of (rel.RelatedElements || [])) {
                storeyMap.set(ref.value, sName);
            }
        }
    } catch (err) { console.warn('Spatial structure extraction failed:', err); }

    try {
        const aggRels = await ifcLoader.ifcManager.getAllItemsOfType(modelID, WebIFC.IFCRELAGGREGATES, true);
        for (const rel of aggRels) {
            const relating = rel.RelatingObject;
            if (!relating) continue;
            let rp;
            try { rp = await ifcLoader.ifcManager.getItemProperties(modelID, relating.value); }
            catch (_) { continue; }
            const rType = rp?.constructor?.name ?? '';
            if (!rType.includes('Storey') && !rType.includes('BuildingStorey')) continue;
            const sName = rp?.Name?.value ?? '';
            for (const ref of (rel.RelatedObjects || [])) {
                if (!storeyMap.has(ref.value)) storeyMap.set(ref.value, sName);
            }
        }
    } catch (_) { /* skip */ }

    const elements = [];
    const psets = [];

    for (const cat of ELEMENT_CATEGORIES) {
        const items = await ifcLoader.ifcManager.getAllItemsOfType(modelID, cat, true);
        for (const el of items) {
            const typeName = el.constructor.name.replace('Ifc', '');
            const elName = el.Name?.value ?? '';

            // Base quantities for this element
            let area = '', volume = '', length = '';

            try {
                const propSets = await ifcLoader.ifcManager.getPropertySets(modelID, el.expressID, true);
                for (const ps of propSets) {
                    const psetName = ps.Name?.value ?? 'Unknown';

                    // Standard property sets (HasProperties)
                    if (ps.HasProperties) {
                        for (const prop of ps.HasProperties) {
                            if (!prop.Name?.value || !prop.NominalValue) continue;
                            let val = prop.NominalValue.value;
                            if (typeof val === 'number') val = parseFloat(val.toFixed(3));
                            psets.push({
                                expressID: el.expressID,
                                ElementName: elName,
                                PSetName: psetName,
                                Property: prop.Name.value,
                                Value: val,
                            });
                        }
                    }

                    // Quantity sets (Quantities) — base quantities
                    if (ps.Quantities) {
                        for (const q of ps.Quantities) {
                            if (!q.Name?.value) continue;
                            const qName = q.Name.value;
                            const qType = q.constructor?.name ?? '';

                            // Extract the value based on quantity type
                            let val = null;
                            if (q.LengthValue !== undefined) val = q.LengthValue?.value ?? q.LengthValue;
                            else if (q.AreaValue !== undefined) val = q.AreaValue?.value ?? q.AreaValue;
                            else if (q.VolumeValue !== undefined) val = q.VolumeValue?.value ?? q.VolumeValue;
                            else if (q.WeightValue !== undefined) val = q.WeightValue?.value ?? q.WeightValue;
                            else if (q.CountValue !== undefined) val = q.CountValue?.value ?? q.CountValue;
                            else if (q.TimeValue !== undefined) val = q.TimeValue?.value ?? q.TimeValue;

                            if (val !== null && typeof val === 'number') val = parseFloat(val.toFixed(3));

                            // Add to psets table
                            psets.push({
                                expressID: el.expressID,
                                ElementName: elName,
                                PSetName: psetName,
                                Property: qName,
                                Value: val ?? '',
                            });

                            // Extract key quantities for element columns
                            if (val !== null) {
                                const ln = qName.toLowerCase();
                                if (!area && (ln.includes('area') || ln === 'grosssidearea' || ln === 'netsidearea' || ln === 'grossarea' || ln === 'netarea')) {
                                    area = val;
                                }
                                if (!volume && (ln.includes('volume') || ln === 'grossvolume' || ln === 'netvolume')) {
                                    volume = val;
                                }
                                if (!length && (ln === 'length' || ln === 'height' || ln === 'perimeter')) {
                                    length = val;
                                }
                            }
                        }
                    }
                }
            } catch (_) { /* skip */ }

            elements.push({
                expressID: el.expressID,
                GlobalId: el.GlobalId?.value ?? '',
                Name: elName,
                Type: typeName,
                Level: storeyMap.get(el.expressID) ?? '',
                Tag: el.Tag?.value ?? '',
                Area: area,
                Volume: volume,
                Length: length,
            });
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
