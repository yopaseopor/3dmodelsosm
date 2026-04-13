/**
 * GeoTIFF UI Controls Module
 * Provides user interface for uploading and managing GeoTIFF terrain data
 */

class GeoTIFFUI {
    constructor() {
        this.isVisible = false;
        this.panel = null;
        this.fileInput = null;
        this.infoPanel = null;
    }

    /**
     * Initialize the GeoTIFF UI
     */
    init() {
        this.createUIPanel();
        this.bindEvents();
        console.log('🏔️ GeoTIFF UI initialized');
    }

    /**
     * Create the UI panel
     */
    createUIPanel() {
        // Create main panel container
        this.panel = document.createElement('div');
        this.panel.id = 'geotiff-panel';
        this.panel.className = 'geotiff-panel';
        this.panel.style.cssText = `
            position: absolute;
            top: 10px;
            right: 10px;
            width: 320px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 15px;
            border-radius: 8px;
            font-family: Arial, sans-serif;
            font-size: 14px;
            z-index: 1000;
            display: none;
            box-shadow: 0 4px 8px rgba(0,0,0,0.3);
        `;

        // Panel content
        this.panel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h3 style="margin: 0; color: #4CAF50;">🏔️ Terrain Control</h3>
                <button id="geotiff-close" style="background: none; border: none; color: white; font-size: 18px; cursor: pointer;">×</button>
            </div>
            
            <div class="geotiff-section">
                <label for="geotiff-file" class="geotiff-label">Select GeoTIFF File:</label>
                <input type="file" id="geotiff-file" accept=".tif,.tiff" class="geotiff-input">
                
                <label for="tfw-file" class="geotiff-label">Select TFW File (optional):</label>
                <input type="file" id="tfw-file" accept=".tfw" class="geotiff-input">
                <small class="geotiff-help">TFW file contains coordinate system information for accurate positioning</small>
            </div>
            
            <div style="margin-bottom: 15px;">
                <button id="geotiff-load" style="width: 100%; padding: 8px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
                    📤 Load Terrain
                </button>
            </div>
            
            <div style="margin-bottom: 15px;">
                <button id="geotiff-reset" style="width: 100%; padding: 8px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
                    🔄 Reset to Default
                </button>
            </div>
            
            <div id="geotiff-info" style="background: rgba(255,255,255,0.1); padding: 10px; border-radius: 4px; margin-top: 15px; display: none;">
                <h4 style="margin: 0 0 10px 0; color: #4CAF50;">Terrain Information:</h4>
                <div id="geotiff-info-content" style="font-size: 12px; line-height: 1.4;"></div>
            </div>
            
            <div id="geotiff-status" style="margin-top: 10px; font-size: 12px; color: #ccc;"></div>
        `;

        // Add to document
        document.body.appendChild(this.panel);

        // Store references
        this.fileInput = document.getElementById('geotiff-file');
        this.infoPanel = document.getElementById('geotiff-info');
        this.infoContent = document.getElementById('geotiff-info-content');
        this.statusPanel = document.getElementById('geotiff-status');
    }

    /**
     * Bind event handlers
     */
    bindEvents() {
        // Close button
        document.getElementById('geotiff-close').addEventListener('click', () => {
            this.hide();
        });

        // Load button
        document.getElementById('geotiff-load').addEventListener('click', () => {
            this.loadGeoTIFF();
        });

        // Reset button
        document.getElementById('geotiff-reset').addEventListener('click', () => {
            this.resetTerrain();
        });

        // File input change
        this.fileInput.addEventListener('change', () => {
            this.updateStatus();
        });

        // Toggle button
        const toggleBtn = document.getElementById('geotiff-toggle-btn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                this.toggle();
            });
        }
    }

    /**
     * Show the panel
     */
    show() {
        this.panel.style.display = 'block';
        this.isVisible = true;
        console.log('🏔️ GeoTIFF panel shown');
    }

    /**
     * Hide the panel
     */
    hide() {
        this.panel.style.display = 'none';
        this.isVisible = false;
        console.log('🏔️ GeoTIFF panel hidden');
    }

    /**
     * Toggle panel visibility
     */
    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }

    /**
     * Load GeoTIFF file
     */
    async loadGeoTIFF() {
        try {
            this.updateStatus('Loading GeoTIFF file...');
            
            // Get file inputs
            const fileInput = document.getElementById('geotiff-file');
            const tfwInput = document.getElementById('tfw-file');
            const file = fileInput.files[0];
            const tfwFile = tfwInput.files[0];
            
            if (!file) {
                this.updateStatus('Please select a GeoTIFF file');
                return;
            }

            // Get Cesium scene
            const cesiumScene = window.ol3d ? window.ol3d.getCesiumScene() : null;
            if (!cesiumScene) {
                throw new Error('Cesium scene not available');
            }

            // Load terrain using terrain manager with optional TFW file
            const success = await window.terrainManager.loadGeoTIFFTerrain(file, cesiumScene, tfwFile);
            
            if (success) {
                const info = window.terrainManager.geoTIFFProvider.getTerrainInfo();
                
                // Check if sample bounds were used
                const isSampleBounds = info.bounds.west === 2.0 && info.bounds.east === 2.3;
                
                if (isSampleBounds) {
                    this.updateStatus('Loaded with sample coordinates (Barcelona area). Original GeoTIFF lacks proper coordinate system.');
                } else if (tfwFile) {
                    this.updateStatus('GeoTIFF terrain loaded successfully with TFW coordinates!');
                } else {
                    this.updateStatus('GeoTIFF terrain loaded successfully!');
                }
                
                this.displayTerrainInfo();
                
                // Update model heights to match new terrain
                if (window.modelRenderer) {
                    setTimeout(() => {
                        window.modelRenderer.addAllModels();
                    }, 2000);
                }
            } else {
                this.updateStatus('Failed to load GeoTIFF terrain');
            }
        } catch (error) {
            console.error('🏔️ Error loading GeoTIFF:', error);
            this.updateStatus(`❌ Error: ${error.message}`);
        }
    }

    /**
     * Reset terrain to default
     */
    resetTerrain() {
        try {
            const cesiumScene = window.ol3d ? window.ol3d.getCesiumScene() : null;
            if (!cesiumScene) {
                throw new Error('Cesium scene not available');
            }

            window.terrainManager.resetToDefaultTerrain(cesiumScene);
            this.updateStatus('✅ Terrain reset to default');
            this.hideTerrainInfo();
            
            // Reload models with default terrain
            if (window.modelRenderer) {
                setTimeout(() => {
                    window.modelRenderer.addAllModels();
                }, 1000);
            }
        } catch (error) {
            console.error('🏔️ Error resetting terrain:', error);
            this.updateStatus(`❌ Error: ${error.message}`);
        }
    }

    /**
     * Display terrain information
     */
    displayTerrainInfo() {
        const info = window.terrainManager.geoTIFFProvider.getTerrainInfo();
        if (!info) {
            return;
        }

        const bounds = info.bounds;
        const dimensions = info.dimensions;
        const elevationRange = info.elevationRange;

        const infoHTML = `
            <div><strong>Bounds:</strong></div>
            <div style="margin-left: 10px;">
                West: ${bounds.west.toFixed(4)}°<br>
                South: ${bounds.south.toFixed(4)}°<br>
                East: ${bounds.east.toFixed(4)}°<br>
                North: ${bounds.north.toFixed(4)}°
            </div>
            <div style="margin-top: 8px;"><strong>Dimensions:</strong> ${dimensions.width} × ${dimensions.height} pixels</div>
            <div style="margin-top: 8px;"><strong>Elevation Range:</strong> ${elevationRange.min.toFixed(1)}m to ${elevationRange.max.toFixed(1)}m</div>
            <div style="margin-top: 8px;"><strong>Status:</strong> <span style="color: #4CAF50;">✅ Ready</span></div>
        `;

        this.infoContent.innerHTML = infoHTML;
        this.infoPanel.style.display = 'block';
    }

    /**
     * Hide terrain information
     */
    hideTerrainInfo() {
        this.infoPanel.style.display = 'none';
    }

    /**
     * Update status message
     * @param {string} message - Status message
     */
    updateStatus(message) {
        if (message) {
            this.statusPanel.textContent = message;
        } else {
            const file = this.fileInput.files[0];
            if (file) {
                const size = (file.size / 1024 / 1024).toFixed(2);
                this.statusPanel.textContent = `📁 Selected: ${file.name} (${size} MB)`;
            } else {
                this.statusPanel.textContent = '📁 No file selected';
            }
        }
    }
}

// Initialize GeoTIFF UI when DOM is ready
window.geotiffUI = new GeoTIFFUI();

// Auto-initialize when document is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.geotiffUI.init();
    });
} else {
    window.geotiffUI.init();
}

// Add keyboard shortcut (Ctrl+T) to toggle GeoTIFF panel
document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key === 't') {
        event.preventDefault();
        window.geotiffUI.toggle();
    }
});

console.log('🏔️ GeoTIFF UI module loaded');
