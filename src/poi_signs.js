/**
 * POI signs — colored 3D plaques for named Points of Interest.
 *
 * A sign is created for NAMED features that carry one of CATEGORY_KEYS; a
 * feature without a name is never signed. It shows the emoji, the feature
 * name, the OSM tag, and the tag definition taken from the per-language
 * `taginfo_simple_<lang>.csv` (English used as fallback).
 *
 * Everything visual is configurable at runtime:
 *
 *   window.poiSigns.config.colors.amenity = '#ff0000';
 *   window.poiSigns.config.emoji['shop=bakery'] = '🥐';
 *   window.poiSigns.config.emoji.shop = '🛍️';
 *   window.poiSigns.config.showTag = false;
 *   window.poiSigns.refresh();          // rebuild the signs already in 3D
 *
 * A `window.poiSignConfig` declared before this script loads is merged in, so
 * colours and emojis can also be set without touching this file.
 */
(function () {
    'use strict';

    const CATEGORY_KEYS = ['amenity', 'tourism', 'leisure', 'shop', 'office'];

    const config = {
        // OSM keys that get a sign. Add keys here (e.g. 'historic') to make
        // signs for other families of features too; they use the default
        // colour unless an entry is added to `colors` as well.
        categories: CATEGORY_KEYS.slice(),

        // One colour per OSM key; `default` is used for any other key.
        colors: {
            amenity: '#c2410c',
            tourism: '#1d4ed8',
            leisure: '#15803d',
            shop: '#7e22ce',
            office: '#475569',
            default: '#0f766e'
        },

        // `key=value` wins over `key`. Edit this object at runtime to change
        // the emoji shown next to a sign.
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

            // Fallbacks per key
            amenity: '🏷️',
            tourism: '🧭',
            leisure: '🌳',
            shop: '🛍️',
            office: '💼',
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

    // Merge a user config declared before this script.
    (function mergeUserConfig() {
        const user = window.poiSignConfig;
        if (!user || typeof user !== 'object') return;
        if (Array.isArray(user.categories)) config.categories = user.categories.slice();
        if (user.colors) Object.assign(config.colors, user.colors);
        if (user.emoji) Object.assign(config.emoji, user.emoji);
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

    /** Load the current language (plus English fallback) and tell the renderer. */
    function load(language) {
        const lang = language || getLanguage();
        if (requestedLanguage === lang && definitionsByLanguage.has(lang)) return Promise.resolve();
        requestedLanguage = lang;
        const jobs = [loadDefinitions(lang)];
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
            if (value !== undefined && value !== null && String(value).trim() !== '') {
                return { key: key, value: String(value).trim() };
            }
        }
        return null;
    }

    function pickEmoji(key, value) {
        const emoji = config.emoji || {};
        return emoji[`${key}=${value}`] || emoji[key] || emoji.default || '📍';
    }

    function cleanText(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/\\t/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Describe a feature as a sign, or return null when it is not a POI.
     * @returns {{key:string,value:string,tag:string,name:string,emoji:string,
     *            color:string,description:string,language:string}|null}
     */
    function describe(feature) {
        const tags = getTags(feature);
        const category = pickCategory(tags);
        if (!category) return null;

        const language = getLanguage();
        const name = cleanText(
            tags[`name:${language}`] ||
            tags.name ||
            tags['name:en'] ||
            '');

        // Unnamed features get no sign: a plaque with only a tag and a
        // definition is noise, and the request is signs for named POIs.
        if (!name) return null;

        const tag = `${category.key}=${category.value}`;
        let description = cleanText(lookupDescription(tag, language));
        if (description === tag) description = '';
        if (description.length > config.maxDescriptionChars) {
            description = description.slice(0, config.maxDescriptionChars).replace(/\s+\S*$/, '') + '…';
        }

        return {
            key: category.key,
            value: category.value,
            tag: tag,
            name: name,
            emoji: pickEmoji(category.key, category.value),
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
     * Build (or reuse) the sign image.
     * @returns {{dataUrl:string,width:number,height:number}|null}
     */
    function buildImage(info) {
        if (!info) return null;
        const cacheKey = [
            info.color, info.emoji, info.name, info.tag, info.description,
            info.language, config.showTag, config.showDescription
        ].join('|');
        if (imageCache.has(cacheKey)) return imageCache.get(cacheKey);

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        const pad = 26;
        const emojiSize = 56;
        const nameSize = 40;
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
        const textHeight =
            nameLines.length * (nameSize + 6) +
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

        // Emoji, vertically centred with the text block
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        const textTop = pad;
        ctx.font = `${emojiSize}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", Arial, sans-serif`;
        ctx.fillStyle = '#ffffff';
        const emojiOffsetY = Math.max(emojiSize, textHeight) / 2 + emojiSize * 0.35;
        ctx.fillText(info.emoji, pad, textTop + emojiOffsetY);

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

        const result = {
            dataUrl: canvas.toDataURL('image/png'),
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
