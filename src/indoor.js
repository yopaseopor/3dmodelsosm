/**
 * Simple Indoor Tagging (SIT) → 3D rendering for the Cesium view.
 *
 * Schema: https://wiki.openstreetmap.org/wiki/Simple_Indoor_Tagging
 * Compatible with the building:part / S3DB rendering in buildings.js (which
 * owns building volumes) — this module renders the INSIDE of buildings:
 *
 *   - indoor=room / indoor=area / indoor=corridor areas with level=* →
 *     a volume on that level (base = level * 3m above ground, optional
 *     height=* or min_height=*, 3m default / 2.7m for rooms without height)
 *   - indoor=wall ways → thin wall ribbons on the given level;
 *     indoor=wall + area=yes areas → thin wall volumes
 *   - indoor=level areas → translucent floor plate of that level
 *   - highway=steps / highway=elevator (multi-level via level=0-3 lists) →
 *     one volume spanning the whole level range
 *   - indoor=door / door=* nodes → small slab on the level;
 *     window=* nodes → glass slab; repeat_on=* duplicates them per level
 *   - POI nodes (any node with level=* + name/ref) → marker + label
 *   - buildings with min_level/max_level (and indoor data) → translucent
 *     shell + a thin plate per level, so level-tagged POIs make sense even
 *     without mapped rooms
 *
 * Multi-level lists follow the wiki: level=1;2, level=-1-5, level=-4--2.
 * repeat_on=* is expanded during preprocessing, exactly as the wiki
 * recommends for consumers ("duplicate these objects, one level each").
 */
