/**
 * Railway Repetition Module
 * Repeats a 3D model along every railway way, the same way
 * highway_repetition.js does along roads.
 *
 * Why this is its own module and not just another tag in model_repetition.js
 * -------------------------------------------------------------------------
 * A rail is a long, thin thing that must lie ALONG the track, and the track
 * turns. That needs two things the generic path does not give:
 *
 *   1. a rotation taken from the bearing of the segment the model sits on,
 *      exactly as highway_repetition.js does for roads - without it every
 *      rail on a curved line points the same way and the track looks broken;
 *   2. spacing in METRES that suits a 3.4 MB rail model. The generic default
 *      (0.20 m) is five models per metre, tuned for kerb props beside a road.
 *
 * Before this module existed, models.js mapped railway=rail to
 * w_railway_rail.glb and then nothing placed it: the two chains that decided
 * how a way gets its models knew fences, highways, footways and drains, and a
 * railway matched none of them. The chain simply ended. This module is now
 * what that branch calls.
 *
 * Debug: ?debug=railwayRepetition (see src/debug_config.js), or
 * set railwayRepetitionDebugConfig.enabled = true here.
 */

// Debug configuration. Mirrors highway_repetition.js so both modules read the
// same way, and defers to the global debug config when it defines this module.
const railwayRepetitionDebugConfig = {
    enabled: false,
    logProcessing: false,
    logStorage: false
};

(function syncDebugConfigWithGlobal() {
    // globalDebugConfig is the name every other module uses (see
    // model_renderer.js), and it is what debug_config.js actually publishes at
    // line 100. This used to read `window.debugConfig`, which nothing ever sets,
    // so `global` was always undefined and these three flags could never turn
    // on - ?debug=railwayRepetition silently did nothing.
    const global = window.globalDebugConfig;
    if (global && global.railwayRepetition) {
        railwayRepetitionDebugConfig.enabled = !!global.railwayRepetition.enabled;
        railwayRepetitionDebugConfig.logProcessing = !!global.railwayRepetition.logProcessing;
        railwayRepetitionDebugConfig.logStorage = !!global.railwayRepetition.logStorage;
    }
})();

/**
 * Spacing per railway kind, in METRES between two models.
 *
 * Interval and sideOffset are what make one railway look like itself and not
 * like another: a tram and a heavy rail line do not have the same gauge, and
 * a preserved/heritage line is drawn sparser on purpose.
 */
const railwayRepetitionConfig = {
    default: {
        interval: 5,        // metres between models
        sideOffset: 0,      // metres sideways from the track centre line
        maxModels: 350,     // per way: a long main line must not spawn thousands
        rotationOffset: 0   // radians added to the bearing, for models whose
                           // "forward" is not the model's +Z
    },

    rail: {
        interval: 4,
        sideOffset: 0,
        maxModels: 400,
        rotationOffset: 0
    },

    light_rail: {
        interval: 4,
        sideOffset: 0,
        maxModels: 400,
        rotationOffset: 0
    },

    tram: {
        interval: 4,
        sideOffset: 0,
        maxModels: 400,
        rotationOffset: 0
    },

    narrow_gauge: {
        interval: 4,
        sideOffset: 0,
        maxModels: 400,
        rotationOffset: 0
    },

    subway: {
        interval: 6,
        sideOffset: 0,
        maxModels: 300,
        rotationOffset: 0
    },

    monorail: {
        interval: 6,
        sideOffset: 0,
        maxModels: 300,
        rotationOffset: 0
    },

    preserved: {
        interval: 8,        // heritage lines are drawn sparser on purpose
        sideOffset: 0,
        maxModels: 200,
        rotationOffset: 0
    },

    funicular: {
        interval: 8,
        sideOffset: 0,
        maxModels: 150,
        rotationOffset: 0
    }
};

/**
 * Configuration for a specific railway kind.
 * @param {string} railwayType - the value of the railway tag
 * @returns {Object} the config for it, or the default
 */
function getRailwayConfig(railwayType) {
    return railwayRepetitionConfig[railwayType] || railwayRepetitionConfig.default;
}

/**
 * Calculate distance between two coordinates in meters
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
 * Bearing of a segment, in radians. This is what turns the model along the
 * track instead of leaving it pointing north wherever the line happens to go.
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
 * Generate repeated model positions along a railway line.
 *
 * The walk is the same as the highway one - carry the leftover distance across
 * segment boundaries - so a model never bunches up at a vertex, and the cap is
 * a cap: a 4 km main line stops instead of producing 1000+ live primitives.
 *
 * @param {Array<Array<number>>} coordinates - [lon, lat] pairs
 * @param {string} railwayType - value of the railway tag
 * @returns {Array<Object>} {position, bearing, config} per model
 */
