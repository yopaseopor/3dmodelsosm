/**
 * Model Repetition Module
 * Handles repeating 3D models along lines (ways) and within areas (polygons)
 * Places additional models next to the original model without affecting points or building extrusion
 */

// Debug configuration
const modelRepetitionDebugConfig = {
    enabled: false,
    logProcessing: false,
    logFeatureCreation: false
};

// Configuration for repetition
const repetitionConfig = {
    line: {
        interval: 0.20,  // meters between repetitions - further decreased for maximum kerb repetition density
        maxModels: 1500,  // Reduced from 1500 to prevent excessive memory usage
        sideOffset: 0,
        config: {
            scale: 1.0,
            heightOffset: 0,
            rotation: [0, 0, 0]
        }
    },
    area: {
        gridSpacing: 5, // meters between models in grid (reduced for visibility)
        maxModels: 5 // maximum number of repeated models per area (reduced for testing)
    }
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

    // Offset in meters - approximate conversion (rough)
    const offsetLat = offset / 111320; // meters per degree latitude
    const offsetLon = offset / (111320 * Math.cos(start[1] * Math.PI / 180)); // adjust for longitude

    return [
        start[0] + perpX * offsetLon,
        start[1] + perpY * offsetLat
    ];
}

/**
 * Generate repeated model positions along a line
 * @param {Array<Array<number>>} coordinates - Array of [lon, lat] coordinates
 * @param {Object} modelConfig - Original model configuration
 * @returns {Array<Object>} Array of {position: [lon, lat], config: Object}
 */
function generateLineRepetitions(coordinates, modelConfig) {
    const repetitions = [];
    const interval = repetitionConfig.line.interval;
    const sideOffset = repetitionConfig.line.sideOffset;
    const maxModels = repetitionConfig.line.maxModels;

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

            repetitions.push({
                position: finalPoint,
                config: { ...modelConfig }
            });

            cumulativeDistance += interval;
            modelCount++;
        }

        cumulativeDistance -= segmentLength; // Carry over to next segment
    }

    return repetitions;
}

/**
 * Generate repeated model positions within an area
 * @param {Array<Array<number>>} coordinates - Polygon coordinates [lon, lat]
 * @param {Object} modelConfig - Original model configuration
 * @returns {Array<Object>} Array of {position: [lon, lat], config: Object}
 */
function generateAreaRepetitions(coordinates, modelConfig) {
    const repetitions = [];
    const spacing = repetitionConfig.area.gridSpacing;
    const maxModels = repetitionConfig.area.maxModels;

    // Find bounding box
    let minLon = Infinity, maxLon = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;

    coordinates.forEach(ring => {
        ring.forEach(coord => {
            minLon = Math.min(minLon, coord[0]);
            maxLon = Math.max(maxLon, coord[0]);
            minLat = Math.min(minLat, coord[1]);
            maxLat = Math.max(maxLat, coord[1]);
        });
    });

    // Convert spacing to degrees (approximate)
    const spacingLat = spacing / 111320;
    const avgLat = (minLat + maxLat) / 2;
    const spacingLon = spacing / (111320 * Math.cos(avgLat * Math.PI / 180));

    let modelCount = 0;
    for (let lat = minLat; lat <= maxLat && modelCount < maxModels; lat += spacingLat) {
        for (let lon = minLon; lon <= maxLon && modelCount < maxModels; lon += spacingLon) {
            // Check if point is inside polygon (simple bounding box check for now)
            repetitions.push({
                position: [lon, lat],
                config: { ...modelConfig }
            });
            modelCount++;
        }
    }

    return repetitions;
}

/**
 * Apply model repetitions to a feature
 * @param {ol.Feature} feature - Original feature to repeat
 * @param {string} modelFilename - Model filename to use
 * @param {Object} modelConfig - Model configuration
 * @param {string} geometryType - Type of geometry ('line', 'area')
 */
