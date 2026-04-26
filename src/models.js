/**
 * Models management module for 3D model display on the map
 * Lists available 3D models from the /models folder and handles model loading
 */

// Available 3D models
const availableModels = [
    'Untitled.glb',
    'test.gltf',
    'w_amenity_bicycle_parking.glb',
    
    'w_amenity_waste_basket.glb',
    'w_area_highway_footway.glb',
    'w_barrier_kerb.gltf',
    'w_highway_footway.glb',
    'w_highway_residential.glb',
    'w_highway_street_lamp.glb',
    'w_highway_street_lamp_straight_mast.glb',
    'w_highway_traffic_signals.gltf',
    'w_highway_traffic_signals_cycle.gltf',
    'w_highway_traffic_signals_pedestrian.gltf',
    'w_man_made_pole.glb',
    'w_recycling_type_container.glb',
    'w_leisure_garden.glb',
    'w_leisure_playground.glb',
    'w_natural_tree.glb',
    'w_traffic_sign_ES_R2.gltf',
    'w_traffic_sign_ES_R101.gltf',
    'w_waterway_stream.gltf',
    'ES_CAT_BCN_casa_batllo.glb',
    'ES_CAT_BCN_casa_mila.glb',
   'ES_CAT_BCN_hotel_arts.glb',
   'ES_CAT_BCN_sagrada_familia.glb',
    'ES_CAT_BCN_torre_glories.glb',
    'ES_CAT_BCN_torre_mapfre.glb',
    'i_asfalt.jpg',
    'i_aigua.jpg',
    'i_crossing.png',
    'i_gespa.jpg',
    'i_kerb.jpg',
    'i_marbre.jpg',
    'i_manhole_drain.jpg',
    'w_amenity_motorcycle_parking.jpg',
    'i_parking_diagonal.jpg',
    'i_parking_space.jpg',
    'i_parking.png',
    'i_terra_verd.jpg',
    'i_panot.jpg',
        'i_llamborda.jpg'
];