function generateRailwayRepetitions(coordinates, railwayType) {
    const config = getRailwayConfig(railwayType);
    const repetitions = [];

    let cumulativeDistance = 0;
    let modelCount = 0;

    for (let i = 0; i < coordinates.length - 1 && modelCount < config.maxModels; i++) {
        const segmentStart = coordinates[i];
        const segmentEnd = coordinates[i + 1];
        const segmentLength = calculateDistance(segmentStart, segmentEnd);
        const segmentBearing = calculateSegmentBearing(segmentStart, segmentEnd);

        // A repeated vertex would spin the bearing for no reason.
        if (segmentLength < 0.01) continue;

        while (cumulativeDistance < segmentLength && modelCount < config.maxModels) {
            const pointAlongSegment = getPointAlongSegment(segmentStart, segmentEnd, cumulativeDistance);

            // Sideways offset, for track that is not on the mapped centre line.
            let finalPoint = pointAlongSegment;
            if (config.sideOffset !== 0) {
                const dx = segmentEnd[0] - segmentStart[0];
                const dy = segmentEnd[1] - segmentStart[1];
                const length = Math.sqrt(dx * dx + dy * dy);

                if (length > 0) {
                    const perpX = -dy / length;
                    const perpY = dx / length;
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
                bearing: segmentBearing,
                config: { ...config }
            });

            cumulativeDistance += config.interval;
            modelCount++;
        }

        cumulativeDistance -= segmentLength; // carry over to the next segment
    }

    return repetitions;
}

/**
 * Apply railway repetitions to a feature.
 *
 * Writes the same repetition_* properties model_renderer.addRepetitionModels
 * reads, so the renderer needs to know nothing about railways.
 *
 * @param {ol.Feature} feature - the railway way
 * @param {string} modelFilename - model chosen by models.js
 * @param {Object} modelConfig - its config (scale, heightOffset, rotation)
 * @param {string} railwayType - value of the railway tag
 */
function applyRailwayRepetitions(feature, modelFilename, modelConfig, railwayType) {
    if (railwayRepetitionDebugConfig.enabled && railwayRepetitionDebugConfig.logProcessing) {
        console.log(`🚆 applyRailwayRepetitions called for railwayType: ${railwayType}, model: ${modelFilename}`);
    }

    const geometry = feature.getGeometry();
    if (!geometry || geometry.getType() !== 'LineString') {
        if (railwayRepetitionDebugConfig.enabled) console.log('🚆 Geometry not a LineString, skipping');
        return;
    }

    const coordinates = geometry.getCoordinates().map(coord =>
        ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326')
    );

    const repetitions = generateRailwayRepetitions(coordinates, railwayType);
    if (repetitions.length === 0) {
        if (railwayRepetitionDebugConfig.enabled) console.log('🚆 No railway repetitions to store');
        return;
    }

    if (railwayRepetitionDebugConfig.enabled && railwayRepetitionDebugConfig.logStorage) {
        console.log(`🚆 Storing ${repetitions.length} railway repetitions for railway=${railwayType}`);
    }

    repetitions.forEach((rep, index) => {
        const repetitionKey = `repetition_${index}`;
        const repModelOptions = {
            uri: `/3dmodelsosm/src/models/${modelFilename}`,
            scale: modelConfig ? modelConfig.scale || 1.0 : 1.0,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            position: rep.position
        };

        feature.set(repetitionKey, repModelOptions);
        feature.set(`${repetitionKey}_position`, rep.position);
        feature.set(`${repetitionKey}_heightOffset`, modelConfig ? modelConfig.heightOffset || 0 : 0);

        // Bearing drives the heading; the model's own pitch and roll survive.
        const baseRotation = (modelConfig && modelConfig.rotation) || [0, 0, 0];
        const config = rep.config || {};
        const bearingRotation = -(rep.bearing || 0) + (config.rotationOffset || 0);
        const adjustedRotation = [
            baseRotation[0],
            bearingRotation,
            baseRotation[2]
        ];

        feature.set(`${repetitionKey}_rotation`, adjustedRotation);

        if (railwayRepetitionDebugConfig.enabled && railwayRepetitionDebugConfig.logStorage && index < 5) {
            console.log(`🚆 Stored railway repetition ${index + 1} at bearing ${(rep.bearing * 180 / Math.PI).toFixed(1)}°, rotation [${adjustedRotation.map(r => (r * 180 / Math.PI).toFixed(1) + '°').join(', ')}]`);
        }
    });

    if (railwayRepetitionDebugConfig.enabled) {
        console.log(`🚆 Successfully stored ${repetitions.length} railway repetition configurations`);
    }
}

// Export functions for use in other modules
window.railwayRepetition = {
    applyRailwayRepetitions,
    generateRailwayRepetitions,
    getRailwayConfig,
    railwayRepetitionConfig,
    calculateSegmentBearing
};

// Debug: Confirm railway_repetition.js is loaded
console.log('🚆 railway_repetition.js loaded successfully');
