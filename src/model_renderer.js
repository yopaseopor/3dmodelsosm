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
        const position = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
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
        const position = Cesium.Cartographic.fromDegrees(lon, lat, 0);

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
    
    // Main function to add models from layers
    addModelsFromLayer: function(layer, cesiumScene) {
        if (debugConfig.enabled) console.log(`🎯 Processing layer: ${layer.get('title') || 'unnamed'} (type: ${layer.get('type') || 'unknown'})`);
        
        if (layer.getSource && typeof layer.getSource === 'function') {
            try {
                const source = layer.getSource();
                if (source && source.getFeatures) {
                    const features = source.getFeatures();
                    if (debugConfig.enabled) console.log(`🎯 Found ${features.length} features in layer`);
                    
                    let modelsFound = 0;
                    let repetitionsFound = 0;
                    
                    features.forEach((feature, fidx) => {
                        const model = feature.get('model');
                        const hasRepetitions = feature.get('repetition_0');
                        
                        if (model) {
                            if (debugConfig.enabled) console.log(`🎯 Feature ${fidx} has model: ${model.uri}`);
                            modelsFound++;
                        }
                        
                        if (hasRepetitions) {
                            if (debugConfig.enabled) console.log(`🎯 Feature ${fidx} has repetitions starting with repetition_0`);
                            repetitionsFound++;
                        }
                        
                        // Process area textures for polygon features with image models
                        const geometry = feature.getGeometry();
                        if (geometry && geometry.getType && (geometry.getType() === 'Polygon' || geometry.getType() === 'MultiPolygon')) {
                            if (model && model.uri && /\.(jpg|jpeg|png|gif|bmp|tiff|tif)$/i.test(model.uri)) {
                                if (debugConfig.enabled) console.log(`🎯 Feature ${fidx} has area texture: ${model.uri}`);
                                this.addAreaTextureForFeature(feature, model, fidx, cesiumScene);
                            } else {
                                // Process individual models for non-texture polygons
                                if (model && typeof model === 'object' && model.uri) {
                                    try {
                                        this.addModelForFeature(feature, fidx, cesiumScene, layer);
                                    } catch (error) {
                                        // Model addition error silently handled
                                    }
                                }
                                
                                // Process repetition models
                                this.addRepetitionModels(feature, cesiumScene);
                            }
                        } else {
                            // Process individual models for non-polygon features
                            if (model && typeof model === 'object' && model.uri) {
                                try {
                                    this.addModelForFeature(feature, fidx, cesiumScene, layer);
                                } catch (error) {
                                    // Model addition error silently handled
                                }
                            }
                            
                            // Process repetition models
                            this.addRepetitionModels(feature, cesiumScene);
                        }
                    });
                    
                    if (debugConfig.enabled) console.log(`🎯 Layer summary: ${modelsFound} models, ${repetitionsFound} features with repetitions`);
                }
            } catch (e) {
                // Layer source access error silently handled
            }
        }
        
        // Check group children recursively
        else if (layer.getLayers && typeof layer.getLayers === 'function') {
            const childLayers = layer.getLayers().getArray();
            childLayers.forEach(childLayer => {
                this.addModelsFromLayer(childLayer, cesiumScene);
            });
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

        // Check total model limit to prevent excessive resource usage
        if (this.totalModelsAdded >= memoryConfig.maxTotalModels) {
            if (debugConfig.enabled) console.warn(`🎯 Model limit reached (${memoryConfig.maxTotalModels}), skipping model at distance ${Math.round(distance)}m`);
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

        // Debug logging
        if (debugConfig.enabled) {
            console.log(`🎯 Processing feature ${fidx} with ID: ${featureId}`);
            console.log(`🎯 Already loaded: ${this.loadedModels.has(featureId)}`);
            console.log(`🎯 Total loaded models: ${this.loadedModels.size}`);
        }

        // Skip if already loaded
        if (this.loadedModels.has(featureId)) {
            if (debugConfig.enabled) console.log(`🎯 Skipping already loaded feature: ${featureId}`);
            return;
        }

        // Use model pooling instead of creating new instances
        const model = feature.get('model');
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
        
        // Get terrain elevation if available
        let terrainElevation = 0;
        if (window.terrainManager && window.terrainManager.getElevation) {
            terrainElevation = window.terrainManager.getElevation(lonLat[0], lonLat[1]);
        }
        
        const totalHeight = heightOffset + terrainElevation;
        let modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(
            Cesium.Cartesian3.fromDegrees(lonLat[0], lonLat[1], totalHeight)
        );
        
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
        
        // Apply LOD scaling - but be less aggressive
        let scale = model.scale || 1.0;
        if (lodLevel === 'medium') scale *= 0.8; // Less reduction
        if (lodLevel === 'low') scale *= 0.6;     // Less reduction
        
        // Update pooled model with ALL properties at once to prevent flashing
        pooledModel.model.modelMatrix = modelMatrix;
        pooledModel.model.scale = scale;
        pooledModel.model.heightReference = model.heightReference;
        pooledModel.model.show = true; // Ensure it's visible

        // Track loaded model with more persistent tracking
        this.loadedModels.set(featureId, {
            model: pooledModel.model,
            feature: feature,
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

        // Handle repetition models stored on the original footway feature
        this.addRepetitionModels(feature, cesiumScene);
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
                const modelData = feature.get('model');
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
        
        // Get terrain elevation if available
        let repTerrainElevation = 0;
        if (window.terrainManager && window.terrainManager.getElevation) {
            repTerrainElevation = window.terrainManager.getElevation(repLonLat[0], repLonLat[1]);
        }
        
        const repTotalHeight = repHeightOffset + repTerrainElevation;
        let repModelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(
            Cesium.Cartesian3.fromDegrees(repLonLat[0], repLonLat[1], repTotalHeight)
        );
        
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
        
        // Clamp to ground for area repetitions
        repCesiumModel.heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
        
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

        // Convert polygon coordinates to Cartesian3
        const cartesianPositions = polygonCoordinates.map(coord =>
            Cesium.Cartesian3.fromDegrees(coord[0], coord[1], 0)
        );
        const cartesianHoleHierarchies = polygonHoles.map(holeRing => {
            const holePositions = holeRing.map(coord =>
                Cesium.Cartesian3.fromDegrees(coord[0], coord[1], 0)
            );
            return new Cesium.PolygonHierarchy(holePositions);
        });

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

            // Apply the calculated repeat with scale adjustment
            if (texturedPolygon && texturedPolygon.polygon && texturedPolygon.polygon.material) {
                // Apply scale to make texture larger (fewer repetitions) when scale > 1.0
                const scaledRepeatX = textureRepeatX / textureScale;
                const scaledRepeatY = textureRepeatY / textureScale;
                texturedPolygon.polygon.material.repeat = new Cesium.Cartesian2(scaledRepeatX, scaledRepeatY);
                if (debugConfig.enabled) console.log(`Updated texture repeat to: ${scaledRepeatX.toFixed(2)} x ${scaledRepeatY.toFixed(2)} (scale: ${textureScale})`);
            } else {
                // Texture repeat structure not as expected
            }

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
                
                // Update material with single rotated image and set repeat to 1
                if (texturedPolygon && texturedPolygon.polygon && texturedPolygon.polygon.material) {
                    texturedPolygon.polygon.material.image = rotatedImageDataUrl;
                    texturedPolygon.polygon.material.repeat = new Cesium.Cartesian2(1, 1);
                    if (modelRendererTexLog()) console.log(`🖼️ Applied rotated texture canvas`);
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
        const centerPosition = Cesium.Cartesian3.fromDegrees(centerLon, centerLat, 0.001);

        // Create polygon hierarchy
        const polygonHierarchy = new Cesium.PolygonHierarchy(cartesianPositions, cartesianHoleHierarchies);

        // Create textured polygon using Entity system for consistency
        const dataSource = window.areaTextureManager.getDataSource();
        if (!dataSource) {
            // No data source available for area texture
            return;
        }
        
        texturedPolygon = dataSource.entities.add(new Cesium.Entity({
            polygon: {
                hierarchy: polygonHierarchy,
                height: 0.001, // Consistent height with Entity system
                extrudedHeight: 0.001,
                material: new Cesium.ImageMaterialProperty({
                    image: imageUri,
                    repeat: new Cesium.Cartesian2(initialRepeatX, initialRepeatY),
                    transparent: true
                })
            }
        }));

        if (debugConfig.enabled) console.log(`🖼️ Created area texture polygon, rotation will be applied in onload callback`);

        if (debugConfig.enabled) console.log(`🖼️ Created area texture polygon with ${polygonCoordinates.length} vertices, size: ${widthMeters.toFixed(1)}m x ${heightMeters.toFixed(1)}m, image: ${imageUri}`);
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
    addAllModels: function() {
        if (debugConfig.enabled) console.log('🎯 addAllModels: scanning layers for 3D models');
        if (!window.ol3d) {
            if (debugConfig.enabled) console.log('🎯 ol3d unavailable');
            return;
        }

        const cesiumScene = window.ol3d.getCesiumScene();
        if (cesiumScene && cesiumScene.primitives) {
            try {
                if (debugConfig.enabled) console.log('🎯 Cesium scene available, processing layers...');
                this.processLayersRecursively(window.map.getLayers().getArray(), cesiumScene);
                if (debugConfig.enabled) console.log('🎯 Layer processing completed');
            } catch (error) {
                if (debugConfig.enabled) console.error('🎯 Model renderer error:', error);
            }
        } else if (debugConfig.enabled) {
            console.log('🎯 Cesium scene unavailable');
        }
    },

    // Recursively process layers including group layers
    processLayersRecursively: function(layers, cesiumScene) {
        layers.forEach(layer => {
            if (layer.getLayers) {
                // This is a group layer, process its child layers
                this.processLayersRecursively(layer.getLayers().getArray(), cesiumScene);
            } else {
                // This is a regular layer
                this.addModelsFromLayer(layer, cesiumScene);
            }
        });
    },
};

if (typeof debugConfig !== 'undefined' && debugConfig.enabled) {
    console.log('🎯 model_renderer.js loaded');
}
