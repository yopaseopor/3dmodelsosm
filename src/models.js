/**
 * Models management module for 3D model display on the map
 * Lists available 3D models from the /models folder and handles model loading
 */

// Available 3D models
const availableModels = [
    'Untitled.glb',
    'test.gltf',
    'test.bin',
    'tree.gltf',
    'tree.bin',
    'hotelarts.gltf',
    'hotelarts.bin'
];

// Model mapping for OSM tags
// Maps OSM key=value pairs to 3D model filenames
const modelMappings = {
    'natural=tree': 'tree.gltf',  // Tree model for natural=tree
    'natural=wood': 'test.gltf', // Could use forest model
    'wikidata=Q1425790': 'hotelarts.gltf', // Could use forest model
    // Add more mappings as needed
};

// Model configurations (optional scaling, rotation, etc.)
const modelConfigs = {
    'test.gltf': {
        scale: 1.0,
        heightOffset: 0.0,
        rotation: [0, 0, 0]
    },
    'tree.gltf': {
        scale: 1.0,
        heightOffset: 0.0,
        rotation: [0, 0, 0]
    },
    'hotelarts.gltf': {
        scale: 1.0,
        heightOffset: 0.0,
        rotation: [0, 0, 0]
    },
    'Untitled.glb': {
        scale: 1.0,
        heightOffset: 0.0,
        rotation: [0, 0, 0]
    }
};

/**
 * Get the model filename for a given OSM tag combination
 * @param {string} key - OSM key
 * @param {string} value - OSM value
 * @returns {string|null} Model filename or null if no mapping exists
 */
function getModelForTag(key, value) {
    const tagCombination = `${key}=${value}`;
    const model = modelMappings[tagCombination] || null;
    console.log(`🔍 Checking model for tag ${tagCombination}: ${model ? 'Found ' + model : 'No mapping found'}`);
    return model;
}

/**
 * Get configuration for a model
 * @param {string} modelFilename - The model filename
 * @returns {object} Model configuration object
 */
function getModelConfig(modelFilename) {
    const config = modelConfigs[modelFilename] || {
        scale: 1.0,
        heightOffset: 0.0,
        rotation: [0, 0, 0]
    };
    console.log(`🔧 Model config for ${modelFilename}:`, config);
    return config;
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
    modelConfigs,
    getModelForTag,
    getModelConfig,
    modelExists
};

// Debug: Confirm models.js is loaded
console.log('🎯 models.js loaded successfully. Available models:', availableModels);
console.log('🎯 Model mappings:', modelMappings);
