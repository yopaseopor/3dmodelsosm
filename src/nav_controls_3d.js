/**
 * 3D Navigation Controls
 * On-screen pad to navigate the Cesium 3D view: pan (N/S/E/W), rotate
 * (heading and roll), tilt (pitch), zoom, and reset. The pad is only visible
 * while 3D mode is active.
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
        rollDegStep: 15,          // roll change per roll tap
        tiltDegStep: 10,          // pitch change per tilt tap
        zoomFactor: 0.75,         // range multiplier per zoom tap (<1 zoom in)
        panStepRangeScale: 0.1,   // pan tap distance relative to view range
        panMinStepMeters: 60,
        // Hold rates (per second, after holdDelayMs)
        rotateRateDeg: 90,
        rollRateDeg: 60,
        tiltRateDeg: 60,
        zoomRate: 1.15,           // exponential zoom speed while held
        panRateRangeScale: 0.8,   // pan speed relative to view range per second
        panMinRateMeters: 40,
        holdDelayMs: 250,         // hold longer than this to start continuous motion
        // Orbit limits
        minRange: 20,
        maxRange: 30000,
        minPitchDeg: -89,
        maxPitchDeg: 89,
        // Glide
        easeSpeed: 10             // higher = snappier glide
    };
    let buttonStrength = 1;

    function isUndergroundMode() {
        return !!(window.indoor && typeof window.indoor.isUndergroundEnabled === 'function' &&
                  window.indoor.isUndergroundEnabled());
    }

    let panel = null;
    let toggleBtn = null;
    let userHidden = false; // tracks manual hide so auto-show doesn't override
    let watchedCamera = null;
    let lastSafeCameraCheck = 0;
    let lastSafeCamera = null;
    const pointerNav = {
        active: false,
        mode: 'walk',
        speed: 2,
        height: 2,
        keys: Object.create(null),
        raf: 0,
        lastT: 0,
        heading: 0,
        pitch: -0.05,
        targetHeading: 0,
        targetPitch: -0.05,
        velocityForward: 0,
        velocityStrafe: 0,
        eyeHeight: 1.7,
        groundHeight: 0,
        lastGroundSampleAt: 0,
        lastGroundLongitude: null,
        lastGroundLatitude: null,
        canvas: null,
        previousCursor: '',
        previousInputs: true,
        dragPointer: null,
        lastX: 0,
        lastY: 0
    };

    // Smooth navigation state
    const nav = {
        active: false,          // rAF glide loop running
        raf: 0,
        lastT: 0,
        pointerId: null,        // pointer still held (drives hold rates)
        pressTime: 0,
        act: null,              // current button action while held
        cur: null,              // { pivot: Cartographic, heading, pitch, roll, range }
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

    function rememberSafeCamera() {
        const now = performance.now();
        if (now - lastSafeCameraCheck < 300) return;
        lastSafeCameraCheck = now;
        const scene = getScene();
        if (!scene || !scene.globe || isUndergroundMode()) return;

        const camera = scene.camera;
        const cameraPosition = camera.positionCartographic;
        let terrainHeight;
        try {
            terrainHeight = scene.globe.getHeight(cameraPosition);
        } catch (e) {
            return;
        }
        if (terrainHeight === null || terrainHeight === undefined || !isFinite(terrainHeight)) return;
        if (cameraPosition.height < terrainHeight + 4) return;
        lastSafeCamera = {
            longitude: cameraPosition.longitude,
            latitude: cameraPosition.latitude,
            height: cameraPosition.height,
            heading: camera.heading,
            pitch: camera.pitch,
            roll: camera.roll
        };
    }

    function recoverToSafeCamera() {
        const scene = getScene();
        if (!scene) return;
        stopNav();
        setPointerActive(false);
        if (isUndergroundMode() && window.indoor &&
            typeof window.indoor.setUnderground === 'function') {
            window.indoor.setUnderground(false);
        }

        const camera = scene.camera;
        const current = camera.positionCartographic;
        const saved = lastSafeCamera || {
            longitude: current.longitude,
            latitude: current.latitude,
            height: current.height,
            heading: camera.heading,
            pitch: -Math.PI / 6,
            roll: 0
        };
        const cartographic = new Cesium.Cartographic(saved.longitude, saved.latitude, 0);
        const terrain = groundAt(cartographic);
        camera.flyTo({
            destination: Cesium.Cartesian3.fromRadians(
                saved.longitude,
                saved.latitude,
                Math.max(saved.height, terrain + 15)
            ),
            orientation: {
                heading: saved.heading,
                pitch: saved.pitch,
                roll: saved.roll
            },
            duration: 0.8
        });
        if (scene.requestRender) scene.requestRender();
    }

    function isEditableTarget(target) {
        return !!(target && target.closest &&
            target.closest('input, select, textarea, [contenteditable="true"]'));
    }

    function pointerSpeedChanged() {
        const value = panel && panel.querySelector('#nav3d-pointer-speed-value');
        if (!value) return;
        value.textContent = pointerNav.speed + ' m/s';
    }

    function adjustPointerSpeed(direction) {
        const step = pointerNav.mode === 'walk' ? 1 : 5;
        const max = pointerNav.mode === 'walk' ? 12 : 100;
        pointerNav.speed = Cesium.Math.clamp(pointerNav.speed + direction * step, step, max);
        pointerSpeedChanged();
    }

    function adjustButtonStrength(direction) {
        buttonStrength = Cesium.Math.clamp(
            Math.round((buttonStrength + direction * 0.25) * 100) / 100,
            0.25, 2
        );
        const value = panel && panel.querySelector('#nav3d-button-strength-value');
        if (value) value.textContent = Math.round(buttonStrength * 100) + '%';
    }

    function applyPointerPose() {
        const scene = getScene();
        if (!scene || !pointerNav.active) return;
        const camera = scene.camera;
        const current = camera.positionCartographic;
        pointerNav.groundHeight = groundAt(current);
        pointerNav.lastGroundSampleAt = performance.now();
        pointerNav.lastGroundLongitude = current.longitude;
        pointerNav.lastGroundLatitude = current.latitude;
        const height = pointerNav.mode === 'walk'
            ? pointerNav.groundHeight + pointerNav.eyeHeight
            : pointerNav.groundHeight + pointerNav.height;
        camera.setView({
            destination: Cesium.Cartesian3.fromRadians(
                current.longitude, current.latitude, height
            ),
            orientation: {
                heading: pointerNav.heading,
                pitch: pointerNav.pitch,
                roll: 0
            }
        });
        if (scene.requestRender) scene.requestRender();
    }

    function stopPointerMovement() {
        if (pointerNav.raf) cancelAnimationFrame(pointerNav.raf);
        pointerNav.raf = 0;
        pointerNav.lastT = 0;
    }

    function updatePointerGround(scene, carto, now, moved) {
        if (!moved) return pointerNav.groundHeight;
        const latitudeDelta = carto.latitude - pointerNav.lastGroundLatitude;
        const longitudeDelta = Cesium.Math.negativePiToPi(
            carto.longitude - pointerNav.lastGroundLongitude
        );
        const movedMeters = pointerNav.lastGroundLongitude === null ? Infinity :
            Math.hypot(
                latitudeDelta * 110574,
                longitudeDelta * 111320 * Math.cos(carto.latitude)
            );
        if (now - pointerNav.lastGroundSampleAt < 250 && movedMeters < 5) {
            return pointerNav.groundHeight;
        }

        pointerNav.lastGroundSampleAt = now;
        pointerNav.lastGroundLongitude = carto.longitude;
        pointerNav.lastGroundLatitude = carto.latitude;
        let sample = null;
        try {
            sample = scene.globe && scene.globe.getHeight(carto);
        } catch (e) {
            return pointerNav.groundHeight;
        }
        if (sample !== null && sample !== undefined && isFinite(sample)) {
            pointerNav.groundHeight = sample;
        }
        return pointerNav.groundHeight;
    }

    function pointerMovementTick(now) {
        pointerNav.raf = 0;
        if (!pointerNav.active) return;
        const scene = getScene();
        if (!scene) {
            setPointerActive(false);
            return;
        }

        const forward = (pointerNav.keys.KeyW || pointerNav.keys.ArrowUp ? 1 : 0) -
            (pointerNav.keys.KeyS || pointerNav.keys.ArrowDown ? 1 : 0);
        const strafe = (pointerNav.keys.KeyD || pointerNav.keys.ArrowRight ? 1 : 0) -
            (pointerNav.keys.KeyA || pointerNav.keys.ArrowLeft ? 1 : 0);
        const dt = Math.min(0.1, pointerNav.lastT ? (now - pointerNav.lastT) / 1000 : 1 / 60);
        pointerNav.lastT = now;
        const magnitude = Math.hypot(forward, strafe);
        const targetForward = magnitude ? forward / magnitude : 0;
        const targetStrafe = magnitude ? strafe / magnitude : 0;
        const motionEase = 1 - Math.exp(-dt * (magnitude ? 7 : 12));
        pointerNav.velocityForward +=
            (targetForward - pointerNav.velocityForward) * motionEase;
        pointerNav.velocityStrafe +=
            (targetStrafe - pointerNav.velocityStrafe) * motionEase;

        let headingDelta = pointerNav.targetHeading - pointerNav.heading;
        if (headingDelta > Math.PI) headingDelta -= 2 * Math.PI;
        if (headingDelta < -Math.PI) headingDelta += 2 * Math.PI;
        const lookEase = 1 - Math.exp(-dt * 16);
        pointerNav.heading = Cesium.Math.zeroToTwoPi(
            pointerNav.heading + headingDelta * lookEase
        );
        pointerNav.pitch += (pointerNav.targetPitch - pointerNav.pitch) * lookEase;

        const distance = pointerNav.speed * (pointerNav.keys.ShiftLeft ||
            pointerNav.keys.ShiftRight ? 2 : 1) * dt;
        const east = (pointerNav.velocityForward * Math.sin(pointerNav.heading) +
            pointerNav.velocityStrafe * Math.cos(pointerNav.heading)) * distance;
        const north = (pointerNav.velocityForward * Math.cos(pointerNav.heading) -
            pointerNav.velocityStrafe * Math.sin(pointerNav.heading)) * distance;
        const camera = scene.camera;
        const position = camera.positionCartographic;
        const latitude = Cesium.Math.clamp(
            position.latitude + north / 110574,
            -Math.PI / 2 + 1e-6, Math.PI / 2 - 1e-6
        );
        const longitude = Cesium.Math.negativePiToPi(
            position.longitude + east / (111320 * Math.max(0.2, Math.cos(position.latitude)))
        );
        const hasMotion = Math.abs(east) > 1e-7 || Math.abs(north) > 1e-7;
        const terrain = updatePointerGround(
            scene, new Cesium.Cartographic(longitude, latitude, 0), now, hasMotion
        );
        const height = pointerNav.mode === 'walk'
            ? terrain + pointerNav.eyeHeight
            : terrain + pointerNav.height;
        const orientationChanged = Math.abs(headingDelta) > 1e-5 ||
            Math.abs(pointerNav.targetPitch - pointerNav.pitch) > 1e-5;
        if (hasMotion || orientationChanged) {
            camera.setView({
                destination: Cesium.Cartesian3.fromRadians(longitude, latitude, height),
                orientation: {
                    heading: pointerNav.heading,
                    pitch: pointerNav.pitch,
                    roll: 0
                }
            });
            if (scene.requestRender) scene.requestRender();
        }
        const settled = !magnitude &&
            Math.abs(pointerNav.velocityForward) < 0.003 &&
            Math.abs(pointerNav.velocityStrafe) < 0.003 &&
            Math.abs(headingDelta) < 0.001 &&
            Math.abs(pointerNav.targetPitch - pointerNav.pitch) < 0.001;
        if (settled) {
            pointerNav.velocityForward = 0;
            pointerNav.velocityStrafe = 0;
            pointerNav.lastT = 0;
            return;
        }
        pointerNav.raf = requestAnimationFrame(pointerMovementTick);
    }

    function startPointerMovement() {
        if (!pointerNav.raf) {
            pointerNav.lastT = 0;
            pointerNav.raf = requestAnimationFrame(pointerMovementTick);
        }
    }

    function onPointerKeyDown(ev) {
        if (!pointerNav.active || isEditableTarget(ev.target) || ev.ctrlKey ||
            ev.metaKey || ev.altKey) return;
        const key = ev.code;
        if (pointerNav.mode === 'fly' && (key === 'KeyQ' || key === 'KeyE')) {
            ev.preventDefault();
            ev.stopPropagation();
            const heights = [0.5, 2, 30, 300, 800];
            const currentIndex = heights.indexOf(pointerNav.height);
            const nextIndex = Cesium.Math.clamp(
                (currentIndex < 0 ? 0 : currentIndex) + (key === 'KeyE' ? 1 : -1),
                0, heights.length - 1
            );
            pointerNav.height = heights[nextIndex];
            const heightSelect = panel && panel.querySelector('#nav3d-pointer-height');
            if (heightSelect) heightSelect.value = String(pointerNav.height);
            applyPointerPose();
            return;
        }
        if (!/^(Key[WASD]|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|ShiftLeft|ShiftRight)$/.test(key)) return;
        ev.preventDefault();
        ev.stopPropagation();
        pointerNav.keys[key] = true;
        startPointerMovement();
    }

    function onPointerKeyUp(ev) {
        if (!pointerNav.active) return;
        if (pointerNav.keys[ev.code]) {
            pointerNav.keys[ev.code] = false;
            ev.preventDefault();
            ev.stopPropagation();
        }
    }

    function onPointerBlur() {
        pointerNav.keys = Object.create(null);
        pointerNav.dragPointer = null;
        stopPointerMovement();
    }

    function onPointerDown(ev) {
        if (!pointerNav.active || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
        pointerNav.dragPointer = ev.pointerId;
        pointerNav.lastX = ev.clientX;
        pointerNav.lastY = ev.clientY;
        if (pointerNav.canvas.setPointerCapture) {
            pointerNav.canvas.setPointerCapture(ev.pointerId);
        }
        ev.preventDefault();
        ev.stopPropagation();
    }

    function onPointerMove(ev) {
        if (!pointerNav.active || pointerNav.dragPointer !== ev.pointerId) return;
        const dx = ev.clientX - pointerNav.lastX;
        const dy = ev.clientY - pointerNav.lastY;
        pointerNav.lastX = ev.clientX;
        pointerNav.lastY = ev.clientY;
        pointerNav.targetHeading = Cesium.Math.zeroToTwoPi(
            pointerNav.targetHeading - dx * 0.004
        );
        const minPitch = pointerNav.mode === 'walk' ? -1.35 : -1.55;
        const maxPitch = pointerNav.mode === 'walk' ? 0.55 : 1.55;
        pointerNav.targetPitch = Cesium.Math.clamp(
            pointerNav.targetPitch - dy * 0.004, minPitch, maxPitch
        );
        startPointerMovement();
        ev.preventDefault();
        ev.stopPropagation();
    }

    function onPointerUp(ev) {
        if (pointerNav.dragPointer === ev.pointerId) pointerNav.dragPointer = null;
    }

    function updatePointerButton() {
        const button = panel && panel.querySelector('#nav3d-pointer-toggle');
        if (!button) return;
        button.textContent = 'P';
        button.setAttribute('aria-label', pointerNav.active ? 'Disable pointer' : 'Enable pointer');
        button.classList.toggle('nav3d-pointer-active', pointerNav.active);
        button.setAttribute('aria-pressed', String(pointerNav.active));
    }

    function ensurePointerReticle() {
        let reticle = document.getElementById('nav3d-reticle');
        const map = document.getElementById('map');
        if (!reticle && map) {
            reticle = document.createElement('div');
            reticle.id = 'nav3d-reticle';
            reticle.setAttribute('aria-hidden', 'true');
            reticle.innerHTML = '<style>' +
                '#nav3d-reticle{display:none;position:absolute;left:50%;top:50%;' +
                'width:18px;height:18px;transform:translate(-50%,-50%);' +
                'pointer-events:none;z-index:1199;border:1px solid rgba(255,255,255,.9);' +
                'border-radius:50%;box-shadow:0 0 2px #111}' +
                '#nav3d-reticle:before,#nav3d-reticle:after{content:"";position:absolute;' +
                'background:#fff;box-shadow:0 0 2px #111}' +
                '#nav3d-reticle:before{width:1px;height:6px;left:8px;top:-5px}' +
                '#nav3d-reticle:after{width:6px;height:1px;left:15px;top:8px}' +
                '#nav3d-reticle.nav3d-reticle-visible{display:block}' +
                '</style><span style="position:absolute;width:6px;height:1px;left:-4px;top:8px;' +
                'background:#fff;box-shadow:0 0 2px #111"></span>' +
                '<span style="position:absolute;width:1px;height:6px;left:8px;top:15px;' +
                'background:#fff;box-shadow:0 0 2px #111"></span>';
            map.appendChild(reticle);
        }
        return reticle;
    }

    function setPointerActive(active) {
        if (active === pointerNav.active) return;
        if (active) {
            const scene = getScene();
            if (!scene || !scene.canvas || !scene.screenSpaceCameraController) return;
            stopNav();
            pointerNav.canvas = scene.canvas;
            pointerNav.previousCursor = pointerNav.canvas.style.cursor;
            pointerNav.previousInputs = scene.screenSpaceCameraController.enableInputs;
            pointerNav.heading = scene.camera.heading;
            pointerNav.pitch = pointerNav.mode === 'walk'
                ? Cesium.Math.clamp(scene.camera.pitch, -1.35, 0.55)
                : Cesium.Math.clamp(scene.camera.pitch, -1.55, 1.55);
            pointerNav.targetHeading = pointerNav.heading;
            pointerNav.targetPitch = pointerNav.pitch;
            pointerNav.velocityForward = 0;
            pointerNav.velocityStrafe = 0;
            pointerNav.groundHeight = groundAt(scene.camera.positionCartographic);
            pointerNav.lastGroundSampleAt = performance.now();
            pointerNav.lastGroundLongitude = scene.camera.positionCartographic.longitude;
            pointerNav.lastGroundLatitude = scene.camera.positionCartographic.latitude;
            pointerNav.active = true;
            scene.screenSpaceCameraController.enableInputs = false;
            pointerNav.canvas.style.cursor = 'crosshair';
            pointerNav.canvas.addEventListener('pointerdown', onPointerDown);
            pointerNav.canvas.addEventListener('pointermove', onPointerMove);
            pointerNav.canvas.addEventListener('pointerup', onPointerUp);
            pointerNav.canvas.addEventListener('pointercancel', onPointerUp);
            window.addEventListener('keydown', onPointerKeyDown, true);
            window.addEventListener('keyup', onPointerKeyUp, true);
            window.addEventListener('blur', onPointerBlur);
            const reticle = ensurePointerReticle();
            if (reticle) reticle.classList.add('nav3d-reticle-visible');
            applyPointerPose();
        } else {
            const scene = getScene();
            pointerNav.active = false;
            pointerNav.keys = Object.create(null);
            stopPointerMovement();
            if (pointerNav.canvas) {
                pointerNav.canvas.style.cursor = pointerNav.previousCursor;
                pointerNav.canvas.removeEventListener('pointerdown', onPointerDown);
                pointerNav.canvas.removeEventListener('pointermove', onPointerMove);
                pointerNav.canvas.removeEventListener('pointerup', onPointerUp);
                pointerNav.canvas.removeEventListener('pointercancel', onPointerUp);
            }
            window.removeEventListener('keydown', onPointerKeyDown, true);
            window.removeEventListener('keyup', onPointerKeyUp, true);
            window.removeEventListener('blur', onPointerBlur);
            if (scene && scene.screenSpaceCameraController) {
                scene.screenSpaceCameraController.enableInputs = pointerNav.previousInputs;
            }
        }
        const reticle = document.getElementById('nav3d-reticle');
        if (reticle) reticle.classList.toggle('nav3d-reticle-visible', pointerNav.active);
        updatePointerButton();
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
    function shortestRoll(angle) {
        const cur = nav.cur ? nav.cur.roll : angle;
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
        // Preserve the camera's actual depth when the globe cannot be picked
        // from below the terrain; otherwise orbit around the surface.
        if (!isUndergroundMode() || carto.height >= gh) carto.height = gh;
        return carto;
    }

    /**
     * Capture the current camera pose as an orbit around the pivot:
     * { pivot, heading, pitch, roll, range } — the same convention as Cesium's
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
            roll: cam.roll,
            range: range
        };
    }

    function cloneState(s) {
        return {
            pivot: new Cesium.Cartographic(s.pivot.longitude, s.pivot.latitude, s.pivot.height),
            heading: s.heading, pitch: s.pitch, roll: s.roll, range: s.range
        };
    }

    /**
     * Place the camera from orbit state: pivot + range at heading/pitch,
     * looking back at the pivot. Terrain is intentionally not a camera
     * collision surface: bridges, tunnels, and below-ground routes stay navigable.
     */
    function applyOrbitState(state) {
        const scene = getScene();
        if (!scene || !state) return;

        const pivotCart = Cesium.Ellipsoid.WGS84.cartographicToCartesian(state.pivot);
        const enu = Cesium.Transforms.eastNorthUpToFixedFrame(pivotCart);
        const h = state.heading, p = state.pitch, r = state.range;
        const cp = Math.cos(p);
        const off = new Cesium.Cartesian3(
            -r * cp * Math.sin(h),
            -r * cp * Math.cos(h),
            -r * Math.sin(p)
        );
        const dest = Cesium.Matrix4.multiplyByPoint(enu, off, new Cesium.Cartesian3());

        scene.camera.setView({
            destination: dest,
            orientation: { heading: state.heading, pitch: state.pitch, roll: state.roll }
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
            // Keep the current depth below ground while panning underground.
            const rel = t.pivot.height - groundAt(t.pivot);
            t.pivot = new Cesium.Cartographic(nl, nlat, gh + rel);
        } else {
            t.pivot = new Cesium.Cartographic(nl, nlat, gh);
        }
    }

    /** Apply one full step for a tap. */
    function applyStep(act) {
        const t = nav.tgt;
        const strength = buttonStrength;
        const panStep = Math.max(CFG.panMinStepMeters, t.range * CFG.panStepRangeScale) * strength;
        const zoomFactor = Math.pow(CFG.zoomFactor, strength);
        switch (act) {
            case 'rot-left':  t.heading = shortestHeading(t.heading - toRad(CFG.rotateDegStep * strength)); break;
            case 'rot-right': t.heading = shortestHeading(t.heading + toRad(CFG.rotateDegStep * strength)); break;
            case 'roll-left': t.roll = shortestRoll(t.roll - toRad(CFG.rollDegStep * strength)); break;
            case 'roll-right': t.roll = shortestRoll(t.roll + toRad(CFG.rollDegStep * strength)); break;
            case 'tilt-up':   t.pitch = clampPitch(t.pitch + toRad(CFG.tiltDegStep * strength)); break;
            case 'tilt-down': t.pitch = clampPitch(t.pitch - toRad(CFG.tiltDegStep * strength)); break;
            case 'zoom-in':   t.range = clampRange(t.range * zoomFactor); break;
            case 'zoom-out':  t.range = clampRange(t.range / zoomFactor); break;
            case 'reset':
                t.heading = shortestHeading(0);
                t.pitch = toRad(-45);
                t.range = clampRange(Math.max(t.range, 200));
                break;
            case 'up':    moveTargetPivot(0, +panStep); break;
            case 'down':  moveTargetPivot(0, -panStep); break;
            case 'left':  moveTargetPivot(-panStep, 0); break;
            case 'right': moveTargetPivot(+panStep, 0); break;
        }
    }

    /** Apply continuous per-second rates while a button is held. */
    function applyHoldRates(dt) {
        if (!nav.act) return;
        const t = nav.tgt;
        const rotRate = toRad(CFG.rotateRateDeg * buttonStrength);
        const rollRate = toRad(CFG.rollRateDeg * buttonStrength);
        const tiltRate = toRad(CFG.tiltRateDeg * buttonStrength);
        const panRate = Math.max(CFG.panMinRateMeters, t.range * CFG.panRateRangeScale) * buttonStrength;
        const zoomK = Math.exp(-CFG.zoomRate * buttonStrength * dt); // per-frame zoom factor (in)
        switch (nav.act) {
            case 'rot-left':  t.heading = shortestHeading(t.heading - rotRate * dt); break;
            case 'rot-right': t.heading = shortestHeading(t.heading + rotRate * dt); break;
            case 'roll-left': t.roll = shortestRoll(t.roll - rollRate * dt); break;
            case 'roll-right': t.roll = shortestRoll(t.roll + rollRate * dt); break;
            case 'tilt-up':   t.pitch = clampPitch(t.pitch + tiltRate * dt); break;
            case 'tilt-down': t.pitch = clampPitch(t.pitch - tiltRate * dt); break;
            case 'zoom-in':   t.range = clampRange(t.range * zoomK); break;
            case 'zoom-out':  t.range = clampRange(t.range / zoomK); break;
            case 'reset': break; // reset is tap-only
            case 'up':    moveTargetPivot(0, +panRate * dt); break;
            case 'down':  moveTargetPivot(0, -panRate * dt); break;
            case 'left':  moveTargetPivot(-panRate * dt, 0); break;
            case 'right': moveTargetPivot(+panRate * dt, 0); break;
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
        nav.cur.roll += (shortestRoll(nav.tgt.roll) - nav.cur.roll) * k;
        nav.cur.range += (nav.tgt.range - nav.cur.range) * k;
        nav.cur.pivot.longitude += (nav.tgt.pivot.longitude - nav.cur.pivot.longitude) * k;
        nav.cur.pivot.latitude += (nav.tgt.pivot.latitude - nav.cur.pivot.latitude) * k;
        nav.cur.pivot.height += (nav.tgt.pivot.height - nav.cur.pivot.height) * k;

        applyOrbitState(nav.cur);

        // ol-cesium's auto render loop puts the scene in
        // `requestRenderMode`: Cesium only draws when a render is requested
        // (ol-cesium does that from canvas mouse events). The glide drives the
        // camera from a rAF loop that no pointer event accompanies, so without
        // this the movement was computed but never painted until the next
        // click — the pad looked frozen.
        if (scene.requestRender) scene.requestRender();

        // Stop the loop once the pointer is released and we have converged
        const settled = !holding &&
            Math.abs(nav.tgt.heading - nav.cur.heading) < 1e-4 &&
            Math.abs(nav.tgt.pitch - nav.cur.pitch) < 1e-4 &&
            Math.abs(shortestRoll(nav.tgt.roll) - nav.cur.roll) < 1e-4 &&
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

    function refreshLayerSelector() {
        const selector = document.getElementById('nav3d-layer-select');
        if (!selector || !window.modelRenderer ||
            typeof window.modelRenderer.getAvailableOsmLayers !== 'function') return;
        const selected = window.modelRenderer.activeOsmLayer;
        selector.innerHTML = '';
        const all = document.createElement('option');
        all.value = '';
        all.textContent = 'All layers';
        selector.appendChild(all);
        window.modelRenderer.getAvailableOsmLayers().forEach(function(layer) {
            const option = document.createElement('option');
            option.value = layer;
            option.textContent = 'Layer ' + layer;
            selector.appendChild(option);
        });
        selector.value = selected === null ? '' : String(selected);
    }

    let watchedLayerMap = null;
    function watchLayerMap() {
        if (!window.map || typeof window.map.on !== 'function' || watchedLayerMap === window.map) return;
        watchedLayerMap = window.map;
        watchedLayerMap.on('addlayer', refreshLayerSelector);
        watchedLayerMap.on('removelayer', refreshLayerSelector);
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
                    position: absolute; right: 8px; top: 122px; z-index: 1200;
                    background: rgba(255,255,255,0.96); border-radius: 6px;
                    box-shadow: 0 1px 5px rgba(0,0,0,0.2);
                    padding: 4px; user-select: none; font-family: sans-serif;
                    display: none; touch-action: none; max-height: calc(100vh - 140px);
                    overflow-y: auto;
                }
                #nav3d-controls.nav3d-visible { display: block; }
                #nav3d-controls .nav3d-grid {
                    display: grid; grid-template-columns: repeat(3, 24px);
                    gap: 2px; justify-items: center;
                }
                #nav3d-controls button {
                    width: 24px; height: 23px; border: 1px solid #bbb;
                    border-radius: 4px; background: #fff; cursor: pointer;
                    font-size: 12px; line-height: 1; padding: 0;
                }
                #nav3d-controls button:hover { background: #e8f0fe; }
                #nav3d-controls button:active { background: #c8daf8; }
                #nav3d-controls .nav3d-row2 { display: flex; flex-wrap: wrap; gap: 2px; margin-top: 3px; justify-content: center; }
                #nav3d-controls .nav3d-row2 button { width: 24px; height: 23px; }
                #nav3d-controls #nav3d-indoor-btn.nav3d-indoor-active {
                    background: #c8e6c9; border-color: #2e7d32;
                }
                #nav3d-controls #nav3d-flat-ground-btn {
                    font-size: 7px; letter-spacing: -0.4px;
                }
                #nav3d-controls #nav3d-flat-ground-btn.nav3d-flat-ground-active {
                    background: #c8e6c9; border-color: #2e7d32;
                }
                #nav3d-controls .nav3d-title {
                    text-align: center; font-size: 9px; color: #555; margin-bottom: 2px;
                }
                #nav3d-controls .nav3d-pointer-settings {
                    border-bottom: 1px solid #ddd; margin-bottom: 3px; padding-bottom: 3px;
                }
                #nav3d-controls .nav3d-actions {
                    display: flex; justify-content: center; gap: 2px; margin-bottom: 2px;
                }
                #nav3d-controls .nav3d-actions button {
                    width: 24px; height: 23px; font-size: 11px;
                }
                #nav3d-controls #nav3d-pointer-toggle {
                    border-color: #1a73e8; color: #174ea6;
                }
                #nav3d-controls #nav3d-pointer-toggle.nav3d-pointer-active {
                    background: #c8daf8;
                }
                #nav3d-controls .nav3d-pointer-setting {
                    display: grid; grid-template-columns: 58px auto; align-items: center;
                    gap: 2px; margin-top: 2px; font: 9px sans-serif; color: #444;
                }
                #nav3d-controls .nav3d-pointer-setting select {
                    width: 82px; height: 19px; padding: 0 2px; font-size: 9px;
                }
                #nav3d-controls .nav3d-stepper {
                    display: flex; align-items: center; justify-content: space-between;
                    gap: 2px; width: 82px;
                }
                #nav3d-controls .nav3d-stepper button {
                    width: 20px; height: 19px; font-size: 11px;
                }
                #nav3d-controls .nav3d-stepper output {
                    min-width: 32px; text-align: center; font-size: 9px;
                }
                #nav3d-controls .nav3d-pointer-help {
                    display: block; max-width: 150px; margin-top: 2px;
                    text-align: center; font: 8px sans-serif; color: #666;
                }
                #nav3d-controls .nav3d-level-select,
                #nav3d-controls .nav3d-layer-select {
                    display: flex; align-items: center; gap: 3px; margin-top: 2px;
                    font: 9px sans-serif; color: #444;
                }
                #nav3d-controls .nav3d-level-select select,
                #nav3d-controls .nav3d-layer-select select {
                    min-width: 78px; max-width: 110px; height: 19px; padding: 0 2px;
                    font-size: 9px; border: 1px solid #bbb; border-radius: 4px; background: #fff;
                }
            </style>
            <div class="nav3d-title">3D navigation</div>
            <div class="nav3d-pointer-settings">
                <div class="nav3d-actions">
                    <button id="nav3d-pointer-toggle" type="button" aria-label="Enable pointer" title="Enable pointer" aria-pressed="false">P</button>
                    <button id="nav3d-recover-view" type="button" aria-label="Return to last safe view" title="Return to last safe view">↩</button>
                </div>
                <label class="nav3d-pointer-setting">
                    Mode
                    <select id="nav3d-pointer-mode" aria-label="Pointer navigation mode">
                        <option value="walk">Walk</option>
                        <option value="fly">Car / drone</option>
                    </select>
                </label>
                <label class="nav3d-pointer-setting">
                    Button strength
                    <span class="nav3d-stepper">
                        <button id="nav3d-strength-down" type="button" aria-label="Decrease button strength">−</button>
                        <output id="nav3d-button-strength-value">100%</output>
                        <button id="nav3d-strength-up" type="button" aria-label="Increase button strength">+</button>
                    </span>
                </label>
                <label class="nav3d-pointer-setting">
                    Speed
                    <span class="nav3d-stepper">
                        <button id="nav3d-speed-down" type="button" aria-label="Decrease pointer speed">−</button>
                        <output id="nav3d-pointer-speed-value">2 m/s</output>
                        <button id="nav3d-speed-up" type="button" aria-label="Increase pointer speed">+</button>
                    </span>
                </label>
                <label class="nav3d-pointer-setting" id="nav3d-pointer-walk-height-setting">
                    Walk height
                    <select id="nav3d-pointer-walk-height" aria-label="Walking camera height above ground">
                        <option value="0.4">Low clearance</option>
                        <option value="1">Low</option>
                        <option value="1.7" selected>Normal</option>
                        <option value="2.4">High</option>
                    </select>
                </label>
                <label class="nav3d-pointer-setting" id="nav3d-pointer-height-setting" style="display:none">
                    Flight height
                    <select id="nav3d-pointer-height" aria-label="Flight height above ground">
                        <option value="0.5">Near ground</option>
                        <option value="2">Street</option>
                        <option value="30">Low</option>
                        <option value="300">Sky</option>
                        <option value="800">High sky</option>
                    </select>
                </label>
                <small class="nav3d-pointer-help">WASD / arrows move · drag to look · Q/E change fly height</small>
            </div>
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
                <button data-act="roll-left" title="Roll left">&#8634;</button>
                <button data-act="roll-right" title="Roll right">&#8635;</button>
                <button id="nav3d-indoor-btn" title="Show / hide indoor view (Simple Indoor Tagging)">&#127963;</button>
                <button id="nav3d-flat-ground-btn" type="button" aria-label="Disable DEM and flatten ground" aria-pressed="false" title="Disable DEM and flatten ground">DEM</button>
            </div>
            <label class="nav3d-level-select" style="display:none">
                Level
                <select id="nav3d-level-select" aria-label="Select indoor level"></select>
            </label>
            <label class="nav3d-layer-select">
                Layer
                <select id="nav3d-layer-select" aria-label="Select OSM layer"></select>
            </label>
        `;
        document.body.appendChild(panel);
        const pointerToggle = panel.querySelector('#nav3d-pointer-toggle');
        const pointerMode = panel.querySelector('#nav3d-pointer-mode');
        const pointerHeight = panel.querySelector('#nav3d-pointer-height');
        const pointerHeightSetting = panel.querySelector('#nav3d-pointer-height-setting');
        const pointerWalkHeight = panel.querySelector('#nav3d-pointer-walk-height');
        const pointerWalkHeightSetting = panel.querySelector('#nav3d-pointer-walk-height-setting');
        const recoverView = panel.querySelector('#nav3d-recover-view');
        pointerToggle.addEventListener('click', function () {
            setPointerActive(!pointerNav.active);
        });
        recoverView.addEventListener('click', recoverToSafeCamera);
        pointerMode.addEventListener('change', function () {
            const wasActive = pointerNav.active;
            if (wasActive) setPointerActive(false);
            pointerNav.mode = pointerMode.value;
            pointerNav.speed = pointerNav.mode === 'walk' ? 2 : 30;
            pointerHeightSetting.style.display = pointerNav.mode === 'fly' ? 'flex' : 'none';
            pointerWalkHeightSetting.style.display = pointerNav.mode === 'walk' ? 'flex' : 'none';
            pointerSpeedChanged();
            if (wasActive) setPointerActive(true);
        });
        panel.querySelector('#nav3d-speed-down').addEventListener('click', function () {
            adjustPointerSpeed(-1);
        });
        panel.querySelector('#nav3d-speed-up').addEventListener('click', function () {
            adjustPointerSpeed(1);
        });
        panel.querySelector('#nav3d-strength-down').addEventListener('click', function () {
            adjustButtonStrength(-1);
        });
        panel.querySelector('#nav3d-strength-up').addEventListener('click', function () {
            adjustButtonStrength(1);
        });
        pointerHeight.addEventListener('change', function () {
            pointerNav.height = Number(pointerHeight.value);
            if (pointerNav.active) applyPointerPose();
        });
        pointerWalkHeight.addEventListener('change', function () {
            pointerNav.eyeHeight = Number(pointerWalkHeight.value);
            if (pointerNav.active) applyPointerPose();
        });
        watchLayerMap();
        refreshLayerSelector();
        if (window.indoor && typeof window.indoor.refreshLevelSelector === 'function') {
            window.indoor.refreshLevelSelector();
        }

        const levelSelect = panel.querySelector('#nav3d-level-select');
        if (levelSelect) {
            levelSelect.addEventListener('change', function (ev) {
                ev.stopPropagation();
                if (window.indoor && typeof window.indoor.setActiveLevel === 'function') {
                    window.indoor.setActiveLevel(levelSelect.value || null);
                }
            });
        }
        const layerSelect = panel.querySelector('#nav3d-layer-select');
        if (layerSelect) {
            layerSelect.addEventListener('change', function (ev) {
                ev.stopPropagation();
                if (window.modelRenderer && typeof window.modelRenderer.setActiveOsmLayer === 'function') {
                    window.modelRenderer.setActiveOsmLayer(layerSelect.value || null);
                }
            });
        }
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
        const flatGroundBtn = panel.querySelector('#nav3d-flat-ground-btn');
        const updateFlatGroundButton = function (enabled) {
            flatGroundBtn.classList.toggle('nav3d-flat-ground-active', enabled);
            flatGroundBtn.setAttribute('aria-pressed', String(enabled));
            const label = enabled
                ? 'Enable DEM terrain'
                : 'Disable DEM and flatten ground';
            flatGroundBtn.title = label;
            flatGroundBtn.setAttribute('aria-label', label);
        };
        if (window.mapterhornTerrain &&
            typeof window.mapterhornTerrain.isFlatGroundMode === 'function') {
            updateFlatGroundButton(window.mapterhornTerrain.isFlatGroundMode());
        } else {
            flatGroundBtn.disabled = true;
            console.error('3D navigation: flat-ground mode is unavailable (terrain module not loaded)');
        }
        flatGroundBtn.addEventListener('click', function (ev) {
            ev.stopPropagation();
            if (!window.mapterhornTerrain ||
                typeof window.mapterhornTerrain.setFlatGroundMode !== 'function') {
                console.error('3D navigation: cannot toggle flat-ground mode (terrain module not loaded)');
                return;
            }
            const enabled = !window.mapterhornTerrain.isFlatGroundMode();
            if (!window.mapterhornTerrain.setFlatGroundMode(enabled)) {
                console.error('3D navigation: failed to change flat-ground mode');
                return;
            }
            updateFlatGroundButton(enabled);
        });
        window.addEventListener('mapterhornFlatGroundChanged', function (ev) {
            updateFlatGroundButton(!!(ev.detail && ev.detail.enabled));
        });
        // Pointer-based input: tap = one animated step, hold = continuous
        panel.addEventListener('pointerdown', function (ev) {
            const btn = ev.target.closest('button');
            if (!btn || !btn.getAttribute('data-act')) return;
            if (pointerNav.active) return;
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
            setPointerActive(false);
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
     * - Camera collision is disabled so mouse/touch navigation can pass under
     *   bridges and below the terrain.
     */
    function tuneCesiumController() {
        const scene = getScene();
        if (!scene || !scene.screenSpaceCameraController) return;
        const c = scene.screenSpaceCameraController;
        try {
            c.inertiaSpin = 0.65;      // drag rotation momentum
            c.inertiaTranslate = 0.65; // drag pan momentum
            c.inertiaZoom = 0.5;       // wheel/pinch momentum (worst offender)
            c.enableCollisionDetection = false;
            c.minimumZoomDistance = 0;
            if (watchedCamera !== scene.camera) {
                if (watchedCamera && watchedCamera.changed &&
                    watchedCamera.changed.removeEventListener) {
                    watchedCamera.changed.removeEventListener(rememberSafeCamera);
                }
                watchedCamera = scene.camera;
                if (watchedCamera.changed && watchedCamera.changed.addEventListener) {
                    watchedCamera.changed.addEventListener(rememberSafeCamera);
                }
            }
        } catch (e) { /* older build without some fields */ }
        rememberSafeCamera();
    }

    // Toggle visibility whenever the 3D mode is enabled/disabled.
    window.addEventListener('ol3dInitialized', function () {
        tuneCesiumController();
        setTimeout(updateVisibility, 100);
    });
    window.addEventListener('ol3dDestroyed', function () {
        setPointerActive(false);
        stopNav();
        if (watchedCamera && watchedCamera.changed &&
            watchedCamera.changed.removeEventListener) {
            watchedCamera.changed.removeEventListener(rememberSafeCamera);
        }
        watchedCamera = null;
        lastSafeCamera = null;
        lastSafeCameraCheck = 0;
        setTimeout(updateVisibility, 100);
    });

    function onLayerDataChanged() {
        watchLayerMap();
        refreshLayerSelector();
    }

    ['overlayFeaturesLoaded', 'tagQueryAdded', 'tagQueryRemoved', 'tagOverlayLoaded', 'osm3d:modelsPlaced']
        .forEach(function(eventName) {
            window.addEventListener(eventName, onLayerDataChanged);
        });

    // Also poll briefly at startup in case events fired before we loaded.
    let tries = 0;
    const t = setInterval(function () {
        updateVisibility();
        if (++tries > 40) clearInterval(t);
    }, 500);

    console.log('🕹️ 3D navigation controls loaded (smooth orbit mode)');
})();
