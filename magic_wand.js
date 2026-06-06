// magic_wand.js
// Implements a mathematical Region Growing algorithm directly on the raw FFT 
// magnitudes to automatically detect continuous sound traces and snap a bounding box.

(function() {
  const magicBtn = document.getElementById('magicBtn');
  const spectrogramCanvas = document.getElementById('spectrogramCanvas');
  const scrollArea = document.getElementById('scrollArea');
  const viewportWrapper = document.getElementById('viewportWrapper');
  
  if (!magicBtn || !spectrogramCanvas || !scrollArea || !viewportWrapper) return;

  // --- Magic Wand Configuration ---
  const WAND_CONFIG = {
    searchFrames: 300,       // +/- frames to search horizontally (time) Default = 300
    searchBins: 150,         // +/- bins to search vertically (frequency) Default = 150
    maxPixelsPct: 0.25,      // Max percentage of search area pixels allowed before aborting Default = 0.25
    noiseThresholdMult: 1.3, // Min multiplier over background noise to allow starting Default = 1.3
    noiseEstStep: 3,         // Grid step size for background noise estimation Default = 3
    refineKernel: 5          // +/- bounds for initial click peak refinement Default = 5
  };

  let isMagicMode = false;
  let magicSession = null;
  let previewBox = null;
  let lastMagicSensitivity = 90;

  function createPreviewBox() {
    if (previewBox) return;
    previewBox = document.createElement('div');
    previewBox.id = 'magicPreviewBox';
    previewBox.style.cssText = 'position:absolute; border:2px dashed #ffeb3b; background:rgba(255, 235, 59, 0.25); pointer-events:none; z-index:2147483640; display:none; box-sizing:border-box;';
    
    const label = document.createElement('div');
    label.id = 'magicPreviewLabel';
    label.style.cssText = 'position:absolute; background:#ffeb3b; color:#000; font-size:11px; padding:2px 8px; border-radius:4px; white-space:nowrap; box-shadow: 0 2px 8px rgba(0,0,0,0.5); font-weight:600; transition: top 0.1s;';
    previewBox.appendChild(label);
    
    viewportWrapper.appendChild(previewBox);
  }

  function cancelMagicSession() {
    magicSession = null;
    if (previewBox) previewBox.style.display = 'none';
  }

  function commitMagicSession() {
    if (!magicSession || !magicSession.bounds) return;
    
    // Get selected species from UI if available
    let speciesVal = '';
    let scientificVal = '';
    if (typeof window.getCurrentSpecies === 'function') {
      const sp = window.getCurrentSpecies();
      if (sp) {
        speciesVal = sp.common || '';
        scientificVal = sp.scientific || '';
      }
    } else {
      try {
          const spLabel = document.querySelector('#speciesResult');
          if (spLabel && spLabel.textContent) {
              speciesVal = spLabel.dataset.common || spLabel.textContent.trim();
              scientificVal = spLabel.dataset.scientific || '';
          }
      } catch(e){}
    }

    if (!scientificVal) {
      try {
        if (speciesVal) window.alert('scientific name not found');
        else window.alert('Please Select a species first and try again.');
      } catch(e){}
      cancelMagicSession();
      return;
    }

    const newAnno = {
      beginTime: Number(magicSession.bounds.beginTime.toFixed(4)),
      endTime: Number(magicSession.bounds.endTime.toFixed(4)),
      lowFreq: Number(magicSession.bounds.lowFreq.toFixed(4)),
      highFreq: Number(magicSession.bounds.highFreq.toFixed(4)),
      species: speciesVal,
      scientificName: scientificVal
    };

    if (globalThis._annotations && typeof globalThis._annotations.add === 'function') {
      globalThis._annotations.add(newAnno, 'magic-wand');
    } else if (window.annotationGrid && typeof window.annotationGrid.addData === 'function') {
      window.annotationGrid.addData([newAnno], true);
    }
    
    window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: 'magic-wand' } }));
    if (typeof window.renderAllAnnotations === 'function') {
      window.renderAllAnnotations();
    }

    lastMagicSensitivity = magicSession.sensitivity;

    cancelMagicSession();
  }

  function updateMagicPreviewBoxPosition() {
    if (!magicSession || !magicSession.bounds || !previewBox) return;

    const AXIS_TOP = 12;
    const rect = spectrogramCanvas.getBoundingClientRect();
    const imgH = globalThis._spectroImageHeight || (rect.height - AXIS_TOP - 44);
    const yMaxHz = globalThis._spectroYMax || 24000;
    const yMinHz = globalThis._spectroYMin || 0;
    const spanHz = yMaxHz - yMinHz;
    const pxPerSec = globalThis._spectroPxPerSec || 100;
    const axisLeft = globalThis._spectroAxisLeft || 70;

    const b = magicSession.bounds;
    const leftPx = axisLeft + (b.beginTime * pxPerSec) - (scrollArea.scrollLeft || 0);
    const widthPx = (b.endTime - b.beginTime) * pxPerSec;
    
    const tTop = Math.max(0, Math.min(1, (yMaxHz - b.highFreq) / spanHz));
    const tBot = Math.max(0, Math.min(1, (yMaxHz - b.lowFreq) / spanHz));
    
    const topPx = AXIS_TOP + tTop * imgH;
    const heightPx = (tBot - tTop) * imgH;
    
    previewBox.style.left = leftPx + 'px';
    previewBox.style.top = topPx + 'px';
    previewBox.style.width = Math.max(2, widthPx) + 'px';
    previewBox.style.height = Math.max(2, heightPx) + 'px';
    
    const label = previewBox.querySelector('#magicPreviewLabel');
    if (label) {
        if (topPx < 30) {
            label.style.top = '100%';
            label.style.marginTop = '4px';
        } else {
            label.style.top = '-24px';
            label.style.marginTop = '0';
        }
        label.textContent = `Sensitivity: ${magicSession.sensitivity.toFixed(0)}% (Shift+Scroll to adjust, Click to commit)`;
    }
    previewBox.style.display = 'block';
  }

  // Intercept the wheel event during an active magic session to adjust sensitivity.
  // Added with capture: true so we intercept it before the standard panning takes over.
  window.addEventListener('wheel', (ev) => {
    if (isMagicMode && magicSession && ev.shiftKey) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      let delta = ev.deltaY < 0 ? 1 : -1; // Scroll up = +1 sensitivity, down = -1
      magicSession.sensitivity = Math.max(1, Math.min(99, magicSession.sensitivity + delta));
      runMagicWandBFS();
    }
  }, { passive: false, capture: true });

  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && magicSession) {
      ev.preventDefault();
      cancelMagicSession();
    }
  }, { capture: true });
  
  scrollArea.addEventListener('scroll', updateMagicPreviewBoxPosition, { passive: true });

  function toggleMagicMode() {
    isMagicMode = !isMagicMode;
    
    if (isMagicMode) {
      lastMagicSensitivity = 90; // Reset starting sensitivity when armed
      window.dispatchEvent(new CustomEvent('magic-wand-enabled'));
      createPreviewBox();
      // Styling for active state (Yellow/Amber hue)
      magicBtn.style.setProperty('background', '#fbc02d', 'important');
      spectrogramCanvas.style.cursor = 'crosshair';
      
      
      if (globalThis._editAnnotations && typeof globalThis._editAnnotations.cancelEdit === 'function') {
        globalThis._editAnnotations.cancelEdit();
      }
    } else {
      cancelMagicSession();
      magicBtn.style.removeProperty('background');
      spectrogramCanvas.style.cursor = '';
    }
  }

  magicBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    if (magicBtn.disabled) return;
    toggleMagicMode();
  });

  function updateMagicButtonState() {
    let isEdit = false;
    try {
      if (globalThis._editAnnotations && typeof globalThis._editAnnotations.isEditMode === 'function') {
        isEdit = globalThis._editAnnotations.isEditMode();
      } else {
        const wrap = document.getElementById('createEditToggle');
        if (wrap && wrap.dataset.mode === 'edit') isEdit = true;
      }
    } catch(e) {}
    
    let modalOpen = false;
    try { if (typeof window.isAnyModalOpen === 'function' && window.isAnyModalOpen()) modalOpen = true; } catch(e){}
    
    if (isEdit || modalOpen) {
      magicBtn.disabled = true;
      magicBtn.style.opacity = '0.5';
      magicBtn.style.cursor = 'not-allowed';
    } else {
      magicBtn.disabled = false;
      magicBtn.style.opacity = '1.0';
      magicBtn.style.cursor = 'pointer';
    }
  }

  window.addEventListener('mode-change', (ev) => {
    if (isMagicMode) toggleMagicMode();
    const mode = ev && ev.detail && ev.detail.mode;
    if (mode === 'edit') {
      magicBtn.disabled = true;
      magicBtn.style.opacity = '0.5';
      magicBtn.style.cursor = 'not-allowed';
    } else if (mode === 'create') {
      magicBtn.disabled = false;
      magicBtn.style.opacity = '1.0';
      magicBtn.style.cursor = 'pointer';
    } else {
      updateMagicButtonState();
    }
  });
  window.addEventListener('modal-toggled', updateMagicButtonState);

  setTimeout(updateMagicButtonState, 200);

  window.addEventListener('repeat-mode-enabled', () => {
    if (isMagicMode) toggleMagicMode();
  });

  spectrogramCanvas.addEventListener('pointerdown', (ev) => {
    if (!isMagicMode || ev.button !== 0) return;

    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();

    if (magicSession) {
      commitMagicSession();
      return; // Stop here. The second click commits, it doesn't start a new selection.
    }

    const spectra = globalThis._spectroSpectra;
    if (!spectra) {
      alert("Spectrogram data not available.");
      return;
    }

    const rect = spectrogramCanvas.getBoundingClientRect();
    const cssX = ev.clientX - rect.left;
    const cssY = ev.clientY - rect.top;

    const absX = cssX + (scrollArea.scrollLeft || 0);
    const pxPerFrame = globalThis._spectroPxPerFrame || 2;
    let clickFrame = Math.floor(absX / pxPerFrame);

    const AXIS_TOP = 12;
    const imgH = globalThis._spectroImageHeight || (rect.height - AXIS_TOP - 44);
    const yMaxHz = globalThis._spectroYMax || 24000;
    const yMinHz = globalThis._spectroYMin || 0;
    
    const yInImage = Math.max(0, Math.min(imgH, cssY - AXIS_TOP));
    const tY = yInImage / imgH; // 0 at top, 1 at bottom
    const clickFreq = yMaxHz - tY * (yMaxHz - yMinHz);
    
    const sr = globalThis._spectroSampleRate || 48000;
    const nyq = globalThis._spectroOriginalNyquist || (sr / 2);
    const bins = globalThis._spectroBins || 512;
    const maxFrames = globalThis._spectroNumFrames || Math.floor(spectra.length / bins);
    
    let clickBin = Math.floor((clickFreq / nyq) * bins);
    
    clickFrame = Math.max(0, Math.min(maxFrames - 1, clickFrame));
    clickBin = Math.max(0, Math.min(bins - 1, clickBin));

    // Refine click to local maximum (e.g. within 5 frames, 5 bins)
    let maxMag = 0;
    let bestF = clickFrame;
    let bestB = clickBin;
    for (let f = Math.max(0, clickFrame - WAND_CONFIG.refineKernel); f <= Math.min(maxFrames - 1, clickFrame + WAND_CONFIG.refineKernel); f++) {
        for (let b = Math.max(0, clickBin - WAND_CONFIG.refineKernel); b <= Math.min(bins - 1, clickBin + WAND_CONFIG.refineKernel); b++) {
            const mag = spectra[f * bins + b];
            if (mag > maxMag) {
                maxMag = mag;
                bestF = f;
                bestB = b;
            }
        }
    }
    clickFrame = bestF;
    clickBin = bestB;
    const startMag = maxMag;

    // Define local search area to bound the search
    const minFSearch = Math.max(0, clickFrame - WAND_CONFIG.searchFrames);
    const maxFSearch = Math.min(maxFrames - 1, clickFrame + WAND_CONFIG.searchFrames);
    const minBSearch = Math.max(0, clickBin - WAND_CONFIG.searchBins);
    const maxBSearch = Math.min(bins - 1, clickBin + WAND_CONFIG.searchBins);

    const searchW = maxFSearch - minFSearch + 1;
    const searchH = maxBSearch - minBSearch + 1;

    // Estimate background noise level in the local area
    let sum = 0;
    let count = 0;
    for (let f = minFSearch; f <= maxFSearch; f += WAND_CONFIG.noiseEstStep) {
       for (let b = minBSearch; b <= maxBSearch; b += WAND_CONFIG.noiseEstStep) {
           sum += spectra[f * bins + b];
           count++;
       }
    }
    const meanMag = count > 0 ? (sum / count) : 0;

    if (startMag < meanMag * WAND_CONFIG.noiseThresholdMult) {
      alert('Clicked area is too close to the background noise level. Please click on a bright sound trace.');
      return;
    }

    let startSens = 90;
    try {
      const s = JSON.parse(localStorage.getItem('spectrolipi.settings.v1') || '{}');
      if (s.magicRepeatSensitivity) startSens = lastMagicSensitivity;
    } catch(e) {}

    magicSession = {
      clickFrame, clickBin, startMag, meanMag,
      minFSearch, maxFSearch, minBSearch, maxBSearch,
      searchW, searchH,
      sensitivity: startSens, // Represents (100-sens)% tolerance initially
      visited: new Uint8Array(searchW * searchH),
      queue: new Int32Array(searchW * searchH * 2)
    };

    runMagicWandBFS();
  }, { capture: true });

  function runMagicWandBFS() {
    if (!magicSession) return;
    const spectra = globalThis._spectroSpectra;
    const sr = globalThis._spectroSampleRate || 48000;
    const nyq = globalThis._spectroOriginalNyquist || (sr / 2);
    const bins = globalThis._spectroBins || 512;

    const tolerance = (100 - magicSession.sensitivity) / 100;
    const threshold = magicSession.meanMag + (magicSession.startMag - magicSession.meanMag) * tolerance;

    magicSession.visited.fill(0);
    const visited = magicSession.visited;
    const queue = magicSession.queue;
    const searchH = magicSession.searchH;
    
    let qHead = 0;
    let qTail = 0;
    
    queue[qTail++] = magicSession.clickFrame;
    queue[qTail++] = magicSession.clickBin;
    visited[(magicSession.clickFrame - magicSession.minFSearch) * searchH + (magicSession.clickBin - magicSession.minBSearch)] = 1;

    let minMatchedF = magicSession.clickFrame, maxMatchedF = magicSession.clickFrame;
    let minMatchedB = magicSession.clickBin, maxMatchedB = magicSession.clickBin;
    let pixelsFound = 0;
    const MAX_PIXELS = Math.floor(magicSession.searchW * searchH * WAND_CONFIG.maxPixelsPct);

    // 5x5 kernel allows jumping over 1 pixel gaps
    const dirs = [];
    for (let df = -2; df <= 2; df++) {
       for (let db = -2; db <= 2; db++) {
          if (df === 0 && db === 0) continue;
          dirs.push(df, db);
       }
    }

    while (qHead < qTail) {
      const cf = queue[qHead++];
      const cb = queue[qHead++];

      if (cf < minMatchedF) minMatchedF = cf;
      if (cf > maxMatchedF) maxMatchedF = cf;
      if (cb < minMatchedB) minMatchedB = cb;
      if (cb > maxMatchedB) maxMatchedB = cb;

      for (let i = 0; i < dirs.length; i += 2) {
        const nf = cf + dirs[i];
        const nb = cb + dirs[i+1];
        
        if (nf >= magicSession.minFSearch && nf <= magicSession.maxFSearch && nb >= magicSession.minBSearch && nb <= magicSession.maxBSearch) {
          const vIdx = (nf - magicSession.minFSearch) * searchH + (nb - magicSession.minBSearch);
          if (!visited[vIdx]) {
            visited[vIdx] = 1;
            const mag = spectra[nf * bins + nb];
            if (mag >= threshold) {
              pixelsFound++;
              if (pixelsFound > MAX_PIXELS) {
                qHead = qTail; // force outer while loop to terminate
                break;
              }
              queue[qTail++] = nf;
              queue[qTail++] = nb;
            }
          }
        }
      }
    }

    if (pixelsFound > MAX_PIXELS) {
      alert('The trace blends into background noise too much. Please click on a brighter part of the trace, or adjust sensitivity with Shift+Scroll.');
      cancelMagicSession();
      return;
    }

    const fps = globalThis._spectroFramesPerSec || (sr / (globalThis._spectroFFTSize ? (globalThis._spectroFFTSize/2) : 512));
    
    let magicPadPx = 5;
    try {
      const s = JSON.parse(localStorage.getItem('spectrolipi.settings.v1') || '{}');
      if (s.magicPad !== undefined && !isNaN(parseInt(s.magicPad, 10))) magicPadPx = parseInt(s.magicPad, 10);
    } catch(e) {}

    const pxPerSec = globalThis._spectroPxPerSec || (globalThis._spectroPxPerFrame * fps) || 100;
    const timePad = magicPadPx / Math.max(1, pxPerSec);

    const AXIS_TOP = 12;
    const rect = spectrogramCanvas.getBoundingClientRect();
    const imgH = globalThis._spectroImageHeight || (rect.height - AXIS_TOP - 44) || 420;
    const yMaxHz = globalThis._spectroYMax || nyq;
    const yMinHz = globalThis._spectroYMin || 0;
    const freqPad = (magicPadPx / Math.max(1, imgH)) * (yMaxHz - yMinHz);

    let beginTime = Math.max(0, (minMatchedF / fps) - timePad);
    let endTime = (maxMatchedF / fps) + timePad;

    const lowFreq = Math.max(0, (minMatchedB / bins) * nyq - freqPad);
    const highFreq = Math.min(nyq, (maxMatchedB / bins) * nyq + freqPad);

    magicSession.bounds = { beginTime, endTime, lowFreq, highFreq };
    updateMagicPreviewBoxPosition();
  }
})();