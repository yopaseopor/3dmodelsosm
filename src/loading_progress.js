// ---------------------------------------------------------------------------
// loading_progress.js — the panel shown while the 3D scene is being built
// ---------------------------------------------------------------------------
// Why this exists: entering 3D used to look like the browser had hung. The
// model renderer used to build the entire scene inside one tick, so the tab
// stopped painting while every glTF was fetched, decoded and uploaded, and
// there was nothing on screen to say what was happening. The renderer now
// streams the work across frames (see model_renderer pumpQueue) — this panel
// is the other half of that change: it says how far along we are, how long is
// left, and how much has actually come down the wire.
//
// It is deliberately a corner panel, not a full-screen blocker: the 2D map
// underneath stays live and interactive while the 3D scene is assembled, so a
// slow load never becomes an unusable page.
//
// Progress is a blend of three independent things, because none of them alone
// describes "is the 3D scene ready":
//   * placement  — features actually turned into primitives (the model queue)
//   * terrain    — Cesium's own tile load progress for the DEM/imagery
//   * bytes      — the Resource Timing API, i.e. what is really still in flight
//
// window.loadingProgress is the public surface:
//   begin(opts)  show the panel, start the timers
//   step(n, done, total)   called by the renderer's per-frame pump
//   drained()    the placement queue is empty
//   terrain(queued, processing, ready)  Cesium tileLoadProgressEvent
//   finish()     hide the panel (fade)
//   fail(msg)    something went wrong; show it instead of an eternal spinner

