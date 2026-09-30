/**
 * MODEL ORIENTATION
 * =================
 * Where a model turns to, and what it turns to.
 *
 * This is the one file to edit. Add a rule per kind of model; nothing else has
 * to change.
 *
 *   facing:  'toward'  the model turns to FACE the way, like a sunflower
 *                      turning to the sun. Two models standing on opposite
 *                      sides of the same street face OPPOSITE ways.
 *                      Use it for anything that watches or serves the street:
 *                      street lamps, bus shelters, benches, bins, sign posts.
 *
 *              'along'  the model points PARALLEL to the street, so everything
 *                      standing on one street shares a heading. Use it for
 *                      models that sit in the line of the street.
 *
 *              'none'   never turn the model. Use its `rotation` as authored.
 *                      For radially symmetric things (trees, hydrants).
 *
 *   against: which kind of way the model is oriented against. See WAY_CLASSES.
 *
 * Rules are matched in order; the first one whose tags all match wins. Rules
 * with more specific tags go ABOVE more general ones.
 *
 * To orient a model that has no rule yet, add one:
 *
 *   { tags: ['amenity=bench'], facing: 'toward', against: 'sidewalk' },
 *
 * `facing` and `against` are both optional; a missing `facing` means 'along',
 * a missing `against` means 'street' (the default hierarchy below).
 */
