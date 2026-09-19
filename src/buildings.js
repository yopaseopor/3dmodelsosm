/**
 * Buildings module for 3D extrusion of building footprints
 * Handles creation of 3D building models from GeoJSON or OSM data
 */

// Global storage for building entities
let buildingEntities = new Map(); // feature -> cesium entity
let ol3dInstance = null;
window.buildings = window.buildings || {};

// Walls extend this far below the sampled ground base, so the building can
// never float over terrain even when DEM detail refines after placement.
const BUILDING_SKIRT_METERS = 0.5;

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
			case 'triumphal_arch':
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

        // Convert coordinates to WGS84 lon/lat first
        const lonLatRing = [];
        for (const ring of coordinates) {
            for (const coord of ring) {
                // coord is [x, y] in map projection, need to convert to WGS84
                lonLatRing.push(ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326'));
            }
        }

        // Per-vertex DEM ground (MapTerhorn / GeoTIFF): each footprint corner
        // samples the DEM grid EXACTLY (no neighborhood averaging) — the same
        // grid the terrain provider renders from — so the base matches the
        // visible surface. Walls are extended 0.5m BELOW the sampled base, so
        // the buried skirt absorbs any residual convexity between corners.
        let groundElevation = 0;          // mean ground (kept for API compat)
        let groundMax = 0;                // highest base corner
        let baseRelief = 0;
        let perVertexHeights = null;
        if (window.terrainManager && window.terrainManager.getElevation && lonLatRing.length > 0) {
            try {
                const samples = (window.mapterhornTerrain && window.mapterhornTerrain.getGroundSamples)
                    ? window.mapterhornTerrain.getGroundSamples(lonLatRing, {
                        // Sample the RENDERED ground surface — the same layer
                        // draped textures and ground-clamped models sit on.
                        // Fall back to the DEM sampling grid only while the
                        // globe tile under the building is still loading.
                        sampler: (lon, lat) => {
                            const globe = (window.mapterhornTerrain._globeElevation)
                                ? window.mapterhornTerrain._globeElevation(lon, lat) : null;
                            if (globe !== null && globe !== undefined && isFinite(globe)) return globe;
                            return window.terrainManager.getElevation(lon, lat);
                        },
                        smoothMeters: 0, // exact per-corner alignment, skirt covers convexity
                        lift: 0
                    })
                    : null;
                if (samples) {
                    groundMax = samples.max;
                    groundElevation = samples.mean;
                    baseRelief = samples.max - samples.min;
                    perVertexHeights = samples.heights.map(h => h - BUILDING_SKIRT_METERS);
                } else {
                    const g = window.terrainManager.getElevation(lonLatRing[0][0], lonLatRing[0][1]);
                    if (g !== null && g !== undefined && isFinite(g)) groundElevation = g;
                    groundMax = groundElevation;
                }
            } catch (e) { /* DEM not ready yet - keep 0 */ }
        }

        const cesiumPositions = lonLatRing.map((lonLat, i) =>
            Cesium.Cartesian3.fromDegrees(lonLat[0], lonLat[1],
                perVertexHeights ? perVertexHeights[i % perVertexHeights.length] : groundElevation));

        // Get building color
        const color = getBuildingColor(tags);

        // Create building data object
        const buildingData = {
            positions: cesiumPositions,
            height: height,
            groundElevation: groundElevation,
            groundMax: groundMax,
            baseRelief: baseRelief,
            // Expose per-corner ground heights so repositionBuildingsOnDem() can
            // distinguish "real samples" from a no-data fallback (height 0).
            // Without this, buildings were never rebuilt when DEM tiles refined.
            perVertexHeights: perVertexHeights,
            color: color,
            tags: tags,
            feature: feature
        };

        console.log(`🏗️ Created extruded building with ${cesiumPositions.length} vertices on ground at ${groundElevation.toFixed(1)}m (max ${groundMax.toFixed(1)}m, relief ${baseRelief.toFixed(1)}m, walls skirted below base)`);

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
        console.log(`🏗️ createBuildingEntity called with:`, buildingData);
        const { positions, height, color, tags } = buildingData;
        const groundElevation = buildingData.groundElevation || 0;
        const groundMax = (buildingData.groundMax !== undefined) ? buildingData.groundMax : groundElevation;
        
        if (!positions || positions.length === 0) {
            console.warn(`🏗️ No positions provided for building entity`);
            return null;
        }
        
        if (!height || height <= 0) {
            console.warn(`🏗️ Invalid height for building entity:`, height);
            return null;
        }

        console.log(`🏗️ Creating entity with ${positions.length} positions, height: ${height}m, color:`, color);

        // Create polygon hierarchy
        const hierarchy = new Cesium.PolygonHierarchy(positions);

        // Create material with better appearance and texture support
        let material;
        
        // Check if texture is specified in tags
        if (tags.texture || tags.building_texture || tags.material) {
            const textureUrl = tags.texture || tags.building_texture || tags.material;
            console.log(`🏗️ Using texture for building:`, textureUrl);
            
            material = new Cesium.Material({
                fabric: {
                    type: 'Image',
                    uniforms: {
                        image: textureUrl,
                        color: color
                    }
                }
            });
        } else {
            // Use solid color material - ensure color is properly applied
            console.log(`🏗️ Using solid color for building:`, color);
            material = color; // Use color directly as material
        }

        // Create the entity
        const entity = new Cesium.Entity({
            polygon: {
                hierarchy: hierarchy,
                perPositionHeight: true, // base vertices carry their soft DEM heights
                extrudedHeight: groundMax + height, // flat top above the highest base corner
                material: material,
                outline: true,
                outlineColor: Cesium.Color.BLACK, // Black outline for better visibility
                outlineWidth: 1.0,
                // Enable proper lighting and shadows for better appearance
                shadows: Cesium.ShadowMode.ENABLED,
                enableLighting: true
            },
            // Add custom properties for identification
            properties: {
                buildingId: tags.id || `building_${Date.now()}`,
                buildingTags: tags,
                isBuilding: true
            }
        });

        // Register the building data on the feature itself so the DEM re-seat
        // hook can find every building (index.js creates entities without
        // storing extrudedBuilding on the feature).
        if (buildingData.feature) {
            buildingData.feature.set('extrudedBuilding', buildingData);
        }

        console.log(`🏗️ Created Cesium entity for building with height ${height}m at position:`, positions[0]); // Log first position for debugging
        return entity;

    } catch (error) {
        console.error('Error creating building entity:', error);
        return null;
    }
}

