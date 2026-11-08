/**
 * Point-model configuration and shared tag lookup for geometry catalogs.
 * Any config value can reference a tag, e.g. scale: { tag: 'height', default: 1 }.
 */

// Point models are the only non-repeated models configured here.
//Implemented tag-driven configuration across all three modules. Use { tag, default } anywhere in a mapping or repetition setting; for example, height can drive scale:
	//config: {
    //scale: { tag: 'height', type: 'number', default: 1 },
   // heightOffset: { tag: 'min_height', type: 'number', default: 0 }}
	//The same syntax works for repetition settings, such as interval, spacing, and maxModels. Numeric tag values are converted to numbers; default is used if a tag is missing or invalid. Optional types include number, string, boolean, and json.
const nodeModelMappings = [
    { tags: ['amenity=bench'], model: 'w_amenity_bench.gltf', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Bicycle parking model for amenity=bicycle_parking
    { tags: ['amenity=bicycle_parking'], model: 'w_amenity_bicycle_parking.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Bicycle parking model for amenity=bicycle_parking
    { tags: ['amenity=charging_station'], model: 'w_amenity_charging_station.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Charging_station
    { tags: ['amenity=drinking_water'], model: 'w_amenity_drinking_water.gltf', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Bicycle parking model for amenity=bicycle_parking
    { tags: ['amenity=post_box'], model: 'w_amenity_post_box.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Street lamp model for highway=street_lamp
    { tags: ['amenity=waste_basket'], model: 'w_amenity_waste_basket.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Bicycle parking model for amenity=bicycle_parking 
    { tags: ['highway=bus_stop'], model: 'w_highway_bus_stop.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Street lamp model for highway=street_lamp
    { tags: ['highway=speed_camera'], model: 'w_highway_speed_camera.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Street lamp model for highway=street_lamp
	{ tags: ['highway=street_lamp', 'lamp_mount=straight_mast'], model: 'w_highway_street_lamp_straight_mast.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, Math.PI / 2, 0] } },
    { tags: ['highway=street_lamp'], model: 'w_highway_street_lamp.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, Math.PI / 2, 0] } },  // Street lamp model for highway=street_lamp
    { tags: ['highway=traffic_signals', 'traffic_signals=cyclist_crossing'], model: 'w_highway_traffic_signals_cycle.gltf', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Traffic signals model for cyclist crossing
    { tags: ['highway=traffic_signals', 'traffic_signals=pedestrian_crossing'], model: 'w_highway_traffic_signals_pedestrian.gltf', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Traffic signals model for pedestrian crossing
    { tags: ['highway=traffic_signals'], model: 'w_highway_traffic_signals.gltf', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Traffic signals model for highway=traffic_signals
    { tags: ['man_made=pole'], model: 'w_man_made_pole.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Tree model for natural=tree
    { tags: ['natural=tree'], model: 'w_natural_tree.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Tree model for natural=tree
    { tags: ['playground=slide'], model: 'w_playground_slide.gltf', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // slide
    { tags: ['playground=springy'], model: 'w_playground_spring.gltf', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // slide
    { tags: ['playground=swing'], model: 'w_playground_swing.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Could use forest model
	{ tags: ['power=pole'], model: 'w_power_pole.gltf', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // slide
	{ tags: ['power=tower'], model: 'w_power_tower.gltf', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // slide
{ tags: ['recycling:plastic=yes'], model: 'w_recycling_plastic_yes.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Recycling container model for    
{ tags: ['recycling:glass=yes'], model: 'w_recycling_glass_yes.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Recycling container model for    
{ tags: ['recycling:organic=yes'], model: 'w_recycling_organic_yes.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Recycling container model for    
{ tags: ['recycling:waste=yes'], model: 'w_recycling_waste_yes.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Recycling container model for    
{ tags: ['recycling:paper=yes'], model: 'w_recycling_paper_yes.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Recycling container model for    
   { tags: ['vending=parking_tickets'], model: 'w_vending_parking_tickets.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // slide
    { tags: ['traffic_sign=ES:R2'], model: 'w_traffic_sign_ES_R2.gltf', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Could use forest model
    { tags: ['traffic_sign=ES:R101'], model: 'w_traffic_sign_ES_R101.gltf', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Could use forest model
        { tags: ['wikidata=Q575953'], model: 'ES_CAT_BCN_casa_batllo.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Casa Batlló
    { tags: ['wikidata=Q207870'], model: 'ES_CAT_BCN_casa_mila.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Casa Mila
    { tags: ['wikidata=Q1425790'], model: 'ES_CAT_BCN_hotel_arts.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Hotel Arts Barcelona model
    { tags: ['wikidata=Q336246'], model: 'ES_CAT_BCN_torre_glories.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Glories model
    { tags: ['wikidata=Q2689231'], model: 'ES_CAT_BCN_torre_mapfre.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Mapfre tower
    { tags: ['wikidata=Q48435'], model: 'ES_CAT_BCN_sagrada_familia.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Sagrada Familia Barcelona
    { tags: ['name=La Pedrera'], model: 'ES_CAT_BCN_casa_mila.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Casa Milà by name
    { tags: ['name=Casa Batlló'], model: 'ES_CAT_BCN_casa_batllo.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Casa Batlló by name
    { tags: ['name=Torre Mapfre'], model: 'ES_CAT_BCN_torre_mapfre.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Torre Mapfre by name
    //{ tags: ['recycling_type=container'], model: 'w_recycling_type_container.glb', geometryType: 'point', config: { scale: 4.0, heightOffset: 0.0, rotation: [30, 40, 50] } },  // Recycling container model for recycling_type=container 
   { tags: ['manhole=drain'], model: 'i_manhole_drain.jpg', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Manhole point models
    //{ tags: ['barrier=kerb'], model: 'w_barrier_kerb.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Kerb repetitions
];

/**
 * Check if a LineString is closed (first and last coordinates are the same)
 * @param {ol.geom.LineString|Array<Array<number>>} geometry - OpenLayers LineString geometry or coordinates array
 * @returns {boolean} True if the LineString is closed
 */
function isLineStringClosed(geometry) {
    let coordinates;
    if (geometry && geometry.getCoordinates) {
        // OpenLayers geometry object
        coordinates = geometry.getCoordinates();
    } else if (Array.isArray(geometry)) {
        // Direct coordinates array
        coordinates = geometry;
    } else {
        return false;
    }
    
    if (!coordinates || coordinates.length < 3) {
        return false; // Need at least 3 coordinates to form a closed shape
    }
    
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    
    // Compare first and last coordinates with tolerance for floating point precision
    const tolerance = 1e-6;
    return Math.abs(first[0] - last[0]) < tolerance && Math.abs(first[1] - last[1]) < tolerance;
}

/**
 * Calculate the bearing (direction) of the way at a specific node index
 * @param {Array<Array<number>>} wayCoordinates - Array of [lon, lat] coordinates
 * @param {number} nodeIndex - Index of the node in the way coordinates
 * @returns {number} Bearing in radians (0 = north, clockwise)
 */
function calculateBearing(wayCoordinates, nodeIndex) {
    if (!wayCoordinates || wayCoordinates.length < 2 || nodeIndex < 0 || nodeIndex >= wayCoordinates.length) {
        return 0;
    }
    let dx, dy;
    if (nodeIndex === 0) {
        // Start of way: use direction to next node
        const curr = wayCoordinates[0];
        const next = wayCoordinates[1];
        dx = next[0] - curr[0];
        dy = next[1] - curr[1];
    } else if (nodeIndex === wayCoordinates.length - 1) {
        // End of way: use direction from previous node
        const prev = wayCoordinates[nodeIndex - 1];
        const curr = wayCoordinates[nodeIndex];
        dx = curr[0] - prev[0];
        dy = curr[1] - prev[1];
    } else {
        // Middle: average direction from prev to next
        const prev = wayCoordinates[nodeIndex - 1];
        const next = wayCoordinates[nodeIndex + 1];
        dx = next[0] - prev[0];
        dy = next[1] - prev[1];
    }
    return Math.atan2(dx, dy); // atan2(x, y) where x=east, y=north
}

/**
 * Work out the bearing a model should be rotated by, in radians.
 *
 * A LineString is oriented by its OWN way, as before. A point is oriented by
 * the street it stands in, resolved through the declarative rules in
 * model_orientation.js — that is where "turn toward the way" vs "run along
 * the way" vs "never turn" is decided.
 *
 * @returns {number|null} radians, or null for "no rotation"
 */
function resolveBearing(tags, wayCoordinates, nodeIndex, orientationContext) {
    // Backward compatibility: a caller that already worked out a bearing.
    if (!orientationContext && tags && tags._parentWayBearing !== undefined) {
        return tags._parentWayBearing;
    }
    if (wayCoordinates && nodeIndex !== null) {
        return calculateBearing(wayCoordinates, nodeIndex);
    }
    if (!orientationContext || !orientationContext.pointLonLat || !orientationContext.allFeatures) {
        return null;
    }
    if (!window.modelOrientation) return null;

    const rule = window.modelOrientation.resolveRule(tags);
    const found = window.modelOrientation.bearingFor(
        orientationContext.pointLonLat, orientationContext.allFeatures, {
            facing: rule.facing,
            against: rule.against
        });
    return found ? found.bearing : null;
}

/**
 * Adjust model config based on direction tags
 * @param {object} config - Original config object
 * @param {object} tags - OSM tags
 * @param {number|null} bearing - Bearing of the way at the node in radians, or null if not available
 * @returns {object} Adjusted config
 */
function adjustConfigForDirection(config, tags, bearing) {
    const resolvedConfig = resolveConfig(config, tags);
    const adjustedConfig = {
        ...resolvedConfig,
        rotation: Array.isArray(resolvedConfig.rotation)
            ? resolvedConfig.rotation.slice()
            : [0, 0, 0]
    };
    // Use bearing from parameter, or from parent way, or default to 0
    const baseBearing = bearing !== null ? bearing : 
                       (tags._parentWayBearing !== undefined ? tags._parentWayBearing : 0);

    // rotation[1] as AUTHORED in the mapping is a constant OFFSET, added to the
    // bearing instead of being overwritten by it. A glTF has its own idea of
    // which way the model faces (forward may be +X, -Z, +Y...), so a model can
    // come out 90 or 180 degrees out. Set rotation: [0, Math.PI/2, 0] on that
    // mapping to correct it without touching any orientation code.
    const offset = adjustedConfig.rotation[1] || 0;
    adjustedConfig.rotation[1] = -baseBearing + offset;
    
    // Check for orientation tag (degrees) first, then direction tag
    const orientation = tags['orientation'];
    console.log(`🧭 adjustConfigForDirection: Processing orientation tag: "${orientation}" for tags:`, tags);
    if (orientation && !isNaN(parseFloat(orientation))) {
        // Convert orientation from degrees to radians and apply to Y-axis (heading)
        // Orientation: 0° = north, 90° = east, 180° = south, 270° = west
        const orientationRadians = parseFloat(orientation) * Math.PI / 180;
        adjustedConfig.rotation[1] = -orientationRadians + offset; // Negative for correct orientation
        console.log(`🧭 Applied orientation ${orientation}° (${orientationRadians.toFixed(3)} rad) to rotation[1]: ${adjustedConfig.rotation[1].toFixed(3)}`);
        return adjustedConfig;
    }
    
    const direction = tags['direction'] || tags['traffic_signals:direction'];
    console.log(`🧭 adjustConfigForDirection: Processing direction tag: "${direction}" for tags:`, tags);
    
    // Check if direction is a numeric degree value (like "116", "168")
    if (direction && !isNaN(parseFloat(direction))) {
        // Convert direction from degrees to radians and apply to Y-axis (heading)
        // Direction: 0° = north, 90° = east, 180° = south, 270° = west
        const directionRadians = parseFloat(direction) * Math.PI / 180;
        adjustedConfig.rotation[1] = -directionRadians + offset; // Negative for correct orientation
        console.log(`🧭 Applied direction ${direction}° (${directionRadians.toFixed(3)} rad) to rotation[1]: ${adjustedConfig.rotation[1].toFixed(3)}`);
        return adjustedConfig;
    }
    
    if (!direction) return adjustedConfig; // No direction tag, keep base bearing
    switch (direction) {
        case 'forward':
            // No additional rotation
            break;
        case 'backward':
            adjustedConfig.rotation[1] += Math.PI; // Add 180 degrees
            break;
        case 'left':
            adjustedConfig.rotation[1] += Math.PI / 2; // Add 90 degrees
            break;
        case 'right':
            adjustedConfig.rotation[1] -= Math.PI / 2; // Subtract 90 degrees
            break;
        case 'all':
            // No additional rotation for all
            break;
        default:
            console.warn(`Unknown direction value: ${direction}`);
            break;
    }
    return adjustedConfig;
}

/**
 * Resolve tag references anywhere in a configuration object.
 *
 * Use { tag: 'height', default: 1 } for a numeric value from an OSM tag.
 * The default is used when the tag is absent or cannot be converted.
 * Optional types are 'number', 'string', 'boolean', and 'json'.
 */
function resolveConfig(config, tags) {
    function resolveValue(value) {
        if (Array.isArray(value)) {
            return value.map(resolveValue);
        }
        if (!value || typeof value !== 'object') {
            return value;
        }

        const keys = Object.keys(value);
        const isTagReference = typeof value.tag === 'string' &&
            keys.every(key => ['tag', 'default', 'type'].includes(key));
        if (isTagReference) {
            const hasDefault = Object.prototype.hasOwnProperty.call(value, 'default');
            const rawValue = tags && Object.prototype.hasOwnProperty.call(tags, value.tag)
                ? tags[value.tag]
                : undefined;
            if (rawValue === undefined || rawValue === null || rawValue === '') {
                return hasDefault ? resolveValue(value.default) : undefined;
            }

            let resolvedValue = rawValue;
            switch (value.type) {
                case 'number': {
                    const number = typeof rawValue === 'number'
                        ? rawValue
                        : Number.parseFloat(String(rawValue).trim());
                    resolvedValue = Number.isFinite(number) ? number : undefined;
                    break;
                }
                case 'string':
                    resolvedValue = String(rawValue);
                    break;
                case 'boolean': {
                    const normalized = String(rawValue).trim().toLowerCase();
                    if (['true', 'yes', '1'].includes(normalized)) resolvedValue = true;
                    else if (['false', 'no', '0'].includes(normalized)) resolvedValue = false;
                    else resolvedValue = undefined;
                    break;
                }
                case 'json':
                    try {
                        resolvedValue = JSON.parse(String(rawValue));
                    } catch (error) {
                        console.warn(`Could not parse tag "${value.tag}" as JSON:`, error);
                        resolvedValue = undefined;
                    }
                    break;
                default: {
                    const number = typeof rawValue === 'number'
                        ? rawValue
                        : Number(String(rawValue).trim());
                    resolvedValue = Number.isFinite(number) ? number : rawValue;
                    break;
                }
            }
            return resolvedValue === undefined && hasDefault
                ? resolveValue(value.default)
                : resolvedValue;
        }

        const resolvedObject = {};
        for (const [key, nestedValue] of Object.entries(value)) {
            const resolvedNestedValue = resolveValue(nestedValue);
            if (resolvedNestedValue !== undefined) {
                resolvedObject[key] = resolvedNestedValue;
            }
        }
        return resolvedObject;
    }

    return resolveValue(config);
}

/**
 * Get the model mapping for a given set of OSM tags and geometry type
 * @param {object} tags - Object with OSM key-value pairs
 * @param {Array<Array<number>>|null} wayCoordinates - Array of [lon, lat] coordinates of the way, or null
 * @param {number|null} nodeIndex - Index of the node in the way coordinates, or null
 * @param {string} geometryType - The geometry type ('point', 'line', 'area')
 * @param {{pointLonLat?:Array<number>, allFeatures?:Array}} [orientationContext] - where a POINT
 *        feature sits, so it can be turned to face (or run along) the right
 *        way. Which way, and whether it turns at all, comes from the
 *        declarative rules in model_orientation.js.
 * @returns {object|null} Mapping object {tags, model, geometryType, config} or null if no mapping exists
 */
let mappingIndexes = new WeakMap();

function buildMappingIndex(mappings) {
    const index = new Map();
    mappings.forEach((mapping, order) => {
        const [key, value] = String(mapping.tags[0]).split('=');
        let byValue = index.get(key);
        if (!byValue) {
            byValue = new Map();
            index.set(key, byValue);
        }
        let bucket = byValue.get(value);
        if (!bucket) {
            bucket = [];
            byValue.set(value, bucket);
        }
        bucket.push({ order, mapping });
    });
    return index;
}

function findTagMapping(mappings, tags, areaPrefixFallback = false) {
    if (!Array.isArray(mappings) || !tags || typeof tags !== 'object') return null;

    let index = mappingIndexes.get(mappings);
    if (!index) {
        index = buildMappingIndex(mappings);
        mappingIndexes.set(mappings, index);
    }

    const candidates = [];
    index.forEach((byValue, key) => {
        let tagValue = tags[key];
        if (tagValue === undefined && areaPrefixFallback && key.startsWith('area:') && tags.area === 'yes') {
            tagValue = tags[key.slice(5)];
        }
        const bucket = byValue.get(tagValue);
        if (bucket) candidates.push(...bucket);
        const wildcardBucket = byValue.get('*');
        if (wildcardBucket) candidates.push(...wildcardBucket);
    });
    candidates.sort((a, b) => a.order - b.order);

    for (const candidate of candidates) {
        const mapping = candidate.mapping;
        const matches = mapping.tags.every(tag => {
            const [key, value] = tag.split('=');
            let tagValue = tags[key];
            if (tagValue === undefined && areaPrefixFallback && key.startsWith('area:') && tags.area === 'yes') {
                tagValue = tags[key.slice(5)];
            }
            return value === '*' ? tagValue !== undefined : tagValue === value;
        });
        if (matches) return mapping;
    }
    return null;
}

function invalidateMappingIndex() {
    mappingIndexes = new WeakMap();
}

function getMappingIndexStats() {
    let index = mappingIndexes.get(nodeModelMappings);
    if (!index) {
        index = buildMappingIndex(nodeModelMappings);
        mappingIndexes.set(nodeModelMappings, index);
    }
    return { point: { firstTagKeys: index.size, mappings: nodeModelMappings.length } };
}

function getConfiguredModels() {
    const mappings = nodeModelMappings.slice();
    if (window.lineRepetition && window.lineRepetition.getModelMappings) {
        mappings.push(...window.lineRepetition.getModelMappings());
    }
    if (window.areaRepetition && window.areaRepetition.areaRepetitionConfigs) {
        mappings.push(...window.areaRepetition.areaRepetitionConfigs);
    }
    return Array.from(new Set(mappings.map(mapping => mapping.model).filter(Boolean)));
}

function getModelForTags(tags, wayCoordinates = null, nodeIndex = null, geometryType = 'point', orientationContext = null) {
    if (geometryType === 'area') {
        return window.areaRepetition && window.areaRepetition.getModelForTags
            ? window.areaRepetition.getModelForTags(tags, wayCoordinates, nodeIndex, orientationContext)
            : null;
    }
    if (geometryType === 'line') {
        return window.lineRepetition && window.lineRepetition.getModelForTags
            ? window.lineRepetition.getModelForTags(tags, wayCoordinates, nodeIndex, orientationContext)
            : null;
    }

    const mapping = findTagMapping(nodeModelMappings, tags);
    if (!mapping) return null;
    const bearing = resolveBearing(tags, wayCoordinates, nodeIndex, orientationContext);
    const resolvedMapping = resolveConfig(mapping, tags);
    return {
        ...resolvedMapping,
        geometryType: 'point',
        config: adjustConfigForDirection(resolvedMapping.config, tags, bearing)
    };
}

window.models = {
    nodeModelMappings,
    modelMappings: nodeModelMappings,
    getModelForTags,
    findTagMapping,
    invalidateMappingIndex,
    getMappingIndexStats,
    getConfiguredModels,
    resolveConfig,
    adjustConfigForDirection,
    resolveBearing,
    calculateBearing,
    isLineStringClosed
};

console.log('models.js loaded. Point model mappings:', nodeModelMappings.length);