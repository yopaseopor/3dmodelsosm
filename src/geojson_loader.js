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
                color: 'rgba(117,63,79,0.4)',
                outlineColor: 'rgba(117,63,79,1)',
                outlineWidth: 1
            },
            stroke: {
                color: 'rgba(117,63,79,1)',
                width: 1
            },
            circle: {
                radius: 6,
                fill: {
                    color: 'rgba(117,63,79,0.4)'
                },
                stroke: {
                    color: 'rgba(117,63,79,1)',
                    width: 1
                }
            },
            image: {
                src: 'icones/maxspeed_empty.svg',
                scale: 0.03
            },
            text: {
                fill: {
                    color: 'rgba(0,0,0,1)'
                },
                stroke: {
                    color: 'rgba(255,255,255,0.7)',
                    width: 2
                },
                offsetX: 7,
                offsetY: -12,
                textAlign: 'center',
                textBaseline: 'bottom',
                overflow: true
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
                console.log(`📍 GeoJSON layer "${layerName}" added to map`);
                
                // Process features for building extrusion and area repetition if modules are available
                if (window.buildings || window.areaRepetition) {
                    setTimeout(() => {
                        const features = layer.getSource().getFeatures();
                        console.log(`📍 Processing ${features.length} features for building and area repetition`);
                        
                        features.forEach((feature, index) => {
                            const tags = {};
                            feature.getKeys().forEach(key => {
                                if (key !== 'geometry' && key !== 'extrudedBuilding') {
                                    tags[key] = feature.get(key);
                                }
                            });
                            
                            // Process for building extrusion
                            if (window.buildings && window.buildings.isBuildingFeature(tags)) {
                                console.log(`📍 Feature ${index}: Found building feature with tags:`, tags);
                                const buildingOptions = window.buildings.createExtrudedBuilding(feature, tags);
                                if (buildingOptions) {
                                    feature.set('extrudedBuilding', buildingOptions);
                                    console.log(`📍 Created building extrusion for feature ${index}`);
                                }
                            }
                            
                            // Get geometry type following the EXACT same logic as the existing system
                            const geometry = feature.getGeometry();
                            let geometryType = 'point';
                            let wayCoordinates = null;
                            let nodeIndex = null;
                            
                            if (geometry) {
                                const geomType = geometry.getType();
                                
                                if (geomType === 'LineString') {
                                    // Extract way coordinates for bearing calculation (EXACT same as overlays)
                                    const coordinates = geometry.getCoordinates();
                                    wayCoordinates = coordinates.map(coord => 
                                        ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326')
                                    );
                                    nodeIndex = Math.floor(wayCoordinates.length / 2);
                                    
                                    // Check if LineString is closed (EXACT same as overlays)
                                    const isClosed = window.models && window.models.isLineStringClosed ? 
                                                   window.models.isLineStringClosed(geometry) : false;
                                    
                                    // Check for area tags: area=yes, area:* tags, or tags starting with area: (EXACT same as overlays)
                                    const hasAreaTag = tags['area'] === 'yes' ||
                                                       Object.keys(tags).some(key => key.startsWith('area:'));
                                    
                                    // Treat as area if closed or has area tags (EXACT same as overlays)
                                    // BUT NOT for fence features - fences should always be treated as lines, even when closed
                                    const isFence = tags['barrier'] === 'fence' || tags['fence_type'];
                                    geometryType = (isClosed && !isFence) || hasAreaTag ? 'area' : 'line';
                                    
                                    if (isClosed) {
                                        console.log(`Feature ${index}: Closed LineString detected, treating as area`);
                                    }
                                } else if (geomType === 'MultiLineString') {
                                    geometryType = 'line';
                                } else if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
                                    geometryType = 'area';
                                }
                            }

                            if (geometryType === 'area') {
                                console.log(`Feature ${index}: Found area feature with geometry ${geometry?.getType()}, tags:`, tags);
                            }

                            console.log(`Feature ${index}: Processing ${geometryType} feature with tags:`, tags);

                            // Check if the tags match any model mapping (EXACT same approach as existing system)
                            const modelMapping = window.models ? window.models.getModelForTags(tags, wayCoordinates, nodeIndex, geometryType) : null;
                            if (modelMapping) {
                                console.log(`📍 Feature ${index}: SUCCESS: Found model mapping for ${geometryType} feature:`, modelMapping);
                                const modelFilename = modelMapping.model;
                                const modelConfig = modelMapping.config;

                                // Skip if model filename is empty
                                if (!modelFilename || modelFilename.trim() === '') {
                                    console.log(`📍 Feature ${index}: Skipping empty model filename for tags:`, tags);
                                    return; // Skip to next feature
                                }

                                // Set the model property for ol-cesium to use - EXACT same as existing system
                                const modelUrl = `/3dmodelsosm/src/models/${modelFilename}`;
                                const modelOptions = {
                                    uri: modelUrl,
                                    scale: modelConfig ? modelConfig.scale : 1.0,
                                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                                };

                                feature.set('model', modelOptions);

                                // Set additional model configuration for positioning (EXACT same as existing system)
                                if (modelConfig) {
                                    feature.set('modelHeightOffset', modelConfig.heightOffset);
                                    feature.set('modelRotation', modelConfig.rotation);
                                } else {
                                    feature.set('modelHeightOffset', 0);
                                }

                                console.log(`📍 Feature ${index}: SUCCESS: Assigned 3D model ${modelFilename} to GeoJSON feature with URL: ${modelUrl}`);

                                // Apply model repetitions for lines and areas (EXACT same logic as existing system)
                                if (modelMapping.geometryType !== 'point' && window.modelRepetition) {
                                    console.log(`Feature ${index}: Applying model repetitions for ${modelMapping.geometryType} feature`);
                                    
                                    if (modelMapping.geometryType === 'line' && (window.highwayRepetition || window.fenceRepetition)) {
                                        // Handle fence lines first
                                        const barrier = tags.barrier;
                                        const fenceType = tags.fence_type;
                                        const highway = tags.highway;
                                        const waterway = tags.waterway;
                                        
                                        if (barrier === 'fence' || fenceType) {
                                            // Handle fence lines
                                            if (window.fenceRepetition) {
                                                const fenceTypeToUse = fenceType || 'default';
                                                console.log(`Feature ${index}: Applying repetitions to fence ${fenceTypeToUse} feature`);
                                                try {
                                                    window.fenceRepetition.applyFenceRepetitions(feature, modelFilename, modelConfig, fenceTypeToUse);
                                                } catch (error) {
                                                    console.error(`Feature ${index}: Error applying repetitions to fence ${fenceTypeToUse} feature:`, error);
                                                    window.modelRepetition.applyModelRepetitions(feature, modelFilename, modelConfig, modelMapping.geometryType);
                                                }
                                            }
                                        } else if (highway && highway !== 'footway' && highway !== 'path' && highway !== 'pedestrian') {
                                            console.log(`Feature ${index}: Applying repetitions to highway ${highway} feature`);
                                            try {
                                                window.highwayRepetition.applyHighwayRepetitions(feature, modelFilename, modelConfig, highway);
                                            } catch (error) {
                                                console.error(`Feature ${index}: Error applying repetitions to highway ${highway} feature:`, error);
                                                window.modelRepetition.applyModelRepetitions(feature, modelFilename, modelConfig, modelMapping.geometryType);
                                            }
                                        } else if (highway === 'footway' || highway === 'path' || highway === 'pedestrian') {
                                            // Handle footway lines (EXACT same as existing system)
                                            if (window.footwayRepetition) {
                                                console.log(`Feature ${index}: Applying repetitions to footway ${highway} feature`);
                                                try {
                                                    window.footwayRepetition.applyFootwayRepetitions(feature, modelFilename, modelConfig, highway);
                                                } catch (error) {
                                                    console.error(`Feature ${index}: Error applying repetitions to footway ${highway} feature:`, error);
                                                    window.modelRepetition.applyModelRepetitions(feature, modelFilename, modelConfig, modelMapping.geometryType);
                                                }
                                            }
                                        } else if (waterway === 'drain') {
                                            // Handle waterway drain lines
                                            console.log(`Feature ${index}: Applying repetitions to waterway ${waterway} feature`);
                                            try {
                                                window.modelRepetition.applyModelRepetitions(feature, modelFilename, modelConfig, modelMapping.geometryType);
                                            } catch (error) {
                                                console.error(`Feature ${index}: Error applying repetitions to waterway ${waterway} feature:`, error);
                                            }
                                        }
                                    } else if (modelMapping.geometryType === 'area' && window.areaRepetition) {
                                        // Handle area repetitions (EXACT same as existing system)
                                        const tags = feature.getProperties();
                                        console.log(`Feature ${index}: Applying area repetitions to feature with tags:`, tags);
                                        try {
                                            // Extract area type from tags (EXACT same as existing system)
                                            const areaType = tags.highway || tags.amenity || tags.landuse || 'unknown';
                                            window.areaRepetition.applyAreaRepetitions(feature, modelFilename, modelConfig, tags);
                                        } catch (error) {
                                            console.error(`Feature ${index}: Error applying area repetitions:`, error);
                                            window.modelRepetition.applyModelRepetitions(feature, modelFilename, modelConfig, modelMapping.geometryType);
                                        }
                                    } else {
                                        // Fallback to old system (EXACT same as existing system)
                                        window.modelRepetition.applyModelRepetitions(feature, modelFilename, modelConfig, modelMapping.geometryType);
                                    }
                                }
                            } else {
                                console.log(`Feature ${index}: No model mapping found for tags:`, tags);
                            }
                        });
                        
                        // If we're in 3D mode, immediately add to scene
                        if (window.ol3d && window.ol3d.getCesiumScene) {
                            console.log(`📍 3D mode active, triggering model renderer update`);
                            
                            // Trigger model renderer once to process all models (buildings, area textures, repetitions)
                            if (window.modelRenderer) {
                                window.modelRenderer.addAllModels();
                            }
                            
                            // Also trigger buildings processing to catch any building entities
                            if (window.buildings) {
                                window.buildings.addBuildingsToScene(window.ol3d);
                            }
                        }
                    }, 100);
                }
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
            visible: options.visible !== false,
            type: 'overlay' // Mark as overlay type for buildings system
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
            // Extract name using same logic as overlay selector
            const key_regex = /^name$/;
            const name_key = feature.getKeys().filter(function(t){return t.match(key_regex)}).pop() || "name";
            const name = feature.get(name_key) || '';
            
            // Create fill and stroke using overlay selector colors
            const fill = new ol.style.Fill({
                color: styleConfig.fill?.color || 'rgba(117,63,79,0.4)'
            });
            const stroke = new ol.style.Stroke({
                color: styleConfig.stroke?.color || 'rgba(117,63,79,1)',
                width: styleConfig.stroke?.width || 1
            });
            
            // Get geometry type for text placement
            const geom = feature.getGeometry();
            const geometryType = geom.getType();
            const isPolygon = geometryType === 'Polygon' || geometryType === 'MultiPolygon';
            
            // Create text style with overlay selector behavior
            const textStyle = new ol.style.Text({
                text: name,
                fill: new ol.style.Fill({
                    color: styleConfig.text?.fill?.color || 'rgba(0,0,0,1)'
                }),
                stroke: new ol.style.Stroke({
                    color: styleConfig.text?.stroke?.color || 'rgba(255,255,255,0.7)',
                    width: styleConfig.text?.stroke?.width || 2
                }),
                offsetX: styleConfig.text?.offsetX || 7,
                offsetY: isPolygon ? (styleConfig.text?.offsetY - 15 || -15) : (styleConfig.text?.offsetY || 0),
                placement: isPolygon ? 'point' : 'point',
                textAlign: styleConfig.text?.textAlign || 'center',
                textBaseline: styleConfig.text?.textBaseline || 'bottom',
                overflow: styleConfig.text?.overflow !== undefined ? styleConfig.text.overflow : true
            });
            
            // Create image/icon style
            let imageStyle;
            if (styleConfig.image?.src) {
                imageStyle = new ol.style.Icon({
                    src: window.imgSrc ? window.imgSrc + styleConfig.image.src : styleConfig.image.src,
                    scale: styleConfig.image.scale || 0.03
                });
            } else {
                // Fallback to circle for points
                imageStyle = new ol.style.Circle({
                    radius: styleConfig.circle?.radius || 6,
                    fill: new ol.style.Fill({
                        color: styleConfig.circle?.fill?.color || 'rgba(117,63,79,0.4)'
                    }),
                    stroke: new ol.style.Stroke({
                        color: styleConfig.circle?.stroke?.color || 'rgba(117,63,79,1)',
                        width: styleConfig.circle?.stroke?.width || 1
                    })
                });
            }
            
            // Create and return the style
            return new ol.style.Style({
                image: imageStyle,
                text: textStyle,
                fill: fill,
                stroke: stroke
            });
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
        
        // Clean up 3D models associated with this layer
        if (window.modelRenderer && layerInfo.layer) {
            const features = layerInfo.layer.getSource().getFeatures();
            features.forEach((feature, fidx) => {
                // Create the same feature ID pattern used in model_renderer.js
                let featureId = feature.getId();
                if (!featureId) {
                    const layerName = layerInfo.name || 'unknown';
                    const geometry = feature.getGeometry();
                    const geometryHash = geometry ? geometry.getExtent().join('_') : 'no_geom';
                    featureId = `feature_${layerName}_${fidx}_${geometryHash}`;
                }
                
                // Remove from loaded models tracking
                if (window.modelRenderer.loadedModels.has(featureId)) {
                    const loadedModel = window.modelRenderer.loadedModels.get(featureId);
                    if (loadedModel.model && loadedModel.model.destroy) {
                        loadedModel.model.destroy();
                    }
                    window.modelRenderer.loadedModels.delete(featureId);
                    console.log(`📍 Cleaned up model for feature ${featureId}`);
                }
            });
        }
        
        this.loadedLayers.delete(layerId);
        console.log(`📍 GeoJSON layer "${layerInfo.name}" removed`);
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
        
        // Clean up all 3D models from GeoJSON layers
        if (window.modelRenderer) {
            this.loadedLayers.forEach((layerInfo, layerId) => {
                if (layerInfo.layer) {
                    const features = layerInfo.layer.getSource().getFeatures();
                    features.forEach((feature, fidx) => {
                        // Create the same feature ID pattern used in model_renderer.js
                        let featureId = feature.getId();
                        if (!featureId) {
                            const layerName = layerInfo.name || 'unknown';
                            const geometry = feature.getGeometry();
                            const geometryHash = geometry ? geometry.getExtent().join('_') : 'no_geom';
                            featureId = `feature_${layerName}_${fidx}_${geometryHash}`;
                        }
                        
                        // Remove from loaded models tracking
                        if (window.modelRenderer.loadedModels.has(featureId)) {
                            const loadedModel = window.modelRenderer.loadedModels.get(featureId);
                            if (loadedModel.model && loadedModel.model.destroy) {
                                loadedModel.model.destroy();
                            }
                            window.modelRenderer.loadedModels.delete(featureId);
                        }
                    });
                }
            });
        }
        
        const count = this.loadedLayers.size;
        this.loadedLayers.clear();
        console.log(`📍 Cleared ${count} GeoJSON layers with model cleanup`);
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
