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

  const TRASH_ICON_SIZE = 22;

  function getTrashIconRect(rectPx) {
    const w = Math.abs(rectPx.right - rectPx.left);
    const h = Math.abs(rectPx.bottom - rectPx.top);

    const right = Math.max(rectPx.left, rectPx.right);
    const bottom = Math.max(rectPx.top, rectPx.bottom);
    
    let x, y;
    if (w < TRASH_ICON_SIZE + 12 || h < TRASH_ICON_SIZE + 12) {
      // Box is too small: draw it just outside the bottom-right corner
      x = right + 4;
      y = bottom + 4;
    } else {
      // Box is large enough: draw it inside the bottom-right corner
      x = right - TRASH_ICON_SIZE - 6;
      y = bottom - TRASH_ICON_SIZE - 6;
    }

    return { x, y, w: TRASH_ICON_SIZE, h: TRASH_ICON_SIZE };
  }

  function drawTrashIcon(ctx, rectPx, isArmed = false) {
    const tr = getTrashIconRect(rectPx);
    if (!tr) return;
    ctx.save();
    
    // If armed (clicked once), show it in red to indicate confirmation step
    ctx.fillStyle = isArmed ? 'rgba(220, 53, 69, 0.9)' : '#ffffff';
    ctx.strokeStyle = isArmed ? '#ffffff' : '#000000';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(tr.x, tr.y, tr.w, tr.h, 2);
    else ctx.rect(tr.x, tr.y, tr.w, tr.h);
    ctx.fill();
    ctx.stroke();

    // Simple vector trash can icon (much lighter than text/emoji)
    ctx.strokeStyle = isArmed ? '#ffffff' : '#000000';
    ctx.beginPath();
    ctx.moveTo(tr.x + 6, tr.y + 8); ctx.lineTo(tr.x + 7, tr.y + 17); // left body
    ctx.lineTo(tr.x + 15, tr.y + 17); ctx.lineTo(tr.x + 16, tr.y + 8); // right body
    ctx.moveTo(tr.x + 4, tr.y + 8); ctx.lineTo(tr.x + 18, tr.y + 8); // lid line
    ctx.moveTo(tr.x + 9, tr.y + 8); ctx.lineTo(tr.x + 9, tr.y + 5); // handle left
    ctx.lineTo(tr.x + 13, tr.y + 5); ctx.lineTo(tr.x + 13, tr.y + 8); // handle right
    ctx.moveTo(tr.x + 9, tr.y + 10); ctx.lineTo(tr.x + 9, tr.y + 15); // inner line left
    ctx.moveTo(tr.x + 13, tr.y + 10); ctx.lineTo(tr.x + 13, tr.y + 15); // inner line right
    ctx.stroke();
    
    ctx.restore();
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
    drawTrashIcon(hCtx, rect, lastTrashClickId === working.id);
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

  let lastTrashClickTime = 0;
  let lastTrashClickId = null;

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
    broadcastEditSelectionChanged();

      // --- NEW: Sync playback to box beginTime ---
      try {
        if (globalThis._playbackScrollJump && typeof globalThis._playbackScrollJump.setPosition === 'function') {
          globalThis._playbackScrollJump.setPosition(authoritative.beginTime);
        }
      } catch(e) {}

    // --- NEW: Immediate grid selection + selection overlay sync (robust) ---
    try { ensureGridSelectionAndOverlay(authoritative.id); } catch(e) { console.warn('ensureGridSelectionAndOverlay failed', e); }
  }

  function persistWorkingToAuthoritative() {
    if (!editSession) return;
    try {
      const w = editSession.working;
      const round4 = v => Number(v).toFixed(4);
      const updateObj = {
        beginTime: Number(round4(w.beginTime)),
        endTime: Number(round4(w.endTime)),
        lowFreq: Number(round4(w.lowFreq)),
        highFreq: Number(round4(w.highFreq))
      };

      if (window.annotationGrid && typeof window.annotationGrid.updateRow === 'function') {
        window.annotationGrid.updateRow(editSession.id, updateObj);
        // Proactively notify and trigger overlay refresh for immediate visual update
        try { window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: 'edit-commit', id: editSession.id } })); } catch (e) {}
      } else {
        const updated = getAnnotations();
        const idx = updated.findIndex(x => x.id === editSession.id);
        if (idx >= 0) {
          updated[idx] = Object.assign({}, updated[idx], updateObj);
          replaceAnnotations(updated);
        }
      }
    } catch (e) { console.error('persist failed', e); }
  }

  function commitEditSessionAndEnd() {
    if (!editSession) return;
    const w = editSession.working;
    const duration = getDurationSec();
    const nyq = globalThis._spectroOriginalNyquist || (globalThis._spectroSampleRate ? globalThis._spectroSampleRate / 2 : 22050);

    if (Number.isFinite(duration)) {
      w.beginTime = Math.max(0, Math.min(duration, w.beginTime));
      w.endTime = Math.max(0, Math.min(duration, w.endTime));
    } else {
      w.beginTime = Math.max(0, w.beginTime);
      w.endTime = Math.max(0, w.endTime);
    }
    if (!(w.beginTime < w.endTime)) { cancelAndEndEditSession(); return; }
    w.lowFreq = Math.max(0, Math.min(nyq, w.lowFreq));
    w.highFreq = Math.max(0, Math.min(nyq, w.highFreq));
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
        const updateObj = {
          beginTime: Number(original.beginTime),
          endTime: Number(original.endTime),
          lowFreq: Number(original.lowFreq),
          highFreq: Number(original.highFreq)
        };
        if ('label' in original) updateObj.label = original.label;
        if ('notes' in original) updateObj.notes = original.notes;
        if ('color' in original) updateObj.color = original.color;

        if (window.annotationGrid && typeof window.annotationGrid.updateRow === 'function') {
          window.annotationGrid.updateRow(editSession.id, updateObj);
          try { window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: 'edit-revert', id: editSession.id } })); } catch (e) {}
        } else {
          const updated = getAnnotations();
          const idx = updated.findIndex(x => x.id === editSession.id);
          if (idx >= 0) {
            updated[idx] = Object.assign({}, updated[idx], updateObj);
            replaceAnnotations(updated);
          }
        }
      }
    } catch (e) { console.error('revert failed', e); }
    endEditSessionFinal();
    broadcastEditSelectionChanged();
  }

  function endEditSessionFinal() {
    if (!editSession) return;
    try { delete globalThis._annotations._editingId; } catch (e) {}
    
    if (editSession.pointerId != null) {
      try { pointerLayer.releasePointerCapture && pointerLayer.releasePointerCapture(editSession.pointerId); } catch(e){}
    }

    editSession = null;
    highlightedId = null;
    hoverEnabled = true;
    try { if (pointerLayer) pointerLayer.style.cursor = ''; } catch (e) {}
    clearHighlightCanvas();
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
    if (!editModeActive) return;
    if (ev.button !== 0) return;

    const rect = highlightCanvas.getBoundingClientRect();
    const localX = ev.clientX - rect.left;
    const localY = ev.clientY - rect.top;
    const isMulti = ev.ctrlKey || ev.metaKey;

    // --- Trash Icon Hit Test ---
    let trashHitId = null;
    if (editSession) {
      const rectPx = annotationToRectPx(editSession.working);
      const tr = getTrashIconRect(rectPx);
      if (tr && localX >= tr.x && localX <= tr.x + tr.w && localY >= tr.y && localY <= tr.y + tr.h) {
        trashHitId = editSession.id;
      }
    }

    if (trashHitId != null) {
      ev.preventDefault();
      ev.stopPropagation();
      
      const now = Date.now();
      if (lastTrashClickId === trashHitId && (now - lastTrashClickTime) < 500) {
        // Double-click confirmed: Delete it!
        doMultiDelete([trashHitId]);
        lastTrashClickId = null;
        lastTrashClickTime = 0;
      } else {
        // First click: Arm it (turns red)
        lastTrashClickId = trashHitId;
        lastTrashClickTime = now;
        
        if (editSession && editSession.id === trashHitId) drawWorkingBoxWithHandles(editSession.working);
        
        // Auto-disarm after 500ms if no second click happens
        setTimeout(() => {
          if (lastTrashClickId === trashHitId && (Date.now() - lastTrashClickTime) >= 490) {
            lastTrashClickId = null;
            if (editSession && editSession.id === trashHitId) drawWorkingBoxWithHandles(editSession.working);
          }
        }, 500);
      }
      return;
    } else {
      // Clicked elsewhere (e.g. grabbed the resize handle), disarm trash instantly
      if (lastTrashClickId != null) {
        const oldArmedId = lastTrashClickId;
        lastTrashClickId = null;
        if (editSession && editSession.id === oldArmedId) drawWorkingBoxWithHandles(editSession.working);
      }
    }

    // 1. If we have an active edit session, check if we are interacting with IT (resizing/moving)
    if (editSession && !isMulti) {
      const rectPx = annotationToRectPx(editSession.working);
      const hit = hitTestHandle(localX, localY, rectPx);

      if (hit) {
        ev.preventDefault();
        editSession.activeHandle = hit;
        editSession.pointerId = ev.pointerId;
        editSession.dragging = true;
        try { pointerLayer.setPointerCapture && pointerLayer.setPointerCapture(ev.pointerId); } catch (e) {}
        drawWorkingBoxWithHandles(editSession.working);
        return;
      }

      // Check if we are over a DIFFERENT box (nested box)
      let isOverBetterTarget = false;
      const nearestHover = findNearestAnnotation(localX, localY);
      if (nearestHover && nearestHover.id !== editSession.id) {
          isOverBetterTarget = true;
      }

      // Only allow move if we are not hovering over a DIFFERENT box
      if (!isOverBetterTarget) {
        if (pointToRectEdgeDistance(localX, localY, rectPx) === 0) {
          ev.preventDefault();
          const w = editSession.working;
          editSession.activeHandle = 'move';
          editSession.pointerId = ev.pointerId;
          editSession.dragging = true;
          editSession.moveStart = { beginTime: w.beginTime, endTime: w.endTime, lowFreq: w.lowFreq, highFreq: w.highFreq };
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
          return;
        }
      }
    }

    // 2. If we reach here, we are clicking to select a new box, empty space, or toggle multi-select.
    // Instantly calculate exact target under the mouse, completely immune to hover lag.
    const nearest = (localY >= -EDGE_TOL_PX && localY <= rect.height + EDGE_TOL_PX) ? findNearestAnnotation(localX, localY) : null;
    const targetId = nearest ? nearest.id : null;

    // Empty space click
    if (!targetId) {
      if (isMulti) return; // Ctrl+click empty space does nothing
      if (editSession) {
        commitEditSessionAndEnd();
      }
      window.__syncingGridSelection = (window.__syncingGridSelection || 0) + 1;
      try { 
        const grid = window.annotationGrid; 
        if (grid) {
          if (typeof grid.deselectRow === 'function') grid.deselectRow(); 
          if (typeof grid.getSelectedRows === 'function') {
             (grid.getSelectedRows() || []).forEach(r => { try { r.deselect && r.deselect(); } catch(e){} });
          }
        }
      } catch(e){} finally { window.__syncingGridSelection--; }
      syncToolbarButtons();
      updateHover(ev.clientX, ev.clientY);
      return;
    }

    // Multi-select mode (Ctrl / Cmd held down)
    if (isMulti) {
      let prevId = editSession ? editSession.id : null;
      
      if (editSession) {
        persistWorkingToAuthoritative();
        endEditSessionFinal();
      }

      window.__syncingGridSelection = (window.__syncingGridSelection || 0) + 1;
      try {
        const grid = window.annotationGrid;
        if (grid) {
          const selData = typeof grid.getSelectedData === 'function' ? grid.getSelectedData() : [];
          let currentSelIds = new Set(selData.map(x => String(x.id)));

          // CRITICAL FIX: If we were actively editing a box, it MUST be in the multi-select pool.
          // Tabulator frequently drops it from getSelectedData() when virtualization recycles the row.
          if (prevId != null) {
            currentSelIds.add(String(prevId));
          }

          const strTarget = String(targetId);
          
          if (currentSelIds.has(strTarget)) {
            currentSelIds.delete(strTarget);
          } else {
            currentSelIds.add(strTarget);
          }

          // Force Tabulator to perfectly match our computed set
          if (typeof grid.deselectRow === 'function') grid.deselectRow();
          if (typeof grid.getSelectedRows === 'function') {
             (grid.getSelectedRows() || []).forEach(r => { try { r.deselect && r.deselect(); } catch(e){} });
          }
          
          const finalIds = Array.from(currentSelIds);
          if (typeof grid.selectRow === 'function' && finalIds.length > 0) {
             grid.selectRow(finalIds);
          }

          // Evaluate outcome based on our strictly managed Set
          if (currentSelIds.size === 1) {
            startEditSession(finalIds[0]);
          } else {
            endEditSessionFinal(); // Ensure handles stay hidden
            try { if (typeof window.renderSelectionOverlay === 'function') window.renderSelectionOverlay(finalIds); } catch(e){}
          }
        }
      } catch(e) {
        console.error('Exception in Multi-Select:', e);
      } finally {
        window.__syncingGridSelection--;
      }
      syncToolbarButtons();

      ev.preventDefault && ev.preventDefault();
      return;
    }

    // Standard single selection (No Ctrl key)
    window.__syncingGridSelection = (window.__syncingGridSelection || 0) + 1;
    try {
      try { 
        const grid = window.annotationGrid; 
        if (grid) {
          if (typeof grid.deselectRow === 'function') grid.deselectRow(); 
          if (typeof grid.getSelectedRows === 'function') {
             (grid.getSelectedRows() || []).forEach(r => { try { r.deselect && r.deselect(); } catch(e){} });
          }
        }
      } catch(e){}

      try {
        if (editSession && editSession.id !== targetId) {
          persistWorkingToAuthoritative();
        }
      } catch (e) {}
      startEditSession(targetId);
    } finally {
      window.__syncingGridSelection--;
    }
    syncToolbarButtons();
    ev.preventDefault && ev.preventDefault();
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

    const nyq = globalThis._spectroOriginalNyquist || (globalThis._spectroSampleRate ? globalThis._spectroSampleRate / 2 : 22050);
    const freqAtY = Math.max(0, Math.min(nyq, (1 - (localY / imageHeight)) * ymaxHz));
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

      // Clamp freq deltas to keep box inside freq bounds (0 to Nyquist)
      const minDF = -ms.lowFreq;
      const maxDF = nyq - ms.highFreq;
      deltaFreq = Math.max(minDF, Math.min(maxDF, deltaFreq));

      w.beginTime = ms.beginTime + deltaTime;
      w.endTime = ms.endTime + deltaTime;
      w.lowFreq = ms.lowFreq + deltaFreq;
      w.highFreq = ms.highFreq + deltaFreq;

      drawWorkingBoxWithHandles(editSession.working);
      return;
    }

    // Use a near-zero delta so the box can collapse visually to a line, 
    // relying on dynamic handle swapping to escape the collapsed state.
    const minTimeDelta = 1e-6;
    const minFreqDelta = 1e-6;

    // Dynamic Handle Swapping: If the user drags a handle past the opposite edge, 
    // swap the active handle so the box smoothly inverts instead of getting stuck.
    let ah = editSession.activeHandle;
    
    if (ah.includes('top') && freqAtY < w.lowFreq) {
      ah = ah.replace('top', 'bottom');
      w.highFreq = w.lowFreq; // Anchor old bottom as the new top
    } else if (ah.includes('bottom') && freqAtY > w.highFreq) {
      ah = ah.replace('bottom', 'top');
      w.lowFreq = w.highFreq; // Anchor old top as the new bottom
    }

    if (ah.includes('left') && tAtX > w.endTime) {
      ah = ah.replace('left', 'right');
      w.beginTime = w.endTime; // Anchor old right as the new left
    } else if (ah.includes('right') && tAtX < w.beginTime) {
      ah = ah.replace('right', 'left');
      w.endTime = w.beginTime; // Anchor old left as the new right
    }
    editSession.activeHandle = ah;

    switch (editSession.activeHandle) {
      case 'left': w.beginTime = Math.min(w.endTime - minTimeDelta, tAtX); break;
      case 'right': w.endTime = Math.max(w.beginTime + minTimeDelta, tAtX); break;
      case 'top': w.highFreq = Math.max(w.lowFreq + minFreqDelta, freqAtY); break;
      case 'bottom': w.lowFreq = Math.min(w.highFreq - minFreqDelta, freqAtY); break;
      case 'topleft': w.beginTime = Math.min(w.endTime - minTimeDelta, tAtX); w.highFreq = Math.max(w.lowFreq + minFreqDelta, freqAtY); break;
      case 'topright': w.endTime = Math.max(w.beginTime + minTimeDelta, tAtX); w.highFreq = Math.max(w.lowFreq + minFreqDelta, freqAtY); break;
      case 'bottomleft': w.beginTime = Math.min(w.endTime - minTimeDelta, tAtX); w.lowFreq = Math.min(w.highFreq - minFreqDelta, freqAtY); break;
      case 'bottomright': w.endTime = Math.max(w.beginTime + minTimeDelta, tAtX); w.lowFreq = Math.min(w.highFreq - minFreqDelta, freqAtY); break;
    }

    w.lowFreq = Math.max(0, Math.min(nyq, w.lowFreq));
    w.highFreq = Math.max(0, Math.min(nyq, w.highFreq));

    drawWorkingBoxWithHandles(editSession.working);
  }

  function onEditPointerUp(ev) {
    if (!editSession) return;
    if (editSession.pointerId != null && ev.pointerId !== editSession.pointerId) return;
    
    const wasDragging = !!(editSession && editSession.dragging);
    if (wasDragging) {
      ev.preventDefault();
    }

    try { pointerLayer.releasePointerCapture && pointerLayer.releasePointerCapture(ev.pointerId); } catch (e) {}

    // clear transient pointer/handle state
    if (editSession) {
      editSession.activeHandle = null;
      editSession.pointerId = null;
    }

    // persist the in-progress working snapshot ONLY if we were actively dragging
    if (wasDragging) {
      window.__syncingGridSelection = (window.__syncingGridSelection || 0) + 1;
      try {
        persistWorkingToAuthoritative();
        if (editSession) {
          ensureGridSelectionAndOverlay(editSession.id);
        }
      } finally {
        window.__syncingGridSelection--;
      }
      broadcastEditSelectionChanged();
    }

    if (editSession) {
      editSession.dragging = false;
    }

    // allow hover/selection for other boxes now that the interaction finished
    hoverEnabled = true;
    drawWorkingBoxWithHandles(editSession ? editSession.working : null);

    // NOTE: do not end the edit session here. Keeping the editSession active
    // allows the user to continue editing the same box without needing to
    // re-select it. If the user clicks another box, handleClickSelection will
    // persist and switch sessions.
  }

  // Keyboard handling inside edit mode
  function handleKeyDown(ev) {
    // Ignore keydown if focus is inside an input, textarea, select, or any dialog.
    if (document.activeElement) {
      const tag = (document.activeElement.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement.isContentEditable) return;
      if (document.activeElement.closest && document.activeElement.closest('[role="dialog"]')) return;
    }

    let multiCount = 0;
    try { const grid = window.annotationGrid; if (grid && grid.initialized && typeof grid.getSelectedData === 'function') multiCount = grid.getSelectedData().length; } catch(e){}

    if (!editSession && multiCount === 0) return;
    
    // Escape instantly clears all active selections
    if (ev.key === 'Escape') {
      if (editSession) {
        commitEditSessionAndEnd();
        updateHover(lastPointerPos.x, lastPointerPos.y);
      }
      window.__syncingGridSelection = (window.__syncingGridSelection || 0) + 1;
      try { 
        const grid = window.annotationGrid; 
        if (grid) {
          if (typeof grid.deselectRow === 'function') grid.deselectRow(); 
          if (typeof grid.getSelectedRows === 'function') {
             (grid.getSelectedRows() || []).forEach(r => { try { r.deselect && r.deselect(); } catch(e){} });
          }
        }
      } catch(e){} finally { window.__syncingGridSelection--; }
      syncToolbarButtons();
      ev.preventDefault();
      return;
    }

    const delBtnLocal = document.getElementById('multiDeleteBtn') || document.querySelector('button[title="Delete"]');
    if (delBtnLocal && !delBtnLocal.disabled && (ev.key === 'Delete' || ev.key === 'd' || ev.key === 'D')) {
      doMultiDelete();
      ev.preventDefault();
      return;
    }

    if (!editModeActive) return;

    // In multi-select mode, playback jumping and Tab navigation are intentionally suppressed
    if (multiCount > 1 && ev.key === 'Tab') {
      ev.preventDefault();
      return;
    }

    // Tab / Shift+Tab Navigation
    if (ev.key === 'Tab') {
      ev.preventDefault(); // Prevent browser focus from leaving the canvas
      const anns = getAnnotations();
      if (!anns || anns.length === 0) return;

      // Sort boxes by beginTime, then by Selection number
      const sortedAnns = anns.slice().sort((a, b) => {
        const tDiff = (Number(a.beginTime) || 0) - (Number(b.beginTime) || 0);
        if (tDiff !== 0) return tDiff;
        const selA = Number(a.Selection) || Number(a.id) || 0;
        const selB = Number(b.Selection) || Number(b.id) || 0;
        return selA - selB;
      });

      const currentIndex = sortedAnns.findIndex(a => a.id === editSession.id);
      if (currentIndex < 0) return;

      let targetIndex = -1;
      if (ev.shiftKey) {
        if (currentIndex > 0) targetIndex = currentIndex - 1; // Previous
      } else {
        if (currentIndex < sortedAnns.length - 1) targetIndex = currentIndex + 1; // Next
      }

      if (targetIndex >= 0 && targetIndex < sortedAnns.length) {
        const targetAnn = sortedAnns[targetIndex];
        persistWorkingToAuthoritative();
        window.__syncingGridSelection = (window.__syncingGridSelection || 0) + 1;
        try { startEditSession(targetAnn.id); } finally { window.__syncingGridSelection--; }
        syncToolbarButtons();

        // Auto-scroll to keep the selected box in view if it is off-screen
        try {
          const { pxPerSec } = getMapping();
          const boxLeft = targetAnn.beginTime * pxPerSec;
          const boxRight = targetAnn.endTime * pxPerSec;
          const viewLeft = scrollArea.scrollLeft;
          const viewRight = viewLeft + scrollArea.clientWidth;
          
          if (boxLeft < viewLeft || boxRight > viewRight) {
            // Center the box in the viewport
            scrollArea.scrollLeft = Math.max(0, boxLeft - (scrollArea.clientWidth / 2) + ((boxRight - boxLeft) / 2));
          }
        } catch(e) {}
      }
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
              if (hoverEnabled) {
                highlightedId = editSession.id;
                drawWorkingBoxWithHandles(editSession.working);
              }
        return;
      }

            let nearest = null;
            if (localY >= -EDGE_TOL_PX && localY <= rect.height + EDGE_TOL_PX) {
                nearest = findNearestAnnotation(localX, localY);
            }

            // If we are over a better target (e.g. a smaller nested box), let it highlight so we can click it
            if (nearest && nearest.id !== editSession.id) {
                pointerLayer.style.cursor = '';
                if (hoverEnabled) {
                    if (highlightedId !== nearest.id) {
                        highlightedId = nearest.id;
                        drawWorkingBoxWithHandles(editSession.working);
                    }
                }
                return;
            }

            // Otherwise, if we are inside the active box body, show grab cursor
            if (pointToRectEdgeDistance(localX, localY, rectPx) === 0) {
                pointerLayer.style.cursor = 'grab';
                if (hoverEnabled && highlightedId !== editSession.id) {
                    highlightedId = editSession.id;
                    drawWorkingBoxWithHandles(editSession.working);
                }
                return;
            }

            // Pointer not over working rect and no other box found
            pointerLayer.style.cursor = '';
            if (hoverEnabled) {
                if (highlightedId !== null) {
                    highlightedId = null;
                    drawWorkingBoxWithHandles(editSession.working);
                }
            }
            return;
    }

    // default hover highlighting behavior when not actively editing
    updateHover(ev.clientX, ev.clientY);

    if (!editSession) {
        pointerLayer.style.cursor = '';
    }
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

  /* Multi-delete logic: use Tabulator grid selection (restored original working logic) */
  function doMultiDelete(forceIds) {
    try {
      let ids = Array.isArray(forceIds) ? forceIds : [];
      if (!ids.length && window.annotationGrid && typeof window.annotationGrid.getSelectedRows === 'function' && window.annotationGrid.initialized !== false) {
        const selectedRows = window.annotationGrid.getSelectedRows();
        ids = selectedRows.map(row => row.getData().id);
      }
        
      // Fallback for canvas edit mode if grid is out of sync
      if (ids.length === 0 && editSession) {
        ids = [editSession.id];
      }

      if (!ids.length) { window.alert('No annotations selected to delete.'); return; }

        const overlayCtl = (function(){
          let active = false;
          return {
            show(opts) {
              try {
                if (window.__spectroWait && typeof window.__spectroWait.show === 'function') {
                  const etaText = (opts && opts.etaText) || 'Deleting rows…';
                  const titleText = (opts && opts.titleText) || 'Deleting rows';
                  const bodyText = (opts && opts.bodyText) || 'Removing selected annotations. Please wait…';
                  window.__spectroWait.show({ etaText, titleText, bodyText });
                  active = true;
                }
              } catch (e) {}
            },
            updateEta(text) {
              try {
                if (active && window.__spectroWait && typeof window.__spectroWait.show === 'function') {
                  window.__spectroWait.show({ etaText: text, titleText: 'Deleting rows', bodyText: 'Removing selected annotations. Please wait…' });
                }
              } catch (e) {}
            },
            hide() {
              if (!active) return;
              try {
                if (window.__spectroWait && typeof window.__spectroWait.hide === 'function') {
                  window.__spectroWait.hide();
                }
              } catch (e) {}
              active = false;
            }
          };
        })();

        const totalRows = ids.length;
        if (totalRows > 1) overlayCtl.show({ etaText: `Deleting ${totalRows} rows…`, titleText: 'Deleting rows', bodyText: 'Removing selected annotations. Please wait…' });

        const deleteInChunks = async () => {
          try {
            const chunkSize = 200;
            for (let i = 0; i < ids.length; i += chunkSize) {
              const chunk = ids.slice(i, i + chunkSize);
              window.annotationGrid.deleteRow(chunk);
              if (totalRows > 1) overlayCtl.updateEta(`Deleting rows ${Math.min(ids.length, i + chunkSize)} / ${ids.length}…`);
              await new Promise(r => setTimeout(r, 0));
            }

            const anns = getAnnotations();
            const idSet = new Set(ids.map(String));
            let remaining = anns.filter(a => !idSet.has(String(a.id)));

            const reindexed = new Array(remaining.length);
            for (let i = 0; i < remaining.length; i++) {
              const item = remaining[i];
              reindexed[i] = {
                ...item,
                id: i + 1,
                Selection: String(i + 1)
              };
              if (totalRows > 1 && (i % 500) === 0) await new Promise(r => setTimeout(r, 0));
            }
            replaceAnnotations(reindexed);
            if (window.annotationGrid && typeof window.annotationGrid.replaceData === 'function') {
              await window.annotationGrid.replaceData(reindexed);
            }
            try { window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: 'multi-delete', deleted: ids } })); } catch (e) {}
            
            // Clear any active edit session if it was deleted
            if (editSession && idSet.has(String(editSession.id))) {
              endEditSessionFinal();
            }
            // Always refresh hover to clear any highlighted boxes that were just deleted
            updateHover(lastPointerPos.x, lastPointerPos.y);
          } catch (err) {
            console.error('multi-delete error', err);
            window.alert('Deletion failed; see console');
          } finally {
            if (totalRows > 1) overlayCtl.hide();
          }
        };

        // Start deletion on a short timer so the overlay can paint immediately
        setTimeout(deleteInChunks, 20);
        return;
    } catch (err) {
      console.error('multi-delete error', err);
      window.alert('Deletion failed; see console');
    }
  }

  // Wire listeners when edit mode active
  function attachEditModeListeners() {
    pointerLayer.style.pointerEvents = 'auto';
    pointerLayer.addEventListener('pointermove', onPointerMoveForHover);
    pointerLayer.addEventListener('pointerleave', onPointerLeaveForHover);

    pointerLayer.addEventListener('pointerdown', onEditPointerDown);
    pointerLayer.addEventListener('pointermove', onEditPointerMove);
    pointerLayer.addEventListener('pointerup', onEditPointerUp);
    pointerLayer.addEventListener('pointercancel', onEditPointerUp);

    pointerLayer.addEventListener('contextmenu', onPointerContextMenu);

    scrollArea.addEventListener('scroll', onScrollOrResize);
  window.addEventListener('resize', onScrollOrResize);
  // Ensure highlight/pointer layers resize when spectrogram is regenerated (ymax/zoom changes)
  window.addEventListener('spectrogram-generated', onScrollOrResize, { passive: true });
  }

  function detachEditModeListeners() {
    pointerLayer.style.pointerEvents = 'none';
    pointerLayer.removeEventListener('pointermove', onPointerMoveForHover);
    pointerLayer.removeEventListener('pointerleave', onPointerLeaveForHover);

    pointerLayer.removeEventListener('pointerdown', onEditPointerDown);
    pointerLayer.removeEventListener('pointermove', onEditPointerMove);
    pointerLayer.removeEventListener('pointerup', onEditPointerUp);
    pointerLayer.removeEventListener('pointercancel', onEditPointerUp);

    pointerLayer.removeEventListener('contextmenu', onPointerContextMenu);

    scrollArea.removeEventListener('scroll', onScrollOrResize);
  window.removeEventListener('resize', onScrollOrResize);
  try { window.removeEventListener('spectrogram-generated', onScrollOrResize); } catch (e) {}
  }

  function onPointerContextMenu(ev) {
    if (!editModeActive) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (editSession) {
      commitEditSessionAndEnd();
      updateHover(lastPointerPos.x, lastPointerPos.y);
    }
    const toggleWrapLocal = document.getElementById('createEditToggle');
    if (toggleWrapLocal) {
      toggleWrapLocal.dispatchEvent(new CustomEvent('mode-change', { detail: { mode: 'create' }, bubbles: true }));
    } else {
      const createBtnLocal = document.getElementById('toggleCreate') || document.querySelector('button[title="Create"]') || document.querySelector('#annoCreateBtn');
      if (createBtnLocal) createBtnLocal.click();
    }
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
    window.__syncingGridSelection = (window.__syncingGridSelection || 0) + 1;
    try { 
      const grid = window.annotationGrid; 
      if (grid) {
        if (typeof grid.deselectRow === 'function') grid.deselectRow(); 
        if (typeof grid.getSelectedRows === 'function') {
           (grid.getSelectedRows() || []).forEach(r => { try { r.deselect && r.deselect(); } catch(e){} });
        }
      }
    } catch(e){} finally { window.__syncingGridSelection--; }
    syncToolbarButtons();
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

  // Multi-delete toolbar button
  if (multiDeleteBtn) {
    multiDeleteBtn.addEventListener('click', (ev) => {
      ev.preventDefault && ev.preventDefault();
      doMultiDelete();
    }, false);
  }

  // COMMON LISTENER: Centralized toolbar state manager for all annotation tools
  function syncToolbarButtons() {
    let count = 0;
    try { if (window.annotationGrid && window.annotationGrid.initialized && typeof window.annotationGrid.getSelectedData === 'function') count = window.annotationGrid.getSelectedData().length; } catch(e){}

    // IMPORTANT: Guarantee that an active canvas edit session counts as at least 1 selection,
    // bypassing any async delays or virtual DOM mismatch from Tabulator
    if (editSession && count <= 1) {
      count = 1;
    }

    const canAction = (count > 0);
    const canScc = (count === 1);

    function setBtnState(id, enabled) {
      const btn = document.getElementById(id) || document.querySelector(`button[title="${id}"]`);
      if (!btn) return;
      btn.disabled = !enabled;
      try {
        btn.style.opacity = enabled ? '1.0' : '0.45';
        btn.style.cursor = enabled ? 'pointer' : 'default';
        btn.style.border = enabled ? '1px solid rgba(255,255,255,0.06)' : '1px solid transparent';
        if (!enabled) btn.style.background = 'transparent';
      } catch(e){}
    }

    setBtnState('multiDeleteBtn', canAction);
    setBtnState('Delete', canAction);
    setBtnState('updateTagsBtn', canAction);
    setBtnState('bulkUpdateSpeciesBtn', canAction);
    setBtnState('runSccBtn', canScc);
  }

  window.addEventListener('mode-change', () => setTimeout(syncToolbarButtons, 0));
  window.addEventListener('edit-selection-changed', () => setTimeout(syncToolbarButtons, 0));
  window.addEventListener('annotations-changed', () => setTimeout(syncToolbarButtons, 0));
  window.addEventListener('keydown', handleKeyDown);

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
      try { g.on('dataChanged', handleGridChange); } catch (e) {}
      try { g.on('dataLoaded', handleGridChange); } catch (e) {}
      try { g.on('rowDeleted', handleGridChange); } catch (e) {}
      try { g.on('cellEdited', handleGridChange); } catch (e) {}
      try { g.on('rowUpdated', handleGridChange); } catch (e) {}

      // Tie Tabulator Selection natively to the Canvas Edit state & update common buttons
      try {
        g.on('rowSelectionChanged', function(data, rows) {
          if (window.__syncingGridSelection > 0) return;
          if (data.length === 1) {
            if (editModeActive && (!editSession || String(editSession.id) !== String(data[0].id))) {
              if (!editSession || !editSession.dragging) startEditSession(data[0].id);
            }
          } else {
            if (editSession && !editSession.dragging) {
              endEditSessionFinal();
              updateHover(lastPointerPos.x, lastPointerPos.y);
            }
          }
          syncToolbarButtons();
        });
      } catch(e){}

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
  globalThis._editAnnotations.deleteEditing = () => { if (editSession) doMultiDelete(); };

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
    try { if (typeof window.renderSelectionOverlay === 'function') window.renderSelectionOverlay([id]); } catch(e){}

    const grid = window.annotationGrid;
    if (!grid) { console.debug('[edit-sync] grid not ready yet for id', id); return; }

    // Helper to attempt selection once
    const trySelect = (tryId) => {
      try {
        // clear existing selection first
        if (typeof grid.deselectRow === 'function') grid.deselectRow();
        if (typeof grid.getSelectedRows === 'function') {
          (grid.getSelectedRows() || []).forEach(r => { try { r.deselect && r.deselect(); } catch(e){} });
        }

        // Prefer getting a row object (materialized), else fall back to selectRow
        let rc = null;
        if (typeof grid.getRow === 'function') {
          rc = grid.getRow(tryId) || grid.getRow(String(tryId)) || (isNaN(tryId) ? null : grid.getRow(Number(tryId)));
        }

        if (rc && typeof rc.select === 'function') {
          // ensure row is visible (Tabulator will materialize it)
          try { if (typeof grid.scrollToRow === 'function') grid.scrollToRow(rc); } catch(e){}
          rc.select();
          return true;
        }

        // Tabulator accepts arrays for selectRow reliably; try array form
        if (typeof grid.selectRow === 'function') {
          try {
            grid.selectRow([tryId]);
            return true;
          } catch (e) {
            try { grid.selectRow(String(tryId)); return true; } catch(e2) {}
            try { if (!isNaN(tryId)) { grid.selectRow(Number(tryId)); return true; } } catch(e3) {}
          }
        }
      } catch (e) { /* swallow and return false */ }
      return false;
    };

    // Try immediate selection, then retry a couple times with small delays if needed
    let attempts = 0;
    const maxAttempts = 5;
    const attemptSelectWithRetry = () => {
      attempts++;
      window.__syncingGridSelection = (window.__syncingGridSelection || 0) + 1;
      try {
        const ok = trySelect(id);
        if (!ok && attempts < maxAttempts) {
          // If row not materialized, try scrolling to approximate row index if possible
          try {
            if (typeof grid.getRow === 'function') {
              const rc = grid.getRow(id) || grid.getRow(String(id));
              if (!rc && typeof grid.scrollToRow === 'function') {
                // best-effort: try scrollToRow with id (some Tabulator builds accept it)
                try { grid.scrollToRow(id); } catch(e){}
              }
            }
          } catch(e){}
          setTimeout(attemptSelectWithRetry, 80 * attempts); // increasing backoff
        }
      } finally {
        window.__syncingGridSelection--;
      }
    };

    attemptSelectWithRetry();
    try { if (typeof window.renderSelectionOverlay === 'function') window.renderSelectionOverlay([id]); } catch(e){}
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