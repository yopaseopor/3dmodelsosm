/**
 * Highway Repetition Module
 * Handles repeating 3D models along all highway types
 * Provides configurable repetition options for different highway tags
 */

// Debug configuration
const highwayRepetitionDebugConfig = {
    enabled: false,
    logProcessing: false,
    logStorage: false
};

// Configuration for highway repetition - can be customized per highway type
const highwayRepetitionConfig = {
    // Default configuration for all highway types
    default: {
        interval: 0.30, // meters between models (very dense but not overlapping)
        sideOffset: 0, // meters to side (tight alignment alongside highway)
        maxModels: 100 // Reduced from 1500 to prevent excessive memory usage
    },
    
    // Specific configurations per highway type (can be customized)
    residential: {
        interval: 0.30, // meters between models for residential roads
        sideOffset: 0, // directly on the road line
        maxModels: 100 // Reduced from 1500
    },
    
    footway: {
        interval: 0.30, // meters between models for footways
        sideOffset: 0, // directly on the footway line
        maxModels: 100 // Reduced from 1500
    },
    
    service: {
        interval: 0.50, // meters between models for service roads
        sideOffset: 0, // directly on the service road line
        maxModels: 80 // Reduced from 1000
    },
    
    primary: {
        interval: 0.20, // meters between models for primary roads
        sideOffset: 0, // directly on the primary road line
        maxModels: 150 // Reduced from 2000
    },
    
    secondary: {
        interval: 0.25, // meters between models for secondary roads
        sideOffset: 0, // directly on the secondary road line
        maxModels: 120 // Reduced from 1800
    },
    
    tertiary: {
        interval: 0.25, // meters between models for tertiary roads
        sideOffset: 0, // directly on the tertiary road line
        maxModels: 120 // Reduced from 1800
    },
    
    track: {
        interval: 0.40, // meters between models for tracks
        sideOffset: 0, // directly on the track line
        maxModels: 800 // Reduced from 800
    },
    
    path: {
        interval: 0.35, // meters between models for paths
        sideOffset: 0, // directly on the path line
        maxModels: 80 // Reduced from 1200
    },
    
    cycleway: {
        interval: 0.25, // meters between models for cycleways
        sideOffset: 0, // directly on the cycleway line
        maxModels: 100 // Reduced from 1500
    },
    
    pedestrian: {
        interval: 0.20, // meters between models for pedestrian areas
        sideOffset: 0, // directly on the pedestrian line
        maxModels: 150 // Reduced from 2000
    }
};

/**
 * Get configuration for a specific highway type
 * @param {string} highwayType - The highway tag value (e.g., 'residential', 'footway')
 * @returns {Object} Configuration object for that highway type
 */
function getHighwayConfig(highwayType) {
    return highwayRepetitionConfig[highwayType] || highwayRepetitionConfig.default;
}

/**
 * Calculate distance between two coordinates in meters
 * @param {Array<number>} coord1 - [lon, lat]
 * @param {Array<number>} coord2 - [lon, lat]
 * @returns {number} Distance in meters
 */
