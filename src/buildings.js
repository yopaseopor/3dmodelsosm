/**
 * Buildings module for 3D extrusion of building footprints
 * Handles creation of 3D building models from GeoJSON or OSM data
 */

// Global storage for building entities
let buildingEntities = new Map(); // feature -> cesium entity
let ol3dInstance = null;

/**
 * Check if a feature represents a building
 * @param {object} tags - OSM tags object
 * @returns {boolean} True if the feature is a building
 */
function isBuildingFeature(tags) {
    return tags && (tags.building || tags['building:part']);
}

/**
 * Get building color/material based on tags
 * @param {object} tags - OSM tags object
 * @returns {Cesium.Color} Cesium color object
 */
function getBuildingColor(tags) {
    if (!tags) {
        return Cesium.Color.GRAY;
    }

    // Different colors for different building types
    const buildingType = tags.building;
    switch (buildingType) {
        case 'residential':
        case 'apartments':
        case 'house':
            return Cesium.Color.LIGHTBLUE;
        case 'commercial':
        case 'retail':
        case 'office':
            return Cesium.Color.LIGHTGREEN;
        case 'industrial':
            return Cesium.Color.ORANGE;
        case 'school':
        case 'university':
        case 'hospital':
            return Cesium.Color.YELLOW;
        case 'church':
        case 'cathedral':
        case 'chapel':
            return Cesium.Color.LIGHTSLATEGRAY;
        case 'yes':
        default:
            return Cesium.Color.GRAY;
    }
}

/**
 * Get building height from OSM tags
 * @param {object} tags - OSM tags object
 * @returns {number} Building height in meters, default 10m if not specified
 */
function getBuildingHeight(tags) {
    if (!tags) return 10;

    // Check various height-related tags
    const heightTags = ['height', 'building:height', 'estimated_height'];
    for (const tag of heightTags) {
        if (tags[tag]) {
            const height = parseFloat(tags[tag]);
            if (!isNaN(height) && height > 0) {
                return height;
            }
        }
    }

    // Check levels and estimate height (assuming ~3m per level)
    const levelsTags = ['building:levels', 'levels'];
    for (const tag of levelsTags) {
        if (tags[tag]) {
            const levels = parseFloat(tags[tag]);
            if (!isNaN(levels) && levels > 0) {
                return levels * 3.0; // Rough estimate: 3 meters per level
            }
        }
    }

    // Default height for generic buildings
    return 10;
}

/**
 * Create extruded 3D building geometry from a building feature
 * @param {ol.Feature} feature - OpenLayers feature with building geometry
 * @param {object} tags - OSM tags object
 * @returns {object} Building data object
 */
function createExtrudedBuilding(feature, tags) {
    if (!isBuildingFeature(tags)) {
        return null;
    }

    const geometry = feature.getGeometry();
    if (!geometry) {
        console.warn('Building feature has no geometry');
        return null;
    }

    // Only handle polygon geometries (building footprints)
    const geometryType = geometry.getType();
    if (geometryType !== 'Polygon' && geometryType !== 'MultiPolygon') {
        console.log(`Skipping building with geometry type: ${geometryType}`);
        return null;
    }

    try {
        // Get building height
        const height = getBuildingHeight(tags);
        console.log(`🏗️ Creating extruded building with height: ${height}m`);

        // Get coordinates in the correct format for Cesium
        let coordinates;
        if (geometryType === 'Polygon') {
            coordinates = geometry.getCoordinates();
        } else if (geometryType === 'MultiPolygon') {
            // For multi-polygons, use the largest polygon
            const polygons = geometry.getCoordinates();
            coordinates = polygons.reduce((largest, current) =>
                current[0].length > largest[0].length ? current : largest
            );
        }

        if (!coordinates || coordinates.length === 0) {
            console.warn('No valid coordinates found for building');
            return null;
        }

        // Convert coordinates to Cesium Cartesian3 array
        // Note: OpenLayers uses [lon, lat] but we need to transform to WGS84 then to Cartesian3
        const cesiumPositions = [];
        for (const ring of coordinates) {
            for (const coord of ring) {
                // coord is [x, y] in map projection, need to convert to WGS84 then to Cartesian3
                const lonLat = ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326');
                const cartesian = Cesium.Cartesian3.fromDegrees(lonLat[0], lonLat[1], 0);
                cesiumPositions.push(cartesian);
            }
        }

        // Get building color
        const color = getBuildingColor(tags);

        // Create building data object
        const buildingData = {
            positions: cesiumPositions,
            height: height,
            color: color,
            tags: tags,
            feature: feature
        };

        console.log(`🏗️ Created extruded building with ${cesiumPositions.length} vertices`);

        return buildingData;

    } catch (error) {
        console.error('Error creating extruded building:', error);
        return null;
    }
}

