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
    area: {
        gridSpacing: 5, // meters between models in grid (reduced for visibility)
        maxModels: 5 // maximum number of repeated models per area (reduced for testing)
    }
};

/**
 * Generate repeated model positions along a line
 * @param {Array<Array<number>>} coordinates - Array of [lon, lat] coordinates
 * @param {Object} modelConfig - Original model configuration
 * @returns {Array<Object>} Array of {position: [lon, lat], config: Object}
 */
function generateLineRepetitions(coordinates, modelConfig) {
    if (!window.lineRepetition || !window.lineRepetition.generateLineRepetitions) {
        console.error('Cannot generate line repetitions: line_repetition.js is not loaded');
        return [];
    }

    return window.lineRepetition.generateLineRepetitions(coordinates, {}).map(repetition => ({
        ...repetition,
        config: { ...(modelConfig || {}) }
    }));
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

    if (geometryType === 'line') {
        applyLineRepetitions(
            feature, feature.getProperties(), modelFilename, modelConfig, geometryType
        );
        return;
    }

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
            repetitionFeature.set(window.OSM3D_MODEL_PROPERTY || 'osm3dModel', repModelOptions);

            // Set additional model configuration
            // NOTE: no baked +10m lift — with the MapTerhorn DEM ground, an
            // offset lifts models into the air. Ground contact needs 0.
            if (rep.config) {
                repetitionFeature.set('modelHeightOffset', rep.config.heightOffset || 0);
                repetitionFeature.set('modelRotation', rep.config.rotation || [0, 0, 0]);
            } else {
                repetitionFeature.set('modelHeightOffset', 0);
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

/**
 * Place the model of a LINE mapping along its way.
 *
 * models.js decides WHICH model a way gets (railway=rail ->
 * w_railway_rail.glb, and so on). This function decides HOW that model is put
 * along the way, and it is the single answer to that question for every caller.
 *
 * Every line mapping uses the same tag-configurable placement module.
 *
 * @param {ol.Feature} feature         the way
 * @param {Object} tags                its OSM tags
 * @param {string} modelFilename       model chosen by models.js
 * @param {Object} modelConfig         its config (scale, heightOffset, rotation)
 * @param {string} [fallbackGeometry]  mapping geometry, for the generic fallback
 */
function applyLineRepetitions(feature, tags, modelFilename, modelConfig) {
    if (!window.lineRepetition || !window.lineRepetition.applyLineRepetitions) {
        console.error('Cannot apply line repetitions: line_repetition.js is not loaded');
        return;
    }
    return window.lineRepetition.applyLineRepetitions(feature, modelFilename, modelConfig, tags);
}

// Export functions for use in other modules
window.modelRepetition = {
    applyModelRepetitions,
    applyLineRepetitions,
    generateLineRepetitions,
    generateAreaRepetitions,
    repetitionConfig
};
