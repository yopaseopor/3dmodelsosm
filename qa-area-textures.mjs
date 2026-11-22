export default async function run(page, ui) {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(String(err)));

  await page.addScriptTag({
    content: `
      (function () {
        if (!window.map) return;
        var view = window.map.getView();
        view.setCenter(ol.proj.fromLonLat([2.2954, 48.8581]));
        view.setZoom(19);
      })();
    `
  });
  await page.waitForTimeout(700);

  await page.locator('#geojson-toggle-btn').click();
  await page.locator('#geojson-file').setInputFiles('qa-area.geojson');
  await page.locator('#geojson-load').click();

  await page.addScriptTag({
    content: `
      (function () {
        window.__qaAreaProbe = { done: false };
        function waitFor(fn, timeout) {
          return new Promise(function (resolve, reject) {
            var start = Date.now();
            (function poll() {
              var value;
              try { value = fn(); } catch (e) { value = false; }
              if (value) return resolve(value);
              if (Date.now() - start > timeout) return reject(new Error('timeout'));
              setTimeout(poll, 200);
            })();
          });
        }
        (async function () {
          var out = {};
          try {
            await waitFor(function () {
              var loader = window.geoJSONLoader;
              if (!loader || !window.map) return false;
              var layers = window.map.getLayers().getArray();
              for (var i = 0; i < layers.length; i++) {
                var source = layers[i].getSource && layers[i].getSource();
                if (source && source.getFeatures && source.getFeatures().length >= 3) {
                  var features = source.getFeatures();
                  var mine = features.filter(function (f) {
                    return String(f.get('name') || '').indexOf('QA ') === 0;
                  });
                  if (mine.length >= 3) return { layer: layers[i], features: mine };
                }
              }
              return false;
            }, 60000);
            var layers = window.map.getLayers().getArray();
            var found = null;
            for (var i = 0; i < layers.length; i++) {
              var source = layers[i].getSource && layers[i].getSource();
              if (!source || !source.getFeatures) continue;
              var mine = source.getFeatures().filter(function (f) {
                return String(f.get('name') || '').indexOf('QA ') === 0;
              });
              if (mine.length >= 3) { found = { layer: layers[i], features: mine }; break; }
            }
            out.features = found.features.map(function (f) {
              return {
                name: f.get('name'),
                areaHighway: f.get('area:highway'),
                amenity: f.get('amenity'),
                footway: f.get('footway'),
                model: f.get('osm3dModel'),
                repetitions: Object.keys(f.getProperties()).filter(function (k) { return /^repetition_/.test(k); }),
                areaEntity: !!f.get('areaEntity')
              };
            });
            out.layerTitle = found.layer.get('title') || found.layer.get('name') || null;

            var button = document.querySelector('.ol-3d-toggle button');
            if (!button) throw new Error('3D toggle missing');
            button.click();
            await waitFor(function () {
              return window.ol3d && window.ol3d.getEnabled && window.ol3d.getEnabled();
            }, 90000);
            var scene = window.ol3d.getCesiumScene();
            await new Promise(function (r) { setTimeout(r, 6000); });

            out.liveByKind = Object.assign({}, window.modelRenderer.liveByKind);
            out.liveTotal = window.modelRenderer.liveTotal;
            out.textures = [];
            window.modelRenderer.loadedModels.forEach(function (entry, key) {
              if (entry.kind !== 'texture') return;
              var primitives = Array.isArray(entry.primitives)
                ? entry.primitives : (entry.primitives ? [entry.primitives] : []);
              out.textures.push({
                key: key,
                count: primitives.length,
                show: primitives.map(function (p) { return p && p.show; }),
                polygon: primitives.map(function (p) { return !!(p && p.polygon); }),
                ready: primitives.map(function (p) { return p && p.ready; }),
                featureName: entry.feature && entry.feature.get('name'),
                featureModel: entry.feature && entry.feature.get('osm3dModel'),
                featureTags: entry.feature ? {
                  areaHighway: entry.feature.get('area:highway'),
                  amenity: entry.feature.get('amenity'),
                  footway: entry.feature.get('footway')
                } : null,
                collection: !!entry.entityCollection,
                materialType: (function () {
                  try {
                    var p = primitives[0];
                    var m = p && p.appearance && p.appearance.material;
                    return m && m.fabric ? m.fabric.type : (m && m.getType ? m.getType(0) : null);
                  } catch (e) { return 'ERR:' + e; }
                })()
              });
            });
            out.resources = performance.getEntriesByType('resource')
              .map(function (r) { return r.name; })
              .filter(function (name) { return /\\.(png|jpe?g|webp)(\\?|$)/i.test(name); })
              .slice(-30);

            // Re-enter 3D and check whether the stale areaEntity flags suppress
            // every area texture in the new Cesium scene.
            var beforeToggle = Object.assign({}, window.modelRenderer.liveByKind);
            button.click();
            await waitFor(function () {
              return !window.ol3d || !window.ol3d.getEnabled || !window.ol3d.getEnabled();
            }, 30000);
            button.click();
            await waitFor(function () {
              return window.ol3d && window.ol3d.getEnabled && window.ol3d.getEnabled();
            }, 90000);
            await new Promise(function (r) { setTimeout(r, 9000); });
            out.beforeToggle = beforeToggle;
            out.afterToggle = Object.assign({}, window.modelRenderer.liveByKind);
            out.areaEntityFlags = window.map.getLayers().getArray().reduce(function (count, layer) {
              var source = layer.getSource && layer.getSource();
              if (!source || !source.getFeatures) return count;
              source.getFeatures().forEach(function (feature) {
                if (feature.get('areaEntity')) count++;
              });
              return count;
            }, 0);
            scene = window.ol3d.getCesiumScene();

            try {
              scene.camera.lookAt(
                Cesium.Cartesian3.fromDegrees(2.29545, 48.8581, 10),
                new Cesium.HeadingPitchRange(0, -Cesium.Math.toRadians(35), 90)
              );
              scene.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
              scene.requestRender();
              await new Promise(function (r) { setTimeout(r, 2000); });
            } catch (e) { out.cameraError = String(e); }

            out.done = true;
            window.__qaAreaProbe = out;
            document.documentElement.dataset.qaArea = JSON.stringify(out);
          } catch (e) {
            out.done = true;
            out.error = String(e && e.stack || e);
            window.__qaAreaProbe = out;
            document.documentElement.dataset.qaArea = JSON.stringify(out);
          }
        })();
      })();
    `
  });

  const handle = await page.waitForFunction(() => {
    const value = document.documentElement.dataset.qaArea;
    return value || false;
  }, { timeout: 180000 });
  const result = JSON.parse(await handle.jsonValue());

  await page.screenshot({ path: 'qa-area-textures.png' });
  return { result, errors: errors.slice(-30) };
}