function calculateDistance(coord1, coord2) {
    const R = 6371000; // Earth's radius in meters
    const lat1Rad = coord1[1] * Math.PI / 180;
    const lat2Rad = coord2[1] * Math.PI / 180;
    const deltaLat = (coord2[1] - coord1[1]) * Math.PI / 180;
    const deltaLon = (coord2[0] - coord1[0]) * Math.PI / 180;

    const a = Math.sin(deltaLat/2) * Math.sin(deltaLat/2) +
              Math.cos(lat1Rad) * Math.cos(lat2Rad) *
              Math.sin(deltaLon/2) * Math.sin(deltaLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
}

/**
 * Get a point at a specific distance along a line segment
 * @param {Array<number>} start - [lon, lat]
 * @param {Array<number>} end - [lon, lat]
 * @param {number} distance - Distance from start in meters
 * @returns {Array<number>} Point coordinates [lon, lat]
 */
function getPointAlongSegment(start, end, distance) {
    const totalDistance = calculateDistance(start, end);
    if (totalDistance === 0) return start;

    const ratio = distance / totalDistance;
    const lon = start[0] + (end[0] - start[0]) * ratio;
    const lat = start[1] + (end[1] - start[1]) * ratio;

    return [lon, lat];
}

/**
 * Generate repeated model positions along a line for highways
 * @param {Array<Array<number>>} coordinates - Array of [lon, lat] coordinates
 * @param {string} highwayType - Type of highway (e.g., 'residential', 'footway')
 * @returns {Array<Object>} Array of {position: [lon, lat], config: Object}
 */
function generateHighwayRepetitions(coordinates, highwayType) {
    const config = getHighwayConfig(highwayType);
    const repetitions = [];
    
    let cumulativeDistance = 0;
    let modelCount = 0;

    for (let i = 0; i < coordinates.length - 1 && modelCount < config.maxModels; i++) {
        const segmentStart = coordinates[i];
        const segmentEnd = coordinates[i + 1];
        const segmentLength = calculateDistance(segmentStart, segmentEnd);

        while (cumulativeDistance < segmentLength && modelCount < config.maxModels) {
            const pointAlongSegment = getPointAlongSegment(segmentStart, segmentEnd, cumulativeDistance);
            
            // Apply side offset if configured
            let finalPoint = pointAlongSegment;
            if (config.sideOffset !== 0) {
                const dx = segmentEnd[0] - segmentStart[0];
                const dy = segmentEnd[1] - segmentStart[1];
                const length = Math.sqrt(dx * dx + dy * dy);
                
                if (length > 0) {
                    // Perpendicular vector (rotated 90 degrees)
                    const perpX = -dy / length;
                    const perpY = dx / length;
                    
                    // Convert offset to degrees
                    const offsetLat = config.sideOffset / 111320;
                    const offsetLon = config.sideOffset / (111320 * Math.cos(pointAlongSegment[1] * Math.PI / 180));
                    
                    finalPoint = [
                        pointAlongSegment[0] + perpX * offsetLon,
                        pointAlongSegment[1] + perpY * offsetLat
                    ];
                }
            }

            repetitions.push({
                position: finalPoint,
                config: { ...config }
            });

            cumulativeDistance += config.interval;
            modelCount++;
        }

        cumulativeDistance -= segmentLength; // Carry over to next segment
    }

    return repetitions;
}

/**
 * Apply highway repetitions to a feature
 * @param {ol.Feature} feature - Original highway feature
 * @param {string} modelFilename - Model filename to use
 * @param {Object} modelConfig - Model configuration
 * @param {string} highwayType - Type of highway (e.g., 'residential', 'footway')
 */
function applyHighwayRepetitions(feature, modelFilename, modelConfig, highwayType) {
    if (highwayRepetitionDebugConfig.enabled && highwayRepetitionDebugConfig.logProcessing) console.log(`🛣️ applyHighwayRepetitions called for highwayType: ${highwayType}, model: ${modelFilename}`);
    
    const geometry = feature.getGeometry();
    if (!geometry || geometry.getType() !== 'LineString') {
        if (highwayRepetitionDebugConfig.enabled) console.log('🛣️ Geometry not a LineString, skipping');
        return;
    }

    const coordinates = geometry.getCoordinates().map(coord =>
        ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326')
    );
    if (highwayRepetitionDebugConfig.enabled && highwayRepetitionDebugConfig.logProcessing) console.log(`🛣️ Processing highway ${highwayType} with ${coordinates.length} coordinates`);

    const repetitions = generateHighwayRepetitions(coordinates, highwayType);

    // Store repetition data on original feature (like footway repetitions do)
    if (repetitions.length > 0) {
        if (highwayRepetitionDebugConfig.enabled && highwayRepetitionDebugConfig.logStorage) console.log(`🛣️ Storing ${repetitions.length} highway repetition configurations on original feature`);

        repetitions.forEach((rep, index) => {
            const repetitionKey = `repetition_${index}`;
            const repModelOptions = {
                uri: `/3dmodelsosm/src/models/${modelFilename}`,
                scale: 1.0, // Normal scale for visibility (like footway)
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                position: rep.position
            };
            
            feature.set(repetitionKey, repModelOptions);
            feature.set(`${repetitionKey}_position`, rep.position);
            feature.set(`${repetitionKey}_heightOffset`, 0); // ON THE GROUND
            feature.set(`${repetitionKey}_rotation`, [0, 0, 0]);

            if (highwayRepetitionDebugConfig.enabled && highwayRepetitionDebugConfig.logStorage && index < 5) console.log(`🛣️ Stored highway repetition ${index + 1} configuration`);
        });

        if (highwayRepetitionDebugConfig.enabled) console.log(`🛣️ Successfully stored ${repetitions.length} highway repetition configurations`);
    } else {
        if (highwayRepetitionDebugConfig.enabled) console.log(`🛣️ No highway repetitions to store`);
    }
}

// Export functions for use in other modules
window.highwayRepetition = {
    applyHighwayRepetitions,
    generateHighwayRepetitions,
    getHighwayConfig,
    highwayRepetitionConfig
};

// Debug: Confirm highway_repetition.js is loaded
console.log('🛣️ highway_repetition.js loaded successfully');
