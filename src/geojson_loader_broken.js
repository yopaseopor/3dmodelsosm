/**
 * GeoJSON Loader Module
 * Handles loading GeoJSON files and displaying them as vector layers on the map
 */

class GeoJSONLoader {
    constructor() {
        this.loadedLayers = new Map(); // Store loaded GeoJSON layers
        this.layerCounter = 0;
        this.defaultStyle = {
            fill: {
                color: 'rgba(255, 255, 0, 0.3)',
                outlineColor: 'rgba(255, 255, 0, 1)',
                outlineWidth: 2
            },
            stroke: {
                color: 'rgba(255, 0, 0, 1)',
                width: 3
            },
            circle: {
                radius: 6,
                fill: {
                    color: 'rgba(0, 0, 255, 0.8)'
                },
                stroke: {
                    color: 'rgba(0, 0, 255, 1)',
                    width: 2
                }
            },
            image: {
                radius: 6,
                fill: {
                    color: 'rgba(0, 0, 255, 0.8)'
                },
                stroke: {
                    color: 'rgba(0, 0, 255, 1)',
                    width: 2
                }
            }
        };
    }

    /**
     * Load GeoJSON file and create vector layer
     * @param {File} file - GeoJSON file
     * @param {Object} options - Loading options
     * @returns {Promise<Object>} Layer information
     */
    async loadGeoJSON(file, options = {}) {
        try {
            console.log('📍 Loading GeoJSON file:', file.name);
            
            // Read file as text
            const geoJSONText = await this.readFileAsText(file);
            
            // Parse GeoJSON
            const geoJSON = JSON.parse(geoJSONText);
            
            // Validate GeoJSON
            if (!this.validateGeoJSON(geoJSON)) {
                throw new Error('Invalid GeoJSON format');
            }
            
            // Create vector layer
            const layer = this.createVectorLayer(geoJSON, options);
            
            // Generate layer ID and name
            const layerId = `geojson_${++this.layerCounter}`;
            const layerName = options.name || file.name.replace(/\.(geo)?json$/i, '');
            
            // Store layer information
            const layerInfo = {
                id: layerId,
                name: layerName,
                layer: layer,
                geoJSON: geoJSON,
                visible: true,
                style: options.style || this.defaultStyle,
                fileName: file.name,
                fileSize: file.size,
                loadTime: new Date().toISOString()
            };
            
            this.loadedLayers.set(layerId, layerInfo);
            
            // Add layer to map
            if (window.map) {
                window.map.addLayer(layer);
                console.log(`GeoJSON layer "${layerName}" added to map`);
            }
            
            // Integrate with overlay system if available
            if (window.geoJSONOverlayIntegration) {
                window.geoJSONOverlayIntegration.addToOverlaySystem(layerInfo);
            }
            
            return layerInfo;
        } catch (error) {
            console.error('📍 Error loading GeoJSON:', error);
            throw error;
        }
    }

    /**
     * Read file as text
     * @param {File} file - File object
     * @returns {Promise<string>} File content as text
     */
    readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    /**
     * Validate GeoJSON structure
     * @param {Object} geoJSON - GeoJSON object
     * @returns {boolean} True if valid
     */
    validateGeoJSON(geoJSON) {
        if (!geoJSON || typeof geoJSON !== 'object') {
            return false;
        }
        
        if (geoJSON.type !== 'FeatureCollection' && 
            geoJSON.type !== 'Feature' && 
            !this.isGeometryType(geoJSON.type)) {
            return false;
        }
        
        return true;
    }

    /**
     * Check if type is a valid GeoJSON geometry type
     * @param {string} type - Geometry type
     * @returns {boolean} True if valid geometry type
     */
    isGeometryType(type) {
        const validTypes = [
            'Point', 'LineString', 'Polygon', 'MultiPoint', 
            'MultiLineString', 'MultiPolygon', 'GeometryCollection'
        ];
        return validTypes.includes(type);
    }

    /**
     * Create OpenLayers vector layer from GeoJSON
     * @param {Object} geoJSON - GeoJSON object
     * @param {Object} options - Layer options
     * @returns {ol.layer.Vector} Vector layer
     */
    createVectorLayer(geoJSON, options = {}) {
        // Create vector source
        const vectorSource = new ol.source.Vector({
            features: new ol.format.GeoJSON().readFeatures(geoJSON, {
                featureProjection: window.map ? window.map.getView().getProjection() : 'EPSG:3857'
            })
        });

        // Create style function
        const styleFunction = this.createStyleFunction(options.style || this.defaultStyle);

        // Create vector layer
        const vectorLayer = new ol.layer.Vector({
            source: vectorSource,
            style: styleFunction,
            zIndex: options.zIndex || 1000,
            visible: options.visible !== false
        });

        return vectorLayer;
    }

