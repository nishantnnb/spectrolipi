// create_annotations.js
// Final drop-in: legacy table creation/updates removed entirely.
// Commits write exclusively to GridLib (Tabulator). If GridLib is unavailable the commit is rejected.
// Exposes globalThis._annotations as a proxy to GridLib where possible.

(function () {
  const AXIS_TOP = 12;
  const PENDING_FILL = 'rgba(255,165,0,0.18)';
  const PENDING_STROKE = 'rgba(255,165,0,0.95)';
  const COMMITTED_FILL = 'rgba(0,150,255,0.12)';
  const COMMITTED_STROKE = 'rgba(0,150,255,0.95)';
  // Updated selected style: high-contrast yellow glow for clear visibility
  const SELECTED_FILL = 'rgba(255,255,0,0.28)';
  const SELECTED_STROKE = 'rgba(255,235,59,0.95)';
  const DASH = [6, 4];

  const viewportWrapper = document.getElementById('viewportWrapper');
  const scrollArea = document.getElementById('scrollArea');
  const spectrogramCanvas = document.getElementById('spectrogramCanvas');

  if (!viewportWrapper || !scrollArea || !spectrogramCanvas) return;

  // overlay canvas for drawing annotations
  let annotationOverlay = document.getElementById('annotationOverlay');
  if (!annotationOverlay) {
    annotationOverlay = document.createElement('canvas');
    annotationOverlay.id = 'annotationOverlay';
    annotationOverlay.style.position = 'absolute';
    annotationOverlay.style.pointerEvents = 'none';
    annotationOverlay.style.zIndex = 70;
    viewportWrapper.appendChild(annotationOverlay);
  }
  const aCtx = annotationOverlay.getContext('2d', { alpha: true });

  // Separate selection overlay (drawn after base boxes to avoid double boxing math mistakes)
  let selectionOverlay = document.getElementById('annotationSelectionOverlay');
  if (!selectionOverlay) {
    selectionOverlay = document.createElement('canvas');
    selectionOverlay.id = 'annotationSelectionOverlay';
    selectionOverlay.style.position = 'absolute';
    selectionOverlay.style.pointerEvents = 'none';
    selectionOverlay.style.zIndex = 72; // above annotationOverlay, below edit highlight
    viewportWrapper.appendChild(selectionOverlay);
  }
  const sCtx = selectionOverlay.getContext('2d', { alpha: true });

  // runtime state (no legacy table)
  let pending = null;
  let mode = 'create';
  let nextId = 1;
  let lastCreatedId = null;
  let onChangeCb = null;
  let __lastPointerId;
  // Centralized pending-restore applier (defined unconditionally so callers can invoke anytime)
  try {
    window.__applyPendingAnnotationRestore = function(){
      try {
        const p = window.__pendingAnnotationRestore;
        if (!p) { return; }
        const gridReady = (window.annotationGrid && typeof window.annotationGrid.replaceData === 'function');
        if (!gridReady) { return; }
        // Parse payload lazily
        let arr = Array.isArray(p.parsed) ? p.parsed : null;
        if (!arr) { try { arr = JSON.parse(p.raw || '[]'); } catch(e){ arr = []; } }
        if (!Array.isArray(arr) || arr.length === 0) { console.info('[backup] nothing to restore'); return; }

        // Normalize and load via our import API to match Upload semantics
        if (globalThis._annotations && typeof globalThis._annotations.import === 'function') {
          try { globalThis._annotations.import(arr); } catch(e) { console.warn('[backup] _annotations.import failed, direct replace fallback', e); try { window.annotationGrid.replaceData(arr); } catch(ex){} }
        } else {
          try { window.annotationGrid.replaceData(arr); } catch(e) { console.error('[backup] replaceData failed', e); return; }
        }
        try { window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: 'restore-backup-apply', count: arr.length } })); } catch(e){}
        try { renderAllAnnotations(); } catch(e){}
        try { console.info('[backup] applied to grid:', arr.length, 'rows'); } catch(e){}
        // Important: clear pending and stop pump so we don't keep replacing data and block edits
        try { window.__pendingAnnotationRestore = null; } catch(e){}
        try { if (window.__restorePumpTimer) { clearInterval(window.__restorePumpTimer); window.__restorePumpTimer = null; } } catch(e){}
        // Keep pending for now in case user refreshes; caller controls purge.
      } catch (e) { /* ignore */ }
    };
  } catch (e) {}

  // Background pump to apply pending restore once grid becomes ready
  function schedulePendingRestorePump(){
    try {
      if (window.__restorePumpTimer) return;
      window.__restorePumpTimer = setInterval(() => {
        try {
          if (window.__pendingAnnotationRestore && window.annotationGrid && typeof window.annotationGrid.replaceData === 'function') {
            try { window.__applyPendingAnnotationRestore && window.__applyPendingAnnotationRestore(); } catch (e) {}
          }
        } catch (e) {}
      }, 250);
    } catch (e) {}
  }


  function r4(v) { return Number((+v).toFixed(4)); }

  // Toggle mode wiring
  const toggleWrap = document.getElementById('createEditToggle');
  function readModeFromToggle() {
    try { if (toggleWrap && toggleWrap.dataset && toggleWrap.dataset.mode) return toggleWrap.dataset.mode; } catch (e) {}
    return null;
  }
  function handleToggleChange(ev) {
    const m = (ev && ev.detail && ev.detail.mode) ? ev.detail.mode : readModeFromToggle();
    if (m && m !== mode) mode = m;
  }
  if (toggleWrap) {
    toggleWrap.addEventListener('mode-change', handleToggleChange, { passive: true });
    const initial = readModeFromToggle();
    if (initial) mode = initial;
  }

  // Authoritative accessor: Tabulator grid
  function authoritativeGetAll() {
    try {
      if (window.annotationGrid && typeof window.annotationGrid.getData === 'function') {
        const gd = window.annotationGrid.getData();
        if (Array.isArray(gd)) return gd.slice();
      }
    } catch (e) {}
    return [];
  }

  // Render overlay from authoritative store (GridLib)
  function resizeAnnotationOverlay() {
    const viewWidth = Math.max(1, scrollArea.clientWidth);
    const viewHeight = Math.max(1, (globalThis._spectroImageHeight || (spectrogramCanvas.clientHeight - AXIS_TOP - 44)) || 100);
    const axisLeft = (typeof globalThis._spectroAxisLeft === 'number') ? globalThis._spectroAxisLeft : 70;
    annotationOverlay.style.left = axisLeft + 'px';
    annotationOverlay.style.top = AXIS_TOP + 'px';
    annotationOverlay.style.width = viewWidth + 'px';
    annotationOverlay.style.height = viewHeight + 'px';
    const dpr = window.devicePixelRatio || 1;
    annotationOverlay.width = Math.round(viewWidth * dpr);
    annotationOverlay.height = Math.round(viewHeight * dpr);
    aCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Mirror sizing for selection overlay
    selectionOverlay.style.left = axisLeft + 'px';
    selectionOverlay.style.top = AXIS_TOP + 'px';
    selectionOverlay.style.width = viewWidth + 'px';
    selectionOverlay.style.height = viewHeight + 'px';
    selectionOverlay.width = Math.round(viewWidth * dpr);
    selectionOverlay.height = Math.round(viewHeight * dpr);
    sCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderAllAnnotations();
    renderSelectionOverlay();
  }

  function clientToTimeAndFreq_local(clientX, clientY) {
    const scrollRect = scrollArea.getBoundingClientRect();
    const localX = clientX - scrollRect.left;
    const leftCol = Math.round(scrollArea.scrollLeft || 0);
    const globalX = leftCol + localX;
    const pxPerSec = (globalThis._spectroMap && typeof globalThis._spectroMap.pxPerSec === 'function')
      ? globalThis._spectroMap.pxPerSec()
      : (globalThis._spectroPxPerSec || (globalThis._spectroPxPerFrame && globalThis._spectroFramesPerSec ? globalThis._spectroPxPerFrame * globalThis._spectroFramesPerSec : 1));
    const timeSec = Math.max(0, globalX / Math.max(1, pxPerSec));

    const canvasRect = spectrogramCanvas.getBoundingClientRect();
    const localY = clientY - canvasRect.top;
    const imageHeight = (typeof globalThis._spectroImageHeight === 'number' && globalThis._spectroImageHeight > 0)
      ? globalThis._spectroImageHeight
      : Math.max(1, (spectrogramCanvas.clientHeight || 0) - AXIS_TOP - 44);
    const ymaxHz = (typeof globalThis._spectroYMax === 'number' && globalThis._spectroYMax > 0)
      ? globalThis._spectroYMax
      : (globalThis._spectroSampleRate ? globalThis._spectroSampleRate / 2 : 22050);
    const yInImage = localY - AXIS_TOP;
    const t = Math.max(0, Math.min(1, yInImage / Math.max(1, imageHeight - 1)));
    const freqHz = Math.max(0, Math.min(ymaxHz, (1 - t) * ymaxHz));

    return { timeSec, freqHz, globalX, localX, localY, pxPerSec };
  }

  function clearOverlay() {
    aCtx.clearRect(0, 0, annotationOverlay.width / (window.devicePixelRatio || 1), annotationOverlay.height / (window.devicePixelRatio || 1));
  }

  function drawBoxOnOverlay(x1, y1, x2, y2, options = {}) {
    const { fill = COMMITTED_FILL, stroke = COMMITTED_STROKE, dashed = false } = options;
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);
    aCtx.save();
    if (dashed) aCtx.setLineDash(DASH); else aCtx.setLineDash([]);
    aCtx.fillStyle = fill;
    aCtx.strokeStyle = stroke;
    aCtx.lineWidth = 1.5;
    aCtx.fillRect(left, top, w, h);
    aCtx.strokeRect(left + 0.5, top + 0.5, w, h);
    aCtx.restore();
  }

  function drawSelectedBox(x1, y1, x2, y2) {
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);
    sCtx.save();
    sCtx.setLineDash([]);
    sCtx.fillStyle = SELECTED_FILL;
    sCtx.strokeStyle = SELECTED_STROKE;
    sCtx.lineWidth = 2.25;
    sCtx.shadowColor = 'rgba(255,235,59,0.8)';
    sCtx.shadowBlur = 8;
    sCtx.fillRect(left, top, w, h);
    sCtx.strokeRect(left + 0.5, top + 0.5, w, h);
    sCtx.restore();
  }

  function renderAllAnnotations() {
    clearOverlay();
    const pxPerSec = (globalThis._spectroMap && typeof globalThis._spectroMap.pxPerSec === 'function') ? globalThis._spectroMap.pxPerSec() : (globalThis._spectroPxPerSec || 1);
    const imageHeight = globalThis._spectroImageHeight || (annotationOverlay.clientHeight || 100);
    const ymaxHz = globalThis._spectroYMax || (globalThis._spectroSampleRate ? globalThis._spectroSampleRate / 2 : 22050);
    const duration = (typeof globalThis._spectroDuration === 'number') ? globalThis._spectroDuration : Infinity;

    // Selected IDs no longer drawn here (handled by selection overlay) but still build set for pending preview logic if needed
    let selectedIdSet = null;
    try {
      if (window.annotationGrid) {
        if (typeof window.annotationGrid.getSelectedData === 'function') {
          const sel = window.annotationGrid.getSelectedData() || [];
          selectedIdSet = new Set(sel.map(r => r && r.id));
        } else if (typeof window.annotationGrid.getSelectedRows === 'function') {
          const rows = window.annotationGrid.getSelectedRows() || [];
          const ids = [];
          rows.forEach(r => { try { const d = r.getData && r.getData(); if (d && d.id !== undefined) ids.push(d.id); } catch (e) {} });
          selectedIdSet = new Set(ids);
        }
      }
    } catch (e) { selectedIdSet = null; }

    const rows = authoritativeGetAll();
    rows.forEach(a => {
      const begin = Number(a.beginTime !== undefined ? a.beginTime : 0) || 0;
      const end = Number(a.endTime !== undefined ? a.endTime : begin) || begin;
      const low = Number(a.lowFreq !== undefined ? a.lowFreq : 0) || 0;
      const high = Number(a.highFreq !== undefined ? a.highFreq : low) || low;
      const beginClamped = Math.max(0, Math.min(begin, duration));
      const endClamped = Math.max(beginClamped, Math.min(end, duration));
      const x1 = (beginClamped * pxPerSec) - Math.round(scrollArea.scrollLeft || 0);
      const x2 = (endClamped * pxPerSec) - Math.round(scrollArea.scrollLeft || 0);
      const t1 = 1 - (high / ymaxHz);
      const t2 = 1 - (low / ymaxHz);
      const y1 = t1 * imageHeight;
      const y2 = t2 * imageHeight;
      // Always draw base box; selection styling is layered separately
      drawBoxOnOverlay(x1, y1, x2, y2, { fill: COMMITTED_FILL, stroke: COMMITTED_STROKE, dashed: false });
    });

    if (pending) {
      const curPxPerSec = pending.pxPerSec || pxPerSec;
      const clampedCurrent = Math.min(pending.currentTime, duration);
      const clampedStart = Math.min(pending.startTime, duration);
      const x1 = (Math.min(clampedStart, clampedCurrent) * curPxPerSec) - Math.round(scrollArea.scrollLeft || 0);
      const x2 = (Math.max(clampedStart, clampedCurrent) * curPxPerSec) - Math.round(scrollArea.scrollLeft || 0);

      const low = Math.min(pending.startFreq, pending.currentFreq);
      const high = Math.max(pending.startFreq, pending.currentFreq);
      const t1 = 1 - (high / ymaxHz);
      const t2 = 1 - (low / ymaxHz);
      const y1 = t1 * imageHeight;
      const y2 = t2 * imageHeight;
      drawBoxOnOverlay(x1, y1, x2, y2, { fill: PENDING_FILL, stroke: PENDING_STROKE, dashed: true });
    }
  }

  function renderSelectionOverlay(idsOverride) {
    // Clear selection canvas
    sCtx.clearRect(0, 0, selectionOverlay.width / (window.devicePixelRatio || 1), selectionOverlay.height / (window.devicePixelRatio || 1));
    let sel = [];
    try {
      if (Array.isArray(idsOverride) && idsOverride.length) {
        // Resolve records by ids
        const all = authoritativeGetAll();
        const idSet = new Set(idsOverride.map(String));
        sel = all.filter(a => idSet.has(String(a.id)));
      } else if (window.annotationGrid) {
        if (typeof window.annotationGrid.getSelectedData === 'function') sel = window.annotationGrid.getSelectedData();
        else if (typeof window.annotationGrid.getSelectedRows === 'function') {
          const rows = window.annotationGrid.getSelectedRows() || [];
          rows.forEach(r => { try { const d = r.getData && r.getData(); if (d) sel.push(d); } catch(e){} });
        }
      }
    } catch(e){ sel = []; }
    if (!Array.isArray(sel) || !sel.length) return;
    const pxPerSec = (globalThis._spectroMap && typeof globalThis._spectroMap.pxPerSec === 'function') ? globalThis._spectroMap.pxPerSec() : (globalThis._spectroPxPerSec || 1);
    const imageHeight = globalThis._spectroImageHeight || (annotationOverlay.clientHeight || 100);
    const ymaxHz = globalThis._spectroYMax || (globalThis._spectroSampleRate ? globalThis._spectroSampleRate / 2 : 22050);
    const duration = (typeof globalThis._spectroDuration === 'number') ? globalThis._spectroDuration : Infinity;
    sel.forEach(a => {
      try {
        const begin = Number(a.beginTime); const end = Number(a.endTime); const low = Number(a.lowFreq); const high = Number(a.highFreq);
        if (!isFinite(begin) || !isFinite(end) || !isFinite(low) || !isFinite(high)) return;
        const beginClamped = Math.max(0, Math.min(begin, duration));
        const endClamped = Math.max(beginClamped, Math.min(end, duration));
        const x1 = (beginClamped * pxPerSec) - Math.round(scrollArea.scrollLeft || 0);
        const x2 = (endClamped * pxPerSec) - Math.round(scrollArea.scrollLeft || 0);
        const t1 = 1 - (high / ymaxHz);
        const t2 = 1 - (low / ymaxHz);
        const y1 = t1 * imageHeight;
        const y2 = t2 * imageHeight;
        drawSelectedBox(x1, y1, x2, y2);
      } catch(e){}
    });
    try { console.debug('[selectionOverlay] drawn selected ids:', sel.map(r=>r.id)); } catch(e){}
  }

  // Re-render helpers hooked to grid and custom events to reflect edits immediately
  function tryHookGridEventsOnce() {
    try {
      const g = window.annotationGrid;
      if (!g || typeof g.on !== 'function') return;
      if (g.__overlayRenderHooked) return; // idempotent
      const rerender = () => {
        try { renderAllAnnotations(); } catch (e) {}
        try { renderSelectionOverlay(); } catch (e) {}
      };
      // Backup helpers: per-file single backup, overwrite on create/modify
      const BACKUP_PREFIX = 'annotations_backup::';
      const BACKUP_META_PREFIX = 'annotations_backup::meta::';
      const BACKUP_TMP_PREFIX = 'annotations_backup::tmp::';
      function currentFileId(){
        try {
          const fi = document.getElementById('file');
          const f = fi && fi.files && fi.files[0];
          if (f) return `${f.name}|${f.size||0}|${f.lastModified||0}`;
        } catch (e) {}
        return 'nofile|0|0';
      }
      function writeBackupNow(){
        try {
          if (!window.annotationGrid || typeof window.annotationGrid.getData !== 'function') return;
          const data = window.annotationGrid.getData() || [];
          const fid = currentFileId();
          const tmpKey = BACKUP_TMP_PREFIX + fid;
          const finKey = BACKUP_PREFIX + fid;
          const metaKey = BACKUP_META_PREFIX + fid;
          // If no rows, purge existing backups for this file (user deleted all)
          if (!Array.isArray(data) || data.length === 0) {
            try { localStorage.removeItem(finKey); } catch(e){}
            try { localStorage.removeItem(tmpKey); } catch(e){}
            try { localStorage.removeItem(metaKey); } catch(e){}
            return;
          }
          const json = JSON.stringify(data);
          // soft size guard (~4MB)
          if (json && json.length > (4 * 1024 * 1024)) { console.warn('[backup] skipped: too large'); return; }
          try { localStorage.setItem(tmpKey, json); } catch (e) { return; }
          // read-back verify
          try { JSON.parse(localStorage.getItem(tmpKey) || '[]'); } catch (e) { try { localStorage.removeItem(tmpKey); } catch(_){} return; }
          try { localStorage.setItem(finKey, json); } catch (e) { /* ignore */ }
          try { localStorage.setItem(metaKey, JSON.stringify({ ts: Date.now(), count: data.length })); } catch (e) { /* ignore */ }
          try { localStorage.removeItem(tmpKey); } catch (e) {}
        } catch (e) { /* ignore */ }
      }
      let __backupTimer = null;
      function scheduleBackup(){
        try { if (__backupTimer) clearTimeout(__backupTimer); __backupTimer = setTimeout(writeBackupNow, 1200); } catch (e) {}
      }
      // Tabulator event coverage: row/cell/data changes
  g.on('dataChanged', rerender);
      g.on('dataLoaded', rerender);
      g.on('cellEdited', function(){ try { rerender(); } catch(e){} scheduleBackup(); });
      g.on('rowAdded', function(){ try { rerender(); } catch(e){} scheduleBackup(); });
      g.on('rowUpdated', function(){ try { rerender(); } catch(e){} scheduleBackup(); });
      g.on('rowDeleted', function(){ try { rerender(); } catch(e){} scheduleBackup(); });
  g.on('rowSelectionChanged', function(){ try { renderSelectionOverlay(); } catch(e){} });
      // Also back up on generic data change if available
      g.on('dataChanged', function(){ scheduleBackup(); });
      try {
        // When species is edited directly in the grid, auto-fill scientificName if possible
        g.on && g.on('cellEdited', function(cell){
          try {
            // Tabulator passes CellComponent; some builds pass (cell, value)
            const cellComp = cell && cell.getField ? cell : (arguments && arguments[0] ? arguments[0] : null);
            if (!cellComp) return;
            const field = (typeof cellComp.getField === 'function') ? cellComp.getField() : null;
            if (field !== 'species') return;
            const newVal = (typeof cellComp.getValue === 'function') ? String(cellComp.getValue() || '').trim() : '';
            // Determine scientific name
            let sci = '';
            try {
              const keyEl = document.getElementById('selectedSpeciesKey');
              const key = keyEl ? String(keyEl.value || '').trim() : '';
              const recs = Array.isArray(window.__speciesRecords) ? window.__speciesRecords : [];
              if (key) {
                const rec = recs.find(r => String((r.key||'')).trim() === key);
                sci = rec ? (rec.scientific || '') : '';
              } else if (newVal) {
                const rec = recs.find(r => String((r.common||'')).trim() === newVal);
                sci = rec ? (rec.scientific || '') : '';
              }
            } catch (e) { sci = ''; }
            // Update the same row with scientificName
            try {
              const row = (typeof cellComp.getRow === 'function') ? cellComp.getRow() : null;
              if (row && typeof row.update === 'function') {
                row.update({ scientificName: sci });
              } else if (window.annotationGrid && typeof window.annotationGrid.updateRow === 'function') {
                const data = (typeof cellComp.getRow === 'function' && cellComp.getRow() && typeof cellComp.getRow().getData === 'function') ? cellComp.getRow().getData() : null;
                if (data && data.id !== undefined) window.annotationGrid.updateRow(data.id, { scientificName: sci });
              }
              try { window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: 'species-cell-edited' } })); } catch (e) {}
            } catch (e) {}
          } catch (e) {}
        });
      } catch (e) {}
      // keep plain rerender listeners too (already above)
      g.__overlayRenderHooked = true;
    } catch (e) {}
  }

  // commitPending: save annotation coordinates in Tabulator grid from index.html
  function commitPending() {
    if (!pending) return;

    const begin = Math.min(pending.startTime, pending.currentTime);
    let end = Math.max(pending.startTime, pending.currentTime);
    const low = Math.min(pending.startFreq, pending.currentFreq);
    const high = Math.max(pending.startFreq, pending.currentFreq);

    if (!(begin < end && low < high)) {
      pending = null;
      renderAllAnnotations();
      return;
    }

    const duration = (typeof globalThis._spectroDuration === 'number') ? globalThis._spectroDuration : Infinity;
    if (end > duration) end = duration;
    const MIN_DUR = 0.01;
    if (begin >= end) end = Math.min(duration, begin + MIN_DUR);

    let speciesVal = '';
    try {
      const spLabel = document.querySelector('#speciesResult');
      if (spLabel) speciesVal = String(spLabel.textContent || '').trim();
    } catch (e) { speciesVal = ''; }
    // If species is missing, block creation: alert with OK-only and cancel the pending
    if (!speciesVal) {
      try {
        window.alert('Please Select a species first and try again.');
      } catch (e) {}
      // discard pending annotation
      cancelPending();
      return;
    }
    // Mark row for later metadata completion if species absent.
    const needsMetadata = !speciesVal;

    // Add annotation to Tabulator grid from index.html
    try {
      if (window.annotationGrid && typeof window.annotationGrid.addData === 'function') {
        // Generate a unique id for each annotation
        const gridData = window.annotationGrid.getData();
        const nextId = gridData.length > 0 ? Math.max(...gridData.map(a => Number(a.id) || 0)) + 1 : 1;
          const round4 = v => Number(v).toFixed(4);
          // Determine scientific name from selected species key or lookup by common name
          let scientificVal = '';
          try {
            const keyEl = document.getElementById('selectedSpeciesKey');
            const key = keyEl ? String(keyEl.value || '').trim() : '';
            const recs = Array.isArray(window.__speciesRecords) ? window.__speciesRecords : [];
            if (key) {
              const rec = recs.find(r => String((r.key||'')).trim() === key);
              scientificVal = rec ? (rec.scientific || '') : '';
            } else if (speciesVal) {
              const rec = recs.find(r => String((r.common||'')).trim() === String(speciesVal).trim());
              scientificVal = rec ? (rec.scientific || '') : '';
            }
          } catch (e) { scientificVal = ''; }

          const rowObj = {
                  id: nextId,
                  Selection: String(nextId),
                  beginTime: Number(round4(begin)),
                  endTime: Number(round4(end)),
                  lowFreq: Number(round4(low)),
                  highFreq: Number(round4(high)),
                  species: speciesVal,
                  scientificName: scientificVal,
                  needsMetadata: needsMetadata,
                  notes: ''
                };
        window.annotationGrid.addData([rowObj]);
        // remember last created id for right-click cancel behavior
        try { lastCreatedId = nextId; } catch (e) {}
      }
    } catch (e) {
      try { window.alert('Failed to add annotation to grid. Annotation not saved.'); } catch (ex) {}
    }
    pending = null;
    renderAllAnnotations();
  }

  function cancelPending() {
    pending = null;
    renderAllAnnotations();
  }

  function cancelPendingCreate() {
    try {
      if (pointerDown && typeof __lastPointerId !== 'undefined' && spectrogramCanvas && spectrogramCanvas.releasePointerCapture) {
        try { spectrogramCanvas.releasePointerCapture(__lastPointerId); } catch (e) {}
      }
    } catch (e) {}
    pointerDown = false;
    pending = null;
    renderAllAnnotations();
    const temp = document.getElementById('createPreviewLayer');
    if (temp) temp.remove();
    try { __lastPointerId = undefined; } catch (e) {}
  }
  window.__cancelPendingCreate = cancelPendingCreate;
  window.addEventListener('cancel-pending-create', (ev) => { cancelPendingCreate(); }, false);

  let pointerDown = false;
  function currentMode() { return readModeFromToggle() || mode; }

  function onPointerDown(ev) {
    if (currentMode() !== 'create') return;
    if (ev.button !== 0) return;
    const canvasRect = spectrogramCanvas.getBoundingClientRect();
    const yInCanvas = ev.clientY - canvasRect.top;
    const imageHeight = globalThis._spectroImageHeight || (spectrogramCanvas.clientHeight - AXIS_TOP - 44);
    if (yInCanvas < AXIS_TOP || yInCanvas > AXIS_TOP + imageHeight) return;
    pointerDown = true;
    __lastPointerId = ev.pointerId;
    const start = clientToTimeAndFreq_local(ev.clientX, ev.clientY);
    pending = {
      startTime: start.timeSec,
      startFreq: start.freqHz,
      currentTime: start.timeSec,
      currentFreq: start.freqHz,
      pxPerSec: start.pxPerSec
    };
    try { ev.target.setPointerCapture && ev.target.setPointerCapture(ev.pointerId); } catch (e) {}
    renderAllAnnotations();
  }

  function onPointerMove(ev) {
    if (currentMode() !== 'create') return;
    if (!pointerDown || !pending) return;
    const cur = clientToTimeAndFreq_local(ev.clientX, ev.clientY);
    const duration = (typeof globalThis._spectroDuration === 'number') ? globalThis._spectroDuration : Infinity;
    pending.currentTime = Math.min(cur.timeSec, duration);
    pending.currentFreq = cur.freqHz;
    pending.pxPerSec = cur.pxPerSec;
    renderAllAnnotations();
  }

  function onPointerUp(ev) {
    if (currentMode() !== 'create') return;
    if (!pointerDown) return;
    pointerDown = false;
    try { ev.target.releasePointerCapture && ev.target.releasePointerCapture(ev.pointerId); } catch (e) {}
    __lastPointerId = undefined;
    // Auto-commit the pending annotation on pointerup (no explicit Enter required)
    try { commitPending(); } catch (e) {}
    renderAllAnnotations();
  }

  function onKeyDown(ev) {
    // Intentionally left blank: creation is auto-committed on pointerup and Undo is handled via Ctrl/Cmd+Z or right-click.
  }

  function onSpectrogramContextMenu(ev) {
    // In create mode right-click cancels the current pending drag or deletes the last created annotation.
    if (currentMode() === 'create') {
      if (pending) {
        ev.preventDefault(); ev.stopPropagation(); cancelPending(); return;
      }
      // delete last created annotation row if present
      if (lastCreatedId != null) {
        ev.preventDefault(); ev.stopPropagation();
        try {
          if (window.annotationGrid && typeof window.annotationGrid.deleteRow === 'function') {
            window.annotationGrid.deleteRow(lastCreatedId);
          }
        } catch (e) {}
        try {
          const anns = authoritativeGetAll() || [];
          const filtered = anns.filter(a => String(a.id) !== String(lastCreatedId));
          // Reindex remaining annotations so ids and Selection are sequential
          const remaining = filtered.map((a, i) => Object.assign({}, a, { id: i + 1, Selection: String(i + 1) }));
          replaceAnnotations(remaining);
          // Also update Tabulator grid if possible
          if (window.annotationGrid && typeof window.annotationGrid.replaceData === 'function') {
            try { window.annotationGrid.replaceData(remaining); } catch (e) {}
          }
        } catch (e) {}
        lastCreatedId = null;
        try { renderAllAnnotations(); } catch (e) {}
        return;
      }
    }
    // otherwise allow native context menu
  }

  // wire events
  spectrogramCanvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  spectrogramCanvas.addEventListener('contextmenu', onSpectrogramContextMenu);
  spectrogramCanvas.tabIndex = spectrogramCanvas.tabIndex || 0;
  spectrogramCanvas.addEventListener('keydown', onKeyDown);
  window.addEventListener('keydown', onKeyDown);

  scrollArea.addEventListener('scroll', () => { resizeAnnotationOverlay(); renderSelectionOverlay(); });
  window.addEventListener('resize', () => { resizeAnnotationOverlay(); renderSelectionOverlay(); });
  // Re-render on global custom signal used by other modules (e.g., uploads/edits)
  window.addEventListener('annotations-changed', () => { renderAllAnnotations(); renderSelectionOverlay(); }, { passive: true });
  // Ensure overlays resync when spectrogram geometry changes (e.g., Y max regenerate)
  window.addEventListener('spectrogram-generated', () => {
    try { resizeAnnotationOverlay(); } catch (e) {}
  try { requestAnimationFrame(() => { try { renderAllAnnotations(); renderSelectionOverlay(); } catch (e) {} }); } catch (e) { try { setTimeout(() => { try { renderAllAnnotations(); renderSelectionOverlay(); } catch (e) {} }, 20); } catch (ex) {} }
  }, { passive: true });

  // Expose helpers for other modules
  try {
    window.renderAllAnnotations = renderAllAnnotations;
    window.resizeAnnotationOverlay = resizeAnnotationOverlay;
    window.renderSelectionOverlay = renderSelectionOverlay;
  } catch (e) {}

  // Expose authoritative API proxied to GridLib
  globalThis._annotations = globalThis._annotations || {};
  globalThis._annotations.getAll = () => authoritativeGetAll();
  globalThis._annotations.import = (arr) => {
    try {
      if (window.GridLib && typeof window.GridLib.loadData === 'function') {
        const headers = window.GridLib.tableInstance && typeof window.GridLib.tableInstance.getColumns === 'function' ? window.GridLib.tableInstance.getColumns().map(c => c.getField()) : ['Selection','Begin Time (s)','End Time (s)','Low Freq (Hz)','High Freq (Hz)','Common name','Notes'];
        window.GridLib.loadData(headers, arr || []);
        try { if (typeof onChangeCb === 'function') onChangeCb(authoritativeGetAll()); } catch (e) {}
        return;
      }
      // Preferred: load directly into Tabulator grid if present
      if (window.annotationGrid && typeof window.annotationGrid.replaceData === 'function') {
        const input = Array.isArray(arr) ? arr : [];
        const norm = input.map((r, i) => {
          const begin = Number(r && r.beginTime != null ? r.beginTime : r.begin);
          const end = Number(r && r.endTime != null ? r.endTime : r.end);
          const low = Number(r && r.lowFreq != null ? r.lowFreq : r.low);
          const high = Number(r && r.highFreq != null ? r.highFreq : r.high);
          const id = i + 1;
          return {
            id,
            Selection: String(id),
            beginTime: isFinite(begin) ? +begin : 0,
            endTime: isFinite(end) ? +end : (isFinite(begin) ? +begin : 0),
            lowFreq: isFinite(low) ? +low : 0,
            highFreq: isFinite(high) ? +high : 0,
            species: r && r.species != null ? r.species : (r && r['Common name'] != null ? r['Common name'] : ''),
            scientificName: r && r.scientificName != null ? r.scientificName : (r && r['Scientific name'] != null ? r['Scientific name'] : ''),
            notes: r && r.notes != null ? r.notes : (r && r.Notes != null ? r.Notes : '')
          };
        });
        try { window.annotationGrid.replaceData(norm); } catch (e) { console.error('replaceData failed', e); }
        try { window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: 'import' } })); } catch (e) {}
        try { renderAllAnnotations(); } catch (e) {}
        try { if (typeof onChangeCb === 'function') onChangeCb(authoritativeGetAll()); } catch (e) {}
        return;
      }
    } catch (e) {}
    try { if (typeof onChangeCb === 'function') onChangeCb(authoritativeGetAll()); } catch (e) {}
    try { renderAllAnnotations(); } catch (e) {}
  };
  globalThis._annotations.onChange = (cb) => { onChangeCb = cb; };
  globalThis._annotations.delete = (id) => {
    try {
      if (window.GridLib && typeof window.GridLib.getData === 'function' && typeof window.GridLib.loadData === 'function') {
        const all = window.GridLib.getData() || [];
        const remaining = (all || []).filter(r => {
          const idVal = (r.id !== undefined) ? String(r.id) : (r.Selection !== undefined ? String(r.Selection) : '');
          return String(idVal) !== String(id) && String(r.id || '') !== String(id);
        });
        const headers = window.GridLib.tableInstance && typeof window.GridLib.tableInstance.getColumns === 'function' ? window.GridLib.tableInstance.getColumns().map(c => c.getField()) : ['Selection','Begin Time (s)','End Time (s)','Low Freq (Hz)','High Freq (Hz)','Common name','Notes'];
        window.GridLib.loadData(headers, remaining);
        try { if (typeof onChangeCb === 'function') onChangeCb(authoritativeGetAll()); } catch (e) {}
        try { renderAllAnnotations(); } catch (e) {}
        return;
      }
    } catch (e) {}
    try { if (typeof onChangeCb === 'function') onChangeCb(authoritativeGetAll()); } catch (e) {}
    try { renderAllAnnotations(); } catch (e) {}
  };
  globalThis._annotations.clear = () => {
    try {
      if (window.GridLib && typeof window.GridLib.clear === 'function') {
        window.GridLib.clear();
      } else if (window.GridLib && typeof window.GridLib.loadData === 'function') {
        const headers = window.GridLib.tableInstance && typeof window.GridLib.tableInstance.getColumns === 'function' ? window.GridLib.tableInstance.getColumns().map(c => c.getField()) : ['Selection','Begin Time (s)','End Time (s)','Low Freq (Hz)','High Freq (Hz)','Common name','Notes'];
        window.GridLib.loadData(headers, []);
      }
    } catch (e) {}
    try { if (typeof onChangeCb === 'function') onChangeCb(authoritativeGetAll()); } catch (e) {}
    try { renderAllAnnotations(); } catch (e) {}
  };

  window.__clearAllAnnotations = function () {
    if (globalThis._annotations && typeof globalThis._annotations.clear === 'function') {
      globalThis._annotations.clear();
    }
    try { clearOverlay(); } catch (e) {}
    // Also clear Tabulator grid if present
    try {
      if (window.annotationGrid && typeof window.annotationGrid.replaceData === 'function') {
        window.annotationGrid.replaceData([]);
      } else if (window.annotationGrid && typeof window.annotationGrid.clearData === 'function') {
        window.annotationGrid.clearData();
      }
    } catch (e) {}
    // Cancel any active edit or pending create sessions so UI doesn't keep stale selection
    try { if (typeof window.__cancelPendingCreate === 'function') window.__cancelPendingCreate(); } catch (e) {}
    try { if (globalThis._editAnnotations && typeof globalThis._editAnnotations.cancelEdit === 'function') globalThis._editAnnotations.cancelEdit(); } catch (e) {}
    // Notify listeners that annotations were cleared
    try { window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: 'clear-all' } })); } catch (e) {}
  };

  // initial sizing and render
  setTimeout(() => {
  resizeAnnotationOverlay();
  renderAllAnnotations();
  renderSelectionOverlay();
    tryHookGridEventsOnce();
    schedulePendingRestorePump();
    // If there is a pending restore request set by spectrogram.js, apply it here when grid is ready
    try {
      if (window.__pendingAnnotationRestore) {
        // define central applier for future invocations as well
        // Apply immediately now that grid is available
        try { window.__applyPendingAnnotationRestore(); } catch(e){}
      }
    } catch (e) {}
  }, 120);

})();