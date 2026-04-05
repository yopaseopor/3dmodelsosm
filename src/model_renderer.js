// Model Renderer - Handles 3D model rendering in Cesium
// Moved from index.js to separate file for better organization

// Memory management configuration
const memoryConfig = {
    maxModelsPerFrame: 50,           // Limit models added per frame
    loadDistance: 1000,              // Load models within this distance (meters)
    unloadDistance: 1500,            // Unload models beyond this distance (meters)
    lodDistances: {                  // Level of Detail distances
        high: 200,                    // High detail within 200m
        medium: 500,                  // Medium detail within 500m
        low: 1000                     // Low detail within 1000m
    },
    cameraUpdateThrottle: 100,       // Throttle camera updates (ms)
    maxTotalModels: 500              // Maximum total models to prevent excessive resource usage
};

// Debug configuration - can be enabled via URL parameter ?debug=true
const debugConfig = {
    enabled: false,
    maxRepetitionLogs: 5,           // Limit repetition model logs
    logModelLoading: true,           // Log when models are loaded
    logRepetitionModels: false       // Log repetition model details
};

// Check URL parameters for debug mode
function checkDebugMode() {
    if (typeof window !== 'undefined' && window.location) {
        const urlParams = new URLSearchParams(window.location.search);
        debugConfig.enabled = urlParams.get('debug') === 'true';
    }
}

