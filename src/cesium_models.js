/**
 * Cesium Models Module
 * Handles 3D model operations in Cesium scene, including area textures and point models
 */

const CESIUM_AREA_TEXTURE_MAX_CANVAS = 2048;
const CESIUM_AREA_TEXTURE_JPEG_QUALITY = 0.78;

function cesiumModelsVerbose() {
    return typeof window !== 'undefined' && window.globalDebugConfig &&
        window.globalDebugConfig.cesiumModels && window.globalDebugConfig.cesiumModels.verbose;
}

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
                if (cesiumModelsVerbose()) console.log('🎨 Created AreaTextures data source');
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
        if (cesiumModelsVerbose()) console.log(`🎨 Applying area texture ${modelFilename}`);

        try {
            if (cesiumModelsVerbose()) console.log(`🎨 Starting area texture creation for feature`, feature.getId ? feature.getId() : 'unknown', 'with model:', modelFilename);

            const geometry = feature.getGeometry();
            const projection = window.map && window.map.getView && window.map.getView().getProjection ?
                window.map.getView().getProjection() : 'EPSG:4326';

            // Normalize ring coordinates helper
            const normalizeRing = ring => {
                if (!Array.isArray(ring)) return [];
                return ring.map(coord => Array.isArray(coord) && coord.length >= 2 ? [coord[0], coord[1]] : null)
                    .filter(coord => coord && typeof coord[0] === 'number' && typeof coord[1] === 'number');
            };

            // Extract polygon coordinates from various geometry types
            const extractPolygonCoordinates = geom => {
                if (!geom || !geom.getType) return null;
                const geomType = geom.getType();

                try {
                    if (geomType === 'Polygon') {
                        return [geom.getCoordinates()];
                    }
                    if (geomType === 'MultiPolygon') {
                        return geom.getCoordinates();
                    }
                    if (geomType === 'LineString') {
                        return [geom.getCoordinates()];
                    }
                    if (geomType === 'GeometryCollection' && geom.getGeometries) {
                        const geometries = geom.getGeometries();
                        for (const subGeom of geometries) {
                            const result = extractPolygonCoordinates(subGeom);
                            if (result) return result;
                        }
                    }
                } catch (e) {
                    if (cesiumModelsVerbose()) console.warn(`🎨 Error extracting coordinates from ${geomType}:`, e.message);
                }
                return null;
            };

            let coordinates = null;

            // Try to extract coordinates from the feature geometry
            if (geometry) {
                if (cesiumModelsVerbose()) console.log(`🎨 Feature has geometry type:`, geometry.getType ? geometry.getType() : 'unknown');
                coordinates = extractPolygonCoordinates(geometry);
                if (coordinates && cesiumModelsVerbose()) console.log(`🎨 Extracted ${coordinates.length} polygon(s) from ${geometry.getType()}`);
            }

            // Fallback: try GeoJSON-style geometry object
            if (!coordinates && geometry && geometry.coordinates) {
                coordinates = geometry.coordinates;
                if (cesiumModelsVerbose()) console.log(`🎨 Using GeoJSON-style coordinates`);
            }

            // Fallback: try geometry in properties
            if (!coordinates && properties && properties.geometry && properties.geometry.coordinates) {
                coordinates = properties.geometry.coordinates;
                if (cesiumModelsVerbose()) console.log(`🎨 Using geometry from properties`);
            }

            if (!coordinates || coordinates.length === 0) {
                console.warn(`🎨 No coordinates found for area texture`);
                return null;
            }

            if (cesiumModelsVerbose()) console.log(`🎨 Processing ${coordinates.length} polygon(s), projection: ${projection}`);

            // Check for duplicate
            if (feature.get('areaEntity')) {
                if (cesiumModelsVerbose()) console.log(`🎨 Feature already has area entity, skipping`);
                return null;
            }

            // Resolve image URL
            const imageUrl = typeof modelFilename === 'string' && modelFilename.startsWith('/') ? 
                modelFilename : `/3dmodelsosm/src/models/${modelFilename}`;
            if (cesiumModelsVerbose()) console.log(`🎨 Using image URL:`, imageUrl);

            // Determine if we have MultiPolygon or Polygon
            const polygonSets = Array.isArray(coordinates[0]) && Array.isArray(coordinates[0][0]) && 
                               Array.isArray(coordinates[0][0][0]) ? coordinates : [coordinates];

            if (cesiumModelsVerbose()) console.log(`🎨 Processing ${polygonSets.length} polygon set(s)`);

            const entities = [];

            for (let pIdx = 0; pIdx < polygonSets.length; pIdx++) {
                const polygonRings = polygonSets[pIdx];
                if (!Array.isArray(polygonRings) || polygonRings.length === 0) {
                    if (cesiumModelsVerbose()) console.warn(`🎨 Polygon ${pIdx} has no rings`);
                    continue;
                }

                let outerRing = normalizeRing(polygonRings[0]);
                if (cesiumModelsVerbose()) console.log(`🎨 Polygon ${pIdx}: outer ring normalized to ${outerRing.length} points`);

                if (outerRing.length < 3) {
                    console.warn(`🎨 Polygon ${pIdx} outer ring has less than 3 points after normalization`);
                    continue;
                }

                // Close the ring if needed
                if (outerRing[0][0] !== outerRing[outerRing.length - 1][0] || outerRing[0][1] !== outerRing[outerRing.length - 1][1]) {
                    outerRing = outerRing.concat([outerRing[0]]);
                }

                // Convert to Cesium Cartesian3
                const cesiumOuter = outerRing.map(coord => {
                    try {
                        // Detect if coordinates are already in EPSG:4326 (WGS84 lat/lon)
                        // If already in valid lat/lon range (-180..180, -90..90) no need to transform
                        let lonLat;
                        if (coord[0] >= -180 && coord[0] <= 180 && coord[1] >= -90 && coord[1] <= 90) {
                            lonLat = coord; // Already WGS84
                        } else {
                            lonLat = ol.proj.transform(coord, projection, 'EPSG:4326');
                        }
                        return Cesium.Cartesian3.fromDegrees(lonLat[0], lonLat[1], 0);
                    } catch (e) {
                        console.error(`🎨 Error transforming coordinate`, coord, ':', e.message);
                        return null;
                    }
                }).filter(c => c !== null);

                if (cesiumOuter.length < 3) {
                    console.warn(`🎨 Polygon ${pIdx} has less than 3 Cartesian points after transformation`);
                    continue;
                }

                // Process holes
                const holeHierarchies = (polygonRings.length > 1 ? polygonRings.slice(1) : [])
                    .map(normalizeRing)
                    .filter(hole => hole.length >= 3)
                    .map(holeRing => {
                        let closedHole = holeRing;
                        if (holeRing[0][0] !== holeRing[holeRing.length - 1][0] || holeRing[0][1] !== holeRing[holeRing.length - 1][1]) {
                            closedHole = holeRing.concat([holeRing[0]]);
                        }
                        const holePositions = closedHole.map(coord => {
                            try {
                                const lonLat = ol.proj.transform(coord, projection, 'EPSG:4326');
                                return Cesium.Cartesian3.fromDegrees(lonLat[0], lonLat[1], 0);
                            } catch (e) {
                                console.error(`🎨 Error transforming hole coordinate`, coord, ':', e.message);
                                return null;
                            }
                        }).filter(c => c !== null);
                        return new Cesium.PolygonHierarchy(holePositions);
                    });

                if (cesiumModelsVerbose()) console.log(`🎨 Polygon ${pIdx}: ${cesiumOuter.length} outer points, ${holeHierarchies.length} hole(s)`);

                // Create polygon hierarchy
                const hierarchy = new Cesium.PolygonHierarchy(cesiumOuter, holeHierarchies);

                // Calculate texture rotation
                const polygonCoords = outerRing.map(coord => 
                    ol.proj.transform(coord, projection, 'EPSG:4326')
                );
                const textureRotation = this.calculateTextureRotation(polygonCoords, imageUrl, tagsObj);

                // Create material
                const material = new Cesium.ImageMaterialProperty({
                    image: imageUrl,
                    transparent: true,
                    color: new Cesium.Color(1.0, 1.0, 1.0, 0.8)
                });

                // Create entity
                const areaEntity = new Cesium.Entity({
                    polygon: {
                        hierarchy: hierarchy,
                        height: modelConfig ? (modelConfig.heightOffset || 0.001) : 0.001,
                        extrudedHeight: modelConfig ? (modelConfig.heightOffset || 0.001) : 0.001,
                        material: material,
                        outline: false,
                        shadows: Cesium.ShadowMode.DISABLED
                    },
                    properties: {
                        areaId: properties.id || `area_${Date.now()}`,
                        areaTags: tagsObj,
                        isArea: true,
                        textureUrl: imageUrl,
                        textureRotation: textureRotation
                    }
                });

                entities.push(areaEntity);
                if (cesiumModelsVerbose()) console.log(`🎨 Created entity for polygon ${pIdx}`);
            }

            if (entities.length === 0) {
                console.warn(`🎨 No valid polygon rings found for area texture`);
                return null;
            }

            // Add to data source
            const dataSource = window.areaTextureManager.getDataSource();
            if (!dataSource) {
                console.warn('🎨 No data source available, storing but not rendering');
                feature.set('areaEntity', entities.length === 1 ? entities[0] : entities);
                return entities.length === 1 ? entities[0] : entities;
            }

            entities.forEach(entity => dataSource.entities.add(entity));
            feature.set('areaEntity', entities.length === 1 ? entities[0] : entities);

            if (window.ol3d && window.ol3d.getCesiumScene) {
                const scene = window.ol3d.getCesiumScene();
                if (scene && scene.requestRender) {
                    scene.requestRender();
                }
            }

            if (cesiumModelsVerbose()) console.log(`🎨 ✓ Created ${entities.length} area texture entity(ies)`);
            return entities.length === 1 ? entities[0] : entities;
        } catch (error) {
            console.error('🎨 Error creating area texture entity:', error);
            console.error('🎨 Stack:', error.stack);
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
                    if (cesiumModelsVerbose()) console.log(`🎨 Added ${addedCount} stored entities`);
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
    calculateTextureRotation(polygonCoordinates, textureName, tagsObj = {}) {
        if (cesiumModelsVerbose()) console.log(`🎨 calculateTextureRotation: ${textureName}`);

        // Special case: disabled parking spaces should not be rotated to maintain proper orientation
        if (tagsObj && tagsObj['parking_space'] === 'disabled') {
            if (cesiumModelsVerbose()) console.log(`🎨 disabled parking space: no rotation`);
            return 0;
        }

        const isCrossingTexture = textureName.toLowerCase().includes('i_crossing.png') ||
                                textureName.toLowerCase().includes('crossing') ||
                                textureName.toLowerCase().includes('panot');

        if (cesiumModelsVerbose()) console.log(`🎨 crossing-like texture: ${isCrossingTexture}`);

        try {
            const layers = this.getAllMapLayers(window.map.getLayers().getArray());
            const nearbyWays = [];

            if (cesiumModelsVerbose()) console.log(`🎨 scan ${layers.length} layers`);

            layers.forEach((layer, layerIndex) => {
                if (layer.getSource && typeof layer.getSource === 'function') {
                    const source = layer.getSource();
                    if (source && source.getFeatures) {
                        const features = source.getFeatures();
                        if (cesiumModelsVerbose()) console.log(`🎨 layer ${layerIndex}: ${features.length} feats`);

                        features.forEach((feature, featureIndex) => {
                            const geometry = feature.getGeometry();
                            if (geometry && (geometry.getType() === 'LineString' || geometry.getType() === 'MultiLineString')) {
                                if (this.wayIntersectsOrAdjacentToPolygon(geometry, polygonCoordinates)) {
                                    nearbyWays.push(feature);
                                    if (cesiumModelsVerbose()) console.log(`🎨 nearby way L${layerIndex} F${featureIndex}`);
                                }
                            }
                        });
                    }
                }
            });

            if (cesiumModelsVerbose()) console.log(`🎨 nearby ways: ${nearbyWays.length}`);

            const isParkingTexture = textureName.toLowerCase().includes('i_parking');
            let sourceWays = nearbyWays;
            if (isParkingTexture) {
                const kerbWays = nearbyWays.filter(f => f.get && f.get('barrier') === 'kerb');
                if (kerbWays.length > 0) {
                    if (cesiumModelsVerbose()) console.log(`🎨 parking: ${kerbWays.length} kerb way(s)`);
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
                    if (cesiumModelsVerbose()) console.log(`🎨 fallback d=${closestFallbackSegment.distance.toFixed(2)}m`);
                    return -closestFallbackSegment.bearing;
                }
                if (cesiumModelsVerbose()) console.log(`🎨 no ways → 0`);
                return 0;
            }

            let bestSegment = null;
            sourceWays.forEach((feature, index) => {
                const geometry = feature.getGeometry();
                const coords = geometry.getType() === 'LineString' ?
                    geometry.getCoordinates() :
                    geometry.getCoordinates().flat();

                if (cesiumModelsVerbose()) console.log(`🎨 way ${index}: ${coords.length} coords`);

                const lonLatCoords = coords.map(coord =>
                    ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326')
                );

                if (cesiumModelsVerbose()) console.log(`🎨 way ${index} sample`, lonLatCoords.slice(0, 2));

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
                if (cesiumModelsVerbose()) console.log(`🎨 no segment → 0`);
                return 0;
            }

            if (cesiumModelsVerbose()) {
                console.log(`🎨 best seg way ${bestSegment.wayIndex} d=${bestSegment.distance.toFixed(2)}m °=${(bestSegment.bearing * 180 / Math.PI).toFixed(1)}`);
            }

            // For textures, we want the texture to flow in the direction of the way
            // So we rotate the texture to align with the way's bearing
            // Cesium texture rotation: positive values rotate clockwise
            return -bestSegment.bearing;

        } catch (error) {
            console.error(`🎨 Error calculating texture rotation:`, error);
            return 0;
        }
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
                // Also accept segments that are parallel/adjacent to polygon limits.
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

        if (o1 !== o2 && o3 !== o4) return true;
        if (o1 === 0 && onSegment(a, c, b)) return true;
        if (o2 === 0 && onSegment(a, d, b)) return true;
        if (o3 === 0 && onSegment(c, a, d)) return true;
        if (o4 === 0 && onSegment(c, b, d)) return true;

        return false;
    }

    /**
     * Check whether a line segment is adjacent to any polygon edge within threshold meters.
     */
    lineAdjacentToPolygon(lineSegment, polygonCoords, thresholdMeters = 10) {
        const [a, b] = lineSegment;

        for (let i = 0; i < polygonCoords.length; i++) {
            const j = (i + 1) % polygonCoords.length;
            const c = polygonCoords[i];
            const d = polygonCoords[j];

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
    }

    /**
     * Distance from point P to segment AB in meters.
     */
    pointToSegmentDistanceMeters(point, segStart, segEnd) {
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
    }

    /**
     * Minimum distance from line segment to polygon edges in meters.
     */
    lineSegmentDistanceToPolygonMeters(lineSegment, polygonCoords) {
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
    }

    /**
     * Find closest line segment from any way to the target polygon.
     */
    findClosestWaySegmentToPolygon(layers, polygonCoordinates, maxDistanceMeters = 40, preferredTag = null) {
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
    }

    /**
     * Flatten map layers recursively to include layers inside groups.
     */
    getAllMapLayers(layers) {
        const result = [];
        (layers || []).forEach((layer) => {
            if (layer && layer.getLayers && typeof layer.getLayers === 'function') {
                result.push(...this.getAllMapLayers(layer.getLayers().getArray()));
            } else {
                result.push(layer);
            }
        });
        return result;
    }

    /**
     * Bearing for one segment [start -> end].
     */
    calculateSegmentBearing(start, end) {
        if (!start || !end) return null;
        if (start[0] === end[0] && start[1] === end[1]) return null;

        const dLon = (end[0] - start[0]) * Math.PI / 180;
        const lat1 = start[1] * Math.PI / 180;
        const lat2 = end[1] * Math.PI / 180;
        const y = Math.sin(dLon) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
        const bearing = Math.atan2(y, x);
        return (bearing + 2 * Math.PI) % (2 * Math.PI);
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
            if (cesiumModelsVerbose()) console.log('🎨 Cleared area texture entities');
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
