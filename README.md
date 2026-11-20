# 3DModelsOSM

**Turn OpenStreetMap data into 3D models on a real 3D globe.**

3DModelsOSM is a web application that reads OpenStreetMap data and shows it as 3D objects on a 3D map. You can see real-world things like bus stops, traffic lights, trees, buildings, and landmarks rendered as 3D models, sitting on real terrain.

It runs entirely in your browser. There is no server to set up, no build step, no database. Just open the page and go.

## What you can do

- **See the map** — 2D maps from OpenStreetMap, satellite imagery, and 3D globe views with real terrain.
- **Search OpenStreetMap** — type a tag like `amenity=bus_stop` and see every matching object on the map.
- **View 3D models** — certain OSM objects automatically show as 3D models (a bus shelter, a tree, a traffic light, a recycling bin, and famous buildings like the Sagrada Familia).
- **Load your own data** — upload a GeoJSON file or download OSM data from the map.
- **Explore indoor** — check OSM indoor data to see inside buildings, by levels.
- **Explore terrain** — load a custom elevation map (GeoTIFF) to see how the 3D models sit on the ground.
- **Switch languages** — the interface is available in some languages.

## What's in the project

‘amenity=bicycle_parking’
‘amenity=motorcycle_parking’
‘amenity=parking_space’
‘amenity=parking’
‘amenity=parking’, ‘orientation=diagonal’
‘amenity=waste_basket’
‘area:barrier=kerb’
‘area:highway=cycleway’
‘area:highway=footway’
‘area:highway=footway’, ‘footway=crossing’
‘area:highway=footway’, ‘footway=sidewalk’
‘area:highway=residential’
‘barrier=kerb’
‘building’
‘building=residential’
‘footway=sidewalk’
‘highway=footway’
‘highway=residential’
‘highway=street_lamp’
‘highway=street_lamp’, ‘lamp_mount=straight_mast’
‘highway=track’
‘highway=traffic_signals’
‘highway=traffic_signals’, ‘traffic_signals=cyclist_crossing’
‘highway=traffic_signals’, ‘traffic_signals=pedestrian_crossing’
‘leisure=garden’
‘leisure=playground’
‘man_made=pole’
‘manhole=drain’
‘name=Casa Batlló’
‘name=La Pedrera’
‘name=Torre Mapfre’
‘natural=tree’
‘natural=wood’
‘parking_space=disabled’
‘recycling_type=container’
‘traffic_sign=ES:R101’
‘traffic_sign=ES:R2’
‘waterway=drain’
‘waterway=stream’
‘wikidata=Q1425790’
‘wikidata=Q207870’
‘wikidata=Q2689231’
‘wikidata=Q336246’
‘wikidata=Q48435’
‘wikidata=Q575953’

## License

This project is open source. See the `LICENSE` file for details (GPL 2.0).

## Built with

- [OpenLayers](https://openlayers.org) — the 2D map engine
- [CesiumJS](https://cesium.com) — the 3D globe and terrain
- [OpenStreetMap](https://www.openstreetmap.org) — the map data