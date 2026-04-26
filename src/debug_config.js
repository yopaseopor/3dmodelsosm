/**
 * Centralized Debug Configuration
 * Provides unified debug control across all modules
 */

// Global debug configuration - can be enabled via URL parameter ?debug=true
const globalDebugConfig = {
    enabled: false,
    
    // Module-specific debug flags
    modelRenderer: {
        enabled: false,
        logModelLoading: false,
        logRepetitionModels: false,
        logTextureProcessing: false,
        logGeometryOperations: false
    },

    /** Verbose logs for cesium_models.js (area entities, texture steps) */
    cesiumModels: {
        verbose: true
    },
    
    valueSearch: {
        enabled: false,
        logFeatureProcessing: false,
        logGeometryDetection: false,
        logModelAssignment: false,
        logAreaProcessing: false,
        logCoordinateProcessing: false
    },
    
    keySearch: {
        enabled: false,
        logKeySearch: false,
        logSelection: false,
        logExecution: false,
        logUI: false
    },
    
    overlayIntegration: {
        enabled: false,
        logOverlayLoading: false,
        logFeatureProcessing: false,
        logModelAssignment: false,
        logGeometryDetection: false,
        logAreaProcessing: false
    }
};

// Check URL parameters for debug mode
function initializeDebugMode() {
    if (typeof window !== 'undefined' && window.location) {
        const urlParams = new URLSearchParams(window.location.search);
        const debugEnabled = urlParams.get('debug') === 'true';
        
        // Enable all debug flags when debug=true
        if (debugEnabled) {
            globalDebugConfig.enabled = true;
            Object.keys(globalDebugConfig).forEach(key => {
                if (typeof globalDebugConfig[key] === 'object' && globalDebugConfig[key] !== null) {
                    globalDebugConfig[key].enabled = true;
                }
            });
        }
        
        // Allow module-specific debug flags via URL parameters
        // Example: ?debug=modelRenderer,valueSearch
        const debugModules = urlParams.get('debug');
        if (debugModules && debugModules.includes(',')) {
            const modules = debugModules.split(',');
            modules.forEach(module => {
                if (globalDebugConfig[module.trim()]) {
                    globalDebugConfig[module.trim()].enabled = true;
                    globalDebugConfig.enabled = true;
                }
            });
        }
    }
}

// Initialize debug mode immediately
initializeDebugMode();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = globalDebugConfig;
} else if (typeof window !== 'undefined') {
    window.globalDebugConfig = globalDebugConfig;
}
