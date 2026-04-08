// Area Repetition - Handles filling areas with repeated 3D models
// Similar to line repetitions but fills polygon areas with model instances

/**
 * Area repetition configuration module
 * Defines how different area types should be filled with models
 */

// Debug configuration
const areaRepetitionDebugConfig = {
    enabled: false,
    logConfigMatching: false,
    logGeneration: false,
    logCoordinates: false
};

// Area repetition configurations
const areaRepetitionConfigs = [
    // Building areas
    /*{
        tags: ['building=residential'],
        model: 'w_highway_residential.glb',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 0.000015, // Very dense for buildings
        maxModels: 5000,
        description: 'Residential building areas'
    },
    {
        tags: ['building'],
        model: 'w_highway_residential.glb',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 0.000015, // Very dense for buildings
        maxModels: 5000,
        description: 'Generic building areas'
    },

    // Highway areas
    {
        tags: ['highway=footway'],
        model: 'w_highway_footway.glb',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 1.0, // 1 meter spacing for footways
        maxModels: 5000,
        description: 'Footway areas'
    },
   
    {
        tags: ['highway=residential'],
        model: 'w_highway_residential.glb',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 1.0, // 5 meter spacing for residential streets
        maxModels: 10000,
        description: 'Residential street areas'
    },*/
    {
        tags: ['area:highway=footway', 'footway=crossing'],
        model: 'i_crossing.png',
        config: { scale: 10.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 1.0, // 1 meter spacing for area-tagged footways
        maxModels: 5000,
        description: 'Area-tagged footway areas with crossing'
    },
    {
        tags: ['area:highway=footway'],
        model: 'i_panot.jpg',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 1.0, // 1 meter spacing for area-tagged footways
        maxModels: 5000,
        description: 'Area-tagged footway areas'
    },

    // Amenity areas
    {
        tags: ['amenity=parking'],
        model: 'i_parking.png',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 1, // 3 meter spacing for parking
        maxModels: 3000,
        description: 'Parking areas'
    },
       {
        tags: ['area:highway=residential'],
        model: 'i_asfalt.jpg',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 1.0, // 5 meter spacing for area-tagged residential streets
        maxModels: 10000,
        description: 'Area-tagged residential street areas'
    },

    // Amenity areas
    {
        tags: ['leisure=garden'],
        model: 'i_gespa.jpg',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 1, // 2 meter spacing for gardens
        maxModels: 10000,
        description: 'Garden'
    },

    // Amenity areas
    {
        tags: ['waterway=stream'],
        model: 'i_aigua.jpg',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 1, // 2 meter spacing for playgrounds
        maxModels: 10000,
        description: 'Stream'
    },

    // Amenity areas
    {
        tags: ['leisure=playground'],
        model: 'i_terra_verd.jpg',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 1, // 2 meter spacing for playgrounds
        maxModels: 10000,
        description: 'Playground'
    },

    // Default fallback
    {
        tags: ['*'], // Match any area
        model: 'i_gespa.jpg',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 5.0, // 5 meter spacing default
        maxModels: 1,
        description: 'Default area filling'
    }
];

/**
 * Get area repetition configuration for given tags
 * @param {object} tags - OSM tags object
 * @returns {object|null} Configuration object or null if no match
 */
function getAreaRepetitionConfig(tags) {
    if (areaRepetitionDebugConfig.enabled && areaRepetitionDebugConfig.logConfigMatching) console.log(`🏞️ Checking area repetition configs for tags:`, tags);

    for (const config of areaRepetitionConfigs) {
        // Skip wildcard/default config for now
        if (config.tags[0] === '*') {
            continue;
        }

        // Check if all required tags match
        const allMatch = config.tags.every(tag => {
            const [key, value] = tag.split('=');
            // Handle compound keys like 'area:highway' - these are single tags, not combinations
            const tagValue = tags[key];
            const matches = tagValue === value;
            if (areaRepetitionDebugConfig.enabled && areaRepetitionDebugConfig.logConfigMatching) console.log(`🏞️ Checking area config tag ${key}=${value}, found: ${tagValue}, matches: ${matches}`);
            return matches;
        });

        if (allMatch) {
            if (areaRepetitionDebugConfig.enabled) console.log(`🏞️ Found matching area repetition config:`, config.description);
            return config;
        }
    }

    if (areaRepetitionDebugConfig.enabled) console.log(`🏞️ No specific area repetition config found, will use default`);
    return null;
}

/**
 * Convert meters to degrees at a given latitude
 * @param {number} meters - Distance in meters
 * @param {number} latitude - Latitude in degrees
 * @returns {Array<number>} [lonDegrees, latDegrees]
 */
function metersToDegrees(meters, latitude) {
    const latDegrees = meters / 111320; // 1 degree latitude ≈ 111.32 km
    const lonDegrees = meters / (111320 * Math.cos(latitude * Math.PI / 180)); // Adjust for longitude
    return [lonDegrees, latDegrees];
}

/**
 * Generate area repetitions for filling a polygon with models
 * @param {Array<Array<number>>} coordinates - Array of [lon, lat] coordinates forming the polygon
 * @param {object} tags - OSM tags object
 * @returns {Array<Object>} Array of repetition objects with position OR single polygon object for textures
 */
function generateAreaRepetitions(coordinates, tags, holes = []) {
    if (areaRepetitionDebugConfig.enabled && areaRepetitionDebugConfig.logGeneration) console.log(`🏞️ generateAreaRepetitions called with coordinates: ${coordinates.length}, tags:`, tags);

    if (!coordinates || coordinates.length < 3) {
        if (areaRepetitionDebugConfig.enabled) console.log('🏞️ Not enough coordinates for area repetition');
        return [];
    }

    // Get configuration for this area type
    const config = getAreaRepetitionConfig(tags) || areaRepetitionConfigs.find(c => c.tags[0] === '*');
    const modelFilename = config.model;
    const isImageFile = modelFilename && (modelFilename.toLowerCase().endsWith('.png') || modelFilename.toLowerCase().endsWith('.jpg') || modelFilename.toLowerCase().endsWith('.jpeg'));

    // For image files (textures), return single polygon object instead of grid points
    if (isImageFile) {
        if (areaRepetitionDebugConfig.enabled) console.log(`🏞️ Using single polygon texture approach for ${modelFilename}`);
        
        // Calculate texture rotation based on nearby ways
        const polygonCoords = coordinates.map(coord => 
            ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326')
        );
        const textureRotation = window.modelRenderer ? 
            window.modelRenderer.calculateTextureRotation(polygonCoords, modelFilename) : 
            0; // No rotation if modelRenderer not available
        
        if (areaRepetitionDebugConfig.enabled && areaRepetitionDebugConfig.logGeneration) {
            console.log(`🏞️ Texture rotation: ${(textureRotation * 180 / Math.PI).toFixed(1)}° ${modelFilename}`);
        }
        
        return [{
            type: 'polygon_texture',
            polygonCoordinates: coordinates,
            polygonHoles: holes,
            model: modelFilename,
            spacing: config.spacing,
            rotation: textureRotation
        }];
    }

    // For 3D models, use the original grid-based approach
    const spacingMeters = config.spacing;
    const maxModels = config.maxModels;

    if (areaRepetitionDebugConfig.enabled && areaRepetitionDebugConfig.logGeneration) console.log(`🏞️ Using grid-based model approach: spacing=${spacingMeters}m, maxModels=${maxModels}, model=${modelFilename}`);

    // Calculate bounding box
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    coordinates.forEach(coord => {
        minLon = Math.min(minLon, coord[0]);
        maxLon = Math.max(maxLon, coord[0]);
        minLat = Math.min(minLat, coord[1]);
        maxLat = Math.max(maxLat, coord[1]);
    });

    if (areaRepetitionDebugConfig.enabled && areaRepetitionDebugConfig.logGeneration) {
        console.log(`🏞️ BBox lon [${minLon.toFixed(6)}, ${maxLon.toFixed(6)}] lat [${minLat.toFixed(6)}, ${maxLat.toFixed(6)}]`);
    }

    // Calculate center latitude for conversion
    const centerLat = (minLat + maxLat) / 2;
    const [spacingLonDeg, spacingLatDeg] = metersToDegrees(spacingMeters, centerLat);

    if (areaRepetitionDebugConfig.enabled && areaRepetitionDebugConfig.logCoordinates) console.log(`🏞️ Center latitude: ${centerLat.toFixed(6)}, spacing: ${spacingLonDeg.toFixed(8)} lon deg, ${spacingLatDeg.toFixed(8)} lat deg`);

    // Generate grid points within bounding box
    const repetitions = [];
    let modelCount = 0;

    for (let lon = minLon; lon <= maxLon && modelCount < maxModels; lon += spacingLonDeg) {
        for (let lat = minLat; lat <= maxLat && modelCount < maxModels; lat += spacingLatDeg) {
            // Check if point is inside polygon
            const isInsideOuter = isPointInPolygon([lon, lat], coordinates);
            const isInsideHole = holes.some(hole => isPointInPolygon([lon, lat], hole));
            if (isInsideOuter && !isInsideHole) {
                repetitions.push({
                    type: 'model_instance',
                    position: [lon, lat, 0], // lon, lat, height
                    model: modelFilename
                });
                modelCount++;
            }
        }
    }

    if (areaRepetitionDebugConfig.enabled && areaRepetitionDebugConfig.logGeneration) {
        console.log(`🏞️ Generated ${repetitions.length} repetitions (${modelCount} checked)`);
    }
    return repetitions;
}

/**
 * Check if a point is inside a polygon using ray casting algorithm
 * @param {Array<number>} point - [lon, lat] point to test
 * @param {Array<Array<number>>} polygon - Array of [lon, lat] polygon vertices
 * @returns {boolean} True if point is inside polygon
 */
function isPointInPolygon(point, polygon) {
    const x = point[0], y = point[1];
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i][0], yi = polygon[i][1];
        const xj = polygon[j][0], yj = polygon[j][1];

        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }

    return inside;
}

