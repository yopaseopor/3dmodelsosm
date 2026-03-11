// Area Repetition - Handles filling areas with repeated 3D models
// Similar to line repetitions but fills polygon areas with model instances

/**
 * Generate area repetitions for filling a polygon with models
 * @param {Array<Array<number>>} coordinates - Array of [lon, lat] coordinates forming the polygon
 * @param {string} modelType - Type of area (e.g., 'residential', 'footway')
 * @returns {Array<Object>} Array of repetition objects with position
 */
function generateAreaRepetitions(coordinates, modelType) {
    console.log(`🏞️ generateAreaRepetitions called for modelType: ${modelType}, coordinates: ${coordinates.length}`);

    if (!coordinates || coordinates.length < 3) {
        console.log('🏞️ Not enough coordinates for area repetition');
        return [];
    }

    // Calculate bounding box
    let minLon = Infinity, maxLon = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;

    coordinates.forEach(coord => {
        minLon = Math.min(minLon, coord[0]);
        maxLon = Math.max(maxLon, coord[0]);
        minLat = Math.min(minLat, coord[1]);
        maxLat = Math.max(maxLat, coord[1]);
    });

    console.log(`🏞️ Area bounding box: [${minLon.toFixed(6)}, ${minLat.toFixed(6)}] to [${maxLon.toFixed(6)}, ${maxLat.toFixed(6)}]`);

    // Determine grid spacing based on model type
    let spacing = 0.0001; // Default ~10 meters in degrees (rough approximation)
    if (modelType === 'residential') {
        spacing = 0.0002; // ~20 meters for residential
    } else if (modelType === 'footway') {
        spacing = 0.00005; // ~5 meters for footway
    }

    const repetitions = [];

    // Generate grid points within bounding box
    for (let lon = minLon; lon <= maxLon; lon += spacing) {
        for (let lat = minLat; lat <= maxLat; lat += spacing) {
            // Check if point is inside polygon
            if (isPointInPolygon([lon, lat], coordinates)) {
                repetitions.push({
                    position: [lon, lat],
                    type: modelType
                });
            }
        }
    }

    console.log(`🏞️ Generated ${repetitions.length} area repetitions for ${modelType}`);
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
 * @param {string} areaType - Type of area (e.g., 'residential', 'footway')
 */
function applyAreaRepetitions(feature, modelFilename, modelConfig, areaType) {
    console.log(`🏞️ applyAreaRepetitions called for areaType: ${areaType}, model: ${modelFilename}`);

    try {
        const geometry = feature.getGeometry();
        if (!geometry || geometry.getType() !== 'Polygon') {
            console.log('🏞️ Geometry not a Polygon, skipping');
            return;
        }

        const coordinates = geometry.getCoordinates()[0].map(coord =>
            ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326')
        );
        console.log(`🏞️ Processing area ${areaType} with ${coordinates.length} coordinates`);

        const repetitions = generateAreaRepetitions(coordinates, areaType);

        // Store repetition data on original feature
        if (repetitions.length > 0) {
            console.log(`🏞️ Storing ${repetitions.length} area repetition configurations on original feature`);

            repetitions.forEach((rep, index) => {
                const repetitionKey = `repetition_${index}`;
                const repModelOptions = {
                    uri: `/3dmodelsosm/src/models/${modelFilename}`,
                    scale: 1.0, // Normal scale for visibility
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                    position: rep.position
                };

                feature.set(repetitionKey, repModelOptions);
                feature.set(`${repetitionKey}_position`, rep.position);
                feature.set(`${repetitionKey}_heightOffset`, 0); // ON THE GROUND
                feature.set(`${repetitionKey}_rotation`, [0, 0, 0]);

                console.log(`🏞️ Stored area repetition ${index + 1} configuration at [${rep.position[0].toFixed(6)}, ${rep.position[1].toFixed(6)}]`);
            });

            console.log(`🏞️ Successfully stored ${repetitions.length} area repetition configurations`);
        } else {
            console.log(`🏞️ No area repetitions to store`);
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

console.log('🏞️ area_repetition.js loaded successfully');
