
(function() {
  const btn = document.getElementById('repeatBtn');
  if (!btn) return;

  let lastDim = null; // { duration: sec, bandwidth: hz }
  let ghost = null;
  let isRepeat = false;

  function updateLastDim() {
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
            if (e > b && h > l) {
              lastDim = { duration: e - b, bandwidth: h - l };
            }
          }
        }
      } catch(e){}
    }
  }

  function toggleRepeat() {
    isRepeat = !isRepeat;
    btn.setAttribute('aria-pressed', String(isRepeat));
    if (isRepeat) {
      btn.style.setProperty('background', '#43a047', 'important');
      updateLastDim();
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
      if (!isRepeat || !lastDim) { if (ghost) ghost.style.display = 'none'; return; }
      
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
      
      const wPx = lastDim.duration * pxPerSec;
      const hPx = (lastDim.bandwidth / yMax) * imgH;
      
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
      if (!isRepeat || !lastDim || ev.button !== 0) return;
      
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
      const t1 = Math.max(0, tCenter - lastDim.duration / 2);
      const t2 = Math.min(duration, tCenter + lastDim.duration / 2);
      const f1 = Math.max(0, freqCenter - lastDim.bandwidth / 2);
      const f2 = Math.min(yMax, freqCenter + lastDim.bandwidth / 2);
      
      // Resolve species info (Common and Scientific)
      let speciesVal = '';
      let scientificVal = '';
      try {
        const keyEl = document.getElementById('selectedSpeciesKey');
        const key = keyEl ? String(keyEl.value || '').trim() : '';
        const recs = Array.isArray(window.__speciesRecords) ? window.__speciesRecords : [];
        
        if (key) {
          const rec = recs.find(r => String((r.key||'')).trim() === key);
          if (rec) { speciesVal = rec.common||''; scientificVal = rec.scientific||''; }
        }
        if (!speciesVal) {
          const spLabel = document.querySelector('#speciesResult');
          if (spLabel) {
            speciesVal = spLabel.dataset.common || '';
            scientificVal = spLabel.dataset.scientific || '';
            if (!speciesVal && spLabel.textContent) {
               const text = String(spLabel.textContent).trim();
               const rec = recs.find(r => r.scientific === text || r.common === text);
               if (rec) { speciesVal = rec.common||''; scientificVal = rec.scientific||''; }
            }
          }
        }
      } catch (e) {}

      if (!speciesVal) {
        alert('Please Select a species first and try again.');
        return;
      }
      
      let nextId = 1;
      if (window.annotationGrid) {
         const data = window.annotationGrid.getData();
         if (data && data.length) nextId = Math.max(...data.map(r=>Number(r.id)||0)) + 1;
         
         window.annotationGrid.addData([{
           id: nextId, Selection: String(nextId),
           beginTime: t1, endTime: t2, lowFreq: f1, highFreq: f2,
           species: speciesVal, scientificName: scientificVal,
           notes: ''
         }]);
         
         if (window.renderAllAnnotations) window.renderAllAnnotations();
         else if (window.create_annotations && window.create_annotations.renderAllAnnotations) window.create_annotations.renderAllAnnotations();
         
         window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: 'repeat-create' } }));
      }
    }, true);
  }
})();
