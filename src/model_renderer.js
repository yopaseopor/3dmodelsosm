// Model Renderer - Handles 3D model rendering in Cesium
// Moved from index.js to separate file for better organization

// Memory management configuration
const memoryConfig = {
    maxModelsPerFrame: 40,           // Limit models added per frame
    loadDistance: 2500,              // Load models within this distance (meters)
    unloadDistance: 9000,            // Unload models beyond this distance (meters)
    lodDistances: {                  // Level of Detail distances
        high: 200,                    // High detail within 200m
        medium: 500,                  // Medium detail within 500m
        low: 2500                     // Low detail within 2500m
    },
    cameraUpdateThrottle: 100,       // Throttle camera updates (ms)

    // Hard ceiling on live Cesium primitives created by this renderer
    // (GLTF models + repetition models + area-texture primitives).
    //
    // This was `maxTotalModels: 400`, compared against `this.totalModelsAdded`
    // — a counter that NOTHING in the file ever incremented. Its only
    // assignment anywhere was `= 0` on teardown. The cap therefore never fired
    // once, on any file of any size: a >1MB GeoJSON placed every model it could
    // and the two `>= memoryConfig.maxTotalModels` guards were dead code.
    // The budget is now measured from live tracking, which cannot drift.
    //
    // 30000, not 8000, and raised together with the ranges below. With
    // streaming in place the live count is bounded by WHAT IS IN VIEW, not by
    // the size of the file, so a bigger ceiling is affordable. A 5km
    // placement radius over a dense city extract is a lot of models, and the
    // point of the ceiling is to stop a runaway, not to keep the view thin.
    //
    // Override it without editing this file:
    //   ?primitives=60000     in the URL, or
    //   modelRenderer.setBudget(60000)  in the console.
    maxLivePrimitives: 30000,

    // Evict down to this fraction of the budget rather than by one, so the
    // scan that finds the farthest entries is amortised over many placements.
    evictToRatio: 0.9,

    // Placement stops at loadDistance * 2 = 5km and unloading starts at 9km.
    // The gap between them is a hysteresis band: something evicted for being
    // far can never be re-placed on the very next sweep, so eviction cannot
    // thrash. Keep unloadDistance comfortably above this product or the two
    // ranges overlap and a sweep re-creates what the last one just destroyed.
    placementRangeFactor: 2
};

// Feature property holding this renderer's stable internal identity.
//
// The dedupe map (loadedModels) has to survive repeated sweeps: addAllModels()
// is called from six call sites plus a guaranteed +4.5s retry plus the
// tagOverlayLoaded event, and each call walks every feature again. Without a
// key that is the SAME on every sweep, a sweep cannot tell "already placed"
// from "never placed" and duplicates the whole scene.
//
// It used to synthesise `feature_<layerName>_<fidx>_<geometryHash>`, which has
// three problems: addRepetitionModel() is not handed a layer or a feature index
// so it could not build it at all, and geojson_loader.js rebuilt it from
// `geometry.getExtent().join('_')` WITHOUT the rounding the renderer applied —
// so the unload-on-layer-removal path never matched a single key and destroyed
// nothing. OL's per-object uid is stable, unique and needs no arguments, so it
// is what we cache here.
const OSM3D_KEY_PROPERTY = 'osm3dKey';

