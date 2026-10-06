/**
 * GeoJSON Loader Module
 * Handles loading GeoJSON files and displaying them as vector layers on the map
 */

/**
 * Is this module's verbose logging on?
 *
 * Resolved per call, never at load time: debug_config.js is parsed after this
 * file, so a value captured here would always be the "off" default and
 * ?debug=geojsonLoader would silently do nothing.
 *
 * This function did not exist, but line 215 of the per-feature loop called it.
 * That threw `ReferenceError: loaderDebugConfig is not a function` on the FIRST
 * feature that reached it, and the loop body has no try/catch, so every feature
 * after that point was skipped without a word. In berlin.geojson that swallowed
 * the remaining ~2,100 features, railways included, which is why
 * railway=rail was present in the file and nothing appeared.
 */
function loaderDebugConfig() {
    var cfg = (typeof window !== 'undefined') && window.globalDebugConfig;
    var section = cfg && cfg.geojsonLoader;
    return !!(section && section.enabled);
}

/** Log one line about a feature, but only when the module's logging is on. */
function loaderLog() {
    if (!loaderDebugConfig()) return;
    console.log.apply(console, arguments);
}

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

            // Open the progress panel for the WHOLE load, from the first byte to
            // the last model placed.
            //
            // Nothing called begin() anywhere, so the panel was dead code: it
            // builds a title, a percentage, an elapsed timer, an ETA and a
            // live byte count from the Resource Timing API, and then nobody ever
            // showed it. That is why a big file appeared to hang with no counter
            // and no percentages.
            //
            // total() is set to the FEATURE count rather than left at zero, so
            // the percentage is a percentage of something real from the first
            // frame instead of jumping from 0 to 100.
            var progress = window.loadingProgress;
            var fileSize = (file && file.size) || 0;
            if (progress && progress.begin) {
                progress.begin({
                    title: 'Loading ' + (file.name || 'GeoJSON'),
                    // A safety valve only: a stalled load must not leave the panel
                    // up forever. Sized well above a real load of a big file,
                    // because a load that legitimately needs two minutes must
                    // not have its counter yanked away at sixty seconds.
                    hardStopMs: 180000
                });
            }

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

            // The file is parsed, so the feature count is known: give it to the
            // panel so the percentage has a real denominator from here on.
            var featureCount = (geoJSON && geoJSON.features) ? geoJSON.features.length : 0;
            if (progress && progress.total) progress.total(featureCount);
            
            // Generate layer ID and name
            const layerId = `geojson_${++this.layerCounter}`;
            const layerName = options.name || file.name.replace(/\.(geo)?json$/i, '');
            
            // Store layer information.
            //
            // `geoJSON: geoJSON` used to be kept here and NOTHING ever read it
            // back (grep across src/ for `.geoJSON` finds no reader). It was not
            // a small leak either: the raw 7.26MB string plus its parsed object
            // graph measures ~11.5MB of retained heap, held for as long as the
            // layer existed, on top of the OpenLayers features that were
            // already built from it — so the file was effectively resident
            // twice. For a >1MB GeoJSON that is the single largest piece of
            // memory this module held and it bought nothing. Only the count is
            // kept now; the features live in the vector source.
            const layerInfo = {
                id: layerId,
                name: layerName,
                layer: layer,
                featureCount: featureCount,
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
                        
                        // Run the per-feature work in time-budgeted slices
                        // instead of one blocking loop.
                        //
                        // A single synchronous forEach over thousands of features
                        // is what made a big file look like a hang: the browser
                        // could not paint, scroll or answer a click until the
                        // whole file was finished, so the progress panel could
                        // not even draw itself. progressive.forEach does exactly
                        // the same work and hands the main thread back every few
                        // milliseconds, so the page stays alive and the counter
                        // keeps moving.
                        //
                        // The fallback matters as much: if progressive.js is ever
                        // missing from index.html the file must still load, just
                        // without the smoothing.
                        var runFeatureSweep = (window.progressive && window.progressive.forEach)
                            ? function (items, worker, opts) { return window.progressive.forEach(items, worker, opts); }
                            : function (items, worker, opts) {
                                for (var i = 0; i < items.length; i++) {
                                    try { worker(items[i], i); }
                                    catch (error) { if (opts && opts.onError) opts.onError(items[i], error, i); }
                                }
                                if (opts && opts.onDone) opts.onDone();
                                return { cancel: function () {} };
                            };

                        var reportedFeatures = 0;
                        runFeatureSweep(features, function (feature, index) {
                          // One bad feature must not cost the file the rest of them.
                          //
                          // This body used to have no try/catch, so a single throw
                          // aborted the ENTIRE forEach: every later feature was
                          // skipped silently, no error surfaced past the first one,
                          // and the file came back looking like it had no models in
                          // it. That is exactly how a railway present in the data
                          // ends up invisible.
                          try {
                            const tags = {};
                            feature.getKeys().forEach(key => {
                                if (key !== 'geometry' && key !== 'extrudedBuilding' && key !== (window.OSM3D_KEY_PROPERTY || 'osm3dKey')) {
                                    tags[key] = feature.get(key);
                                }
                            });
                            
                            // Process for building extrusion
                            if (window.buildings && window.buildings.isBuildingFeature(tags)) {
                                loaderLog(`📍 Feature ${index}: Found building feature with tags:`, tags);
                                const buildingOptions = window.buildings.createExtrudedBuilding(feature, tags);
                                if (buildingOptions) {
                                    feature.set('extrudedBuilding', buildingOptions);
                                    loaderLog(`📍 Created building extrusion for feature ${index}`);
                                }
                            }
                            
                            // Get geometry type following the EXACT same logic as the existing system
                            const geometry = feature.getGeometry();
                            let geometryType = 'point';
                            let wayCoordinates = null;
                            let nodeIndex = null;
                            let orientationContext = null;
                            
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
                                        loaderLog(`Feature ${index}: Closed LineString detected, treating as area`);
                                    }
                                } else if (geomType === 'Point') {
                                    // The rules in model_orientation.js decide what this point
                                    // turns to face; here we only say where it is.
                                    orientationContext = {
                                        pointLonLat: ol.proj.transform(
                                            geometry.getCoordinates(), window.map.getView().getProjection(), 'EPSG:4326'),
                                        // `features` IS the array
                                        // getSource().getFeatures() just
                                        // returned. Asking the source again for
                                        // every point rebuilt the whole array
                                        // every time, which is quadratic in the
                                        // feature count and was a large part of
                                        // why a big file crawled: with ~2,000
                                        // points in a 3,800-feature file that is
                                        // ~7.7 million element copies plus the
                                        // array allocations, before any work.
                                        allFeatures: features
                                    };
                                } else if (geomType === 'MultiLineString') {
                                    geometryType = 'line';
                                } else if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
                                    geometryType = 'area';
                                }
                            }

                            if (geometryType === 'area') {
                                loaderLog(`Feature ${index}: Found area feature with geometry ${geometry?.getType()}, tags:`, tags);
                            }

                            loaderLog(`Feature ${index}: Processing ${geometryType} feature with tags:`, tags);

                            // Check if the tags match any model mapping (EXACT same approach as existing system)
                            const modelMapping = window.models ? window.models.getModelForTags(tags, wayCoordinates, nodeIndex, geometryType, orientationContext) : null;
                            if (modelMapping) {
                                loaderLog(`📍 Feature ${index}: SUCCESS: Found model mapping for ${geometryType} feature:`, modelMapping);
                                const modelFilename = modelMapping.model;
                                const modelConfig = modelMapping.config;

                                // Skip if model filename is empty
                                if (!modelFilename || modelFilename.trim() === '') {
                                    loaderLog(`📍 Feature ${index}: Skipping empty model filename for tags:`, tags);
                                    return; // Skip to next feature
                                }

                                // Set the model property for ol-cesium to use - EXACT same as existing system
                                const modelUrl = `/3dmodelsosm/src/models/${modelFilename}`;
                                const modelOptions = {
                                    uri: modelUrl,
                                    scale: modelConfig ? modelConfig.scale : 1.0,
                                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                                };

                                feature.set(window.OSM3D_MODEL_PROPERTY || 'osm3dModel', modelOptions);

                                // Set additional model configuration for positioning (EXACT same as existing system)
                                if (modelConfig) {
                                    feature.set('modelHeightOffset', modelConfig.heightOffset);
                                    feature.set('modelRotation', modelConfig.rotation);
                                } else {
                                    feature.set('modelHeightOffset', 0);
                                }

                                loaderLog(`📍 Feature ${index}: SUCCESS: Assigned 3D model ${modelFilename} to GeoJSON feature with URL: ${modelUrl}`);

                                // Apply model repetitions for lines and areas (EXACT same logic as existing system)
                                if (modelMapping.geometryType !== 'point' && window.modelRepetition) {
                                    if (loaderDebugConfig()) loaderLog(`Feature ${index}: Applying model repetitions for ${modelMapping.geometryType} feature`);

                                    if (modelMapping.geometryType === 'line') {
                                        // Every kind of way goes through ONE router.
                                        //
                                        // This used to be a chain of its own that only knew
                                        // fences, highways, footways and drains. A railway
                                        // matched none of them, so the chain simply ended and the
                                        // feature got no model at all - even though models.js maps
                                        // railway=rail to w_railway_rail.glb. It is now
                                        // applyLineRepetitions() in model_repetition.js, which
                                        // also keeps the fence/highway/footway branches and adds
                                        // a generic metre-based fallback, so no tag can fall off
                                        // the end again.
                                        try {
                                            window.modelRepetition.applyLineRepetitions(feature, tags, modelFilename, modelConfig, modelMapping.geometryType);
                                        } catch (error) {
                                            console.error(`Feature ${index}: Error applying line repetitions:`, error);
                                        }
                                    } else if (modelMapping.geometryType === 'area' && window.areaRepetition) {
                                        // Handle area repetitions (EXACT same as existing system)
                                        const tags = feature.getProperties();
                                        loaderLog(`Feature ${index}: Applying area repetitions to feature with tags:`, tags);
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
                                loaderLog(`Feature ${index}: No model mapping found for tags:`, tags);
                            }
                          } catch (featureError) {
                              // Report it, then carry on with the next feature. The
                              // console keeps the failure visible instead of it
                              // quietly swallowing the rest of the file.
                              console.error(`Feature ${index}: processing failed, skipping this feature only:`, featureError);
                          }
                        }, {
                            label: 'geojson features',
                            onProgress: function (done, total) {
                                // step(n, done, total): `n` is how many features
                                // this slice handled, which is what the panel
                                // turns into a rate and an ETA.
                                if (progress && progress.step) progress.step(done - reportedFeatures, done, total);
                                reportedFeatures = done;
                            },
                            onError: function (feature, error, index) {
                                // Backstop only - the body above already catches
                                // per feature - but a throw from here must never
                                // abandon the rest of the file.
                                console.error(`Feature ${index}: processing failed, skipping this feature only:`, error);
                            },
                            onDone: function () {
                                // Only now, with every feature processed, is it
                                // safe to walk the scene: the renderer reads the
                                // model properties and repetitions that the sweep
                                // has just written, so calling it earlier showed
                                // an incomplete scene.
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

                                    // Simple Indoor Tagging: render indoor elements loaded in 3D mode
                                    if (window.indoor) {
                                        window.indoor.addIndoorVisuals(window.ol3d);
                                    }
                                }
                                else if (progress && progress.finish) {
                                // 2D only: the work is finished, there is no
                                // renderer pass coming to write the summary,
                                // and leaving the panel up would mean a frozen
                                // counter over a finished job.
                                progress.finish();
                                }
                            }
                        });
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
            const renderer = window.modelRenderer;
            const scene = window.ol3d && window.ol3d.getCesiumScene
                ? window.ol3d.getCesiumScene() : null;
            const ownedKeys = new Set();
            const repetitionBases = [];
            const features = layerInfo.layer.getSource().getFeatures();features.forEach((feature, fidx) => {
                        // Ask the renderer for the feature's own key.
                        //
                        // This block used to rebuild
                        // `feature_<layer>_<fidx>_<extent>` from
                        // `geometry.getExtent().join('_')` while model_renderer
                        // built the same string from the extent ROUNDED to 1e-6
                        // and prefixed with the layer's OL title, which is not
                        // the layer NAME. The two never matched, so removing a
                        // large GeoJSON layer freed nothing: every primitive
                        // stayed in scene.primitives and in the map, invisible
                        // to the user and to the census.
                        var base = window.getFeatureKey ? window.getFeatureKey(feature) : null;
                        if (!base) return;
                        ownedKeys.add(base);
                        ownedKeys.add('reptex_' + base);
                        ownedKeys.add('areatex_' + base);
                        repetitionBases.push(base);
                    });

                    // Repetition keys are `rep_<base>_<index>` with an index
                    // that can run into the thousands on a long way, so they
                    // are matched by prefix against one snapshot of the map
                    // rather than by guessing how many indices to probe.
                    renderer.loadedModels.forEach(function (entry, key) {
                        for (var i = 0; i < repetitionBases.length; i++) {
                            if (key.indexOf('rep_' + repetitionBases[i] + '_') === 0) ownedKeys.add(key);
                        }
                    });

                    ownedKeys.forEach(function (featureId) {
                        if (!renderer.loadedModels.has(featureId)) return;
                        if (renderer.unloadEntry) renderer.unloadEntry(featureId, scene);
                        else renderer.loadedModels.delete(featureId);
                        console.log(`📍 Cleaned up primitive for ${featureId}`);
                    });

                    // Model-less features were draped as plain markers in a
                    // separate map, with no release path at all.
                    if (typeof renderer.unloadPlainResultsForLayer === 'function') {
                        const released = renderer.unloadPlainResultsForLayer(layerInfo.layer);
                        if (released) console.log(`📍 Cleaned up ${released} plain marker(s) for layer "${layerInfo.name}"`);
                    }
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
            const renderer = window.modelRenderer;
            const scene = window.ol3d && window.ol3d.getCesiumScene
                ? window.ol3d.getCesiumScene() : null;
            const ownedKeys = new Set();
            const repetitionBases = [];
            this.loadedLayers.forEach((layerInfo, layerId) => {
                if (layerInfo.layer) {
                    const features = layerInfo.layer.getSource().getFeatures();
                    features.forEach((feature) => {
                        // Same keys as removeLayer: model, area texture and
                        // repetitions. This block rebuilt the old
                        // `feature_<name>_<fidx>_<extent>` string, which never
                        // matched what the renderer stored, so "clear all" freed
                        // nothing at all.
                        const base = window.getFeatureKey ? window.getFeatureKey(feature) : null;
                        if (!base) return;
                        ownedKeys.add(base);
                        ownedKeys.add('reptex_' + base);
                        ownedKeys.add('areatex_' + base);
                        repetitionBases.push(base);
                    });
                }
            });

            renderer.loadedModels.forEach(function (entry, key) {
                for (let i = 0; i < repetitionBases.length; i++) {
                    if (key.indexOf('rep_' + repetitionBases[i] + '_') === 0) ownedKeys.add(key);
                }
            });
            ownedKeys.forEach(function (key) {
                if (renderer.loadedModels.has(key)) renderer.unloadEntry(key, scene);
            });
            if (typeof renderer.unloadPlainResultsForLayer === 'function') {
                this.loadedLayers.forEach(function (layerInfo) {
                    if (layerInfo.layer) renderer.unloadPlainResultsForLayer(layerInfo.layer);
                });
            }
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
