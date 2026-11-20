# 3DModelsOSM

**Turn OpenStreetMap data into 3D models on a real 3D globe.**

3DModelsOSM is a web application that reads OpenStreetMap data and shows it as 3D objects on a 3D map. You can see real-world things like bus stops, traffic lights, trees, buildings, and landmarks rendered as 3D models, sitting on real terrain.

It runs entirely in your browser. There is no server to set up, no build step, no database. Just open the page and go.

## What you can do

- **See the map** — 2D maps from OpenStreetMap, satellite imagery, and 3D globe views with real terrain.
- **Search OpenStreetMap** — type a tag like `amenity=bus_stop` and see every matching object on the map.
- **View 3D models** — certain OSM objects automatically show as 3D models (a bus shelter, a tree, a traffic light, a recycling bin, and famous buildings like the Sagrada Familia).
- **Load your own data** — upload a GeoJSON file or download OSM data from the map.
- **Explore terrain** — load a custom elevation map (GeoTIFF) to see how the 3D models sit on the ground.
- **Switch languages** — the interface is available in 11 languages.

## How to run it

### Option 1 — GitHub Pages (easiest)

1. Fork this repository on GitHub.
2. Go to **Settings → Pages**.
3. Set **Source** to deploy from the **main** branch.
4. Wait a couple of minutes and your site will be live.

No configuration needed. Everything runs in the browser.

### Option 2 — Run locally

1. Clone the repository.
2. Open a terminal in the project folder and run:

```bash
python serve_dev.py
```

3. Open the address it prints (usually `http://localhost:8000/3dmodelsosm/`).

That's it. The page loads and the map appears.

### Option 3 — Any web server

Copy the whole project folder to any web hosting provider (Netlify, Vercel, Cloudflare Pages, or your own server). The app is just static files — HTML, JavaScript, CSS, and model files. Nothing is compiled.

## What's in the project

The main files are:

- `index.html` — the main page that loads everything.
- `src/index.js` — the main application code.
- `src/config.js` — settings for the map, languages, and API keys.
- `src/models.js` — tells the app which 3D model to show for each OpenStreetMap tag.
- `src/model_renderer.js` — renders the 3D models on the map.
- `src/line_repetition.js` and `src/area_repetition.js` — repeat models along roads and fill areas with textures.
- `src/i18n/` — translation files for 11 languages.
- `src/models/` — the 3D model files (GLB and GLTF format).
- `src/css/` — the stylesheets.

There are also helper scripts in `scripts/` for downloading tag data and managing translations, but you don't need them to run the app.

## Settings

If you want street-level imagery (Mapillary), you need to add your own API key. Open `src/config.js`, find the line that says `apiKeys.mapillary`, and replace the value with your token. You can get a free token at [mapillary.com/developer](https://www.mapillary.com/developer).

Everything else works out of the box.

## How to add a new 3D model

1. Put your model file (GLB or GLTF) in the `src/models/` folder.
2. Open `src/models.js`.
3. Add a new line that connects an OpenStreetMap tag to your model. For example:

```javascript
{ tags: ['amenity=bench'], model: 'my_bench.glb', geometryType: 'point',
  config: { scale: 1.0, heightOffset: 0.0, rotation: [0, 0, 0] } },
```

4. Save the file and refresh the browser.

The model will now appear automatically wherever that tag exists on the map.

## License

This project is open source. See the `LICENSE` file for details (GPL 2.0).

## Built with

- [OpenLayers](https://openlayers.org) — the 2D map engine
- [CesiumJS](https://cesium.com) — the 3D globe and terrain
- [OpenStreetMap](https://www.openstreetmap.org) — the map data