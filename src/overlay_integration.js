// Import the overlays
import { allOverlays } from './overlays/index.js';
import { getCurrentLanguage } from './i18n/index.js';

// Import external layers
import { allLayers } from './layers/index.js';

// Import centralized debug configuration
if (typeof window !== 'undefined' && window.globalDebugConfig) {
    var debugConfig = window.globalDebugConfig.overlayIntegration;
} else {
    // Fallback debug configuration if centralized config not available
    var debugConfig = {
        enabled: false,
        logOverlayLoading: false,      // Log overlay loading operations
        logFeatureProcessing: false,   // Log individual feature processing
        logModelAssignment: false,     // Log model assignment details
        logGeometryDetection: false,   // Log geometry detection details
        logAreaProcessing: false       // Log area texture processing
    };
}

// Function to convert overlay to OpenLayers layer
function createOlLayer(overlay) {
    // Spinner element
    const spinner = document.getElementById('overlay-search-spinner');
    function setOverlaySpinner(visible) {
        if (spinner) spinner.style.display = visible ? 'flex' : 'none';
    }
    
    let vectorSource;

    /**
     * Turn one parsed GeoJSON object into features on the map.
     *
     * This is the single path for overlay data, used by both the normal fetch
     * and the precharge hand-off. It was inline in the fetch's .then() before,
     * so there was nowhere for an already-parsed file to enter except by
     * fetching and parsing it all over again.
     */
    function ingestGeoJSON(data, projection) {
        setOverlaySpinner(false);
        if (debugConfig.enabled && debugConfig.logOverlayLoading) console.log('Received GeoJSON data for ' + overlay.title, data);
        if (debugConfig.enabled && debugConfig.logOverlayLoading) console.log('Number of features in GeoJSON:', data.features ? data.features.length : 'unknown');
        const features = new ol.format.GeoJSON().readFeatures(data, {
            featureProjection: projection
        });

        if (debugConfig.enabled && debugConfig.logFeatureProcessing) console.log('Parsed features count:', features.length);
        if (debugConfig.enabled && debugConfig.logFeatureProcessing) console.log('First few features:', features.slice(0, 3).map(f => ({
            type: f.getGeometry().getType(),
            properties: f.getProperties()
        })));

        // Assign 3D models to features based on their properties
        if (debugConfig.enabled && debugConfig.logModelAssignment) console.log('🎯 About to assign models to', features.length, 'features');

        // Same reason as the GeoJSON loader's sweep: thousands of features in
        // one blocking loop freeze the tab, so it is time-sliced here too.
        //
        // The fallback keeps the old synchronous behaviour, so a missing
        // progressive.js degrades to "slow" rather than to "broken" - and it
        // calls onDone itself, which is why the add lives in onDone and not
        // straight after the call.
        const assignAll = window.progressive && window.progressive.forEach
            ? window.progressive.forEach
            : function (items, worker, opts) {
                for (let i = 0; i < items.length; i++) {
                    try { worker(items[i], i); }
                    catch (error) { if (opts && opts.onError) opts.onError(items[i], error, i); }
                }
                if (opts && opts.onDone) opts.onDone();
            };

        // Everything after the sweep: the features are only added to the source
        // once EVERY one of them has its model, otherwise the renderer would
        // wake up on a half-finished layer and never revisit it.
        function publishFeatures() {
            if (debugConfig.enabled && debugConfig.logOverlayLoading) console.log('Added ' + features.length + ' features for ' + overlay.title);
            vectorSource.addFeatures(features);
            // Dispatch event to trigger global summary update
            window.dispatchEvent(new CustomEvent('overlayFeaturesLoaded'));
        }

        assignAll(features, (feature, index) => {
            if (index < 5 && debugConfig.enabled && debugConfig.logFeatureProcessing) { // Log first 5
                console.log('🎯 Processing feature', index, 'properties:', feature.getProperties());
            }
            assignModelToFeature(feature, features);
        }, {
            label: 'overlay features',
            onError: (feature, error, index) => {
                console.error('Overlay "' + overlay.title + '" feature ' + index + ' failed, skipping this feature only:', error);
            },
            onDone: publishFeatures
        });
    }
    
    if (overlay.geojson) {
        // Handle GeoJSON overlays
        vectorSource = new ol.source.Vector({
            format: new ol.format.GeoJSON(),
            loader: function(extent, resolution, projection) {
                // For GeoJSON files, load immediately when first requested
                if (vectorSource.getFeatures().length === 0) {
                    // Show spinner before fetch
                    setOverlaySpinner(true);
                    const url = overlay.geojson;

                    // Precharge may already have fetched AND parsed this file
                    // in the background. Take it instead of asking for it again:
                    // no request, no JSON.parse, straight to the map. Without
                    // this the background work was thrown away and opening the
                    // overlay still cost the full download plus parse.
                    const precharged = window.precharge ? window.precharge.take(url) : null;
                    if (precharged) {
                        console.log('⚡ Using precharged data for ' + overlay.title);
                        ingestGeoJSON(precharged, projection);
                        return;
                    }

                    fetch(url)
                        .then(response => {
                            if (!response.ok) {
                                throw new Error('Network response was not ok');
                            }
                            return response.json();
                        })
                        .then(data => {
                            ingestGeoJSON(data, projection);
                        })
                        .catch(error => {
                            setOverlaySpinner(false);
                            console.error('Error loading GeoJSON data for ' + overlay.title + ':', error);
                        });
                }
            },
            strategy: ol.loadingstrategy.all // Load all data at once, not based on bbox
        });
    } else if (overlay.query) {
        // Handle Overpass query overlays
        vectorSource = new ol.source.Vector({
            format: new ol.format.GeoJSON(),
            loader: function(extent, resolution, projection) {
                const epsg4326Extent = ol.proj.transformExtent(extent, projection, 'EPSG:4326');
                const bbox = [epsg4326Extent[1], epsg4326Extent[0], epsg4326Extent[3], epsg4326Extent[2]].join(',');
                const query = overlay.query.replace('{{bbox}}', bbox);
                const url = window.config.overpassApi() + '?data=' + encodeURIComponent(query);
                // Show spinner before fetch
                setOverlaySpinner(true);
                fetch(url)
                    .then(response => {
                        if (!response.ok) {
                            throw new Error('Network response was not ok');
                        }
                        return response.json();
                    })
                    .then(data => {
                        setOverlaySpinner(false);
                        if (debugConfig.enabled && debugConfig.logOverlayLoading) console.log('Received data for ' + overlay.title);
                        if (!data || !data.elements) {
                            console.warn('No elements found in response for ' + overlay.title);
                            return;
                        }
                        const geojson = osmtogeojson(data);
                        const features = new ol.format.GeoJSON().readFeatures(geojson, {
                            featureProjection: projection
                        });
                        
                        // Assign 3D models to features based on their properties
                        features.forEach(feature => {
                            assignModelToFeature(feature);
                        });
                        
                        if (debugConfig.enabled && debugConfig.logOverlayLoading) console.log('Added ' + features.length + ' features for ' + overlay.title);
                        vectorSource.addFeatures(features);
                        // Dispatch event to trigger global summary update
                        window.dispatchEvent(new CustomEvent('overlayFeaturesLoaded'));
                    })
                    .catch(error => {
                        setOverlaySpinner(false);
                        console.error('Error loading overlay data for ' + overlay.title + ':', error);
                    });
            },
            strategy: ol.loadingstrategy.bbox
        });
    } else {
        // Fallback: create empty vector source
        vectorSource = new ol.source.Vector({
            format: new ol.format.GeoJSON()
        });
    }

    const layer = new ol.layer.Vector({
        title: overlay.title,
        group: overlay.group,
        type: 'overlay',
        source: vectorSource,
        style: typeof overlay.style === 'function' ? overlay.style : undefined,
        visible: false
    });

    // Add a reference to the original overlay for easier access
    layer.overlay = overlay;
    
    // For GeoJSON overlays, ensure loader runs when layer becomes visible
    if (overlay.geojson) {
        layer.on('change:visible', function() {
            if (layer.getVisible() && vectorSource.getFeatures().length === 0) {
                if (debugConfig.enabled && debugConfig.logOverlayLoading) console.log('🎯 Layer became visible, triggering GeoJSON loader for', overlay.title);
                // Trigger the loader manually
                vectorSource.loadFeatures([0, 0, 0, 0], 0, window.map.getView().getProjection());
            }
        });
    }
    
    return layer;
}

