// spectral_stamp.js
// Pattern: Mirrored after repeat_annotation.js for seamless Spectrolipi integration

(function () {
    const COPY_BTN_ID = 'spectralCopyBtn';
    let stampState = 'off'; // 'off', 'drawing_dest', 'moving_source'
    let destRegion = null; 
    let isDrawing = false;
    let drawStartCoords = null;
    let boxA = null; // Destination box
    let boxB = null; // Source box (ghost)

    function getMapping() {
        const pxPerSec = (globalThis._spectroMap && typeof globalThis._spectroMap.pxPerSec === 'function')
            ? globalThis._spectroMap.pxPerSec()
            : (globalThis._spectroPxPerSec || 1);
        const spectrogramCanvas = document.getElementById('spectrogramCanvas');
        const imageHeight = (typeof globalThis._spectroImageHeight === 'number' && globalThis._spectroImageHeight > 0)
            ? globalThis._spectroImageHeight
            : Math.max(1, (spectrogramCanvas ? spectrogramCanvas.clientHeight : 300) - 12 - 44);
        const ymaxHz = (typeof globalThis._spectroYMax === 'number' && globalThis._spectroYMax > 0)
            ? globalThis._spectroYMax
            : (globalThis._spectroSampleRate ? globalThis._spectroSampleRate / 2 : 22050);
        const yminHz = (typeof globalThis._spectroYMin === 'number') ? globalThis._spectroYMin : 0;
        const axisLeft = (typeof globalThis._spectroAxisLeft === 'number') ? globalThis._spectroAxisLeft : 70;
        return { pxPerSec, imageHeight, ymaxHz, yminHz, axisLeft };
    }

    function init() {
        const btn = document.getElementById(COPY_BTN_ID);
        if (!btn) return;

        btn.addEventListener('click', (ev) => {
            ev.preventDefault();
            if (stampState === 'off') {
                stampState = 'drawing_dest';
                btn.style.setProperty('background', '#43a047', 'important');
                createBoxes();
                if (typeof globalThis.disarmCutMode === 'function') {
                    globalThis.disarmCutMode(true);
                }
            } else {
                cancelStampMode();
            }
        });

        const wrapper = document.getElementById('viewportWrapper');
        if (wrapper) {
            wrapper.addEventListener('pointerdown', onPointerDown, true);
            wrapper.addEventListener('pointermove', onPointerMove, true);
            wrapper.addEventListener('pointerup', onPointerUp, true);
            wrapper.addEventListener('pointerleave', onPointerLeave, true);
        }

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && stampState !== 'off') cancelStampMode();
        });
    }

    function createBoxes() {
        const scrollArea = document.getElementById('scrollArea');
        if (!scrollArea) return;
        
        if (!boxA) {
            boxA = document.createElement('div');
            boxA.style.position = 'absolute';
            boxA.style.pointerEvents = 'none';
            boxA.style.background = 'rgba(255, 152, 0, 0.3)';
            boxA.style.border = '2px dashed #f57c00';
            boxA.style.zIndex = '9999';
            scrollArea.appendChild(boxA);
        }
        if (!boxB) {
            boxB = document.createElement('div');
            boxB.style.position = 'absolute';
            boxB.style.pointerEvents = 'none';
            boxB.style.background = 'rgba(76, 175, 80, 0.4)';
            boxB.style.border = '2px dashed #2e7d32';
            boxB.style.zIndex = '9999';
            scrollArea.appendChild(boxB);
        }
        boxA.style.display = 'none';
        boxB.style.display = 'none';
    }

    function cancelStampMode() {
        stampState = 'off';
        isDrawing = false;
        destRegion = null;
        if (boxA) boxA.style.display = 'none';
        if (boxB) boxB.style.display = 'none';
        const btn = document.getElementById(COPY_BTN_ID);
        if (btn) btn.style.removeProperty('background');

        if (globalThis._spectroMouse) globalThis._spectroMouse.clearCrosshair();
        
        // Force the native toolbar manager to sync its state
        try { if (typeof globalThis.updateCutButtonEnabled === 'function') globalThis.updateCutButtonEnabled(); } catch(e){}
    }
    globalThis.cancelStampMode = cancelStampMode;

    function getCoords(ev) {
        const scrollArea = document.getElementById('scrollArea');
        const rect = scrollArea.getBoundingClientRect();
        const x = ev.clientX - rect.left + (scrollArea.scrollLeft || 0);
        const y = ev.clientY - rect.top;
        return { x, y };
    }

    function onPointerDown(ev) {
        if (stampState === 'off' || ev.button !== 0) return;

        const current = getCoords(ev);
        const AXIS_TOP = 12;
        const { imageHeight } = getMapping();
        if (current.y < AXIS_TOP || current.y > AXIS_TOP + imageHeight) return;

        ev.stopPropagation();
        ev.stopImmediatePropagation();
        ev.preventDefault();

        if (stampState === 'drawing_dest') {
            isDrawing = true;
            drawStartCoords = current;
            boxA.style.left = drawStartCoords.x + 'px';
            boxA.style.top = drawStartCoords.y + 'px';
            boxA.style.width = '0px';
            boxA.style.height = '0px';
            boxA.style.display = 'block';
            boxB.style.display = 'none';
        } else if (stampState === 'moving_source') {
            executeStamp(ev);
        }
    }

    function onPointerMove(ev) {
        if (stampState === 'off') return;

        if (stampState === 'drawing_dest') {
            if (globalThis._spectroMouse) {
                const pos = globalThis._spectroMouse.clientToOverlayLocal(ev);
                globalThis._spectroMouse.drawCrosshair(pos.x, pos.y);
            }

            if (isDrawing) {
                ev.preventDefault();

                const current = getCoords(ev);
                const left = Math.min(drawStartCoords.x, current.x);
                const top = Math.min(drawStartCoords.y, current.y);
                const width = Math.abs(current.x - drawStartCoords.x);
                const height = Math.abs(current.y - drawStartCoords.y);

                boxA.style.left = left + 'px';
                boxA.style.top = top + 'px';
                boxA.style.width = width + 'px';
                boxA.style.height = height + 'px';
            }
        } else if (stampState === 'moving_source') {
            if (globalThis._spectroMouse) {
                globalThis._spectroMouse.clearCrosshair();
            }
            
            const current = getCoords(ev);
            const width = parseFloat(boxA.style.width);
            const height = parseFloat(boxA.style.height);
            const top = parseFloat(boxA.style.top);

            boxB.style.left = (current.x - width / 2) + 'px';
            boxB.style.top = top + 'px';
            boxB.style.width = width + 'px';
            boxB.style.height = height + 'px';
            boxB.style.display = 'block';
        }
    }

    function onPointerUp(ev) {
        if (stampState === 'drawing_dest' && isDrawing) {
            ev.stopPropagation();
            ev.stopImmediatePropagation();
            ev.preventDefault();

            isDrawing = false;
            const width = parseFloat(boxA.style.width) || 0;
            const height = parseFloat(boxA.style.height) || 0;

            if (width < 5 || height < 5) {
                boxA.style.display = 'none';
                return; 
            }

            const { pxPerSec, imageHeight, ymaxHz, yminHz } = getMapping();
            const left = parseFloat(boxA.style.left);
            const top = parseFloat(boxA.style.top);
            const bottom = top + height;

            const startSec = left / pxPerSec;
            const endSec = (left + width) / pxPerSec;

            const AXIS_TOP = 12;
            const t1 = (top - AXIS_TOP) / imageHeight;
            const t2 = (bottom - AXIS_TOP) / imageHeight;

            const spanHz = Math.max(1, ymaxHz - yminHz);
            const f1 = ymaxHz - t1 * spanHz;
            const f2 = ymaxHz - t2 * spanHz;

            destRegion = {
                startSec: Math.max(0, startSec),
                endSec: Math.max(0, endSec),
                highFreq: Math.min(ymaxHz, Math.max(yminHz, Math.max(f1, f2))),
                lowFreq: Math.min(ymaxHz, Math.max(yminHz, Math.min(f1, f2))),
                duration: endSec - startSec
            };

            stampState = 'moving_source';
            
            if (globalThis._spectroMouse) globalThis._spectroMouse.clearCrosshair();
        }
    }

    async function executeStamp(ev) {
        const { pxPerSec } = getMapping();
        const current = getCoords(ev);
        const sourceCenterSec = current.x / pxPerSec;
        const sourceStartSec = Math.max(0, sourceCenterSec - destRegion.duration / 2);
        const sourceEndSec = sourceStartSec + destRegion.duration;

        try {
            if (window.__spectroWait) window.__spectroWait.show({ titleText: 'Stamping...' });
            
            // Capture the spectrogram and audio state before applying the stamp to enable Undo
            let snap = null;
            try { 
                if (typeof globalThis.snapshotSpectrogramState === 'function') {
                    snap = globalThis.snapshotSpectrogramState();
                }
            } catch(e) {}
            if (snap) {
                try { if (typeof globalThis._setSpectroLastSnapshot === 'function') globalThis._setSpectroLastSnapshot(snap); } catch(e){}
            }

            await executeSpectralPasteDSP(sourceStartSec, sourceEndSec, destRegion.startSec, destRegion.lowFreq, destRegion.highFreq);
            
            // Visual Refresh
            const totalFrames = globalThis._spectroNumFrames || 0;
            if (totalFrames > 0 && typeof globalThis._spectrogram_recomputeFrames === 'function') {
                const sr = globalThis._spectroSampleRate || 44100;
                const N = globalThis._spectroFFTSize || 2048;
                const hop = Math.max(1, Math.floor(N / 2));
                const frameStart = Math.max(0, Math.floor((destRegion.startSec * sr - N) / hop));
                const frameEnd = Math.min(totalFrames - 1, Math.ceil(((destRegion.startSec + destRegion.duration) * sr + N) / hop));
                await globalThis._spectrogram_recomputeFrames(frameStart, frameEnd);
            } else if (typeof globalThis._rebuildAllTilesFromSpectra === 'function') {
                await globalThis._rebuildAllTilesFromSpectra();
            }
            
            // Force the native toolbar manager to sync its state and light up the Undo button
            try { if (typeof globalThis.updateCutButtonEnabled === 'function') globalThis.updateCutButtonEnabled(); } catch(e){}
            
            try {
                const t = document.createElement('div');
                t.textContent = 'Stamp applied';
                t.style.position='fixed'; t.style.left='50%'; t.style.transform='translateX(-50%)'; t.style.bottom='20px'; t.style.background='rgba(0,0,0,0.8)'; t.style.color='#fff'; t.style.padding='6px 10px'; t.style.borderRadius='6px'; t.style.zIndex='2147483646';
                document.body.appendChild(t); setTimeout(()=>{ try { t.remove(); } catch(e){} }, 2000);
            } catch(e){}
            
        } catch (e) {
            console.error("Stamp Error:", e);
            alert("Stamp failed: " + e.message);
        } finally {
            if (window.__spectroWait) window.__spectroWait.hide();
            // Keep stamp mode active, reset cycle to draw a new destination box
            stampState = 'drawing_dest';
            isDrawing = false;
            destRegion = null;
            if (boxA) boxA.style.display = 'none';
            if (boxB) boxB.style.display = 'none';
        }
    }

    async function executeSpectralPasteDSP(srcStart, srcEnd, destStart, lowHz, highHz) {
        const audioBuf = globalThis._spectroAudioBuffer;
        if (!audioBuf) throw new Error("No audio buffer.");
        
        const sr = audioBuf.sampleRate;
        const numSamples = Math.floor((srcEnd - srcStart) * sr);
        const srcStartSample = Math.floor(srcStart * sr);
        const destStartSample = Math.floor(destStart * sr);

        const finalNumSamples = Math.min(numSamples, audioBuf.length - srcStartSample, audioBuf.length - destStartSample);
        if (finalNumSamples <= 0) return;

        // --- NEW: Deep clone the audio buffer so the Undo Snapshot holds the unmodified state ---
        const CtxClass = window.AudioContext || window.webkitAudioContext;
        const tempCtx = new CtxClass();
        const newAudioBuf = tempCtx.createBuffer(audioBuf.numberOfChannels, audioBuf.length, audioBuf.sampleRate);
        for (let c = 0; c < audioBuf.numberOfChannels; c++) {
            newAudioBuf.copyToChannel(audioBuf.getChannelData(c), c);
        }
        try { if (typeof tempCtx.close === 'function') tempCtx.close(); } catch (e) {}

        function reverseBits(x, bits) {
            let y = 0;
            for (let i = 0; i < bits; i++) { y = (y << 1) | (x & 1); x >>>= 1; }
            return y;
        }

        function fft(real, imag) {
            const n = real.length;
            const levels = Math.log2(n) | 0;
            for (let i = 0; i < n; i++) {
                const j = reverseBits(i, levels);
                if (j > i) {
                    const tr = real[i], ti = imag[i];
                    real[i] = real[j]; imag[i] = imag[j];
                    real[j] = tr; imag[j] = ti;
                }
            }
            for (let size = 2; size <= n; size <<= 1) {
                const half = size >>> 1;
                const theta = -2 * Math.PI / size;
                const wpr = Math.cos(theta), wpi = Math.sin(theta);
                for (let i = 0; i < n; i += size) {
                    let wr = 1, wi = 0;
                    for (let j = 0; j < half; j++) {
                        const k = i + j, l = k + half;
                        const tr = wr * real[l] - wi * imag[l];
                        const ti = wr * imag[l] + wi * real[l];
                        real[l] = real[k] - tr; imag[l] = imag[k] - ti;
                        real[k] += tr; imag[k] += ti;
                        const tmp = wr;
                        wr = tmp * wpr - wi * wpi;
                        wi = tmp * wpi + wi * wpr;
                    }
                }
            }
        }

        function ifft(real, imag) {
            const n = real.length;
            for (let i = 0; i < n; i++) imag[i] = -imag[i];
            fft(real, imag);
            for (let i = 0; i < n; i++) { real[i] /= n; imag[i] = -imag[i] / n; }
        }

        // Use the exact same FFT size as the spectrogram for mathematical visual parity
        const N = globalThis._spectroFFTSize || 2048; 
        const hop = N / 2;
        const windowF32 = new Float32Array(N);
        for (let i = 0; i < N; i++) {
            windowF32[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / N));
        }

        const binLow = Math.floor((lowHz / (sr / 2)) * (N / 2));
        const binHigh = Math.ceil((highHz / (sr / 2)) * (N / 2));

        const padFrames = 2; 
        const padSamples = padFrames * N;
        const lengthToProcess = finalNumSamples + 2 * padSamples;
        const numFrames = Math.floor((lengthToProcess - N) / hop) + 1;

        for (let ch = 0; ch < newAudioBuf.numberOfChannels; ch++) {
            const data = newAudioBuf.getChannelData(ch);   // We modify the clone
            const origData = audioBuf.getChannelData(ch);  // We read from the pristine original
            const outBuf = new Float32Array(lengthToProcess);
            
            for (let f = 0; f < numFrames; f++) {
                const offset = f * hop;
                const reSrc = new Float32Array(N);
                const imSrc = new Float32Array(N);
                const reDest = new Float32Array(N);
                const imDest = new Float32Array(N);
                
                for (let i = 0; i < N; i++) {
                    const sPos = srcStartSample - padSamples + offset + i;
                    if (sPos >= 0 && sPos < origData.length) reSrc[i] = origData[sPos] * windowF32[i];
                    
                    const dPos = destStartSample - padSamples + offset + i;
                    if (dPos >= 0 && dPos < origData.length) reDest[i] = origData[dPos] * windowF32[i];
                }
                
                fft(reSrc, imSrc);
                fft(reDest, imDest);
                
                const frameCenter = offset + hop;
                let fade = 0.0;
                if (frameCenter >= padSamples && frameCenter <= padSamples + finalNumSamples) {
                    fade = 1.0;
                } else {
                    const dist = frameCenter < padSamples ? (padSamples - frameCenter) : (frameCenter - (padSamples + finalNumSamples));
                    fade = Math.max(0, 1.0 - (dist / hop));
                }
                
                for (let b = 0; b <= N / 2; b++) {
                    const symB = b === 0 ? 0 : N - b;
                    if (b >= binLow && b <= binHigh) {
                        const mixRe = reDest[b] * (1 - fade) + reSrc[b] * fade;
                        const mixIm = imDest[b] * (1 - fade) + imSrc[b] * fade;
                        
                        reDest[b] = mixRe;
                        imDest[b] = mixIm;
                        if (symB !== 0 && symB !== b) {
                            reDest[symB] = mixRe;
                            imDest[symB] = -mixIm;
                        }
                    }
                }
                
                ifft(reDest, imDest);
                
                for (let i = 0; i < N; i++) {
                    outBuf[offset + i] += reDest[i];
                }
            }
            
            // Time-domain crossfade to prevent clicks while strictly containing the modification
            const fadeSamples = Math.max(1, Math.min(Math.floor(sr * 0.01), Math.floor(finalNumSamples / 4))); 
            
            for (let i = 0; i < finalNumSamples; i++) {
                const dPos = destStartSample + i;
                if (dPos >= 0 && dPos < data.length) {
                    let mix = 1.0;
                    if (i < fadeSamples) {
                        mix = Math.max(0, i / fadeSamples);
                        mix = mix * mix * (3 - 2 * mix); // smoothstep
                    } else if (i >= finalNumSamples - fadeSamples) {
                        mix = Math.max(0, (finalNumSamples - 1 - i) / fadeSamples);
                        mix = mix * mix * (3 - 2 * mix);
                    }
                    data[dPos] = origData[dPos] * (1 - mix) + outBuf[padSamples + i] * mix;
                }
            }
            
            if (globalThis.fastYield) await globalThis.fastYield();
            else await new Promise(r => setTimeout(r, 0));
        }

        // Replace global buffer so the Undo stack perfectly holds the original pointer
        globalThis._spectroAudioBuffer = newAudioBuf;
    }

    function onPointerLeave(ev) {
        if (stampState === 'drawing_dest' && !isDrawing) {
            if (globalThis._spectroMouse) globalThis._spectroMouse.clearCrosshair();
        }
    }

    init();
})();