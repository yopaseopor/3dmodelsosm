/**
 * 3D Model Repository (3DMR) integration.
 *
 * 3DMR publishes 3D models as glTF binary files and exposes a small
 * CORS-enabled JSON API:
 *   POST /api/search/full   -> model ids + locations + titles
 *   GET  /api/model/<id>    -> the glb model
 *   GET  /api/info/<id>     -> model metadata (license, author, …)
 *
 * In 2D the layer shows one marker per repository model. The same features
 * carry an `osm3dModel` descriptor, which is the property the existing
 * model_renderer uses to place glTF models in the Cesium scene. That means 3D
 * loading is handled by the renderer's normal terrain placement, streaming
 * and memory budget instead of by a second, parallel loader.
 *
 * The published coordinates say where a model belongs, but not which way it
 * faces. In 3D, selecting a 3DMR model therefore shows a round rotate handle
 * and a small editor. Its heading is stored in `modelRotation[1]` (the same
 * convention as models.js) and its vertical offset in `modelHeightOffset`.
 * Both survive map movement (stored locally per 3DMR id) and are included in
 * the downloadable GeoJSON.
 *
 * 3DMR models are CC0 1.0 or CC BY 4.0. The CC BY variant asks for
 * attribution to "3D Model Repository" and no further attribution, so the
 * repository credit below is the required one; the per-model author is still
 * shown when a marker is opened.
 */
