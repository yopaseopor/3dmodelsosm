// Model Renderer - Handles 3D model rendering in Cesium
// Moved from index.js to separate file for better organization

window.modelRenderer = {
    
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
        const extent = geometry.getExtent();
        const center = ol.extent.getCenter(extent);
        const lonLat = ol.proj.toLonLat(center);
        
        // Create model matrix for positioning
        const heightOffset = feature.get('modelHeightOffset') || 0.0;
        let modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(
            Cesium.Cartesian3.fromDegrees(lonLat[0], lonLat[1], heightOffset)
        );
        
        // Apply model rotation if specified
        const modelRotation = feature.get('modelRotation');
        if (modelRotation && Array.isArray(modelRotation) && modelRotation.length >= 3) {
            // Apply bearing rotation (Y-axis in OpenLayers becomes Z-axis rotation in Cesium east-north-up frame)
            if (modelRotation[1] !== 0) {
                const bearingRotation = Cesium.Matrix3.fromRotationZ(modelRotation[1]);
                modelMatrix = Cesium.Matrix4.multiplyByMatrix3(modelMatrix, bearingRotation, new Cesium.Matrix4());
            }
            
            // Apply X-axis rotation if needed
            if (modelRotation[0] !== 0) {
                const xRotation = Cesium.Matrix3.fromRotationX(modelRotation[0]);
                modelMatrix = Cesium.Matrix4.multiplyByMatrix3(modelMatrix, xRotation, new Cesium.Matrix4());
            }
            
            // Apply Z-axis rotation if needed  
            if (modelRotation[2] !== 0) {
                const zRotation = Cesium.Matrix3.fromRotationZ(modelRotation[2]);
                modelMatrix = Cesium.Matrix4.multiplyByMatrix3(modelMatrix, zRotation, new Cesium.Matrix4());
            }
            
            console.log(`🎯 Applied rotation to model: [${modelRotation.map(r => (r * 180 / Math.PI).toFixed(2) + '°').join(', ')}]`);
        }
        
        console.log(`🎯 Model url: ${feature.model.uri}`);
        const cesiumModel = cesiumScene.primitives.add(Cesium.Model.fromGltf({
            url: feature.model.uri,
            modelMatrix: modelMatrix,
            scale: feature.model.scale || 1.0,
            show: true
        }));
        
        // Set height reference to clamp to ground
        cesiumModel.heightReference = feature.model.heightReference;
        
        console.log(`🎯 Added GLTF model at:`, lonLat);
        
        // Listen for loading
        cesiumModel.readyPromise.then(function(model) {
            console.log(`🎯 GLTF Model ${fidx} loaded successfully:`, model);
        }).catch(function(error) {
            console.error(`🎯 GLTF Model ${fidx} failed to load:`, error);
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
        
        // Create model matrix for repetition model - GROUND LEVEL (like footway)
        const repHeightOffset = 0; // ON THE GROUND (same as footway)
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
        
        // Clamp to ground
        repCesiumModel.heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
        
        console.log(`🚶 Added repetition GLTF model ${repIndex} at ground position:`, repLonLat);
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
