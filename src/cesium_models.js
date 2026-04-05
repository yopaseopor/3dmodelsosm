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
                
                // Check if feature already has an area entity to prevent duplicates
                if (feature.get('areaEntity')) {
                    console.log(`🎨 Feature already has area entity, skipping duplicate creation`);
                    return null;
                }

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

                // Calculate texture rotation based on nearby ways
                const polygonCoords = coordinates[0].map(coord => 
                    ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326')
                );
                const textureRotation = this.calculateTextureRotation(polygonCoords, modelFilename);
                console.log(`🎨 Calculated texture rotation: ${(textureRotation * 180 / Math.PI).toFixed(1)}°`);

                // Create textured material with rotation support
                const material = new Cesium.ImageMaterialProperty({
                    image: `/3dmodelsosm/src/models/${modelFilename}`,
                    transparent: true,
                    color: new Cesium.Color(1.0, 1.0, 1.0, 0.8), // Slight transparency
                });
                
                console.log(`🎨 Created material with texture: ${modelFilename}, rotation: ${(textureRotation * 180 / Math.PI).toFixed(1)}°`);

                // Create the entity
                const areaEntity = new Cesium.Entity({
                    polygon: {
                        hierarchy: hierarchy,
                        height: modelConfig ? (modelConfig.heightOffset || 0.001) : 0.001,
                        extrudedHeight: modelConfig ? (modelConfig.heightOffset || 0.001) : 0.001, // Flat on ground
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
                        textureUrl: `/3dmodelsosm/src/models/${modelFilename}`,
                        textureRotation: textureRotation
                    }
                });

                console.log(`🎨 Created area entity with rotation:`, areaEntity);

                // Store the entity on the feature for later management
                feature.set('areaEntity', areaEntity);

                // Add to data source if in 3D mode
                const dataSource = window.areaTextureManager.getDataSource();
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

                console.log(`🎨 SUCCESS: Created Cesium entity for area texture ${modelFilename} with ${cesiumPositions.length} vertices and rotation ${(textureRotation * 180 / Math.PI).toFixed(1)}°`);
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
        const dataSource = window.areaTextureManager.getDataSource();
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
     * Calculate texture rotation based on nearby ways that cross or are adjacent to the texture area
     * @param {Array<Array<number>>} polygonCoordinates - Polygon coordinates [lon, lat]
     * @param {string} textureName - Name of the texture file
     * @returns {number} Rotation angle in radians (0 if no rotation needed)
     */
    calculateTextureRotation(polygonCoordinates, textureName) {
        console.log(`🎨 calculateTextureRotation called for texture: ${textureName}`);

        // DISABLED: Canvas rotation causes gaps in tiling
        // Need different approach - pre-rotated textures or different rotation method
        console.log(`🎨 Texture rotation disabled - canvas rotation causes tiling gaps`);
        return 0; // No rotation for now
        
        /*
        // TEMPORARY: Force 45-degree rotation on ALL textures for testing
        const testRotation = Math.PI / 4; // 45 degrees
        console.log(`🎨 FORCING TEST ROTATION: ${(testRotation * 180 / Math.PI).toFixed(1)}° for ALL textures`);
        return testRotation;
        
        // Original code below - disabled for testing
        console.log(`🎨 Processing rotation for texture: ${textureName} (testing all textures)`);
        // ... rest of original code
        */
    }

    /**
     * Check if a way intersects or is adjacent to a polygon
     * @param {ol.geom.LineString|ol.geom.MultiLineString} wayGeometry - The way geometry
     * @param {Array<Array<number>>} polygonCoords - Polygon coordinates [lon, lat]
     * @returns {boolean} True if the way intersects or is adjacent
     */
    wayIntersectsOrAdjacentToPolygon(wayGeometry, polygonCoords) {
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
    }

    /**
     * Check if a line segment intersects a polygon
     * @param {Array<Array<number>>} lineSegment - [[lon1, lat1], [lon2, lat2]]
     * @param {Array<Array<number>>} polygonCoords - Polygon coordinates
     * @returns {boolean} True if line intersects polygon
     */
    lineIntersectsPolygon(lineSegment, polygonCoords) {
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
    }

    /**
     * Check if two line segments intersect
     */
    linesIntersect(a, b, c, d) {
        const det = (b[0] - a[0]) * (d[1] - c[1]) - (d[0] - c[0]) * (b[1] - a[1]);
        if (det === 0) return false; // Lines are parallel

        const lambda = ((d[1] - c[1]) * (d[0] - a[0]) + (c[0] - d[0]) * (d[1] - a[1])) / det;
        const gamma = ((a[1] - b[1]) * (d[0] - a[0]) + (b[0] - a[0]) * (d[1] - a[1])) / det;

        return (0 < lambda && lambda < 1) && (0 < gamma && gamma < 1);
    }

    /**
     * Check if point is inside polygon using ray casting
     */
    isPointInPolygon(point, polygon) {
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
    }

    /**
     * Get bounding box of polygon
     */
    getPolygonBounds(polygonCoords) {
        let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
        polygonCoords.forEach(coord => {
            minLon = Math.min(minLon, coord[0]);
            maxLon = Math.max(maxLon, coord[0]);
            minLat = Math.min(minLat, coord[1]);
            maxLat = Math.max(maxLat, coord[1]);
        });
        return { minLon, maxLon, minLat, maxLat };
    }

    /**
     * Check if point is near polygon (within distance in meters)
     */
    pointNearPolygon(point, polygonCoords, bounds, maxDistanceMeters) {
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
    }

    /**
     * Calculate distance from point to line segment in meters
     */
    pointToLineDistance(point, lineStart, lineEnd) {
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
    }

    /**
     * Calculate haversine distance between two points in meters
     */
    haversineDistance(point1, point2) {
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
    }

    /**
     * Calculate bearing (direction) of a way from its coordinates
     * @param {Array<Array<number>>} coords - Array of [lon, lat] coordinates
     * @returns {number|null} Bearing in radians, or null if cannot calculate
     */
    calculateWayBearing(coords) {
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
