// Model Renderer - Handles 3D model rendering in Cesium
// Moved from index.js to separate file for better organization

// Memory management configuration
const memoryConfig = {
    maxModelsPerFrame: 40,           // Limit models added per frame
    loadDistance: 1000,              // Load models within this distance (meters)
    unloadDistance: 1500,            // Unload models beyond this distance (meters)
    lodDistances: {                  // Level of Detail distances
        high: 200,                    // High detail within 200m
        medium: 500,                  // Medium detail within 500m
        low: 1000                     // Low detail within 1000m
    },
    cameraUpdateThrottle: 100,       // Throttle camera updates (ms)
    maxTotalModels: 400              // Cap concurrent 3D models (memory / GPU)
};

/** Max canvas edge for rotated area textures (pixels); lower = less RAM / GPU upload */
const AREA_TEXTURE_MAX_CANVAS = 2048;
const AREA_TEXTURE_JPEG_QUALITY = 0.78;

// Import centralized debug configuration
if (typeof window !== 'undefined' && window.globalDebugConfig) {
    var debugConfig = window.globalDebugConfig.modelRenderer;
} else {
    // Fallback debug configuration if centralized config not available
    var debugConfig = {
        enabled: false,
        maxRepetitionLogs: 5,
        logModelLoading: false,
        logRepetitionModels: false,
        logTextureProcessing: false
    };
}

function modelRendererTexLog() {
    return debugConfig.enabled && debugConfig.logTextureProcessing;
}

// ---------------------------------------------------------------------------
// Plain results: query features with no model and no texture
// ---------------------------------------------------------------------------
// These used to be left entirely to ol-cesium's VectorSynchronizer, which
// converts OL geometry straight to Cesium positions at ellipsoid height 0 —
// sea level. With globe.depthTestAgainstTerrain disabled they were not hidden
// underground, so on sloping ground they appeared displaced from the terrain
// ("a few metres", 3D only, points and lines alike). They are markers, not
// models, and they must always lie ON the ground: hills, valleys and inclines
// included. Cesium's ground-conforming primitives do that natively and keep
// following the surface as the DEM tiles refine, so no manual re-seating is
// needed here (unlike the model path, which places an explicit height).
//
//   point   -> Entity + heightReference: CLAMP_TO_GROUND
//   line    -> Entity + polyline.clampToGround
//   area    -> Entity + polygon.heightReference: CLAMP_TO_GROUND
//
// Plain markers keep Cesium's clamp; MODEL primitives deliberately do not (see
// addModelForFeature). The clamp is only honoured for entities/graphics and
// only when the terrain provider exposes `availability`; the MapTerhorn
// provider does not, so on a Model primitive it is a silent no-op.

/** Default marker look when the OL style gives us nothing usable. */
const PLAIN_MARKER_PIXEL_SIZE = 7;
const hasCesium = typeof Cesium !== 'undefined';
const PLAIN_MARKER_COLOR = hasCesium ? Cesium.Color.fromCssColorString('#e6a01a') : null;
const PLAIN_LINE_COLOR = hasCesium ? Cesium.Color.fromCssColorString('#e6a01a').withAlpha(0.9) : null;
const PLAIN_AREA_COLOR = hasCesium ? Cesium.Color.fromCssColorString('#e6a01a').withAlpha(0.25) : null;

/** Best-effort read of the OL style so the 3D marker resembles the 2D one. */
function readPlainStyle(feature, layer) {
    let style = null;
    try { style = feature.getStyle(); } catch (e) { /* no style on the feature */ }
    if (!style && layer && typeof layer.getStyle === 'function') {
        try { style = layer.getStyleFunction()(feature, 0); } catch (e) { /* no layer style */ }
    }
    if (Array.isArray(style)) style = style[0];
    return style || null;
}

/** OL [r,g,b,a] (0-255) -> Cesium.Color, falling back when unusable. */
function olColorToCesium(olColor, fallback) {
    if (!olColor || olColor.length < 3) return fallback;
    return new Cesium.Color(
        olColor[0] / 255, olColor[1] / 255, olColor[2] / 255,
        olColor.length > 3 ? olColor[3] : 1);
}

/**
 * OL coordinates -> Cesium.Cartesian3.
 *
 * OL geometries are in the VIEW projection (EPSG:3857 metres), NOT degrees.
 * Cesium.Cartesian3.fromDegrees() must only ever receive lon/lat — feeding it
 * metres puts everything near null island, which is exactly the "result data
 * is offset" symptom we are fixing. Same transform the model path uses.
 */
function plainCoordsToCartesian(coords) {
    return coords.map(c => {
        const lonLat = ol.proj.toLonLat(c);
        return Cesium.Cartesian3.fromDegrees(lonLat[0], lonLat[1]);
    });
}

/** All vertices of a (possibly nested) OL coordinate array, flattened. */
function plainFlattenCoords(coords, out) {
    out = out || [];
    if (!coords || !coords.length) return out;
    if (typeof coords[0] === 'number') { out.push(coords); return out; }
    for (const c of coords) plainFlattenCoords(c, out);
    return out;
}

/**
 * Feature property holding this app's 3D model descriptor.
 *
 * ol-cesium's VectorSynchronizer interprets a feature property literally named
 * 'model' and creates its OWN Cesium model for it. Storing our descriptor under
 * that name therefore rendered every model twice: once by this renderer
 * (ground-clamped on the DEM, correctly placed) and once by ol-cesium
 * (positioned at height 0, so it appeared to be flying above the terrain).
 *
 * Our descriptor lives under 'osm3dModel', which ol-cesium ignores, so this
 * renderer is the only producer. getFeatureModelOptions() still accepts 'model'
 * for backward compatibility with any feature that already carries it.
 */
const OSM3D_MODEL_PROPERTY = 'osm3dModel';

function getFeatureModelOptions(feature) {
    if (!feature || typeof feature.get !== 'function') return null;
    return feature.get(OSM3D_MODEL_PROPERTY) || feature.get('model') || null;
}

// Expose for modules loaded after this one (repetitions, geojson loader, ...).
window.OSM3D_MODEL_PROPERTY = OSM3D_MODEL_PROPERTY;
window.getFeatureModelOptions = getFeatureModelOptions;

/**
 * Ground elevation (metres) for a lon/lat, from whichever DEM is in use.
 *
 * The local GeoTIFF terrain manager keeps priority when one is loaded, but the
 * MapTerhorn global DEM is what the Cesium globe actually renders when no
 * GeoTIFF is active. Reading only terrainManager meant every model created
 * outside the GeoTIFF workflow (Overpass/tag queries, plain 3D activation)
 * was placed at elevation 0 — i.e. at sea level — until the async
 * `repositionModelsOnDem` hook rescued it. Worse, isPositionVisible /
 * getDistanceFromCamera measured the camera-to-model distance with the same
 * zero elevation, so on a 1200 m mountain the distance was short by the whole
 * elevation and models fell outside lodDistances/unloadDistance and never
 * loaded at all.
 *
 * Returns 0 while the DEM tile is still decoding; the onTilesLoaded hook
 * re-seats the model as soon as the real value is known.
 *
 * @param {number} lon
 * @param {number} lat
 * @returns {number} elevation in metres
 */
function sampleGroundElevation(lon, lat) {
    if (window.terrainManager && window.terrainManager.getElevation) {
        const local = window.terrainManager.getElevation(lon, lat);
        if (local !== null && local !== undefined && isFinite(local)) return local;
    }
    if (window.mapterhornTerrain && window.mapterhornTerrain.getElevation) {
        const dem = window.mapterhornTerrain.getElevation(lon, lat);
        if (dem !== null && dem !== undefined && isFinite(dem)) return dem;
    }
    return 0;
}

