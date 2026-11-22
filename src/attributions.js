/**
 * Central attribution control for the 2D and 3D map.
 *
 * The page used to show three independent credit surfaces:
 *   - the default OpenLayers attribution control,
 *   - the 3DMR bar injected by threedmr.js,
 *   - Cesium's credit widget (hidden in index.html).
 *
 * They could overlap each other and the scale line/editor panels, and a credit
 * could disappear just because the map switched mode. This module owns one
 * compact control instead. It reads two complementary scopes:
 *
 *   dynamic — attributions of the visible OpenLayers layers plus credits whose
 *             `active` flag is true (OSM data, 3DMR when enabled, 3D services).
 *   static  — every configured/source attribution and every registered credit,
 *             whether currently active or not.
 *
 * Public API (also useful from the browser console):
 *   window.attributions.get('dynamic'|'static')
 *   window.attributions.registerStatic(id, {title, html, active, order})
 *   window.attributions.setStaticActive(id, active)
 *   window.attributions.removeStatic(id)
 *   window.attributions.refresh()
 *   window.attributions.open() / close() / toggle()
 */
(function () {
    'use strict';

    var MODE_DYNAMIC = 'dynamic';
    var MODE_STATIC = 'static';
    var REFRESH_DELAY_MS = 80;

    var state = {
        map: null,
        mapWatchTimer: 0,
        mapWatchTries: 0,
        mode: MODE_DYNAMIC,
        root: null,
        toggle: null,
        panel: null,
        list: null,
        note: null,
        ticker: null,
        track: null,
        sequence: null,
        tickerVersion: 0,
        modeButtons: [],
        refreshTimer: 0,
        registered: Object.create(null),
        layerSeen: (typeof WeakSet === 'function' ? new WeakSet() : null),
        builtins: [
            {
                id: 'osm',
                title: 'OpenStreetMap data',
                html: '&copy; <a href="https://www.openstreetmap.org/copyright" ' +
                    'target="_blank" rel="noopener">OpenStreetMap</a> contributors',
                active: true,
                order: 0
            },
            {
                id: 'cesium',
                title: '3D engine',
                html: '3D rendering by <a href="https://cesium.com/" target="_blank" ' +
                    'rel="noopener">Cesium</a>',
                active: function () { return is3D(); },
                order: 30
            },
            {
                id: 'mapterhorn',
                title: 'Terrain',
                html: 'Terrain &copy; <a href="https://mapterhorn.com/attribution" ' +
                    'target="_blank" rel="noopener">Mapterhorn</a>',
                active: function () { return isMapterhornActive(); },
                order: 31
            }
        ]
    };

    function is3D() {
        try {
            return !!(window.ol3d && typeof window.ol3d.getEnabled === 'function' &&
                window.ol3d.getEnabled());
        } catch (e) {
            return false;
        }
    }

    function isMapterhornActive() {
        if (!is3D()) return false;
        try {
            var scene = window.ol3d.getCesiumScene && window.ol3d.getCesiumScene();
            var provider = scene && scene.terrainProvider;
            return !!(provider && provider.isMapterhornProvider);
        } catch (e) {
            // If the scene cannot be inspected yet, keep the credit rather than
            // dropping a required terrain attribution.
            return true;
        }
    }

    function normalizeMode(mode) {
        return mode === MODE_STATIC || mode === 'all' ? MODE_STATIC : MODE_DYNAMIC;
    }

    function htmlToText(html) {
        var value = String(html == null ? '' : html);
        if (typeof document !== 'undefined' && document.createElement) {
            var holder = document.createElement('div');
            holder.innerHTML = value;
            return (holder.textContent || holder.innerText || '')
                .replace(/\s+/g, ' ').trim();
        }
        return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function attributionKey(html) {
        var text = htmlToText(html).toLowerCase();
        var compact = text.replace(/\s+/g, ' ').replace(/\s*\.\s*$/, '').trim();
        // Layer sources and registered credits often describe the same provider
        // with slightly different wording. Merge only a credit that consists
        // solely of that provider: a combined source attribution (for example
        // "© OpenStreetMap contributors © MapTiler") must keep all of its parts.
        if (/^(?:©\s*)?openstreetmap(?:\s+contributors?)?$/.test(compact)) {
            return 'openstreetmap';
        }
        if (/^(?:models\s+©\s*)?3d model repository(?:\s+contributors)?(?:\s*\(cc0\s*\/\s*cc by 4\.0\))?$/.test(compact)) {
            return '3d-model-repository';
        }
        return text || String(html).replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function addUnique(list, value) {
        if (!value) return;
        var key = String(value).toLowerCase();
        for (var i = 0; i < list.length; i++) {
            if (String(list[i]).toLowerCase() === key) return;
        }
        list.push(String(value));
    }

    function entryIsActive(entry) {
        if (typeof entry.active === 'function') {
            try { return !!entry.active(); } catch (e) { return false; }
        }
        return entry.active !== false;
    }

    function buildFrameState(map) {
        var view = map.getView ? map.getView() : null;
        var size = map.getSize ? map.getSize() : null;
        var frameState = {
            pixelRatio: window.devicePixelRatio || 1,
            time: Date.now()
        };
        if (view) {
            try {
                frameState.viewState = {
                    center: view.getCenter(),
                    resolution: view.getResolution(),
                    rotation: view.getRotation(),
                    zoom: view.getZoom()
                };
            } catch (e) { /* partial map state */ }
            if (size && view.calculateExtent) {
                try { frameState.extent = view.calculateExtent(size); } catch (e) { /* no extent yet */ }
            }
        }
        return frameState;
    }

    function collect(mode) {
        var includeInactive = normalizeMode(mode) === MODE_STATIC;
        var byKey = Object.create(null);
        // The API can be called before the polling hook has attached, so fall
        // back to the already-created global map for an immediate read.
        var map = state.map || (typeof window !== 'undefined' ? window.map : null);
        var frameState = map ? buildFrameState(map) : {};

        function add(html, title, active, order) {
            if (!html || !String(html).trim()) return;
            if (!includeInactive && !active) return;

            var key = attributionKey(html);
            var entry = byKey[key];
            if (!entry) {
                entry = {
                    key: key,
                    html: String(html),
                    titles: [],
                    active: false,
                    order: typeof order === 'number' ? order : 20
                };
                byKey[key] = entry;
            }
            entry.active = entry.active || !!active;
            if (typeof order === 'number' && order < entry.order) entry.order = order;
            addUnique(entry.titles, title);
        }

        // Fixed credits always in the catalogue; only active ones appear in the
        // dynamic scope.
        state.builtins.forEach(function (credit) {
            add(credit.html, credit.title, entryIsActive(credit), credit.order);
        });

        // Credits registered by feature modules (3DMR, future services).
        Object.keys(state.registered).forEach(function (id) {
            var credit = state.registered[id];
            if (!credit) return;
            add(credit.html, credit.title || id, entryIsActive(credit), credit.order);
        });

        // OpenLayers sources: visible layers in dynamic mode, every configured
        // source in the static catalogue.
        if (map && typeof ol !== 'undefined' && map.getLayers) {
            function visitCollection(collection, parentVisible) {
                if (!collection || typeof collection.forEach !== 'function') return;
                collection.forEach(function (layer) {
                    if (!layer) return;
                    var layerVisible = parentVisible && layer.getVisible() !== false;
                    if (typeof layer.getLayers === 'function') {
                        visitCollection(layer.getLayers(), layerVisible);
                        return;
                    }
                    if (!includeInactive && !layerVisible) return;

                    var source = null;
                    try {
                        source = typeof layer.getSource === 'function' ? layer.getSource() : null;
                    } catch (e) { /* source not ready */ }
                    if (!source || typeof source.getAttributions !== 'function') return;

                    var attributions = null;
                    try { attributions = source.getAttributions(); } catch (e) { return; }
                    if (typeof attributions === 'function') {
                        try { attributions = attributions(frameState); } catch (e) { return; }
                    }
                    if (!attributions) return;

                    var title = '';
                    try { title = layer.get('title') || ''; } catch (e) { /* no title */ }
                    var list = Array.isArray(attributions) ? attributions : [attributions];
                    for (var i = 0; i < list.length; i++) {
                        add(list[i], title, layerVisible, 10);
                    }
                });
            }
            visitCollection(map.getLayers(), true);
        }

        var entries = Object.keys(byKey).map(function (key) {
            var entry = byKey[key];
            return {
                html: entry.html,
                text: htmlToText(entry.html),
                titles: entry.titles.slice(),
                title: formatTitles(entry.titles),
                active: entry.active,
                order: entry.order
            };
        });

        entries.sort(function (a, b) {
            if (a.order !== b.order) return a.order - b.order;
            return a.text.localeCompare(b.text);
        });
        return entries;
    }

    function formatTitles(titles) {
        if (!titles || !titles.length) return '';
        var shown = titles.slice(0, 3);
        var text = shown.join(' · ');
        if (titles.length > shown.length) text += ' +' + (titles.length - shown.length);
        return text;
    }

    function ensureUI() {
        if (state.root && document.body.contains(state.root)) return state.root;
        if (!document.body) return null;

        var root = document.createElement('div');
        root.id = 'map-attributions';
        root.className = 'map-attributions';
        root.innerHTML =
            '<div class="map-attributions-ticker" role="region" aria-label="Map attribution">' +
                '<div class="map-attributions-track">' +
                    '<span class="map-attributions-sequence"></span>' +
                '</div>' +
            '</div>' +
            '<button type="button" id="map-attributions-toggle" class="map-attributions-details" ' +
                'aria-expanded="false" aria-controls="map-attributions-panel" ' +
                'title="Attribution details" aria-label="Open attribution details">' +
                '<span aria-hidden="true">i</span>' +
            '</button>' +
            '<div id="map-attributions-panel" class="map-attributions-panel" ' +
                'role="region" aria-label="Attribution and credits" hidden>' +
                '<div class="map-attributions-head">' +
                    '<strong>Attribution &amp; credits</strong>' +
                    '<button type="button" class="map-attributions-close" ' +
                        'aria-label="Close attribution">&times;</button>' +
                '</div>' +
                '<div class="map-attributions-modes" role="group" aria-label="Attribution scope">' +
                    '<button type="button" data-attribution-mode="dynamic" ' +
                        'aria-pressed="true">Current view</button>' +
                    '<button type="button" data-attribution-mode="static" ' +
                        'aria-pressed="false">All credits</button>' +
                '</div>' +
                '<div class="map-attributions-list" role="list"></div>' +
                '<div class="map-attributions-note"></div>' +
            '</div>';

        document.body.appendChild(root);
        document.body.classList.add('attributions-ready');

        state.root = root;
        state.toggle = root.querySelector('#map-attributions-toggle');
        state.panel = root.querySelector('#map-attributions-panel');
        state.list = root.querySelector('.map-attributions-list');
        state.note = root.querySelector('.map-attributions-note');
        state.ticker = root.querySelector('.map-attributions-ticker');
        state.track = root.querySelector('.map-attributions-track');
        state.sequence = root.querySelector('.map-attributions-sequence');

        state.toggle.addEventListener('click', function () {
            if (state.panel.hidden) openPanel(); else closePanel();
        });
        root.querySelector('.map-attributions-close').addEventListener('click', closePanel);

        var buttons = root.querySelectorAll('[data-attribution-mode]');
        for (var i = 0; i < buttons.length; i++) {
            state.modeButtons.push(buttons[i]);
            buttons[i].addEventListener('click', function () {
                setMode(this.getAttribute('data-attribution-mode'));
            });
        }

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && state.panel && !state.panel.hidden) closePanel();
        });
        document.addEventListener('pointerdown', function (event) {
            if (!state.panel || state.panel.hidden) return;
            if (state.root && !state.root.contains(event.target)) closePanel();
        }, true);

        setMode(state.mode);
        return root;
    }

    function renderList() {
        if (!state.list) return;
        var entries = collect(state.mode);
        state.list.innerHTML = '';

        if (!entries.length) {
            var empty = document.createElement('div');
            empty.className = 'map-attributions-empty';
            empty.textContent = state.mode === MODE_STATIC
                ? 'No credits are configured.'
                : 'No credits for the current view.';
            state.list.appendChild(empty);
        } else {
            entries.forEach(function (entry) {
                var item = document.createElement('div');
                item.className = 'map-attributions-item';
                item.setAttribute('role', 'listitem');
                if (!entry.active) item.className += ' map-attributions-item-inactive';

                if (entry.title) {
                    var source = document.createElement('div');
                    source.className = 'map-attributions-source';
                    source.textContent = entry.title;
                    item.appendChild(source);
                }

                var text = document.createElement('div');
                text.className = 'map-attributions-text';
                text.innerHTML = entry.html;
                item.appendChild(text);
                state.list.appendChild(item);
            });
        }

        if (state.note) {
            state.note.textContent = state.mode === MODE_STATIC
                ? 'Every credit configured by the map and its data services.'
                : 'Credits for the visible layers and active 3D services.';
        }
        updateModeButtons();
    }

    function updateModeButtons() {
        state.modeButtons.forEach(function (button) {
            var active = button.getAttribute('data-attribution-mode') === state.mode;
            button.setAttribute('aria-pressed', String(active));
            button.classList.toggle('active', active);
        });
    }

    function renderTicker() {
        if (!state.sequence || !state.track || !state.ticker) return;

        state.tickerVersion += 1;
        var version = state.tickerVersion;

        var clones = state.track.querySelectorAll('.map-attributions-sequence-clone');
        for (var c = clones.length - 1; c >= 0; c--) {
            if (clones[c].parentNode) clones[c].parentNode.removeChild(clones[c]);
        }
        state.root.classList.remove('map-attributions-scrolling');
        state.track.style.animationDuration = '';
        state.sequence.textContent = '';

        var entries = collect(state.mode);
        if (!entries.length) {
            state.sequence.textContent = state.mode === MODE_STATIC
                ? 'No attribution data is configured.'
                : 'No attribution is available for the current view.';
            return;
        }

        entries.forEach(function (entry, index) {
            var item = document.createElement('span');
            item.className = 'map-attributions-credit';
            item.innerHTML = entry.html;
            state.sequence.appendChild(item);

            if (index < entries.length - 1) {
                var separator = document.createElement('span');
                separator.className = 'map-attributions-separator';
                separator.setAttribute('aria-hidden', 'true');
                separator.textContent = '·';
                state.sequence.appendChild(separator);
            }
        });

        // Only duplicate the sequence when the text actually overflows. This
        // keeps short attributions compact and gives long WMS/3D credit lists
        // a seamless marquee instead of truncating them.
        var requestFrame = typeof window.requestAnimationFrame === 'function'
            ? window.requestAnimationFrame.bind(window)
            : function (callback) { return setTimeout(callback, 16); };
        requestFrame(function () {
            if (version !== state.tickerVersion || !state.ticker || !state.sequence) return;
            var available = state.ticker.clientWidth;
            if (!available || state.sequence.scrollWidth <= available + 1) return;

            var clone = state.sequence.cloneNode(true);
            clone.classList.add('map-attributions-sequence-clone');
            clone.setAttribute('aria-hidden', 'true');
            state.track.appendChild(clone);

            // Keep links mouse-clickable in BOTH copies. The duplicate is
            // hidden from assistive tech and removed from keyboard order, but
            // inert would also block the click when the second copy is the one
            // currently visible in the marquee.
            var links = clone.querySelectorAll('a');
            for (var i = 0; i < links.length; i++) links[i].setAttribute('tabindex', '-1');

            state.root.classList.add('map-attributions-scrolling');
            state.track.style.animationDuration =
                Math.max(18, Math.round(state.sequence.scrollWidth / 45)) + 's';
        });
    }

    function refresh() {
        if (state.refreshTimer) {
            clearTimeout(state.refreshTimer);
            state.refreshTimer = 0;
        }
        if (!state.root) return;

        renderTicker();
        if (!state.panel.hidden) renderList();
        else updateModeButtons();
    }

    function scheduleRefresh() {
        if (state.refreshTimer) return;
        state.refreshTimer = setTimeout(refresh, REFRESH_DELAY_MS);
    }

    function setMode(mode) {
        state.mode = normalizeMode(mode);
        updateModeButtons();
        renderTicker();
        if (state.panel && !state.panel.hidden) renderList();
    }

    function openPanel() {
        if (!state.panel) return;
        state.panel.hidden = false;
        state.toggle.setAttribute('aria-expanded', 'true');
        state.root.classList.add('open');
        renderList();
    }

    function closePanel() {
        if (!state.panel) return;
        state.panel.hidden = true;
        state.toggle.setAttribute('aria-expanded', 'false');
        state.root.classList.remove('open');
    }

    function togglePanel() {
        if (state.panel && state.panel.hidden) openPanel(); else closePanel();
    }

    function registerStatic(id, options) {
        if (!id) return;
        if (typeof options === 'string') options = { html: options };
        options = options || {};
        state.registered[String(id)] = {
            id: String(id),
            title: options.title || '',
            html: options.html || '',
            active: options.active === undefined ? true : options.active,
            order: typeof options.order === 'number' ? options.order : 20
        };
        scheduleRefresh();
    }

    function setStaticActive(id, active) {
        var credit = state.registered[String(id)];
        if (!credit) return;
        credit.active = !!active;
        scheduleRefresh();
    }

    function removeStatic(id) {
        if (!state.registered[String(id)]) return;
        delete state.registered[String(id)];
        scheduleRefresh();
    }

    function hookLayers() {
        if (!state.map || !state.map.getLayers) return;

        function visit(layer) {
            if (!layer) return;
            if (state.layerSeen && state.layerSeen.has(layer)) return;
            if (state.layerSeen) state.layerSeen.add(layer);

            if (typeof layer.on === 'function') {
                layer.on('change:visible', scheduleRefresh);
            }
            if (typeof layer.getLayers === 'function') {
                var children = layer.getLayers();
                if (children && typeof children.on === 'function') {
                    children.on('change:length', function () {
                        hookLayers();
                        scheduleRefresh();
                    });
                }
                if (children && typeof children.forEach === 'function') children.forEach(visit);
            }
        }

        state.map.getLayers().forEach(visit);
    }

    function hookMap(map) {
        if (!map || state.map === map) return;
        state.map = map;

        if (typeof map.on === 'function') {
            map.on('moveend', scheduleRefresh);
            map.on('change:size', scheduleRefresh);
        }
        if (map.getLayers && typeof map.getLayers().on === 'function') {
            map.getLayers().on('change:length', function () {
                hookLayers();
                scheduleRefresh();
            });
        }
        hookLayers();
        refresh();
    }

    function watchForMap() {
        clearInterval(state.mapWatchTimer);
        state.mapWatchTimer = setInterval(function () {
            if (window.map) {
                clearInterval(state.mapWatchTimer);
                state.mapWatchTimer = 0;
                hookMap(window.map);
            } else if (++state.mapWatchTries > 300) {
                clearInterval(state.mapWatchTimer);
                state.mapWatchTimer = 0;
            }
        }, 100);
    }

    function boot() {
        if (!ensureUI()) {
            document.addEventListener('DOMContentLoaded', boot, { once: true });
            return;
        }
        window.addEventListener('ol3dInitialized', scheduleRefresh);
        window.addEventListener('ol3dDestroyed', scheduleRefresh);
        window.addEventListener('mapterhornFlatGroundChanged', scheduleRefresh);
        window.addEventListener('attributionsChanged', scheduleRefresh);
        window.addEventListener('resize', scheduleRefresh);
        window.addEventListener('load', scheduleRefresh);
        watchForMap();
        scheduleRefresh();
    }

    window.attributions = {
        get: function (mode) { return collect(mode); },
        getDynamic: function () { return collect(MODE_DYNAMIC); },
        getStatic: function () { return collect(MODE_STATIC); },
        registerStatic: registerStatic,
        setStaticActive: setStaticActive,
        removeStatic: removeStatic,
        refresh: refresh,
        open: openPanel,
        close: closePanel,
        toggle: togglePanel
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }
})();