(function () {
    'use strict';

    /** Extensions worth counting as "the 3D payload". */
    var ASSET_RE = /\.(glb|gltf|bin|basis|ktx2|png|jpe?g|webp|tiff?|terrain|dds|json)(?:$|\?)/i;
    /** Terrain tile payloads are usually json/tiff/binary without an extension. */
    var TERRAIN_HINT = /terrain|tile|swisstopo|mapterhorn|copernicus|dem/i;

    var state = {
        active: false,
        title: 'Building 3D scene',
        startedAt: 0,
        // Smoothed throughput (items/second). A single item can take a long
        // time (a big glTF decode), so a raw last-item delta makes the ETA
        // jump around uselessly; an EWMA over ~1s reads much better.
        rate: 0,
        lastTickAt: 0,
        placed: 0,
        placementTotal: 0,
        drained: false,
        terrain: { queued: 0, processing: 0, ready: 0, valid: false },
        // A second, independent queue (buildings) reports through the same
        // panel: it is separate work with its own total, so it gets its own
        // counters rather than being folded into the model numbers.
        sub: { done: 0, total: 0, label: 'building extrusions' },
        modelsPlaced: null,      // models produced by the finished pass
        revealTimer: null,
        bytesAtStart: 0,
        finishAt: null
    };

    // -------------------------------------------------------------------------
    // Panel DOM (built once, reused)
    // -------------------------------------------------------------------------
    var el = null;

    function buildPanel() {
        if (el) return el;
        var host = document.createElement('div');
        host.id = 'osm3d-loading';
        host.setAttribute('role', 'status');
        host.setAttribute('aria-live', 'polite');
        host.style.cssText = [
            'position:fixed',
            'top:16px',
            'right:16px',
            'z-index:10000',
            'width:264px',
            'padding:12px 14px 11px',
            'border-radius:10px',
            'background:rgba(18,22,28,0.90)',
            'color:#eef2f6',
            'font:13px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
            'box-shadow:0 6px 24px rgba(0,0,0,0.45)',
            'pointer-events:none',
            'transition:opacity .35s ease, transform .35s ease'
        ].join(';');

        host.innerHTML =
            '<div class="lp-title" style="font-weight:600;letter-spacing:.2px"></div>' +
            '<div class="lp-pct" style="display:flex;align-items:baseline;gap:6px;margin-top:6px">' +
                '<span class="lp-pct-value" style="font-size:26px;font-weight:700;line-height:1">0%</span>' +
                '<span class="lp-stage" style="font-size:12px;opacity:.72"></span>' +
            '</div>' +
            '<div class="lp-bar" style="position:relative;height:6px;margin-top:9px;border-radius:3px;background:rgba(255,255,255,.14);overflow:hidden">' +
                '<div class="lp-fill" style="position:absolute;inset:0 auto 0 0;width:0%;border-radius:3px;background:linear-gradient(90deg,#3fa9f5,#5fd0a5);transition:width .25s ease"></div>' +
            '</div>' +
            '<div class="lp-eta" style="margin-top:9px;font-variant-numeric:tabular-nums">Calculating…</div>' +
            '<div class="lp-bytes" style="margin-top:2px;font-size:12px;opacity:.72;font-variant-numeric:tabular-nums"></div>';

        document.body.appendChild(host);
        el = {
            host: host,
            title: host.querySelector('.lp-title'),
            pct: host.querySelector('.lp-pct-value'),
            stage: host.querySelector('.lp-stage'),
            fill: host.querySelector('.lp-fill'),
            eta: host.querySelector('.lp-eta'),
            bytes: host.querySelector('.lp-bytes')
        };
        return el;
    }

    // -------------------------------------------------------------------------
    // Formatting helpers
    // -------------------------------------------------------------------------
    function formatClock(ms) {
        if (!isFinite(ms) || ms < 0) return '—';
        var total = Math.round(ms / 1000);
        var minutes = Math.floor(total / 60);
        var seconds = total % 60;
        if (minutes >= 60) {
            var hours = Math.floor(minutes / 60);
            return hours + 'h ' + (minutes % 60) + 'm';
        }
        return minutes + ':' + (seconds < 10 ? '0' : '') + seconds;   // e.g. 2:05
    }

    function formatBytes(bytes) {
        if (!isFinite(bytes) || bytes <= 0) return '0 B';
        var units = ['B', 'KB', 'MB', 'GB'];
        var i = Math.floor(Math.log(bytes) / Math.log(1024));
        if (i < 0) i = 0;
        if (i >= units.length) i = units.length - 1;
        var value = bytes / Math.pow(1024, i);
        return (i === 0 ? value.toFixed(0) : value.toFixed(1)) + ' ' + units[i];
    }

    /**
     * Bytes actually received for the 3D payload, per the Resource Timing API.
     *
     * This is the honest number: it counts what the network handed over for
     * glTF buffers, textures and terrain tiles, which is what makes the wait
     * feel long. TransferSize is 0 for cache hits, so encodedBodySize is used
     * as a floor — otherwise a warm reload would report 0 B and look broken.
     */
    function assetBytes() {
        var total = 0;
        try {
            var entries = performance.getEntriesByType('resource');
            for (var i = 0; i < entries.length; i++) {
                var entry = entries[i];
                if (!ASSET_RE.test(entry.name) && !TERRAIN_HINT.test(entry.name)) continue;
                // transferSize is the wire size (0 on a cache hit), encodedBodySize
                // is the compressed body. decodedBodySize is the DECOMPRESSED
                // size and would inflate a compressed .glb several times over,
                // so it is deliberately not counted.
                total += Math.max(entry.transferSize || 0, entry.encodedBodySize || 0);
            }
        } catch (e) { /* Resource Timing unavailable */ }
        return total;
    }

    /** JS heap in use, when the browser exposes it (Chrome/Edge do). */
    function heapBytes() {
        try {
            if (performance.memory && performance.memory.usedJSHeapSize) return performance.memory.usedJSHeapSize;
        } catch (e) { /* not available */ }
        return null;
    }

    // -------------------------------------------------------------------------
    // Progress maths
    // -------------------------------------------------------------------------
    /**
     * Blended completion 0..1.
     *
     * Placement dominates (0.65) because that is the work we control, terrain
     * refinement takes 0.25 (it has its own, much longer tail), and bytes are
     * only used as a sanity floor when the queue is already empty: with a
     * one-model query the queue finishes in a frame while a 40 MB DEM is still
     * arriving, and reporting 100% then would be a lie.
     */
    function progressRatio() {
        // Weights are renormalised over the channels that actually have work.
        // A hard-coded "+10% already done" once made the panel open at 30%
        // before a single model was placed.
        var placed = state.drained ? 1
            : (state.placementTotal > 0 ? Math.min(1, state.placed / state.placementTotal) : 0);

        var t = state.terrain;
        var terrain;
        if (t.valid && (t.queued + t.processing) > 0) {
            var pending = t.queued + t.processing;
            var throughput = Math.max(1, t.ready);           // guards divide-by-zero
            terrain = Math.max(0, Math.min(1, 1 - pending / (pending + throughput)));
        } else if (t.valid) {
            terrain = 1;             // nothing queued, nothing processing
        } else {
            terrain = state.drained ? 1 : 0;   // never reported: only trust it once idle
        }

        var ratio = placed * 0.55 + terrain * 0.25;
        var weight = 0.80;
        if (state.sub.total > 0) {
            ratio += Math.min(1, state.sub.done / state.sub.total) * 0.20;
            weight += 0.20;
        }
        return Math.max(0, Math.min(1, ratio / weight));
    }

    function stageLabel() {
        var sub = state.sub;
        if (sub.total > 0 && sub.done < sub.total) return 'building footprints';
        if (!state.drained) return 'placing models';
        var t = state.terrain;
        if (t.valid && (t.queued + t.processing) > 0) return 'loading terrain';
        // Done and settled: say what was built rather than a vague "finishing".
        if (state.modelsPlaced !== null) return state.modelsPlaced + ' models loaded';
        return 'ready';
    }

    /** Seconds left, from the smoothed placement rate (null until we have one). */
    function etaMs() {
        if (state.drained) {
            var t = state.terrain;
            if (t.valid && (t.queued + t.processing) > 0) {
                // Rough, and deliberately vague: terrain refinement is driven by
                // the screen-space error, not by a queue we control.
                return (t.queued + t.processing) * 400;
            }
            return 0;
        }
        if (!state.rate || state.rate <= 0) {
            // No throughput yet. If nothing is left to place, we can still be
            // honest about the terrain tail instead of showing "estimating…" for
            // a queue that is already empty.
            var remaining0 = Math.max(0, state.placementTotal - state.placed);
            if (remaining0 > 0) return null;
            var t0 = state.terrain;
            if (t0.valid && (t0.queued + t0.processing) > 0) return (t0.queued + t0.processing) * 400;
            return 0;
        }
        var remaining = Math.max(0, state.placementTotal - state.placed);
        if (remaining === 0) {
            var t2 = state.terrain;
            if (t2.valid && (t2.queued + t2.processing) > 0) return (t2.queued + t2.processing) * 400;
            return 0;
        }
        return (remaining / state.rate) * 1000;
    }

    function render() {
        if (!el) return;
        var pct = progressRatio();
        el.title.textContent = state.title;
        el.pct.textContent = Math.round(pct * 100) + '%';
        el.stage.textContent = stageLabel();
        el.fill.style.width = (pct * 100).toFixed(1) + '%';

        var eta = etaMs();
        var elapsed = Date.now() - state.startedAt;
        el.eta.textContent = 'elapsed ' + formatClock(elapsed) +
            (state.drained ? '' : (eta === null ? ' · working…' : ' · about ' + formatClock(eta) + ' left'));

        var bytes = assetBytes();
        var heap = heapBytes();
        el.bytes.textContent = formatBytes(bytes) + ' loaded' +
            (heap !== null ? ' · heap ' + formatBytes(heap) : '') +
            (state.placementTotal ? ' · ' + state.placed + '/' + state.placementTotal + ' features' : '') +
            (state.modelsPlaced !== null ? ' · ' + state.modelsPlaced + ' models' : '') +
            (state.sub.total ? ' · ' + state.sub.done + '/' + state.sub.total + ' buildings' : '');
    }

    // -------------------------------------------------------------------------
    // Public surface
    // -------------------------------------------------------------------------
    window.loadingProgress = {
        /**
         * Show the panel. `hardStopMs` is a safety valve: whatever happens,
         * the panel finishes itself after that long so the app can never be
         * left behind an eternal spinner.
         */
        begin: function (opts) {
            opts = opts || {};
            var panel = buildPanel();
            state.active = true;
            state.title = opts.title || 'Building 3D scene';
            state.startedAt = Date.now();
            state.lastTickAt = state.startedAt;
            state.rate = 0;
            state.placed = 0;
            state.placementTotal = 0;
            state.drained = false;
            state.terrain = { queued: 0, processing: 0, ready: 0, valid: false };
            state.sub = { done: 0, total: 0, label: 'building extrusions' };
            state.modelsPlaced = null;
            state.bytesAtStart = assetBytes();
            panel.host.style.opacity = '1';
            panel.host.style.display = 'block';
            this.render();

            var self = this;
            this._timer = setInterval(function () { self.render(); }, 250);

            if (state.revealTimer) clearTimeout(state.revealTimer);
            var hardStop = opts.hardStopMs || 15000;
            state.revealTimer = setTimeout(function () {
                console.warn('⏱️ loadingProgress: hard stop reached, finishing anyway');
                self.finish();
            }, hardStop);
        },

        /**
         * The renderer tells us how many features the sweep is about to walk,
         * BEFORE it walks them, so the percentage is real from the first tick.
         */
        total: function (n) {
            if (isFinite(n) && n >= 0) state.placementTotal = n;
            if (state.active) render();
        },

        /**
         * Final line: the pass is over, this is what it produced. The panel
         * stays up for a moment (index.js closes it) so the user sees the result.
         */
        summary: function (placed) {
            // `placed` is the number of MODELS, not of features: the bar tracks
            // features (state.placed / state.placementTotal), so mixing the two
            // made the counter read "233/1295 placed".
            state.drained = true;
            state.modelsPlaced = isFinite(placed) ? placed : 0;
            state.title = '3D scene ready';
            render();
        },

        /** Called by the renderer's per-frame pump after each feature. */
        step: function (n, done, total) {
            if (!state.active) return;
            var now = Date.now();
            var deltaMs = now - state.lastTickAt;
            state.lastTickAt = now;
            if (deltaMs > 0) {
                var instant = (n || 1) / (deltaMs / 1000);
                state.rate = state.rate > 0 ? (state.rate * 0.7 + instant * 0.3) : instant;
            }
            if (isFinite(done)) state.placed = done;
            if (isFinite(total)) state.placementTotal = total;
        },

        /** The placement queue is empty. */
        drained: function () {
            if (!state.active) return;
            state.drained = true;
            this.render();
        },

        /**
         * The buildings queue reports its own total (it is filled after the
         * panel is already on screen, so there is nothing to count at begin()).
         */
        sub: function (total, done) {
            if (isFinite(total)) state.sub.total = total;
            if (isFinite(done)) state.sub.done = done;
            if (state.active) render();
        },

        /** Cesium tileLoadProgressEvent. */
        terrain: function (queued, processing, ready) {
            state.terrain = { queued: queued, processing: processing, ready: ready, valid: true };
        },

        render: render,

        /** Hide the panel. Safe to call when it was never shown. */
        finish: function () {
            if (this._timer) { clearInterval(this._timer); this._timer = null; }
            if (state.revealTimer) { clearTimeout(state.revealTimer); state.revealTimer = null; }
            state.active = false;
            if (!el) return;
            el.host.style.opacity = '0';
            var host = el.host;
            setTimeout(function () { if (!state.active) host.style.display = 'none'; }, 400);
        },

        /** Never leave the user staring at a bar that will not move. */
        fail: function (message) {
            if (this._timer) { clearInterval(this._timer); this._timer = null; }
            state.active = false;
            var panel = buildPanel();
            panel.host.style.opacity = '1';
            panel.host.style.display = 'block';
            panel.title.textContent = '3D scene could not be completed';
            panel.stage.textContent = '';
            panel.fill.style.width = '100%';
            panel.fill.style.background = '#c0552f';
            panel.eta.textContent = message || 'Unknown error';
            panel.bytes.textContent = '';
        }
    };

    // A 3D session can be torn down at any time; make sure the panel goes with
    // it, otherwise leaving 3D during a load leaves a dead overlay on screen.
    window.addEventListener('ol3dDestroyed', function () {
        if (window.loadingProgress) window.loadingProgress.finish();
    });
})();