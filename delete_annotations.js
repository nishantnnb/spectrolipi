// delete_annotations.js
// Robust bulk-delete controller that integrates with edit_annotations.js.
// - Wires the existing Delete toolbar button and exposes a deleteNow API.
// - Honors table row bulk selection (input.ann-bulk-check) and edit-session deletion (edit_annotations sets _annotations._editingId).
// - Normalizes id types when matching and tries multiple persistence APIs (import, setAll, replace, _store).
// - Listens for edit-selection-changed so edit_annotations toggles state correctly.

(function () {
  if (!window || !document) return;

  const DELETE_SELECTOR = 'button[title="Delete"]';
  const CHECKBOX_SELECTOR = 'input.ann-bulk-check';
  const HEADER_CHECKBOX_ID = 'ann-bulk-check-all';
  const BUTTON_OBS_POLL_MS = 80;
  const MAX_TRIES = 40;

  // internal state
  let selectedIds = new Set();
  let desiredEnabled = false;

  // --- utilities
  function getDeleteBtn() { return document.querySelector(DELETE_SELECTOR); }

  function getAnnotations() {
    try {
      if (globalThis._annotations && typeof globalThis._annotations.getAll === 'function') {
        return globalThis._annotations.getAll() || [];
      }
    } catch (e) { console.warn('getAnnotations error', e); }
    return [];
  }

  function tryPersistAnnotations(arr) {
    try {
      if (globalThis._annotations && typeof globalThis._annotations.import === 'function') {
        globalThis._annotations.import(Array.isArray(arr) ? arr.slice() : []);
        return true;
      }
    } catch (e) { console.warn('persist import failed', e); }
    try {
      if (globalThis._annotations && typeof globalThis._annotations.setAll === 'function') {
        globalThis._annotations.setAll(Array.isArray(arr) ? arr.slice() : []);
        return true;
      }
    } catch (e) { console.warn('persist setAll failed', e); }
    try {
      if (globalThis._annotations && typeof globalThis._annotations.replace === 'function') {
        globalThis._annotations.replace(Array.isArray(arr) ? arr.slice() : []);
        return true;
      }
    } catch (e) { console.warn('persist replace failed', e); }
    try {
      if (globalThis._annotations) {
        globalThis._annotations._store = Array.isArray(arr) ? arr.slice() : [];
        return true;
      }
    } catch (e) { console.warn('persist _store assign failed', e); }
    console.error('delete_annotations: no persistence method succeeded');
    return false;
  }

  // --- DOM helpers
  function collectCheckedRowIds() {
    const ids = [];
    try {
      document.querySelectorAll(CHECKBOX_SELECTOR + ':checked').forEach(cb => {
        try {
          if (cb.dataset && cb.dataset.aid) ids.push(String(cb.dataset.aid));
          else {
            const tr = cb.closest && cb.closest('tr[data-aid]');
            if (tr) ids.push(String(tr.getAttribute('data-aid')));
          }
        } catch (e) {}
      });
    } catch (e) {}
    return ids;
  }

  function syncSelectionFromDom() {
    selectedIds.clear();
    const ids = collectCheckedRowIds();
    ids.forEach(id => selectedIds.add(String(id)));
  }

  function applyDeleteVisualState(enable) {
    const del = getDeleteBtn();
    if (!del) return;
    try {
      del.disabled = !enable;
      del.style.opacity = enable ? '1.0' : '0.45';
      del.style.cursor = enable ? 'pointer' : 'default';
      del.style.border = enable ? '1px solid rgba(255,255,255,0.06)' : '1px solid transparent';
    } catch (e) {}
  }

  function computeShouldEnable() {
    syncSelectionFromDom();
    const anyChecked = selectedIds.size > 0;

    const editActive = (globalThis._editAnnotations && typeof globalThis._editAnnotations.isEditMode === 'function')
      ? !!globalThis._editAnnotations.isEditMode() : false;
    const editingId = (globalThis._editAnnotations && typeof globalThis._editAnnotations.getEditingId === 'function')
      ? globalThis._editAnnotations.getEditingId() : null;
    const editSelected = editActive && (editingId !== null && editingId !== undefined && String(editingId) !== '');

    return anyChecked || editSelected;
  }

  function updateState() {
    try {
      const should = computeShouldEnable();
      desiredEnabled = !!should;
      applyDeleteVisualState(desiredEnabled);
    } catch (e) { console.warn('updateState', e); }
  }

  // --- deletion logic (bulk rows OR edit-session)
  function performDelete(idsToDelete) {
    if (!idsToDelete || !idsToDelete.length) return false;
    try {
      const anns = getAnnotations();
      const idSet = new Set(idsToDelete.map(x => String(x)));
      const remaining = anns.filter(a => !idSet.has(String(a.id)));
      const persisted = tryPersistAnnotations(remaining);
      if (!persisted) return false;

      // clear checkboxes UI
      try {
        document.querySelectorAll(CHECKBOX_SELECTOR).forEach(cb => { try { cb.checked = false; } catch (e) {} });
        const master = document.getElementById(HEADER_CHECKBOX_ID);
        if (master) { master.checked = false; master.indeterminate = false; }
      } catch (e) {}
      // notify listeners
      try { window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: 'delete_annotations' } })); } catch (e) {}
      return true;
    } catch (e) {
      console.error('performDelete error', e);
      return false;
    }
  }

  function performDeleteAction() {
    // refresh selection
    syncSelectionFromDom();
    const bulk = Array.from(selectedIds || []);
    const editActive = (globalThis._editAnnotations && typeof globalThis._editAnnotations.isEditMode === 'function')
      ? !!globalThis._editAnnotations.isEditMode() : false;
    const editingId = (globalThis._editAnnotations && typeof globalThis._editAnnotations.getEditingId === 'function')
      ? globalThis._editAnnotations.getEditingId() : null;

    let ids = [];
    if (bulk.length > 0) ids = bulk.slice();
    else if (editActive && editingId) ids = [String(editingId)];
    else {
      console.info('delete_annotations: no selection to delete');
      return;
    }

    const prompt = ids.length === 1 ? 'Delete the selected annotation?' : `Delete ${ids.length} selected annotations?`;
    if (!window.confirm(prompt)) return;

    // try centralized API first if it accepts ids (best-effort)
    try {
      if (globalThis._deleteAnnotations && typeof globalThis._deleteAnnotations.deleteNow === 'function') {
        // call central delete; it may act on DOM/selection
        globalThis._deleteAnnotations.deleteNow();
        // still attempt fallback persistence if nothing changed after a short delay
        setTimeout(() => {
          try {
            const annsAfter = getAnnotations();
            const still = ids.filter(id => annsAfter.some(a => String(a.id) === String(id)));
            if (still.length) performDelete(ids);
          } catch (e) {}
        }, 60);
        return;
      }
    } catch (e) { console.warn('central delete call failed', e); }

    // fallback direct perform
    performDelete(ids);
    // update visuals
    setTimeout(updateState, 50);
  }

  // --- attach click to Delete button (idempotent)
  function attachDeleteClick() {
    const del = getDeleteBtn();
    if (!del) return;
    if (del.__delete_annotations_attached) return;
    del.__delete_annotations_attached = true;
    del.addEventListener('click', (ev) => {
      try { ev && ev.preventDefault && ev.preventDefault(); } catch (e) {}
      performDeleteAction();
    }, false);
  }

  // --- auto-enable based on checkbox changes (delegation) and edit-selection-changed
  function attachDelegationAndObservers() {
    // delegate change events at document level for robustness
    document.addEventListener('change', (ev) => {
      try {
        const t = ev.target;
        if (t && t.matches && t.matches(CHECKBOX_SELECTOR)) {
          setTimeout(updateState, 0);
        }
      } catch (e) {}
    }, true);

    // also listen for clicks in case row clicking toggles selection by other handlers
    document.addEventListener('click', () => setTimeout(updateState, 0), true);

    // listen to edit-selection-changed from edit_annotations.js so edit mode updates Delete state
    try {
      window.addEventListener('edit-selection-changed', () => setTimeout(updateState, 0), { passive: true });
    } catch (e) {}
  }

  // --- initialize with retries (toolbar may be created later)
  function init() {
    attachDelegationAndObservers();
    attachDeleteClick();
    updateState();

    let tries = 0;
    const t = setInterval(() => {
      tries++;
      attachDeleteClick();
      updateState();
      if (tries > MAX_TRIES) clearInterval(t);
    }, BUTTON_OBS_POLL_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else setTimeout(init, 0);

  // --- public API
  globalThis._deleteAnnotations = globalThis._deleteAnnotations || {};
  globalThis._deleteAnnotations.getSelectedIds = () => Array.from(selectedIds);
  globalThis._deleteAnnotations.deleteNow = () => performDeleteAction();
  globalThis._deleteAnnotations.setEnabled = (b) => { desiredEnabled = !!b; applyDeleteVisualState(!!b); };

})();