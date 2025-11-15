// edit_annotations.js
// Edit-mode interactions: hover, select, resize handles, commit/cancel, delete.
// Listens to authoritative segmented toggle (#createEditToggle) and never toggles modes itself.
// Delete button is enabled only when mode === 'edit'. Multi-delete supported via toolbar.

(function () {
  const EDGE_TOL_PX = 6;
  const HANDLE_SIZE = 10;
  const HANDLE_HIT = 14;
  const HIGHLIGHT_COLOR = '#ffff66';
  const HIGHLIGHT_LINEWIDTH = 2.5;
  const AXIS_TOP = 12;

  // DOM refs
  const viewportWrapper = document.getElementById('viewportWrapper');
  const scrollArea = document.getElementById('scrollArea');
  const spectrogramCanvas = document.getElementById('spectrogramCanvas');
  const annotationOverlay = document.getElementById('annotationOverlay');
  if (!viewportWrapper || !scrollArea || !spectrogramCanvas || !annotationOverlay) return;

  // highlight canvas
  let highlightCanvas = document.getElementById('editHighlightOverlay');
  if (!highlightCanvas) {
    highlightCanvas = document.createElement('canvas');
    highlightCanvas.id = 'editHighlightOverlay';
    highlightCanvas.style.position = 'absolute';
    highlightCanvas.style.pointerEvents = 'none';
    highlightCanvas.style.zIndex = 75;
    viewportWrapper.appendChild(highlightCanvas);
  }
  const hCtx = highlightCanvas.getContext && highlightCanvas.getContext('2d', { alpha: true });
  if (!hCtx) return;

  // pointer layer for captures
  let pointerLayer = document.getElementById('editPointerLayer');
  if (!pointerLayer) {
    pointerLayer = document.createElement('div');
    pointerLayer.id = 'editPointerLayer';
    pointerLayer.style.position = 'absolute';
    pointerLayer.style.left = '0px';
    pointerLayer.style.top = '0px';
    pointerLayer.style.width = '100%';
    pointerLayer.style.height = '100%';
    pointerLayer.style.background = 'transparent';
    pointerLayer.style.zIndex = 80;
    pointerLayer.style.pointerEvents = 'none';
    viewportWrapper.appendChild(pointerLayer);
  }

  // toolbar elements (support toggle and legacy pages)
  const toggleWrap = document.getElementById('createEditToggle');
  const createBtn = document.getElementById('toggleCreate') || document.querySelector('button[title="Create"]') || document.querySelector('#annoCreateBtn');
  const editBtn = document.getElementById('toggleEdit') || document.querySelector('button[title="Edit"]') || document.querySelector('#annoEditBtn');
  const deleteBtn = document.querySelector('button[title="Delete"]') || document.getElementById('annoDeleteBtn');
  const multiDeleteBtn = document.getElementById('multiDeleteBtn');

  // Helpers to access authoritative annotations API
  function getAnnotations() {
    if (globalThis._annotations && typeof globalThis._annotations.getAll === 'function') {
      try { return globalThis._annotations.getAll() || []; } catch (e) { return []; }
    }
    return [];
  }
  function replaceAnnotations(newArr) {
    if (globalThis._annotations && typeof globalThis._annotations.import === 'function') {
      try { globalThis._annotations.import(newArr); } catch (e) { /* ignore */ }
    }
  }

  // Mapping helpers
  function getMapping() {
    const pxPerSec = (globalThis._spectroMap && typeof globalThis._spectroMap.pxPerSec === 'function')
      ? globalThis._spectroMap.pxPerSec()
      : (globalThis._spectroPxPerSec || 1);
    const imageHeight = (typeof globalThis._spectroImageHeight === 'number' && globalThis._spectroImageHeight > 0)
      ? globalThis._spectroImageHeight
      : Math.max(1, (spectrogramCanvas.clientHeight || 300) - AXIS_TOP - 44);
    const ymaxHz = (typeof globalThis._spectroYMax === 'number' && globalThis._spectroYMax > 0)
      ? globalThis._spectroYMax
      : (globalThis._spectroSampleRate ? globalThis._spectroSampleRate / 2 : 22050);
    const axisLeft = (typeof globalThis._spectroAxisLeft === 'number') ? globalThis._spectroAxisLeft : 70;
    return { pxPerSec, imageHeight, ymaxHz, axisLeft };
  }

  // Authoritative duration getter (used for clamps)
  function getDurationSec() {
    if (typeof globalThis._spectroDuration === 'number' && isFinite(globalThis._spectroDuration)) return globalThis._spectroDuration;
    if (globalThis._spectroAudioBuffer && typeof globalThis._spectroAudioBuffer.duration === 'number' && isFinite(globalThis._spectroAudioBuffer.duration)) {
      return globalThis._spectroAudioBuffer.duration;
    }
    const audio = document.querySelector('audio');
    if (audio && isFinite(audio.duration)) return audio.duration;
    return null;
  }

  // Resize highlight & pointer layers
  function resizeLayers() {
    const viewWidth = Math.max(1, scrollArea.clientWidth);
    const { imageHeight } = getMapping();
    const axisLeft = (typeof globalThis._spectroAxisLeft === 'number') ? globalThis._spectroAxisLeft : 70;

    highlightCanvas.style.left = axisLeft + 'px';
    highlightCanvas.style.top = AXIS_TOP + 'px';
    highlightCanvas.style.width = viewWidth + 'px';
    highlightCanvas.style.height = imageHeight + 'px';
    const dpr = window.devicePixelRatio || 1;
    highlightCanvas.width = Math.round(viewWidth * dpr);
    highlightCanvas.height = Math.round(imageHeight * dpr);
    hCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    pointerLayer.style.left = axisLeft + 'px';
    pointerLayer.style.top = AXIS_TOP + 'px';
    pointerLayer.style.width = viewWidth + 'px';
    pointerLayer.style.height = imageHeight + 'px';
  }

  function clearHighlightCanvas() {
    hCtx.clearRect(0, 0, highlightCanvas.width / (window.devicePixelRatio || 1), highlightCanvas.height / (window.devicePixelRatio || 1));
  }

  // Geometry helpers
  function annotationToRectPx(a) {
    const { pxPerSec, imageHeight, ymaxHz } = getMapping();
    const left = (a.beginTime * pxPerSec) - Math.round(scrollArea.scrollLeft || 0);
    const right = (a.endTime * pxPerSec) - Math.round(scrollArea.scrollLeft || 0);
    const t1 = 1 - (a.highFreq / ymaxHz);
    const t2 = 1 - (a.lowFreq / ymaxHz);
    const top = t1 * imageHeight;
    const bottom = t2 * imageHeight;
    return { left, top, right, bottom, width: Math.abs(right - left), height: Math.abs(bottom - top) };
  }

  function pointToRectEdgeDistance(px, py, rect) {
    const left = Math.min(rect.left, rect.right);
    const right = Math.max(rect.left, rect.right);
    const top = Math.min(rect.top, rect.bottom);
    const bottom = Math.max(rect.top, rect.bottom);
    if (px >= left && px <= right && py >= top && py <= bottom) return 0;
    const dx = Math.max(left - px, 0, px - right);
    const dy = Math.max(top - py, 0, py - bottom);
    return Math.sqrt(dx * dx + dy * dy);
  }

  function findNearestAnnotation(px, py) {
    const anns = getAnnotations();
    if (!anns || !anns.length) return null;
    let best = null;
    for (const a of anns) {
      const rect = annotationToRectPx(a);
      const d = pointToRectEdgeDistance(px, py, rect);
      if (best === null || d < best.dist || (d === best.dist && (rect.width * rect.height) < (best.rectPx.width * best.rectPx.height))) {
        best = { id: a.id, dist: d, rectPx: rect, ann: a };
      }
    }
    return (best && best.dist <= EDGE_TOL_PX) ? best : null;
  }

  function computeHandles(rectPx) {
    const left = Math.min(rectPx.left, rectPx.right);
    const right = Math.max(rectPx.left, rectPx.right);
    const top = Math.min(rectPx.top, rectPx.bottom);
    const bottom = Math.max(rectPx.top, rectPx.bottom);
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const s = HANDLE_SIZE;
    return [
      { name: 'left', x: left, y: cy, w: s, h: s },
      { name: 'right', x: right, y: cy, w: s, h: s },
      { name: 'top', x: cx, y: top, w: s, h: s },
      { name: 'bottom', x: cx, y: bottom, w: s, h: s },
      { name: 'topleft', x: left, y: top, w: s, h: s },
      { name: 'topright', x: right, y: top, w: s, h: s },
      { name: 'bottomleft', x: left, y: bottom, w: s, h: s },
      { name: 'bottomright', x: right, y: bottom, w: s, h: s }
    ];
  }

  function hitTestHandle(localX, localY, rectPx) {
    const handles = computeHandles(rectPx);
    for (const h of handles) {
      const hx = h.x - (HANDLE_HIT / 2);
      const hy = h.y - (HANDLE_HIT / 2);
      if (localX >= hx && localX <= hx + HANDLE_HIT && localY >= hy && localY <= hy + HANDLE_HIT) return h.name;
    }
    return null;
  }

  // Drawing
  function drawWorkingBoxWithHandles(working) {
    clearHighlightCanvas();
    if (!working) return;

    // If another annotation is highlighted while we are editing, draw that
    // highlight first so it appears underneath the working box.
    try {
      if (highlightedId != null && highlightedId !== working.id) {
        const a = getAnnotations().find(x => x.id === highlightedId);
        if (a) {
          const r = annotationToRectPx(a);
          hCtx.save();
          hCtx.setLineDash([]);
          hCtx.lineWidth = HIGHLIGHT_LINEWIDTH;
          hCtx.strokeStyle = HIGHLIGHT_COLOR;
          const l = Math.min(r.left, r.right);
          const t = Math.min(r.top, r.bottom);
          const ww = Math.abs(r.right - r.left);
          const hh = Math.abs(r.bottom - r.top);
          hCtx.strokeRect(l + 0.5, t + 0.5, ww, hh);
          hCtx.restore();
        }
      }
    } catch (e) {}

    const rect = annotationToRectPx(working);
    hCtx.save();
    hCtx.setLineDash([]);
    hCtx.lineWidth = HIGHLIGHT_LINEWIDTH;
    hCtx.strokeStyle = HIGHLIGHT_COLOR;
    const left = Math.min(rect.left, rect.right);
    const top = Math.min(rect.top, rect.bottom);
    const w = Math.abs(rect.right - rect.left);
    const h = Math.abs(rect.bottom - rect.top);
    hCtx.strokeRect(left + 0.5, top + 0.5, w, h);

    const handles = computeHandles(rect);
    for (const hh of handles) {
      const x = hh.x - hh.w / 2;
      const y = hh.y - hh.h / 2;
      hCtx.fillStyle = HIGHLIGHT_COLOR;
      hCtx.fillRect(x, y, hh.w, hh.h);
    }
    hCtx.restore();
  }

  function drawHighlightOnlyForId(id) {
    clearHighlightCanvas();
    const a = getAnnotations().find(x => x.id === id);
    if (!a) return;
    const rect = annotationToRectPx(a);
    hCtx.save();
    hCtx.setLineDash([]);
    hCtx.lineWidth = HIGHLIGHT_LINEWIDTH;
    hCtx.strokeStyle = HIGHLIGHT_COLOR;
    const left = Math.min(rect.left, rect.right);
    const top = Math.min(rect.top, rect.bottom);
    const w = Math.abs(rect.right - rect.left);
    const h = Math.abs(rect.bottom - rect.top);
    hCtx.strokeRect(left + 0.5, top + 0.5, w, h);
    hCtx.restore();
  }

  // State
  let editModeActive = false;
  let hoverEnabled = true;
  let highlightedId = null;
  let editSession = null; // { id, originalSnapshot, working, activeHandle, pointerId, dragging }
  let lastPointerPos = { x: 0, y: 0 };

  // Edit session management
  function startEditSession(id) {
    const anns = getAnnotations();
    const idx = anns.findIndex(a => a.id === id);
    if (idx < 0) return;
    const authoritative = anns[idx];
    editSession = {
      id: authoritative.id,
      originalSnapshot: JSON.parse(JSON.stringify(authoritative)),
      working: JSON.parse(JSON.stringify(authoritative)),
      activeHandle: null,
      pointerId: null,
      dragging: false
    };
  try { globalThis._annotations._editingId = editSession.id; } catch (e) {}
  // Keep hover enabled so other boxes can still highlight while one is in edit mode.
  hoverEnabled = true;
  highlightedId = null;
    drawWorkingBoxWithHandles(editSession.working);
    // populate species label if present
    try {
      const sp = document.querySelector('#speciesResult');
      if (sp) sp.textContent = String(authoritative.species || '').trim();
    } catch (e) {}
    setDeleteEnabled(true);
    broadcastEditSelectionChanged();

    // --- NEW: Immediate grid selection + selection overlay sync (robust) ---
    try { ensureGridSelectionAndOverlay(authoritative.id); } catch(e) { console.warn('ensureGridSelectionAndOverlay failed', e); }
  }

  function persistWorkingToAuthoritative() {
    if (!editSession) return;
    try {
      const updated = getAnnotations();
      const idx = updated.findIndex(x => x.id === editSession.id);
      if (idx >= 0) {
        const w = editSession.working;
        const round4 = v => Number(v).toFixed(4);
        updated[idx] = Object.assign({}, updated[idx], {
          beginTime: Number(round4(w.beginTime)),
          endTime: Number(round4(w.endTime)),
          lowFreq: Number(round4(w.lowFreq)),
          highFreq: Number(round4(w.highFreq))
        });
        replaceAnnotations(updated);
        // Update Tabulator grid row
        if (window.annotationGrid && typeof window.annotationGrid.updateRow === 'function') {
          window.annotationGrid.updateRow(editSession.id, {
            beginTime: Number(round4(w.beginTime)),
            endTime: Number(round4(w.endTime)),
            lowFreq: Number(round4(w.lowFreq)),
            highFreq: Number(round4(w.highFreq))
          });
          // Proactively notify and trigger overlay refresh for immediate visual update
          try { window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: 'edit-commit', id: editSession.id } })); } catch (e) {}
        }
      }
    } catch (e) { console.error('persist failed', e); }
  }

  function commitEditSessionAndEnd() {
    if (!editSession) return;
    const w = editSession.working;
    const duration = getDurationSec();
    const ymax = (typeof globalThis._spectroYMax === 'number') ? globalThis._spectroYMax : (globalThis._spectroSampleRate ? globalThis._spectroSampleRate / 2 : 22050);

    if (Number.isFinite(duration)) {
      w.beginTime = Math.max(0, Math.min(duration, w.beginTime));
      w.endTime = Math.max(0, Math.min(duration, w.endTime));
    } else {
      w.beginTime = Math.max(0, w.beginTime);
      w.endTime = Math.max(0, w.endTime);
    }
    if (!(w.beginTime < w.endTime)) { cancelAndEndEditSession(); return; }
    w.lowFreq = Math.max(0, Math.min(ymax, w.lowFreq));
    w.highFreq = Math.max(0, Math.min(ymax, w.highFreq));
    if (!(w.lowFreq < w.highFreq)) { cancelAndEndEditSession(); return; }

    persistWorkingToAuthoritative();
    endEditSessionFinal();
    broadcastEditSelectionChanged();
  }

  function cancelAndEndEditSession() {
    if (!editSession) return;
    try {
      const original = editSession.originalSnapshot;
      if (original) {
        const updated = getAnnotations();
        const idx = updated.findIndex(x => x.id === editSession.id);
        if (idx >= 0) {
          updated[idx] = Object.assign({}, updated[idx], {
            beginTime: Number(original.beginTime),
            endTime: Number(original.endTime),
            lowFreq: Number(original.lowFreq),
            highFreq: Number(original.highFreq)
          });
          if ('label' in original) updated[idx].label = original.label;
          if ('notes' in original) updated[idx].notes = original.notes;
          if ('color' in original) updated[idx].color = original.color;
          replaceAnnotations(updated);
        }
      }
    } catch (e) { console.error('revert failed', e); }
    endEditSessionFinal();
    broadcastEditSelectionChanged();
  }

  function endEditSessionFinal() {
    if (!editSession) return;
    try { delete globalThis._annotations._editingId; } catch (e) {}
    editSession = null;
    highlightedId = null;
    hoverEnabled = true;
    try { if (pointerLayer) pointerLayer.style.cursor = ''; } catch (e) {}
    clearHighlightCanvas();
  }

  function deleteSelectedAnnotation() {
    if (!editSession) return;
    try {
      const updated = getAnnotations();
      const idx = updated.findIndex(x => x.id === editSession.id);
        if (idx >= 0) {
        updated.splice(idx, 1);
        // Reindex remaining annotations so ids and Selection are sequential
        let remaining = updated.map((a, i) => Object.assign({}, a, { id: i + 1, Selection: String(i + 1) }));
        replaceAnnotations(remaining);
        // Update Tabulator grid rows to match reindexed annotations
        if (window.annotationGrid) {
          try {
            if (typeof window.annotationGrid.replaceData === 'function') {
              window.annotationGrid.replaceData(remaining);
            } else if (typeof window.annotationGrid.deleteRow === 'function') {
              // Fallback: delete the row by old id
              window.annotationGrid.deleteRow(editSession.id);
            }
          } catch (e) {}
        }

        // Notify listeners and refresh overlays immediately so UI updates without a full page reload
        try { window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: 'delete', id: editSession.id } })); } catch (e) {}
        try { if (typeof window.renderAllAnnotations === 'function') window.renderAllAnnotations(); } catch (e) {}
      }
    } catch (e) { console.error('delete failed', e); }
    endEditSessionFinal();
    updateHover(lastPointerPos.x, lastPointerPos.y);
    broadcastEditSelectionChanged();
  }

  // Hover and hit-testing
  function updateHover(clientX, clientY) {
    if (!editModeActive) return;
    if (!hoverEnabled) return;
    lastPointerPos.x = clientX; lastPointerPos.y = clientY;

    const rect = highlightCanvas.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    if (localY < -EDGE_TOL_PX || localY > rect.height + EDGE_TOL_PX) { clearHighlightCanvas(); highlightedId = null; return; }

    const nearest = findNearestAnnotation(localX, localY);
    if (!nearest) { clearHighlightCanvas(); highlightedId = null; return; }
    if (highlightedId === nearest.id) return;
    highlightedId = nearest.id;
    drawHighlightOnlyForId(highlightedId);
  }

  // Pointer handlers for editing handles
  function onEditPointerDown(ev) {
    if (!editSession) return;
    if (ev.button !== 0) return;
    ev.preventDefault();
    const rect = highlightCanvas.getBoundingClientRect();
    const localX = ev.clientX - rect.left;
    const localY = ev.clientY - rect.top;
    const rectPx = annotationToRectPx(editSession.working);
    const hit = hitTestHandle(localX, localY, rectPx);
    if (hit) {
      editSession.activeHandle = hit;
      editSession.pointerId = ev.pointerId;
      editSession.dragging = true;
      try { pointerLayer.setPointerCapture && pointerLayer.setPointerCapture(ev.pointerId); } catch (e) {}
      drawWorkingBoxWithHandles(editSession.working);
      return;
    }

    // if user pressed inside the rect (but not on a handle) start a move/translate
    if (pointToRectEdgeDistance(localX, localY, rectPx) === 0) {
      const w = editSession.working;
      editSession.activeHandle = 'move';
      editSession.pointerId = ev.pointerId;
      editSession.dragging = true;
      // snapshot of starting values for stable translation math
      editSession.moveStart = { beginTime: w.beginTime, endTime: w.endTime, lowFreq: w.lowFreq, highFreq: w.highFreq };
      // record robust drag origin (local pixels + global X + mapped time/frequency)
      try {
        const { pxPerSec, imageHeight, ymaxHz } = getMapping();
        const secsPerPx = 1 / Math.max(1e-9, pxPerSec);
        const originY = Math.max(0, Math.min(imageHeight, localY));
        editSession.dragOrigin = { x: localX, y: originY };
        editSession.dragOriginGlobalX = (localX + Math.round(scrollArea.scrollLeft || 0));
        editSession.dragOriginTime = editSession.dragOriginGlobalX * secsPerPx;
        editSession.dragOriginFreq = Math.max(0, Math.min(ymaxHz, (1 - (originY / imageHeight)) * ymaxHz));
      } catch (e) { editSession.dragOrigin = { x: localX, y: localY }; editSession.dragOriginGlobalX = null; editSession.dragOriginTime = null; editSession.dragOriginFreq = null; }
      try { pointerLayer.setPointerCapture && pointerLayer.setPointerCapture(ev.pointerId); } catch (e) {}
        
      drawWorkingBoxWithHandles(editSession.working);
    }
  }

  function onEditPointerMove(ev) {
    if (!editSession || !editSession.activeHandle) return;
    if (editSession.pointerId != null && ev.pointerId !== editSession.pointerId) return;
    ev.preventDefault();
    const rect = highlightCanvas.getBoundingClientRect();
    const localX = ev.clientX - rect.left;
    const localY = ev.clientY - rect.top;
    const { pxPerSec, imageHeight, ymaxHz } = getMapping();
    const secsPerPx = 1 / Math.max(1e-9, pxPerSec);

    // Compute raw time at X, then clamp to [0, duration] so editing cannot push times out of file bounds
    let tAtX = (localX + Math.round(scrollArea.scrollLeft || 0)) * secsPerPx;
    const duration = getDurationSec();
    if (Number.isFinite(duration)) {
      // clamp into [0, duration]
      if (tAtX < 0) tAtX = 0;
      if (tAtX > duration) tAtX = duration;
    } else {
      if (tAtX < 0) tAtX = 0;
    }

    const freqAtY = Math.max(0, Math.min(ymaxHz, (1 - (localY / imageHeight)) * ymaxHz));
    const w = editSession.working;

    // support translating the entire box when activeHandle === 'move'
    if (editSession.activeHandle === 'move') {
      // ensure we have a moveStart snapshot
      const ms = editSession.moveStart || { beginTime: w.beginTime, endTime: w.endTime, lowFreq: w.lowFreq, highFreq: w.highFreq };
      // compute current time/freq delta from stored global X and local Y origins
      let deltaTime = 0;
      let deltaFreq = 0;
      try {
        // prefer global X origin to account for scroll changes
        if (typeof editSession.dragOriginGlobalX === 'number') {
          const currentGlobalX = (localX + Math.round(scrollArea.scrollLeft || 0));
          const dxGlobal = currentGlobalX - editSession.dragOriginGlobalX;
          deltaTime = dxGlobal * secsPerPx;
        } else if (editSession.dragOrigin && typeof editSession.dragOrigin.x === 'number') {
          const dx = localX - editSession.dragOrigin.x;
          deltaTime = dx * secsPerPx;
        }

        // vertical: prefer frequency-difference based on stored dragOriginFreq (robust across resizes)
        if (typeof editSession.dragOriginFreq === 'number') {
          deltaFreq = freqAtY - editSession.dragOriginFreq;
        } else if (editSession.dragOrigin && typeof editSession.dragOrigin.y === 'number') {
          const originYClamped = Math.max(0, Math.min(imageHeight, editSession.dragOrigin.y));
          const curYClamped = Math.max(0, Math.min(imageHeight, localY));
          deltaFreq = ((originYClamped - curYClamped) / Math.max(1, imageHeight)) * ymaxHz;
        } else {
          deltaFreq = 0;
        }
      } catch (e) { /* fallbacks already set above */ }

      // clamp time deltas to keep box inside duration bounds
      if (Number.isFinite(duration)) {
        const minDT = -ms.beginTime;
        const maxDT = duration - ms.endTime;
        deltaTime = Math.max(minDT, Math.min(maxDT, deltaTime));
      } else {
        deltaTime = Math.max(-ms.beginTime, deltaTime);
      }

      // During move allow frequencies to go outside current visible ymax to prevent
      // immediate snapping/clamping when boxes extend beyond the display range.
      w.beginTime = ms.beginTime + deltaTime;
      w.endTime = ms.endTime + deltaTime;
      w.lowFreq = ms.lowFreq + deltaFreq;
      w.highFreq = ms.highFreq + deltaFreq;

      

      drawWorkingBoxWithHandles(editSession.working);
      return;
    }

    switch (editSession.activeHandle) {
      case 'left': w.beginTime = Math.min(w.endTime - 1e-6, tAtX); break;
      case 'right': w.endTime = Math.max(w.beginTime + 1e-6, tAtX); break;
      case 'top': w.highFreq = Math.max(w.lowFreq + 1e-6, freqAtY); break;
      case 'bottom': w.lowFreq = Math.min(w.highFreq - 1e-6, freqAtY); break;
      case 'topleft': w.beginTime = Math.min(w.endTime - 1e-6, tAtX); w.highFreq = Math.max(w.lowFreq + 1e-6, freqAtY); break;
      case 'topright': w.endTime = Math.max(w.beginTime + 1e-6, tAtX); w.highFreq = Math.max(w.lowFreq + 1e-6, freqAtY); break;
      case 'bottomleft': w.beginTime = Math.min(w.endTime - 1e-6, tAtX); w.lowFreq = Math.min(w.highFreq - 1e-6, freqAtY); break;
      case 'bottomright': w.endTime = Math.max(w.beginTime + 1e-6, tAtX); w.lowFreq = Math.min(w.highFreq - 1e-6, freqAtY); break;
    }

    drawWorkingBoxWithHandles(editSession.working);
  }

  function onEditPointerUp(ev) {
    if (!editSession) return;
    if (editSession.pointerId != null && ev.pointerId !== editSession.pointerId) return;
    ev.preventDefault();
    try { pointerLayer.releasePointerCapture && pointerLayer.releasePointerCapture(ev.pointerId); } catch (e) {}

    // clear transient pointer/handle state
    const wasDragging = !!(editSession && editSession.dragging);
    if (editSession) {
      editSession.activeHandle = null;
      editSession.pointerId = null;
      editSession.dragging = false;
    }

    // persist the in-progress working snapshot
    persistWorkingToAuthoritative();
    // allow hover/selection for other boxes now that the drag finished
    hoverEnabled = true;
    drawWorkingBoxWithHandles(editSession ? editSession.working : null);
    // Broadcast selection change so UI (buttons, delete state) updates.
    broadcastEditSelectionChanged();

    // NOTE: do not end the edit session here. Keeping the editSession active
    // allows the user to continue editing the same box without needing to
    // re-select it. If the user clicks another box, handleClickSelection will
    // persist and switch sessions.
  }

  // Click selection to start edit session
  function handleClickSelection(ev) {
    if (!editModeActive) return;
    if (!highlightedId) return;
    // If an edit session exists for a different box, persist it first so edits are saved
    // before switching to a new selection.
    try {
      if (editSession && editSession.id !== highlightedId) {
        persistWorkingToAuthoritative();
      }
    } catch (e) {}
    startEditSession(highlightedId);
    ev.preventDefault && ev.preventDefault();
  }

  // Keyboard handling inside edit mode
  function handleKeyDown(ev) {
    if (!editModeActive) return;
    if (!editSession) return;
    // Leave Enter and Escape unassigned by design. Support Delete for deletion.
    const delBtnLocal = document.querySelector('button[title="Delete"]') || document.getElementById('annoDeleteBtn');
    if (delBtnLocal && !delBtnLocal.disabled && (ev.key === 'Delete' || ev.key === 'd' || ev.key === 'D')) {
      deleteSelectedAnnotation();
      ev.preventDefault();
      return;
    }
  }

  function onPointerMoveForHover(ev) {
    try { if (ev.isPrimary === false) return; } catch (e) {}
    // When an editSession exists, show appropriate cursors for handles or box translation
    if (editSession) {
      const rect = highlightCanvas.getBoundingClientRect();
      const localX = ev.clientX - rect.left;
      const localY = ev.clientY - rect.top;
      const rectPx = annotationToRectPx(editSession.working);
      const handle = hitTestHandle(localX, localY, rectPx);

      if (editSession.dragging) {
        // show grabbing while dragging
        if (editSession.activeHandle === 'move') pointerLayer.style.cursor = 'grabbing';
        else pointerLayer.style.cursor = 'move';
        return;
      }

      if (handle) {
        // map handle names to resize cursors
        const m = { left: 'ew-resize', right: 'ew-resize', top: 'ns-resize', bottom: 'ns-resize', topleft: 'nwse-resize', bottomright: 'nwse-resize', topright: 'nesw-resize', bottomleft: 'nesw-resize' };
        pointerLayer.style.cursor = m[handle] || 'default';
        return;
      }

      // If pointer is over the working rect, show grab cursor. Otherwise allow hover
      // to highlight other boxes (if hoverEnabled) so user can pick a different box
      // without having to cancel the current edit session.
      if (pointToRectEdgeDistance(localX, localY, rectPx) === 0) {
        pointerLayer.style.cursor = 'grab';
        return;
      }

      // pointer not over working rect — allow normal hover behavior when enabled
      if (hoverEnabled) {
        updateHover(ev.clientX, ev.clientY);
        // redraw working box so both highlight and working box are visible
        try { drawWorkingBoxWithHandles(editSession.working); } catch (e) {}
      } else {
        pointerLayer.style.cursor = '';
      }
      return;
    }

    // default hover highlighting behavior when not actively editing
    updateHover(ev.clientX, ev.clientY);
  }

  function onPointerLeaveForHover() {
    if (editSession) { try { if (pointerLayer) pointerLayer.style.cursor = ''; } catch (e) {} drawWorkingBoxWithHandles(editSession.working); return; }
    try { if (pointerLayer) pointerLayer.style.cursor = ''; } catch (e) {}
    clearHighlightCanvas();
    highlightedId = null;
  }

  function onScrollOrResize() {
    resizeLayers();
    if (editSession) drawWorkingBoxWithHandles(editSession.working);
    else if (highlightedId) drawHighlightOnlyForId(highlightedId);
    else clearHighlightCanvas();
  }

  /* Multi-delete logic: use Tabulator grid selection */
  function doMultiDelete() {
    try {
      if (window.annotationGrid && typeof window.annotationGrid.getSelectedRows === 'function') {
        const selectedRows = window.annotationGrid.getSelectedRows();
        if (!selectedRows.length) { window.alert('No rows selected for Multi-delete'); return; }
        if (!window.confirm(selectedRows.length === 1 ? 'Delete selected row?' : `Delete ${selectedRows.length} selected rows?`)) return;
        const ids = selectedRows.map(row => row.getData().id);
        // Remove from Tabulator grid
        window.annotationGrid.deleteRow(ids);
        // Remove from authoritative annotations
        const anns = getAnnotations();
        const idSet = new Set(ids.map(String));
        let remaining = anns.filter(a => !idSet.has(String(a.id)));
        // Reindex IDs and Selections
        remaining = remaining.map((a, idx) => ({
          ...a,
          id: idx + 1,
          Selection: String(idx + 1)
        }));
        replaceAnnotations(remaining);
        // Also update Tabulator grid rows
        if (window.annotationGrid && typeof window.annotationGrid.replaceData === 'function') {
          window.annotationGrid.replaceData(remaining);
        }
        try { window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: 'multi-delete', deleted: ids } })); } catch (e) {}
        return;
      }
    } catch (err) { console.error('multi-delete error', err); window.alert('Deletion failed; see console'); }
  }

  // set delete button enabled/disabled visuals
  function setDeleteEnabled(enabled) {
    const deleteBtnLocal = document.querySelector('button[title="Delete"]') || document.getElementById('annoDeleteBtn');
    if (!deleteBtnLocal) return;
    deleteBtnLocal.disabled = !enabled;
    try {
      deleteBtnLocal.style.opacity = enabled ? '1.0' : '0.45';
      deleteBtnLocal.style.cursor = enabled ? 'pointer' : 'default';
      deleteBtnLocal.style.border = enabled ? '1px solid rgba(255,255,255,0.06)' : '1px solid transparent';
      if (!enabled) deleteBtnLocal.style.background = 'transparent';
    } catch (e) {}
  }

  // Wire listeners when edit mode active
  function attachEditModeListeners() {
    pointerLayer.style.pointerEvents = 'auto';
    pointerLayer.addEventListener('pointermove', onPointerMoveForHover);
    pointerLayer.addEventListener('pointerleave', onPointerLeaveForHover);
    pointerLayer.addEventListener('click', handleClickSelection);

    pointerLayer.addEventListener('pointerdown', onEditPointerDown);
    pointerLayer.addEventListener('pointermove', onEditPointerMove);
    pointerLayer.addEventListener('pointerup', onEditPointerUp);
    pointerLayer.addEventListener('pointercancel', onEditPointerUp);

    pointerLayer.addEventListener('contextmenu', onPointerContextMenu);

    window.addEventListener('keydown', handleKeyDown);
    scrollArea.addEventListener('scroll', onScrollOrResize);
  window.addEventListener('resize', onScrollOrResize);
  // Ensure highlight/pointer layers resize when spectrogram is regenerated (ymax/zoom changes)
  window.addEventListener('spectrogram-generated', onScrollOrResize, { passive: true });

    // disable species control visually when editing (unless bulk selection exists)
    try {
      const spIn = document.querySelector('#speciesKwInput');
      const spLbl = document.querySelector('#speciesResult');
      const spClear = document.querySelector('#speciesClearBtn');
      const bulkSelected = (globalThis._speciesBulkEdit && typeof globalThis._speciesBulkEdit.getSelectedIds === 'function')
        ? (globalThis._speciesBulkEdit.getSelectedIds() || []).length > 0
        : false;
      if (!bulkSelected) {
        if (spIn) { spIn.disabled = true; spIn.setAttribute('aria-disabled', 'true'); }
        if (spLbl) { spLbl.setAttribute('aria-disabled', 'true'); spLbl.style.opacity = '0.6'; }
        if (spClear) { spClear.style.display = 'none'; }
      }
    } catch (e) {}
  }

  function detachEditModeListeners() {
    pointerLayer.style.pointerEvents = 'none';
    pointerLayer.removeEventListener('pointermove', onPointerMoveForHover);
    pointerLayer.removeEventListener('pointerleave', onPointerLeaveForHover);
    pointerLayer.removeEventListener('click', handleClickSelection);

    pointerLayer.removeEventListener('pointerdown', onEditPointerDown);
    pointerLayer.removeEventListener('pointermove', onEditPointerMove);
    pointerLayer.removeEventListener('pointerup', onEditPointerUp);
    pointerLayer.removeEventListener('pointercancel', onEditPointerUp);

    pointerLayer.removeEventListener('contextmenu', onPointerContextMenu);

    window.removeEventListener('keydown', handleKeyDown);
    scrollArea.removeEventListener('scroll', onScrollOrResize);
  window.removeEventListener('resize', onScrollOrResize);
  try { window.removeEventListener('spectrogram-generated', onScrollOrResize); } catch (e) {}

    // restore species control state
    try {
      const spIn = document.querySelector('#speciesKwInput');
      const spLbl = document.querySelector('#speciesResult');
      const spClear = document.querySelector('#speciesClearBtn');
      if (spIn) { spIn.disabled = false; spIn.removeAttribute('aria-disabled'); }
      if (spLbl) { spLbl.removeAttribute('aria-disabled'); spLbl.style.opacity = ''; }
      if (spClear) {
        if (spLbl && (spLbl.textContent || '').trim()) spClear.style.display = 'inline-flex';
        else spClear.style.display = 'none';
      }
    } catch (e) {}
  }

  function onPointerContextMenu(ev) {
    // Do not use right-click in edit mode. Leave the native context menu alone
    // and do not cancel or otherwise change the edit session. This prevents
    // accidental cancellation via contextmenu while editing.
    return;
  }

  // Delete toolbar button: do not toggle mode. If editSession exists delete it; otherwise show message and keep mode.
  if (deleteBtn) {
    deleteBtn.addEventListener('click', (ev) => {
      ev.preventDefault && ev.preventDefault();
      // Prefer central API handler if present
      try {
        if (globalThis._editAnnotations && typeof globalThis._editAnnotations.deleteEditing === 'function') {
          globalThis._editAnnotations.deleteEditing();
          return;
        }
      } catch (e) { console.error('Delegation to _editAnnotations.deleteEditing failed', e); }

      // if local editSession present, delete it
      if (editSession) {
        deleteSelectedAnnotation();
        broadcastEditSelectionChanged();
        return;
      }

      // No edit selection — keep current mode and inform user
      try { window.alert('No annotation selected to delete. Select a box first or switch to edit mode.'); } catch (e) {}
    }, false);
  }

  // Multi-delete toolbar button
  if (multiDeleteBtn) {
    multiDeleteBtn.addEventListener('click', (ev) => {
      ev.preventDefault && ev.preventDefault();
      doMultiDelete();
    }, false);
  }

  // Keep legacy button visuals in pages without toggle; otherwise synchronize with toggle.
  function setActiveVisual(button, active) {
    try { if (button) button.style.background = active ? 'rgba(255,255,255,0.02)' : 'transparent'; } catch (e) {}
  }

  function readModeFromToggle() {
    try { if (toggleWrap && toggleWrap.dataset) return toggleWrap.dataset.mode; } catch (e) {}
    return null;
  }

  function startEditMode() {
    if (editModeActive) return;
    editModeActive = true;
    hoverEnabled = true;
    highlightedId = null;
    editSession = null;
    attachEditModeListeners();
    resizeLayers();
    clearHighlightCanvas();
    // sync visual to toggle if present
    try {
      if (toggleWrap) {
        toggleWrap.dataset.mode = 'edit';
        const bEdit = toggleWrap.querySelector('[data-mode="edit"]');
        const bCreate = toggleWrap.querySelector('[data-mode="create"]');
        if (bEdit) bEdit.setAttribute('aria-pressed', 'true');
        if (bCreate) bCreate.setAttribute('aria-pressed', 'false');
      } else {
        setActiveVisual(editBtn, true);
        setActiveVisual(createBtn, false);
      }
    } catch (e) {}
  }

  function stopEditMode() {
    if (!editModeActive) return;
    editModeActive = false;
    hoverEnabled = false;
    highlightedId = null;
    if (editSession) {
      try {
        commitEditSessionAndEnd();
      } catch (e) {
        cancelAndEndEditSession();
      }
    }
    detachEditModeListeners();
    clearHighlightCanvas();
    // sync visual to toggle if present
    try {
      if (toggleWrap) {
        toggleWrap.dataset.mode = 'create';
        const bEdit = toggleWrap.querySelector('[data-mode="edit"]');
        const bCreate = toggleWrap.querySelector('[data-mode="create"]');
        if (bEdit) bEdit.setAttribute('aria-pressed', 'false');
        if (bCreate) bCreate.setAttribute('aria-pressed', 'true');
      } else {
        setActiveVisual(editBtn, false);
      }
    } catch (e) {}
  }

  // Respond to authoritative toggle changes if present, else wire legacy buttons
  function setupAuthoritativeToggleSync() {
    if (!toggleWrap) {
      if (createBtn) createBtn.addEventListener('click', () => { setActiveVisual(editBtn, false); stopEditMode(); });
      if (editBtn) editBtn.addEventListener('click', () => { if (!editModeActive) startEditMode(); else stopEditMode(); });
      return;
    }

    toggleWrap.addEventListener('mode-change', (ev) => {
      const m = (ev && ev.detail && ev.detail.mode) ? ev.detail.mode : readModeFromToggle();
      if (m === 'edit') startEditMode();
      else stopEditMode();
    }, { passive: true });

    const initial = readModeFromToggle();
    if (initial === 'edit') startEditMode();
    else stopEditMode();
  }

  // --- start: ensure Delete button enabled only in edit mode ---
  (function syncDeleteButtonWithMode_edit() {
    const deleteBtnLocal = document.getElementById('annoDeleteBtn') || document.querySelector('button[title="Delete"]');

    function applyMode(m) {
      try {
        const isEdit = (m === 'edit');
        if (typeof setDeleteEnabled === 'function') {
          setDeleteEnabled(isEdit);
        } else if (deleteBtnLocal) {
          deleteBtnLocal.disabled = !isEdit;
          deleteBtnLocal.style.opacity = isEdit ? '1.0' : '0.45';
          deleteBtnLocal.style.cursor = isEdit ? 'pointer' : 'default';
        }
        try { window.dispatchEvent(new CustomEvent('annotation-mode-changed', { detail: { mode: (isEdit ? 'edit' : 'create') } })); } catch(e) {}
      } catch (e) {}
    }

    try { applyMode((function () { try { return (toggleWrap && toggleWrap.dataset && toggleWrap.dataset.mode) ? toggleWrap.dataset.mode : null; } catch (e) { return null; } })() || (globalThis._editAnnotations && typeof globalThis._editAnnotations.isEditMode === 'function' && globalThis._editAnnotations.isEditMode() ? 'edit' : 'create')); } catch (e) {}

    if (toggleWrap) {
      toggleWrap.addEventListener('mode-change', (ev) => {
        const m = (ev && ev.detail && ev.detail.mode) ? ev.detail.mode : (toggleWrap.dataset && toggleWrap.dataset.mode) ? toggleWrap.dataset.mode : null;
        applyMode(m || 'create');
      }, { passive: true });
    } else {
      window.addEventListener('edit-selection-changed', () => {
        try {
          const isEdit = (globalThis._editAnnotations && typeof globalThis._editAnnotations.isEditMode === 'function' && globalThis._editAnnotations.isEditMode());
          applyMode(isEdit ? 'edit' : 'create');
        } catch (e) {}
      });
    }
  })();
  // --- end

  // init
  resizeLayers();
  setupAuthoritativeToggleSync();
  setTimeout(() => { resizeLayers(); clearHighlightCanvas(); }, 120);

  // Hook Tabulator grid events so deletions/edits made via the grid UI
  // also cause the edit session to end if the edited annotation is removed.
  function tryHookGridEventsOnce_Edit() {
    try {
      const g = window.annotationGrid;
      if (!g || typeof g.on !== 'function') return;
      if (g.__editOverlayHooked) return;
      const handleGridChange = () => {
        try {
          if (!editSession) return;
          const anns = getAnnotations() || [];
          const still = anns.find(a => String(a.id) === String(editSession.id));
          if (!still) {
            endEditSessionFinal();
            try { if (typeof window.renderAllAnnotations === 'function') window.renderAllAnnotations(); } catch (e) {}
          } else {
            // If the annotation still exists, redraw highlight to reflect any cell edits
            try { drawWorkingBoxWithHandles(editSession.working); } catch (e) {}
          }
        } catch (e) { console.error('grid change handler failed', e); }
      };
      // Cover wide range of Tabulator events
      try { g.on('dataChanged', handleGridChange); } catch (e) {}
      try { g.on('dataLoaded', handleGridChange); } catch (e) {}
      try { g.on('rowDeleted', handleGridChange); } catch (e) {}
      try { g.on('rowDeleted', handleGridChange); } catch (e) {}
      try { g.on('rowSelectionChanged', handleGridChange); } catch (e) {}
      try { g.on('cellEdited', handleGridChange); } catch (e) {}
      try { g.on('rowUpdated', handleGridChange); } catch (e) {}
      g.__editOverlayHooked = true;
    } catch (e) {}
  }
  tryHookGridEventsOnce_Edit();

  // If annotations change externally (grid deletes / replace / upload), ensure any
  // active edit session is closed if its annotation was removed. This prevents
  // a deleted-but-still-selected box from lingering on the canvas.
  try {
    window.addEventListener('annotations-changed', (ev) => {
      try {
        if (!editSession) return;
        const anns = getAnnotations() || [];
        const still = anns.find(a => String(a.id) === String(editSession.id));
        if (!still) {
          // end without trying to persist (annotation was removed elsewhere)
          endEditSessionFinal();
          try { if (typeof window.renderAllAnnotations === 'function') window.renderAllAnnotations(); } catch (e) {}
        }
      } catch (e) {}
    }, { passive: true });
  } catch (e) {}

  // Public API
  globalThis._editAnnotations = globalThis._editAnnotations || {};
  globalThis._editAnnotations.isEditMode = () => !!editModeActive;
  globalThis._editAnnotations.getEditingId = () => (editSession ? editSession.id : null);
  globalThis._editAnnotations.cancelEdit = () => {
    if (editSession) {
      try {
        commitEditSessionAndEnd();
      } catch (e) {
        cancelAndEndEditSession();
      }
    }
  };
  globalThis._editAnnotations.commitEdit = () => { if (editSession) commitEditSessionAndEnd(); };
  globalThis._editAnnotations.deleteEditing = () => { if (editSession) deleteSelectedAnnotation(); };

  // Broadcast helper
  function broadcastEditSelectionChanged() {
    try {
      const detail = { isEditMode: !!editModeActive, editingId: (editSession ? editSession.id : null) };
      window.dispatchEvent(new CustomEvent('edit-selection-changed', { detail }));
    } catch (e) {}
  }

  // --- Selection sync helper ---
  function ensureGridSelectionAndOverlay(id){
    if (!id) return;
    // Draw selection overlay immediately even if grid selection lags
    try { if (typeof window.renderSelectionOverlay === 'function') window.renderSelectionOverlay([id]); } catch(e){}
    const grid = window.annotationGrid;
    if (!grid) { console.debug('[edit-sync] grid not ready yet for id', id); return; }

    let attempts = 0; const MAX_ATTEMPTS = 10; const DELAY_MS = 100;
    function attempt(){
      attempts++;
      let selectedOk = false;
      try {
        // Deselect previous selection explicitly
        if (typeof grid.getSelectedRows === 'function') {
          (grid.getSelectedRows()||[]).forEach(r=>{ try { r.deselect && r.deselect(); } catch(e){} });
        }
        // Try select via getRow(id)
        if (typeof grid.getRow === 'function') {
          let rc = grid.getRow(id);
          if (!rc) rc = grid.getRow(String(id));
          if (rc && typeof rc.select === 'function') { rc.select(); selectedOk = true; }
        }
        // Fallback: selectRow API
        if (!selectedOk && typeof grid.selectRow === 'function') {
          grid.selectRow([id, String(id)]);
          selectedOk = (grid.getSelectedRows && grid.getSelectedRows().length > 0) || (grid.getSelectedData && (grid.getSelectedData()||[]).length>0);
        }
        // Visual fallback: add a CSS marker class to the matching row element if selection APIs failed
        if (!selectedOk && typeof grid.getRow === 'function') {
          let rc = grid.getRow(id) || grid.getRow(String(id));
          if (rc && rc.getElement) {
            const el = rc.getElement();
            try { el.classList.add('row-active-edit'); } catch(e){}
          }
        }
      } catch(e) { /* swallow */ }

      // Ensure overlay redraw reflects final selection state
      try { if (typeof window.renderSelectionOverlay === 'function') window.renderSelectionOverlay([id]); } catch(e){}
      if (!selectedOk && attempts < MAX_ATTEMPTS) setTimeout(attempt, DELAY_MS);
      else console.debug('[edit-sync] selection sync attempts:', attempts, 'success:', selectedOk, 'id:', id);
    }
    attempt();
  }

  // Inject minimal CSS once for visual fallback highlight
  (function injectFallbackCss(){
    try {
      if (document.getElementById('edit-sync-style')) return;
      const css = '.tabulator-row.row-active-edit { box-shadow: inset 0 0 0 2px rgba(255,235,59,0.9); background: rgba(255,255,0,0.10) !important; }';
      const st = document.createElement('style'); st.id='edit-sync-style'; st.appendChild(document.createTextNode(css)); document.head.appendChild(st);
    } catch(e){}
  })();


})();