(function () {
    'use strict';

    if (typeof window === 'undefined' || typeof Cesium === 'undefined') return;
    window.indoor = window.indoor || {};

    // ------------------------------------------------------------------
    // Constants
    // ------------------------------------------------------------------
    var LEVEL_HEIGHT = 3.0;      // fallback floor height when nothing is tagged
    var ROOM_HEIGHT = 2.7;       // interior volume default (below slab)
    var WALL_THICKNESS = 0.15;   // ribbon half-width used around wall centerlines
    var DOOR_HEIGHT = 2.1;
    var DOOR_WIDTH = 1.0;
    var MAX_INDENT = 12;         // max inset applied per level

    var colorCache = null;
    function colorFor(kind) {
        if (!colorCache) {
            colorCache = {
                room: Cesium.Color.fromCssColorString('#7fc8f8'),
                area: Cesium.Color.fromCssColorString('#bde0fe'),
                corridor: Cesium.Color.fromCssColorString('#ffd166'),
                wall: Cesium.Color.fromCssColorString('#e8e8e8'),
                level: Cesium.Color.fromCssColorString('#7fd1ae'),
                shell: Cesium.Color.fromCssColorString('#a8dadc'),
                steps: Cesium.Color.fromCssColorString('#e9c46a'),
                door: Cesium.Color.fromCssColorString('#d4a373'),
                window: Cesium.Color.fromCssColorString('#90e0ef'),
                poi: Cesium.Color.fromCssColorString('#f4a261')
            };
        }
        return colorCache[kind];
    }

    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------
    var indoorEnabled = false;             // UI toggle (3D nav panel 🏢 button) — OFF by default: first click ENABLES translucent walls
    var undergroundEnabled = false;        // UI toggle (3D nav panel L-1 button)
    var indoorOl3d = null;                 // active OLCesium instance

    function deg(rad) { return rad * 180 / Math.PI; }
    var indoorEntities = new Map();        // feature -> Cesium.Entity[]
    var indoorPrimitives = [];             // [{ ref }] primitive visuals
    var registeredBuildings = [];          // { rings, holes, bbox, minLevel, maxLevel, tags }
    var processedFeatures = new Set();     // dedupe across repeated layer loads
    var entityBudget = 2000;               // hard cap for indoor geometry entities


    // ------------------------------------------------------------------
    // Small utilities
    // ------------------------------------------------------------------
    function clamp(v, min, max) { return v < min ? min : (v > max ? max : v); }

    function parseLengthMeters(value, fallback) {
        if (value === undefined || value === null) return fallback;
        var m = String(value).trim().match(/^(-?[\d.]+)\s*(m|meter|meters|ft|feet|')?$/i);
        if (!m) return fallback;
        var n = parseFloat(m[1]);
        if (!isFinite(n)) return fallback;
        if (m[2] && /^(ft|feet|')$/i.test(m[2])) n *= 0.3048;
        return n;
    }

    function collectTags(feature) {
        var tags = {};
        feature.getKeys().forEach(function (key) {
            if (key !== 'geometry' && key !== 'extrudedBuilding' && key !== 'extrudedBuildingIndoor') {
                tags[key] = feature.get(key);
            }
        });
        return tags;
    }

    /** level=* / repeat_on=* list parser: "1;2", "0-3", "-1-2", "-4--2" */
    function parseLevelList(value) {
        if (value === undefined || value === null) return null;
        var s = String(value).trim();
        if (!s) return null;
        var out = [];
        var parts = s.split(';');
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i].trim();
            if (!p) continue;
            var m = p.match(/^(-?\d+)\s*-\s*(-?\d+)$/);
            if (m) {
                var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
                if (!isFinite(a) || !isFinite(b)) continue;
                if (a > b) { var t = a; a = b; b = t; }
                for (var l = a; l <= b; l++) out.push(l);
            } else {
                var n = parseInt(p, 10);
                if (isFinite(n)) out.push(n);
            }
        }
        return out.length ? out : null;
    }

    function isBuildingTags(tags) {
        return tags.building !== undefined && tags.building !== null && tags.building !== 'no';
    }

    /** SIT element kind carried by a feature, or null */
    function getIndoorKind(tags) {
        var v = (tags.indoor || '') + '';
        if (v === 'room' || v === 'area' || v === 'corridor' || v === 'wall' || v === 'level') return v;
        // Real-world data also carries legacy values (indoor=yes, indoor=shop…).
        // Render them as spaces when a level is tagged (SIT-compatible fallback;
        // purpose tags like room=*/shop keep working alongside).
        if (v && v !== 'no' && v !== 'door' &&
            (tags.level !== undefined || tags.repeat_on !== undefined)) return 'area';
        return null;
    }

    /** Vertical connections: staircases / elevators / steps (SIT §Vertical connections) */
    function getVerticalTags(tags) {
        if (tags.highway === 'elevator') return 'elevator';
        if (tags.highway === 'steps') return (tags.conveying === 'yes' || tags.conveying === 'forward' || tags.conveying === 'backward') ? 'escalator' : 'steps';
        if ((tags.indoor || '') + '' === 'area' && tags.stairs === 'yes') return 'steps';
        return null;
    }

    function getWayNodeKind(tags) {
        if (tags.indoor === 'door' || (tags.indoor !== 'door' && tags.door !== undefined && tags.indoor === undefined && (tags.level !== undefined || tags.repeat_on !== undefined) && tags.highway === undefined && tags.building === undefined)) {
            // indoor=door, or door=* on a node placed in a wall (entrances too)
            return 'door';
        }
        if (tags.window !== undefined && tags.window !== 'no') return 'window';
        return null;
    }

    // ------------------------------------------------------------------
    // Geometry helpers (same conventions as buildings.js)
    // ------------------------------------------------------------------
    function mapProjection() {
        return (window.map && window.map.getView()) ? window.map.getView().getProjection() : 'EPSG:3857';
    }

    function toLonLat(coord) {
        return ol.proj.transform(coord, mapProjection(), 'EPSG:4326');
    }

    /** Polygon/MultiPolygon → [outerRing, hole, hole...] in WGS84 lon/lat */
    function getFeatureLonLatRings(feature) {
        var geometry = feature.getGeometry();
        if (!geometry) return null;
        var type = geometry.getType();
        var coords;
        try {
            if (type === 'Polygon') coords = geometry.getCoordinates();
            else if (type === 'MultiPolygon') coords = geometry.getCoordinates()[0];
            else return null;
        } catch (e) { return null; }
        if (!coords || !coords[0] || coords[0].length < 3) return null;
        return coords.map(function (ring) {
            return ring.map(toLonLat);
        });
    }

    /** LineString → [[lon,lat], ...] in WGS84 */
    function getFeatureLonLatLine(feature) {
        var geometry = feature.getGeometry();
        if (!geometry) return null;
        if (geometry.getType() !== 'LineString') return null;
        var coords = geometry.getCoordinates();
        if (!coords || coords.length < 2) return null;
        return coords.map(toLonLat);
    }

    /** node coordinates → [lon, lat] */
    function getFeatureLonLatPoint(feature) {
        var geometry = feature.getGeometry();
        if (!geometry || geometry.getType() !== 'Point') return null;
        return toLonLat(geometry.getCoordinates());
    }

    /** DEM height at lon/lat; null when no DEM data is available */
    function sampleGroundHeight(lon, lat) {
        if (window.terrainManager && window.terrainManager.getElevation) {
            var h = window.terrainManager.getElevation(lon, lat);
            if (typeof h === 'number' && isFinite(h)) return h;
        }
        if (window.mapterhornTerrain && window.mapterhornTerrain.getElevation) {
            var h2 = window.mapterhornTerrain.getElevation(lon, lat);
            if (typeof h2 === 'number' && isFinite(h2)) return h2;
        }
        return null;
    }

    /** Per-vertex ground heights for a ring; null when DEM is missing there */
    function sampleRingHeights(ring) {
        var hs = new Array(ring.length).fill(null);
        var valid = 0;
        for (var i = 0; i < ring.length; i++) {
            var h = sampleGroundHeight(ring[i][0], ring[i][1]);
            if (h !== null) { hs[i] = h; valid++; }
        }
        if (valid === 0) return null;
        var sum = 0;
        for (var j = 0; j < hs.length; j++) if (hs[j] !== null) sum += hs[j];
        var mean = sum / valid;
        for (var k = 0; k < hs.length; k++) if (hs[k] === null) hs[k] = mean;
        return hs;
    }

    function ringBBox(ring) {
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (var i = 0; i < ring.length; i++) {
            if (ring[i][0] < minX) minX = ring[i][0];
            if (ring[i][0] > maxX) maxX = ring[i][0];
            if (ring[i][1] < minY) minY = ring[i][1];
            if (ring[i][1] > maxY) maxY = ring[i][1];
        }
        return [minX, minY, maxX, maxY];
    }

    function pointInRing(lon, lat, ring) {
        var inside = false;
        for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
            if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
        }
        return inside;
    }

    function ringCentroid(ring) {
        var x = 0, y = 0;
        for (var i = 0; i < ring.length - 1; i++) { x += ring[i][0]; y += ring[i][1]; }
        var n = Math.max(1, ring.length - 1);
        return [x / n, y / n];
    }

    function polylineLength(lonLatLine) {
        var len = 0;
        for (var i = 1; i < lonLatLine.length; i++) {
            var dx = (lonLatLine[i][0] - lonLatLine[i - 1][0]) * 111320 * Math.cos(lonLatLine[i][1] * Math.PI / 180);
            var dy = (lonLatLine[i][1] - lonLatLine[i - 1][1]) * 110540;
            len += Math.sqrt(dx * dx + dy * dy);
        }
        return len;
    }

    /**
     * Offset a line sideways into a thin ribbon polygon (for indoor=wall ways).
     * Returns [left..., right(reversed)...] as a closed lon/lat ring.
     */
    function lineToRibbon(lonLatLine, halfWidth) {
        var n = lonLatLine.length;
        var left = [], right = [];
        var px = 111320 * Math.cos(lonLatLine[0][1] * Math.PI / 180);
        function offsetAt(i) {
            var prev = lonLatLine[Math.max(0, i - 1)], next = lonLatLine[Math.min(n - 1, i + 1)];
            var dx = (next[0] - prev[0]) * px, dy = (next[1] - prev[1]) * 110540;
            var len = Math.sqrt(dx * dx + dy * dy) || 1;
            // left normal of the direction of travel
            return [lonLatLine[i][0] + (-dy / len) * halfWidth / px, lonLatLine[i][1] + (dx / len) * halfWidth / 110540];
        }
        for (var i = 0; i < n; i++) left.push(offsetAt(i));
        for (var j = n - 1; j >= 0; j--) right.push(lonLatLine[j]);
        return left.concat(right);
    }

    // ------------------------------------------------------------------
    // Building registration (for shells + "which building am I in" lookups)
    // ------------------------------------------------------------------
    function registerIndoorBuilding(rings, tags) {
        if (!rings || !rings[0]) return;
        var minLevel = parseLevelList(tags.min_level);
        var maxLevel = parseLevelList(tags.max_level);
        registeredBuildings.push({
            rings: rings,
            bbox: ringBBox(rings[0]),
            minLevel: (minLevel && minLevel.length) ? Math.min.apply(null, minLevel) : null,
            maxLevel: (maxLevel && maxLevel.length) ? Math.max.apply(null, maxLevel) : null,
            tags: tags
        });
    }

    function findBuildingFor(ring) {
        var c = ringCentroid(ring);
        for (var i = 0; i < registeredBuildings.length; i++) {
            var b = registeredBuildings[i];
            if (c[0] < b.bbox[0] || c[0] > b.bbox[2] || c[1] < b.bbox[1] || c[1] > b.bbox[3]) continue;
            if (pointInRing(c[0], c[1], b.rings[0])) return b;
        }
        return null;
    }

    // ------------------------------------------------------------------
    // Rendering primitives
    // ------------------------------------------------------------------
    function dataSource() {
        if (!indoorOl3d) return null;
        var sources = indoorOl3d.getDataSources();
        for (var i = 0; i < sources.length; i++) {
            if (sources.get(i).name === 'Indoor') return sources.get(i);
        }
        var ds = new Cesium.CustomDataSource('Indoor');
        sources.add(ds);
        return ds;
    }

    function budgetLeft() {
        if (!indoorEnabled) return false; // mode off → never create visuals
        return entityBudget - indoorEntities.size > 0;
    }

    function addEntity(feature, entity) {
        if (!budgetLeft()) return null;
        var ds = dataSource();
        if (!ds) return null;
        ds.entities.add(entity);
        if (!indoorEntities.has(feature)) indoorEntities.set(feature, []);
        indoorEntities.get(feature).push(entity);
        return entity;
    }

    function addPrimitive(feature, prim) {
        if (feature) {
            if (!indoorEntities.has(feature)) indoorEntities.set(feature, []);
            indoorEntities.get(feature).push(prim);
        }
        indoorPrimitives.push({ ref: prim });
        return prim;
    }

    function lonLatHeightsToCartesian(ring, heights, heightOffset) {
        var arr = [];
        for (var i = 0; i < ring.length; i++) {
            var h = (heights && heights[i] !== undefined && heights[i] !== null ? heights[i] : 0) + (heightOffset || 0);
            arr.push(Cesium.Cartesian3.fromDegrees(ring[i][0], ring[i][1], h));
        }
        return arr;
    }

    /**
     * Extruded volume for a closed ring. positions carry per-vertex GROUND
     * heights (terrain-following base), baseLift raises the floor (level),
     * wallHeight is the volume height above the floor.
     */
    function renderVolume(feature, rings, groundHeights, baseLift, wallHeight, color, options) {
        options = options || {};
        var outer = lonLatHeightsToCartesian(rings[0], groundHeights, baseLift);
        var holes = [];
        for (var h = 1; h < rings.length; h++) {
            holes.push(new Cesium.PolygonHierarchy(lonLatHeightsToCartesian(rings[h], groundHeights, baseLift)));
        }
        var entity = {
            polygon: {
                hierarchy: new Cesium.PolygonHierarchy(outer, holes),
                perPositionHeight: true,
                extrudedHeight: meanGround(groundHeights) + baseLift + wallHeight,
                material: color.withAlpha(options.alpha !== undefined ? options.alpha : 0.55),
                outline: true,
                outlineColor: color.withAlpha(0.9),
                closeSurface: true
            }
        };
        return addEntity(feature, new Cesium.Entity(entity));
    }

    /** Thin horizontal plate (floor slabs, level plates) */
    function renderPlate(feature, rings, groundHeights, topLift, thickness, color, alpha) {
        var outer = lonLatHeightsToCartesian(rings[0], groundHeights, 0);
        var holes = [];
        for (var h = 1; h < rings.length; h++) {
            holes.push(new Cesium.PolygonHierarchy(lonLatHeightsToCartesian(rings[h], groundHeights, 0)));
        }
        var entity = {
            polygon: {
                hierarchy: new Cesium.PolygonHierarchy(outer, holes),
                perPositionHeight: true,
                extrudedHeight: meanGround(groundHeights) + topLift + thickness,
                material: color.withAlpha(alpha !== undefined ? alpha : 0.35),
                outline: true,
                outlineColor: color.withAlpha(0.8),
                closeSurface: true
            }
        };
        return addEntity(feature, new Cesium.Entity(entity));
    }

    /** Vertical ribbon from a closed lon/lat ring following terrain (walls) */
    function renderRibbon(feature, ring, groundHeights, baseLift, wallHeight, color, alpha) {
        var bottom = lonLatHeightsToCartesian(ring, groundHeights, baseLift);
        var top = lonLatHeightsToCartesian(ring, groundHeights, baseLift + wallHeight);
        var positions = bottom.concat(top.slice().reverse());
        var scene = indoorOl3d ? indoorOl3d.getCesiumScene() : null;
        if (!scene || !scene.primitives) return null;
        var prim = scene.primitives.add(new Cesium.Primitive({
            geometryInstances: new Cesium.GeometryInstance({
                geometry: new Cesium.PolygonGeometry({
                    polygonHierarchy: new Cesium.PolygonHierarchy(positions),
                    perPositionHeight: true
                }),
                attributes: {
                    color: Cesium.ColorGeometryInstanceAttribute.fromColor(color.withAlpha(alpha !== undefined ? alpha : 0.85))
                }
            }),
            appearance: new Cesium.PerInstanceColorAppearance({
                flat: true,
                translucent: true,
                renderState: { depthTest: { enabled: true } }
            }),
            asynchronous: false
        }));
        return addPrimitive(feature, prim);
    }

    // ------------------------------------------------------------------
    // Element renderers
    // ------------------------------------------------------------------
    /**
     * Base height (meters above ground) for level N of a building, following
     * SIT: level 0 is ground, -1 first basement. If the building declares
     * min_level (e.g. local conventions where 3 is ground) that level is
     * seated on the ground instead.
     */
    function levelBaseMeters(building, level, tags) {
        var minLevel = building && building.minLevel !== null ? building.minLevel : 0;
        // Local conventions (min_level=3 is ground) only shift ABOVE-ground levels;
        // standard numbering: level 0 sits on the ground, negatives go below it.
        var above = (minLevel > 0 && level >= minLevel) ? (level - minLevel) : level;
        // explicit per-element base (min_height) wins
        if (tags && tags.min_height !== undefined) {
            return parseLengthMeters(tags.min_height, above * LEVEL_HEIGHT);
        }
        return above * LEVEL_HEIGHT;
    }

    /** Mean DEM height of a sampled ring (extrudedHeight is ABSOLUTE in Cesium
     *  when perPositionHeight is true, so tops must include the ground level). */
    function meanGround(groundHeights) {
        if (!groundHeights || !groundHeights.length) return 0;
        var s = 0;
        for (var i = 0; i < groundHeights.length; i++) s += (groundHeights[i] || 0);
        return s / groundHeights.length;
    }

    function elementHeight(tags, fallback) {
        if (tags.height !== undefined) return Math.max(0.5, parseLengthMeters(tags.height, fallback));
        if (tags['building:levels'] !== undefined) {
            var lv = parseFloat(tags['building:levels']);
            if (isFinite(lv) && lv > 0) return lv * LEVEL_HEIGHT;
        }
        return fallback;
    }

    function renderIndoorSpace(feature, tags, kind) {
        var rings = getFeatureLonLatRings(feature);
        if (!rings) {
            // Point "spaces" (legacy indoor=yes nodes) render as POIs instead
            if (getFeatureLonLatPoint(feature)) renderIndoorPoi(feature, tags);
            return;
        }
        var building = findBuildingFor(rings[0]);
        var levels = parseLevelList(tags.level) || [0];
        var repeatOn = parseLevelList(tags.repeat_on) || [];
        var allLevels = levels.concat(repeatOn);
        var height = elementHeight(tags, kind === 'room' ? ROOM_HEIGHT : LEVEL_HEIGHT);
        var color = colorFor(kind);
        var alpha = kind === 'corridor' ? 0.45 : 0.55;

        var groundHeights = sampleRingHeights(rings[0]);
        if (!groundHeights) return;
        for (var i = 0; i < allLevels.length; i++) {
            var level = allLevels[i];
            if (building && building.minLevel !== null && building.maxLevel !== null &&
                (level < building.minLevel - 1 || level > building.maxLevel)) continue;
            var base = levelBaseMeters(building, level, tags);
            // Underground levels render at their true depth — visible only
            // while the underground view (L-1 button) is enabled.
            if (base < 0 && !undergroundEnabled) continue;
            renderVolume(feature, rings, groundHeights, base, height, color, { alpha: alpha });
        }
    }

    function renderIndoorWall(feature, tags) {
        var rings = getFeatureLonLatRings(feature);
        if (rings) { // wall mapped as area (irregular wall, SIT §Walls)
            var groundHeights = sampleRingHeights(rings[0]);
            if (!groundHeights) return;
            var levels = parseLevelList(tags.level) || [0];
            var base = levels[0] * LEVEL_HEIGHT;
            if (base < 0 && !undergroundEnabled) return;
            renderVolume(feature, rings, groundHeights, base, elementHeight(tags, ROOM_HEIGHT), colorFor('wall'), { alpha: 0.9 });
            return;
        }
        var line = getFeatureLonLatLine(feature);
        if (!line) return;
        var width = parseLengthMeters(tags.width, WALL_THICKNESS * 2) / 2;
        var ribbon = lineToRibbon(line, Math.max(0.05, width));
        var ribbonHeights = sampleRingHeights(ribbon);
        if (!ribbonHeights) return;
        var lvl = parseLevelList(tags.level) || [0];
        var baseLift = lvl[0] * LEVEL_HEIGHT;
        if (baseLift < 0 && !undergroundEnabled) return;
        renderRibbon(feature, ribbon, ribbonHeights, baseLift, elementHeight(tags, ROOM_HEIGHT), colorFor('wall'), 0.9);
    }

    function renderIndoorLevel(feature, tags) {
        var rings = getFeatureLonLatRings(feature);
        if (!rings) return;
        var groundHeights = sampleRingHeights(rings[0]);
        if (!groundHeights) return;
        var level = parseLevelList(tags.level);
        var lvl = (level && level.length) ? level[0] : 0;
        var building = findBuildingFor(rings[0]);
        var base = levelBaseMeters(building, lvl, null);
        if (base < 0 && !undergroundEnabled) return;
        var plate = renderPlate(feature, rings, groundHeights, base, 0.12, colorFor('level'), 0.30);
        var name = tags.name || tags['level:ref'];
        if (plate && name) {
            var c = ringCentroid(rings[0]);
            var g = sampleGroundHeight(c[0], c[1]) || 0;
            addEntity(feature, new Cesium.Entity({
                position: Cesium.Cartesian3.fromDegrees(c[0], c[1], g + base + 1.2),
                label: {
                    text: String(name),
                    font: '12px sans-serif',
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    showBackground: true,
                    backgroundColor: new Cesium.Color(0.1, 0.2, 0.15, 0.6),
                    pixelOffset: new Cesium.Cartesian2(0, -10)
                }
            }));
        }
    }

    /** SIT §Vertical connections — one volume spanning the level range */
    function renderVerticalConnection(feature, tags, kind) {
        var levels = parseLevelList(tags.level) || [0];
        var minLevel = Math.min.apply(null, levels);
        var maxLevel = Math.max.apply(null, levels);
        var color = colorFor('steps');
        var levelCount = maxLevel - minLevel + 1;
        var heightMeters = Math.round(levelCount * LEVEL_HEIGHT);
        var spanText = (minLevel === maxLevel ? 'L' + minLevel : 'L' + minLevel + '→L' + maxLevel) +
            ' · ' + levelCount + (levelCount === 1 ? ' level' : ' levels') + ' · ' + heightMeters + ' m';

        // Fully buried connections are only visible in underground view
        if (!undergroundEnabled && maxLevel < 0) return;

        /** Label stating the span and height in levels (e.g. "L-1→L0 · 2 levels · 6 m") */
        function addSpanLabel(ringLike, topLift) {
            var c = ringCentroid(ringLike);
            var g = sampleGroundHeight(c[0], c[1]);
            if (g === null) return;
            addEntity(feature, new Cesium.Entity({
                position: Cesium.Cartesian3.fromDegrees(c[0], c[1], g + Math.max(0, topLift) + 2),
                label: {
                    text: (kind === 'elevator' ? '⇅ elevator ' : kind === 'escalator' ? '⇅ escalator ' : '⇅ steps ') + spanText,
                    font: '11px sans-serif',
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    showBackground: true,
                    backgroundColor: new Cesium.Color(0.25, 0.18, 0.05, 0.65),
                    pixelOffset: new Cesium.Cartesian2(0, -8)
                }
            }));
        }

        if (kind === 'elevator' || kind === 'escalator') {
            // shafts / escalators: volume from bottom level to top of top level
            var rings = getFeatureLonLatRings(feature);
            if (rings) {
                var groundHeights = sampleRingHeights(rings[0]);
                if (!groundHeights) return;
                var building = findBuildingFor(rings[0]);
                var base = levelBaseMeters(building, minLevel, tags);
                if (base < 0 && !undergroundEnabled) base = 0;
                var top = levelBaseMeters(building, maxLevel, null) + LEVEL_HEIGHT;
                renderVolume(feature, rings, groundHeights, base, Math.max(LEVEL_HEIGHT, top - base), colorFor('area'), { alpha: kind === 'elevator' ? 0.35 : 0.5 });
                addSpanLabel(rings[0], top);
            }
            return;
        }

        // highway=steps ways: ribbon following the terrain along the flight,
        // spanning from the bottom level floor to the top level ceiling.
        var line = getFeatureLonLatLine(feature);
        if (!line) return;
        var ribbon = lineToRibbon(line, 0.6);
        var heights = sampleRingHeights(ribbon);
        if (!heights) return;
        var baseLift = minLevel * LEVEL_HEIGHT;
        if (baseLift < 0 && !undergroundEnabled) baseLift = 0;
        var topLift = maxLevel * LEVEL_HEIGHT + ROOM_HEIGHT;
        renderRibbon(feature, ribbon, heights, baseLift, Math.max(LEVEL_HEIGHT, topLift - baseLift), color, kind === 'escalator' ? 0.5 : 0.85);
        addSpanLabel(line, topLift);
    }

    /** Doors / windows: small slabs on their level; repeat_on duplicates them */
    function renderWayNode(feature, tags, kind) {
        var lonLat = getFeatureLonLatPoint(feature);
        if (!lonLat) return;
        var ground = sampleGroundHeight(lonLat[0], lonLat[1]);
        if (ground === null) return;
        var levels = parseLevelList(tags.level) || [0];
        var repeatOn = parseLevelList(tags.repeat_on) || [];
        var allLevels = levels.concat(repeatOn);
        var building = findBuildingFor([[lonLat[0], lonLat[1]]]);
        var color = colorFor(kind);
        var height = kind === 'door' ? parseLengthMeters(tags.height, DOOR_HEIGHT) : 1.2;

        for (var i = 0; i < allLevels.length; i++) {
            var base = levelBaseMeters(building, allLevels[i], null);
            if (base < 0 && !undergroundEnabled) continue; // basement openings: only in underground view
            // Wall slab tilted to match the actual door wall orientation
            addVerticalPanel(feature, [lonLat[0], lonLat[1]], bearingOfDoorWall(lonLat, building),
                { base: base, height: height, width: parseLengthMeters(tags.width, DOOR_WIDTH),
                  color: color, alpha: 0.85, ground: ground });
        }
    }

    /** Simple POI mapping: any node with level=* (and name/ref) → marker */
    function renderIndoorPoi(feature, tags) {
        var lonLat = getFeatureLonLatPoint(feature);
        if (!lonLat) return;
        var ground = sampleGroundHeight(lonLat[0], lonLat[1]);
        if (ground === null) return;
        var levels = parseLevelList(tags.level) || [0];
        var repeatOn = parseLevelList(tags.repeat_on) || [];
        var allLevels = levels.concat(repeatOn);
        var building = findBuildingFor([[lonLat[0], lonLat[1]]]);
        var text = tags.name || tags.ref || tags['level:ref'] || '';
        for (var i = 0; i < allLevels.length; i++) {
            var base = levelBaseMeters(building, allLevels[i], null);
            if (base < 0 && !undergroundEnabled) continue;
            addEntity(feature, new Cesium.Entity({
                position: Cesium.Cartesian3.fromDegrees(lonLat[0], lonLat[1], ground + base + 1.4),
                point: {
                    pixelSize: 7,
                    color: colorFor('poi').withAlpha(0.95),
                    outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
                    outlineWidth: 1,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY
                },
                label: text ? {
                    text: String(text) + (allLevels.length > 1 ? ' (L' + allLevels[i] + ')' : ''),
                    font: '11px sans-serif',
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    pixelOffset: new Cesium.Cartesian2(0, -12),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY
                } : undefined
            }));
        }
    }

    // ------------------------------------------------------------------
    // Building-level visuals: translucent shell + one plate per level
    // (SIT §Building: min_level/max_level make simple POI visualisation work)
    // ------------------------------------------------------------------
    function renderBuildingIndoor(feature, tags, rings) {
        var building = findBuildingFor(rings[0]);
        var minLevel = building && building.minLevel !== null ? building.minLevel : (parseLevelList(tags.min_level) ? Math.min.apply(null, parseLevelList(tags.min_level)) : 0);
        var maxLevel = building && building.maxLevel !== null ? building.maxLevel : (parseLevelList(tags.max_level) ? Math.max.apply(null, parseLevelList(tags.max_level)) : null);
        if (maxLevel === null) return; // no level range declared → nothing to draw

        var groundHeights = sampleRingHeights(rings[0]);
        if (!groundHeights) return;

        // Translucent shell over the above-ground storeys so indoor volumes
        // read as "inside a building" instead of floating boxes. The shell
        // belongs to INDOOR mode only — never drawn while the button is off
        // (it would ghost-haze buildings that must stay opaque).
        if (indoorEnabled) {
            var shellTop = Math.max(0, maxLevel - Math.min(0, minLevel) + 1) * LEVEL_HEIGHT;
            if (tags.height !== undefined) {
                shellTop = Math.min(parseLengthMeters(tags.height, shellTop), 30 * LEVEL_HEIGHT);
            }
            renderVolume(feature, rings, groundHeights, 0, shellTop, colorFor('shell'), { alpha: 0.12 });
        }

        // One thin plate per level (skip underground; cap storeys rendered)
        var plateCount = 0;
        for (var lvl = Math.max(0, minLevel); lvl <= maxLevel && plateCount <= 15; lvl++, plateCount++) {
            var base = levelBaseMeters(building, lvl, null);
            renderPlate(feature, rings, groundHeights, base, 0.1, colorFor('level'), 0.18);
        }
    }

    function hasIndoorData(tags) {
        return tags.min_level !== undefined || tags.max_level !== undefined ||
            tags.non_existent_levels !== undefined || (tags.indoor !== undefined && tags.indoor !== 'no');
    }

    /** True when every level a feature references is below ground (L-1 view). */
    function isFullyUndergroundTags(tags) {
        var levels = parseLevelList(tags.level);
        var repeat = parseLevelList(tags.repeat_on);
        if (!levels && !repeat) return false;
        var all = (levels || []).concat(repeat || []);
        for (var i = 0; i < all.length; i++) if (all[i] >= 0) return false;
        return true;
    }

    /**
     * Vertical rectangular panel centered at (lon,lat), oriented at bearing
     * (deg, direction the panel's normal faces), spanning base..base+height
     * meters above ground, width meters wide. Renders a facade-aligned plane —
     * used for door slabs so they sit IN the wall plane
     * like a building texture instead of camera-facing billboards.
     */
    function addVerticalPanel(feature, lonLatCenter, bearingDeg, opts) {
        var b = (bearingDeg % 360) * Math.PI / 180;
        var h = opts && opts.height ? opts.height : 1.5;
        var wHalf = (opts && opts.width ? opts.width : 1) / 2;
        var base = opts && opts.base !== undefined ? opts.base : 0;
        var gnd = (opts && opts.ground !== undefined) ? opts.ground : 0;
        var color = opts && opts.color ? opts.color : Cesium.Color.WHITE;
        var alpha = opts && opts.alpha !== undefined ? opts.alpha : 0.9;
        var image = opts && opts.image ? opts.image : null;
        var px = 111320 * Math.cos(lonLatCenter[1] * Math.PI / 180);
        // Panel runs perpendicular to the bearing; the normal faces along it.
        var dirLon = Math.sin(b) / px, dirLat = Math.cos(b) / 110540;      // along bearing
        var perLon = Math.cos(b) / px, perLat = -Math.sin(b) / 110540;     // across (panel extent)
        var c = lonLatCenter;
        var corners = [
            [c[0] - dirLon * wHalf + perLon * wHalf, c[1] - dirLat * wHalf + perLat * wHalf],
            [c[0] + dirLon * wHalf + perLon * wHalf, c[1] + dirLat * wHalf + perLat * wHalf],
            [c[0] + dirLon * wHalf - perLon * wHalf, c[1] + dirLat * wHalf - perLat * wHalf],
            [c[0] - dirLon * wHalf - perLon * wHalf, c[1] - dirLat * wHalf - perLat * wHalf]
        ];
        var positions = corners.map(function (cc) {
            return Cesium.Cartesian3.fromDegrees(cc[0], cc[1], gnd + base);
        });
        var material = image
            ? new Cesium.Material({ fabric: { type: 'Image', uniforms: { image: image, color: Cesium.Color.WHITE } } })
            : color.withAlpha(alpha);
        return addEntity(feature, new Cesium.Entity({
            polygon: {
                hierarchy: new Cesium.PolygonHierarchy(positions),
                perPositionHeight: true,
                extrudedHeight: gnd + base + h,
                material: material,
                outline: true,
                outlineColor: color.withAlpha(alpha)
            }
        }));
    }

    /**
     * Bearing (deg) of the nearest wall of a building around a point, or a
     * pseudo-random-but-stable bearing when no building matches (bears 0°).
     */
    function bearingOfDoorWall(lonLat, building) {
        if (!building || !building.rings || !building.rings[0]) return 0;
        var ring = building.rings[0];
        var best = null, bestD = Infinity;
        for (var i = 0; i < ring.length - 1; i++) {
            var mx = (ring[i][0] + ring[i + 1][0]) / 2, my = (ring[i][1] + ring[i + 1][1]) / 2;
            var dx = (mx - lonLat[0]) * 111320 * Math.cos(lonLat[1] * Math.PI / 180);
            var dy = (my - lonLat[1]) * 110540;
            var d = dx * dx + dy * dy;
            if (d < bestD) {
                bestD = d;
                best = [ring[i], ring[i + 1]];
            }
        }
        if (!best) return 0;
        var ebx = (best[1][0] - best[0][0]) * 111320 * Math.cos(lonLat[1] * Math.PI / 180);
        var eby = (best[1][1] - best[0][1]) * 110540;
        return deg(Math.atan2(eby, ebx));
    }

    // ------------------------------------------------------------------
    // Feature processing
    // ------------------------------------------------------------------
    function renderIndoorFeature(feature, tags) {
        try {
            var kind = getIndoorKind(tags);
            if (kind === 'room' || kind === 'area' || kind === 'corridor') { renderIndoorSpace(feature, tags, kind); return; }
            if (kind === 'wall') { renderIndoorWall(feature, tags); return; }
            if (kind === 'level') { renderIndoorLevel(feature, tags); return; }
            var vertical = getVerticalTags(tags);
            if (vertical) { renderVerticalConnection(feature, tags, vertical); return; }
            var nodeKind = getWayNodeKind(tags);
            if (nodeKind) { renderWayNode(feature, tags, nodeKind); return; }
            if (tags.level !== undefined && (tags.name !== undefined || tags.ref !== undefined)) {
                renderIndoorPoi(feature, tags);
            }
        } catch (e) {
            console.warn('🏢 indoor: failed to render feature', e);
        }
    }

    function processFeatureList(featureList) {
        if (!featureList || !featureList.length) return;
        // Skip features already rendered: repeated addIndoorVisuals calls
        // (layer reloads, more GeoJSON files) must not duplicate entities.
        var fresh = [];
        for (var pre = 0; pre < featureList.length; pre++) {
            if (!processedFeatures.has(featureList[pre])) {
                processedFeatures.add(featureList[pre]);
                fresh.push(featureList[pre]);
            }
        }
        if (!fresh.length) return;
        featureList = fresh;

        // Pass 1 — register buildings (SIT §Building) so level placement and
        // shell rendering know their context regardless of feature order.
        for (var i = 0; i < featureList.length; i++) {
            var f = featureList[i];
            var tags = collectTags(f);
            if (!isBuildingTags(tags)) continue;
            var rings = getFeatureLonLatRings(f);
            if (rings) registerIndoorBuilding(rings, tags);
        }

        // Pass 2 — indoor elements. In underground view (L-1) only below-ground
        // elements render at all: every surface feature must disappear.
        var drawn = 0;
        for (var j = 0; j < featureList.length; j++) {
            var fj = featureList[j];
            var tj = collectTags(fj);
            if (getIndoorKind(tj) || getVerticalTags(tj) || getWayNodeKind(tj) ||
                (tj.level !== undefined && (tj.name !== undefined || tj.ref !== undefined))) {
                if (undergroundEnabled && !isFullyUndergroundTags(tj)) continue;
                renderIndoorFeature(fj, tj);
                drawn++;
            }
        }

        // Pass 3 — building shells + level plates where indoor data exists
        for (var k = 0; k < featureList.length; k++) {
            var fk = featureList[k];
            var tk = collectTags(fk);
            if (!isBuildingTags(tk)) continue;
            if (fk.get && fk.get('buildingExtrusionDisabled')) continue; // parts carry the volumes
            var rk = getFeatureLonLatRings(fk);
            if (!rk) continue;
            if (hasIndoorData(tk)) {
                try { renderBuildingIndoor(fk, tk, rk); } catch (e) { /* skip */ }
            }
        }

        if (drawn > 0) console.log('🏢 indoor: rendered ' + drawn + ' indoor element(s)');
    }

    function processLayer(layer) {
        if (!layer || typeof layer.getSource !== 'function') return;
        var source = layer.getSource();
        if (source && source.getFeatures) processFeatureList(source.getFeatures());
    }

    // ------------------------------------------------------------------
    // Scene lifecycle (mirrors buildings.js)
    // ------------------------------------------------------------------
    function addIndoorVisuals(ol3d) {
        if (!indoorEnabled) return;        // toggled off: nothing is rendered
        if (!ol3d || !ol3d.getDataSources || !window.map) return;
        indoorOl3d = ol3d;

        window.map.getLayers().forEach(function (layer) {
            if (layer.get && layer.get('type') === 'overlay' && typeof layer.getLayers === 'function') {
                layer.getLayers().forEach(function (sub) { processLayer(sub); });
            } else if (ol.layer.Vector && layer instanceof ol.layer.Vector) {
                processLayer(layer);
            }
        });
    }

    /**
     * Mode gate for the two exclusive 3D view modes (called on 🏢 and L-1
     * toggles and whenever buildings are rebuilt):
     *   - INDOOR (🏢): building walls translucent (alpha 0.30), restored
     *     opaque when off. Windows belong to this mode only.
     *   - UNDERGROUND (L-1): ground goes translucent showing level<0 / layer<0
     *     volumes; ALL surface features are hidden. When off, the globe is
     *     opaque and NOTHING below ground is rendered.
     */
    function applyModeVisuals() {
        if (window.buildings && typeof window.buildings.setBuildingsTranslucent === 'function') {
            try { window.buildings.setBuildingsTranslucent(indoorEnabled); } catch (e) { /* noop */ }
        }
        if (window.buildings && typeof window.buildings.setUndergroundView === 'function') {
            try { window.buildings.setUndergroundView(undergroundEnabled); } catch (e) { /* noop */ }
        }
        // L-1 = CLEAN ground: no surface clutter. Area textures (parkings,
        // asphalt, sidewalks...) are 'AreaTextures' dataSource entities —
        // hide them in underground view, restore in surface view.
        try {
            var at = window.areaTextureManager;
            if (at && typeof at.getDataSource === 'function') {
                var atds = at.getDataSource();
                if (atds && atds.entities) {
                    var atlist = atds.entities.values;
                    for (var ti = 0; ti < atlist.length; ti++) {
                        if (atlist[ti]) atlist[ti].show = !undergroundEnabled;
                    }
                }
            }
        } catch (e) { /* area textures not present */ }
    }

    /**
     * Keep a newly created / DEM-rebuilt building consistent with the active
     * modes: translucent walls while 🏢 is on; surface buildings hidden while
     * L-1 is on; layer<0 buildings visible only in underground view.
     * Called from createBuildingEntity in buildings.js.
     */
    function syncBuildingEntity(entity, isUndergroundPart) {
        if (!entity) return;
        if (undergroundEnabled) {
            if (!isUndergroundPart) entity.show = false; // surface building: hidden
            return;
        }
        if (isUndergroundPart) entity.show = false;  // layer<0: underground only
        // 🏢 active: walls of EVERY new/rebuilt entity must be translucent —
        // layer loads and DEM re-seats recreate entities opaque, so re-apply
        // the alpha here (was skipped before → 100% opaque grey walls).
        if (indoorEnabled) {
            if (window.buildings && typeof window.buildings.applyWallTranslucency === 'function') {
                try { window.buildings.applyWallTranslucency(entity, true); } catch (e) { /* noop */ }
            }
            if (entity.polygon) entity.show = true;
            return;
        }
        // No mode active: everything opaque and visible (the previous
        // version re-applied translucency here, ghosting walls after a
        // DEM rebuild even with the 🏢 button off).
        if (entity.polygon) entity.show = true;
    }

    function clearIndoorVisuals() {
        var scene = indoorOl3d ? indoorOl3d.getCesiumScene() : null;
        indoorPrimitives.forEach(function (p) {
            try { if (scene && scene.primitives) scene.primitives.remove(p.ref); } catch (e) { /* gone */ }
        });
        indoorPrimitives = [];
        if (indoorOl3d) {
            var sources = indoorOl3d.getDataSources();
            for (var i = sources.length - 1; i >= 0; i--) {
                if (sources.get(i).name === 'Indoor') { sources.remove(sources.get(i), true); break; }
            }
        }
        indoorEntities.clear();
        registeredBuildings = [];
        processedFeatures.clear();
        indoorOl3d = null;
    }

    function setIndoorVisible(visible) {
        indoorEntities.forEach(function (visuals) {
            visuals.forEach(function (v) { if (v) v.show = visible; });
        });
        indoorPrimitives.forEach(function (p) { if (p.ref) p.ref.show = visible; });
    }

    /**
     * UI toggle (3D navigation panel). Turning OFF hides every indoor visual;
     * turning ON shows them again, or renders from scratch if the layer was
     * never drawn (e.g. enabled after GeoJSON layers were already loaded).
     * @returns {boolean} the new state
     */
    /** Full re-render: clear everything and rebuild with the current flags. */
    function rebuildIndoor() {
        clearIndoorVisuals();
        var o = (window.ol3d && window.ol3d.getDataSources &&
                 (!window.ol3d.getEnabled || window.ol3d.getEnabled())) ? window.ol3d : null;
        if (o) addIndoorVisuals(o);
    }

    /** Keep the nav-panel toggle buttons in sync with the actual mode flags. */
    function syncModeButtons() {
        var indoorBtn = document.getElementById('nav3d-indoor-btn');
        if (indoorBtn) {
            indoorBtn.classList.toggle('nav3d-indoor-active', indoorEnabled);
            indoorBtn.title = indoorEnabled ? 'Hide indoor view (Simple Indoor Tagging)'
                                            : 'Show indoor view (Simple Indoor Tagging)';
        }
        var underBtn = document.getElementById('nav3d-underground-btn');
        if (underBtn) {
            underBtn.classList.toggle('nav3d-indoor-active', undergroundEnabled);
            underBtn.title = undergroundEnabled ? 'Hide underground (back to surface only)'
                                                : 'Show underground: level -1 / layer -1 (translucent ground)';
        }
    }

    function setEnabled(enabled) {
        indoorEnabled = !!enabled;
        // Modes are exclusive: enabling indoor always leaves the underground
        // view — indoor requires an OPAQUE ground with only surface features.
        if (indoorEnabled && undergroundEnabled) {
            undergroundEnabled = false;
            applyGlobeTranslucency();
        }
        applyModeVisuals();
        if (indoorEnabled) {
            rebuildIndoor();
        } else {
            setIndoorVisible(false);
        }
        syncModeButtons();
        console.log('🏢 indoor 3D view ' + (indoorEnabled ? 'enabled' : 'disabled'));
        return indoorEnabled;
    }

    function isEnabled() { return indoorEnabled; }

    /**
     * Underground view (L-1 button): basement / level<0 elements render at
     * their true depth, and the globe becomes translucent so they — and any
     * layer=-1 building parts placed below ground by buildings.js — can be
     * seen from above.
     */
    function setUnderground(enabled) {
        undergroundEnabled = !!enabled;
        // Modes are exclusive: entering L-1 always leaves indoor mode —
        // L-1 shows a CLEAN translucent ground with ONLY below-ground
        // volumes; indoor visuals (rooms, windows, labels) never mix in.
        if (undergroundEnabled && indoorEnabled) {
            indoorEnabled = false;
        }
        applyGlobeTranslucency();
        applyModeVisuals();          // opaque walls + hidden windows when indoor off
        if (indoorEnabled) {
            rebuildIndoor();
        } else {
            setIndoorVisible(false); // no indoor entities in L-1 view
        }
        syncModeButtons();
        console.log('🕳️ underground 3D view ' + (undergroundEnabled ? 'enabled' : 'disabled'));
        return undergroundEnabled;
    }

    function isUndergroundEnabled() { return undergroundEnabled; }

    function applyGlobeTranslucency() {
        var o = indoorOl3d || ((window.ol3d && window.ol3d.getCesiumScene) ? window.ol3d : null);
        var scene = o ? o.getCesiumScene() : null;
        if (!scene || !scene.globe || !scene.globe.translucency) return;
        try {
            scene.globe.translucency.enabled = undergroundEnabled;
            if (undergroundEnabled) scene.globe.translucency.frontFaceAlpha = 0.45;
        } catch (e) { /* older Cesium without globe translucency */ }
    }

    window.addEventListener('ol3dInitialized', function (event) {
        try {
            applyGlobeTranslucency();   // keep the underground view across 3D sessions
            addIndoorVisuals(event.detail && event.detail.ol3d);
        } catch (e) {
            console.warn('🏢 indoor: init failed', e);
        }
    });

    window.addEventListener('ol3dDestroyed', function () {
        clearIndoorVisuals();
    });

    // Public API
    window.indoor = {
        LEVEL_HEIGHT: LEVEL_HEIGHT,
        addIndoorVisuals: addIndoorVisuals,
        clearIndoorVisuals: clearIndoorVisuals,
        setIndoorVisible: setIndoorVisible,
        setEnabled: setEnabled,
        isEnabled: isEnabled,
        syncBuildingEntity: syncBuildingEntity,
        addVerticalPanel: addVerticalPanel,
        setUnderground: setUnderground,
        isUndergroundEnabled: isUndergroundEnabled,
        processFeatureList: processFeatureList,
        processLayer: processLayer,
        parseLevelList: parseLevelList
    };
})();
