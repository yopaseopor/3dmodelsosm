/**
 * Buildings module for 3D extrusion of building footprints
 * Handles creation of 3D building models from GeoJSON or OSM data
 */

// Global storage for building entities
let buildingEntities = new Map(); // feature -> cesium entity
let ol3dInstance = null;
window.buildings = window.buildings || {};

// Walls extend this far below the sampled ground base, so the building can
// never float over terrain even when DEM detail refines after placement.
const BUILDING_SKIRT_METERS = 0.5;

/* ------------------------------------------------------------------ */
/* building:part support (https://wiki.openstreetmap.org/wiki/Key:building:part)
 * - An outline tagged building=* that contains building:part=* areas must NOT
 *   be extruded in 3D; the parts carry the real volumes.
 * - Parts support their own height, min_height, building:min_level, layer,
 *   building:colour and building:material tags.
 * - Special values: roof/porch/balcony (canopy slabs), column, steps,
 *   staircase, corridor; layer=-1 marks underground parts.
 * ------------------------------------------------------------------ */

// Registry of building:part footprints (lon/lat outer rings) used to detect
// outlines that must not be extruded because they contain parts.
const buildingPartRegistry = [];
const registeredPartFeatures = new Set();

// OSM layer=* is a stacking order, not meters: a small per-unit vertical
// offset avoids z-fighting between overlapping volumes; layer=-1 sinks
// underground parts slightly below ground.
const LAYER_STACK_METERS = 0.5;
const LAYER_STACK_CLAMP = 5;

/**
 * Parse an OSM length value ("12", "12.5", "12 m", "40 ft") to meters
 * @param {*} value
 * @returns {number} NaN when not parseable
 */
function parseLengthMeters(value) {
    if (value === undefined || value === null || value === '') return NaN;
    if (typeof value === 'number') return isFinite(value) ? value : NaN;
    const str = String(value).trim().toLowerCase().replace(',', '.');
    const match = str.match(/(-?\d+(?:\.\d+)?)/);
    if (!match) return NaN;
    let meters = parseFloat(match[1]);
    if (!isFinite(meters)) return NaN;
    if (/\b(ft|feet|foot)\b/.test(str) || str.includes("'")) {
        meters *= 0.3048; // imperial feet -> meters
    }
    return meters;
}

/**
 * Parse a plain numeric OSM value (levels, layer)
 * @param {*} value
 * @returns {number} NaN when not parseable
 */
