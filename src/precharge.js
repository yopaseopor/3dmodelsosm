// ---------------------------------------------------------------------------
// precharge.js — warm up big GeoJSON before the user asks for it
// ---------------------------------------------------------------------------
// Why this exists
// ---------------
// Turning on a big overlay used to be one uninterruptible lump of work: fetch
// the file, JSON.parse 4 MB of text, hand it to OpenLayers, then place models
// for every feature. Nothing of that was visible, and the first two steps
// happen while the user is already staring at a spinner wondering whether
// anything is happening at all.
//
// "Precharge" is just moving those steps EARLIER. The moment the overlay list
// exists we ask the server how big each file is (a HEAD request, no body), and
// anything above the size threshold is fetched one file at a time while the
// user is still choosing. The response is retained as a size-bounded Blob;
// parsing waits until selection and runs in a Worker.
//
// When the overlay is finally switched on, `take(url)` hands the loader that
// Blob, avoiding another download without retaining a large parsed object graph.
//
// It is deliberately quiet:
//   * small files are never precharged (below the threshold, fetching on
//     click is faster than probing in advance);
//   * only one file is charged at a time, with a gap between them, so this
//     never competes with what the user is actually doing;
//   * the panel only appears once something big is really being downloaded,
//     and it is collapsible (and collapsed state is remembered).
//
// window.precharge is the public surface:
//   warm(url, label)          probe one file and charge it if it is big
//   warmAll(overlays)         probe every overlay that has a .geojson
//   take(url)                 the cached GeoJSON Blob, or null if not ready
//   info(url)                 {state, bytes, features, mix} for a file
//   forget(url)               drop cached data (frees the memory)
// ---------------------------------------------------------------------------
(function () {
    'use strict';

    var deviceMemory = Number(window.navigator && window.navigator.deviceMemory) || 4;
    /** Below this, charging in advance costs more than it saves. */
    var BIG_BYTES = 400 * 1024;
    /** Never parse a background file whose decoded payload exceeds this size. */
    var MAX_PRECHARGE_BYTES = deviceMemory <= 2 ? 6 * 1024 * 1024 :
        (deviceMemory <= 4 ? 12 * 1024 * 1024 : 20 * 1024 * 1024);
    /** Bound the total retained response bodies in memory. */
    var MAX_CACHED_HEAP_BYTES = deviceMemory <= 2 ? 20 * 1024 * 1024 :
        (deviceMemory <= 4 ? 48 * 1024 * 1024 : 96 * 1024 * 1024);
    /** One file at a time, and a pause between files: politeness, not speed. */
    var CHARGE_GAP_MS = 250;
    /** How long to wait between the size probes of the overlay list. */
    var PROBE_GAP_MS = 200;
    /** Keep at most this many parsed files; the biggest ones are kept longest. */
    var MAX_CACHED = 3;
    var STORAGE_KEY = 'osm3dPrechargeCollapsed';

    var cache = Object.create(null);     // url -> entry
    var charging = false;
    var pendingQueue = [];
    var panelState = { collapsed: false, dismissed: false };

    function debugEnabled() {
        // window.globalDebugConfig, NOT window.debugConfig: nothing ever
        // publishes the latter, so ?debug=precharge logged nothing at all.
        var cfg = window.globalDebugConfig;
        return !!(cfg && cfg.precharge && cfg.precharge.enabled);
    }

    function debug() {
        if (!debugEnabled()) return;
        var args = ['🔌 precharge'].concat(Array.prototype.slice.call(arguments));
        console.log.apply(console, args);
    }

    // -------------------------------------------------------------------------
    // Panel (self-contained, collapsible)
    // -------------------------------------------------------------------------
    var el = null;

    function readCollapsed() {
        try { return window.localStorage.getItem(STORAGE_KEY) === '1'; } catch (e) { return false; }
    }

    function writeCollapsed(value) {
        panelState.collapsed = !!value;
        try { window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0'); } catch (e) { /* private mode */ }
    }

    function buildPanel() {
        if (el) return el;
        var host = document.createElement('div');
        host.id = 'osm3d-precharge';
        host.setAttribute('role', 'status');
        host.setAttribute('aria-live', 'polite');
        host.style.cssText = [
            'position:fixed',
            'bottom:16px',
            'left:16px',
            'z-index:10000',
            'width:300px',
            'padding:12px 14px 11px',
            'border-radius:10px',
            'background:rgba(18,22,28,0.90)',
            'color:#eef2f6',
            'font:13px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
            'box-shadow:0 6px 24px rgba(0,0,0,0.45)',
            // The map underneath must stay clickable, so the panel itself does
            // not take pointer events; only the header does.
            'pointer-events:none',
            'transition:opacity .35s ease'
        ].join(';');

        host.innerHTML =
            '<div class="pc-head" style="display:flex;align-items:center;gap:8px;pointer-events:auto">' +
                '<div class="pc-title" style="flex:1;font-weight:600">Precharging GeoJSON</div>' +
                '<button class="pc-toggle" type="button" ' +
                    'style="pointer-events:auto;cursor:pointer;width:22px;height:22px;line-height:1;' +
                    'border:1px solid rgba(255,255,255,.28);border-radius:5px;background:transparent;' +
                    'color:#eef2f6;font:13px/1 system-ui,sans-serif;padding:0">−</button>' +
                '<button class="pc-close" type="button" aria-label="Hide precharge statistics" title="Hide precharge statistics" ' +
                    'style="pointer-events:auto;cursor:pointer;width:22px;height:22px;line-height:1;' +
                    'border:1px solid rgba(255,255,255,.28);border-radius:5px;background:transparent;' +
                    'color:#eef2f6;font:16px/1 system-ui,sans-serif;padding:0">×</button>' +
            '</div>' +
            '<div class="pc-body">' +
                '<div class="pc-list"></div>' +
            '</div>';

        document.body.appendChild(host);
        var reopen = document.createElement('button');
        reopen.type = 'button';
        reopen.textContent = 'GeoJSON preload stats';
        reopen.setAttribute('aria-label', 'Show precharge statistics');
        reopen.style.cssText = [
            'position:fixed',
            'bottom:16px',
            'left:16px',
            'z-index:10000',
            'display:none',
            'padding:7px 10px',
            'border:1px solid rgba(255,255,255,.28)',
            'border-radius:8px',
            'background:rgba(18,22,28,0.92)',
            'color:#eef2f6',
            'font:12px system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
            'box-shadow:0 6px 24px rgba(0,0,0,0.45)',
            'cursor:pointer'
        ].join(';');
        document.body.appendChild(reopen);

        var toggle = host.querySelector('.pc-toggle');
        toggle.addEventListener('click', function () {
            writeCollapsed(!panelState.collapsed);
            render();
        });
        host.querySelector('.pc-close').addEventListener('click', function () {
            panelState.dismissed = true;
            render();
        });
        reopen.addEventListener('click', function () {
            panelState.dismissed = false;
            render();
        });

        el = {
            host: host,
            reopen: reopen,
            toggle: toggle,
            title: host.querySelector('.pc-title'),
            body: host.querySelector('.pc-body'),
            list: host.querySelector('.pc-list')
        };
        panelState.collapsed = readCollapsed();
        return el;
    }

    function formatBytes(bytes) {
        if (!isFinite(bytes) || bytes <= 0) return '—';
        var units = ['B', 'KB', 'MB', 'GB'];
        var i = Math.floor(Math.log(bytes) / Math.log(1024));
        if (i < 0) i = 0;
        if (i >= units.length) i = units.length - 1;
        var value = bytes / Math.pow(1024, i);
        return (i === 0 ? value.toFixed(0) : value.toFixed(1)) + ' ' + units[i];
    }

    function formatDuration(ms) {
        var seconds = Math.max(0, Math.round(ms / 1000));
        var minutes = Math.floor(seconds / 60);
        seconds %= 60;
        return minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
    }

    function nameOf(url) {
        var clean = String(url).split('?')[0].split('/');
        return clean[clean.length - 1] || String(url);
    }

    /** Rows worth showing: anything being probed, charged, ready or in use. */
    function visibleEntries() {
        var out = [];
        for (var url in cache) {
            var entry = cache[url];
            if (entry.state === 'probing' || entry.state === 'queued' ||
                entry.state === 'loading' || entry.state === 'ready' ||
                entry.state === 'taken' || entry.state === 'failed' ||
                entry.state === 'skipped') {
                out.push(entry);
            }
        }
        out.sort(function (a, b) { return (b.bytes || 0) - (a.bytes || 0); });
        return out.slice(0, 4);
    }

    function render() {
        if (!el) return;
        var entries = visibleEntries();
        var ready = 0, busy = 0, loadedBytes = 0, estimatedHeapBytes = 0;
        for (var cacheUrl in cache) estimatedHeapBytes += cache[cacheUrl].cacheCost || 0;
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            loadedBytes += entry.received || 0;
            // A charged file that the map has already taken still counts as
            // ready: it is exactly the state the panel is telling the user
            // about, and it is the state that lasts.
            if (entry.state === 'ready' || entry.state === 'taken') ready++;
            else if (entry.state !== 'failed') busy++;
        }

        // Nothing left to say: get out of the way entirely.
        if (!entries.length) {
            el.host.style.opacity = '0';
            el.host.style.display = 'none';
            el.reopen.style.display = 'none';
            return;
        }
        if (panelState.dismissed) {
            el.host.style.display = 'none';
            el.reopen.style.display = 'block';
            return;
        }
        el.host.style.display = 'block';
        el.reopen.style.display = 'none';
        el.host.style.opacity = '1';
        el.body.style.display = panelState.collapsed ? 'none' : 'block';
        el.toggle.textContent = panelState.collapsed ? '+' : '−';
        el.toggle.setAttribute('aria-expanded', panelState.collapsed ? 'false' : 'true');
        el.toggle.title = panelState.collapsed ? 'Expand precharge details' : 'Collapse precharge details';

        var title = busy > 0
            ? 'Precharging GeoJSON (' + busy + ' file' + (busy > 1 ? 's' : '') + ')'
            : (ready + ' GeoJSON file' + (ready > 1 ? 's' : '') + ' ready before use');
        el.title.textContent = title;

        var html = '';
        for (var j = 0; j < entries.length; j++) {
            var e = entries[j];
            var bits = [];
            if (e.state === 'ready' || e.state === 'taken') {
                bits.push(formatBytes(e.bytes));
                if (e.features) bits.push(e.features.toLocaleString() + ' features');
                if (e.mix) bits.push(e.mix);
                if (e.elapsedMs) bits.push('ready in ' + formatDuration(e.elapsedMs));
                if (!e.features) bits.push('features parsed on selection');
                bits.push('ready');
            } else if (e.state === 'failed') {
                bits.push('could not be precharged');
            } else if (e.state === 'skipped') {
                bits.push('too large to cache in memory; will load when selected');
            } else if (e.state === 'probing') {
                bits.push('checking size…');
            } else if (e.state === 'queued') {
                bits.push('queued');
            } else {
                var downloading = formatBytes(e.received || 0) +
                    (e.bytes ? ' / ' + formatBytes(e.bytes) : ' · size unknown') + ' downloading';
                if (e.rate > 0) {
                    if (e.bytes > e.received) {
                        downloading += ' · about ' + formatDuration((e.bytes - e.received) / e.rate * 1000) + ' left';
                    } else {
                        downloading += ' · ' + formatBytes(e.rate) + '/s';
                    }
                }
                bits.push(downloading);
            }
            html += '<div style="margin-top:4px">' +
                '<div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
                    (e.label || nameOf(e.url)) + '</div>' +
                '<div style="font-size:12px;opacity:.72">' + bits.join(' · ') + '</div>' +
            '</div>';
        }
        if (loadedBytes > 0) {
            html += '<div style="margin-top:6px;font-size:12px;opacity:.72">' +
                formatBytes(loadedBytes) + ' downloaded · about ' + formatBytes(estimatedHeapBytes) +
                ' cached in memory</div>';
        }
        el.list.innerHTML = html;
    }

    function show() {
        buildPanel();
        render();
    }

    // -------------------------------------------------------------------------
    // Charging
    // -------------------------------------------------------------------------
    function entryFor(url) {
        if (!cache[url]) {
            cache[url] = {
                url: url, label: '', state: 'idle', bytes: 0, received: 0, rate: 0,
                features: 0, mix: null, data: null, error: null,
                cacheCost: 0, lastUsed: 0, startedAt: 0, elapsedMs: 0
            };
        }
        return cache[url];
    }

    /**
     * Read the body while counting bytes, so the panel can say "3.1 / 4.2 MB"
     * instead of an indeterminate spinner. Falls back to a plain text() read
     * where streams are not available.
     */
    function sizeLimitError() {
        var error = new Error('Precharge size limit exceeded');
        error.prechargeSizeLimit = true;
        return error;
    }

    function readWithProgress(response, onBytes) {
        if (!response.body || typeof response.body.getReader !== 'function') {
            return response.blob().then(function (blob) {
                if (blob.size > MAX_PRECHARGE_BYTES) throw sizeLimitError();
                onBytes(blob.size);
                return blob;
            });
        }
        var reader = response.body.getReader();
        var chunks = [];
        var received = 0;
        function pump() {
            return reader.read().then(function (result) {
                if (result.done) {
                    onBytes(received);
                    var blob = new Blob(chunks, { type: 'application/geo+json' });
                    chunks.length = 0;
                    return blob;
                }
                received += result.value.byteLength;
                if (received > MAX_PRECHARGE_BYTES) {
                    return reader.cancel().then(function () { throw sizeLimitError(); }, function () { throw sizeLimitError(); });
                }
                chunks.push(result.value);
                onBytes(received);
                return pump();
            });
        }
        return pump();
    }

    function evictOldCaches() {
        var ready = [];
        var retainedBytes = 0;
        var url;
        for (url in cache) {
            if ((cache[url].state === 'ready' || cache[url].state === 'taken') && cache[url].data) {
                ready.push(url);
                retainedBytes += cache[url].cacheCost || 0;
            }
        }
        // Keep recently used entries and evict until both limits are satisfied.
        ready.sort(function (a, b) { return cache[a].lastUsed - cache[b].lastUsed; });
        while (ready.length > MAX_CACHED || retainedBytes > MAX_CACHED_HEAP_BYTES) {
            var victim = ready.shift();
            retainedBytes -= cache[victim].cacheCost || 0;
            cache[victim].data = null;      // release the cached response body
            cache[victim].cacheCost = 0;
            cache[victim].state = 'idle';
            debug('evicted', nameOf(victim));
        }
    }

    function pumpQueue() {
        if (charging || !pendingQueue.length) return;
        charging = true;
        var entry = pendingQueue.shift();
        entry.state = 'loading';
        entry.received = 0;
        entry.rate = 0;
        entry.startedAt = Date.now();
        show();

        fetch(entry.url)
            .then(function (response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                // Content-Length is unknown for a chunked/compressed response;
                // the streamed count then becomes the size.
                entry.bytes = Number(response.headers.get('content-length')) || 0;
                if (entry.bytes > MAX_PRECHARGE_BYTES) {
                    if (response.body && response.body.cancel) {
                        response.body.cancel().catch(function (error) {
                            debug('could not cancel oversized preload', error && error.message);
                        });
                    }
                    throw sizeLimitError();
                }
                return readWithProgress(response, function (received) {
                    entry.received = received;
                    entry.rate = received * 1000 / Math.max(1, Date.now() - entry.startedAt);
                    render();
                });
            })
            .then(function (blob) {
                entry.bytes = entry.received || entry.bytes || blob.size;
                entry.data = blob;
                entry.features = 0;
                entry.mix = null;
                entry.state = 'ready';
                entry.received = entry.bytes;
                entry.cacheCost = entry.bytes;
                entry.lastUsed = Date.now();
                entry.elapsedMs = Date.now() - entry.startedAt;
                debug('ready', entry.label, formatBytes(entry.bytes), entry.features + ' features');
                evictOldCaches();
                render();
                // Tell anyone who wants to know (a panel, a log, a test).
                window.dispatchEvent(new CustomEvent('osm3d:precharged', {
                    detail: { url: entry.url, bytes: entry.bytes, features: entry.features }
                }));
            })
            .catch(function (error) {
                // A failed precharge is not a failure of the app: the loader
                // will simply fetch the file itself when it is needed.
                entry.state = error && error.prechargeSizeLimit ? 'skipped' : 'failed';
                entry.error = error;
                if (entry.state === 'failed') debug('failed', entry.label, error && error.message);
                render();
            })
            .then(function () {
                charging = false;
                setTimeout(pumpQueue, CHARGE_GAP_MS);
            });
    }

    function enqueue(entry) {
        if (entry.state === 'queued' || entry.state === 'loading') return;
        entry.state = 'queued';
        pendingQueue.push(entry);
        show();
        pumpQueue();
    }

    // -------------------------------------------------------------------------
    // Public surface
    // -------------------------------------------------------------------------
    window.precharge = {
        /**
         * Probe one file and charge it if it turns out to be big.
         *
         * The probe is a HEAD request: no body, no cost. Files below the
         * threshold are left alone (`state: 'small'`) because fetching them
         * in advance would be slower than fetching them on click.
         */
        warm: function (url, label) {
            if (!url) return null;
            var entry = entryFor(url);
            if (label) entry.label = label;
            if (entry.state !== 'idle' && entry.state !== 'small' && entry.state !== 'failed') return entry;
            entry.state = 'probing';
            entry.error = null;
            return fetch(url, { method: 'HEAD' })
                .then(function (response) {
                    var length = Number(response.headers.get('content-length')) || 0;
                    entry.bytes = length;
                    if (length > 0 && length < BIG_BYTES) {
                        entry.state = 'small';
                        return entry;
                    }
                    if (length > MAX_PRECHARGE_BYTES) {
                        entry.state = 'skipped';
                        render();
                        return entry;
                    }
                    // No length at all (compressed/chunked): charge it anyway,
                    // because "unknown" on a GeoJSON overlay means "possibly
                    // enormous", which is the case we are protecting against.
                    enqueue(entry);
                    return entry;
                })
                .catch(function () {
                    // Servers are allowed to refuse HEAD. That is not a reason
                    // to skip the precharge.
                    debug('HEAD failed for', entry.label || url);
                    enqueue(entry);
                    return entry;
                });
        },

        /** Probe every overlay that carries a .geojson, one probe at a time. */
        warmAll: function (overlays) {
            var list = (overlays || []).filter(function (overlay) {
                return overlay && overlay.geojson;
            });
            if (!list.length) return;
            var i = 0;
            function next() {
                if (i >= list.length) return;
                var overlay = list[i++];
                window.precharge.warm(overlay.geojson, overlay.title);
                setTimeout(next, PROBE_GAP_MS);
            }
            setTimeout(next, PROBE_GAP_MS);
        },

        /**
         * The cached body for a URL that is already charged, or null. Parsing
         * is left to the loader's Worker so the background cache stays compact.
         */
        take: function (url) {
            var entry = cache[url];
            if (!entry || entry.state !== 'ready' || !entry.data) return null;
            entry.state = 'taken';
            entry.lastUsed = Date.now();
            entry.data = null;
            entry.cacheCost = 0;
            debug('taken', entry.label, entry.features + ' features');
            render();
            return entry.data;
        },

        info: function (url) {
            var entry = cache[url];
            if (!entry) return null;
            return {
                state: entry.state, bytes: entry.bytes, received: entry.received,
                features: entry.features || null, mix: entry.mix
            };
        },

        /** Drop a cached file and release its response body. */
        forget: function (url) {
            if (cache[url]) cache[url].data = null;
            delete cache[url];
            render();
        },

        /** Exposed for the panel/tests; not part of normal use. */
        BIG_BYTES: BIG_BYTES
    };
})();
