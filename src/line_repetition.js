/**
 * Repeats mapped models along line features.
 *
 * Edit lineRepetitionConfig below to tune spacing, offset and per-feature
 * model limits. Tag-specific values override their tag family's defaults.
 */
(function () {
    const lineRepetitionDebugConfig = {
        enabled: false,
        logProcessing: false,
        logStorage: false
    };
    const globalDebugConfig = window.globalDebugConfig;
    if (globalDebugConfig && globalDebugConfig.lineRepetition) {
        lineRepetitionDebugConfig.enabled = !!globalDebugConfig.lineRepetition.enabled;
        lineRepetitionDebugConfig.logProcessing = !!globalDebugConfig.lineRepetition.logProcessing;
        lineRepetitionDebugConfig.logStorage = !!globalDebugConfig.lineRepetition.logStorage;
    }

    // Image assets use the same repeated-texture renderer as areas. Configure
    // their strip width per mapping with config.textureWidthMeters.
	//Implemented tag-driven configuration across all three modules. Use { tag, default } anywhere in a mapping or repetition setting; for example, height can drive scale:
	//config: {
    //scale: { tag: 'height', type: 'number', default: 1 },
   // heightOffset: { tag: 'min_height', type: 'number', default: 0 }}
	//The same syntax works for repetition settings, such as interval, spacing, and maxModels. Numeric tag values are converted to numbers; default is used if a tag is missing or invalid. Optional types include number, string, boolean, and json.

	
	
    const lineModelMappings = [
        { tags: ['barrier=kerb'], model: 'w_barrier_kerb.gltf', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
        { tags: ['road_markings=edge_line', 'stroke=solid'], model: 'w_stroke_solid.glb', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
        { tags: ['road_markings=lane_divider', 'stroke=dashed'], model: 'w_stroke_dashed.glb', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
        { tags: ['barrier=fence', 'fence_type=railing'], model: 'w_barrier_fence_type_railing.glb', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
        { tags: ['barrier=fence', 'fence_type=wood'], model: 'w_barrier_fence_wood.gltf', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
        { tags: ['barrier=fence', 'fence_type=metal'], model: 'w_barrier_fence_wood.gltf', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
        { tags: ['barrier=fence', 'fence_type=chain_link'], model: 'w_barrier_fence_wood.gltf', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
        { tags: ['barrier=fence', 'fence_type=wire'], model: 'w_barrier_fence_wood.gltf', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
        { tags: ['barrier=fence', 'fence_type=pole'], model: 'w_barrier_fence_wood.gltf', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
        { tags: ['barrier=fence'], model: 'w_barrier_fence_wood.gltf', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
        { tags: ['fence_type=wood'], model: 'w_barrier_fence_wood.gltf', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
        { tags: ['fence_type=metal'], model: 'w_barrier_fence_wood.gltf', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
        { tags: ['fence_type=chain_link'], model: 'w_barrier_fence_wood.gltf', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
        { tags: ['fence_type=wire'], model: 'w_barrier_fence_wood.gltf', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
        { tags: ['fence_type=pole'], model: 'w_barrier_fence_wood.gltf', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
        { tags: ['barrier=wall'], model: 'w_barrier_wall.glb', config: { scale: { tag: 'height', type: 'number', default: 1 }, heightOffset: 0.0, rotation: [0, 0, 0] } },
		{ tags: ['barrier=retaining_wall'], model: 'w_barrier_wall.glb', config: { scale: { tag: 'height', type: 'number', default: 1 }, heightOffset: 0.0, rotation: [0, 0, 0] } },
        { tags: ['highway=cycleway'], model: 'w_highway_cycleway.glb', config: { scale: 4.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
        { tags: ['highway=footway'], model: 'w_highway_footway.glb', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, -Math.PI / 4, 0] } },
        { tags: ['footway=sidewalk'], model: 'w_highway_footway.glb', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, -Math.PI / 4, 0] } },
        { tags: ['highway=residential'], model: 'w_highway_residential.gltf', config: { scale: 3.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
        { tags: ['highway=motorway'], model: 'w_highway_residential.gltf', config: { scale: 6.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
        { tags: ['highway=motorway_link'], model: 'w_highway_residential.gltf', config: { scale: 6.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
        { tags: ['highway=path'], model: 'w_highway_track.gltf', config: { scale: 2.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
        { tags: ['highway=track'], model: 'w_highway_track.gltf', config: { scale: 6.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
        { tags: ['natural=beach'], model: 'w_natural_beach.gltf', config: { scale: 12.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
        { tags: ['natural=coastline'], model: 'w_natural_beach.gltf', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
        { tags: ['railway=rail'], model: 'w_railway_rail.glb', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
        { tags: ['public_transport=platform'], model: 'w_public_transport_platform.glb', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
        { tags: ['barrier=guard_rail', 'bridge=yes'], model: 'w_barrier_guard_rail_bridge.glb', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
        { tags: ['barrier=guard_rail'], model: 'w_barrier_guard_rail.glb', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
        { tags: ['waterway=drain'], model: 'w_waterway_drain_intermittent.glb', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
		{ tags: ['waterway=stream'], model: 'w_waterway_stream.gltf', config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } }
    ];

    // Any setting can read a tag value, e.g. scale: { tag: 'height', default: 1 }.
    // Add a tag group here to configure new line types; its keys are detected automatically.
    const lineRepetitionConfig = {
        default: { interval: 0.5, sideOffset: 0, maxModels: 500 },
        highway: {
            default: { interval: 0.30, sideOffset: 0, maxModels: 100 },
            residential: { interval: 0.50, sideOffset: 0, maxModels: 1500 },
            footway: { interval: 0.30, sideOffset: 0, maxModels: 1000 },
            service: { interval: 0.50, sideOffset: 0, maxModels: 800 },
            motorway: { interval: 0.20, sideOffset: 0, maxModels: 3000 },
            motorway_link: { interval: 0.20, sideOffset: 0, maxModels: 3000 },
            primary: { interval: 0.20, sideOffset: 0, maxModels: 1500 },
            secondary: { interval: 0.25, sideOffset: 0, maxModels: 1200 },
            tertiary: { interval: 0.25, sideOffset: 0, maxModels: 1200 },
            track: { interval: 0.25, sideOffset: 0, maxModels: 1500 },
            path: { interval: 0.35, sideOffset: 0, maxModels: 1500 },
            cycleway: { interval: 0.25, sideOffset: 0, maxModels: 1500 },
            pedestrian: { interval: 0.20, sideOffset: 0, maxModels: 150 }
        },
        public_transport: {
            default: { interval: 5, sideOffset: 0, maxModels: 350, rotationOffset: 0 },
            platform: { interval: 0.30, sideOffset: 0, maxModels: 1000 },
            funicular: { interval: 8, sideOffset: 0, maxModels: 150, rotationOffset: 0 }
         },
        railway: {
            default: { interval: 5, sideOffset: 0, maxModels: 350, rotationOffset: 0 },
            rail: { interval: 4, sideOffset: 0, maxModels: 400, rotationOffset: 0 },
            light_rail: { interval: 4, sideOffset: 0, maxModels: 400, rotationOffset: 0 },
            tram: { interval: 4, sideOffset: 0, maxModels: 400, rotationOffset: 0 },
            narrow_gauge: { interval: 4, sideOffset: 0, maxModels: 400, rotationOffset: 0 },
            subway: { interval: 6, sideOffset: 0, maxModels: 300, rotationOffset: 0 },
            monorail: { interval: 6, sideOffset: 0, maxModels: 300, rotationOffset: 0 },
            preserved: { interval: 8, sideOffset: 0, maxModels: 200, rotationOffset: 0 },
            funicular: { interval: 8, sideOffset: 0, maxModels: 150, rotationOffset: 0 }
         },
        stroke: {
            default: { interval: 0.30, sideOffset: 0, maxModels: 350, rotationOffset: 0 },
			solid: { interval: 1.5, sideOffset: 0, maxModels: 10000, rotationOffset: 0 },
            dashed: { interval: 2, sideOffset: 0, maxModels: 10000, rotationOffset: 0 }

        },
        waterway: {
            default: { interval: 0.30, sideOffset: 0, maxModels: 350, rotationOffset: 0 },
            drain: { interval: 0.30, sideOffset: 0, maxModels: 3350, rotationOffset: 0 },
            stream: { interval: 0.30, sideOffset: 0, maxModels: 350, rotationOffset: 0 }

        },
        natural: {
            default: { interval: 0.50, sideOffset: 0, maxModels: 100 },
            beach: { interval: 0.40, sideOffset: 0, maxModels: 1500 },
            water: { interval: 0.30, sideOffset: 0, maxModels: 200 },
            river: { interval: 0.25, sideOffset: 0, maxModels: 300 },
            stream: { interval: 0.20, sideOffset: 0, maxModels: 150 },
            canal: { interval: 0.35, sideOffset: 0, maxModels: 2000 },
            coastline: { interval: 0.45, sideOffset: 0, maxModels: 1250 },
            cliff: { interval: 0.60, sideOffset: 0, maxModels: 100 }
        },
        barrier: {
            default: { interval: 0.5, sideOffset: 0, maxModels: 500 },
            fence: {
                interval: 0.2, sideOffset: 0, maxModels: 5000, postHeight: 1.0,
                postWidth: 0.1, heightOffset: 0
            },
			guard_rail: {
                interval: 3, sideOffset: 0, maxModels: 5000, postHeight: 1.0,
                postWidth: 0.1, heightOffset: 0
            },
			kerb: {
                interval: 0.1, sideOffset: 0, maxModels: 5000, postHeight: 1.0,
                postWidth: 0.1, heightOffset: 0
            },
            wall: {
                interval: 1, sideOffset: 0, maxModels: 5000, postHeight: 1.0,
                postWidth: 0.1, heightOffset: 0
            }
        },
        fence_type: {
            default: {
                interval: 0.2, sideOffset: 0, maxModels: 5000, postHeight: 1.0,
                postWidth: 0.1, heightOffset: 0
            },
            wood: {
                interval: 0.15, sideOffset: 0, maxModels: 5000, postHeight: 1.0,
                postWidth: 0.15, heightOffset: 0,
                description: 'Wooden fence posts'
            },
            metal: {
                interval: 0.25, sideOffset: 0, maxModels: 800, postHeight: 1.8,
                postWidth: 0.08, description: 'Metal fence posts'
            },
            chain_link: {
                interval: 0.3, sideOffset: 0, maxModels: 300, postHeight: 2.0,
                postWidth: 0.05, description: 'Chain link fence posts'
            },
            pole: {
                interval: 0.5, sideOffset: 0, maxModels: 400, postHeight: 2.2,
                postWidth: 0.12, description: 'Pole fence posts'
            },
            wire: {
                interval: 5.0, sideOffset: 0, maxModels: 200, postHeight: 1.2,
                postWidth: 0.03, description: 'Wire fence posts'
            }
        },
        wall: {
            default: {
                interval: 0.2, sideOffset: 0, maxModels: 5000, postHeight: 1.0,
                postWidth: 0.1, heightOffset: 0
            },
            brick: {
                interval: 0.15, sideOffset: 0, maxModels: 5000, postHeight: 1.0,
                postWidth: 0.15, heightOffset: 0,
                description: 'Brick wall posts'
            },
            dry_stone: {
                interval: 0.25, sideOffset: 0, maxModels: 800, postHeight: 1.8,
                postWidth: 0.08, description: 'Dry stone wall posts'
            },
            noise_barrier: {
                interval: 0.3, sideOffset: 0, maxModels: 300, postHeight: 2.0,
                postWidth: 0.05, description: 'Noise barrier posts'
            },
            stone: {
                interval: 0.5, sideOffset: 0, maxModels: 400, postHeight: 2.2,
                postWidth: 0.12, description: 'Stone wall posts'
            },
            concrete_block: {
                interval: 0.5, sideOffset: 0, maxModels: 400, postHeight: 2.2,
                postWidth: 0.12, description: 'Concrete block wall posts'
            },
            concrete: {
                interval: 5.0, sideOffset: 0, maxModels: 200, postHeight: 1.2,
                postWidth: 0.03, description: 'Concrete wall posts'
            }
        }
    };

    lineRepetitionConfig.wall_type = lineRepetitionConfig.wall;
    const tagPriority = ['fence_type', 'wall_type', 'wall', 'highway', 'railway', 'natural', 'barrier'];

    function getLineConfig(tags) {
        const properties = tags || {};
        const customKeys = Object.keys(lineRepetitionConfig).filter(key =>
            key !== 'default' && !tagPriority.includes(key)
        );
        for (const key of tagPriority.concat(customKeys)) {
            const family = lineRepetitionConfig[key];
            if (!family || properties[key] === undefined) continue;
            const specific = family[properties[key]];
            if (specific) {
                return resolveConfigForTags(
                    { ...lineRepetitionConfig.default, ...family.default, ...specific },
                    properties
                );
            }
            if (family.default) {
                return resolveConfigForTags(
                    { ...lineRepetitionConfig.default, ...family.default },
                    properties
                );
            }
        }
        return resolveConfigForTags({ ...lineRepetitionConfig.default }, properties);
    }

    function resolveConfigForTags(config, tags) {
        return window.models && typeof window.models.resolveConfig === 'function'
            ? window.models.resolveConfig(config, tags)
            : config;
    }

    function getModelForTags(tags) {
        const mapping = window.models && window.models.findTagMapping
            ? window.models.findTagMapping(lineModelMappings, tags)
            : null;
        if (!mapping) return null;

        const resolvedMapping = resolveConfigForTags(mapping, tags);
        return {
            ...resolvedMapping,
            geometryType: 'line',
            config: window.models && window.models.adjustConfigForDirection
                ? window.models.adjustConfigForDirection(
                    resolvedMapping.config,
                    tags,
                    null
                )
                : resolvedMapping.config
        };
    }

    function calculateDistance(start, end) {
        const radius = 6371000;
        const lat1 = start[1] * Math.PI / 180;
        const lat2 = end[1] * Math.PI / 180;
        const deltaLat = (end[1] - start[1]) * Math.PI / 180;
        const deltaLon = (end[0] - start[0]) * Math.PI / 180;
        const sinLat = Math.sin(deltaLat / 2);
        const sinLon = Math.sin(deltaLon / 2);
        const a = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
        return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function calculateBearing(start, end) {
        const deltaLon = (end[0] - start[0]) * Math.PI / 180;
        const lat1 = start[1] * Math.PI / 180;
        const lat2 = end[1] * Math.PI / 180;
        const y = Math.sin(deltaLon) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
        return (Math.atan2(y, x) + 2 * Math.PI) % (2 * Math.PI);
    }

    function isClosedLine(coordinates) {
        if (!coordinates || coordinates.length < 3) return false;
        const first = coordinates[0];
        const last = coordinates[coordinates.length - 1];
        return Math.abs(first[0] - last[0]) < 1e-6 &&
            Math.abs(first[1] - last[1]) < 1e-6;
    }

    function createLineTexturePolygon(coordinates, widthMeters) {
        if (!Number.isFinite(widthMeters) || widthMeters <= 0) {
            throw new RangeError('Line texture width must be a positive number of meters');
        }
        if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

        if (coordinates.some(coord =>
            !Array.isArray(coord) || !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])
        )) {
            throw new TypeError('Line texture coordinates must contain finite longitude and latitude values');
        }

        const referenceLon = coordinates[0][0];
        const referenceLat = coordinates.reduce((sum, coord) => sum + coord[1], 0) /
            coordinates.length;
        const metersPerDegreeLat = 111320;
        const metersPerDegreeLon = metersPerDegreeLat *
            Math.cos(referenceLat * Math.PI / 180);
        if (Math.abs(metersPerDegreeLon) < 1e-6) {
            throw new RangeError('Cannot create a line texture strip at this latitude');
        }

        const points = [];
        for (const coord of coordinates) {
            const point = [
                (coord[0] - referenceLon) * metersPerDegreeLon,
                (coord[1] - referenceLat) * metersPerDegreeLat
            ];
            const previous = points[points.length - 1];
            if (!previous || Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 1e-4) {
                points.push(point);
            }
        }
        if (points.length < 2) return null;

        const normals = [];
        for (let index = 0; index < points.length - 1; index++) {
            const dx = points[index + 1][0] - points[index][0];
            const dy = points[index + 1][1] - points[index][1];
            const length = Math.hypot(dx, dy);
            normals.push([-dy / length, dx / length]);
        }

        const halfWidth = widthMeters / 2;
        function vertexOffset(index) {
            if (index === 0) return normals[0].map(value => value * halfWidth);
            if (index === points.length - 1) {
                return normals[normals.length - 1].map(value => value * halfWidth);
            }

            const previous = normals[index - 1];
            const next = normals[index];
            const sum = [previous[0] + next[0], previous[1] + next[1]];
            const sumLength = Math.hypot(sum[0], sum[1]);
            if (sumLength < 1e-6) return previous.map(value => value * halfWidth);

            const miter = [sum[0] / sumLength, sum[1] / sumLength];
            const denominator = miter[0] * next[0] + miter[1] * next[1];
            if (denominator <= 1e-6) return previous.map(value => value * halfWidth);

            const miterLength = Math.min(halfWidth / denominator, halfWidth * 4);
            return [miter[0] * miterLength, miter[1] * miterLength];
        }

        const left = [];
        const right = [];
        for (let index = 0; index < points.length; index++) {
            const offset = vertexOffset(index);
            left.push([points[index][0] + offset[0], points[index][1] + offset[1]]);
            right.push([points[index][0] - offset[0], points[index][1] - offset[1]]);
        }

        const toLonLat = point => [
            referenceLon + point[0] / metersPerDegreeLon,
            referenceLat + point[1] / metersPerDegreeLat
        ];
        const ring = left.concat(right.reverse()).map(toLonLat);
        let signedArea = 0;
        for (let index = 0; index < ring.length; index++) {
            const next = ring[(index + 1) % ring.length];
            signedArea += ring[index][0] * next[1] - next[0] * ring[index][1];
        }
        if (signedArea < 0) ring.reverse();
        ring.push(ring[0].slice());
        return ring;
    }

    function generateLineRepetitions(coordinates, tags, maxModelsOverride) {
        const config = getLineConfig(tags);
        if (!Number.isFinite(config.interval) || config.interval <= 0) {
            throw new RangeError('lineRepetitionConfig interval must be a positive number');
        }
        if (!Number.isFinite(config.maxModels) || config.maxModels < 0) {
            throw new RangeError('lineRepetitionConfig maxModels must be a non-negative number');
        }
        if (String(tags && tags.area || '').toLowerCase() === 'yes' || isClosedLine(coordinates)) {
            return [];
        }

        const repetitions = [];
        const modelLimit = Math.floor(maxModelsOverride === undefined
            ? config.maxModels
            : Math.min(config.maxModels, maxModelsOverride));
        let distanceToNext = 0;

        for (let i = 0; i < coordinates.length - 1 && repetitions.length < modelLimit; i++) {
            const start = coordinates[i];
            const end = coordinates[i + 1];
            const segmentLength = calculateDistance(start, end);
            if (segmentLength < 0.01) continue;

            const bearing = calculateBearing(start, end);
            while (distanceToNext < segmentLength && repetitions.length < modelLimit) {
                const ratio = distanceToNext / segmentLength;
                const position = [
                    start[0] + (end[0] - start[0]) * ratio,
                    start[1] + (end[1] - start[1]) * ratio
                ];

                if (config.sideOffset) {
                    const dx = end[0] - start[0];
                    const dy = end[1] - start[1];
                    const length = Math.hypot(dx, dy);
                    if (length > 0) {
                        const offsetLat = config.sideOffset / 111320;
                        const offsetLon = config.sideOffset /
                            (111320 * Math.cos(position[1] * Math.PI / 180));
                        position[0] += (-dy / length) * offsetLon;
                        position[1] += (dx / length) * offsetLat;
                    }
                }

                repetitions.push({ position, bearing, config });
                distanceToNext += config.interval;
            }

            distanceToNext -= segmentLength;
        }

        return repetitions;
    }

    function applyLineRepetitions(feature, modelFilename, modelConfig, tags) {
        const geometry = feature && feature.getGeometry && feature.getGeometry();
        if (!geometry) return;

        const properties = tags || feature.getProperties();
        if (String(properties.area || '').toLowerCase() === 'yes') {
            if (lineRepetitionDebugConfig.enabled) console.log('Skipping area=yes feature in line repetition');
            return;
        }

        const geometryType = geometry.getType();
        if (geometryType !== 'LineString' && geometryType !== 'MultiLineString') {
            if (lineRepetitionDebugConfig.enabled) {
                console.log(`Skipping ${geometryType} geometry in line repetition`);
            }
            return;
        }

        const projection = window.map.getView().getProjection();
        const sourceLines = geometryType === 'LineString'
            ? [geometry.getCoordinates()]
            : geometry.getCoordinates();
        const openLines = sourceLines.filter(line => !isClosedLine(line));
        if (lineRepetitionDebugConfig.enabled && lineRepetitionDebugConfig.logProcessing) {
            console.log(`Processing ${geometryType} with ${openLines.length} open line(s)`);
        }

        if (/\.(jpg|jpeg|png|gif|bmp|tiff|tif|webp)$/i.test(modelFilename || '')) {
            const textureWidthMeters = modelConfig && modelConfig.textureWidthMeters;
            if (openLines.length && (!Number.isFinite(textureWidthMeters) || textureWidthMeters <= 0)) {
                throw new RangeError('Image line mappings must set config.textureWidthMeters to a positive number');
            }

            const spacing = modelConfig && modelConfig.textureTileSizeMeters !== undefined
                ? modelConfig.textureTileSizeMeters
                : 1.0;
            if (!Number.isFinite(spacing) || spacing <= 0) {
                throw new RangeError('Line texture tile size must be a positive number of meters');
            }

            const textureModelLimit = getLineConfig(properties).maxModels;
            if (!Number.isFinite(textureModelLimit) || textureModelLimit < 0) {
                throw new RangeError('lineRepetitionConfig maxModels must be a non-negative number');
            }
            const textureLimit = Math.floor(textureModelLimit);
            const repetitions = openLines.slice(0, textureLimit).map(line => {
                const coordinates = line.map(coord =>
                    ol.proj.transform(coord, projection, 'EPSG:4326')
                );
                const polygonCoordinates = createLineTexturePolygon(coordinates, textureWidthMeters);
                return polygonCoordinates && {
                    type: 'polygon_texture',
                    polygonCoordinates,
                    spacing,
                    scale: modelConfig.scale || 1.0,
                    textureRotationOffsetDegrees: modelConfig.textureRotationOffsetDegrees
                };
            }).filter(Boolean);

            storeLineTextureRepetitions(feature, repetitions, modelFilename);
            if (lineRepetitionDebugConfig.enabled && lineRepetitionDebugConfig.logStorage) {
                console.log(`Stored ${repetitions.length} line texture strip(s)`);
            }
            return;
        }

        if (geometryType === 'MultiLineString') {
            const repetitions = [];
            for (const line of openLines) {
                const remainingModels = getLineConfig(properties).maxModels - repetitions.length;
                if (remainingModels <= 0) break;
                const lineCoordinates = line.map(coord =>
                    ol.proj.transform(coord, projection, 'EPSG:4326')
                );
                repetitions.push(...generateLineRepetitions(lineCoordinates, properties, remainingModels));
            }
            storeRepetitions(feature, repetitions, modelFilename, modelConfig);
            if (lineRepetitionDebugConfig.enabled && lineRepetitionDebugConfig.logStorage) {
                console.log(`Stored ${repetitions.length} line repetitions`);
            }
            return;
        }

        const coordinates = sourceLines[0].map(coord =>
            ol.proj.transform(coord, projection, 'EPSG:4326')
        );
        storeRepetitions(
            feature,
            generateLineRepetitions(coordinates, properties),
            modelFilename,
            modelConfig
        );
        if (lineRepetitionDebugConfig.enabled && lineRepetitionDebugConfig.logStorage) {
            console.log(`Stored ${feature.get('repetition_0') ? 'line' : 'no'} repetition models`);
        }
    }

    function storeRepetitions(feature, repetitions, modelFilename, modelConfig) {
        const baseRotation = (modelConfig && modelConfig.rotation) || [0, 0, 0];
        for (let index = 0; index < repetitions.length; index++) {
            const repetition = repetitions[index];
            const key = `repetition_${index}`;
            const config = repetition.config;
            feature.set(key, {
                uri: `/3dmodelsosm/src/models/${modelFilename}`,
                scale: modelConfig ? modelConfig.scale || 1.0 : 1.0,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                position: repetition.position
            });
            feature.set(`${key}_position`, repetition.position);
            const heightOffset = config.heightOffset !== undefined
                ? config.heightOffset
                : (modelConfig ? modelConfig.heightOffset || 0 : 0);
            feature.set(`${key}_heightOffset`, heightOffset);
            feature.set(`${key}_rotation`, [
                baseRotation[0],
                -repetition.bearing + (baseRotation[1] || 0) + (config.rotationOffset || 0),
                baseRotation[2]
            ]);
        }
    }

    function storeLineTextureRepetitions(feature, repetitions, imageFilename) {
        repetitions.forEach((repetition, index) => {
            const key = `repetition_${index}`;
            const uri = `/3dmodelsosm/src/models/${imageFilename}`;
            feature.set(key, {
                uri,
                scale: repetition.scale,
                type: 'polygon_texture',
                polygonCoordinates: repetition.polygonCoordinates,
                spacing: repetition.spacing,
                textureRotationOffsetDegrees: repetition.textureRotationOffsetDegrees
            });
            feature.set(`${key}_type`, 'polygon_texture');
            feature.set(`${key}_polygonCoordinates`, repetition.polygonCoordinates);
            feature.set(`${key}_polygonHoles`, []);
            feature.set(`${key}_spacing`, repetition.spacing);
        });
    }

    window.lineRepetitionConfig = lineRepetitionConfig;
    window.lineRepetition = {
        applyLineRepetitions,
        generateLineRepetitions,
        createLineTexturePolygon,
        getLineConfig,
        getModelForTags,
        getModelMappings: () => lineModelMappings,
        lineModelMappings,
        lineRepetitionConfig
    };
    if (window.modelRepetition && window.modelRepetition.repetitionConfig) {
        window.modelRepetition.repetitionConfig.line = lineRepetitionConfig.default;
    }
})();