// Function to create overlay group
function createOverlayGroup(title, layers) {
    // Get the translated title
    const translatedTitle = window.getTranslation ? window.getTranslation(title) : title;
    
    // Create the group with the translated title
    const group = new ol.layer.Group({
        title: translatedTitle,
        type: 'overlay',
        // Store the original untranslated title for future translations
        originalTitle: title,
        layers: new ol.Collection(layers),
        visible: true
    });
    
    // Store the original title on each layer for reference
    layers.forEach(layer => {
        if (layer.overlay) {
            layer.overlay._originalGroup = title;
        }
    });
    
    return group;
}

// Helper function to assign 3D models to features
function assignModelToFeature(feature, allFeatures = null) {
    if (debugConfig.enabled && debugConfig.logFeatureProcessing) console.log('Processing feature geometry:', feature.getGeometry() ? feature.getGeometry().getType() : 'null', 'tags:', feature.getProperties());
    const properties = feature.getProperties();
    if (debugConfig.enabled && debugConfig.logModelAssignment) console.log('🎯 Assigning model to GeoJSON feature with properties:', properties);
    
    // Filter OSM tags
    const osmTags = Object.keys(properties).filter(prop =>
        !['geometry', 'id', 'type', 'originalType', 'fixedGeometry', 'members', 'memberOf', 'member', 'membership', 'role', 'version', 'timestamp', 'changeset', 'user', 'uid', 'visible'].includes(prop)
    );
    
    // Collect all OSM tags into an object
    const tagsObj = {};
    osmTags.forEach(tag => {
        tagsObj[tag] = properties[tag];
    });
    if (debugConfig.enabled && debugConfig.logModelAssignment) console.log('assignModelToFeature tagsObj:', tagsObj);

    // Feature geometry (OL geometry in the map projection). This declaration was
    // lost in a refactor (commit 4a6a397): the code below read an undeclared
    // `geometry`, throwing "ReferenceError: geometry is not defined" for every
    // feature and killing model/texture assignment for all GeoJSON overlays —
    // the load's .catch() also swallowed the features themselves.
    const geometry = feature.getGeometry();

    let geometryType = 'point'; // default
    let wayCoordinates = null;
    let nodeIndex = null;
    let orientationContext = null;
    
    if (debugConfig.enabled && debugConfig.logGeometryDetection) console.log(`🎯 Geometry detection for feature with tags:`, tagsObj, `geometry:`, geometry ? geometry.getType() : 'null');
    
    if (geometry) {
        const geomType = geometry.getType();
        if (debugConfig.enabled && debugConfig.logGeometryDetection) console.log(`🎯 Geometry type: ${geomType}`);
        if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
            geometryType = 'area';
        } else if (geomType === 'LineString' || geomType === 'MultiLineString') {
            // Check if LineString is closed (first and last coordinates are the same)
            const isClosed = window.models && window.models.isLineStringClosed ? 
                             window.models.isLineStringClosed(geometry) : false;
            
            // Check if this is a way tagged as an area
            if (debugConfig.enabled && debugConfig.logGeometryDetection) console.log(`🎯 Checking area tags on LineString: area:highway=${tagsObj['area:highway']}`);
            const hasAreaTag = tagsObj['area:highway'] || tagsObj['area:amenity'] || tagsObj['area:leisure'] || tagsObj['area:natural'] || tagsObj['area:landuse'];
            
            if (isClosed || hasAreaTag) {
                geometryType = 'area';
                if (debugConfig.enabled && debugConfig.logGeometryDetection) {
                    if (isClosed) {
                        console.log(`🔗 DEBUG: Closed LineString detected, treating as area`);
                    } else {
                        console.log(`🎨 Detected area-tagged way, treating as area geometry`);
                    }
                }
            } else {
                geometryType = 'line';
            }
            // Extract way coordinates from LineString geometry for bearing calculation
            const coordinates = geometry.getCoordinates();
            // Convert from map projection to lon/lat for bearing calculation
            wayCoordinates = coordinates.map(coord => 
                ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326')
            );
            // Use the middle node for bearing calculation, or first if only one segment
            nodeIndex = Math.floor(wayCoordinates.length / 2);
            
            if (debugConfig.enabled && debugConfig.logGeometryDetection) console.log(`📐 Way coordinates extracted: ${wayCoordinates.length} nodes, calculating bearing at node ${nodeIndex}`);
            if (debugConfig.enabled && debugConfig.logGeometryDetection) console.log(`📐 Way coordinate sample:`, wayCoordinates.slice(0, 3).map((coord, i) => 
                `[${i}]: [${coord[0].toFixed(6)}, ${coord[1].toFixed(6)}]`
            ));
        } else if (geomType === 'Point') {
            geometryType = 'point';
            // The rules in model_orientation.js decide what this point turns to
            // face; here we only say where it is and what ways are around it.
            if (allFeatures) {
                orientationContext = {
                    pointLonLat: ol.proj.transform(geometry.getCoordinates(), window.map.getView().getProjection(), 'EPSG:4326'),
                    allFeatures: allFeatures
                };
            }
        }
    }
    
    // Check for area tags that force geometry type after geometry determination
    if (Object.keys(tagsObj).some(key => key.startsWith('area:'))) {
        geometryType = 'area';
    }

    // Special case: treat footway features as lines for model placement along paths
    if (tagsObj['highway'] === 'footway') {
        geometryType = 'line';
    }

    if (debugConfig.enabled && debugConfig.logGeometryDetection) console.log(`🔍 Final geometry type determination: ${geometryType} for tags:`, tagsObj);
    const modelMapping = window.models ? window.models.getModelForTags(tagsObj, wayCoordinates, nodeIndex, geometryType, orientationContext) : null;
    if (debugConfig.enabled && debugConfig.logModelAssignment) console.log(`🎯 Model mapping for tags:`, tagsObj, `geometry type: ${geometryType}:`, modelMapping);
    
    if (modelMapping) {
        const modelFilename = modelMapping.model;
        const modelConfig = modelMapping.config;
        const mappingGeometryType = modelMapping.geometryType;
        
        if (mappingGeometryType === 'area') {
            if (debugConfig.enabled && debugConfig.logAreaProcessing) console.log('🎨 Area code reached for tags:', tagsObj, 'geometryType:', mappingGeometryType);
            // Handle area textures/materials
            if (debugConfig.enabled && debugConfig.logAreaProcessing) console.log(`🎨 Applying area texture ${modelFilename} to polygon or line`);
            
            // Create a Cesium entity for the textured area or line
            try {
                const geometry = feature.getGeometry();
                if (geometry && geometry.getType() === 'Polygon') {
                    const coordinates = geometry.getCoordinates()[0];
                    // OL geometries are in the map projection (EPSG:3857 meters):
                    // transform to WGS84 degrees before fromDegrees, otherwise the
                    // draped texture lands near (0,0) in the Atlantic.
                    const mapProjection = window.map.getView().getProjection();
                    const cesiumPositions = coordinates.map(coord => {
                        const lonLat = ol.proj.transform(coord, mapProjection, 'EPSG:4326');
                        return Cesium.Cartesian3.fromDegrees(lonLat[0], lonLat[1]);
                    });
                    
                    if (cesiumPositions.length > 0) {
                        // Check if feature already has an area entity to prevent duplicates
                        if (feature.get('areaEntity')) {
                            if (debugConfig.enabled && debugConfig.logAreaProcessing) console.log(`🎨 Feature already has area entity, skipping duplicate creation`);
                            return;
                        }
                        
                        // Calculate texture rotation based on nearby ways
                        const polygonCoords = coordinates.map(coord => 
                            ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326')
                        );
                        const textureRotation = window.modelRenderer ? 
                            window.modelRenderer.calculateTextureRotation(polygonCoords, modelFilename, tagsObj) : 
                            0; // No rotation if modelRenderer not available
                        
                        if (debugConfig.enabled && debugConfig.logAreaProcessing) {
                            console.log(`🎨 overlay texture °: ${(textureRotation * 180 / Math.PI).toFixed(1)}`);
                        }
                        
                        const hierarchy = new Cesium.PolygonHierarchy(cesiumPositions);
                        if (debugConfig.enabled && debugConfig.logAreaProcessing) {
                            console.log(`🎨 overlay area entity`, modelFilename);
                        }
                        const areaEntity = new Cesium.Entity({
                            polygon: {
                                hierarchy: hierarchy,
                                material: new Cesium.ImageMaterialProperty({
                                    image: `/3dmodelsosm/src/models/${modelFilename}`,
                                    repeat: new Cesium.Cartesian2(1, 1),
                                    stRotation: textureRotation !== 0 ? textureRotation : undefined
                                }),
                                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND // drape over DEM terrain (was flat at 0.001m)
                            }
                        });
                        
                        feature.set('areaEntity', areaEntity);
                        
                        // If we're in 3D mode, immediately add the area to the scene
                        if (window.ol3d && window.ol3d.getDataSources) {
                            const dataSources = window.ol3d.getDataSources();
                            let dataSource = null;
                            for (let i = 0; i < dataSources.length; i++) {
                                const ds = dataSources.get(i);
                                if (ds.name === 'AreaTextures') {
                                    dataSource = ds;
                                    break;
                                }
                            }
                            if (!dataSource) {
                                dataSource = new Cesium.CustomDataSource('AreaTextures');
                                dataSources.add(dataSource);
                                if (debugConfig.enabled && debugConfig.logAreaProcessing) console.log('🎨 AreaTextures data source');
                            }
                            dataSource.entities.add(areaEntity);
                            if (debugConfig.enabled && debugConfig.logAreaProcessing) console.log(`🎨 overlay area entity added`);
                        }
                        
                        if (debugConfig.enabled && debugConfig.logAreaProcessing) {
                            console.log(`🎨 overlay area ok ${modelFilename} verts=${cesiumPositions.length}`);
                        }
                    } else {
                        console.warn(`🎨 No valid coordinates found for area texture`);
                    }
                } else if (geometry && geometry.getType() === 'LineString') {
                    const coordinates = geometry.getCoordinates();
                    // Same projection fix as polygons above (map projection -> WGS84).
                    const mapProjection = window.map.getView().getProjection();
                    const positions = coordinates.map(coord => {
                        const lonLat = ol.proj.transform(coord, mapProjection, 'EPSG:4326');
                        return Cesium.Cartesian3.fromDegrees(lonLat[0], lonLat[1]);
                    });
                    
                    if (positions.length > 1) {
                        // Calculate texture rotation based on nearby ways for line textures
                        const lineCoords = coordinates.map(coord => 
                            ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326')
                        );
                        const textureRotation = window.modelRenderer ? 
                            window.modelRenderer.calculateTextureRotation(lineCoords, modelFilename, tagsObj) : 
                            0; // No rotation if modelRenderer not available
                        
                        if (debugConfig.enabled && debugConfig.logAreaProcessing) {
                            console.log(`🎨 overlay line texture °: ${(textureRotation * 180 / Math.PI).toFixed(1)}`);
                        }
                        
                        const areaEntity = new Cesium.Entity({
                            polyline: {
                                positions: positions,
                                width: 5,
                                clampToGround: true, // drape over DEM terrain — at ellipsoid
                                                     // height 0 the texture line is buried on
                                                     // mountains and z-fights at sea level
                                material: new Cesium.ImageMaterialProperty({
                                    image: `/3dmodelsosm/src/models/${modelFilename}`,
                                    repeat: new Cesium.Cartesian2(coordinates.length * 0.1, 1),
                                    stRotation: textureRotation !== 0 ? textureRotation : undefined
                                })
                            }
                        });
                        
                        feature.set('areaEntity', areaEntity);
                        
                        // If we're in 3D mode, immediately add the polyline to the scene
                        if (window.ol3d && window.ol3d.getDataSources) {
                            const dataSources = window.ol3d.getDataSources();
                            let dataSource = null;
                            for (let i = 0; i < dataSources.length; i++) {
                                const ds = dataSources.get(i);
                                if (ds.name === 'AreaTextures') {
                                    dataSource = ds;
                                    break;
                                }
                            }
                            if (!dataSource) {
                                dataSource = new Cesium.CustomDataSource('AreaTextures');
                                dataSources.add(dataSource);
                                if (debugConfig.enabled && debugConfig.logAreaProcessing) console.log('🎨 AreaTextures data source');
                            }
                            dataSource.entities.add(areaEntity);
                            if (debugConfig.enabled && debugConfig.logAreaProcessing) console.log(`🎨 overlay polyline added`);
                        }
                        
                        if (debugConfig.enabled && debugConfig.logAreaProcessing) {
                            console.log(`🎨 overlay line ok ${modelFilename} pts=${positions.length}`);
                        }
                    } else {
                        console.warn(`🎨 No valid coordinates found for line texture`);
                    }
                } else {
                    console.warn(`🎨 Area texture feature has unsupported geometry type: ${geometry ? geometry.getType() : 'null'}`);
                }
            } catch (error) {
                console.error('🎨 Error creating area texture entity:', error);
            }
            
        } else if (mappingGeometryType === 'line') {
            // Handle way textures or models along ways
            if (debugConfig.enabled && debugConfig.logFeatureProcessing) {
                console.log(`🛤️ way model ${modelFilename}`);
            }
            
            // For ways, we can either:
            // 1. Place multiple models along the way (like existing behavior)
            // 2. Apply texture along the corridor
            
            // Start with option 1: place models at intervals along the way
            if (wayCoordinates && wayCoordinates.length > 1) {
                // Models along a way must be written as repetition_0, repetition_1,
                // ... because that is the ONLY thing model_renderer reads when it
                // places a feature (see addRepetitionModels).
                //
                // This block used to build the whole run of way models right here,
                // at a step of 0.05 along the way index (20 models PER SEGMENT),
                // and park the result on `feature.wayModels`. Nothing ever read
                // that property: it is written in this file and in value_search.js
                // and read nowhere in the codebase. So every line model produced
                // here went into a dead end, which is why a railway way in an
                // overlay GeoJSON resolved to w_railway_rail.glb and then drew
                // nothing at all.
                //
                // The 170k intermediate objects it built per overlay are gone too:
                // paris.geojson has ~8500 way segments, so one overlay produced
                // 170,280 of them on every load.
                //
                // applyLineRepetitions (model_repetition.js) is now the one place
                // that decides how a tagged way is populated: fence -> highway ->
                // footway -> railway -> generic metre-based fallback. It never ends
                // in "nothing to do", which is what a railway used to hit.
                if (window.modelRepetition && window.modelRepetition.applyLineRepetitions) {
                    window.modelRepetition.applyLineRepetitions(feature, tagsObj, modelFilename, modelConfig, mappingGeometryType);
                } else if (window.modelRepetition && window.modelRepetition.applyModelRepetitions) {
                    window.modelRepetition.applyModelRepetitions(feature, modelFilename, modelConfig, mappingGeometryType);
                }
            } else if (!wayCoordinates && geometry && geometry.getType() === 'Point') {
                // Handle point features treated as lines: place a single model at the point
                const pointCoords = geometry.getCoordinates();
                const lonLat = ol.proj.transform(pointCoords, window.map.getView().getProjection(), 'EPSG:4326');
                
                const pointModelOptions = {
                    uri: `/3dmodelsosm/src/models/${modelFilename}`,
                    scale: modelConfig ? modelConfig.scale : 1.0,
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                    position: Cesium.Cartesian3.fromDegrees(lonLat[0], lonLat[1])
                };
                
                feature.set(window.OSM3D_MODEL_PROPERTY || 'osm3dModel', pointModelOptions);
                
                // Set additional model configuration for positioning
                if (modelConfig) {
                    // Add height offset so models appear above ground
                    feature.set('modelHeightOffset', modelConfig.heightOffset);
                    feature.set('modelRotation', modelConfig.rotation);
                    
                    // Log bearing and rotation information
                    console.log(`� Model ${modelFilename} orientation info for point feature:`);
                    console.log(`  📍 Position: [${lonLat[0].toFixed(6)}, ${lonLat[1].toFixed(6)}]`);
                    console.log(`  🔄 Final rotation: [${modelConfig.rotation.join(', ')}]`);
                    console.log(`  📍 Feature ID: ${properties.id || 'unknown'}, Tags:`, tagsObj);
                } else {
                    // Default height offset if no config
                    feature.set('modelHeightOffset', 0);
                }
                
                console.log(`🛤️ SUCCESS: Placed single model at point for line-treated feature with tags:`, tagsObj);
            }
            
        } else {
            // Handle point models (existing functionality)
            console.log(`🎯 Applying point model ${modelFilename}`);
            
            // Set the model property for ol-cesium to use - use Cesium Model options object
            const modelUrl = `/3dmodelsosm/src/models/${modelFilename}`;
            const modelOptions = {
                uri: modelUrl,
                scale: modelConfig ? modelConfig.scale : 1.0,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            };

            feature.set(window.OSM3D_MODEL_PROPERTY || 'osm3dModel', modelOptions);

            // Set additional model configuration for positioning
            if (modelConfig) {
                // Add height offset so models appear above ground
                feature.set('modelHeightOffset', modelConfig.heightOffset);
                feature.set('modelRotation', modelConfig.rotation);
                
                // Log bearing and rotation information
                const bearing = wayCoordinates && nodeIndex !== null ? 
                    window.models.calculateBearing(wayCoordinates, nodeIndex) : 
                    (tagsObj._parentWayBearing !== undefined ? tagsObj._parentWayBearing : null);
                console.log(`🎯 Model ${modelFilename} orientation info:`);
                console.log(`  📐 Bearing at node ${nodeIndex}: ${bearing ? (bearing * 180 / Math.PI).toFixed(2) : 'N/A'}°`);
                console.log(`  🔄 Final rotation: [${modelConfig.rotation.join(', ')}] (Y-axis: ${(modelConfig.rotation[1] * 180 / Math.PI).toFixed(2)}°)`);
                console.log(`  📍 Feature ID: ${properties.id || 'unknown'}, Tags:`, tagsObj);
            } else {
                // Default height offset if no config
                feature.set('modelHeightOffset', 0);
            }

            console.log(`🎯 SUCCESS: Assigned point model ${modelFilename} to feature with tags:`, tagsObj);
        }
    }
}

