/**
 * OSM Cat config
 */

// opening_hours loader: use local vendored file loaded synchronously from index.html.
// Resolve to the OpeningHours constructor (or the opening_hours factory) or reject if missing.
var openingHoursPromise = new Promise(function(resolve, reject) {
	function isAvailable() {
		return (typeof window.OpeningHours === 'function') || (typeof window.opening_hours === 'function');
	}

	if (isAvailable()) {
		resolve(window.OpeningHours || window.opening_hours);
		return;
	}

	// If not yet available (unexpected), wait briefly for synchronous include to execute.
	var waited = 0;
	var interval = setInterval(function() {
		if (isAvailable()) {
			clearInterval(interval);
			resolve(window.OpeningHours || window.opening_hours);
			return;
		}
		waited += 50;
		if (waited > 5000) {
			clearInterval(interval);
			reject(new Error('opening_hours library not available (expected local file at src/vendor/opening_hours.min.js)'));
		}
	}, 50);
});

//@@ Ruta de imágenes
var imgSrc = 'src/img/';

//@@Coordenadas LONgitud LATitud Rotación Zoom, Zoom de la geolocalización, unidades
var config = {
	//@@ API Keys for external services (add your own keys here)
	apiKeys: {
		mapillary: 'MLY|25184084394537227|a1d2ba8a7ad819e741b1949b288cb142', // Add your Mapillary API key here: 'your_mapillary_client_token'
	},
	initialConfig: {
		lon: 1.59647,
		lat: 41.69689,
		rotation: 0, //in radians (positive rotation clockwise, 0 means North)
		zoom: 8,
		zoomGeolocation: 17,
		units: 'metric'
	},
	i18n: {
		//@@ Textos entre comillas.
		layersLabel: 'Capas',
		completeWith: 'Completar con:',
		editWith: 'Editar con:',
		openWith: 'Abrir con:',
		showWith: 'Mostrar con:',
		show2With: 'Mostrar también con:',
		checkTools: 'Validar con:',
		copyDialog: 'S\'ha copiat l\'enllaç al porta-retalls.Enlace copiado. Link has been copied',
		nodeLabel: 'Nodo:',
		noNodesFound: 'No se ha encontrado información.',
		wayLabel: 'Vía:'
	},
	// Shared list of Overpass API servers (must match the selector in value_search.js)
	_overpassServers: [
		'https://overpass-api.de/api/interpreter',
		'https://overpass.kumi.systems/api/interpreter',
		'https://overpass.saltant.org/api/interpreter',
		'https://overpass.private.coffee/api/interpreter',
		'https://overpass.openstreetmap.fr/api/interpreter',
		'https://overpass.osm.ch/api/interpreter',
		'https://z.overpass-api.de/api/interpreter'
	],
	overpassApi: function(){
		// Try to get the server selected by the user from localStorage, or use the first one
		var servers = this._overpassServers;
		var currentServerIndex = parseInt(localStorage.getItem('overpassServerIndex') || '0');
		// Clamp to valid range
		if (currentServerIndex < 0 || currentServerIndex >= servers.length) {
			currentServerIndex = 0;
		}
		return servers[currentServerIndex];
	},
	overpassApiFallback: function() {
		// Get next available server for fallback when the current one fails
		var servers = this._overpassServers;
		var currentIndex = parseInt(localStorage.getItem('overpassServerIndex') || '0');
		var nextIndex = (currentIndex + 1) % servers.length;
		localStorage.setItem('overpassServerIndex', nextIndex.toString());

		console.log('Switching to Overpass server:', servers[nextIndex]);
		return servers[nextIndex];
	},
	//@@ Mapas de fondo
	layers: [
	new ol.layer.Tile({
			title: 'OpenStreetMap',
			iconSrc: imgSrc + 'icones_web/osm_logo-layer.svg',
			source: new ol.source.OSM()
		}),
				
		// MapTiler Basic - WORKING RENDERING
		(function() {
			const layer = new ol.layer.VectorTile({
				title: 'MapTiler Basic',
				iconSrc: imgSrc + 'icones_web/maptiler_logo.png',
				visible: false,
				opacity: 1.0,
				source: new ol.source.VectorTile({
					tilePixelRatio: 1,
					tileGrid: ol.tilegrid.createXYZ({minZoom: 0, maxZoom: 14}),
					format: new ol.format.MVT(),
					url: 'https://api.maptiler.com/tiles/v3/{z}/{x}/{y}.pbf?key=Faz9gJu55zrWejNF55oZ',
					attributions: [
						'<a href="https://www.maptiler.com/copyright/" target="_blank">MapTiler</a>',
						'<a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>'
					]
				}),
				style: createMapTilerBasicStyle()
			});

			console.log('MapTiler Basic layer loaded with roads, water, buildings, and city names!');
			return layer;
		})(),
		
		//Versatiles colorful
		(function() {
			const layer = new ol.layer.VectorTile({
				title: 'Versatiles colorful',
				iconSrc: imgSrc + 'icones_web/osm_logo-layer.svg',
				visible: false,
				opacity: 1.0,
				source: new ol.source.VectorTile({
					tilePixelRatio: 1,
					tileGrid: ol.tilegrid.createXYZ({minZoom: 0, maxZoom: 14}),
					format: new ol.format.MVT(),
					url: 'https://vector.openstreetmap.org/shortbread_v1/{z}/{x}/{y}.mvt',
					attributions: [
						'<a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>'
					]
				}),
				style: createVersatilesColorfulStyle()
			});

			console.log('Versatiles colorful layer loaded with vibrant land-use colors and comprehensive mapping!');
			return layer;
		})(),
		
	

		(function() {
			const layer = new ol.layer.VectorTile({
				title: 'OSM Customyopaseopor',
				iconSrc: imgSrc + 'icones_web/osm_logo-layer.svg',
				visible: false,
				opacity: 1.0,
				source: new ol.source.VectorTile({
					tilePixelRatio: 1,
					tileGrid: ol.tilegrid.createXYZ({minZoom: 0, maxZoom: 14}),
					format: new ol.format.MVT(),
					url: 'https://vector.openstreetmap.org/shortbread_v1/{z}/{x}/{y}.mvt',
					attributions: [
						'<a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>'
					]
				}),
				style: createCustomyopaseoporStyle()
			});

			console.log('OSM Customyopaseopor layer loaded with earth-tone sky-blue styling!');
			return layer;
		})(),
		

								new ol.layer.Tile({
/*@@ título */					title: 'OpenStreetMap DE',
/*@@ icono */					iconSrc: imgSrc + 'icones_web/osmbw_logo-layer.png',
/*@@ zoom máximo */				maxZoom: 18,
								source: new ol.source.XYZ({
/*@@ atribución */				attributions: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
/*@@ url */						url: 'https://{a-c}.tile.openstreetmap.de/{z}/{x}/{y}.png'
								}),
/*@@ visible de inicio */		visible: false
/*@@ final de copia */			}),
		new ol.layer.Tile({// OpenStreetMap France https://openstreetmap.fr
			title: 'OpenStreetMap FR',
			iconSrc: imgSrc + 'icones_web/osmfr_logo-layer.png',
			source: new ol.source.OSM({
				attributions: '&copy; <a href="https://www.openstreetmap.fr/" target="_blank">OpenStreetMap France</a>',
				url: 'https://{a-c}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png'
			}),
			visible: false
		}),
		new ol.layer.Tile({
			title: 'Esri Sat',
			iconSrc: imgSrc + 'icones_web/esri_logo_layer.png',
			source: new ol.source.XYZ({
				attributions: 'Map data &copy; <a href="https://www.openstreetmap.org/" target="_blank">OpenStreetMap Contributors</a>,Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
				url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
			}),
			visible: false
		}),
		new ol.layer.Tile({
			title: 'ES_IGN - PNOA - Actual',
			iconSrc: imgSrc + 'icones_web/logo_ign.png',
			source: new ol.source.TileWMS({
				attributions: 'Map data &copy; <a href="https://www.openstreetmap.org/" target="_blank">OpenStreetMap Contributors</a>,Tiles &copy; IGN &mdash; Source: IGN',
				url: 'https://www.ign.es/wms-inspire/pnoa-ma?',
				params: {'LAYERS': 'OI.OrthoimageCoverage', 'VERSION': '1.3.0'}
			}),
			visible: false
		}),
		
				new ol.layer.Tile({
			title: 'ES_CAT_ICGC - Actual',
			iconSrc: imgSrc + 'icones_web/logo_icgc.png',
			source: new ol.source.TileWMS({
				attributions: 'Map data &copy; <a href="https://www.openstreetmap.org/" target="_blank">OpenStreetMap Contributors</a>,Tiles &copy; ICGC &mdash; Source: ICGC',
				url: 'https://geoserveis.icgc.cat/servei/catalunya/orto-territorial/wms?',
				params: {'LAYERS': 'ortofoto_color_vigent', 'VERSION': '1.3.0'}
			}),
			visible: false
		})
	],
	/**
	* @type Array
	* Overlay
	* group: string nom del grup
	* title: string títol de la capa
	* query: string consulta tal como https://overpass-turbo.eu
	* iconSrc: string ruta de la imatge
	* style: function see https://openlayers.org/en/latest/apidoc/module-ol_style_Style-Style.html
	*/
	overlays: [



		
				
		
{
			group: 'Test',
			title: 'Supermercados',
			query: '(nwr["shop"="supermarket"]({{bbox}});node(w););out meta;',
			iconSrc: imgSrc + 'icones/maxspeed_empty.svg',
			iconStyle: 'background-color:rgba(255,255,255,0.4)',
style: function (feature) {
				var key_regex = /^name$/
				var name_key = feature.getKeys().filter(function(t){return t.match(key_regex)}).pop() || "name"
				var name = feature.get(name_key) || '';
				var fill = new ol.style.Fill({
					color: 'rgba(117,63,79,0.4)'
				});
				var stroke = new ol.style.Stroke({
					color: 'rgba(117,63,79,1)',
					width: 1
				});
				var style = new ol.style.Style({
					image: new ol.style.Icon({
							src: imgSrc + 'icones/maxspeed_empty.svg',
							scale:0.03
						}),
							text: new ol.style.Text({
								text: name,
								offsetX : 7,
								offsetY : -12,
								fill: new ol.style.Fill({
                            color: 'rgba(0,0,0,1)'
                        }),
						}),
					fill: fill,
					stroke: stroke
				});
				return style;
			}

/*@@ inicio-fin de copia */			},
/*   abrir */							{
    group: 'Test',
    title: 'Supermercados',
    query: '(nwr["shop"="supermarket"]({{bbox}});node(w););out meta;',
    iconSrc: imgSrc + 'icones/maxspeed_empty.svg',
    iconStyle: 'background-color:rgba(255,255,255,0.4)',
    style: function (feature) {
        var key_regex = /^name$/;
        var name_key = feature.getKeys().filter(function(t){return t.match(key_regex)}).pop() || "name";
        var name = feature.get(name_key) || '';
        var fill = new ol.style.Fill({
            color: 'rgba(117,63,79,0.4)'
        });
        var stroke = new ol.style.Stroke({
            color: 'rgba(117,63,79,1)',
            width: 1
        });
        // Get the geometry type
        var geom = feature.getGeometry();
        var isPolygon = geom.getType() === 'Polygon' || geom.getType() === 'MultiPolygon';
        
        var style = new ol.style.Style({
            image: new ol.style.Icon({
                src: imgSrc + 'icones/maxspeed_empty.svg',
                scale: 0.03
            }),
            text: new ol.style.Text({
                text: name,
              			
                fill: new ol.style.Fill({
                    color: 'rgba(0,0,0,1)'
                }),
                stroke: new ol.style.Stroke({
                    color: 'rgba(255,255,255,0.7)',
                    width: 2
                }),
                // For polygons, we'll use a different placement strategy
                placement: isPolygon ? 'point' : 'point',
				textAlign: 'center',
                textBaseline: 'bottom',
                offsetY: isPolygon ? -15 : 0, // Move text up for polygons
                overflow: true // Allow text to be rendered outside the view
            }),
            fill: fill,
            stroke: stroke
        });
        
        return style;
/*   cerrar */								}

/*@@ fin-inicio de copia */			},
/*   abrir */							{
    group: 'Overpass',
    title: 'All in a zone (z20)',
query: '(nwr({{bbox}});<;);out meta;',
    iconSrc: imgSrc + 'icones/maxspeed_empty.svg',
    iconStyle: 'background-color:rgba(255,255,255,0.4)',
    style: function (feature) {
        var key_regex = /^name$/;
        var name_key = feature.getKeys().filter(function(t){return t.match(key_regex)}).pop() || "name";
        var name = feature.get(name_key) || '';
        var fill = new ol.style.Fill({
            color: 'rgba(117,63,79,0.4)'
        });
        var stroke = new ol.style.Stroke({
            color: 'rgba(117,63,79,1)',
            width: 1
        });
        // Get the geometry type
        var geom = feature.getGeometry();
        var isPolygon = geom.getType() === 'Polygon' || geom.getType() === 'MultiPolygon';
        
        var style = new ol.style.Style({
            image: new ol.style.Icon({
                src: imgSrc + 'icones/maxspeed_empty.svg',
                scale: 0.03
            }),
            text: new ol.style.Text({
                text: name,
              			
                fill: new ol.style.Fill({
                    color: 'rgba(0,0,0,1)'
                }),
                stroke: new ol.style.Stroke({
                    color: 'rgba(255,255,255,0.7)',
                    width: 2
                }),
                // For polygons, we'll use a different placement strategy
                placement: isPolygon ? 'point' : 'point',
				textAlign: 'center',
                textBaseline: 'bottom',
                offsetY: isPolygon ? -15 : 0, // Move text up for polygons
                overflow: true // Allow text to be rendered outside the view
            }),
            fill: fill,
            stroke: stroke
        });
        
        return style;
/*   cerrar */								}

/*@@ fin-inicio de copia */			},
/*   abrir */							{
    group: 'Geojson',
    title: 'Test geojson (z20)',
geojson: '/3dmodelsosm/src/test.geojson',
    iconSrc: imgSrc + 'icones/maxspeed_empty.svg',
    iconStyle: 'background-color:rgba(255,255,255,0.4)',
    style: function (feature) {
        var key_regex = /^name$/;
        var name_key = feature.getKeys().filter(function(t){return t.match(key_regex)}).pop() || "name";
        var name = feature.get(name_key) || '';
        var fill = new ol.style.Fill({
            color: 'rgba(117,63,79,0.4)'
        });
        var stroke = new ol.style.Stroke({
            color: 'rgba(117,63,79,1)',
            width: 1
        });
        // Get the geometry type
        var geom = feature.getGeometry();
        var isPolygon = geom.getType() === 'Polygon' || geom.getType() === 'MultiPolygon';
        
        var style = new ol.style.Style({
            image: new ol.style.Icon({
                src: imgSrc + 'icones/maxspeed_empty.svg',
                scale: 0.03
            }),
            text: new ol.style.Text({
                text: name,
              			
                fill: new ol.style.Fill({
                    color: 'rgba(0,0,0,1)'
                }),
                stroke: new ol.style.Stroke({
                    color: 'rgba(255,255,255,0.7)',
                    width: 2
                }),
                // For polygons, we'll use a different placement strategy
                placement: isPolygon ? 'point' : 'point',
				textAlign: 'center',
                textBaseline: 'bottom',
                offsetY: isPolygon ? -15 : 0, // Move text up for polygons
                overflow: true // Allow text to be rendered outside the view
            }),
            fill: fill,
            stroke: stroke
        });
        
        return style;
/*   cerrar */								}

/*@@ fin-inicio de copia */			},
/*   abrir */							{
    group: 'Geojson',
    title: 'ES_CAT_BCN geojson',
geojson: './src/bcn1.geojson',
    iconSrc: imgSrc + 'icones/maxspeed_empty.svg',
    iconStyle: 'background-color:rgba(255,255,255,0.4)',
    style: function (feature) {
        var key_regex = /^name$/;
        var name_key = feature.getKeys().filter(function(t){return t.match(key_regex)}).pop() || "name";
        var name = feature.get(name_key) || '';
        var fill = new ol.style.Fill({
            color: 'rgba(117,63,79,0.4)'
        });
        var stroke = new ol.style.Stroke({
            color: 'rgba(117,63,79,1)',
            width: 1
        });
        // Get the geometry type
        var geom = feature.getGeometry();
        var isPolygon = geom.getType() === 'Polygon' || geom.getType() === 'MultiPolygon';
        
        var style = new ol.style.Style({
            image: new ol.style.Icon({
                src: imgSrc + 'icones/maxspeed_empty.svg',
                scale: 0.03
            }),
            text: new ol.style.Text({
                text: name,
              			
                fill: new ol.style.Fill({
                    color: 'rgba(0,0,0,1)'
                }),
                stroke: new ol.style.Stroke({
                    color: 'rgba(255,255,255,0.7)',
                    width: 2
                }),
                // For polygons, we'll use a different placement strategy
                placement: isPolygon ? 'point' : 'point',
				textAlign: 'center',
                textBaseline: 'bottom',
                offsetY: isPolygon ? -15 : 0, // Move text up for polygons
                overflow: true // Allow text to be rendered outside the view
            }),
            fill: fill,
            stroke: stroke
        });
        
        return style;
/*   cerrar */								}

/*@@ fin-inicio de copia */			},
/*   abrir */							{
    group: 'Geojson',
    title: 'ES_CAT_VNG traffic_signals semáforos semàfors',
geojson: './src/vng_highway_traffic_signals.geojson',
    iconSrc: imgSrc + 'icones/maxspeed_empty.svg',
    iconStyle: 'background-color:rgba(255,255,255,0.4)',
    style: function (feature) {
        var key_regex = /^name$/;
        var name_key = feature.getKeys().filter(function(t){return t.match(key_regex)}).pop() || "name";
        var name = feature.get(name_key) || '';
        var fill = new ol.style.Fill({
            color: 'rgba(117,63,79,0.4)'
        });
        var stroke = new ol.style.Stroke({
            color: 'rgba(117,63,79,1)',
            width: 1
        });
        // Get the geometry type
        var geom = feature.getGeometry();
        var isPolygon = geom.getType() === 'Polygon' || geom.getType() === 'MultiPolygon';
        
        var style = new ol.style.Style({
            image: new ol.style.Icon({
                src: imgSrc + 'icones/maxspeed_empty.svg',
                scale: 0.03
            }),
            text: new ol.style.Text({
                text: name,
              			
                fill: new ol.style.Fill({
                    color: 'rgba(0,0,0,1)'
                }),
                stroke: new ol.style.Stroke({
                    color: 'rgba(255,255,255,0.7)',
                    width: 2
                }),
                // For polygons, we'll use a different placement strategy
                placement: isPolygon ? 'point' : 'point',
				textAlign: 'center',
                textBaseline: 'bottom',
                offsetY: isPolygon ? -15 : 0, // Move text up for polygons
                overflow: true // Allow text to be rendered outside the view
            }),
            fill: fill,
            stroke: stroke
        });
        
        return style;
/*   cerrar */								}

/*@@ fin-inicio de copia */			},
/*   abrir */							{
    group: 'Geojson',
    title: 'ES_CAT_VNG trees árboles arbres',
geojson: './src/vng_natural_tree.geojson',
    iconSrc: imgSrc + 'icones/maxspeed_empty.svg',
    iconStyle: 'background-color:rgba(255,255,255,0.4)',
    style: function (feature) {
        var key_regex = /^name$/;
        var name_key = feature.getKeys().filter(function(t){return t.match(key_regex)}).pop() || "name";
        var name = feature.get(name_key) || '';
        var fill = new ol.style.Fill({
            color: 'rgba(117,63,79,0.4)'
        });
        var stroke = new ol.style.Stroke({
            color: 'rgba(117,63,79,1)',
            width: 1
        });
        // Get the geometry type
        var geom = feature.getGeometry();
        var isPolygon = geom.getType() === 'Polygon' || geom.getType() === 'MultiPolygon';
        
        var style = new ol.style.Style({
            image: new ol.style.Icon({
                src: imgSrc + 'icones/maxspeed_empty.svg',
                scale: 0.03
            }),
            text: new ol.style.Text({
                text: name,
              			
                fill: new ol.style.Fill({
                    color: 'rgba(0,0,0,1)'
                }),
                stroke: new ol.style.Stroke({
                    color: 'rgba(255,255,255,0.7)',
                    width: 2
                }),
                // For polygons, we'll use a different placement strategy
                placement: isPolygon ? 'point' : 'point',
				textAlign: 'center',
                textBaseline: 'bottom',
                offsetY: isPolygon ? -15 : 0, // Move text up for polygons
                overflow: true // Allow text to be rendered outside the view
            }),
            fill: fill,
            stroke: stroke
        });
        
        return style;
/*   cerrar */								}

},
/*   abrir */							{
    group: 'Geojson',
    title: 'ES_CAT_VNG5 Sant Joan area',
geojson: './src/vng5_area.geojson',
    iconSrc: imgSrc + 'icones/maxspeed_empty.svg',
    iconStyle: 'background-color:rgba(255,255,255,0.4)',
    style: function (feature) {
        var key_regex = /^name$/;
        var name_key = feature.getKeys().filter(function(t){return t.match(key_regex)}).pop() || "name";
        var name = feature.get(name_key) || '';
        var fill = new ol.style.Fill({
            color: 'rgba(117,63,79,0.1)'
        });
        var stroke = new ol.style.Stroke({
            color: 'rgba(117,63,79,1)',
            width: 1
        });
        // Get the geometry type
        var geom = feature.getGeometry();
        var isPolygon = geom.getType() === 'Polygon' || geom.getType() === 'MultiPolygon';
        
        var style = new ol.style.Style({
            image: new ol.style.Icon({
                src: imgSrc + 'icones/maxspeed_empty.svg',
                scale: 0.01
            }),
            text: new ol.style.Text({
                text: name,
              			
                fill: new ol.style.Fill({
                    color: 'rgba(0,0,0,0.1)'
                }),
                stroke: new ol.style.Stroke({
                    color: 'rgba(255,255,255,0.3)',
                    width: 2
                }),
                // For polygons, we'll use a different placement strategy
                placement: isPolygon ? 'point' : 'point',
				textAlign: 'center',
                textBaseline: 'bottom',
                offsetY: isPolygon ? -15 : 0, // Move text up for polygons
                overflow: true // Allow text to be rendered outside the view
            }),
            fill: fill,
            stroke: stroke
        });
        
        return style;
/*   cerrar */								}

},
/*   abrir */							{
    group: 'Geojson',
    title: 'ES_CAT_BDN Planetes Llefià',
geojson: './src/planetes_llefia.geojson',
    iconSrc: imgSrc + 'icones/maxspeed_empty.svg',
    iconStyle: 'background-color:rgba(255,255,255,0.4)',
    style: function (feature) {
        var key_regex = /^name$/;
        var name_key = feature.getKeys().filter(function(t){return t.match(key_regex)}).pop() || "name";
        var name = feature.get(name_key) || '';
        var fill = new ol.style.Fill({
            color: 'rgba(117,63,79,0.1)'
        });
        var stroke = new ol.style.Stroke({
            color: 'rgba(117,63,79,1)',
            width: 1
        });
        // Get the geometry type
        var geom = feature.getGeometry();
        var isPolygon = geom.getType() === 'Polygon' || geom.getType() === 'MultiPolygon';
        
        var style = new ol.style.Style({
            image: new ol.style.Icon({
                src: imgSrc + 'icones/maxspeed_empty.svg',
                scale: 0.01
            }),
            text: new ol.style.Text({
                text: name,
              			
                fill: new ol.style.Fill({
                    color: 'rgba(0,0,0,0.1)'
                }),
                stroke: new ol.style.Stroke({
                    color: 'rgba(255,255,255,0.3)',
                    width: 2
                }),
                // For polygons, we'll use a different placement strategy
                placement: isPolygon ? 'point' : 'point',
				textAlign: 'center',
                textBaseline: 'bottom',
                offsetY: isPolygon ? -15 : 0, // Move text up for polygons
                overflow: true // Allow text to be rendered outside the view
            }),
            fill: fill,
            stroke: stroke
        });
        
        return style;
/*   cerrar */								}

},
/*   abrir */							{
    group: 'Geojson',
    title: 'ES_ARA_ZGZ Pedrola',
geojson: './src/pedrola.geojson',
    iconSrc: imgSrc + 'icones/maxspeed_empty.svg',
    iconStyle: 'background-color:rgba(255,255,255,0.4)',
    style: function (feature) {
        var key_regex = /^name$/;
        var name_key = feature.getKeys().filter(function(t){return t.match(key_regex)}).pop() || "name";
        var name = feature.get(name_key) || '';
        var fill = new ol.style.Fill({
            color: 'rgba(117,63,79,0.1)'
        });
        var stroke = new ol.style.Stroke({
            color: 'rgba(117,63,79,1)',
            width: 1
        });
        // Get the geometry type
        var geom = feature.getGeometry();
        var isPolygon = geom.getType() === 'Polygon' || geom.getType() === 'MultiPolygon';
        
        var style = new ol.style.Style({
            image: new ol.style.Icon({
                src: imgSrc + 'icones/maxspeed_empty.svg',
                scale: 0.01
            }),
            text: new ol.style.Text({
                text: name,
              			
                fill: new ol.style.Fill({
                    color: 'rgba(0,0,0,0.1)'
                }),
                stroke: new ol.style.Stroke({
                    color: 'rgba(255,255,255,0.3)',
                    width: 2
                }),
                // For polygons, we'll use a different placement strategy
                placement: isPolygon ? 'point' : 'point',
				textAlign: 'center',
                textBaseline: 'bottom',
                offsetY: isPolygon ? -15 : 0, // Move text up for polygons
                overflow: true // Allow text to be rendered outside the view
            }),
            fill: fill,
            stroke: stroke
        });
        
        return style;
/*   cerrar */								}

},
/*   abrir */							{
    group: 'Geojson',
    title: 'ES_CAT_StAnBa Sant Andreu de la Barca',
geojson: './src/catalunya_sab.geojson',
    iconSrc: imgSrc + 'icones/maxspeed_empty.svg',
    iconStyle: 'background-color:rgba(255,255,255,0.4)',
    style: function (feature) {
        var key_regex = /^name$/;
        var name_key = feature.getKeys().filter(function(t){return t.match(key_regex)}).pop() || "name";
        var name = feature.get(name_key) || '';
        var fill = new ol.style.Fill({
            color: 'rgba(117,63,79,0.1)'
        });
        var stroke = new ol.style.Stroke({
            color: 'rgba(117,63,79,1)',
            width: 1
        });
        // Get the geometry type
        var geom = feature.getGeometry();
        var isPolygon = geom.getType() === 'Polygon' || geom.getType() === 'MultiPolygon';
        
        var style = new ol.style.Style({
            image: new ol.style.Icon({
                src: imgSrc + 'icones/maxspeed_empty.svg',
                scale: 0.01
            }),
            text: new ol.style.Text({
                text: name,
              			
                fill: new ol.style.Fill({
                    color: 'rgba(0,0,0,0.1)'
                }),
                stroke: new ol.style.Stroke({
                    color: 'rgba(255,255,255,0.3)',
                    width: 2
                }),
                // For polygons, we'll use a different placement strategy
                placement: isPolygon ? 'point' : 'point',
				textAlign: 'center',
                textBaseline: 'bottom',
                offsetY: isPolygon ? -15 : 0, // Move text up for polygons
                overflow: true // Allow text to be rendered outside the view
            }),
            fill: fill,
            stroke: stroke
        });
        
        return style;
/*   cerrar */								}

},
/*   abrir */							{
    group: 'Geojson',
    title: 'ES_CAT_VNG Talaia',
geojson: './src/talaia.geojson',
    iconSrc: imgSrc + 'icones/maxspeed_empty.svg',
    iconStyle: 'background-color:rgba(255,255,255,0.4)',
    style: function (feature) {
        var key_regex = /^name$/;
        var name_key = feature.getKeys().filter(function(t){return t.match(key_regex)}).pop() || "name";
        var name = feature.get(name_key) || '';
        var fill = new ol.style.Fill({
            color: 'rgba(117,63,79,0.1)'
        });
        var stroke = new ol.style.Stroke({
            color: 'rgba(117,63,79,1)',
            width: 1
        });
        // Get the geometry type
        var geom = feature.getGeometry();
        var isPolygon = geom.getType() === 'Polygon' || geom.getType() === 'MultiPolygon';
        
        var style = new ol.style.Style({
            image: new ol.style.Icon({
                src: imgSrc + 'icones/maxspeed_empty.svg',
                scale: 0.01
            }),
            text: new ol.style.Text({
                text: name,
              			
                fill: new ol.style.Fill({
                    color: 'rgba(0,0,0,0.1)'
                }),
                stroke: new ol.style.Stroke({
                    color: 'rgba(255,255,255,0.3)',
                    width: 2
                }),
                // For polygons, we'll use a different placement strategy
                placement: isPolygon ? 'point' : 'point',
				textAlign: 'center',
                textBaseline: 'bottom',
                offsetY: isPolygon ? -15 : 0, // Move text up for polygons
                overflow: true // Allow text to be rendered outside the view
            }),
            fill: fill,
            stroke: stroke
        });
        
        return style;
/*   cerrar */								}

},
/*   abrir */							{
    group: 'Geojson',
    title: 'ES_CAT_VNG1 Molí de Vent',
geojson: './src/vng1.geojson',
    iconSrc: imgSrc + 'icones/maxspeed_empty.svg',
    iconStyle: 'background-color:rgba(255,255,255,0.4)',
    style: function (feature) {
        var key_regex = /^name$/;
        var name_key = feature.getKeys().filter(function(t){return t.match(key_regex)}).pop() || "name";
        var name = feature.get(name_key) || '';
        var fill = new ol.style.Fill({
            color: 'rgba(117,63,79,0.4)'
        });
        var stroke = new ol.style.Stroke({
            color: 'rgba(117,63,79,1)',
            width: 1
        });
        // Get the geometry type
        var geom = feature.getGeometry();
        var isPolygon = geom.getType() === 'Polygon' || geom.getType() === 'MultiPolygon';
        
        var style = new ol.style.Style({
            image: new ol.style.Icon({
                src: imgSrc + 'icones/maxspeed_empty.svg',
                scale: 0.03
            }),
            text: new ol.style.Text({
                text: name,
              			
                fill: new ol.style.Fill({
                    color: 'rgba(0,0,0,1)'
                }),
                stroke: new ol.style.Stroke({
                    color: 'rgba(255,255,255,0.7)',
                    width: 2
                }),
                // For polygons, we'll use a different placement strategy
                placement: isPolygon ? 'point' : 'point',
				textAlign: 'center',
                textBaseline: 'bottom',
                offsetY: isPolygon ? -15 : 0, // Move text up for polygons
                overflow: true // Allow text to be rendered outside the view
            }),
            fill: fill,
            stroke: stroke
        });
        
        return style;
/*   cerrar */								}

/*@@ fin-inicio de copia */			},
/*   abrir */							{
    group: 'Geojson',
    title: 'ES_CAT_VNG2 Torrent Sant Joan',
geojson: './src/vng2.geojson',
    iconSrc: imgSrc + 'icones/maxspeed_empty.svg',
    iconStyle: 'background-color:rgba(255,255,255,0.4)',
    style: function (feature) {
        var key_regex = /^name$/;
        var name_key = feature.getKeys().filter(function(t){return t.match(key_regex)}).pop() || "name";
        var name = feature.get(name_key) || '';
        var fill = new ol.style.Fill({
            color: 'rgba(117,63,79,0.4)'
        });
        var stroke = new ol.style.Stroke({
            color: 'rgba(117,63,79,1)',
            width: 1
        });
        // Get the geometry type
        var geom = feature.getGeometry();
        var isPolygon = geom.getType() === 'Polygon' || geom.getType() === 'MultiPolygon';
        
        var style = new ol.style.Style({
            image: new ol.style.Icon({
                src: imgSrc + 'icones/maxspeed_empty.svg',
                scale: 0.03
            }),
            text: new ol.style.Text({
                text: name,
              			
                fill: new ol.style.Fill({
                    color: 'rgba(0,0,0,1)'
                }),
                stroke: new ol.style.Stroke({
                    color: 'rgba(255,255,255,0.7)',
                    width: 2
                }),
                // For polygons, we'll use a different placement strategy
                placement: isPolygon ? 'point' : 'point',
				textAlign: 'center',
                textBaseline: 'bottom',
                offsetY: isPolygon ? -15 : 0, // Move text up for polygons
                overflow: true // Allow text to be rendered outside the view
            }),
            fill: fill,
            stroke: stroke
        });
        
        return style;
/*   cerrar */								}

/*@@ fin-inicio de copia */			},
/*   abrir */							{
    group: 'Geojson',
    title: 'ES_CAT_VNG3 encreuament',
geojson: './src/vng3.geojson',
    iconSrc: imgSrc + 'icones/maxspeed_empty.svg',
    iconStyle: 'background-color:rgba(255,255,255,0.4)',
    style: function (feature) {
        var key_regex = /^name$/;
        var name_key = feature.getKeys().filter(function(t){return t.match(key_regex)}).pop() || "name";
        var name = feature.get(name_key) || '';
        var fill = new ol.style.Fill({
            color: 'rgba(117,63,79,0.4)'
        });
        var stroke = new ol.style.Stroke({
            color: 'rgba(117,63,79,1)',
            width: 1
        });
        // Get the geometry type
        var geom = feature.getGeometry();
        var isPolygon = geom.getType() === 'Polygon' || geom.getType() === 'MultiPolygon';
        
        var style = new ol.style.Style({
            image: new ol.style.Icon({
                src: imgSrc + 'icones/maxspeed_empty.svg',
                scale: 0.03
            }),
            text: new ol.style.Text({
                text: name,
              			
                fill: new ol.style.Fill({
                    color: 'rgba(0,0,0,1)'
                }),
                stroke: new ol.style.Stroke({
                    color: 'rgba(255,255,255,0.7)',
                    width: 2
                }),
                // For polygons, we'll use a different placement strategy
                placement: isPolygon ? 'point' : 'point',
				textAlign: 'center',
                textBaseline: 'bottom',
                offsetY: isPolygon ? -15 : 0, // Move text up for polygons
                overflow: true // Allow text to be rendered outside the view
            }),
            fill: fill,
            stroke: stroke
        });
        
        return style;
/*   cerrar */								}

/*@@ fin-inicio de copia */			},
/*   abrir */							{
    group: 'Geojson',
    title: 'ES_CAT_VNG4 Olèrdola',
geojson: './src/vng4_area.geojson',
    iconSrc: imgSrc + 'icones/maxspeed_empty.svg',
    iconStyle: 'background-color:rgba(255,255,255,0.4)',
    style: function (feature) {
        var key_regex = /^name$/;
        var name_key = feature.getKeys().filter(function(t){return t.match(key_regex)}).pop() || "name";
        var name = feature.get(name_key) || '';
        var fill = new ol.style.Fill({
            color: 'rgba(117,63,79,0.1)'
        });
        var stroke = new ol.style.Stroke({
            color: 'rgba(117,63,79,1)',
            width: 1
        });
        // Get the geometry type
        var geom = feature.getGeometry();
        var isPolygon = geom.getType() === 'Polygon' || geom.getType() === 'MultiPolygon';
        
        var style = new ol.style.Style({
            image: new ol.style.Icon({
                src: imgSrc + 'icones/maxspeed_empty.svg',
                scale: 0.01
            }),
            text: new ol.style.Text({
                text: name,
              			
                fill: new ol.style.Fill({
                    color: 'rgba(0,0,0,0.1)'
                }),
                stroke: new ol.style.Stroke({
                    color: 'rgba(255,255,255,0.3)',
                    width: 2
                }),
                // For polygons, we'll use a different placement strategy
                placement: isPolygon ? 'point' : 'point',
				textAlign: 'center',
                textBaseline: 'bottom',
                offsetY: isPolygon ? -15 : 0, // Move text up for polygons
                overflow: true // Allow text to be rendered outside the view
            }),
            fill: fill,
            stroke: stroke
        });
        
        return style;
/*   cerrar */								}

	]
};
