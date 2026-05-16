/**
 * Fence Repetition Module
 * Handles repeating fence models along ways to close fields and boundaries
 * Provides configurable repetition options for different fence types
 */

// Debug configuration
const fenceRepetitionDebugConfig = {
    enabled: false,
    logProcessing: false,
    logStorage: false
};

// Configuration for fence repetition - can be customized per fence type
const fenceRepetitionConfig = {
    // Default configuration for all fence types
    default: {
        interval: 0.2, // meters between fence posts (20cm - realistic fence spacing)
        sideOffset: 0, // meters to side (directly on the fence line)
        maxModels: 5000, // Maximum fence posts per way
        postHeight: 1.0, // Default post height in meters
        postWidth: 0.1, // Default post width in meters
        heightOffset: 0.0, // Height offset from ground - ground level
        closedLoop: true // Whether to connect ends for closed ways
    },
    
    // Specific configurations per fence type
    wood: {
        interval: 0.15, // meters between wooden fence posts (15cm - close spacing for wooden fences)
        sideOffset: 0,
        maxModels: 5000,
        postHeight: 1.0,
        postWidth: 0.15,
        heightOffset: 0.0, // Ground level for wooden fence posts
        closedLoop: true,
        description: 'Wooden fence posts'
    },
    
    metal: {
        interval: 0.25, // meters between metal fence posts (25cm - standard metal fence spacing)
        sideOffset: 0,
        maxModels: 800,
        postHeight: 1.8,
        postWidth: 0.08,
        closedLoop: true,
        description: 'Metal fence posts'
    },
    
    chain_link: {
        interval: 0.3, // meters between chain link fence posts (30cm - chain link spacing)
        sideOffset: 0,
        maxModels: 300,
        postHeight: 2.0,
        postWidth: 0.05,
        closedLoop: true,
        description: 'Chain link fence posts'
    },
    
    pole: {
        interval: 0.5, // meters between pole fence posts (50cm - wider spacing for pole fences)
        sideOffset: 0,
        maxModels: 400,
        postHeight: 2.2,
        postWidth: 0.12,
        closedLoop: true,
        description: 'Pole fence posts'
    },
    
    wire: {
        interval: 5.0, // meters between wire fence posts
        sideOffset: 0,
        maxModels: 200,
        postHeight: 1.2,
        postWidth: 0.03,
        closedLoop: true,
        description: 'Wire fence posts'
    }
};

/**
 * Get configuration for a specific fence type
 * @param {string} fenceType - The fence type value (e.g., 'wood', 'metal', 'pole')
 * @returns {Object} Configuration object for that fence type
 */
function getFenceConfig(fenceType) {
    return fenceRepetitionConfig[fenceType] || fenceRepetitionConfig.default;
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
 * Check if a way forms a closed loop (first and last points are very close)
 * @param {Array<Array<number>>} coordinates - Array of [lon, lat] coordinates
 * @returns {boolean} True if the way is closed
 */
function isClosedWay(coordinates) {
    if (coordinates.length < 3) return false;
    
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    const distance = calculateDistance(first, last);
    
    // Consider closed if distance between first and last is less than 1 meter
    return distance < 1.0;
}

/**
 * Generate repeated fence post positions along a line
 * @param {Array<Array<number>>} coordinates - Array of [lon, lat] coordinates
 * @param {string} fenceType - Type of fence (e.g., 'wood', 'metal', 'pole')
 * @returns {Array<Object>} Array of {position: [lon, lat], bearing: number, config: Object}
 */
function generateFenceRepetitions(coordinates, fenceType) {
    const config = getFenceConfig(fenceType);
    const repetitions = [];
    
    let cumulativeDistance = 0;
    let modelCount = 0;
    const isClosed = isClosedWay(coordinates);
    
    // For closed ways, we need to ensure the last post connects back to the first
    const totalLength = coordinates.reduce((sum, coord, index) => {
        if (index === 0) return 0;
        return sum + calculateDistance(coordinates[index - 1], coord);
    }, 0);

    // Add the closing segment if it's a closed way
    const effectiveCoordinates = isClosed && config.closedLoop ? 
        [...coordinates, coordinates[0]] : coordinates;

    for (let i = 0; i < effectiveCoordinates.length - 1 && modelCount < config.maxModels; i++) {
            const segmentStart = effectiveCoordinates[i];
            const segmentEnd = effectiveCoordinates[i + 1];
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
                config: { ...config },
                isClosedWay: isClosed
            });

            cumulativeDistance += config.interval;
            modelCount++;
        }

        cumulativeDistance -= segmentLength; // Carry over to next segment
    }

        return repetitions;
}

/**
 * Apply fence repetitions to a feature
 * @param {ol.Feature} feature - Original fence feature
 * @param {string} modelFilename - Model filename to use
 * @param {Object} modelConfig - Model configuration
 * @param {string} fenceType - Type of fence (e.g., 'wood', 'metal', 'pole')
 */
function applyFenceRepetitions(feature, modelFilename, modelConfig, fenceType) {
        
    const geometry = feature.getGeometry();
    if (!geometry || geometry.getType() !== 'LineString') {
        return;
    }

    const coordinates = geometry.getCoordinates().map(coord =>
        ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326')
    );

    const repetitions = generateFenceRepetitions(coordinates, fenceType);

    // Store repetition data on original feature
    if (repetitions.length > 0) {

        repetitions.forEach((rep, index) => {
            const repetitionKey = `fence_repetition_${index}`;
            const repModelOptions = {
                uri: `/3dmodelsosm/src/models/${modelFilename}`,
                scale: modelConfig ? modelConfig.scale || 1.0 : 1.0,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                position: rep.position
            };
            
            feature.set(repetitionKey, repModelOptions);
            feature.set(`${repetitionKey}_position`, rep.position);
            const fenceConfig = getFenceConfig(fenceType);
            feature.set(`${repetitionKey}_heightOffset`, fenceConfig.heightOffset);
            feature.set(`${repetitionKey}_fenceType`, fenceType);
            feature.set(`${repetitionKey}_isClosedWay`, rep.isClosedWay);
            
            // Calculate rotation: combine base rotation from modelConfig with bearing-based rotation
            const baseRotation = modelConfig ? modelConfig.rotation || [0, 0, 0] : [0, 0, 0];
            const bearingRotation = rep.bearing !== undefined ? -rep.bearing : 0; // Negative for correct orientation
            
            // Apply bearing to Y-axis (heading) while preserving other rotations
            const adjustedRotation = [
                baseRotation[0], // X-axis rotation (pitch)
                bearingRotation,  // Y-axis rotation (heading) - aligned with fence direction
                baseRotation[2]  // Z-axis rotation (roll)
            ];
            
            feature.set(`${repetitionKey}_rotation`, adjustedRotation);
        });
    } else {
    }
}

// Export functions for use in other modules
window.fenceRepetition = {
    applyFenceRepetitions,
    generateFenceRepetitions,
    getFenceConfig,
    fenceRepetitionConfig
};

// Debug: Confirm fence_repetition.js is loaded
console.log('🚜 fence_repetition.js loaded successfully');