    /**
     * Create style function for vector layer
     * @param {Object} styleConfig - Style configuration
     * @returns {Function} Style function
     */
    createStyleFunction(styleConfig) {
        return function(feature) {
            const geometryType = feature.getGeometry().getType();
            
            switch (geometryType) {
                case 'Point':
                case 'MultiPoint':
                    return new ol.style.Style({
                        image: new ol.style.Circle({
                            radius: styleConfig.circle?.radius || 6,
                            fill: new ol.style.Fill({
                                color: styleConfig.circle?.fill?.color || 'rgba(0, 0, 255, 0.8)'
                            }),
                            stroke: new ol.style.Stroke({
                                color: styleConfig.circle?.stroke?.color || 'rgba(0, 0, 255, 1)',
                                width: styleConfig.circle?.stroke?.width || 2
                            })
                        })
                    });
                    
                case 'LineString':
                case 'MultiLineString':
                    return new ol.style.Style({
                        stroke: new ol.style.Stroke({
                            color: styleConfig.stroke?.color || 'rgba(255, 0, 0, 1)',
                            width: styleConfig.stroke?.width || 3
                        })
                    });
                    
                case 'Polygon':
                case 'MultiPolygon':
                    return new ol.style.Style({
                        fill: new ol.style.Fill({
                            color: styleConfig.fill?.color || 'rgba(255, 255, 0, 0.3)'
                        }),
                        stroke: new ol.style.Stroke({
                            color: styleConfig.fill?.outlineColor || 'rgba(255, 255, 0, 1)',
                            width: styleConfig.fill?.outlineWidth || 2
                        })
                    });
                    
                default:
                    return new ol.style.Style({
                        image: new ol.style.Circle({
                            radius: 6,
                            fill: new ol.style.Fill({
                                color: 'rgba(128, 128, 128, 0.8)'
                            }),
                            stroke: new ol.style.Stroke({
                                color: 'rgba(128, 128, 128, 1)',
                                width: 2
                            })
                        })
                    });
            }
        };
    }

    /**
     * Remove a GeoJSON layer
     * @param {string} layerId - Layer ID
     * @returns {boolean} True if removed
     */
    removeLayer(layerId) {
        const layerInfo = this.loadedLayers.get(layerId);
        if (!layerInfo) {
            return false;
        }
    };
}

/**
 * Remove a GeoJSON layer
 * @param {string} layerId - Layer ID
 * @returns {boolean} True if removed
 */
removeLayer(layerId) {
    const layerInfo = this.loadedLayers.get(layerId);
    if (!layerInfo) {
        return false;
    }

    if (window.map) {
        window.map.removeLayer(layerInfo.layer);
    }
        
    // Remove from overlay system if available
    if (window.geoJSONOverlayIntegration) {
        window.geoJSONOverlayIntegration.removeFromOverlaySystem(layerId);
    }
        
    this.loadedLayers.delete(layerId);
    console.log(`GeoJSON layer "${layerInfo.name}" removed`);
    return true;
}

/**
 * Toggle layer visibility
 * @param {string} layerId - Layer ID
 * @returns {boolean} New visibility state
 */
toggleLayerVisibility(layerId) {
    const layerInfo = this.loadedLayers.get(layerId);
    if (!layerInfo) {
        return false;
    }

    layerInfo.visible = !layerInfo.visible;
    layerInfo.layer.setVisible(layerInfo.visible);
        
    return layerInfo.visible;
}

/**
 * Zoom to layer extent
 * @param {string} layerId - Layer ID
 * @returns {boolean} True if zoomed
 */
zoomToLayer(layerId) {
    const layerInfo = this.loadedLayers.get(layerId);
    if (!layerInfo || !window.map) {
        return false;
    }

    const extent = layerInfo.layer.getSource().getExtent();
    if (extent && !ol.extent.isEmpty(extent)) {
        window.map.getView().fit(extent, {
            duration: 1000,
            padding: [20, 20, 20, 20]
        });
        return true;
    }
        
    return false;
}

/**
 * Get information about all loaded layers
 * @returns {Array} Array of layer information
 */
getLoadedLayers() {
    return Array.from(this.loadedLayers.values()).map(layerInfo => ({
        id: layerInfo.id,
        name: layerInfo.name,
        fileName: layerInfo.fileName,
        fileSize: layerInfo.fileSize,
        visible: layerInfo.visible,
        loadTime: layerInfo.loadTime,
        featureCount: layerInfo.layer.getSource().getFeatures().length
    }));
}

/**
 * Get layer information by ID
 * @param {string} layerId - Layer ID
 * @returns {Object|null} Layer information
 */
getLayerInfo(layerId) {
    const layerInfo = this.loadedLayers.get(layerId);
    if (!layerInfo) {
        return null;
    }

    const source = layerInfo.layer.getSource();
    const features = source.getFeatures();
        
    return {
        id: layerInfo.id,
        name: layerInfo.name,
        fileName: layerInfo.fileName,
        fileSize: layerInfo.fileSize,
        visible: layerInfo.visible,
        loadTime: layerInfo.loadTime,
        featureCount: features.length,
        geometryTypes: [...new Set(features.map(f => f.getGeometry().getType()))],
        extent: source.getExtent(),
        bounds: this.extentToBounds(source.getExtent())
    };
}

