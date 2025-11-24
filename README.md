# IFC Viewer & Excel Exporter

A lightweight, browser-based BIM viewer that loads .ifc files locally and exports building data to Excel. Built with `web-ifc-viewer` and `SheetJS`, it runs entirely in the browser using ES Modules—no build tools or backend required.

![image](https://github.com/davras5/ifc-viewer/blob/main/Preview.JPG)

## Features

-   **Modern Glass UI**: A clean, floating interface built with Tailwind CSS and Glassmorphism effects.
-   **Fast IFC Loading**: Uses [web-ifc](https://github.com/thatopen/engine_web-ifc) (WASM) to parse Industry Foundation Classes (IFC) files natively in the browser.
-   **Enhanced Visualization**: Includes real-time shadow rendering (`ShadowDropper`), grid, and axes helpers.
-   **Property Inspection**: Double-click any element to view its full set of IFC properties (Name, GlobalID, Dimensions, etc.) in a floating side panel.
-   **Excel Export**: Automatically scans the model for specific categories (Walls, Slabs, Doors, etc.) and extracts them into a formatted `.xlsx` report using SheetJS.
-   **Zero-Install**: Single HTML file architecture using an Import Map. No Node.js build steps or bundlers required.

## Technology Stack

-   **Viewer Engine**: [web-ifc-viewer](https://github.com/IFCjs/web-ifc-viewer) (v1.0.217)
-   **3D Core**: [Three.js](https://threejs.org/) (v0.160.0)
-   **IFC Parsing**: [web-ifc](https://github.com/thatopen/engine_web-ifc) (v0.0.50 - WASM)
-   **Excel Generation**: [SheetJS](https://sheetjs.com/)
-   **Styling**: Tailwind CSS + FontAwesome (via CDN)

## How to Run

Because this project uses ES Modules and loads WebAssembly (`.wasm`) files, browser security policies (CORS) prevent it from running directly from the file system (`file://`). You must use a local static server.

### Option 1: VS Code (Recommended)
1.  Install the **"Live Server"** extension for VS Code.
2.  Open the project folder.
3.  Right-click `index.html` and select **"Open with Live Server"**.

### Option 2: Python
If you have Python installed, open your terminal in the project folder and run:

```bash
# Python 3
python -m http.server 8000