// Initialize debug mode
checkDebugMode();

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
                console.log(`♻️ Returned model to pool: ${modelUrl}`);
            }
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
                    console.error('Background task error:', error);
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
        console.log(`🎯 Processing layer: ${layer.get('title') || 'unnamed'} (type: ${layer.get('type') || 'unknown'})`);
        
        if (layer.getSource && typeof layer.getSource === 'function') {
            try {
                const source = layer.getSource();
                if (source && source.getFeatures) {
                    const features = source.getFeatures();
                    if (debugConfig.enabled) console.log(`🎯 Found ${features.length} features in layer`);
                    
                    let modelsFound = 0;
                    let repetitionsFound = 0;
                    
                    features.forEach((feature, fidx) => {
                        const model = feature.model;
                        const hasRepetitions = feature.get('repetition_0');
                        
                        if (model) {
                            console.log(`🎯 Feature ${fidx} has model: ${model.uri}`);
                            modelsFound++;
                        }
                        
                        if (hasRepetitions) {
                            console.log(`🎯 Feature ${fidx} has repetitions starting with repetition_0`);
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
                                        this.addModelForFeature(feature, fidx, cesiumScene);
                                    } catch (error) {
                                        console.error(`🎯 Error adding model for feature ${fidx}:`, error);
                                    }
                                }
                                
                                // Process repetition models
                                this.addRepetitionModels(feature, cesiumScene);
                            }
                        } else {
                            // Process individual models for non-polygon features
                            if (model && typeof model === 'object' && model.uri) {
                                try {
                                    this.addModelForFeature(feature, fidx, cesiumScene);
                                } catch (error) {
                                    console.error(`🎯 Error adding model for feature ${fidx}:`, error);
                                }
                            }
                            
                            // Process repetition models
                            this.addRepetitionModels(feature, cesiumScene);
                        }
                    });
                    
                    console.log(`🎯 Layer summary: ${modelsFound} models, ${repetitionsFound} features with repetitions`);
                }
            } catch (e) {
                console.log('Error accessing layer source:', e.message);
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
    addModelForFeature: function(feature, fidx, cesiumScene) {
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

        const featureId = feature.getId() || `feature_${fidx}_${Date.now()}`;

        // Skip if already loaded
        if (this.loadedModels.has(featureId)) {
            return;
        }

        // Use model pooling instead of creating new instances
        const modelUrl = feature.model.uri;
        const pooledModel = this.getModelFromPool(modelUrl, cesiumScene);
        
        // Create model matrix for positioning BEFORE setting on model
        const heightOffset = feature.get('modelHeightOffset') || 0.0;
        let modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(
            Cesium.Cartesian3.fromDegrees(lonLat[0], lonLat[1], heightOffset)
        );
        
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
        let scale = feature.model.scale || 1.0;
        if (lodLevel === 'medium') scale *= 0.8; // Less reduction
        if (lodLevel === 'low') scale *= 0.6;     // Less reduction
        
        // Update pooled model with ALL properties at once to prevent flashing
        pooledModel.model.modelMatrix = modelMatrix;
        pooledModel.model.scale = scale;
        pooledModel.model.heightReference = feature.model.heightReference;
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

        console.log(`🎯 Added memory-managed GLTF model at:`, lonLat, `(LOD: ${lodLevel}, Distance: ${Math.round(distance)}m)`);

        // Listen for loading
        pooledModel.model.readyPromise.then(function(model) {
            console.log(`🎯 Memory-managed GLTF Model ${fidx} loaded successfully:`, model);
        }).catch(function(error) {
            console.error(`🎯 Memory-managed GLTF Model ${fidx} failed to load:`, error);
        });

        // Handle repetition models stored on the original footway feature
        this.addRepetitionModels(feature, cesiumScene);
    },

    // Add repetition models for a feature
    addRepetitionModels: function(feature, cesiumScene) {
        const isRepetition = feature.get('isRepetition');
        const hasRepetitions = feature.get('repetition_0'); // Check if this feature has repetition models
        
        if (isRepetition || hasRepetitions) {
            if (debugConfig.enabled && debugConfig.logRepetitionModels) console.log(`🚶 Processing repetition models for ${isRepetition ? 'kerb' : 'highway/footway'} feature`);
            
            if (isRepetition) {
                // Kerb repetition: model data is stored directly on the feature
                const modelData = feature.get('model');
                if (modelData && modelData.uri && modelData.position) {
                    try {
                        this.addRepetitionModel(feature, 0, modelData, cesiumScene);
                    } catch (error) {
                        console.error(`🚶 Error adding kerb repetition model:`, error);
                    }
                } else {
                    console.warn('🚶 Kerb repetition feature missing model data');
                }
            } else {
                // Highway/Footway repetition: find all repetition models on this feature
                let repIndex = 0;
                let loggedCount = 0;
                while (true) {
                    const repModel = feature.get(`repetition_${repIndex}`);
                    if (!repModel) break;
                    
                    try {
                        this.addRepetitionModel(feature, repIndex, repModel, cesiumScene);
                        repIndex++;
                    } catch (error) {
                        console.error(`🚶 Error adding repetition model ${repIndex}:`, error);
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
            const spacing = feature.get(`repetition_${repIndex}_spacing`);
            const rotation = feature.get(`repetition_${repIndex}_rotation`) || 0;
            const imageUri = repModel.uri;

            if (polygonCoordinates && imageUri) {
                console.log(`🖼️ Adding polygon texture for ${repIndex} with ${polygonCoordinates.length} coordinates and rotation: ${(rotation * 180 / Math.PI).toFixed(1)}°`);
                this.addAreaTexture(polygonCoordinates, imageUri, { spacing: spacing, rotation: rotation }, cesiumScene);
                return;
            }
        }

        // Original individual model logic continues below
        // Use the stored position from repetition generation
        const repPosition = repModel.position || feature.get(`repetition_${repIndex}_position`);
        if (!repPosition) {
            console.warn(`🚶 No position found for repetition model ${repIndex}`);
            return;
        }
        
        // The repPosition is already in lon/lat format (from footway_repetition.js)
        // No need to convert again
        const repLonLat = repPosition;
        
        console.log(`🚶 Repetition model ${repIndex} using stored position: [${repPosition[0].toFixed(6)}, ${repPosition[1].toFixed(6)}] (already lon/lat)`);
        
        // Check if model is an image file (PNG/JPG)
        const modelUri = repModel.uri;
        const isImageFile = modelUri && (modelUri.toLowerCase().endsWith('.png') || modelUri.toLowerCase().endsWith('.jpg') || modelUri.toLowerCase().endsWith('.jpeg'));
        
        if (isImageFile) {
            // Handle image files using billboards
            console.log(`🚶 Loading image file as billboard: ${modelUri}`);
            this.addImageBillboard(repLonLat, modelUri, repModel, cesiumScene);
            return;
        }
        
        // Create model matrix for repetition model - GROUND LEVEL (like footway)
        const repHeightOffset = feature.get(`repetition_${repIndex}_heightOffset`) || 0; // Use stored height offset instead of hardcoded 10
        let repModelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(
            Cesium.Cartesian3.fromDegrees(repLonLat[0], repLonLat[1], repHeightOffset)
        );
        
        // Apply repetition model rotation
        let repModelRotation = null;
        
        // For kerb repetitions, rotation is stored as 'modelRotation'
        if (feature.get('isRepetition')) {
            repModelRotation = feature.get('modelRotation');
        } else {
            // For highway/footway repetitions, rotation is stored as 'repetition_${repIndex}_rotation'
            repModelRotation = feature.get(`repetition_${repIndex}_rotation`);
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
        
        console.log(`🚶 Applied rotation to repetition model ${repIndex}: [${(repModelRotation || [0, 0, 0]).map(r => (r * 180 / Math.PI).toFixed(2) + '°').join(', ')}]`);
        
        console.log(`🚶 Repetition model url: ${repModel.uri}`);
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
        console.log(`🎨 Adding area texture for polygon feature ${fidx} with model: ${model.uri}`);

        const geometry = feature.getGeometry();
        if (!geometry || !geometry.getType || (geometry.getType() !== 'Polygon' && geometry.getType() !== 'MultiPolygon')) {
            console.warn(`🎨 Feature ${fidx} is not a polygon, skipping area texture`);
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

        // Use the area texture manager to create the entity
        const areaEntity = window.areaTextureManager.createAreaEntity(
            feature,
            model.uri, // This is the texture filename
            model, // Pass the model config
            tagsObj,
            properties
        );

        if (areaEntity) {
            console.log(`🎨 Successfully created area texture entity for feature ${fidx}`);
        } else {
            console.warn(`🎨 Failed to create area texture entity for feature ${fidx}`);
        }
    },

    // Add image billboard for PNG/JPG files
    addImageBillboard: function(position, imageUri, repModel, cesiumScene) {
        // For area textures, we should use a single textured polygon instead of individual billboards
        // This method is kept for backward compatibility but should ideally be replaced with addAreaTexture
        console.warn('🖼️ addImageBillboard called - consider using addAreaTexture for full polygon coverage');
        this.addImageBillboard(position, imageUri, repModel, cesiumScene);
    },

    // Add textured polygon for area coverage
    addAreaTexture: function(polygonCoordinates, imageUri, repModel, cesiumScene) {
        console.log(`🖼️ addAreaTexture called with ${polygonCoordinates.length} coordinates, texture: ${imageUri}`);

        const sceneToUse = cesiumScene || window.ol3d.getCesiumScene();

        // Convert polygon coordinates to Cartesian3
        const cartesianPositions = polygonCoordinates.map(coord =>
            Cesium.Cartesian3.fromDegrees(coord[0], coord[1], 0)
        );

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
            console.log(`🖼️ Using provided rotation: ${(textureRotation * 180 / Math.PI).toFixed(1)}°`);
        } else {
            // Find nearby ways and calculate rotation
            textureRotation = this.calculateTextureRotation(polygonCoordinates, imageUri);
            console.log(`🖼️ Calculated texture rotation: ${(textureRotation * 180 / Math.PI).toFixed(1)}°`);
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
            const desiredTextureSizeMeters = repModel.spacing || 1.0; // Use spacing from config, default 1m

            // Calculate how many times to repeat texture to fill the polygon
            const textureRepeatX = widthMeters / desiredTextureSizeMeters;
            const textureRepeatY = heightMeters / desiredTextureSizeMeters;

            // Apply the calculated repeat
            if (texturedPolygon && texturedPolygon.polygon && texturedPolygon.polygon.material) {
                texturedPolygon.polygon.material.repeat = new Cesium.Cartesian2(textureRepeatX, textureRepeatY);
                console.log(`🖼️ Updated texture repeat to: ${textureRepeatX.toFixed(2)} x ${textureRepeatY.toFixed(2)}`);
            } else {
                console.warn(`🖼️ Could not apply texture repeat - texturedPolygon structure not as expected`);
            }

            // Try to apply rotation by rotating the image on a canvas
            if (textureRotation !== 0) {
                console.log(`🖼️ Attempting to apply rotation by rotating image on canvas: ${(textureRotation * 180 / Math.PI).toFixed(1)}°`);
                
                // Calculate the diagonal to ensure canvas is large enough for rotation
                const diagonal = Math.sqrt(imageWidth * imageWidth + imageHeight * imageHeight);
                const canvasSize = Math.ceil(diagonal);
                
                // Create canvas large enough to contain rotated image without cutting corners
                const canvas = document.createElement('canvas');
                canvas.width = canvasSize;
                canvas.height = canvasSize;
                const ctx = canvas.getContext('2d');
                
                // Clear canvas
                ctx.clearRect(0, 0, canvasSize, canvasSize);
                
                // Rotate from center of canvas
                ctx.translate(canvasSize / 2, canvasSize / 2);
                ctx.rotate(textureRotation);
                
                // Draw image centered
                ctx.drawImage(img, -imageWidth / 2, -imageHeight / 2, imageWidth, imageHeight);
                
                // Create a data URL from the rotated canvas
                const rotatedImageDataUrl = canvas.toDataURL();
                
                // Update the material image to the rotated version
                // Adjust repeat to account for larger canvas size
                if (texturedPolygon && texturedPolygon.polygon && texturedPolygon.polygon.material) {
                    texturedPolygon.polygon.material.image = rotatedImageDataUrl;
                    // Scale repeat to maintain same visual density
                    const scaleFactor = canvasSize / imageWidth;
                    texturedPolygon.polygon.material.repeat = new Cesium.Cartesian2(textureRepeatX / scaleFactor, textureRepeatY / scaleFactor);
                    console.log(`🖼️ Applied rotated image to material (canvas: ${canvasSize}x${canvasSize}, scale: ${scaleFactor.toFixed(2)})`);
                }
            }

            console.log(`🖼️ Fixed texture repeat: ${textureRepeatX.toFixed(2)} x ${textureRepeatY.toFixed(2)} (polygon ${widthMeters.toFixed(1)}m x ${heightMeters.toFixed(1)}m, desired tile size ${desiredTextureSizeMeters}m)`);
        };

        img.src = imageUri;

        // Initial repeat (will be updated when image loads)
        const initialRepeatX = widthMeters;
        const initialRepeatY = heightMeters;

        // Create polygon hierarchy
        const polygonHierarchy = new Cesium.PolygonHierarchy(cartesianPositions);

        // Create textured polygon using Entity system for consistency
        const dataSource = window.areaTextureManager.getDataSource();
        if (!dataSource) {
            console.warn('🖼️ No data source available for area texture');
            return;
        }
        
        texturedPolygon = dataSource.entities.add(new Cesium.Entity({
            polygon: {
                hierarchy: new Cesium.PolygonHierarchy(cartesianPositions),
                height: 0.001, // Consistent height with Entity system
                extrudedHeight: 0.001,
                material: new Cesium.ImageMaterialProperty({
                    image: imageUri,
                    repeat: new Cesium.Cartesian2(initialRepeatX, initialRepeatY),
                    transparent: true
                })
            }
        }));

        console.log(`🖼️ Created area texture polygon with rotation: ${(textureRotation * 180 / Math.PI).toFixed(1)}°`);

        console.log(`🖼️ Created area texture polygon with ${polygonCoordinates.length} vertices, size: ${widthMeters.toFixed(1)}m x ${heightMeters.toFixed(1)}m, image: ${imageUri}`);
    },

    /**
     * Calculate texture rotation based on nearby ways that cross or are adjacent to the texture area
     * @param {Array<Array<number>>} polygonCoordinates - Polygon coordinates [lon, lat]
     * @param {string} textureName - Name of the texture file
     * @returns {number} Rotation angle in radians (0 if no rotation needed)
     */
    calculateTextureRotation: function(polygonCoordinates, textureName) {
        console.log(`🖼️ calculateTextureRotation called for texture: ${textureName}`);

        // DISABLED: Canvas rotation causes gaps in tiling
        // Need different approach - pre-rotated textures or different rotation method
        console.log(`🖼️ Texture rotation disabled - canvas rotation causes tiling gaps`);
        return 0; // No rotation for now
        
        /*
        // TEMPORARY: Force 45-degree rotation on ALL textures for testing
        const testRotation = Math.PI / 4; // 45 degrees
        console.log(`🖼️ FORCING TEST ROTATION: ${(testRotation * 180 / Math.PI).toFixed(1)}° for ALL textures`);
        return testRotation;
        
        // Original code below - disabled for testing
        // Apply rotation to ALL textures for testing - remove texture type filtering
        console.log(`🖼️ Processing rotation for texture: ${textureName} (testing all textures)`);

        // Special handling for crossing textures - align with parent footway
        console.log(`🖼️ Checking if texture is crossing: ${textureName}`);
        console.log(`🖼️ Texture name lowercase: ${textureName.toLowerCase()}`);
        console.log(`🖼️ Contains i_crossing.png: ${textureName.toLowerCase().includes('i_crossing.png')}`);
        console.log(`🖼️ Contains crossing: ${textureName.toLowerCase().includes('crossing')}`);
        console.log(`🖼️ Contains panot: ${textureName.toLowerCase().includes('panot')}`);
        
        // Check for multiple possible crossing texture names
        const isCrossingTexture = textureName.toLowerCase().includes('i_crossing.png') || 
                                textureName.toLowerCase().includes('crossing') ||
                                textureName.toLowerCase().includes('panot');
        
        if (isCrossingTexture) {
            console.log(`🖼️ Special handling for crossing texture - looking for parent footway`);
            const crossingRotation = this.calculateCrossingTextureRotation(polygonCoordinates, textureName);
            console.log(`🖼️ Crossing rotation result: ${crossingRotation}`);
            if (crossingRotation !== null) {
                console.log(`🖼️ Crossing texture rotation found: ${(crossingRotation * 180 / Math.PI).toFixed(1)}°`);
                return crossingRotation;
            } else {
                console.log(`🖼️ Crossing rotation returned null, falling back to general rotation`);
            }
        } else {
            console.log(`🖼️ Not a crossing texture, using general rotation`);
        }

        try {
            // Get all map layers to find ways
            const layers = window.map.getLayers().getArray();
            const nearbyWays = [];

            console.log(`🖼️ Searching ${layers.length} layers for nearby ways...`);

            // Search through all layers for ways that cross or are adjacent to the polygon
            layers.forEach((layer, layerIndex) => {
                if (layer.getSource && typeof layer.getSource === 'function') {
                    const source = layer.getSource();
                    if (source && source.getFeatures) {
                        const features = source.getFeatures();
                        console.log(`🖼️ Layer ${layerIndex}: ${features.length} features`);

                        features.forEach((feature, featureIndex) => {
                            const geometry = feature.getGeometry();
                            if (geometry && (geometry.getType() === 'LineString' || geometry.getType() === 'MultiLineString')) {
                                // Check if this way crosses or is adjacent to our polygon
                                if (this.wayIntersectsOrAdjacentToPolygon(geometry, polygonCoordinates)) {
                                    nearbyWays.push(feature);
                                    console.log(`🖼️ Found nearby way in layer ${layerIndex}, feature ${featureIndex}`);
                                }
                            }
                        });
                    }
                }
            });

            console.log(`🖼️ Found ${nearbyWays.length} nearby ways for texture rotation`);

            if (nearbyWays.length === 0) {
                console.log(`🖼️ No nearby ways found - using test rotation of 45° for debugging`);
                return Math.PI / 4; // Return 45° for testing when no ways found
            }

            // Calculate average bearing of nearby ways
            const bearings = nearbyWays.map((feature, index) => {
                const geometry = feature.getGeometry();
                const coords = geometry.getType() === 'LineString' ?
                    geometry.getCoordinates() :
                    geometry.getCoordinates().flat();

                console.log(`🖼️ Way ${index} has ${coords.length} coordinates`);

                // Convert to EPSG:4326 if needed
                const lonLatCoords = coords.map(coord =>
                    ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326')
                );

                console.log(`🖼️ Way ${index} first few coords:`, lonLatCoords.slice(0, 3));

                const bearing = this.calculateWayBearing(lonLatCoords);
                console.log(`🖼️ Way ${index} bearing: ${(bearing * 180 / Math.PI).toFixed(1)}°`);
                return bearing;
            }).filter(bearing => bearing !== null);

            console.log(`🖼️ Valid bearings calculated: ${bearings.length} out of ${nearbyWays.length}`);

            if (bearings.length === 0) {
                console.log(`🖼️ Could not calculate bearings - using test rotation of 45° for debugging`);
                return Math.PI / 4; // Return 45° for testing
            }

            // Calculate average bearing
            const averageBearing = bearings.reduce((sum, bearing) => sum + bearing, 0) / bearings.length;

            console.log(`🖼️ Calculated average bearing from ${bearings.length} ways: ${(averageBearing * 180 / Math.PI).toFixed(1)}°`);

            // For textures, we want the texture to flow in the direction of the way
            // So we rotate the texture to align with the way's bearing
            // Cesium texture rotation: positive values rotate clockwise
            return -averageBearing;

        } catch (error) {
            console.error(`🖼️ Error calculating texture rotation:`, error);
            return Math.PI / 4; // Return 45° for testing on error
        }
        */
    },

    /**
     * Calculate rotation for crossing textures by finding the parent footway
     * @param {Array<Array<number>>} polygonCoordinates - Crossing polygon coordinates [lon, lat]
     * @param {string} textureName - Name of the texture file
     * @returns {number|null} Rotation angle in radians, or null if not found
     */
    calculateCrossingTextureRotation: function(polygonCoordinates, textureName) {
        console.log(`🚶 calculateCrossingTextureRotation called for crossing texture: ${textureName}`);
        console.log(`🚶 Polygon coordinates count: ${polygonCoordinates.length}`);

        try {
            // Get all map layers to find footways
            const layers = window.map.getLayers().getArray();
            const footways = [];

            console.log(`🚶 Searching ${layers.length} layers for footways...`);

            // Search through all layers for footway ways
            layers.forEach((layer, layerIndex) => {
                if (layer.getSource && typeof layer.getSource === 'function') {
                    const source = layer.getSource();
                    if (source && source.getFeatures) {
                        const features = source.getFeatures();
                        console.log(`🚶 Layer ${layerIndex}: ${features.length} features`);

                        features.forEach((feature, featureIndex) => {
                            const geometry = feature.getGeometry();
                            const tags = feature.getProperties();
                            
                            console.log(`🚶 Feature ${featureIndex}: geometry=${geometry ? geometry.getType() : 'null'}, tags:`, tags);
                            
                            // Look for footway ways (not crossing areas)
                            if (geometry && (geometry.getType() === 'LineString' || geometry.getType() === 'MultiLineString') &&
                                (tags['highway'] === 'footway' || tags['footway'] || tags['highway'] === 'path' || tags['highway'] === 'pedestrian')) {
                                
                                console.log(`🚶 Found potential footway feature ${featureIndex}`);
                                
                                // Check if this footway intersects or is very close to our crossing polygon
                                const intersects = this.wayIntersectsOrAdjacentToPolygon(geometry, polygonCoordinates);
                                console.log(`🚶 Footway intersection check: ${intersects}`);
                                
                                if (intersects) {
                                    footways.push({ feature, geometry, tags });
                                    console.log(`🚶 Found intersecting footway in layer ${layerIndex}, feature ${featureIndex}:`, tags);
                                }
                            }
                        });
                    }
                }
            });

            console.log(`🚶 Found ${footways.length} footways near the crossing`);

            if (footways.length === 0) {
                console.log(`🚶 No footways found near crossing - will use general rotation`);
                return null;
            }

            // Calculate bearing of the footway(s)
            const bearings = footways.map((footway, index) => {
                const geometry = footway.geometry;
                const coords = geometry.getType() === 'LineString' ?
                    geometry.getCoordinates() :
                    geometry.getCoordinates().flat();

                console.log(`🚶 Footway ${index} has ${coords.length} coordinates`);

                // Convert to EPSG:4326 if needed
                const lonLatCoords = coords.map(coord =>
                    ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326')
                );

                console.log(`🚶 Footway ${index} first few coords:`, lonLatCoords.slice(0, 3));

                const bearing = this.calculateWayBearing(lonLatCoords);
                console.log(`🚶 Footway ${index} bearing: ${(bearing * 180 / Math.PI).toFixed(1)}°`);
                return bearing;
            }).filter(bearing => bearing !== null);

            console.log(`🚶 Valid footway bearings calculated: ${bearings.length}`);

            if (bearings.length === 0) {
                console.log(`🚶 Could not calculate footway bearings`);
                return null;
            }

            // Use the first footway bearing (or average if multiple)
            const footwayBearing = bearings.length === 1 ? bearings[0] : 
                bearings.reduce((sum, bearing) => sum + bearing, 0) / bearings.length;

            console.log(`🚶 Using footway bearing for crossing texture: ${(footwayBearing * 180 / Math.PI).toFixed(1)}°`);

            // For crossing textures, we want the crossing stripes to be perpendicular to the footway direction
            // So we rotate 90 degrees from the footway bearing
            const crossingRotation = footwayBearing + Math.PI / 2; // Add 90 degrees
            
            console.log(`🚶 Crossing texture rotation (perpendicular to footway): ${(crossingRotation * 180 / Math.PI).toFixed(1)}°`);

            // Cesium texture rotation: positive values rotate clockwise
            return -crossingRotation;

        } catch (error) {
            console.error(`🚶 Error calculating crossing texture rotation:`, error);
            return null;
        }
    },

    /**
     * Check if a way intersects or is adjacent to a polygon
     * @param {ol.geom.LineString|ol.geom.MultiLineString} wayGeometry - The way geometry
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
            console.error('Error checking way intersection:', error);
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
        const det = (b[0] - a[0]) * (d[1] - c[1]) - (d[0] - c[0]) * (b[1] - a[1]);
        if (det === 0) return false; // Lines are parallel

        const lambda = ((d[1] - c[1]) * (d[0] - a[0]) + (c[0] - d[0]) * (d[1] - a[1])) / det;
        const gamma = ((a[1] - b[1]) * (d[0] - a[0]) + (b[0] - a[0]) * (d[1] - a[1])) / det;

        return (0 < lambda && lambda < 1) && (0 < gamma && gamma < 1);
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
        console.log('🎯 Manually adding 3D models to Cesium scene...');
        if (!window.ol3d) {
            console.log('🎯 window.ol3d is null, cannot add models');
            return;
        }

        const cesiumScene = window.ol3d.getCesiumScene();
        if (cesiumScene && cesiumScene.primitives) {
            try {
                let modelsAdded = 0;
                
                // Count models before adding
                const originalCount = modelsAdded;
                
                // Recursively process all layers including group layers
                this.processLayersRecursively(window.map.getLayers().getArray(), cesiumScene);

                console.log(`🎯 Added ${modelsAdded - originalCount} GLTF models using model renderer`);
            } catch (error) {
                console.error('🎯 Error with model renderer approach:', error);
            }
        } else {
            console.log('🎯 Cesium scene not available for manual model addition');
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

console.log('🎯 model_renderer.js loaded successfully');
