import { getTranslation } from '../../i18n/index.js';

export function governmentOverlays() {
    return [
        {
            group: getTranslation('government'),
            title: getTranslation('government'),
            query: "[out:json][timeout:25];(nwr[\"office\"=\"government\"]({{bbox}});node(w););out meta;",
            iconSrc: "src/img/logos/generic.svg",
            iconStyle: "background-color:rgba(255,255,255,0.4)",
            style: function (feature) {
                var fill = new ol.style.Fill({
                    color: 'rgba(255,0,0,0.4)'
                });
                var stroke = new ol.style.Stroke({
                    color: 'rgba(255,0,0,1)',
                    width: 1
                });
                return new ol.style.Style({
                    image: new ol.style.Icon({
                        src: "src/img/logos/generic.svg",
                        scale: 0.0200
                    }),
                    text: new ol.style.Text({
                        text: feature.get("name") || '',
                        offsetX: 7,
                        offsetY: -12,
                        fill: new ol.style.Fill({ color: 'rgba(0,0,0,1)' })
                    }),
                    fill: fill,
                    stroke: stroke
                });
            }
        },
        {
        group: getTranslation('government'),
	title: "Agenzia delle Entrate",
    query: "[out:json][timeout:25];(nwr[\"brand\"=\"Agenzia delle Entrate\"][\"name\"=\"Agenzia delle Entrate\"][\"office\"=\"government\"]({{bbox}});node(w););out meta;",
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
},
{
    group: getTranslation('government'),
	title: "C\u00e2mara de Vereadores",
    query: "[out:json][timeout:25];(nwr[\"brand\"=\"C\u00e2mara de Vereadores\"][\"name\"=\"C\u00e2mara de Vereadores\"][\"office\"=\"government\"]({{bbox}});node(w););out meta;",
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
},
{
    group: getTranslation('government'),
	title: "\u06a9\u0645\u06cc\u062a\u0647 \u0627\u0645\u062f\u0627\u062f",
    query: "[out:json][timeout:25];(nwr[\"brand\"=\"\u06a9\u0645\u06cc\u062a\u0647 \u0627\u0645\u062f\u0627\u062f\"][\"name\"=\"\u06a9\u0645\u06cc\u062a\u0647 \u0627\u0645\u062f\u0627\u062f\"][\"office\"=\"government\"]({{bbox}});node(w););out meta;",
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