/**
 * Create a Cesium entity for a building
 * @param {object} buildingData - Building data from createExtrudedBuilding
 * @returns {Cesium.Entity} Cesium entity for the building
 */
function createBuildingEntity(buildingData) {
    try {
        const { positions, height, color, tags } = buildingData;

        // Create polygon hierarchy
        const hierarchy = new Cesium.PolygonHierarchy(positions);

        // Create the entity
        const entity = new Cesium.Entity({
            polygon: {
                hierarchy: hierarchy,
                extrudedHeight: height,
                height: 0, // Base height (ground level)
                material: color, // Remove alpha for full opacity
                outline: true,
                outlineColor: Cesium.Color.RED, // Make outline more visible
                outlineWidth: 2.0,
                // Disable shadows and lighting for better performance
                shadows: Cesium.ShadowMode.DISABLED
            },
            // Add custom properties for identification
            properties: {
                buildingId: tags.id || `building_${Date.now()}`,
                buildingTags: tags,
                isBuilding: true
            }
        });

        console.log(`🏗️ Created Cesium entity for building with height ${height}m at position:`, positions[0]); // Log first position for debugging
        return entity;

    } catch (error) {
        console.error('Error creating building entity:', error);
        return null;
    }
}

function addBuildingsToScene(ol3d) {
    if (!ol3d || !ol3d.getDataSources) {
        console.warn('OLCesium instance not available or getDataSources not supported');
        return;
    }

    ol3dInstance = ol3d;
    const dataSources = ol3d.getDataSources();

    // Check if 'Buildings' data source already exists
    let dataSource = null;
    for (let i = 0; i < dataSources.length; i++) {
        const ds = dataSources.get(i);
        if (ds.name === 'Buildings') {
            dataSource = ds;
            break;
        }
    }

    // If no Buildings data source exists, create one
    if (!dataSource) {
        dataSource = new Cesium.CustomDataSource('Buildings');
        dataSources.add(dataSource);
        console.log('🏗️ Created new Buildings data source');
    } else {
        console.log('🏗️ Using existing Buildings data source');
    }

    // Process all features that have building data
    window.map.getLayers().forEach(layer => {
        if (layer.get('type') === 'overlay') {
            layer.getLayers().forEach(sublayer => {
                const source = sublayer.getSource();
                if (source && source.getFeatures) {
                    const features = source.getFeatures();
                    features.forEach(feature => {
                        const buildingData = feature.get('extrudedBuilding');
                        if (buildingData) {
                            // Check if entity already exists for this feature
                            if (!buildingEntities.has(feature)) {
                                const entity = createBuildingEntity(buildingData);
                                if (entity) {
                                    dataSource.entities.add(entity);
                                    buildingEntities.set(feature, entity);
                                }
                            }
                        }
                    });
                }
            });
        }
    });

    console.log(`🏗️ Buildings data source now has ${dataSource.entities.values.length} entities`);
    console.log(`🏗️ Total data sources: ${dataSources.length}`);
}

/**
 * Remove building entities from the Cesium scene
 */
function removeBuildingsFromScene() {
    if (!ol3dInstance) return;

    const dataSources = ol3dInstance.getDataSources();

    // Remove all building data sources
    for (let i = dataSources.length - 1; i >= 0; i--) {
        const dataSource = dataSources.get(i);
        if (dataSource.name === 'Buildings') {
            dataSources.remove(dataSource, true);
            console.log('🏗️ Removed buildings data source from 3D scene');
            break;
        }
    }

    // Clear the entities map
    buildingEntities.clear();
    ol3dInstance = null;
}

/**
 * Update building visibility in 3D scene
 * @param {boolean} visible - Whether buildings should be visible
 */
function setBuildingsVisible(visible) {
    buildingEntities.forEach(entity => {
        entity.show = visible;
    });
    console.log(`🏗️ Set building visibility to: ${visible}`);
}

