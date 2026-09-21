/**
 * 3D Navigation Controls
 * On-screen pad to navigate the Cesium 3D view: pan (N/S/E/W), rotate
 * (heading), tilt (pitch), zoom, and reset. The pad is only visible while
 * 3D mode is active.
 *
 * Smoothness model:
 * - Rotate/tilt ORBIT around the ground point under the screen centre with a
 *   CONSTANT range. Tilting therefore never changes the distance to what you
 *   are looking at — no more "tilt becomes rapid movement + unzoom".
 * - All movements glide: the camera state eases toward its target every frame
 *   (exponential smoothing), so a tap is a short fluid animation and holding
 *   a button keeps moving smoothly instead of stacking discrete jumps.
 * - While the pad drives the camera, Cesium's own drag controller is paused
 *   to avoid fighting, and restored afterwards (we use plain setView, so no
 *   lookAt transform is left behind).
 */
(function () {
    'use strict';

    const CFG = {
        // Single-tap steps
        rotateDegStep: 15,        // heading change per rotate tap
        tiltDegStep: 10,          // pitch change per tilt tap
        zoomFactor: 0.75,         // range multiplier per zoom tap (<1 zoom in)
        panStepRangeScale: 0.1,   // pan tap distance relative to view range
        panMinStepMeters: 60,
        // Hold rates (per second, after holdDelayMs)
        rotateRateDeg: 90,
        tiltRateDeg: 60,
        zoomRate: 1.15,           // exponential zoom speed while held
        panRateRangeScale: 0.8,   // pan speed relative to view range per second
        panMinRateMeters: 40,
        holdDelayMs: 250,         // hold longer than this to start continuous motion
        // Orbit limits
        minRange: 20,
        maxRange: 30000,
        minPitchDeg: -89,
        maxPitchDeg: 10,
        // Glide
        easeSpeed: 10,            // higher = snappier glide
        groundClearance: 15,      // keep the camera this far above terrain
        // Underground (L-1) navigation: the camera may dive BELOW ground to
        // orbit the basements through the translucent globe. Deepest stop is
        // 5 levels under (matches building:levels:underground up to 4 + margin).
        undergroundMinHeight: -15,
        levelRate: 8              // vertical descend/ascend rate while held (m/s)
    };

    /** True while the underground view (L-1) is active — camera may go below ground. */
    function isUndergroundMode() {
        return !!(window.indoor && typeof window.indoor.isUndergroundEnabled === 'function' &&
                  window.indoor.isUndergroundEnabled());
    }

    /** One storey height (falls back to 3 m when the indoor module is absent). */
    function levelHeightMeters() {
        return (window.indoor && window.indoor.LEVEL_HEIGHT) || 3;
    }

    /**
     * Shift the orbit pivot vertically by dm meters. The pivot sits ON the
     * ground on the surface; underground (L-1) it may sink to
     * undergroundMinHeight below it. Descending for the first time auto-enters
     * the underground view (opaque ground would show nothing); ascending back
     * to ground level auto-exits it.
     */
    function shiftPivotHeight(dm) {
        const t = nav.tgt;
        if (!t) return;
        const under = isUndergroundMode();
        if (dm < 0 && !under &&
            window.indoor && typeof window.indoor.setUnderground === 'function') {
            window.indoor.setUnderground(true);   // translucent globe + basements visible
        }
        const gh = groundAt(t.pivot);
        const minAbs = gh + CFG.undergroundMinHeight; // deepest stop (L-1…L-5)
        const maxAbs = gh;                            // pivot back ON the ground
        t.pivot.height = Math.max(minAbs, Math.min(maxAbs, t.pivot.height + dm));
        if (dm > 0 && isUndergroundMode() && t.pivot.height >= maxAbs - 0.01 &&
            window.indoor && typeof window.indoor.setUnderground === 'function') {
            window.indoor.setUnderground(false);  // surfaced: restore opaque globe
        }
    }

    let panel = null;
    let toggleBtn = null;
    let userHidden = false; // tracks manual hide so auto-show doesn't override

    // Smooth navigation state
    const nav = {
        active: false,          // rAF glide loop running
        raf: 0,
        lastT: 0,
        pointerId: null,        // pointer still held (drives hold rates)
        pressTime: 0,
        act: null,              // current button action while held
        cur: null,              // { pivot: Cartographic, heading, pitch, range }
        tgt: null               // same shape — where the glide is heading
    };

    function getOl3d() {
        return window.ol3d || null;
    }

    function is3dActive() {
        const o = getOl3d();
        if (!o) return false;
        // Trust getEnabled() when available: the Cesium scene exists even while
        // 3D is disabled, which kept the pad on screen after returning to 2D.
        if (typeof o.getEnabled === 'function') return !!o.getEnabled();
        return !!(o.getCesiumScene && o.getCesiumScene());
    }

    function getScene() {
        const o = getOl3d();
        return o ? o.getCesiumScene() : null;
    }

    /** Ground height (or 0) under a cartographic position. */
    function groundAt(carto) {
        const scene = getScene();
        if (!scene || !scene.globe) return 0;
        let g = 0;
        try { g = scene.globe.getHeight(carto); } catch (e) { g = 0; }
        return (g !== null && g !== undefined && isFinite(g)) ? g : 0;
    }

    function toRad(deg) { return deg * Math.PI / 180; }
    function clampPitch(p) {
        return Cesium.Math.clamp(p, toRad(CFG.minPitchDeg), toRad(CFG.maxPitchDeg));
    }
    function clampRange(r) {
        return Cesium.Math.clamp(r, CFG.minRange, CFG.maxRange);
    }
    /** Keep a target heading within ±180° of the current heading. */
    function shortestHeading(angle) {
        const cur = nav.cur ? nav.cur.heading : angle;
        let a = angle;
        while (a - cur > Math.PI) a -= 2 * Math.PI;
        while (a - cur < -Math.PI) a += 2 * Math.PI;
        return a;
    }

    /** Ground point under the middle of the screen (Cartographic). */
    function pickPivot() {
        const scene = getScene();
        if (!scene) return null;
        let carto = null;
        try {
            const canvas = scene.canvas;
            const center = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
            const ray = scene.camera.getPickRay(center);
            const pos = scene.globe.pick(ray, scene);
            if (pos) carto = Cesium.Cartographic.fromCartesian(pos);
        } catch (e) { /* fall through */ }
        if (!carto) {
            // Fallback: the camera position itself (an underground camera has
            // no globe hit under the crosshair — the surface is above it)
            const c = scene.camera.positionCartographic;
            carto = new Cesium.Cartographic(c.longitude, c.latitude, c.height);
        }
        const gh = groundAt(carto);
        if (isUndergroundMode() && carto.height < gh) {
            // Underground: orbit at the camera's depth instead of snapping the
            // pivot back up to the surface (which bounced L-1 navigation out).
            carto.height = Math.max(carto.height, gh + CFG.undergroundMinHeight);
        } else {
            carto.height = gh;
        }
        return carto;
    }

    /**
     * Capture the current camera pose as an orbit around the pivot:
     * { pivot, heading, pitch, range } — the same convention as Cesium's
     * HeadingPitchRange (camera sits range meters away from the pivot at the
     * given heading/pitch, looking back at it).
     */
    function captureOrbitState() {
        const scene = getScene();
        if (!scene) return null;
        const cam = scene.camera;
        const pivot = pickPivot();
        if (!pivot) return null;
        const pivotCart = Cesium.Ellipsoid.WGS84.cartographicToCartesian(pivot);
        const enu = Cesium.Transforms.eastNorthUpToFixedFrame(pivotCart);
        const inv = Cesium.Matrix4.inverseTransformation(enu, new Cesium.Matrix4());
        const camEnu = Cesium.Matrix4.multiplyByPoint(inv, cam.positionWC, new Cesium.Cartesian3());
        const east = camEnu.x, north = camEnu.y, up = camEnu.z;
        const flat = Math.sqrt(east * east + north * north);
        const range = clampRange(Math.max(flat, Math.abs(up), CFG.minRange));
        // Invert the orbit offset: up = -range*sin(pitch), east = -range*cos(pitch)*sin(heading)
        const pitch = clampPitch(Math.asin(Cesium.Math.clamp(-up / range, -1, 1)));
        const heading = Math.atan2(-east, -north);
        return {
            pivot: new Cesium.Cartographic(pivot.longitude, pivot.latitude, pivot.height),
            heading: heading,
            pitch: pitch,
            range: range
        };
    }

    function cloneState(s) {
        return {
            pivot: new Cesium.Cartographic(s.pivot.longitude, s.pivot.latitude, s.pivot.height),
            heading: s.heading, pitch: s.pitch, range: s.range
        };
    }

    /**
     * Place the camera from orbit state: pivot + range at heading/pitch,
     * looking back at the pivot. Raises the orbit plane when the derived
     * camera position would sink into terrain.
     */
    function applyOrbitState(state) {
        const scene = getScene();
        if (!scene || !state) return;

        let dest = null;
        for (let iter = 0; iter < 2; iter++) {
            const pivotCart = Cesium.Ellipsoid.WGS84.cartographicToCartesian(state.pivot);
            const enu = Cesium.Transforms.eastNorthUpToFixedFrame(pivotCart);
            const h = state.heading, p = state.pitch, r = state.range;
            const cp = Math.cos(p);
            const off = new Cesium.Cartesian3(
                -r * cp * Math.sin(h),
                -r * cp * Math.cos(h),
                -r * Math.sin(p)
            );
            dest = Cesium.Matrix4.multiplyByPoint(enu, off, new Cesium.Cartesian3());

            // Keep the camera above terrain — EXCEPT in underground (L-1) view,
            // where orbiting the basements REQUIRES the camera below ground.
            if (!isUndergroundMode()) {
                const carto = Cesium.Cartographic.fromCartesian(dest);
                const minH = groundAt(carto) + CFG.groundClearance;
                if (carto.height < minH) {
                    const lift = minH - carto.height;
                    state.pivot.height += lift;
                    if (nav.tgt && nav.tgt !== state) {
                        nav.tgt.pivot.height = Math.max(nav.tgt.pivot.height, state.pivot.height);
                    }
                    continue; // recompute once with the lifted pivot
                }
            }
            break;
        }

        scene.camera.setView({
            destination: dest,
            orientation: { heading: state.heading, pitch: state.pitch, roll: 0 }
        });
    }

    /** Move the target pivot dx meters right / dy meters forward (heading frame). */
    function moveTargetPivot(dx, dy) {
        const t = nav.tgt;
        const h = t.heading;
        const e = dx * Math.cos(h) + dy * Math.sin(h);
        const n = -dx * Math.sin(h) + dy * Math.cos(h);
        const latRad = t.pivot.latitude;
        const lonPerM = 1 / (111320 * Math.max(0.2, Math.cos(latRad)));
        const latPerM = 1 / 110574;
        const nl = t.pivot.longitude + e * lonPerM;
        const nlat = t.pivot.latitude + n * latPerM;
        const gh = groundAt(new Cesium.Cartographic(nl, nlat, 0));
        if (isUndergroundMode()) {
            // Keep the current depth below ground while panning underground
            const rel = Math.min(0, t.pivot.height - groundAt(t.pivot));
            t.pivot = new Cesium.Cartographic(nl, nlat,
                Math.max(gh + CFG.undergroundMinHeight, gh + rel));
        } else {
            t.pivot = new Cesium.Cartographic(nl, nlat, gh);
        }
    }

    /** Apply one full step for a tap. */
    function applyStep(act) {
        const t = nav.tgt;
        switch (act) {
            case 'rot-left':  t.heading = shortestHeading(t.heading - toRad(CFG.rotateDegStep)); break;
            case 'rot-right': t.heading = shortestHeading(t.heading + toRad(CFG.rotateDegStep)); break;
            case 'tilt-up':   t.pitch = clampPitch(t.pitch + toRad(CFG.tiltDegStep)); break;
            case 'tilt-down': t.pitch = clampPitch(t.pitch - toRad(CFG.tiltDegStep)); break;
            case 'zoom-in':   t.range = clampRange(t.range * CFG.zoomFactor); break;
            case 'zoom-out':  t.range = clampRange(t.range / CFG.zoomFactor); break;
            case 'reset':
                t.heading = shortestHeading(0);
                if (isUndergroundMode()) {
                    // Reset INSIDE the basement: steeper tilt over the L-1 floor
                    t.pitch = toRad(-60);
                    t.pivot.height = groundAt(t.pivot) - levelHeightMeters();
                    t.range = clampRange(Math.max(Math.min(t.range, 120), 60));
                } else {
                    t.pitch = toRad(-45);
                    t.range = clampRange(Math.max(t.range, 200));
                }
                break;
            case 'up':    moveTargetPivot(0, +1); break;
            case 'down':  moveTargetPivot(0, -1); break;
            case 'left':  moveTargetPivot(-1, 0); break;
            case 'right': moveTargetPivot(+1, 0); break;
            case 'level-down': shiftPivotHeight(-levelHeightMeters()); break;
            case 'level-up':   shiftPivotHeight(+levelHeightMeters()); break;
        }
    }

    /** Apply continuous per-second rates while a button is held. */
    function applyHoldRates(dt) {
        if (!nav.act) return;
        const t = nav.tgt;
        const rotRate = toRad(CFG.rotateRateDeg);
        const tiltRate = toRad(CFG.tiltRateDeg);
        const panRate = Math.max(CFG.panMinRateMeters, t.range * CFG.panRateRangeScale);
        const zoomK = Math.exp(-CFG.zoomRate * dt); // per-frame zoom factor (in)
        switch (nav.act) {
            case 'rot-left':  t.heading = shortestHeading(t.heading - rotRate * dt); break;
            case 'rot-right': t.heading = shortestHeading(t.heading + rotRate * dt); break;
            case 'tilt-up':   t.pitch = clampPitch(t.pitch + tiltRate * dt); break;
            case 'tilt-down': t.pitch = clampPitch(t.pitch - tiltRate * dt); break;
            case 'zoom-in':   t.range = clampRange(t.range * zoomK); break;
            case 'zoom-out':  t.range = clampRange(t.range / zoomK); break;
            case 'reset': break; // reset is tap-only
            case 'up':    moveTargetPivot(0, +panRate * dt); break;
            case 'down':  moveTargetPivot(0, -panRate * dt); break;
            case 'left':  moveTargetPivot(-panRate * dt, 0); break;
            case 'right': moveTargetPivot(+panRate * dt, 0); break;
            case 'level-down': shiftPivotHeight(-CFG.levelRate * dt); break;
            case 'level-up':   shiftPivotHeight(+CFG.levelRate * dt); break;
        }
    }

    function stopNav() {
        if (nav.raf) { cancelAnimationFrame(nav.raf); nav.raf = 0; }
        nav.active = false;
        nav.pointerId = null;
        nav.act = null;
        const scene = getScene();
        if (scene && scene.screenSpaceCameraController) {
            try { scene.screenSpaceCameraController.enableInputs = true; } catch (e) { /* noop */ }
        }
    }

    /** Glide loop: ease current state toward target and apply to the camera. */
    function tick(now) {
        if (!nav.active) return;
        const scene = getScene();
        if (!scene) { stopNav(); return; }

        const dt = Math.min(0.05, (now - (nav.lastT || now)) / 1000);
        nav.lastT = now;

        // Continuous rates kick in after the hold delay
        const holding = nav.pointerId !== null && (now - nav.pressTime) > CFG.holdDelayMs;
        if (holding) applyHoldRates(dt);

        // Exponential ease toward the target (frame-rate independent)
        const k = 1 - Math.exp(-dt * CFG.easeSpeed);
        nav.cur.heading += (nav.tgt.heading - nav.cur.heading) * k;
        nav.cur.pitch += (nav.tgt.pitch - nav.cur.pitch) * k;
        nav.cur.range += (nav.tgt.range - nav.cur.range) * k;
        nav.cur.pivot.longitude += (nav.tgt.pivot.longitude - nav.cur.pivot.longitude) * k;
        nav.cur.pivot.latitude += (nav.tgt.pivot.latitude - nav.cur.pivot.latitude) * k;
        nav.cur.pivot.height += (nav.tgt.pivot.height - nav.cur.pivot.height) * k;

        applyOrbitState(nav.cur);

        // Stop the loop once the pointer is released and we have converged
        const settled = !holding &&
            Math.abs(nav.tgt.heading - nav.cur.heading) < 1e-4 &&
            Math.abs(nav.tgt.pitch - nav.cur.pitch) < 1e-4 &&
            Math.abs(nav.tgt.range - nav.cur.range) < 0.05 &&
            Math.abs(nav.tgt.pivot.longitude - nav.cur.pivot.longitude) < 1e-8 &&
            Math.abs(nav.tgt.pivot.latitude - nav.cur.pivot.latitude) < 1e-8 &&
            Math.abs(nav.tgt.pivot.height - nav.cur.pivot.height) < 0.01;
        if (settled) {
            stopNav();
        } else {
            nav.raf = requestAnimationFrame(tick);
        }
    }

    function beginGesture(act, pointerId) {
        if (!is3dActive()) return;
        const scene = getScene();
        if (!scene) return;

        if (!nav.active) {
            const state = captureOrbitState();
            if (!state) return;
            nav.cur = state;
            nav.tgt = cloneState(state);
            nav.active = true;
            nav.lastT = 0;
            // Pause Cesium's own camera controller while the pad drives
            try { scene.screenSpaceCameraController.enableInputs = false; } catch (e) { /* noop */ }
        }
        nav.pointerId = pointerId;
        nav.pressTime = performance.now();
        nav.act = act;
        applyStep(act); // a tap is always one full step, animated by the glide
        if (!nav.raf) nav.raf = requestAnimationFrame(tick);
    }

    function endGesture() {
        // Release: stop hold rates; the glide keeps animating until settled
        nav.pointerId = null;
        nav.act = null;
    }

    function buildPanel() {
        // --- Toggle button (separate from the panel) ---
        toggleBtn = document.createElement('div');
        toggleBtn.id = 'nav3d-toggle-btn';
        toggleBtn.innerHTML = `
            <style>
                #nav3d-toggle-btn {
                    position: absolute; right: 14px; top: 90px; z-index: 1201;
                    background: rgba(255,255,255,0.92); border-radius: 10px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.25);
                    padding: 6px 10px; cursor: pointer; font-family: sans-serif;
                    font-size: 18px; display: none; user-select: none;
                }
                #nav3d-toggle-btn:hover { background: #e8f0fe; }
                #nav3d-toggle-btn.nav3d-toggle-visible { display: block; }
                #nav3d-toggle-btn.nav3d-active {
                    background: #c8daf8;
                    box-shadow: 0 0 0 2px #1a73e8 inset, 0 2px 10px rgba(0,0,0,0.25);
                }
            </style>
            🕹️
        `;
        toggleBtn.title = 'Show / hide 3D navigation controls';

        // Reflect panel state on the toggle button (visual open/closed cue)
        window._updateNav3dToggleState = function () {
            if (!toggleBtn || !panel) return;
            const open = panel.classList.contains('nav3d-visible');
            toggleBtn.classList.toggle('nav3d-active', open);
            toggleBtn.title = open ? 'Hide 3D navigation controls' : 'Show 3D navigation controls';
        };
        document.body.appendChild(toggleBtn);

        toggleBtn.addEventListener('click', function () {
            userHidden = panel.classList.contains('nav3d-visible');
            panel.classList.toggle('nav3d-visible');
            if (window._updateNav3dToggleState) window._updateNav3dToggleState();
        });

        // --- Navigation panel ---
        panel = document.createElement('div');
        panel.id = 'nav3d-controls';
        panel.innerHTML = `
            <style>
                #nav3d-controls {
                    position: absolute; right: 14px; top: 134px; z-index: 1200;
                    background: rgba(255,255,255,0.92); border-radius: 10px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.25);
                    padding: 8px; user-select: none; font-family: sans-serif;
                    display: none; touch-action: none;
                }
                #nav3d-controls.nav3d-visible { display: block; }
                #nav3d-controls .nav3d-grid {
                    display: grid; grid-template-columns: repeat(3, 40px);
                    gap: 4px; justify-items: center;
                }
                #nav3d-controls button {
                    width: 40px; height: 34px; border: 1px solid #bbb;
                    border-radius: 6px; background: #fff; cursor: pointer;
                    font-size: 16px; line-height: 1; padding: 0;
                }
                #nav3d-controls button:hover { background: #e8f0fe; }
                #nav3d-controls button:active { background: #c8daf8; }
                #nav3d-controls .nav3d-row2 { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; justify-content: center; }
                #nav3d-controls .nav3d-row2 button { width: 40px; height: 34px; }
                #nav3d-controls #nav3d-indoor-btn.nav3d-indoor-active {
                    background: #c8e6c9; border-color: #2e7d32;
                }
                #nav3d-controls #nav3d-underground-btn.nav3d-indoor-active {
                    background: #d7ccc8; border-color: #4e342e;
                }
                #nav3d-controls .nav3d-title {
                    text-align: center; font-size: 11px; color: #555; margin-bottom: 4px;
                }
            </style>
            <div class="nav3d-title">3D navigation</div>
            <div class="nav3d-grid">
                <button data-act="rot-left"  title="Rotate left">&#8635;</button>
                <button data-act="up"        title="Pan forward (hold to keep moving)">&#9650;</button>
                <button data-act="rot-right" title="Rotate right">&#8634;</button>
                <button data-act="left"      title="Pan left">&#9664;</button>
                <button data-act="reset"     title="Reset: north up, 45&#176; tilt">&#8682;</button>
                <button data-act="right"     title="Pan right">&#9654;</button>
                <button data-act="tilt-up"   title="Tilt up (more horizontal)">&#8593;&#771;</button>
                <button data-act="down"      title="Pan backward">&#9660;</button>
                <button data-act="tilt-down" title="Tilt down (more top-down)">&#8595;&#771;</button>
            </div>
            <div class="nav3d-row2">
                <button data-act="zoom-in"  title="Zoom in">&#10133;</button>
                <button data-act="zoom-out" title="Zoom out">&#10134;</button>
                <button id="nav3d-indoor-btn" title="Show / hide indoor view (Simple Indoor Tagging)">&#127963;</button>
                <button id="nav3d-underground-btn" title="Show underground: level -1 / layer -1 (translucent ground)">L-1</button>
                <button data-act="level-down" title="Descend one level (first press enters the underground view)">&#9660;L</button>
                <button data-act="level-up"   title="Ascend one level (exits the underground view at the surface)">&#9650;L</button>
            </div>
        `;
        document.body.appendChild(panel);

        // Indoor view toggle: plain click — excluded from nav gestures below
        // (the button carries no data-act, and the handler ignores it too)
        const indoorBtn = panel.querySelector('#nav3d-indoor-btn');
        if (indoorBtn) {
            indoorBtn.addEventListener('click', function (ev) {
                ev.stopPropagation();
                if (window.indoor && typeof window.indoor.setEnabled === 'function') {
                    const on = window.indoor.setEnabled(!window.indoor.isEnabled());
                    indoorBtn.classList.toggle('nav3d-indoor-active', on);
                    indoorBtn.title = on ? 'Hide indoor view (Simple Indoor Tagging)'
                                         : 'Show indoor view (Simple Indoor Tagging)';
                }
            });
        }
        // Underground view: basements (level=-1) and layer=-1 parts at true depth
        const underBtn = panel.querySelector('#nav3d-underground-btn');
        if (underBtn) {
            underBtn.addEventListener('click', function (ev) {
                ev.stopPropagation();
                if (window.indoor && typeof window.indoor.setUnderground === 'function') {
                    const on = window.indoor.setUnderground(!window.indoor.isUndergroundEnabled());
                    underBtn.classList.toggle('nav3d-indoor-active', on);
                    underBtn.title = on ? 'Hide underground (back to surface only)'
                                        : 'Show underground: level -1 / layer -1 (translucent ground)';
                }
            });
        }

        // Pointer-based input: tap = one animated step, hold = continuous
        panel.addEventListener('pointerdown', function (ev) {
            const btn = ev.target.closest('button');
            if (!btn || !btn.getAttribute('data-act')) return;
            ev.preventDefault();
            beginGesture(btn.getAttribute('data-act'), ev.pointerId);
        });
        const onRelease = function () { endGesture(); };
        window.addEventListener('pointerup', onRelease);
        window.addEventListener('pointercancel', onRelease);
    }

    function updateVisibility() {
        if (!panel) buildPanel();
        const active = is3dActive();
        // Show the toggle button whenever 3D is active
        toggleBtn.classList.toggle('nav3d-toggle-visible', active);
        if (window._updateNav3dToggleState) window._updateNav3dToggleState();
        if (!active) {
            // Leaving 3D – reset everything
            panel.classList.remove('nav3d-visible');
            userHidden = false;
            stopNav();
        } else if (!userHidden) {
            // Entering 3D for the first time – auto-show the panel
            panel.classList.add('nav3d-visible');
        }
        // If userHidden is true we respect the manual hide
    }

    /**
     * Damp Cesium's own (mouse/touch) camera controller so free navigation
     * without the panel also stays smooth:
     * - Lower inertia: after a drag or wheel tick the movement glides out
     *   briefly instead of keeping 90% momentum forever (which stacked into
     *   the "rapid movement + unzoom" effect, especially in tilted views).
     * - minimumZoomDistance keeps the wheel from slingshotting the camera
     *   under the terrain/buildings when tilted.
     */
    function tuneCesiumController() {
        const scene = getScene();
        if (!scene || !scene.screenSpaceCameraController) return;
        const c = scene.screenSpaceCameraController;
        try {
            c.inertiaSpin = 0.65;      // drag rotation momentum
            c.inertiaTranslate = 0.65; // drag pan momentum
            c.inertiaZoom = 0.5;       // wheel/pinch momentum (worst offender)
            c.minimumZoomDistance = 5; // don't dive under ground/buildings
        } catch (e) { /* older build without some fields */ }
    }

    // Toggle visibility whenever the 3D mode is enabled/disabled.
    window.addEventListener('ol3dInitialized', function () {
        tuneCesiumController();
        setTimeout(updateVisibility, 100);
    });
    window.addEventListener('ol3dDestroyed', function () {
        stopNav();
        setTimeout(updateVisibility, 100);
    });

    // Also poll briefly at startup in case events fired before we loaded.
    let tries = 0;
    const t = setInterval(function () {
        updateVisibility();
        if (++tries > 40) clearInterval(t);
    }, 500);

    console.log('🕹️ 3D navigation controls loaded (smooth orbit mode)');
})();