(function () {
    'use strict';
    if (typeof window === 'undefined') return;

    // ---------------------------------------------------------------------
    // Way classes: the kinds of way a model can be oriented against
    // ---------------------------------------------------------------------
    const WAY_CLASSES = {
        /** The road itself. Never a footway, a path or a cycleway. */
        carriageway: {
            highway: ['motorway', 'trunk', 'primary', 'secondary', 'tertiary',
                      'unclassified', 'residential', 'living_street', 'road', 'service']
        },
        /** The pavement a kerbside model stands on. */
        sidewalk: { footway: 'sidewalk' },
        /**
         * The pedestrian crossing a crossing signal marks.
         *
         * highway=footway + footway=crossing is the ONLY reliable form: the
         * bare `highway=crossing` nodes are untagged POINTS describing the
         * crossing, and buildIndex() only indexes LineStrings, so they never
         * appear here at all. They are kept below as a tolerated fallback for
         * data that does carry the way, but nothing should rely on them.
         */
        crossing: [
            { highway: 'footway', footway: 'crossing' },
            { highway: 'crossing' },
            { footway: 'crossing' }
        ],
        /** Cycle lanes. */
        cycleway: { highway: 'cycleway' },
        /** Park paths, tracks, steps — not streets. */
        path: { highway: ['path', 'track', 'steps', 'bridleway'] },
        /**
         * The default: any real street, ranked so a road always beats a
         * footpath, a kerb, a fence or a watercourse no matter which is nearer.
         */
        street: null      // handled by STREET_PRIORITY below
    };

    // Higher wins when several classes are within range. Only used to rank
    // ways that the `against` filter already let through.
    const STREET_PRIORITY = {
        motorway: 100, trunk: 100, primary: 100, secondary: 100, tertiary: 100,
        unclassified: 100, residential: 100, living_street: 100,
        road: 95, service: 90, pedestrian: 85, cycleway: 70,
        path: 60, track: 60, steps: 60, bridleway: 60
    };

    // ---------------------------------------------------------------------
    // THE RULES — edit these
    // ---------------------------------------------------------------------
    const RULES = [
        // --- street lamps: belong to the road, and must face it -----------
        { tags: ['highway=street_lamp', 'lamp_mount=straight_mast'],
          facing: 'toward', against: 'carriageway' },
        { tags: ['highway=street_lamp'],
          facing: 'toward', against: 'carriageway' },

        // --- shelters: open onto the road they serve ----------------------
        { tags: ['highway=bus_stop'],
          facing: 'toward', against: 'carriageway' },

        // --- traffic signals ---------------------------------------------
        // A signal HEAD is mounted at the kerb and aimed ACROSS the road at the
        // approaching lanes, so its face looks perpendicular to the direction of
        // travel: `toward` the carriageway centreline. That is the physical
        // truth for a plain vehicle signal, and it is also self-correcting —
        // wherever a real crossing exists it runs roughly perpendicular to the
        // street, so `toward/carriageway` and `along/crossing` agree to a few
        // degrees (measured: 1-7 deg on the four signals in this fixture).
        //
        // The previous `along/crossing` rule was only accidentally right. When
        // the nearest "crossing" the index found was a way running PARALLEL to
        // the road, `along` pointed the head down the street instead of across
        // it - off by 89-178 deg on 5 of the 9 signals here. `toward` ignores
        // which way the way is digitised, so it cannot be fooled that way.
        // NOTE: RULES is first-match-wins (resolveRule returns on the first
        // hit), so the SPECIFIC signal rules must stay ABOVE the generic
        // `highway=traffic_signals` one below. Put the plain rule first and it
        // swallows every pedestrian and cyclist signal, and they silently
        // inherit toward/carriageway.

        // --- pedestrian signals: ALONG the footway crossing -------------
        // These are the exception to the vehicle rule, and they got it wrong
        // when `toward` was applied here. A pedestrian head does NOT face the
        // road: it faces the pedestrian who is crossing, i.e. along the axis
        // they walk. So `along` the crossing is correct and `toward` is not.
        //
        // The failure mode is specific and worth recording: `toward` aims at
        // the crossing centreline, so which way it points depends purely on
        // which side of the crossing the signal happens to stand. Signals on
        // opposite kerbs came out ~180 deg apart, scattering one junction's
        // heads across 105/166/261/282/325 deg instead of sharing the crossing
        // axis. `along` ignores which side the signal is on and returns the
        // crossing's own axis, so every head at one crossing agrees.
        //
        // A pedestrian crossing is ALWAYS highway=footway + footway=crossing
        // (see WAY_CLASSES.crossing), which is why `against: 'crossing'` is
        // the right target and not the carriageway.
        { tags: ['highway=traffic_signals', 'traffic_signals=pedestrian_crossing'],
          facing: 'along', against: 'crossing' },
        // Same intent, other tag spelling seen in the wild. Cheap to accept
        // and stops a signal silently falling through to the vehicle rule.
        { tags: ['highway=traffic_signals', 'traffic_signals:signal=pedestrian'],
          facing: 'along', against: 'crossing' },

        // --- cyclist signals: ALONG the CYCLEWAY, not a crossing ---------
        // A cycle signal stands on the cycle lane and faces along it, in the
        // direction the rider is travelling. The geometry that defines it is
        // the cycleway (highway=cycleway), NOT a pedestrian footway crossing —
        // aiming at `crossing` put these heads on the footway axis, which is
        // the wrong road entirely whenever a crossing runs nearby.
        { tags: ['highway=traffic_signals', 'traffic_signals=cyclist_crossing'],
          facing: 'along', against: 'cycleway' },
        { tags: ['highway=traffic_signals', 'traffic_signals:signal=cyclist'],
          facing: 'along', against: 'cycleway' },

        // Plain vehicle signal: no crossing sub-tag, so aim at the road it
        // stands on. MUST come after the pedestrian/cyclist rules above.
        { tags: ['highway=traffic_signals'],
          facing: 'toward', against: 'carriageway' },

        // --- speed cameras watch traffic coming at them, so along ---------
        { tags: ['highway=speed_camera'],
          facing: 'along', against: 'carriageway' },

        // --- radially symmetric: turning them does nothing ----------------
        { tags: ['natural=tree'], facing: 'none' },
        { tags: ['man_made=pole'], facing: 'none' },
        { tags: ['power=tower'], facing: 'none' },

        // --- anything else on the street: parallel to it ------------------
        { tags: ['amenity=bench'], facing: 'along', against: 'sidewalk' },
        { tags: ['amenity=waste_basket'], facing: 'along', against: 'street' },
        { tags: ['amenity=post_box'], facing: 'along', against: 'street' }
    ];

    const DEFAULT_RULE = { facing: 'along', against: 'street' };

    // ---------------------------------------------------------------------
    // Rule lookup
    // ---------------------------------------------------------------------
    function tagsMatch(rule, tags) {
        if (!rule.tags || !rule.tags.length) return true;
        return rule.tags.every(pair => {
            const eq = pair.indexOf('=');
            if (eq === -1) return tags[pair] !== undefined;
            return tags[pair.slice(0, eq)] === pair.slice(eq + 1);
        });
    }

    // A `direction` tag is ALWAYS defined against the direction of travel of
    // the way the object belongs to (OSM: forward/backward/left/right are
    // relative to the way's digitisation, not to an arbitrary compass). So a
    // tagged object must be oriented `along` its street, whatever its own rule
    // says -- `forward` means "faces along the way", NOT "faces along whatever
    // the geometry rule decided".
    const DIRECTION_TAGS = ['direction', 'traffic_signals:direction'];

    function hasDirectionTag(tags) {
        if (!tags) return false;
        return DIRECTION_TAGS.some(k => typeof tags[k] === 'string' && tags[k].length > 0);
    }

    function resolveRule(tags) {
        for (const rule of RULES) {
            if (tagsMatch(rule, tags)) {
                // Direction tag present: it is authoritative and overrides the
                // geometry rule. Without this the offset was added to the
                // PERPENDICULAR bearing a `toward` rule produced, which put
                // every tagged signal 90 degrees out from the direction the
                // tag actually names.
                if (hasDirectionTag(tags)) {
                    // Keep the rule's OWN `against`. A direction tag is relative
                    // to the way the signal is attached to, and each rule
                    // already knows which way that is: a cyclist signal's way
                    // is the cycleway, a pedestrian signal's is the footway
                    // crossing, a plain signal's is the road. Forcing all of
                    // them onto `carriageway` threw the cyclist and pedestrian
                    // ones onto the wrong way whenever a road ran nearby.
                    return {
                        facing: 'along',
                        against: rule.against || DEFAULT_RULE.against
                    };
                }
                return {
                    facing: rule.facing || DEFAULT_RULE.facing,
                    against: rule.against || DEFAULT_RULE.against
                };
            }
        }
        if (hasDirectionTag(tags)) return { facing: 'along', against: 'carriageway' };
        return { facing: DEFAULT_RULE.facing, against: DEFAULT_RULE.against };
    }

    function wayMatchesClass(tags, className) {
        const spec = WAY_CLASSES[className];
        if (spec === null || spec === undefined) return true;   // 'street': any way
        const specs = Array.isArray(spec) ? spec : [spec];
        return specs.some(s => Object.keys(s).every(key => {
            const wanted = s[key];
            const actual = tags ? tags[key] : undefined;
            return Array.isArray(wanted) ? wanted.indexOf(actual) !== -1 : actual === wanted;
        }));
    }

    function wayPriority(tags) {
        if (!tags) return 10;
        const highway = tags['highway'];
        if (highway === 'footway') {
            if (tags['footway'] === 'sidewalk') return 88;
            if (tags['footway'] === 'crossing') return 86;
        }
        if (tags['barrier'] === 'kerb' || tags['kerb']) return 78;
        if (tags['waterway']) return 30;
        if (tags['barrier']) return 40;
        if (highway && Object.prototype.hasOwnProperty.call(STREET_PRIORITY, highway)) {
            return STREET_PRIORITY[highway];
        }
        return highway ? 50 : 10;
    }

    // ---------------------------------------------------------------------
    // Geometry (lon/lat throughout)
    // ---------------------------------------------------------------------
    function segmentLength(a, b) {
        const kx = 111320.0 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
        return Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * 110540.0);
    }

    /**
     * Distance from a point to a segment, the segment's own direction, and the
     * direction from the point TOWARDS the segment (for facing: 'toward').
     */
    function pointToSegment(point, a, b) {
        const kx = 111320.0 * Math.cos(point[1] * Math.PI / 180);
        const ky = 110540.0;
        const ax = (a[0] - point[0]) * kx, ay = (a[1] - point[1]) * ky;
        const bx = (b[0] - point[0]) * kx, by = (b[1] - point[1]) * ky;
        const dx = bx - ax, dy = by - ay;
        const lenSq = dx * dx + dy * dy;
        const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lenSq));
        const ox = ax + t * dx, oy = ay + t * dy;
        return {
            distance: Math.hypot(ox, oy),
            along: Math.atan2(dx, dy),
            toward: (ox || oy) ? Math.atan2(ox, oy) : null
        };
    }

    function angleBetween(a, b) {
        let d = Math.abs(a - b) % (2 * Math.PI);
        if (d > Math.PI) d = 2 * Math.PI - d;
        return d;
    }

    /** Angle between two UNDIRECTED lines, 0..PI/2. A street is a line, not a ray. */
    function axisDelta(a, b) {
        const d = angleBetween(a, b) % Math.PI;
        return d > Math.PI / 2 ? Math.PI - d : d;
    }

    function wayDirection(coords) {
        const a = coords[0], b = coords[coords.length - 1];
        const kx = 111320.0 * Math.cos(a[1] * Math.PI / 180);
        const dx = (b[0] - a[0]) * kx, dy = (b[1] - a[1]) * 110540.0;
        if (Math.hypot(dx, dy) > 1) return Math.atan2(dx, dy);
        let bestLen = -1, bestAng = 0;                    // closed way: longest segment
        for (let i = 0; i < coords.length - 1; i++) {
            const len = segmentLength(coords[i], coords[i + 1]);
            if (len > bestLen) {
                bestLen = len;
                bestAng = pointToSegment(coords[i], coords[i], coords[i + 1]).along;
            }
        }
        return bestAng;
    }

    function sampleWay(coords, step) {
        const out = [];
        let carry = 0;
        for (let i = 0; i < coords.length - 1; i++) {
            const a = coords[i], b = coords[i + 1];
            const L = segmentLength(a, b);
            let t = 0;
            while (carry + (L - t) >= step) {
                t += step - carry;
                const f = t / L;
                out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
                carry = 0;
            }
            carry += L - t;
        }
        return out;
    }

    function distanceToWay(point, coords) {
        let best = Infinity;
        for (let i = 0; i < coords.length - 1; i++) {
            const d = pointToSegment(point, coords[i], coords[i + 1]).distance;
            if (d < best) best = d;
        }
        return best;
    }

    // ---------------------------------------------------------------------
    // Street index — built once per layer, not once per model
    // ---------------------------------------------------------------------
    let _cache = { features: null, tolerance: null, index: null };

    function buildIndex(allFeatures, tolerance) {
        const index = [];
        const seen = new Set();
        const projection = window.map.getView().getProjection();

        for (const feature of allFeatures) {
            if (!feature || seen.has(feature)) continue;
            seen.add(feature);
            const geometry = feature.getGeometry ? feature.getGeometry() : null;
            if (!geometry || geometry.getType() !== 'LineString') continue;
            const raw = geometry.getCoordinates();
            if (!raw || raw.length < 2) continue;

            const tags = feature.getProperties ? feature.getProperties() : {};
            const coords = raw.map(c => ol.proj.transform(c, projection, 'EPSG:4326'));
            let length = 0;
            for (let i = 0; i < coords.length - 1; i++) length += segmentLength(coords[i], coords[i + 1]);
            index.push({
                feature, tags, coords, length,
                priority: wayPriority(tags),
                direction: wayDirection(coords),
                samples: sampleWay(coords, 8),
                flip: false, representative: -1
            });
        }

        // Collapse ways that are the same street into one entry.
        //
        // A street reaches a model in two shapes and BOTH flip models 180 deg
        // apart if ignored:
        //   (a) duplicate copies — the same line drawn twice;
        //   (b) contiguous arms — one street split at a junction into several
        //       ways, which is how OSM stores long streets, and the arms are
        //       routinely digitised in opposite directions.
        // Both are compared WAY-TO-WAY. Comparing them to the model instead
        // (e.g. "closest way wins, break ties by length") let a longer street
        // at a junction take the model away from the street it stands on.
        const parent = index.map((_, i) => i);
        const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
        const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };

        const tested = new Set();
        const test = (i, j) => {
            if (i === j || index[i].priority !== index[j].priority) return;
            const key = i < j ? i + '|' + j : j + '|' + i;
            if (tested.has(key)) return;
            tested.add(key);

            const a = index[i], b = index[j];
            // Collinear only. This is what stops two streets crossing at a
            // junction from merging, and what stops a short stub from being
            // absorbed by the crossing street it merely touches.
            if (axisDelta(a.direction, b.direction) > 0.35) return;   // ~20 degrees

            for (const v of a.coords) {
                if (distanceToWay(v, b.coords) <= tolerance) { union(i, j); return; }
            }
            for (const v of b.coords) {
                if (distanceToWay(v, a.coords) <= tolerance) { union(i, j); return; }
            }
            const short = a.length <= b.length ? a : b;
            const long = a.length <= b.length ? b : a;
            if (!short.samples.length) return;
            let hits = 0;
            for (const p of short.samples) {
                if (distanceToWay(p, long.coords) <= tolerance) hits++;
            }
            if (hits / short.samples.length >= 0.5) union(i, j);
        };

        // Coarse grid so this stays near-linear rather than O(n^2) per layer.
        const CELL = 0.001, cells = new Map(), oversized = [];
        for (let i = 0; i < index.length; i++) {
            const xs = index[i].coords.map(c => c[0]), ys = index[i].coords.map(c => c[1]);
            const x0 = Math.floor((Math.min.apply(null, xs) - tolerance) / CELL);
            const x1 = Math.floor((Math.max.apply(null, xs) + tolerance) / CELL);
            const y0 = Math.floor((Math.min.apply(null, ys) - tolerance) / CELL);
            const y1 = Math.floor((Math.max.apply(null, ys) + tolerance) / CELL);
            if ((x1 - x0 + 1) * (y1 - y0 + 1) > 256) { oversized.push(i); continue; }
            for (let x = x0; x <= x1; x++) {
                for (let y = y0; y <= y1; y++) {
                    const k = x + ':' + y;
                    if (!cells.has(k)) cells.set(k, []);
                    cells.get(k).push(i);
                }
            }
        }
        for (const bucket of cells.values()) {
            for (let a = 0; a < bucket.length; a++) {
                for (let b = a + 1; b < bucket.length; b++) test(bucket[a], bucket[b]);
            }
        }
        for (const i of oversized) for (let j = 0; j < index.length; j++) test(i, j);

        // One representative per street: the longest, so every model on that
        // street lands on the same copy.
        const best = new Map();
        for (let i = 0; i < index.length; i++) {
            const root = find(i), cur = best.get(root);
            if (cur === undefined) { best.set(root, i); continue; }
            const a = index[cur], b = index[i];
            if (b.length > a.length ||
                (b.length === a.length && String(b.feature.getId()) < String(a.feature.getId()))) {
                best.set(root, i);
            }
        }
        const reps = index.map((_, i) => best.get(find(i)));
        index.forEach((w, i) => { w.representative = reps[i]; });

        // A street has ONE direction. Arms drawn the other way are marked, and
        // the mark is per WAY so a curve inside a way is still followed.
        index.forEach((w, i) => {
            w.flip = angleBetween(w.direction, index[reps[i]].direction) > Math.PI / 2;
        });
        return index;
    }

    function getIndex(allFeatures, tolerance) {
        if (_cache.features === allFeatures && _cache.tolerance === tolerance) return _cache.index;
        const index = buildIndex(allFeatures, tolerance);
        _cache = { features: allFeatures, tolerance, index };
        return index;
    }

    // ---------------------------------------------------------------------
    // The bearing a model should be rotated by
    // ---------------------------------------------------------------------
    /**
     * @param {Array<number>} pointLonLat
     * @param {Array} allFeatures     features of the layer to search
     * @param {{facing?:string, against?:string, radius?:number}} [options]
     * @returns {{bearing:number, distance:number, way:object}|null} radians
     */
    function bearingFor(pointLonLat, allFeatures, options) {
        const opts = options || {};
        if (!pointLonLat || !allFeatures || !allFeatures.length) return null;
        const facing = opts.facing || 'along';
        if (facing === 'none') return null;
        const radius = opts.radius || 25;                 // metres
        const index = getIndex(allFeatures, 3);
        if (!index.length) return null;

        // One entry per distinct street; distance is the minimum over all of
        // that street's ways, never the representative's alone.
        const byStreet = new Map();
        for (const way of index) {
            if (!wayMatchesClass(way.tags, opts.against || 'street')) continue;
            let best = null;
            for (let i = 0; i < way.coords.length - 1; i++) {
                const seg = pointToSegment(pointLonLat, way.coords[i], way.coords[i + 1]);
                if (!best || seg.distance < best.distance) best = seg;
            }
            if (!best) continue;

            let bearing;
            if (facing === 'toward') {
                if (best.toward === null) continue;        // standing on the way
                bearing = best.toward;                    // no flip: the offset
            } else {                                      // 'along'
                bearing = way.flip
                    ? (best.along + Math.PI) % (2 * Math.PI)
                    : best.along;
            }

            const entry = byStreet.get(way.representative);
            if (!entry) {
                byStreet.set(way.representative, { way, distance: best.distance, bearing });
            } else if (best.distance < entry.distance) {
                entry.distance = best.distance;
                entry.bearing = bearing;
            }
        }
        if (!byStreet.size) return null;

        const candidates = [];
        for (const entry of byStreet.values()) {
            if (entry.distance <= radius) candidates.push(entry);
        }
        if (!candidates.length) return null;

        const top = candidates.reduce((m, c) => Math.max(m, c.way.priority), 0);
        const tier = candidates.filter(c => c.way.priority === top);
        tier.sort((a, b) => a.distance - b.distance);    // nearest street wins
        const chosen = tier[0];
        return { bearing: chosen.bearing, distance: chosen.distance, way: chosen.way.feature };
    }

    window.modelOrientation = {
        RULES, WAY_CLASSES, DEFAULT_RULE,
        resolveRule, wayMatchesClass, wayPriority,
        hasDirectionTag,
        bearingFor
    };
})();
