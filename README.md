IFC Viewer & Excel Exporter
===========================

A lightweight, browser-based BIM viewer that loads .ifc files locally and exports building data to Excel. Built with web-ifc-viewer and SheetJS, it runs entirely in the browser with no backend required.

Features
--------

*   **Fast IFC Loading**: Uses web-ifc (WASM) to parse Industry Foundation Classes (IFC) files natively in the browser.
    
*   **3D Navigation**: Orbit, pan, and zoom controls with a grid and axes helper.
    
*   **Property Inspection**: Double-click any element to view its full set of IFC properties (Name, Type, Dimensions, etc.).
    
*   **Excel Export**: Automatically categorizes and extracts data (Walls, Slabs, Doors, Windows, etc.) into a clean .xlsx report.
    
*   **Zero-Install**: Single HTML file architecture. No Node.js build steps or bundlers required.
    

Technology Stack
----------------

*   **Viewer Engine**: [web-ifc-viewer](https://github.com/IFCjs/web-ifc-viewer) (based on Three.js)
    
*   **IFC Parsing**: [web-ifc](https://www.google.com/search?q=https://github.com/thatopen/engine_web-ifc) (WASM)
    
*   **Excel Generation**: [SheetJS (xlsx)](https://sheetjs.com/)
    
*   **Styling**: Tailwind CSS (via CDN)
    

How to Run
----------

Because this project uses ES Modules and WebAssembly, it is best run using a local static server to avoid browser security restrictions (CORS) with local files.

### Option 1: VS Code (Recommended)

1.  Install the "Live Server" extension for VS Code.
    
2.  Open the project folder.
    
3.  Right-click index.html and select "Open with Live Server".
    

### Option 2: Python

If you have Python installed, run this command in the project folder:

Plain textANTLR4BashCC#CSSCoffeeScriptCMakeDartDjangoDockerEJSErlangGitGoGraphQLGroovyHTMLJavaJavaScriptJSONJSXKotlinLaTeXLessLuaMakefileMarkdownMATLABMarkupObjective-CPerlPHPPowerShell.propertiesProtocol BuffersPythonRRubySass (Sass)Sass (Scss)SchemeSQLShellSwiftSVGTSXTypeScriptWebAssemblyYAMLXML`   # Python 3  python -m http.server 8000   `

Then open http://localhost:8000 in your browser.

### Option 3: Node.js

Plain textANTLR4BashCC#CSSCoffeeScriptCMakeDartDjangoDockerEJSErlangGitGoGraphQLGroovyHTMLJavaJavaScriptJSONJSXKotlinLaTeXLessLuaMakefileMarkdownMATLABMarkupObjective-CPerlPHPPowerShell.propertiesProtocol BuffersPythonRRubySass (Sass)Sass (Scss)SchemeSQLShellSwiftSVGTSXTypeScriptWebAssemblyYAMLXML`   npx serve .   `

Usage
-----

1.  Click **Open IFC File** and select a .ifc model from your computer.
    
2.  **Navigate**:
    
    *   **Left Click + Drag**: Rotate
        
    *   **Right Click + Drag**: Pan
        
    *   **Scroll**: Zoom
        
3.  **Inspect**: Double-click on any 3D element to see its properties in the side panel.
    
4.  **Export**: Click **Export Excel** to generate a report of all physical building elements (Walls, Slabs, Beams, etc.).
    

Customization
-------------

The logic is contained entirely within index.html.

*   **To change the background color**: Modify the IfcViewerAPI constructor config.
    
*   **To change exported categories**: Edit the categories array in the exportBtn event listener. Currently, it scans for:
    
    *   Walls, Slabs, Roofs
        
    *   Windows, Doors
        
    *   Columns, Beams, Members
        
    *   Stairs, Railings, Plates, Furnishing Elements
        

License
-------

This project is open source and available under the MIT License.

**Note**: This viewer relies on unpkg.com and esm.sh to load dependencies dynamically. An internet connection is required for the first load.