function parseNumber(value) {
    if (value === undefined || value === null || value === '') return NaN;
    if (typeof value === 'number') return isFinite(value) ? value : NaN;
    const match = String(value).trim().replace(',', '.').match(/(-?\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : NaN;
}

/**
 * Parse an OSM colour value (hex like #ff0000, or CSS colour names like "red")
 * @param {*} value
 * @returns {Cesium.Color|null}
 */
function parseOsmtColour(value) {
    if (!value || typeof value !== 'string') return null;
    const str = value.trim();
    if (!str) return null;
    try {
        return Cesium.Color.fromCssColorString(str) || null;
    } catch (e) {
        return null;
    }
}

/**
 * Check whether a tag value looks like a texture image URL.
 * Material names (building:material=brick) are NOT URLs and must never be
 * handed to Cesium's Image material.
 * @param {*} value
 * @returns {boolean}
 */
function isTextureUrl(value) {
    if (!value || typeof value !== 'string') return false;
    const str = value.trim();
    if (/^https?:\/\//i.test(str)) return true;
    return /\.(png|jpe?g|gif|svg|webp)$/i.test(str) && !str.includes(' ');
}

// Representative colours for common building:material=* values
const FACADE_MATERIAL_COLORS = {
    brick: 'rgb(154,72,61)',
    bricks: 'rgb(154,72,61)',
    plaster: 'rgb(232,224,211)',
    stucco: 'rgb(232,224,211)',
    concrete: 'rgb(194,194,189)',
    stone: 'rgb(176,170,157)',
    masonry: 'rgb(170,158,143)',
    wood: 'rgb(156,122,80)',
    timber_framing: 'rgb(139,102,66)',
    metal: 'rgb(168,173,179)',
    steel: 'rgb(168,173,179)',
    glass: 'rgb(184,208,220)',
    mud: 'rgb(160,130,94)',
    adobe: 'rgb(198,152,110)'
};

/**
 * Facade colour per the building:part combination tags:
 * building:colour=* > building:material=* (as colour) > building type colour
 * @param {object} tags
 * @returns {Cesium.Color}
 */
function getFacadeColor(tags) {
    if (tags) {
        const explicit = parseOsmtColour(tags['building:colour']) || parseOsmtColour(tags.colour);
        if (explicit) return explicit;
        const material = (tags['building:material'] || '').toString().trim().toLowerCase();
        if (material && FACADE_MATERIAL_COLORS[material]) {
            const c = parseOsmtColour(FACADE_MATERIAL_COLORS[material]);
            if (c) return c;
        }
    }
    return getBuildingColor(tags);
}

/**
 * Base elevation offset above ground: min_height=* (meters) or
 * building:min_level=* (floors). Lifts parts that do not start at the ground
 * (bridges, arches, overhanging balconies) per the building:part wiki.
 * @param {object} tags
 * @returns {number} meters above ground for the base
 */
function getBaseOffsetMeters(tags) {
    const minHeight = parseLengthMeters(tags['min_height']);
    if (isFinite(minHeight) && minHeight !== 0) return minHeight;
    const minLevel = parseNumber(tags['building:min_level']);
    if (isFinite(minLevel) && minLevel !== 0) return minLevel * 3.0;
    return 0;
}

/**
 * Vertical stacking offset from OSM layer=* (see LAYER_STACK_METERS).
 * @param {object} tags
 * @returns {number} meters
 */
function getLayerOffsetMeters(tags) {
    const layer = parseNumber(tags.layer);
    if (!isFinite(layer) || layer === 0) return 0;
    const clamped = Math.max(-LAYER_STACK_CLAMP, Math.min(LAYER_STACK_CLAMP, layer));
    return clamped * LAYER_STACK_METERS;
}

/* ------------------------------------------------------------------ */
/* Roof tags (Simple 3D Buildings: "Tags for only the roof")            */
/* roof:shape, roof:height, roof:angle, roof:levels,                    */
/* roof:orientation (along/across), roof:direction, roof:colour,        */
/* roof:material, roof:texture                                          */
/* ------------------------------------------------------------------ */

// Visual extras (roof primitives / cap / dome entities) per feature
const roofVisuals = new Map(); // feature -> [{ kind: 'primitive'|'entity', ref }]

// Representative colours for common roof:material=* values
const ROOF_MATERIAL_COLORS = {
    roof_tiles: 'rgb(158,74,53)',
    tiles: 'rgb(158,74,53)',
    terracotta: 'rgb(186,98,70)',
    slate: 'rgb(90,102,112)',
    concrete: 'rgb(181,176,168)',
    metal: 'rgb(143,152,160)',
    metal_sheet: 'rgb(143,152,160)',
    copper: 'rgb(110,161,144)',
    wood: 'rgb(139,90,43)',
    thatch: 'rgb(194,163,91)',
    grass: 'rgb(122,157,78)',
    tar_paper: 'rgb(61,61,63)',
    gravel: 'rgb(150,142,130)',
    glass: 'rgb(170,198,216)'
};

const DEFAULT_ROOF_PITCH_DEG = 35; // default pitch when a non-flat roof has no size tags

/**
 * Canonicalize roof:shape=* values into the shapes this renderer supports.
 * Unknown values fall back to flat.
 * @param {*} value
 * @returns {string} flat|skillion|gabled|halfhipped|hipped|pyramidal|gambrel|mansard|dome|onion|round|saltbox
 */
function canonicalRoofShape(value) {
    const shape = (value || '').toString().trim().toLowerCase();
    switch (shape) {
        case '':
        case 'flat':
            return 'flat';
        case 'skillion':
        case 'mono_pitched':
        case 'shed':
            return 'skillion';
        case 'gabled':
        case 'gable':
            return 'gabled';
        case 'half-hipped':
        case 'half_hipped':
        case 'halfhipped':
            return 'halfhipped';
        case 'hipped':
        case 'hip':
            return 'hipped';
        case 'pyramidal':
        case 'pyramid':
        case 'conical':
            return 'pyramidal';
        case 'gambrel':
            return 'gambrel';    // approximated as gabled
        case 'mansard':
            return 'mansard';    // approximated as hipped
        case 'dome':
            return 'dome';
        case 'onion':
            return 'onion';
        case 'round':
        case 'circular':
            return 'round';
        case 'saltbox':
            return 'saltbox';    // approximated as gabled with offset ridge
        default:
            console.log(`🏗️ Unknown roof:shape="${value}", rendering flat roof`);
            return 'flat';
    }
}

/**
 * Roof colour per S3DB: roof:colour=* > roof:material=* (as colour) >
 * darkened facade tone so untagged roofs still read as roofs.
 * @param {object} tags
 * @param {Cesium.Color} facadeColor
 * @returns {Cesium.Color}
 */
function getRoofColor(tags, facadeColor) {
    const explicit = parseOsmtColour(tags['roof:colour']);
    if (explicit) return explicit;
    const material = (tags['roof:material'] || '').toString().trim().toLowerCase();
    if (material && ROOF_MATERIAL_COLORS[material]) {
        const c = parseOsmtColour(ROOF_MATERIAL_COLORS[material]);
        if (c) return c;
    }
    const c = facadeColor.clone();
    return new Cesium.Color(c.red * 0.72, c.green * 0.72, c.blue * 0.72, c.alpha);
}

/**
 * Analyse a footprint (outer ring, lon/lat) to derive the geometry inputs of
 * roof generation: local metric coordinates, ridge axis and spans.
 * @param {Array<Array<number>>} outerLonLat - [[lon,lat], ...] closed ring
 * @returns {object} footprint analysis
 */
function analyzeFootprint(outerLonLat) {
    const pts = outerLonLat.map(ll => [ll[0], ll[1]]);
    let cx = 0, cy = 0;
    pts.forEach(p => { cx += p[0]; cy += p[1]; });
    cx /= pts.length;
    cy /= pts.length;
    const latRad = cy * Math.PI / 180;
    const toLocal = (lon, lat) => [
        (lon - cx) * 111320 * Math.cos(latRad),
        (lat - cy) * 110540
    ];
    const local = pts.map(p => toLocal(p[0], p[1]));

    // Ridge axis: direction of the longest edge of the outline (a good proxy
    // for the main orientation; roof:orientation=across can flip it later).
    let bestLen = -1, bestEdge = [1, 0];
    for (let i = 0; i < local.length - 1; i++) {
        const dx = local[i + 1][0] - local[i][0];
        const dy = local[i + 1][1] - local[i][1];
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > bestLen && len > 0.01) {
            bestLen = len;
            bestEdge = [dx / len, dy / len];
        }
    }
    return {
        centroid: [cx, cy],
        axis: bestEdge,          // along-ridge unit vector (east/north meters)
        toLocal: toLocal,
        local: local
    };
}

/**
 * Compute the roof size following S3DB precedence:
 *   roof:height=* > roof:angle=* (with footprint span) > roof:levels=* x3m >
 *   default pitch of 35 degrees over the eave-to-ridge half span.
 * The result is clamped so the facade always keeps at least 30% of height.
 * @param {object} tags
 * @param {string} shape - canonical roof shape
 * @param {number} totalHeight - building height in meters
 * @param {object} fp - footprint analysis
 * @returns {number} roof height in meters (0 for flat)
 */
function resolveRoofHeight(tags, shape, totalHeight, fp) {
    if (shape === 'flat') return 0;

    // Horizontal spans of the footprint (meters)
    const projections = fp.local.map(p => ({
        t: p[0] * fp.axis[0] + p[1] * fp.axis[1],
        u: -p[0] * fp.axis[1] + p[1] * fp.axis[0]
    }));
    const spanAlong = Math.max(...projections.map(p => p.t)) - Math.min(...projections.map(p => p.t));
    const spanPerp = Math.max(...projections.map(p => p.u)) - Math.min(...projections.map(p => p.u));

    // 1) explicit roof:height
    let roofHeight = parseLengthMeters(tags['roof:height']);

    // 2) implicit via roof:angle (inclination of the sides in degrees)
    if (!isFinite(roofHeight) || roofHeight <= 0) {
        const angle = parseNumber(tags['roof:angle']);
        if (isFinite(angle) && angle > 0 && angle < 90) {
            const tan = Math.tan(angle * Math.PI / 180);
            if (shape === 'skillion') roofHeight = tan * spanAlong;
            else if (shape === 'pyramidal') roofHeight = tan * Math.min(spanAlong, spanPerp) / 2;
            else roofHeight = tan * spanPerp / 2;
        }
    }

    // 3) implicit via roof:levels (floors inside the roof)
    if (!isFinite(roofHeight) || roofHeight <= 0) {
        const roofLevels = parseNumber(tags['roof:levels']);
        if (isFinite(roofLevels) && roofLevels > 0) roofHeight = roofLevels * 3.0;
    }

    // 4) default pitch (35 degrees) over the eave-to-ridge span
    if (!isFinite(roofHeight) || roofHeight <= 0) {
        if (shape === 'skillion') roofHeight = 0.25 * spanAlong;
        else if (shape === 'dome' || shape === 'onion' || shape === 'round') roofHeight = 0.5 * spanPerp;
        else roofHeight = Math.tan(DEFAULT_ROOF_PITCH_DEG * Math.PI / 180) * spanPerp / 2;
        roofHeight = Math.max(1.5, Math.min(8, roofHeight));
    }

    // Conflict guard: the roof can never eat more than 70% of the building
    roofHeight = Math.min(roofHeight, totalHeight * 0.7);
    return Math.max(0, roofHeight);
}

/**
 * Distance from point p to segment a-b in the t/u plane (meters)
 */
function distToSegment(px, py, ax, ay, bx, by) {
    const abx = bx - ax, aby = by - ay;
    const len2 = abx * abx + aby * aby;
    if (len2 < 1e-9) {
        const dx = px - ax, dy = py - ay;
        return Math.sqrt(dx * dx + dy * dy);
    }
    let t = ((px - ax) * abx + (py - ay) * aby) / len2;
    t = Math.max(0, Math.min(1, t));
    const dx = px - (ax + abx * t), dy = py - (ay + aby * t);
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Compute the roof surface height of every outline vertex, depending on shape.
 * @param {string} shape
 * @param {object} fp - footprint analysis
 * @param {number} eaveAbs - absolute height of the eave (facade top)
 * @param {number} roofHeight
 * @param {object} tags - for roof:orientation / roof:direction
 * @returns {object} { vertexHeights, centroidHeight } absolute meters
 */
function computeRoofVertexHeights(shape, fp, eaveAbs, roofHeight, tags) {
    const local = fp.local;

    // Ridge axis: roof:orientation=across flips to the shortest side;
    // roof:direction (compass degrees) overrides for skillion slopes.
    let axis = fp.axis.slice();
    if (shape === 'skillion') {
        const dirDeg = parseNumber(tags['roof:direction']);
        if (isFinite(dirDeg)) {
            // Direction the main face looks at; the roof rises away from it.
            const rad = dirDeg * Math.PI / 180;
            const dx = Math.sin(rad), dy = Math.cos(rad); // compass -> east/north
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            axis = [-dx / len, -dy / len]; // rise towards the back
        }
    } else if ((tags['roof:orientation'] || '').toString().trim().toLowerCase() === 'across') {
        axis = [-fp.axis[1], fp.axis[0]];
    }

    const proj = local.map(p => ({
        t: p[0] * axis[0] + p[1] * axis[1],
        u: -p[0] * axis[1] + p[1] * axis[0]
    }));
    const tMin = Math.min(...proj.map(p => p.t));
    const tMax = Math.max(...proj.map(p => p.t));
    const spanAlong = Math.max(tMax - tMin, 0.01);
    const uMin = Math.min(...proj.map(p => p.u));
    const uMax = Math.max(...proj.map(p => p.u));
    const halfSpanPerp = Math.max((uMax - uMin) / 2, 0.01);

    // Ridge geometry per shape
    let mode = 'line';            // gabled / saltbox / gambrel: ridge line
    let ridgeA = null, ridgeB = null; // hipped / halfhipped / pyramidal: segment
    let ridgeHalf = spanAlong / 2;
    if (shape === 'hipped' || shape === 'mansard') {
        // 45-degree hip assumption: ridge shortened by roof:height at both ends
        ridgeHalf = Math.max(0.1 * spanAlong, (spanAlong - 2 * roofHeight) / 2);
        mode = 'segment';
    } else if (shape === 'halfhipped') {
        ridgeHalf = Math.max(0.1 * spanAlong, (spanAlong - roofHeight) / 2);
        mode = 'segment';
    } else if (shape === 'pyramidal') {
        ridgeHalf = 0;
        mode = 'segment';
    } else if (shape === 'skillion') {
        mode = 'skillion';
    }

    const ridgeMidT = (tMin + tMax) / 2;
    if (mode === 'segment') {
        ridgeA = [ridgeMidT - ridgeHalf, (uMin + uMax) / 2];
        ridgeB = [ridgeMidT + ridgeHalf, (uMin + uMax) / 2];
    }

    // Slope so the roof plane(s) reach the eave at the farthest outline point
    let slope;
    let ridgeU = (uMin + uMax) / 2;
    if (mode === 'segment') {
        if (shape === 'pyramidal') {
            // Apex at the centroid: rise vanishes at the farthest corner
            let maxDist = 0.01;
            proj.forEach(p => {
                const d = distToSegment(p.t, p.u, ridgeA[0], ridgeA[1], ridgeB[0], ridgeB[1]);
                maxDist = Math.max(maxDist, d);
            });
            slope = roofHeight / maxDist;
        } else {
            slope = roofHeight / halfSpanPerp;
        }
    } else if (mode === 'line') {
        // Saltbox: ridge pushed towards one eave (asymmetric slopes)
        if (shape === 'saltbox') ridgeU = ridgeU + 0.2 * (uMax - uMin);
        const maxDist = Math.max(Math.abs(uMin - ridgeU), Math.abs(uMax - ridgeU), 0.01);
        slope = roofHeight / maxDist;
    }

    const vertexHeights = proj.map(p => {
        let rise = 0;
        if (mode === 'line') {
            const d = Math.abs(p.u - ridgeU);
            rise = Math.max(0, roofHeight - slope * d);
        } else if (mode === 'segment') {
            const d = distToSegment(p.t, p.u, ridgeA[0], ridgeA[1], ridgeB[0], ridgeB[1]);
            rise = Math.max(0, roofHeight - slope * d);
        } else { // skillion: linear slope along the axis
            rise = roofHeight * (p.t - tMin) / spanAlong;
        }
        return eaveAbs + rise;
    });

    // Centroid height (apex for pyramidal roofs, ridge level elsewhere)
    let centroidRise = roofHeight;
    if (mode === 'segment') {
        const cT = (tMin + tMax) / 2, cU = (uMin + uMax) / 2;
        const d = distToSegment(cT, cU, ridgeA[0], ridgeA[1], ridgeB[0], ridgeB[1]);
        centroidRise = Math.max(0, roofHeight - slope * d);
    } else if (mode === 'skillion') {
        centroidRise = roofHeight * 0.5;
    } else if (mode === 'line' && shape === 'saltbox') {
        centroidRise = Math.max(0, roofHeight - slope * Math.abs((uMin + uMax) / 2 - ridgeU));
    }
    return { vertexHeights: vertexHeights, centroidHeight: eaveAbs + centroidRise };
}

/**
 * Build a Cesium geometry made of raw triangles
 * @param {Array<number>} positionsFlat - [x,y,z, x,y,z, ...]
 * @param {Array<number>} indices - triangle indices
 * @returns {Cesium.Geometry|null}
 */
function createTriangleMeshGeometry(positionsFlat, indices) {
    if (!indices || indices.length < 3) return null;
    const cartesians = [];
    for (let i = 0; i < positionsFlat.length; i += 3) {
        cartesians.push(new Cesium.Cartesian3(positionsFlat[i], positionsFlat[i + 1], positionsFlat[i + 2]));
    }
    return new Cesium.Geometry({
        attributes: {
            position: new Cesium.GeometryAttribute({
                componentDatatype: Cesium.ComponentDatatype.DOUBLE,
                componentsPerAttribute: 3,
                values: new Float64Array(positionsFlat)
            })
        },
        indices: new Uint32Array(indices),
        primitiveType: Cesium.PrimitiveType.TRIANGLES,
        boundingSphere: Cesium.BoundingSphere.fromPoints(cartesians)
    });
}

/**
 * Get the Cesium scene from the active OLCesium instance
 * @returns {Cesium.Scene|null}
 */
function getCesiumScene() {
    if (ol3dInstance && ol3dInstance.getCesiumScene) return ol3dInstance.getCesiumScene();
    if (window.ol3d && window.ol3d.getCesiumScene) return window.ol3d.getCesiumScene();
    return null;
}

/**
 * Find (or lazily look up) the 'Buildings' CustomDataSource in the scene
 * @returns {Cesium.CustomDataSource|null}
 */
function getBuildingsDataSource() {
    const holder = (ol3dInstance && ol3dInstance.getDataSources) ? ol3dInstance
        : (window.ol3d && window.ol3d.getDataSources) ? window.ol3d : null;
    if (!holder) return null;
    const dataSources = holder.getDataSources();
    for (let i = 0; i < dataSources.length; i++) {
        if (dataSources.get(i).name === 'Buildings') return dataSources.get(i);
    }
    // Lazily create so roof caps/domes always have a home even when callers
    // create wall entities before creating the data source (index.js does
    // exactly that for the walls).
    try {
        const ds = new Cesium.CustomDataSource('Buildings');
        dataSources.add(ds);
        return ds;
    } catch (e) {
        return null;
    }
}

/* ------------------------------------------------------------------ */
/* Building translucency (used by the indoor 3D view): with walls      */
/* see-through, indoor volumes become readable, and facade windows     */
/* drawn on the translucent walls read like a building texture.        */
/* ------------------------------------------------------------------ */
let translucentBuildings = false;           // indoor-view state
const savedBuildingMaterials = new Map();   // entity -> saved appearance

/**
 * Iterate EVERY building wall entity — not just the buildingEntities map.
 * Entities created by index.js / geojson_loader live in the 'Buildings'
 * dataSource without being registered in the map, so mode switches missed
 * them before (visible walls while L-1 should hide everything).
 * cb receives (entity, feature|null).
 */
function forEachBuildingWallEntity(cb) {
    const seen = new Set();
    const ds = getBuildingsDataSource();
    if (ds && ds.entities) {
        const list = ds.entities.values.slice();
        for (let i = 0; i < list.length; i++) {
            const e = list[i];
            if (e && e.polygon && !seen.has(e)) { seen.add(e); cb(e, null); }
        }
    }
    buildingEntities.forEach((entity, feature) => {
        if (entity && entity.polygon && !seen.has(entity)) { seen.add(entity); cb(entity, feature); }
    });
}

/** True when a building entity sits below ground (layer < 0). */
function entityIsUnderground(entity, feature) {
    const data = feature && feature.get ? feature.get('extrudedBuilding') : null;
    if (data && data.layerOffset !== undefined) return data.layerOffset < 0;
    if (entity.properties) {
        try {
            const v = entity.properties.getValue(Cesium.JulianDate.now());
            const t = v && v.buildingTags;
            const ln = t ? parseFloat(t.layer) : NaN;
            if (isFinite(ln)) return ln < 0;
        } catch (e) { /* fall through */ }
    }
    return false;
}

/**
 * Extract the effective wall Color from whatever the entity descriptor holds:
 * a raw Color, a Color wrapped in a ConstantProperty (entity descriptors wrap
 * raw values — reading .withAlpha/.red off the wrapper was the bug that kept
 * walls opaque), or a ColorMaterialProperty (material = Color at creation).
 * @returns {Cesium.Color|null}
 */
function resolveEntityColor(prop) {
    if (!prop) return null;
    if (typeof Cesium.Color !== 'undefined' && prop instanceof Cesium.Color) return prop.clone();
    if (typeof Cesium.ColorMaterialProperty !== 'undefined' && prop instanceof Cesium.ColorMaterialProperty) {
        const inner = prop.color;
        if (inner && typeof inner.getValue === 'function') {
            try { const v = inner.getValue(Cesium.JulianDate.now()); return (v && v.red !== undefined) ? v.clone() : null; }
            catch (e) { return null; }
        }
        return null;
    }
    // ConstantProperty / any Property evaluating to a Color
    if (typeof prop.getValue === 'function') {
        try { const v = prop.getValue(Cesium.JulianDate.now()); return (v && v.red !== undefined) ? v.clone() : null; }
        catch (e) { return null; }
    }
    return null;
}

/**
 * Apply (or restore) wall translucency on ONE building entity. Extracted so
 * both the bulk toggle below and the per-entity sync (indoor.syncBuildingEntity,
 * for buildings created/rebuilt while the indoor view is already on) share the
 * same logic — the previous in-line version mis-handled the material shapes
 * Cesium actually stores (ConstantProperty / ColorMaterialProperty vs raw
 * Color), which left new walls 100% opaque grey even with the indoor view on.
 * @param {Cesium.Entity} entity
 * @param {boolean} translucent true = make see-through, false = restore saved
 * @returns {boolean} true when the entity was touched
 */
function applyWallTranslucency(entity, translucent) {
    if (!entity || !entity.polygon) return false;
    if (translucent) {
        if (!savedBuildingMaterials.has(entity)) {
            savedBuildingMaterials.set(entity, {
                material: entity.polygon.material,
                color: entity.polygon.color,
                outlineColor: entity.polygon.outlineColor
            });
        }
        const base = savedBuildingMaterials.get(entity);
        let c = resolveEntityColor(base.color);
        if (!c) {
            const matColor = base.material && base.material.color;
            c = resolveEntityColor(matColor) || resolveEntityColor(base.material);
        }
        if (!c) c = Cesium.Color.WHITE;
        // Assigning a raw Color re-wraps it in a ColorMaterialProperty —
        // the one assignment that reliably changes the rendered alpha.
        entity.polygon.material = c.withAlpha(0.30);
        return true;
    }
    const saved = savedBuildingMaterials.get(entity);
    if (saved) {
        entity.polygon.material = saved.material;
        entity.polygon.color = saved.color;
        entity.polygon.outlineColor = saved.outlineColor;
        savedBuildingMaterials.delete(entity);
    }
    return true;
}

function setBuildingsTranslucent(enabled) {
    translucentBuildings = !!enabled;
    let count = 0;
    forEachBuildingWallEntity((entity) => {
        if (!entity || !entity.polygon) return;
        if (applyWallTranslucency(entity, translucentBuildings)) count++;
    });
    // Roof primitives (pitched roofs / caps / domes) are Cesium Primitives,
    // not Entities: toggle per-instance alpha so they match the walls.
    const scene = getCesiumScene();
    roofVisuals.forEach(visuals => {
        visuals.forEach(v => {
            if (!v || v.kind !== 'primitive' || !v.ref) return;
            const attrs = v.ref.getGeometryInstanceAttributes && v.ref.getGeometryInstanceAttributes('color');
            if (attrs && attrs.color) {
                if (!v._savedColor) v._savedColor = attrs.color.slice();
                const c = Cesium.Color.fromBytes(attrs.color[0], attrs.color[1], attrs.color[2]);
                const withA = c.withAlpha(translucentBuildings ? 0.30 : (v._savedAlpha || 1.0));
                v.ref.getGeometryInstanceAttributes('color').color =
                    Cesium.ColorGeometryInstanceAttribute.toValue(withA);
            }
        });
    });
    console.log(`🏗️ Building translucency ${translucentBuildings ? 'ON' : 'OFF'} (${count} entities)`);
}

function setBuildingOpacity(alpha) {
    const clamped = Math.max(0, Math.min(1, alpha));
    forEachBuildingWallEntity((entity) => {
        if (!entity || !entity.polygon) return;
        const base = savedBuildingMaterials.get(entity);
        if (base && base.color) {
            entity.polygon.color = base.color.withAlpha(clamped);
            entity.polygon.material = base.color.withAlpha(clamped);
        }
    });
}

/**
 * Build the roof primitive (surface + vertical wall fill strips) for pitched
 * roofs. Wall fill strips close the gap between the flat wall top (facade
 * height) and the sloped roof surface — they render the gable ends of gabled
 * roofs and the raised walls of skillions in the facade colour.
 * @param {object} params
 * @returns {Cesium.Primitive|null}
 */
function buildRoofPrimitive(params) {
    const { outerLonLat, vertexHeights, centroidHeight, eaveAbs, roofColor, facadeColor } = params;
    if (!outerLonLat || outerLonLat.length < 3 || !isFinite(eaveAbs)) return null;

    const surfacePos = [];
    const surfaceIdx = [];
    const wallPos = [];
    const wallIdx = [];
    const ring = outerLonLat;
    const n = ring.length - 1; // last vertex repeats the first

    // Roof surface: triangle fan around the centroid
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const centroidIdx = surfacePos.length / 3;
    surfacePos.push(cx, cy, centroidHeight);
    for (let i = 0; i < n; i++) {
        const a = surfacePos.length / 3;
        surfacePos.push(ring[i][0], ring[i][1], vertexHeights[i]);
        const b = surfacePos.length / 3;
        surfacePos.push(ring[i + 1][0], ring[i + 1][1], vertexHeights[i + 1]);
        surfaceIdx.push(centroidIdx, a, b);
    }

    // Wall fill strips between facade top (eave) and roof surface
    for (let i = 0; i < n; i++) {
        const hA = vertexHeights[i], hB = vertexHeights[i + 1];
        if (hA - eaveAbs < 0.02 && hB - eaveAbs < 0.02) continue; // degenerate (eave edge)
        const base = wallPos.length / 3;
        wallPos.push(
            ring[i][0], ring[i][1], eaveAbs,
            ring[i + 1][0], ring[i + 1][1], eaveAbs,
            ring[i + 1][0], ring[i + 1][1], hB,
            ring[i][0], ring[i][1], hA
        );
        wallIdx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    const roofGeom = createTriangleMeshGeometry(surfacePos, surfaceIdx);
    const wallGeom = createTriangleMeshGeometry(wallPos, wallIdx);
    if (!roofGeom && !wallGeom) return null;

    const instances = [];
    if (roofGeom) {
        instances.push(new Cesium.GeometryInstance({
            geometry: roofGeom,
            attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(roofColor) }
        }));
    }
    if (wallGeom) {
        instances.push(new Cesium.GeometryInstance({
            geometry: wallGeom,
            attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(facadeColor) }
        }));
    }

    const scene = getCesiumScene();
    if (!scene) return null;
    const primitive = scene.primitives.add(new Cesium.Primitive({
        geometryInstances: instances,
        appearance: new Cesium.PerInstanceColorAppearance({
            flat: true,        // no lighting artifacts on hand-built triangles
            closed: false,     // render both faces
            // translucent:true lets the indoor view fade these (the gable-end
            // wall strips ARE walls); alpha=1 renders identically to opaque.
            translucent: true
        }),
        asynchronous: false
    }));
    return primitive;
}

/**
 * Track a roof visual (primitive or entity) for later removal
 */
function addRoofVisual(feature, kind, ref) {
    if (!feature || !ref) return;
    if (!roofVisuals.has(feature)) roofVisuals.set(feature, []);
    roofVisuals.get(feature).push({ kind: kind, ref: ref });
}

/**
 * Remove every roof visual (primitives/entities) created for a feature
 * @param {ol.Feature} feature
 */
function removeBuildingVisuals(feature) {
    const visuals = roofVisuals.get(feature);
    if (!visuals) return;
    const scene = getCesiumScene();
    visuals.forEach(v => {
        try {
            if (v.kind === 'primitive' && scene && scene.primitives) {
                scene.primitives.remove(v.ref);
            } else if (v.kind === 'entity' && v.ref) {
                const ds = getBuildingsDataSource();
                if (ds && ds.entities) ds.entities.remove(v.ref);
            }
        } catch (e) { /* already destroyed */ }
    });
    roofVisuals.delete(feature);
}

/**
 * Classify special building:part values that need adjusted volumes
 * @param {object} tags
 * @returns {string|null} 'canopy' | 'column' | 'steps' | 'corridor' | null
 */
function getPartKind(tags) {
    const value = (tags['building:part'] || '').toString().trim().toLowerCase();
    switch (value) {
        case 'roof':
        case 'porch':
        case 'balcony':
            return 'canopy';   // roof structure with no (or short) vertical walls
        case 'column':
            return 'column';   // slim supporting pillar
        case 'steps':
        case 'staircase':
            return 'steps';    // low stair volume
        case 'corridor':
            return 'corridor'; // connecting passage (ground or sky bridge)
        default:
            return null;
    }
}

/**
 * Default volume height for special building:part values when no height=*
 * or building:levels=* is tagged
 * @param {string} partKind
 * @returns {number} meters
 */
function getPartDefaultHeight(partKind) {
    switch (partKind) {
        case 'canopy': return 1.5;
        case 'column': return 4.0;
        case 'steps': return 3.0;
        case 'corridor': return 3.0;
        default: return 10;
    }
}

/**
 * Point in polygon (ray casting) on a lon/lat ring
 * @param {Array<number>} point - [lon, lat]
 * @param {Array<Array<number>>} ring
 * @returns {boolean}
 */
function pointInPolygon(point, ring) {
    let inside = false;
    const x = point[0], y = point[1];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }
    return inside;
}

/**
 * Register a building:part footprint so outlines containing it are skipped
 * @param {ol.Feature} feature
 * @param {Array<Array<number>>} outerLonLat - [[lon,lat], ...] outer ring
 */
function registerBuildingPart(feature, outerLonLat) {
    if (!feature || !outerLonLat || outerLonLat.length < 3) return;
    if (registeredPartFeatures.has(feature)) return;
    registeredPartFeatures.add(feature);
    if (buildingPartRegistry.length > 5000) return; // safety cap

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let cx = 0, cy = 0;
    outerLonLat.forEach(ll => {
        cx += ll[0]; cy += ll[1];
        minX = Math.min(minX, ll[0]); maxX = Math.max(maxX, ll[0]);
        minY = Math.min(minY, ll[1]); maxY = Math.max(maxY, ll[1]);
    });
    const entry = {
        feature: feature,
        centroid: [cx / outerLonLat.length, cy / outerLonLat.length],
        bbox: [minX, minY, maxX, maxY]
    };
    buildingPartRegistry.push(entry);

    // Retroactive: if an outline entity was already created for a building
    // that contains this part, remove it (outline is not rendered in 3D).
    disableConflictingOutlinesForPart(entry);
}

/**
 * Register all building:part features of a list before processing outlines.
 * Call this as a first pass so outline conflict detection is order-independent.
 * @param {Array<ol.Feature>} features
 */
function registerBuildingPartsFromFeatures(features) {
    if (!features || !features.forEach) return;
    features.forEach(feature => {
        try {
            if (registeredPartFeatures.has(feature)) return;
            const tags = {};
            feature.getKeys().forEach(key => {
                if (key !== 'geometry' && key !== 'extrudedBuilding') {
                    tags[key] = feature.get(key);
                }
            });
            const partValue = tags['building:part'];
            if (!partValue || partValue === 'no') return;
            const geometry = feature.getGeometry();
            if (!geometry) return;
            const geomType = geometry.getType();
            if (geomType !== 'Polygon' && geomType !== 'MultiPolygon') return;
            const rings = (geomType === 'Polygon') ? geometry.getCoordinates() : geometry.getCoordinates()[0];
            if (!rings || !rings[0] || rings[0].length < 3) return;
            const outerLonLat = rings[0].map(coord =>
                ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326'));
            registerBuildingPart(feature, outerLonLat);
        } catch (e) { /* skip unprojectable part */ }
    });
}

/**
 * Does this outline contain any registered building:part?
 * @param {Array<Array<number>>} outerLonLat
 * @returns {boolean}
 */
function outlineHasPartConflict(outerLonLat) {
    if (!outerLonLat || buildingPartRegistry.length === 0) return false;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    outerLonLat.forEach(ll => {
        minX = Math.min(minX, ll[0]); maxX = Math.max(maxX, ll[0]);
        minY = Math.min(minY, ll[1]); maxY = Math.max(maxY, ll[1]);
    });
    for (const part of buildingPartRegistry) {
        const b = part.bbox;
        if (b[2] < minX || b[0] > maxX || b[3] < minY || b[1] > maxY) continue;
        if (pointInPolygon(part.centroid, outerLonLat)) return true;
    }
    return false;
}

/**
 * Remove already-created outline entities that contain the given part
 * @param {object} partEntry - registry entry from registerBuildingPart
 */
function disableConflictingOutlinesForPart(partEntry) {
    if (buildingEntities.size === 0) return;
    const toDisable = [];
    buildingEntities.forEach((entity, feature) => {
        try {
            const buildingData = feature.get('extrudedBuilding');
            if (!buildingData || !buildingData.tags) return;
            if (buildingData.tags['building:part']) return; // parts are kept
            if (!buildingData.tags.building) return;        // outlines only
            const positions = buildingData.positions;
            if (!positions || !positions.length) return;
            // Recover the lon/lat ring from the Cartesian3 positions
            const ring = positions.map(p => {
                const carto = Cesium.Cartographic.fromCartesian(p);
                return [Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude)];
            });
            const b = partEntry.bbox;
            let inBox = false;
            for (const ll of ring) {
                if (ll[0] >= b[0] && ll[0] <= b[2] && ll[1] >= b[1] && ll[1] <= b[3]) { inBox = true; break; }
            }
            if (!inBox) return;
            if (!pointInPolygon(partEntry.centroid, ring)) return;
            toDisable.push(feature);
        } catch (e) { /* skip */ }
    });
    toDisable.forEach(feature => {
        const entity = buildingEntities.get(feature);
        if (entity && window.ol3d && window.ol3d.getDataSources) {
            const dataSources = window.ol3d.getDataSources();
            for (let i = 0; i < dataSources.length; i++) {
                const ds = dataSources.get(i);
                if (ds.name === 'Buildings' && ds.entities) {
                    ds.entities.remove(entity);
                    break;
                }
            }
        }
        buildingEntities.delete(feature);
        feature.set('extrudedBuilding', undefined);
        feature.set('buildingExtrusionDisabled', 'overlapping building:part');
        console.log('🏗️ Conflict: building outline overlaps a building:part — outline extrusion disabled');
    });
}

/**
 * Check if a feature represents a building
 * @param {object} tags - OSM tags object
 * @returns {boolean} True if the feature is a building
 */
function isBuildingFeature(tags) {
    return tags && (tags.building || tags['building:part']);
}

/**
 * Get building color/material based on tags
 * @param {object} tags - OSM tags object
 * @returns {Cesium.Color} Cesium color object
 */
function getBuildingColor(tags) {
    if (!tags) {
        return Cesium.Color.GRAY;
    }

    // Different colors for different building types (building:part value wins:
    // a building:part=roof colours like a roof part, per the wiki examples)
    const buildingType = tags['building:part'] || tags.building;
    switch (buildingType) {
        case 'residential':
        case 'apartments':
        case 'house':
            return Cesium.Color.LIGHTBLUE;
        case 'commercial':
        case 'retail':
        case 'office':
            return Cesium.Color.LIGHTGREEN;
        case 'industrial':
            return Cesium.Color.ORANGE;
        case 'school':
        case 'university':
        case 'hospital':
            return Cesium.Color.YELLOW;
			case 'triumphal_arch':
        case 'church':
        case 'cathedral':
        case 'chapel':
            return Cesium.Color.LIGHTSLATEGRAY;
        case 'yes':
        default:
            return Cesium.Color.GRAY;
    }
}

/**
 * Get building height from OSM tags
 * @param {object} tags - OSM tags object
 * @returns {number} Building height in meters, default 10m if not specified
 */
function getBuildingHeight(tags) {
    if (!tags) return 10;

    // Check various height-related tags
    const heightTags = ['height', 'building:height', 'estimated_height'];
    for (const tag of heightTags) {
        if (tags[tag]) {
            const height = parseFloat(tags[tag]);
            if (!isNaN(height) && height > 0) {
                return height;
            }
        }
    }

    // Check levels and estimate height (assuming ~3m per level)
    const levelsTags = ['building:levels', 'levels'];
    for (const tag of levelsTags) {
        if (tags[tag]) {
            const levels = parseFloat(tags[tag]);
            if (!isNaN(levels) && levels > 0) {
                return levels * 3.0; // Rough estimate: 3 meters per level
            }
        }
    }

    // Default height for generic buildings
    return 10;
}

/**
 * Create extruded 3D building geometry from a building feature
 * @param {ol.Feature} feature - OpenLayers feature with building geometry
 * @param {object} tags - OSM tags object
 * @returns {object} Building data object
 */
function createExtrudedBuilding(feature, tags) {
    if (!isBuildingFeature(tags)) {
        return null;
    }

    const geometry = feature.getGeometry();
    if (!geometry) {
        console.warn('Building feature has no geometry');
        return null;
    }

    // Only handle polygon geometries (building footprints)
    const geometryType = geometry.getType();
    if (geometryType !== 'Polygon' && geometryType !== 'MultiPolygon') {
        console.log(`Skipping building with geometry type: ${geometryType}`);
        return null;
    }

    try {
        // Get building height
        let height = getBuildingHeight(tags);

        // --- building:part conflicts (Key:building:part / Simple 3D Buildings) ---
        // A feature that already carries a 3D model keeps the model, no extrusion
        if (feature && feature.get && feature.get('model')) {
            console.log('🏗️ Skipping extrusion: feature already has a 3D model assigned');
            return null;
        }
        // Underground buildings are never extruded
        if (((tags.location || '') + '').toLowerCase() === 'underground') {
            console.log('🏗️ Skipping underground building (location=underground)');
            return null;
        }
        // Previously disabled (outline overlapped by a building:part, etc.)
        if (feature && feature.get && feature.get('buildingExtrusionDisabled')) {
            return null;
        }
        // Special building:part values get sensible default volumes when no
        // height/building:levels are tagged (roof/porch/balcony = canopy slab,
        // column = slim pillar, steps/staircase = low stair volume)
        const partKind = getPartKind(tags);
        if (partKind && !tags.height && !tags['building:levels']) {
            height = getPartDefaultHeight(partKind);
            console.log(`🏗️ building:part=${tags['building:part']}: default height ${height}m`);
        }

        console.log(`🏗️ Creating extruded building with height: ${height}m`);

        // Get coordinates in the correct format for Cesium
        let coordinates;
        if (geometryType === 'Polygon') {
            coordinates = geometry.getCoordinates();
        } else if (geometryType === 'MultiPolygon') {
            // For multi-polygons, use the largest polygon
            const polygons = geometry.getCoordinates();
            coordinates = polygons.reduce((largest, current) =>
                current[0].length > largest[0].length ? current : largest
            );
        }

        if (!coordinates || coordinates.length === 0) {
            console.warn('No valid coordinates found for building');
            return null;
        }

        // Convert coordinates to WGS84 lon/lat first
        const lonLatRing = [];
        for (const ring of coordinates) {
            for (const coord of ring) {
                // coord is [x, y] in map projection, need to convert to WGS84
                lonLatRing.push(ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326'));
            }
        }

        // Conflict rule from Simple 3D Buildings / Key:building:part: when a
        // building outline contains building:part=* areas, the outline is NOT
        // extruded in 3D — the parts carry the real volumes.
        const outerLonLat = coordinates[0].map(coord =>
            ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326'));
        const isPart = !!tags['building:part'];
        if (!isPart && outlineHasPartConflict(outerLonLat)) {
            console.log('🏗️ Conflict: building outline contains building:part area(s) — outline extrusion disabled');
            if (feature && feature.set) feature.set('buildingExtrusionDisabled', 'contains building:part');
            return null;
        }
        if (isPart) registerBuildingPart(feature, outerLonLat);

        // Vertical placement of this part: min_height=* / building:min_level=*
        // lift the base above ground (bridges, arches, overhangs) and layer=*
        // stacks overlapping volumes (layer=-1 sinks underground parts).
        const baseOffset = getBaseOffsetMeters(tags);
        const layerOffset = getLayerOffsetMeters(tags);
        if (height - baseOffset < 0.5) {
            console.log(`🏗️ Conflict: min_height (${baseOffset.toFixed(1)}m) >= height (${height.toFixed(1)}m) — extrusion disabled`);
            if (feature && feature.set) feature.set('buildingExtrusionDisabled', 'min_height >= height');
            return null;
        }

        // Roof size per S3DB: facade height = height - roof:height (there is no
        // building:height tag). Sized via roof:height / roof:angle / roof:levels.
        const fp = analyzeFootprint(outerLonLat);
        let roofShape = canonicalRoofShape(tags['roof:shape']);
        let roofHeight = resolveRoofHeight(tags, roofShape, height, fp);
        let facadeTop = height - roofHeight;
        if (roofShape !== 'flat' && facadeTop < 1) {
            // Conflict: roof taller than the building -> disable the roof only
            console.log('🏗️ Conflict: roof:height consumes the whole height= of the building — roof disabled, rendered flat');
            roofShape = 'flat';
            roofHeight = 0;
            facadeTop = height;
        }
        const roofColorExplicit = !!(tags['roof:colour'] ||
            ROOF_MATERIAL_COLORS[(tags['roof:material'] || '').toString().trim().toLowerCase()]);

        // Per-vertex DEM ground (MapTerhorn / GeoTIFF): each footprint corner
        // samples the DEM grid EXACTLY (no neighborhood averaging) — the same
        // grid the terrain provider renders from — so the base matches the
        // visible surface. Walls are extended 0.5m BELOW the sampled base, so
        // the buried skirt absorbs any residual convexity between corners.
        let groundElevation = 0;          // mean ground (kept for API compat)
        let groundMax = 0;                // highest base corner
        let baseRelief = 0;
        let perVertexHeights = null;
        if (window.terrainManager && window.terrainManager.getElevation && lonLatRing.length > 0) {
            try {
                const samples = (window.mapterhornTerrain && window.mapterhornTerrain.getGroundSamples)
                    ? window.mapterhornTerrain.getGroundSamples(lonLatRing, {
                        // Sample the RENDERED ground surface — the same layer
                        // draped textures and ground-clamped models sit on.
                        // Fall back to the DEM sampling grid only while the
                        // globe tile under the building is still loading.
                        sampler: (lon, lat) => {
                            const globe = (window.mapterhornTerrain._globeElevation)
                                ? window.mapterhornTerrain._globeElevation(lon, lat) : null;
                            if (globe !== null && globe !== undefined && isFinite(globe)) return globe;
                            return window.terrainManager.getElevation(lon, lat);
                        },
                        smoothMeters: 0, // exact per-corner alignment, skirt covers convexity
                        lift: 0
                    })
                    : null;
                if (samples) {
                    groundMax = samples.max;
                    groundElevation = samples.mean;
                    baseRelief = samples.max - samples.min;
                    perVertexHeights = samples.heights.map(h => h - BUILDING_SKIRT_METERS);
                } else {
                    const g = window.terrainManager.getElevation(lonLatRing[0][0], lonLatRing[0][1]);
                    if (g !== null && g !== undefined && isFinite(g)) groundElevation = g;
                    groundMax = groundElevation;
                }
            } catch (e) { /* DEM not ready yet - keep 0 */ }
        }

        const cesiumPositions = lonLatRing.map((lonLat, i) =>
            Cesium.Cartesian3.fromDegrees(lonLat[0], lonLat[1],
                (perVertexHeights ? perVertexHeights[i % perVertexHeights.length] : groundElevation)
                    + baseOffset + layerOffset));

        // Get building color (building:colour=* / building:material=* when tagged)
        const color = getFacadeColor(tags);

        // Create building data object
        const roofTextureCandidate = tags['roof:texture'];
        const buildingData = {
            positions: cesiumPositions,
            height: height,
            partKind: partKind,
            baseOffset: baseOffset,
            layerOffset: layerOffset,
            outerLonLat: outerLonLat,
            roofShape: roofShape,
            roofHeight: roofHeight,
            facadeTop: facadeTop,
            roofColor: getRoofColor(tags, color),
            roofColorExplicit: roofColorExplicit,
            roofTextureUrl: (roofTextureCandidate && isTextureUrl(roofTextureCandidate)) ? roofTextureCandidate.trim() : null,
            groundElevation: groundElevation,
            groundMax: groundMax,
            baseRelief: baseRelief,
            // Expose per-corner ground heights so repositionBuildingsOnDem() can
            // distinguish "real samples" from a no-data fallback (height 0).
            // Without this, buildings were never rebuilt when DEM tiles refined.
            perVertexHeights: perVertexHeights,
            color: color,
            tags: tags,
            feature: feature
        };

        console.log(`🏗️ Created extruded building with ${cesiumPositions.length} vertices on ground at ${groundElevation.toFixed(1)}m (max ${groundMax.toFixed(1)}m, relief ${baseRelief.toFixed(1)}m, walls skirted below base)`);

        return buildingData;

    } catch (error) {
        console.error('Error creating extruded building:', error);
        return null;
    }
}

/**
 * Create a Cesium entity for a building
 * @param {object} buildingData - Building data from createExtrudedBuilding
 * @returns {Cesium.Entity} Cesium entity for the building
 */
function createBuildingEntity(buildingData, container) {
    try {
        console.log(`🏗️ createBuildingEntity called with:`, buildingData);
        const { positions, height, color, tags } = buildingData;
        const groundElevation = buildingData.groundElevation || 0;
        const groundMax = (buildingData.groundMax !== undefined) ? buildingData.groundMax : groundElevation;
        const layerOffset = buildingData.layerOffset || 0;
        const roofShape = buildingData.roofShape || 'flat';
        const roofHeight = buildingData.roofHeight || 0;
        const facadeTop = (buildingData.facadeTop !== undefined) ? buildingData.facadeTop : height;
        const roofColor = buildingData.roofColor || color;
        const feature = buildingData.feature;

        // Absolute heights (perPositionHeight makes extrudedHeight absolute)
        const topAbs = groundMax + height + layerOffset;
        const facadeAbs = groundMax + facadeTop + layerOffset;
        
        if (!positions || positions.length === 0) {
            console.warn(`🏗️ No positions provided for building entity`);
            return null;
        }
        
        if (!height || height <= 0) {
            console.warn(`🏗️ Invalid height for building entity:`, height);
            return null;
        }

        console.log(`🏗️ Creating entity with ${positions.length} positions, height: ${height}m, color:`, color);

        // Create polygon hierarchy
        const hierarchy = new Cesium.PolygonHierarchy(positions);

        // Create material with better appearance and texture support
        let material;
        
        // Check if a texture IMAGE URL is specified in tags.
        // NOTE: building:material=* is a material NAME (brick, glass...), never
        // a URL — it must not be fed to the Image material.
        const textureTag = tags.texture || tags.building_texture;
        if (textureTag && isTextureUrl(textureTag)) {
            const textureUrl = textureTag;
            console.log(`🏗️ Using texture for building:`, textureUrl);
            
            material = new Cesium.Material({
                fabric: {
                    type: 'Image',
                    uniforms: {
                        image: textureUrl,
                        color: color
                    }
                }
            });
        } else {
            // Use solid color material - ensure color is properly applied
            console.log(`🏗️ Using solid color for building:`, color);
            material = color; // Use color directly as material
        }

        // Flat roofs with an explicit roof colour/texture get a thin separate
        // cap so roof:colour=* / roof:material=* stays visible; otherwise the
        // walls simply close at the top.
        const flatCapOffset = (roofShape === 'flat' && (buildingData.roofColorExplicit || buildingData.roofTextureUrl)) ? 0.06 : 0;
        const wallsTopAbs = (roofShape === 'flat') ? topAbs - flatCapOffset : facadeAbs;

        // Create the entity
        const entity = new Cesium.Entity({
            polygon: {
                hierarchy: hierarchy,
                perPositionHeight: true, // base vertices carry their soft DEM heights
                extrudedHeight: wallsTopAbs, // facade top above the highest base corner (+ layer stacking)
                material: material,
                outline: true,
                outlineColor: Cesium.Color.BLACK, // Black outline for better visibility
                outlineWidth: 1.0,
                // Enable proper lighting and shadows for better appearance
                shadows: Cesium.ShadowMode.ENABLED,
                enableLighting: true
            },
            // Add custom properties for identification
            properties: {
                buildingId: tags.id || `building_${Date.now()}`,
                buildingTags: tags,
                isBuilding: true
            }
        });

        // --- Roof visuals (Simple 3D Buildings roof:* tags) ------------------
        if (roofShape === 'flat') {
            if ((buildingData.roofColorExplicit || buildingData.roofTextureUrl) && buildingData.outerLonLat) {
                // Flat roof cap at the full height, slightly proud of the walls
                const capRing = buildingData.outerLonLat.map(ll =>
                    Cesium.Cartesian3.fromDegrees(ll[0], ll[1], topAbs));
                const target = container || getBuildingsDataSource();
                if (target && target.entities) {
                    addRoofVisual(feature, 'entity', target.entities.add({
                        polygon: {
                            hierarchy: new Cesium.PolygonHierarchy(capRing),
                            perPositionHeight: true,
                            material: buildingData.roofTextureUrl
                                ? new Cesium.Material({ fabric: { type: 'Image', uniforms: { image: buildingData.roofTextureUrl, color: Cesium.Color.WHITE } } })
                                : roofColor,
                            shadows: Cesium.ShadowMode.ENABLED
                        }
                    }));
                }
            }
        } else if ((roofShape === 'dome' || roofShape === 'round' || roofShape === 'onion') && buildingData.outerLonLat) {
            // Half-ellipsoid cap; the buried half hides inside the walls prism.
            const fp = analyzeFootprint(buildingData.outerLonLat);
            const proj = fp.local.map(p => [p[0] * fp.axis[0] + p[1] * fp.axis[1], -p[0] * fp.axis[1] + p[1] * fp.axis[0]]);
            const spanAlong = Math.max(...proj.map(p => p[0])) - Math.min(...proj.map(p => p[0]));
            const spanPerp = Math.max(...proj.map(p => p[1])) - Math.min(...proj.map(p => p[1]));
            const rx = roofShape === 'onion' ? spanAlong * 0.35 : spanAlong / 2;
            const ry = roofShape === 'onion' ? spanPerp * 0.35 : spanPerp / 2;
            const target = container || getBuildingsDataSource();
            if (target && target.entities) {
                addRoofVisual(feature, 'entity', target.entities.add({
                    position: Cesium.Cartesian3.fromDegrees(fp.centroid[0], fp.centroid[1], facadeAbs),
                    ellipsoid: {
                        radii: new Cesium.Cartesian3(Math.max(rx, 0.5), Math.max(ry, 0.5), Math.max(roofHeight, 0.5)),
                        material: roofColor,
                        slicePartitions: 24,
                        stackPartitions: 16,
                        shadows: Cesium.ShadowMode.ENABLED
                    }
                }));
            }
        } else if (roofHeight > 0 && buildingData.outerLonLat) {
            // Pitched shapes: triangle-mesh roof over the facade prism
            const roofVertexData = computeRoofVertexHeights(
                roofShape, analyzeFootprint(buildingData.outerLonLat), facadeAbs, roofHeight, tags);
            const primitive = buildRoofPrimitive({
                outerLonLat: buildingData.outerLonLat,
                vertexHeights: roofVertexData.vertexHeights,
                centroidHeight: roofVertexData.centroidHeight,
                eaveAbs: facadeAbs,
                roofColor: roofColor,
                facadeColor: color
            });
            if (primitive) addRoofVisual(feature, 'primitive', primitive);
        }

        // Register the building data on the feature itself so the DEM re-seat
        // hook can find every building (index.js creates entities without
        // storing extrudedBuilding on the feature).
        if (buildingData.feature) {
            buildingData.feature.set('extrudedBuilding', buildingData);
        }

        // Keep mode-consistent when buildings are created/rebuilt AFTER a mode
        // was enabled (DEM re-seat rebuilds entities as opaque): re-apply the
        // indoor translucency and hide new surface buildings in underground view.
        if (window.indoor && typeof window.indoor.syncBuildingEntity === 'function') {
            try { window.indoor.syncBuildingEntity(entity, layerOffset < 0); } catch (e) { /* noop */ }
        }

        console.log(`🏗️ Created Cesium entity for building with height ${height}m (${roofShape} roof) at position:`, positions[0]); // Log first position for debugging
        return entity;

    } catch (error) {
        console.error('Error creating building entity:', error);
        return null;
    }
}

/**
 * Helper function to process features in a layer for building extrusion
 * @param {ol.layer.Layer} layer - Layer to process
 * @param {Cesium.CustomDataSource} dataSource - Data source to add entities to
 */
function processLayerFeatures(layer, dataSource) {
    const source = layer.getSource();
    if (source && source.getFeatures) {
        const features = source.getFeatures();
        console.log(`🏗️ Processing ${features.length} features in layer for buildings`);

        // Pass 1: register every building:part footprint FIRST so outlines that
        // contain parts are detected no matter which feature comes first.
        registerBuildingPartsFromFeatures(features);
        
        features.forEach((feature, index) => {
            let buildingData = feature.get('extrudedBuilding');
            // Re-check the outline conflict even for cached building data: the
            // outline may have been extruded (e.g. via geojson_loader) BEFORE
            // its building:part areas were registered.
            if (buildingData && buildingData.outerLonLat && !buildingData.tags['building:part']
                    && outlineHasPartConflict(buildingData.outerLonLat)) {
                console.log(`🏗️ Conflict: cached outline for feature ${index} contains building:part — extrusion disabled`);
                const staleEntity = buildingEntities.get(feature);
                if (staleEntity && dataSource && dataSource.entities) {
                    dataSource.entities.remove(staleEntity);
                    buildingEntities.delete(feature);
                }
                feature.set('extrudedBuilding', undefined);
                feature.set('buildingExtrusionDisabled', 'contains building:part');
                buildingData = null;
            }
            if (buildingData) {
                // Check if entity already exists for this feature
                if (!buildingEntities.has(feature)) {
                    console.log(`🏗️ Feature ${index}: Found existing building data, creating entity`);
                    const entity = createBuildingEntity(buildingData, dataSource);
                    if (entity && dataSource && dataSource.entities) {
                        dataSource.entities.add(entity);
                        buildingEntities.set(feature, entity);
                        console.log(`🏗️ Added building entity for feature ${index}`);
                    } else {
                        console.warn(`🏗️ Failed to create entity for feature ${index}:`, entity);
                    }
                } else {
                    console.log(`🏗️ Feature ${index}: Entity already exists`);
                }
            } else {
                // Check if this feature should be extruded as a building
                const tags = {};
                feature.getKeys().forEach(key => {
                    if (key !== 'geometry' && key !== 'extrudedBuilding') {
                        tags[key] = feature.get(key);
                    }
                });
                
                console.log(`🏗️ Feature ${index} tags:`, tags);
                const isBuilding = isBuildingFeature(tags);
                console.log(`🏗️ Feature ${index} isBuilding:`, isBuilding);
                
                if (isBuilding) {
                    console.log(`🏗️ Feature ${index}: Found building feature with tags:`, tags);
                    const buildingOptions = createExtrudedBuilding(feature, tags);
                    console.log(`🏗️ Feature ${index}: Created building options:`, buildingOptions);
                    if (buildingOptions) {
                        feature.set('extrudedBuilding', buildingOptions);
                        const entity = createBuildingEntity(buildingOptions, dataSource);
                        console.log(`🏗️ Feature ${index}: Created entity:`, entity);
                        if (entity && dataSource && dataSource.entities) {
                            dataSource.entities.add(entity);
                            buildingEntities.set(feature, entity);
                            console.log(`🏗️ Created and added building entity for feature ${index}`);
                        } else {
                            console.warn(`🏗️ Failed to add entity for feature ${index}:`, { entity, dataSource, entities: dataSource?.entities });
                        }
                    } else {
                        console.warn(`🏗️ Failed to create building options for feature ${index}`);
                    }
                } else {
                    console.log(`🏗️ Feature ${index}: Not a building, skipping`);
                }
            }
        });
    }
}

/**
 * Re-seat tracked buildings on the DEM ground when new terrain tiles arrive.
 * Building bases are sampled from the rendered surface at creation time; when
 * finer tiles load afterwards the surface can shift, leaving buildings sunk or
 * floating. Rebuilding the entity with fresh DEM samples fixes it.
 */
function repositionBuildingsOnDem() {
    if (buildingEntities.size === 0) return;
    // ol3dInstance may be null when entities were added via processBuildingFeatures;
    // fall back to the global instance so re-seating still works.
    if (!ol3dInstance && window.ol3d && window.ol3d.getDataSources) {
        ol3dInstance = window.ol3d;
    }
    if (!ol3dInstance || !ol3dInstance.getDataSources) return;

    let dataSource = null;
    const dataSources = ol3dInstance.getDataSources();
    for (let i = 0; i < dataSources.length; i++) {
        if (dataSources.get(i).name === 'Buildings') { dataSource = dataSources.get(i); break; }
    }
    if (!dataSource) return;

    let updated = 0;
    buildingEntities.forEach((entity, feature) => {
        try {
            const current = feature.get('extrudedBuilding');
            if (!current || !current.tags || !entity || !entity.polygon) return;

            const fresh = createExtrudedBuilding(feature, current.tags);
            if (!fresh || !isFinite(fresh.groundMax)) return;
            // Never rebuild from a no-data sample (would bury at height 0):
            // perVertexHeights is only set when real DEM samples came back.
            if (!fresh.perVertexHeights) return;

            // Only rebuild when the ground clearly moved (tile refinement);
            // sub-meter shifts are covered by the 0.5m buried walls.
            if (Math.abs(fresh.groundMax - current.groundMax) < 1.0) return;

            removeBuildingVisuals(feature);
            dataSource.entities.remove(entity);
            const rebuilt = createBuildingEntity(fresh, dataSource);
            if (rebuilt) {
                dataSource.entities.add(rebuilt);
                buildingEntities.set(feature, rebuilt);
                feature.set('extrudedBuilding', fresh);
                updated++;
            }
        } catch (e) { /* skip this building */ }
    });

    if (updated > 0) {
        console.log(`🏗️ Re-seated ${updated} building(s) on refined DEM ground`);
    }
}

function addBuildingsToScene(ol3d) {
    if (!ol3d || !ol3d.getDataSources) {
        console.warn('OLCesium instance not available or getDataSources not supported');
        return;
    }

    ol3dInstance = ol3d;

    // Re-seat buildings when DEM terrain tiles arrive after placement
    if (window.mapterhornTerrain && window.mapterhornTerrain.onTilesLoaded && !addBuildingsToScene._demHooked) {
        addBuildingsToScene._demHooked = true;
        window.mapterhornTerrain.onTilesLoaded(function () { repositionBuildingsOnDem(); });
    }
    const dataSources = ol3d.getDataSources();

    // Check if 'Buildings' data source already exists
    let dataSource = null;
    for (let i = 0; i < dataSources.length; i++) {
        const ds = dataSources.get(i);
        if (ds.name === 'Buildings') {
            dataSource = ds;
            break;
        }
    }

    // If no Buildings data source exists, create one
    if (!dataSource) {
        dataSource = new Cesium.CustomDataSource('Buildings');
        dataSources.add(dataSource);
        console.log('🏗️ Created new Buildings data source');
    } else {
        console.log('🏗️ Using existing Buildings data source');
    }

    // Process all features that have building data
    window.map.getLayers().forEach(layer => {
        // Process overlay layers (existing logic) - check if it's a group layer
        if (layer.get('type') === 'overlay' && typeof layer.getLayers === 'function') {
            layer.getLayers().forEach(sublayer => {
                processLayerFeatures(sublayer, dataSource);
            });
        }
        // Process GeoJSON layers (new logic)
        else if (layer instanceof ol.layer.Vector) {
            processLayerFeatures(layer, dataSource);
        }
    });

    console.log(`🏗️ Buildings data source now has ${dataSource.entities.values.length} entities`);
    console.log(`🏗️ Total data sources: ${dataSources.length}`);
}

/**
 * Remove building entities from the Cesium scene
 */
function removeBuildingsFromScene() {
    if (!ol3dInstance) return;

    // Remove roof primitives from the scene before tearing the instance down
    const scene = getCesiumScene();
    roofVisuals.forEach(visuals => {
        visuals.forEach(v => {
            try {
                if (v.kind === 'primitive' && scene && scene.primitives) {
                    scene.primitives.remove(v.ref);
                }
            } catch (e) { /* already destroyed */ }
        });
    });
    roofVisuals.clear();

    const dataSources = ol3dInstance.getDataSources();

    // Remove all building data sources
    for (let i = dataSources.length - 1; i >= 0; i--) {
        const dataSource = dataSources.get(i);
        if (dataSource.name === 'Buildings') {
            dataSources.remove(dataSource, true);
            console.log('🏗️ Removed buildings data source from 3D scene');
            break;
        }
    }

    // Clear the entities map
    buildingEntities.clear();
    ol3dInstance = null;
}

/**
 * Clean up building entities to prevent memory leaks
 * Removes entities when count exceeds limit
 */
function cleanupBuildingEntities() {
    const maxBuildings = 500; // Maximum building entities to keep
    
    if (buildingEntities.size > maxBuildings) {
        console.log(`🏗️ Cleaning up building entities: ${buildingEntities.size} buildings, reducing to ${maxBuildings}`);
        
        if (!ol3dInstance) return;
        
        const dataSources = ol3dInstance.getDataSources();
        let dataSource = null;
        for (let i = 0; i < dataSources.length; i++) {
            const ds = dataSources.get(i);
            if (ds.name === 'Buildings') {
                dataSource = ds;
                break;
            }
        }
        
        if (!dataSource) return;
        
        // Remove oldest entities (first ones in the map)
        const toRemove = buildingEntities.size - maxBuildings;
        let removed = 0;
        
        for (const [feature, entity] of buildingEntities) {
            if (removed >= toRemove) break;
            removeBuildingVisuals(feature);
            dataSource.entities.remove(entity);
            buildingEntities.delete(feature);
            removed++;
        }
        
        console.log(`🏗️ Removed ${removed} building entities`);
    }
}

/**
 * Update building visibility in 3D scene
 * @param {boolean} visible - Whether buildings should be visible
 */
function setBuildingsVisible(visible) {
    buildingEntities.forEach(entity => {
        entity.show = visible;
    });
    roofVisuals.forEach(visuals => {
        visuals.forEach(v => {
            if (v.ref) v.ref.show = visible;
            if (v.ref && v.ref.polyline) v.ref.polyline.show = visible;
            if (v.ref && v.ref.polygon) v.ref.polygon.show = visible;
            if (v.ref && v.ref.wall) v.ref.wall.show = visible;
        });
    });
    console.log(`🏗️ Set building visibility to: ${visible}`);
}

/**
 * Underground view (L-1 button): hide ALL surface buildings (and roof
 * visuals) and show only layer<0 volumes; when disabled, restore the normal
 * view — surface buildings visible, layer<0 parts hidden again.
 * @param {boolean} enabled - true = underground mode, false = normal view
 */
function setUndergroundView(enabled) {
    // Cover every building wall entity (dataSource + registered map) so no
    // unregistered building leaks through in either mode.
    forEachBuildingWallEntity((entity, feature) => {
        const below = entityIsUnderground(entity, feature);
        // Underground mode: keep ONLY layer<0 volumes; normal mode: show only
        // surface volumes (layer>=0).
        entity.show = enabled ? below : !below;
    });
    roofVisuals.forEach((visuals, feature) => {
        const data = feature && feature.get ? feature.get('extrudedBuilding') : null;
        const below = !!(data && data.layerOffset < 0);
        const show = enabled ? below : !below;
        visuals.forEach(v => {
            if (!v || !v.ref) return;
            if (v.ref.show !== undefined) v.ref.show = show;
        });
    });
    console.log(`🏗️ Underground view ${enabled ? 'ON (surface hidden)' : 'OFF (surface restored)'}`);
}

/**
 * Process features and create extruded buildings where applicable
 * @param {Array<ol.Feature>} features - Array of OpenLayers features
 */
function processBuildingFeatures(features) {
    if (!features || !Array.isArray(features)) {
        console.warn('No features provided for building processing');
        return;
    }

    console.log(`🏗️ Processing ${features.length} features for building extrusion`);

    // Pass 1: register building:part footprints first (conflict detection)
    registerBuildingPartsFromFeatures(features);

    let buildingCount = 0;

    features.forEach((feature, index) => {
        try {
            const properties = feature.getProperties();
            const osmTags = Object.keys(properties).filter(prop =>
                !['geometry', 'id', 'type', 'originalType', 'fixedGeometry', 'members', 'memberOf', 'member', 'membership', 'role', 'version', 'timestamp', 'changeset', 'user', 'uid', 'visible'].includes(prop)
            );

            // Collect all OSM tags into an object
            const tagsObj = {};
            osmTags.forEach(tag => {
                tagsObj[tag] = properties[tag];
            });

            // Try to create extruded building
            const buildingData = createExtrudedBuilding(feature, tagsObj);

            if (buildingData) {
                // Store building data on the feature
                feature.set('extrudedBuilding', buildingData);
                feature.set('buildingHeight', buildingData.height);
                feature.set('buildingTags', tagsObj);

                buildingCount++;
                console.log(`🏗️ SUCCESS: Created extruded building ${buildingCount} with height ${buildingData.height}m`);

                // If we're in 3D mode, immediately add the building to the scene
                if (window.ol3d && window.ol3d.getDataSources) {
                    const dataSources = window.ol3d.getDataSources();
                    // Find or create buildings data source
                    let dataSource = null;
                    for (let i = 0; i < dataSources.length; i++) {
                        const ds = dataSources.get(i);
                        if (ds.name === 'Buildings') {
                            dataSource = ds;
                            break;
                        }
                    }
                    if (!dataSource) {
                        dataSource = new Cesium.CustomDataSource('Buildings');
                        dataSources.add(dataSource);
                    }
                    const entity = createBuildingEntity(buildingData);
                    if (entity) {
                        dataSource.entities.add(entity);
                        window.buildings.buildingEntities.set(feature, entity);
                        console.log(`🏗️ Added new building entity to 3D scene from GeoJSON`);
                        
                        // Clean up periodically to prevent memory leaks
                        if (window.buildings.buildingEntities.size % 50 === 0) {
                            window.buildings.cleanupBuildingEntities();
                        }
                    }
                }
            } else {
                // Check if this should have been a building but failed
                if (isBuildingFeature(tagsObj)) {
                    console.log(`🏗️ WARNING: Failed to create extruded building for feature with building tags:`, tagsObj);
                }
            }

        } catch (error) {
            console.error(`Error processing feature ${index + 1} for building extrusion:`, error);
        }
    });

    console.log(`🏗️ Building extrusion complete: ${buildingCount} buildings created from ${features.length} features`);
}

/**
 * Update building extrusion options based on user preferences or dynamic data
 * @param {ol.Feature} feature - Building feature
 * @param {object} options - New options to apply
 */
function updateBuildingExtrusion(feature, options) {
    if (!feature) return;

    const currentBuilding = feature.get('extrudedBuilding');
    if (!currentBuilding) {
        console.warn('Feature does not have extruded building data');
        return;
    }

    // Update the building data
    const updatedBuilding = { ...currentBuilding, ...options };
    feature.set('extrudedBuilding', updatedBuilding);

    // Update individual properties if specified
    if (options.height !== undefined) {
        feature.set('buildingHeight', options.height);
    }

    // Update the Cesium entity if it exists
    const entity = buildingEntities.get(feature);
    if (entity) {
        if (options.height !== undefined) {
            entity.polygon.extrudedHeight = options.height;
        }
        if (options.color) {
            entity.polygon.material = options.color.withAlpha(0.8);
        }
    }

    console.log('🏗️ Updated building extrusion options');
}

window.addEventListener('ol3dInitialized', function(event) {
    console.log('🏗️ 3D mode initialized, adding buildings to scene');
    addBuildingsToScene(event.detail.ol3d);
});

/**
 * Reprocess all layers for buildings (useful when GeoJSON layers are loaded before 3D mode)
 */
function reprocessAllLayersForBuildings() {
    if (!window.map) return;
    
    console.log('🏗️ Reprocessing all layers for buildings');
    window.map.getLayers().forEach(layer => {
        // Process overlay layers - check if it's a group layer
        if (layer.get('type') === 'overlay' && typeof layer.getLayers === 'function') {
            layer.getLayers().forEach(sublayer => {
                processLayerFeatures(sublayer, null);
            });
        }
        // Process GeoJSON layers
        else if (layer instanceof ol.layer.Vector) {
            processLayerFeatures(layer, null);
        }
    });
}

window.addEventListener('ol3dDestroyed', function() {
    console.log('🏗️ 3D mode destroyed, removing buildings from scene');
    removeBuildingsFromScene();
});

// Export functions for use in other modules
window.buildings = {
    buildingEntities, // Add buildingEntities to the export
    isBuildingFeature,
    getBuildingHeight,
    getBuildingColor,
    getFacadeColor,
    getRoofColor,
    getBaseOffsetMeters,
    outlineHasPartConflict,
    canonicalRoofShape,
    createExtrudedBuilding,
    createBuildingEntity,
    addBuildingsToScene,
    removeBuildingsFromScene,
    cleanupBuildingEntities,
    setBuildingsVisible,
    setBuildingsTranslucent,
    applyWallTranslucency,
    setUndergroundView,
    setBuildingOpacity,
    processBuildingFeatures,
    updateBuildingExtrusion,
    reprocessAllLayersForBuildings
};