function applyModelRepetitions(feature, modelFilename, modelConfig, geometryType) {
    if (modelRepetitionDebugConfig.enabled && modelRepetitionDebugConfig.logProcessing) console.log(`🔄 applyModelRepetitions called for geometryType: ${geometryType}, model: ${modelFilename}`);
    
    const geometry = feature.getGeometry();
    if (!geometry) {
        if (modelRepetitionDebugConfig.enabled) console.log('🔄 No geometry found, skipping');
        return;
    }

    let repetitions = [];

    if (geometryType === 'line' && geometry.getType() === 'LineString') {
        const coordinates = geometry.getCoordinates().map(coord =>
            ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326')
        );
        if (modelRepetitionDebugConfig.enabled && modelRepetitionDebugConfig.logProcessing) console.log(`🔄 Processing line with ${coordinates.length} coordinates`);
        repetitions = generateLineRepetitions(coordinates, modelConfig);
    } else if (geometryType === 'area' && geometry.getType() === 'Polygon') {
        const coordinates = geometry.getCoordinates()[0].map(coord =>
            ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326')
        );
        if (modelRepetitionDebugConfig.enabled && modelRepetitionDebugConfig.logProcessing) console.log(`🔄 Processing area with ${coordinates.length} coordinates`);
        repetitions = generateAreaRepetitions([coordinates], modelConfig);
    } else {
        if (modelRepetitionDebugConfig.enabled) console.log(`🔄 Geometry type ${geometry.getType()} not supported for repetitions`);
    }

    // Create additional features for repetitions
    const repetitionFeatures = [];
    if (repetitions.length > 0) {
        if (modelRepetitionDebugConfig.enabled && modelRepetitionDebugConfig.logProcessing) console.log(`🔄 Creating ${repetitions.length} repetition features`);

        repetitions.forEach((rep, index) => {
            // Create new point feature at repetition position
            const pointGeometry = new ol.geom.Point(
                ol.proj.transform(rep.position, 'EPSG:4326', window.map.getView().getProjection())
            );
            
            const repetitionFeature = new ol.Feature({
                geometry: pointGeometry,
                originalFeatureId: feature.getId() || feature.get('id'),
                isRepetition: true,
                repetitionIndex: index
            });

            // Copy relevant properties from original feature
            const propertiesToCopy = ['id', 'type', 'originalType', 'fixedGeometry', 'members', 'memberOf', 'member', 'membership', 'role', 'version', 'timestamp', 'changeset', 'user', 'uid', 'visible'];
            propertiesToCopy.forEach(prop => {
                if (feature.get(prop) !== undefined) {
                    repetitionFeature.set(prop, feature.get(prop));
                }
            });

            // Copy all OSM tags from original feature so repetition features can be matched to model mappings
            Object.entries(feature.getProperties()).forEach(([key, value]) => {
                // Skip internal properties and geometry
                if (key !== 'geometry' && !propertiesToCopy.includes(key) && !key.startsWith('_')) {
                    repetitionFeature.set(key, value);
                }
            });

            // Set model for repetition
            const repModelOptions = {
                uri: `/3dmodelsosm/src/models/${modelFilename}`,
                scale: 1.0, // Normal scale for visibility
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                position: rep.position // Store the actual position
            };
            repetitionFeature.set('model', repModelOptions);

            // Set additional model configuration
            if (rep.config) {
                repetitionFeature.set('modelHeightOffset', (rep.config.heightOffset || 0) + 10);
                repetitionFeature.set('modelRotation', rep.config.rotation || [0, 0, 0]);
            } else {
                repetitionFeature.set('modelHeightOffset', 10);
                repetitionFeature.set('modelRotation', [0, 0, 0]);
            }

            // Store repetition feature for processing
            repetitionFeatures.push(repetitionFeature);
            
            if (modelRepetitionDebugConfig.enabled && modelRepetitionDebugConfig.logFeatureCreation && index < 5) console.log(`🔄 Created repetition feature ${index + 1} at position: [${rep.position[0].toFixed(6)}, ${rep.position[1].toFixed(6)}]`);
        });

        if (modelRepetitionDebugConfig.enabled) console.log(`🔄 Successfully generated ${repetitions.length} repetition features`);
        
        // Store repetition data on the original feature (like footway repetitions do)
        repetitions.forEach((rep, index) => {
            const repetitionKey = `repetition_${index}`;
            const repModelOptions = {
                uri: `/3dmodelsosm/src/models/${modelFilename}`,
                scale: 1.0,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                position: rep.position
            };
            feature.set(repetitionKey, repModelOptions);
            
            // Store rotation data for this repetition
            feature.set(`${repetitionKey}_rotation`, rep.config ? rep.config.rotation || [0, 0, 0] : [0, 0, 0]);
        });
        
        if (modelRepetitionDebugConfig.enabled) console.log(`🔄 Stored ${repetitions.length} repetition models on original feature`);
    } else {
        if (modelRepetitionDebugConfig.enabled) console.log(`🔄 No repetitions generated for this feature`);
    }
}

// Export functions for use in other modules
window.modelRepetition = {
    applyModelRepetitions,
    generateLineRepetitions,
    generateAreaRepetitions,
    repetitionConfig
};