/**
 * Convert OpenLayers extent to geographic bounds
 * @param {Array} extent - OpenLayers extent [minX, minY, maxX, maxY]
 * @returns {Object} Geographic bounds
 */
extentToBounds(extent) {
    if (!extent || ol.extent.isEmpty(extent)) {
        return null;
    }

    // Transform to WGS84
    const bottomLeft = ol.proj.transform([extent[0], extent[1]], 'EPSG:3857', 'EPSG:4326');
    const topRight = ol.proj.transform([extent[2], extent[3]], 'EPSG:3857', 'EPSG:4326');

    return {
        west: bottomLeft[0],
        south: bottomLeft[1],
        east: topRight[0],
        north: topRight[1]
    };
}

/**
 * Clear all loaded layers
 */
clearAllLayers() {
    if (window.map) {
        this.loadedLayers.forEach(layerInfo => {
            window.map.removeLayer(layerInfo.layer);
        });
    }
     * @returns {boolean} New visibility state
     */
    toggleLayerVisibility(layerId) {
        const layerInfo = this.loadedLayers.get(layerId);
        if (!layerInfo) {
            return false;
        }

        layerInfo.visible = !layerInfo.visible;
        layerInfo.layer.setVisible(layerInfo.visible);
        
        return layerInfo.visible;
    }

    /**
     * Zoom to layer extent
     * @param {string} layerId - Layer ID
     * @returns {boolean} True if zoomed
     */
    zoomToLayer(layerId) {
        const layerInfo = this.loadedLayers.get(layerId);
        if (!layerInfo || !window.map) {
            return false;
        }

        const extent = layerInfo.layer.getSource().getExtent();
        if (extent && !ol.extent.isEmpty(extent)) {
            window.map.getView().fit(extent, {
                duration: 1000,
                padding: [20, 20, 20, 20]
            });
            return true;
        }
        
        return false;
    }

    /**
     * Get information about all loaded layers
     * @returns {Array} Array of layer information
     */
    getLoadedLayers() {
        return Array.from(this.loadedLayers.values()).map(layerInfo => ({
            id: layerInfo.id,
            name: layerInfo.name,
            fileName: layerInfo.fileName,
            fileSize: layerInfo.fileSize,
            visible: layerInfo.visible,
            loadTime: layerInfo.loadTime,
            featureCount: layerInfo.layer.getSource().getFeatures().length
        }));
    }

    /**
     * Get layer information by ID
     * @param {string} layerId - Layer ID
     * @returns {Object|null} Layer information
     */
    getLayerInfo(layerId) {
        const layerInfo = this.loadedLayers.get(layerId);
        if (!layerInfo) {
            return null;
        }

        const source = layerInfo.layer.getSource();
        const features = source.getFeatures();
        
        return {
            id: layerInfo.id,
            name: layerInfo.name,
            fileName: layerInfo.fileName,
            fileSize: layerInfo.fileSize,
            visible: layerInfo.visible,
            loadTime: layerInfo.loadTime,
            featureCount: features.length,
            geometryTypes: [...new Set(features.map(f => f.getGeometry().getType()))],
            extent: source.getExtent(),
            bounds: this.extentToBounds(source.getExtent())
        };
    }

    /**
     * Convert OpenLayers extent to geographic bounds
     * @param {Array} extent - OpenLayers extent [minX, minY, maxX, maxY]
     * @returns {Object} Geographic bounds
     */
    extentToBounds(extent) {
        if (!extent || ol.extent.isEmpty(extent)) {
            return null;
        }

        // Transform to WGS84
        const bottomLeft = ol.proj.transform([extent[0], extent[1]], 'EPSG:3857', 'EPSG:4326');
        const topRight = ol.proj.transform([extent[2], extent[3]], 'EPSG:3857', 'EPSG:4326');

        return {
            west: bottomLeft[0],
            south: bottomLeft[1],
            east: topRight[0],
            north: topRight[1]
        };
    }

    /**
     * Clear all loaded layers
     */
    clearAllLayers() {
        if (window.map) {
            this.loadedLayers.forEach(layerInfo => {
                window.map.removeLayer(layerInfo.layer);
            });
        }
        
        const count = this.loadedLayers.size;
        this.loadedLayers.clear();
        console.log(`📍 Cleared ${count} GeoJSON layers`);
    }

    /**
     * Update layer style
     * @param {string} layerId - Layer ID
     * @param {Object} newStyle - New style configuration
     * @returns {boolean} True if updated
     */
    updateLayerStyle(layerId, newStyle) {
        const layerInfo = this.loadedLayers.get(layerId);
        if (!layerInfo) {
            return false;
        }

        layerInfo.style = { ...layerInfo.style, ...newStyle };
        layerInfo.layer.setStyle(this.createStyleFunction(layerInfo.style));
        
        return true;
    }
}

// Global GeoJSON loader manager
window.geoJSONLoader = new GeoJSONLoader();

console.log('📍 GeoJSON loader module loaded');