/** Parse a plain numeric OSM value (levels, layer) */
function parseOsNumber(value) {
    if (value === undefined || value === null || value === '') return NaN;
    if (typeof value === 'number') return isFinite(value) ? value : NaN;
    const match = String(value).trim().replace(',', '.').match(/(-?\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : NaN;
}

function isTunnelFeature(feature) {
    if (!feature || typeof feature.get !== 'function') return false;
    const tunnel = String(feature.get('tunnel') || '').trim().toLowerCase();
    return tunnel === 'yes' && parseOsNumber(feature.get('layer')) === -1;
}

function isUndergroundFeature(feature) {
    if (!feature || typeof feature.get !== 'function') return false;
    const tunnel = String(feature.get('tunnel') || '').trim().toLowerCase();
    return tunnel === 'yes' || parseOsNumber(feature.get('layer')) === -1;
}

function getTunnelElevation() {
    // Treat OSM layer -1 as one storey below a flat, DEM-independent datum.
    return -3;
}

function isUndergroundViewEnabled() {
    return !!(window.indoor && typeof window.indoor.isUndergroundEnabled === 'function' &&
        window.indoor.isUndergroundEnabled());
}

/**
 * Check whether a feature has a positive OSM bridge value.
 * @param {ol.Feature} feature - OpenLayers feature with OSM tags as properties
 * @returns {boolean} True when the feature is tagged as a bridge
 */
function isBridgeFeature(feature) {
    if (!feature || typeof feature.get !== 'function') return false;
    const bridge = feature.get('bridge');
    if (bridge === true || bridge === 1) return true;
    if (typeof bridge !== 'string') return false;
    const value = bridge.trim().toLowerCase();
    return value !== '' && !['no', 'false', '0'].includes(value);
}

function getFeatureKey(feature) {
    if (!feature || typeof feature.get !== 'function') return null;
    const cached = feature.get(OSM3D_KEY_PROPERTY);
    if (cached) return cached;

    let uid = null;
    try { if (typeof feature.getUid === 'function') uid = feature.getUid(); } catch (e) { /* not an OL object */ }
    if ((uid === null || uid === undefined) && typeof ol !== 'undefined' && typeof ol.getUid === 'function') {
        try { uid = ol.getUid(feature); } catch (e) { /* not an OL object */ }
    }
    if (uid === null || uid === undefined) {
        // Last resort: geometry extent. Same weakness the old key had (two
        // coincident features collide), but it is stable, which is what the
        // dedupe actually needs.
        const geometry = feature.getGeometry && feature.getGeometry();
        const hash = geometry && geometry.getExtent
            ? geometry.getExtent().map(c => Math.round(c * 1000000) / 1000000).join('_')
            : 'no_geom';
        uid = 'h' + hash;
    }
    const key = String(uid);
    feature.set(OSM3D_KEY_PROPERTY, key);
    return key;
}

window.OSM3D_KEY_PROPERTY = OSM3D_KEY_PROPERTY;
window.getFeatureKey = getFeatureKey;

/**
 * Has this Cesium primitive already been destroyed?
 *
 * Written as a typeof guard on purpose. The earlier form,
 * `!p.isDestroyed && !p.isDestroyed()`, evaluates `undefined()` on any object
 * without that method, throws, and the surrounding try/catch swallows the
 * throw — so the primitive is never removed from the scene while the caller
 * believes it was. That failure is invisible: the census goes down and the GPU
 * memory does not.
 */
function isPrimitiveDestroyed(p) {
    return !!(p && typeof p.isDestroyed === 'function' && p.isDestroyed());
}

/**
 * Centre of an OL geometry, as lon/lat.
 *
 * The OL geometry is in the VIEW projection (EPSG:3857 metres), not degrees,
 * so it must go through the view transform. Averaging the raw coordinates, or
 * treating them as degrees, puts the point on Null Island — which then fails
 * every range test for the wrong reason.
 */
function areaGeometryCentreLonLat(geometry) {
    if (!geometry || typeof geometry.getExtent !== 'function') return null;
    let centre = null;
    try {
        const extent = geometry.getExtent();
        if (extent && extent.length === 4 && isFinite(extent[0]) && isFinite(extent[2])) {
            centre = ol.extent.getCenter(extent);
        }
    } catch (e) { /* unusable geometry */ }
    if (!centre) return null;
    try {
        const lonLat = ol.proj.toLonLat(centre);
        return (lonLat && isFinite(lonLat[0]) && isFinite(lonLat[1])) ? lonLat : null;
    } catch (e) { /* no view projection */ }
    return null;
}

/** Mean position of a polygon ring, as lon/lat. Used to range-gate an area. */
function areaCentroidLonLat(coordinates) {
    if (!coordinates || !coordinates.length) return null;
    let lon = 0, lat = 0, n = 0;
    for (let i = 0; i < coordinates.length; i++) {
        const c = coordinates[i];
        if (!c || c.length < 2) continue;
        lon += c[0]; lat += c[1]; n++;
    }
    return n ? [lon / n, lat / n] : null;
}

// Import centralized debug configuration
if (typeof window !== 'undefined' && window.globalDebugConfig) {
    var debugConfig = window.globalDebugConfig.modelRenderer;
} else {
    // Fallback debug configuration if centralized config not available
    var debugConfig = {
        enabled: false,
        maxRepetitionLogs: 5,
        logModelLoading: false,
        logRepetitionModels: false,
        logTextureProcessing: false
    };
}

function modelRendererTexLog() {
    return debugConfig.enabled && debugConfig.logTextureProcessing;
}

// ---------------------------------------------------------------------------
// Plain results: query features with no model and no texture
// ---------------------------------------------------------------------------
// These used to be left entirely to ol-cesium's VectorSynchronizer, which
// converts OL geometry straight to Cesium positions at ellipsoid height 0 —
// sea level. With globe.depthTestAgainstTerrain disabled they were not hidden
// underground, so on sloping ground they appeared displaced from the terrain
// ("a few metres", 3D only, points and lines alike). They are markers, not
// models, and they must always lie ON the ground: hills, valleys and inclines
// included. Cesium's ground-conforming primitives do that natively and keep
// following the surface as the DEM tiles refine, so no manual re-seating is
// needed here (unlike the model path, which places an explicit height).
//
//   point   -> Entity + heightReference: CLAMP_TO_GROUND
//   line    -> Entity + polyline.clampToGround
//   area    -> Entity + polygon.heightReference: CLAMP_TO_GROUND
//
// Plain markers keep Cesium's clamp; MODEL primitives deliberately do not (see
// addModelForFeature). The clamp is only honoured for entities/graphics and
// only when the terrain provider exposes `availability`; the MapTerhorn
// provider does not, so on a Model primitive it is a silent no-op.

/** Default marker look when the OL style gives us nothing usable. */
const PLAIN_MARKER_PIXEL_SIZE = 7;
const hasCesium = typeof Cesium !== 'undefined';
const PLAIN_MARKER_COLOR = hasCesium ? Cesium.Color.fromCssColorString('#e6a01a') : null;
const PLAIN_LINE_COLOR = hasCesium ? Cesium.Color.fromCssColorString('#e6a01a').withAlpha(0.9) : null;
const PLAIN_AREA_COLOR = hasCesium ? Cesium.Color.fromCssColorString('#e6a01a').withAlpha(0.25) : null;

/** Best-effort read of the OL style so the 3D marker resembles the 2D one. */
function readPlainStyle(feature, layer) {
    let style = null;
    try { style = feature.getStyle(); } catch (e) { /* no style on the feature */ }
    if (!style && layer && typeof layer.getStyle === 'function') {
        try { style = layer.getStyleFunction()(feature, 0); } catch (e) { /* no layer style */ }
    }
    if (Array.isArray(style)) style = style[0];
    return style || null;
}

/** OL [r,g,b,a] (0-255) -> Cesium.Color, falling back when unusable. */
function olColorToCesium(olColor, fallback) {
    if (!olColor || olColor.length < 3) return fallback;
    return new Cesium.Color(
        olColor[0] / 255, olColor[1] / 255, olColor[2] / 255,
        olColor.length > 3 ? olColor[3] : 1);
}

/**
 * OL coordinates -> Cesium.Cartesian3.
 *
 * OL geometries are in the VIEW projection (EPSG:3857 metres), NOT degrees.
 * Cesium.Cartesian3.fromDegrees() must only ever receive lon/lat — feeding it
 * metres puts everything near null island, which is exactly the "result data
 * is offset" symptom we are fixing. Same transform the model path uses.
 */
function plainCoordsToCartesian(coords) {
    return coords.map(c => {
        const lonLat = ol.proj.toLonLat(c);
        return Cesium.Cartesian3.fromDegrees(lonLat[0], lonLat[1]);
    });
}

/** All vertices of a (possibly nested) OL coordinate array, flattened. */
function plainFlattenCoords(coords, out) {
    out = out || [];
    if (!coords || !coords.length) return out;
    if (typeof coords[0] === 'number') { out.push(coords); return out; }
    for (const c of coords) plainFlattenCoords(c, out);
    return out;
}

/**
 * Feature property holding this app's 3D model descriptor.
 *
 * ol-cesium's VectorSynchronizer interprets a feature property literally named
 * 'model' and creates its OWN Cesium model for it. Storing our descriptor under
 * that name therefore rendered every model twice: once by this renderer
 * (ground-clamped on the DEM, correctly placed) and once by ol-cesium
 * (positioned at height 0, so it appeared to be flying above the terrain).
 *
 * Our descriptor lives under 'osm3dModel', which ol-cesium ignores, so this
 * renderer is the only producer. getFeatureModelOptions() still accepts 'model'
 * for backward compatibility with any feature that already carries it.
 */
const OSM3D_MODEL_PROPERTY = 'osm3dModel';

function getFeatureModelOptions(feature) {
    if (!feature || typeof feature.get !== 'function') return null;
    return feature.get(OSM3D_MODEL_PROPERTY) || feature.get('model') || null;
}

// Expose for modules loaded after this one (repetitions, geojson loader, ...).
window.OSM3D_MODEL_PROPERTY = OSM3D_MODEL_PROPERTY;
window.getFeatureModelOptions = getFeatureModelOptions;

/**
 * Ground elevation (metres) for a lon/lat, from whichever DEM is in use.
 *
 * The local GeoTIFF terrain manager keeps priority when one is loaded, but the
 * MapTerhorn global DEM is what the Cesium globe actually renders when no
 * GeoTIFF is active. Reading only terrainManager meant every model created
 * outside the GeoTIFF workflow (Overpass/tag queries, plain 3D activation)
 * was placed at elevation 0 — i.e. at sea level — until the async
 * `repositionModelsOnDem` hook rescued it. Worse, isPositionVisible /
 * getDistanceFromCamera measured the camera-to-model distance with the same
 * zero elevation, so on a 1200 m mountain the distance was short by the whole
 * elevation and models fell outside lodDistances/unloadDistance and never
 * loaded at all.
 *
 * Returns 0 while the DEM tile is still decoding; the onTilesLoaded hook
 * re-seats the model as soon as the real value is known.
 *
 * @param {number} lon
 * @param {number} lat
 * @returns {number} elevation in metres
 */
function sampleGroundElevation(lon, lat) {
    if (window.terrainManager && window.terrainManager.getElevation) {
        const local = window.terrainManager.getElevation(lon, lat);
        if (local !== null && local !== undefined && isFinite(local)) return local;
    }
    if (window.mapterhornTerrain && window.mapterhornTerrain.getElevation) {
        const dem = window.mapterhornTerrain.getElevation(lon, lat);
        if (dem !== null && dem !== undefined && isFinite(dem)) return dem;
    }
    return 0;
}

const bridgeSurfaceFeatureCache = new WeakMap();
const BRIDGE_SURFACE_MATCH_DISTANCE_METERS = 30;

function findBridgeSurfaceFeature(feature, position) {
    if (!feature || !position || !window.map || !window.modelRenderer) return feature;
    const featureGeometry = feature.getGeometry && feature.getGeometry();
    if (feature.get('highway') && featureGeometry &&
        ['LineString', 'MultiLineString'].includes(featureGeometry.getType())) return feature;
    const cached = bridgeSurfaceFeatureCache.get(feature);
    if (cached) return cached;

    const featureLayer = parseOsNumber(feature.get('layer'));
    const featureLevel = isFinite(featureLayer) ? featureLayer : 0;
    const projection = window.map.getView().getProjection();
    let closest = null;
    let closestDistance = BRIDGE_SURFACE_MATCH_DISTANCE_METERS;
    const layers = window.modelRenderer.getAllMapLayers(window.map.getLayers().getArray());

    for (const layer of layers) {
        const source = layer && layer.getSource && layer.getSource();
        if (!source || !source.getFeatures) continue;
        for (const candidate of source.getFeatures()) {
            if (candidate === feature || !isBridgeFeature(candidate) ||
                !candidate.get('highway')) continue;
            const candidateLayer = parseOsNumber(candidate.get('layer'));
            if ((isFinite(candidateLayer) ? candidateLayer : 0) !== featureLevel) continue;

            const geometry = candidate.getGeometry && candidate.getGeometry();
            if (!geometry || !['LineString', 'MultiLineString'].includes(geometry.getType())) continue;
            let distance = Infinity;
            for (const line of getGeometryLines(geometry)) {
                for (let i = 0; i < line.length - 1; i++) {
                    const start = ol.proj.transform(line[i], projection, 'EPSG:4326');
                    const end = ol.proj.transform(line[i + 1], projection, 'EPSG:4326');
                    distance = Math.min(
                        distance,
                        window.modelRenderer.pointToSegmentDistanceMeters(position, start, end)
                    );
                    if (distance === 0) break;
                }
                if (distance === 0) break;
            }
            if (distance < closestDistance) {
                closest = candidate;
                closestDistance = distance;
            }
        }
    }

    if (closest) bridgeSurfaceFeatureCache.set(feature, closest);
    return closest || feature;
}

// Find the closest highway/footway that this barrier runs alongside
function findAdjacentHighway(feature, lonLat) {
    const geometry = feature.getGeometry && feature.getGeometry();
    if (!geometry) return null;
    const featureLevel = parseOsNumber(feature.get('layer')) || 0;
    const projection = window.map.getView().getProjection();
    let closestFeature = null;
    let closestDistance = Infinity;

    const layers = window.modelRenderer.getAllMapLayers(window.map.getLayers().getArray());
    for (const layer of layers) {
        const source = layer && layer.getSource && layer.getSource();
        if (!source || !source.getFeatures) continue;
        for (const candidate of source.getFeatures()) {
            if (candidate === feature) continue;
            const candidateLevel = parseOsNumber(candidate.get('layer')) || 0;
            // Must be at same level
            if (Math.abs(candidateLevel - featureLevel) > 0.01) continue;
            // Must be a highway, footway, or path
            const highway = candidate.get('highway');
            if (!highway || !['primary', 'secondary', 'tertiary', 'residential',
                'unclassified', 'footway', 'path', 'cycleway', 'steps',
                'living_street', 'pedestrian', 'track'].includes(highway)) continue;
            const candidateGeometry = candidate.getGeometry && candidate.getGeometry();
            if (!candidateGeometry) continue;
            // First check bounding box overlap (fast filter)
            if (!geometriesIntersect(geometry, candidateGeometry)) continue;
            // Sample multiple points along the guard rail to find minimum distance
            const featureCoords = getGeometryLines(geometry);
            let minDist = Infinity;
            for (const fLine of featureCoords) {
                // Check at intervals along the line
                for (let i = 0; i < fLine.length; i += Math.max(1, Math.floor(fLine.length / 10))) {
                    const point = ol.proj.transform(fLine[i], projection, 'EPSG:4326');
                    for (const cLine of getGeometryLines(candidateGeometry)) {
                        for (let j = 0; j < cLine.length - 1; j++) {
                            const start = ol.proj.transform(cLine[j], projection, 'EPSG:4326');
                            const end = ol.proj.transform(cLine[j + 1], projection, 'EPSG:4326');
                            const dist = window.modelRenderer.pointToSegmentDistanceMeters(point, start, end);
                            minDist = Math.min(minDist, dist);
                        }
                    }
                }
            }
            // Only consider if very close (within 10 meters)
            if (minDist < 10 && minDist < closestDistance) {
                closestFeature = candidate;
                closestDistance = minDist;
            }
        }
    }
    return closestFeature;
}

function getBridgeReferenceHeight(feature, lonLat) {
    const surfaceFeature = findBridgeSurfaceFeature(feature, lonLat);
    const surfaceAnchor = surfaceFeature === feature
        ? lonLat
        : (getFeatureAnchorLonLat(surfaceFeature) || lonLat);
    let referenceHeight = surfaceFeature.get('bridgeRefHeight');
    if (referenceHeight === undefined || referenceHeight === null || !isFinite(referenceHeight)) {
        if (window.mapterhornTerrain && window.mapterhornTerrain.warmUp) {
            try { window.mapterhornTerrain.warmUp(surfaceAnchor[0], surfaceAnchor[1]); } catch (e) { /* no DEM yet */ }
        }
        referenceHeight = sampleGroundElevation(surfaceAnchor[0], surfaceAnchor[1]);
        if (referenceHeight === null || !isFinite(referenceHeight)) referenceHeight = 0;
        surfaceFeature.set('bridgeRefHeight', referenceHeight);
        surfaceFeature.set('bridgeRefPosition', surfaceAnchor.slice(0, 2));
    }
    const referencePosition = surfaceFeature.get('bridgeRefPosition') || surfaceAnchor;
    feature.set('bridgeRefHeight', referenceHeight);
    feature.set('bridgeRefPosition', referencePosition.slice(0, 2));
    return referenceHeight;
}

window.getBridgeReferenceHeight = getBridgeReferenceHeight;

function getGeometryLines(geometry) {
    if (!geometry || typeof geometry.getType !== 'function') return [];
    const type = geometry.getType();
    if (type === 'LineString') return [geometry.getCoordinates()];
    if (type === 'MultiLineString' || type === 'Polygon') return geometry.getCoordinates();
    if (type === 'MultiPolygon') return geometry.getCoordinates().flat();
    if (type === 'GeometryCollection' && geometry.getGeometries) {
        return geometry.getGeometries().flatMap(getGeometryLines);
    }
    return [];
}

function geometriesIntersect(first, second) {
    if (!first || !second || !ol.extent.intersects(first.getExtent(), second.getExtent())) return false;
    const firstLines = getGeometryLines(first);
    const secondLines = getGeometryLines(second);
    const intersectsCoordinate = (geometry, coordinate) => {
        try {
            return typeof geometry.intersectsCoordinate === 'function' &&
                geometry.intersectsCoordinate(coordinate);
        } catch (e) {
            return false;
        }
    };

    for (const line of firstLines) {
        for (const coordinate of line) {
            if (intersectsCoordinate(second, coordinate)) return true;
        }
    }
    for (const line of secondLines) {
        for (const coordinate of line) {
            if (intersectsCoordinate(first, coordinate)) return true;
        }
    }
    for (const firstLine of firstLines) {
        for (let i = 0; i < firstLine.length - 1; i++) {
            for (const secondLine of secondLines) {
                for (let j = 0; j < secondLine.length - 1; j++) {
                    if (window.modelRenderer.linesIntersect(
                        firstLine[i], firstLine[i + 1], secondLine[j], secondLine[j + 1]
                    )) return true;
                }
            }
        }
    }
    return false;
}

const underBridgeCandidateCache = new WeakMap();

function findBridgeAboveFeature(feature, lonLatPosition = null) {
    if (!feature || isBridgeFeature(feature) || !window.map || !window.modelRenderer) return null;
    const geometry = feature.getGeometry && feature.getGeometry();
    if (!geometry) return null;
    const featureLayer = parseOsNumber(feature.get('layer'));
    const featureLevel = isFinite(featureLayer) ? featureLayer : 0;
    const projection = window.map.getView().getProjection();
    const point = lonLatPosition
        ? ol.proj.transform(lonLatPosition, 'EPSG:4326', projection)
        : null;
    const layers = window.modelRenderer.getAllMapLayers(window.map.getLayers().getArray());
    const revision = layers.map((layer) => {
        const source = layer && layer.getSource && layer.getSource();
        return source && source.getRevision ? source.getRevision() : '';
    }).join(':');
    let cached = underBridgeCandidateCache.get(feature);
    if (!cached || cached.revision !== revision) {
        const candidates = [];
        for (const layer of layers) {
            const source = layer && layer.getSource && layer.getSource();
            if (!source || !source.getFeatures) continue;
            for (const bridge of source.getFeatures()) {
                if (bridge === feature || !isBridgeFeature(bridge)) continue;
                const bridgeGeometry = bridge.getGeometry && bridge.getGeometry();
                if (!bridgeGeometry || !geometriesIntersect(geometry, bridgeGeometry)) continue;
                const bridgeLayer = parseOsNumber(bridge.get('layer'));
                const bridgeLevel = isFinite(bridgeLayer) ? bridgeLayer : 1;
                if (bridgeLevel > featureLevel) candidates.push(bridge);
            }
        }
        cached = { revision, candidates };
        underBridgeCandidateCache.set(feature, cached);
    }

    for (const bridge of cached.candidates) {
        if (!point) return bridge;
        const bridgeGeometry = bridge.getGeometry();
        for (const line of getGeometryLines(bridgeGeometry)) {
            for (let i = 0; i < line.length - 1; i++) {
                const start = ol.proj.transform(line[i], projection, 'EPSG:4326');
                const end = ol.proj.transform(line[i + 1], projection, 'EPSG:4326');
                if (window.modelRenderer.pointToSegmentDistanceMeters(lonLatPosition, start, end) <= 15) {
                    return bridge;
                }
            }
        }
    }
    return null;
}

function getFeatureAnchorLonLat(feature) {
    const geometry = feature && feature.getGeometry && feature.getGeometry();
    if (!geometry) return null;
    const type = geometry.getType();
    if (type === 'Point') return ol.proj.toLonLat(geometry.getCoordinates());
    if (type === 'LineString') {
        const coordinates = geometry.getCoordinates();
        if (coordinates.length === 0) return null;
        return ol.proj.toLonLat(coordinates[Math.floor(coordinates.length / 2)]);
    }
    const extent = geometry.getExtent();
    return ol.proj.toLonLat(ol.extent.getCenter(extent));
}

/**
 * Find ALL features whose geometry crosses the given feature's geometry,
 * regardless of tags (bridge=*, layer=*, etc.). Returns the closest
 * crossing feature by minimum point-to-segment distance.
 */
function findCrossingFeatures(feature, maxDistance = 15) {
    const geometry = feature.getGeometry && feature.getGeometry();
    if (!geometry || !window.map || !window.modelRenderer) return [];
    const projection = window.map.getView().getProjection();
    const featureLines = getGeometryLines(geometry);
    const layers = window.modelRenderer.getAllMapLayers(window.map.getLayers().getArray());
    const results = [];

    for (const layer of layers) {
        const source = layer && layer.getSource && layer.getSource();
        if (!source || !source.getFeatures) continue;
        for (const candidate of source.getFeatures()) {
            if (candidate === feature) continue;
            const candidateGeometry = candidate.getGeometry && candidate.getGeometry();
            if (!candidateGeometry) continue;
            if (!geometriesIntersect(geometry, candidateGeometry)) continue;

            // Compute minimum distance between the two geometries
            let minDist = Infinity;
            for (const fLine of featureLines) {
                for (let i = 0; i < fLine.length - 1; i++) {
                    const fStart = ol.proj.transform(fLine[i], projection, 'EPSG:4326');
                    const fEnd = ol.proj.transform(fLine[i + 1], projection, 'EPSG:4326');
                    for (const cLine of getGeometryLines(candidateGeometry)) {
                        for (let j = 0; j < cLine.length - 1; j++) {
                            const cStart = ol.proj.transform(cLine[j], projection, 'EPSG:4326');
                            const cEnd = ol.proj.transform(cLine[j + 1], projection, 'EPSG:4326');
                            minDist = Math.min(minDist,
                                window.modelRenderer.pointToSegmentDistanceMeters(fStart, cStart, cEnd),
                                window.modelRenderer.pointToSegmentDistanceMeters(fEnd, cStart, cEnd),
                                window.modelRenderer.pointToSegmentDistanceMeters(cStart, fStart, fEnd),
                                window.modelRenderer.pointToSegmentDistanceMeters(cEnd, fStart, fEnd)
                            );
                        }
                    }
                }
            }
            if (minDist <= maxDistance) {
                results.push({ feature: candidate, distance: minDist });
            }
        }
    }
    results.sort((a, b) => a.distance - b.distance);
    return results;
}

function findUnderBridgeWayFeature(areaFeature, bridge, areaCentre) {
    const areaGeometry = areaFeature.getGeometry && areaFeature.getGeometry();
    if (!areaGeometry || !bridge) return null;
    const projection = window.map.getView().getProjection();
    const bridgeLayer = parseOsNumber(bridge.get('layer'));
    const bridgeLevel = isFinite(bridgeLayer) ? bridgeLayer : 1;
    let closestFeature = null;
    let closestDistance = Infinity;
    const layers = window.modelRenderer.getAllMapLayers(window.map.getLayers().getArray());

    for (const layer of layers) {
        const source = layer && layer.getSource && layer.getSource();
        if (!source || !source.getFeatures) continue;
        for (const candidate of source.getFeatures()) {
            if (candidate === areaFeature || isBridgeFeature(candidate)) continue;
            const geometry = candidate.getGeometry && candidate.getGeometry();
            if (!geometry || !['LineString', 'MultiLineString'].includes(geometry.getType())) continue;
            if (!geometriesIntersect(areaGeometry, geometry)) continue;
            const candidateLayer = parseOsNumber(candidate.get('layer'));
            if ((isFinite(candidateLayer) ? candidateLayer : 0) >= bridgeLevel) continue;
            if (typeof getFeatureModelOptions === 'function' && !getFeatureModelOptions(candidate)) continue;

            let distance = Infinity;
            for (const line of getGeometryLines(geometry)) {
                for (let i = 0; i < line.length - 1; i++) {
                    const start = ol.proj.transform(line[i], projection, 'EPSG:4326');
                    const end = ol.proj.transform(line[i + 1], projection, 'EPSG:4326');
                    distance = Math.min(
                        distance,
                        window.modelRenderer.pointToSegmentDistanceMeters(areaCentre, start, end)
                    );
                }
            }
            if (distance < closestDistance) {
                closestFeature = candidate;
                closestDistance = distance;
            }
        }
    }
    return closestFeature;
}

function getUnderBridgeSurface(feature, bridge, lonLatPosition) {
    const bridgeKey = getFeatureKey(bridge);
    const cached = feature.get('underBridgeSurfaces') || {};
    let surface = cached[bridgeKey];
    if (!surface) {
        if (window.mapterhornTerrain && window.mapterhornTerrain.warmUp) {
            try { window.mapterhornTerrain.warmUp(lonLatPosition[0], lonLatPosition[1]); } catch (e) { /* no DEM yet */ }
        }
        surface = {
            height: sampleGroundElevation(lonLatPosition[0], lonLatPosition[1]),
            position: lonLatPosition.slice(0, 2),
            smoothed: false // Flag to indicate if smoothing has been applied
        };
        cached[bridgeKey] = surface;
        feature.set('underBridgeSurfaces', cached);
    }
    return { bridge, bridgeKey, feature, height: surface.height, position: surface.position };
}

/**
 * When a feature is very close (<1m) to a bridge or crossing way
 * but NOT tagged bridge=yes, sample DEM just outside the influence
 * zone on both sides and interpolate. This avoids DEM artifacts
 * right next to bridge structures (like mediana/median ground
 * level fluctuations) while still placing the feature at the
 * correct ground elevation.
 *
 * Also finds crossing features regardless of bridge/layer tags.
 */
function getInterpolatedBridgeHeight(feature, bridge, lonLatPosition) {
    // Also look for ANY crossing feature (not just bridge=yes)
    let crossingFeature = bridge;
    if (!crossingFeature) {
        const crossings = findCrossingFeatures(feature, 15);
        if (crossings.length > 0) {
            crossingFeature = crossings[0].feature;
            console.log(`🔍 Crossing feature: ${crossingFeature.getId()} (${crossingFeature.get('highway') || crossingFeature.get('barrier') || 'unknown'}) at ${crossings[0].distance.toFixed(2)}m`);
        }
    }
    if (!crossingFeature) return null;

    const geometry = feature.getGeometry && feature.getGeometry();
    if (!geometry || !crossingFeature) return null;
    const projection = window.map.getView().getProjection();
    const crossingGeom = crossingFeature.getGeometry();
    const pos = ol.proj.transform(lonLatPosition, 'EPSG:4326', projection);

    // Find the closest point on the crossing geometry
    let closestDist = Infinity;
    let closestPoint = null;
    let segmentAngle = 0;
    for (const line of getGeometryLines(crossingGeom)) {
        for (let i = 0; i < line.length - 1; i++) {
            const start = ol.proj.transform(line[i], projection, 'EPSG:4326');
            const end = ol.proj.transform(line[i + 1], projection, 'EPSG:4326');
            const dist = window.modelRenderer.pointToSegmentDistanceMeters(pos, start, end);
            if (dist < closestDist) {
                closestDist = dist;
                const dx = end[0] - start[0], dy = end[1] - start[1];
                segmentAngle = Math.atan2(dy, dx);
                closestPoint = [start[0] + ((pos[0] - start[0]) * dx + (pos[1] - start[1]) * dy) / (dx*dx + dy*dy) * dx,
                                start[1] + ((pos[0] - start[0]) * dx + (pos[1] - start[1]) * dy) / (dx*dx + dy*dy) * dy];
            }
        }
    }
    if (!closestPoint || closestDist > 1.0) return null;

    // Sample DEM at 5m and 10m perpendicular distances on both sides
    // This captures the middle ground height away from crossing interference
    const SAMPLE_DISTS = [5, 10];  // meters - two points on each side
    const TOLERANCE = 1.0;  // max allowed difference between samples (meters)

    const perpDir1 = segmentAngle + Math.PI / 2;
    const perpDir2 = segmentAngle - Math.PI / 2;

    function sampleAt(offsetMeters, angle) {
        const mPerDegLat = 111320;
        const mPerDegLon = 111320 * Math.cos(lonLatPosition[1] * Math.PI / 180);
        const latOffset = (offsetMeters * Math.sin(angle)) / mPerDegLat;
        const lonOffset = (offsetMeters * Math.cos(angle)) / mPerDegLon;
        return sampleGroundElevation(lonLatPosition[0] + lonOffset, lonLatPosition[1] + latOffset);
    }

    // Sample at 5m and 10m on both sides of crossing
    const h1_5m = sampleAt(5, perpDir1);
    const h2_5m = sampleAt(5, perpDir2);
    const h1_10m = sampleAt(10, perpDir1);
    const h2_10m = sampleAt(10, perpDir2);

    const samples = [h1_5m, h2_5m, h1_10m, h2_10m].filter(h => h !== null);

    if (samples.length < 2) return null;

    // Calculate median height
    const sorted = samples.slice().sort((a, b) => a - b);
    const medianHeight = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];

    // Check consistency
    const avgHeight = samples.reduce((a, b) => a + b, 0) / samples.length;
    let isConsistent = true;
    for (let i = 0; i < samples.length; i++) {
        if (Math.abs(samples[i] - avgHeight) > TOLERANCE) {
            isConsistent = false;
            break;
        }
    }

    if (!isConsistent) {
        console.log(`⚠️ Crossing interp: inconsistent samples, using DEM`);
        return null;
    }

    console.log(`🔍 Crossing interp: ${samples.length} samples at 5-10m → median=${medianHeight.toFixed(2)}m (avg=${avgHeight.toFixed(2)}m, dist=${closestDist.toFixed(2)}m)`);
    return medianHeight;
}

function getFeatureHeightOffset(feature) {
    const offset = feature && feature.get && feature.get('modelHeightOffset');
    return typeof offset === 'number' && isFinite(offset) ? offset : 0;
}

window.modelRenderer = {

    loadedModels: new Map(),          // Track live primitives by stable key

    // Live primitive census, maintained by trackEntry/untrackEntry so it can
    // never drift away from loadedModels the way the old `totalModelsAdded`
    // counter did.
    liveByKind: { model: 0, repetition: 0, texture: 0 },
    liveTotal: 0,
    cameraUpdateTimeout: null,        // Throttle camera updates
    modelPool: new Map(),             // Pool of reusable model instances
    backgroundTasks: [],              // Background loading tasks
    isProcessing: false,              // Prevent concurrent processing
    totalModelsAdded: 0,              // DEPRECATED: never incremented by anything. Use liveTotal.
    batchLogStats: {                  // Batch logging to reduce console spam
        modelsAdded: 0,
        repetitionsAdded: 0,
        lastLogTime: Date.now(),
        batchInterval: 5000           // Log summary every 5 seconds
    },

    /**
     * Model Pooling System - Reuse Cesium model instances
     */
    getModelFromPool: function(modelUrl, cesiumScene) {
        // Check if this is an image file - don't pool images as GLTF models
        const isImageFile = modelUrl && (modelUrl.toLowerCase().endsWith('.png') || modelUrl.toLowerCase().endsWith('.jpg') || modelUrl.toLowerCase().endsWith('.jpeg'));
        if (isImageFile) {
            if (debugConfig.enabled) console.log(`♻️ Skipping model pooling for image file: ${modelUrl}`);
            return null;
        }
        
        if (!this.modelPool.has(modelUrl)) {
            this.modelPool.set(modelUrl, []);
        }
        
        const pool = this.modelPool.get(modelUrl);
        const availableModel = pool.find(model => !model.isVisible);
        
        if (availableModel) {
            availableModel.isVisible = true;
            if (debugConfig.enabled) console.log(`♻️ Reused model from pool: ${modelUrl}`);
            return availableModel;
        }
        
        // Clean up pool before creating new model if it's getting large
        if (pool.length > 15) {
            this.cleanupModelPool();
        }
        
        // Create new model if pool is empty
        const newModel = cesiumScene.primitives.add(Cesium.Model.fromGltf({
            url: modelUrl,
            show: true
        }));
        
        pool.push({
            model: newModel,
            isVisible: true
        });
        
        if (debugConfig.enabled) console.log(`🆕 Created new pooled model: ${modelUrl}`);
        return { model: newModel, isVisible: true };
    },

    /**
     * Return model to pool (hide instead of destroy)
     */
    returnModelToPool: function(modelUrl, modelInstance) {
        if (this.modelPool.has(modelUrl)) {
            const pool = this.modelPool.get(modelUrl);
            const pooledModel = pool.find(item => item.model === modelInstance);
            if (pooledModel) {
                pooledModel.isVisible = false;
                pooledModel.model.show = false;
                if (debugConfig.enabled) console.log(`♻️ Returned model to pool: ${modelUrl}`);
                // Clean up pool periodically when returning models
                if (Math.random() < 0.1) { // 10% chance to clean up
                    this.cleanupModelPool();
                }
            }
        }
    },

    /**
     * Clean up model pool to prevent unlimited growth
     * Removes oldest unused models when pool exceeds limit
     */
    cleanupModelPool: function() {
        const maxPoolSize = 60; // Maximum total pooled primitives (memory)
        let totalPoolSize = 0;
        
        // Calculate total pool size
        this.modelPool.forEach((pool) => {
            totalPoolSize += pool.length;
        });
        
        if (totalPoolSize > maxPoolSize) {
            if (debugConfig.enabled) console.log(`♻️ Cleaning up model pool: ${totalPoolSize} models, reducing to ${maxPoolSize}`);
            
            // Remove oldest unused models from each pool
            this.modelPool.forEach((pool, modelUrl) => {
                const unusedModels = pool.filter(item => !item.isVisible);
                const toRemove = Math.max(0, unusedModels.length - Math.floor(maxPoolSize / this.modelPool.size));
                
                for (let i = 0; i < toRemove; i++) {
                    const index = pool.indexOf(unusedModels[i]);
                    if (index > -1) {
                        pool.splice(index, 1);
                        if (debugConfig.enabled) console.log(`♻️ Removed unused model from pool: ${modelUrl}`);
                    }
                }
            });
        }
    },

    /**
     * Background loading system to prevent frame drops
     */
    addBackgroundTask: function(task) {
        this.backgroundTasks.push(task);
        if (!this.isProcessing) {
            this.processBackgroundTasks();
        }
    },

    /**
     * Process background tasks without blocking main thread
     */
    processBackgroundTasks: function() {
        if (this.isProcessing || this.backgroundTasks.length === 0) return;
        
        this.isProcessing = true;
        
        const processBatch = () => {
            const batchSize = 10; // Process 10 tasks per frame
            for (let i = 0; i < Math.min(batchSize, this.backgroundTasks.length); i++) {
                const task = this.backgroundTasks.shift();
                try {
                    task();
                } catch (error) {
                    // Background task error silently handled
                }
            }
            
            if (this.backgroundTasks.length > 0) {
                requestAnimationFrame(processBatch);
            } else {
                this.isProcessing = false;
            }
        };
        
        requestAnimationFrame(processBatch);
    },

    /**
     * Check if a position is visible in the current camera view (viewport culling)
     */
    isPositionVisible: function(lon, lat, cesiumScene) {
        if (!cesiumScene || !cesiumScene.camera) return false;

        const camera = cesiumScene.camera;
        const position = Cesium.Cartesian3.fromDegrees(lon, lat,
            sampleGroundElevation(lon, lat));
        const frustum = camera.frustum;

        // Check if position is in camera frustum
        return frustum.computeCullingVolume(camera.position, camera.direction, camera.up).computeVisibility(new Cesium.BoundingSphere(position, 10)) !== Cesium.Intersect.OUTSIDE;
    },

    /**
     * Calculate distance from camera to position
     */
    getDistanceFromCamera: function(lon, lat, cesiumScene) {
        if (!cesiumScene || !cesiumScene.camera) return Infinity;

        const camera = cesiumScene.camera;
        const cameraPosition = camera.positionCartographic;
        const position = Cesium.Cartographic.fromDegrees(lon, lat,
            sampleGroundElevation(lon, lat));

        return Cesium.Cartesian3.distance(
            Cesium.Cartographic.toCartesian(cameraPosition),
            Cesium.Cartographic.toCartesian(position)
        );
    },

    /**
     * Get appropriate LOD level based on distance
     */
    getLODLevel: function(distance) {
        if (distance <= memoryConfig.lodDistances.high) return 'high';
        if (distance <= memoryConfig.lodDistances.medium) return 'medium';
        if (distance <= memoryConfig.lodDistances.low) return 'low';
        return 'none'; // Too far, don't load
    },

    // -----------------------------------------------------------------------
    // Live primitive accounting
    // -----------------------------------------------------------------------
    // Every primitive this renderer creates is reachable from loadedModels, so
    // it can be counted and — this is the part that was missing — DESTROYED.
    // Before this, area-texture GroundPrimitives were added straight to
    // scene.primitives with no record anywhere (addAreaTexture returned
    // nothing), which meant no cleanup path could ever reach them and the
    // "placed N models" console line did not even count them.

    /** Adjust the census. `previousKind` of null means "nothing was there". */
    _trackLive: function(previousKind, newKind) {
        if (previousKind) this.liveByKind[previousKind] = Math.max(0, this.liveByKind[previousKind] - 1);
        if (newKind) this.liveByKind[newKind] = (this.liveByKind[newKind] || 0) + 1;
        this.liveTotal = this.liveByKind.model + this.liveByKind.repetition + this.liveByKind.texture;
    },

    /** Record a live primitive under `key`. Replaces any entry already there. */
    trackEntry: function(key, entry) {
        const previous = this.loadedModels.get(key);
        this._trackLive(previous ? (previous.kind || 'model') : null, entry.kind || 'model');
        this.loadedModels.set(key, entry);
        this.setUndergroundEntryVisibility(entry, isUndergroundViewEnabled());
        this.setActiveLevelEntryVisibility(entry, window.indoor && window.indoor.isEnabled()
            ? window.indoor.getActiveLevel() : null);
        return entry;
    },

    setUndergroundEntryVisibility: function(entry, undergroundVisible) {
        if (!entry || !entry.feature) return;
        const isUnderground = isUndergroundFeature(entry.feature);
        const items = entry.kind === 'texture'
            ? (Array.isArray(entry.primitives) ? entry.primitives : [entry.primitives])
            : [entry.model];
        items.forEach(function(item) {
            if (item) item.show = isUnderground === !!undergroundVisible;
        });
    },

    setUndergroundVisibility: function(undergroundVisible) {
        if (!this.loadedModels) return;
        this.loadedModels.forEach(function(entry) {
            this.setUndergroundEntryVisibility(entry, undergroundVisible);
        }, this);
        const scene = window.ol3d && window.ol3d.getCesiumScene
            ? window.ol3d.getCesiumScene()
            : null;
        if (scene && scene.requestRender) scene.requestRender();
    },

    setActiveLevelEntryVisibility: function(entry, activeLevel) {
        if (!entry || !entry.feature || typeof entry.feature.get !== 'function') return;
        const feature = entry.feature;
        const underground = isUndergroundFeature(feature);
        const undergroundVisible = isUndergroundViewEnabled();
        let visible = underground === undergroundVisible;
        if (activeLevel !== null && activeLevel !== undefined && activeLevel !== '') {
            const levelTags = [feature.get('level'), feature.get('repeat_on')]
                .filter(value => value !== undefined && value !== null && value !== '')
                .map(String);
            const hasLevelRange = feature.get('min_level') !== undefined ||
                feature.get('max_level') !== undefined;
            const floorFeature = !!(feature.get('indoor') || feature.get('door') ||
                feature.get('window') || feature.get('highway') === 'steps' ||
                feature.get('highway') === 'elevator');
            if (levelTags.length || hasLevelRange || floorFeature) {
                const selectedLabel = String(activeLevel).trim().toLowerCase();
                const selectedNumbers = window.indoor && window.indoor.parseLevelList
                    ? window.indoor.parseLevelList(activeLevel) : null;
                const selectedNumber = selectedNumbers && selectedNumbers.length
                    ? selectedNumbers[0] : parseOsNumber(activeLevel);
                const taggedLevels = [];
                levelTags.forEach(value => {
                    if (window.indoor && window.indoor.parseLevelList) {
                        const parsed = window.indoor.parseLevelList(value);
                        if (parsed) taggedLevels.push.apply(taggedLevels, parsed);
                    }
                    value.split(/[;,]/).forEach(tagged => {
                        if (tagged.trim()) taggedLevels.push(tagged.trim().toLowerCase());
                    });
                });
                const hasExplicitLevels = levelTags.length > 0;
                const matchesExplicit = taggedLevels.some(tagged => {
                    if (typeof tagged === 'number' && isFinite(selectedNumber)) return tagged === selectedNumber;
                    if (String(tagged) === selectedLabel) return true;
                    const number = parseOsNumber(tagged);
                    return isFinite(number) && isFinite(selectedNumber) && number === selectedNumber;
                });
                let matchesRange = false;
                if (hasLevelRange && isFinite(selectedNumber)) {
                    const minimum = window.indoor && window.indoor.parseLevelList
                        ? window.indoor.parseLevelList(feature.get('min_level')) : null;
                    const maximum = window.indoor && window.indoor.parseLevelList
                        ? window.indoor.parseLevelList(feature.get('max_level')) : null;
                    if (minimum && maximum && minimum.length && maximum.length) {
                        matchesRange = selectedNumber >= Math.min.apply(null, minimum) &&
                            selectedNumber <= Math.max.apply(null, maximum);
                    }
                }
                const defaultGroundLevel = !hasExplicitLevels && !hasLevelRange && floorFeature &&
                    (selectedLabel === '0' || selectedLabel === 'g' || selectedLabel === 'ground');
                visible = visible && (matchesExplicit || matchesRange || defaultGroundLevel);
            }
        }
        const items = entry.kind === 'texture'
            ? (Array.isArray(entry.primitives) ? entry.primitives : [entry.primitives])
            : [entry.model];
        items.forEach(item => {
            if (item) item.show = visible;
        });
    },

    setActiveLevelVisibility: function(activeLevel) {
        if (!this.loadedModels) return;
        this.loadedModels.forEach(function(entry) {
            this.setActiveLevelEntryVisibility(entry, activeLevel);
        }, this);
        const scene = window.ol3d && window.ol3d.getCesiumScene
            ? window.ol3d.getCesiumScene()
            : null;
        if (scene && scene.requestRender) scene.requestRender();
    },

    /** Stop counting `key` and forget it. Does NOT destroy the primitive. */
    untrackEntry: function(key) {
        const entry = this.loadedModels.get(key);
        if (!entry) return null;
        this._trackLive(entry.kind || 'model', null);
        this.loadedModels.delete(key);
        return entry;
    },

    /** Forget everything without destroying (the scene is already gone). */
    resetLive: function() {
        this.loadedModels.clear();
        this.liveByKind = { model: 0, repetition: 0, texture: 0 };
        this.liveTotal = 0;
    },

    /** Rebuild the census from loadedModels. Defensive: catches any drift. */
    recountLive: function() {
        this.liveByKind = { model: 0, repetition: 0, texture: 0 };
        this.loadedModels.forEach(function(entry) {
            const kind = entry.kind || 'model';
            this.liveByKind[kind] = (this.liveByKind[kind] || 0) + 1;
        }, this);
        this.liveTotal = this.liveByKind.model + this.liveByKind.repetition + this.liveByKind.texture;
        return this.liveTotal;
    },

    // -----------------------------------------------------------------------
    // Releasing memory
    // -----------------------------------------------------------------------
    /** Forget a pooled primitive so it is not handed out again. */
    dropFromPool: function(modelUrl, modelInstance) {
        const pool = this.modelPool.get(modelUrl);
        if (!pool) return;
        const i = pool.findIndex(item => item.model === modelInstance);
        if (i > -1) pool.splice(i, 1);
    },

    /**
     * Destroy the primitive behind an entry and stop counting it.
     *
     * `unloadDistance` had zero readers before, so nothing placed was ever
     * released: on a 7MB file with 197km of ways, every primitive built during
     * the session stayed in scene.primitives for the life of the scene.
     */
    unloadEntry: function(key, cesiumScene) {
        const entry = this.loadedModels.get(key);
        if (!entry) return false;

        // An entry from an older 3D session points at a primitive that died
        // with the old scene. Just stop counting it.
        if (entry.sessionId !== undefined && entry.sessionId !== this._session3dId) {
            this.untrackEntry(key);
            return true;
        }

        const scene = entry.scene || cesiumScene ||
            (window.ol3d && window.ol3d.getCesiumScene ? window.ol3d.getCesiumScene() : null);

        try {
            if (entry.kind === 'texture') {
                const list = Array.isArray(entry.primitives) ? entry.primitives
                    : (entry.primitives ? [entry.primitives] : []);
                if (scene && scene.primitives) {
                    for (let i = 0; i < list.length; i++) {
                        const p = list[i];
                        if (p && !isPrimitiveDestroyed(p)) scene.primitives.remove(p);
                    }
                }
                // createAreaEntity() early-returns on this property, so it has
                // to be cleared or the area can never be built again.
                if (entry.feature && typeof entry.feature.set === 'function') {
                    entry.feature.set('areaEntity', undefined);
                }
                // Drop the generated data URL / canvas reference with the entry.
                entry.primitives = null;
            } else if (entry.model) {
                // Pooled base models: leaving them in the pool keeps the GPU
                // memory, so remove them from BOTH the pool and the scene.
                // Cesium caches the parsed glTF by url, so re-placing later is
                // cheap rather than a re-download.
                this.dropFromPool(entry.modelUrl, entry.model);
                if (scene && scene.primitives && !isPrimitiveDestroyed(entry.model)) {
                    scene.primitives.remove(entry.model);
                }
            }
        } catch (e) {
            // Already destroyed / scene gone. Still stop counting it.
        }

        this.untrackEntry(key);
        return true;
    },

    /** Cheap planar distance in metres; avoids per-entry Cesium maths. */
    _roughDistance: function(entry, camLon, camLat, camHeight) {
        const dy = (entry.lat - camLat) * 110540;
        const dx = (entry.lon - camLon) * 111320 * Math.cos(camLat * Math.PI / 180);
        const dh = (entry.elevation || 0) - camHeight;
        return Math.sqrt(dx * dx + dy * dy + dh * dh);
    },

    /**
     * Destroy every tracked primitive beyond unloadDistance.
     * Called from the throttled camera hook.
     */
    unloadDistantModels: function(cesiumScene) {
        if (!cesiumScene || !cesiumScene.camera) return 0;
        const carto = cesiumScene.camera.positionCartographic;
        if (!carto) return 0;
        const camLon = Cesium.Math.toDegrees(carto.longitude);
        const camLat = Cesium.Math.toDegrees(carto.latitude);
        const camHeight = carto.height;

        const stale = [];
        this.loadedModels.forEach(function(entry, key) {
            if (entry.lon === undefined || entry.lat === undefined) return;
            if (this._roughDistance(entry, camLon, camLat, camHeight) > memoryConfig.unloadDistance) {
                stale.push(key);
            }
        }, this);

        for (let i = 0; i < stale.length; i++) this.unloadEntry(stale[i], cesiumScene);
        return stale.length;
    },

    /**
     * Enforce the hard primitive budget, farthest first.
     *
     * Only entries that are ALREADY outside unloadDistance are eligible. If
     * everything still on screen is within it, there is nothing safe to drop,
     * ensureBudget() returns false and the caller places nothing — the budget
     * is respected even when that means fewer models than ideal.
     *
     * Because eviction only touches what is beyond unloadDistance and placement
     * only accepts what is within loadDistance * placementRangeFactor, the two ranges never
     * overlap, so an evicted primitive is not immediately re-created.
     */
    ensureBudget: function(cesiumScene) {
        if (this.liveTotal < memoryConfig.maxLivePrimitives) return true;
        this.evictFarthest(cesiumScene);
        return this.liveTotal < memoryConfig.maxLivePrimitives;
    },

    evictFarthest: function(cesiumScene) {
        if (!cesiumScene || !cesiumScene.camera) return 0;
        const carto = cesiumScene.camera.positionCartographic;
        if (!carto) return 0;
        const camLon = Cesium.Math.toDegrees(carto.longitude);
        const camLat = Cesium.Math.toDegrees(carto.latitude);
        const camHeight = carto.height;

        const eligible = [];
        this.loadedModels.forEach(function(entry, key) {
            if (entry.lon === undefined || entry.lat === undefined) return;
            const d = this._roughDistance(entry, camLon, camLat, camHeight);
            if (d > memoryConfig.unloadDistance) eligible.push([d, key]);
        }, this);
        if (!eligible.length) return 0;

        eligible.sort(function(a, b) { return b[0] - a[0]; });   // farthest first
        const target = Math.floor(memoryConfig.maxLivePrimitives * memoryConfig.evictToRatio);
        let removed = 0;
        for (let i = 0; i < eligible.length && this.liveTotal > target; i++) {
            this.unloadEntry(eligible[i][1], cesiumScene);
            removed++;
        }
        if (removed > 0) {
            // Counted so the report can say whether the ceiling is being hit
            // regularly or only on the first sweep.
            this.evictions = (this.evictions || 0) + 1;
            this._lastEvicted = removed;
        }
        return removed;
    },

    // -----------------------------------------------------------------------
    // Camera-driven streaming
    // -----------------------------------------------------------------------
    // Placements are range-gated, but without this nothing ever REMOVED one, so
    // the peak was the whole file rather than the view. The hook is throttled
    // because camera.changed fires on every mouse pixel.

    hookCameraStreaming: function() {
        if (this._cameraStreamingHooked) return;
        if (!window.ol3d || !window.ol3d.getCesiumScene) return;
        let scene = null;
        try { scene = window.ol3d.getCesiumScene(); } catch (e) { return; }
        if (!scene || !scene.camera || !scene.camera.changed) return;

        const self = this;
        scene.camera.changed.addEventListener(function() { self.requestStreamingUpdate(); });
        this._cameraStreamingHooked = true;
    },

    requestStreamingUpdate: function() {
        if (this._streamPending) return;
        const now = Date.now();
        const wait = memoryConfig.cameraUpdateThrottle - (now - (this._lastStreamAt || 0));
        if (wait > 0) {
            const self = this;
            this._streamPending = setTimeout(function() {
                self._streamPending = null;
                self.streamingUpdate();
            }, wait);
            return;
        }
        this._lastStreamAt = now;
        this.streamingUpdate();
    },

    streamingUpdate: function() {
        if (this._streaming) return;
        if (!window.ol3d || !window.ol3d.getCesiumScene) return;
        let scene = null;
        try { scene = window.ol3d.getCesiumScene(); } catch (e) { return; }
        if (!scene) return;

        this._streaming = true;
        try {
            const removed = this.unloadDistantModels(scene);
            // Only re-sweep if something actually went away; a camera nudge
            // inside the loaded area must not trigger a full walk.
            if (removed > 0) this.addAllModels();
        } catch (error) {
            console.error('🎯 streaming update failed:', error);
        } finally {
            this._streaming = false;
        }
    },

    evictions: 0,                    // how often the ceiling has forced a sacrifice

    /** One line of truth about what is currently resident. */
    memoryReport: function() {
        let text = this.liveTotal + ' live primitive(s): models ' + this.liveByKind.model +
            ', repetitions ' + this.liveByKind.repetition + ', area textures ' + this.liveByKind.texture +
            ' (budget ' + memoryConfig.maxLivePrimitives +
            ', range ' + Math.round(memoryConfig.loadDistance * memoryConfig.placementRangeFactor) + 'm' +
            ', unload ' + memoryConfig.unloadDistance + 'm)';
        // If the ceiling ever actually bites, say so and say how often. A budget
        // that silently refuses placements reads as "the data ends here".
        if (this.evictions > 0) {
            text += ' — at budget ' + this.evictions + ' time(s), last freed ' + this._lastEvicted + ' farthest';
        }
        return text;
    },

    /**
     * Raise or lower the live-primitive ceiling while the app is running.
     *
     * @param {number} value  new ceiling, in primitives
     * @returns {number} the ceiling now in force
     */
    setBudget: function(value) {
        const next = parseInt(value, 10);
        if (!isFinite(next) || next < 0) {
            console.warn('🎯 setBudget: expected a non-negative number, got ' + value);
            return memoryConfig.maxLivePrimitives;
        }
        memoryConfig.maxLivePrimitives = next;
        console.log('🎯 budget now ' + next + ' primitive(s) — was ' + this.liveTotal + ' live');
        // Deliberately does NOT kick off a sweep.
        //
        // addAllModels() opens a new 3D session whenever the scene object is
        // not the one it saw last time, and opening a session calls resetLive()
        // — which forgets every tracked primitive. If the scene identity ever
        // differs from the last sweep (ol-cesium handing back a fresh wrapper),
        // calling a sweep from here would silently stop tracking every live
        // primitive while leaving them all in the scene: the exact leak this
        // whole mechanism exists to prevent.
        //
        // The next camera move, or the +4.5s retry, picks up the new ceiling.
        return next;
    },
    
    // -----------------------------------------------------------------------
    // Pre-load panel reporting + sliced placement
    // -----------------------------------------------------------------------
    // The per-feature work below (placeFeature) is exactly what it always was.
    // The only difference is WHEN it runs: instead of one blocking loop that
    // freezes the page (and freezes the progress bar with it), the walk is done
    // in slices of a few dozen features, handing control back to the browser
    // between them so the panel really repaints at 10%, 25%, 60%… and the map
    // stays usable while a big query is built.
    _progressTotal: 0,
    _progressDone: 0,
    _placing: false,             // a pass is in flight
    _pendingSweep: false,        // addAllModels() was called again while it ran

    /**
     * Features placed before the browser is given a turn. Small enough that the
     * bar moves visibly, large enough that the per-slice hand-off costs
     * nothing measurable.
     */
    placeSliceSize: 40,

    /**
     * Flatten the layer tree into the list of things to place. Same walk as
     * before (groups recurse, leaf layers contribute their features) — it just
     * collects instead of placing, so the total is known before any work.
     */
    collectPlaceTasks: function(layers, cesiumScene, out) {
        const self = this;
        (layers || []).forEach(function(layer) {
            if (!layer) return;
            // A group: descend, whatever its type.
            if (typeof layer.getLayers === 'function') {
                self.collectPlaceTasks(layer.getLayers().getArray(), cesiumScene, out);
                return;
            }
            if (!layer.getSource || typeof layer.getSource !== 'function') return;
            let features = null;
            try {
                const source = layer.getSource();
                if (source && source.getFeatures) features = source.getFeatures();
            } catch (e) {
                // Layer source access failed. Log instead of swallowing: an
                // empty catch here hid the failure of every model in the layer.
                console.error(`🎯 Could not read layer "${layer.get && layer.get('title') || 'unnamed'}" features:`, e);
                return;
            }
            if (!features) return;
            if (debugConfig.enabled) console.log(`🎯 Found ${features.length} features in layer`);
            for (let i = 0; i < features.length; i++) {
                out.push({ feature: features[i], fidx: i, layer: layer, cesiumScene: cesiumScene });
            }
        });
        return out;
    },

    /**
     * Run the placement in slices. Each slice is the original feature body; the
     * hand-off between slices is what lets the browser paint the progress bar
     * and keep answering clicks.
     */
    runPlaceSlices: function(tasks) {
        const self = this;
        const total = tasks.length;
        let index = 0;
        this._placing = true;

        function slice() {
            const started = index;
            const end = Math.min(total, index + self.placeSliceSize);
            for (; index < end; index++) {
                const task = tasks[index];
                try {
                    // Isolate every feature. addPlainResult / the repetition
                    // helpers are NOT wrapped individually, so a single throw
                    // would abort the whole sweep and silently cost the rest of
                    // the layer its models.
                    self.placeFeature(task.feature, task.fidx, task.cesiumScene, task.layer);
                } catch (featureError) {
                    console.error(`🎯 Feature ${task.fidx} in layer "${task.layer.get('title') || 'unnamed'}" failed, skipping:`, featureError);
                }
            }
            self._progressDone = index;
            if (window.loadingProgress && window.loadingProgress.step) {
                window.loadingProgress.step(index - started, index, total);
            }

            if (index < total) {
                setTimeout(slice, 0);          // let the browser breathe
                return;
            }
            self._placing = false;
            // Reconcile the census against the map once per pass. Incremental
            // counting cannot drift as long as everything goes through
            // trackEntry/untrackEntry; this makes that self-checking rather than
            // merely true, and it is where the memory line gets its number.
            self.recountLive();
            self._progressSummary();
            // A query that arrived while this pass was running gets its own
            // sweep now; it is idempotent, so it only places what is missing.
            if (self._pendingSweep) {
                self._pendingSweep = false;
                self.addAllModels();
            }
        }

        if (total === 0) { this._placing = false; this.recountLive(); this._progressSummary(); return; }
        slice();
    },

    _progressSummary: function() {
        const live = this.loadedModels ? this.loadedModels.size : 0;
        if (window.loadingProgress) {
            if (window.loadingProgress.summary) window.loadingProgress.summary(live);
        }
        console.log('🎯 placed ' + live + ' model(s) for ' + this._progressTotal + ' feature(s)');
        // Second line, and the only one that was truthful: `live` above counts
        // map entries, which never included the area-texture GroundPrimitives
        // (nothing tracked them) and was compared against a budget that never
        // fired. Not gated on debugConfig on purpose — the whole point of a
        // memory ceiling is being able to see it without turning on logging.
        console.log('🎯   ' + this.memoryReport());
        this._progressTotal = 0;
        this._progressDone = 0;
        window.dispatchEvent(new CustomEvent('osm3d:modelsPlaced', { detail: { placed: live } }));
    },

    /** Start a sweep over one layer (kept as the module's entry point). */
    addModelsFromLayer: function(layer, cesiumScene) {
        const tasks = this.collectPlaceTasks([layer], cesiumScene, []);
        this._progressTotal = tasks.length;
        if (window.loadingProgress && window.loadingProgress.total) {
            window.loadingProgress.total(tasks.length);
        }
        this.runPlaceSlices(tasks);
    },

    /**
     * Place everything that belongs to one feature: its model, its repetitions,
     * its area texture, or a draped marker when it has none of those.
     * This is the original per-feature body of the layer loop, unchanged.
     */
    placeFeature: function(feature, fidx, cesiumScene, layer) {
        const model = getFeatureModelOptions(feature);
        const hasRepetitions = feature.get('repetition_0');
        const hasAreaTextureRepetition = feature.get('repetition_0_type') === 'polygon_texture';
        const geometry = feature.getGeometry();
        const hasLineRepetitions = !!hasRepetitions && geometry && geometry.getType &&
            (geometry.getType() === 'LineString' || geometry.getType() === 'MultiLineString');

        if (geometry && geometry.getType && (geometry.getType() === 'Polygon' || geometry.getType() === 'MultiPolygon')) {
            const hasImageModel = model && model.uri && /\.(jpg|jpeg|png|gif|bmp|tiff|tif)$/i.test(model.uri);
            if (hasImageModel && !hasAreaTextureRepetition) {
                if (debugConfig.enabled) console.log(`🎯 Feature ${fidx} has area texture: ${model.uri}`);
                this.addAreaTextureForFeature(feature, model, fidx, cesiumScene);
            } else {
                if (model && typeof model === 'object' && model.uri && !hasImageModel && !hasAreaTextureRepetition) {
                    this.addModelForFeature(feature, fidx, cesiumScene, layer);
                }
                this.addRepetitionModels(feature, cesiumScene);
                // Neither model nor texture: drape the outline on the terrain
                // instead of letting ol-cesium draw it at sea level.
                if (!model && !hasAreaTextureRepetition) this.addPlainResult(feature, fidx, cesiumScene, layer);
            }
        } else {
            if (model && typeof model === 'object' && model.uri &&
                !hasAreaTextureRepetition && !hasLineRepetitions) {
                this.addModelForFeature(feature, fidx, cesiumScene, layer);
            }
            this.addRepetitionModels(feature, cesiumScene);
            // No model for this result: draw it as a marker/line that follows
            // the ground (see addPlainResult).
            if (!model && !hasAreaTextureRepetition) this.addPlainResult(feature, fidx, cesiumScene, layer);
        }
    },

    // Add individual model for a feature
    addModelForFeature: function(feature, fidx, cesiumScene, layer) {
        const geometry = feature.getGeometry();
        if (!geometry) return;

        // Get proper coordinates for positioning
        let lonLat;
        const geometryType = geometry.getType();

        if (geometryType === 'Point') {
            // For point features, use the point coordinates
            lonLat = ol.proj.toLonLat(geometry.getCoordinates());
        } else if (geometryType === 'LineString') {
            // For line features, use the midpoint
            const coordinates = geometry.getCoordinates();
            const midIndex = Math.floor(coordinates.length / 2);
            lonLat = ol.proj.toLonLat(coordinates[midIndex]);
        } else if (geometryType === 'Polygon') {
            // For polygon features, use the centroid
            const extent = geometry.getExtent();
            const center = ol.extent.getCenter(extent);
            lonLat = ol.proj.toLonLat(center);
        } else {
            // Fallback to extent center for other geometry types
            const extent = geometry.getExtent();
            const center = ol.extent.getCenter(extent);
            lonLat = ol.proj.toLonLat(center);
        }

        // Memory management: Check if model should be loaded
        const distance = this.getDistanceFromCamera(lonLat[0], lonLat[1], cesiumScene);
        const isVisible = this.isPositionVisible(lonLat[0], lonLat[1], cesiumScene);
        const lodLevel = this.getLODLevel(distance);

        // Skip if too far or not visible - but be less aggressive with LOD
        // Same gate as every other primitive kind. This line carried its own hardcoded
        // `* 1.5` while repetitions and area textures used
        // memoryConfig.placementRangeFactor, so base models stopped being placed
        // 1.25km before the rest of the scene did — an invisible seam where a
        // lamp post vanished but the kerb beside it stayed.
        const loadDistance = memoryConfig.loadDistance * memoryConfig.placementRangeFactor;
        if (distance > loadDistance && !isVisible) {
            return;
        }

        // Create a stable feature ID that doesn't change between calls.
        // Cached on the feature, so every sweep — and every repetition — agrees
        // on the same key (see getFeatureKey).
        const featureId = getFeatureKey(feature) || ('feature_' + fidx);

        // Hard memory budget. This guard used to read
        // `this.totalModelsAdded >= memoryConfig.maxTotalModels`, and
        // totalModelsAdded was never incremented by anything, so it never fired.
        if (!this.ensureBudget(cesiumScene)) return;

        // Debug logging
        if (debugConfig.enabled) {
            console.log(`🎯 Processing feature ${fidx} with ID: ${featureId}`);
            console.log(`🎯 Already loaded: ${this.loadedModels.has(featureId)}`);
            console.log(`🎯 Total loaded models: ${this.loadedModels.size}`);
        }

        // Skip if already loaded in THIS 3D session. The map is cleared when 3D
        // mode ends (primitives are destroyed with the scene) so re-entering 3D
        // rebuilds everything — persistent entries pointed at dead primitives.
        const tracked = this.loadedModels.get(featureId);
        if (tracked && tracked.sessionId === this._session3dId) {
            if (debugConfig.enabled) console.log(`🎯 Skipping already loaded feature: ${featureId}`);
            return;
        }

        // Use model pooling instead of creating new instances
        const model = getFeatureModelOptions(feature);
        if (!model || !model.uri) {
            if (debugConfig.enabled) console.log(`🎯 Feature ${fidx} has no valid model URI, skipping`);
            return;
        }
        
        const modelUrl = model.uri;
        
        // Check if this is an image file - skip GLTF loading for images
        const isImageFile = modelUrl && (modelUrl.toLowerCase().endsWith('.png') || modelUrl.toLowerCase().endsWith('.jpg') || modelUrl.toLowerCase().endsWith('.jpeg'));
        if (isImageFile) {
            if (debugConfig.enabled) console.log(`🎯 Skipping GLTF loading for image file: ${modelUrl}`);
            return;
        }
        
        const pooledModel = this.getModelFromPool(modelUrl, cesiumScene);
        
        // If pooledModel is null (image file), skip processing
        if (!pooledModel) {
            return;
        }
        
        // Create model matrix for positioning BEFORE setting on model
        const heightOffset = feature.get('modelHeightOffset') || 0.0;

        // Bridge / layer awareness:
        // - Bridge ways: keep their models at one sampled terrain height so
        //   they do not undulate along the way.
        // - Non-bridge ways (including everything UNDER a bridge): stay at
        //   ground level per-position DEM height, independently of the bridge.
        //   Barriers (guard rails, fences, walls) must ALWAYS be on the ground
        //   level, even if they have bridge=yes (inherited from the road they
        //   run alongside).
        const isTunnel = isTunnelFeature(feature);
        const isBridge = !isTunnel && isBridgeFeature(feature);
        const isBarrier = feature.get('barrier') || feature.get('fence_type') || feature.get('wall_type') || feature.get('wall');

        // Check for bridges above this feature. All features (except tunnels) check
        // for bridge overhead. Barriers must detect bridges above them to stay
        // on ground (not bridge deck), even if they have bridge=yes inherited.
        const bridgeAbove = isTunnel ? null : findBridgeAboveFeature(feature, lonLat);
        const underBridge = bridgeAbove
            ? getUnderBridgeSurface(feature, bridgeAbove, lonLat)
            : null;

        // Force ground elevation for barriers, ignore bridge tag
        const isActuallyBridge = isBridge && !isBarrier;

        // For barriers: use crossing interpolation if near a crossing feature,
        // otherwise use regular ground DEM (never bridge deck height)
        let terrainElevation;
        if (isTunnel) {
            terrainElevation = getTunnelElevation();
        } else if (underBridge) {
            // Feature is UNDER a bridge: use cached ground height (same as textures)
            // This applies to ALL features under bridges, including barriers with bridge=yes
            terrainElevation = underBridge.height;
        } else if (isBarrier) {
            // Barriers without bridge tag:
            // - If crossing a bridge: use bridge deck height
            // - If running alongside a highway: use highway's exact height
            // - Otherwise: use ground DEM
            const adjHighway = findAdjacentHighway(feature, lonLat);
            console.log(`🔍 Barrier: barrier=${feature.get('barrier')}, bridge=${feature.get('bridge')}, adjHighway=${adjHighway ? adjHighway.getId() : 'null'}, bridgeAbove=${bridgeAbove ? bridgeAbove.getId() : 'null'}`);

            if (adjHighway && adjHighway !== feature) {
                // Barrier runs alongside a highway - use highway's exact height
                const highwayAnchor = getFeatureAnchorLonLat(adjHighway) || lonLat;
                const highwayRefHeight = adjHighway.get('bridgeRefHeight');
                console.log(`🔍 Highway ${adjHighway.getId()}: highway=${adjHighway.get('highway')}, bridge=${adjHighway.get('bridge')}, anchor=[${highwayAnchor[0].toFixed(6)},${highwayAnchor[1].toFixed(6)}], refHeight=${highwayRefHeight}`);
                if (highwayRefHeight !== undefined && isFinite(highwayRefHeight)) {
                    terrainElevation = highwayRefHeight;
                } else {
                    terrainElevation = getBridgeReferenceHeight(adjHighway, highwayAnchor);
                    console.log(`🔍 Barrier using highway refHeight=${terrainElevation.toFixed(2)}m`);
                }
            } else {
                // No adjacent highway found - check if crossing ANY bridge feature
                const crossings = findCrossingFeatures(feature, 15);
                const crossingBridge = crossings.find(c => isBridgeFeature(c.feature));
                if (crossingBridge) {
                    terrainElevation = getBridgeReferenceHeight(crossingBridge.feature, lonLat);
                    console.log(`🔍 Barrier crossing bridge feature ${crossingBridge.feature.getId()}, using bridge height=${terrainElevation.toFixed(2)}m`);
                } else if (bridgeAbove) {
                    terrainElevation = getBridgeReferenceHeight(bridgeAbove, lonLat);
                    console.log(`🔍 Barrier crossing bridge, using bridge height=${terrainElevation.toFixed(2)}m`);
                } else {
                    // Regular ground
                    if (window.mapterhornTerrain && window.mapterhornTerrain.warmUp) {
                        try { window.mapterhornTerrain.warmUp(lonLat[0], lonLat[1]); } catch (e) { /* no DEM yet */ }
                    }
                    terrainElevation = sampleGroundElevation(lonLat[0], lonLat[1]);
                    console.log(`🔍 Barrier: no highway/bridge found, using ground=${terrainElevation.toFixed(2)}m`);
                }
            }
        } else if (isActuallyBridge) {
            // Feature is a BRIDGE (and not a barrier): use bridge reference height
            terrainElevation = getBridgeReferenceHeight(feature, lonLat);
        } else {
            // Non-bridge way: use ground elevation (sampleGroundElevation).
            // If very close to a crossing feature (<1m), interpolate instead
            // of using DEM (avoids artifacts near structures).
            const nearCrossingHeight = !isTunnel && !underBridge
                ? getInterpolatedBridgeHeight(feature, bridgeAbove, lonLat)
                : null;
            if (nearCrossingHeight !== null) {
                terrainElevation = nearCrossingHeight;
            } else {
                if (window.mapterhornTerrain && window.mapterhornTerrain.warmUp) {
                    try { window.mapterhornTerrain.warmUp(lonLat[0], lonLat[1]); } catch (e) { /* no DEM yet */ }
                }
                terrainElevation = sampleGroundElevation(lonLat[0], lonLat[1]);
            }
        }

        // Clamp to ground only when under a bridge or not a bridge feature.
        // Barriers on bridges should be at bridge deck elevation (like the highway).
        const clampToGround = underBridge || (!isBridge && !isBarrier);

        const totalHeight = heightOffset + terrainElevation;
        let modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(
            Cesium.Cartesian3.fromDegrees(lonLat[0], lonLat[1], clampToGround ? 0 : totalHeight)
        );

        // Tilt the model to follow the terrain slope
        if (!isTunnel && !isBridge && (!underBridge || isBarrier) && window.mapterhornTerrain && window.mapterhornTerrain.applySlopeTilt) {
            try {
                modelMatrix = window.mapterhornTerrain.applySlopeTilt(modelMatrix, lonLat[0], lonLat[1]);
            } catch (e) { /* no DEM data yet */ }
        }
        
        if (debugConfig.enabled && terrainElevation > 0) {
            console.log(`🎯 Model positioned at terrain elevation: ${terrainElevation.toFixed(1)}m + offset: ${heightOffset.toFixed(1)}m = ${totalHeight.toFixed(1)}m`);
        }
        
        // Apply model rotation if specified
        const modelRotation = feature.get('modelRotation');
        if (modelRotation && Array.isArray(modelRotation) && modelRotation.length >= 3) {
            if (modelRotation[1] !== 0) {
                const bearingRotation = Cesium.Matrix3.fromRotationZ(modelRotation[1]);
                modelMatrix = Cesium.Matrix4.multiplyByMatrix3(modelMatrix, bearingRotation, new Cesium.Matrix4());
            }
            
            if (modelRotation[0] !== 0) {
                const xRotation = Cesium.Matrix3.fromRotationX(modelRotation[0]);
                modelMatrix = Cesium.Matrix4.multiplyByMatrix3(modelMatrix, xRotation, new Cesium.Matrix4());
            }
            
            if (modelRotation[2] !== 0) {
                const zRotation = Cesium.Matrix3.fromRotationZ(modelRotation[2]);
                modelMatrix = Cesium.Matrix4.multiplyByMatrix3(modelMatrix, zRotation, new Cesium.Matrix4());
            }
            
            if (debugConfig.enabled) console.log(`🎯 Applied rotation to model: [${modelRotation.map(r => (r * 180 / Math.PI).toFixed(2) + '°').join(', ')}]`);
        }
        
        // IMPORTANT: no distance-based scaling. Shrinking far models made them
        // inconsistent with identical models placed near the camera and with
        // real-world sizes on terrain; real size must stay constant.
        
        // Update pooled model with ALL properties at once to prevent flashing
        pooledModel.model.modelMatrix = modelMatrix;
        pooledModel.model.scale = model.scale || 1.0;
        // Keep the sampled height explicit. Ground-clamping can snap an
        // under-bridge way onto the bridge surface, unless it's a barrier.
        pooledModel.model.heightReference = isBarrier ? Cesium.HeightReference.CLAMP_TO_GROUND : Cesium.HeightReference.NONE;
        pooledModel.model.show = true; // Ensure it's visible

        // Track loaded model for the current 3D session only
        this.trackEntry(featureId, {
            kind: 'model',
            model: pooledModel.model,
            feature: feature,
            sessionId: this._session3dId,
            // Recorded explicitly: the re-seat hook must not depend on the
            // feature property still being readable at re-seat time.
            heightOffset: heightOffset,
            isBridge: isBridge,
            isUnderBridge: !!underBridge,
            underBridgeKey: underBridge && underBridge.bridgeKey,
            surfacePosition: underBridge && underBridge.position,
            lon: lonLat[0],
            lat: lonLat[1],
            elevation: terrainElevation,
            isTunnel: isTunnel,
            distance: distance,
            lodLevel: lodLevel,
            modelUrl: modelUrl,
            lastUpdate: Date.now() // Track when it was last updated
        });

        if (debugConfig.enabled) console.log(`🎯 Added memory-managed GLTF model at:`, lonLat, `(LOD: ${lodLevel}, Distance: ${Math.round(distance)}m)`);

        // Listen for loading
        pooledModel.model.readyPromise.then(function(model) {
            if (debugConfig.enabled) console.log(`🎯 Memory-managed GLTF Model ${fidx} loaded successfully:`, model);
        }).catch(function(error) {
            // Model loading error silently handled
        });

        // NOTE: repetition models are NOT added here. addModelsFromLayer()
        // already calls addRepetitionModels() for every feature (both the
        // polygon and the non-polygon branch), and calling it a second time
        // from here added every repeated model twice — the residual duplicates
        // seen along roads (bus stops, benches, fences) after the base model
        // itself had been de-duplicated. Repetition primitives are not tracked
        // in loadedModels, so the per-session dedupe never covered them.
    },

    // Add repetition models for a feature
    addRepetitionModels: function(feature, cesiumScene) {
        // Check if this is a fence feature
        const hasFenceRepetitions = feature.get('fence_repetition_0');
        
        const isRepetition = feature.get('isRepetition');
        const hasRepetitions = feature.get('repetition_0'); // Check if this feature has repetition models
        
        if (isRepetition || hasRepetitions || hasFenceRepetitions) {
            // Determine repetition type for logging
            let repType = 'unknown';
            if (isRepetition) {
                repType = 'kerb';
            } else if (feature.get('fence_repetition_0')) {
                repType = 'fence';
            } else {
                repType = 'highway/footway';
            }
            
            if (debugConfig.enabled && debugConfig.logRepetitionModels) console.log(`Processing repetition models for ${repType} feature`);
            
            if (isRepetition) {
                // Kerb repetition: model data is stored directly on the feature
                const modelData = getFeatureModelOptions(feature);
                if (modelData && modelData.uri && modelData.position) {
                    try {
                        this.addRepetitionModel(feature, 0, modelData, cesiumScene);
                    } catch (error) {
                        // Kerb repetition model error silently handled
                    }
                } else {
                    if (debugConfig.enabled) console.warn('Kerb repetition feature missing model data');
                }
            } else {
                // Highway/Footway/Fence repetition: find all repetition models on this feature
                let repIndex = 0;
                let loggedCount = 0;
                while (true) {
                    // Check for fence repetitions first, then regular repetitions
                    const fenceRepModel = feature.get(`fence_repetition_${repIndex}`);
                    const repModel = fenceRepModel || feature.get(`repetition_${repIndex}`);
                    if (!repModel) break;
                    
                    try {
                        this.addRepetitionModel(feature, repIndex, repModel, cesiumScene);
                        repIndex++;
                    } catch (error) {
                        // Repetition model error silently handled
                        repIndex++;
                    }
                }
            }
        }
    },

    // Add individual repetition model
    addRepetitionModel: function(feature, repIndex, repModel, cesiumScene) {
        // Stable key for this (feature, repetition) pair. It used to be
        // `'rep_' + repIndex + '_' + this._repSeq` with a MONOTONIC counter, so
        // the key was different on every sweep and no sweep could ever dedupe.
        // With addAllModels() called from six places plus a guaranteed +4.5s
        // retry, each pass rebuilt every repetition primitive and stacked a
        // second copy on top of the first — doubling the scene each time.
        const featureKey = getFeatureKey(feature);
        const textureKey = featureKey ? 'reptex_' + featureKey + '_' + repIndex : null;

        // Check if this is a polygon texture instead of individual model instances
        const repType = feature.get(`repetition_${repIndex}_type`);
        if (repType === 'polygon_texture') {
            const polygonCoordinates = feature.get(`repetition_${repIndex}_polygonCoordinates`);
            const polygonHoles = feature.get(`repetition_${repIndex}_polygonHoles`) || [];
            const spacing = feature.get(`repetition_${repIndex}_spacing`);
            const imageUri = repModel.uri;

            if (polygonCoordinates && imageUri) {
                // Already built this one: the old key made every sweep add
                // another copy of the same canvas.
                if (textureKey) {
                    const built = this.loadedModels.get(textureKey);
                    if (built && built.sessionId === this._session3dId) return;
                }

                // Same range gate as every other primitive; repeated image
                // textures still allocate a GPU primitive.
                const centre = areaCentroidLonLat(polygonCoordinates);
                if (centre) {
                    const texDistance = this.getDistanceFromCamera(centre[0], centre[1], cesiumScene);
                    const texVisible = this.isPositionVisible(centre[0], centre[1], cesiumScene);
                    if (texDistance > memoryConfig.loadDistance * memoryConfig.placementRangeFactor && !texVisible) return;
                }
                if (!this.ensureBudget(cesiumScene)) return;
                let flatSurfaceHeight = null;
                let flatSurfacePosition = null;
                let surfaceHeightOffset = 0;
                let underBridgeKey = null;
                let underBridgeFeature = null;
                if (isTunnelFeature(feature)) {
                    flatSurfaceHeight = getTunnelElevation();
                } else if (centre) {
                    // Check for bridges above FIRST (before bridge feature check)
                    // so barriers under bridges use ground height, not bridge deck height
                    const bridgeAbove = findBridgeAboveFeature(feature, centre);
                    if (bridgeAbove) {
                        underBridgeFeature = findUnderBridgeWayFeature(feature, bridgeAbove, centre) || feature;
                        const surfacePosition = underBridgeFeature === feature
                            ? centre
                            : getFeatureAnchorLonLat(underBridgeFeature);
                        const underBridge = getUnderBridgeSurface(underBridgeFeature, bridgeAbove, surfacePosition);
                        surfaceHeightOffset = getFeatureHeightOffset(underBridgeFeature);
                        flatSurfaceHeight = underBridge.height + surfaceHeightOffset;
                        flatSurfacePosition = underBridge.position;
                        underBridgeKey = underBridge.bridgeKey;
                    } else if (isBridgeFeature(feature)) {
                        if (window.mapterhornTerrain && window.mapterhornTerrain.warmUp) {
                            try { window.mapterhornTerrain.warmUp(centre[0], centre[1]); } catch (e) { /* no DEM yet */ }
                        }
                        flatSurfaceHeight = getBridgeReferenceHeight(feature, centre);
                        flatSurfacePosition = feature.get('bridgeRefPosition');
                    }
                }

                // Area repetitions store polygon coordinates and their bearing
                // in WGS84 when generated. Preserve that bearing instead of
                // transforming the already-geographic coordinates a second time.
                const textureRotation = Number.isFinite(repModel.rotation)
                    ? repModel.rotation
                    : this.calculateTextureRotation(
                        polygonCoordinates,
                        imageUri,
                        feature.getProperties ? feature.getProperties() : {}
                    );
                if (modelRendererTexLog()) console.log(`🖼️ Using stored repetition rotation ${repIndex}: ${(textureRotation * 180 / Math.PI).toFixed(1)}° ${imageUri}`);
                
                if (debugConfig.enabled) console.log(`🖼️ Adding polygon texture for ${repIndex} with ${polygonCoordinates.length} coordinates and rotation: ${(textureRotation * 180 / Math.PI).toFixed(1)}°`);
                const created = this.addAreaTexture(
                    {
                        outer: polygonCoordinates,
                        holes: polygonHoles
                    },
                    imageUri,
                    {
                        spacing: spacing,
                        rotation: textureRotation,
                        textureRotationOffsetDegrees: repModel.textureRotationOffsetDegrees,
                        scale: repModel.scale,
                        bridgeSurfaceHeight: isTunnelFeature(feature) ? null : flatSurfaceHeight,
                        fixedSurfaceHeight: isTunnelFeature(feature) ? getTunnelElevation() : null,
                        undergroundFeature: feature,
                        bridgeFeature: !isTunnelFeature(feature) && isBridgeFeature(feature) ? feature : null,
                        underBridgeFeature: underBridgeFeature,
                        underBridgeKey: underBridgeKey,
                        surfaceHeightOffset: surfaceHeightOffset,
                        underBridgeSurfaceHeightOffset: surfaceHeightOffset
                    },
                    cesiumScene
                );
                // addAreaTexture used to return nothing, so these primitives
                // were unreachable: nothing could count them, destroy them, or
                // notice a second sweep had made another one.
                if (textureKey) {
                    this.trackEntry(textureKey, {
                        kind: 'texture',
                        primitives: created,
                        feature: feature,
                        isTunnel: isTunnelFeature(feature),
                        surfaceFeature: underBridgeFeature,
                        sessionId: this._session3dId,
                        bridgeSurfaceHeight: isTunnelFeature(feature) ? null : flatSurfaceHeight,
                        isUnderBridge: underBridgeKey !== null,
                        underBridgeKey: underBridgeKey,
                        surfaceHeightOffset: surfaceHeightOffset,
                        surfacePosition: flatSurfacePosition,
                        lon: centre ? centre[0] : undefined,
                        lat: centre ? centre[1] : undefined,
                        elevation: 0,
                        distance: 0,
                        lodLevel: 'texture',
                        lastUpdate: Date.now()
                    });
                }
                return;
            }
        }

        // Budget check, before any expensive placement work.
        if (!this.ensureBudget(cesiumScene)) return;

        // Original individual model logic continues below
        // Use the stored position from repetition generation
        const repPosition = repModel.position || 
                           feature.get(`fence_repetition_${repIndex}_position`) || 
                           feature.get(`repetition_${repIndex}_position`);
        if (!repPosition) {
            if (debugConfig.enabled) console.warn(`No position found for repetition model ${repIndex}`);
            return;
        }
        
        // The repPosition is already in lon/lat format (from line_repetition.js)
        // No need to convert again
        const repLonLat = repPosition;

        // Distance gate.
        //
        // This gate — and the `const repScene = ...` that used to follow it —
        // were swallowed into the end of this comment by a bad edit:
        //
        //     // lamps — that were never unloaded. Base models already had this gate.const repScene = ...
        //
        // so the code compiled, the comment described a check that did not
        // exist, and repetitions were placed at ANY distance from the camera.
        // Base models were range-gated; repetitions were not. On pedrola.geojson
        // that is 197km of ways at 20-50cm spacing, so the live primitive count
        // scaled with the FILE, not with the view.
        const repDistance = this.getDistanceFromCamera(repLonLat[0], repLonLat[1], cesiumScene);
        const repVisible = this.isPositionVisible(repLonLat[0], repLonLat[1], cesiumScene);
        if (repDistance > memoryConfig.loadDistance * memoryConfig.placementRangeFactor && !repVisible) {
            return;
        }

        const repKey = featureKey ? 'rep_' + featureKey + '_' + repIndex : null;
        if (repKey) {
            const built = this.loadedModels.get(repKey);
            if (built && built.sessionId === this._session3dId) return;
        }

        if (debugConfig.enabled) console.log(`🚶 Repetition model ${repIndex} using stored position: [${repPosition[0].toFixed(6)}, ${repPosition[1].toFixed(6)}] (already lon/lat)`);
        
        // Check if model is an image file (PNG/JPG)
        const modelUri = repModel.uri;
        const isRepImageFile = modelUri && (modelUri.toLowerCase().endsWith('.png') || modelUri.toLowerCase().endsWith('.jpg') || modelUri.toLowerCase().endsWith('.jpeg'));
        
        if (isRepImageFile) {
            // Handle image files using billboards
            if (debugConfig.enabled) console.log(`🚶 Loading image file as billboard: ${modelUri}`);
            this.addImageBillboard(repLonLat, modelUri, repModel, cesiumScene);
            return;
        }
        
        // Keep bridge repetitions level with one sampled terrain height.
        const repIsTunnel = isTunnelFeature(feature);
        const repIsBridge = !repIsTunnel && isBridgeFeature(feature);
        const repIsBarrier = feature.get('barrier') || feature.get('fence_type') || feature.get('wall_type') || feature.get('wall');

        if (repIsBarrier) {
            console.log(`🔍 Rep barrier feature ${feature.getId()}: barrier=${feature.get('barrier')}, bridge=${feature.get('bridge')}, layer=${feature.get('layer')}, repIsTunnel=${repIsTunnel}, repIsBridge=${repIsBridge}, repLonLat=[${repLonLat[0].toFixed(6)},${repLonLat[1].toFixed(6)}]`);
        }

        // Check for bridges above this feature. All features (except tunnels) check
        // for bridge overhead.
        const bridgeAbove = repIsTunnel ? null : findBridgeAboveFeature(feature, repLonLat);
        const underBridge = bridgeAbove
            ? getUnderBridgeSurface(feature, bridgeAbove, repLonLat)
            : null;

        // Create model matrix for repetition model - GROUND LEVEL (like footway)
        const repHeightOffset = feature.get(`fence_repetition_${repIndex}_heightOffset`) || 
                               feature.get(`repetition_${repIndex}_heightOffset`) || 0; // Use stored height offset instead of hardcoded 10

        // Prime the DEM tile before sampling (see addModelForFeature): without it
        // repetitions placed early in a session are built at elevation 0.
        if (!repIsTunnel && window.mapterhornTerrain && window.mapterhornTerrain.warmUp) {
            try { window.mapterhornTerrain.warmUp(repLonLat[0], repLonLat[1]); } catch (e) { /* no DEM yet */ }
        }
        
        // Get terrain elevation. For bridges: cache reference DEM height on
        // first repetition so the whole bridge stays FLAT at one elevation
        // (no undulation down mountains). Non-bridge ways sample per-position
        // (ground level) and must NOT climb up to meet the bridge.
        // BARRIERS use exact highway height when adjacent.
        let repTerrainElevation;
        if (repIsTunnel) {
            repTerrainElevation = getTunnelElevation();
        } else if (underBridge) {
            // Feature is UNDER a bridge: use cached ground height (same as textures)
            // This applies to ALL features under bridges, including barriers with bridge=yes
            repTerrainElevation = underBridge.height;
        } else if (repIsBarrier) {
            // Barriers without bridge tag:
            // - If crossing a bridge: use bridge deck height
            // - If running alongside a highway: use highway's exact height
            const adjHighway = findAdjacentHighway(feature, repLonLat);
            console.log(`🔍 Rep Barrier: barrier=${feature.get('barrier')}, bridge=${feature.get('bridge')}, adjHighway=${adjHighway ? adjHighway.getId() : 'null'}`);

            if (adjHighway && adjHighway !== feature) {
                // Barrier runs alongside a highway - use highway's exact height
                const highwayAnchor = getFeatureAnchorLonLat(adjHighway) || repLonLat;
                const highwayRefHeight = adjHighway.get('bridgeRefHeight');
                console.log(`🔍 Rep Highway ${adjHighway.getId()}: highway=${adjHighway.get('highway')}, bridge=${adjHighway.get('bridge')}, anchor=[${highwayAnchor[0].toFixed(6)},${highwayAnchor[1].toFixed(6)}], refHeight=${highwayRefHeight}`);
                if (highwayRefHeight !== undefined && isFinite(highwayRefHeight)) {
                    repTerrainElevation = highwayRefHeight;
                } else {
                    repTerrainElevation = getBridgeReferenceHeight(adjHighway, highwayAnchor);
                    console.log(`🔍 Rep Barrier using highway refHeight=${repTerrainElevation.toFixed(2)}m`);
                }
            } else {
                // No adjacent highway found - check if crossing ANY bridge feature
                const crossings = findCrossingFeatures(feature, 15);
                const crossingBridge = crossings.find(c => isBridgeFeature(c.feature));
                if (crossingBridge) {
                    repTerrainElevation = getBridgeReferenceHeight(crossingBridge.feature, repLonLat);
                    console.log(`🔍 Rep Barrier crossing bridge feature ${crossingBridge.feature.getId()}, using bridge height=${repTerrainElevation.toFixed(2)}m`);
                } else if (bridgeAbove) {
                    repTerrainElevation = getBridgeReferenceHeight(bridgeAbove, repLonLat);
                    console.log(`🔍 Rep Barrier crossing bridge, using bridge height=${repTerrainElevation.toFixed(2)}m`);
                } else {
                    if (window.mapterhornTerrain && window.mapterhornTerrain.warmUp) {
                        try { window.mapterhornTerrain.warmUp(repLonLat[0], repLonLat[1]); } catch (e) { /* no DEM yet */ }
                    }
                    repTerrainElevation = sampleGroundElevation(repLonLat[0], repLonLat[1]);
                    console.log(`🔍 Rep Barrier: no highway/bridge found, using ground=${repTerrainElevation.toFixed(2)}m`);
                }
            }
        } else if (repIsBridge && !repIsBarrier) {
            repTerrainElevation = getBridgeReferenceHeight(feature, repLonLat);
        } else {
            // Non-bridge way: use ground elevation, but if very close to a
            // crossing feature (<1m), interpolate instead of DEM.
            const nearCrossingHeight = !repIsTunnel && !underBridge
                ? getInterpolatedBridgeHeight(feature, bridgeAbove, repLonLat)
                : null;
            if (nearCrossingHeight !== null) {
                repTerrainElevation = nearCrossingHeight;
            } else {
                if (window.mapterhornTerrain && window.mapterhornTerrain.warmUp) {
                    try { window.mapterhornTerrain.warmUp(repLonLat[0], repLonLat[1]); } catch (e) { /* no DEM yet */ }
                }
                repTerrainElevation = sampleGroundElevation(repLonLat[0], repLonLat[1]);
            }
        }

        const repClampToGround = underBridge || (!repIsBridge && !repIsBarrier);

        const repTotalHeight = repHeightOffset + repTerrainElevation;
        let repModelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(
            Cesium.Cartesian3.fromDegrees(repLonLat[0], repLonLat[1], repClampToGround ? 0 : repTotalHeight)
        );

        // Follow terrain slope so poles/fences stand perpendicular to the ground
        if (!repIsTunnel && !repIsBridge && (!underBridge || repIsBarrier) && window.mapterhornTerrain && window.mapterhornTerrain.applySlopeTilt) {
            try {
                repModelMatrix = window.mapterhornTerrain.applySlopeTilt(repModelMatrix, repLonLat[0], repLonLat[1]);
            } catch (e) { /* no DEM data yet */ }
        }
        
        if (debugConfig.enabled && repTerrainElevation > 0) {
            console.log(`🚶 Repetition model ${repIndex} positioned at terrain elevation: ${repTerrainElevation.toFixed(1)}m + offset: ${repHeightOffset.toFixed(1)}m = ${repTotalHeight.toFixed(1)}m`);
        }
        
        // Apply repetition model rotation
        let repModelRotation = null;
        
        // For kerb repetitions, rotation is stored as 'modelRotation'
        if (feature.get('isRepetition')) {
            repModelRotation = feature.get('modelRotation');
        } else {
            // Check for fence repetitions first, then highway/footway repetitions
            repModelRotation = feature.get(`fence_repetition_${repIndex}_rotation`) || 
                              feature.get(`repetition_${repIndex}_rotation`);
        }
        
        if (repModelRotation && Array.isArray(repModelRotation) && repModelRotation.length >= 3) {
            if (repModelRotation[1] !== 0) {
                const bearingRotation = Cesium.Matrix3.fromRotationZ(repModelRotation[1]);
                repModelMatrix = Cesium.Matrix4.multiplyByMatrix3(repModelMatrix, bearingRotation, new Cesium.Matrix4());
            }
            if (repModelRotation[0] !== 0) {
                const xRotation = Cesium.Matrix3.fromRotationX(repModelRotation[0]);
                repModelMatrix = Cesium.Matrix4.multiplyByMatrix3(repModelMatrix, xRotation, new Cesium.Matrix4());
            }
            if (repModelRotation[2] !== 0) {
                const zRotation = Cesium.Matrix3.fromRotationZ(repModelRotation[2]);
                repModelMatrix = Cesium.Matrix4.multiplyByMatrix3(repModelMatrix, zRotation, new Cesium.Matrix4());
            }
        }
        
        if (debugConfig.enabled) console.log(`🚶 Applied rotation to repetition model ${repIndex}: [${(repModelRotation || [0, 0, 0]).map(r => (r * 180 / Math.PI).toFixed(2) + '°').join(', ')}]`);
        
        if (debugConfig.enabled) console.log(`🚶 Repetition model url: ${repModel.uri}`);
        
        // Check if this is an image file - skip GLTF loading for images
        const isRepModelImageFile = repModel.uri && (repModel.uri.toLowerCase().endsWith('.png') || repModel.uri.toLowerCase().endsWith('.jpg') || repModel.uri.toLowerCase().endsWith('.jpeg'));
        if (isRepModelImageFile) {
            if (debugConfig.enabled) console.log(`🚶 Skipping GLTF loading for image file: ${repModel.uri}`);
            return;
        }
        
        const sceneToUse = cesiumScene || window.ol3d.getCesiumScene();
        const repCesiumModel = sceneToUse.primitives.add(Cesium.Model.fromGltf({
            url: repModel.uri,
            modelMatrix: repModelMatrix,
            scale: repModel.scale || 1.0,
            show: true
        }));
        
        // Keep the sampled height explicit for non-barriers (to avoid ground-clamp
        // snapping under-bridge ways onto the bridge surface). Barriers under bridges
        // should use CLAMP_TO_GROUND so they stay on the terrain, not at bridge height.
        repCesiumModel.heightReference = repIsBarrier ? Cesium.HeightReference.CLAMP_TO_GROUND : Cesium.HeightReference.NONE;

        // Track repetition models so the DEM re-seat hook can re-ground them
        // when terrain tiles refine AFTER placement (without this, kerbs,
        // fences and lamps placed before fine tiles arrived stayed floating).
        this._repSeq = (this._repSeq || 0) + 1;
        this.trackEntry(repKey || ('rep_' + repIndex + '_' + this._repSeq), {
            kind: 'repetition',
            model: repCesiumModel,
            scene: sceneToUse,
            feature: feature,
            sessionId: this._session3dId,
            heightOffset: repHeightOffset,
            isBridge: repIsBridge,
            isUnderBridge: !!underBridge,
            underBridgeKey: underBridge && underBridge.bridgeKey,
            surfacePosition: underBridge && underBridge.position,
            lon: repLonLat[0],
            lat: repLonLat[1],
            elevation: repTerrainElevation,
            distance: repDistance,
            lodLevel: 'rep',
            modelUrl: repModel.uri,
            isTunnel: repIsTunnel,
            lastUpdate: Date.now()
        });
        
        if (debugConfig.enabled && debugConfig.logRepetitionModels) console.log(`🚶 Added repetition GLTF model ${repIndex} at ground position:`, repLonLat);
    },

    // Add area texture for polygon features
    addAreaTextureForFeature: function(feature, model, fidx, cesiumScene) {
        if (debugConfig.enabled) console.log(`🎨 Adding area texture for polygon feature ${fidx} with model: ${model.uri}`);

        const geometry = feature.getGeometry();
        if (!geometry || !geometry.getType || (geometry.getType() !== 'Polygon' && geometry.getType() !== 'MultiPolygon')) {
            if (debugConfig.enabled) console.warn(`🎨 Feature ${fidx} is not a polygon, skipping area texture`);
            return;
        }

        // Get feature properties and create tags object
        const properties = feature.getProperties();
        const tagsObj = {};

        // Extract OSM tags from properties
        Object.keys(properties).forEach(prop => {
            if (!['geometry', 'id', 'type', 'originalType', 'fixedGeometry', 'members', 'memberOf', 'member', 'membership', 'role', 'version', 'timestamp', 'changeset', 'user', 'uid', 'visible'].includes(prop)) {
                tagsObj[prop] = properties[prop];
            }
        });

        // Range gate and budget, BEFORE anything is built.
        //
        // This path had neither. The polygon_texture branch of
        // addRepetitionModel() gates on distance and calls ensureBudget();
        // this one went straight into createAreaEntity, so on a large file every
        // tagged polygon in the file got a canvas and a GroundPrimitive
        // regardless of where it was, and it could push the scene past the
        // budget no matter how many were already resident.
        const areaCentre = areaGeometryCentreLonLat(geometry);
        const isTunnel = isTunnelFeature(feature);
        const bridgeAbove = isTunnel || !areaCentre
            ? null
            : findBridgeAboveFeature(feature, areaCentre);
        const underBridgeFeature = bridgeAbove
            ? (findUnderBridgeWayFeature(feature, bridgeAbove, areaCentre) || feature)
            : null;
        const underBridgePosition = underBridgeFeature && underBridgeFeature !== feature
            ? getFeatureAnchorLonLat(underBridgeFeature)
            : areaCentre;
        const underBridge = bridgeAbove
            ? getUnderBridgeSurface(underBridgeFeature, bridgeAbove, underBridgePosition)
            : null;
        const underBridgeHeightOffset = underBridge
            ? getFeatureHeightOffset(underBridgeFeature)
            : 0;
        if (areaCentre) {
            const areaDistance = this.getDistanceFromCamera(areaCentre[0], areaCentre[1], cesiumScene);
            const areaVisible = this.isPositionVisible(areaCentre[0], areaCentre[1], cesiumScene);
            if (areaDistance > memoryConfig.loadDistance * memoryConfig.placementRangeFactor && !areaVisible) return;
        }
        if (!this.ensureBudget(cesiumScene)) return;

        // Check if model URI is valid
        if (!model || !model.uri || model.uri.trim() === '') {
            console.warn(`🎨 Feature ${fidx} has invalid model URI, skipping area texture`);
            return;
        }

        // Check if area texture manager is available
        if (!window.areaTextureManager) {
            console.error(`🎨 Area texture manager not available for feature ${fidx}`);
            return;
        }

        if (debugConfig.enabled) {
            console.log(`🎨 Creating area entity for feature ${fidx} with texture: ${model.uri}`);
            console.log(`🎨 Feature tags:`, tagsObj);
            console.log(`🎨 Model config:`, model);
        }

        // Use the area texture manager to create the entity
        try {
            const textureModel = isTunnel
                ? Object.assign({}, model, {
                    fixedSurfaceHeight: getTunnelElevation(),
                    tunnelSurface: true
                })
                : (underBridge
                    ? Object.assign({}, model, {
                        underBridgeSurfaceHeight: underBridge.height + underBridgeHeightOffset,
                        underBridgeSurfacePosition: underBridge.position,
                        underBridgeBridgeKey: underBridge.bridgeKey,
                        underBridgeSurfaceHeightOffset: underBridgeHeightOffset,
                        underBridgeSurfaceFeature: underBridgeFeature
                    })
                    : model);
            const areaEntity = window.areaTextureManager.createAreaEntity(
                feature,
                model.uri, // This is the texture filename
                textureModel,
                tagsObj,
                properties
            );

            if (areaEntity) {
                if (debugConfig.enabled) console.log(`🎨 Successfully created area texture entity for feature ${fidx}`);
                // createAreaEntity() does its own "already has one" early-return,
                // so this cannot double-build; it just makes the primitive
                // visible to the census and to the unload path.
                //
                // Deliberately NOT inside the surrounding try. If tracking threw,
                // that catch would swallow it and leave a GroundPrimitive in
                // the scene that nothing owns — the precise leak this tracking
                // exists to remove.
                const key = getFeatureKey(feature);
                if (key) {
                    this.trackEntry('areatex_' + key, {
                        kind: 'texture',
                        primitives: areaEntity,
                        feature: feature,
                        isTunnel: isTunnel,
                        surfaceFeature: underBridgeFeature,
                        sessionId: this._session3dId,
                        bridgeSurfaceHeight: isBridgeFeature(feature)
                            ? feature.get('bridgeRefHeight')
                            : (underBridge
                                ? underBridge.height + underBridgeHeightOffset
                                : null),
                        isUnderBridge: !!underBridge,
                        underBridgeKey: underBridge && underBridge.bridgeKey,
                        surfaceHeightOffset: underBridgeHeightOffset,
                        surfacePosition: isBridgeFeature(feature)
                            ? (feature.get('bridgeRefPosition') || areaCentre)
                            : (underBridge ? underBridge.position : null),
                        lon: areaCentre ? areaCentre[0] : undefined,
                        lat: areaCentre ? areaCentre[1] : undefined,
                        elevation: 0,
                        distance: 0,
                        lodLevel: 'texture',
                        lastUpdate: Date.now()
                    });
                }
            } else {
                console.warn(`🎨 Failed to create area texture entity for feature ${fidx} - createAreaEntity returned null`);
            }
        } catch (error) {
            console.error(`🎨 Error creating area texture entity for feature ${fidx}:`, error);
        }
    },

    // Add image billboard for PNG/JPG files
    addImageBillboard: function(position, imageUri, repModel, cesiumScene) {
        if (debugConfig.enabled) {
            console.warn('🖼️ addImageBillboard is deprecated; use addAreaTexture for polygon coverage');
        }
    },

    // Add textured polygon for area coverage
    addAreaTexture: function(polygonData, imageUri, repModel, cesiumScene) {
        // Returns the area texture primitives it created, so the caller can
        // record them. It used to return nothing at all, which is why nothing
        // in this file could ever count, evict or destroy an area texture.
        const created = [];
        const polygonCoordinates = Array.isArray(polygonData) ? polygonData : polygonData.outer;
        const polygonHoles = Array.isArray(polygonData) ? [] : (polygonData.holes || []);
        if (debugConfig.enabled) console.log(`🖼️ addAreaTexture called with ${polygonCoordinates.length} outer coordinates and ${polygonHoles.length} hole(s), texture: ${imageUri}`);
        
        // Scale debug removed

        const sceneToUse = cesiumScene || window.ol3d.getCesiumScene();

        // Convert polygon coordinates to Cartesian3 WITHOUT explicit heights:
        // the polygon is ground-clamped (see entity below), so Cesium drapes it
        // over the rendered terrain (MapTerhorn DEM) and the base imagery
        // exactly — no step edges, no z-fighting, always aligned with ways on
        // slopes. (Per-vertex heights were tried here and broke rendering:
        // sparse OSM vertices made the triangulation cut into convex terrain.)
        let bridgeSurfaceHeight = repModel && isFinite(repModel.bridgeSurfaceHeight)
            ? repModel.bridgeSurfaceHeight
            : null;
        if (repModel && isFinite(repModel.fixedSurfaceHeight)) {
            bridgeSurfaceHeight = repModel.fixedSurfaceHeight;
        }
        const bridgeFeature = repModel && repModel.bridgeFeature;
        const createPolygonHierarchy = (surfaceHeight) => {
            const positions = polygonCoordinates.map(coord =>
                surfaceHeight === null
                ? Cesium.Cartesian3.fromDegrees(coord[0], coord[1])
                    : Cesium.Cartesian3.fromDegrees(coord[0], coord[1], surfaceHeight)
            );
            const holeHierarchies = polygonHoles.map(holeRing =>
                new Cesium.PolygonHierarchy(holeRing.map(coord =>
                    surfaceHeight === null
                    ? Cesium.Cartesian3.fromDegrees(coord[0], coord[1])
                        : Cesium.Cartesian3.fromDegrees(coord[0], coord[1], surfaceHeight))));
            return new Cesium.PolygonHierarchy(positions, holeHierarchies);
        };

        // Calculate bounding box in degrees
        let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
        polygonCoordinates.forEach(coord => {
            minLon = Math.min(minLon, coord[0]);
            maxLon = Math.max(maxLon, coord[0]);
            minLat = Math.min(minLat, coord[1]);
            maxLat = Math.max(maxLat, coord[1]);
        });

        // Calculate center latitude for accurate meter conversion
        const centerLat = (minLat + maxLat) / 2;

        // Convert degree differences to meters
        const widthMeters = (maxLon - minLon) * 111320 * Math.cos(centerLat * Math.PI / 180);
        const heightMeters = (maxLat - minLat) * 111320;

        // Use provided rotation or calculate new one
        let textureRotation;
        if (repModel && repModel.rotation !== undefined) {
            textureRotation = repModel.rotation;
            if (modelRendererTexLog()) console.log(`🖼️ Using provided rotation from repModel: ${(textureRotation * 180 / Math.PI).toFixed(1)}°`);
        } else {
            textureRotation = this.calculateTextureRotation(
                polygonCoordinates,
                imageUri,
                repModel && repModel.featureTags ? repModel.featureTags : {}
            );
            if (modelRendererTexLog()) console.log(`🖼️ Calculated texture rotation: ${(textureRotation * 180 / Math.PI).toFixed(1)}°`);
        }

        // Load image to get dimensions for proper scaling
        const img = new Image();
        let texturedPolygon; // Declare for scope

        img.onload = () => {
            if (bridgeFeature) {
                const refinedHeight = bridgeFeature.get('bridgeRefHeight');
                if (refinedHeight !== undefined && refinedHeight !== null && isFinite(refinedHeight)) {
                    bridgeSurfaceHeight = refinedHeight;
                    polygonHierarchy = createPolygonHierarchy(bridgeSurfaceHeight);
                }
            } else if (repModel && repModel.underBridgeFeature && repModel.underBridgeKey) {
                const surfaces = repModel.underBridgeFeature.get('underBridgeSurfaces') || {};
                const surface = surfaces[repModel.underBridgeKey];
                if (surface && isFinite(surface.height)) {
                    bridgeSurfaceHeight = surface.height + (repModel.underBridgeSurfaceHeightOffset || 0);
                    polygonHierarchy = createPolygonHierarchy(bridgeSurfaceHeight);
                }
            }
            const imageWidth = img.naturalWidth || img.width;
            const imageHeight = img.naturalHeight || img.height;
            if (!imageWidth || !imageHeight) {
                console.error(`🖼️ Texture ${imageUri} has invalid dimensions: ${imageWidth}x${imageHeight}`);
                return;
            }

            // Repeat the original texture on the GPU. The short image side maps
            // to the configured tile size; the other side follows its aspect.
            const baseTextureSizeMeters = repModel.spacing || 1.0;
            const textureScale = repModel.scale || 1.0;
            const desiredTileSize = baseTextureSizeMeters * textureScale;
            if (!Number.isFinite(desiredTileSize) || desiredTileSize <= 0) {
                throw new RangeError('Area texture tile size must be a positive number');
            }
            const shortImageSide = Math.min(imageWidth, imageHeight);
            const tileWidthMeters = desiredTileSize * imageWidth / shortImageSide;
            const tileHeightMeters = desiredTileSize * imageHeight / shortImageSide;
            const textureRotationOffsetDegrees = Number.isFinite(repModel.textureRotationOffsetDegrees)
                ? repModel.textureRotationOffsetDegrees
                : 0;
            const finalRotation = textureRotation;

            if (debugConfig.enabled) {
                console.log(`🖼️ Native-resolution repeat: ${tileWidthMeters.toFixed(2)}m x ${tileHeightMeters.toFixed(2)}m tiles across ${widthMeters.toFixed(2)}m x ${heightMeters.toFixed(2)}m area`);
            }

            const textureScene = cesiumScene ||
                (window.ol3d && window.ol3d.getCesiumScene ? window.ol3d.getCesiumScene() : null);
            if (textureScene && polygonHierarchy) {
                try {
                    const texturePrimitive = bridgeSurfaceHeight === null
                        ? Cesium.GroundPrimitive
                        : Cesium.Primitive;
                    // PolygonGeometry clamps stRotation against its unrotated
                    // bounds. Rotate in meter space in the material instead,
                    // so angled tiles keep the same dimensions without clipping.
                    const primitive = new texturePrimitive({
                        geometryInstances: new Cesium.GeometryInstance({
                            geometry: new Cesium.PolygonGeometry({
                                polygonHierarchy,
                                vertexFormat: Cesium.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat,
                                perPositionHeight: bridgeSurfaceHeight !== null
                            })
                        }),
                        appearance: new Cesium.MaterialAppearance({
                            material: new Cesium.Material({
                                fabric: {
                                    type: 'WorldScaleImage',
                                    uniforms: {
                                        image: imageUri,
                                        areaSizeMeters: new Cesium.Cartesian2(widthMeters, heightMeters),
                                        tileSizeMeters: new Cesium.Cartesian2(tileWidthMeters, tileHeightMeters),
                                        textureRotation: -finalRotation +
                                            textureRotationOffsetDegrees * Math.PI / 180
                                    },
                                    source: `
                                        czm_material czm_getMaterial(czm_materialInput materialInput) {
                                            czm_material material = czm_getDefaultMaterial(materialInput);
                                            vec2 localPosition = (materialInput.st - vec2(0.5)) * areaSizeMeters;
                                            float cosine = cos(textureRotation);
                                            float sine = sin(textureRotation);
                                            vec2 rotatedPosition = vec2(
                                                cosine * localPosition.x - sine * localPosition.y,
                                                sine * localPosition.x + cosine * localPosition.y
                                            );
                                            vec2 textureSt = rotatedPosition / tileSizeMeters;
                                            vec4 texel = texture2D(image, fract(textureSt));
                                            material.diffuse = czm_gammaCorrect(texel.rgb);
                                            material.alpha = texel.a;
                                            return material;
                                        }
                                    `
                                }
                            }),
                            translucent: true
                        }),
                        asynchronous: false
                    });
                    if (repModel && repModel.undergroundFeature) {
                        primitive.show = isUndergroundFeature(repModel.undergroundFeature) === isUndergroundViewEnabled();
                    }
                    textureScene.primitives.add(primitive);
                    created.push(primitive);
                    if (modelRendererTexLog()) {
                        console.log(`🖼️ Created repeated texture with rotation ${(finalRotation * 180 / Math.PI).toFixed(1)}°`);
                    }
                } catch (error) {
                    console.error('🖼️ Failed to create repeated area texture:', error);
                }
            }
        };

        // Everything the onload handler needs is built BEFORE `img.src` is
        // assigned.
        //
        // `polygonHierarchy` used to be declared ten lines below `img.src`. The
        // handler reads it, so the ordering only held together because setting
        // `src` is normally asynchronous. Anything that completes the load
        // synchronously — an already-decoded image in the browser cache — runs
        // the handler while `polygonHierarchy` is still in its temporal dead
        // zone; the ReferenceError is thrown inside the handler's own
        // try/catch, so it is swallowed and the area texture silently never
        // appears. Building it first removes the ordering dependency entirely.

        // Create polygon hierarchy
        let polygonHierarchy = createPolygonHierarchy(bridgeSurfaceHeight);

        img.src = imageUri;

        // Terrain-following textures use GroundPrimitive; bridge surfaces use
        // a flat Primitive at their reference height. Both are created inside
        // img.onload above, once the texture image has loaded.
        //
        // `created` is returned by reference and filled in by the handler when
        // the image arrives, so the caller's array ends up holding every
        // primitive that was made — including ones built a moment later.
        return created;
    },

    /**
     * Calculate texture rotation based on nearby ways that cross or are adjacent to the texture area
     * @param {Array<Array<number>>} polygonCoordinates - Polygon coordinates [lon, lat]
     * @param {string} textureName - Name of the texture file
     * @returns {number} Rotation angle in radians (0 if no rotation needed)
     */
    calculateTextureRotation: function(polygonCoordinates, textureName, tagsObj = {}) {
        if (modelRendererTexLog()) console.log(`🖼️ calculateTextureRotation: ${textureName}`);

        const isFootwayTexture = textureName.toLowerCase().includes('i_llamborda.jpg');
        const textureTags = tagsObj || {};
        const isFootwayArea = isFootwayTexture && (
            textureTags['area:highway'] === 'footway' ||
            textureTags.highway === 'footway' ||
            textureTags.footway === 'sidewalk'
        );
        const isCrossingTexture = textureName.toLowerCase().includes('i_crossing.png') ||
                                textureName.toLowerCase().includes('crossing');
        const isParkingTexture = textureName.toLowerCase().includes('i_parking');

        if (modelRendererTexLog()) console.log(`🖼️ isCrossingTexture: ${isCrossingTexture}`);

        if (isCrossingTexture) {
            if (modelRendererTexLog()) console.log(`🖼️ crossing texture path`);
            const crossingRotation = this.calculateCrossingTextureRotation(polygonCoordinates, textureName);
            if (modelRendererTexLog()) console.log(`🖼️ crossing rotation: ${crossingRotation}`);
            if (crossingRotation !== null) {
                if (modelRendererTexLog()) console.log(`🖼️ crossing bearing °: ${(crossingRotation * 180 / Math.PI).toFixed(1)}`);
                return crossingRotation;
            }
        } else {
            const isLimitTexture = textureName.toLowerCase().includes('i_llamborda.jpg') ||
                                  textureName.toLowerCase().includes('i_parking.png') ||
                                  textureName.toLowerCase().includes('i_parking.jpg') ||
                                  textureName.toLowerCase().includes('i_parking_space.jpg') ||
                                  textureName.toLowerCase().includes('i_parking_space_disabled.jpg') ||
                                  textureName.toLowerCase().includes('i_asfalt.jpg') ||
                                  textureName.toLowerCase().includes('i_gespa.jpg') ||
                                  textureName.toLowerCase().includes('i_manhole_drain.jpg') ||
                                  textureName.toLowerCase().includes('i_aigua.jpg') ||
                                  textureName.toLowerCase().includes('i_terra_verd.jpg');

            if (modelRendererTexLog()) console.log(`🖼️ isLimitTexture: ${isLimitTexture}`);

            if (isLimitTexture && !isFootwayArea && !isParkingTexture) {
                if (modelRendererTexLog()) console.log(`🖼️ limit/adjacent texture path (polygon longest edge)`);
                const limitRotation = this.calculateCrossingTextureRotation(polygonCoordinates, textureName);
                if (modelRendererTexLog()) console.log(`🖼️ limit rotation: ${limitRotation}`);
                if (limitRotation !== null) {
                    if (modelRendererTexLog()) console.log(`🖼️ limit bearing °: ${(limitRotation * 180 / Math.PI).toFixed(1)}`);
                    return limitRotation;
                }
            }
        }

        try {
            const layers = this.getAllMapLayers(window.map.getLayers().getArray());
            const nearbyWays = [];

            if (modelRendererTexLog()) console.log(`🖼️ scanning ${layers.length} layers for ways`);

            layers.forEach((layer, layerIndex) => {
                if (layer.getSource && typeof layer.getSource === 'function') {
                    const source = layer.getSource();
                    if (source && source.getFeatures) {
                        const features = source.getFeatures();
                        if (modelRendererTexLog()) console.log(`🖼️ layer ${layerIndex}: ${features.length} features`);

                        features.forEach((feature, featureIndex) => {
                            const geometry = feature.getGeometry();
                            if (geometry && (geometry.getType() === 'LineString' || geometry.getType() === 'MultiLineString')) {
                                if (this.wayIntersectsOrAdjacentToPolygon(geometry, polygonCoordinates)) {
                                    nearbyWays.push(feature);
                                    if (modelRendererTexLog()) console.log(`🖼️ nearby way L${layerIndex} F${featureIndex}`);
                                }
                            }
                        });
                    }
                }
            });

            if (modelRendererTexLog()) console.log(`🖼️ nearby ways: ${nearbyWays.length}`);

            let sourceWays = nearbyWays;
            if (isFootwayArea) {
                const footwayWays = nearbyWays.filter(feature =>
                    feature.get && (
                        feature.get('highway') === 'footway' ||
                        feature.get('footway') === 'sidewalk' ||
                        feature.get('area:highway') === 'footway'
                    )
                );
                sourceWays = footwayWays;
            }
            if (isParkingTexture) {
                const kerbWays = nearbyWays.filter(f => f.get && f.get('barrier') === 'kerb');
                if (kerbWays.length > 0) {
                    if (modelRendererTexLog()) console.log(`🖼️ parking: using ${kerbWays.length} kerb way(s)`);
                    sourceWays = kerbWays;
                }
            }

            if (sourceWays.length === 0) {
                if (isFootwayArea) {
                    const polygonRotation = this.calculateCrossingTextureRotation(
                        polygonCoordinates,
                        textureName
                    );
                    if (polygonRotation !== null) return polygonRotation;
                }
                const closestFallbackSegment = this.findClosestWaySegmentToPolygon(
                    layers,
                    polygonCoordinates,
                    40,
                    isParkingTexture ? { key: 'barrier', value: 'kerb' } : null
                );
                if (closestFallbackSegment) {
                    if (modelRendererTexLog()) console.log(`🖼️ fallback segment d=${closestFallbackSegment.distance.toFixed(2)}m °=${(closestFallbackSegment.bearing * 180 / Math.PI).toFixed(1)}`);
                    return -closestFallbackSegment.bearing;
                }
                if (modelRendererTexLog()) console.log(`🖼️ no ways → rotation 0`);
                return 0;
            }

            // Pick the closest relevant way segment instead of averaging many ways.
            // Averaging can cancel out opposite directions and default texture to north.
            let bestSegment = null;
            sourceWays.forEach((feature, index) => {
                const geometry = feature.getGeometry();
                const coords = geometry.getType() === 'LineString' ?
                    geometry.getCoordinates() :
                    geometry.getCoordinates().flat();

                if (modelRendererTexLog()) console.log(`🖼️ way ${index}: ${coords.length} coords`);

                // Convert to EPSG:4326 if needed
                const lonLatCoords = coords.map(coord =>
                    ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326')
                );

                if (modelRendererTexLog()) console.log(`🖼️ way ${index} sample`, lonLatCoords.slice(0, 2));

                for (let i = 0; i < lonLatCoords.length - 1; i++) {
                    const start = lonLatCoords[i];
                    const end = lonLatCoords[i + 1];
                    const segment = [start, end];
                    const segmentDistance = this.lineSegmentDistanceToPolygonMeters(segment, polygonCoordinates);
                    const segmentLength = this.haversineDistance(start, end);
                    const segmentBearing = this.calculateSegmentBearing(start, end);

                    if (segmentBearing === null) continue;

                    if (!bestSegment ||
                        segmentDistance < bestSegment.distance - 0.001 ||
                        (Math.abs(segmentDistance - bestSegment.distance) < 0.001 && segmentLength > bestSegment.length)) {
                        bestSegment = {
                            distance: segmentDistance,
                            length: segmentLength,
                            bearing: segmentBearing,
                            wayIndex: index
                        };
                    }
                }
            });

            if (!bestSegment) {
                if (modelRendererTexLog()) console.log(`🖼️ no best segment → 0`);
                return 0;
            }

            if (modelRendererTexLog()) {
                console.log(`🖼️ best seg way ${bestSegment.wayIndex} d=${bestSegment.distance.toFixed(2)}m °=${(bestSegment.bearing * 180 / Math.PI).toFixed(1)}`);
            }

            // For textures, we want the texture to flow in the direction of the way
            // So we rotate the texture to align with the way's bearing
            // Cesium texture rotation: positive values rotate clockwise
            return -bestSegment.bearing;

        } catch (error) {
            // Texture rotation calculation error silently handled
            return 0;
        }
    },

    /**
     * Calculate rotation for crossing textures by finding the parent footway
     * @param {Array<Array<number>>} polygonCoordinates - Crossing polygon coordinates [lon, lat]
     * @param {string} textureName - Name of the texture file
     * @returns {number|null} Rotation angle in radians, or null if not found
     */
    calculateCrossingTextureRotation: function(polygonCoordinates, textureName) {
        // Calculate rotation from the polygon's own geometry
        // For crossing areas, the polygon represents the crossing itself
        // We calculate the bearing of its longest segment to determine orientation
        
        if (!polygonCoordinates || polygonCoordinates.length < 2) {
            return null;
        }

        // Convert to EPSG:4326 if needed
        const coords4326 = polygonCoordinates.map(coord => {
            if (coord.length === 2) {
                return coord; // Already [lon, lat]
            } else {
                return ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326');
            }
        });

        // Find the longest segment to determine orientation
        let maxDistance = 0;
        let bestStart, bestEnd;
        
        for (let i = 0; i < coords4326.length - 1; i++) {
            const start = coords4326[i];
            const end = coords4326[i + 1];
            
            const dLat = (end[1] - start[1]) * Math.PI / 180;
            const dLon = (end[0] - start[0]) * Math.PI / 180;
            const lat1 = start[1] * Math.PI / 180;
            const lat2 = end[1] * Math.PI / 180;
            
            const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                      Math.cos(lat1) * Math.cos(lat2) *
                      Math.sin(dLon/2) * Math.sin(dLon/2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            const distance = 6371000 * c; // Earth's radius in meters
            
            if (distance > maxDistance) {
                maxDistance = distance;
                bestStart = start;
                bestEnd = end;
            }
        }

        if (!bestStart || !bestEnd) {
            return 0;
        }

        // Calculate bearing from start to end
        const dLat = (bestEnd[1] - bestStart[1]) * Math.PI / 180;
        const dLon = (bestEnd[0] - bestStart[0]) * Math.PI / 180;
        const lat1 = bestStart[1] * Math.PI / 180;
        const lat2 = bestEnd[1] * Math.PI / 180;
        
        const y = Math.sin(dLon) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
        const bearing = Math.atan2(y, x);
        
        if (modelRendererTexLog()) {
            console.log(`🖼️ polygon-edge bearing °: ${(bearing * 180 / Math.PI).toFixed(1)} (seg ${maxDistance.toFixed(1)}m)`);
        }

        // For textures, we want them to align with the bearing direction
        // Cesium rotation is clockwise, so we negate the bearing
        return -bearing;
    },

    /**
     * Check if a way intersects or is adjacent to a polygon
     * @param {ol.geom.LineString|ol.geom.MultiLineString} wayGeometry - The way geometry
     * @param {Array<Array<number>>} polygonCoords - Polygon coordinates
     * @param {Array<Array<number>>} polygonCoords - Polygon coordinates [lon, lat]
     * @returns {boolean} True if the way intersects or is adjacent
     */
    wayIntersectsOrAdjacentToPolygon: function(wayGeometry, polygonCoords) {
        try {
            const wayCoords = wayGeometry.getType() === 'LineString' ?
                wayGeometry.getCoordinates() :
                wayGeometry.getCoordinates().flat();

            // Convert to EPSG:4326 if needed
            const wayLonLat = wayCoords.map(coord =>
                ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326')
            );

            // Check if any way segment crosses the polygon
            for (let i = 0; i < wayLonLat.length - 1; i++) {
                const segment = [wayLonLat[i], wayLonLat[i + 1]];
                if (this.lineIntersectsPolygon(segment, polygonCoords)) {
                    return true;
                }
                // Also treat segments that run very close to (or along) polygon limits as adjacent.
                if (this.lineAdjacentToPolygon(segment, polygonCoords, 10)) {
                    return true;
                }
            }

            // Check if way is adjacent (within 10 meters) to polygon
            const polygonBounds = this.getPolygonBounds(polygonCoords);
            for (const wayPoint of wayLonLat) {
                if (this.pointNearPolygon(wayPoint, polygonCoords, polygonBounds, 10)) {
                    return true;
                }
            }

            return false;
        } catch (error) {
            // Way intersection check error silently handled
            return false;
        }
    },

    /**
     * Check if a line segment intersects a polygon
     * @param {Array<Array<number>>} lineSegment - [[lon1, lat1], [lon2, lat2]]
     * @param {Array<Array<number>>} polygonCoords - Polygon coordinates
     * @returns {boolean} True if line intersects polygon
     */
    lineIntersectsPolygon: function(lineSegment, polygonCoords) {
        const [p1, p2] = lineSegment;

        // Check intersection with each polygon edge
        for (let i = 0; i < polygonCoords.length; i++) {
            const j = (i + 1) % polygonCoords.length;
            const edge = [polygonCoords[i], polygonCoords[j]];

            if (this.linesIntersect(p1, p2, edge[0], edge[1])) {
                return true;
            }
        }

        // Check if line segment is completely inside polygon
        return this.isPointInPolygon(p1, polygonCoords) && this.isPointInPolygon(p2, polygonCoords);
    },

    /**
     * Check if two line segments intersect
     */
    linesIntersect: function(a, b, c, d) {
        const eps = 1e-10;
        const orientation = (p, q, r) => {
            const value = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
            if (Math.abs(value) < eps) return 0;
            return value > 0 ? 1 : 2;
        };

        const onSegment = (p, q, r) => {
            return q[0] <= Math.max(p[0], r[0]) + eps &&
                   q[0] >= Math.min(p[0], r[0]) - eps &&
                   q[1] <= Math.max(p[1], r[1]) + eps &&
                   q[1] >= Math.min(p[1], r[1]) - eps;
        };

        const o1 = orientation(a, b, c);
        const o2 = orientation(a, b, d);
        const o3 = orientation(c, d, a);
        const o4 = orientation(c, d, b);

        if (o1 !== o2 && o3 !== o4) {
            return true;
        }

        // Colinear / touching endpoints are also intersections for area-edge matching.
        if (o1 === 0 && onSegment(a, c, b)) return true;
        if (o2 === 0 && onSegment(a, d, b)) return true;
        if (o3 === 0 && onSegment(c, a, d)) return true;
        if (o4 === 0 && onSegment(c, b, d)) return true;

        return false;
    },

    /**
     * Check whether a line segment is adjacent to any polygon edge within threshold meters.
     * Useful for ways that run next to or along polygon limits without crossing.
     */
    lineAdjacentToPolygon: function(lineSegment, polygonCoords, thresholdMeters = 10) {
        const [a, b] = lineSegment;

        for (let i = 0; i < polygonCoords.length; i++) {
            const j = (i + 1) % polygonCoords.length;
            const c = polygonCoords[i];
            const d = polygonCoords[j];

            // Intersections (including colinear overlap / touching) are handled as adjacent too.
            if (this.linesIntersect(a, b, c, d)) {
                return true;
            }

            const minDistance = Math.min(
                this.pointToSegmentDistanceMeters(a, c, d),
                this.pointToSegmentDistanceMeters(b, c, d),
                this.pointToSegmentDistanceMeters(c, a, b),
                this.pointToSegmentDistanceMeters(d, a, b)
            );

            if (minDistance <= thresholdMeters) {
                return true;
            }
        }

        return false;
    },

    /**
     * Distance from point P to segment AB in meters.
     */
    pointToSegmentDistanceMeters: function(point, segStart, segEnd) {
        const toMeters = (lon, lat, refLat) => {
            const x = lon * 111320 * Math.cos(refLat * Math.PI / 180);
            const y = lat * 111320;
            return [x, y];
        };

        const refLat = (point[1] + segStart[1] + segEnd[1]) / 3;
        const p = toMeters(point[0], point[1], refLat);
        const a = toMeters(segStart[0], segStart[1], refLat);
        const b = toMeters(segEnd[0], segEnd[1], refLat);

        const abx = b[0] - a[0];
        const aby = b[1] - a[1];
        const apx = p[0] - a[0];
        const apy = p[1] - a[1];
        const abLenSq = abx * abx + aby * aby;

        if (abLenSq === 0) {
            const dx = p[0] - a[0];
            const dy = p[1] - a[1];
            return Math.sqrt(dx * dx + dy * dy);
        }

        const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq));
        const closestX = a[0] + t * abx;
        const closestY = a[1] + t * aby;
        const dx = p[0] - closestX;
        const dy = p[1] - closestY;
        return Math.sqrt(dx * dx + dy * dy);
    },

    /**
     * Minimum distance from line segment to polygon edges in meters.
     */
    lineSegmentDistanceToPolygonMeters: function(lineSegment, polygonCoords) {
        const [a, b] = lineSegment;
        let minDistance = Infinity;

        for (let i = 0; i < polygonCoords.length; i++) {
            const j = (i + 1) % polygonCoords.length;
            const c = polygonCoords[i];
            const d = polygonCoords[j];

            if (this.linesIntersect(a, b, c, d)) {
                return 0;
            }

            const distance = Math.min(
                this.pointToSegmentDistanceMeters(a, c, d),
                this.pointToSegmentDistanceMeters(b, c, d),
                this.pointToSegmentDistanceMeters(c, a, b),
                this.pointToSegmentDistanceMeters(d, a, b)
            );

            if (distance < minDistance) {
                minDistance = distance;
            }
        }

        return Number.isFinite(minDistance) ? minDistance : Infinity;
    },

    /**
     * Find closest line segment from any way to the target polygon.
     */
            findClosestWaySegmentToPolygon: function(layers, polygonCoordinates, maxDistanceMeters = 40, preferredTag = null) {
        let bestSegment = null;

            layers.forEach((layer) => {
            if (!layer.getSource || typeof layer.getSource !== 'function') return;
            const source = layer.getSource();
            if (!source || !source.getFeatures) return;

            source.getFeatures().forEach((feature) => {
                const geometry = feature.getGeometry();
                if (!geometry || (geometry.getType() !== 'LineString' && geometry.getType() !== 'MultiLineString')) {
                    return;
                }

                const coords = geometry.getType() === 'LineString'
                    ? geometry.getCoordinates()
                    : geometry.getCoordinates().flat();
                const lonLatCoords = coords.map(coord =>
                    ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326')
                );

                for (let i = 0; i < lonLatCoords.length - 1; i++) {
                    const start = lonLatCoords[i];
                    const end = lonLatCoords[i + 1];
                    const bearing = this.calculateSegmentBearing(start, end);
                    if (bearing === null) continue;

                    const distance = this.lineSegmentDistanceToPolygonMeters([start, end], polygonCoordinates);
                    const length = this.haversineDistance(start, end);
                    if (distance > maxDistanceMeters) continue;

                    // If a preferred tag is requested (e.g. barrier=kerb for parking),
                    // favor segments coming from those features.
                    const isPreferred = preferredTag &&
                        feature.get &&
                        feature.get(preferredTag.key) === preferredTag.value;

                    if (!bestSegment) {
                        bestSegment = { distance, length, bearing, isPreferred };
                    } else {
                        const betterByPreference = isPreferred && !bestSegment.isPreferred;
                        const closer = distance < bestSegment.distance - 0.001;
                        const similarDistanceLonger = Math.abs(distance - bestSegment.distance) < 0.001 && length > bestSegment.length;
                        if (betterByPreference || closer || (similarDistanceLonger && (!betterByPreference && !bestSegment.isPreferred))) {
                            bestSegment = { distance, length, bearing, isPreferred };
                        }
                    }
                }
            });
        });

        return bestSegment;
    },

    /**
     * Flatten map layers recursively to include layers inside groups.
     */
    getAllMapLayers: function(layers) {
        const result = [];
        (layers || []).forEach((layer) => {
            if (layer && layer.getLayers && typeof layer.getLayers === 'function') {
                result.push(...this.getAllMapLayers(layer.getLayers().getArray()));
            } else {
                result.push(layer);
            }
        });
        return result;
    },

    /**
     * Bearing for a single segment [start -> end].
     */
    calculateSegmentBearing: function(start, end) {
        if (!start || !end) return null;
        if (start[0] === end[0] && start[1] === end[1]) return null;

        const dLon = (end[0] - start[0]) * Math.PI / 180;
        const lat1 = start[1] * Math.PI / 180;
        const lat2 = end[1] * Math.PI / 180;
        const y = Math.sin(dLon) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
        const bearing = Math.atan2(y, x);
        return (bearing + 2 * Math.PI) % (2 * Math.PI);
    },

    /**
     * Check if point is inside polygon using ray casting
     */
    isPointInPolygon: function(point, polygon) {
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
    },

    /**
     * Get bounding box of polygon
     */
    getPolygonBounds: function(polygonCoords) {
        let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
        polygonCoords.forEach(coord => {
            minLon = Math.min(minLon, coord[0]);
            maxLon = Math.max(maxLon, coord[0]);
            minLat = Math.min(minLat, coord[1]);
            maxLat = Math.max(maxLat, coord[1]);
        });
        return { minLon, maxLon, minLat, maxLat };
    },

    /**
     * Check if point is near polygon (within distance in meters)
     */
    pointNearPolygon: function(point, polygonCoords, bounds, maxDistanceMeters) {
        const [lon, lat] = point;

        // Quick bounds check
        if (lon < bounds.minLon - 0.001 || lon > bounds.maxLon + 0.001 ||
            lat < bounds.minLat - 0.001 || lat > bounds.maxLat + 0.001) {
            return false;
        }

        // Calculate distance from point to polygon edges
        for (let i = 0; i < polygonCoords.length; i++) {
            const j = (i + 1) % polygonCoords.length;
            const edge = [polygonCoords[i], polygonCoords[j]];
            const distance = this.pointToLineDistance(point, edge[0], edge[1]);
            if (distance <= maxDistanceMeters) {
                return true;
            }
        }

        return false;
    },

    /**
     * Calculate distance from point to line segment in meters
     */
    pointToLineDistance: function(point, lineStart, lineEnd) {
        const [px, py] = point;
        const [x1, y1] = lineStart;
        const [x2, y2] = lineEnd;

        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.sqrt(dx * dx + dy * dy);

        if (length === 0) return this.haversineDistance(point, lineStart);

        const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (length * length)));
        const closestX = x1 + t * dx;
        const closestY = y1 + t * dy;

        return this.haversineDistance(point, [closestX, closestY]);
    },

    /**
     * Calculate haversine distance between two points in meters
     */
    haversineDistance: function(point1, point2) {
        const R = 6371000; // Earth's radius in meters
        const [lon1, lat1] = point1;
        const [lon2, lat2] = point2;

        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        return R * c;
    },

    /**
     * Calculate bearing (direction) of a way from its coordinates
     * @param {Array<Array<number>>} coords - Array of [lon, lat] coordinates
     * @returns {number|null} Bearing in radians, or null if cannot calculate
     */
    calculateWayBearing: function(coords) {
        if (!coords || coords.length < 2) return null;

        // Use the first segment to determine direction
        const start = coords[0];
        const end = coords[1];

        const dLon = (end[0] - start[0]) * Math.PI / 180;
        const lat1 = start[1] * Math.PI / 180;
        const lat2 = end[1] * Math.PI / 180;

        const y = Math.sin(dLon) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

        const bearing = Math.atan2(y, x);

        // Normalize to 0-2π
        return (bearing + 2 * Math.PI) % (2 * Math.PI);
    },

    // Main entry point for adding all models
    // Data source for plain (non-model) results, created on demand per scene.
    _plainDataSource: null,
    _plainIdSeq: 0,

    /**
     * Unique entity id for a plain result. Cesium's EntityCollection throws on
     * a duplicate id, and fidx repeats across layers, so ids come from a
     * monotonic counter instead.
     */
    _nextPlainId: function() {
        this._plainIdSeq = (this._plainIdSeq || 0) + 1;
        return 'plain-' + this._session3dId + '-' + this._plainIdSeq;
    },

    /**
     * The Cesium DataSourceCollection holding the plain-result entities.
     *
     * `cesiumScene` is ol-cesium's CesiumScene WRAPPER, not a real
     * Cesium.Scene: it proxies `primitives`/`camera`, but it has no
     * `dataSources` at all (the string does not appear anywhere in
     * ol-cesium). Reading `cesiumScene.dataSources.add(...)` therefore threw
     * "Cannot read properties of undefined" for the first model-less feature
     * of every layer — and, before the per-feature try/catch, that silently
     * aborted the whole layer, which is what left GeoJSON-loaded overlays
     * with no models and no textures.
     *
     * The collection lives on the OLCesium instance instead, which is the
     * accessor the rest of this codebase (buildings.js, cesium_models.js)
     * already uses.
     */
    getPlainDataSource: function(cesiumScene) {
        const ol3d = window.ol3d;
        if (!ol3d || typeof ol3d.getDataSources !== 'function') {
            if (debugConfig.enabled) {
                console.warn('➖ Skipping plain result: OLCesium data sources unavailable');
            }
            return null;
        }
        const dataSources = ol3d.getDataSources();
        if (!dataSources) return null;

        const previous = this._plainDataSource;
        if (previous && typeof dataSources.contains === 'function' &&
            dataSources.contains(previous)) {
            return previous;
        }
        const dataSource = new Cesium.CustomDataSource('PlainResults');
        dataSources.add(dataSource);
        this._plainDataSource = dataSource;
        return dataSource;
    },

    /**
     * Draw a query result that has neither a model nor a texture, conforming it
     * to the terrain. Called for every such feature, so it must be idempotent:
     * an entity already created for this feature in this 3D session is reused.
     */
    addPlainResult: function(feature, fidx, cesiumScene, layer) {
        const geometry = feature.getGeometry && feature.getGeometry();
        if (!geometry || !geometry.getType) return;
        const type = geometry.getType();

        // Only the geometry types ol-cesium was drawing for us at sea level.
        if (type !== 'Point' && type !== 'LineString' && type !== 'MultiLineString' &&
            type !== 'Polygon' && type !== 'MultiPolygon' && type !== 'LinearRing') {
            return;
        }
        if (!this.plainResults) this.plainResults = new Map();
        const existing = this.plainResults.get(feature);
        if (existing && existing.sessionId === this._session3dId) return;  // already drawn

        let positions;
        try {
            if (type === 'Point') {
                positions = plainCoordsToCartesian([geometry.getCoordinates()]);
            } else {
                positions = plainCoordsToCartesian(plainFlattenCoords(geometry.getCoordinates()));
            }
        } catch (e) { return; }
        if (!positions || !positions.length) return;

        const dataSource = this.getPlainDataSource(cesiumScene);
        if (!dataSource) return;   // no 3D scene/datasources: nothing to draw into
        const style = readPlainStyle(feature, layer);
        let graphics = null;

        if (type === 'Point') {
            const image = style && style.getImage && style.getImage();
            if (image && image.src) {
                graphics = { billboard: { image: image.src, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND } };
            } else {
                let size = PLAIN_MARKER_PIXEL_SIZE;
                let color = PLAIN_MARKER_COLOR;
                if (style && style.getImage && style.getImage()) {
                    const img = style.getImage();
                    if (img.size) size = Math.max(3, Math.round(img.size[0]));
                }
                if (style && style.getFill && style.getFill()) {
                    const fill = style.getFill();
                    const olColor = fill.getColor ? fill.getColor() : null;
                    if (olColor) color = olColorToCesium(olColor, color);
                }
                graphics = {
                    point: {
                        pixelSize: size,
                        color: color,
                        // CLAMP_TO_GROUND keeps the marker sitting on the surface
                        // instead of at sea level, and re-seats it as the DEM refines.
                        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                        outlineColor: Cesium.Color.BLACK,
                        outlineWidth: 1
                    }
                };
            }
        } else if (type === 'LineString' || type === 'MultiLineString' || type === 'LinearRing') {
            const stroke = style && style.getStroke && style.getStroke();
            let width = 3;
            let color = PLAIN_LINE_COLOR;
            if (stroke) {
                if (stroke.getWidth && stroke.getWidth()) width = Math.max(1, stroke.getWidth());
                if (stroke.getColor && stroke.getColor()) color = olColorToCesium(stroke.getColor(), color);
            }
            // A MultiLineString yields several paths, but Cesium takes one
            // position list per polyline: draw each path as its own entity.
            const paths = type === 'MultiLineString'
                ? geometry.getCoordinates().map(coords => plainCoordsToCartesian(coords))
                : [positions];
            const created = [];
            paths.forEach(path => {
                if (!path || path.length < 2) return;
                created.push(dataSource.entities.add({
                    id: this._nextPlainId(),
                    polyline: {
                        positions: path,
                        width: width,
                        material: color,
                        // Drapes the line over hills, valleys and inclines.
                        clampToGround: true
                    }
                }));
            });
            if (!created.length) return;
            this.plainResults.set(feature, { entities: created, layer: layer, sessionId: this._session3dId });
            if (debugConfig.enabled) {
                console.log('➖ Plain line draped on ground: ' + created.length + ' path(s)');
            }
            return;
        } else {
            // Polygon / MultiPolygon: let Cesium build a ground primitive that
            // follows the surface exactly. The outer ring and the holes must stay
            // separate, so the raw ring structure is used rather than the flat
            // vertex list.
            const rings = (type === 'MultiPolygon' ? geometry.getCoordinates()[0] : geometry.getCoordinates())
                .filter(r => r && r.length > 2)
                .map(r => plainCoordsToCartesian(r));
            if (!rings.length) return;
            const fill = style && style.getFill && style.getFill();
            let color = PLAIN_AREA_COLOR;
            if (fill && fill.getColor && fill.getColor()) color = olColorToCesium(fill.getColor(), color);
            graphics = {
                polygon: {
                    hierarchy: new Cesium.PolygonHierarchy(
                        rings[0], rings.slice(1).map(r => new Cesium.PolygonHierarchy(r))),
                    material: color,
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
                }
            };
        }

        const entity = dataSource.entities.add(Object.assign({
            id: this._nextPlainId(),
            position: positions[0]
        }, graphics));
        this.plainResults.set(feature, { entities: [entity], layer: layer, sessionId: this._session3dId });
        if (debugConfig.enabled) console.log('➖ Plain ' + type + ' draped on ground');
    },

    /**
     * Remove plain-result entities from the scene, not just from the map.
     *
     * This used to be `plainResults.clear(); _plainDataSource = null;` — which
     * is a no-op for memory. The entities live in a Cesium.CustomDataSource
     * that was added to ol3d's dataSources collection; dropping the reference
     * leaves both the collection and every entity in it alive, and the next
     * call to getPlainDataSource() sees the old source is still "contained"
     * and hands it straight back. The only thing that actually went away was
     * the bookkeeping.
     */
    clearPlainResults: function() {
        const dataSource = this._plainDataSource;
        if (dataSource) {
            try {
                if (dataSource.entities && typeof dataSource.entities.removeAll === 'function') {
                    dataSource.entities.removeAll();
                }
                const ol3d = window.ol3d;
                const collection = ol3d && typeof ol3d.getDataSources === 'function'
                    ? ol3d.getDataSources() : null;
                if (collection && typeof collection.remove === 'function') {
                    collection.remove(dataSource);
                }
            } catch (e) { /* scene already gone */ }
        }
        if (this.plainResults) this.plainResults.clear();
        this._plainDataSource = null;
    },

    /**
     * Release the plain markers that belong to one layer.
     *
     * Removing a GeoJSON layer frees its models and textures through
     * loadedModels, but plain markers were not in that map and had no release
     * path at all: a feature with no model draped a billboard or polyline that
     * survived the layer it came from, for the rest of the session. On a
     * >1MB file that is most of the features.
     *
     * @returns {number} how many entries were released
     */
    unloadPlainResultsForLayer: function(layer) {
        if (!this.plainResults || !layer) return 0;
        const dataSource = this._plainDataSource;
        let released = 0;
        this.plainResults.forEach(function (entry, feature) {
            if (!entry || entry.layer !== layer) return;
            const entities = Array.isArray(entry.entities) ? entry.entities
                : (entry.entities ? [entry.entities] : []);
            if (dataSource && dataSource.entities && typeof dataSource.entities.remove === 'function') {
                for (let i = 0; i < entities.length; i++) {
                    try { dataSource.entities.remove(entities[i]); } catch (e) { /* already gone */ }
                }
            }
            this.plainResults.delete(feature);
            released++;
        }, this);
        return released;
    },

    addAllModels: function() {
        if (debugConfig.enabled) console.log('🎯 addAllModels: scanning layers for 3D models');
        if (!window.ol3d) {
            if (debugConfig.enabled) console.log('🎯 ol3d unavailable');
            return;
        }

        const cesiumScene = window.ol3d.getCesiumScene();

        // A NEW scene means every tracked primitive died with the previous one,
        // so start a new session exactly once. This used to bump the session id
        // on EVERY call, which silently defeated the dedupe check below
        // (tracked.sessionId === this._session3dId): all 6 addAllModels() call
        // sites re-processed every feature, and because pooled models are still
        // flagged visible the renderer created a SECOND primitive per feature
        // and left the first one in the scene. The result was every model drawn
        // twice — the older copy stranded at its first-pass height, which is
        // what looked like a second model "flying" above the terrain.
        if (this._sceneRef !== cesiumScene) {
            this._sceneRef = cesiumScene;
            this._session3dId = (this._session3dId || 0) + 1;
            this.resetLive();
            this.modelPool.clear();
            // The camera listener is bound to the OLD scene's camera. Unhook so
            // hookCameraStreaming() re-binds to the new one; otherwise streaming
            // silently stops working after the first 3D session ends.
            this._cameraStreamingHooked = false;
            // A pass in flight belongs to the previous scene; its primitives are
            // about to be destroyed with it.
            this._placing = false;
            this._pendingSweep = false;
            if (this.clearPlainResults) this.clearPlainResults();
            if (debugConfig.enabled) console.log('🎯 New 3D session ' + this._session3dId + ' — tracking reset');
        }

        // Hook DEM tile loads once: models placed before MapTerhorn tiles were
        // decoded (elevation 0) must be re-seated on the ground when they arrive
        if (window.mapterhornTerrain && window.mapterhornTerrain.onTilesLoaded && !this._demRepositionHooked) {
            this._demRepositionHooked = true;
            window.mapterhornTerrain.onTilesLoaded(() => this.repositionModelsOnDem());
        }

        if (cesiumScene && cesiumScene.primitives) {
            try {
                // Start streaming: from now on, moving the camera releases what
                // falls outside unloadDistance instead of letting the scene
                // grow for the whole session.
                if (this.hookCameraStreaming) this.hookCameraStreaming();
                if (debugConfig.enabled) console.log('🎯 Cesium scene available, processing layers...');
                // One pass at a time: a second sweep arriving mid-pass (a new
                // query, the +3s retry) waits for this one instead of placing
                // the same features concurrently.
                if (this._placing) { this._pendingSweep = true; return; }

                const layers = window.map.getLayers().getArray();
                const tasks = this.collectPlaceTasks(layers, cesiumScene, []);
                // Tell the panel the real total BEFORE any work starts, so the
                // percentage it shows is a percentage of something.
                this._progressTotal = tasks.length;
                if (window.loadingProgress && window.loadingProgress.total) {
                    window.loadingProgress.total(tasks.length);
                }
                this.runPlaceSlices(tasks);
                if (debugConfig.enabled) console.log('🎯 Layer processing started (' + tasks.length + ' features)');
            } catch (error) {
                console.error('🎯 Model renderer error:', error);
            }
        } else if (debugConfig.enabled) {
            console.log('🎯 Cesium scene unavailable');
        }
    },

    // Re-seat tracked models on the DEM ground when new terrain tiles arrive.
    // Keeps the original rotation/tilt baked in the matrix and only updates the
    // translation height, so nothing flips when the elevation refines.
    repositionModelsOnDem: function() {
        // No DEM source at all: sampleGroundElevation would answer 0 and we
        // would actively drag every model down to sea level. Do nothing.
        const hasDem = (window.terrainManager && window.terrainManager.getElevation) ||
                       (window.mapterhornTerrain && window.mapterhornTerrain.getElevation);
        if (!hasDem) return;
        if (!this.loadedModels || this.loadedModels.size === 0) return;
        if (!window.ol3d || !window.ol3d.getCesiumScene) return;

        let updated = 0;
        this.loadedModels.forEach((entry) => {
            try {
                if (!entry.feature) return;
                // Skip entries from older 3D sessions — their primitives were
                // destroyed with the previous scene and must not be touched.
                if (entry.sessionId !== undefined && entry.sessionId !== this._session3dId) return;
                if (isTunnelFeature(entry.feature)) return;
                if (entry.kind === 'texture') {
                    if (typeof entry.bridgeSurfaceHeight !== 'number' ||
                        !isFinite(entry.bridgeSurfaceHeight) || !entry.surfacePosition) return;
                    const surfacePosition = entry.surfacePosition;
                    const groundHeight = sampleGroundElevation(surfacePosition[0], surfacePosition[1]);
                    if (!isFinite(groundHeight)) return;
                    const refinedHeight = groundHeight + (entry.surfaceHeightOffset || 0);
                    const delta = refinedHeight - entry.bridgeSurfaceHeight;
                    if (Math.abs(delta) < 0.5) return;

                    const primitives = Array.isArray(entry.primitives)
                        ? entry.primitives
                        : (entry.primitives ? [entry.primitives] : []);
                    if (primitives.length > 0) {
                        const anchor = Cesium.Cartesian3.fromDegrees(surfacePosition[0], surfacePosition[1]);
                        const up = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(anchor, new Cesium.Cartesian3());
                        const translation = Cesium.Matrix4.fromTranslation(
                            Cesium.Cartesian3.multiplyByScalar(up, delta, new Cesium.Cartesian3())
                        );
                        primitives.forEach((primitive) => {
                            if (!primitive || !primitive.modelMatrix) return;
                            primitive.modelMatrix = Cesium.Matrix4.multiply(
                                translation,
                                primitive.modelMatrix,
                                new Cesium.Matrix4()
                            );
                        });
                    }
                    entry.bridgeSurfaceHeight = refinedHeight;
                    if (entry.isUnderBridge && entry.underBridgeKey) {
                        const surfaceFeature = entry.surfaceFeature || entry.feature;
                        const surfaces = surfaceFeature.get('underBridgeSurfaces') || {};
                        const surface = surfaces[entry.underBridgeKey];
                        if (surface) surface.height = groundHeight;
                        surfaceFeature.set('underBridgeSurfaces', surfaces);
                    } else {
                        entry.feature.set('bridgeRefHeight', refinedHeight);
                    }
                    updated++;
                    return;
                }
                if (!entry.model) return;
                // Nothing is skipped here any more. Models used to be marked
                // CLAMP_TO_GROUND and skipped on that basis, but the clamp is a
                // no-op with the MapTerhorn provider (it exposes no
                // `availability`), so the skipped models were exactly the ones
                // that needed re-seating — they stayed frozen at elevation 0.
                // Rotation/tilt are preserved: only the translation is rewritten.
                const lon = entry.lon, lat = entry.lat;
                const heightOffset = (entry.heightOffset !== undefined && entry.heightOffset !== null)
                    ? entry.heightOffset
                    : (entry.feature.get('modelHeightOffset') || 0.0);
                const isBridge = (entry.isBridge !== undefined) ? entry.isBridge : isBridgeFeature(entry.feature);

                // Sample exactly the same way placement did. Reading
                // mapterhornTerrain directly here fought the placement path,
                // which prefers terrainManager (local GeoTIFF) when one is
                // loaded: the two sources disagreed and the model was dragged
                // between them on every tile callback. Same sampler, same answer.
                const referencePosition = isBridge
                    ? (entry.feature.get('bridgeRefPosition') || [lon, lat])
                    : (entry.isUnderBridge && entry.surfacePosition
                        ? entry.surfacePosition
                        : [lon, lat]);
                const demHeight = sampleGroundElevation(referencePosition[0], referencePosition[1]);
                if (demHeight === null || demHeight === undefined || !isFinite(demHeight)) return;
                if (isBridge) entry.feature.set('bridgeRefHeight', demHeight);
                if (entry.isUnderBridge && entry.underBridgeKey) {
                    const surfaceFeature = entry.surfaceFeature || entry.feature;
                    const surfaces = surfaceFeature.get('underBridgeSurfaces') || {};
                    const surface = surfaces[entry.underBridgeKey];
                    if (surface) surface.height = demHeight;
                    surfaceFeature.set('underBridgeSurfaces', surfaces);
                }
                const totalHeight = heightOffset + demHeight;

                const matrix = entry.model.modelMatrix;
                const translation = Cesium.Matrix4.getColumn(matrix, 3, new Cesium.Cartesian4());
                const currentHeight = Cesium.Cartographic.fromCartesian(
                    new Cesium.Cartesian3(translation.x, translation.y, translation.z)).height;
                if (!isFinite(currentHeight)) return;

                // Soft re-seat: only move when the correction is clearly beyond
                // sampling noise (0.5m). Corrections are safe in both directions
                // now that getElevation returns the RENDERED surface.
                const delta = totalHeight - currentHeight;
                if (Math.abs(delta) < 0.5) return;

                Cesium.Matrix4.setTranslation(
                    matrix,
                    Cesium.Cartesian3.fromDegrees(lon, lat, totalHeight),
                    matrix
                );
                updated++;
            } catch (e) { /* skip this model */ }
        });

        if (updated > 0 && debugConfig.enabled) {
            console.log(`🎯 Re-seated ${updated} model(s) on MapTerhorn DEM ground`);
        }
    },
};

