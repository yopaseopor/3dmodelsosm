/**
 * GeoJSON UI Controls Module
 * Provides user interface for uploading and managing GeoJSON data layers
 */

class GeoJSONUI {
    constructor() {
        this.isVisible = false;
        this.panel = null;
        this.fileInput = null;
        this.layersList = null;
        this.statusPanel = null;
    }

    /**
     * Initialize the GeoJSON UI
     */
    init() {
        this.createUIPanel();
        this.bindEvents();
        console.log('📍 GeoJSON UI initialized');
    }

    /**
     * Create the UI panel
     */
    createUIPanel() {
        // Create main panel container
        this.panel = document.createElement('div');
        this.panel.id = 'geojson-panel';
        this.panel.className = 'geojson-panel';
        this.panel.style.cssText = `
            position: absolute;
            top: 10px;
            right: 10px;
            width: 350px;
            max-height: 80vh;
            background: rgba(0, 0, 0, 0.85);
            color: white;
            padding: 15px;
            border-radius: 8px;
            font-family: Arial, sans-serif;
            font-size: 14px;
            z-index: 1000;
            display: none;
            box-shadow: 0 4px 8px rgba(0,0,0,0.3);
            overflow-y: auto;
        `;

        // Panel content
        this.panel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h3 style="margin: 0; color: #2196F3;">📍 GeoJSON Loader</h3>
                <button id="geojson-close" style="background: none; border: none; color: white; font-size: 18px; cursor: pointer;">×</button>
            </div>
            
            <div class="geojson-section">
                <label for="geojson-file" class="geojson-label">Select GeoJSON File:</label>
                <input type="file" id="geojson-file" accept=".json,.geojson" class="geojson-input">
                <small class="geojson-help">Supports .json and .geojson files with Point, LineString, Polygon, and Multi* geometries</small>
            </div>
            
            <div style="margin-bottom: 15px;">
                <label for="geojson-layer-name" class="geojson-label">Layer Name (optional):</label>
                <input type="text" id="geojson-layer-name" placeholder="Auto-generated from filename" class="geojson-input" style="width: 100%;">
            </div>
            
            <div style="margin-bottom: 15px;">
                <button id="geojson-load" style="width: 100%; padding: 8px; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
                    📤 Load GeoJSON
                </button>
            </div>
            
            <div style="margin-bottom: 15px;">
                <button id="geojson-clear-all" style="width: 100%; padding: 8px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
                    🗑️ Clear All Layers
                </button>
            </div>
            
            <div id="geojson-layers-section" style="margin-top: 20px;">
                <h4 style="margin: 0 0 10px 0; color: #2196F3;">Loaded Layers:</h4>
                <div id="geojson-layers-list" style="max-height: 300px; overflow-y: auto;">
                    <div style="color: #ccc; font-style: italic;">No layers loaded</div>
                </div>
            </div>
            
            <div id="geojson-status" style="margin-top: 10px; font-size: 12px; color: #ccc;"></div>
        `;

        // Add to document
        document.body.appendChild(this.panel);

        // Store references
        this.fileInput = document.getElementById('geojson-file');
        this.layersList = document.getElementById('geojson-layers-list');
        this.statusPanel = document.getElementById('geojson-status');
    }

    /**
     * Bind event handlers
     */
    bindEvents() {
        // Close button
        document.getElementById('geojson-close').addEventListener('click', () => {
            this.hide();
        });

        // Load button
        document.getElementById('geojson-load').addEventListener('click', () => {
            this.loadGeoJSON();
        });

        // Clear all button
        document.getElementById('geojson-clear-all').addEventListener('click', () => {
            this.clearAllLayers();
        });

        // File input change
        this.fileInput.addEventListener('change', () => {
            this.updateStatus();
        });

        // Toggle button
        const toggleBtn = document.getElementById('geojson-toggle-btn');
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
        this.refreshLayersList();
        console.log('📍 GeoJSON panel shown');
    }

    /**
     * Hide the panel
     */
    hide() {
        this.panel.style.display = 'none';
        this.isVisible = false;
        console.log('📍 GeoJSON panel hidden');
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
     * Load GeoJSON file
     */
    async loadGeoJSON() {
        try {
            this.updateStatus('Loading GeoJSON file...');
            
            // Get file input
            const fileInput = document.getElementById('geojson-file');
            const nameInput = document.getElementById('geojson-layer-name');
            const file = fileInput.files[0];
            
            if (!file) {
                this.updateStatus('Please select a GeoJSON file');
                return;
            }

            // Prepare options
            const options = {
                name: nameInput.value.trim() || undefined
            };

            // Load GeoJSON using loader
            const layerInfo = await window.geoJSONLoader.loadGeoJSON(file, options);
            
            this.updateStatus(`✅ Successfully loaded "${layerInfo.name}" with ${layerInfo.layer.getSource().getFeatures().length} features`);
            
            // Clear form
            fileInput.value = '';
            nameInput.value = '';
            
            // Refresh layers list
            this.refreshLayersList();
            
            // Zoom to the loaded layer
            setTimeout(() => {
                window.geoJSONLoader.zoomToLayer(layerInfo.id);
            }, 500);
            
        } catch (error) {
            console.error('📍 Error loading GeoJSON:', error);
            this.updateStatus(`❌ Error: ${error.message}`);
        }
    }

    /**
     * Clear all layers
     */
    clearAllLayers() {
        try {
            const count = window.geoJSONLoader.getLoadedLayers().length;
            window.geoJSONLoader.clearAllLayers();
            this.updateStatus(`✅ Cleared ${count} GeoJSON layers`);
            this.refreshLayersList();
        } catch (error) {
            console.error('📍 Error clearing layers:', error);
            this.updateStatus(`❌ Error: ${error.message}`);
        }
    }

    /**
     * Refresh the layers list
     */
    refreshLayersList() {
        const layers = window.geoJSONLoader.getLoadedLayers();
        
        if (layers.length === 0) {
            this.layersList.innerHTML = '<div style="color: #ccc; font-style: italic;">No layers loaded</div>';
            return;
        }

        let html = '';
        layers.forEach(layer => {
            const fileSize = (layer.fileSize / 1024).toFixed(1);
            const visibilityIcon = layer.visible ? '👁️' : '🚫';
            
            html += `
                <div class="geojson-layer-item" style="background: rgba(255,255,255,0.1); padding: 10px; margin-bottom: 8px; border-radius: 4px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <strong style="color: #2196F3;">${layer.name}</strong>
                        <span>${visibilityIcon}</span>
                    </div>
                    <div style="font-size: 12px; color: #ccc; margin-bottom: 8px;">
                        📁 ${layer.fileName} (${fileSize} KB) | 🗺️ ${layer.featureCount} features
                    </div>
                    <div style="display: flex; gap: 5px;">
                        <button onclick="window.geoJSONUI.toggleLayer('${layer.id}')" style="flex: 1; padding: 4px; background: #FF9800; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 11px;">
                            Toggle
                        </button>
                        <button onclick="window.geoJSONUI.zoomToLayer('${layer.id}')" style="flex: 1; padding: 4px; background: #4CAF50; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 11px;">
                            Zoom
                        </button>
                        <button onclick="window.geoJSONUI.removeLayer('${layer.id}')" style="flex: 1; padding: 4px; background: #f44336; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 11px;">
                            Remove
                        </button>
                    </div>
                </div>
            `;
        });

        this.layersList.innerHTML = html;
    }

    /**
     * Toggle layer visibility
     * @param {string} layerId - Layer ID
     */
    toggleLayer(layerId) {
        try {
            const visible = window.geoJSONLoader.toggleLayerVisibility(layerId);
            this.refreshLayersList();
            this.updateStatus(`Layer ${visible ? 'shown' : 'hidden'}`);
        } catch (error) {
            console.error('📍 Error toggling layer:', error);
            this.updateStatus(`❌ Error: ${error.message}`);
        }
    }

    /**
     * Zoom to layer
     * @param {string} layerId - Layer ID
     */
    zoomToLayer(layerId) {
        try {
            const success = window.geoJSONLoader.zoomToLayer(layerId);
            if (success) {
                this.updateStatus('Zoomed to layer extent');
            } else {
                this.updateStatus('Could not zoom to layer (empty extent)');
            }
        } catch (error) {
            console.error('📍 Error zooming to layer:', error);
            this.updateStatus(`❌ Error: ${error.message}`);
        }
    }

    /**
     * Remove layer
     * @param {string} layerId - Layer ID
     */
    removeLayer(layerId) {
        try {
            const success = window.geoJSONLoader.removeLayer(layerId);
            if (success) {
                this.refreshLayersList();
                this.updateStatus('Layer removed');
            } else {
                this.updateStatus('Layer not found');
            }
        } catch (error) {
            console.error('📍 Error removing layer:', error);
            this.updateStatus(`❌ Error: ${error.message}`);
        }
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
                const size = (file.size / 1024).toFixed(1);
                this.statusPanel.textContent = `📁 Selected: ${file.name} (${size} KB)`;
            } else {
                const layers = window.geoJSONLoader.getLoadedLayers();
                this.statusPanel.textContent = layers.length > 0 ? `📍 ${layers.length} layer(s) loaded` : '📁 No file selected';
            }
        }
    }
}

// Initialize GeoJSON UI when DOM is ready
window.geoJSONUI = new GeoJSONUI();

// Auto-initialize when document is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.geoJSONUI.init();
    });
} else {
    window.geoJSONUI.init();
}

// Add keyboard shortcut (Ctrl+G) to toggle GeoJSON panel
document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key === 'g') {
        event.preventDefault();
        window.geoJSONUI.toggle();
    }
});

console.log('📍 GeoJSON UI module loaded');
