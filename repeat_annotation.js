
(function() {
  const btn = document.getElementById('repeatBtn');
  if (!btn) return;

  let lastAnn = null; // { duration: sec, bandwidth: hz, species: 'common', scientificName: 'scientific' }
  let ghost = null;
  let guideLine = null;
  let isRepeat = false;

  function updateLastAnn() {
    if (window.annotationGrid) {
      try {
        const data = window.annotationGrid.getData();
        if (Array.isArray(data) && data.length > 0) {
          // Robustly find the row with the highest numeric ID to ensure we get the latest created box
          let maxId = -Infinity;
          let last = null;
          for (const r of data) {
            const idVal = Number(r.id);
            if (!isNaN(idVal) && idVal > maxId) { maxId = idVal; last = r; }
          }
          if (last) {
            const b = Number(last.beginTime);
            const e = Number(last.endTime);
            const l = Number(last.lowFreq);
            const h = Number(last.highFreq);
            const sp = last.species || '';
            const sc = last.scientificName || '';

            if (e > b && h > l) {
              lastAnn = { 
                duration: e - b, 
                bandwidth: h - l,
                lowFreq: l,
                highFreq: h,
                centerFreq: (h + l) / 2,
                species: sp,
                scientificName: sc
              };
            }
          }
        }
      } catch(e){
        console.error('Error reading last annotation for repeat:', e);
        lastAnn = null; // Reset on error
      }
    }
  }

  function toggleRepeat() {
    isRepeat = !isRepeat;
    globalThis._isRepeatMode = isRepeat;
    btn.setAttribute('aria-pressed', String(isRepeat));
    if (isRepeat) {
      window.dispatchEvent(new CustomEvent('repeat-mode-enabled'));
      btn.style.setProperty('background', '#43a047', 'important');
      updateLastAnn(); // This now captures dimensions AND species
      if (!lastAnn) {
        alert('Could not find a previous annotation to repeat. Please create one first.');
        toggleRepeat(); // Immediately turn off if no data
      } else {
        // Instantly clear the blue crosshair if hovering
        const crosshair = document.getElementById('spectrogramCrosshairOverlay');
        if (crosshair) {
          const ctx = crosshair.getContext('2d');
          if (ctx) ctx.clearRect(0, 0, crosshair.width, crosshair.height);
        }
      }
    } else {
      btn.style.removeProperty('background');
      if (ghost) ghost.style.display = 'none';
      if (guideLine) guideLine.style.display = 'none';
    }
  }

  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    if (btn.disabled) return;

    toggleRepeat();
  });

  // Automatically exit Repeat Mode when toggling between Create/Edit modes
  window.addEventListener('mode-change', () => {
    if (isRepeat) toggleRepeat();
  });

  // Automatically exit Repeat Mode when Magic Wand is enabled
  window.addEventListener('magic-wand-enabled', () => {
    if (isRepeat) toggleRepeat();
  });

  // Cancel Repeat Mode when Escape key is pressed
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && isRepeat) {
      ev.preventDefault();
      toggleRepeat();
    }
  });

  function updateRepeatButtonState() {
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
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
    } else {
      btn.disabled = false;
      btn.style.opacity = '1.0';
      btn.style.cursor = 'pointer';
    }
  }

  window.addEventListener('mode-change', (ev) => {
    if (isRepeat) toggleRepeat();
    const mode = ev && ev.detail && ev.detail.mode;
    if (mode === 'edit') {
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
    } else if (mode === 'create') {
      btn.disabled = false;
      btn.style.opacity = '1.0';
      btn.style.cursor = 'pointer';
    } else {
      updateRepeatButtonState();
    }
  });
  window.addEventListener('modal-toggled', updateRepeatButtonState);

  setTimeout(updateRepeatButtonState, 200);

  const scrollArea = document.getElementById('scrollArea');
  const viewportWrapper = document.getElementById('viewportWrapper');
  if (scrollArea && viewportWrapper) {
    viewportWrapper.addEventListener('pointermove', (ev) => {
      if (!isRepeat || !lastAnn) { 
        if (ghost) ghost.style.display = 'none'; 
        if (guideLine) guideLine.style.display = 'none';
        return; 
      }
      
      if (!ghost) {
        ghost = document.createElement('div');
        ghost.style.position = 'absolute';
        ghost.style.border = '2px dashed #00ff00';
        ghost.style.boxShadow = '0 0 4px rgba(0,255,0,0.4)';
        ghost.style.pointerEvents = 'none';
        ghost.style.zIndex = '9999';
        scrollArea.appendChild(ghost);
      }
      
      if (!guideLine) {
        guideLine = document.createElement('div');
        guideLine.style.position = 'absolute';
        guideLine.style.borderTop = '1px dashed #ff4081'; // Pinkish-red smart guide
        guideLine.style.pointerEvents = 'none';
        guideLine.style.zIndex = '9998';
        guideLine.style.display = 'none';
        scrollArea.appendChild(guideLine);
      }
      
      const rect = scrollArea.getBoundingClientRect();
      const y = ev.clientY - rect.top;
      const imgH = globalThis._spectroImageHeight || 420;
      const AXIS_TOP = 12;
      const yMax = globalThis._spectroYMax || 22050;
      const yMin = globalThis._spectroYMin || 0;
      const ySpan = Math.max(1, yMax - yMin);

      if (y < AXIS_TOP || y > AXIS_TOP + imgH) {
        if (ghost) ghost.style.display = 'none';
        if (guideLine) guideLine.style.display = 'none';
        return;
      }

      const map = globalThis._spectroMap;
      if (!map) return;
      
      const x = ev.clientX - rect.left + scrollArea.scrollLeft;
      
      const pxPerSec = map.pxPerSec();
      
      let isTemporal = false;
      try { const s = JSON.parse(localStorage.getItem('spectrolipi.settings.v1') || '{}'); isTemporal = s.annotationMode === 'temporal'; } catch(e){}

      const wPx = lastAnn.duration * pxPerSec;
      let hPx = (lastAnn.bandwidth / ySpan) * imgH;
      
      // Convert current Y to frequency
      const freqCenterHover = yMax - ((y - AXIS_TOP) / imgH) * ySpan;
      
      // Smart Guide Snapping Logic (10px threshold)
      const snapThresholdPx = 5;
      const snapThresholdFreq = (snapThresholdPx / imgH) * ySpan;
      
      let snapped = false;
      let snappedFreq = freqCenterHover;

      if (Math.abs(freqCenterHover - lastAnn.centerFreq) < snapThresholdFreq) {
        snapped = true;
        snappedFreq = lastAnn.centerFreq;
      }

      // Store state for pointerdown creation
      ghost._isSnapped = snapped;
      
      let snappedY = AXIS_TOP + imgH * ((yMax - snappedFreq) / ySpan);
      let drawY = snappedY - hPx / 2;

      // Fix Y axis visual mapping if temporal
      if (isTemporal) {
        snapped = false;
        hPx = imgH;
        drawY = AXIS_TOP;
      }
      
      ghost.style.width = wPx + 'px';
      ghost.style.height = hPx + 'px';
      ghost.style.left = (x - wPx / 2) + 'px';
      ghost.style.top = drawY + 'px';
      
      if (snapped && !isTemporal) {
        ghost.style.borderColor = '#ff4081'; // Match guide line color when snapped
        ghost.style.boxShadow = '0 0 4px rgba(255,64,129,0.4)';
        
        // Align guide line with current view port
        guideLine.style.left = scrollArea.scrollLeft + 'px';
        guideLine.style.width = scrollArea.clientWidth + 'px';
        guideLine.style.top = snappedY + 'px';
        guideLine.style.display = 'block';
      } else {
        ghost.style.borderColor = '#00ff00'; // Default green
        ghost.style.boxShadow = '0 0 4px rgba(0,255,0,0.4)';
        guideLine.style.display = 'none';
      }
      
      ghost.style.display = 'block';
    }, true);

    viewportWrapper.addEventListener('pointerleave', () => {
      if (ghost) ghost.style.display = 'none';
      if (guideLine) guideLine.style.display = 'none';
    }, true);

    viewportWrapper.addEventListener('pointerdown', (ev) => {
      if (!isRepeat || !lastAnn || ev.button !== 0) return;
      
      const rect = scrollArea.getBoundingClientRect();
      const y = ev.clientY - rect.top;
      const imgH = globalThis._spectroImageHeight || 420;
      const AXIS_TOP = 12; // Matches spectrogram.js layout
      
      if (y < AXIS_TOP || y > AXIS_TOP + imgH) return;

      // Intercept creation
      ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();

      const map = globalThis._spectroMap;
      if (!map) return;
      
      const x = ev.clientX - rect.left + scrollArea.scrollLeft;
      
      const tCenter = map.pxToSec(x);
      const yMax = globalThis._spectroYMax || 22050;
      const yMin = globalThis._spectroYMin || 0;
      const ySpan = Math.max(1, yMax - yMin);
      const freqCenter = yMax - ((y - AXIS_TOP) / imgH) * ySpan;
      
      const duration = (typeof globalThis._spectroDuration === 'number' && isFinite(globalThis._spectroDuration)) ? globalThis._spectroDuration : Infinity;
      const t1 = Math.max(0, tCenter - lastAnn.duration / 2);
      const t2 = Math.min(duration, tCenter + lastAnn.duration / 2);
      
      const nyq = globalThis._spectroOriginalNyquist || (globalThis._spectroSampleRate ? globalThis._spectroSampleRate / 2 : 22050);

      let isTemporal = false;
      try { const s = JSON.parse(localStorage.getItem('spectrolipi.settings.v1') || '{}'); isTemporal = s.annotationMode === 'temporal'; } catch(e){}

      let f1, f2;
      if (isTemporal) {
        f1 = 0;
        f2 = nyq;
      } else if (ghost && ghost._isSnapped) {
        f1 = lastAnn.lowFreq;
        f2 = lastAnn.highFreq;
      } else {
        f1 = Math.max(0, freqCenter - lastAnn.bandwidth / 2);
        f2 = Math.min(yMax, freqCenter + lastAnn.bandwidth / 2);
      }
      
      f1 = Math.max(0, Math.min(nyq, f1));
      f2 = Math.max(0, Math.min(nyq, f2));
      
      if (f1 >= f2) return;
      
      // Use the species info stored from the last annotation
      if (!lastAnn.scientificName) {
        alert('The annotation you are repeating does not have a scientific name. Please select a species for it or create a new annotation.');
        return;
      }

      const speciesVal = lastAnn.species;
      const scientificVal = lastAnn.scientificName;
      
      globalThis._annotations.add({
        beginTime: t1, 
        endTime: t2, 
        lowFreq: f1, 
        highFreq: f2,
        species: speciesVal, 
        scientificName: scientificVal
      }, 'repeat-create');
    }, true);
  }
})();
