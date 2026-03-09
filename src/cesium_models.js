/**
 * Cesium Models Module
 * Handles 3D model operations in Cesium scene, including area textures and point models
 */

// Area texture management
class AreaTextureManager {
    constructor() {
        this.areaEntities = new Map(); // Store area entities by feature ID
        this.dataSource = null; // Cesium data source for area textures
    }

    /**
     * Initialize or get the AreaTextures data source
     */
    getDataSource() {
        if (!this.dataSource && window.ol3d && window.ol3d.getDataSources) {
            const dataSources = window.ol3d.getDataSources();
            for (let i = 0; i < dataSources.length; i++) {
                const ds = dataSources.get(i);
                if (ds.name === 'AreaTextures') {
                    this.dataSource = ds;
                    break;
                }
            }
            if (!this.dataSource) {
                this.dataSource = new Cesium.CustomDataSource('AreaTextures');
                dataSources.add(this.dataSource);
                console.log('🎨 Created new AreaTextures data source');
            }
        }
        return this.dataSource;
    }

    /**
     * Create a Cesium entity for area texture
     * @param {Object} feature - OpenLayers feature
     * @param {string} modelFilename - Texture filename
     * @param {Object} modelConfig - Model configuration
     * @param {Object} tagsObj - Feature tags
     * @param {Object} properties - Feature properties
     */
    createAreaEntity(feature, modelFilename, modelConfig, tagsObj, properties) {
        console.log(`🎨 Applying area texture ${modelFilename} to polygon`);

        try {
            let coordinates;
            const geometry = feature.getGeometry();

            if (geometry && geometry.getType && geometry.getType() === 'Polygon') {
                coordinates = geometry.getCoordinates();
                console.log(`🎨 Using Polygon coordinates:`, coordinates);
            } else if (geometry && geometry.getType && geometry.getType() === 'LineString') {
                // For area-tagged ways, create a simple polygon from the linestring
                const lineCoords = geometry.getCoordinates();
                coordinates = [lineCoords]; // Single ring
                console.log(`🎨 Converting LineString to Polygon coordinates:`, coordinates);
            } else if (geometry && geometry.coordinates) {
                // Fallback for GeoJSON-style geometry
                coordinates = geometry.coordinates;
                console.log(`🎨 Using GeoJSON coordinates:`, coordinates);
            } else if (properties.geometry && properties.geometry.coordinates) {
                // Last resort - use geometry from properties
                coordinates = properties.geometry.coordinates;
                console.log(`🎨 Using geometry property coordinates:`, coordinates);
            } else {
                console.warn(`🎨 No coordinates found for area texture`);
                coordinates = null;
            }

            if (coordinates && coordinates.length > 0) {
                console.log(`🎨 Processing coordinates with ${coordinates.length} rings`);

                // Convert coordinates to Cesium Cartesian3 array
                const cesiumPositions = [];
                for (const ring of coordinates) {
                    console.log(`🎨 Processing ring with ${ring.length} points`);
                    for (const coord of ring) {
                        const lonLat = ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326');
                        const cartesian = Cesium.Cartesian3.fromDegrees(lonLat[0], lonLat[1], 0);
                        cesiumPositions.push(cartesian);
                        console.log(`🎨 Added point: [${lonLat[0]}, ${lonLat[1]}] -> Cartesian3`);
                    }
                }

                console.log(`🎨 Created ${cesiumPositions.length} Cesium positions`);

                // Create polygon hierarchy
                const hierarchy = new Cesium.PolygonHierarchy(cesiumPositions);
                console.log(`🎨 Created polygon hierarchy`);

                // Create textured material
                const material = new Cesium.ImageMaterialProperty({
                    image: `/3dmodelsosm/src/models/${modelFilename}`,
                    transparent: true,
                    color: new Cesium.Color(1.0, 1.0, 1.0, 0.8) // Slight transparency
                });
                console.log(`🎨 Created material with texture: ${modelFilename}`);

                // Create the entity
                const areaEntity = new Cesium.Entity({
                    polygon: {
                        hierarchy: hierarchy,
                        height: modelConfig ? modelConfig.heightOffset : 0,
                        extrudedHeight: 0, // Flat on ground
                        material: material,
                        outline: true, // Enable outline for debugging
                        outlineColor: Cesium.Color.RED,
                        outlineWidth: 2.0,
                        shadows: Cesium.ShadowMode.DISABLED
                    },
                    properties: {
                        areaId: properties.id || `area_${Date.now()}`,
                        areaTags: tagsObj,
                        isArea: true,
                        textureUrl: `/3dmodelsosm/src/models/${modelFilename}`
                    }
                });

                console.log(`🎨 Created area entity:`, areaEntity);

                // Store the entity on the feature for later management
                feature.set('areaEntity', areaEntity);

                // Add to data source if in 3D mode
                const dataSource = this.getDataSource();
                if (dataSource) {
                    dataSource.entities.add(areaEntity);
                    console.log(`🎨 Added textured area entity to 3D scene. Total entities: ${dataSource.entities.values.length}`);

                    // Force a render
                    if (window.ol3d.getCesiumScene) {
                        const scene = window.ol3d.getCesiumScene();
                        if (scene && scene.requestRender) {
                            scene.requestRender();
                            console.log('🎨 Requested scene render');
                        }
                    }
                } else {
                    console.warn('🎨 No 3D mode available, area entity stored but not rendered');
                }

                console.log(`🎨 SUCCESS: Created Cesium entity for area texture ${modelFilename} with ${cesiumPositions.length} vertices`);
                return areaEntity;
            } else {
                console.warn(`🎨 No valid coordinates found for area texture`);
                return null;
            }
        } catch (error) {
            console.error('🎨 Error creating area texture entity:', error);
            console.error('🎨 Error stack:', error.stack);
            return null;
        }
    }

    /**
     * Add all stored area entities to the 3D scene
     */
    addStoredEntitiesToScene() {
        const dataSource = this.getDataSource();
        if (!dataSource) {
            console.warn('🎨 Cannot add stored entities - no data source available');
            return;
        }

        let addedCount = 0;
        // This would need to be implemented to track stored entities
        // For now, entities are added immediately when created

        if (addedCount > 0) {
            if (window.ol3d.getCesiumScene) {
                const scene = window.ol3d.getCesiumScene();
                if (scene && scene.requestRender) {
                    scene.requestRender();
                    console.log(`🎨 Added ${addedCount} stored area entities to scene`);
                }
            }
        }
    }

    /**
     * Clear all area entities
     */
    clear() {
        if (this.dataSource) {
            this.dataSource.entities.removeAll();
            console.log('🎨 Cleared all area texture entities');
        }
        this.areaEntities.clear();
    }
}

// Global area texture manager instance
window.areaTextureManager = new AreaTextureManager();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AreaTextureManager };
}