// Model mapping for OSM tags (array of objects to support multiple tags per mapping) - Maps arrays of OSM key=value pairs to 3D model filenames
const modelMappings = [
    // Point models (existing functionality)
    { tags: ['amenity=bicycle_parking'], model: 'w_amenity_bicycle_parking.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Bicycle parking model for amenity=bicycle_parking
    { tags: ['amenity=waste_basket'], model: 'w_amenity_waste_basket.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Bicycle parking model for amenity=bicycle_parking 
    { tags: ['highway=street_lamp', 'lamp_mount=straight_mast'], model: 'w_highway_street_lamp_straight_mast.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
    { tags: ['highway=street_lamp'], model: 'w_highway_street_lamp.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Street lamp model for highway=street_lamp
    // More specific traffic signals first
    { tags: ['highway=traffic_signals', 'traffic_signals=cyclist_crossing'], model: 'w_highway_traffic_signals_cycle.gltf', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Traffic signals model for cyclist crossing
    { tags: ['highway=traffic_signals', 'traffic_signals=pedestrian_crossing'], model: 'w_highway_traffic_signals_pedestrian.gltf', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Traffic signals model for pedestrian crossing
    // General traffic signals last
    { tags: ['highway=traffic_signals'], model: 'w_highway_traffic_signals.gltf', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Traffic signals model for highway=traffic_signals
    { tags: ['man_made=pole'], model: 'w_man_made_pole.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Tree model for natural=tree
    { tags: ['natural=tree'], model: 'w_natural_tree.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Tree model for natural=tree
    { tags: ['natural=wood'], model: 'test.gltf', geometryType: 'area', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Could use forest model
    { tags: ['traffic_sign=ES:R2'], model: 'w_traffic_sign_ES_R2.gltf', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Could use forest model
    { tags: ['traffic_sign=ES:R101'], model: 'w_traffic_sign_ES_R101.gltf', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Could use forest model
        { tags: ['wikidata=Q575953'], model: 'ES_CAT_BCN_casa_batllo.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Casa Batlló
    { tags: ['wikidata=Q207870'], model: 'ES_CAT_BCN_casa_mila.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Casa Mila
    { tags: ['wikidata=Q1425790'], model: 'ES_CAT_BCN_hotel_arts.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Hotel Arts Barcelona model
    { tags: ['wikidata=Q336246'], model: 'ES_CAT_BCN_torre_glories.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Glories model
    { tags: ['wikidata=Q2689231'], model: 'ES_CAT_BCN_torre_mapfre.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Mapfre tower
    { tags: ['wikidata=Q48435'], model: 'ES_CAT_BCN_sagrada_familia.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Sagrada Familia Barcelona
    { tags: ['name=La Pedrera'], model: 'ES_CAT_BCN_casa_mila.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Casa Milà by name
    { tags: ['name=Casa Batlló'], model: 'ES_CAT_BCN_casa_batllo.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Casa Batlló by name
    { tags: ['name=Torre Mapfre'], model: 'ES_CAT_BCN_torre_mapfre.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Torre Mapfre by name
    { tags: ['recycling_type=container'], model: 'w_recycling_type_container.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Bicycle parking model for amenity=bicycle_parking 
    
    // Area models (new functionality) - supports both actual polygons and ways tagged as areas
   //  { tags: ['area:highway=footway'], model: 'llamborda.jpg', geometryType: 'area', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Footway area models
   { tags: ['highway=footway'], model: 'w_highway_footway.glb', geometryType: 'area', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Footway area models
   { tags: ['highway=residential'], model: 'w_highway_residential.glb', geometryType: 'area', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Residential area models
   // { tags: ['building=residential'], model: 'w_highway_residential.glb', geometryType: 'area', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Residential building areas
  // { tags: ['building'], model: 'w_highway_residential.glb', geometryType: 'area', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Generic building areas
  { tags: ['amenity=parking', 'orientation=diagonal'], model: '', geometryType: 'area', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Parking area models  
   { tags: ['amenity=parking_space'], model: '', geometryType: 'area', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Parking area models  
    { tags: ['amenity=parking'], model: '', geometryType: 'area', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Parking area models
  { tags: ['area:barrier=kerb'], model: 'noimage.jpg', geometryType: 'area', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Footway area texture
      { tags: ['area:highway=footway', 'footway=sidewalk'], model: 'noimage.jpg', geometryType: 'area', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Footway area texture
  { tags: ['area:highway=footway', 'footway=crossing'], model: 'noimage.jpg', geometryType: 'area', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Footway point models
{ tags: ['area:highway=residential'], model: 'i_asfalt.jpg', geometryType: 'area', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Residential area-tagged ways
{ tags: ['amenity=motorcycle_parking'], model: '', geometryType: 'area', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Motorcycle parking model for amenity=motorcycle_parking   
{ tags: ['leisure=garden'], model: '', geometryType: 'area', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Garden area models
   { tags: ['leisure=playground'], model: '', geometryType: 'area', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Playground area models
   { tags: ['waterway=stream'], model: '', geometryType: 'area', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Stream area models (closed streams)
   { tags: ['manhole=drain'], model: 'i_manhole_drain.jpg', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Manhole point models
   { tags: ['manhole=drain'], model: 'i_manhole_drain.jpg', geometryType: 'area', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Manhole area models (for closed LineStrings)
   { tags: ['parking_space=disabled'], model: '', geometryType: 'area', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Manhole area models (for closed LineStrings)
  
  // Way models (new functionality) - models placed along ways
  { tags: ['highway=footway'], model: 'w_highway_footway.glb', geometryType: 'line', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Footway line models
    { tags: ['footway=sidewalk'], model: 'w_highway_footway.glb', geometryType: 'line', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Sidewalk line models
   { tags: ['highway=residential'], model: 'w_highway_residential.glb', geometryType: 'line', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Residential road line models
   { tags: ['highway=track'], model: 'w_highway_residential.glb', geometryType: 'line', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Residential road line models
   { tags: ['barrier=kerb'], model: 'w_barrier_kerb.gltf', geometryType: 'line', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Kerb
{ tags: ['waterway=drain'], model: 'w_waterway_stream.gltf', geometryType: 'line', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Drain area models (closed drains)
   
    //{ tags: ['area:highway=footway'], model: 'w_highway_footway.glb', geometryType: 'line', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Footway line models
   
    //{ tags: ['barrier=kerb'], model: 'w_barrier_kerb.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Kerb repetitions
    
    //{ tags: ['highway=footway','footway=sidewalk'], model: 'w_area_highway_footway.glb', geometryType: 'line', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Footway line models
];

/**
 * Check if a LineString is closed (first and last coordinates are the same)
 * @param {ol.geom.LineString|Array<Array<number>>} geometry - OpenLayers LineString geometry or coordinates array
 * @returns {boolean} True if the LineString is closed
 */
function isLineStringClosed(geometry) {
    let coordinates;
    if (geometry && geometry.getCoordinates) {
        // OpenLayers geometry object
        coordinates = geometry.getCoordinates();
    } else if (Array.isArray(geometry)) {
        // Direct coordinates array
        coordinates = geometry;
    } else {
        return false;
    }
    
    if (!coordinates || coordinates.length < 3) {
        return false; // Need at least 3 coordinates to form a closed shape
    }
    
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    
    // Compare first and last coordinates with tolerance for floating point precision
    const tolerance = 1e-6;
    return Math.abs(first[0] - last[0]) < tolerance && Math.abs(first[1] - last[1]) < tolerance;
}

/**
 * Calculate the bearing (direction) of the way at a specific node index
 * @param {Array<Array<number>>} wayCoordinates - Array of [lon, lat] coordinates
 * @param {number} nodeIndex - Index of the node in the way coordinates
 * @returns {number} Bearing in radians (0 = north, clockwise)
 */
function calculateBearing(wayCoordinates, nodeIndex) {
    if (!wayCoordinates || wayCoordinates.length < 2 || nodeIndex < 0 || nodeIndex >= wayCoordinates.length) {
        return 0;
    }
    let dx, dy;
    if (nodeIndex === 0) {
        // Start of way: use direction to next node
        const curr = wayCoordinates[0];
        const next = wayCoordinates[1];
        dx = next[0] - curr[0];
        dy = next[1] - curr[1];
    } else if (nodeIndex === wayCoordinates.length - 1) {
        // End of way: use direction from previous node
        const prev = wayCoordinates[nodeIndex - 1];
        const curr = wayCoordinates[nodeIndex];
        dx = curr[0] - prev[0];
        dy = curr[1] - prev[1];
    } else {
        // Middle: average direction from prev to next
        const prev = wayCoordinates[nodeIndex - 1];
        const next = wayCoordinates[nodeIndex + 1];
        dx = next[0] - prev[0];
        dy = next[1] - prev[1];
    }
    return Math.atan2(dx, dy); // atan2(x, y) where x=east, y=north
}

/**
 * Adjust model config based on direction tags
 * @param {object} config - Original config object
 * @param {object} tags - OSM tags
 * @param {number|null} bearing - Bearing of the way at the node in radians, or null if not available
 * @returns {object} Adjusted config
 */
function adjustConfigForDirection(config, tags, bearing) {
    const adjustedConfig = JSON.parse(JSON.stringify(config));
    // Use bearing from parameter, or from parent way, or default to 0
    const baseBearing = bearing !== null ? bearing : 
                       (tags._parentWayBearing !== undefined ? tags._parentWayBearing : 0);
    adjustedConfig.rotation[1] = -baseBearing;
    const direction = tags['direction'] || tags['traffic_signals:direction'];
    if (!direction) return adjustedConfig; // No direction tag, keep base bearing
    switch (direction) {
        case 'forward':
            // No additional rotation
            break;
        case 'backward':
            adjustedConfig.rotation[1] += Math.PI; // Add 180 degrees
            break;
        case 'left':
            adjustedConfig.rotation[1] += Math.PI / 2; // Add 90 degrees
            break;
        case 'right':
            adjustedConfig.rotation[1] -= Math.PI / 2; // Subtract 90 degrees
            break;
        case 'all':
            // No additional rotation for all
            break;
        default:
            console.warn(`Unknown direction value: ${direction}`);
            break;
    }
    return adjustedConfig;
}

/**
 * Get the model mapping for a given set of OSM tags and geometry type
 * @param {object} tags - Object with OSM key-value pairs
 * @param {Array<Array<number>>|null} wayCoordinates - Array of [lon, lat] coordinates of the way, or null
 * @param {number|null} nodeIndex - Index of the node in the way coordinates, or null
 * @param {string} geometryType - The geometry type ('point', 'line', 'area')
 * @returns {object|null} Mapping object {tags, model, geometryType, config} or null if no mapping exists
 */
function getModelForTags(tags, wayCoordinates = null, nodeIndex = null, geometryType = 'point') {
    console.log(`🔍 Checking model mappings for tags:`, tags, `geometry type: ${geometryType}`);
    for (const mapping of modelMappings) {
        // Check if geometry type matches (default to 'point' for backward compatibility)
        const mappingGeometryType = mapping.geometryType || 'point';
        if (mappingGeometryType !== geometryType) continue;
        
        const allMatch = mapping.tags.every(tag => {
            const [key, value] = tag.split('=');
            // Handle compound keys like 'area:highway' - these are single tags, not combinations
            const tagValue = tags[key];
            const matches = tagValue === value;
            console.log(`🔍 Checking tag ${key}=${value}, found value: ${tagValue}, matches: ${matches}`);
            return matches;
        });
        if (allMatch) {
            console.log(`🔍 Found matching model ${mapping.model} for tags:`, mapping.tags, `geometry type: ${geometryType}`);
            const bearing = wayCoordinates && nodeIndex !== null ? calculateBearing(wayCoordinates, nodeIndex) : null;
            return { ...mapping, config: adjustConfigForDirection(mapping.config, tags, bearing) };
        }
    }
    console.log(`🔍 No model mapping found for tags:`, tags, `geometry type: ${geometryType}`);
    return null;
}

/**
 * Check if a model file exists
 * @param {string} filename - Model filename
 * @returns {boolean} True if model exists
 */
function modelExists(filename) {
    const exists = availableModels.includes(filename);
    console.log(`📁 Model ${filename} exists: ${exists}`);
    return exists;
}

// Export functions for use in other modules
window.models = {
    availableModels,
    modelMappings,
    getModelForTags,
    modelExists,
    calculateBearing,
    isLineStringClosed
};

// Debug: Confirm models.js is loaded
console.log('🎯 models.js loaded successfully. Available models:', availableModels);
console.log('🎯 Model mappings:', modelMappings);
