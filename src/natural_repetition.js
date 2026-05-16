/**
 * Natural Repetition Module
 * Handles repeating 3D models along natural line features
 * Provides configurable repetition options for different natural tags
 */

// Debug configuration
const naturalRepetitionDebugConfig = {
    enabled: true,
    logProcessing: true,
    logStorage: true
};

// Configuration for natural repetition - can be customized per natural type
const naturalRepetitionConfig = {
    // Default configuration for all natural types
    default: {
        interval: 0.50, // meters between models
        sideOffset: 0, // meters to side (directly on the natural feature line)
        maxModels: 100 // Prevent excessive memory usage
    },
    
    // Specific configurations per natural type (can be customized)
    beach: {
        interval: 0.40, // meters between models for beach lines
        sideOffset: 0, // directly on the beach line
        maxModels: 1500 // More models for beach features
    },
    
    water: {
        interval: 0.30, // meters between models for water lines
        sideOffset: 0, // directly on the water line
        maxModels: 200 // More models for water features
    },
    
    river: {
        interval: 0.25, // meters between models for river lines
        sideOffset: 0, // directly on the river line
        maxModels: 300 // More models for longer river features
    },
    
    stream: {
        interval: 0.20, // meters between models for stream lines
        sideOffset: 0, // directly on the stream line
        maxModels: 150 // Moderate models for stream features
    },
    
    canal: {
        interval: 0.35, // meters between models for canal lines
        sideOffset: 0, // directly on the canal line
        maxModels: 2000 // More models for canal features
    },
    
    coastline: {
        interval: 0.45, // meters between models for coastline lines
        sideOffset: 0, // directly on the coastline line
        maxModels: 1250 // More models for coastline features
    },
    
    cliff: {
        interval: 0.60, // meters between models for cliff lines
        sideOffset: 0, // directly on the cliff line
        maxModels: 100 // Fewer models for cliff features
    }
};

/**
 * Get configuration for a specific natural type
 * @param {string} naturalType - The natural tag value (e.g., 'beach', 'water')
 * @returns {Object} Configuration object for that natural type
 */
function getNaturalConfig(naturalType) {
    return naturalRepetitionConfig[naturalType] || naturalRepetitionConfig.default;
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
 * Calculate bearing of a line segment
 * @param {Array<number>} start - [lon, lat] start point
 * @param {Array<number>} end - [lon, lat] end point
 * @returns {number} Bearing in radians
 */
function calculateSegmentBearing(start, end) {
    const dLon = (end[0] - start[0]) * Math.PI / 180;
    const lat1 = start[1] * Math.PI / 180;
    const lat2 = end[1] * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    const bearing = Math.atan2(y, x);
    return (bearing + 2 * Math.PI) % (2 * Math.PI);
}

/**
 * Generate repeated model positions along a line for natural features
 * @param {Array<Array<number>>} coordinates - Array of [lon, lat] coordinates
 * @param {string} naturalType - Type of natural feature (e.g., 'beach', 'water')
 * @returns {Array<Object>} Array of {position: [lon, lat], bearing: number, config: Object}
 */
function generateNaturalRepetitions(coordinates, naturalType) {
    const config = getNaturalConfig(naturalType);
    const repetitions = [];
    
    let cumulativeDistance = 0;
    let modelCount = 0;

    for (let i = 0; i < coordinates.length - 1 && modelCount < config.maxModels; i++) {
        const segmentStart = coordinates[i];
        const segmentEnd = coordinates[i + 1];
        const segmentLength = calculateDistance(segmentStart, segmentEnd);
        const segmentBearing = calculateSegmentBearing(segmentStart, segmentEnd);

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
                bearing: segmentBearing, // Include bearing for proper model orientation
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
 * Apply natural repetitions to a feature
 * @param {ol.Feature} feature - Original natural feature
 * @param {string} modelFilename - Model filename to use
 * @param {Object} modelConfig - Model configuration
 * @param {string} naturalType - Type of natural feature (e.g., 'beach', 'water')
 */
function applyNaturalRepetitions(feature, modelFilename, modelConfig, naturalType) {
    if (naturalRepetitionDebugConfig.enabled && naturalRepetitionDebugConfig.logProcessing) console.log(`🌿 applyNaturalRepetitions called for naturalType: ${naturalType}, model: ${modelFilename}`);
    
    const geometry = feature.getGeometry();
    if (!geometry || geometry.getType() !== 'LineString') {
        if (naturalRepetitionDebugConfig.enabled) console.log('🌿 Geometry not a LineString, skipping');
        return;
    }

    const coordinates = geometry.getCoordinates().map(coord =>
        ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326')
    );
    if (naturalRepetitionDebugConfig.enabled && naturalRepetitionDebugConfig.logProcessing) console.log(`🌿 Processing natural ${naturalType} with ${coordinates.length} coordinates`);

    const repetitions = generateNaturalRepetitions(coordinates, naturalType);

    // Store repetition data on original feature
    if (repetitions.length > 0) {
        if (naturalRepetitionDebugConfig.enabled && naturalRepetitionDebugConfig.logStorage) console.log(`🌿 Storing ${repetitions.length} natural repetition configurations on original feature`);

        repetitions.forEach((rep, index) => {
            const repetitionKey = `repetition_${index}`;
            const repModelOptions = {
                uri: `/3dmodelsosm/src/models/${modelFilename}`,
                scale: modelConfig ? modelConfig.scale || 1.0 : 1.0, // Use scale from modelConfig
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                position: rep.position
            };
            
            feature.set(repetitionKey, repModelOptions);
            feature.set(`${repetitionKey}_position`, rep.position);
            feature.set(`${repetitionKey}_heightOffset`, modelConfig ? modelConfig.heightOffset || 0 : 0); // Use heightOffset from modelConfig
            
            // Calculate rotation: combine base rotation from modelConfig with bearing-based rotation
            const baseRotation = modelConfig ? modelConfig.rotation || [0, 0, 0] : [0, 0, 0];
            const bearingRotation = rep.bearing !== undefined ? -rep.bearing : 0; // Negative for correct orientation
            
            // Apply bearing to Y-axis (heading) while preserving other rotations
            const adjustedRotation = [
                baseRotation[0], // X-axis rotation (pitch)
                bearingRotation,  // Y-axis rotation (heading) - aligned with feature direction
                baseRotation[2]  // Z-axis rotation (roll)
            ];
            
            feature.set(`${repetitionKey}_rotation`, adjustedRotation);

            if (naturalRepetitionDebugConfig.enabled && naturalRepetitionDebugConfig.logStorage && index < 5) {
                console.log(`🌿 Stored natural repetition ${index + 1} with bearing: ${(rep.bearing * 180 / Math.PI).toFixed(1)}°, rotation: [${adjustedRotation.map(r => (r * 180 / Math.PI).toFixed(1) + '°').join(', ')}]`);
            }
        });

        if (naturalRepetitionDebugConfig.enabled) console.log(`🌿 Successfully stored ${repetitions.length} natural repetition configurations`);
    } else {
        if (naturalRepetitionDebugConfig.enabled) console.log(`🌿 No natural repetitions to store`);
    }
}

// Export functions for use in other modules
window.naturalRepetition = {
    applyNaturalRepetitions,
    generateNaturalRepetitions,
    getNaturalConfig,
    naturalRepetitionConfig
};

// Debug: Confirm natural_repetition.js is loaded
console.log('🌿 natural_repetition.js loaded successfully');