if (typeof debugConfig !== 'undefined' && debugConfig.enabled) {
    console.log('🎯 model_renderer.js loaded');
}

// A key search dispatches 'tagOverlayLoaded' once its Overpass results are
// parsed, and those results almost always arrive AFTER 3D mode was entered — the
// one-shot init below had already swept the layers and found nothing, because the
// query had not run yet. Nothing in the app listened for this event name (only
// 'tagQueryAdded', which value search fires and key search does not), so results
// loaded during a 3D session were never re-scanned and stayed flat.
//
// addAllModels() re-walks every layer and is idempotent: addModelForFeature()
// skips features already tracked in the current 3D session, and re-entering 3D
// bumps the session id. Same pattern as the tagQueryAdded/overlayFeaturesLoaded
// listeners in buildings.js.
window.addEventListener('tagOverlayLoaded', function () {
    if (window.is3d && window.ol3d && window.ol3d.getEnabled && window.ol3d.getEnabled()) {
        window.modelRenderer.addAllModels();
    }
});

// When 3D mode ends the Cesium scene is replaced on the next 3D session.
// All tracked primitives and pooled models from the old scene are dead:
// forget them so re-entering 3D rebuilds everything in the new scene
// instead of reusing primitives that belong to a destroyed scene.
window.addEventListener('ol3dDestroyed', function () {
    if (window.modelRenderer) {
        window.modelRenderer.resetLive();
        window.modelRenderer.modelPool.clear();
        window.modelRenderer._placing = false;
        window.modelRenderer._pendingSweep = false;
        if (window.modelRenderer.clearPlainResults) window.modelRenderer.clearPlainResults();
        // Forget the dead scene so the next addAllModels() starts a new session
        // even if ol-cesium hands back an equivalent object.
        window.modelRenderer._sceneRef = null;
        if (debugConfig.enabled) console.log('🎯 Cleared model tracking after 3D mode ended');
    }
});

// How many models, textures and repetitions to allow.
// -----------------------------------------------------
// A hard number in memoryConfig is the wrong shape for this: the right ceiling
// depends on the machine, and the only way to find it is to watch the frame
// rate while raising it. Two overrides, neither requiring a file edit:
//
//   ?primitives=60000            in the URL, read once at load
//   modelRenderer.setBudget(60000)  in the console, takes effect immediately
//
// Both only raise the CEILING. The ranges that decide how much of the file is
// worth placing are separate numbers in memoryConfig (loadDistance,
// placementRangeFactor, unloadDistance) and are deliberately not reachable from
// the URL — changing those changes what the map looks like, which is a
// decision to make in the file rather than by typo in an address bar.
(function applyPrimitiveBudgetOverride() {
    if (typeof window === 'undefined' || !window.location) return;
    var match = /[?&]primitives=(\d+)/.exec(window.location.search || '');
    if (!match) return;
    var requested = parseInt(match[1], 10);
    if (!isFinite(requested) || requested <= 0) return;
    memoryConfig.maxLivePrimitives = requested;
    console.log('🎯 primitive budget set to ' + requested + ' from the URL');
})();