/**
 * Helper function to process features in a layer for building extrusion
 * @param {ol.layer.Layer} layer - Layer to process
 * @param {Cesium.CustomDataSource} dataSource - Data source to add entities to
 */
function processLayerFeatures(layer, dataSource) {
    const source = layer.getSource();
    if (source && source.getFeatures) {
        const features = source.getFeatures();
        console.log(`🏗️ Processing ${features.length} features in layer for buildings`);
        
        features.forEach((feature, index) => {
            const buildingData = feature.get('extrudedBuilding');
            if (buildingData) {
                // Check if entity already exists for this feature
                if (!buildingEntities.has(feature)) {
                    console.log(`🏗️ Feature ${index}: Found existing building data, creating entity`);
                    const entity = createBuildingEntity(buildingData);
                    if (entity && dataSource && dataSource.entities) {
                        dataSource.entities.add(entity);
                        buildingEntities.set(feature, entity);
                        console.log(`🏗️ Added building entity for feature ${index}`);
                    } else {
                        console.warn(`🏗️ Failed to create entity for feature ${index}:`, entity);
                    }
                } else {
                    console.log(`🏗️ Feature ${index}: Entity already exists`);
                }
            } else {
                // Check if this feature should be extruded as a building
                const tags = {};
                feature.getKeys().forEach(key => {
                    if (key !== 'geometry' && key !== 'extrudedBuilding') {
                        tags[key] = feature.get(key);
                    }
                });
                
                console.log(`🏗️ Feature ${index} tags:`, tags);
                const isBuilding = isBuildingFeature(tags);
                console.log(`🏗️ Feature ${index} isBuilding:`, isBuilding);
                
                if (isBuilding) {
                    console.log(`🏗️ Feature ${index}: Found building feature with tags:`, tags);
                    const buildingOptions = createExtrudedBuilding(feature, tags);
                    console.log(`🏗️ Feature ${index}: Created building options:`, buildingOptions);
                    if (buildingOptions) {
                        feature.set('extrudedBuilding', buildingOptions);
                        const entity = createBuildingEntity(buildingOptions);
                        console.log(`🏗️ Feature ${index}: Created entity:`, entity);
                        if (entity && dataSource && dataSource.entities) {
                            dataSource.entities.add(entity);
                            buildingEntities.set(feature, entity);
                            console.log(`🏗️ Created and added building entity for feature ${index}`);
                        } else {
                            console.warn(`🏗️ Failed to add entity for feature ${index}:`, { entity, dataSource, entities: dataSource?.entities });
                        }
                    } else {
                        console.warn(`🏗️ Failed to create building options for feature ${index}`);
                    }
                } else {
                    console.log(`🏗️ Feature ${index}: Not a building, skipping`);
                }
            }
        });
    }
}

/**
 * Re-seat tracked buildings on the DEM ground when new terrain tiles arrive.
 * Building bases are sampled from the rendered surface at creation time; when
 * finer tiles load afterwards the surface can shift, leaving buildings sunk or
 * floating. Rebuilding the entity with fresh DEM samples fixes it.
 */
