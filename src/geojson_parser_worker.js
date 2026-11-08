/* Parse large GeoJSON files off the UI thread and transfer bounded feature batches. */
self.onmessage = async function (event) {
    const file = event.data && event.data.file;
    if (!file) {
        self.postMessage({ type: 'error', message: 'No GeoJSON file was provided.' });
        return;
    }

    try {
        let text = typeof file.text === 'function'
            ? await file.text()
            : new FileReaderSync().readAsText(file);
        const data = JSON.parse(text);
        text = null;

        let features;
        if (data && data.type === 'FeatureCollection') {
            if (!Array.isArray(data.features)) throw new Error('Invalid GeoJSON FeatureCollection.');
            features = data.features;
        } else if (data && data.type === 'Feature') {
            features = [data];
        } else if (data && typeof data.type === 'string') {
            features = [{ type: 'Feature', geometry: data, properties: {} }];
        } else {
            throw new Error('Invalid GeoJSON format.');
        }

        self.postMessage({ type: 'start', geoJSONType: data.type, featureCount: features.length });
        let waiting = false;
        const BATCH_SIZE = 100;

        self.onmessage = function (nextEvent) {
            if (!waiting || !nextEvent.data || nextEvent.data.type !== 'continue') return;
            waiting = false;
            sendBatch();
        };

        function sendBatch() {
            if (features.length === 0) {
                self.postMessage({ type: 'done' });
                return;
            }
            const batch = features.splice(0, BATCH_SIZE);
            waiting = true;
            self.postMessage({ type: 'features', features: batch });
        }

        sendBatch();
    } catch (error) {
        self.postMessage({
            type: 'error',
            message: error && error.message ? error.message : 'Failed to parse GeoJSON.'
        });
    }
};
