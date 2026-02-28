/**
 * Models management module for 3D model display on the map
 * Lists available 3D models from the /models folder and handles model loading
 */

// Available 3D models
const availableModels = [
    'Untitled.glb',
    'test.gltf',
    'w_amenity_bicycle_parking.glb',
    'w_highway_street_lamp.glb',
    'w_highway_street_lamp_straight_mast.glb',
    'w_highway_traffic_signals.glb',
    'w_natural_tree.glb',
    'ES_CAT_BCN_casa_batllo.glb',
    'ES_CAT_BCN_casa_mila.glb',
   'ES_CAT_BCN_hotel_arts.glb',
   'ES_CAT_BCN_sagrada_familia.glb',
    'ES_CAT_BCN_torre_glories.glb',
    'ES_CAT_BCN_torre_mapfre.glb'
];

// Model mapping for OSM tags (array of objects to support multiple tags per mapping) - Maps arrays of OSM key=value pairs to 3D model filenames
const modelMappings = [
    { tags: ['amenity=bicycle_parking'], model: 'w_amenity_bicycle_parking.glb', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Bicycle parking model for amenity=bicycle_parking
    { tags: ['highway=street_lamp', 'lamp_mount=straight_mast'], model: 'w_highway_street_lamp_straight_mast.glb', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
    { tags: ['highway=street_lamp'], model: 'w_highway_street_lamp.glb', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Street lamp model for highway=street_lamp
    { tags: ['highway=traffic_signals'], model: 'w_highway_traffic_signals.glb', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Traffic signals model for highway=traffic_signals
    { tags: ['natural=tree'], model: 'w_natural_tree.glb', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Tree model for natural=tree
    { tags: ['natural=wood'], model: 'test.gltf', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Could use forest model
    { tags: ['wikidata=Q575953'], model: 'ES_CAT_BCN_casa_batllo.glb', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Casa Batlló
    { tags: ['wikidata=Q207870'], model: 'ES_CAT_BCN_casa_mila.glb', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Casa Mila
    { tags: ['wikidata=Q1425790'], model: 'ES_CAT_BCN_hotel_arts.glb', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Hotel Arts Barcelona model
    { tags: ['wikidata=Q336246'], model: 'ES_CAT_BCN_torre_glories.glb', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Glories model
    { tags: ['wikidata=Q2689231'], model: 'ES_CAT_BCN_torre_mapfre.glb', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Mapfre tower
    { tags: ['wikidata=Q48435'], model: 'ES_CAT_BCN_sagrada_familia.glb', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Sagrada Familia Barcelona
    { tags: ['name=La Pedrera'], model: 'ES_CAT_BCN_casa_mila.glb', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Casa Milà by name
    { tags: ['name=Casa Batlló'], model: 'ES_CAT_BCN_casa_batllo.glb', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Casa Batlló by name
    { tags: ['name=Torre Mapfre'], model: 'ES_CAT_BCN_torre_mapfre.glb', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Torre Mapfre by name
    // Example mapping with two tags: requires both natural=tree and leaf_type=broadleaved
    
    // Add more mappings as needed
];

/**
 * Get the model mapping for a given set of OSM tags
 * @param {object} tags - Object with OSM key-value pairs
 * @returns {object|null} Mapping object {tags, model, config} or null if no mapping exists
 */
function getModelForTags(tags) {
    for (const mapping of modelMappings) {
        const allMatch = mapping.tags.every(tag => {
            const [key, value] = tag.split('=');
            return tags[key] === value;
        });
        if (allMatch) {
            console.log(`🔍 Found matching model ${mapping.model} for tags:`, mapping.tags);
            return mapping;
        }
    }
    console.log(`🔍 No model mapping found for tags:`, tags);
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
    modelExists
};

// Debug: Confirm models.js is loaded
console.log('🎯 models.js loaded successfully. Available models:', availableModels);
console.log('🎯 Model mappings:', modelMappings);
