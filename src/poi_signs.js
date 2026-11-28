/**
 * POI signs — colored 3D plaques for named Points of Interest.
 *
 * A sign is created for features that carry one of CATEGORY_KEYS and have a
 * name or a ref; a feature with neither is never signed. Highway roads and
 * paths count too (highway=residential, steps, elevator, ...), and a road
 * that is only known by its ref gets a sign showing that ref. It shows the
 * emoji, the feature name (or ref), the ref when the feature also has a
 * name, the OSM tag, and the tag definition taken from the per-language
 * `taginfo_simple_<lang>.csv` (English used as fallback).
 *
 * The emoji of a sign comes from `taginfo_simple_emoji.csv` (columns
 * key,value,emoji), so tags are connected to emojis by that file instead of
 * this one. A `name=<value>` row gives that one place its own emoji
 * (`name,Vila net,☀️`), and it wins over the category tag's emoji even when
 * the feature also has shop/amenity tags. Many rows there have no emoji at
 * all: those fall back to the `config.emoji` table below and finally to 📍.
 * When a row's third column is an image URL (http(s):// or data:image/) the
 * image is drawn on the sign in the same box an emoji would occupy.
 *
 * The fourth column, `geojson`, scopes a row to a polygon: when it names a
 * geojson file (e.g. `limit_molivent`, read from `src/`), the row only applies
 * to signs whose point is inside that polygon. A row with an empty column is
 * a global default, so the same CSV holds both the normal emoji of a tag and
 * the local look of that tag inside a district:
 *
 *   amenity,bench,🪑,              <- everywhere
 *   amenity,bench,🛋️,limit_molivent <- only inside src/limit_molivent.geojson
 *
 * Several zones can share a row by listing them with `;`. When zones overlap
 * the row further down the file wins. Unreadable files are ignored, so the
 * global rows keep applying and nothing breaks without a geojson.
 *
 * Everything visual is configurable at runtime:
 *
 *   window.poiSigns.config.colors.amenity = '#ff0000';
 *   window.poiSigns.config.emoji['shop=pawnbroker'] = '💍';  // CSV fallback
 *   window.poiSigns.config.emoji.shop = '🛍️';
 *   window.poiSigns.config.showTag = false;
 *   window.poiSigns.refresh();          // rebuild the signs already in 3D
 *
 * A `window.poiSignConfig` declared before this script loads is merged in, so
 * colours and emojis can also be set without touching this file.
 */