(function () {
    'use strict';

    var API_BASE = 'https://3dmr.eu';
    var PAGE_SIZE = 20;          // fixed by the 3DMR API
    var MAX_MODELS = 100;        // keep one view from downloading an entire city
    var MAX_RADIUS_METERS = 50000;
    var MIN_ZOOM = 10;
    var REFRESH_DELAY_MS = 450;
    var ROTATION_RADIUS_METERS = 16;
    var STORAGE_KEY = '3dmrModelTransforms';

    var state = {
        enabled: false,
        booted: false,
        map: null,
        layer: null,
        source: null,
        checkbox: null,
        statusEl: null,
        selectedEl: null,
        selectedId: null,
        downloadButton: null,
        requestVersion: 0,
        refreshTimer: 0,
        overrides: loadOverrides(),
        rotation: {
            feature: null,
            el: null,
            titleEl: null,
            slider: null,
            outputEl: null,
            heightInput: null,
            dataSource: null,
            collection: null,
            scene: null,
            ring: null,
            handle: null,
            center: null,
            handler: null,
            handlerScene: null,
            handlerCanvas: null,
            dragging: false,
            suppressClick: false,
            cameraInputs: null,
            cursorBeforeDrag: null,
            icon: null
        }
    };

    function is3D() {
        try {
            return !!(window.ol3d && typeof window.ol3d.getEnabled === 'function' &&
                window.ol3d.getEnabled());
        } catch (e) {
            return false;
        }
    }

    function getScene() {
        try {
            return window.ol3d && typeof window.ol3d.getCesiumScene === 'function'
                ? window.ol3d.getCesiumScene() : null;
        } catch (e) {
            return null;
        }
    }

    function setStatus(text) {
        if (state.statusEl) state.statusEl.textContent = text;
    }

    /**
     * Ground height for the rotation ring/handle.
     *
     * The MapTerhorn provider does not expose terrain availability, so
     * Cesium's CLAMP_TO_GROUND is a silent no-op on it. A handle at height 0
     * therefore sits under the terrain everywhere except at sea level, and the
     * user cannot grab it. Use the same DEM sources and priority order as the
     * model renderer so the handle is on the surface the model stands on.
     */
    function groundHeightAt(lon, lat) {
        try {
            if (window.mapterhornTerrain &&
                typeof window.mapterhornTerrain.isFlatGroundMode === 'function' &&
                window.mapterhornTerrain.isFlatGroundMode()) return 0;
            if (window.terrainManager && typeof window.terrainManager.getElevation === 'function') {
                var local = window.terrainManager.getElevation(lon, lat);
                if (local !== null && local !== undefined && isFinite(local)) return local;
            }
            if (window.mapterhornTerrain && typeof window.mapterhornTerrain.getElevation === 'function') {
                var dem = window.mapterhornTerrain.getElevation(lon, lat);
                if (dem !== null && dem !== undefined && isFinite(dem)) return dem;
            }
        } catch (e) { /* no DEM yet */ }
        return 0;
    }

    // -----------------------------------------------------------------------
    // Per-model turn / height persistence
    // -----------------------------------------------------------------------

    function loadOverrides() {
        try {
            var raw = window.localStorage && window.localStorage.getItem(STORAGE_KEY);
            var parsed = raw ? JSON.parse(raw) : null;
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    function persistOverrides() {
        try {
            if (window.localStorage) {
                window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.overrides));
            }
        } catch (e) { /* private mode / storage disabled */ }
    }

    function normalizeDegrees(degrees) {
        var value = Number(degrees);
        if (!isFinite(value)) return 0;
        value = value % 360;
        return value < 0 ? value + 360 : value;
    }

    function parseRotation(value) {
        if (typeof value === 'string') {
            try { value = JSON.parse(value); } catch (e) { value = null; }
        }
        if (!Array.isArray(value) || value.length < 3) return [0, 0, 0];
        return [
            Number(value[0]) || 0,
            Number(value[1]) || 0,
            Number(value[2]) || 0
        ];
    }

    function getFeatureId(feature) {
        if (!feature || typeof feature.get !== 'function') return null;
        var id = feature.get('3dmr:id') || feature.get('3dmr');
        return id === undefined || id === null || String(id) === '' ? null : String(id);
    }

    function getFeatureRotation(feature) {
        return parseRotation(feature && feature.get ? feature.get('modelRotation') : null);
    }

    function getFeatureHeightOffset(feature) {
        var value = Number(feature && feature.get ? feature.get('modelHeightOffset') : 0);
        return isFinite(value) ? value : 0;
    }

    function getSavedTransform(id) {
        if (id === null || id === undefined) return null;
        return state.overrides[String(id)] || null;
    }

    function setSavedTransform(id, rotation, heightOffset) {
        if (id === null || id === undefined) return;
        state.overrides[String(id)] = {
            rotation: parseRotation(rotation),
            heightOffset: isFinite(Number(heightOffset)) ? Number(heightOffset) : 0
        };
        persistOverrides();
    }

    // -----------------------------------------------------------------------
    // Map layer and 2D markers
    // -----------------------------------------------------------------------

    function markerStyle() {
        return new ol.style.Style({
            image: new ol.style.Circle({
                radius: 8,
                fill: new ol.style.Fill({ color: 'rgba(103, 58, 183, 0.92)' }),
                stroke: new ol.style.Stroke({ color: '#ffffff', width: 2 })
            }),
            text: new ol.style.Text({
                text: '3D',
                font: 'bold 8px sans-serif',
                fill: new ol.style.Fill({ color: '#ffffff' }),
                textAlign: 'center'
            })
        });
    }

    function createLayer() {
        var source = new ol.source.Vector({
            attributions: [
                '<a href="' + API_BASE + '" target="_blank" rel="noopener">' +
                '3D Model Repository</a> contributors (CC0 / CC BY 4.0)'
            ]
        });
        var layer = new ol.layer.Vector({
            title: '3D Model Repository',
            type: '3dmr',
            source: source,
            style: markerStyle,
            zIndex: 1100
        });
        layer.set('is3dmr', true);
        return { source: source, layer: layer };
    }

    function createFeature(row) {
        if (!Array.isArray(row) || row.length < 4) return null;
        var id = Number(row[0]);
        var lat = Number(row[1]);
        var lon = Number(row[2]);
        if (!isFinite(id) || !isFinite(lat) || !isFinite(lon)) return null;

        var title = String(row[3] || ('3DMR model #' + id));
        var pageUrl = API_BASE + '/model/' + id;
        var modelUrl = API_BASE + '/api/model/' + id;
        var saved = getSavedTransform(id);
        var rotation = saved ? parseRotation(saved.rotation) : [0, 0, 0];
        var heightOffset = saved && isFinite(Number(saved.heightOffset))
            ? Number(saved.heightOffset) : 0;

        var feature = new ol.Feature({
            geometry: new ol.geom.Point(ol.proj.fromLonLat([lon, lat])),
            title: title,
            name: title,
            '3dmr': String(id),
            '3dmr:id': String(id),
            '3dmr:url': pageUrl,
            '3dmr:license': 'CC0 1.0 / CC BY 4.0 — attribution: 3D Model Repository',
            source: pageUrl,
            // model_renderer places any feature carrying this descriptor. The
            // API's latest revision is fetched when the 3D model is needed.
            osm3dModel: { uri: modelUrl, scale: 1 },
            modelRotation: rotation,
            modelHeightOffset: heightOffset
        });
        feature.setId('3dmr-' + id);
        return feature;
    }

    /**
     * The API's range search is circular and only knows about the centre.
     * Use the map viewport's corner distance so a wide view still covers the
     * whole visible area, while the client-side extent filter below drops
     * locations that fall outside the rectangle.
     */
    function getSearchArea() {
        if (!state.map || !state.map.getSize || !state.map.getView) return null;

        // In 3D the OL view is a flattened approximation of the Cesium camera:
        // its centre can sit at the horizon and its zoom does not describe the
        // camera distance. Searching around it made a camera move replace the
        // model list with an empty result and unload the model that was on
        // screen. Use the camera's ground position and a radius derived from
        // its height instead.
        if (is3D()) {
            var scene = getScene();
            var camera = scene && scene.camera;
            var carto = camera && camera.positionCartographic;
            if (!carto || !isFinite(carto.longitude) || !isFinite(carto.latitude)) return null;
            var cameraHeight = isFinite(carto.height) ? Math.max(0, carto.height) : 0;
            return {
                center: [
                    Cesium.Math.toDegrees(carto.longitude),
                    Cesium.Math.toDegrees(carto.latitude)
                ],
                radius: Math.min(MAX_RADIUS_METERS, Math.max(1500, cameraHeight * 3)),
                extent: null
            };
        }

        var size = state.map.getSize();
        if (!size || !size[0] || !size[1]) return null;

        var view = state.map.getView();
        var center = view.getCenter();
        if (!center) return null;

        var extent = view.calculateExtent(size);
        var centerLL = ol.proj.toLonLat(center);
        var corners = [
            [extent[0], extent[1]],
            [extent[2], extent[1]],
            [extent[0], extent[3]],
            [extent[2], extent[3]]
        ];
        var radius = 0;
        corners.forEach(function (corner) {
            var distance = ol.sphere.getDistance(centerLL, ol.proj.toLonLat(corner));
            if (isFinite(distance) && distance > radius) radius = distance;
        });

        radius = Math.min(MAX_RADIUS_METERS, Math.max(1500, radius * 1.05));
        return { center: centerLL, radius: radius, extent: extent };
    }

    function fetchModelRows(area, version) {
        var rows = [];
        var page = 1;

        function fetchPage() {
            if (version !== state.requestVersion) return Promise.resolve(rows);
            return fetch(API_BASE + '/api/search/full', {
                method: 'POST',
                // 3DMR does not answer CORS preflights (OPTIONS returns 400).
                // text/plain is CORS-safelisted, so the browser sends the JSON
                // body directly; the Django view parses request.body itself.
                headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
                body: JSON.stringify({
                    lat: area.center[1],
                    lon: area.center[0],
                    range: Math.round(area.radius),
                    page: page,
                    format: ['id', 'latitude', 'longitude', 'title']
                })
            }).then(function (response) {
                if (!response.ok) {
                    throw new Error('3DMR search returned HTTP ' + response.status);
                }
                return response.json();
            }).then(function (batch) {
                if (version !== state.requestVersion) return rows;
                if (!Array.isArray(batch) || batch.length === 0) return rows;
                rows = rows.concat(batch);
                if (batch.length < PAGE_SIZE || rows.length >= MAX_MODELS) {
                    return rows.slice(0, MAX_MODELS);
                }
                page += 1;
                return fetchPage();
            });
        }

        return fetchPage();
    }

    function unloadModels(features) {
        if (!is3D() || !window.modelRenderer ||
            typeof window.modelRenderer.unloadEntry !== 'function') return;
        var scene = getScene();
        features.forEach(function (feature) {
            var key = window.getFeatureKey
                ? window.getFeatureKey(feature)
                : feature.get('osm3dKey');
            if (key !== null && key !== undefined) {
                window.modelRenderer.unloadEntry(String(key), scene);
            }
        });
    }

    function clearLayerData(preserveSelection) {
        if (!state.source) return null;
        var reopenId = null;
        if (state.rotation.feature &&
            state.source.getFeatures().indexOf(state.rotation.feature) !== -1) {
            if (preserveSelection) reopenId = getFeatureId(state.rotation.feature);
            clearRotation();
        }
        unloadModels(state.source.getFeatures().slice());
        state.source.clear();
        return reopenId;
    }

    function requestModelLoad() {
        if (!state.enabled || !is3D() || !window.modelRenderer ||
            typeof window.modelRenderer.addAllModels !== 'function') return;
        // Let the vector layer finish being added/synchronised first. The
        // priority layer is placed immediately if a GeoJSON sweep is already
        // running; otherwise the normal sweep puts 3DMR before other layers.
        setTimeout(function () {
            if (state.enabled && is3D()) {
                window.modelRenderer.addAllModels({ priorityLayer: state.layer });
            }
        }, 0);
    }

    function refresh() {
        if (!state.enabled || !state.map || !state.source) return;

        var view = state.map.getView();
        if (!is3D() && view.getZoom() < MIN_ZOOM) {
            // Invalidate an older request too: otherwise its response could
            // repopulate the layer after the user has zoomed out.
            state.requestVersion += 1;
            clearLayerData();
            setStatus('Zoom in to at least ' + MIN_ZOOM + ' to see 3DMR models.');
            return;
        }

        var area = getSearchArea();
        if (!area) {
            setStatus('Move or zoom the map to load 3DMR models.');
            return;
        }

        var version = ++state.requestVersion;
        setStatus('Loading 3D Model Repository locations…');

        fetchModelRows(area, version).then(function (rows) {
            if (!state.enabled || version !== state.requestVersion) return;

            // Keep the feature (and its already-loaded Cesium model) for every
            // id the new response still contains. Replacing the whole source
            // unloaded and re-created an unchanged 3DMR model on every refresh
            // — it visibly blinked and closed the rotation editor. Removed ids
            // are released below; new ids are added.
            var existing = state.source.getFeatures().slice();
            var existingById = Object.create(null);
            var duplicateExisting = [];
            existing.forEach(function (feature) {
                var existingId = getFeatureId(feature);
                if (existingId === null) return;
                // Defensive: a previous interrupted refresh or a toggled layer
                // must never leave two markers/models for one 3DMR id.
                if (existingById[existingId]) {
                    duplicateExisting.push(feature);
                    return;
                }
                existingById[existingId] = feature;
            });

            var features = [];
            var newFeatures = [];
            var seen = Object.create(null);
            // In 3D the OL view is a top-down approximation of a pitched camera:
            // its centre sits at the horizon, so models in the foreground can
            // fall outside the 2D extent even though they are plainly visible.
            // The API already limited the result to the search radius; applying
            // the flat extent filter here made the 3DMR layer empty on entering
            // 3D and unloaded the model that had just started loading.
            var filterByTopDownExtent = !is3D();
            rows.forEach(function (row) {
                var rowId = String(Number(row[0]));
                var feature = existingById[rowId] || createFeature(row);
                if (!feature) return;
                var id = feature.get('3dmr:id');
                if (seen[id]) return;
                if (filterByTopDownExtent &&
                    !ol.extent.containsCoordinate(area.extent, feature.getGeometry().getCoordinates())) return;
                if (!existingById[rowId]) newFeatures.push(feature);
                seen[id] = true;
                features.push(feature);
            });

            // A 3D camera transition can produce an empty intermediate
            // response. Do not tear down a working layer for it: the next
            // settled search will either return the model again or return a
            // different non-empty set, which is handled below. In 2D an empty
            // response really does mean there is nothing in the rectangle.
            var keepExistingOnEmpty = is3D() && rows.length === 0;
            var removed = keepExistingOnEmpty ? duplicateExisting : existing.filter(function (feature) {
                var id = getFeatureId(feature);
                return id === null || !seen[id] || duplicateExisting.indexOf(feature) !== -1;
            });
            if (removed.length) {
                if (state.rotation.feature && removed.indexOf(state.rotation.feature) !== -1) {
                    clearRotation();
                }
                unloadModels(removed);
                state.source.removeFeatures(removed);
            }

            if (newFeatures.length) state.source.addFeatures(newFeatures);
            var visibleCount = features.length ||
                (keepExistingOnEmpty ? existing.length - duplicateExisting.length : 0);
            setStatus(visibleCount
                ? visibleCount + ' 3DMR model location(s) in view. 3D models load in 3D mode.'
                : 'No 3DMR models in this view. Pan or zoom to find some.');

            if (visibleCount) requestModelLoad();
        }).catch(function (error) {
            if (version !== state.requestVersion) return;
            console.warn('3DMR search failed:', error);
            setStatus('Could not load 3DMR models. Check the connection and try again.');
        });
    }

    function scheduleRefresh() {
        if (!state.enabled) return;
        clearTimeout(state.refreshTimer);
        state.refreshTimer = setTimeout(refresh, REFRESH_DELAY_MS);
    }

    // -----------------------------------------------------------------------
    // Selected-model information (2D)
    // -----------------------------------------------------------------------

    function hideSelected() {
        state.selectedId = null;
        if (state.selectedEl) {
            state.selectedEl.style.display = 'none';
            state.selectedEl.innerHTML = '';
        }
    }

    function appendInfoLine(panel, text) {
        var line = document.createElement('div');
        line.className = 'threedmr-info-meta';
        line.textContent = text;
        panel.appendChild(line);
    }

    function showSelected(feature) {
        if (!state.selectedEl) return;
        var id = feature.get('3dmr:id');
        var title = feature.get('title') || ('3DMR model #' + id);
        state.selectedId = String(id);
        state.selectedEl.innerHTML = '';
        state.selectedEl.style.display = 'block';

        var head = document.createElement('div');
        head.className = 'threedmr-info-head';

        var heading = document.createElement('strong');
        heading.textContent = title;
        head.appendChild(heading);

        var close = document.createElement('button');
        close.type = 'button';
        close.className = 'threedmr-info-close';
        close.setAttribute('aria-label', 'Close 3DMR model info');
        close.textContent = '×';
        close.addEventListener('click', hideSelected);
        head.appendChild(close);
        state.selectedEl.appendChild(head);

        var pageUrl = feature.get('3dmr:url') || (API_BASE + '/model/' + id);
        var link = document.createElement('a');
        link.href = pageUrl;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = 'Open model page on 3dmr.eu';
        state.selectedEl.appendChild(link);

        appendInfoLine(state.selectedEl, 'Model #' + id + ' · 3D Model Repository');
        appendInfoLine(state.selectedEl, 'Attribution: 3D Model Repository (CC0 / CC BY 4.0)');

        // Metadata is fetched only for the model the user selected. The search
        // API deliberately returns only id/position/title, so this keeps the
        // normal layer request small.
        fetch(API_BASE + '/api/info/' + encodeURIComponent(id)).then(function (response) {
            return response.ok ? response.json() : null;
        }).then(function (info) {
            if (!info || state.selectedId !== String(id) || !state.selectedEl) return;
            var license = info.license === 0 ? 'CC0 1.0' :
                info.license === 1 ? 'CC BY 4.0' : 'see model page';
            var details = 'License: ' + license;
            if (info.author) details += ' · OSM user #' + info.author;
            appendInfoLine(state.selectedEl, details);
        }).catch(function () {
            // The generic attribution above is still sufficient for display.
        });
    }

    // -----------------------------------------------------------------------
    // 3D rotation handle and height editor
    // -----------------------------------------------------------------------

    function featureAnchorLonLat(feature) {
        if (!feature || typeof feature.getGeometry !== 'function') return null;
        var geometry = feature.getGeometry();
        if (!geometry) return null;
        var projection = state.map && state.map.getView
            ? state.map.getView().getProjection() : 'EPSG:3857';
        try {
            var type = geometry.getType();
            var coordinate = null;
            if (type === 'Point') {
                coordinate = geometry.getCoordinates();
            } else if (type === 'LineString') {
                var line = geometry.getCoordinates();
                if (line.length) coordinate = line[Math.floor(line.length / 2)];
            } else {
                coordinate = ol.extent.getCenter(geometry.getExtent());
            }
            if (!coordinate) return null;
            return ol.proj.toLonLat(coordinate, projection);
        } catch (e) {
            return null;
        }
    }

    function turnDegreesFromFeature(feature) {
        return normalizeDegrees(-getFeatureRotation(feature)[1] * 180 / Math.PI);
    }

    function updateRotationReadout() {
        if (!state.rotation.feature) return;
        var degrees = Math.round(turnDegreesFromFeature(state.rotation.feature)) % 360;
        var heightOffset = getFeatureHeightOffset(state.rotation.feature);
        if (state.rotation.slider) state.rotation.slider.value = String(degrees);
        if (state.rotation.outputEl) state.rotation.outputEl.textContent = degrees + '°';
        if (state.rotation.heightInput) state.rotation.heightInput.value = heightOffset.toFixed(1);
    }

    /**
     * Height for the grab handle.
     *
     * At the default 45° camera angle the ground beside a model can project
     * below the viewport, while the model itself is on screen. Keep the handle
     * at the model's centre height (falling back to the DEM) so it remains
     * reachable instead of being buried under the model or below the view.
     */
    function rotationHandleHeight(lon, lat) {
        var ground = groundHeightAt(lon, lat);
        var feature = state.rotation.feature;
        if (!feature || !window.Cesium || !window.modelRenderer ||
            !window.modelRenderer.loadedModels) return ground;
        try {
            var key = window.getFeatureKey
                ? window.getFeatureKey(feature)
                : feature.get('osm3dKey');
            var entry = key && window.modelRenderer.loadedModels.get(String(key));
            if (!entry || !entry.model) return ground;

            // Model.boundingSphere.center is local to the glTF, not an ECEF
            // point. The radius is still useful: the model origin sits on the
            // terrain, so lifting the handle by roughly one radius puts it near
            // the visible body instead of on the ground below the camera.
            var radius = entry.model.boundingSphere &&
                Number(entry.model.boundingSphere.radius);
            if (!isFinite(radius) || radius <= 0) return ground;
            var base = Number(entry.elevation);
            if (!isFinite(base)) base = ground;
            return base + getFeatureHeightOffset(feature) + Math.min(radius, 200);
        } catch (e) {
            return ground;
        }
    }

    function updateRotationHandle(degrees) {
        var handle = state.rotation.handle;
        var center = state.rotation.center;
        if (!handle || !center || !window.Cesium) return;

        var bearing = normalizeDegrees(degrees) * Math.PI / 180;
        var lat = center[1] + (ROTATION_RADIUS_METERS * Math.cos(bearing)) / 111320;
        var lon = center[0] + (ROTATION_RADIUS_METERS * Math.sin(bearing)) /
            (111320 * Math.max(0.05, Math.cos(center[1] * Math.PI / 180)));
        handle.position = Cesium.Cartesian3.fromDegrees(lon, lat, rotationHandleHeight(lon, lat));
    }

    function applyFeatureRotation() {
        var feature = state.rotation.feature;
        if (!feature) return;
        var rotation = getFeatureRotation(feature);
        if (window.modelRenderer && typeof window.modelRenderer.setFeatureRotation === 'function') {
            window.modelRenderer.setFeatureRotation(feature, rotation, state.rotation.scene);
        }
    }

    function applyFeatureHeightOffset() {
        var feature = state.rotation.feature;
        if (!feature) return;
        if (window.modelRenderer && typeof window.modelRenderer.setFeatureHeightOffset === 'function') {
            window.modelRenderer.setFeatureHeightOffset(
                feature, getFeatureHeightOffset(feature), state.rotation.scene);
        }
    }

    function rememberFeatureTransform() {
        var feature = state.rotation.feature;
        if (!feature) return;
        setSavedTransform(getFeatureId(feature), getFeatureRotation(feature),
            getFeatureHeightOffset(feature));
    }

    function setTurnDegrees(degrees) {
        var feature = state.rotation.feature;
        if (!feature) return;
        var rotation = getFeatureRotation(feature);
        rotation[1] = -normalizeDegrees(degrees) * Math.PI / 180;
        feature.set('modelRotation', rotation);
        rememberFeatureTransform();
        applyFeatureRotation();
        updateRotationHandle(normalizeDegrees(degrees));
        updateRotationReadout();
    }

    function setHeightOffset(offset) {
        var feature = state.rotation.feature;
        if (!feature) return;
        var value = Number(offset);
        if (!isFinite(value)) return;
        feature.set('modelHeightOffset', value);
        rememberFeatureTransform();
        applyFeatureHeightOffset();
        updateRotationHandle(turnDegreesFromFeature(feature));
        updateRotationReadout();
    }

    function rotationIconDataUrl() {
        if (state.rotation.icon) return state.rotation.icon;
        try {
            var canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 64;
            var ctx = canvas.getContext('2d');
            if (!ctx) return null;
            ctx.beginPath();
            ctx.arc(32, 32, 27, 0, Math.PI * 2);
            ctx.fillStyle = '#673AB7';
            ctx.fill();
            ctx.lineWidth = 4;
            ctx.strokeStyle = '#ffffff';
            ctx.stroke();
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 38px Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('↻', 32, 35);
            state.rotation.icon = canvas.toDataURL('image/png');
            return state.rotation.icon;
        } catch (e) {
            return null;
        }
    }

    function ringPositions(center) {
        var positions = [];
        for (var i = 0; i <= 72; i++) {
            var bearing = (i / 72) * Math.PI * 2;
            var lat = center[1] + (ROTATION_RADIUS_METERS * Math.cos(bearing)) / 111320;
            var lon = center[0] + (ROTATION_RADIUS_METERS * Math.sin(bearing)) /
                (111320 * Math.max(0.05, Math.cos(center[1] * Math.PI / 180)));
            positions.push(Cesium.Cartesian3.fromDegrees(lon, lat, groundHeightAt(lon, lat)));
        }
        return positions;
    }

    function disposeRotationEntities() {
        var rotation = state.rotation;
        if (rotation.dataSource) {
            try {
                if (rotation.dataSource.entities && rotation.dataSource.entities.removeAll) {
                    rotation.dataSource.entities.removeAll();
                }
                if (rotation.collection && typeof rotation.collection.remove === 'function' &&
                    typeof rotation.collection.contains === 'function' &&
                    rotation.collection.contains(rotation.dataSource)) {
                    rotation.collection.remove(rotation.dataSource);
                }
            } catch (e) { /* scene already gone */ }
        }
        rotation.dataSource = null;
        rotation.collection = null;
        rotation.scene = null;
        rotation.ring = null;
        rotation.handle = null;
    }

    function ensureRotationEntities() {
        var scene = getScene();
        if (!scene || !window.Cesium) return false;

        if (state.rotation.dataSource && state.rotation.scene === scene) {
            if (state.rotation.ring) {
                state.rotation.ring.polyline.positions = ringPositions(state.rotation.center);
                state.rotation.ring.show = true;
            }
            if (state.rotation.handle) state.rotation.handle.show = true;
            updateRotationHandle(turnDegreesFromFeature(state.rotation.feature));
            return true;
        }

        disposeRotationEntities();

        var collection = window.ol3d && typeof window.ol3d.getDataSources === 'function'
            ? window.ol3d.getDataSources() : null;
        if (!collection || typeof collection.add !== 'function') return false;

        var dataSource = new Cesium.CustomDataSource('3DMR-rotation');
        collection.add(dataSource);

        var positions = ringPositions(state.rotation.center);
        var ring = dataSource.entities.add({
            id: 'threedmr-rotation-ring',
            polyline: {
                positions: positions,
                width: 3,
                material: Cesium.Color.fromCssColorString('#673AB7').withAlpha(0.92),
                clampToGround: true
            }
        });

        var icon = rotationIconDataUrl();
        if (!icon) {
            collection.remove(dataSource);
            return false;
        }
        var handle = dataSource.entities.add({
            id: 'threedmr-rotation-handle',
            position: Cesium.Cartesian3.fromDegrees(
                state.rotation.center[0], state.rotation.center[1],
                rotationHandleHeight(state.rotation.center[0], state.rotation.center[1])),
            billboard: {
                image: icon,
                scale: 0.6,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
        });

        state.rotation.dataSource = dataSource;
        state.rotation.collection = collection;
        state.rotation.scene = scene;
        state.rotation.ring = ring;
        state.rotation.handle = handle;
        updateRotationHandle(turnDegreesFromFeature(state.rotation.feature));
        return true;
    }

    function ensureRotationPanel() {
        if (state.rotation.el) return state.rotation.el;

        var panel = document.createElement('div');
        panel.id = 'threedmr-rotate-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Adjust 3DMR model');
        panel.innerHTML =
            '<div class="threedmr-rotate-head">' +
                '<strong>Adjust 3DMR model</strong>' +
                '<button type="button" class="threedmr-rotate-close" aria-label="Close model adjustment">×</button>' +
            '</div>' +
            '<div class="threedmr-rotate-title"></div>' +
            '<div class="threedmr-rotate-row">' +
                '<span>Turn</span>' +
                '<input id="threedmr-rotate-slider" type="range" min="0" max="359" step="1" value="0" aria-label="Model turn in degrees">' +
                '<output class="threedmr-rotate-output">0°</output>' +
            '</div>' +
            '<div class="threedmr-rotate-hint">Drag the model itself or the round ↻ handle around it in the 3D view, or use the slider. Shift is not required; the handle snaps to your pointer.</div>' +
            '<div class="threedmr-rotate-actions">' +
                '<button type="button" id="threedmr-rotate-left" aria-label="Turn model counter-clockwise 15 degrees">↺ 15°</button>' +
                '<button type="button" id="threedmr-rotate-right" aria-label="Turn model clockwise 15 degrees">↻ 15°</button>' +
                '<button type="button" id="threedmr-rotate-reset">Reset turn &amp; height</button>' +
                '<button type="button" id="threedmr-rotate-download">Download GeoJSON</button>' +
            '</div>' +
            '<div class="threedmr-rotate-row">' +
                '<label for="threedmr-rotate-height">Height (m)</label>' +
                '<input id="threedmr-rotate-height" type="number" step="0.1" value="0" aria-label="Model height offset in metres">' +
            '</div>' +
            '<div class="threedmr-rotate-hint">Height is an offset above the terrain, useful when the model floor is wrong.</div>';

        document.body.appendChild(panel);

        state.rotation.el = panel;
        state.rotation.titleEl = panel.querySelector('.threedmr-rotate-title');
        state.rotation.slider = panel.querySelector('#threedmr-rotate-slider');
        state.rotation.outputEl = panel.querySelector('.threedmr-rotate-output');
        state.rotation.heightInput = panel.querySelector('#threedmr-rotate-height');

        panel.querySelector('.threedmr-rotate-close').addEventListener('click', function () {
            clearRotation();
        });
        state.rotation.slider.addEventListener('input', function () {
            setTurnDegrees(Number(this.value));
        });
        panel.querySelector('#threedmr-rotate-left').addEventListener('click', function () {
            if (!state.rotation.feature) return;
            setTurnDegrees(turnDegreesFromFeature(state.rotation.feature) - 15);
        });
        panel.querySelector('#threedmr-rotate-right').addEventListener('click', function () {
            if (!state.rotation.feature) return;
            setTurnDegrees(turnDegreesFromFeature(state.rotation.feature) + 15);
        });
        state.rotation.heightInput.addEventListener('change', function () {
            setHeightOffset(Number(this.value));
        });
        panel.querySelector('#threedmr-rotate-reset').addEventListener('click', function () {
            setTurnDegrees(0);
            setHeightOffset(0);
        });
        panel.querySelector('#threedmr-rotate-download').addEventListener('click', downloadGeoJSON);

        if (window.panelDrag && typeof window.panelDrag.makeDraggable === 'function') {
            window.panelDrag.makeDraggable(panel, panel.querySelector('.threedmr-rotate-head'));
        }
        return panel;
    }

    function selectFeature(feature) {
        if (!is3D() || getFeatureId(feature) === null) return false;
        var anchor = featureAnchorLonLat(feature);
        if (!anchor) return false;

        state.rotation.feature = feature;
        state.rotation.center = anchor;
        if (!ensureRotationEntities()) return false;

        var panel = ensureRotationPanel();
        if (!panel) return false;
        var title = feature.get('name') || feature.get('title') || ('3DMR model #' + getFeatureId(feature));
        if (state.rotation.titleEl) state.rotation.titleEl.textContent = title;
        panel.classList.add('threedmr-rotate-visible');
        document.body.classList.add('threedmr-rotate-open');
        updateRotationReadout();
        updateRotationHandle(turnDegreesFromFeature(feature));
        var scene = state.rotation.scene;
        if (scene && scene.requestRender) scene.requestRender();
        return true;
    }

    function clearRotation() {
        state.rotation.dragging = false;
        state.rotation.suppressClick = false;
        restoreCameraInputs();
        disposeRotationEntities();
        state.rotation.feature = null;
        state.rotation.center = null;
        if (state.rotation.el) {
            state.rotation.el.classList.remove('threedmr-rotate-visible');
        }
        document.body.classList.remove('threedmr-rotate-open');
    }

    function restoreCameraInputs() {
        var scene = state.rotation.scene;
        if (scene && scene.screenSpaceCameraController &&
            state.rotation.cameraInputs !== null) {
            scene.screenSpaceCameraController.enableInputs = state.rotation.cameraInputs;
        }
        state.rotation.cameraInputs = null;
        if (state.rotation.handlerCanvas) {
            state.rotation.handlerCanvas.style.cursor = state.rotation.cursorBeforeDrag || '';
        }
        state.rotation.cursorBeforeDrag = null;
    }

    function pickLonLat(scene, screenPosition) {
        if (!scene || !screenPosition || !window.Cesium) return null;
        var cartesian = null;
        try {
            if (scene.pickPositionSupported && typeof scene.pickPosition === 'function') {
                cartesian = scene.pickPosition(screenPosition);
            }
        } catch (e) { /* pickPosition can reject symbols */ }
        if (!cartesian && scene.globe && scene.camera) {
            try {
                var ray = scene.camera.getPickRay(screenPosition);
                if (ray) cartesian = scene.globe.pick(ray, scene);
            } catch (e) { /* outside globe */ }
        }
        if (!cartesian && scene.camera && typeof scene.camera.pickEllipsoid === 'function') {
            try {
                var ellipsoid = scene.globe ? scene.globe.ellipsoid : undefined;
                cartesian = scene.camera.pickEllipsoid(screenPosition, ellipsoid);
            } catch (e) { /* no ellipsoid */ }
        }
        if (!cartesian) return null;
        var cartographic = Cesium.Cartographic.fromCartesian(cartesian);
        if (!cartographic) return null;
        return [
            Cesium.Math.toDegrees(cartographic.longitude),
            Cesium.Math.toDegrees(cartographic.latitude)
        ];
    }

    function bearingBetween(start, end) {
        var radians = Math.PI / 180;
        var lat1 = start[1] * radians;
        var lat2 = end[1] * radians;
        var deltaLon = (end[0] - start[0]) * radians;
        var y = Math.sin(deltaLon) * Math.cos(lat2);
        var x = Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
        return normalizeDegrees(Math.atan2(y, x) * 180 / Math.PI);
    }

    function pickedFeature(picked) {
        if (!picked) return null;
        return (picked.primitive && picked.primitive._olFeature) ||
            (picked.id && picked.id._olFeature) || null;
    }

    function onSceneClick(movement) {
        if (!is3D() || state.rotation.suppressClick || !movement || !movement.position) return;
        var scene = getScene();
        if (!scene) return;
        var picks = [];
        try {
            picks = scene.drillPick ? scene.drillPick(movement.position, 12) : [];
        } catch (e) { picks = []; }
        for (var i = 0; i < picks.length; i++) {
            var feature = pickedFeature(picks[i]);
            if (feature && getFeatureId(feature) !== null) {
                selectFeature(feature);
                return;
            }
        }
    }

    function onDragStart(movement) {
        if (!is3D() || !movement || !movement.position ||
            !state.rotation.feature || !state.rotation.scene) return;
        var scene = state.rotation.scene;
        var picked = null;
        try { picked = scene.pick(movement.position); } catch (e) { picked = null; }
        var isHandle = !!(picked && picked.id === state.rotation.handle);
        var pickedModelFeature = pickedFeature(picked);
        var isSelectedModel = !!(pickedModelFeature &&
            getFeatureId(pickedModelFeature) !== null &&
            getFeatureId(pickedModelFeature) === getFeatureId(state.rotation.feature));
        if (!isHandle && !isSelectedModel) return;

        state.rotation.dragging = true;
        state.rotation.suppressClick = true;
        if (state.rotation.handlerCanvas) {
            state.rotation.cursorBeforeDrag = state.rotation.handlerCanvas.style.cursor || '';
            state.rotation.handlerCanvas.style.cursor = 'grabbing';
        }
        var controller = scene.screenSpaceCameraController;
        if (controller) {
            state.rotation.cameraInputs = controller.enableInputs;
            controller.enableInputs = false;
        }
    }

    function onDragMove(movement) {
        if (!state.rotation.dragging || !movement || !state.rotation.center) return;
        var scene = state.rotation.scene;
        var point = pickLonLat(scene, movement.endPosition);
        if (!point) return;
        setTurnDegrees(bearingBetween(state.rotation.center, point));
    }

    function onDragEnd() {
        if (!state.rotation.dragging) return;
        state.rotation.dragging = false;
        restoreCameraInputs();
        var scene = state.rotation.scene;
        if (scene && scene.requestRender) scene.requestRender();
        // The click that follows the pointer-up must not immediately re-select
        // something under the handle.
        setTimeout(function () { state.rotation.suppressClick = false; }, 220);
    }

    function attach3DInteraction() {
        var scene = getScene();
        if (!scene || !window.Cesium || !Cesium.ScreenSpaceEventHandler) return false;
        var canvas = scene.canvas ||
            document.querySelector('.cesium-widget canvas') ||
            document.querySelector('canvas.cesium-widget-canvas');
        if (!canvas) return false;
        if (state.rotation.handler && state.rotation.handlerScene === scene) return true;

        detach3DInteraction();
        var handler = new Cesium.ScreenSpaceEventHandler(canvas);
        handler.setInputAction(onSceneClick, Cesium.ScreenSpaceEventType.LEFT_CLICK);
        handler.setInputAction(onDragStart, Cesium.ScreenSpaceEventType.LEFT_DOWN);
        handler.setInputAction(onDragMove, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        handler.setInputAction(onDragEnd, Cesium.ScreenSpaceEventType.LEFT_UP);
        state.rotation.handler = handler;
        state.rotation.handlerScene = scene;
        state.rotation.handlerCanvas = canvas;
        return true;
    }

    function detach3DInteraction() {
        if (state.rotation.handler) {
            try { state.rotation.handler.destroy(); } catch (e) { /* already destroyed */ }
            state.rotation.handler = null;
        }
        state.rotation.handlerScene = null;
        state.rotation.handlerCanvas = null;
    }

    // -----------------------------------------------------------------------
    // GeoJSON export
    // -----------------------------------------------------------------------

    function forEachMapSource(callback) {
        if (!state.map || !state.map.getLayers) return;
        function visit(layer) {
            if (!layer) return;
            if (typeof layer.getLayers === 'function') {
                layer.getLayers().forEach(visit);
                return;
            }
            var source = typeof layer.getSource === 'function' ? layer.getSource() : null;
            if (source && typeof source.getFeatures === 'function') callback(source);
        }
        state.map.getLayers().forEach(visit);
    }

    function collect3DMRFeatures() {
        var byId = Object.create(null);
        forEachMapSource(function (source) {
            source.getFeatures().forEach(function (feature) {
                var id = getFeatureId(feature);
                if (id === null) return;
                byId[id] = feature;
            });
        });
        return Object.keys(byId).map(function (id) { return byId[id]; });
    }

    function featureToGeoJSON(feature) {
        var id = getFeatureId(feature);
        var lonLat = featureAnchorLonLat(feature);
        if (id === null || !lonLat) return null;

        var model = feature.get('osm3dModel') || feature.get('model') || {};
        var uri = model.uri || (API_BASE + '/api/model/' + encodeURIComponent(id));
        var pageUrl = feature.get('3dmr:url') || (API_BASE + '/model/' + encodeURIComponent(id));
        var title = feature.get('name') || feature.get('title') || ('3DMR model #' + id);
        var rotation = getFeatureRotation(feature);
        var heightOffset = getFeatureHeightOffset(feature);

        return {
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [lonLat[0], lonLat[1]]
            },
            properties: {
                name: title,
                title: title,
                '3dmr': String(id),
                '3dmr:id': String(id),
                '3dmr:url': pageUrl,
                '3dmr:license': 'CC0 1.0 / CC BY 4.0 — attribution: 3D Model Repository',
                source: pageUrl,
                osm3dModel: {
                    uri: uri,
                    scale: Number(model.scale) || 1
                },
                modelRotation: rotation,
                modelHeightOffset: heightOffset
            }
        };
    }

    function downloadGeoJSON() {
        var features = collect3DMRFeatures().map(featureToGeoJSON).filter(Boolean);
        if (!features.length) {
            setStatus('No 3DMR models loaded. Enable the layer and wait for the markers first.');
            return;
        }

        var geoJSON = {
            type: 'FeatureCollection',
            name: '3D Model Repository models',
            features: features
        };
        var blob = new Blob([JSON.stringify(geoJSON, null, 2)], {
            type: 'application/geo+json'
        });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = '3dmr_models_' + new Date().toISOString().slice(0, 10) + '.geojson';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
        setStatus('Downloaded ' + features.length +
            ' 3DMR model(s) with their turn and height offset.');
    }

    // -----------------------------------------------------------------------
    // Attribution
    // -----------------------------------------------------------------------

    // Register the model credit with the single map attribution control. It
    // stays in the static catalogue even while the layer is off; setEnabled
    // flips the active flag so the dynamic scope follows the layer state.
    function updateAttribution() {
        if (!window.attributions || typeof window.attributions.registerStatic !== 'function') return;
        window.attributions.registerStatic('3dmr', {
            title: '3D models',
            html: 'Models &copy; <a href="' + API_BASE + '" target="_blank" rel="noopener">' +
                '3D Model Repository</a> (CC0 / CC BY 4.0)',
            active: state.enabled,
            order: 20
        });
    }

    // -----------------------------------------------------------------------
    // Enable / disable
    // -----------------------------------------------------------------------

    function ensureLayer() {
        if (!state.layer || !state.source) {
            var created = createLayer();
            state.layer = created.layer;
            state.source = created.source;
        }
        if (state.map && state.map.getLayers().getArray().indexOf(state.layer) === -1) {
            state.map.addLayer(state.layer);
        }
    }

    function setEnabled(enabled) {
        state.enabled = !!enabled;
        if (state.checkbox) state.checkbox.checked = state.enabled;
        updateAttribution();

        if (!state.enabled) {
            state.requestVersion += 1;
            clearTimeout(state.refreshTimer);
            hideSelected();
            clearRotation();
            clearLayerData();
            if (state.layer && state.map) {
                try { state.map.removeLayer(state.layer); } catch (e) { /* map gone */ }
            }
            state.layer = null;
            state.source = null;
            setStatus('3D Model Repository layer is off.');
            return;
        }

        ensureLayer();
        setStatus('Loading 3D Model Repository locations…');
        refresh();
    }

    // -----------------------------------------------------------------------
    // Bootstrap
    // -----------------------------------------------------------------------

    function onMapClick(event) {
        if (!state.enabled || !state.map || is3D()) return;
        var hit = state.map.forEachFeatureAtPixel(event.pixel, function (feature) {
            return feature.get('3dmr:id') ? feature : null;
        }, { hitTolerance: 4 });
        if (hit) showSelected(hit);
    }

    function boot() {
        if (state.booted) return true;
        if (!window.map || !window.map.getView) return false;
        state.booted = true;
        state.map = window.map;

        state.checkbox = document.getElementById('threedmr-toggle');
        state.statusEl = document.getElementById('threedmr-status');
        state.selectedEl = document.getElementById('threedmr-selected');
        state.downloadButton = document.getElementById('threedmr-download');

        if (state.checkbox) {
            state.checkbox.checked = state.enabled;
            state.checkbox.addEventListener('change', function () {
                setEnabled(this.checked);
            });
        }
        if (state.downloadButton) {
            state.downloadButton.addEventListener('click', downloadGeoJSON);
        }

        state.map.on('moveend', scheduleRefresh);
        state.map.on('singleclick', onMapClick);

        window.addEventListener('ol3dInitialized', function () {
            updateAttribution();
            attach3DInteraction();
            if (state.enabled) refresh();
        });
        window.addEventListener('ol3dDestroyed', function () {
            clearRotation();
            detach3DInteraction();
            updateAttribution();
        });

        if (is3D()) attach3DInteraction();
        updateAttribution();
        setStatus('Show 3DMR model locations. The same models load in 3D mode.');
        return true;
    }

    var tries = 0;
    var waitTimer = setInterval(function () {
        if (boot() || ++tries > 100) clearInterval(waitTimer);
    }, 200);

    // Public API used by object_info.js and the console.
    window.threedmr = {
        selectFeature: selectFeature,
        clearSelection: clearRotation,
        clearRotation: clearRotation,
        downloadGeoJSON: downloadGeoJSON,
        collect3DMRFeatures: collect3DMRFeatures,
        rememberImportedTransform: function (feature) {
            var id = getFeatureId(feature);
            if (id === null) return;
            setSavedTransform(id, getFeatureRotation(feature), getFeatureHeightOffset(feature));
        }
    };

    console.log('🧱 3D Model Repository integration loaded');
})();
