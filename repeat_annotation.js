
(function() {
  const btn = document.getElementById('repeatBtn');
  if (!btn) return;

  let lastAnn = null; // { duration: sec, bandwidth: hz, species: 'common', scientificName: 'scientific' }
  let ghost = null;
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
    btn.setAttribute('aria-pressed', String(isRepeat));
    if (isRepeat) {
      btn.style.setProperty('background', '#43a047', 'important');
      updateLastAnn(); // This now captures dimensions AND species
      if (!lastAnn) {
        alert('Could not find a previous annotation to repeat. Please create one first.');
        toggleRepeat(); // Immediately turn off if no data
      }
    } else {
      btn.style.removeProperty('background');
      if (ghost) ghost.style.display = 'none';
    }
  }

  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    toggleRepeat();
  });

  // Auto-disable/enable repeat based on mode
  window.addEventListener('mode-change', (ev) => {
    const mode = ev.detail && ev.detail.mode;
    if (mode === 'edit') {
      if (isRepeat) toggleRepeat();
      btn.disabled = true;
    } else if (mode === 'create') {
      btn.disabled = false;
    }
  });

  const scrollArea = document.getElementById('scrollArea');
  const spectrogramCanvas = document.getElementById('spectrogramCanvas');
  if (scrollArea && spectrogramCanvas) {
    spectrogramCanvas.addEventListener('pointermove', (ev) => {
      if (!isRepeat || !lastAnn) { if (ghost) ghost.style.display = 'none'; return; }
      
      if (!ghost) {
        ghost = document.createElement('div');
        ghost.style.position = 'absolute';
        ghost.style.border = '2px dashed #00ff00';
        ghost.style.boxShadow = '0 0 4px rgba(0,255,0,0.4)';
        ghost.style.pointerEvents = 'none';
        ghost.style.zIndex = '9999';
        scrollArea.appendChild(ghost);
      }

      const map = globalThis._spectroMap;
      if (!map) return;
      
      const rect = scrollArea.getBoundingClientRect();
      const x = ev.clientX - rect.left + scrollArea.scrollLeft;
      const y = ev.clientY - rect.top;
      
      const pxPerSec = map.pxPerSec();
      const yMax = globalThis._spectroYMax || 22050;
      const imgH = globalThis._spectroImageHeight || 420;
      
      const wPx = lastAnn.duration * pxPerSec;
      const hPx = (lastAnn.bandwidth / yMax) * imgH;
      
      ghost.style.width = wPx + 'px';
      ghost.style.height = hPx + 'px';
      ghost.style.left = (x - wPx / 2) + 'px';
      ghost.style.top = (y - hPx / 2) + 'px';
      ghost.style.display = 'block';
    });

    spectrogramCanvas.addEventListener('pointerleave', () => {
      if (ghost) ghost.style.display = 'none';
    });

    spectrogramCanvas.addEventListener('pointerdown', (ev) => {
      if (!isRepeat || !lastAnn || ev.button !== 0) return;
      
      // Intercept creation
      ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();

      const map = globalThis._spectroMap;
      if (!map) return;
      
      const rect = scrollArea.getBoundingClientRect();
      const x = ev.clientX - rect.left + scrollArea.scrollLeft;
      const y = ev.clientY - rect.top;
      
      const tCenter = map.pxToSec(x);
      const yMax = globalThis._spectroYMax || 22050;
      const imgH = globalThis._spectroImageHeight || 420;
      const AXIS_TOP = 12; // Matches spectrogram.js layout
      const freqCenter = yMax * (1 - (y - AXIS_TOP) / imgH);
      
      const duration = (typeof globalThis._spectroDuration === 'number' && isFinite(globalThis._spectroDuration)) ? globalThis._spectroDuration : Infinity;
      const t1 = Math.max(0, tCenter - lastAnn.duration / 2);
      const t2 = Math.min(duration, tCenter + lastAnn.duration / 2);
      const f1 = Math.max(0, freqCenter - lastAnn.bandwidth / 2);
      const f2 = Math.min(yMax, freqCenter + lastAnn.bandwidth / 2);
      
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
