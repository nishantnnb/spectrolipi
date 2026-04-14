// video_export.js
// Records a video of the spectrogram (playback + annotations + audio).
// Uses an inline Web Worker to ensure rendering continues even if the browser tab is in the background.

(function() {
  const MODAL_ID = 'videoExportModal';
  let activeWorker = null;
  let activeAudioCtx = null;
  let activeRecorder = null;
  let isRecording = false;

  function buildModal() {
    let modal = document.getElementById(MODAL_ID);
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:2147483655;display:none;align-items:center;justify-content:center;backdrop-filter:blur(2px);';
    modal.innerHTML = `
      <div style="background:#111;color:#fff;width:95%;max-width:420px;padding:20px;border-radius:10px;border:1px solid rgba(255,255,255,0.05);font-family:system-ui,sans-serif;box-shadow:0 12px 36px rgba(0,0,0,0.4);">
        <h3 style="margin:0 0 12px 0;font-size:18px;">Export Video</h3>
        <p style="font-size:13px;color:#ccc;line-height:1.4;margin-bottom:16px;">
          Record a video of the spectrogram playback including audio and annotations. 
          This process runs reliably even if the browser tab is minimized.
        </p>
        <div style="background:#1a1a1a;padding:12px;border-radius:6px;border:1px solid #333;margin-bottom:16px;">
          <div style="display:flex; align-items:center; gap:12px; margin-bottom:10px;">
            <label style="font-size:13px; color:#ddd; white-space:nowrap; width:115px;">Start at (mm:ss):</label>
            <div style="display:flex; align-items:center; gap:4px;">
                <input id="ve-start-m" type="text" inputmode="numeric" value="0" style="width:45px;padding:4px;background:#111;color:#fff;border:1px solid #555;border-radius:4px;text-align:center;font-size:13px;">
                <span style="color:#fff;font-weight:bold;">:</span>
                <input id="ve-start-s" type="text" inputmode="numeric" value="0" style="width:45px;padding:4px;background:#111;color:#fff;border:1px solid #555;border-radius:4px;text-align:center;font-size:13px;">
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:12px;">
            <label style="font-size:13px; color:#ddd; white-space:nowrap; width:115px;">Video duration (s):</label>
            <div style="display:flex; align-items:center; gap:10px;">
                <label style="font-size:13px; color:#fff; display:flex; align-items:center; gap:4px; cursor:pointer;"><input type="radio" name="ve-duration" value="30"> 30</label>
                <label style="font-size:13px; color:#fff; display:flex; align-items:center; gap:4px; cursor:pointer;"><input type="radio" name="ve-duration" value="60" checked> 60</label>
            </div>
          </div>
          <div id="ve-range-warning" style="font-size:12px;color:#ff6b6b;margin-top:10px;display:none;"></div>
        </div>
        <div style="background:#1a1a1a;padding:12px;border-radius:6px;border:1px solid #333;margin-bottom:16px;">
          <div style="font-size:13px;color:#aaa;margin-bottom:6px;">Video Format (Dimensions):</div>
          <select id="ve-format" style="width:100%;padding:8px;background:#111;color:#fff;border:1px solid #444;border-radius:4px;font-size:13px;">
            <option value="reel" selected>Reel (1080 x 1920)</option>
            <option value="portrait">Potrait feed (1080 x 1350)</option>
            <option value="square">Square feed (1080 x 1080)</option>
          </select>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px;">
          <button id="ve-cancel" style="background:transparent;border:1px solid #4b5563;color:#cbd5e1;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:13px;">Cancel</button>
          <button id="ve-start" style="background:#2196F3;color:#fff;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">Export video</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    modal.querySelector('#ve-cancel').onclick = () => { modal.style.display = 'none'; };
    modal.querySelector('#ve-start').onclick = () => {
        modal.style.display = 'none';
        startVideoRecording();
    };
    
    const validate = () => getAndValidateRange(modal);
    const enforceLimits = (e) => {
        let val = e.target.value.replace(/[^0-9]/g, ''); // Strip negative signs, decimals, letters
        if (val.length > 2) val = val.slice(0, 2);       // Max 2 characters
        if (parseInt(val, 10) > 59) val = '59';          // Max value 59
        e.target.value = val;
        validate();
    };
    modal.querySelector('#ve-start-m').addEventListener('input', enforceLimits);
    modal.querySelector('#ve-start-s').addEventListener('input', enforceLimits);
    modal.querySelectorAll('input[name="ve-duration"]').forEach(r => r.addEventListener('change', validate));

    return modal;
  }

  function getAndValidateRange(modalEl) {
    const modal = modalEl || document.getElementById(MODAL_ID);
    if (!modal) return null;
    
    const audioLen = globalThis._spectroAudioBuffer ? globalThis._spectroAudioBuffer.duration : 0;
    const m = parseInt(modal.querySelector('#ve-start-m').value) || 0;
    const s = parseInt(modal.querySelector('#ve-start-s').value) || 0;
    const startSec = m * 60 + s;
    const durSec = parseInt(modal.querySelector('input[name="ve-duration"]:checked').value) || 60;
    
    const warning = modal.querySelector('#ve-range-warning');
    const startBtn = modal.querySelector('#ve-start');
    
    const formatMMSS = (sec) => {
        const fm = Math.floor(sec / 60);
        const fs = Math.floor(sec % 60);
        return `${fm}:${fs.toString().padStart(2, '0')}`;
    };

    if (startSec >= audioLen) {
        warning.textContent = `Start time cannot exceed audio length (${formatMMSS(audioLen)}).`;
        warning.style.color = '#ff6b6b';
        warning.style.display = 'block';
        startBtn.disabled = true;
        startBtn.style.opacity = '0.5';
        startBtn.style.cursor = 'not-allowed';
        return null;
    } else if (startSec + durSec > audioLen) {
        const actualDur = audioLen - startSec;
        warning.textContent = `Note: Video will end at audio length (Duration: ${actualDur.toFixed(1)}s).`;
        warning.style.color = '#cbd5e1';
        warning.style.display = 'block';
        startBtn.disabled = false;
        startBtn.style.opacity = '1';
        startBtn.style.cursor = 'pointer';
        return { startSec, endSec: audioLen, duration: actualDur };
    } else {
        warning.style.display = 'none';
        startBtn.disabled = false;
        startBtn.style.opacity = '1';
        startBtn.style.cursor = 'pointer';
        return { startSec, endSec: startSec + durSec, duration: durSec };
    }
  }

  window.__openVideoExportModal = function() {
    if (!globalThis._spectroAudioBuffer) {
        alert('No audio loaded. Please load an audio file and generate a spectrogram first.');
        return;
    }
    
    const modal = buildModal();
    
    let startSec = 0;
    let durSec = 60;
    
    if (typeof window._spectroHasSelection === 'function' && window._spectroHasSelection()) {
        const sel = globalThis._spectroCurrentSelection;
        if (sel && isFinite(sel.start) && isFinite(sel.end)) {
            startSec = sel.start;
            durSec = sel.end - sel.start;
        }
    }
    
    let m = Math.floor(startSec / 60);
    const s = Math.floor(startSec % 60);
    if (m > 59) m = 59;
    modal.querySelector('#ve-start-m').value = m;
    modal.querySelector('#ve-start-s').value = s;

    const radios = modal.querySelectorAll('input[name="ve-duration"]');
    let bestDiff = Infinity;
    let bestVal = '60';
    radios.forEach(r => {
       const diff = Math.abs(Number(r.value) - durSec);
       if (diff < bestDiff) { bestDiff = diff; bestVal = r.value; }
    });
    radios.forEach(r => r.checked = (r.value === bestVal));
    
    getAndValidateRange(modal);
    modal.style.display = 'flex';
  };

  async function startVideoRecording() {
    if (isRecording) return;
    const range = getAndValidateRange();
    if (!range) return;

    // Pause standard playback if running
    try { if (globalThis._playbackScrollJump && typeof globalThis._playbackScrollJump.pause === 'function') await globalThis._playbackScrollJump.pause(); } catch(e){}

    isRecording = true;
    if (window.__spectroWait) window.__spectroWait.show({titleText: "Exporting Video", etaText: "Recording... 0%"});

    const sa = document.getElementById('scrollArea');
    const axisC = document.getElementById('axisCanvas');
    const specC = document.getElementById('spectrogramCanvas');
    const annC = document.getElementById('annotationOverlay');
    const selC = document.getElementById('annotationSelectionOverlay');
    const highC = document.getElementById('editHighlightOverlay');
    
    const axisW = 0; // Removed Y axis background, draw over spectrogram
    const vw = sa.clientWidth;
    const imgH = globalThis._spectroImageHeight || 300;

    const formatSelect = document.getElementById('ve-format');
    const exportFormat = formatSelect ? formatSelect.value : 'reel';

    const stageH = 12 + imgH + 44;
    let targetW, targetH, stageW, exportVw;

    if (exportFormat === 'square') { 
        targetW = 1080; targetH = 1080; 
    } else if (exportFormat === 'portrait') {
        targetW = 1080; targetH = 1350;
    } else {
        targetW = 1080; targetH = 1920; 
    }
    stageW = Math.round(stageH * (targetW / targetH));
    exportVw = stageW - axisW;
    if (exportVw < 50) exportVw = 50;

    // Prepare internal staging canvas
    const stageCanvas = document.createElement('canvas');
    stageCanvas.width = stageW;
    stageCanvas.height = stageH;
    const stageCtx = stageCanvas.getContext('2d', { alpha: false });

    // Prepare output composite canvas (Target size)

    const compCanvas = document.createElement('canvas');
    compCanvas.width = targetW;
    compCanvas.height = targetH;
    const compCtx = compCanvas.getContext('2d', { alpha: false });

    // Setup Audio Routing
    const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
    activeAudioCtx = new AudioCtxClass();
    const dest = activeAudioCtx.createMediaStreamDestination();
    const source = activeAudioCtx.createBufferSource();
    source.buffer = globalThis._spectroAudioBuffer;
    
    // Connect audio to the recording stream, AND the user's speakers so they hear it
    source.connect(dest);
    source.connect(activeAudioCtx.destination);

    // Setup Video Stream
    const stream = compCanvas.captureStream(30); // 30 FPS
    const audioTracks = dest.stream.getAudioTracks();
    if (audioTracks.length > 0) stream.addTrack(audioTracks[0]);

    // Find best codec
    const mimeTypes = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    let selectedMime = '';
    for (const mime of mimeTypes) {
       if (MediaRecorder.isTypeSupported(mime)) { selectedMime = mime; break; }
    }

    activeRecorder = new MediaRecorder(stream, { mimeType: selectedMime });
    const chunks = [];
    activeRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    
    activeRecorder.onstop = () => {
        isRecording = false;
        const isMp4 = selectedMime.includes('mp4');
        const ext = isMp4 ? '.mp4' : '.webm';
        
        const blob = new Blob(chunks, { type: selectedMime || 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        
        const origName = (document.getElementById('file') && document.getElementById('file').files[0] && document.getElementById('file').files[0].name) || 'export';
        a.download = origName.replace(/\.[^.]+$/, '') + '_' + targetW + 'x' + targetH + ext;
        
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 2000);
        
        if (window.__spectroWait) window.__spectroWait.hide();
        try { activeAudioCtx.close(); } catch(e){}
        
        // Show completion toast
        const t = document.createElement('div');
        t.textContent = 'Video exported successfully';
        t.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:20px;background:rgba(0,0,0,0.8);color:#fff;padding:6px 10px;border-radius:6px;z-index:2147483646;';
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 3000);
    };

    // Setup Web Worker for stable background timing
    const workerCode = `
      let timer;
      self.onmessage = function(e) {
        if (e.data === 'start') {
          timer = setInterval(() => self.postMessage('tick'), 1000 / 30);
        } else if (e.data === 'stop') {
          clearInterval(timer);
        }
      };
    `;
    const workerBlob = new Blob([workerCode], {type: 'application/javascript'});
    activeWorker = new Worker(URL.createObjectURL(workerBlob));

    source.start(0, range.startSec, range.duration);
    activeRecorder.start();
    activeWorker.postMessage('start');
    const startTime = activeAudioCtx.currentTime;
    
    let exportScroll = sa.scrollLeft;

    activeWorker.onmessage = () => {
        const elapsed = activeAudioCtx.currentTime - startTime;
        if (elapsed >= range.duration) {
            activeWorker.postMessage('stop');
            try { source.stop(); } catch(e){}
            try { activeRecorder.stop(); } catch(e){}
            return;
        }

        const currentSec = range.startSec + elapsed;
        const pxPerSec = globalThis._spectroPxPerSec || 1;
        const globalX = currentSec * pxPerSec;
        
        exportScroll = Math.max(0, globalX - (exportVw / 2));
        const maxExportScroll = Math.max(0, (globalThis._spectroImageWidth || vw) - exportVw);
        exportScroll = Math.min(maxExportScroll, exportScroll);
        
        let uiScroll = sa.scrollLeft;
        // Keep the UI scroll window covering the export window
        if (exportScroll < uiScroll || exportScroll + exportVw > uiScroll + vw) {
            uiScroll = exportScroll;
            sa.scrollLeft = uiScroll;
            sa.dispatchEvent(new Event('scroll'));
            if (window.renderAllAnnotations) window.renderAllAnnotations();
            if (window.renderSelectionOverlay) window.renderSelectionOverlay();
        }
        
        const screenX = globalX - exportScroll;
        const uiOffset = exportScroll - uiScroll;
        
        // --- DRAW STAGE FRAME ---
        stageCtx.fillStyle = '#111';
        stageCtx.fillRect(0, 0, stageCanvas.width, stageCanvas.height);
        
        // 1. Spectrogram (crop)
        if (specC) {
            const sScaleX = specC.width / (specC.clientWidth || 1);
            const sScaleY = specC.height / (specC.clientHeight || 1);
            stageCtx.drawImage(
                specC, 
                uiOffset * sScaleX, 12 * sScaleY, exportVw * sScaleX, imgH * sScaleY,
                axisW, 12, exportVw, imgH
            );
        }
        
        // 2. Overlays
        const dpr = window.devicePixelRatio || 1;
        const overlays = [annC, selC, highC];
        overlays.forEach(c => {
            if (c && c.width > 0 && c.style.display !== 'none') {
                stageCtx.drawImage(
                    c, 
                    uiOffset * dpr, 0, exportVw * dpr, c.height, 
                    axisW, 12, exportVw, imgH
                );
            }
        });
        
        // 2.5 Draw labels explicitly since DOM elements aren't captured
        if (globalThis._annotations && typeof globalThis._annotations.getAll === 'function') {
            const anns = globalThis._annotations.getAll();
            stageCtx.textAlign = 'left';
            stageCtx.textBaseline = 'top';
            const ymaxHz = globalThis._spectroYMax || 22050;
            const leftSec = exportScroll / pxPerSec;
            const rightSec = leftSec + (exportVw / pxPerSec);

            for (const ann of anns) {
                if (ann.endTime < leftSec || ann.beginTime > rightSec) continue;

                const text = ann.species || ann.scientificName || '';
                if (text) {
                    const xPx = axisW + (ann.beginTime - leftSec) * pxPerSec;
                    const yPx = 12 + (1 - ann.highFreq/ymaxHz) * imgH;
                    
                    stageCtx.font = '11px sans-serif';
                    const tw = stageCtx.measureText(text).width;
                    stageCtx.fillStyle = 'rgba(0,0,0,0.65)';
                    stageCtx.fillRect(xPx, yPx - 16, tw + 6, 16);
                    stageCtx.fillStyle = '#fff';
                    stageCtx.fillText(text, xPx + 3, yPx - 13);
                }
            }
        }
        
        // 3. Axis Y (manually drawn over the spectrogram)
        const yTicks = 6;
        stageCtx.strokeStyle = 'rgba(255,255,255,0.4)';
        stageCtx.lineWidth = 1;
        stageCtx.fillStyle = '#fff';
        stageCtx.font = '9px sans-serif';
        stageCtx.textAlign = 'left';
        stageCtx.textBaseline = 'top';
        const ymaxHz = globalThis._spectroYMax || 22050;
        
        for (let i = 0; i < yTicks; i++) {
            const t = i / (yTicks - 1);
            const freq = ymaxHz * (1 - t);
            const yPx = 12 + Math.round(t * imgH);
            
            stageCtx.beginPath(); 
            stageCtx.moveTo(0, yPx); 
            stageCtx.lineTo(5, yPx); 
            stageCtx.stroke();
            
            const label = (freq >= 1000) ? (Math.round(freq/10)/100).toString() + 'k' : Math.round(freq).toString();
            stageCtx.shadowColor = 'rgba(0,0,0,0.8)';
            stageCtx.shadowBlur = 3;
            stageCtx.fillText(label, 8, yPx + 2);
            stageCtx.shadowBlur = 0;
        }
        
        // 4. Time ticks (Top & Bottom)
        stageCtx.fillStyle = '#111';
        stageCtx.fillRect(axisW, 0, exportVw, 12);
        stageCtx.fillRect(axisW, 12 + imgH, exportVw, 44);
        
        const leftTime = exportScroll / pxPerSec;
        const rightTime = leftTime + (exportVw / pxPerSec);
        
        const niceSteps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60];
        let step = niceSteps[0];
        
        const pxpf = globalThis._spectroPxPerFrame;
        if (pxpf === 1) step = 2;
        else if (pxpf === 2) step = 1;
        else if (pxpf === 4) step = 0.5;
        else if (pxpf === 8) step = 0.25;
        else {
          for (let v of niceSteps) { if (v * pxPerSec >= 60) { step = v; break; } step = v; }
        }
        const firstTick = Math.floor(leftTime / step) * step;
        
        stageCtx.strokeStyle = 'rgba(255,255,255,0.06)';
        stageCtx.fillStyle = '#ddd';
        stageCtx.font = '9px sans-serif';
        stageCtx.textAlign = 'center';
        stageCtx.textBaseline = 'top';
        
        for (let t = firstTick; t <= rightTime; t += step) {
           const cx = axisW + (t - leftTime) * pxPerSec;
           stageCtx.beginPath(); stageCtx.moveTo(cx, 0); stageCtx.lineTo(cx, 8); stageCtx.stroke();
           stageCtx.beginPath(); stageCtx.moveTo(cx, 12 + imgH); stageCtx.lineTo(cx, 12 + imgH + 8); stageCtx.stroke();
           let decimals = (step % 1 !== 0) ? step.toString().split('.')[1].length : 0;
           let label = t.toFixed(decimals) + 's';
           if (t >= 60) label = Math.floor(t/60) + ':' + String(Math.floor(t%60)).padStart(2,'0');
           stageCtx.fillText(label, cx, 12 + imgH + 10);
        }

        // Fixed "Spectrolipi" X-axis label
        stageCtx.fillStyle = 'rgba(255,255,255,0.4)';
        stageCtx.font = '10px sans-serif';
        stageCtx.textAlign = 'center';
        stageCtx.fillText('Spectrolipi', axisW + (exportVw / 2), 12 + imgH + 26);
        
        // 5. Playhead
        stageCtx.strokeStyle = '#ff6b6b';
        stageCtx.lineWidth = 2;
        stageCtx.beginPath();
        stageCtx.moveTo(axisW + screenX, 12);
        stageCtx.lineTo(axisW + screenX, 12 + imgH);
        stageCtx.stroke();

        // --- SCALE & COPY STAGE TO FINAL COMPOSITE ---
        compCtx.fillStyle = '#000';
        compCtx.fillRect(0, 0, targetW, targetH);
        compCtx.drawImage(stageCanvas, 0, 0, targetW, targetH);
        
        // Update progress UI
        const pct = Math.round((elapsed / range.duration) * 100);
        if (window.__spectroWait) window.__spectroWait.show({etaText: `Recording... ${pct}% (works in background)`});
    };
  }
})();