/**
 * Process features and create extruded buildings where applicable
 * @param {Array<ol.Feature>} features - Array of OpenLayers features
 */
function processBuildingFeatures(features) {
    if (!features || !Array.isArray(features)) {
        console.warn('No features provided for building processing');
        return;
    }

    console.log(`🏗️ Processing ${features.length} features for building extrusion`);

    let buildingCount = 0;

    features.forEach((feature, index) => {
        try {
            const properties = feature.getProperties();
            const osmTags = Object.keys(properties).filter(prop =>
                !['geometry', 'id', 'type', 'originalType', 'fixedGeometry', 'members', 'memberOf', 'member', 'membership', 'role', 'version', 'timestamp', 'changeset', 'user', 'uid', 'visible'].includes(prop)
            );

            // Collect all OSM tags into an object
            const tagsObj = {};
            osmTags.forEach(tag => {
                tagsObj[tag] = properties[tag];
            });

            // Try to create extruded building
            const buildingData = createExtrudedBuilding(feature, tagsObj);

            if (buildingData) {
                // Store building data on the feature
                feature.set('extrudedBuilding', buildingData);
                feature.set('buildingHeight', buildingData.height);
                feature.set('buildingTags', tagsObj);

                buildingCount++;
                console.log(`🏗️ SUCCESS: Created extruded building ${buildingCount} with height ${buildingData.height}m`);

                // If we're in 3D mode, immediately add the building to the scene
                if (window.ol3d && window.ol3d.getDataSources) {
                    const dataSources = window.ol3d.getDataSources();
                    // Find or create buildings data source
                    let dataSource = null;
                    for (let i = 0; i < dataSources.length; i++) {
                        const ds = dataSources.get(i);
                        if (ds.name === 'Buildings') {
                            dataSource = ds;
                            break;
                        }
                    }
                    if (!dataSource) {
                        dataSource = new Cesium.CustomDataSource('Buildings');
                        dataSources.add(dataSource);
                    }
                    const entity = createBuildingEntity(buildingData);
                    if (entity) {
                        dataSource.entities.add(entity);
                        window.buildings.buildingEntities.set(feature, entity);
                        console.log(`🏗️ Added new building entity to 3D scene from GeoJSON`);
                    }
                }
            } else {
                // Check if this should have been a building but failed
                if (isBuildingFeature(tagsObj)) {
                    console.log(`🏗️ WARNING: Failed to create extruded building for feature with building tags:`, tagsObj);
                }
            }

        } catch (error) {
            console.error(`Error processing feature ${index + 1} for building extrusion:`, error);
        }
    });

    console.log(`🏗️ Building extrusion complete: ${buildingCount} buildings created from ${features.length} features`);
}

/**
 * Update building extrusion options based on user preferences or dynamic data
 * @param {ol.Feature} feature - Building feature
 * @param {object} options - New options to apply
 */
function updateBuildingExtrusion(feature, options) {
    if (!feature) return;

    const currentBuilding = feature.get('extrudedBuilding');
    if (!currentBuilding) {
        console.warn('Feature does not have extruded building data');
        return;
    }

    // Update the building data
    const updatedBuilding = { ...currentBuilding, ...options };
    feature.set('extrudedBuilding', updatedBuilding);

    // Update individual properties if specified
    if (options.height !== undefined) {
        feature.set('buildingHeight', options.height);
    }

    // Update the Cesium entity if it exists
    const entity = buildingEntities.get(feature);
    if (entity) {
        if (options.height !== undefined) {
            entity.polygon.extrudedHeight = options.height;
        }
        if (options.color) {
            entity.polygon.material = options.color.withAlpha(0.8);
        }
    }

    console.log('🏗️ Updated building extrusion options');
}

window.addEventListener('ol3dInitialized', function(event) {
    console.log('🏗️ 3D mode initialized, adding buildings to scene');
    addBuildingsToScene(event.detail.ol3d);
});

window.addEventListener('ol3dDestroyed', function() {
    console.log('🏗️ 3D mode destroyed, removing buildings from scene');
    removeBuildingsFromScene();
});

// Export functions for use in other modules
window.buildings = {
    isBuildingFeature,
    getBuildingHeight,
    getBuildingColor,
    createExtrudedBuilding,
    createBuildingEntity,
    addBuildingsToScene,
    removeBuildingsFromScene,
    setBuildingsVisible,
    processBuildingFeatures,
    updateBuildingExtrusion
};