// findBearingFromParentWays() used to live here. It picked the globally
// NEAREST way VERTEX with no tag filter and compared distances in raw
// degrees (0.0001, which is ~11 m north but only ~8 m east). It is gone:
// a point's orientation is now resolved from the declarative rules in
// model_orientation.js, which pick the KIND of way to use, not merely the
// nearest one. Nothing calls this any more; do not reintroduce it.

// Function to integrate overlays
function integrateOverlays() {
    if (!window.config || !window.config.layers) return;
    
    console.log('Integrating overlays...');
    
    // Clear existing overlay layers
    window.config.layers = window.config.layers.filter(layer => layer.get('type') !== 'overlay');
    
    // Flatten all overlays from all groups
    const allOverlaysFlat = Object.values(window.allOverlays)
        .filter(Array.isArray)
        .flat();

    // Start downloading and parsing the overlay files NOW, in the background,
    // so that opening one later is instant instead of a long download plus a
    // long JSON.parse while the tab is frozen. precharge probes each file with
    // a HEAD request first and only really fetches the big ones.
    if (window.precharge && window.precharge.warmAll) {
        window.precharge.warmAll(allOverlaysFlat);
    }
        
    // Group overlays by their group property
    const groupMap = {};
    allOverlaysFlat.forEach(overlay => {
        if (!overlay.group) return;
        let groupKey = overlay.group;
        // Store the original group key for reference
        overlay._originalGroup = groupKey;
        if (!groupMap[groupKey]) groupMap[groupKey] = [];
        groupMap[groupKey].push(overlay);
    });
    
    // Store current visibility state of layers by title
    const visibilityState = {};
    if (window.config && window.config.layers) {
        window.config.layers.forEach(layer => {
            if (layer.get('type') === 'overlay') {
                const title = layer.get('title');
                if (title) {
                    visibilityState[title] = layer.getVisible();
                }
            }
        });
    }
    
    // Create OpenLayers groups for each unique group name
    const overlayGroups = {};
    Object.entries(groupMap).forEach(([groupName, overlays]) => {
        const layers = overlays.map(overlay => createOlLayer(overlay));
        const group = createOverlayGroup(groupName, layers);
        
        // Restore visibility state if it exists
        const groupTitle = group.get('title');
        if (groupTitle in visibilityState) {
            group.setVisible(visibilityState[groupTitle]);
        }
        
        overlayGroups[groupName] = group;
    });
    
    // Add groups to config layers
    Object.values(overlayGroups).forEach(group => {
        window.config.layers.push(group);
    });
    
    // Update window.overlays for the search functionality
    console.log('Updating window.overlays...');
    window.overlays = Object.entries(overlayGroups).flatMap(([groupName, group]) => {
        return group.getLayers().getArray().map(layer => ({
            title: layer.get('title'),
            group: groupName, // Keep original group name for reference
            id: layer.get('id') || '',
            _olLayer: layer,
            ...layer.overlay,
            _originalGroup: groupName
        }));
    });
    
    // Dispatch event to notify that overlays are ready
    console.log('Dispatching overlaysReady event...');
    window.dispatchEvent(new CustomEvent('overlaysReady', {
        detail: { 
            overlays: window.overlays,
            groups: overlayGroups
        }
    }));
    
    // Also dispatch a custom event when all overlays are loaded
    window.dispatchEvent(new CustomEvent('overlaysFullyLoaded'));
}

