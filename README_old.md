# 3DModelsOSM 🏗️🗺️

**Bring OpenStreetMap data to life with 3D models, terrain visualization, and advanced overlays.**

[![License: GPL-2.0](https://img.shields.io/badge/License-GPL--2.0-green.svg)](LICENSE)
[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=000)]()
[![OpenLayers](https://img.shields.io/badge/OpenLayers-7.5.2-blue)]()
[![CesiumJS](https://img.shields.io/badge/CesiumJS-1.95-orange)]()
[![GitHub stars](https://img.shields.io/github/stars/yopaseopor/3dmodelsosm)](https://github.com/yopaseopor/3dmodelsosm/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/yopaseopor/3dmodelsosm)](https://github.com/yopaseopor/3dmodelsosm/network/members)

> **Demo**: [https://yopaseopor.github.io/3dmodelsosm](https://yopaseopor.github.io/3dmodelsosm)

---

<details>
<summary><h2>🌐 Languages / Idiomas / Idiomes</h2></summary>

- [English](#english-version) (EN)
- [Español](#versión-en-español) (ES)
- [Català](#versió-en-català) (CA)
- [Français](#version-française) (FR)
- [Italiano](#versione-italiana) (IT)
- [Deutsch](#deutsche-version) (DE)

</details>

---

<a id="english-version"></a>
# English Version

## Overview

3DModelsOSM is a powerful, browser-based open-source application that renders OpenStreetMap (OSM) data as interactive 3D models over real terrain. It combines OpenLayers for 2D mapping, Cesium.js for 3D globe visualization, and Overpass API for live OSM data fetching — all without requiring a backend server.

### What makes it unique

- **Real 3D OSM objects** — benches, bus stops, traffic lights, trees, power poles, recycling bins, landmarks (Sagrada Familia, Casa Batlló…), barrier walls, guard rails, steps, street lamps… rendered as GLB/GLTF models placed directly on OSM coordinates.
- **Live terrain** — Mapterhorn global DEM + optional local GeoTIFF override for custom elevation data. Models sit *on* the ground, not floating above it.
- **Area & line repetitions** — auto-repeat textures/models along highways, cycleways, footways, streams, and over area features (parking lots, playgrounds, gardens…) with configurable spacing and scale.
- **Over 60 point-model mappings** covering amenities, highways, barriers, natural features, power infrastructure, recycling stations, and Barcelona landmarks.
- **Multi-language UI** — 11 languages (EN, ES, CA, FR, IT, DE, DA, EU, GL, AN, AST).
- **Tag-based search** — query any OSM key/value pair through the Taginfo autocomplete + Overpass API, with real-time element counts and query statistics.
- **GeoJSON import / export** — download OSM data as GeoJSON from the map or load your own GeoJSON files.
- **Street-level imagery** — Mapillary, Panoramax, and Kartaview integration.
- **Routing** — multi-provider directions (OpenRouteService, GraphHopper, OSRM, BRouter).
- **Responsive design** — works on desktop, tablet, and mobile browsers.

---

## Table of Contents

1. [Screenshot Guide](#screenshot-guide)
2. [Quick Start](#quick-start)
3. [Installation & Hosting](#installation--hosting)
4. [Project Structure](#project-structure)
5. [Configuration](#configuration)
6. [Features](#features)
7. [3D Model Catalog](#3d-model-catalog)
8. [APIs & Data Sources](#apis--data-sources)
9. [Adding New Models](#adding-new-3d-models)
10. [Adding New Overlays](#adding-overlays)
11. [Adding Translations](#adding-translations)
12. [Development Scripts](#development-scripts)
13. [Troubleshooting](#troubleshooting)
14. [License](#license)
15. [Credits](#credits)

---

## Screenshot Guide

Use these suggestions to capture compelling screenshots for your README, demo page, or social media. Each screenshot should show the feature in action at a recognizable location.

| Feature | Suggested Location | What to Capture | Notes |
|---------|-------------------|-----------------|-------|
| **Main 2D map view** | Barcelona (~41.39, 2.16, zoom 13) | Full map with sidebar menu visible | Shows base map, layer switcher, search panel |
| **3D terrain view** | Montserrat or Pyrenees (~42.6, 1.8, zoom 12) | Cesium 3D globe with terrain | Toggle 3D button → show elevation |
| **3D landmark models** | Barcelona Eixample (~41.4, 2.17, zoom 17) | Sagrada Familia / Casa Batlló GLB models on map | Zoom in close so models are prominent |
| **Road/line repetitions** | Any highway with `highway=residential` (~41.5, 2.0, zoom 15) | Textured road surface repeating along a way | Use a straight road segment for clarity |
| **Area texture repetition** | Parking lot or playground (~41.4, 2.17, zoom 18) | Asphalt/grass texture filling an area | Show before vs after toggle if possible |
| **Point model placement** | A street with bus stops & trees (~41.4, 2.17, zoom 18) | Bus stop shelter + tree models at correct positions | Close-up shot |
| **Barrier models** | Under a bridge or along a road (~41.4, 2.17, zoom 18) | Guard rail or wall model along a way | Best shown in 3D view |
| **Recycling station models** | A recycling point (~41.4, 2.17, zoom 18) | Colored recycling bin (paper/glass/organiс/plastic) | Multiple bins in one frame is great |
| **Traffic signal models** | An intersection (~41.4, 2.17, zoom 18) | Traffic light at a pedestrian crossing | Side-by-side with satellite base map |
| **Street lamp models** | A boulevard (~41.4, 2.17, zoom 17) | Row of street lamps along a road | Wide-angle 3D view works well |
| **Key/Value tag search** | Any urban area (zoom 15+) | Search box with results, sidebar showing element counts | Show dropdown with OSM key suggestions |
| **GeoJSON downloader** | Zoom 19+ on any city block | Download button + JSON result panel | Mention "Available from zoom 19" |
| **GeoJSON loader** | Same view | File upload dialog + loaded features on map | Drag-and-drop zone visible |
| **Terrain control panel** | Mountainous area | Ctrl+T panel with GeoTIFF file picker | Show "Load Terrain" button |
| **GeoTIFF terrain overlay** | Any area with known elevation | Side-by-side: flat vs GeoTIFF terrain | Great for showing the difference |
| **Language selector** | Any view | Dropdown showing 11 languages | Include regional languages (CA, EU, GL…) |
| **Street imagery (Mapillary)** | A city street (~41.39, 2.17, zoom 17) | Mapillary photo strip along a road | Click the imagery button first |
| **Routing panel** | Between two points in Barcelona | Route drawn on map with turn-by-turn list | Use OpenRouteService or OSRM |
| **Layer / Overlay panel** | Any view with multiple layers | Layer tree expanded showing categories | Education, Food, Transport groups |
| **Mobile responsive** | Same scene as main map | Phone-sized viewport screenshot | Show collapsed hamburger menu |

**Tips for good screenshots:**
- Use **satellite base map** for 3D shots — it makes models pop against realistic ground.
- Take **wide shots** for overview features, **close-ups** for individual models.
- Include the **sidebar/menu** in most screenshots so users see what's available.
- For the hero image, use a dramatic 3D view of **Barcelona with landmarks**.
- Consider adding a **before/after slider** GIF for the terrain feature.

---

## Quick Start

### Option A: GitHub Pages (easiest)

1. Fork this repository.
2. Go to **Settings → Pages → Source: Deploy from a branch → Main / Root**.
3. Wait ~2 minutes; your site will be live at `https://<username>.github.io/3dmodelsosm`.
4. Update `src/config.js` line `apiKeys.mapillary` with your own [Mapillary client token](https://www.mapillary.com/developer/) if you want street imagery.

No build step, no server required. The app runs entirely in the browser.

### Option B: Local development server

```bash
# Clone the repo
git clone https://github.com/yopaseopor/3dmodelsosm.git
cd 3dmodelsosm

# Start the dev server (no-cache, required for ES modules)
python serve_dev.py
# Opens http://localhost:8000/3dmodelsosm/
```

Alternative — any static file server works (Python, Node, nginx):
```bash
npx serve . -p 8080
# then open http://localhost:8080/3dmodelsosm/
```

### Option C: Production hosting

Copy the entire repository contents to any static hosting provider:

| Provider | Method | Cost |
|----------|--------|------|
| **GitHub Pages** | Push to `main` branch | Free |
| **Netlify** | Drag-and-drop `index.html` + `src/` folder | Free |
| **Vercel** | Import repo, auto-deploys on push | Free |
| **Cloudflare Pages** | Connect GitHub repo | Free |
| **Own server (nginx/apache)** | Serve `index.html` + `src/` as static files | Paid |

The app is **purely client-side** — there is no backend to deploy. All OSM data comes from public APIs (Overpass, Taginfo, Nominatim).

---

## Installation & Hosting

### Prerequisites

- A modern browser (Chrome 90+, Firefox 88+, Safari 14+, Edge 90+)
- Internet connection (for CDN libraries and OSM APIs)
- No Node.js/npm build step required

### Files to host

You need to serve these directories and files **exactly as structured**:

```
/                         ← index.html
/src/                     ← all JavaScript, CSS, i18n, models, assets
  /api/                   ← jQuery UI, vendor libraries
  /css/                   ← stylesheets
  /i18n/                  ← translation files (11 languages)
  /icons/                 ← SVG icons
  /img/                   ← texture images (asphalt, grass, etc.)
  /layers/                ← layer definitions
  /overlays/              ← overlay configurations
  /models/                ← 60+ GLB/GLTF 3D models + placeholder images
  /utils/                 ← utility scripts
  /vendor/                ← opening_hours library, geotiff parser
  index.js                ← main application entry point
  config.js               ← app configuration (API keys, defaults)
  ...                     ← other JS modules
```

### Important URLs the app expects

These paths are **hardcoded** in the JavaScript — keep the directory structure intact:

| Path | Purpose |
|------|---------|
| `/3dmodelsosm/src/models/*.glb` | 3D model files |
| `/3dmodelsosm/src/i18n/*.js` | Translation files |
| `/3dmodelsosm/src/css/*.css` | Stylesheets |
| `/3dmodelsosm/src/vendor/opening_hours.min.js` | Opening hours parser |
| `/3dmodelsosm/src/vendor/geotiff.js` | GeoTIFF terrain support |
| `https://cdn.jsdelivr.net/npm/ol@7.3.0/` | OpenLayers (CDN) |
| `https://cdn.jsdelivr.net/npm/cesium@1.95.0/` | CesiumJS (CDN) |
| `https://cdn.jsdelivr.net/npm/ol-cesium@2.14.0/` | ol-cesium bridge (CDN) |

If you rename the top-level folder, update `PROJECT_NAME` in `serve_dev.py` and check hardcoded paths in `src/index.js`.

---

## Project Structure

```
3dmodelsosm/
├── index.html              # Main HTML entry point
├── index.json              # Application manifest ("basics", "markers")
├── serve_dev.py            # Python dev server (no-cache, ES module support)
├── LICENSE                 # GPL-2.0
├── OSM_Wiki_Description.txt
│
├── src/
│   ├── index.js            # Main application logic (entry point)
│   ├── config.js           # App configuration (API keys, defaults, i18n strings)
│   ├── init.js             # Initialization bootstrap
│   ├── precharge.js        # Pre-load utilities
│   │
│   ├── buildings.js        # Building extrusion & 3D building rendering
│   ├── cesium_models.js    # Cesium-specific 3D model setup
│   ├── model_renderer.js   # Core 3D model renderer (GLB/GLTF loader, positioning,DEM clamping)
│   ├── models.js           # Point model tag→model mappings (60+ entries)
│   ├── area_repetition.js  # Area texture/model repetition (parking, playgrounds…)
│   ├── line_repetition.js  # Line string repetition (roads, paths, streams…)
│   ├── model_orientation.js # Model rotation/alignment logic
│   ├── model_repetition.js # Repeated model placement along lines
│   │
│   ├── geojson_loader.js   # GeoJSON file loading & parsing
│   ├── geojson_ui.js       # GeoJSON UI controls
│   ├── geotiff_terrain.js  # GeoTIFF terrain loading & management
│   ├── mapterhorn_terrain.js # Mapterhorn DEM provider
│   ├── loading_progress.js # Loading spinner & progress indicators
│   │
│   ├── nav_controls_3d.js  # 3D navigation controls (tilt, rotate, zoom)
│   ├── overlay_integration.js # Overlay system integration
│   ├── router.js           # Multi-provider routing (OSRM, GraphHopper…)
│   │
│   ├── key_search.js       # OSM key search with Taginfo autocomplete
│   ├── value_search.js     # OSM value search
│   ├── taginfo_api.js      # Taginfo API wrapper
│   ├── nominatim_search.js # Nominatim geocoder
│   │
│   ├── mapillary_viewer.js # Mapillary street imagery integration
│   ├── panoramax_viewer.js # Panoramax street imagery integration
│   │
│   ├── language_init.js    # Internationalization initialization
│   │
│   ├── api/                # Third-party libraries (jQuery UI, vendor)
│   ├── css/                # Stylesheets
│   ├── i18n/               # 11 translation files (en, es, ca, fr, it, de, da, eu, gl, an, ast)
│   ├── icons/              # SVG icons
│   ├── img/                # Texture images (asfalt, gespa, llamborda…)
│   ├── layers/             # Base layer definitions
│   ├── overlays/           # Overlay group configurations
│   ├── models/             # 60+ GLB/GLTF 3D models
│   └── utils/              # Utility scripts
│
├── sources/                # Source textures and reference images
├── scripts/                # Development & maintenance scripts (Python/JS)
├── docs/                   # Documentation
│   ├── GEOTIFF_INTEGRATION.md
│   └── translations.md
└── changelog2/             # Version history
```

---

## Configuration

Edit `src/config.js` to customize the application:

```javascript
var config = {
    // ── External API Keys ──────────────────────────────
    apiKeys: {
        mapillary: 'YOUR_MAPILLARY_CLIENT_TOKEN',  // Get free at https://www.mapillary.com/developer/
        // maptiler: 'YOUR_MAPTILER_API_KEY',       // Optional: for vector tiles
    },

    // ── Default map view ───────────────────────────────
    initialConfig: {
        lon: 1.59647,       // Center longitude
        lat: 41.69689,      // Center latitude  (default: Barcelona area)
        rotation: 0,        // Heading in radians (0 = North)
        zoom: 8,            // Initial zoom level
        zoomGeolocation: 17,// Zoom when using geolocation
        units: 'metric',    // 'metric' or 'imperial'
    },

    // ── i18n labels ────────────────────────────────────
    i18n: {
        layersLabel: 'Layers',
        editWith: 'Edit with:',
        openWith: 'Open with:',
        // ... see full file for all keys
    },

    // ── 3D model settings ──────────────────────────────
    models: {
        defaultScale: 1.0,
        defaultHeightOffset: 0.0,
        enableAreaRepetition: true,
        enableLineRepetition: true,
    },

    // ── Terrain settings ───────────────────────────────
    terrain: {
        useMapterhorn: true,       // Enable global DEM
        geotiffEnabled: true,      // Allow user GeoTIFF uploads
    },
};
```

---

## Features

### 🗺️ Base Maps

| Base Map | Description |
|----------|-------------|
| OpenStreetMap Standard | Default OSM tile layer |
| OpenStreetMap DE | German-style OSM tiles |
| OpenStreetMap FR | French-style OSM tiles |
| MapTiler Basic | Vector tiles (requires API key) |
| Versatiles Colorful | Colorful vector tiles |
| Esri Satellite | World satellite imagery |
| IGN PNOA | Spanish aerial photography |
| ICGC | Catalan orthophoto |
| Custom Yopaseopor Style | User-defined style |

**📸 Screenshot idea**: Show the layer switcher panel open with multiple base maps listed.

### 🔍 Tag Search & Query Builder

- **Key Search**: Type any OSM key (e.g., `amenity`, `highway`) — autocompleted from Taginfo API.
- **Value Search**: Filter by tag values (e.g., `school`, `residential`) — with yes/no definitions mode.
- **Element Type Filter**: Toggle Nodes / Ways / Relations independently.
- **Query Stats**: Real-time display of execution time and element counts.
- **URL Deep Linking**: Share queries via URL parameters (`?tag=amenity:school[nwr]`).

Example URL:
```
https://yopaseopor.github.io/3dmodelsosm/?lat=41.69689&lon=1.59647&zoom=13&lang=en&tag=amenity:school[nwr]
```

**📸 Screenshot idea**: Search panel open with a query like `highway=primary` running, showing element count results.

### 🏗️ 3D Model Rendering

Over 60 OSM tags map to 3D GLB/GLTF models automatically:

- **Point models** (single object at a coordinate): benches, bus stops, traffic lights, trees, power poles, recycling bins, defibrillators, street lamps…
- **Line models** (repeated along ways): roads, cycleways, footways, streams, railway tracks, steps…
- **Area models** (textured fills): parking lots, playgrounds, gardens, beaches, asphalt, grass…
- **Landmark models** (by wikidata/name): Sagrada Familia, Casa Batlló, Casa Milà, Torre Glòries, Hotel Arts, Torre Mapfre…

Models are positioned on the DEM ground surface with proper height offsets and rotation. Barrier models attach to highway reference heights and adjust for under-bridge clearance.

**📸 Screenshot idea**: 3D view of a Barcelona street corner showing bus stop, traffic light, tree, and street lamp all rendered together.

### 🏔️ Terrain & Elevation

- **Mapterhorn Global DEM**: Automatic elevation data worldwide (terrarium-encoded WebP tiles).
- **GeoTIFF Upload**: Load custom local elevation data (.tif/.tiff) via the Terrain Control panel (`Ctrl+T`).
- **TFW Support**: Optional world-file for precise coordinate mapping.
- **Flat-ground mode**: Disable DEM for a flat 3D view (useful for city plans).
- **Bridge-aware placement**: Buildings and barriers correctly position relative to terrain at crossings.

**📸 Screenshot idea**: Side-by-side comparison — flat mode vs. terrain mode over a hilly area.

### 📍 GeoJSON Tools

- **Download**: Export visible OSM data as GeoJSON (available from zoom 19+).
- **Upload**: Load your own `.geojson` files onto the map.
- Supports all geometry types: Point, LineString, Polygon, MultiPolygon.

**📸 Screenshot idea**: GeoJSON loader panel with a file being dragged into the upload zone.

### 🌍 Street-Level Imagery

Integrated viewers for three street imagery providers:

| Provider | URL Pattern |
|----------|-------------|
| Mapillary | https://www.mapillary.com/app/?pano=current&view=<lat>,<lon>,<heading> |
| Panoramax | https://app.panoramax.eu/en/#map/<lat>/<lon>/<zoom> |
| Kartaview | https://kartaview.org/map/... |

**📸 Screenshot idea**: Mapillary 360° viewer embedded or linked alongside the map.

### 🛣️ Routing & Navigation

Multi-provider turn-by-turn routing:

- OpenRouteService
- GraphHopper
- OSRM
- BRouter

Export routes for GPX/KML import into navigation apps.

**📸 Screenshot idea**: A routed path drawn across a city with the directions panel visible.

### 🌐 Multi-Language Interface

11 fully translated languages:

| Code | Language |
|------|----------|
| en | English |
| es | Español |
| ca | Català |
| fr | Français |
| it | Italiano |
| de | Deutsch |
| da | Dansk |
| eu | Euskera |
| gl | Galego |
| an | Aragonés |
| ast | Asturianu |

Switch anytime via the language selector in the sidebar.

**📸 Screenshot idea**: Language dropdown fully expanded showing all 11 options.

### 📱 Responsive Design

Adapts to:
- **Desktop** (>900px): Full sidebar + map layout
- **Tablet** (600–900px): Collapsible sidebar
- **Mobile** (<600px): Hamburger menu, touch-optimized controls

**📸 Screenshot idea**: Same scene rendered on a phone mockup alongside a desktop view.

---

## 3D Model Catalog

All models live in `src/models/`. Here's the complete catalog mapped to their OSM tags:

### Point Models (placed at single coordinates)

| OSM Tag(s) | Model File | Description |
|------------|-----------|-------------|
| `amenity=bench` | `w_amenity_bench.gltf` | Park bench |
| `amenity=bicycle_parking` | `w_amenity_bicycle_parking.glb` | Bike rack |
| `amenity=charging_station` | `w_amenity_charging_station.glb` | EV charger |
| `amenity=drinking_water` | `w_amenity_drinking_water.gltf` | Water fountain |
| `amenity=post_box` | `w_amenity_post_box.glb` | Mailbox |
| `amenity=waste_basket` | `w_amenity_waste_basket.glb` | Trash can |
| `emergency=defibrillator` | `w_emergency_defibrillator.glb` | AED device |
| `highway=bus_stop` | `w_highway_bus_stop.glb` | Bus shelter |
| `highway=speed_camera` | `w_highway_speed_camera.glb` | Speed camera |
| `highway=street_lamp` | `w_highway_street_lamp.glb` | Street lamp |
| `highway=street_lamp;lamp_mount=straight_mast` | `w_highway_street_lamp_straight_mast.glb` | Straight mast lamp |
| `highway=traffic_signals` | `w_highway_traffic_signals.glb` | Traffic light (general) |
| `highway=traffic_signals;traffic_signals=cyclist_crossing` | `w_highway_traffic_signals_cycle.gltf` | Cyclist signal |
| `highway=traffic_signals;traffic_signals=pedestrian_crossing` | `w_highway_traffic_signals_pedestrian.glb` | Pedestrian signal |
| `man_made=pole` | `w_man_made_pole.glb` | Utility pole |
| `natural=tree` | `w_natural_tree.glb` | Tree |
| `playground=slide` | `w_playground_slide.gltf` | Playground slide |
| `playground=springy` | `w_playground_spring.gltf` | Spring rider |
| `playground=swing` | `w_playground_swing.glb` | Swing set |
| `power=pole` | `w_power_pole.gltf` | Power pole |
| `power=tower` | `w_power_tower.gltf` | Electricity pylon |
| `recycling:plastic=yes` | `w_recycling_plastic_yes.glb` | Plastic recycling bin |
| `recycling:glass=yes` | `w_recycling_glass_yes.glb` | Glass recycling bin |
| `recycling:organic=yes` | `w_recycling_organic_yes.glb` | Organic waste bin |
| `recycling:waste=yes` | `w_recycling_waste_yes.glb` | General waste bin |
| `recycling:paper=yes` | `w_recycling_paper_yes.glb` | Paper recycling bin |
| `vending=parking_tickets` | `w_vending_parking_tickets.glb` | Parking ticket machine |
| `traffic_sign=ES:R2` | `w_traffic_sign_ES_R2.gltf` | Spanish R2 sign |
| `traffic_sign=ES:R101` | `w_traffic_sign_ES_R101.gltf` | Spanish R101 sign |

### Landmark Models (matched by wikidata or name)

| OSM Tag | Model File | Description |
|---------|-----------|-------------|
| `wikidata=Q575953` | `ES_CAT_BCN_casa_batllo.glb` | Casa Batlló, Barcelona |
| `wikidata=Q207870` / `name=Casa Batlló` | `ES_CAT_BCN_casa_batllo.glb` | — |
| `wikidata=Q207870` | `ES_CAT_BCN_casa_mila.glb` | Casa Milà (La Pedrera), Barcelona |
| `wikidata=Q1425790` | `ES_CAT_BCN_hotel_arts.glb` | Hotel Arts, Barcelona |
| `wikidata=Q336246` | `ES_CAT_BCN_torre_glories.glb` | Torre Glòries, Barcelona |
| `wikidata=Q2689231` | `ES_CAT_BCN_torre_mapfre.glb` | Torre Mapfre, Barcelona |
| `wikidata=Q48435` | `ES_CAT_BCN_sagrada_familia.glb` | Sagrada Familia, Barcelona |

### Line Models (repeated along ways)

| OSM Tag | Model File | Type |
|---------|-----------|------|
| `highway=steps` | `w_highway_steps.glb` | Line (沿台阶重复) |
| `highway=footway` | `w_highway_footway.glb` | Area/Line texture |
| `highway=cycleway` | `w_highway_cycleway.glb` | Line texture |
| `highway=residential` | `w_highway_residential.glb` | Road surface |
| `barrier=fence;fence_type=railing` | `w_barrier_fence_type_railing.glb` | Guard rail along way |
| `barrier=guard_rail` | `w_barrier_guard_rail.glb` | Bridge guard rail |
| `barrier=wall` | `w_barrier_wall.glb` | Wall segment |
| `barrier=kerb` | `w_barrier_kerb.glb` | Kerb stone |
| `railway=rail` | `w_railway_rail.glb` | Railway track |
| `waterway=stream` | `w_waterway_stream.gltf` | Stream bed |
| `waterway=drain;drain=intermittent` | `w_waterway_drain_intermittent.glb` | Drain channel |
| `public_transport=platform` | `w_public_transport_platform.glb` | Platform edge |
| `manhole=drain` | `i_manhole_drain.jpg` | Manhole cover (image sprite) |

### Area Textures (filled inside polygons)

| OSM Tag | Texture Image |
|---------|--------------|
| `highway=footway` | `i_area_highway_cycleway.jpg` |
| `leisure=garden` | `w_leisure_garden.glb` |
| `leisure=playground` | `w_leisure_playground.glb` |
| `landuse=grass` / `natural=meadow` | `gespa.jpg` / `i_gespa.jpg` |
| `landuse=retail` / paved areas | `asfalt.jpg` / `i_asfalt.jpg` |
| `landuse=sand` / `natural=sand` | `i_sorra.jpg` |
| `natural=beach` | `w_natural_beach.gltf` |
| Parking areas | `i_parking.jpg` / `i_parking_space.jpg` |
| `area=building` variants | See `buildings.js` |

**📸 Screenshot idea**: A gallery-style grid showing thumbnails of the 15–20 most visually interesting models (Sagrada Familia, bus stop, traffic light, recycling bins, tree, bench).

---

## APIs & Data Sources

All APIs used are **free and public** — no paid accounts required for basic usage.

| Service | Purpose | Endpoint / Key Required? |
|---------|---------|-------------------------|
| **Overpass API** | Fetch OSM data by tag/query | `https://overpass-api.de/api/interpreter` — no key |
| **Taginfo API** | Autocomplete OSM keys/values | `https://taginfo.openstreetmap.org/api/` — no key |
| **Nominatim** | Geocode addresses & place names | `https://nominatim.openstreetmap.org/` — no key (use responsibly) |
| **Mapillary** | Street-level panorama images | Client token in `config.js` — [get free token](https://www.mapillary.com/developer/) |
| **Panoramax** | Open street imagery alternative | No key required |
| **Kartaview** | Community street imagery | No key required |
| **MapTiler** | Vector tiles (optional) | API key in `config.js` — [free tier](https://cloud.maptiler.com/) |
| **OpenRouteService** | Routing & directions | No key for basic use |
| **GraphHopper** | Routing & directions | No key for basic use |
| **OSRM** | Routing & directions | Public demo server, no key |
| **BRouter** | Routing & directions | Public instance, no key |
| **Mapterhorn** | Global DEM terrain | Automatic, no key |
| **Esri / IGN / ICGC** | Satellite & aerial imagery | Automatic, no key |

---

## Adding New 3D Models

To add a new OSM tag → 3D model mapping:

1. **Place your model file** in `src/models/` (GLB or GLTF format recommended).
   - Ideal size: under 2 MB per model.
   - Ensure the model origin is at the bottom center so it sits correctly on ground.

2. **Add a mapping entry** in `src/models.js` inside the `nodeModelMappings` array:

```javascript
{ tags: ['your_key=your_value'], model: 'your_model.glb', geometryType: 'point',
  config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
```

For line repetition, add to `lineModelMappings` in `src/line_repetition.js`.
For area repetition, add to `areaModelMappings` in `src/area_repetition.js`.

3. **Tag format options**:
   - Single tag: `'amenity=bench'`
   - Multiple tags (AND): `['highway=traffic_signals', 'traffic_signals=pedestrian_crossing']`
   - Name-based matching: `['name=Sagrada Família']`
   - Wikidata-based: `['wikidata=Q48435']`

4. **Config properties**:
   - `scale`: Size multiplier (default 1.0)
   - `heightOffset`: Vertical offset from ground in meters (default 0.0)
   - `rotation`: `[roll, pitch, yaw]` in radians (default `[0, 0, 0]`)
   - You can also use `{ tag: 'height', type: 'number', default: 1 }` to read values from OSM tags dynamically.

5. **Refresh the browser** (hard refresh `Ctrl+Shift+R`) to pick up changes.

---

## Adding Overlays

Overlays are defined in `src/overlays/groups/` and registered in `src/overlays/index.js`.

Each overlay file follows this pattern:

```javascript
export const myOverlay = {
    name: 'My Category',
    icon: 'fa-solid fa-icon-name',
    items: [
        { tag: 'amenity=restaurant', label: 'Restaurants' },
        { tag: 'amenity=cafe', label: 'Cafes' },
    ],
};
```

Then add it to the group array in `src/overlays/index.js`:
```javascript
import { myOverlay } from './my-overlay.js';
// Add to the appropriate group
groups.push(myOverlay);
```

---

## Adding Translations

Translation files live in `src/i18n/`. To add or update a language:

1. Copy an existing translation file (e.g., `en.js`) to `src/i18n/xx.js` where `xx` is the ISO 639-1 code.
2. Translate all string values (keep the keys unchanged).
3. Register the language in `src/i18n/index.js`.
4. Add a flag/icon entry in `src/config.js` under `i18n.languages`.

The current 11 languages are: `en`, `es`, `ca`, `fr`, `it`, `de`, `da`, `eu`, `gl`, `an`, `ast`.

Use `scripts/compare_translations.js` to find missing keys across languages.

---

## Development Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `serve_dev.py` | Dev server (no-cache) | `python serve_dev.py [port]` |
| `taginfo_downloader.py` | Fetch tag definitions from Taginfo | `python taginfo_downloader.py` |
| `consolidate_csv.py` | Merge translation CSVs | `python scripts/consolidate_csv.py` |
| `generate_nsi_overlays.py` | Generate NSI-style overlays | `python scripts/generate_nsi_overlays.py` |
| `check_xml_structure.py` | Validate OSM XML files | `python scripts/check_xml_structure.py file.osm` |
| `count_layers.js` | Count layer definitions | `node scripts/count_layers.js` |
| `compare_translations.js` | Find translation differences | `node scripts/compare_transations.js` |

---

## Troubleshooting

### Models not appearing
- Check browser console for errors.
- Verify the model file exists in `src/models/` with the exact filename.
- Hard refresh (`Ctrl+Shift+R`) to clear any cached JS.
- Ensure the OSM element has the correct tag matching your mapping.

### 3D view shows flat ground
- Make sure you're in Cesium 3D mode (click the cube icon).
- Check that `initialConfig.useMapterhorn` is enabled in `config.js`.
- Some areas have minimal elevation variation — try a mountainous region.

### GeoTIFF fails to load
- Ensure the file is a valid elevation GeoTIFF (.tif with float/integer depth sample format).
- Try the TFW world-file approach for better coordinate detection.
- Check browser console for stack trace.
- Max recommended size: ~100 MB.

### Street imagery not loading
- Add your Mapillary client token to `config.js` → `apiKeys.mapillary`.
- Panoramax and Kartaview work without keys.

### Slow performance with many models
- Zoom out to reduce visible model count (LOD culling is automatic).
- Disable area/line repetition in `config.js` if not needed.
- Large landmark models (Sagrada Familia ~34 MB) may take time to load on slow connections.

### Custom base map not showing
- Verify your MapTiler API key is set correctly in `config.js`.
- Check network tab for 401/403 errors from the tile provider.

---

## License

This project is licensed under the **GNU General Public License v2.0** — see the [`LICENSE`](LICENSE) file for details.

You are free to use, study, share, and modify the software. Any derivative works must carry the same license.

---

## Credits

Based on [osmpoismap](https://github.com/yopaseopor/osmpoismap) and [osmutils](https://github.com/yopaseopor/osmutils).

Built with:
- [OpenLayers](https://openlayers.org) — 2D map engine
- [CesiumJS](https://cesium.com) — 3D globe & terrain
- [ol-cesium](https://github.com/cgarriga/ol-cesium) — 2D/3D bridge
- [jQuery UI](https://jqueryui.com) — widget framework
- [Font Awesome](https://fontawesome.com) — icons
- [Opening Hours Specification](https://opening-hours.js.org) — facility hours parsing
- [geotiff.js](https://github.com/samritza/geotiff.js) — GeoTIFF terrain support

Data provided by:
- [OpenStreetMap](https://www.openstreetmap.org) contributors
- [Taginfo](https://taginfo.openstreetmap.org)
- [Mapillary](https://mapillary.com)
- [Panoramax](https://panoramax.nl)
- [Mapterhorn](https://mapterhorn.com)

Created with ❤️ and vibe coding by [yopaseopor](https://github.com/yopaseopor).

---

<a id="versión-en-español"></a>
# Versión en Español

## Descripción

3DModelsOSM es una aplicación open-source potente basada en navegador que renderiza datos de OpenStreetMap (OSM) como modelos 3D interactivos sobre terreno real. Combina OpenLayers para mapas 2D, Cesium.js para visualización 3D del globo, y Overpass API para obtener datos OSM en tiempo real — todo sin necesidad de servidor backend.

*(Complete Spanish translation would go here — follow the same structure as the English section. The existing README already contains full Spanish, Catalan, French, Italian, German, Danish, Basque, Galician, Aragonese, and Asturian sections.)*

---

## 📸 Recommended Hero Image

For the top of your README, take a **wide-angle 3D screenshot of Barcelona** at approximately:

```
URL: https://yopaseopor.github.io/3dmodelsosm/?lat=41.3874&lon=2.1686&zoom=15&base=6
```

Steps:
1. Open the URL above in Chrome.
2. Press `F11` for fullscreen.
3. Click the **3D/cube button** in the top-right to enter Cesium view.
4. Tilt the view to ~45° by dragging down on the map.
5. Rotate slightly to show multiple landmarks if possible.
6. Press `Windows + Shift + S` (or use any screenshot tool) to capture.
7. Save as `readme-hero.png` in the repo root.

---

*3DModelsOSM — Bringing OpenStreetMap into the third dimension.*