window.modelRenderer = {

    loadedModels: new Map(),          // Track loaded models by feature ID
    cameraUpdateTimeout: null,        // Throttle camera updates
    modelPool: new Map(),             // Pool of reusable model instances
    backgroundTasks: [],              // Background loading tasks
    isProcessing: false,              // Prevent concurrent processing
    totalModelsAdded: 0,              // Track total models added to prevent excessive usage
    batchLogStats: {                  // Batch logging to reduce console spam
        modelsAdded: 0,
        repetitionsAdded: 0,
        lastLogTime: Date.now(),
        batchInterval: 5000           // Log summary every 5 seconds
    },

    /**
     * Model Pooling System - Reuse Cesium model instances
     */
    getModelFromPool: function(modelUrl, cesiumScene) {
        // Check if this is an image file - don't pool images as GLTF models
        const isImageFile = modelUrl && (modelUrl.toLowerCase().endsWith('.png') || modelUrl.toLowerCase().endsWith('.jpg') || modelUrl.toLowerCase().endsWith('.jpeg'));
        if (isImageFile) {
            if (debugConfig.enabled) console.log(`♻️ Skipping model pooling for image file: ${modelUrl}`);
            return null;
        }
        
        if (!this.modelPool.has(modelUrl)) {
            this.modelPool.set(modelUrl, []);
        }
        
        const pool = this.modelPool.get(modelUrl);
        const availableModel = pool.find(model => !model.isVisible);
        
        if (availableModel) {
            availableModel.isVisible = true;
            if (debugConfig.enabled) console.log(`♻️ Reused model from pool: ${modelUrl}`);
            return availableModel;
        }
        
        // Clean up pool before creating new model if it's getting large
        if (pool.length > 15) {
            this.cleanupModelPool();
        }
        
        // Create new model if pool is empty
        const newModel = cesiumScene.primitives.add(Cesium.Model.fromGltf({
            url: modelUrl,
            show: true
        }));
        
        pool.push({
            model: newModel,
            isVisible: true
        });
        
        if (debugConfig.enabled) console.log(`🆕 Created new pooled model: ${modelUrl}`);
        return { model: newModel, isVisible: true };
    },

    /**
     * Return model to pool (hide instead of destroy)
     */
    returnModelToPool: function(modelUrl, modelInstance) {
        if (this.modelPool.has(modelUrl)) {
            const pool = this.modelPool.get(modelUrl);
            const pooledModel = pool.find(item => item.model === modelInstance);
            if (pooledModel) {
                pooledModel.isVisible = false;
                pooledModel.model.show = false;
                if (debugConfig.enabled) console.log(`♻️ Returned model to pool: ${modelUrl}`);
                // Clean up pool periodically when returning models
                if (Math.random() < 0.1) { // 10% chance to clean up
                    this.cleanupModelPool();
                }
            }
        }
    },

    /**
     * Clean up model pool to prevent unlimited growth
     * Removes oldest unused models when pool exceeds limit
     */
    cleanupModelPool: function() {
        const maxPoolSize = 60; // Maximum total pooled primitives (memory)
        let totalPoolSize = 0;
        
        // Calculate total pool size
        this.modelPool.forEach((pool) => {
            totalPoolSize += pool.length;
        });
        
        if (totalPoolSize > maxPoolSize) {
            if (debugConfig.enabled) console.log(`♻️ Cleaning up model pool: ${totalPoolSize} models, reducing to ${maxPoolSize}`);
            
            // Remove oldest unused models from each pool
            this.modelPool.forEach((pool, modelUrl) => {
                const unusedModels = pool.filter(item => !item.isVisible);
                const toRemove = Math.max(0, unusedModels.length - Math.floor(maxPoolSize / this.modelPool.size));
                
                for (let i = 0; i < toRemove; i++) {
                    const index = pool.indexOf(unusedModels[i]);
                    if (index > -1) {
                        pool.splice(index, 1);
                        if (debugConfig.enabled) console.log(`♻️ Removed unused model from pool: ${modelUrl}`);
                    }
                }
            });
        }
    },

    /**
     * Background loading system to prevent frame drops
     */
    addBackgroundTask: function(task) {
        this.backgroundTasks.push(task);
        if (!this.isProcessing) {
            this.processBackgroundTasks();
        }
    },

    /**
     * Process background tasks without blocking main thread
     */
    processBackgroundTasks: function() {
        if (this.isProcessing || this.backgroundTasks.length === 0) return;
        
        this.isProcessing = true;
        
        const processBatch = () => {
            const batchSize = 10; // Process 10 tasks per frame
            for (let i = 0; i < Math.min(batchSize, this.backgroundTasks.length); i++) {
                const task = this.backgroundTasks.shift();
                try {
                    task();
                } catch (error) {
                    // Background task error silently handled
                }
            }
            
            if (this.backgroundTasks.length > 0) {
                requestAnimationFrame(processBatch);
            } else {
                this.isProcessing = false;
            }
        };
        
        requestAnimationFrame(processBatch);
    },

    /**
     * Check if a position is visible in the current camera view (viewport culling)
     */
    isPositionVisible: function(lon, lat, cesiumScene) {
        if (!cesiumScene || !cesiumScene.camera) return false;

        const camera = cesiumScene.camera;
        const position = Cesium.Cartesian3.fromDegrees(lon, lat,
            sampleGroundElevation(lon, lat));
        const frustum = camera.frustum;

        // Check if position is in camera frustum
        return frustum.computeCullingVolume(camera.position, camera.direction, camera.up).computeVisibility(new Cesium.BoundingSphere(position, 10)) !== Cesium.Intersect.OUTSIDE;
    },

    /**
     * Calculate distance from camera to position
     */
    getDistanceFromCamera: function(lon, lat, cesiumScene) {
        if (!cesiumScene || !cesiumScene.camera) return Infinity;

        const camera = cesiumScene.camera;
        const cameraPosition = camera.positionCartographic;
        const position = Cesium.Cartographic.fromDegrees(lon, lat,
            sampleGroundElevation(lon, lat));

        return Cesium.Cartesian3.distance(
            Cesium.Cartographic.toCartesian(cameraPosition),
            Cesium.Cartographic.toCartesian(position)
        );
    },

    /**
     * Get appropriate LOD level based on distance
     */
    getLODLevel: function(distance) {
        if (distance <= memoryConfig.lodDistances.high) return 'high';
        if (distance <= memoryConfig.lodDistances.medium) return 'medium';
        if (distance <= memoryConfig.lodDistances.low) return 'low';
        return 'none'; // Too far, don't load
    },
    
    // -----------------------------------------------------------------------
    // Pre-load panel reporting + sliced placement
    // -----------------------------------------------------------------------
    // The per-feature work below (placeFeature) is exactly what it always was.
    // The only difference is WHEN it runs: instead of one blocking loop that
    // freezes the page (and freezes the progress bar with it), the walk is done
    // in slices of a few dozen features, handing control back to the browser
    // between them so the panel really repaints at 10%, 25%, 60%… and the map
    // stays usable while a big query is built.
    _progressTotal: 0,
    _progressDone: 0,
    _placing: false,             // a pass is in flight
    _pendingSweep: false,        // addAllModels() was called again while it ran

    /**
     * Features placed before the browser is given a turn. Small enough that the
     * bar moves visibly, large enough that the per-slice hand-off costs
     * nothing measurable.
     */
    placeSliceSize: 40,

    /**
     * Flatten the layer tree into the list of things to place. Same walk as
     * before (groups recurse, leaf layers contribute their features) — it just
     * collects instead of placing, so the total is known before any work.
     */
    collectPlaceTasks: function(layers, cesiumScene, out) {
        const self = this;
        (layers || []).forEach(function(layer) {
            if (!layer) return;
            // A group: descend, whatever its type.
            if (typeof layer.getLayers === 'function') {
                self.collectPlaceTasks(layer.getLayers().getArray(), cesiumScene, out);
                return;
            }
            if (!layer.getSource || typeof layer.getSource !== 'function') return;
            let features = null;
            try {
                const source = layer.getSource();
                if (source && source.getFeatures) features = source.getFeatures();
            } catch (e) {
                // Layer source access failed. Log instead of swallowing: an
                // empty catch here hid the failure of every model in the layer.
                console.error(`🎯 Could not read layer "${layer.get && layer.get('title') || 'unnamed'}" features:`, e);
                return;
            }
            if (!features) return;
            if (debugConfig.enabled) console.log(`🎯 Found ${features.length} features in layer`);
            for (let i = 0; i < features.length; i++) {
                out.push({ feature: features[i], fidx: i, layer: layer, cesiumScene: cesiumScene });
            }
        });
        return out;
    },

    /**
     * Run the placement in slices. Each slice is the original feature body; the
     * hand-off between slices is what lets the browser paint the progress bar
     * and keep answering clicks.
     */
    runPlaceSlices: function(tasks) {
        const self = this;
        const total = tasks.length;
        let index = 0;
        this._placing = true;

        function slice() {
            const started = index;
            const end = Math.min(total, index + self.placeSliceSize);
            for (; index < end; index++) {
                const task = tasks[index];
                try {
                    // Isolate every feature. addPlainResult / the repetition
                    // helpers are NOT wrapped individually, so a single throw
                    // would abort the whole sweep and silently cost the rest of
                    // the layer its models.
                    self.placeFeature(task.feature, task.fidx, task.cesiumScene, task.layer);
                } catch (featureError) {
                    console.error(`🎯 Feature ${task.fidx} in layer "${task.layer.get('title') || 'unnamed'}" failed, skipping:`, featureError);
                }
            }
            self._progressDone = index;
            if (window.loadingProgress && window.loadingProgress.step) {
                window.loadingProgress.step(index - started, index, total);
            }

            if (index < total) {
                setTimeout(slice, 0);          // let the browser breathe
                return;
            }
            self._placing = false;
            self._progressSummary();
            // A query that arrived while this pass was running gets its own
            // sweep now; it is idempotent, so it only places what is missing.
            if (self._pendingSweep) {
                self._pendingSweep = false;
                self.addAllModels();
            }
        }

        if (total === 0) { this._placing = false; this._progressSummary(); return; }
        slice();
    },

    _progressSummary: function() {
        const live = this.loadedModels ? this.loadedModels.size : 0;
        if (window.loadingProgress) {
            if (window.loadingProgress.summary) window.loadingProgress.summary(live);
        }
        console.log('🎯 placed ' + live + ' model(s) for ' + this._progressTotal + ' feature(s)');
        this._progressTotal = 0;
        this._progressDone = 0;
        window.dispatchEvent(new CustomEvent('osm3d:modelsPlaced', { detail: { placed: live } }));
    },

    /** Start a sweep over one layer (kept as the module's entry point). */
    addModelsFromLayer: function(layer, cesiumScene) {
        const tasks = this.collectPlaceTasks([layer], cesiumScene, []);
        this._progressTotal = tasks.length;
        if (window.loadingProgress && window.loadingProgress.total) {
            window.loadingProgress.total(tasks.length);
        }
        this.runPlaceSlices(tasks);
    },

    /**
     * Place everything that belongs to one feature: its model, its repetitions,
     * its area texture, or a draped marker when it has none of those.
     * This is the original per-feature body of the layer loop, unchanged.
     */
    placeFeature: function(feature, fidx, cesiumScene, layer) {
        const model = getFeatureModelOptions(feature);
        const hasRepetitions = feature.get('repetition_0');
        const geometry = feature.getGeometry();

        if (geometry && geometry.getType && (geometry.getType() === 'Polygon' || geometry.getType() === 'MultiPolygon')) {
            if (model && model.uri && /\.(jpg|jpeg|png|gif|bmp|tiff|tif)$/i.test(model.uri)) {
                if (debugConfig.enabled) console.log(`🎯 Feature ${fidx} has area texture: ${model.uri}`);
                this.addAreaTextureForFeature(feature, model, fidx, cesiumScene);
            } else {
                if (model && typeof model === 'object' && model.uri) {
                    this.addModelForFeature(feature, fidx, cesiumScene, layer);
                }
                this.addRepetitionModels(feature, cesiumScene);
                // Neither model nor texture: drape the outline on the terrain
                // instead of letting ol-cesium draw it at sea level.
                if (!model) this.addPlainResult(feature, fidx, cesiumScene, layer);
            }
        } else {
            if (model && typeof model === 'object' && model.uri) {
                this.addModelForFeature(feature, fidx, cesiumScene, layer);
            }
            this.addRepetitionModels(feature, cesiumScene);
            // No model for this result: draw it as a marker/line that follows
            // the ground (see addPlainResult).
            if (!model) this.addPlainResult(feature, fidx, cesiumScene, layer);
        }
    },

    // Add individual model for a feature
    addModelForFeature: function(feature, fidx, cesiumScene, layer) {
        const geometry = feature.getGeometry();
        if (!geometry) return;

        // Get proper coordinates for positioning
        let lonLat;
        const geometryType = geometry.getType();

        if (geometryType === 'Point') {
            // For point features, use the point coordinates
            lonLat = ol.proj.toLonLat(geometry.getCoordinates());
        } else if (geometryType === 'LineString') {
            // For line features, use the midpoint
            const coordinates = geometry.getCoordinates();
            const midIndex = Math.floor(coordinates.length / 2);
            lonLat = ol.proj.toLonLat(coordinates[midIndex]);
        } else if (geometryType === 'Polygon') {
            // For polygon features, use the centroid
            const extent = geometry.getExtent();
            const center = ol.extent.getCenter(extent);
            lonLat = ol.proj.toLonLat(center);
        } else {
            // Fallback to extent center for other geometry types
            const extent = geometry.getExtent();
            const center = ol.extent.getCenter(extent);
            lonLat = ol.proj.toLonLat(center);
        }

        // Memory management: Check if model should be loaded
        const distance = this.getDistanceFromCamera(lonLat[0], lonLat[1], cesiumScene);
        const isVisible = this.isPositionVisible(lonLat[0], lonLat[1], cesiumScene);
        const lodLevel = this.getLODLevel(distance);

        // Skip if too far or not visible - but be less aggressive with LOD
        const loadDistance = memoryConfig.loadDistance * 1.5; // Increase load distance
        if (distance > loadDistance && !isVisible) {
            return;
        }

        // Create a stable feature ID that doesn't change between calls
        let featureId = feature.getId();
        if (!featureId) {
            // Use layer name, feature index, and stable geometry hash for ID
            const layerName = layer.get('title') || layer.get('name') || 'unknown';
            const geometry = feature.getGeometry();
            let geometryHash = 'no_geom';
            if (geometry) {
                // Round coordinates to avoid floating point precision issues
                const extent = geometry.getExtent().map(coord => Math.round(coord * 1000000) / 1000000);
                geometryHash = extent.join('_');
            }
            featureId = `feature_${layerName}_${fidx}_${geometryHash}`;
        }

        // Check total model limit to prevent excessive resource usage
        if (this.totalModelsAdded >= memoryConfig.maxTotalModels) {
            if (debugConfig.enabled) console.warn(`🎯 Model limit reached (${memoryConfig.maxTotalModels}), skipping model at distance ${Math.round(distance)}m`);
            return;
        }

        // Debug logging
        if (debugConfig.enabled) {
            console.log(`🎯 Processing feature ${fidx} with ID: ${featureId}`);
            console.log(`🎯 Already loaded: ${this.loadedModels.has(featureId)}`);
            console.log(`🎯 Total loaded models: ${this.loadedModels.size}`);
        }

        // Skip if already loaded in THIS 3D session. The map is cleared when 3D
        // mode ends (primitives are destroyed with the scene) so re-entering 3D
        // rebuilds everything — persistent entries pointed at dead primitives.
        const tracked = this.loadedModels.get(featureId);
        if (tracked && tracked.sessionId === this._session3dId) {
            if (debugConfig.enabled) console.log(`🎯 Skipping already loaded feature: ${featureId}`);
            return;
        }

        // Use model pooling instead of creating new instances
        const model = getFeatureModelOptions(feature);
        if (!model || !model.uri) {
            if (debugConfig.enabled) console.log(`🎯 Feature ${fidx} has no valid model URI, skipping`);
            return;
        }
        
        const modelUrl = model.uri;
        
        // Check if this is an image file - skip GLTF loading for images
        const isImageFile = modelUrl && (modelUrl.toLowerCase().endsWith('.png') || modelUrl.toLowerCase().endsWith('.jpg') || modelUrl.toLowerCase().endsWith('.jpeg'));
        if (isImageFile) {
            if (debugConfig.enabled) console.log(`🎯 Skipping GLTF loading for image file: ${modelUrl}`);
            return;
        }
        
        const pooledModel = this.getModelFromPool(modelUrl, cesiumScene);
        
        // If pooledModel is null (image file), skip processing
        if (!pooledModel) {
            return;
        }
        
        // Create model matrix for positioning BEFORE setting on model
        const heightOffset = feature.get('modelHeightOffset') || 0.0;

        // Prime the DEM tile for this point BEFORE sampling it. Without this the
        // first sample of a session almost always returns 0 (tile still decoding),
        // the model is built at sea level, and the only thing that could pull it
        // back down is the re-seat hook below. Warming here also guarantees the
        // hook has a tile to fire on for this position.
        if (window.mapterhornTerrain && window.mapterhornTerrain.warmUp) {
            try { window.mapterhornTerrain.warmUp(lonLat[0], lonLat[1]); } catch (e) { /* no DEM yet */ }
        }

        // Get terrain elevation. Exact bilinear DEM sample — the same
        // interpolated surface buildings use and the terrain renders from.
        // (Neighborhood averaging was tried and ELEVATED models on convex
        // ground: the probe average rides above the true surface.)
        const terrainElevation = sampleGroundElevation(lonLat[0], lonLat[1]);
        
        const totalHeight = heightOffset + terrainElevation;
        let modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(
            Cesium.Cartesian3.fromDegrees(lonLat[0], lonLat[1], totalHeight)
        );
        
        // Tilt the model to follow the terrain slope so it stands correctly
        // inclined on mountains (MapTerhorn DEM surface normal)
        if (window.mapterhornTerrain && window.mapterhornTerrain.applySlopeTilt) {
            try {
                modelMatrix = window.mapterhornTerrain.applySlopeTilt(modelMatrix, lonLat[0], lonLat[1]);
            } catch (e) { /* no DEM data yet */ }
        }
        
        if (debugConfig.enabled && terrainElevation > 0) {
            console.log(`🎯 Model positioned at terrain elevation: ${terrainElevation.toFixed(1)}m + offset: ${heightOffset.toFixed(1)}m = ${totalHeight.toFixed(1)}m`);
        }
        
        // Apply model rotation if specified
        const modelRotation = feature.get('modelRotation');
        if (modelRotation && Array.isArray(modelRotation) && modelRotation.length >= 3) {
            if (modelRotation[1] !== 0) {
                const bearingRotation = Cesium.Matrix3.fromRotationZ(modelRotation[1]);
                modelMatrix = Cesium.Matrix4.multiplyByMatrix3(modelMatrix, bearingRotation, new Cesium.Matrix4());
            }
            
            if (modelRotation[0] !== 0) {
                const xRotation = Cesium.Matrix3.fromRotationX(modelRotation[0]);
                modelMatrix = Cesium.Matrix4.multiplyByMatrix3(modelMatrix, xRotation, new Cesium.Matrix4());
            }
            
            if (modelRotation[2] !== 0) {
                const zRotation = Cesium.Matrix3.fromRotationZ(modelRotation[2]);
                modelMatrix = Cesium.Matrix4.multiplyByMatrix3(modelMatrix, zRotation, new Cesium.Matrix4());
            }
            
            if (debugConfig.enabled) console.log(`🎯 Applied rotation to model: [${modelRotation.map(r => (r * 180 / Math.PI).toFixed(2) + '°').join(', ')}]`);
        }
        
        // IMPORTANT: no distance-based scaling. Shrinking far models made them
        // inconsistent with identical models placed near the camera and with
        // real-world sizes on terrain; real size must stay constant.
        
        // Update pooled model with ALL properties at once to prevent flashing
        pooledModel.model.modelMatrix = modelMatrix;
        pooledModel.model.scale = model.scale || 1.0;
        // We own the height here — do NOT delegate to Cesium's ground clamp.
        //
        // This used to be CLAMP_TO_GROUND, and it is the single reason models
        // flew. Cesium implements that clamp for a Model primitive via
        // sampleClampToHeightMostDetailed(), which requires the terrain provider
        // to expose `availability`. Our MapterhornTerrainProvider returns
        // `undefined` for it (no tile-availability index exists for a raster
        // heightmap), so the clamp silently degrades to a no-op and the model
        // keeps whatever height the matrix was built with — 0 while the DEM
        // tile is still decoding, i.e. hanging in mid-air over the hillside.
        //
        // Worse, the constant still *read* as CLAMP_TO_GROUND, so
        // repositionModelsOnDem() believed the primitive was self-maintaining
        // and skipped it — the one code path that could re-seat the model on the
        // real surface. That left the floating models stranded until a reload.
        //
        // So: heightReference NONE (we set the height ourselves, from the same
        // DEM the globe renders) + the re-seat hook keeps it exact as tiles
        // refine. Rotation and slope tilt stay baked into the matrix.
        pooledModel.model.heightReference = Cesium.HeightReference.NONE;
        pooledModel.model.show = true; // Ensure it's visible

        // Track loaded model for the current 3D session only
        this.loadedModels.set(featureId, {
            model: pooledModel.model,
            feature: feature,
            sessionId: this._session3dId,
            // Recorded explicitly: the re-seat hook must not depend on the
            // feature property still being readable at re-seat time.
            heightOffset: heightOffset,
            lon: lonLat[0],
            lat: lonLat[1],
            distance: distance,
            lodLevel: lodLevel,
            modelUrl: modelUrl,
            lastUpdate: Date.now() // Track when it was last updated
        });

        if (debugConfig.enabled) console.log(`🎯 Added memory-managed GLTF model at:`, lonLat, `(LOD: ${lodLevel}, Distance: ${Math.round(distance)}m)`);

        // Listen for loading
        pooledModel.model.readyPromise.then(function(model) {
            if (debugConfig.enabled) console.log(`🎯 Memory-managed GLTF Model ${fidx} loaded successfully:`, model);
        }).catch(function(error) {
            // Model loading error silently handled
        });

        // NOTE: repetition models are NOT added here. addModelsFromLayer()
        // already calls addRepetitionModels() for every feature (both the
        // polygon and the non-polygon branch), and calling it a second time
        // from here added every repeated model twice — the residual duplicates
        // seen along roads (bus stops, benches, fences) after the base model
        // itself had been de-duplicated. Repetition primitives are not tracked
        // in loadedModels, so the per-session dedupe never covered them.
    },

    // Add repetition models for a feature
    addRepetitionModels: function(feature, cesiumScene) {
        // Check if this is a fence feature
        const hasFenceRepetitions = feature.get('fence_repetition_0');
        
        const isRepetition = feature.get('isRepetition');
        const hasRepetitions = feature.get('repetition_0'); // Check if this feature has repetition models
        
        if (isRepetition || hasRepetitions || hasFenceRepetitions) {
            // Determine repetition type for logging
            let repType = 'unknown';
            if (isRepetition) {
                repType = 'kerb';
            } else if (feature.get('fence_repetition_0')) {
                repType = 'fence';
            } else {
                repType = 'highway/footway';
            }
            
            if (debugConfig.enabled && debugConfig.logRepetitionModels) console.log(`Processing repetition models for ${repType} feature`);
            
            if (isRepetition) {
                // Kerb repetition: model data is stored directly on the feature
                const modelData = getFeatureModelOptions(feature);
                if (modelData && modelData.uri && modelData.position) {
                    try {
                        this.addRepetitionModel(feature, 0, modelData, cesiumScene);
                    } catch (error) {
                        // Kerb repetition model error silently handled
                    }
                } else {
                    if (debugConfig.enabled) console.warn('Kerb repetition feature missing model data');
                }
            } else {
                // Highway/Footway/Fence repetition: find all repetition models on this feature
                let repIndex = 0;
                let loggedCount = 0;
                while (true) {
                    // Check for fence repetitions first, then regular repetitions
                    const fenceRepModel = feature.get(`fence_repetition_${repIndex}`);
                    const repModel = fenceRepModel || feature.get(`repetition_${repIndex}`);
                    if (!repModel) break;
                    
                    try {
                        this.addRepetitionModel(feature, repIndex, repModel, cesiumScene);
                        repIndex++;
                    } catch (error) {
                        // Repetition model error silently handled
                        repIndex++;
                    }
                }
            }
        }
    },

    // Add individual repetition model
    addRepetitionModel: function(feature, repIndex, repModel, cesiumScene) {
        // Check total model limit to prevent excessive repetition models
        if (this.totalModelsAdded >= memoryConfig.maxTotalModels) {
            if (debugConfig.enabled && debugConfig.logRepetitionModels) console.warn(`🚶 Model limit reached (${memoryConfig.maxTotalModels}), skipping repetition model ${repIndex}`);
            return;
        }
        // Check if this is a polygon texture instead of individual model instances
        const repType = feature.get(`repetition_${repIndex}_type`);
        if (repType === 'polygon_texture') {
            const polygonCoordinates = feature.get(`repetition_${repIndex}_polygonCoordinates`);
            const polygonHoles = feature.get(`repetition_${repIndex}_polygonHoles`) || [];
            const spacing = feature.get(`repetition_${repIndex}_spacing`);
            const imageUri = repModel.uri;

            if (polygonCoordinates && imageUri) {
                // Force recalculation of rotation instead of using stored value
                const polygonCoords4326 = polygonCoordinates.map(coord => 
                    ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326')
                );
                const recalculatedRotation = this.calculateTextureRotation(polygonCoords4326, imageUri);
                if (modelRendererTexLog()) console.log(`🖼️ Recalculated repetition rotation ${repIndex}: ${(recalculatedRotation * 180 / Math.PI).toFixed(1)}° ${imageUri}`);
                
                if (debugConfig.enabled) console.log(`🖼️ Adding polygon texture for ${repIndex} with ${polygonCoordinates.length} coordinates and recalculated rotation: ${(recalculatedRotation * 180 / Math.PI).toFixed(1)}°`);
                this.addAreaTexture(
                    {
                        outer: polygonCoordinates,
                        holes: polygonHoles
                    },
                    imageUri,
                    { spacing: spacing, rotation: recalculatedRotation, scale: repModel.scale },
                    cesiumScene
                );
                return;
            }
        }

        // Original individual model logic continues below
        // Use the stored position from repetition generation
        const repPosition = repModel.position || 
                           feature.get(`fence_repetition_${repIndex}_position`) || 
                           feature.get(`repetition_${repIndex}_position`);
        if (!repPosition) {
            if (debugConfig.enabled) console.warn(`No position found for repetition model ${repIndex}`);
            return;
        }
        
        // The repPosition is already in lon/lat format (from footway_repetition.js)
        // No need to convert again
        const repLonLat = repPosition;

        // Distance gate. Repetitions used to be placed at ANY distance from the
        // camera: one road query produces repetitions along every metre of it,
        // so a 2 km street meant hundreds of live primitives — kerbs, fences,
        // lamps — that were never unloaded. Base models already had this gate.const repScene = cesiumScene || (window.ol3d && window.ol3d.getCesiumScene ? window.ol3d.getCesiumScene() : null);

        if (debugConfig.enabled) console.log(`🚶 Repetition model ${repIndex} using stored position: [${repPosition[0].toFixed(6)}, ${repPosition[1].toFixed(6)}] (already lon/lat)`);
        
        // Check if model is an image file (PNG/JPG)
        const modelUri = repModel.uri;
        const isRepImageFile = modelUri && (modelUri.toLowerCase().endsWith('.png') || modelUri.toLowerCase().endsWith('.jpg') || modelUri.toLowerCase().endsWith('.jpeg'));
        
        if (isRepImageFile) {
            // Handle image files using billboards
            if (debugConfig.enabled) console.log(`🚶 Loading image file as billboard: ${modelUri}`);
            this.addImageBillboard(repLonLat, modelUri, repModel, cesiumScene);
            return;
        }
        
        // Create model matrix for repetition model - GROUND LEVEL (like footway)
        const repHeightOffset = feature.get(`fence_repetition_${repIndex}_heightOffset`) || 
                               feature.get(`repetition_${repIndex}_heightOffset`) || 0; // Use stored height offset instead of hardcoded 10

        // Prime the DEM tile before sampling (see addModelForFeature): without it
        // repetitions placed early in a session are built at elevation 0.
        if (window.mapterhornTerrain && window.mapterhornTerrain.warmUp) {
            try { window.mapterhornTerrain.warmUp(repLonLat[0], repLonLat[1]); } catch (e) { /* no DEM yet */ }
        }
        
        // Get terrain elevation (exact bilinear DEM sample, as above)
        const repTerrainElevation = sampleGroundElevation(repLonLat[0], repLonLat[1]);
        
        const repTotalHeight = repHeightOffset + repTerrainElevation;
        let repModelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(
            Cesium.Cartesian3.fromDegrees(repLonLat[0], repLonLat[1], repTotalHeight)
        );
        
        // Follow terrain slope so poles/fences stand perpendicular to the ground
        if (window.mapterhornTerrain && window.mapterhornTerrain.applySlopeTilt) {
            try {
                repModelMatrix = window.mapterhornTerrain.applySlopeTilt(repModelMatrix, repLonLat[0], repLonLat[1]);
            } catch (e) { /* no DEM data yet */ }
        }
        
        if (debugConfig.enabled && repTerrainElevation > 0) {
            console.log(`🚶 Repetition model ${repIndex} positioned at terrain elevation: ${repTerrainElevation.toFixed(1)}m + offset: ${repHeightOffset.toFixed(1)}m = ${repTotalHeight.toFixed(1)}m`);
        }
        
        // Apply repetition model rotation
        let repModelRotation = null;
        
        // For kerb repetitions, rotation is stored as 'modelRotation'
        if (feature.get('isRepetition')) {
            repModelRotation = feature.get('modelRotation');
        } else {
            // Check for fence repetitions first, then highway/footway repetitions
            repModelRotation = feature.get(`fence_repetition_${repIndex}_rotation`) || 
                              feature.get(`repetition_${repIndex}_rotation`);
        }
        
        if (repModelRotation && Array.isArray(repModelRotation) && repModelRotation.length >= 3) {
            if (repModelRotation[1] !== 0) {
                const bearingRotation = Cesium.Matrix3.fromRotationZ(repModelRotation[1]);
                repModelMatrix = Cesium.Matrix4.multiplyByMatrix3(repModelMatrix, bearingRotation, new Cesium.Matrix4());
            }
            if (repModelRotation[0] !== 0) {
                const xRotation = Cesium.Matrix3.fromRotationX(repModelRotation[0]);
                repModelMatrix = Cesium.Matrix4.multiplyByMatrix3(repModelMatrix, xRotation, new Cesium.Matrix4());
            }
            if (repModelRotation[2] !== 0) {
                const zRotation = Cesium.Matrix3.fromRotationZ(repModelRotation[2]);
                repModelMatrix = Cesium.Matrix4.multiplyByMatrix3(repModelMatrix, zRotation, new Cesium.Matrix4());
            }
        }
        
        if (debugConfig.enabled) console.log(`🚶 Applied rotation to repetition model ${repIndex}: [${(repModelRotation || [0, 0, 0]).map(r => (r * 180 / Math.PI).toFixed(2) + '°').join(', ')}]`);
        
        if (debugConfig.enabled) console.log(`🚶 Repetition model url: ${repModel.uri}`);
        
        // Check if this is an image file - skip GLTF loading for images
        const isRepModelImageFile = repModel.uri && (repModel.uri.toLowerCase().endsWith('.png') || repModel.uri.toLowerCase().endsWith('.jpg') || repModel.uri.toLowerCase().endsWith('.jpeg'));
        if (isRepModelImageFile) {
            if (debugConfig.enabled) console.log(`🚶 Skipping GLTF loading for image file: ${repModel.uri}`);
            return;
        }
        
        const sceneToUse = cesiumScene || window.ol3d.getCesiumScene();
        const repCesiumModel = sceneToUse.primitives.add(Cesium.Model.fromGltf({
            url: repModel.uri,
            modelMatrix: repModelMatrix,
            scale: repModel.scale || 1.0,
            show: true
        }));
        
        // We own the height: Cesium's ground clamp is a no-op against the custom
        // MapTerhorn provider (no `availability`), so it left repetitions hanging
        // at the elevation the matrix was built with. Keep the matrix height and
        // let repositionModelsOnDem() refine it as tiles arrive.
        repCesiumModel.heightReference = Cesium.HeightReference.NONE;

        // Track repetition models so the DEM re-seat hook can re-ground them
        // when terrain tiles refine AFTER placement (without this, kerbs,
        // fences and lamps placed before fine tiles arrived stayed floating).
        this._repSeq = (this._repSeq || 0) + 1;
        this.loadedModels.set('rep_' + repIndex + '_' + this._repSeq, {
            model: repCesiumModel,
            feature: feature,
            sessionId: this._session3dId,
            heightOffset: repHeightOffset,
            lon: repLonLat[0],
            lat: repLonLat[1],
            distance: 0,
            lodLevel: 'rep',
            modelUrl: repModel.uri,
            lastUpdate: Date.now()
        });
        
        if (debugConfig.enabled && debugConfig.logRepetitionModels) console.log(`🚶 Added repetition GLTF model ${repIndex} at ground position:`, repLonLat);
    },

    // Add area texture for polygon features
    addAreaTextureForFeature: function(feature, model, fidx, cesiumScene) {
        if (debugConfig.enabled) console.log(`🎨 Adding area texture for polygon feature ${fidx} with model: ${model.uri}`);

        const geometry = feature.getGeometry();
        if (!geometry || !geometry.getType || (geometry.getType() !== 'Polygon' && geometry.getType() !== 'MultiPolygon')) {
            if (debugConfig.enabled) console.warn(`🎨 Feature ${fidx} is not a polygon, skipping area texture`);
            return;
        }

        // Get feature properties and create tags object
        const properties = feature.getProperties();
        const tagsObj = {};

        // Extract OSM tags from properties
        Object.keys(properties).forEach(prop => {
            if (!['geometry', 'id', 'type', 'originalType', 'fixedGeometry', 'members', 'memberOf', 'member', 'membership', 'role', 'version', 'timestamp', 'changeset', 'user', 'uid', 'visible'].includes(prop)) {
                tagsObj[prop] = properties[prop];
            }
        });

        // Check if model URI is valid
        if (!model || !model.uri || model.uri.trim() === '') {
            console.warn(`🎨 Feature ${fidx} has invalid model URI, skipping area texture`);
            return;
        }

        // Check if area texture manager is available
        if (!window.areaTextureManager) {
            console.error(`🎨 Area texture manager not available for feature ${fidx}`);
            return;
        }

        if (debugConfig.enabled) {
            console.log(`🎨 Creating area entity for feature ${fidx} with texture: ${model.uri}`);
            console.log(`🎨 Feature tags:`, tagsObj);
            console.log(`🎨 Model config:`, model);
        }

        // Use the area texture manager to create the entity
        try {
            const areaEntity = window.areaTextureManager.createAreaEntity(
                feature,
                model.uri, // This is the texture filename
                model, // Pass the model config
                tagsObj,
                properties
            );

            if (areaEntity) {
                if (debugConfig.enabled) console.log(`🎨 Successfully created area texture entity for feature ${fidx}`);
            } else {
                console.warn(`🎨 Failed to create area texture entity for feature ${fidx} - createAreaEntity returned null`);
            }
        } catch (error) {
            console.error(`🎨 Error creating area texture entity for feature ${fidx}:`, error);
        }
    },

    // Add image billboard for PNG/JPG files
    addImageBillboard: function(position, imageUri, repModel, cesiumScene) {
        if (debugConfig.enabled) {
            console.warn('🖼️ addImageBillboard is deprecated; use addAreaTexture for polygon coverage');
        }
    },

    // Add textured polygon for area coverage
    addAreaTexture: function(polygonData, imageUri, repModel, cesiumScene) {
        const polygonCoordinates = Array.isArray(polygonData) ? polygonData : polygonData.outer;
        const polygonHoles = Array.isArray(polygonData) ? [] : (polygonData.holes || []);
        if (debugConfig.enabled) console.log(`🖼️ addAreaTexture called with ${polygonCoordinates.length} outer coordinates and ${polygonHoles.length} hole(s), texture: ${imageUri}`);
        
        // Scale debug removed

        const sceneToUse = cesiumScene || window.ol3d.getCesiumScene();

        // Convert polygon coordinates to Cartesian3 WITHOUT explicit heights:
        // the polygon is ground-clamped (see entity below), so Cesium drapes it
        // over the rendered terrain (MapTerhorn DEM) and the base imagery
        // exactly — no step edges, no z-fighting, always aligned with ways on
        // slopes. (Per-vertex heights were tried here and broke rendering:
        // sparse OSM vertices made the triangulation cut into convex terrain.)
        const cartesianPositions = polygonCoordinates.map(coord =>
            Cesium.Cartesian3.fromDegrees(coord[0], coord[1])
        );
        const cartesianHoleHierarchies = polygonHoles.map(holeRing =>
            new Cesium.PolygonHierarchy(holeRing.map(coord =>
                Cesium.Cartesian3.fromDegrees(coord[0], coord[1]))));

        // Calculate bounding box in degrees
        let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
        polygonCoordinates.forEach(coord => {
            minLon = Math.min(minLon, coord[0]);
            maxLon = Math.max(maxLon, coord[0]);
            minLat = Math.min(minLat, coord[1]);
            maxLat = Math.max(maxLat, coord[1]);
        });

        // Calculate center latitude for accurate meter conversion
        const centerLat = (minLat + maxLat) / 2;

        // Convert degree differences to meters
        const widthMeters = (maxLon - minLon) * 111320 * Math.cos(centerLat * Math.PI / 180);
        const heightMeters = (maxLat - minLat) * 111320;

        // Use provided rotation or calculate new one
        let textureRotation;
        if (repModel && repModel.rotation !== undefined) {
            textureRotation = repModel.rotation;
            if (modelRendererTexLog()) console.log(`🖼️ Using provided rotation from repModel: ${(textureRotation * 180 / Math.PI).toFixed(1)}°`);
        } else {
            textureRotation = this.calculateTextureRotation(polygonCoordinates, imageUri);
            if (modelRendererTexLog()) console.log(`🖼️ Calculated texture rotation: ${(textureRotation * 180 / Math.PI).toFixed(1)}°`);
        }

        // Load image to get dimensions for proper scaling
        const img = new Image();
        let texturedPolygon; // Declare for scope

        img.onload = () => {
            const imageWidth = img.width;
            const imageHeight = img.height;
            const imageAspectRatio = imageWidth / imageHeight;
            const polygonAspectRatio = widthMeters / heightMeters;

            // Calculate desired texture size in meters (how large the texture should appear in real world)
            // For pavement/parking textures, typically 1 meter tiles
            const baseTextureSizeMeters = repModel.spacing || 1.0; // Use spacing from config, default 1m
            const textureScale = repModel.scale || 1.0; // Use scale from config, default 1
            const desiredTextureSizeMeters = baseTextureSizeMeters * textureScale; // Scale affects texture size

            // Calculate how many times to repeat texture to fill the polygon
            const textureRepeatX = widthMeters / desiredTextureSizeMeters;
            const textureRepeatY = heightMeters / desiredTextureSizeMeters;

            // Texture repeat is baked into the canvas tiling (GroundPrimitive approach)

            if (debugConfig.enabled) console.log(`🖼️ Fixed texture repeat: ${textureRepeatX.toFixed(2)} x ${textureRepeatY.toFixed(2)} (polygon ${widthMeters.toFixed(1)}m x ${heightMeters.toFixed(1)}m, desired tile size ${desiredTextureSizeMeters}m)`);

            if (modelRendererTexLog()) console.log(`🖼️ textureRotation: ${(textureRotation * 180 / Math.PI).toFixed(1)}°`);
            if (textureRotation !== 0) {
                if (modelRendererTexLog()) console.log(`🖼️ Creating rotated texture canvas: ${(textureRotation * 180 / Math.PI).toFixed(1)}°`);
                
                const imageWidth = img.width;
                const imageHeight = img.height;
                // Use actual image dimensions, not minimum
                const tileWidth = imageWidth;
                const tileHeight = imageHeight;
                const tileSize = Math.min(imageWidth, imageHeight); // For spacing calculation
                
                // Calculate canvas size based on polygon dimensions
                const baseTextureSizeMeters = repModel.spacing || 1.0;
                const textureScale = repModel.scale || 1.0;
                const desiredTextureSizeMeters = baseTextureSizeMeters * textureScale;
                const pixelsPerMeter = tileSize / desiredTextureSizeMeters;
                let canvasWidth = Math.floor(widthMeters * pixelsPerMeter);
                let canvasHeight = Math.floor(heightMeters * pixelsPerMeter);
                
                const scale = Math.min(1, AREA_TEXTURE_MAX_CANVAS / Math.max(canvasWidth, canvasHeight));
                canvasWidth = Math.floor(canvasWidth * scale);
                canvasHeight = Math.floor(canvasHeight * scale);
                const scaledTileWidth = Math.floor(tileWidth * scale);
                const scaledTileHeight = Math.floor(tileHeight * scale);
                
                if (modelRendererTexLog()) console.log(`🖼️ Canvas: ${canvasWidth}x${canvasHeight}px, tile: ${scaledTileWidth}x${scaledTileHeight}px`);
                
                const canvas = document.createElement('canvas');
                canvas.width = canvasWidth;
                canvas.height = canvasHeight;
                const ctx = canvas.getContext('2d');
                
                // Rotate context around center - apply different offsets based on texture type and orientation
                ctx.translate(canvasWidth / 2, canvasHeight / 2);
                const isCrossingTexture = imageUri.toLowerCase().includes('i_crossing.png') ||
                                        imageUri.toLowerCase().includes('crossing');
                const isParkingTexture = imageUri.toLowerCase().includes('i_parking');
                
                let finalRotation;
                if (isCrossingTexture) {
                    finalRotation = textureRotation + (45 * Math.PI / 180); // Add 45 degrees for crossings
                } else if (isParkingTexture) {
                    // For parking textures, apply different offsets based on street orientation
                    const bearingDegrees = ((textureRotation * 180 / Math.PI) + 360) % 360; // Normalize to 0-360
                    const isNorthSouth = (bearingDegrees >= 315 || bearingDegrees < 45) || // North (0° ± 45°)
                                       (bearingDegrees >= 135 && bearingDegrees < 225); // South (180° ± 45°)
                    const isEastWest = (bearingDegrees >= 45 && bearingDegrees < 135) || // East (90° ± 45°)
                                     (bearingDegrees >= 225 && bearingDegrees < 315); // West (270° ± 45°)
                    
                    if (isNorthSouth) {
                        finalRotation = textureRotation + (35 * Math.PI / 180); // Add 35 degrees for north-south parking
                        if (modelRendererTexLog()) {
                            console.log(`🖼️ North-South parking detected (bearing: ${bearingDegrees.toFixed(1)}°), applying 35° offset`);
                        }
                    } else if (isEastWest) {
                        finalRotation = textureRotation + (45 * Math.PI / 180); // Add 45 degrees for east-west parking
                        if (modelRendererTexLog()) {
                            console.log(`🖼️ East-West parking detected (bearing: ${bearingDegrees.toFixed(1)}°), applying 45° offset`);
                        }
                    } else {
                        finalRotation = textureRotation; // Fallback: no offset
                    }
                } else {
                    finalRotation = textureRotation; // Use direct rotation for other textures
                }
                
                if (modelRendererTexLog()) {
                    console.log(`🖼️ ${isCrossingTexture ? 'Crossing' : (isParkingTexture ? 'Parking' : 'Other')} texture - base: ${(textureRotation * 180 / Math.PI).toFixed(1)}°, final: ${(finalRotation * 180 / Math.PI).toFixed(1)}°`);
                }
                
                ctx.rotate(finalRotation);
                
                // Calculate how many tiles needed to cover area when rotated
                const diagonal = Math.sqrt(canvasWidth * canvasWidth + canvasHeight * canvasHeight);
                const tilesX = Math.ceil(diagonal / scaledTileWidth) + 2;
                const tilesY = Math.ceil(diagonal / scaledTileHeight) + 2;
                
                // Draw tiles covering entire area
                for (let x = 0; x < tilesX; x++) {
                    for (let y = 0; y < tilesY; y++) {
                        ctx.drawImage(img, 
                            -diagonal / 2 - scaledTileWidth + x * scaledTileWidth,
                            -diagonal / 2 - scaledTileHeight + y * scaledTileHeight,
                            scaledTileWidth,
                            scaledTileHeight);
                    }
                }
                
                // Create data URL
                const rotatedImageDataUrl = canvas.toDataURL('image/jpeg', AREA_TEXTURE_JPEG_QUALITY);
                
                // Create GroundPrimitive with rotated canvas — same layer as GLTF models
                const _sceneRT = cesiumScene || (window.ol3d && window.ol3d.getCesiumScene ? window.ol3d.getCesiumScene() : null);
                if (_sceneRT && polygonHierarchy) {
                    try {
                        const gpRot = new Cesium.GroundPrimitive({
                            geometryInstances: new Cesium.GeometryInstance({
                                geometry: new Cesium.PolygonGeometry({
                                    polygonHierarchy: polygonHierarchy,
                                    vertexFormat: Cesium.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat
                                })
                            }),
                            appearance: new Cesium.MaterialAppearance({
                                material: new Cesium.Material({ fabric: { type: 'Image', uniforms: { image: rotatedImageDataUrl } } }),
                                translucent: true
                            }),
                            asynchronous: false
                        });
                        _sceneRT.primitives.add(gpRot);
                        if (modelRendererTexLog()) console.log(`🖼️ Created GroundPrimitive with rotated texture`);
                    } catch (e) { if (debugConfig.enabled) console.warn('GroundPrimitive creation error:', e); }
                }
            }


            // No-rotation case: create GroundPrimitive with original image
            if (textureRotation === 0) {
                const _sceneNR = cesiumScene || (window.ol3d && window.ol3d.getCesiumScene ? window.ol3d.getCesiumScene() : null);
                if (_sceneNR && polygonHierarchy) {
                    try {
                        const gpNr = new Cesium.GroundPrimitive({
                            geometryInstances: new Cesium.GeometryInstance({
                                geometry: new Cesium.PolygonGeometry({
                                    polygonHierarchy: polygonHierarchy,
                                    vertexFormat: Cesium.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat
                                })
                            }),
                            appearance: new Cesium.MaterialAppearance({
                                material: new Cesium.Material({ fabric: { type: 'Image', uniforms: { image: imageUri } } }),
                                translucent: true
                            }),
                            asynchronous: false
                        });
                        _sceneNR.primitives.add(gpNr);
                        if (modelRendererTexLog()) console.log(`🖼️ Created GroundPrimitive with original texture`);
                    } catch (e) { if (debugConfig.enabled) console.warn('GroundPrimitive creation error:', e); }
                }
            }

            if (debugConfig.enabled) console.log(`🖼️ Fixed texture repeat: ${textureRepeatX.toFixed(2)} x ${textureRepeatY.toFixed(2)} (polygon ${widthMeters.toFixed(1)}m x ${heightMeters.toFixed(1)}m, desired tile size ${desiredTextureSizeMeters}m)`);
        };

        img.src = imageUri;

        // Initial repeat (will be updated when image loads) - apply scale here too
        const textureScale = repModel ? (repModel.scale || 1.0) : 1.0;
        const initialRepeatX = widthMeters / textureScale;
        const initialRepeatY = heightMeters / textureScale;

        // Calculate polygon center for entity rotation
        const centerLon = (minLon + maxLon) / 2;
        const centerPosition = Cesium.Cartesian3.fromDegrees(centerLon, centerLat);

        // Create polygon hierarchy
        const polygonHierarchy = new Cesium.PolygonHierarchy(cartesianPositions, cartesianHoleHierarchies);

        // Area textures are now rendered as GroundPrimitive on scene.primitives
        // (same layer as GLTF models) — avoids flying textures and keeps everything
        // on a single rendering layer. The primitive is created inside img.onload
        // below, once the texture image has loaded.
    },

    /**
     * Calculate texture rotation based on nearby ways that cross or are adjacent to the texture area
     * @param {Array<Array<number>>} polygonCoordinates - Polygon coordinates [lon, lat]
     * @param {string} textureName - Name of the texture file
     * @returns {number} Rotation angle in radians (0 if no rotation needed)
     */
    calculateTextureRotation: function(polygonCoordinates, textureName) {
        if (modelRendererTexLog()) console.log(`🖼️ calculateTextureRotation: ${textureName}`);

        const isCrossingTexture = textureName.toLowerCase().includes('i_crossing.png') ||
                                textureName.toLowerCase().includes('crossing');

        if (modelRendererTexLog()) console.log(`🖼️ isCrossingTexture: ${isCrossingTexture}`);

        if (isCrossingTexture) {
            if (modelRendererTexLog()) console.log(`🖼️ crossing texture path`);
            const crossingRotation = this.calculateCrossingTextureRotation(polygonCoordinates, textureName);
            if (modelRendererTexLog()) console.log(`🖼️ crossing rotation: ${crossingRotation}`);
            if (crossingRotation !== null) {
                if (modelRendererTexLog()) console.log(`🖼️ crossing bearing °: ${(crossingRotation * 180 / Math.PI).toFixed(1)}`);
                return crossingRotation;
            }
        } else {
            const isLimitTexture = textureName.toLowerCase().includes('i_llamborda.jpg') ||
                                  textureName.toLowerCase().includes('i_parking.png') ||
                                  textureName.toLowerCase().includes('i_parking.jpg') ||
                                  textureName.toLowerCase().includes('i_parking_space.jpg') ||
                                  textureName.toLowerCase().includes('i_parking_space_disabled.jpg') ||
                                  textureName.toLowerCase().includes('i_asfalt.jpg') ||
                                  textureName.toLowerCase().includes('i_gespa.jpg') ||
                                  textureName.toLowerCase().includes('i_manhole_drain.jpg') ||
                                  textureName.toLowerCase().includes('i_aigua.jpg') ||
                                  textureName.toLowerCase().includes('i_terra_verd.jpg');

            if (modelRendererTexLog()) console.log(`🖼️ isLimitTexture: ${isLimitTexture}`);

            if (isLimitTexture) {
                if (modelRendererTexLog()) console.log(`🖼️ limit/adjacent texture path (polygon longest edge)`);
                const limitRotation = this.calculateCrossingTextureRotation(polygonCoordinates, textureName);
                if (modelRendererTexLog()) console.log(`🖼️ limit rotation: ${limitRotation}`);
                if (limitRotation !== null) {
                    if (modelRendererTexLog()) console.log(`🖼️ limit bearing °: ${(limitRotation * 180 / Math.PI).toFixed(1)}`);
                    return limitRotation;
                }
            }
        }

        try {
            const layers = this.getAllMapLayers(window.map.getLayers().getArray());
            const nearbyWays = [];

            if (modelRendererTexLog()) console.log(`🖼️ scanning ${layers.length} layers for ways`);

            layers.forEach((layer, layerIndex) => {
                if (layer.getSource && typeof layer.getSource === 'function') {
                    const source = layer.getSource();
                    if (source && source.getFeatures) {
                        const features = source.getFeatures();
                        if (modelRendererTexLog()) console.log(`🖼️ layer ${layerIndex}: ${features.length} features`);

                        features.forEach((feature, featureIndex) => {
                            const geometry = feature.getGeometry();
                            if (geometry && (geometry.getType() === 'LineString' || geometry.getType() === 'MultiLineString')) {
                                if (this.wayIntersectsOrAdjacentToPolygon(geometry, polygonCoordinates)) {
                                    nearbyWays.push(feature);
                                    if (modelRendererTexLog()) console.log(`🖼️ nearby way L${layerIndex} F${featureIndex}`);
                                }
                            }
                        });
                    }
                }
            });

            if (modelRendererTexLog()) console.log(`🖼️ nearby ways: ${nearbyWays.length}`);

            const isParkingTexture = textureName.toLowerCase().includes('i_parking');
            let sourceWays = nearbyWays;
            if (isParkingTexture) {
                const kerbWays = nearbyWays.filter(f => f.get && f.get('barrier') === 'kerb');
                if (kerbWays.length > 0) {
                    if (modelRendererTexLog()) console.log(`🖼️ parking: using ${kerbWays.length} kerb way(s)`);
                    sourceWays = kerbWays;
                }
            }

            if (sourceWays.length === 0) {
                const closestFallbackSegment = this.findClosestWaySegmentToPolygon(
                    layers,
                    polygonCoordinates,
                    40,
                    isParkingTexture ? { key: 'barrier', value: 'kerb' } : null
                );
                if (closestFallbackSegment) {
                    if (modelRendererTexLog()) console.log(`🖼️ fallback segment d=${closestFallbackSegment.distance.toFixed(2)}m °=${(closestFallbackSegment.bearing * 180 / Math.PI).toFixed(1)}`);
                    return -closestFallbackSegment.bearing;
                }
                if (modelRendererTexLog()) console.log(`🖼️ no ways → rotation 0`);
                return 0;
            }

            // Pick the closest relevant way segment instead of averaging many ways.
            // Averaging can cancel out opposite directions and default texture to north.
            let bestSegment = null;
            sourceWays.forEach((feature, index) => {
                const geometry = feature.getGeometry();
                const coords = geometry.getType() === 'LineString' ?
                    geometry.getCoordinates() :
                    geometry.getCoordinates().flat();

                if (modelRendererTexLog()) console.log(`🖼️ way ${index}: ${coords.length} coords`);

                // Convert to EPSG:4326 if needed
                const lonLatCoords = coords.map(coord =>
                    ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326')
                );

                if (modelRendererTexLog()) console.log(`🖼️ way ${index} sample`, lonLatCoords.slice(0, 2));

                for (let i = 0; i < lonLatCoords.length - 1; i++) {
                    const start = lonLatCoords[i];
                    const end = lonLatCoords[i + 1];
                    const segment = [start, end];
                    const segmentDistance = this.lineSegmentDistanceToPolygonMeters(segment, polygonCoordinates);
                    const segmentLength = this.haversineDistance(start, end);
                    const segmentBearing = this.calculateSegmentBearing(start, end);

                    if (segmentBearing === null) continue;

                    if (!bestSegment ||
                        segmentDistance < bestSegment.distance - 0.001 ||
                        (Math.abs(segmentDistance - bestSegment.distance) < 0.001 && segmentLength > bestSegment.length)) {
                        bestSegment = {
                            distance: segmentDistance,
                            length: segmentLength,
                            bearing: segmentBearing,
                            wayIndex: index
                        };
                    }
                }
            });

            if (!bestSegment) {
                if (modelRendererTexLog()) console.log(`🖼️ no best segment → 0`);
                return 0;
            }

            if (modelRendererTexLog()) {
                console.log(`🖼️ best seg way ${bestSegment.wayIndex} d=${bestSegment.distance.toFixed(2)}m °=${(bestSegment.bearing * 180 / Math.PI).toFixed(1)}`);
            }

            // For textures, we want the texture to flow in the direction of the way
            // So we rotate the texture to align with the way's bearing
            // Cesium texture rotation: positive values rotate clockwise
            return -bestSegment.bearing;

        } catch (error) {
            // Texture rotation calculation error silently handled
            return 0;
        }
    },

    /**
     * Calculate rotation for crossing textures by finding the parent footway
     * @param {Array<Array<number>>} polygonCoordinates - Crossing polygon coordinates [lon, lat]
     * @param {string} textureName - Name of the texture file
     * @returns {number|null} Rotation angle in radians, or null if not found
     */
    calculateCrossingTextureRotation: function(polygonCoordinates, textureName) {
        // Calculate rotation from the polygon's own geometry
        // For crossing areas, the polygon represents the crossing itself
        // We calculate the bearing of its longest segment to determine orientation
        
        if (!polygonCoordinates || polygonCoordinates.length < 2) {
            return null;
        }

        // Convert to EPSG:4326 if needed
        const coords4326 = polygonCoordinates.map(coord => {
            if (coord.length === 2) {
                return coord; // Already [lon, lat]
            } else {
                return ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326');
            }
        });

        // Find the longest segment to determine orientation
        let maxDistance = 0;
        let bestStart, bestEnd;
        
        for (let i = 0; i < coords4326.length - 1; i++) {
            const start = coords4326[i];
            const end = coords4326[i + 1];
            
            const dLat = (end[1] - start[1]) * Math.PI / 180;
            const dLon = (end[0] - start[0]) * Math.PI / 180;
            const lat1 = start[1] * Math.PI / 180;
            const lat2 = end[1] * Math.PI / 180;
            
            const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                      Math.cos(lat1) * Math.cos(lat2) *
                      Math.sin(dLon/2) * Math.sin(dLon/2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            const distance = 6371000 * c; // Earth's radius in meters
            
            if (distance > maxDistance) {
                maxDistance = distance;
                bestStart = start;
                bestEnd = end;
            }
        }

        if (!bestStart || !bestEnd) {
            return 0;
        }

        // Calculate bearing from start to end
        const dLat = (bestEnd[1] - bestStart[1]) * Math.PI / 180;
        const dLon = (bestEnd[0] - bestStart[0]) * Math.PI / 180;
        const lat1 = bestStart[1] * Math.PI / 180;
        const lat2 = bestEnd[1] * Math.PI / 180;
        
        const y = Math.sin(dLon) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
        const bearing = Math.atan2(y, x);
        
        if (modelRendererTexLog()) {
            console.log(`🖼️ polygon-edge bearing °: ${(bearing * 180 / Math.PI).toFixed(1)} (seg ${maxDistance.toFixed(1)}m)`);
        }

        // For textures, we want them to align with the bearing direction
        // Cesium rotation is clockwise, so we negate the bearing
        return -bearing;
    },

    /**
     * Check if a way intersects or is adjacent to a polygon
     * @param {ol.geom.LineString|ol.geom.MultiLineString} wayGeometry - The way geometry
     * @param {Array<Array<number>>} polygonCoords - Polygon coordinates
     * @param {Array<Array<number>>} polygonCoords - Polygon coordinates [lon, lat]
     * @returns {boolean} True if the way intersects or is adjacent
     */
    wayIntersectsOrAdjacentToPolygon: function(wayGeometry, polygonCoords) {
        try {
            const wayCoords = wayGeometry.getType() === 'LineString' ?
                wayGeometry.getCoordinates() :
                wayGeometry.getCoordinates().flat();

            // Convert to EPSG:4326 if needed
            const wayLonLat = wayCoords.map(coord =>
                ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326')
            );

            // Check if any way segment crosses the polygon
            for (let i = 0; i < wayLonLat.length - 1; i++) {
                const segment = [wayLonLat[i], wayLonLat[i + 1]];
                if (this.lineIntersectsPolygon(segment, polygonCoords)) {
                    return true;
                }
                // Also treat segments that run very close to (or along) polygon limits as adjacent.
                if (this.lineAdjacentToPolygon(segment, polygonCoords, 10)) {
                    return true;
                }
            }

            // Check if way is adjacent (within 10 meters) to polygon
            const polygonBounds = this.getPolygonBounds(polygonCoords);
            for (const wayPoint of wayLonLat) {
                if (this.pointNearPolygon(wayPoint, polygonCoords, polygonBounds, 10)) {
                    return true;
                }
            }

            return false;
        } catch (error) {
            // Way intersection check error silently handled
            return false;
        }
    },

    /**
     * Check if a line segment intersects a polygon
     * @param {Array<Array<number>>} lineSegment - [[lon1, lat1], [lon2, lat2]]
     * @param {Array<Array<number>>} polygonCoords - Polygon coordinates
     * @returns {boolean} True if line intersects polygon
     */
    lineIntersectsPolygon: function(lineSegment, polygonCoords) {
        const [p1, p2] = lineSegment;

        // Check intersection with each polygon edge
        for (let i = 0; i < polygonCoords.length; i++) {
            const j = (i + 1) % polygonCoords.length;
            const edge = [polygonCoords[i], polygonCoords[j]];

            if (this.linesIntersect(p1, p2, edge[0], edge[1])) {
                return true;
            }
        }

        // Check if line segment is completely inside polygon
        return this.isPointInPolygon(p1, polygonCoords) && this.isPointInPolygon(p2, polygonCoords);
    },

    /**
     * Check if two line segments intersect
     */
    linesIntersect: function(a, b, c, d) {
        const eps = 1e-10;
        const orientation = (p, q, r) => {
            const value = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
            if (Math.abs(value) < eps) return 0;
            return value > 0 ? 1 : 2;
        };

        const onSegment = (p, q, r) => {
            return q[0] <= Math.max(p[0], r[0]) + eps &&
                   q[0] >= Math.min(p[0], r[0]) - eps &&
                   q[1] <= Math.max(p[1], r[1]) + eps &&
                   q[1] >= Math.min(p[1], r[1]) - eps;
        };

        const o1 = orientation(a, b, c);
        const o2 = orientation(a, b, d);
        const o3 = orientation(c, d, a);
        const o4 = orientation(c, d, b);

        if (o1 !== o2 && o3 !== o4) {
            return true;
        }

        // Colinear / touching endpoints are also intersections for area-edge matching.
        if (o1 === 0 && onSegment(a, c, b)) return true;
        if (o2 === 0 && onSegment(a, d, b)) return true;
        if (o3 === 0 && onSegment(c, a, d)) return true;
        if (o4 === 0 && onSegment(c, b, d)) return true;

        return false;
    },

    /**
     * Check whether a line segment is adjacent to any polygon edge within threshold meters.
     * Useful for ways that run next to or along polygon limits without crossing.
     */
    lineAdjacentToPolygon: function(lineSegment, polygonCoords, thresholdMeters = 10) {
        const [a, b] = lineSegment;

        for (let i = 0; i < polygonCoords.length; i++) {
            const j = (i + 1) % polygonCoords.length;
            const c = polygonCoords[i];
            const d = polygonCoords[j];

            // Intersections (including colinear overlap / touching) are handled as adjacent too.
            if (this.linesIntersect(a, b, c, d)) {
                return true;
            }

            const minDistance = Math.min(
                this.pointToSegmentDistanceMeters(a, c, d),
                this.pointToSegmentDistanceMeters(b, c, d),
                this.pointToSegmentDistanceMeters(c, a, b),
                this.pointToSegmentDistanceMeters(d, a, b)
            );

            if (minDistance <= thresholdMeters) {
                return true;
            }
        }

        return false;
    },

    /**
     * Distance from point P to segment AB in meters.
     */
    pointToSegmentDistanceMeters: function(point, segStart, segEnd) {
        const toMeters = (lon, lat, refLat) => {
            const x = lon * 111320 * Math.cos(refLat * Math.PI / 180);
            const y = lat * 111320;
            return [x, y];
        };

        const refLat = (point[1] + segStart[1] + segEnd[1]) / 3;
        const p = toMeters(point[0], point[1], refLat);
        const a = toMeters(segStart[0], segStart[1], refLat);
        const b = toMeters(segEnd[0], segEnd[1], refLat);

        const abx = b[0] - a[0];
        const aby = b[1] - a[1];
        const apx = p[0] - a[0];
        const apy = p[1] - a[1];
        const abLenSq = abx * abx + aby * aby;

        if (abLenSq === 0) {
            const dx = p[0] - a[0];
            const dy = p[1] - a[1];
            return Math.sqrt(dx * dx + dy * dy);
        }

        const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq));
        const closestX = a[0] + t * abx;
        const closestY = a[1] + t * aby;
        const dx = p[0] - closestX;
        const dy = p[1] - closestY;
        return Math.sqrt(dx * dx + dy * dy);
    },

    /**
     * Minimum distance from line segment to polygon edges in meters.
     */
    lineSegmentDistanceToPolygonMeters: function(lineSegment, polygonCoords) {
        const [a, b] = lineSegment;
        let minDistance = Infinity;

        for (let i = 0; i < polygonCoords.length; i++) {
            const j = (i + 1) % polygonCoords.length;
            const c = polygonCoords[i];
            const d = polygonCoords[j];

            if (this.linesIntersect(a, b, c, d)) {
                return 0;
            }

            const distance = Math.min(
                this.pointToSegmentDistanceMeters(a, c, d),
                this.pointToSegmentDistanceMeters(b, c, d),
                this.pointToSegmentDistanceMeters(c, a, b),
                this.pointToSegmentDistanceMeters(d, a, b)
            );

            if (distance < minDistance) {
                minDistance = distance;
            }
        }

        return Number.isFinite(minDistance) ? minDistance : Infinity;
    },

    /**
     * Find closest line segment from any way to the target polygon.
     */
            findClosestWaySegmentToPolygon: function(layers, polygonCoordinates, maxDistanceMeters = 40, preferredTag = null) {
        let bestSegment = null;

            layers.forEach((layer) => {
            if (!layer.getSource || typeof layer.getSource !== 'function') return;
            const source = layer.getSource();
            if (!source || !source.getFeatures) return;

            source.getFeatures().forEach((feature) => {
                const geometry = feature.getGeometry();
                if (!geometry || (geometry.getType() !== 'LineString' && geometry.getType() !== 'MultiLineString')) {
                    return;
                }

                const coords = geometry.getType() === 'LineString'
                    ? geometry.getCoordinates()
                    : geometry.getCoordinates().flat();
                const lonLatCoords = coords.map(coord =>
                    ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326')
                );

                for (let i = 0; i < lonLatCoords.length - 1; i++) {
                    const start = lonLatCoords[i];
                    const end = lonLatCoords[i + 1];
                    const bearing = this.calculateSegmentBearing(start, end);
                    if (bearing === null) continue;

                    const distance = this.lineSegmentDistanceToPolygonMeters([start, end], polygonCoordinates);
                    const length = this.haversineDistance(start, end);
                    if (distance > maxDistanceMeters) continue;

                    // If a preferred tag is requested (e.g. barrier=kerb for parking),
                    // favor segments coming from those features.
                    const isPreferred = preferredTag &&
                        feature.get &&
                        feature.get(preferredTag.key) === preferredTag.value;

                    if (!bestSegment) {
                        bestSegment = { distance, length, bearing, isPreferred };
                    } else {
                        const betterByPreference = isPreferred && !bestSegment.isPreferred;
                        const closer = distance < bestSegment.distance - 0.001;
                        const similarDistanceLonger = Math.abs(distance - bestSegment.distance) < 0.001 && length > bestSegment.length;
                        if (betterByPreference || closer || (similarDistanceLonger && (!betterByPreference && !bestSegment.isPreferred))) {
                            bestSegment = { distance, length, bearing, isPreferred };
                        }
                    }
                }
            });
        });

        return bestSegment;
    },

    /**
     * Flatten map layers recursively to include layers inside groups.
     */
    getAllMapLayers: function(layers) {
        const result = [];
        (layers || []).forEach((layer) => {
            if (layer && layer.getLayers && typeof layer.getLayers === 'function') {
                result.push(...this.getAllMapLayers(layer.getLayers().getArray()));
            } else {
                result.push(layer);
            }
        });
        return result;
    },

    /**
     * Bearing for a single segment [start -> end].
     */
    calculateSegmentBearing: function(start, end) {
        if (!start || !end) return null;
        if (start[0] === end[0] && start[1] === end[1]) return null;

        const dLon = (end[0] - start[0]) * Math.PI / 180;
        const lat1 = start[1] * Math.PI / 180;
        const lat2 = end[1] * Math.PI / 180;
        const y = Math.sin(dLon) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
        const bearing = Math.atan2(y, x);
        return (bearing + 2 * Math.PI) % (2 * Math.PI);
    },

    /**
     * Check if point is inside polygon using ray casting
     */
    isPointInPolygon: function(point, polygon) {
        const x = point[0], y = point[1];
        let inside = false;

        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i][0], yi = polygon[i][1];
            const xj = polygon[j][0], yj = polygon[j][1];

            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }

        return inside;
    },

    /**
     * Get bounding box of polygon
     */
    getPolygonBounds: function(polygonCoords) {
        let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
        polygonCoords.forEach(coord => {
            minLon = Math.min(minLon, coord[0]);
            maxLon = Math.max(maxLon, coord[0]);
            minLat = Math.min(minLat, coord[1]);
            maxLat = Math.max(maxLat, coord[1]);
        });
        return { minLon, maxLon, minLat, maxLat };
    },

    /**
     * Check if point is near polygon (within distance in meters)
     */
    pointNearPolygon: function(point, polygonCoords, bounds, maxDistanceMeters) {
        const [lon, lat] = point;

        // Quick bounds check
        if (lon < bounds.minLon - 0.001 || lon > bounds.maxLon + 0.001 ||
            lat < bounds.minLat - 0.001 || lat > bounds.maxLat + 0.001) {
            return false;
        }

        // Calculate distance from point to polygon edges
        for (let i = 0; i < polygonCoords.length; i++) {
            const j = (i + 1) % polygonCoords.length;
            const edge = [polygonCoords[i], polygonCoords[j]];
            const distance = this.pointToLineDistance(point, edge[0], edge[1]);
            if (distance <= maxDistanceMeters) {
                return true;
            }
        }

        return false;
    },

    /**
     * Calculate distance from point to line segment in meters
     */
    pointToLineDistance: function(point, lineStart, lineEnd) {
        const [px, py] = point;
        const [x1, y1] = lineStart;
        const [x2, y2] = lineEnd;

        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.sqrt(dx * dx + dy * dy);

        if (length === 0) return this.haversineDistance(point, lineStart);

        const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (length * length)));
        const closestX = x1 + t * dx;
        const closestY = y1 + t * dy;

        return this.haversineDistance(point, [closestX, closestY]);
    },

    /**
     * Calculate haversine distance between two points in meters
     */
    haversineDistance: function(point1, point2) {
        const R = 6371000; // Earth's radius in meters
        const [lon1, lat1] = point1;
        const [lon2, lat2] = point2;

        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        return R * c;
    },

    /**
     * Calculate bearing (direction) of a way from its coordinates
     * @param {Array<Array<number>>} coords - Array of [lon, lat] coordinates
     * @returns {number|null} Bearing in radians, or null if cannot calculate
     */
    calculateWayBearing: function(coords) {
        if (!coords || coords.length < 2) return null;

        // Use the first segment to determine direction
        const start = coords[0];
        const end = coords[1];

        const dLon = (end[0] - start[0]) * Math.PI / 180;
        const lat1 = start[1] * Math.PI / 180;
        const lat2 = end[1] * Math.PI / 180;

        const y = Math.sin(dLon) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

        const bearing = Math.atan2(y, x);

        // Normalize to 0-2π
        return (bearing + 2 * Math.PI) % (2 * Math.PI);
    },

    // Main entry point for adding all models
    // Data source for plain (non-model) results, created on demand per scene.
    _plainDataSource: null,
    _plainIdSeq: 0,

    /**
     * Unique entity id for a plain result. Cesium's EntityCollection throws on
     * a duplicate id, and fidx repeats across layers, so ids come from a
     * monotonic counter instead.
     */
    _nextPlainId: function() {
        this._plainIdSeq = (this._plainIdSeq || 0) + 1;
        return 'plain-' + this._session3dId + '-' + this._plainIdSeq;
    },

    /**
     * The Cesium DataSourceCollection holding the plain-result entities.
     *
     * `cesiumScene` is ol-cesium's CesiumScene WRAPPER, not a real
     * Cesium.Scene: it proxies `primitives`/`camera`, but it has no
     * `dataSources` at all (the string does not appear anywhere in
     * ol-cesium). Reading `cesiumScene.dataSources.add(...)` therefore threw
     * "Cannot read properties of undefined" for the first model-less feature
     * of every layer — and, before the per-feature try/catch, that silently
     * aborted the whole layer, which is what left GeoJSON-loaded overlays
     * with no models and no textures.
     *
     * The collection lives on the OLCesium instance instead, which is the
     * accessor the rest of this codebase (buildings.js, cesium_models.js)
     * already uses.
     */
    getPlainDataSource: function(cesiumScene) {
        const ol3d = window.ol3d;
        if (!ol3d || typeof ol3d.getDataSources !== 'function') {
            if (debugConfig.enabled) {
                console.warn('➖ Skipping plain result: OLCesium data sources unavailable');
            }
            return null;
        }
        const dataSources = ol3d.getDataSources();
        if (!dataSources) return null;

        const previous = this._plainDataSource;
        if (previous && typeof dataSources.contains === 'function' &&
            dataSources.contains(previous)) {
            return previous;
        }
        const dataSource = new Cesium.CustomDataSource('PlainResults');
        dataSources.add(dataSource);
        this._plainDataSource = dataSource;
        return dataSource;
    },

    /**
     * Draw a query result that has neither a model nor a texture, conforming it
     * to the terrain. Called for every such feature, so it must be idempotent:
     * an entity already created for this feature in this 3D session is reused.
     */
    addPlainResult: function(feature, fidx, cesiumScene, layer) {
        const geometry = feature.getGeometry && feature.getGeometry();
        if (!geometry || !geometry.getType) return;
        const type = geometry.getType();

        // Only the geometry types ol-cesium was drawing for us at sea level.
        if (type !== 'Point' && type !== 'LineString' && type !== 'MultiLineString' &&
            type !== 'Polygon' && type !== 'MultiPolygon' && type !== 'LinearRing') {
            return;
        }
        if (!this.plainResults) this.plainResults = new Map();
        const existing = this.plainResults.get(feature);
        if (existing && existing.sessionId === this._session3dId) return;  // already drawn

        let positions;
        try {
            if (type === 'Point') {
                positions = plainCoordsToCartesian([geometry.getCoordinates()]);
            } else {
                positions = plainCoordsToCartesian(plainFlattenCoords(geometry.getCoordinates()));
            }
        } catch (e) { return; }
        if (!positions || !positions.length) return;

        const dataSource = this.getPlainDataSource(cesiumScene);
        if (!dataSource) return;   // no 3D scene/datasources: nothing to draw into
        const style = readPlainStyle(feature, layer);
        let graphics = null;

        if (type === 'Point') {
            const image = style && style.getImage && style.getImage();
            if (image && image.src) {
                graphics = { billboard: { image: image.src, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND } };
            } else {
                let size = PLAIN_MARKER_PIXEL_SIZE;
                let color = PLAIN_MARKER_COLOR;
                if (style && style.getImage && style.getImage()) {
                    const img = style.getImage();
                    if (img.size) size = Math.max(3, Math.round(img.size[0]));
                }
                if (style && style.getFill && style.getFill()) {
                    const fill = style.getFill();
                    const olColor = fill.getColor ? fill.getColor() : null;
                    if (olColor) color = olColorToCesium(olColor, color);
                }
                graphics = {
                    point: {
                        pixelSize: size,
                        color: color,
                        // CLAMP_TO_GROUND keeps the marker sitting on the surface
                        // instead of at sea level, and re-seats it as the DEM refines.
                        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                        outlineColor: Cesium.Color.BLACK,
                        outlineWidth: 1
                    }
                };
            }
        } else if (type === 'LineString' || type === 'MultiLineString' || type === 'LinearRing') {
            const stroke = style && style.getStroke && style.getStroke();
            let width = 3;
            let color = PLAIN_LINE_COLOR;
            if (stroke) {
                if (stroke.getWidth && stroke.getWidth()) width = Math.max(1, stroke.getWidth());
                if (stroke.getColor && stroke.getColor()) color = olColorToCesium(stroke.getColor(), color);
            }
            // A MultiLineString yields several paths, but Cesium takes one
            // position list per polyline: draw each path as its own entity.
            const paths = type === 'MultiLineString'
                ? geometry.getCoordinates().map(coords => plainCoordsToCartesian(coords))
                : [positions];
            const created = [];
            paths.forEach(path => {
                if (!path || path.length < 2) return;
                created.push(dataSource.entities.add({
                    id: this._nextPlainId(),
                    polyline: {
                        positions: path,
                        width: width,
                        material: color,
                        // Drapes the line over hills, valleys and inclines.
                        clampToGround: true
                    }
                }));
            });
            if (!created.length) return;
            this.plainResults.set(feature, { entities: created, sessionId: this._session3dId });
            if (debugConfig.enabled) {
                console.log('➖ Plain line draped on ground: ' + created.length + ' path(s)');
            }
            return;
        } else {
            // Polygon / MultiPolygon: let Cesium build a ground primitive that
            // follows the surface exactly. The outer ring and the holes must stay
            // separate, so the raw ring structure is used rather than the flat
            // vertex list.
            const rings = (type === 'MultiPolygon' ? geometry.getCoordinates()[0] : geometry.getCoordinates())
                .filter(r => r && r.length > 2)
                .map(r => plainCoordsToCartesian(r));
            if (!rings.length) return;
            const fill = style && style.getFill && style.getFill();
            let color = PLAIN_AREA_COLOR;
            if (fill && fill.getColor && fill.getColor()) color = olColorToCesium(fill.getColor(), color);
            graphics = {
                polygon: {
                    hierarchy: new Cesium.PolygonHierarchy(
                        rings[0], rings.slice(1).map(r => new Cesium.PolygonHierarchy(r))),
                    material: color,
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
                }
            };
        }

        const entity = dataSource.entities.add(Object.assign({
            id: this._nextPlainId(),
            position: positions[0]
        }, graphics));
        this.plainResults.set(feature, { entities: [entity], sessionId: this._session3dId });
        if (debugConfig.enabled) console.log('➖ Plain ' + type + ' draped on ground');
    },

    /** Drop plain results tracked for a previous 3D session (primitives died). */
    clearPlainResults: function() {
        if (this.plainResults) this.plainResults.clear();
        this._plainDataSource = null;
    },

    addAllModels: function() {
        if (debugConfig.enabled) console.log('🎯 addAllModels: scanning layers for 3D models');
        if (!window.ol3d) {
            if (debugConfig.enabled) console.log('🎯 ol3d unavailable');
            return;
        }

        const cesiumScene = window.ol3d.getCesiumScene();

        // A NEW scene means every tracked primitive died with the previous one,
        // so start a new session exactly once. This used to bump the session id
        // on EVERY call, which silently defeated the dedupe check below
        // (tracked.sessionId === this._session3dId): all 6 addAllModels() call
        // sites re-processed every feature, and because pooled models are still
        // flagged visible the renderer created a SECOND primitive per feature
        // and left the first one in the scene. The result was every model drawn
        // twice — the older copy stranded at its first-pass height, which is
        // what looked like a second model "flying" above the terrain.
        if (this._sceneRef !== cesiumScene) {
            this._sceneRef = cesiumScene;
            this._session3dId = (this._session3dId || 0) + 1;
            this.loadedModels.clear();
            this.modelPool.clear();
            // A pass in flight belongs to the previous scene; its primitives are
            // about to be destroyed with it.
            this._placing = false;
            this._pendingSweep = false;
            if (this.clearPlainResults) this.clearPlainResults();
            if (debugConfig.enabled) console.log('🎯 New 3D session ' + this._session3dId + ' — tracking reset');
        }

        // Hook DEM tile loads once: models placed before MapTerhorn tiles were
        // decoded (elevation 0) must be re-seated on the ground when they arrive
        if (window.mapterhornTerrain && window.mapterhornTerrain.onTilesLoaded && !this._demRepositionHooked) {
            this._demRepositionHooked = true;
            window.mapterhornTerrain.onTilesLoaded(() => this.repositionModelsOnDem());
        }

        if (cesiumScene && cesiumScene.primitives) {
            try {
                if (debugConfig.enabled) console.log('🎯 Cesium scene available, processing layers...');
                // One pass at a time: a second sweep arriving mid-pass (a new
                // query, the +3s retry) waits for this one instead of placing
                // the same features concurrently.
                if (this._placing) { this._pendingSweep = true; return; }

                const layers = window.map.getLayers().getArray();
                const tasks = this.collectPlaceTasks(layers, cesiumScene, []);
                // Tell the panel the real total BEFORE any work starts, so the
                // percentage it shows is a percentage of something.
                this._progressTotal = tasks.length;
                if (window.loadingProgress && window.loadingProgress.total) {
                    window.loadingProgress.total(tasks.length);
                }
                this.runPlaceSlices(tasks);
                if (debugConfig.enabled) console.log('🎯 Layer processing started (' + tasks.length + ' features)');
            } catch (error) {
                console.error('🎯 Model renderer error:', error);
            }
        } else if (debugConfig.enabled) {
            console.log('🎯 Cesium scene unavailable');
        }
    },

    // Re-seat tracked models on the DEM ground when new terrain tiles arrive.
    // Keeps the original rotation/tilt baked in the matrix and only updates the
    // translation height, so nothing flips when the elevation refines.
    repositionModelsOnDem: function() {
        // No DEM source at all: sampleGroundElevation would answer 0 and we
        // would actively drag every model down to sea level. Do nothing.
        const hasDem = (window.terrainManager && window.terrainManager.getElevation) ||
                       (window.mapterhornTerrain && window.mapterhornTerrain.getElevation);
        if (!hasDem) return;
        if (!this.loadedModels || this.loadedModels.size === 0) return;
        if (!window.ol3d || !window.ol3d.getCesiumScene) return;

        let updated = 0;
        this.loadedModels.forEach((entry) => {
            try {
                if (!entry.model || !entry.feature) return;
                // GroundPrimitive area textures are clamped to the terrain by
                // Cesium and carry no modelMatrix: there is nothing to re-seat.
                if (entry.kind === 'texture') return;
                // Skip entries from older 3D sessions — their primitives were
                // destroyed with the previous scene and must not be touched.
                if (entry.sessionId !== undefined && entry.sessionId !== this._session3dId) return;
                // Nothing is skipped here any more. Models used to be marked
                // CLAMP_TO_GROUND and skipped on that basis, but the clamp is a
                // no-op with the MapTerhorn provider (it exposes no
                // `availability`), so the skipped models were exactly the ones
                // that needed re-seating — they stayed frozen at elevation 0.
                // Rotation/tilt are preserved: only the translation is rewritten.
                const lon = entry.lon, lat = entry.lat;
                const heightOffset = (entry.heightOffset !== undefined && entry.heightOffset !== null)
                    ? entry.heightOffset
                    : (entry.feature.get('modelHeightOffset') || 0.0);
                // Sample exactly the same way placement did. Reading
                // mapterhornTerrain directly here fought the placement path,
                // which prefers terrainManager (local GeoTIFF) when one is
                // loaded: the two sources disagreed and the model was dragged
                // between them on every tile callback. Same sampler, same answer.
                const demHeight = sampleGroundElevation(lon, lat);
                if (demHeight === null || demHeight === undefined || !isFinite(demHeight)) return;
                const totalHeight = heightOffset + demHeight;

                const matrix = entry.model.modelMatrix;
                const translation = Cesium.Matrix4.getColumn(matrix, 3, new Cesium.Cartesian4());
                const currentHeight = Cesium.Cartographic.fromCartesian(
                    new Cesium.Cartesian3(translation.x, translation.y, translation.z)).height;
                if (!isFinite(currentHeight)) return;

                // Soft re-seat: only move when the correction is clearly beyond
                // sampling noise (0.5m). Corrections are safe in both directions
                // now that getElevation returns the RENDERED surface.
                const delta = totalHeight - currentHeight;
                if (Math.abs(delta) < 0.5) return;

                Cesium.Matrix4.setTranslation(
                    matrix,
                    Cesium.Cartesian3.fromDegrees(lon, lat, totalHeight),
                    matrix
                );
                updated++;
            } catch (e) { /* skip this model */ }
        });

        if (updated > 0 && debugConfig.enabled) {
            console.log(`🎯 Re-seated ${updated} model(s) on MapTerhorn DEM ground`);
        }
    },
};

