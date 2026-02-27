import { getTranslation } from '../../i18n/index.js';

export function animalOverlays() {
    return [
        {
            group: getTranslation('animal_boarding'),
            title: getTranslation('animal_boarding'),
            query: "[out:json][timeout:25];(nwr[\"amenity\"=\"animal_boarding\"]({{bbox}});node(w););out meta;",
            iconSrc: "src/img/logos/generic.svg",
            iconStyle: "background-color:rgba(255,255,255,0.4)",
            style: function (feature) {
                var key_regex = /^name$/
                var name_key = feature.getKeys().filter(function(t){return t.match(key_regex)}).pop() || "name"
                var name = feature.get(name_key) || '';
                var fill = new ol.style.Fill({
                    color: 'rgba(0,128,0,0.4)'
                });
                var stroke = new ol.style.Stroke({
                    color: 'rgba(0,128,0,1)',
                    width: 1
                });
                var style = new ol.style.Style({
                    image: new ol.style.Icon({
                        src: "src/img/logos/generic.svg",
                        scale: 0.0200
                    }),
                    text: new ol.style.Text({
                        text: name,
                        offsetX: 7,
                        offsetY: -12,
                        fill: new ol.style.Fill({
                            color: 'rgba(0,0,0,1)'
                        })
                    }),
                    fill: fill,
                    stroke: stroke
                });
                return style;
            }
        },
        {
            group: getTranslation('animal_shelter'),
            title: getTranslation('animal_shelter'),
            query: "[out:json][timeout:25];(nwr[\"amenity\"=\"animal_shelter\"]({{bbox}});node(w););out meta;",
            iconSrc: "src/img/logos/generic.svg",
            iconStyle: "background-color:rgba(255,255,255,0.4)",
            style: function (feature) {
                var key_regex = /^name$/
                var name_key = feature.getKeys().filter(function(t){return t.match(key_regex)}).pop() || "name"
                var name = feature.get(name_key) || '';
                var fill = new ol.style.Fill({
                    color: 'rgba(0,0,255,0.4)'
                });
                var stroke = new ol.style.Stroke({
                    color: 'rgba(0,0,255,1)',
                    width: 1
                });
                var style = new ol.style.Style({
                    image: new ol.style.Icon({
                        src: "src/img/logos/generic.svg",
                        scale: 0.0200
                    }),
                    text: new ol.style.Text({
                        text: name,
                        offsetX: 7,
                        offsetY: -12,
                        fill: new ol.style.Fill({
                            color: 'rgba(0,0,0,1)'
                        })
                    }),
                    fill: fill,
                    stroke: stroke
                });
                return style;
            }
        },
        {
            group: getTranslation('veterinary'),
            title: getTranslation('veterinary'),
            query: "[out:json][timeout:25];(nwr[\"amenity\"=\"veterinary\"]({{bbox}});node(w););out meta;",
            iconSrc: "src/img/logos/generic.svg",
            iconStyle: "background-color:rgba(255,255,255,0.4)",
            style: function (feature) {
                var key_regex = /^name$/
                var name_key = feature.getKeys().filter(function(t){return t.match(key_regex)}).pop() || "name"
                var name = feature.get(name_key) || '';
                var fill = new ol.style.Fill({
                    color: 'rgba(255,165,0,0.4)'
                });
                var stroke = new ol.style.Stroke({
                    color: 'rgba(255,165,0,1)',
                    width: 1
                });
                var style = new ol.style.Style({
                    image: new ol.style.Icon({
                        src: "src/img/logos/generic.svg",
                        scale: 0.0200
                    }),
                    text: new ol.style.Text({
                        text: name,
                        offsetX: 7,
                        offsetY: -12,
                        fill: new ol.style.Fill({
                            color: 'rgba(0,0,0,1)'
                        })
                    }),
                    fill: fill,
                    stroke: stroke
                });
                return style;
            }
        },
        {
        group: getTranslation('animal_boarding'),
		title: "Dogtopia",
    query: "[out:json][timeout:25];(nwr[\"amenity\"=\"animal_boarding\"][\"animal_boarding\"=\"dog\"][\"brand\"=\"Dogtopia\"][\"brand:wikidata\"=\"Q112037444\"][\"name\"=\"Dogtopia\"]({{bbox}});node(w););out meta;",
    iconSrc: "src/img/logos/generic.svg",
    iconStyle: "background-color:rgba(255,255,255,0.4)",
    style: function (feature) {
        var key_regex = /^name$/
        var name_key = feature.getKeys().filter(function(t){return t.match(key_regex)}).pop() || "name"
        var name = feature.get(name_key) || '';
        var fill = new ol.style.Fill({
            color: 'rgba(255,0,0,0.4)'
        });
        var stroke = new ol.style.Stroke({
            color: 'rgba(255,0,0,1)',
            width: 1
        });
        var style = new ol.style.Style({
            image: new ol.style.Icon({
                src: "src/img/logos/generic.svg",
                scale:0.0200
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
},
{
    group: getTranslation('pet'),
	title: "\u9b5a\u4e2d\u9b5a",
    query: "[out:json][timeout:25];(nwr[\"brand\"=\"\u9b5a\u4e2d\u9b5a\"][\"brand:en\"=\"Pets Mall Fish\"][\"brand:ja\"=\"\u9b5a\u4e2d\u9b5a\"][\"brand:wikidata\"=\"Q120801864\"][\"name\"=\"\u9b5a\u4e2d\u9b5a\"][\"name:en\"=\"Pets Mall Fish\"][\"name:ja\"=\"\u9b5a\u4e2d\u9b5a\"][\"shop\"=\"pet\"]({{bbox}});node(w););out meta;",
    iconSrc: "https://commons.wikimedia.org/wiki/Special:FilePath/Petsmallfish-20.2023-06-24.jpg",
    iconStyle: "background-color:rgba(255,255,255,0.4)",
    style: function (feature) {
        var key_regex = /^name$/
        var name_key = feature.getKeys().filter(function(t){return t.match(key_regex)}).pop() || "name"
        var name = feature.get(name_key) || '';
        var fill = new ol.style.Fill({
            color: 'rgba(255,0,0,0.4)'
        });
        var stroke = new ol.style.Stroke({
            color: 'rgba(255,0,0,1)',
            width: 1
        });
        var style = new ol.style.Style({
            image: new ol.style.Icon({
                src: "https://commons.wikimedia.org/wiki/Special:FilePath/Petsmallfish-20.2023-06-24.jpg",
                scale:0.30
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
        }
    ];
}