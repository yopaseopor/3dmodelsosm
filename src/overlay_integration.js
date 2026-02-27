// Import the overlays
import { allOverlays } from './overlays/index.js';
import { getCurrentLanguage } from './i18n/index.js';

// Import external layers
import { allLayers } from './layers/index.js';

// Function to convert overlay to OpenLayers layer
function createOlLayer(overlay) {
    // Spinner element
    const spinner = document.getElementById('overlay-search-spinner');
    function setOverlaySpinner(visible) {
        if (spinner) spinner.style.display = visible ? 'flex' : 'none';
    }
    
    let vectorSource;
    
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
                    fetch(url)
                        .then(response => {
                            if (!response.ok) {
                                throw new Error('Network response was not ok');
                            }
                            return response.json();
                        })
                        .then(data => {
                            setOverlaySpinner(false);
                            console.log('Received GeoJSON data for ' + overlay.title, data);
                            console.log('Number of features in GeoJSON:', data.features ? data.features.length : 'unknown');
                            const features = new ol.format.GeoJSON().readFeatures(data, {
                                featureProjection: projection
                            });
                            
                            console.log('Parsed features count:', features.length);
                            console.log('First few features:', features.slice(0, 3).map(f => ({ 
                                type: f.getGeometry().getType(),
                                properties: f.getProperties() 
                            })));
                            
                            // Assign 3D models to features based on their properties
                            console.log('🎯 About to assign models to', features.length, 'features');
                            features.forEach((feature, index) => {
                                if (index < 5) { // Log first 5
                                    console.log('🎯 Processing feature', index, 'properties:', feature.getProperties());
                                }
                                assignModelToFeature(feature);
                            });
                            
                            console.log('Added ' + features.length + ' features for ' + overlay.title);
                            vectorSource.addFeatures(features);
                            // Dispatch event to trigger global summary update
                            window.dispatchEvent(new CustomEvent('overlayFeaturesLoaded'));
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
                        console.log('Received data for ' + overlay.title);
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
                        
                        console.log('Added ' + features.length + ' features for ' + overlay.title);
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
                console.log('🎯 Layer became visible, triggering GeoJSON loader for', overlay.title);
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
function assignModelToFeature(feature) {
    const properties = feature.getProperties();
    console.log('🎯 Assigning model to GeoJSON feature with properties:', properties);
    
    // Filter OSM tags
    const osmTags = Object.keys(properties).filter(prop =>
        !['geometry', 'id', 'type', 'originalType', 'fixedGeometry', 'members', 'memberOf', 'member', 'membership', 'role', 'version', 'timestamp', 'changeset', 'user', 'uid', 'visible'].includes(prop)
    );
    
    // Collect all OSM tags into an object
    const tagsObj = {};
    osmTags.forEach(tag => {
        tagsObj[tag] = properties[tag];
    });
    
    // Check if the tags match any model mapping
    const modelFilename = window.models ? window.models.getModelForTags(tagsObj) : null;
    console.log(`🎯 Model filename for tags:`, tagsObj, ':', modelFilename);
    if (modelFilename) {
        // Get model configuration first
        const modelConfig = window.models ? window.models.getModelConfig(modelFilename) : null;

        // Set the model property for ol-cesium to use - use Cesium Model options object
        const modelUrl = `/src/models/${modelFilename}`;
        const modelOptions = {
            uri: modelUrl,
            scale: modelConfig ? modelConfig.scale : 1.0,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        };

        feature.model = modelOptions;

        // Set additional model configuration for positioning
        if (modelConfig) {
            // Add height offset so models appear above ground
            feature.set('modelHeightOffset', modelConfig.heightOffset);
            feature.set('modelRotation', modelConfig.rotation);
        } else {
            // Default height offset if no config
            feature.set('modelHeightOffset', 10);
        }

        console.log(`🎯 SUCCESS: Assigned 3D model ${modelFilename} to overlay feature with tags:`, tagsObj);
    }
}

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
    
    // Check if the tags match any model mapping
    const modelFilename = window.models ? window.models.getModelForTags(tagsObj) : null;
    if (modelFilename) {
        const modelConfig = window.models ? window.models.getModelConfig(modelFilename) : null;
        const modelUrl = `/src/models/${modelFilename}`;
        return {
            uri: modelUrl,
            scale: modelConfig ? modelConfig.scale : 1.0,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        };
    }
    return null;
}

// Make parseFeatureForModel available globally
window.parseFeatureForModel = parseFeatureForModel;
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