// Function to integrate external layers
function integrateExternalLayers() {
    if (!window.config || !window.config.layers) return;
    // Flatten all layers from all external sources
    const allExternalLayers = Object.values(allLayers)
        .filter(Array.isArray)
        .flat();
    // Add each external layer (allow duplicates for now)
    allExternalLayers.forEach(layer => {
        if (layer && layer.get) {
            window.config.layers.push(layer);
        }
    });
    // Debug: Log all layer titles after integration
    console.log('All layers after external integration:', window.config.layers.map(l => l.get && l.get('title')));
}

// Integrate overlays and external layers
function integrateAll() {
    integrateExternalLayers();
    integrateOverlays();
}

// Make integrateOverlays available globally
window.integrateOverlays = integrateOverlays;

// Function to parse a GeoJSON feature and return 3D model options
function parseFeatureForModel(feature) {
    const properties = feature.properties || feature.getProperties();
    const excludedProperties = ['geometry', 'id', 'type', 'originalType', 'fixedGeometry', 'members', 'memberOf', 'member', 'membership', 'role', 'version', 'timestamp', 'changeset', 'user', 'uid', 'visible'];
    
    // Filter OSM tags
    const osmTags = Object.keys(properties).filter(prop => !excludedProperties.includes(prop));
    
    // Collect all OSM tags into an object
    const tagsObj = {};
    osmTags.forEach(tag => {
        tagsObj[tag] = properties[tag];
    });
    
    // Detect geometry type
    const geometry = feature.geometry || feature.getGeometry();
    let geometryType = 'point'; // default
    let wayCoordinates = null;
    let nodeIndex = null;
    
    if (geometry) {
        const geomType = geometry.type || (geometry.getType && geometry.getType());
        if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
            geometryType = 'area';
        } else if (geomType === 'LineString' || geomType === 'MultiLineString') {
            // Extract way coordinates from geometry for bearing calculation
            let wayCoordinates = null;
            let nodeIndex = null;
            const geometry = feature.getGeometry();
            if (geometry) {
                const geomType = geometry.getType();
                if (geomType === 'LineString') {
                    const coordinates = geometry.getCoordinates();
                    if (coordinates) {
                        wayCoordinates = coordinates.map(coord => ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326'));
                        nodeIndex = Math.floor(wayCoordinates.length / 2);
                    }
                } else if (geomType === 'MultiLineString') {
                    const coordinates = geometry.getCoordinates();
                    if (coordinates) {
                        wayCoordinates = coordinates.flat().map(coord => ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326'));
                        nodeIndex = Math.floor(wayCoordinates.length / 2);
                    }
                }
            }
            geometryType = 'line';
        } else if (geomType === 'Point') {
            geometryType = 'point';
        }
    }
    
    // Check if the tags match any model mapping with the detected geometry type
    const modelMapping = window.models ? window.models.getModelForTags(tagsObj, wayCoordinates, nodeIndex, geometryType) : null;
    if (modelMapping) {
        const modelConfig = modelMapping.config;
        const mappingGeometryType = modelMapping.geometryType;
        
        if (mappingGeometryType === 'area') {
            // Return area texture options
            return {
                type: 'area',
                polygon: {
                    hierarchy: geometry ? (geometry.coordinates || geometry.getCoordinates()) : [],
                    material: {
                        image: `/3dmodelsosm/src/models/${modelMapping.model}`,
                        transparent: true
                    },
                    height: modelConfig ? modelConfig.heightOffset : 0,
                    extrudedHeight: 0
                }
            };
        } else if (mappingGeometryType === 'line') {
            // For ways, return array of models along the way
            const wayModels = [];
            if (wayCoordinates && wayCoordinates.length > 1) {
                const interval = Math.max(1, Math.floor(wayCoordinates.length / 10));
                for (let i = 0; i < wayCoordinates.length; i += interval) {
                    const bearing = window.models.calculateBearing(wayCoordinates, i);
                    const adjustedConfig = window.models.adjustConfigForDirection ? 
                        window.models.adjustConfigForDirection(modelConfig, tagsObj, bearing) : modelConfig;
                    
                    wayModels.push({
                        position: wayCoordinates[i],
                        model: {
                            uri: `/3dmodelsosm/src/models/${modelMapping.model}`,
                            scale: adjustedConfig ? adjustedConfig.scale : 1.0,
                            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                            position: Cesium.Cartesian3.fromDegrees(wayCoordinates[i][0], wayCoordinates[i][1])
                        },
                        config: adjustedConfig
                    });
                }
            }
            return {
                type: 'way',
                models: wayModels
            };
        } else {
            // Return point model options (existing functionality)
            const modelUrl = `/3dmodelsosm/src/models/${modelMapping.model}`;
            return {
                uri: modelUrl,
                scale: modelConfig ? modelConfig.scale : 1.0,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            };
        }
    }
    return null;
}

// Make assignModelToFeature available globally
window.assignModelToFeature = assignModelToFeature;
console.log('Overlay integration module loaded');

// Listen for config to be available
if (window.config) {
    console.log('Config already available, integrating overlays...');
    integrateAll();
} else {
    console.log('Waiting for config to be available...');
    window.addEventListener('configLoaded', () => {
        console.log('Config loaded, integrating overlays...');
        integrateAll();
    });
}

// Re-integrate when new overlays are loaded
window.addEventListener('overlaysUpdated', function(event) {
    console.log('Overlays updated, re-integrating...', event.detail);
    if (window.config) {
        integrateOverlays();
    }
});