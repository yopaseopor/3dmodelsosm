// Headless regression check for memory management on large (>1MB) GeoJSON.
//
// Loads the REAL src/model_renderer.js into a vm sandbox with stubbed browser
// globals and drives the real placement path (addModelForFeature,
// addRepetitionModel, addAreaTexture, unloadDistantModels, ensureBudget).
// Nothing here is imported by the app.
//
// Each check below corresponds to a defect that was measured, not assumed:
//   1. the model cap never fired          (totalModelsAdded was never incremented)
//   2. re-sweeps duplicated the scene     (repetition keys used a counter)
//   3. repetitions ignored the range gate (the gate was inside a // comment)
//   4. area textures were untracked       (addAreaTexture returned nothing)
//   5. nothing was ever unloaded          (unloadDistance had no readers)
//
// Run: node tools/check_memory_large_file.js
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

function makeStubs() {
    const removed = [];
    const scene = {
        primitives: {
            _items: [],
            add(p) { this._items.push(p); return p; },
            remove(p) {
                const i = this._items.indexOf(p);
                if (i > -1) this._items.splice(i, 1);
                removed.push(p);
                return true;
            },
            get length() { return this._items.length; }
        },
        camera: {
            positionCartographic: { longitude: 0.0174, latitude: 0.7299, height: 300 },
            changed: { addEventListener() {} },
            percentageChanged: 0
        }
    };

    const colour = { withAlpha() { return colour; } };
    const Cesium = {
        Color: { fromCssColorString: () => colour },
        MaterialAppearance: Object.assign(
            function (o) { this.material = o.material; },
            { MaterialSupport: { TEXTURED: { vertexFormat: 'vertexFormat' } } }
        ),
        HeightReference: { NONE: 0, CLAMP_TO_GROUND: 1 },
        Intersect: { OUTSIDE: 0, INSIDE: 1 },
        Math: { toDegrees: r => r * 180 / Math.PI, toRadians: d => d * Math.PI / 180 },
        Cartesian3: {
            fromDegrees(lon, lat, h) { return { x: lon, y: lat, z: h || 0, _lonlat: [lon, lat, h || 0] }; },
            // Degrees in x/y, METRES in z. Converting the height difference by
            // the degrees-to-metres factor as well makes a 300 m camera height
            // read as 33 000 km, which puts every feature far outside every
            // range gate and makes the whole harness vacuous.
            distance(a, b) {
                const dx = (a.x - b.x) * 111320;
                const dy = (a.y - b.y) * 111320;
                const dz = a.z - b.z;
                return Math.sqrt(dx * dx + dy * dy + dz * dz);
            }
        },
        Cartesian2: function (x, y) { this.x = x; this.y = y; },
        Cartographic: {
            fromDegrees(lon, lat, h) { return { longitude: lon, latitude: lat, height: h || 0 }; },
            toCartesian(c) { return { x: c.longitude, y: c.latitude, z: c.height }; },
            fromCartesian(c) { return { longitude: c.x, latitude: c.y, height: c.z }; }
        },
        BoundingSphere: function (centre, r) { this.centre = centre; this.radius = r; },
        Transforms: { eastNorthUpToFixedFrame: p => ({ _p: p }) },
        Matrix3: { fromRotationZ: () => ({}) },
        Matrix4: {
            multiplyByMatrix3: m => m,
            setTranslation: (m, p) => m,
            getColumn: (m, i) => ({ x: 0, y: 0, z: 0 })
        },
        Model: { fromGltf: opts => ({ __gltf: opts.url, isDestroyed: () => false, readyPromise: Promise.resolve(opts.url) }) },
        PolygonHierarchy: function (positions, holes) { this.positions = positions; this.holes = holes; },
        GeometryInstance: function (o) { this.geometry = o.geometry; },
        PolygonGeometry: function (o) {
            this.hierarchy = o.polygonHierarchy;
            this.options = o;
        },
        Material: function (o) { this.fabric = o.fabric; },
        GroundPrimitive: function (o) { this.__gp = o; this.isDestroyed = () => false; },
        Entity: function () {}
    };

    // Frustum that culls like a real zoomed-in camera: anything past
    // VISIBLE_RADIUS_M is OUTSIDE. The placement gate is
    // `far && !visible`, so with a frustum that never culls NOTHING is ever
    // range-gated and this harness proves nothing.
    const VISIBLE_RADIUS_M = 1200;
    scene.camera.frustum = {
        computeCullingVolume(cameraPosition, cameraDirection, cameraUp) {
            return {
                computeVisibility(sphere) {
                    const lon = sphere.centre._lonlat[0];
                    const lat = sphere.centre._lonlat[1];
                    const d = Math.sqrt(
                        Math.pow((lon - 0.0174) * 111320, 2) +
                        Math.pow((lat - 0.7299) * 111320, 2));
                    return d <= VISIBLE_RADIUS_M ? Cesium.Intersect.INSIDE : Cesium.Intersect.OUTSIDE;
                }
            };
        }
    };

    const ol = {
        proj: {
            // Pretend the view projection is degrees scaled by 1.0 so the
            // stubs stay trivial; only ordering matters for the checks.
            toLonLat(c) { return [c[0], c[1]]; },
            transform(c) { return c; },
            get: () => 'EPSG:4326'
        },
        extent: {
            getCenter(e) { return [(e[0] + e[2]) / 2, (e[1] + e[3]) / 2]; }
        }
    };

    const listeners = {};
    const windowStub = {
        addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
        dispatch(name) { (listeners[name] || []).forEach(f => f()); },
        ol3d: { getCesiumScene: () => scene, getEnabled: () => true },
        map: {
            getLayers: () => ({ getArray: () => [] }),
            getView: () => ({ getProjection: () => 'EPSG:4326' }),
            addLayer: function () {},
            removeLayer: function () {}
        },
        is3d: true,
        _listeners: listeners
    };

    const canvases = [];
    const documentStub = {
        createElement: () => {
            const canvas = makeCanvas();
            canvases.push(canvas);
            return canvas;
        }
    };

    return { Cesium, ol, scene, removed, windowStub, documentStub, canvases };
}

