// Area Repetition - Handles filling areas with repeated 3D models
// Similar to line repetitions but fills polygon areas with model instances

/**
 * Area repetition configuration module
 * Defines how different area types should be filled with models
 */

// Debug configuration
const areaRepetitionDebugConfig = {
    enabled: false,
    logConfigMatching: false,
    logGeneration: false,
    logCoordinates: false
};

// Area model and texture configurations. Any setting can read a tag, e.g.
// config.scale: { tag: 'height', default: 1 } or spacing: { tag: 'spacing', default: 1 }.
// Keep each area tag's asset and repeat settings together here.
// Texture configs can set textureRepeatCount to fit that many tiles on each polygon axis.
//Implemented tag-driven configuration across all three modules. Use { tag, default } anywhere in a mapping or repetition setting; for example, height can drive scale:
	//config: {
    //scale: { tag: 'height', type: 'number', default: 1 },
   // heightOffset: { tag: 'min_height', type: 'number', default: 0 }}
	//The same syntax works for repetition settings, such as interval, spacing, and maxModels. Numeric tag values are converted to numbers; default is used if a tag is missing or invalid. Optional types include number, string, boolean, and json.
const areaRepetitionConfigs = [
    {
        tags: ['natural=wood'],
        model: 'test.gltf',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 1.0,
        maxModels: 5000,
        description: 'Wooded areas'
    },
    // Building areas
    /*{
        tags: ['building=residential'],
        model: 'w_highway_residential.glb',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 0.000015, // Very dense for buildings
        maxModels: 5000,
        description: 'Residential building areas'
    },
    {
        tags: ['building'],
        model: 'w_highway_residential.glb',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 0.000015, // Very dense for buildings
        maxModels: 5000,
        description: 'Generic building areas'
    },

    // Highway areas
    {
        tags: ['highway=footway'],
        model: 'w_highway_footway.glb',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 1.0, // 1 meter spacing for footways
        maxModels: 5000,
        description: 'Footway areas'
    },
   
    {
        tags: ['highway=residential'],
        model: 'w_highway_residential.glb',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 1.0, // 5 meter spacing for residential streets
        maxModels: 10000,
        description: 'Residential street areas'
    },*/
    {
        tags: ['area:barrier=kerb'],
        model: 'i_kerb.jpg',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 1.0, // 1 meter spacing for area-tagged footways
        maxModels: 5000,
        description: 'Area-tagged kerb areas'
     },
    {
        tags: ['area:highway=cycleway'],
        model: 'i_area_highway_cycleway.jpg',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 1.0, // 1 meter spacing for area-tagged footways
        maxModels: 5000,
        description: 'Area-tagged footway areas with crossing'
    },
    {
        tags: ['area:highway=footway', 'footway=crossing'],
        model: 'i_crossing.png',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        // Rotate the stripe axis perpendicular to the footway's travel direction.
        textureRotationOffsetDegrees: 90,
        spacing: 1.0, // 1 meter spacing for area-tagged footways
        maxModels: 5000,
        description: 'Area-tagged footway areas with crossing'
        },
    {
        tags: ['area:highway=footway', 'footway=sidewalk'],
        model: 'i_llamborda.jpg',
        config: { scale: 0.5, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 1.0, // 1 meter spacing for area-tagged footways
        maxModels: 5000,
        description: 'Area-tagged footway areas'
    },
    {
        tags: ['area:highway=footway'],
        model: 'i_llamborda.jpg',
        config: { scale: 0.5, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 1.0, // 1 meter spacing for area-tagged footways
        maxModels: 5000,
        description: 'Area-tagged footway areas'
    },

    // Amenity areas
    {
        tags: ['amenity=motorcycle_parking'],
        model: 'i_motorcycle_parking.jpg',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        textureRotationOffsetDegrees: 90,
        spacing: 1, // 3 meter spacing for parking
        maxModels: 3000,
        description: 'Motorcycle parking areas'
     },

    // Amenity areas
    {
        tags: ['amenity=parking', 'orientation=diagonal'],
        model: 'i_parking_diagonal.jpg',
        config: { scale: 2.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        textureRotationOffsetDegrees: 45,
        spacing: 1, // 3 meter spacing for parking
        maxModels: 3000,
        description: 'Parking areas'
      },

    // Amenity areas
    {
        tags: ['amenity=parking', 'orientation=parallel'],
        model: 'i_parking.jpg',
		render_order: 2,
        config: { scale: 2.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        textureRotationOffsetDegrees: 90,
        spacing: 1, // 3 meter spacing for parking
        maxModels: 3000,
        description: 'Parking areas'
     },

    // Disabled parking spaces are tagged BOTH amenity=parking_space AND
    // parking_space=disabled in OSM. The config matcher returns the FIRST
    // matching entry top-to-bottom, so this more-specific entry MUST come
    // before the generic amenity=parking_space entry below — otherwise
    // disabled spaces match the generic entry (no textureRepeatCount) first
    // and get native-resolution tiling instead of exactly 10 tiles/axis.
    {
        tags: ['parking_space=disabled'],
        model: 'i_parking_space_disabled.jpg',
        config: { scale: 2.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        textureRotationOffsetDegrees: 180,
		textureRepeatCount: 1,
        spacing: 1,
        maxModels: 3000,
        description: 'Disabled parking spaces'
    },
    
    {
        tags: ['parking_space=delivery'],
        model: 'i_parking_space_delivery.jpg',
        config: { scale: 2.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        textureRotationOffsetDegrees: 90,
		spacing: 1,
        maxModels: 3000,
        description: 'Delivery parking spaces'
    },
    {
        tags: ['amenity=parking_space'],
        model: 'i_parking_space.jpg',
        config: { scale: 2.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        textureRotationOffsetDegrees: 90,
        spacing: 1, // 1 meter spacing for parking spaces
        maxModels: 3000,
        description: 'Regular parking spaces with smart rotation'
    },

    // Amenity areas
    {
        tags: ['amenity=parking'],
        model: 'i_parking.png',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        textureRotationOffsetDegrees: 90,
        spacing: 1, // 3 meter spacing for parking
        maxModels: 3000,
        description: 'Parking areas'
    },
       {
        tags: ['area:highway=motorway'],
        model: 'i_asfalt.jpg',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 1.0, // 5 meter spacing for area-tagged residential streets
        maxModels: 10000,
        description: 'Area-tagged residential street areas'
    },
       {
        tags: ['area:highway=motorway_link'],
        model: 'i_asfalt.jpg',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 1.0, // 5 meter spacing for area-tagged residential streets
        maxModels: 10000,
        description: 'Area-tagged residential street areas'
    },
       {
        tags: ['area:highway=residential'],
        model: 'i_asfalt.jpg',
		render_order: 1,
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 1.0, // 5 meter spacing for area-tagged residential streets
        maxModels: 10000,
        description: 'Area-tagged residential street areas'
    },
       {
        tags: ['area:highway=steps'],
        model: 'w_highway_steps.glb',
		textureRotationOffsetDegrees: 90,
		textureRepeatCount: 2,
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 1.0, // 5 meter spacing for area-tagged residential streets
        maxModels: 10000,
        description: 'Area-tagged steps areas'
    },
       {
           tags: ['area:highway=*'],
           model: 'i_asfalt.jpg',
           config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
           spacing: 1.0,
           maxModels: 10000,
           description: 'Other area-tagged highways'
    },
       {
        tags: ['highway=elevator'],
        model: 'w_highway_elevator.glb',
		textureRotationOffsetDegrees: 0,
		textureRepeatCount: 1,
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 1.0, // 5 meter spacing for area-tagged residential streets
        maxModels: 10000,
        description: ''
    },
    {
        tags: ['highway=footway'],
        model: 'w_highway_footway.glb',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 1.0,
        maxModels: 5000,
        description: 'Footway areas'
    },
    {
        tags: ['highway=residential'],
        model: 'w_highway_residential.glb',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 1.0,
        maxModels: 10000,
        description: 'Residential road areas'
    },
    {
        tags: ['highway=motorway'],
        model: 'w_highway_residential.glb',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 1.0,
        maxModels: 10000,
        description: 'Motorway areas'
    },
    {
        tags: ['highway=motorway_link'],
        model: 'w_highway_residential.glb',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 1.0,
        maxModels: 10000,
        description: 'Motorway link areas'
    },

    // Amenity areas
    {
        tags: ['leisure=garden'],
        model: 'i_gespa.jpg',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 1, // 2 meter spacing for gardens
        maxModels: 10000,
        description: 'Garden'
     },

    // Amenity areas
    {
        tags: ['manhole=drain'],
        model: 'i_manhole_drain.jpg',
		textureRotationOffsetDegrees: 90,
        config: { scale: 0.1, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 0.5, // Small spacing for precise coverage
        maxModels: 10000, // Only need one instance for small manholes
        description: 'Manhole drain - exact polygon coverage'
    },

    // Amenity areas
    {
        tags: ['natural=grassland'],
        model: 'i_gespa.jpg',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 1, // 2 meter spacing for gardens
        maxModels: 10000,
        description: 'Garden'
      },

    // Amenity areas
    {
        tags: ['amenity=parking', 'orientation=parallel'],
        model: 'i_parking.jpg',
		render_order: 2,
        config: { scale: 2.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        textureRotationOffsetDegrees: 90,
        spacing: 1, // 3 meter spacing for parking
        maxModels: 3000,
        description: 'Parking areas'
      },

    // Amenity areas
    {
        tags: ['road_marking=restriction'],
        model: 'i_road_marking_restriction.jpg',
		render_order: 2,
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        textureRotationOffsetDegrees: 90,
        // Fit this many complete texture tiles across each polygon dimension.
        textureRepeatCount: 1,
        spacing: 2, // 3 meter spacing for parking
        maxModels: 3000,
        description: 'Parking areas'
     },
    {
        tags: ['road_restriction=*'],
        model: 'i_road_marking_restriction.jpg',
        config: { scale: 2.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        textureRotationOffsetDegrees: 90,
        textureRepeatCount: 1,
        spacing: 2,
        maxModels: 3000,
        description: 'Road restriction areas'
    },

    {
        tags: ['waterway=stream'],
        model: 'i_aigua.jpg',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 5.0,
        maxModels: 1,
        description: 'Stream areas'
    },

    // Amenity areas
    {
        tags: ['leisure=playground'],
        model: 'i_terra_verd.jpg',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 1, // 2 meter spacing for playgrounds
        maxModels: 10000,
        description: 'Playground'
    },

    // Amenity areas
    {
        tags: ['railway=platform'],
        model: 'w_public_transport_platform.glb',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 1.0,
        maxModels: 3000,
        description: 'Railway platform model'
    },
    {
        tags: ['public_transport=platform'],
        model: 'i_railway_platform.jpg',
        config: { scale: 0.5, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 1.0, // 1 meter spacing for area-tagged footways
        maxModels: 5000,
        description: 'Area-tagged footway areas'
     },

    // Default fallback
    {
        tags: ['*'], // Match any area
        model: 'i_gespa.jpg',
        config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] },
        spacing: 5.0, // 5 meter spacing default
        maxModels: 1,
        description: 'Default area filling'
    }
];

/**
 * Get area repetition configuration for given tags
 * @param {object} tags - OSM tags object
 * @returns {object|null} Configuration object or null if no match
 */
function getAreaRepetitionConfig(tags) {
    if (areaRepetitionDebugConfig.enabled && areaRepetitionDebugConfig.logConfigMatching) console.log(`🏞️ Checking area repetition configs for tags:`, tags);

    for (const config of areaRepetitionConfigs) {
        // Skip wildcard/default config for now
        if (config.tags[0] === '*') {
            continue;
        }

        // Check if all required tags match
        const allMatch = config.tags.every(tag => {
            const [key, value] = tag.split('=');
            let tagValue = tags[key];
            
            // BUG FIX: Handle Overpass returned areas which have area=yes + original tags (without area: prefix)
            // If config uses area: prefix tag, also check the original unprefixed tag when feature has area=yes
            if (tagValue === undefined && key.startsWith('area:') && tags['area'] === 'yes') {
                const originalKey = key.substring(5); // remove 'area:' prefix
                tagValue = tags[originalKey];
            }
            
            const matches = value === '*'
                ? tagValue !== undefined
                : tagValue === value;
            if (areaRepetitionDebugConfig.enabled && areaRepetitionDebugConfig.logConfigMatching) console.log(`🏞️ Checking area config tag ${key}=${value}, found: ${tagValue}, matches: ${matches}`);
            return matches;
        });

        if (allMatch) {
            if (areaRepetitionDebugConfig.enabled) console.log(`🏞️ Found matching area repetition config:`, config.description);
            return resolveConfigForTags(config, tags);
        }
    }

    if (areaRepetitionDebugConfig.enabled) console.log(`🏞️ No specific area repetition config found, will use default`);
    return null;
}

function resolveConfigForTags(config, tags) {
    return window.models && typeof window.models.resolveConfig === 'function'
        ? window.models.resolveConfig(config, tags)
        : config;
}

function getAreaRenderOrder(tags, config) {
    const manager = window.areaTextureManager;
    return manager && typeof manager.getRenderOrder === 'function'
        ? manager.getRenderOrder(tags, config)
        : null;
}

function getModelForTags(tags, wayCoordinates = null, nodeIndex = null, orientationContext = null) {
    const areaConfig = getAreaRepetitionConfig(tags);
    if (!areaConfig) return null;

    const bearing = window.models && window.models.resolveBearing
        ? window.models.resolveBearing(tags, wayCoordinates, nodeIndex, orientationContext)
        : null;
    const config = window.models && window.models.adjustConfigForDirection
        ? window.models.adjustConfigForDirection(areaConfig.config, tags, bearing)
        : areaConfig.config;

    return {
        tags: areaConfig.tags,
        model: areaConfig.model,
        geometryType: 'area',
        config,
        repetitionConfig: areaConfig
    };
}

/**
 * Convert meters to degrees at a given latitude
 * @param {number} meters - Distance in meters
 * @param {number} latitude - Latitude in degrees
 * @returns {Array<number>} [lonDegrees, latDegrees]
 */
function metersToDegrees(meters, latitude) {
    const latDegrees = meters / 111320; // 1 degree latitude ≈ 111.32 km
    const lonDegrees = meters / (111320 * Math.cos(latitude * Math.PI / 180)); // Adjust for longitude
    return [lonDegrees, latDegrees];
}

/**
 * Generate area repetitions for filling a polygon with models
 * @param {Array<Array<number>>} coordinates - Array of [lon, lat] coordinates forming the polygon
 * @param {object} tags - OSM tags object
 * @returns {Array<Object>} Array of repetition objects with position OR single polygon object for textures
 */
function generateAreaRepetitions(coordinates, tags, holes = []) {
    if (areaRepetitionDebugConfig.enabled && areaRepetitionDebugConfig.logGeneration) console.log(`🏞️ generateAreaRepetitions called with coordinates: ${coordinates.length}, tags:`, tags);

    if (!coordinates || coordinates.length < 3) {
        if (areaRepetitionDebugConfig.enabled) console.log('🏞️ Not enough coordinates for area repetition');
        return [];
    }

    // Get configuration for this area type
    const config = getAreaRepetitionConfig(tags) || resolveConfigForTags(
        areaRepetitionConfigs.find(c => c.tags[0] === '*'),
        tags
    );
    const modelFilename = config.model;
    // Decide whether to use the single-polygon texture approach (drives the
    // WorldScaleImage GLSL shader) versus the classic grid-of-model-instances
    // approach. Image files always use the polygon texture path. A .glb/.gltf
    // uses the polygon-texture path ONLY when textureRepeatCount > 1 AND
    // textureRotationOffsetDegrees is set — that combination makes sense as a
    // scaled shader tile.  When textureRepeatCount === 1 for glb we keep the
    // grid-instancing path (spacing derives from bbox / count = one large
    // model covering the polygon); when no textureRepeatCount is set the model
    // instances are placed on a fixed-rotation-meter grid.
    const isImageFile = modelFilename && /\.jpe?g$/i.test(modelFilename) || /\.png$/i.test(modelFilename);
    const isGlbOrGltf = modelFilename && /\.(glb|gltf)$/i.test(modelFilename);
    const hasTextureRepeatOrRot = config.textureRepeatCount !== undefined ||
                                  config.textureRotationOffsetDegrees !== undefined;
    // NOTE: GLB/GLTF models ALWAYS use grid instancing — never the shader-tile path.
    // Shader tiles work only for image textures stretched over a single polygon.
    const needsPolygonTexture = isImageFile || tags['manhole'] === 'drain';

    // For image files OR manhole=drain, return single polygon object instead of grid points
    if (needsPolygonTexture || tags['manhole'] === 'drain') {
        if (areaRepetitionDebugConfig.enabled) console.log(`🏞️ Using single polygon texture approach for ${modelFilename}`);
        
        // Calculate texture rotation based on nearby ways
        // Coordinates are already in EPSG:4326 (transformed in applyAreaRepetitions)
        const polygonCoords = coordinates;
        const textureRotation = window.modelRenderer ? 
            window.modelRenderer.calculateTextureRotation(polygonCoords, modelFilename, tags) : 
            0; // No rotation if modelRenderer not available
        
        if (areaRepetitionDebugConfig.enabled && areaRepetitionDebugConfig.logGeneration) {
            console.log(`🏞️ Texture rotation: ${(textureRotation * 180 / Math.PI).toFixed(1)}° ${modelFilename}`);
        }
        
        return [{
            type: 'polygon_texture',
            polygonCoordinates: coordinates,
            polygonHoles: holes,
            model: tags['manhole'] === 'drain' ? 'i_manhole_drain.jpg' : modelFilename,
            spacing: config.spacing,
            rotation: textureRotation,
            textureRepeatCount: config.textureRepeatCount,
            textureRotationOffsetDegrees: Number.isFinite(config.textureRotationOffsetDegrees)
                ? config.textureRotationOffsetDegrees
                : 0,
            scale: config.config.scale,
            renderOrder: getAreaRenderOrder(tags, config)
        }];
    }

    // For 3D models, use the original grid-based approach
    const baseSpacingMeters = config.spacing;
    const maxModels = config.maxModels;
    // When textureRepeatCount is set, treat it as the target number of model
    // instances along each polygon axis and derive the grid spacing from the
    // bounding-box dimensions rather than using the raw config.spacing value.
    // This makes textureRepeatCount work for .glb/.gltf area repetitions just
    // like it does for image-texture areas.
    const textureRepeatCount = Number.isInteger(config.textureRepeatCount) && config.textureRepeatCount >= 1
        ? config.textureRepeatCount : null;

    if (areaRepetitionDebugConfig.enabled && areaRepetitionDebugConfig.logGeneration) {
        console.log(`🏞️ Using grid-based model approach: spacing=${baseSpacingMeters}m, maxModels=${maxModels}, model=${modelFilename}${textureRepeatCount !== null ? ', repeatCount=' + textureRepeatCount : ''}`);
    }

    // Calculate bounding box
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    coordinates.forEach(coord => {
        minLon = Math.min(minLon, coord[0]);
        maxLon = Math.max(maxLon, coord[0]);
        minLat = Math.min(minLat, coord[1]);
        maxLat = Math.max(maxLat, coord[1]);
    });

    if (areaRepetitionDebugConfig.enabled && areaRepetitionDebugConfig.logGeneration) {
        console.log(`🏞️ BBox lon [${minLon.toFixed(6)}, ${maxLon.toFixed(6)}] lat [${minLat.toFixed(6)}, ${maxLat.toFixed(6)}]`);
    }

    // Calculate center latitude for conversion
    const centerLat = (minLat + maxLat) / 2;

    const lonDegPerMeter = 1 / (111320 * Math.cos(centerLat * Math.PI / 180));
    const latDegPerMeter = 1 / 111320;
    const bboxWidthM  = (maxLon - minLon)  / lonDegPerMeter;
    const bboxHeightM = (maxLat - minLat)  / latDegPerMeter;

    // textureRepeatCount = N means: tile the area with N rows × N cols.
    //   N=1 → ONE model covering the ENTIRE bbox (largest possible).
    //   N>1 → NxN grid of smaller models spaced evenly across the bbox.
    let nx, ny;
    if (textureRepeatCount !== null) {
        nx = Math.max(1, Math.round(textureRepeatCount));
        ny = Math.max(1, Math.round(textureRepeatCount));
    } else {
        // No repeatCount specified: use baseSpacingMeters to derive a natural grid
        const spacingXmeters = baseSpacingMeters || 1.0;
        const spacingYmeters = baseSpacingMeters || 1.0;
        const dxDeg = spacingXmeters * lonDegPerMeter;
        const dyDeg = spacingYmeters * latDegPerMeter;
        nx = Math.max(1, Math.ceil((maxLon - minLon) / dxDeg) + 1);
        ny = Math.max(1, Math.ceil((maxLat - minLat) / dyDeg) + 1);
    }

    const spacingLonDeg = (maxLon - minLon) / nx;
    const spacingLatDeg = (maxLat - minLat) / ny;

    // Size of one grid cell in meters
    const cellWidthMeters  = bboxWidthM  / nx;
    const cellHeightMeters = bboxHeightM / ny;

    // Auto-scale: make each model fill its assigned cell based on real GLB dimensions
    let modelScale = config.config.scale;
    const maxDim = (window.models && typeof window.models.getModelMaxDimension === 'function')
        ? window.models.getModelMaxDimension(modelFilename) : null;
    if (maxDim && maxDim > 0) {
        // Scale so the model's largest dimension fills the larger cell dimension
        const cellSpan = Math.max(cellWidthMeters, cellHeightMeters);
        modelScale = (config.config.scale || 1) * (cellSpan / maxDim);
    }

    // Compute polygon bearing so instances align with the way
    let effectiveBearing = 0;
    {
        const authoredYRot = Array.isArray(config.config.rotation) ? (config.config.rotation[1] || 0) : 0;
        const calculated = window.modelRenderer && window.modelRenderer.calculateTextureRotation
            ? window.modelRenderer.calculateTextureRotation(coordinates, modelFilename, tags)
            : 0;
        const textureOffset = (config.textureRotationOffsetDegrees || 0) * Math.PI / 180;
        effectiveBearing = (calculated || 0) + authoredYRot + textureOffset;
    }

    // Generate grid points at CELL CENTERS so they land inside the polygon boundary
    const repetitions = [];
    let modelCount = 0;

    for (let ix = 0; ix < nx && modelCount < maxModels; ix++) {
        const lon = minLon + (ix + 0.5) * spacingLonDeg;
        for (let iy = 0; iy < ny && modelCount < maxModels; iy++) {
            const lat = minLat + (iy + 0.5) * spacingLatDeg;
            // Check if point is inside polygon
            const isInsideOuter = isPointInPolygon([lon, lat], coordinates);
            const isInsideHole = holes.some(hole => isPointInPolygon([lon, lat], hole));
            if (isInsideOuter && !isInsideHole) {
                repetitions.push({
                    type: 'model_instance',
                    position: [lon, lat, 0], // lon, lat, height
                    model: modelFilename,
                    scale: modelScale,
                    heightOffset: config.config.heightOffset,
                    rotation: [0, effectiveBearing, 0]
                });
                modelCount++;
            }
        }
    }

    if (areaRepetitionDebugConfig.enabled && areaRepetitionDebugConfig.logGeneration) {
        console.log(`🏞️ Generated ${repetitions.length} repetitions (${modelCount} checked)`);
    }
    return repetitions;
}

/**
 * Check if a point is inside a polygon using ray casting algorithm
 * @param {Array<number>} point - [lon, lat] point to test
 * @param {Array<Array<number>>} polygon - Array of [lon, lat] polygon vertices
 * @returns {boolean} True if point is inside polygon
 */
function isPointInPolygon(point, polygon) {
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
 * Apply area repetitions to a feature
 * @param {ol.Feature} feature - Original area feature
 * @param {string} modelFilename - Model filename to use
 * @param {Object} modelConfig - Model configuration
 * @param {object} tags - OSM tags object
 */
function applyAreaRepetitions(feature, modelFilename, modelConfig, tags) {
    if (areaRepetitionDebugConfig.enabled) console.log(`🏞️ applyAreaRepetitions called for tags:`, tags, `model: ${modelFilename}`);

    try {
        const geometry = feature.getGeometry();
        let geometryType = geometry.getType();
        let polygons = [];

        if (geometryType === 'Polygon') {
            // Keep the full polygon rings: first is outer, remaining are holes
            polygons = [geometry.getCoordinates()];
        } else if (geometryType === 'MultiPolygon') {
            // Keep all rings for each polygon in the multipolygon
            polygons = geometry.getCoordinates();
        } else if (geometryType === 'LineString') {
            // Check if it's a closed LineString (represents an area) using centralized function
            const isClosed = window.models && window.models.isLineStringClosed ? 
                             window.models.isLineStringClosed(geometry) : false;

            if (isClosed) {
                const lineCoords = geometry.getCoordinates();
                polygons = [[lineCoords.slice(0, -1)]]; // Single polygon with only outer ring
                geometryType = 'Polygon'; // Treat as polygon for processing
                if (areaRepetitionDebugConfig.enabled) console.log('Closed LineString detected, treating as polygon for area repetition');
            } else {
                if (areaRepetitionDebugConfig.enabled) console.log('LineString not closed, skipping area repetition');
                return;
            }
        } else {
            if (areaRepetitionDebugConfig.enabled) console.log(`Geometry type ${geometryType} not supported for area repetition`);
            return;
        }

        if (areaRepetitionDebugConfig.enabled && areaRepetitionDebugConfig.logGeneration) console.log(`🏞️ Processing ${geometryType} with ${polygons.length} polygon(s)`);

        let allRepetitions = [];
        polygons.forEach((polygonRings, polyIndex) => {
            if (!Array.isArray(polygonRings) || polygonRings.length === 0) {
                return;
            }

            const outerRing4326 = polygonRings[0].map(coord =>
                ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326')
            );
            const holes4326 = polygonRings.slice(1).map(holeRing =>
                holeRing.map(coord =>
                    ol.proj.transform(coord, window.map.getView().getProjection(), 'EPSG:4326')
                )
            );

            if (areaRepetitionDebugConfig.enabled && areaRepetitionDebugConfig.logCoordinates) {
                console.log(`🏞️ Polygon ${polyIndex + 1}: ring ${outerRing4326.length} pts, ${holes4326.length} hole(s)`);
            }

            const repetitions = generateAreaRepetitions(outerRing4326, tags, holes4326);
            allRepetitions = allRepetitions.concat(repetitions);
        });

        // Store repetition data on original feature
        if (allRepetitions.length > 0) {
            if (areaRepetitionDebugConfig.enabled) console.log(`🏞️ Storing ${allRepetitions.length} area repetition configurations on original feature`);

            allRepetitions.forEach((rep, index) => {
                const repetitionKey = `repetition_${index}`;

                if (rep.type === 'polygon_texture') {
                    // Store polygon texture data with rotation
                    const repModelOptions = {
                        uri: `/3dmodelsosm/src/models/${rep.model}`,
                        scale: rep.scale === undefined ? 1.0 : rep.scale,
                        type: 'polygon_texture',
                        polygonCoordinates: rep.polygonCoordinates,
                        spacing: rep.spacing,
                        textureRepeatCount: rep.textureRepeatCount,
                        rotation: rep.rotation || 0,
                        textureRotationOffsetDegrees: rep.textureRotationOffsetDegrees,
                        renderOrder: rep.renderOrder
                    };

                    feature.set(repetitionKey, repModelOptions);
                    feature.set(`${repetitionKey}_type`, 'polygon_texture');
                    feature.set(`${repetitionKey}_polygonCoordinates`, rep.polygonCoordinates);
                    feature.set(`${repetitionKey}_polygonHoles`, rep.polygonHoles || []);
                    feature.set(`${repetitionKey}_spacing`, rep.spacing);
                    feature.set(`${repetitionKey}_rotation`, rep.rotation || 0);

                    if (areaRepetitionDebugConfig.enabled) console.log(`🏞️ Stored polygon texture repetition ${index + 1} for model: ${rep.model} with rotation: ${((rep.rotation || 0) * 180 / Math.PI).toFixed(1)}°`);
                } else {
                    // Original model instance approach
                    const repModelOptions = {
                        uri: `/3dmodelsosm/src/models/${rep.model}`, // Use model from repetition config
                        scale: rep.scale === undefined ? 1.0 : rep.scale,
                        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                        position: rep.position,
                        textureRotationOffsetDegrees: rep.textureRotationOffsetDegrees,
                        textureRepeatCount: rep.textureRepeatCount
                    };

                    feature.set(repetitionKey, repModelOptions);
                    feature.set(`${repetitionKey}_position`, rep.position);
                    feature.set(`${repetitionKey}_heightOffset`,
                        rep.heightOffset === undefined ? 0 : rep.heightOffset);
                    feature.set(`${repetitionKey}_rotation`,
                        rep.rotation || [0, 0, 0]);
                    feature.set(`${repetitionKey}_textureRotationOffsetDegrees`,
                        rep.textureRotationOffsetDegrees !== undefined ? rep.textureRotationOffsetDegrees : 0);

                    if (areaRepetitionDebugConfig.enabled) console.log(`🏞️ Stored model instance repetition ${index + 1} configuration at [${rep.position[0].toFixed(6)}, ${rep.position[1].toFixed(6)}] with model: ${rep.model}`);
                }
            });

            if (areaRepetitionDebugConfig.enabled) console.log(`🏞️ Successfully stored ${allRepetitions.length} area repetition configurations`);
        } else {
            if (areaRepetitionDebugConfig.enabled) console.log(`🏞️ No area repetitions to store`);
        }
    } catch (error) {
        throw error; // Re-throw to let caller handle it
    }
}

// Export functions for global access
window.areaRepetition = {
    applyAreaRepetitions: applyAreaRepetitions,
    generateAreaRepetitions: generateAreaRepetitions,
    isPointInPolygon: isPointInPolygon,
    getAreaRepetitionConfig: getAreaRepetitionConfig,
    getModelForTags: getModelForTags,
    areaRepetitionConfigs
};