/**
 * Apply area repetitions to a feature
 * @param {ol.Feature} feature - Original area feature
 * @param {string} modelFilename - Model filename to use
 * @param {Object} modelConfig - Model configuration
 * @param {object} tags - OSM tags object
 */
function applyAreaRepetitions(feature, modelFilename, modelConfig, tags) {
    if (areaRepetitionDebugConfig.enabled) console.log(`🏞️ applyAreaRepetitions called for tags:`, tags, `model: ${modelFilename}`);

    try {
        const geometry = feature.getGeometry();
        let geometryType = geometry.getType();
        let polygons = [];

        if (geometryType === 'Polygon') {
            // Keep the full polygon rings: first is outer, remaining are holes
            polygons = [geometry.getCoordinates()];
        } else if (geometryType === 'MultiPolygon') {
            // Keep all rings for each polygon in the multipolygon
            polygons = geometry.getCoordinates();
        } else if (geometryType === 'LineString') {
            // Check if it's a closed LineString (represents an area)
            const lineCoords = geometry.getCoordinates();
            if (lineCoords.length >= 3 && 
                lineCoords[0][0] === lineCoords[lineCoords.length - 1][0] && 
                lineCoords[0][1] === lineCoords[lineCoords.length - 1][1]) {
                polygons = [[lineCoords.slice(0, -1)]]; // Single polygon with only outer ring
                geometryType = 'Polygon'; // Treat as polygon for processing
            } else {
                if (areaRepetitionDebugConfig.enabled) console.log('🏞️ LineString not closed, skipping area repetition');
                return;
            }
        } else {
            if (areaRepetitionDebugConfig.enabled) console.log(`🏞️ Geometry type ${geometryType} not supported for area repetition`);
            return;
        }

        if (areaRepetitionDebugConfig.enabled && areaRepetitionDebugConfig.logGeneration) console.log(`🏞️ Processing ${geometryType} with ${polygons.length} polygon(s)`);

        let allRepetitions = [];
        polygons.forEach((polygonRings, polyIndex) => {
            if (!Array.isArray(polygonRings) || polygonRings.length === 0) {
                return;
            }

            const outerRing4326 = polygonRings[0].map(coord =>
                ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326')
            );
            const holes4326 = polygonRings.slice(1).map(holeRing =>
                holeRing.map(coord =>
                    ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326')
                )
            );

            if (areaRepetitionDebugConfig.enabled && areaRepetitionDebugConfig.logCoordinates) {
                console.log(`🏞️ Polygon ${polyIndex + 1}: ring ${outerRing4326.length} pts, ${holes4326.length} hole(s)`);
            }

            const repetitions = generateAreaRepetitions(outerRing4326, tags, holes4326);
            allRepetitions = allRepetitions.concat(repetitions);
        });

        // Store repetition data on original feature
        if (allRepetitions.length > 0) {
            if (areaRepetitionDebugConfig.enabled) console.log(`🏞️ Storing ${allRepetitions.length} area repetition configurations on original feature`);

            allRepetitions.forEach((rep, index) => {
                const repetitionKey = `repetition_${index}`;

                if (rep.type === 'polygon_texture') {
                    // Store polygon texture data with rotation
                    const repModelOptions = {
                        uri: `/3dmodelsosm/src/models/${rep.model}`,
                        scale: 1.0,
                        type: 'polygon_texture',
                        polygonCoordinates: rep.polygonCoordinates,
                        spacing: rep.spacing,
                        rotation: rep.rotation || 0
                    };

                    feature.set(repetitionKey, repModelOptions);
                    feature.set(`${repetitionKey}_type`, 'polygon_texture');
                    feature.set(`${repetitionKey}_polygonCoordinates`, rep.polygonCoordinates);
                    feature.set(`${repetitionKey}_polygonHoles`, rep.polygonHoles || []);
                    feature.set(`${repetitionKey}_spacing`, rep.spacing);
                    feature.set(`${repetitionKey}_rotation`, rep.rotation || 0);

                    if (areaRepetitionDebugConfig.enabled) console.log(`🏞️ Stored polygon texture repetition ${index + 1} for model: ${rep.model} with rotation: ${((rep.rotation || 0) * 180 / Math.PI).toFixed(1)}°`);
                } else {
                    // Original model instance approach
                    const repModelOptions = {
                        uri: `/3dmodelsosm/src/models/${rep.model}`, // Use model from repetition config
                        scale: 1.0, // Normal scale for visibility
                        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                        position: rep.position
                    };

                    feature.set(repetitionKey, repModelOptions);
                    feature.set(`${repetitionKey}_position`, rep.position);
                    feature.set(`${repetitionKey}_heightOffset`, 0); // ON THE GROUND
                    feature.set(`${repetitionKey}_rotation`, [0, 0, 0]);

                    if (areaRepetitionDebugConfig.enabled) console.log(`🏞️ Stored model instance repetition ${index + 1} configuration at [${rep.position[0].toFixed(6)}, ${rep.position[1].toFixed(6)}] with model: ${rep.model}`);
                }
            });

            if (areaRepetitionDebugConfig.enabled) console.log(`🏞️ Successfully stored ${allRepetitions.length} area repetition configurations`);
        } else {
            if (areaRepetitionDebugConfig.enabled) console.log(`🏞️ No area repetitions to store`);
        }
    } catch (error) {
        console.error(`🏞️ Error in applyAreaRepetitions:`, error);
        throw error; // Re-throw to let caller handle it
    }
}

// Export functions for global access
window.areaRepetition = {
    applyAreaRepetitions: applyAreaRepetitions,
    generateAreaRepetitions: generateAreaRepetitions,
    isPointInPolygon: isPointInPolygon
};

