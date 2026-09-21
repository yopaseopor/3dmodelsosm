/**
 * MapTerhorn Terrain Provider
 * ---------------------------
 * Renders real terrain (mountains/valleys) in the Cesium 3D view using the
 * MapTerhorn global terrain tiles:
 *     https://tiles.mapterhorn.com/tilejson.json
 *     { tiles: ["https://tiles.mapterhorn.com/{z}/{x}/{y}.webp"],
 *       encoding: "terrarium", tileSize: 512, scheme: "xyz", maxZoom: 15 }
 *
 * How it works:
 *  - XYZ (slippy) tiles line up 1:1 with Cesium's WebMercatorTilingScheme,
 *    so each tile can be turned directly into a Cesium heightmap.
 *  - WebP tiles are decoded through a canvas and the "terrarium" encoding
 *    (h = R*256 + G + B/256 - 32768) is converted to meters.
 *  - Each decoded tile is resampled to a 129x129 heightmap grid which is
 *    handed to Cesium as HeightmapTerrainData (skirts handle tile edges).
 *  - Levels above 15 are served by slicing the z15 ancestor tile, so the
 *    terrain works at every zoom level.
 *
 * It also exposes:
 *  - mapterhornTerrain.getElevation(lon, lat)   -> meters (sync, cached tiles)
 *  - mapterhornTerrain.getSlopeInfo(lon, lat)   -> surface normal / tilt
 *  - mapterhornTerrain.applySlopeTilt(modelMatrix, lon, lat)
 *      -> tilts a model so it stands perpendicular to the terrain surface
 *         ("correct inclination" on mountains).
 *  - mapterhornTerrain.applyToScene(scene)      -> enable real terrain.
 */
