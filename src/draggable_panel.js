// ---------------------------------------------------------------------------
// draggable_panel.js — let the floating 3D panels be dragged out of the way
// ---------------------------------------------------------------------------
// The 3D navigation panel and the 3D generation stats panel are both pinned to
// a corner of the screen by their own stylesheets, so whichever one the user
// needs is often the one the other one covers. Each panel gets a drag surface
// and dragging it moves the whole panel.
//
// window.panelDrag.makeDraggable(panel, handle, options)
//   panel   — the floating element to move
//   handle  — where a drag may start (the panel itself, or a grip inside it)
//   options.skip — selector for controls inside the handle that keep their own
//                  behaviour (buttons, selects, …); default below
//
// Dragging is pointer based, so mouse, pen and touch behave the same. The
// move only starts after the pointer travels a few pixels, so a plain click on
// a label or the panel never turns into a drag, and nothing is prevented until
// then. The pointer is captured, so a quick drag that leaves the panel still
// moves it instead of dropping it. The panel switches to position:fixed on the
// first drag (both panels are viewport overlays) and is kept inside the
// viewport, so it can never be dragged off-screen and lost.
// ---------------------------------------------------------------------------

(function () {
    'use strict';

    // Pixels of the panel that must stay on screen, so a dragged panel always
    // has something left to grab again.
    var KEEP_VISIBLE = 48;
    // Pointer travel before a press is treated as a drag instead of a click.
    var DRAG_THRESHOLD = 3;
    var DEFAULT_SKIP = 'button, select, option, input, textarea, output, a';

    function clamp(value, min, max) {
        if (max < min) return min;
        return Math.min(Math.max(value, min), max);
    }

    function makeDraggable(panel, handle, options) {
        if (!panel || !handle || handle._panelDragInstalled) return;
        handle._panelDragInstalled = true;

        var skip = (options && options.skip) || DEFAULT_SKIP;
        var drag = null;

        function onDown(ev) {
            // Primary button only; middle/right clicks still belong to the page.
            if (ev.pointerType === 'mouse' && ev.button !== 0) return;
            var target = ev.target;
            if (target && target.closest && target.closest(skip)) return;
            var rect = panel.getBoundingClientRect();
            if (!rect.width) return;   // a hidden panel has nothing to drag

            drag = {
                pointerId: ev.pointerId,
                startX: ev.clientX,
                startY: ev.clientY,
                left: rect.left,
                top: rect.top,
                width: rect.width,
                moved: false
            };
            try { handle.setPointerCapture(ev.pointerId); } catch (e) { /* noop */ }
        }

        function onMove(ev) {
            if (!drag || ev.pointerId !== drag.pointerId) return;
            var dx = ev.clientX - drag.startX;
            var dy = ev.clientY - drag.startY;
            if (!drag.moved) {
                if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
                drag.moved = true;
                // Anchor with left/top from here on, and let the stylesheet's
                // right/top corner placement go.
                panel.style.position = 'fixed';
                panel.style.right = 'auto';
                panel.style.bottom = 'auto';
                handle.style.cursor = 'grabbing';
            }
            var maxLeft = window.innerWidth - Math.min(KEEP_VISIBLE, drag.width);
            panel.style.left = clamp(drag.left + dx, KEEP_VISIBLE - drag.width, maxLeft) + 'px';
            panel.style.top = clamp(drag.top + dy, 0, window.innerHeight - KEEP_VISIBLE) + 'px';
            ev.preventDefault();
        }

        function onUp(ev) {
            if (!drag || ev.pointerId !== drag.pointerId) return;
            try { handle.releasePointerCapture(ev.pointerId); } catch (e) { /* noop */ }
            drag = null;
            handle.style.cursor = '';
        }

        handle.addEventListener('pointerdown', onDown);
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
        handle.addEventListener('pointercancel', onUp);
    }

    window.panelDrag = { makeDraggable: makeDraggable };
})();
