// ---------------------------------------------------------------------------
// object_info.js — click a rendered 3D object to read its OSM information.
// ---------------------------------------------------------------------------
// The 3D scene is a mix of Cesium entities (indoor, area textures, buildings,
// plain GeoJSON results) and primitives (indoor ribbons, repeated textures,
// models). Picking therefore works in two steps:
//   1. drillPick the Cesium objects under the pointer and use any OL feature
//      reference attached to them;
//   2. if that yields nothing, take the picked position and find the most
//      specific visible OSM feature containing / nearest to that point.
// The popup is deliberately independent from the navigation panel so it can
// be dragged, closed and re-used while the user keeps clicking objects.
// ---------------------------------------------------------------------------

(function () {
    'use strict';

    var PICK_TOLERANCE_METERS = 20;
    var MAX_DRILL_PICKS = 12;

    var INTERNAL_FEATURE_KEYS = {
        geometry: true,
        extrudedBuilding: true,
        extrudedBuildingIndoor: true,
        areaEntity: true,
        areaTags: true,
        buildingTags: true
    };

    var INTERNAL_PROP_KEYS = {
        areaId: true,
        areaTags: true,
        isArea: true,
        textureUrl: true,
        buildingId: true,
        buildingTags: true,
        isBuilding: true
    };

    var PRIMARY_KEYS = [
        'indoor', 'area:highway', 'building', 'highway', 'amenity', 'shop',
        'tourism', 'leisure', 'landuse', 'natural', 'public_transport',
        'railway', 'barrier', 'man_made', 'office', 'craft', 'historic',
        'place', 'emergency', 'healthcare'
    ];

    var enabled = false;
    var popup = null;
    var titleEl = null;
    var subtitleEl = null;
    var tagsEl = null;
    var hintEl = null;
    var handler = null;
    var handlerScene = null;
    var handlerCanvas = null;
    var previousCursor = '';

    // ------------------------------------------------------------------
    // Tag extraction
    // ------------------------------------------------------------------
    function scalar(value) {
        var type = typeof value;
        if (type === 'string' || type === 'number' || type === 'boolean') {
            return String(value);
        }
        return null;
    }

    function mergeScalars(target, source) {
        if (!source || typeof source !== 'object') return;
        Object.keys(source).forEach(function (key) {
            var text = scalar(source[key]);
            if (text !== null) target[key] = text;
        });
    }

    function featureTags(feature) {
        var tags = {};
        if (!feature || typeof feature.getKeys !== 'function') return tags;
        try {
            feature.getKeys().forEach(function (key) {
                if (INTERNAL_FEATURE_KEYS[key]) return;
                var text = scalar(feature.get(key));
                if (text !== null) tags[key] = text;
            });
        } catch (e) {
            return tags;
        }
        return tags;
    }

    function tagsFromEntity(entity) {
        if (!entity || !entity.properties) return null;
        var value = entity.properties;
        try {
            if (typeof value.getValue === 'function') {
                value = value.getValue(window.Cesium.JulianDate.now());
            }
        } catch (e) {
            return null;
        }
        if (!value || typeof value !== 'object') return null;

        var tags = {};
        mergeScalars(tags, value.areaTags);
        mergeScalars(tags, value.buildingTags);
        Object.keys(value).forEach(function (key) {
            if (INTERNAL_PROP_KEYS[key]) return;
            var text = scalar(value[key]);
            if (text !== null) tags[key] = text;
        });
        return Object.keys(tags).length ? tags : null;
    }

    function primaryTag(tags) {
        for (var i = 0; i < PRIMARY_KEYS.length; i++) {
            var key = PRIMARY_KEYS[i];
            if (tags[key] !== undefined && tags[key] !== '') {
                return key + ' = ' + tags[key];
            }
        }
        var keys = Object.keys(tags);
        for (var j = 0; j < keys.length; j++) {
            if (keys[j] === 'name' || keys[j] === 'ref') continue;
            if (tags[keys[j]] !== '') return keys[j] + ' = ' + tags[keys[j]];
        }
        return '';
    }

    // ------------------------------------------------------------------
    // Layer / feature helpers
    // ------------------------------------------------------------------
    function layerLabel(layer) {
        if (!layer || typeof layer.get !== 'function') return '';
        var keys = ['title', 'name', 'id'];
        for (var i = 0; i < keys.length; i++) {
            var value = layer.get(keys[i]);
            if (value !== undefined && value !== null && String(value) !== '') {
                return String(value);
            }
        }
        return '';
    }

    function forEachLayer(root, callback, includeHidden) {
        if (!root) return;
        function visit(layer) {
            if (!layer) return;
            if (!includeHidden && typeof layer.getVisible === 'function' &&
                !layer.getVisible()) return;
            if (typeof layer.getLayers === 'function') {
                layer.getLayers().forEach(visit);
                return;
            }
            if (typeof layer.getSource === 'function') callback(layer);
        }
        if (typeof root.getLayers === 'function') root.getLayers().forEach(visit);
    }

    function resolveLayer(feature) {
        if (!feature || !window.map) return null;
        var found = null;
        forEachLayer(window.map, function (layer) {
            if (found) return;
            var source = layer.getSource();
            if (source && typeof source.hasFeature === 'function' && source.hasFeature(feature)) {
                found = layer;
            }
        }, true);
        return found;
    }

    function toLonLat(coord, projection) {
        return window.ol.proj.toLonLat([coord[0], coord[1]], projection);
    }

    function pointDistanceMeters(lon, lat, point) {
        var latMid = lat * Math.PI / 180;
        var dx = (point[0] - lon) * 111320 * Math.cos(latMid);
        var dy = (point[1] - lat) * 110540;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function segmentDistanceMeters(lon, lat, a, b) {
        var latMid = ((a[1] + b[1]) / 2) * Math.PI / 180;
        var px = 111320 * Math.cos(latMid);
        var py = 110540;
        var ax = (a[0] - lon) * px;
        var ay = (a[1] - lat) * py;
        var bx = (b[0] - lon) * px;
        var by = (b[1] - lat) * py;
        var dx = bx - ax;
        var dy = by - ay;
        var lengthSq = dx * dx + dy * dy;
        var t = lengthSq > 0 ? -(ax * dx + ay * dy) / lengthSq : 0;
        t = Math.max(0, Math.min(1, t));
        var cx = ax + t * dx;
        var cy = ay + t * dy;
        return Math.sqrt(cx * cx + cy * cy);
    }

    function lineDistanceMeters(coords, lon, lat, projection) {
        if (!coords || !coords.length) return Infinity;
        if (coords.length === 1) {
            return pointDistanceMeters(lon, lat, toLonLat(coords[0], projection));
        }
        var min = Infinity;
        for (var i = 1; i < coords.length; i++) {
            var a = toLonLat(coords[i - 1], projection);
            var b = toLonLat(coords[i], projection);
            min = Math.min(min, segmentDistanceMeters(lon, lat, a, b));
        }
        return min;
    }

    function ringDistanceMeters(ring, lon, lat, projection) {
        if (!ring || !ring.length) return Infinity;
        var min = Infinity;
        for (var i = 0; i < ring.length; i++) {
            var a = toLonLat(ring[i], projection);
            var b = toLonLat(ring[(i + 1) % ring.length], projection);
            min = Math.min(min, segmentDistanceMeters(lon, lat, a, b));
        }
        return min;
    }

    function pointInRing(lon, lat, ring) {
        var inside = false;
        for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            var xi = ring[i][0], yi = ring[i][1];
            var xj = ring[j][0], yj = ring[j][1];
            if (((yi > lat) !== (yj > lat)) &&
                (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        return inside;
    }

    function extentArea(geometry) {
        try {
            var extent = geometry.getExtent();
            var area = Math.abs((extent[2] - extent[0]) * (extent[3] - extent[1]));
            return area > 0 ? area : Infinity;
        } catch (e) {
            return Infinity;
        }
    }

    function ringsMatch(rings, lon, lat, projection) {
        if (!rings || !rings[0] || rings[0].length < 3) return null;
        var outer = rings[0].map(function (coord) { return toLonLat(coord, projection); });
        var contains = pointInRing(lon, lat, outer);
        if (contains) {
            for (var h = 1; h < rings.length; h++) {
                var hole = rings[h].map(function (coord) { return toLonLat(coord, projection); });
                if (pointInRing(lon, lat, hole)) {
                    contains = false;
                    break;
                }
            }
        }
        var min = Infinity;
        for (var i = 0; i < rings.length; i++) {
            min = Math.min(min, ringDistanceMeters(rings[i], lon, lat, projection));
        }
        return { contains: contains, distance: min };
    }

    function polygonMatch(geometry, lon, lat, projection) {
        var match = ringsMatch(geometry.getCoordinates(), lon, lat, projection);
        if (match) match.area = extentArea(geometry);
        return match;
    }

    function multiPolygonMatch(geometry, lon, lat, projection) {
        var polygons = geometry.getCoordinates();
        var best = null;
        for (var i = 0; i < polygons.length; i++) {
            var match = ringsMatch(polygons[i], lon, lat, projection);
            if (!match) continue;
            if (!best) best = { contains: false, distance: Infinity };
            if (match.contains) best.contains = true;
            best.distance = Math.min(best.distance, match.distance);
        }
        if (best) best.area = extentArea(geometry);
        return best;
    }

    function geometryMatch(geometry, lon, lat, projection) {
        if (!geometry || typeof geometry.getType !== 'function') return null;
        var type = geometry.getType();
        try {
            if (type === 'Point') {
                var point = toLonLat(geometry.getCoordinates(), projection);
                return { contains: false, distance: pointDistanceMeters(lon, lat, point) };
            }
            if (type === 'MultiPoint') {
                var points = geometry.getCoordinates();
                var pointMin = Infinity;
                for (var p = 0; p < points.length; p++) {
                    pointMin = Math.min(pointMin,
                        pointDistanceMeters(lon, lat, toLonLat(points[p], projection)));
                }
                return { contains: false, distance: pointMin };
            }
            if (type === 'LineString' || type === 'LinearRing') {
                return { contains: false, distance: lineDistanceMeters(geometry.getCoordinates(), lon, lat, projection) };
            }
            if (type === 'MultiLineString') {
                var lines = geometry.getCoordinates();
                var lineMin = Infinity;
                for (var l = 0; l < lines.length; l++) {
                    lineMin = Math.min(lineMin, lineDistanceMeters(lines[l], lon, lat, projection));
                }
                return { contains: false, distance: lineMin };
            }
            if (type === 'Polygon') {
                return polygonMatch(geometry, lon, lat, projection);
            }
            if (type === 'MultiPolygon') {
                return multiPolygonMatch(geometry, lon, lat, projection);
            }
            if (type === 'GeometryCollection' && typeof geometry.getGeometries === 'function') {
                var parts = geometry.getGeometries();
                var best = null;
                for (var g = 0; g < parts.length; g++) {
                    var part = geometryMatch(parts[g], lon, lat, projection);
                    if (!part) continue;
                    if (!best) best = { contains: false, distance: Infinity };
                    if (part.contains) best.contains = true;
                    best.distance = Math.min(best.distance, part.distance);
                }
                if (best) best.area = extentArea(geometry);
                return best;
            }
        } catch (e) {
            return null;
        }
        return null;
    }

    function findFeatureAt(lon, lat) {
        if (!window.map || !window.ol || !window.ol.proj || typeof window.map.getView !== 'function') {
            return null;
        }
        var projection;
        var extent;
        try {
            projection = window.map.getView().getProjection();
            var dLat = PICK_TOLERANCE_METERS / 110540;
            var dLon = PICK_TOLERANCE_METERS /
                (111320 * Math.max(0.05, Math.cos(lat * Math.PI / 180)));
            extent = window.ol.proj.transformExtent(
                [lon - dLon, lat - dLat, lon + dLon, lat + dLat],
                'EPSG:4326', projection
            );
        } catch (e) {
            return null;
        }

        var bestContained = null;
        var bestNear = null;

        forEachLayer(window.map, function (layer) {
            var source = layer.getSource && layer.getSource();
            if (!source) return;
            var features = null;
            if (typeof source.getFeaturesInExtent === 'function') {
                try { features = source.getFeaturesInExtent(extent); } catch (e) { features = null; }
            }
            if (!features) {
                try { features = source.getFeatures ? source.getFeatures() : []; } catch (e) { return; }
            }

            for (var i = 0; i < features.length; i++) {
                var feature = features[i];
                var tags = featureTags(feature);
                if (!Object.keys(tags).length) continue;
                var geometry;
                try { geometry = feature.getGeometry && feature.getGeometry(); } catch (e) { continue; }
                var match = geometryMatch(geometry, lon, lat, projection);
                if (!match) continue;

                if (match.contains) {
                    if (!bestContained || match.area < bestContained.area) {
                        bestContained = {
                            feature: feature,
                            tags: tags,
                            layer: layer,
                            area: match.area
                        };
                    }
                } else if (match.distance <= PICK_TOLERANCE_METERS) {
                    if (!bestNear || match.distance < bestNear.distance) {
                        bestNear = {
                            feature: feature,
                            tags: tags,
                            layer: layer,
                            distance: match.distance
                        };
                    }
                }
            }
        });

        return bestContained || bestNear;
    }

    // ------------------------------------------------------------------
    // Cesium picking
    // ------------------------------------------------------------------
    function getScene() {
        var ol3d = window.ol3d;
        if (!ol3d || typeof ol3d.getCesiumScene !== 'function') return null;
        try {
            if (typeof ol3d.getEnabled === 'function' && !ol3d.getEnabled()) return null;
            return ol3d.getCesiumScene();
        } catch (e) {
            return null;
        }
    }

    function collectDirect(scene, position) {
        var picks = [];
        try {
            picks = scene.drillPick
                ? scene.drillPick(position, MAX_DRILL_PICKS)
                : [];
        } catch (e) {
            picks = [];
        }
        if (!picks || !picks.length) {
            try {
                var one = scene.pick(position);
                if (one) picks = [one];
            } catch (e) {
                picks = [];
            }
        }

        var result = [];
        for (var i = 0; i < picks.length; i++) {
            var picked = picks[i];
            if (!picked) continue;
            var entity = picked.id;
            var primitive = picked.primitive;
            var primitiveFeature = primitive && primitive._olFeature;
            var entityFeature = entity && entity._olFeature;
            var feature = entityFeature || primitiveFeature || null;
            var pickedObject = primitive || entity;
            var isModel = !!(window.Cesium && window.Cesium.Model &&
                pickedObject && pickedObject instanceof window.Cesium.Model);
            var tags = feature ? featureTags(feature) : null;
            if (!tags || !Object.keys(tags).length) {
                tags = tagsFromEntity(entity) || tagsFromEntity(primitive);
            }
            if (!tags || !Object.keys(tags).length) continue;
            // A model/primitive carries its feature directly; unlike a building
            // shell, it is the object that was actually rendered at the cursor.
            result.push({
                feature: feature,
                tags: tags,
                model: isModel,
                precise: !!(entityFeature || primitiveFeature)
            });
        }
        return result;
    }

    function pickedLonLat(scene, position) {
        var cartesian = null;
        try {
            if (scene.pickPositionSupported && typeof scene.pickPosition === 'function') {
                cartesian = scene.pickPosition(position);
            }
        } catch (e) { /* pickPosition can reject symbols */ }
        if (!cartesian && scene.globe && scene.camera) {
            try {
                var ray = scene.camera.getPickRay(position);
                if (ray) cartesian = scene.globe.pick(ray, scene);
            } catch (e) { /* outside globe */ }
        }
        if (!cartesian && scene.camera && typeof scene.camera.pickEllipsoid === 'function') {
            try {
                var ellipsoid = scene.globe ? scene.globe.ellipsoid : undefined;
                cartesian = scene.camera.pickEllipsoid(position, ellipsoid);
            } catch (e) { /* no ellipsoid */ }
        }
        if (!cartesian || !window.Cesium || !window.Cesium.Cartographic) return null;
        var cartographic = window.Cesium.Cartographic.fromCartesian(cartesian);
        if (!cartographic) return null;
        return [
            window.Cesium.Math.toDegrees(cartographic.longitude),
            window.Cesium.Math.toDegrees(cartographic.latitude)
        ];
    }

    function onClick(movement) {
        if (!enabled || !movement || !movement.position) return;
        var scene = getScene();
        if (!scene) return;
        var position = movement.position;

        var direct = collectDirect(scene, position);
        var lonLat = pickedLonLat(scene, position);
        var fallback = lonLat ? findFeatureAt(lonLat[0], lonLat[1]) : null;

        // Indoor spaces live inside translucent shells: prefer an object that
        // actually carries indoor=* over the building shell in the drill list.
        // A non-building direct hit (a 3D area texture, model or POI) is more
        // precise than the coordinate fallback; a building shell is not, since
        // the fallback can still find the room or shop inside it.
        var indoor = null;
        var model = null;
        var precise = null;
        var directSpecific = null;
        for (var i = 0; i < direct.length; i++) {
            var tags = direct[i].tags;
            if (tags && tags.indoor !== undefined && tags.indoor !== 'no') {
                indoor = direct[i];
                break;
            }
            if (!model && direct[i].model) model = direct[i];
            if (!precise && direct[i].precise) precise = direct[i];
            if (!directSpecific && tags && tags.building === undefined) {
                directSpecific = direct[i];
            }
        }

        // Direct picks describe the object actually rendered under the cursor.
        // The coordinate fallback is only useful when nothing was picked, or
        // when it finds an indoor space nested inside a picked building shell.
        // Before this, a model with no feature ref (or a building shell) lost
        // to whatever map polygon happened to lie underneath.
        var fallbackIndoor = fallback && fallback.tags &&
            fallback.tags.indoor !== undefined && fallback.tags.indoor !== 'no'
            ? fallback : null;
        var chosen = indoor || model || precise || directSpecific ||
            fallbackIndoor || direct[0] || fallback || null;
        if (chosen) {
            showResult(chosen.feature || null, chosen.tags,
                chosen.layer || resolveLayer(chosen.feature));
            return;
        }

        var pickedSomething = false;
        try { pickedSomething = !!scene.pick(position); } catch (e) { pickedSomething = false; }
        if (pickedSomething || direct.length) {
            showHint('No OSM tags were found for this object.');
        } else {
            hidePopup();
        }
    }

    // ------------------------------------------------------------------
    // Popup UI
    // ------------------------------------------------------------------
    function ensurePopup() {
        if (popup) return;
        popup = document.createElement('div');
        popup.id = 'object-info-popup';
        popup.style.cssText = [
            'position: fixed',
            'left: 12px',
            'bottom: 12px',
            'width: 300px',
            'max-width: calc(100vw - 24px)',
            'max-height: 55vh',
            'display: none',
            'flex-direction: column',
            'background: rgba(255,255,255,0.98)',
            'border: 1px solid #b8c0c8',
            'border-radius: 8px',
            'box-shadow: 0 4px 18px rgba(0,0,0,0.28)',
            'z-index: 1500',
            'font: 12px/1.35 Arial, sans-serif',
            'color: #222',
            'overflow: hidden'
        ].join(';');

        popup.innerHTML = `
            <div id="object-info-drag-handle" title="Drag to move" style="display:flex;align-items:center;gap:8px;flex:0 0 auto;padding:6px 8px;background:#eef3f8;border-bottom:1px solid #d5dde5;cursor:move;user-select:none;touch-action:none;">
                <strong style="font-size:12px;color:#1f3d5c;">Object info</strong>
                <button id="object-info-close" type="button" aria-label="Close object info" title="Close" style="margin-left:auto;width:22px;height:20px;padding:0;border:1px solid #b8c0c8;border-radius:4px;background:#fff;color:#333;font-size:15px;line-height:1;cursor:pointer;">&times;</button>
            </div>
            <div id="object-info-body" style="flex:1 1 auto;min-height:0;padding:8px;overflow:auto;">
                <div id="object-info-title" style="font-weight:bold;font-size:13px;margin-bottom:2px;word-break:break-word;"></div>
                <div id="object-info-subtitle" style="font-size:10px;color:#667;margin-bottom:6px;word-break:break-word;"></div>
                <div id="object-info-hint" style="font-size:11px;color:#556;"></div>
                <div id="object-info-tags"></div>
            </div>
        `;
        document.body.appendChild(popup);

        titleEl = document.getElementById('object-info-title');
        subtitleEl = document.getElementById('object-info-subtitle');
        tagsEl = document.getElementById('object-info-tags');
        hintEl = document.getElementById('object-info-hint');

        document.getElementById('object-info-close').addEventListener('click', function (ev) {
            ev.stopPropagation();
            hidePopup();
        });

        var handle = document.getElementById('object-info-drag-handle');
        if (handle && window.panelDrag &&
            typeof window.panelDrag.makeDraggable === 'function') {
            window.panelDrag.makeDraggable(popup, handle);
        }
    }

    function showHint(text) {
        ensurePopup();
        titleEl.textContent = 'Object info';
        subtitleEl.textContent = '';
        tagsEl.innerHTML = '';
        tagsEl.style.display = 'none';
        hintEl.textContent = text || 'Click a 3D object to inspect it.';
        hintEl.style.display = 'block';
        popup.style.display = 'flex';
    }

    function showResult(feature, tags, layer) {
        ensurePopup();

        // Keep the 3DMR rotation handle in sync with the object inspector. The
        // handle has its own Cesium pick handler too, so this works even when
        // the inspector is off, and this hook covers the coordinate fallback
        // that finds a 3DMR point under the cursor.
        if (window.threedmr && typeof window.threedmr.selectFeature === 'function') {
            var is3dmr = feature && typeof feature.get === 'function' &&
                (feature.get('3dmr:id') || feature.get('3dmr'));
            if (is3dmr) {
                window.threedmr.selectFeature(feature);
            } else if (typeof window.threedmr.clearSelection === 'function') {
                window.threedmr.clearSelection();
            }
        }

        tags = tags || {};
        var keys = Object.keys(tags).sort(function (a, b) { return a.localeCompare(b); });
        var name = tags.name || tags.ref || '';
        var primary = primaryTag(tags);

        titleEl.textContent = name || primary || 'OSM object';

        var subtitle = [];
        if (name && primary) subtitle.push(primary);
        var label = layerLabel(layer);
        if (label) subtitle.push(label);
        var geometryType = '';
        try {
            if (feature && typeof feature.getGeometry === 'function') {
                geometryType = feature.getGeometry().getType();
            }
        } catch (e) { geometryType = ''; }
        if (geometryType) subtitle.push(geometryType);
        var featureId = null;
        try { featureId = feature && feature.getId ? feature.getId() : null; } catch (e) { featureId = null; }
        if (featureId !== null && featureId !== undefined && String(featureId) !== '') {
            subtitle.push('id ' + featureId);
        }
        subtitleEl.textContent = subtitle.join(' · ');

        tagsEl.innerHTML = '';
        if (!keys.length) {
            tagsEl.style.display = 'none';
            hintEl.textContent = 'No OSM tags on this object.';
            hintEl.style.display = 'block';
            popup.style.display = 'flex';
            return;
        }

        var table = document.createElement('table');
        table.style.cssText = 'width:100%;border-collapse:collapse;';
        keys.forEach(function (key) {
            var row = document.createElement('tr');
            var th = document.createElement('th');
            th.textContent = key;
            th.style.cssText = 'width:42%;padding:2px 4px 2px 0;text-align:left;vertical-align:top;color:#555;font-weight:600;word-break:break-word;';
            var td = document.createElement('td');
            td.textContent = tags[key];
            td.style.cssText = 'padding:2px 0;vertical-align:top;word-break:break-word;';
            row.appendChild(th);
            row.appendChild(td);
            table.appendChild(row);
        });
        tagsEl.appendChild(table);
        tagsEl.style.display = 'block';
        hintEl.style.display = 'none';
        popup.style.display = 'flex';
    }

    function hidePopup() {
        if (popup) popup.style.display = 'none';
    }

    // ------------------------------------------------------------------
    // Scene lifecycle
    // ------------------------------------------------------------------
    function attach() {
        var scene = getScene();
        if (!scene) return false;
        // Cesium.Scene exposes its own canvas; the document lookup is only a
        // fallback for ol-cesium builds that wrap the scene object.
        var canvas = scene.canvas ||
            document.querySelector('.cesium-widget canvas') ||
            document.querySelector('canvas.cesium-widget-canvas');
        if (!canvas) return false;
        if (handler && handlerScene === scene) return true;
        detach();
        if (!window.Cesium || !window.Cesium.ScreenSpaceEventHandler) return false;

        handlerScene = scene;
        handlerCanvas = canvas;
        previousCursor = handlerCanvas.style.cursor || '';
        handlerCanvas.style.cursor = 'crosshair';
        handler = new window.Cesium.ScreenSpaceEventHandler(handlerCanvas);
        handler.setInputAction(onClick, window.Cesium.ScreenSpaceEventType.LEFT_CLICK);
        return true;
    }

    function detach() {
        if (handler) {
            try { handler.destroy(); } catch (e) { /* already destroyed */ }
            handler = null;
        }
        if (handlerCanvas) {
            handlerCanvas.style.cursor = previousCursor;
        }
        handlerCanvas = null;
        handlerScene = null;
    }

    function setEnabled(value) {
        value = !!value;
        if (value === enabled) {
            if (value) attach();
            return enabled;
        }
        enabled = value;
        if (enabled) {
            showHint('Click any 3D object to see its OSM tags.');
            if (!attach()) {
                showHint('Waiting for the 3D view to be ready...');
            }
        } else {
            detach();
            hidePopup();
        }
        return enabled;
    }

    function isEnabled() {
        return enabled;
    }

    window.addEventListener('ol3dInitialized', function () {
        if (enabled) attach();
    });
    window.addEventListener('ol3dDestroyed', function () {
        detach();
        hidePopup();
    });

    window.objectInfo = {
        setEnabled: setEnabled,
        isEnabled: isEnabled,
        close: hidePopup
    };
})();
