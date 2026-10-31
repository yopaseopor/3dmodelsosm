// Measures the primitive EXPLOSION a >1MB GeoJSON actually causes, on the real
// fixtures, using the real config table out of area_repetition.js.
//
// Two numbers matter:
//   * polygon_texture  -> ONE Cesium GroundPrimitive + ONE canvas (up to
//                         2048x2048) per area, never tracked, never released.
//   * gridded          -> floor(w/spacing) * floor(h/spacing) separate GLTF
//                         primitives per area, capped by maxModels.
//
// Read-only analysis; nothing here is imported by the app.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

function readAreaTable() {
    // Strip block comments first: the top of area_repetition.js holds a big
    // /*...*/ of disabled configs, and a naive regex happily reads THAT table.
    const src = fs.readFileSync(path.join(SRC, 'area_repetition.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    const entries = [];
    const re = /tags:\s*\[([^\]]*)\]\s*,\s*model:\s*'([^']*)'\s*,\s*config:\s*\{[^}]*\}\s*,\s*spacing:\s*([\d.]+)\s*,\s*(?:\/\/[^\n]*\n\s*)*maxModels:\s*(\d+)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        const tags = m[1].split(',')
            .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean)
            .map(s => s.split('='));
        entries.push({ tags, model: m[2], spacing: parseFloat(m[3]), maxModels: parseInt(m[4], 10) });
    }
    return entries;
}

function matchConfig(table, tags) {
    for (const cfg of table) {
        if (cfg.tags[0][0] === '*') continue;
        const all = cfg.tags.every(([k, v]) => {
            let tv = tags[k];
            if (tv === undefined && k.indexOf('area:') === 0 && tags['area'] === 'yes') tv = tags[k.slice(5)];
            return tv === v;
        });
        if (all) return cfg;
    }
    return table.find(c => c.tags[0][0] === '*') || null;
}

// Return a flat list of coordinate rings (each ring = array of [lon,lat]).
function ringsOf(geom) {
    if (geom.type === 'Polygon') return geom.coordinates;              // [ring, ...]
    if (geom.type === 'MultiPolygon') {
        const out = [];
        for (const poly of geom.coordinates) for (const ring of poly) out.push(ring);
        return out;
    }
    return [];
}

function extentMetres(rings) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const ring of rings) for (const c of ring) {
        if (c[0] < minX) minX = c[0]; if (c[0] > maxX) maxX = c[0];
        if (c[1] < minY) minY = c[1]; if (c[1] > maxY) maxY = c[1];
    }
    const lat = (minY + maxY) / 2;
    const mLon = 111320 * Math.cos(lat * Math.PI / 180);
    return { w: (maxX - minX) * mLon, h: (maxY - minY) * 111320, lat };
}

const table = readAreaTable();
const files = process.argv.slice(2);
if (!files.length) files.push('pedrola.geojson', 'paris.geojson', 'berlin.geojson');

console.log('area_repetition.js configs parsed: ' + table.length);
for (const name of files) {
    const full = path.isAbsolute(name) ? name : path.join(SRC, name);
    const raw = fs.readFileSync(full, 'utf8');
    const feats = (JSON.parse(raw).features) || [];
    let areas = 0, textures = 0, gridModels = 0, capped = 0;
    const worst = [];
    for (const f of feats) {
        const rings = ringsOf(f.geometry || {});
        if (!rings.length) continue;
        areas++;
        const cfg = matchConfig(table, f.properties || {});
        if (!cfg) continue;
        if (/\.(png|jpe?g)$/i.test(cfg.model)) { textures++; continue; }
        const { w, h } = extentMetres(rings);
        const cols = Math.max(0, Math.floor(w / cfg.spacing));
        const rows = Math.max(0, Math.floor(h / cfg.spacing));
        const n = Math.min(cols * rows, cfg.maxModels);
        if (cols * rows > cfg.maxModels) capped++;
        gridModels += n;
        worst.push([f.properties && (f.properties.highway || f.properties.amenity || f.properties.manhole), Math.round(w), Math.round(h), cfg.spacing, n]);
    }
    worst.sort((a, b) => b[4] - a[4]);
    console.log(
        `\n${name}  ${(raw.length / 1048576).toFixed(2)}MB  features=${feats.length}\n` +
        `  areas                 : ${areas}\n` +
        `  -> polygon_texture    : ${textures}   (1 GroundPrimitive + 1 canvas each, untracked)\n` +
        `  -> gridded GLTF prims : ${gridModels}   (${capped} areas hit maxModels)\n` +
        `  TOTAL Cesium prims    : ${gridModels + textures}`
    );
    console.log('  worst areas (tag, w m, h m, spacing m, prims): ' +
        JSON.stringify(worst.slice(0, 6)));
}