(function () {
    'use strict';

    if (typeof window === 'undefined' || typeof Cesium === 'undefined') {
        console.warn('🗺️ MapTerhorn terrain module skipped (Cesium not loaded)');
        return;
    }

    // ---------------------------------------------------------------------
    // Configuration
    // ---------------------------------------------------------------------

    const DEFAULT_TILE_URL = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';
    const DEFAULT_MAX_LEVEL = 15;          // MapTerhorn serves 0..15
    const DEFAULT_HEIGHTMAP_SIZE = 129;    // 128x128 quads per tile
    const DEFAULT_SAMPLE_LEVEL = 15;       // zoom used for elevation queries
    const DEFAULT_SAMPLE_RADIUS = 20;      // meters between slope samples
    const DEFAULT_MAX_TILT = 35 * Math.PI / 180; // clamp tilt for models
    const MAX_CACHED_TILES = 900;          // ~60MB of 129x129 Float32 grids.
                                           // Sized to keep fine tiles resident when
                                           // globe.maximumScreenSpaceError=1 demands
                                           // extra refinement near the camera — if fine
                                           // tiles get evicted the provider re-serves
                                           // coarse ancestors and draped textures sag
                                           // off the mesh ("flying" at grazing angles).
    const TERRARIUM_OFFSET = 32768.0;

    function debugEnabled() {
        return window.MAPTERTHORN_VERBOSE === true ||
            (new URLSearchParams(window.location.search).get('debug') === 'true');
    }

    function log() {
        if (debugEnabled()) console.log.apply(console, ['🗺️'].concat(Array.prototype.slice.call(arguments)));
    }

    // ---------------------------------------------------------------------
    // Slippy-tile math helpers
    // ---------------------------------------------------------------------

    function lonToTileX(lon, zoom) {
        const n = 1 << zoom;
        return (lon + 180) / 360 * n;
    }

    function latToTileY(lat, zoom) {
        const n = 1 << zoom;
        const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
        const rad = clamped * Math.PI / 180;
        return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n;
    }

    /** Bilinear sample of a square grid. u,v in [0,1]; v=0 is the north row. */
    function sampleGrid(src, srcSize, u, v) {
        const gx = Math.max(0, Math.min(srcSize - 1, u * (srcSize - 1)));
        const gy = Math.max(0, Math.min(srcSize - 1, v * (srcSize - 1)));
        const x0 = Math.floor(gx), y0 = Math.floor(gy);
        const x1 = Math.min(x0 + 1, srcSize - 1), y1 = Math.min(y0 + 1, srcSize - 1);
        const fx = gx - x0, fy = gy - y0;
        const h00 = src[y0 * srcSize + x0], h10 = src[y0 * srcSize + x1];
        const h01 = src[y1 * srcSize + x0], h11 = src[y1 * srcSize + x1];
        return h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) +
               h01 * (1 - fx) * fy + h11 * fx * fy;
    }

    /**
     * Resample the sub-rectangle [u0,u1]x[v0,v1] of a srcSize x srcSize grid
     * into a new size x size grid.
     */
    function resampleGrid(src, srcSize, size, u0, u1, v0, v1) {
        const out = new Float32Array(size * size);
        for (let iy = 0; iy < size; iy++) {
            const v = v0 + (v1 - v0) * (iy / (size - 1));
            for (let ix = 0; ix < size; ix++) {
                const u = u0 + (u1 - u0) * (ix / (size - 1));
                out[iy * size + ix] = sampleGrid(src, srcSize, u, v);
            }
        }
        return out;
    }

    // ---------------------------------------------------------------------
    // WebP -> terrarium height decoding
    // ---------------------------------------------------------------------

    let sharedCanvas = null;

    function decodeTerrariumWebp(arrayBuffer) {
        return new Promise((resolve, reject) => {
            let blobUrl = null;
            const cleanup = () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
            try {
                const blob = new Blob([arrayBuffer], { type: 'image/webp' });
                blobUrl = URL.createObjectURL(blob);
                const img = new Image();
                img.onload = () => {
                    try {
                        const w = img.naturalWidth;
                        const h = img.naturalHeight;
                        if (!w || !h) throw new Error('Empty terrain tile image');
                        if (!sharedCanvas) sharedCanvas = document.createElement('canvas');
                        if (sharedCanvas.width < w || sharedCanvas.height < h) {
                            sharedCanvas.width = w;
                            sharedCanvas.height = h;
                        }
                        const ctx = sharedCanvas.getContext('2d', { willReadFrequently: true });
                        ctx.clearRect(0, 0, w, h);
                        ctx.drawImage(img, 0, 0, w, h);
                        const pixels = ctx.getImageData(0, 0, w, h).data;
                        const heights = new Float32Array(w * h);
                        for (let i = 0; i < w * h; i++) {
                            const o = i * 4;
                            heights[i] = (pixels[o] * 256 + pixels[o + 1] + pixels[o + 2] / 256) - TERRARIUM_OFFSET;
                        }
                        cleanup();
                        resolve({ width: w, height: h, heights: heights });
                    } catch (e) {
                        cleanup();
                        reject(e);
                    }
                };
                img.onerror = () => {
                    cleanup();
                    reject(new Error('Failed to decode terrain WebP tile'));
                };
                img.src = blobUrl;
            } catch (e) {
                cleanup();
                reject(e);
            }
        });
    }

    // ---------------------------------------------------------------------
    // Tile cache (z/x/y -> 129x129 height grid)
    // ---------------------------------------------------------------------

    class MapterhornTileCache {
        constructor(tileUrl, heightmapSize) {
            this.tileUrl = tileUrl;
            this.heightmapSize = heightmapSize;
            this._tiles = new Map();     // key -> {grid, min, max}
            this._pending = new Map();   // key -> Promise
            this._onTileLoaded = [];
        }

        onTileLoaded(cb) { this._onTileLoaded.push(cb); }

        _notify() {
            this._onTileLoaded.forEach(cb => {
                try { cb(); } catch (e) { /* listener error ignored */ }
            });
        }

        static key(z, x, y) { return z + '/' + x + '/' + y; }

        getIfCached(z, x, y) {
            const k = MapterhornTileCache.key(z, x, y);
            const entry = this._tiles.get(k);
            if (entry) {
                // LRU touch
                this._tiles.delete(k);
                this._tiles.set(k, entry);
            }
            return entry;
        }

        /** Fetch + decode a tile; resolves with {grid, min, max} or rejects. */
        get(z, x, y) {
            const k = MapterhornTileCache.key(z, x, y);
            const cached = this.getIfCached(z, x, y);
            if (cached) return Promise.resolve(cached);

            const inFlight = this._pending.get(k);
            if (inFlight) return inFlight;

            const url = this.tileUrl
                .replace('{z}', z).replace('{x}', x).replace('{y}', y);

            const promise = fetch(url)
                .then(response => {
                    if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + url);
                    return response.arrayBuffer();
                })
                .then(buf => decodeTerrariumWebp(buf))
                .then(decoded => {
                    const srcGrid = this._toUnitGrid(decoded);
                    const srcSize = decoded.width;
                    const grid = resampleGrid(
                        srcGrid, srcSize,
                        this.heightmapSize,
                        0, 1, 0, 1
                    );
                    let min = Infinity, max = -Infinity;
                    for (let i = 0; i < grid.length; i++) {
                        if (grid[i] < min) min = grid[i];
                        if (grid[i] > max) max = grid[i];
                    }
                    const entry = { grid: grid, min: min, max: max };
                    this._tiles.set(k, entry);
                    this._evict();
                    this._pending.delete(k);
                    this._notify();
                    return entry;
                })
                .catch(err => {
                    this._pending.delete(k);
                    throw err;
                });

            this._pending.set(k, promise);
            return promise;
        }

        /** Decode result is already meters; kept as a hook for clamp/NaN fixes. */
        _toUnitGrid(decoded) {
            const g = decoded.heights;
            for (let i = 0; i < g.length; i++) {
                if (!isFinite(g[i])) g[i] = 0;
            }
            return g;
        }

        _evict() {
            while (this._tiles.size > MAX_CACHED_TILES) {
                const oldest = this._tiles.keys().next().value;
                this._tiles.delete(oldest);
            }
        }
    }

    // ---------------------------------------------------------------------
    // Cesium terrain provider
    // ---------------------------------------------------------------------

    class MapterhornTerrainProvider {
        constructor(options) {
            options = options || {};
            this.tileUrl = options.tileUrl || DEFAULT_TILE_URL;
            this.maxLevel = options.maxLevel || DEFAULT_MAX_LEVEL;
            this.heightmapSize = options.heightmapSize || DEFAULT_HEIGHTMAP_SIZE;
            this._cache = options.cache || new MapterhornTileCache(this.tileUrl, this.heightmapSize);
            this._tilingScheme = new Cesium.WebMercatorTilingScheme();
            this._credit = new Cesium.Credit(
                '<a href="https://mapterhorn.com/attribution" target="_blank">© Mapterhorn</a>', true);
            this._errorEvent = new Cesium.Event();
            this._ready = true;
            this._readyPromise = Promise.resolve(this);
            this.isMapterhornProvider = true;
        }

        get tilingScheme() { return this._tilingScheme; }
        get ready() { return this._ready; }
        get readyPromise() { return this._readyPromise; }
        get credit() { return this._credit; }
        get errorEvent() { return this._errorEvent; }
        get hasWaterMask() { return false; }
        get hasVertexNormals() { return false; }
        get requestVertexNormals() { return false; }
        get requestWaterMask() { return false; }
        get availability() { return undefined; }

        getTileDataAvailable(x, y, level) {
            // Cap refinement at the source resolution: Cesium upsamples the
            // z15 heights geometrically instead of fetching more tiles.
            return level <= this.maxLevel;
        }

        getLevelMaximumGeometricError(level) {
            // Same formula as Cesium.TerrainProvider for a heightmap of this size.
            const levelZeroError =
                (Cesium.Ellipsoid.WGS84.maximumRadius * 2 * Math.PI * 4.0) /
                (this.heightmapSize * this._tilingScheme.getNumberOfXTilesAtLevel(0));
            return levelZeroError / (1 << level);
        }

        getMaximumGeometricError() {
            return this.getLevelMaximumGeometricError(0);
        }

        /**
         * Fetch terrain for one tile. Levels above maxLevel are sliced out of
         * the closest available ancestor tile, so every zoom level works.
         */
        requestTileGeometry(x, y, level) {
            const self = this;
            return this._loadGridForTile(x, y, level).then(result => {
                // NOTE: Cesium's HeightmapTessellator computes
                // `latitude = north - granularityY * row`, i.e. buffer row 0 is
                // the NORTH edge — the same order as the decoded image grid,
                // so no row inversion is needed here.
                const heightmap = resampleGrid(
                    result.entry.grid, self.heightmapSize,
                    self.heightmapSize,
                    result.u0, result.u1, result.v0, result.v1
                );
                return new Cesium.HeightmapTerrainData({
                    buffer: heightmap,
                    width: self.heightmapSize,
                    height: self.heightmapSize
                });
            });
        }

        /**
         * Resolve terrain for one tile. Returns { entry, z, u0,u1,v0,v1 }
         * where entry is the decoded ancestor grid and the uv rect is the
         * sub-area of that grid covered by the requested tile.
         * Strategy: use the first cached ancestor (no wait), otherwise fetch
         * the best tile and fall back to coarser ancestors on failure.
         */
        _loadGridForTile(x, y, level) {
            const self = this;
            const makeResult = (entry, zUsed) => {
                // Ancestor at zUsed covers s x s tiles of the requested level.
                const s = 1 << (level - zUsed);
                const ax = x >> (level - zUsed);
                const ay = y >> (level - zUsed);
                const fx = x - ax * s;
                const fy = y - ay * s;
                return {
                    entry: entry,
                    z: zUsed,
                    u0: fx / s,
                    u1: (fx + 1) / s,
                    v0: fy / s,
                    v1: (fy + 1) / s
                };
            };

            // Fast path: first cached ancestor wins (no network wait).
            for (let zTry = Math.min(level, this.maxLevel); zTry >= 0; zTry--) {
                const entry = this._cache.getIfCached(zTry, x >> (level - zTry), y >> (level - zTry));
                if (entry) {
                    log('cached tile z' + zTry + ' serves level ' + level);
                    return Promise.resolve(makeResult(entry, zTry));
                }
            }

            // Slow path: fetch the best tile, lazily falling back to coarser
            // ancestors only if the finer ones fail (lazy chain => at most one
            // network request in the common case).
            let chain = Promise.reject(new Error('no tiles'));
            for (let zTry = Math.min(level, this.maxLevel); zTry >= 0; zTry--) {
                const zz = zTry;
                const ax = x >> (level - zz);
                const ay = y >> (level - zz);
                chain = chain.catch(() =>
                    self._cache.get(zz, ax, ay).then(entry => {
                        log('tile z' + zz + ' serves level ' + level);
                        return makeResult(entry, zz);
                    })
                );
            }

            return chain.then(result => {
                if (!result || !result.entry) {
                    throw new Error('MapTerhorn: no terrain available for tile ' + level + '/' + x + '/' + y);
                }
                return result;
            });
        }
    }

    // ---------------------------------------------------------------------
    // Public singleton: scene wiring + elevation/slope API
    // ---------------------------------------------------------------------

    const mapterhornTerrain = {
        alignToSlope: true,            // tilt models to stand on slopes
        maxSlopeTilt: DEFAULT_MAX_TILT,
        sampleLevel: DEFAULT_SAMPLE_LEVEL,
        sampleRadiusMeters: DEFAULT_SAMPLE_RADIUS,
        groundSmoothMeters: 30,        // neighborhood size for soft ground sampling

        _cache: new MapterhornTileCache(DEFAULT_TILE_URL, DEFAULT_HEIGHTMAP_SIZE),
        _elevationPending: new Set(),

        createProvider: function (options) {
            const opts = Object.assign({}, options || {});
            opts.cache = opts.cache || this._cache;
            return new MapterhornTerrainProvider(opts);
        },

        /**
         * Enable real terrain on a Cesium scene.
         */
        applyToScene: function (scene, options) {
            if (!scene || !scene.globe) return false;
            try {
                const provider = this.createProvider(options);
                scene.terrainProvider = provider;
                this._scene = scene;
                // depthTestAgainstTerrain stays as the app configured it (false):
                // forcing it true hides ground-level models behind terrain tiles.
                log('terrain enabled (' + DEFAULT_TILE_URL + ')');
                // Health check: if MapTerhorn is unreachable, quietly fall back
                // to a flat globe instead of leaving a broken terrain surface.
                const fallbackToFlat = () => {
                    try {
                        if (scene.terrainProvider === provider && !scene.isDestroyed()) {
                            scene.terrainProvider = new Cesium.EllipsoidTerrainProvider();
                            console.warn('🗺️ MapTerhorn unreachable — falling back to flat terrain');
                        }
                    } catch (e) { /* scene already destroyed */ }
                };
                const timeout = new Promise(resolve => setTimeout(resolve, 12000));
                Promise.race([this._cache.get(0, 0, 0), timeout])
                    .then(result => { if (result === undefined) fallbackToFlat(); })
                    .catch(fallbackToFlat);

                // Camera safety: as DEM tiles arrive, make sure the camera never
                // ends up below the terrain surface it is looking at.
                this.onTilesLoaded(() => {
                    try {
                        const camera = scene.camera;
                        const carto = camera.positionCartographic;
                        const ground = scene.globe.getHeight(carto);
                        if (ground !== undefined && ground !== null &&
                            isFinite(ground) && carto.height < ground + 2) {
                            const raised = new Cesium.Cartographic(carto.longitude, carto.latitude, ground + 2);
                            camera.position = Cesium.Ellipsoid.WGS84.cartographicToCartesian(raised);
                            log('camera raised above DEM ground: ' + Math.round(ground) + 'm');
                        }
                    } catch (e) { /* camera not ready */ }
                });
                return true;
            } catch (e) {
                console.warn('🗺️ Failed to enable MapTerhorn terrain:', e);
                return false;
            }
        },

        /** Register a callback fired (debounced) whenever new terrain arrives. */
        onTilesLoaded: function (cb) {
            if (!this._tilesLoadedCallbacks) {
                this._tilesLoadedCallbacks = [];
                let timer = null;
                this._cache.onTileLoaded(() => {
                    if (timer) clearTimeout(timer);
                    timer = setTimeout(() => {
                        this._tilesLoadedCallbacks.forEach(fn => {
                            try { fn(); } catch (e) { /* ignore */ }
                        });
                    }, 700);
                });
            }
            this._tilesLoadedCallbacks.push(cb);
        },

        /**
         * Synchronous elevation lookup (meters). Returns null when no decoded
         * tile covers the point yet; a background fetch is then started so a
         * later call (or a tile-load callback) will have data.
         */
        getElevation: function (longitude, latitude) {
            // Deterministic sample from the DEM grid — the SAME source the
            // terrain provider renders from, so geometry heights always match
            // the visible surface. (Querying the rendered globe instead
            // returned coarse in-progress mesh heights while tiles streamed,
            // which placed geometry at the wrong height.)
            const value = this._sampleWalk(longitude, latitude, this.sampleLevel, true);
            if (value !== null) return value;
            this._primeElevationTile(longitude, latitude);
            return null;
        },

        /** Height of the rendered globe surface at a point, or null. */
        _globeElevation: function (longitude, latitude) {
            try {
                const scene = this._scene;
                if (!scene || !scene.globe) return null;
                const h = scene.globe.getHeight(Cesium.Cartographic.fromDegrees(longitude, latitude));
                return (h !== undefined && h !== null && isFinite(h)) ? h : null;
            } catch (e) {
                return null;
            }
        },

        /**
         * Asynchronous, always-resolving elevation lookup (meters).
         * Loads the best tile for the point if needed.
         */
        getElevationAsync: function (longitude, latitude) {
            const self = this;
            return this._sampleWalkAsync(longitude, latitude, this.sampleLevel)
                .then(h => (h === null ? self._sampleWalk(longitude, latitude, self.sampleLevel, true) : h));
        },

        /**
         * Walk from `zoom` down through ancestor tiles looking for a decoded
         * grid. cachedOnly=true never starts downloads.
         */
        _sampleWalk: function (longitude, latitude, zoom, cachedOnly) {
            let z = Math.max(0, Math.min(DEFAULT_MAX_LEVEL, Math.round(zoom)));
            let tx = Math.floor(lonToTileX(longitude, z));
            let ty = Math.floor(latToTileY(latitude, z));

            while (z >= 0) {
                const entry = this._cache.getIfCached(z, tx, ty);
                if (entry) {
                    const size = Math.sqrt(entry.grid.length);
                    const u = lonToTileX(longitude, z) - tx;
                    const v = latToTileY(latitude, z) - ty;
                    return sampleGrid(entry.grid, size, u, v);
                }
                if (!cachedOnly) {
                    this._cache.get(z, tx, ty).catch(() => { });
                    return null;
                }
                z = z - 1;
                tx = tx >> 1;
                ty = ty >> 1;
            }
            return null;
        },

        _sampleWalkAsync: function (longitude, latitude, zoom) {
            const self = this;
            const z = Math.max(0, Math.min(DEFAULT_MAX_LEVEL, Math.round(zoom)));
            const tx = Math.floor(lonToTileX(longitude, z));
            const ty = Math.floor(latToTileY(latitude, z));
            return self._cache.get(z, tx, ty).then(entry => {
                const size = Math.sqrt(entry.grid.length);
                const u = lonToTileX(longitude, z) - tx;
                const v = latToTileY(latitude, z) - ty;
                return sampleGrid(entry.grid, size, u, v);
            }).catch(() => null);
        },

        _primeElevationTile: function (longitude, latitude) {
            const key = MapterhornTileCache.key(
                this.sampleLevel,
                Math.floor(lonToTileX(longitude, this.sampleLevel)),
                Math.floor(latToTileY(latitude, this.sampleLevel)));
            if (this._elevationPending.has(key)) return;
            this._elevationPending.add(key);
            this._cache.get(
                this.sampleLevel,
                Math.floor(lonToTileX(longitude, this.sampleLevel)),
                Math.floor(latToTileY(latitude, this.sampleLevel))
            ).catch(() => { }).then(() => {
                this._elevationPending.delete(key);
            });
        },

        /**
         * Terrain surface info around a point.
         * Returns { height, normal(ENU), tilt } or null when data is missing.
         */
        getSlopeInfo: function (longitude, latitude) {
            const radius = this.sampleRadiusMeters;
            const h = this.getElevation(longitude, latitude);
            if (h === null || h === undefined) return null;

            const dLat = radius / 110574;
            const dLon = radius / (111320 * Math.max(0.2, Math.cos(latitude * Math.PI / 180)));

            const hEast = this.getElevation(longitude + dLon, latitude);
            const hNorth = this.getElevation(longitude, latitude + dLat);
            if (hEast === null || hNorth === null) return null;

            const slopeX = (hEast - h) / radius;    // dHeight/dEast
            const slopeY = (hNorth - h) / radius;   // dHeight/dNorth

            // Surface normal in the local East-North-Up frame.
            const len = Math.sqrt(slopeX * slopeX + slopeY * slopeY + 1);
            const normal = new Cesium.Cartesian3(-slopeX / len, -slopeY / len, 1 / len);
            return {
                height: h,
                normal: normal,
                tilt: Math.atan(Math.sqrt(slopeX * slopeX + slopeY * slopeY))
            };
        },

        /**
         * Rotate an East-North-Up model matrix so the model's up axis follows
         * the terrain surface normal ("correct inclination" on mountains).
         * Returns the matrix unchanged when no terrain data is available yet
         * or the slope is negligible.
         */
        applySlopeTilt: function (modelMatrix, longitude, latitude) {
            if (!this.alignToSlope || !modelMatrix) return modelMatrix;
            let info = null;
            try {
                info = this.getSlopeInfo(longitude, latitude);
            } catch (e) {
                return modelMatrix;
            }
            if (!info || info.tilt < 0.008) return modelMatrix; // < ~0.5°

            const tilt = Math.min(info.tilt, this.maxSlopeTilt || DEFAULT_MAX_TILT);
            const up = new Cesium.Cartesian3(0, 0, 1);
            const axis = Cesium.Cartesian3.cross(up, info.normal, new Cesium.Cartesian3());
            if (Cesium.Cartesian3.magnitude(axis) < 1e-6) return modelMatrix;
            Cesium.Cartesian3.normalize(axis, axis);
            const rotation = Cesium.Matrix3.fromAxisAngle(axis, tilt);
            const tilted = Cesium.Matrix4.multiplyByMatrix3(
                modelMatrix, rotation, new Cesium.Matrix4());
            log('slope tilt applied:', (tilt * 180 / Math.PI).toFixed(1) + '°');
            return tilted;
        },

        /** Force-load terrain around a lon/lat (used to warm the cache). */
        warmUp: function (longitude, latitude) {
            this._primeElevationTile(longitude, latitude);
        },

        /**
         * Soft per-point ground heights for a list of WGS84 [lon, lat] points.
         * Used to lay extended geometry (building footprints, area textures)
         * onto the DEM without hard steps AND without burying geometry:
         *  - each point samples the true DEM plus a small neighborhood,
         *  - the vertex height is max(true sample, neighborhood average):
         *    concave dips get filled up to the average (no sinking below the
         *    rendered ground), convex bumps are kept as-is (never lower than
         *    the true surface),
         *  - `lift` raises all vertices (safety margin over draped imagery),
         *  - gaps (no data yet) fill with the patch mean.
         * Options: { smoothMeters, lift, sampler }.
         * `sampler(lon, lat)` defaults to this.getElevation; pass
         * terrainManager.getElevation to keep local GeoTIFF priority.
         * Returns { heights, mean, max, min } or null when no data is available.
         */
        getGroundSamples: function (points, options) {
            const opts = Object.assign({
                smoothMeters: this.groundSmoothMeters || 30,
                lift: 0,
                sampler: null
            }, options || {});
            if (!Array.isArray(points) || points.length === 0) return null;

            const sampler = opts.sampler || ((lon, lat) => this.getElevation(lon, lat));

            const memo = new Map();
            const softAt = (lon, lat) => {
                const key = lon.toFixed(7) + ',' + lat.toFixed(7);
                if (memo.has(key)) return memo.get(key);

                // smoothMeters <= 0: exact single sample — best alignment with
                // the rendered surface (used for building corners, where the
                // buried-wall skirt covers residual convexity instead).
                let v = null;
                if (opts.smoothMeters <= 0) {
                    try {
                        const c = sampler(lon, lat);
                        if (c !== null && c !== undefined && isFinite(c)) v = c;
                    } catch (e) { /* no data */ }
                } else {
                    const dLat = opts.smoothMeters / 110574;
                    const dLon = opts.smoothMeters /
                        (111320 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
                    let sum = 0, n = 0, center = null;
                    const probes = [
                        [lon, lat],
                        [lon + dLon, lat], [lon - dLon, lat],
                        [lon, lat + dLat], [lon, lat - dLat]
                    ];
                    for (let p = 0; p < probes.length; p++) {
                        let h = null;
                        try { h = sampler(probes[p][0], probes[p][1]); } catch (e) { /* skip */ }
                        if (h !== null && h !== undefined && isFinite(h)) {
                            sum += h; n++;
                            if (p === 0) center = h;
                        }
                    }
                    // Never below the true DEM surface: dips fill up to the
                    // neighborhood average, bumps are left untouched.
                    v = (center !== null && n > 0) ? Math.max(center, sum / n) : null;
                }
                memo.set(key, v);
                return v;
            };

            const heights = points.map(p => softAt(p[0], p[1]));
            let sum = 0, count = 0;
            for (let i = 0; i < heights.length; i++) {
                if (heights[i] !== null) { sum += heights[i]; count++; }
            }
            if (count === 0) return null;

            // Fill gaps with the patch mean so geometry stays closed.
            const rawMean = sum / count;
            for (let i = 0; i < heights.length; i++) {
                if (heights[i] === null) heights[i] = rawMean;
            }
            if (opts.lift) {
                for (let i = 0; i < heights.length; i++) heights[i] += opts.lift;
            }

            let max = -Infinity, min = Infinity, meanSum = 0;
            for (let i = 0; i < heights.length; i++) {
                if (heights[i] > max) max = heights[i];
                if (heights[i] < min) min = heights[i];
                meanSum += heights[i];
            }
            return { heights: heights, mean: meanSum / heights.length, max: max, min: min };
        }
    };

    window.mapterhornTerrain = mapterhornTerrain;

    /**
     * Browser-side diagnostic. Open the console and run: mapterhornDiag()
     * Reports which link of the chain fails:
     * module load -> tile fetch -> WebP decode -> elevation -> models -> render loop.
     */
    window.mapterhornDiag = async function () {
        const results = {};
        const report = (name, good, extra) => {
            results[name] = (good ? 'PASS' : 'FAIL') + (extra ? ' (' + extra + ')' : '');
            console.log((good ? '✅' : '❌') + ' ' + name + (extra ? ' — ' + extra : ''));
        };

        report('Cesium library', typeof Cesium !== 'undefined');
        report('ol-cesium (olcs)', typeof olcs !== 'undefined');
        report('MapTerhorn module', typeof window.mapterhornTerrain !== 'undefined');
        report('models registry (window.models)', !!window.models && Array.isArray(window.models.availableModels),
            window.models ? window.models.availableModels.length + ' models registered' : 'models.js not loaded');
        report('model renderer', !!(window.modelRenderer && window.modelRenderer.addAllModels));

        // Terrain fetch + decode test on a tile with strong relief.
        try {
            const t0 = Date.now();
            const entry = await mapterhornTerrain._cache.get(8, 128, 88); // Pyrenees area
            const ms = Date.now() - t0;
            const min = Math.round(entry.min), max = Math.round(entry.max);
            report('MapTerhorn tile fetch+decode', true, 'z8/128/88 in ' + ms + 'ms, elevation range ' + min + 'm..' + max + 'm');
            const elev = mapterhornTerrain.getElevation(1.59647, 41.69689); // app default view
            report('Elevation at default view', elev !== null && isFinite(elev), elev === null ? 'null (tile not cached yet)' : Math.round(elev) + 'm');
        } catch (e) {
            report('MapTerhorn tile fetch+decode', false, e.message || String(e));
        }

        // Model file availability probe (first few GLBs).
        if (window.models && window.models.availableModels.length) {
            const probe = window.models.availableModels.filter(m => /\.glb$/i.test(m)).slice(0, 3);
            const checks = await Promise.all(probe.map(f =>
                fetch('/3dmodelsosm/src/models/' + f, { method: 'HEAD' })
                    .then(r => f + ':' + r.status).catch(e => f + ':ERR')));
            const allOk = checks.every(c => c.endsWith(':200'));
            report('Model files served', allOk, checks.join(', '));
        }

        // Render loop / scene state (only meaningful after toggling 3D).
        try {
            if (window.ol3d && window.ol3d.getEnabled && window.ol3d.getEnabled()) {
                const scene = window.ol3d.getCesiumScene();
                const tp = scene.terrainProvider;
                const tpName = tp && tp.isMapterhornProvider ? 'MapTerhorn' :
                    (tp && tp.constructor ? tp.constructor.name : String(tp));
                report('3D scene active', true,
                    'terrain=' + tpName + ', depthTest=' + scene.globe.depthTestAgainstTerrain +
                    ', tilesLoaded=' + scene.globe.tilesLoaded);
            } else {
                results['3D scene active'] = 'SKIPPED (toggle 3D first, then run mapterhornDiag() again)';
                console.log('ℹ️ Toggle the 3D view first, then run mapterhornDiag() again for scene checks');
            }
        } catch (e) {
            report('3D scene active', false, e.message || String(e));
        }

        if (console.table) console.table(results);
        return results;
    };

    console.log('🗺️ MapTerhorn terrain module loaded (tiles.mapterhorn.com, terrarium encoding). Run mapterhornDiag() in the console to test.');
})();
