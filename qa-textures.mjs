export default async function run(page, ui) {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(String(err)));

  await page.addScriptTag({
    content: `
      (function () {
        window.__qaTextureProbe = { done: false };
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
            if (!window.map) throw new Error('window.map missing');
            var view = window.map.getView();
            view.setCenter(ol.proj.fromLonLat([2.294694, 48.858093]));
            view.setZoom(17);
            await new Promise(function (r) { setTimeout(r, 1000); });

            var toggle = document.querySelector('#threedmr-toggle');
            if (toggle && !toggle.checked) toggle.click();
            await waitFor(function () {
              var layers = window.map.getLayers().getArray();
              for (var i = 0; i < layers.length; i++) {
                if (layers[i].get('is3dmr')) {
                  return layers[i].get('source') && layers[i].get('source').getFeatures().length
                    ? layers[i].get('source').getFeatures() : false;
                }
              }
              return false;
            }, 60000);
            var dmrLayer = window.map.getLayers().getArray().filter(function (l) {
              return l.get('is3dmr');
            })[0];
            var dmrFeatures = dmrLayer.getSource().getFeatures();
            out.dmrFeatures = dmrFeatures.length;
            out.dmrIds = dmrFeatures.map(function (f) { return f.get('3dmr:id') || f.get('3dmr'); }).slice(0, 10);
            out.dmrModel = dmrFeatures[0] && dmrFeatures[0].get('osm3dModel');

            var button = document.querySelector('.ol-3d-toggle button');
            if (!button) throw new Error('3D toggle missing');
            button.click();
            await waitFor(function () {
              return window.ol3d && window.ol3d.getEnabled && window.ol3d.getEnabled();
            }, 90000);

            var scene = window.ol3d.getCesiumScene();
            await waitFor(function () {
              var entries = window.modelRenderer && window.modelRenderer.loadedModels;
              if (!entries) return false;
              var found = false;
              entries.forEach(function (entry) {
                if (entry.modelUrl && entry.modelUrl.indexOf('/api/model/') !== -1) found = entry;
              });
              return found && found.model && found.model.ready;
            }, 90000);
            await new Promise(function (r) { setTimeout(r, 6000); });

            var entries = [];
            window.modelRenderer.loadedModels.forEach(function (entry) {
              if (!entry.modelUrl || entry.modelUrl.indexOf('/api/model/') === -1) return;
              var model = entry.model;
              var gltf = model._model || model._gltf || null;
              var info = {
                id: entry.feature && (entry.feature.get('3dmr:id') || entry.feature.get('3dmr')),
                url: entry.modelUrl,
                ready: !!model.ready,
                show: model.show,
                hasModelMatrix: !!model.modelMatrix,
                modelKeys: gltf ? Object.keys(gltf).slice(0, 40) : [],
                gltfComponents: gltf && gltf.components ? Object.keys(gltf.components) : null,
                gltfMaterials: gltf && gltf.materials ? gltf.materials.length : null,
                gltfTextures: gltf && gltf.textures ? gltf.textures.length : null,
                gltfImages: gltf && gltf.images ? gltf.images.length : null,
                gltfMeshes: gltf && gltf.meshes ? gltf.meshes.length : null,
                loadError: entry.loadError || null
              };
              try {
                var materials = gltf && gltf.materials;
                if (materials && materials.length) {
                  var m = materials[0];
                  info.firstMaterialKeys = Object.keys(m);
                  info.firstMaterialHasTexture = !!(m.baseColorTexture || (m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture));
                  info.firstMaterialTextureKeys = m.baseColorTexture ? Object.keys(m.baseColorTexture) : null;
                }
              } catch (e) { info.materialError = String(e); }
              try {
                if (gltf && gltf.meshes && gltf.meshes[0] && gltf.meshes[0].primitives) {
                  info.firstPrimitiveKeys = Object.keys(gltf.meshes[0].primitives[0]);
                }
              } catch (e) { info.meshError = String(e); }
              entries.push(info);
            });
            out.entries = entries;
            out.liveTotal = window.modelRenderer.liveTotal;
            out.liveByKind = Object.assign({}, window.modelRenderer.liveByKind);
            out.scene = {
              terrain: scene && scene.terrainProvider && scene.terrainProvider.constructor
                ? scene.terrainProvider.constructor.name : null,
              primitives: scene && scene.primitives ? scene.primitives.length : null,
              imageryLayers: scene && scene.imageryLayers ? scene.imageryLayers.length : null,
              contextLost: scene && scene.context ? !!scene.context.isDestroyed() : null
            };
            out.resources = performance.getEntriesByType('resource')
              .map(function (r) { return { name: r.name, transferSize: r.transferSize, duration: r.duration }; })
              .filter(function (r) { return /3dmr|api\\/model|\\.glb|\\.gltf|\\.png|\\.jpe?g|\\.webp|ktx|basis/i.test(r.name); })
              .slice(-40);

            try {
              if (entries.length) {
                scene.camera.lookAt(
                  Cesium.Cartesian3.fromDegrees(2.294694, 48.858093, 120),
                  new Cesium.HeadingPitchRange(0, -Cesium.Math.toRadians(8), 550)
                );
                scene.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
                scene.requestRender();
                await new Promise(function (r) { setTimeout(r, 2000); });
              }
            } catch (e) { out.cameraError = String(e); }

            out.done = true;
            window.__qaTextureProbe = out;
            document.documentElement.dataset.qaTextures = JSON.stringify(out);
          } catch (e) {
            out.done = true;
            out.error = String(e && e.stack || e);
            window.__qaTextureProbe = out;
            document.documentElement.dataset.qaTextures = JSON.stringify(out);
          }
        })();
      })();
    `
  });

  const handle = await page.waitForFunction(() => {
    const value = document.documentElement.dataset.qaTextures;
    return value || false;
  }, { timeout: 180000 });
  const result = JSON.parse(await handle.jsonValue());

  await page.screenshot({ path: 'qa-textures.png' });
  return { result, errors: errors.slice(-30) };
}
