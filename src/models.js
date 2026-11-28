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
// GeoJSON zone override (points). Copy the default entry, keep the same tags,
// add `geojson` and the model/scale the zone should use instead:
//
//   { tags: ['amenity=bench'], model: 'w_amenity_bench.gltf', geometryType: 'point',
//     config: { scale: 1.0, heightOffset: 0.0, rotation: [0, Math.PI / 2, 0] } },
//   { tags: ['amenity=bench'], geojson: 'limit_molivent', model: 'w_amenity_bench.gltf',
//     geometryType: 'point', config: { scale: 2.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
//
// The geojson is a file in src/ (with or without '.geojson'), an array of names
// also works. It only applies inside its polygon; a missing file logs one warning
// and the entry without `geojson` stays in charge.
// Test: a bench inside the polygon uses the second entry's model/scale, a bench
// outside it uses the first; a missing file logs one warning and leaves the
// first entry in charge.
const nodeModelMappings = [
    { tags: ['amenity=bench'], model: 'w_amenity_bench.gltf', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, Math.PI / 2, 0] } },  // seat faces +X, so PI/2 turns it 90 deg right: the direction tag lands on the seat side (fence behind)
    { tags: ['amenity=bicycle_parking'], model: 'w_amenity_bicycle_parking.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Bicycle parking model for amenity=bicycle_parking
    { tags: ['amenity=charging_station'], model: 'w_amenity_charging_station.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Charging_station
    { tags: ['amenity=drinking_water'], model: 'w_amenity_drinking_water.gltf', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, Math.PI / 2, 0] } },  // spout faces +X, so PI/2 turns it 90 deg right: the direction tag lands on the spout side
    { tags: ['amenity=post_box'], model: 'w_amenity_post_box.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Street lamp model for highway=street_lamp
    { tags: ['amenity=waste_basket'], model: 'w_amenity_waste_basket.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Bicycle parking model for amenity=bicycle_parking 
    { tags: ['emergency=defibrillator'], model: 'w_emergency_defibrillator.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  
	{ tags: ['entrance=garage'], model: 'w_entrance_garage.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, Math.PI / 2, 0] } },
	{ tags: ['entrance=yes'], model: 'w_entrance_yes.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, Math.PI / 2, 0] } },
	{ tags: ['highway=bus_stop'], model: 'w_highway_bus_stop.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Street lamp model for highway=street_lamp
    { tags: ['highway=elevator'], model: 'w_highway_elevator.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, Math.PI / 2, 0] } },
	{ tags: ['highway=elevator'], model: 'w_highway_elevator.glb', geometryType: 'area', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, Math.PI / 2, 0] } },
	{ tags: ['highway=speed_camera'], model: 'w_highway_speed_camera.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Street lamp model for highway=street_lamp
	{ tags: ['highway=steps'], model: 'w_highway_steps.glb', geometryType: 'line', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, Math.PI / 2, 0] } },
{ tags: ['highway=street_lamp', 'lamp_mount=straight_mast'], model: 'w_highway_street_lamp_straight_mast.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, Math.PI / 2, 0] } },
    
    { tags: ['highway=street_lamp'], model: 'w_highway_street_lamp.glb', geometryType: 'point', config: { scale: 0.4, heightOffset: 0.0, rotation: [0, Math.PI / 2, 0] } },  // Street lamp model for highway=street_lamp
    { tags: ['highway=traffic_signals', 'traffic_signals=cyclist_crossing'], model: 'w_highway_traffic_signals_cycle.gltf', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Traffic signals model for cyclist crossing
    { tags: ['highway=traffic_signals', 'traffic_signals=pedestrian_crossing'], model: 'w_highway_traffic_signals_pedestrian.gltf', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Traffic signals model for pedestrian crossing
    { tags: ['highway=traffic_signals'], model: 'w_highway_traffic_signals.gltf', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Traffic signals model for highway=traffic_signals
    { tags: ['man_made=pole'], model: 'w_man_made_pole.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Tree model for natural=tree
    	{ tags: ['natural=tree'], geojson: 'limit_molivent', model: 'w_highway_bus_stop.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Street lamp model for highway=street_lamp
	{ tags: ['natural=tree'], model: 'w_natural_tree.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Tree model for natural=tree
    { tags: ['playground=slide'], model: 'w_playground_slide.gltf', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // slide
    { tags: ['playground=springy'], model: 'w_playground_spring.gltf', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // slide
    { tags: ['playground=swing'], model: 'w_playground_swing.glb', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // Could use forest model
	{ tags: ['power=pole'], model: 'w_power_pole.gltf', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // slide
	{ tags: ['power=tower'], model: 'w_power_tower.gltf', geometryType: 'point', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }, // slide
{ tags: ['recycling:plastic=yes'], model: 'w_recycling_plastic_yes.glb', geometryType: 'point', config: { scale: 0.5, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Recycling container model for    
{ tags: ['recycling:glass=yes'], model: 'w_recycling_glass_yes.glb', geometryType: 'point', config: { scale: 0.5, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Recycling container model for    
{ tags: ['recycling:organic=yes'], model: 'w_recycling_organic_yes.glb', geometryType: 'point', config: { scale: 0.5, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Recycling container model for    
{ tags: ['recycling:waste=yes'], model: 'w_recycling_waste_yes.glb', geometryType: 'point', config: { scale: 0.5, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Recycling container model for    
{ tags: ['recycling:paper=yes'], model: 'w_recycling_paper_yes.glb', geometryType: 'point', config: { scale: 0.5, heightOffset: 0.0, rotation: [0, 0, 0] } },  // Recycling container model for    
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
    { tags: ['addr:housenumber'], model: null, geometryType: 'point', config: { scale: 1.0, heightOffset: 1.6, rotation: [0, 0, 0], isHouseNumberLabel: true } }, // Door-height address label (blue square, white number)
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

    // Preserve repetition-level scalar settings that live alongside `config`.
    // These are non-recursive leaf values (numbers/strings/booleans) so they
    // survive resolveValue unchanged, but we keep them here for clarity.
    const LEAF_KEYS = ['textureRepeatCount', 'textureRotationOffsetDegrees',
                       'render_order', 'spacing', 'maxModels'];
    const out = resolveValue(config);
    for (const key of LEAF_KEYS) {
        if (config && Object.prototype.hasOwnProperty.call(config, key)) {
            out[key] = config[key];
        }
    }
    return out;
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

// ---------------------------------------------------------------------------
// Zone overrides: a mapping may name a GeoJSON it only applies inside of.
//
//   { tags: ['amenity=bench'], model: 'w_amenity_bench.gltf' }                       // default
//   { tags: ['amenity=bench'], geojson: 'limit_molivent', model: 'bench_zone.glb' }  // inside that polygon
//
// The name is a file in src/ ("limit_molivent", "limit_molivent.geojson" or the
// full "src/limit_molivent.geojson"); an array of names is accepted too. Inside
// the polygon the entry with `geojson` wins; outside it, or for any tag it does
// not cover, the entry without `geojson` is used. A file that cannot be loaded
// is only a warning: its entries never apply.
//
// Containment is OpenLayers' own point-in-polygon, on the geometry parsed from
// the file, so no custom polygon math is needed.
// ---------------------------------------------------------------------------
const zoneGeojsonGeometries = new Map(); // file -> ol polygon geometries ([] when failed)
const zoneGeojsonPending = new Set();
let zoneGeojsonScanDone = false;

/** "limit_molivent", "limit_molivent.geojson" or "src/limit_molivent.geojson" -> file path. */
function zoneGeojsonFile(name) {
    if (typeof name !== 'string' || !name.trim()) return null;
    let file = name.trim().replace(/^\.\//, '');
    if (!/\.geojson$/i.test(file)) file += '.geojson';
    if (file.indexOf('/') === -1) file = 'src/' + file;
    return file;
}

/** GeoJSON files this mapping is limited to; [] means it always applies. */
function mappingZoneGeojsons(mapping) {
    if (!mapping || !mapping.geojson) return [];
    const names = Array.isArray(mapping.geojson) ? mapping.geojson : [mapping.geojson];
    return names.map(zoneGeojsonFile).filter(Boolean);
}

function loadZoneGeojson(file) {
    if (!file || zoneGeojsonGeometries.has(file) || zoneGeojsonPending.has(file)) return;
    zoneGeojsonPending.add(file);
    Promise.resolve()
        .then(() => {
            if (typeof ol === 'undefined' || !ol.format || typeof fetch !== 'function') {
                throw new Error('OpenLayers or fetch is not available');
            }
            return fetch(file).then(response => {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            });
        })
        .then(geojson => {
            const format = new ol.format.GeoJSON();
            const geometries = geojson && (geojson.type === 'FeatureCollection' || geojson.type === 'Feature')
                ? format.readFeatures(geojson).map(feature => feature.getGeometry())
                : [format.readGeometry(geojson)];
            const polygons = geometries.filter(geometry => geometry && (
                geometry.getType() === 'Polygon' || geometry.getType() === 'MultiPolygon'));
            if (!polygons.length) throw new Error('no polygon geometry');
            zoneGeojsonGeometries.set(file, polygons);
        })
        .catch(error => {
            zoneGeojsonGeometries.set(file, []);
            console.warn(`🗺️ Zone geojson "${file}" not loaded, its model entries are ignored and the default configuration is used`, error);
        })
        .then(() => zoneGeojsonPending.delete(file));
}

/** Load every geojson named by a mapping, once the three mapping lists exist. */
function loadZoneGeojsons() {
    if (zoneGeojsonScanDone) return;
    const sources = [nodeModelMappings];
    if (window.lineRepetition && window.lineRepetition.getModelMappings) {
        sources.push(window.lineRepetition.getModelMappings());
    }
    if (window.areaRepetition && window.areaRepetition.areaRepetitionConfigs) {
        sources.push(window.areaRepetition.areaRepetitionConfigs);
    }
    if (sources.length < 3) return; // line/area modules still loading
    zoneGeojsonScanDone = true;
    sources.forEach(mappings => (mappings || []).forEach(mapping =>
        mappingZoneGeojsons(mapping).forEach(loadZoneGeojson)));
}

/** True when the [lon, lat] point is inside the named zone geojson. */
function isInsideZoneGeojson(fileOrName, lonLat) {
    loadZoneGeojsons();
    const file = zoneGeojsonFile(fileOrName);
    if (!file || !lonLat) return false;
    const geometries = zoneGeojsonGeometries.get(file);
    if (!geometries) {
        loadZoneGeojson(file);
        return false;
    }
    return geometries.some(geometry => {
        try { return geometry.intersectsCoordinate(lonLat); } catch (e) { return false; }
    });
}

/** Where a feature sits, in lon/lat: the point itself, or the way node handled now. */
function getFeatureLonLat(wayCoordinates, nodeIndex, orientationContext) {
    if (orientationContext && Array.isArray(orientationContext.pointLonLat)) {
        return orientationContext.pointLonLat;
    }
    if (Array.isArray(wayCoordinates) && wayCoordinates.length) {
        const index = Number.isInteger(nodeIndex) && nodeIndex >= 0 && nodeIndex < wayCoordinates.length
            ? nodeIndex
            : 0;
        return wayCoordinates[index];
    }
    return null;
}

function findTagMapping(mappings, tags, lonLat = null, areaPrefixFallback = false) {
    if (!Array.isArray(mappings) || !tags || typeof tags !== 'object') return null;
    loadZoneGeojsons();

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

    const matchesTags = (mapping) => mapping.tags.every(tag => {
        const [key, value] = tag.split('=');
        let tagValue = tags[key];
        if (tagValue === undefined && areaPrefixFallback && key.startsWith('area:') && tags.area === 'yes') {
            tagValue = tags[key.slice(5)];
        }
        return value === '*' ? tagValue !== undefined : tagValue === value;
    });

    // A `geojson` entry is active only inside its polygon; it is checked first
    // so it wins there. Entries without `geojson` stay the default everywhere.
    for (const candidate of candidates) {
        const files = mappingZoneGeojsons(candidate.mapping);
        if (!files.length) continue;
        if (files.some(file => isInsideZoneGeojson(file, lonLat)) && matchesTags(candidate.mapping)) {
            return candidate.mapping;
        }
    }
    for (const candidate of candidates) {
        if (mappingZoneGeojsons(candidate.mapping).length) continue;
        if (matchesTags(candidate.mapping)) return candidate.mapping;
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

    const lonLat = getFeatureLonLat(wayCoordinates, nodeIndex, orientationContext);
    const mapping = findTagMapping(nodeModelMappings, tags, lonLat);
    if (!mapping) return null;
    const bearing = resolveBearing(tags, wayCoordinates, nodeIndex, orientationContext);
    const resolvedMapping = resolveConfig(mapping, tags);
    return {
        ...resolvedMapping,
        geometryType: 'point',
        config: adjustConfigForDirection(resolvedMapping.config, tags, bearing)
    };
}

// Auto-fit GLB models to area cells using their real-world dimensions.
const glbAABB = {};
glbAABB['ES_CAT_BCN_casa_batllo.glb'] = {x:41.8753, y:37.9088, z:0.6475};
glbAABB['ES_CAT_BCN_casa_mila.glb'] = {x:1.2899, y:1.9528, z:0.5382};
glbAABB['ES_CAT_BCN_hotel_arts.glb'] = {x:6.7882, y:6.7882, z:15.4000};
glbAABB['ES_CAT_BCN_sagrada_familia.glb'] = {x:6.7297, y:17.2477, z:27.9168};
glbAABB['ES_CAT_BCN_torre_glories.glb'] = {x:35.8430, y:36.4033, z:140.4821};
glbAABB['ES_CAT_BCN_torre_mapfre.glb'] = {x:2.8284, y:2.8284, z:1.5000};
glbAABB['Untitled.glb'] = {x:0.2389, y:0.3793, z:2.8922};
glbAABB['w_amenity_bicycle_parking.glb'] = {x:2.4740, y:0.6693, z:0.0043};
glbAABB['w_amenity_charging_station.glb'] = {x:0.6000, y:1.8000, z:1.6000};
glbAABB['w_amenity_post_box.glb'] = {x:0.8580, y:0.8555, z:1.4732};
glbAABB['w_amenity_waste_basket.glb'] = {x:33.0065, y:25.6943, z:63.2074};
glbAABB['w_barrier_fence_type_railing.glb'] = {x:0.0200, y:1.0000, z:0.0200};
glbAABB['w_barrier_guard_rail.glb'] = {x:1.5674, y:4.9027, z:11.7831};
glbAABB['w_barrier_guard_rail_bridge.glb'] = {x:0.1328, y:0.9110, z:1.8960};
glbAABB['w_barrier_kerb.glb'] = {x:0.2634, y:0.1242, z:0.2920};
glbAABB['w_barrier_wall.glb'] = {x:0.1740, y:1.0934, z:0.9883};
glbAABB['w_barrier_wall_material_brick.glb'] = {x:0.1740, y:1.0934, z:0.9883};
glbAABB['w_highway_bus_stop.glb'] = {x:0.2000, y:4.0000, z:0.2000};
glbAABB['w_highway_bus_stop2.glb'] = {x:0.4723, y:0.0894, z:0.6427};
glbAABB['w_highway_speed_camera.glb'] = {x:1.0000, y:2.0000, z:1.0000};
glbAABB['w_highway_steps.glb'] = {x:1.2000, y:0.4000, z:0.4000};
glbAABB['w_highway_steps_short.glb'] = {x:0.2000, y:0.4016, z:0.4000};
glbAABB['w_highway_street_lamp.glb'] = {x:1.2748, y:1.2748, z:8.7869};
glbAABB['w_highway_street_lamp_straight_mast.glb'] = {x:0.3398, y:0.1351, z:0.0563};
glbAABB['w_highway_traffic_signals.glb'] = {x:3.4685, y:0.2567, z:8.9881};
glbAABB['w_highway_traffic_signals_cycle.glb'] = {x:0.2389, y:0.3793, z:2.6556};
glbAABB['w_highway_traffic_signals_exp.glb'] = {x:3.2000, y:8.0400, z:1.2400};
glbAABB['w_highway_traffic_signals_n_pedestrian.glb'] = {x:0.4744, y:0.5014, z:2.8922};
glbAABB['w_highway_traffic_signals_pedestrian.glb'] = {x:0.4657, y:0.3435, z:2.5084};
glbAABB['w_highway_traffic_signals_pedestrian_cycle.glb'] = {x:0.4744, y:0.5014, z:2.6556};
glbAABB['w_man_made_pole.glb'] = {x:0.0595, y:2.0000, z:0.0464};
glbAABB['w_natural_tree.glb'] = {x:2.9317, y:2.8009, z:3.5888};
glbAABB['w_playground_slide.glb'] = {x:464.5669, y:464.5670, z:814.9606};
glbAABB['w_playground_swing.glb'] = {x:2.2986, y:2.3097, z:3.7755};
glbAABB['w_railway_rail - copia.glb'] = {x:0.0031, y:0.0357, z:0.0003};
glbAABB['w_railway_rail.glb'] = {x:0.0031, y:0.0130, z:0.0003};
glbAABB['w_recycling_glass_yes.glb'] = {x:2.7400, y:3.3200, z:2.7400};
glbAABB['w_recycling_organic_yes.glb'] = {x:2.7400, y:3.3200, z:2.7400};
glbAABB['w_recycling_paper_yes.glb'] = {x:3.7600, y:3.3200, z:2.7400};
glbAABB['w_recycling_plastic_yes.glb'] = {x:3.7600, y:3.3200, z:2.7400};
glbAABB['w_recycling_type_container.glb'] = {x:4869.6500, y:12641.6503, z:1716.3513};
glbAABB['w_recycling_waste_yes.glb'] = {x:3.7600, y:3.3200, z:2.7400};
glbAABB['w_stroke_dashed.glb'] = {x:0.9129, y:0.0097, z:0.1518};
glbAABB['w_stroke_solid.glb'] = {x:0.9129, y:0.0097, z:0.1518};
glbAABB['w_traffic_sign_ES_R2.glb'] = {x:0.5372, y:0.0832, z:0.5119};
glbAABB['w_vending_parking_tickets.glb'] = {x:0.6737, y:1.7358, z:0.7008};

/**
 * Get the largest real-world dimension of a GLB model in meters.
 * Uses pre-computed mesh bounds × node scale from the GLB file.
 * Returns null if the model is not in the lookup table.
 */
function getModelMaxDimension(filename) {
    const info = glbAABB[filename];
    if (!info) return null;
    return Math.max(info.x || 0, info.y || 0, info.z || 0);
}
window.models = {
    nodeModelMappings,
    modelMappings: nodeModelMappings,
    getFeatureLonLat,
    mappingZoneGeojsons,
    isInsideZoneGeojson,
    loadZoneGeojsons,
    getModelForTags,
    findTagMapping,
    invalidateMappingIndex,
    getMappingIndexStats,
    getConfiguredModels,
    resolveConfig,
    adjustConfigForDirection,
    resolveBearing,
    calculateBearing,
    isLineStringClosed,
    getModelMaxDimension
};

// Start the zone geojson loads once the other mapping lists exist; features
// rendered before a file arrives use the default configuration until then.
if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('load', loadZoneGeojsons);
}
setTimeout(loadZoneGeojsons, 0);

console.log('models.js loaded. Point model mappings:', nodeModelMappings.length);