function makeCanvas() {
    const canvas = {
        width: 0, height: 0,
        rotation: null,
        getContext() {
            return {
                translate() {},
                rotate(angle) { canvas.rotation = angle; },
                drawImage() {}
            };
        },
        toDataURL: () => 'data:image/jpeg;base64,'
    };
    return canvas;
}

/** Minimal OL feature/geometry pair. */
let uidSeq = 0;
function makeFeature(lon, lat, props, geometryType) {
    const store = Object.assign({}, props);
    const geometry = {
        _t: geometryType || 'Point',
        getType() { return this._t; },
        getCoordinates() { return [lon, lat]; },
        getExtent() { return [lon, lat, lon, lat]; }
    };
    return {
        _uid: ++uidSeq,
        get(k) { return store[k]; },
        set(k, v) { store[k] = v; },
        getKeys() { return Object.keys(store); },
        getProperties() { return store; },
        getGeometry() { return geometry; },
        getId() { return undefined; },
        getUid() { return this._uid; }
    };
}

/** metres east/north of the camera, expressed as degrees of stub space */
function offset(metresEast, metresNorth) {
    return [0.0174 + metresEast / 111320, 0.7299 + metresNorth / 111320];
}

// ---------------------------------------------------------------------------
// Load the real renderer
// ---------------------------------------------------------------------------
function loadRenderer() {
    const stubs = makeStubs();
    const sandbox = {
        window: stubs.windowStub,
        document: stubs.documentStub,
        Cesium: stubs.Cesium,
        ol: stubs.ol,
        console: { log() {}, warn() {}, error() {} },
        setTimeout: () => 0,
        clearTimeout: () => {},
        setInterval: () => 0,
        clearInterval: () => {},
        requestAnimationFrame: () => 0,
        Promise,
        // addAreaTexture builds the primitive inside img.onload, so the stub
        // has to fire it or nothing is ever created.
        Image: function () {
            const self = this;
            this.width = 8; this.height = 8;
            Object.defineProperty(this, 'src', {
                set(uri) {
                    const textureUri = String(uri).toLowerCase();
                    if (textureUri.includes('i_crossing.png') || textureUri.includes('i_parking.png')) {
                        self.width = 250;
                        self.height = 500;
                    }
                    if (typeof self.onload === 'function') self.onload();
                }
            });
        },
        isFinite,
        Math,
        JSON,
        Date,
        Array,
        Object,
        String,
        Number,
        Infinity,
        NaN,
        Float32Array
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(process.env.MODEL_RENDERER_PATH || path.join(SRC, 'model_renderer.js'), 'utf8'),
        sandbox, { filename: 'model_renderer.js' });
    return { renderer: sandbox.window.modelRenderer, stubs, sandbox };
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------
const results = [];
const pending = [];
function check(name, fn) {
    // A check that hands back a promise is tracked separately so the reporter
    // waits for it. A sync throw is a failure, never a silent pass.
    try {
        const out = fn();
        if (out && typeof out.then === 'function') {
            pending.push(out.then(
                () => results.push({ name, ok: true }),
                e => results.push({ name, ok: false, why: e && e.message })
            ));
        } else {
            results.push({ name, ok: true });
        }
    } catch (e) {
        results.push({ name, ok: false, why: e && e.message });
    }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) {
    if (a !== b) throw new Error((msg || 'not equal') + ': expected ' + b + ', got ' + a);
}

// --- 1. the cap actually fires -------------------------------------------
check('hard primitive budget is enforced (cap used to never fire)', () => {
    const { renderer, stubs } = loadRenderer();
    renderer._session3dId = 1;

    const model = { uri: 'src/models/w_highway_street_lamp.glb' };
    let peak = 0;
    // Enough features to blow through the budget, all inside the placement
    // range (they have to be, or the range gate culls them and the budget is
    // never exercised). The gate is now 5km, so this grid has to be bigger.
    const budget = 30000;
    for (let i = 0; i < 40000; i++) {
        const p = offset((i % 200) * 12, Math.floor(i / 200) * 12);
        const f = makeFeature(p[0], p[1], { osm3dModel: model });
        renderer.addModelForFeature(f, i, stubs.scene, { get: () => 'test' });
        if (renderer.liveTotal > peak) peak = renderer.liveTotal;
    }
    assert(peak <= budget, 'peak live primitives ' + peak + ' exceeded the budget of ' + budget);
    assert(peak > budget * 0.8, 'the budget was never approached (peak ' + peak + '), so this proves nothing');
    eq(renderer.liveTotal, stubs.scene.primitives.length, 'census must match scene contents');
    assert(renderer.evictions > 0, 'the budget was exceeded but nothing was evicted');
});

// --- 1b. the ceiling is adjustable at runtime ----------------------------
check('the budget can be raised live without editing the file', () => {
    const { renderer, stubs } = loadRenderer();
    renderer._session3dId = 1;
    const model = { uri: 'src/models/w_highway_street_lamp.glb' };
    const place = n => {
        for (let i = 0; i < n; i++) {
            const p = offset((i % 200) * 12, Math.floor(i / 200) * 12);
            renderer.addModelForFeature(makeFeature(p[0], p[1], { osm3dModel: model }), i, stubs.scene, { get: () => 't' });
        }
    };
    place(40000);
    const capped = renderer.liveTotal;
    assert(capped <= 30000, 'default ceiling ignored: ' + capped);

    renderer.setBudget(45000);
    eq(renderer.liveTotal, capped, 'raising the ceiling must not drop anything');

    // With room now, the same workload must be allowed through.
    place(40000);
    assert(renderer.liveTotal > capped,
        'raising the ceiling to 45000 did not admit more than the old cap (' + renderer.liveTotal + ')');
    assert(renderer.liveTotal <= 45000, 'the new ceiling of 45000 was exceeded: ' + renderer.liveTotal);

    const before = renderer.liveTotal;
    renderer.setBudget('nonsense');
    eq(renderer.liveTotal, before, 'setBudget with a bad value must be a no-op');
    eq(renderer.memoryReport().indexOf('45000') > -1, true, 'report does not show the new ceiling');
});

// --- 2. re-sweeps do not duplicate ---------------------------------------
// NOTE: this one also passes against the pre-fix code. Base-model dedupe
// already worked (the old synthesised key was stable), so this is a GUARD
// against getFeatureKey breaking it, not proof of a fix.
check('GUARD: a second sweep over the same features adds nothing', () => {
    const { renderer, stubs } = loadRenderer();
    renderer._session3dId = 1;
    const model = { uri: 'src/models/w_highway_street_lamp.glb' };
    const features = [];
    for (let i = 0; i < 300; i++) {
        const p = offset(i * 5, 0);
        const f = makeFeature(p[0], p[1], { osm3dModel: model });
        features.push(f);
        renderer.addModelForFeature(f, i, stubs.scene, { get: () => 'test' });
    }
    const afterFirst = stubs.scene.primitives.length;
    for (let i = 0; i < features.length; i++) {
        renderer.addModelForFeature(features[i], i, stubs.scene, { get: () => 'test' });
    }
    eq(stubs.scene.primitives.length, afterFirst, 'second sweep duplicated the scene');
});

// --- 3. repetition keys are stable ---------------------------------------
check('repetition primitives are deduped across sweeps', () => {
    const { renderer, stubs } = loadRenderer();
    renderer._session3dId = 1;
    const [lon, lat] = offset(100, 0);
    const f = makeFeature(lon, lat, {
        repetition_0_position: [lon, lat],
        repetition_0_rotation: [0, 0, 0],
        repetition_0_heightOffset: 0,
        repetition_0_uri: 'src/models/w_railway_rail.glb'
    });
    const rep = { uri: 'src/models/w_railway_rail.glb', scale: 1 };
    renderer.addRepetitionModel(f, 0, rep, stubs.scene);
    eq(stubs.scene.primitives.length, 1, 'first placement');
    renderer.addRepetitionModel(f, 0, rep, stubs.scene);
    renderer.addRepetitionModel(f, 0, rep, stubs.scene);
    eq(stubs.scene.primitives.length, 1, 're-sweep duplicated the repetition');
    eq(renderer.liveByKind.repetition, 1, 'repetition census');
});

// --- 4. repetition range gate --------------------------------------------
check('repetitions far from the camera are not placed (gate was in a comment)', () => {
    const { renderer, stubs } = loadRenderer();
    renderer._session3dId = 1;
    const [lon, lat] = offset(20000, 0);          // 20 km away
    const f = makeFeature(lon, lat, {
        repetition_0_position: [lon, lat],
        repetition_0_rotation: [0, 0, 0]
    });
    renderer.addRepetitionModel(f, 0, { uri: 'src/models/w_railway_rail.glb' }, stubs.scene);
    eq(stubs.scene.primitives.length, 0, 'a 20km-distant repetition was placed');
    eq(renderer.liveTotal, 0, 'and it was counted');
});

// --- 5. area textures are tracked and destroyable ------------------------
check('area-texture GroundPrimitives are tracked and released', () => {
    const { renderer, stubs } = loadRenderer();
    renderer._session3dId = 1;
    const [lon, lat] = offset(50, 0);
    const f = makeFeature(lon, lat, {
        repetition_0_type: 'polygon_texture',
        repetition_0_polygonCoordinates: [[lon - 0.0005, lat - 0.0005], [lon + 0.0005, lat - 0.0005], [lon + 0.0005, lat + 0.0005]],
        repetition_0_polygonHoles: [],
        repetition_0_spacing: 1.0
    });
    renderer.calculateTextureRotation = () => 0;
    renderer.addRepetitionModel(f, 0, { uri: 'i_asfalt.jpg', scale: 1 }, stubs.scene);

    assert(renderer.liveByKind.texture >= 1, 'area texture was not counted');
    assert(stubs.scene.primitives.length >= 1, 'no GroundPrimitive reached the scene');
    eq(renderer.liveTotal, renderer.loadedModels.size, 'census drifted');

    const before = stubs.scene.primitives.length;
    Array.from(renderer.loadedModels.keys()).forEach(k => renderer.unloadEntry(k, stubs.scene));
    eq(stubs.scene.primitives.length, 0, 'area texture was not removed from the scene');
    eq(renderer.liveTotal, 0, 'area texture was still counted after unload');
});

check('large footway texture repeats its native-resolution tile along the way', () => {
    const { renderer, stubs } = loadRenderer();
    const polygon = [
        [-0.0005, -0.0005],
        [0.0005, -0.0005],
        [0.0005, 0.0005],
        [-0.0005, 0.0005],
        [-0.0005, -0.0005]
    ];
    const way = (tags, coordinates) => ({
        get(key) { return tags[key]; },
        getGeometry() {
            return {
                getType: () => 'LineString',
                getCoordinates: () => coordinates
            };
        }
    });
    const footway = way({ highway: 'footway' }, [
        [-0.001, -0.001],
        [0.001, 0.001]
    ]);
    const crossingRoad = way({ highway: 'residential' }, [
        [-0.001, 0],
        [0.001, 0]
    ]);
    stubs.windowStub.map.getLayers = () => ({
        getArray: () => [{
            getSource: () => ({ getFeatures: () => [crossingRoad, footway] })
        }]
    });

    const textureRotation = renderer.calculateTextureRotation(
        polygon,
        'i_llamborda.jpg',
        { 'area:highway': 'footway' }
    );
    assert(Math.abs(textureRotation + Math.PI / 4) < 1e-8,
        'texture angle did not come from the nearby diagonal footway: ' + textureRotation);

    renderer.addAreaTexture(
        polygon,
        'i_llamborda.jpg',
        { rotation: textureRotation, spacing: 1, scale: 0.5 },
        stubs.scene
    );

    eq(stubs.canvases.length, 0, 'texture should not be resampled into a whole-area canvas');
    const primitive = stubs.scene.primitives._items[0].__gp;
    const geometry = primitive.geometryInstances.geometry;
    const fabric = primitive.appearance.material.fabric;
    assert(Math.abs(fabric.uniforms.textureRotation - Math.PI / 4) < 1e-8,
        'footway texture rotation did not align with the northeast way');
    eq(fabric.uniforms.image, 'i_llamborda.jpg', 'native source texture was not used');
    eq(geometry.options.stRotation, undefined, 'geometry must not clamp rotated UVs');
    eq(fabric.uniforms.tileSizeMeters.x, 0.5, 'footway tile width changed');
    eq(fabric.uniforms.tileSizeMeters.y, 0.5, 'footway tile height changed');
    assert(Math.abs(fabric.uniforms.textureRotation - Math.PI / 4) < 1e-8,
        'footway texture rotation changed');
    assert(fabric.source.includes('fract(textureSt)'),
        'meter-based tile coordinates are not repeated in the shader');
    assert(fabric.source.includes('czm_gammaCorrect'),
        'source texture color correction changed');

    renderer.addAreaTexture(
        [
            [-0.001, -0.001],
            [0.001, -0.001],
            [0.001, 0.001],
            [-0.001, 0.001],
            [-0.001, -0.001]
        ],
        'i_llamborda.jpg',
        { rotation: textureRotation, spacing: 1, scale: 0.5 },
        stubs.scene
    );
    const largerAreaMaterial = stubs.scene.primitives._items[1].__gp.appearance.material.fabric;
    eq(largerAreaMaterial.uniforms.tileSizeMeters.x, fabric.uniforms.tileSizeMeters.x,
        'larger footway polygon changed the physical tile width');
    eq(largerAreaMaterial.uniforms.tileSizeMeters.y, fabric.uniforms.tileSizeMeters.y,
        'larger footway polygon changed the physical tile height');
});

check('crossing texture follows its way bearing without a forced diagonal offset', () => {
    const { renderer, stubs } = loadRenderer();
    renderer.addAreaTexture(
        [[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001]],
        'i_crossing.png',
        { rotation: Math.PI / 4, spacing: 1, scale: 1, textureRotationOffsetDegrees: 90 },
        stubs.scene
    );

    eq(stubs.canvases.length, 0, 'crossing texture should not be baked into a canvas');
    const primitive = stubs.scene.primitives._items[0].__gp;
    const geometry = primitive.geometryInstances.geometry;
    const fabric = primitive.appearance.material.fabric;
    eq(geometry.options.stRotation, undefined, 'crossing geometry must not clamp rotated UVs');
    assert(Math.abs(fabric.uniforms.textureRotation - Math.PI / 4) < 1e-8,
        'crossing texture did not apply its configured perpendicular offset');
    eq(fabric.uniforms.tileSizeMeters.x, 1, 'crossing tile width changed');
    eq(fabric.uniforms.tileSizeMeters.y, 2, 'crossing tile aspect ratio was not preserved');
    assert(fabric.source.includes('fract(textureSt)'), 'crossing texture is not repeated in the shader');
});

check('parking texture follows a nearby kerb and keeps its original aspect', () => {
    const { renderer, stubs } = loadRenderer();
    const polygon = [
        [0, 0],
        [0.001, 0],
        [0.001, 0.0001],
        [0, 0.0001],
        [0, 0]
    ];
    const way = (tags, coordinates) => ({
        get(key) { return tags[key]; },
        getGeometry() {
            return {
                getType: () => 'LineString',
                getCoordinates: () => coordinates
            };
        }
    });
    const kerb = way({ barrier: 'kerb' }, [[0, 0], [0, 0.0001]]);
    const road = way({ highway: 'residential' }, [[0, -0.0001], [0.001, -0.0001]]);
    stubs.windowStub.map.getLayers = () => ({
        getArray: () => [{
            getSource: () => ({ getFeatures: () => [road, kerb] })
        }]
    });

    const rotation = renderer.calculateTextureRotation(polygon, 'i_parking.png', { amenity: 'parking' });
    assert(Math.abs(rotation) < 1e-8,
        'parking ignored the nearby north-south kerb and followed the polygon width: ' + rotation);

    renderer.addAreaTexture(
        polygon,
        'i_parking.png',
        { rotation, spacing: 1, scale: 1, textureRotationOffsetDegrees: 90 },
        stubs.scene
    );
    const material = stubs.scene.primitives._items[0].__gp.appearance.material.fabric;
    assert(Math.abs(material.uniforms.textureRotation - Math.PI / 2) < 1e-8,
        'parking did not apply its configured perpendicular offset');
    eq(material.uniforms.tileSizeMeters.x, 1, 'parking tile width changed');
    eq(material.uniforms.tileSizeMeters.y, 2, 'parking tile aspect ratio was not preserved');
});

check('area texture orientation offsets are configurable per tag mapping', () => {
    const { renderer, sandbox, stubs } = loadRenderer();
    vm.runInContext(fs.readFileSync(path.join(SRC, 'area_repetition.js'), 'utf8'),
        sandbox, { filename: 'area_repetition.js' });
    renderer.calculateTextureRotation = () => -Math.PI / 4;
    stubs.windowStub.modelRenderer = renderer;

    const crossing = stubs.windowStub.areaRepetition.generateAreaRepetitions(
        [[0, 0], [0.001, 0], [0.001, 0.001]],
        { 'area:highway': 'footway', footway: 'crossing' }
    )[0];
    eq(crossing.textureRotationOffsetDegrees, 90,
        'crossing mapping did not expose a per-tag texture rotation offset');

    const parking = stubs.windowStub.areaRepetition.generateAreaRepetitions(
        [[0, 0], [0.001, 0], [0.001, 0.001]],
        { amenity: 'parking' }
    )[0];
    eq(parking.textureRotationOffsetDegrees, 90,
        'parking mapping did not expose a per-tag texture rotation offset');

    const parallelTags = { amenity: 'parking', orientation: 'parallel' };
    const parallel = stubs.windowStub.areaRepetition.generateAreaRepetitions(
        [[0, 0], [0.001, 0], [0.001, 0.001]],
        parallelTags
    )[0];
    eq(parallel.model, 'i_parking_diagonal.jpg',
        'parallel parking did not select its specific texture mapping');
    eq(parallel.textureRotationOffsetDegrees, 20,
        'parallel parking did not return its configured 20 degree offset');

    const tags = parallelTags;
    const properties = Object.assign({}, tags);
    const west = offset(40, 10);
    const east = offset(80, 10);
    const ring = [
        west,
        east,
        offset(80, 30),
        offset(40, 30),
        west
    ];
    const feature = {
        get(key) { return properties[key]; },
        set(key, value) { properties[key] = value; },
        getProperties() { return properties; },
        getGeometry() {
            return {
                getType: () => 'Polygon',
                getCoordinates: () => [ring]
            };
        }
    };
    stubs.windowStub.areaRepetition.applyAreaRepetitions(feature, null, null, tags);
    const repModel = feature.get('repetition_0');
    eq(repModel.textureRotationOffsetDegrees, 20,
        'per-tag parallel parking rotation was dropped when storing the repetition');

    renderer._session3dId = 1;
    renderer.addRepetitionModel(feature, 0, repModel, stubs.scene);
    const textureMaterial = stubs.scene.primitives._items[0].__gp.appearance.material.fabric;
    assert(Math.abs(textureMaterial.uniforms.textureRotation - (Math.PI / 4 + 20 * Math.PI / 180)) < 1e-8,
        'parallel parking offset was dropped or its stored way bearing was recalculated');
});

check('empty-model area mappings still generate configured textures', () => {
    const { sandbox, stubs } = loadRenderer();
    vm.runInContext(fs.readFileSync(path.join(SRC, 'geojson_loader.js'), 'utf8'),
        sandbox, { filename: 'geojson_loader.js' });

    let applied = 0;
    stubs.windowStub.areaRepetition = {
        applyAreaRepetitions(feature, model, config, tags) {
            applied++;
            eq(model, '', 'empty area mapping model changed');
            eq(tags.orientation, 'parallel', 'area tags were not forwarded');
        }
    };
    const feature = {};
    const handled = sandbox.applyEmptyAreaModelMapping(
        feature,
        { geometryType: 'area', model: '', config: {} },
        { amenity: 'parking', orientation: 'parallel' }
    );
    assert(handled, 'empty-model area mapping was skipped');
    eq(applied, 1, 'configured area repetitions were not applied');
    eq(sandbox.applyEmptyAreaModelMapping(feature, { geometryType: 'line', model: '' }, {}),
        false,
        'empty non-area mapping should keep the existing skip behavior');
});

check('texture-only polygons do not add an untextured fallback surface', () => {
    const { renderer } = loadRenderer();
    const feature = makeFeature(0, 0, {
        repetition_0: { type: 'polygon_texture' },
        repetition_0_type: 'polygon_texture'
    }, 'Polygon');
    let repetitionCalls = 0;
    let plainCalls = 0;
    renderer.addRepetitionModels = () => repetitionCalls++;
    renderer.addPlainResult = () => plainCalls++;
    renderer.placeFeature(feature, 0, {}, null);
    eq(repetitionCalls, 1, 'area texture repetition was not rendered');
    eq(plainCalls, 0, 'an untextured base polygon was rendered over the texture');
});

check('an explicit zero texture rotation offset is honored', () => {
    const { renderer, stubs } = loadRenderer();
    renderer.addAreaTexture(
        [[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001]],
        'i_crossing.png',
        { rotation: Math.PI / 4, spacing: 1, scale: 1, textureRotationOffsetDegrees: 0 },
        stubs.scene
    );
    const material = stubs.scene.primitives._items[0].__gp.appearance.material.fabric;
    assert(Math.abs(material.uniforms.textureRotation + Math.PI / 4) < 1e-8,
        'explicit zero offset was replaced with a non-zero rotation');
});

check('sidewalk model rotation follows the way and corrects its authored yaw', () => {
    const { stubs, sandbox } = loadRenderer();
    vm.runInContext(fs.readFileSync(path.join(SRC, 'models.js'), 'utf8'),
        sandbox, { filename: 'models.js' });
    vm.runInContext(fs.readFileSync(path.join(SRC, 'line_repetition.js'), 'utf8'),
        sandbox, { filename: 'line_repetition.js' });

    const tags = { footway: 'sidewalk' };
    const coordinates = [[0, 0], [0.001, 0.001]];
    const mapping = sandbox.window.models.getModelForTags(
        tags,
        coordinates,
        0,
        'line'
    );
    assert(mapping, 'sidewalk model mapping was not found');
    assert(Math.abs(mapping.config.rotation[1] + Math.PI / 4) < 1e-8,
        'sidewalk asset yaw correction was lost in the mapping');

    const properties = Object.assign({}, tags);
    const feature = {
        get(key) { return properties[key]; },
        set(key, value) { properties[key] = value; },
        getProperties() { return properties; },
        getGeometry() {
            return {
                getType: () => 'LineString',
                getCoordinates: () => coordinates
            };
        }
    };
    sandbox.window.lineRepetition.applyLineRepetitions(
        feature,
        mapping.model,
        mapping.config,
        tags
    );

    const rotation = feature.get('repetition_0_rotation');
    assert(rotation, 'sidewalk repetition rotation was not stored');
    assert(Math.abs(rotation[1] + Math.PI / 2) < 1e-8,
        '45° way bearing and model-axis correction did not combine: ' + rotation[1]);
});

// --- 6. unloading releases what is far away ------------------------------
check('moving the camera far away unloads the primitives', () => {
    const { renderer, stubs } = loadRenderer();
    renderer._session3dId = 1;
    const model = { uri: 'src/models/w_highway_street_lamp.glb' };
    for (let i = 0; i < 200; i++) {
        const p = offset(i * 20, 0);
        renderer.addModelForFeature(makeFeature(p[0], p[1], { osm3dModel: model }), i, stubs.scene, { get: () => 't' });
    }
    assert(stubs.scene.primitives.length === 200, 'setup placed ' + stubs.scene.primitives.length);

    // Fly 40 km east: everything is now far beyond unloadDistance (9000 m).
    stubs.scene.camera.positionCartographic = { longitude: 0.0174 + 40000 / 111320, latitude: 0.7299, height: 300 };
    const removed = renderer.unloadDistantModels(stubs.scene);
    assert(removed > 0, 'nothing was unloaded after flying 40km away');
    eq(stubs.scene.primitives.length, 0, 'primitives survived in the scene');
    eq(renderer.liveTotal, 0, 'primitives survived in the census');
    eq(renderer.recountLive(), 0, 'census drifted after unload');
});

// --- 7. eviction never drops something visible ---------------------------
// NOTE: on the pre-fix code this fails only because evictFarthest does not
// exist there, so it is a weak discriminator — but the invariant it asserts is
// the one that matters: never destroy something the user can see.
check('eviction only sacrifices what is already out of range', () => {
    const { renderer, stubs } = loadRenderer();
    renderer._session3dId = 1;
    const model = { uri: 'src/models/w_highway_street_lamp.glb' };
    // 300 near the camera — these must survive any eviction.
    for (let i = 0; i < 300; i++) {
        const p = offset(i * 3, 0);
        renderer.addModelForFeature(makeFeature(p[0], p[1], { osm3dModel: model }), i, stubs.scene, { get: () => 't' });
    }
    const nearBefore = stubs.scene.primitives.length;

    // Force the budget path even though nothing out of range exists.
    renderer.evictFarthest(stubs.scene);
    eq(stubs.scene.primitives.length, nearBefore,
        'eviction destroyed primitives the user can see');
});

// --- 8. the parsed file is not kept alive ---------------------------------
// Guards the single largest heap item on a >1MB file: layerInfo.geoJSON held
// the whole parsed object graph (~11.5MB for a 7.26MB file) and NOTHING read
// it back.
check('the loaded layer does not retain the parsed GeoJSON', () => {
    const { renderer, stubs, sandbox } = loadRenderer();

    // Minimal ol layer/source stubs, enough for createVectorLayer.
    const olStub = Object.assign(Object.create(Object.getPrototypeOf(stubs.ol)), stubs.ol, {
        layer: {
            Vector: function () {
                this.setSource = function () {};
                this.getSource = () => ({ getFeatures: () => [] });
                this.getStyleFunction = () => function () { return null; };
            }
        },
        source: { Vector: function () {} },
        format: { GeoJSON: function () { return { readFeatures: () => [] }; } }
    });

    const loaderSandbox = {
        window: stubs.windowStub,
        document: stubs.documentStub,
        Cesium: stubs.Cesium,
        ol: olStub,
        console: { log() {}, warn() {}, error() {} },
        setTimeout: () => 0,          // the post-load sweep must not run
        clearTimeout: () => {},
        Promise, Math, Array, Object, Infinity, NaN, isFinite, JSON, Date,
        String, Number, Float32Array, Map, Set
    };
    loaderSandbox.globalThis = loaderSandbox;
    vm.createContext(loaderSandbox);
    vm.runInContext(fs.readFileSync(process.env.GEOJSON_LOADER_PATH || path.join(SRC, 'geojson_loader.js'), 'utf8'),
        loaderSandbox, { filename: 'geojson_loader.js' });

    const loader = loaderSandbox.window.geoJSONLoader;
    assert(loader, 'geojson_loader.js did not export window.geoJSONLoader');

    // A feature set the size of a real >1MB file.
    const features = [];
    for (let i = 0; i < 6000; i++) {
        features.push({
            type: 'Feature',
            properties: { highway: 'residential', name: 'street ' + i },
            geometry: { type: 'LineString', coordinates: [[2.1, 41.2], [2.1001, 41.2001]] }
        });
    }
    const big = { type: 'FeatureCollection', features: features };

    // Stub the file read: this is the object whose retention we are testing.
    loader.readFileAsText = () => Promise.resolve(JSON.stringify(big));

    let info = null;
    return loader.loadGeoJSON({ name: 'big.geojson', size: 7400000 }, {}).then(() => {
        info = loader.loadedLayers.get('geojson_1');
        assert(info, 'layer was not registered');
        assert(info.geoJSON === undefined,
            'layerInfo still retains the parsed GeoJSON (' +
            (info.geoJSON ? (info.geoJSON.features || []).length + ' features held' : '') + ')');
        assert(info.featureCount === 6000, 'featureCount should replace the retained object');
    });
});

// --- 9. areaTextureManager path is gated and budgeted --------------------
// This path (addAreaTextureForFeature -> areaTextureManager.createAreaEntity)
// is separate from the polygon_texture repetition branch and had neither a
// range gate nor a budget check, so it was an unbounded route into the scene.
check('polygon-feature area textures are range gated and budgeted', () => {
    const { renderer, stubs } = loadRenderer();
    renderer._session3dId = 1;
    let built = 0;
    stubs.windowStub.areaTextureManager = {
        createAreaEntity(feature) {
            built++;
            const gp = stubs.scene.primitives.add(
                new stubs.Cesium.GroundPrimitive({})
            );
            feature.set('areaEntity', gp);
            return gp;
        }
    };

    const image = { uri: 'i_asfalt.jpg' };

    // 20km away: must be refused before anything is constructed.
    const far = makeFeature(...offset(20000, 0), { osm3dModel: image }, 'Polygon');
    renderer.addAreaTextureForFeature(far, image, 0, stubs.scene);
    eq(built, 0, 'a 20km-distant polygon texture was built');

    // Near: built and counted.
    const near = makeFeature(...offset(50, 0), { osm3dModel: image }, 'Polygon');
    renderer.addAreaTextureForFeature(near, image, 1, stubs.scene);
    eq(built, 1, 'the nearby polygon texture was not built');
    eq(renderer.liveByKind.texture, 1, 'the area texture was not counted');
    eq(stubs.scene.primitives.length, 1, 'scene/census disagree');
});

// --- 10. plain markers are released ---------------------------------------
// Model-less features are draped as Cesium entities in a CustomDataSource
// that lives outside loadedModels. clearPlainResults used to clear the map and
// drop the reference, which left the entities AND the data source in the scene.
check('plain markers are actually removed from the scene', () => {
    const { renderer, stubs } = loadRenderer();
    renderer._session3dId = 1;

    const entities = [];
    const removedFromSource = [];
    const removedFromCollection = [];
    const collection = {
        contains: () => true,
        add: () => {},
        remove: ds => removedFromCollection.push(ds)
    };
    stubs.windowStub.ol3d.getDataSources = () => collection;
    stubs.Cesium.CustomDataSource = function () {
        const self = this;
        this.entities = {
            add: e => { entities.push(e); return e; },
            remove: e => { removedFromSource.push(e); const i = entities.indexOf(e); if (i > -1) entities.splice(i, 1); return true; },
            removeAll: () => { removedFromSource.push.apply(removedFromSource, entities); entities.length = 0; return true; }
        };
    };

    const layer = { get: () => 'test-layer' };
    const otherLayer = { get: () => 'other-layer' };
    const f1 = makeFeature(...offset(10, 0), {}, 'Point');
    const f2 = makeFeature(...offset(20, 0), {}, 'Point');
    renderer.addPlainResult(f1, 0, stubs.scene, layer);
    renderer.addPlainResult(f2, 1, stubs.scene, otherLayer);
    eq(entities.length, 2, 'setup did not create two markers');

    // Releasing ONE layer must take exactly its own marker and no other.
    const released = renderer.unloadPlainResultsForLayer(layer);
    eq(released, 1, 'wrong number of markers released for the layer');
    eq(entities.length, 1, 'the wrong marker was removed');

    renderer.clearPlainResults();
    eq(entities.length, 0, 'clearPlainResults left entities in the data source');
    assert(removedFromCollection.length === 1, 'clearPlainResults left the data source in the scene');
});

// --- report ---------------------------------------------------------------
Promise.all(pending).then(() => {
    let failed = 0;
    for (const r of results) {
        console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.name + (r.ok ? '' : '\n        -> ' + r.why));
        if (!r.ok) failed++;
    }
    console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed');
    process.exit(failed ? 1 : 0);
});