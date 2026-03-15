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
    cameraUpdateThrottle: 100        // Throttle camera updates (ms)
};

window.modelRenderer = {

    loadedModels: new Map(),          // Track loaded models by feature ID
    cameraUpdateTimeout: null,        // Throttle camera updates
    modelPool: new Map(),             // Pool of reusable model instances
    backgroundTasks: [],              // Background loading tasks
    isProcessing: false,              // Prevent concurrent processing

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
            console.log(`♻️ Reused model from pool: ${modelUrl}`);
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
        
        console.log(`🆕 Created new pooled model: ${modelUrl}`);
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
                    console.log(`🎯 Found ${features.length} features in layer`);
                    
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
                        
                        // Process individual models
                        if (model && typeof model === 'object' && model.uri) {
                            try {
                                this.addModelForFeature(feature, fidx, cesiumScene);
                            } catch (error) {
                                console.error(`🎯 Error adding model for feature ${fidx}:`, error);
                            }
                        }
                        
                        // Process repetition models
                        this.addRepetitionModels(feature, cesiumScene);
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
            
            console.log(`🎯 Applied rotation to model: [${modelRotation.map(r => (r * 180 / Math.PI).toFixed(2) + '°').join(', ')}]`);
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
            console.log(`🚶 Processing repetition models for ${isRepetition ? 'kerb' : 'highway/footway'} feature`);
            
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
        // Check if this is a polygon texture instead of individual model instances
        const repType = feature.get(`repetition_${repIndex}_type`);
        if (repType === 'polygon_texture') {
            const polygonCoordinates = feature.get(`repetition_${repIndex}_polygonCoordinates`);
            const spacing = feature.get(`repetition_${repIndex}_spacing`);
            const imageUri = repModel.uri;

            if (polygonCoordinates && imageUri) {
                console.log(`🖼️ Adding polygon texture for ${repIndex} with ${polygonCoordinates.length} coordinates`);
                this.addAreaTexture(polygonCoordinates, imageUri, { spacing: spacing }, cesiumScene);
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
        
        console.log(`🚶 Added repetition GLTF model ${repIndex} at ground position:`, repLonLat);
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

        // Load image to get dimensions for proper scaling
        const img = new Image();
        let texturedPolygon; // Declare for scope

        img.onload = () => {
            const imageWidth = img.width;
            const imageHeight = img.height;
            const imageAspectRatio = imageWidth / imageHeight;
            const polygonAspectRatio = widthMeters / heightMeters;

            // Calculate scale factors to fill polygon exactly
            let scaleX, scaleY;

            if (polygonAspectRatio > imageAspectRatio) {
                // Polygon is wider than image - fit height, crop width
                scaleY = heightMeters; // Fill height completely
                scaleX = scaleY * imageAspectRatio; // Maintain aspect ratio
            } else {
                // Polygon is taller than image - fit width, crop height
                scaleX = widthMeters; // Fill width completely
                scaleY = scaleX / imageAspectRatio; // Maintain aspect ratio
            }

            // Set repeat to scale the texture to fill polygon
            const textureRepeatX = scaleX;
            const textureRepeatY = scaleY;

            // Apply the calculated repeat
            texturedPolygon.appearance.material.uniforms.repeat = new Cesium.Cartesian2(textureRepeatX, textureRepeatY);

            console.log(`🖼️ Scaled texture to fill polygon: ${textureRepeatX.toFixed(2)} x ${textureRepeatY.toFixed(2)} (image ${imageWidth}x${imageHeight}, polygon ${widthMeters.toFixed(1)}m x ${heightMeters.toFixed(1)}m)`);
        };

        img.src = imageUri;

        // Initial repeat (will be updated when image loads)
        const initialRepeatX = widthMeters;
        const initialRepeatY = heightMeters;

        // Create polygon hierarchy
        const polygonHierarchy = new Cesium.PolygonHierarchy(cartesianPositions);

        // Create textured polygon
        texturedPolygon = sceneToUse.primitives.add(new Cesium.GroundPrimitive({
            geometryInstances: new Cesium.GeometryInstance({
                geometry: new Cesium.PolygonGeometry({
                    polygonHierarchy: polygonHierarchy,
                    height: 0,
                    extrudedHeight: 0
                }),
                attributes: {
                    color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.WHITE)
                }
            }),
            appearance: new Cesium.MaterialAppearance({
                material: new Cesium.Material({
                    fabric: {
                        type: 'Image',
                        uniforms: {
                            image: imageUri,
                            repeat: new Cesium.Cartesian2(initialRepeatX, initialRepeatY)
                        }
                    }
                }),
                flat: true
            }),
            show: true
        }));

        console.log(`🖼️ Created area texture polygon with ${polygonCoordinates.length} vertices, size: ${widthMeters.toFixed(1)}m x ${heightMeters.toFixed(1)}m, image: ${imageUri}`);
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
