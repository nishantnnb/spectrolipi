(function () {
    const MENU_BTN_ID = 'runBirdnetBtn';
    const MODAL_ID = 'birdnetOverlayModal';
    let birdNetInited = false;
    let BirdNetJSInstance = null;
    let SAMPLE_RATE = 48000;
    let CHUNK_3S = 144000; // This is a constant, no change needed here.
    let AUDIO_CONFIDENCE = 0.3;
    let AREA_THRESHOLD = 0.1; // Change default to 0.1
    let customSpeciesList = null;

    function init() {
        const btn = document.getElementById(MENU_BTN_ID);
        if (!btn) return;
        btn.addEventListener('click', (ev) => {
            ev.preventDefault();
            openOverlay();
        });
    }

    const bnStyles = `
        #bn-container { padding: 15px; color: #ddd; font-family: system-ui, sans-serif; background: #222; display: flex; flex-direction: column; height: 100%; box-sizing: border-box; }
        
        /* Frames */
        #bn-options-frame { flex: 0 0 auto; display: flex; flex-direction: column; gap: 8px; border-bottom: 1px solid #444; padding-bottom: 10px; margin-bottom: 10px; }
        #bn-results-frame { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; gap: 10px; }

        /* Options styling */
        .bn-control-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
        .bn-box { background: #333; padding: 8px; border-radius: 4px; border: 1px solid #444; }
        .bn-row { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
        .bn-row:last-child { margin-bottom: 0; }
        .bn-row label { font-size: 12px; color: #ccc; }
        .bn-row input[type="number"], .bn-row select { background: #111; border: 1px solid #555; color: #fff; padding: 4px; border-radius: 4px; flex: 1; min-width: 0; }
        
        #bn-start-btn { padding: 10px; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; text-transform: uppercase; width: 100%; }
        #bn-start-btn:hover { background: #1976D2; }
        #bn-start-btn:disabled { background: #444; color: #888; cursor: not-allowed; }

        /* Results styling */
        #bn-results-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; flex: 1 1 auto; min-height: 0; }
        .bn-result-col { display: flex; flex-direction: column; min-height: 0; }
        .bn-result-col h4 { margin: 0 0 5px 0; font-size: 14px; color: #aaa; }
        
        #bn-birdslist, #bn-unique-species-list { 
            list-style: none; padding: 0; margin: 0; 
            background: #111; border: 1px solid #444; border-radius: 4px; 
            overflow-y: auto; flex: 1 1 auto; 
        }
        
        #bn-birdslist li:hover, #bn-unique-species-list li:hover { background: #222; }
        
        #bn-insert-annotations-btn { padding: 10px 20px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; text-transform: uppercase; flex-shrink: 0; }
        #bn-insert-annotations-btn:hover { background: #45a049; }
        #bn-insert-annotations-btn:disabled { background: #444; color: #888; cursor: not-allowed; }

        /* Misc */
        .bn-loader { width: 20px; height: 20px; border: 2px solid #FFF; border-bottom-color: transparent; border-radius: 50%; animation: bn-rotation 1s linear infinite; display: inline-block; vertical-align: middle; }
        @keyframes bn-rotation { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        
        #bn-progress { margin-bottom: 5px; }
        #bn-progress_bar { width: 100%; height: 8px; }
        #bn-error { color: #ff6b6b; font-size: 13px; margin-bottom: 5px; }
        #bn-log { font-size: 12px; color: #888; margin-bottom: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    `;

    function buildUI(container) {
        container.innerHTML = `
            <style>${bnStyles}</style>
            <div id="bn-container">
                
                <!-- TOP FRAME: Options -->
                <div id="bn-options-frame">
                    <header style="display:flex; justify-content:space-between; align-items:center;">
                        <div id="bn-progress" style="flex:1; margin-right:10px; display:none;">
                            <progress id="bn-progress_bar" value="0" max="100"></progress>
                            <span id="bn-progress_text" style="font-size:12px; color:#ccc;"></span>
                        </div>
                    </header>

                    <div class="bn-control-grid">
                        <div class="bn-box">
                            <div class="bn-row">
                                <label>Audio Conf:</label>
                                <span id="bn-audio-confidence-num" style="font-size:12px; width:30px; text-align:right;">0.3</span>
                                <input id="bn-audio-confidence" type="range" value="0.3" min="0.1" max="1.0" step="0.05" style="flex:1;">
                            </div>
                            <div class="bn-row" style="display:none"> <!-- Area confidence hidden as requested previously -->
                                <label>Area Conf:</label>
                                <span id="bn-area-confidence-num">0.1</span>
                                <input id="bn-area-confidence" type="range" value="0.1" min="0" max="10">
                            </div>
                            <div class="bn-row">
                                <label>Overlap (s):</label>
                                <select id="bn-overlap">
                                    <option value="0" selected>0</option>
                                    <option value="0.5">0.5</option>
                                    <option value="1.0">1.0</option>
                                    <option value="1.5">1.5</option>
                                    <option value="2.0">2.0</option>
                                    <option value="2.5">2.5</option>
                                </select>
                            </div>
                        </div>

                        <div class="bn-box">
                            <div class="bn-row">
                                <input id="bn-use-location" type="checkbox" checked>
                                <label for="bn-use-location" style="cursor:pointer">Use Location</label>
                            </div>
                            <div class="bn-row">
                                <label>Lat:</label><input id="bn-lat" type="number" step="0.0001" placeholder="Lat">
                            </div>
                            <div class="bn-row">
                                <label>Lon:</label><input id="bn-lon" type="number" step="0.0001" placeholder="Lon">
                            </div>
                        </div>
                        
                        <div class="bn-box">
                            <div class="bn-row">
                                <input id="bn-use-custom-list" type="checkbox">
                                <label for="bn-use-custom-list" style="cursor:pointer">Custom List</label>
                            </div>
                            <div class="bn-row">
                                <button id="bn-pick-custom-list" class="seg-btn" style="padding:2px 8px; font-size:11px;" disabled>Load List</button>
                                <input type="file" id="bn-custom-list-file" style="display:none;" accept=".txt,.csv">
                            </div>
                            <div class="bn-row">
                                <span id="bn-custom-list-name" style="font-size:10px; color:#aaa; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"></span>
                            </div>
                        </div>
                    </div>
                    
                    <button id="bn-start-btn" disabled>Start Analysis</button>
                </div>

                <!-- BOTTOM FRAME: Results -->
                <div id="bn-results-frame">
                    <div id="bn-error"></div>
                    <div id="bn-log"></div>
                    
                    <div id="bn-results-grid">
                        <div class="bn-result-col">
                            <h4>Detected Species</h4>
                            <ul id="bn-birdslist"></ul>
                        </div>
                        <div class="bn-result-col">
                            <h4>Unique Species</h4>
                            <ul id="bn-unique-species-list"></ul>
                        </div>
                    </div>
                    
                    <div style="display: flex; align-items: center; gap: 15px; margin-top: 10px; flex: 0 0 auto;">
                        <label style="display: flex; align-items: center; gap: 6px; font-size: 13px; color: #ccc; white-space: nowrap; margin-right: auto;">
                            <input type="checkbox" id="bn-merge-detections">
                            <span>Merge consecutive detections</span>
                        </label>
                        <button id="bn-insert-annotations-btn" disabled>Insert Annotations</button>
                    </div>
                </div>

                <!-- Hidden inputs preserved for logic -->
                <input id="bn-year-around" type="checkbox" checked style="display:none">
                <input id="bn-week" type="number" value="1" style="display:none">
            </div>
        `;

        const startBtn = document.getElementById('bn-start-btn');
        startBtn.onclick = async () => {
            const fileInput = document.getElementById('file');
            const file = fileInput?.files?.[0];
            if (file) await startAnalysis(file);
        };

        const insertBtn = document.getElementById('bn-insert-annotations-btn');
        insertBtn.onclick = () => {
            const selectedSpecies = new Set(Array.from(document.querySelectorAll('#bn-unique-species-list input:checked')).map(cb => cb.value));
            const detections = [];
            document.querySelectorAll('#bn-birdslist li').forEach(li => {
                const span = li.querySelector('span');
                if (span && li.style.display !== 'none' && selectedSpecies.has(span.textContent)) {
                    const startTime = parseFloat(span.dataset.start);
                    detections.push({
                        start: startTime,
                        end: startTime + 3.0, // Add end time for merging logic
                        common: span.textContent,
                        scientific: span.dataset.scientific,
                        confidence: parseFloat(span.dataset.confidence)
                    });
                }
            });
            
            if (detections.length === 0) {
                alert("No detections selected to insert.");
                return;
            }

            insertBirdnetAnnotations(detections);
        };

        const useLocationCb = document.getElementById('bn-use-location');
        const latInput = document.getElementById('bn-lat');
        const lonInput = document.getElementById('bn-lon');
        const yearAroundCb = document.getElementById('bn-year-around');
        const weekInput = document.getElementById('bn-week');
        const useCustomListCb = document.getElementById('bn-use-custom-list');
        const pickCustomListBtn = document.getElementById('bn-pick-custom-list');
        const customListFile = document.getElementById('bn-custom-list-file');
        const customListName = document.getElementById('bn-custom-list-name');
        const areaSlider = document.getElementById('bn-area-confidence');

        function updateDisabledStates() {
            const locActive = useLocationCb.checked;
            const customActive = useCustomListCb.checked;

            latInput.disabled = !locActive;
            lonInput.disabled = !locActive;
            yearAroundCb.disabled = !locActive;
            weekInput.disabled = !locActive || yearAroundCb.checked;

            pickCustomListBtn.disabled = !customActive;
            // Disable area confidence slider if using custom list (since it overrides geo scores)
            areaSlider.disabled = customActive;
        }

        useLocationCb.onchange = () => {
            if (useLocationCb.checked) useCustomListCb.checked = false;
            updateDisabledStates();
        };
        yearAroundCb.onchange = () => {
            updateDisabledStates();
        };

        useCustomListCb.onchange = () => {
            if (useCustomListCb.checked) useLocationCb.checked = false;
            updateDisabledStates();
        };

        pickCustomListBtn.onclick = () => customListFile.click();

        weekInput.onchange = () => {
            let v = parseInt(weekInput.value);
            if (isNaN(v) || v < 1) weekInput.value = 1;
            else if (v > 52) weekInput.value = 52;
        };

        customListFile.onchange = async (e) => {
            const file = e.target.files[0];
            if (file) {
                customListName.textContent = file.name;
                const text = await file.text();
                customSpeciesList = text.split('\n').map(line => line.trim()).filter(Boolean);
            } else {
                customListName.textContent = '';
                customSpeciesList = null;
            }
        };

        document.getElementById('bn-audio-confidence').oninput = (e) => {
            AUDIO_CONFIDENCE = parseFloat(e.target.value);
            document.getElementById('bn-audio-confidence-num').innerText = AUDIO_CONFIDENCE.toFixed(2);
            updateBirds();
        };
        document.getElementById('bn-area-confidence').onchange = (e) => {
            AREA_THRESHOLD = e.target.value / 10;
            document.getElementById('bn-area-confidence-num').innerText = AREA_THRESHOLD.toFixed(2);
            updateBirds();
        };
    }

    function updateBirds() {
        const visibleSpecies = new Set();
        document.querySelectorAll('#bn-birdslist span').forEach(bird => {
            // Use 0.005 tolerance to match visual rounding to 2 decimals
            // e.g. 0.995 rounds to 1.00, so it should be visible if threshold is 1.00
            const TOLERANCE = 0.005;
            const confidence = Number(bird.attributes['data-confidence'].value);
            const areaScore = Number(bird.attributes['data-geoscore'].value);
            const isVisible = areaScore >= (AREA_THRESHOLD - TOLERANCE) && confidence >= (AUDIO_CONFIDENCE - TOLERANCE);
            bird.parentNode.style.display = isVisible ? '' : 'none';
            
            if (isVisible) {
                visibleSpecies.add(bird.textContent);
            }
        });

        // Rebuild unique species list based on visible items
        const uniqueListEl = document.getElementById('bn-unique-species-list');
        // Preserve checked state for existing items where possible
        const checkedState = new Set(Array.from(uniqueListEl.querySelectorAll('input:checked')).map(cb => cb.value));
        
        uniqueListEl.innerHTML = '';
        const sortedSpecies = Array.from(visibleSpecies).sort();
        sortedSpecies.forEach(speciesName => {
            // Default to checked if new, or preserve previous state if it existed
            const shouldCheck = checkedState.has(speciesName) || !birdNetInited; // (relying on initial state or persistence)
            // Actually, simpler UX: if it's in the list, default to checked unless user unchecked it previously? 
            // For now, simple approach: check all visible species by default if they weren't explicitly unchecked (hard to track "explicitly unchecked" without more state). 
            // Let's just check them all effectively on re-filter to ensure "Insert" captures everything currently visible, which is usually desired behavior when filtering.
            // However, to be nicer, let's try to keep checks if the item persists.
            // If we are running a fresh analysis, everything is new.
            
            // Simple logic: if it was checked before (or didn't exist in the list), check it. 
            // If the list was empty (fresh analysis), everything is checked.
            const isChecked = (uniqueListEl.children.length === 0 && checkedState.size === 0) ? true : (checkedState.has(speciesName) || !document.querySelector(`#bn-unique-species-list input[value="${speciesName}"]`));
            // Actually, querying the DOM before clearing is safer.
            // Let's just default to TRUE for all visible species when filters change, as the user likely wants to insert what they filtered for.
            // But if the user unchecked one specifically, we might annoy them. 
            // Let's stick to: Check all visible.
            
            const listItem = document.createElement('li');
            listItem.innerHTML = `<label><input type="checkbox" value="${speciesName}" checked> ${speciesName}</label>`;
            uniqueListEl.appendChild(listItem);
        });

        const insertBtn = document.getElementById('bn-insert-annotations-btn');
        if (insertBtn) insertBtn.disabled = sortedSpecies.length === 0;
    }

    function mergeBirdNETDetections(detections) {
        const MAX_GAP_SEC = 1.0;
        if (!detections || detections.length <= 1) return detections;

        // 1. Group by species (common name)
        const groupedBySpecies = detections.reduce((acc, det) => {
            const species = det.common;
            if (!acc[species]) {
                acc[species] = [];
            }
            acc[species].push(det);
            return acc;
        }, {});

        const finalDetections = [];

        // 2. Process each species group
        for (const species in groupedBySpecies) {
            const speciesDetections = groupedBySpecies[species];
            if (speciesDetections.length <= 1) {
                finalDetections.push(...speciesDetections);
                continue;
            }

            // Sort by start time
            speciesDetections.sort((a, b) => a.start - b.start);
            
            const mergedForSpecies = [];
            let current = { ...speciesDetections[0] };
            let merged = false; // Track if the current block is a result of a merge

            for (let i = 1; i < speciesDetections.length; i++) {
                const next = speciesDetections[i];
                const gap = next.start - current.end;
                
                // Condition to merge: gap is small (less than 1s), or they overlap
                if (gap < MAX_GAP_SEC) {
                    // Merge: extend end time, take max confidence
                    current.end = Math.max(current.end, next.end);
                    current.confidence = Math.max(current.confidence, next.confidence);
                    merged = true;
                } else {
                    if (merged) {
                        current.isMerged = true;
                    }
                    mergedForSpecies.push(current);
                    current = { ...next };
                    merged = false;
                }
            }
            // Add the last block
            if (merged) {
                current.isMerged = true;
            }
            mergedForSpecies.push(current);

            finalDetections.push(...mergedForSpecies);
        }

        // Sort the final combined list by start time for consistent output order
        finalDetections.sort((a, b) => a.start - b.start);

        return finalDetections;
    }

    function insertBirdnetAnnotations(detections) {
        if (!window.annotationGrid) {
            alert("Main annotation table not found.");
            return;
        }

        // Determine next ID based on existing rows
        const shouldMerge = document.getElementById('bn-merge-detections').checked;
        let finalDetections = detections;

        if (shouldMerge) {
            finalDetections = mergeBirdNETDetections(detections);
        }

        const rowsToCreate = finalDetections.map((d) => {
            const note = d.isMerged ? "Birdnet detection: Scores - NA (Merged)" : `Birdnet detection. Score - ${Number(d.confidence).toFixed(2)}`;
            return {
                beginTime: d.start,
                endTime: d.end,
                lowFreq: 0,
                highFreq: 15000,
                species: d.common,
                scientificName: d.scientific,
                sex: '',
                lifeStage: '',
                soundType: '', 
                notes: note
            };
        });
        const addedRows = globalThis._annotations.addMany(rowsToCreate, 'birdnet-insert');

        // Provide feedback and close the overlay
        alert(`Successfully inserted ${addedRows.length} annotations into the annotation table.`);
        const modal = document.getElementById(MODAL_ID);
        if (modal) modal.style.display = 'none';
    }

    async function loadingScreen({ version = 1 } = {}) {
        document.getElementById('bn-progress').style.display = 'block';
        let SR = 48000;
        let C3S = 144000;
        let path = 'birdnet_v2.4.js?lang=' + navigator.language;

        const BirdNetWorker = new Worker(path);
        async function BirdNetJS(data) {
            BirdNetWorker.postMessage(data);
            return new Promise(resolve => {
                function onMessage({ data: dataRes }) {
                    if (dataRes.message === data.message) {
                        BirdNetWorker.removeEventListener('message', onMessage);
                        resolve(dataRes);
                    }
                }
                BirdNetWorker.addEventListener('message', onMessage);
            });
        }

        // Manual inputs requested: Commenting out automatic browser geolocation
        // const geolocation = new Promise((resolve, reject) => {
        //     navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false });
        // });

        await new Promise((resolve) => {
            function onLoadingMessage({ data }) {
                if (data.progress) document.querySelector('#bn-progress_bar').value = data.progress;
                if (data.message === 'load_model') document.getElementById('bn-progress_text').innerText = 'Loading BirdNET model...';
                if (data.message === 'warmup') document.getElementById('bn-progress_text').innerText = 'BirdNET warmup run...';
                if (data.message === 'load_labels') document.getElementById('bn-progress_text').innerText = 'Loading bird labels...';
                if (data.message === 'load_geomodel') document.getElementById('bn-progress_text').innerText = 'Loading geolocation model...';
                if (data.message === 'loaded') {
                    BirdNetWorker.removeEventListener('message', onLoadingMessage);
                    resolve();
                }
            }
            BirdNetWorker.addEventListener('message', onLoadingMessage);
        });

        document.getElementById('bn-progress').style.display = 'none';
        return { BirdNetJS, SR, C3S };
    }

    async function startAnalysis(file) {
        const startBtn = document.getElementById('bn-start-btn');
        if (startBtn) startBtn.disabled = true;

        document.getElementById('bn-error').innerHTML = '';
        document.getElementById('bn-birdslist').innerHTML = '';
        document.getElementById('bn-unique-species-list').innerHTML = '';
        document.getElementById('bn-log').innerHTML = '';

        const useLocation = document.getElementById('bn-use-location').checked;
        const yearAround = document.getElementById('bn-year-around').checked;
        const useCustomList = document.getElementById('bn-use-custom-list').checked;
        const weekNum = parseInt(document.getElementById('bn-week').value) || 1;
        
        const latVal = document.getElementById('bn-lat').value;
        const lonVal = document.getElementById('bn-lon').value;
        const hasLocation = latVal.trim() !== '' && lonVal.trim() !== '';

        if (useLocation && hasLocation) {
            const lat = parseFloat(latVal);
            const lon = parseFloat(lonVal);

            document.getElementById('bn-progress').style.display = 'block';
            document.getElementById('bn-progress_text').innerText = 'Updating area model...';
            try {
                await BirdNetJSInstance({ 
                    message: 'area-scores', 
                    latitude: lat, 
                    longitude: lon, 
                    week: yearAround ? -1 : weekNum 
                });
            } catch (e) {
                document.getElementById('bn-log').innerText = 'Area score update failed.';
            }
        } else if (useCustomList && customSpeciesList) {
            document.getElementById('bn-progress').style.display = 'block';
            document.getElementById('bn-progress_text').innerText = 'Applying custom species list...';
            try {
                await BirdNetJSInstance({ message: 'set_species_list', list: customSpeciesList });
            } catch (e) {
                document.getElementById('bn-log').innerText = 'Failed to apply custom species list.';
            }
        } else {
            document.getElementById('bn-progress').style.display = 'block';
            document.getElementById('bn-progress_text').innerText = 'Disabling area filter...';
            try {
                await BirdNetJSInstance({ message: 'reset-area' });
            } catch (e) {
                console.error("Failed to reset area scores", e);
            }
        }
        // Add status update before decoding audio, which can be slow
        document.getElementById('bn-progress_text').innerText = 'Decoding audio file...';
        await new Promise(r => setTimeout(r, 20)); // Allow UI to repaint

        try {
            await processAudio(file);
        } finally {
            if (startBtn) startBtn.disabled = false;
        }
    }

    async function processAudio(file) {
        if (!file) return;
        document.getElementById('bn-progress').style.display = 'block';
        document.getElementById('bn-progress_bar').value = 0;
        
        try {
            let start = performance.now();
            const arrayBuffer = await file.arrayBuffer();
            const tempCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
            const originalBuffer = await tempCtx.decodeAudioData(arrayBuffer);
            const pcmAudio = new Float32Array(originalBuffer.getChannelData(0));
            tempCtx.close();
            
            const audioLen = pcmAudio.length / SAMPLE_RATE;
            // Removed decoding status log as requested
            
            start = performance.now();

            const overlapSec = parseFloat(document.getElementById('bn-overlap').value) || 0;
            const chunkDur = CHUNK_3S / SAMPLE_RATE; // 3.0s
            // Stride = Chunk Duration - Overlap. Ensure at least 0.1s stride to prevent infinite loops.
            const strideSamples = Math.max(Math.floor(0.1 * SAMPLE_RATE), Math.floor((chunkDur - overlapSec) * SAMPLE_RATE));

            for (let k = 0; k < pcmAudio.length; k += strideSamples) {
                let pcm3sChunk = pcmAudio.slice(k, k + CHUNK_3S);
                if (pcm3sChunk.length < CHUNK_3S) {
                    let extBuf = new Float32Array(CHUNK_3S);
                    extBuf.set(pcm3sChunk, 0);
                    pcm3sChunk = extBuf;
                }
                const { prediction } = await BirdNetJSInstance({ message: 'predict', pcmAudio: pcm3sChunk });
                document.getElementById('bn-progress_bar').value = k / pcmAudio.length * 100 | 0;
                
                const birdElems = [];
                for (let j = 0; j < prediction.length; j++) {
                    const audioConfidence = prediction[j].confidence;
                    const areaConfidence = prediction[j].geoscore;
                    const startS = k / SAMPLE_RATE;
                    const m = Math.floor(startS / 60);
                    const s = (startS % 60).toFixed(1); // Keep 1 decimal for precise start time
                    const time = `${m.toString().padStart(2, '0')}:${s.padStart(4, '0')}`; // e.g. 00:02.5
                    const birdElem = document.createElement('li');
                    const TOLERANCE = 0.005;
                    const visible = audioConfidence >= (AUDIO_CONFIDENCE - TOLERANCE) && areaConfidence >= (AREA_THRESHOLD - TOLERANCE);
                    birdElem.style.display = visible ? '' : 'none';
                    birdElem.innerHTML = `${time} - <span data-geoscore="${areaConfidence}" data-confidence="${audioConfidence}" data-start="${k / SAMPLE_RATE}" data-scientific="${prediction[j].scientific || ''}">${prediction[j].nameI18n}</span> (${audioConfidence.toFixed(2)})`;
                    birdElems.push(birdElem);
                }
                document.getElementById('bn-birdslist').append(...birdElems);
            }

            // Update filters and unique list based on the newly populated results
            updateBirds();

            const timeSpent = (performance.now() - start) / 1000;
            document.getElementById('bn-progress').style.display = 'none';
            document.getElementById('bn-log').innerHTML += `Inference time: ${timeSpent.toFixed(1)}s (x${audioLen / timeSpent | 0})<br />`;
        } catch (e) {
            document.getElementById('bn-progress').style.display = 'none';
            document.getElementById('bn-error').innerText = 'Error processing audio: ' + e.message;
            console.error(e);
        }
    }

    async function openOverlay() {
        const fileInput = document.getElementById('file');
        const file = fileInput?.files?.[0];
        if (!file) {
            alert("Please load an audio file in the main viewer first.");
            return;
        }

        let modal = document.getElementById(MODAL_ID);
        if (!modal) {
            modal = document.createElement('div');
            modal.id = MODAL_ID;
            modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:2147483650;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';
            modal.innerHTML = `
                <div style="background:#222; width:95%; height:90%; border-radius:12px; display:flex; flex-direction:column; border:1px solid #444; position:relative; overflow:hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.5);">
                    <div style="padding:12px 20px; background:#111; border-bottom:1px solid #333; display:flex; flex-direction:column; gap:5px;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span style="color:bisque; font-family:monospace; font-weight:bold; font-size:14px;">BirdNET Model V2.4 (tfjs)</span>
                            <button id="bn-close" style="background:none; border:none; color:#ff6b6b; font-size:28px; cursor:pointer; line-height:1;">&times;</button>
                        </div>
                        <div style="font-size:11px; color:#888; line-height:1.3;">
                            BirdNET AI model by the K. Lisa Yang Center for Conservation Bioacoustics at the Cornell Lab of Ornithology in collaboration with Chemnitz University of Technology. Stefan Kahl, Connor Wood, Maximilian Eibl, Holger Klinck. 
                            <a href="https://github.com/birdnet-team/BirdNET-Analyzer" target="_blank" style="color:#aaa;text-decoration:underline;">BirdNET Analyzer</a>, 
                            <a href="https://zenodo.org/records/15050749" target="_blank" style="color:#aaa;text-decoration:underline;">BirdNET Models</a>
                        </div>
                    </div>
                    <div id="bn-content-wrapper" style="flex:1; display:flex; flex-direction:column; overflow:hidden;"></div>
                </div>
            `;
            document.body.appendChild(modal);
            document.getElementById('bn-close').onclick = () => { modal.style.display = 'none'; };
            buildUI(document.getElementById('bn-content-wrapper'));
        }

        modal.style.display = 'flex';

        try {
            if (!birdNetInited) {
                const res = await loadingScreen();
                BirdNetJSInstance = res.BirdNetJS;
                SAMPLE_RATE = res.SR;
                CHUNK_3S = res.C3S;
                birdNetInited = true;
            }
            const startBtn = document.getElementById('bn-start-btn');
            if (startBtn) startBtn.disabled = false;
        } catch (e) {
            const errEl = document.getElementById('bn-error');
            if (errEl) errEl.innerText = e.stack || e.message;
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();