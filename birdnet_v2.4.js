importScripts('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest');

// Custom Layer for BirdNET v2.4 (as studied from main.js)
class MelSpecLayerSimple extends tf.layers.Layer {
    constructor(config) {
        super(config);
        this.sampleRate = config.sampleRate;
        this.specShape = config.specShape;
        this.frameStep = config.frameStep;
        this.frameLength = config.frameLength;
        this.fmin = config.fmin;
        this.fmax = config.fmax;
        this.melFilterbank = tf.tensor2d(config.melFilterbank);
    }

    build(inputShape) {
        this.magScale = this.addWeight('magnitude_scaling', [], 'float32', tf.initializers.constant({ value: 1.23 }));
        super.build(inputShape);
    }

    computeOutputShape(inputShape) {
        return [inputShape[0], this.specShape[0], this.specShape[1], 1];
    }

    call(inputs) {
        return tf.tidy(() => {
            let input = inputs[0];
            if (input.shape.length === 1) input = input.expandDims(0);
            
            return tf.stack(tf.split(input, input.shape[0]).map(t => {
                let spec = t.squeeze();
                // Normalization matching v2.4 requirements
                spec = tf.sub(spec, tf.min(spec, -1, true));
                spec = tf.div(spec, tf.max(spec, -1, true).add(1e-6));
                spec = tf.sub(spec, 0.5);
                spec = tf.mul(spec, 2.0);

                // STFT computation
                spec = tf.signal.stft(spec, this.frameLength, this.frameStep, this.frameLength, tf.signal.hannWindow);
                spec = tf.cast(spec, 'float32');
                spec = tf.matMul(spec, this.melFilterbank);
                spec = spec.pow(2.0);
                spec = spec.pow(tf.div(1.0, tf.add(1.0, tf.exp(this.magScale.read()))));
                
                // Reformat to [Height, Width, Channel] for the model
                spec = tf.reverse(spec, -1);
                spec = tf.transpose(spec);
                spec = spec.expandDims(-1);
                return spec;
            }));
        });
    }

    static get className() { return 'MelSpecLayerSimple'; }
}
tf.serialization.registerClass(MelSpecLayerSimple);

let customSpeciesList = null;
async function main() {
    const BASE = '/models/birdnet_v2.4/';
    await tf.setBackend('webgl');
    
    postMessage({ message: 'load_model', progress: 10 });
    const model = await tf.loadLayersModel(BASE + 'model.json');
    
    postMessage({ message: 'warmup', progress: 50 });
    model.predict(tf.zeros([1, 144000])).dispose();
    
    postMessage({ message: 'load_geomodel', progress: 70 });
    let mdataModel = null;
    try {
        // v2.4 uses 'mdata' folder instead of 'area-model'
        mdataModel = await tf.loadGraphModel(BASE + 'mdata/model.json');
    } catch (e) {
        console.warn('Could not load metadata model');
    }
    
    postMessage({ message: 'load_labels', progress: 90 });
    // Labels are in JSON format in v2.4
    const labelsRaw = await fetch(BASE + 'labels.json').then(r => r.json());
    const birds = labelsRaw.map(l => ({
        name: l.includes('_') ? l.split('_')[1] : l,
        scientific: l.includes('_') ? l.split('_')[0] : '',
        geoscore: 1.0
    }));

    postMessage({ message: 'loaded' });

    onmessage = async (e) => {
        const { data } = e;
        if (data.message === 'predict') {
            const pcm = tf.tensor(data.pcmAudio, [1, 144000]);
            const res = model.predict(pcm);
            const probs = await res.data();
            pcm.dispose();
            res.dispose();
            
            const prediction = [];
            for (let i = 0; i < probs.length; i++) {
                if (probs[i] > 0.01) {
                    let currentGeoScore = birds[i].geoscore; // The score from mdata model

                    // If a custom list is active, override the geoscore
                    if (customSpeciesList) {
                        const commonName = (birds[i].name || '').toLowerCase();
                        const scientificName = (birds[i].scientific || '').toLowerCase();
                        
                        // Check if either common or scientific name is in the custom list
                        if (customSpeciesList.has(commonName) || customSpeciesList.has(scientificName)) {
                            currentGeoScore = 1.0;
                        } else {
                            currentGeoScore = 0.0;
                        }
                    }

                    prediction.push({
                        nameI18n: birds[i].name,
                        scientific: birds[i].scientific,
                        confidence: probs[i],
                        geoscore: currentGeoScore
                    });
                }
            }
            postMessage({ message: 'predict', prediction });
        }

        if (data.message === 'set_species_list') {
            if (data.list && Array.isArray(data.list)) {
                // Normalize names for case-insensitive matching
                const candidates = [];
                data.list.forEach(item => {
                    if (item && item.includes('_')) {
                        item.split('_').forEach(part => candidates.push(part));
                    } else {
                        candidates.push(item);
                    }
                });
                customSpeciesList = new Set(candidates.map(name => String(name || '').trim().toLowerCase()).filter(Boolean));
                postMessage({ message: 'set_species_list', status: 'ok', count: customSpeciesList.size });
            } else {
                customSpeciesList = null;
                postMessage({ message: 'set_species_list', status: 'cleared' });
            }
            return; // Important to return here
        }

        if (data.message === 'area-scores') {
            customSpeciesList = null; // Clear any custom list override
            if (!mdataModel) {
                postMessage({ message: 'area-scores' });
                return;
            }
            let weeks = [];
            if (data.week === -1) {
                weeks = [1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 41, 45];
            } else {
                weeks = [data.week || 1];
            }

            let maxScores = new Float32Array(birds.length).fill(0);
            for (const w of weeks) {
                tf.tidy(() => {
                    const input = tf.tensor2d([[data.latitude, data.longitude, w]]);
                    const res = mdataModel.predict(input);
                    const scores = res.dataSync();
                    for (let i = 0; i < birds.length; i++) {
                        if (scores[i] > maxScores[i]) maxScores[i] = scores[i];
                    }
                });
            }
            for (let i = 0; i < birds.length; i++) {
                birds[i].geoscore = maxScores[i];
            }
            postMessage({ message: 'area-scores' });
        }

        if (data.message === 'reset-area') {
            customSpeciesList = null; // Clear any custom list override
            birds.forEach(b => b.geoscore = 1.0);
            postMessage({ message: 'reset-area' });
        }
    };
}


main();