function repositionBuildingsOnDem() {
    if (buildingEntities.size === 0) return;
    // ol3dInstance may be null when entities were added via processBuildingFeatures;
    // fall back to the global instance so re-seating still works.
    if (!ol3dInstance && window.ol3d && window.ol3d.getDataSources) {
        ol3dInstance = window.ol3d;
    }
    if (!ol3dInstance || !ol3dInstance.getDataSources) return;

    let dataSource = null;
    const dataSources = ol3dInstance.getDataSources();
    for (let i = 0; i < dataSources.length; i++) {
        if (dataSources.get(i).name === 'Buildings') { dataSource = dataSources.get(i); break; }
    }
    if (!dataSource) return;

    let updated = 0;
    buildingEntities.forEach((entity, feature) => {
        try {
            const current = feature.get('extrudedBuilding');
            if (!current || !current.tags || !entity || !entity.polygon) return;

            const fresh = createExtrudedBuilding(feature, current.tags);
            if (!fresh || !isFinite(fresh.groundMax)) return;
            // Never rebuild from a no-data sample (would bury at height 0):
            // perVertexHeights is only set when real DEM samples came back.
            if (!fresh.perVertexHeights) return;

            // Only rebuild when the ground clearly moved (tile refinement);
            // sub-meter shifts are covered by the 0.5m buried walls.
            if (Math.abs(fresh.groundMax - current.groundMax) < 1.0) return;

            dataSource.entities.remove(entity);
            const rebuilt = createBuildingEntity(fresh);
            if (rebuilt) {
                dataSource.entities.add(rebuilt);
                buildingEntities.set(feature, rebuilt);
                feature.set('extrudedBuilding', fresh);
                updated++;
            }
        } catch (e) { /* skip this building */ }
    });

    if (updated > 0) {
        console.log(`🏗️ Re-seated ${updated} building(s) on refined DEM ground`);
    }
}

function addBuildingsToScene(ol3d) {
    if (!ol3d || !ol3d.getDataSources) {
        console.warn('OLCesium instance not available or getDataSources not supported');
        return;
    }

    ol3dInstance = ol3d;

    // Re-seat buildings when DEM terrain tiles arrive after placement
    if (window.mapterhornTerrain && window.mapterhornTerrain.onTilesLoaded && !addBuildingsToScene._demHooked) {
        addBuildingsToScene._demHooked = true;
        window.mapterhornTerrain.onTilesLoaded(function () { repositionBuildingsOnDem(); });
    }
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
        // Process overlay layers (existing logic) - check if it's a group layer
        if (layer.get('type') === 'overlay' && typeof layer.getLayers === 'function') {
            layer.getLayers().forEach(sublayer => {
                processLayerFeatures(sublayer, dataSource);
            });
        }
        // Process GeoJSON layers (new logic)
        else if (layer instanceof ol.layer.Vector) {
            processLayerFeatures(layer, dataSource);
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
 * Clean up building entities to prevent memory leaks
 * Removes entities when count exceeds limit
 */
function cleanupBuildingEntities() {
    const maxBuildings = 500; // Maximum building entities to keep
    
    if (buildingEntities.size > maxBuildings) {
        console.log(`🏗️ Cleaning up building entities: ${buildingEntities.size} buildings, reducing to ${maxBuildings}`);
        
        if (!ol3dInstance) return;
        
        const dataSources = ol3dInstance.getDataSources();
        let dataSource = null;
        for (let i = 0; i < dataSources.length; i++) {
            const ds = dataSources.get(i);
            if (ds.name === 'Buildings') {
                dataSource = ds;
                break;
            }
        }
        
        if (!dataSource) return;
        
        // Remove oldest entities (first ones in the map)
        const toRemove = buildingEntities.size - maxBuildings;
        let removed = 0;
        
        for (const [feature, entity] of buildingEntities) {
            if (removed >= toRemove) break;
            dataSource.entities.remove(entity);
            buildingEntities.delete(feature);
            removed++;
        }
        
        console.log(`🏗️ Removed ${removed} building entities`);
    }
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
                        
                        // Clean up periodically to prevent memory leaks
                        if (window.buildings.buildingEntities.size % 50 === 0) {
                            window.buildings.cleanupBuildingEntities();
                        }
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

/**
 * Reprocess all layers for buildings (useful when GeoJSON layers are loaded before 3D mode)
 */
function reprocessAllLayersForBuildings() {
    if (!window.map) return;
    
    console.log('🏗️ Reprocessing all layers for buildings');
    window.map.getLayers().forEach(layer => {
        // Process overlay layers - check if it's a group layer
        if (layer.get('type') === 'overlay' && typeof layer.getLayers === 'function') {
            layer.getLayers().forEach(sublayer => {
                processLayerFeatures(sublayer, null);
            });
        }
        // Process GeoJSON layers
        else if (layer instanceof ol.layer.Vector) {
            processLayerFeatures(layer, null);
        }
    });
}

window.addEventListener('ol3dDestroyed', function() {
    console.log('🏗️ 3D mode destroyed, removing buildings from scene');
    removeBuildingsFromScene();
});

// Export functions for use in other modules
window.buildings = {
    buildingEntities, // Add buildingEntities to the export
    isBuildingFeature,
    getBuildingHeight,
    getBuildingColor,
    createExtrudedBuilding,
    createBuildingEntity,
    addBuildingsToScene,
    removeBuildingsFromScene,
    cleanupBuildingEntities,
    setBuildingsVisible,
    processBuildingFeatures,
    updateBuildingExtrusion,
    reprocessAllLayersForBuildings
};
