// ---------------------------------------------------------------------------
// progressive.js — run a long per-item job without freezing the tab
// ---------------------------------------------------------------------------
// Why this exists
// ---------------
// Loading a GeoJSON extract used to be ONE synchronous loop over every
// feature (tag matching, model lookup, orientation, repetition setup). With a
// city-sized file that is thousands of features, and the browser could not
// paint, scroll or answer a click until the whole thing finished: the page
// simply looked broken for however long it took. Opening a 4000-feature file
// took tens of seconds, and a newcomer closes the tab.
//
// The fix is not "make the work smaller" alone — the work is what it is — but
// "give the browser a turn every few milliseconds". That is what this module
// is for, and it is the same idea the 3D model renderer uses for placing
// models (see model_renderer.runPlaceSlices).
//
// How it behaves
// --------------
//   * a slice ends when the time budget is spent (not after a fixed item
//     count, because a cheap feature and an expensive one differ by 100x);
//   * the next slice is sized from the measured cost of the previous one, so a
//     fast machine batches and a slow one spreads out;
//   * ONE item throwing never stops the rest: a bad feature is reported and
//     the sweep continues (a single throw used to abort the whole file);
//   * progress is reported as it goes, so a panel can show a moving number;
//   * the hand-off is a single unclamped macrotask (see yieldToBrowser).
//
// window.progressive is the public surface:
//   progressive.forEach(items, worker, opts)  run `worker(item, index)`
//   progressive.yield(callback)               hand back to the browser
//   progressive.nowMs()                       the clock used for budgeting
// ---------------------------------------------------------------------------
(function () {
    'use strict';

    function nowMs() {
        if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
            return performance.now();
        }
        return Date.now();
    }

    // One shared MessageChannel, reused for every hand-off.
    //
    // Why not requestIdleCallback? It was the previous choice and it is the
    // reason loading crawled in Firefox and Safari:
    //
    //  - Firefox only runs an idle callback when the event loop has nothing
    //    else to do. A Cesium scene repaints continuously, so there is almost
    //    never an idle period, and every slice had to wait out the whole
    //    `timeout` (120 ms) before running. That latency is paid PER SLICE:
    //    a few hundred slices turned a one-second load into tens of seconds,
    //    and the progress bar crawled, which read as "frozen".
    //  - Safari has no requestIdleCallback at all, so it fell through to
    //    requestAnimationFrame — one slice per FRAME, capped by the display
    //    refresh and delayed further whenever the compositor was busy.
    //
    // Why MessageChannel: posting a message queues a macrotask with NO
    // minimum delay. The browser runs input and rendering around it, so the
    // page stays usable, but we are not waiting for a frame or for the
    // browser to decide we are idle. It is supported everywhere (Safari 5.1+,
    // Firefox 41+), and unlike setTimeout it is not clamped to 4 ms once the
    // nesting level gets high, so hundreds of back-to-back hand-offs do not
    // quietly become hundreds of extra milliseconds.
    var yieldPort = null;
    try {
        if (typeof MessageChannel === 'function') {
            var channel = new MessageChannel();
            yieldPort = channel.port2;
            channel.port1.onmessage = function () {
                if (typeof yieldPort.__onYield === 'function') yieldPort.__onYield();
            };
        }
    } catch (error) {
        yieldPort = null;
    }

    /**
     * Run `callback` when the main thread is free again.
     *
     * The hand-off is deliberately fast and unconditional: the slice budget
     * (8 ms) is what keeps the page responsive, and a scheduler that can
     * decide to wait 120 ms is what makes the whole thing feel broken.
     */
    function yieldToBrowser(callback, timeoutMs) {
        var doc = (typeof document !== 'undefined') ? document : null;
        if (yieldPort) {
            // A hidden tab still processes messages, but there is nobody
            // watching and no rendering to keep up, so slow down rather than
            // spin a core in the background.
            if (doc && doc.hidden) {
                setTimeout(callback, 32);
                return;
            }
            yieldPort.__onYield = callback;
            yieldPort.postMessage(0);
            return;
        }
        if (doc && doc.hidden) {
            setTimeout(callback, 32);
            return;
        }
        // Very old browsers: setTimeout is the only hand-off available. The
        // clamp applies, which is why the slice budget matters more here.
        setTimeout(callback, 0);
    }

    /**
     * Call `worker(item, index)` for every item, in time-budgeted slices.
     *
     * options:
     *   budgetMs        target main-thread time per slice (default 8)
     *   probeItems      items per slice before the cost is known (default 12)
     *   maxItems        never burst more than this many at once (default 250)
     *   idleTimeoutMs   kept for call-site compatibility; the hand-off no
     *                    longer waits on it (see yieldToBrowser)
     *   label           used in the error message
     *   onProgress(done, total)  called after every slice
     *   onDone()                  called once, after the last item
     *   onError(item, error, index)  called for each item that throws
     *
     * @returns {{cancel: function()}} a handle that can stop the run
     */
    function forEach(items, worker, options) {
        var opts = options || {};
        var list = items || [];
        var total = list.length;
        var budgetMs = opts.budgetMs || 8;
        var probeItems = opts.probeItems || 12;
        var maxItems = opts.maxItems || 250;
        var idleTimeoutMs = opts.idleTimeoutMs || 120;
        var onProgress = opts.onProgress, onDone = opts.onDone, onError = opts.onError;
        var label = opts.label || 'work';
        var index = 0, cancelled = false, costPerItem = 0;

        function slice() {
            if (cancelled) return;

            var started = index;
            // Before the first measurement, place a small probe batch: it does
            // useful work and tells us what the machine can take.
            var planned = costPerItem > 0 ? Math.ceil(budgetMs / costPerItem) : probeItems;
            var batch = Math.max(1, Math.min(planned, maxItems));
            var limit = Math.min(total, index + batch);
            var startedAt = nowMs();
            var deadline = startedAt + budgetMs;

            while (index < limit) {
                var item = list[index];
                try {
                    worker(item, index);
                } catch (error) {
                    // One bad feature must not cost the rest of the file its
                    // models, which is what an unguarded forEach did.
                    if (onError) onError(item, error, index);
                    else console.error('progressive: "' + label + '" failed on item ' + index + ':', error);
                }
                index++;
                // Checked AFTER the item, so a hand-off never happens without
                // having done some work. A single very slow item can overrun
                // the budget by itself; the measurement below shrinks the next
                // slice in response.
                if (index - started >= 1 && nowMs() >= deadline) break;
            }

            var done = index - started;
            if (done > 0) {
                var perItem = (nowMs() - startedAt) / done;
                // Smoothed: one unusual feature should not resize every slice.
                costPerItem = costPerItem > 0 ? (costPerItem * 0.7 + perItem * 0.3) : perItem;
            }

            if (onProgress) onProgress(index, total);
            if (index < total) {
                yieldToBrowser(slice, idleTimeoutMs);
                return;
            }
            if (onDone) {
                // Isolated like the items: a caller whose completion hook throws
                // must not take the run down with it (and the work is already
                // done at this point, so there is nothing left to lose).
                try { onDone(); } catch (error) { console.error('progressive: "' + label + '" completion failed:', error); }
            }
        }

        var handle = {
            cancel: function () { cancelled = true; }
        };
        if (total === 0) {
            if (onDone) {
                try { onDone(); } catch (error) { console.error('progressive: "' + label + '" completion failed:', error); }
            }
            return handle;
        }
        slice();
        return handle;
    }

    window.progressive = {
        forEach: forEach,
        yield: yieldToBrowser,
        nowMs: nowMs
    };
})();