(function () {
    'use strict';

    const CATEGORY_KEYS = ['amenity', 'tourism', 'leisure', 'shop', 'office', 'highway'];

    const config = {
        // OSM keys that get a sign. Add keys here (e.g. 'historic') to make
        // signs for other families of features too; they use the default
        // colour unless an entry is added to `colors` as well.
        categories: CATEGORY_KEYS.slice(),

        // Per-key value filter: a key listed here only signs features whose
        // value is in its list. `highway` is restricted to the road/path kinds
        // worth a plaque (footway, cycleway, ... stay unsignposted). Remove a
        // key (or override it in window.poiSignConfig.values) to widen it.
        values: {
            highway: [
                'service', 'steps', 'escalator', 'elevator', 'unclassified',
                'pedestrian', 'living_street', 'residential', 'tertiary',
                'secondary', 'primary', 'trunk', 'motorway', 'track', 'path'
            ]
        },

        // One colour per OSM key; `default` is used for any other key.
        colors: {
            amenity: '#c2410c',
            tourism: '#1d4ed8',
            leisure: '#15803d',
            shop: '#7e22ce',
            office: '#475569',
            highway: '#334155',
            default: '#0f766e'
        },

        // Fallback emojis: `taginfo_simple_emoji.csv` is consulted first, and
        // this table only supplies entries that file has no emoji for.
        // `key=value` wins over `key`. An image URL is accepted wherever an
        // emoji is (drawn at emoji size), e.g. 'shop=bakery': 'https://…/bread.png'.
        // Entries declared in `window.poiSignConfig.emoji` win over the CSV.
        emoji: {
            'amenity=restaurant': '🍽️',
            'amenity=fast_food': '🍔',
            'amenity=cafe': '☕',
            'amenity=pub': '🍻',
            'amenity=bar': '🍸',
            'amenity=ice_cream': '🍦',
            'amenity=bank': '🏦',
            'amenity=atm': '🏧',
            'amenity=pharmacy': '💊',
            'amenity=hospital': '🏥',
            'amenity=clinic': '🏥',
            'amenity=doctors': '🩺',
            'amenity=dentist': '🦷',
            'amenity=veterinary': '🐾',
            'amenity=school': '🎓',
            'amenity=university': '🎓',
            'amenity=kindergarten': '🧒',
            'amenity=library': '📖',
            'amenity=cinema': '🎬',
            'amenity=theatre': '🎭',
            'amenity=nightclub': '🕺',
            'amenity=parking': '🅿️',
            'amenity=fuel': '⛽',
            'amenity=police': '👮',
            'amenity=fire_station': '🚒',
            'amenity=post_box': '📮',
            'amenity=post_office': '📬',
            'amenity=townhall': '🏛️',
            'amenity=place_of_worship': '⛪',
            'amenity=toilets': '🚻',
            'amenity=drinking_water': '🚰',
            'amenity=bench': '🪑',
            'amenity=waste_basket': '🗑️',
            'amenity=bicycle_parking': '🚲',
            'amenity=marketplace': '🧺',
            'amenity=community_centre': '🏘️',
            'tourism=hotel': '🏨',
            'tourism=guest_house': '🛏️',
            'tourism=hostel': '🛏️',
            'tourism=motel': '🏩',
            'tourism=museum': '🖼️',
            'tourism=attraction': '🎡',
            'tourism=zoo': '🦁',
            'tourism=aquarium': '🐠',
            'tourism=camp_site': '⛺',
            'tourism=information': 'ℹ️',
            'tourism=viewpoint': '👁️',
            'leisure=park': '🌳',
            'leisure=garden': '🌷',
            'leisure=playground': '🛝',
            'leisure=sports_centre': '⚽',
            'leisure=swimming_pool': '🏊',
            'leisure=fitness_centre': '🏋️',
            'leisure=stadium': '🏟️',
            'leisure=pitch': '🥅',
            'leisure=track': '🏃',
            'shop=supermarket': '🛒',
            'shop=convenience': '🛒',
            'shop=department_store': '🏬',
            'shop=mall': '🏬',
            'shop=bakery': '🥐',
            'shop=butcher': '🥩',
            'shop=greengrocer': '🥦',
            'shop=florist': '💐',
            'shop=clothes': '👕',
            'shop=shoes': '👠',
            'shop=electronics': '💻',
            'shop=books': '📚',
            'shop=chemist': '🧴',
            'shop=cosmetics': '💄',
            'shop=hairdresser': '💇',
            'shop=beauty': '💅',
            'shop=gift': '🎁',
            'shop=souvenir': '🎁',
            'shop=toys': '🧸',
            'shop=furniture': '🛋️',
            'shop=hardware': '🔧',
            'shop=jewelry': '💍',
            'shop=bicycle': '🚲',
            'shop=car': '🚗',
            'shop=car_repair': '🔧',
            'shop=laundry': '🧺',
            'shop=optician': '👓',
            'office=company': '💼',
            'office=government': '🏛️',
            'office=lawyer': '⚖️',
            'office=insurance': '📋',
            'office=estate_agent': '🏠',
            'highway=motorway': '🛣️',
            'highway=trunk': '🛣️',
            'highway=primary': '🛣️',
            'highway=secondary': '🛣️',
            'highway=tertiary': '🛣️',
            'highway=unclassified': '🛣️',
            'highway=residential': '🏘️',
            'highway=living_street': '🏘️',
            'highway=pedestrian': '🚶',
            'highway=service': '🛠️',
            'highway=track': '🚜',
            'highway=path': '🥾',
            'highway=steps': '🪜',
            'highway=escalator': '⬆️',
            'highway=elevator': '🛗',

            // Fallbacks per key
            amenity: '🏷️',
            tourism: '🧭',
            leisure: '🌳',
            shop: '🛍️',
            office: '💼',
            highway: '🛣️',
            default: '📍'
        },

        showTag: true,
        showDescription: true,
        heightMeters: 4.4,          // plaque bottom above the ground
        displayWidthPx: 300,        // billboard width on screen
        // Nudge the sign towards the viewer in eye space so a sign mounted on
        // the wall of its own building is not swallowed by that wall's depth.
        // It stays depth-tested, so other buildings in front still hide it.
        // Signs are wide screen-facing quads, so a small offset is not enough:
        // seen at an angle the quad cuts back into the wall. Keep this around
        // half the sign's on-screen width (a few metres) and it clears it.
        depthOffsetMeters: 4.0,
        maxDescriptionChars: 220,
        maxDescriptionLines: 3
    };

    // Emoji overrides copied from `window.poiSignConfig.emoji`: these win over
    // taginfo_simple_emoji.csv, while edits to config.emoji only fill its gaps.
    const userEmoji = {};

    // Merge a user config declared before this script.
    (function mergeUserConfig() {
        const user = window.poiSignConfig;
        if (!user || typeof user !== 'object') return;
        if (Array.isArray(user.categories)) config.categories = user.categories.slice();
        if (user.colors) Object.assign(config.colors, user.colors);
        if (user.values) Object.assign(config.values, user.values);
        if (user.emoji) {
            Object.assign(config.emoji, user.emoji);
            Object.assign(userEmoji, user.emoji);
        }
        ['showTag', 'showDescription', 'heightMeters', 'displayWidthPx',
            'depthOffsetMeters', 'maxDescriptionChars', 'maxDescriptionLines'].forEach(function (key) {
                if (user[key] !== undefined) config[key] = user[key];
            });
    })();

    // ---------------------------------------------------------------------
    // Per-language definitions from taginfo_simple_<lang>.csv
    // ---------------------------------------------------------------------
    const definitionsByLanguage = new Map();   // lang -> Map('key=value' -> definition)
    const loadingByLanguage = new Map();       // lang -> Promise
    let requestedLanguage = null;

    function getLanguage() {
        try {
            if (window.i18n && typeof window.i18n.getCurrentLanguage === 'function') {
                return window.i18n.getCurrentLanguage() || 'en';
            }
            const fromUrl = new URLSearchParams(window.location.search).get('lang');
            if (fromUrl) return fromUrl;
        } catch (e) { /* ignore */ }
        return 'en';
    }

    function parseCsvLine(line) {
        const values = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
                else inQuotes = !inQuotes;
            } else if (ch === ',' && !inQuotes) {
                values.push(current);
                current = '';
            } else {
                current += ch;
            }
        }
        values.push(current);
        return values;
    }

    function loadDefinitions(lang) {
        if (definitionsByLanguage.has(lang)) return Promise.resolve(definitionsByLanguage.get(lang));
        if (loadingByLanguage.has(lang)) return loadingByLanguage.get(lang);

        const promise = fetch(`taginfo_simple_${lang}.csv`)
            .then(function (response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.text();
            })
            .then(function (text) {
                const definitions = new Map();
                const lines = text.split(/\r?\n/);
                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i];
                    if (!line) continue;
                    const values = parseCsvLine(line);
                    if (values.length < 3) continue;
                    const key = values[0].trim();
                    const value = values[1].trim();
                    const definition = values[2].trim();
                    if (!key || !value) continue;
                    definitions.set(`${key}=${value}`, definition);
                }
                definitionsByLanguage.set(lang, definitions);
                return definitions;
            })
            .catch(function (error) {
                console.warn(`🏷️ POI signs: could not load taginfo_simple_${lang}.csv`, error);
                const empty = new Map();
                definitionsByLanguage.set(lang, empty);
                return empty;
            })
            .then(function (definitions) {
                loadingByLanguage.delete(lang);
                return definitions;
            });

        loadingByLanguage.set(lang, promise);
        return promise;
    }

    function lookupDescription(tag, lang) {
        const current = definitionsByLanguage.get(lang);
        if (current && current.has(tag)) return current.get(tag);
        if (lang !== 'en') {
            const english = definitionsByLanguage.get('en');
            if (english && english.has(tag)) return english.get(tag);
        }
        return '';
    }

    function refreshAll() {
        window.dispatchEvent(new CustomEvent('poiSignsReady', { detail: { language: getLanguage() } }));
    }

    // ---------------------------------------------------------------------
    // Emojis from taginfo_simple_emoji.csv (key,value,emoji,geojson)
    //
    // This file connects every tag to the emoji its sign shows. Rows whose
    // third column is empty simply have no emoji, which is not an error: the
    // config table is used instead. A third column that is an image URL is
    // loaded and drawn in the emoji's box, so signs can carry small pictures.
    // A fourth column names a geojson polygon, which scopes the row to signs
    // inside it; rows with an empty fourth column are the global defaults.
    // ---------------------------------------------------------------------
    let emojiByTag = null;         // Map('key=value' -> emoji | image URL)
    let emojiByName = null;        // Map(lowercased name -> emoji | image URL)
    let emojiByZone = null;        // Map(geojson -> Map('key=value' -> emoji | image URL))
    let emojiByNameByZone = null;  // Map(geojson -> Map(lowercased name -> emoji | image URL))
    let emojiTablePromise = null;

    /**
     * Comparison key for names in the CSV: case, decorative apostrophes
     * (`Trebol’s` vs `Trebol's`), accents and extra spaces all ignored.
     */
    function normalizeEmojiName(text) {
        return String(text === undefined || text === null ? '' : text)
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[\u2018\u2019\u201B\u02BC\u2032`\u00B4]/g, "'")
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function parseEmojiTable(text) {
        const table = new Map();
        const byName = new Map();
        const byZone = new Map();
        const byZoneName = new Map();
        const lines = text.split(/\r?\n/);
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line) continue;
            const values = parseCsvLine(line);
            if (values.length < 3) continue;
            const key = values[0].trim();
            const value = values[1].trim();
            const emoji = values[2].trim();
            if (!key || !value || !emoji) continue;

            // Fourth column: geojson polygons the row is limited to. Empty
            // means the row is a default and applies everywhere.
            const zones = String(values[3] || '').split(';')
                .map(function (zone) { return zone.trim(); })
                .filter(Boolean);
            if (zones.length) {
                zones.forEach(function (zone) {
                    if (!byZone.has(zone)) byZone.set(zone, new Map());
                    byZone.get(zone).set(`${key}=${value}`, emoji);
                    if (key === 'name') {
                        if (!byZoneName.has(zone)) byZoneName.set(zone, new Map());
                        byZoneName.get(zone).set(normalizeEmojiName(value), emoji);
                    }
                });
                continue;
            }

            table.set(`${key}=${value}`, emoji);
            // `name=<value>` rows give one place its own emoji (Vila net -> ☀️).
            if (key === 'name') byName.set(normalizeEmojiName(value), emoji);
        }
        emojiByName = byName;
        emojiByZone = byZone;
        emojiByNameByZone = byZoneName;
        return table;
    }

    function loadEmojiTable() {
        if (emojiTablePromise) return emojiTablePromise;
        emojiTablePromise = fetch('taginfo_simple_emoji.csv')
            .then(function (response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.text();
            })
            .then(function (text) {
                emojiByTag = parseEmojiTable(text);
                // Rows in the geojson column name polygon files: read them so
                // the signs can be checked against them once they are in.
                const zones = loadEmojiZones();
                // Images are painted synchronously into the sign canvas, so
                // fetch them now; signs built before one arrives fall back to
                // an emoji and are rebuilt when it lands. Config entries can
                // be image URLs too, so preload those as well.
                const values = Array.from(emojiByTag.values());
                if (emojiByZone) {
                    emojiByZone.forEach(function (rows) {
                        rows.forEach(function (emoji) { values.push(emoji); });
                    });
                }
                Object.keys(config.emoji || {}).forEach(function (key) {
                    values.push(config.emoji[key]);
                });
                return preloadEmojiImages(values).then(function () { return zones; });
            })
            .catch(function (error) {
                console.warn('🏷️ POI signs: could not load taginfo_simple_emoji.csv', error);
                if (!emojiByTag) emojiByTag = new Map();
            });
        return emojiTablePromise;
    }

    /** True when an emoji cell holds an image URL instead of an emoji. */
    function isImageUrl(text) {
        const value = String(text === undefined || text === null ? '' : text).trim();
        return /^https?:\/\//i.test(value) ||
            /^\/\//.test(value) ||
            /^data:image\//i.test(value) ||
            /\.(png|jpe?g|gif|svg|webp|avif)(\?|#|$)/i.test(value);
    }

    const EMOJI_IMAGES = new Map();    // url -> { status, image }
    const EMOJI_IMAGE_TIMEOUT_MS = 10000;

    /** Start loading an emoji image once; never returns a rejected promise. */
    function loadEmojiImage(url) {
        const entry = EMOJI_IMAGES.get(url);
        if (entry) return entry.done;
        const record = { status: 'loading', image: null, done: null };
        EMOJI_IMAGES.set(url, record);
        record.done = new Promise(function (resolve) {
            let settled = false;
            const finish = function (status) {
                if (settled) return;
                settled = true;
                record.status = status;
                resolve(record);
                // The sign was drawn with a text emoji: repaint it with the image.
                if (status === 'ready') scheduleEmojiRefresh();
            };
            const image = new Image();
            image.crossOrigin = 'anonymous';
            image.onload = function () { record.image = image; finish('ready'); };
            image.onerror = function () { finish('error'); };
            image.src = url;
            setTimeout(function () { finish('error'); }, EMOJI_IMAGE_TIMEOUT_MS);
        });
        return record.done;
    }

    /** Loaded image for a URL, or null while it is still pending or broken. */
    function getEmojiImage(url) {
        const entry = EMOJI_IMAGES.get(url);
        if (!entry) {
            loadEmojiImage(url);
            return null;
        }
        return entry.status === 'ready' ? entry.image : null;
    }

    function preloadEmojiImages(values) {
        const jobs = [];
        const seen = new Set();
        values.forEach(function (value) {
            if (!isImageUrl(value) || seen.has(value)) return;
            seen.add(value);
            if (!EMOJI_IMAGES.has(value)) loadEmojiImage(value);
            jobs.push(loadEmojiImage(value));
        });
        return Promise.all(jobs);
    }

    /** A cross-origin image without CORS headers taints the sign canvas. */
    function markEmojiImageUnusable(url) {
        const entry = EMOJI_IMAGES.get(url);
        if (entry) {
            entry.status = 'error';
            entry.image = null;
        }
        imageCache.clear();
    }

    let emojiRefreshTimer = null;
    function scheduleEmojiRefresh() {
        if (emojiRefreshTimer) return;
        emojiRefreshTimer = setTimeout(function () {
            emojiRefreshTimer = null;
            imageCache.clear();
            refreshAll();
        }, 250);
    }

    // ---------------------------------------------------------------------
    // Emoji zones: the fourth CSV column
    //
    // A row like `amenity,bench,🛋️,limit_molivent` only applies inside
    // src/limit_molivent.geojson; everywhere else the bench keeps its global
    // emoji. Files are read with OpenLayers and tested with
    // geometry.intersectsCoordinate(lonLat), the same test the 3D model zones
    // use, so a district looks the same for models and signs.
    // ---------------------------------------------------------------------
    const zoneGeometries = new Map();  // geojson name -> [geometry] | null
    const zonePending = new Map();     // geojson name -> Promise

    /** URL of a geojson named in the CSV: bare names live next to this file. */
    function zoneUrl(name) {
        const clean = String(name || '').trim();
        if (!clean) return '';
        if (/^(https?:)?\/\//i.test(clean) || clean.indexOf('/') !== -1) return clean;
        return 'src/' + (/\.geojson$/i.test(clean) ? clean : clean + '.geojson');
    }

    /** Load one zone geometry once; failures are cached and never retried. */
    function loadEmojiZone(name) {
        if (zoneGeometries.has(name)) return Promise.resolve(zoneGeometries.get(name));
        if (zonePending.has(name)) return zonePending.get(name);

        const url = zoneUrl(name);
        const promise = fetch(url)
            .then(function (response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            })
            .then(function (data) {
                if (typeof ol === 'undefined' || !ol.format || !ol.format.GeoJSON) {
                    throw new Error('OpenLayers GeoJSON reader not available');
                }
                // No featureProjection: the coordinates stay lon/lat, so they
                // can be compared with the sign's own ol.proj.toLonLat() point.
                const features = new ol.format.GeoJSON().readFeatures(data);
                const geometries = [];
                features.forEach(function (feature) {
                    const geometry = feature && typeof feature.getGeometry === 'function'
                        ? feature.getGeometry() : null;
                    if (geometry && typeof geometry.intersectsCoordinate === 'function') {
                        geometries.push(geometry);
                    }
                });
                if (!geometries.length) throw new Error('no polygon in the file');
                zoneGeometries.set(name, geometries);
                return geometries;
            })
            .catch(function (error) {
                // A missing or broken zone file must not break the signs: its
                // rows are ignored and the global rows keep applying.
                zoneGeometries.set(name, null);
                console.warn('🏷️ POI signs: zone geojson "' + url +
                    '" not loaded, its emoji rows are ignored', error);
                return null;
            })
            .then(function (geometries) {
                zonePending.delete(name);
                return geometries;
            });

        zonePending.set(name, promise);
        return promise;
    }

    /** Load every geojson named in the emoji table; signs refresh when done. */
    function loadEmojiZones() {
        if (!emojiByZone || !emojiByZone.size) return Promise.resolve([]);
        const jobs = Array.from(emojiByZone.keys()).map(loadEmojiZone);
        return Promise.all(jobs).then(function (results) {
            // Signs placed before the polygons arrived were drawn with the
            // global rows; rebuild them now that the zones can be tested.
            if (results.some(Boolean)) scheduleEmojiRefresh();
            return results;
        });
    }

    /** Point of a feature in lon/lat, the projection zone files are read in. */
    function featureLonLat(feature) {
        try {
            const geometry = feature && typeof feature.getGeometry === 'function'
                ? feature.getGeometry() : null;
            if (!geometry) return null;
            let coords = null;
            const type = typeof geometry.getType === 'function' ? geometry.getType() : '';
            if (type === 'Point') {
                coords = geometry.getCoordinates();
            } else if ((type === 'LineString' || type === 'MultiLineString') &&
                typeof geometry.getCoordinates === 'function') {
                // Same anchor as the sign: middle of the longest part (see
                // addPoiSign, which signs the road at that coordinate).
                const parts = type === 'LineString'
                    ? [geometry.getCoordinates()]
                    : geometry.getCoordinates();
                let longest = null;
                for (let i = 0; i < (parts || []).length; i++) {
                    if (parts[i] && (!longest || parts[i].length > longest.length)) longest = parts[i];
                }
                if (longest && longest.length) coords = longest[Math.floor(longest.length / 2)];
            } else if (typeof geometry.getExtent === 'function') {
                // Areas use their bbox centre, like their signs do.
                const extent = geometry.getExtent();
                coords = [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2];
            }
            if (!coords) return null;
            if (typeof ol !== 'undefined' && ol.proj && typeof ol.proj.toLonLat === 'function') {
                coords = ol.proj.toLonLat(coords);
            }
            return coords;
        } catch (error) { /* not an OL feature */ }
        return null;
    }

    /**
     * Emoji rows of every zone containing the feature, merged: a later row in
     * the CSV overrides an earlier one, and every zone row overrides the
     * global rows.
     * @returns {{tags: Map<string,string>, names: Map<string,string>}|null}
     */
    function emojiZoneRows(feature) {
        if (!emojiByZone || !emojiByZone.size) return null;
        const point = featureLonLat(feature);
        if (!point) return null;

        let tags = null;
        let names = null;
        emojiByZone.forEach(function (rows, name) {
            const geometries = zoneGeometries.get(name);
            if (!geometries) return;
            const inside = geometries.some(function (geometry) {
                return geometry.intersectsCoordinate(point);
            });
            if (!inside) return;
            rows.forEach(function (emoji, tag) {
                tags = tags || new Map();
                tags.set(tag, emoji);
            });
            const nameRows = emojiByNameByZone.get(name);
            if (nameRows) {
                nameRows.forEach(function (emoji, key) {
                    names = names || new Map();
                    names.set(key, emoji);
                });
            }
        });
        return tags || names ? { tags: tags || new Map(), names: names || new Map() } : null;
    }

    /** Zone emoji for a tag, or '' when the zone does not override it. */
    function zoneEmoji(zone, key, value) {
        if (!zone || !zone.tags) return '';
        return zone.tags.get(`${key}=${value}`) || '';
    }

    /** Load the current language (plus English fallback) and tell the renderer. */
    function load(language) {
        const lang = language || getLanguage();
        if (requestedLanguage === lang && definitionsByLanguage.has(lang)) return Promise.resolve();
        requestedLanguage = lang;
        const jobs = [loadDefinitions(lang), loadEmojiTable()];
        if (lang !== 'en') jobs.push(loadDefinitions('en'));
        return Promise.all(jobs).then(function () { refreshAll(); });
    }

    // ---------------------------------------------------------------------
    // Sign data
    // ---------------------------------------------------------------------
    function getTags(feature) {
        try {
            if (feature && typeof feature.getProperties === 'function') {
                return feature.getProperties() || {};
            }
        } catch (e) { /* not an OL feature */ }
        return {};
    }

    function pickCategory(tags) {
        const keys = Array.isArray(config.categories) ? config.categories : CATEGORY_KEYS;
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const value = tags[key];
            if (value === undefined || value === null || String(value).trim() === '') continue;
            const clean = String(value).trim();
            // A key can be limited to some of its values (highway=residential,
            // motorway, ...): other values of that key get no sign.
            const allowed = config.values && config.values[key];
            if (Array.isArray(allowed) && allowed.indexOf(clean) === -1) continue;
            return { key: key, value: clean };
        }
        return null;
    }

    /** Emoji for a tag from taginfo_simple_emoji.csv, or '' when it has none. */
    function emojiFromTable(key, value) {
        if (!emojiByTag) return '';
        const direct = emojiByTag.get(`${key}=${value}`);
        if (direct) return direct;
        // Values can be semicolon lists ('cafe;bar', 'bakery;pastry')
        const first = String(value).split(';')[0].trim();
        if (first && first !== value) {
            const fromFirst = emojiByTag.get(`${key}=${first}`);
            if (fromFirst) return fromFirst;
        }
        return '';
    }

    /**
     * Emoji (or image URL) for a feature's own name, from a `name=<value>` row
     * in the CSV. Every spelling of the name is tried (the one shown on the
     * sign, plain `name`, then `name:*`), compared case-insensitively.
     * @param {string|string[]} names one name or a list of candidates
     * @param {{names: Map<string,string>}|null} zone rows of the zones the
     *        feature is inside, checked before the global rows
     * @returns {string} '' when no name has a row
     */
    function emojiFromName(names, zone) {
        const list = Array.isArray(names) ? names : [names];
        for (let i = 0; i < list.length; i++) {
            const name = cleanText(list[i]);
            if (!name) continue;
            const normalized = normalizeEmojiName(name);
            const zonal = zone && zone.names ? zone.names.get(normalized) : '';
            if (zonal) return zonal;
            const override = userEmoji[`name=${name}`];
            if (override) return override;
            if (emojiByName) {
                const fromTable = emojiByName.get(normalized);
                if (fromTable) return fromTable;
            }
        }
        return '';
    }

    /** Fallback emoji for a tag: no CSV entry, so use the config table. */
    function fallbackEmoji(key, value) {
        const emoji = config.emoji || {};
        // An entry may itself be an image URL, which cannot be drawn as text:
        // skip those and keep looking, so a broken image still shows something.
        const candidates = [
            userEmoji[`${key}=${value}`], userEmoji[key],
            emoji[`${key}=${value}`], emoji[key],
            emoji.default, '📍'
        ];
        for (let i = 0; i < candidates.length; i++) {
            const candidate = candidates[i];
            if (candidate && !isImageUrl(candidate)) return candidate;
        }
        return '📍';
    }

    /**
     * Emoji (or image URL) for a tag: zone row, user override, CSV, config.
     */
    function pickEmoji(key, value, zone) {
        return zoneEmoji(zone, key, value) ||
            userEmoji[`${key}=${value}`] || userEmoji[key] ||
            emojiFromTable(key, value) || fallbackEmoji(key, value);
    }

    function cleanText(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/\\t/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Describe a feature as a sign, or return null when it is not a POI.
     * @returns {{key:string,value:string,tag:string,name:string,ref:string,
     *            emoji:string, emojiImage:Image|null, color:string,
     *            description:string, language:string}|null}
     */
    function describe(feature) {
        const tags = getTags(feature);
        const category = pickCategory(tags);
        if (!category) return null;

        const language = getLanguage();
        let name = cleanText(
            tags[`name:${language}`] ||
            tags.name ||
            tags['name:en'] ||
            '');

        // Roads and paths are often known by their ref only (N-II, C-31).
        const ref = cleanText(tags.ref);
        if (!name) name = ref;

        // A sign needs a name or a ref: a plaque with only a tag and a
        // definition is noise, and the request is signs for named POIs.
        if (!name) return null;

        const tag = `${category.key}=${category.value}`;
        let description = cleanText(lookupDescription(tag, language));
        if (description === tag) description = '';
        if (description.length > config.maxDescriptionChars) {
            description = description.slice(0, config.maxDescriptionChars).replace(/\s+\S*$/, '') + '…';
        }

        // The emoji may be an image URL: use the loaded image, and a text
        // emoji in the meantime (or if the image never arrives).
        //
        // Order: a row of the zones the feature is inside (fourth CSV column
        // naming a geojson), an explicit override for this very tag, the emoji
        // of the feature's name (`name,Vila net,☀️`), then the category tag
        // (shop, amenity, ...). A sign for a named place shows the name's
        // emoji even when it also has shop/amenity tags. Any spelling of the
        // name can carry the row, so `name:ca` matches a CSV `name` row too.
        const nameCandidates = [name, tags.name];
        Object.keys(tags).forEach(function (key) {
            if (key.indexOf('name:') === 0) nameCandidates.push(tags[key]);
        });
        const zone = emojiZoneRows(feature);
        // highway=steps with conveying=* is an escalator: give it its own
        // emoji, while the tag line still shows highway=steps.
        const escalator = category.key === 'highway' &&
            category.value === 'steps' &&
            /^(yes|forward|backward)$/.test(cleanText(tags.conveying));
        const emojiValue = escalator ? 'escalator' : category.value;
        const picked = zoneEmoji(zone, category.key, category.value) ||
            zoneEmoji(zone, category.key, emojiValue) ||
            userEmoji[tag] ||
            (escalator ? userEmoji[`${category.key}=${emojiValue}`] : '') ||
            emojiFromName(nameCandidates, zone) ||
            pickEmoji(category.key, emojiValue, zone);
        const emojiImage = isImageUrl(picked) ? getEmojiImage(picked) : null;
        const emoji = isImageUrl(picked) ? fallbackEmoji(category.key, emojiValue) : picked;

        return {
            key: category.key,
            value: category.value,
            tag: tag,
            name: name,
            ref: ref,
            emoji: emoji,
            emojiImage: emojiImage,
            color: config.colors[category.key] || config.colors.default,
            description: description,
            language: language
        };
    }

    // ---------------------------------------------------------------------
    // Canvas
    // ---------------------------------------------------------------------
    const imageCache = new Map();
    const IMAGE_CACHE_LIMIT = 1200;

    function wrapLines(ctx, text, maxWidth, maxLines) {
        const words = String(text).split(/\s+/).filter(Boolean);
        const lines = [];
        let line = '';
        for (let i = 0; i < words.length; i++) {
            const candidate = line ? line + ' ' + words[i] : words[i];
            if (ctx.measureText(candidate).width <= maxWidth || !line) {
                line = candidate;
            } else {
                lines.push(line);
                line = words[i];
                if (lines.length === maxLines) break;
            }
        }
        if (line && lines.length < maxLines) lines.push(line);
        if (lines.length === maxLines && words.length) {
            // mark truncation without losing the last visible word
            const last = lines[lines.length - 1];
            if (ctx.measureText(last + ' …').width <= maxWidth) lines[lines.length - 1] = last + ' …';
        }
        return lines;
    }

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    /**
     * Paint an emoji image inside a square box, keeping its aspect ratio.
     * @param {CanvasRenderingContext2D} ctx
     * @param {HTMLImageElement} image
     * @param {number} x left edge of the box
     * @param {number} y top edge of the box
     * @param {number} size box edge, the same size an emoji glyph gets
     */
    function drawEmojiImage(ctx, image, x, y, size) {
        const imageWidth = image.naturalWidth || image.width;
        const imageHeight = image.naturalHeight || image.height;
        if (!imageWidth || !imageHeight) return;
        const scale = Math.min(size / imageWidth, size / imageHeight);
        const drawWidth = imageWidth * scale;
        const drawHeight = imageHeight * scale;
        ctx.drawImage(
            image,
            x + (size - drawWidth) / 2,
            y + (size - drawHeight) / 2,
            drawWidth,
            drawHeight);
    }

    /**
     * Build (or reuse) the sign image.
     * @returns {{dataUrl:string,width:number,height:number}|null}
     */
    function buildImage(info) {
        if (!info) return null;
        const cacheKey = [
            info.color, info.emoji, info.emojiImage ? `img:${info.emojiImage.src}` : '',
            info.name, info.ref, info.tag, info.description,
            info.language, config.showTag, config.showDescription
        ].join('|');
        if (imageCache.has(cacheKey)) return imageCache.get(cacheKey);

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        const pad = 26;
        const emojiSize = 100;  // emoji glyphs and images share this box
        const nameSize = 40;
        const refSize = 30;
        const tagSize = 24;
        const descSize = 22;
        const descLineHeight = 28;
        const textX = pad + emojiSize + 18;
        const width = 720;
        const textWidth = width - textX - pad;

        // Name (max 2 lines) and description lines decide the height.
        let nameLines = [];
        if (info.name) {
            ctx.font = `bold ${nameSize}px Arial, sans-serif`;
            nameLines = wrapLines(ctx, info.name, textWidth, 2);
        }
        let descLines = [];
        if (config.showDescription && info.description) {
            ctx.font = `${descSize}px Arial, sans-serif`;
            descLines = wrapLines(ctx, info.description, textWidth, config.maxDescriptionLines || 3);
        }

        const tagLine = config.showTag ? info.tag : '';
        // Ref of a road/path, only when the name already showed it differently.
        const refLine = info.ref && info.ref !== info.name ? `ref ${info.ref}` : '';
        const textHeight =
            nameLines.length * (nameSize + 6) +
            (refLine ? refSize + 4 : 0) +
            (tagLine ? tagSize + 8 : 0) +
            descLines.length * descLineHeight;
        const contentHeight = Math.max(emojiSize, textHeight);
        const height = Math.max(112, pad * 2 + contentHeight);

        canvas.width = width;
        canvas.height = height;

        // Background
        ctx.fillStyle = info.color;
        roundRect(ctx, 0, 0, width, height, 22);
        ctx.fill();
        // Subtle darker edge so a sign stays readable against light terrain.
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 4;
        roundRect(ctx, 2, 2, width - 4, height - 4, 20);
        ctx.stroke();

        // Emoji (or an image in the same box), vertically centred with the
        // text block
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        const textTop = pad;
        const emojiBlockHeight = Math.max(emojiSize, textHeight);
        if (info.emojiImage) {
            drawEmojiImage(ctx, info.emojiImage, pad, textTop + (emojiBlockHeight - emojiSize) / 2, emojiSize);
        } else {
            ctx.font = `${emojiSize}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", Arial, sans-serif`;
            ctx.fillStyle = '#ffffff';
            const emojiOffsetY = emojiBlockHeight / 2 + emojiSize * 0.35;
            ctx.fillText(info.emoji, pad, textTop + emojiOffsetY);
        }

        let y = textTop;
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'top';

        // Name
        if (nameLines.length) {
            ctx.font = `bold ${nameSize}px Arial, sans-serif`;
            nameLines.forEach(function (line) {
                ctx.fillText(line, textX, y);
                y += nameSize + 6;
            });
        }

        // Ref (N-II, C-31, ...), above the tag line
        if (refLine) {
            ctx.font = `bold ${refSize}px Arial, sans-serif`;
            ctx.fillStyle = 'rgba(255,255,255,0.95)';
            ctx.fillText(refLine, textX, y + 2);
            y += refSize + 4;
            ctx.fillStyle = '#ffffff';
        }

        // Tag (key=value)
        if (tagLine) {
            ctx.font = `${tagSize}px "Courier New", monospace`;
            ctx.fillStyle = 'rgba(255,255,255,0.92)';
            ctx.fillText(tagLine, textX, y + 2);
            y += tagSize + 8;
            ctx.fillStyle = '#ffffff';
        }

        // Description from the current language CSV
        if (descLines.length) {
            ctx.font = `${descSize}px Arial, sans-serif`;
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            descLines.forEach(function (line) {
                ctx.fillText(line, textX, y);
                y += descLineHeight;
            });
        }

        let dataUrl;
        try {
            dataUrl = canvas.toDataURL('image/png');
        } catch (error) {
            if (info.emojiImage) {
                // The image came from another origin without CORS headers and
                // tainted the canvas. Drop it and draw the text emoji instead.
                markEmojiImageUnusable(info.emojiImage.src);
                return buildImage(Object.assign({}, info, { emojiImage: null }));
            }
            console.warn('🏷️ POI signs: could not export the sign image', error);
            return null;
        }

        const result = {
            dataUrl: dataUrl,
            width: width,
            height: height
        };
        imageCache.set(cacheKey, result);
        if (imageCache.size > IMAGE_CACHE_LIMIT) {
            const oldest = imageCache.keys().next();
            if (!oldest.done) imageCache.delete(oldest.value);
        }
        return result;
    }

    window.poiSigns = {
        config: config,
        get categories() { return config.categories; },
        describe: describe,
        /** Rows of the zones a feature is inside (null outside every zone). */
        emojiZoneRows: emojiZoneRows,
        /** Reload the zone geojson files named in the CSV. */
        loadEmojiZones: loadEmojiZones,
        buildImage: buildImage,
        getLanguage: getLanguage,
        load: load,
        /** Rebuild every sign already in the scene (used by model_renderer). */
        refresh: function () { refreshAll(); },
        /** Trigger the renderer-side refresh after changing config by hand. */
        invalidateCache: function () { imageCache.clear(); refreshAll(); }
    };

    window.addEventListener('languageChanged', function (event) {
        const lang = event && event.detail && event.detail.language;
        requestedLanguage = null;
        load(lang || getLanguage());
    });

    // Start loading right away: signs are built synchronously from this data,
    // so by the time 3D is switched on the descriptions are usually in place.
    load();
})();
