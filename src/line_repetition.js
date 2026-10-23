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
			kerb: {
                interval: 0.1, sideOffset: 0, maxModels: 5000, postHeight: 1.0,
                postWidth: 0.1, heightOffset: 0
            },
            wall: {
                interval: 0.2, sideOffset: 0, maxModels: 5000, postHeight: 1.0,
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
            if (specific) return { ...lineRepetitionConfig.default, ...family.default, ...specific };
            if (family.default) return { ...lineRepetitionConfig.default, ...family.default };
        }
        return { ...lineRepetitionConfig.default };
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
                -repetition.bearing + (config.rotationOffset || 0),
                baseRotation[2]
            ]);
        }
    }

    window.lineRepetitionConfig = lineRepetitionConfig;
    window.lineRepetition = {
        applyLineRepetitions,
        generateLineRepetitions,
        getLineConfig,
        lineRepetitionConfig
    };
    if (window.modelRepetition && window.modelRepetition.repetitionConfig) {
        window.modelRepetition.repetitionConfig.line = lineRepetitionConfig.default;
    }
})();
