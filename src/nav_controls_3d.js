/**
 * 3D Navigation Controls
 * On-screen pad to navigate the Cesium 3D view: pan (N/S/E/W), rotate
 * (heading), tilt (pitch), zoom, and reset. The pad is only visible while
 * 3D mode is active.
 */
(function () {
    'use strict';

    const CFG = {
        panMeters: 60,          // ground distance per pan step
        rotateDeg: 15,          // heading change per rotate step
        tiltDeg: 10,            // pitch change per tilt step
        zoomFactor: 0.75,       // distance multiplier per zoom step (<1 zoom in)
        moveDurationMs: 0       // 0 = instant (feels like a joystick)
    };

    let panel = null;
    let toggleBtn = null;
    let userHidden = false; // tracks manual hide so auto-show doesn't override

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
        const g = scene.globe.getHeight(carto);
        return (g !== null && g !== undefined && isFinite(g)) ? g : 0;
    }

    /** Move the camera x(east)/y(north) meters relative to current heading. */
    function panBy(metersEast, metersNorth) {
        const scene = getScene();
        if (!scene) return;
        const camera = scene.camera;
        const carto = camera.positionCartographic;
        const lat = carto.latitude * 180 / Math.PI;

        // Rotate the pan direction into the current heading frame so "up"
        // always means "the way the camera faces".
        const fwd = -camera.heading; // heading 0 = north
        const east = metersEast * Math.cos(fwd) - metersNorth * Math.sin(fwd);
        const north = metersEast * Math.sin(fwd) + metersNorth * Math.cos(fwd);

        const newLat = lat + north / 110574;
        const newLon = carto.longitude * 180 / Math.PI +
            east / (111320 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));

        // Keep altitude above ground at the NEW position (panning uphill).
        const newCarto = Cesium.Cartographic.fromDegrees(newLon, newLat);
        const minH = groundAt(newCarto) + 40;
        const destH = Math.max(carto.height, minH);

        camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(newLon, newLat, destH),
            orientation: { heading: camera.heading, pitch: camera.pitch, roll: 0 }
        });
    }

    /** Turn in place: heading change, position and pitch untouched. */
    function rotateBy(deg) {
        const scene = getScene();
        if (!scene) return;
        const camera = scene.camera;
        const carto = camera.positionCartographic;
        camera.setView({
            destination: Cesium.Ellipsoid.WGS84.cartographicToCartesian(carto),
            orientation: {
                heading: camera.heading + Cesium.Math.toRadians(deg),
                pitch: camera.pitch,
                roll: 0
            }
        });
    }

    /** Nod in place: pitch change (clamped near top-down/horizon). */
    function tiltBy(deg) {
        const scene = getScene();
        if (!scene) return;
        const camera = scene.camera;
        const carto = camera.positionCartographic;
        const newPitch = Cesium.Math.clamp(camera.pitch + Cesium.Math.toRadians(deg),
            Cesium.Math.toRadians(-89), Cesium.Math.toRadians(10));
        camera.setView({
            destination: Cesium.Ellipsoid.WGS84.cartographicToCartesian(carto),
            orientation: {
                heading: camera.heading,
                pitch: newPitch,
                roll: 0
            }
        });
    }

    /** Zoom by scaling the camera height around the ground point. */
    function zoomBy(factor) {
        const scene = getScene();
        if (!scene) return;
        const camera = scene.camera;
        const carto = camera.positionCartographic;
        const ground = scene.globe.getHeight(carto);
        const aboveGround = carto.height - (ground !== null && ground !== undefined ? ground : 0);
        const newAbove = Math.max(30, aboveGround * factor);
        const newHeight = (ground !== null && ground !== undefined ? ground : 0) + newAbove;
        camera.setView({
            destination: Cesium.Ellipsoid.WGS84.cartographicToCartesian(
                new Cesium.Cartographic(carto.longitude, carto.latitude, newHeight)),
            orientation: {
                heading: camera.heading,
                pitch: camera.pitch,
                roll: 0
            }
        });
    }

    /** Ground point under the middle of the screen (for pivot ops). */
    function pickGroundCenter(scene) {
        try {
            const canvas = scene.canvas;
            const center = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
            const ray = scene.camera.getPickRay(center);
            const pos = scene.globe.pick(ray, scene);
            return pos || null;
        } catch (e) {
            return null;
        }
    }

    /** Reset orientation: north up, 45° tilt, keep current position. */
    function resetOrientation() {
        const scene = getScene();
        if (!scene) return;
        const camera = scene.camera;
        const carto = camera.positionCartographic;
        const above = Math.max(carto.height - groundAt(carto), 200);
        camera.setView({
            destination: Cesium.Ellipsoid.WGS84.cartographicToCartesian(
                new Cesium.Cartographic(carto.longitude, carto.latitude,
                    groundAt(carto) + above)),
            orientation: {
                heading: 0,
                pitch: Cesium.Math.toRadians(-45),
                roll: 0
            }
        });
    }

    /** Fly toward a screen direction with a smooth camera.flyTo on a point ahead. */
    function panFly(dir) {
        const scene = getScene();
        if (!scene) return;
        const camera = scene.camera;
        const heading = camera.heading;
        let dx = 0, dy = 0;
        if (dir === 'up') dy = CFG.panMeters;
        if (dir === 'down') dy = -CFG.panMeters;
        if (dir === 'left') dx = -CFG.panMeters;
        if (dir === 'right') dx = CFG.panMeters;
        panBy(dx, dy);
        void heading;
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
                    display: none;
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
                #nav3d-controls .nav3d-row2 { display: flex; gap: 4px; margin-top: 6px; justify-content: center; }
                #nav3d-controls .nav3d-row2 button { width: 40px; height: 34px; }
                #nav3d-controls .nav3d-title {
                    text-align: center; font-size: 11px; color: #555; margin-bottom: 4px;
                }
            </style>
            <div class="nav3d-title">3D navigation</div>
            <div class="nav3d-grid">
                <button data-act="rot-left"  title="Rotate left">&#8635;</button>
                <button data-act="up"        title="Pan forward">&#9650;</button>
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
            </div>
        `;
        document.body.appendChild(panel);

        panel.addEventListener('click', function (ev) {
            const btn = ev.target.closest('button');
            if (!btn) return;
            const act = btn.getAttribute('data-act');
            switch (act) {
                case 'up': case 'down': case 'left': case 'right':
                    panFly(act); break;
                case 'rot-left':  rotateBy(-CFG.rotateDeg); break;
                case 'rot-right': rotateBy(+CFG.rotateDeg); break;
                case 'tilt-up':   tiltBy(+CFG.tiltDeg); break;
                case 'tilt-down': tiltBy(-CFG.tiltDeg); break;
                case 'zoom-in':  zoomBy(CFG.zoomFactor); break;
                case 'zoom-out': zoomBy(1 / CFG.zoomFactor); break;
                case 'reset':    resetOrientation(); break;
            }
        });
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
        } else if (!userHidden) {
            // Entering 3D for the first time – auto-show the panel
            panel.classList.add('nav3d-visible');
        }
        // If userHidden is true we respect the manual hide
    }

    // Toggle visibility whenever the 3D mode is enabled/disabled.
    window.addEventListener('ol3dInitialized', function () {
        setTimeout(updateVisibility, 100);
    });
    window.addEventListener('ol3dDestroyed', function () {
        setTimeout(updateVisibility, 100);
    });

    // Also poll briefly at startup in case events fired before we loaded.
    let tries = 0;
    const t = setInterval(function () {
        updateVisibility();
        if (++tries > 40) clearInterval(t);
    }, 500);

    console.log('🕹️ 3D navigation controls loaded');
})();