if (typeof debugConfig !== 'undefined' && debugConfig.enabled) {
    console.log('🎯 model_renderer.js loaded');
}

// A key search dispatches 'tagOverlayLoaded' once its Overpass results are
// parsed, and those results almost always arrive AFTER 3D mode was entered — the
// one-shot init below had already swept the layers and found nothing, because the
// query had not run yet. Nothing in the app listened for this event name (only
// 'tagQueryAdded', which value search fires and key search does not), so results
// loaded during a 3D session were never re-scanned and stayed flat.
//
// addAllModels() re-walks every layer and is idempotent: addModelForFeature()
// skips features already tracked in the current 3D session, and re-entering 3D
// bumps the session id. Same pattern as the tagQueryAdded/overlayFeaturesLoaded
// listeners in buildings.js.
window.addEventListener('tagOverlayLoaded', function () {
    if (window.is3d && window.ol3d && window.ol3d.getEnabled && window.ol3d.getEnabled()) {
        window.modelRenderer.addAllModels();
    }
});

// When 3D mode ends the Cesium scene is replaced on the next 3D session.
// All tracked primitives and pooled models from the old scene are dead:
// forget them so re-entering 3D rebuilds everything in the new scene
// instead of reusing primitives that belong to a destroyed scene.
window.addEventListener('ol3dDestroyed', function () {
    if (window.modelRenderer) {
        window.modelRenderer.loadedModels.clear();
        window.modelRenderer.modelPool.clear();
        window.modelRenderer.totalModelsAdded = 0;
        window.modelRenderer._placing = false;
        window.modelRenderer._pendingSweep = false;
        if (window.modelRenderer.clearPlainResults) window.modelRenderer.clearPlainResults();
        // Forget the dead scene so the next addAllModels() starts a new session
        // even if ol-cesium hands back an equivalent object.
        window.modelRenderer._sceneRef = null;
        if (debugConfig.enabled) console.log('🎯 Cleared model tracking after 3D mode ended');
    }
});
