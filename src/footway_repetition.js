/**
 * Footway Repetition Module
 * Specific repetition logic for highway=footway models along lines
 * Places models at close intervals next to each other along footway ways
 */

// Debug configuration
const footwayRepetitionDebugConfig = {
    enabled: false,
    logProcessing: false,
    logStorage: false
};

// Configuration for footway repetition
const footwayRepetitionConfig = {
    interval: 0.30, // meters between models (very dense but not overlapping)
    sideOffset: 0, // meters to the side (tight alignment alongside footway)
    maxModels: 100 // Reduced from 1500 to prevent excessive memory usage
};

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
 * Get a point offset perpendicular to a line segment
 * @param {Array<number>} start - [lon, lat]
 * @param {Array<number>} end - [lon, lat]
 * @param {number} offset - Offset distance in meters
 * @returns {Array<number>} Offset point coordinates [lon, lat]
 */
function getPerpendicularOffset(start, end, offset) {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length === 0) return start;

    // Perpendicular vector (rotated 90 degrees)
    const perpX = -dy / length;
    const perpY = dx / length;

    // Offset in meters - approximate conversion
    const offsetLat = offset / 111320; // meters per degree latitude
    const offsetLon = offset / (111320 * Math.cos(start[1] * Math.PI / 180)); // adjust for longitude

    return [
        start[0] + perpX * offsetLon,
        start[1] + perpY * offsetLat
    ];
}

/**
 * Generate repeated model positions along a footway line
 * @param {Array<Array<number>>} coordinates - Array of [lon, lat] coordinates
 * @param {Object} modelConfig - Model configuration
 * @param {string} modelFilename - Model filename
 * @returns {Array<Object>} Array of {position: [lon, lat], config: Object}
 */
function generateFootwayRepetitions(coordinates, modelConfig, modelFilename) {
    const repetitions = [];
    const interval = footwayRepetitionConfig.interval;
    const sideOffset = footwayRepetitionConfig.sideOffset;
    const maxModels = footwayRepetitionConfig.maxModels;

    let cumulativeDistance = 0;
    let modelCount = 0;

    for (let i = 0; i < coordinates.length - 1 && modelCount < maxModels; i++) {
        const segmentStart = coordinates[i];
        const segmentEnd = coordinates[i + 1];
        const segmentLength = calculateDistance(segmentStart, segmentEnd);

        while (cumulativeDistance < segmentLength && modelCount < maxModels) {
            const pointAlongSegment = getPointAlongSegment(segmentStart, segmentEnd, cumulativeDistance);
            const offsetPoint = getPerpendicularOffset(segmentStart, segmentEnd, sideOffset);

            // Combine the point along segment with perpendicular offset
            const finalPoint = [
                pointAlongSegment[0] + (offsetPoint[0] - segmentStart[0]),
                pointAlongSegment[1] + (offsetPoint[1] - segmentStart[1])
            ];

            const rep = {
                position: finalPoint,
                modelFilename: modelFilename,
                config: modelConfig
            };

            repetitions.push(rep);

            cumulativeDistance += interval;
            modelCount++;
        }

        cumulativeDistance -= segmentLength; // Carry over to next segment
    }

    return repetitions;
}

/**
 * Apply footway repetitions to a feature
 * @param {Object} feature - OpenLayers feature
 * @param {string} modelFilename - Model filename
 * @param {Object} modelConfig - Model configuration
 * @param {Object} vectorSource - The vector source to add repetition features to
 */
function applyFootwayRepetitions(feature, modelFilename, modelConfig, vectorSource) {
    if (footwayRepetitionDebugConfig.enabled && footwayRepetitionDebugConfig.logProcessing) console.log(`🚶 applyFootwayRepetitions called for model: ${modelFilename}`);

    const geometry = feature.getGeometry();
    if (!geometry || geometry.getType() !== 'LineString') {
        if (footwayRepetitionDebugConfig.enabled) console.log('🚶 Geometry not a LineString, skipping');
        return;
    }

    const coordinates = geometry.getCoordinates().map(coord =>
        ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326')
    );
    if (footwayRepetitionDebugConfig.enabled && footwayRepetitionDebugConfig.logProcessing) console.log(`🚶 Processing footway with ${coordinates.length} coordinates`);

    const repetitions = generateFootwayRepetitions(coordinates, modelConfig, modelFilename);

    // Create additional 3D models for repetitions (don't create new features)
    if (repetitions.length > 0) {
        if (footwayRepetitionDebugConfig.enabled && footwayRepetitionDebugConfig.logProcessing) console.log(`🚶 Creating ${repetitions.length} footway repetition 3D models`);

        repetitions.forEach((rep, index) => {
            // Set model for repetition directly on the original feature
            const repModelUrl = `/3dmodelsosm/src/models/${rep.modelFilename}`;
            const repModelOptions = {
                uri: repModelUrl,
                scale: 1.0, // Normal scale for visibility
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                position: rep.position // Store the actual position
            };
            
            // Store the repetition model data on the original feature
            const repetitionKey = `repetition_${index}`;
            feature.set(repetitionKey, repModelOptions);
            feature.set(`${repetitionKey}_position`, rep.position); // Store position separately
            feature.set(`${repetitionKey}_heightOffset`, 0); // ON THE GROUND
            feature.set(`${repetitionKey}_rotation`, [0, 0, 0]);

            // Set additional model configuration for this repetition
            if (rep.config) {
                feature.set(`${repetitionKey}_heightOffset`, 0); // ON THE GROUND
                feature.set(`${repetitionKey}_rotation`, rep.config.rotation || [0, 0, 0]);
            } else {
                feature.set(`${repetitionKey}_heightOffset`, 0); // ON THE GROUND
                feature.set(`${repetitionKey}_rotation`, [0, 0, 0]);
            }

            if (footwayRepetitionDebugConfig.enabled && footwayRepetitionDebugConfig.logStorage && index < 5) console.log(`🚶 Added footway repetition 3D model ${index + 1} at position: [${rep.position[0].toFixed(6)}, ${rep.position[1].toFixed(6)}]`);
        });

        if (footwayRepetitionDebugConfig.enabled) console.log(`🚶 Successfully generated ${repetitions.length} footway repetition 3D models`);
    } else {
        if (footwayRepetitionDebugConfig.enabled) console.log(`🚶 No footway repetitions generated`);
    }
}

// Export functions for use in other modules
window.footwayRepetition = {
    applyFootwayRepetitions,
    generateFootwayRepetitions,
    footwayRepetitionConfig
};

// Debug: Confirm footway_repetition.js is loaded
console.log('🚶 footway_repetition.js loaded successfully');
