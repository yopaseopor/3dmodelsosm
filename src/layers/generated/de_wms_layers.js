// OpenLayers WMS layers generated from JOSM imagery.xml
// Generated on: 2025-07-07 23:30:22 UTC
// Total layers: 60

export const DELayers = [
    new ol.layer.Tile({
        title: 'Aktuelle Luftbilder der Landeshauptstadt München 20cm',
        source: new ol.source.TileWMS({
            attributions: 'Datenquelle: dl-de/by-2-0: Landeshauptstadt München – Kommunalreferat – GeodatenService – www.geodatenservice-muenchen.de',
            url: 'https://geoportal.muenchen.de/geoserver/gsm/luftbild/ows',
            params: {
                'LAYERS': 'luftbild',
                'VERSION': '1.3.0',
                'FORMAT': 'image/png',
                'TRANSPARENT': 'true'
            },
            serverType: 'geoserver'
        }),
        visible: false
    }),
    new ol.layer.Tile({
        title: 'Baden-Würrtemberg DOP20',
        source: new ol.source.TileWMS({
            attributions: '© LGL-BW (2025) - dl-de/by-2-0 (https://www.govdata.de/dl-de/by-2-0) - Verwendung unter besonderer Erlaubnis',
            url: 'https://owsproxy.lgl-bw.de/owsproxy/ows/WMS_LGL-BW_ATKIS_DOP_20_C',
            params: {
                'LAYERS': 'IMAGES_DOP_20_RGB',
                'VERSION': '1.3.0',
                'FORMAT': 'image/png',
                'TRANSPARENT': 'true'
            },
            serverType: 'mapserver'
        }),
        visible: false
    }),
    new ol.layer.Tile({
        title: 'Brandenburg GeoBasis-DE/LGB / Alkis',
        source: new ol.source.TileWMS({
            attributions: 'GeoBasis-DE/LGB / Alkis, dl-de/by-2-0',
            url: 'https://isk.geobasis-bb.de/ows/alkis_wms',
            params: {
                'LAYERS': 'adv_alkis_gewaesser,adv_alkis_vegetation,adv_alkis_flurstuecke,adv_alkis_gebaeude,adv_alkis_tatsaechliche_nutzung,adv_alkis_verkehr,adv_alkis_siedlung',
                'VERSION': '1.3.0',
                'FORMAT': 'image/png',
                'TRANSPARENT': 'true'
            },
            serverType: 'mapserver'
        }),
        visible: false
    }),
    new ol.layer.Tile({
        title: 'Aachen Liegenschaftskataster',
        source: new ol.source.TileWMS({
            attributions: '',
            url: 'https://geodienste.staedteregion-aachen.de/cgi-bin/qgis_mapserv.fcgi',
            params: {
                'LAYERS': 'alkis_lk_inkas',
                'VERSION': '1.3.0',
                'FORMAT': 'image/png',
                'TRANSPARENT': 'true'
            },
            serverType: 'mapserver'
        }),
        visible: false
    }),
    new ol.layer.Tile({
        title: 'ALKIS Kreis Viersen',
        source: new ol.source.TileWMS({
            attributions: '',
            url: 'https://gdi-niederrhein-geodienste.de/flurkarte_verb_sammeldienst/service',
            params: {
                'LAYERS': 'FlurkarteNW_Viersen',
                'VERSION': '1.3.0',
                'FORMAT': 'image/png',
                'TRANSPARENT': 'true'
            },
            serverType: 'mapserver'
        }),
visible: false
    })
];

