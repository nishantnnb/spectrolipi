// species_bulkedit.js
// Bulk-edit behavior for the shared species label with Tabulator grid selection.
// - Uses Tabulator's row selection (header checkbox already present in grid) — no DOM table checkboxes.
// - When one or more rows are selected, temporarily enables the shared species input/label for bulk apply.
// - On acceptance (Enter while species input focused OR "species-select" event), prompts confirm and updates
//   the selected rows' species field directly in Tabulator via updateData.
// - Respects edit mode: edit_annotations disables species control, but bulk selection re-enables it for this action.

(function () {
  if (!window || !document) return;

  // Config
  const SPECIES_LABEL_SELECTOR = '#speciesResult';
  const SPECIES_INPUT_SELECTOR = '#speciesKwInput';
  const SPECIES_INPUT_BUTTON_CLEAR = '#speciesClearBtn';

  // Own-species persistence keys
  const OWN_SPECIES_DB = 'spectrogram-app';
  const OWN_SPECIES_STORE = 'kv';
  const OWN_SPECIES_KEY = 'own-species-list';
  const OWN_SPECIES_META = 'own-species-meta';
  const OWN_SPECIES_TOGGLE = 'useOwnSpecies'; // stored in localStorage as '1' or '0'

  // Bounded wait used when Enter pressed to allow upstream autocompletes to finalize selection
  const LABEL_WAIT_TIMEOUT_MS = 200; // maximum time to wait for label update
  const LABEL_WAIT_POLL_MS = 20;     // poll interval

  // State (from Tabulator selection)
  const selectedIds = new Set(); // stringified ids
  let gridWired = false;

  // Helpers to access authoritative annotations
  function getAnnotations() {
    if (globalThis._annotations && typeof globalThis._annotations.getAll === 'function') {
      try { return globalThis._annotations.getAll() || []; } catch (e) { return []; }
    }
    return [];
  }
  function replaceAnnotations(arr) {
    if (globalThis._annotations && typeof globalThis._annotations.import === 'function') {
      try { globalThis._annotations.import(Array.isArray(arr) ? arr.slice() : []); } catch (e) { console.error('bulk: replaceAnnotations failed', e); }
    }
  }

  // Tabulator helpers
  function getGrid() { try { return window.annotationGrid || null; } catch (e) { return null; } }
  function getSelectedRowIdsFromGrid() {
    const grid = getGrid();
    if (!grid || typeof grid.getSelectedData !== 'function') return [];
    try { return (grid.getSelectedData() || []).map(r => r && r.id).filter(v => v !== undefined && v !== null); } catch (e) { return []; }
  }
  function onGridSelectionChanged() {
    const ids = getSelectedRowIdsFromGrid();
    selectedIds.clear();
    ids.forEach(id => selectedIds.add(String(id)));
    onSelectionChanged();
  }

  // DOM refs (look up fresh when needed)
  function findSpeciesLabelEl() { return document.querySelector(SPECIES_LABEL_SELECTOR); }
  function findSpeciesInputEl() { return document.querySelector(SPECIES_INPUT_SELECTOR); }
  function findSpeciesClearBtn() { return document.querySelector(SPECIES_INPUT_BUTTON_CLEAR); }

  // ---------------------------
  // Own-species helpers (IndexedDB + parsing + UI wiring)
  // ---------------------------
  function openSimpleIDB() {
    return new Promise((resolve, reject) => {
      try {
        const r = indexedDB.open(OWN_SPECIES_DB, 1);
        r.onupgradeneeded = e => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(OWN_SPECIES_STORE)) db.createObjectStore(OWN_SPECIES_STORE);
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = (ev) => reject(r.error || ev);
      } catch (err) { reject(err); }
    });
  }

  async function idbGet(key) {
    try {
      const db = await openSimpleIDB();
      return await new Promise((res, rej) => {
        try {
          const tx = db.transaction(OWN_SPECIES_STORE, 'readonly');
          const req = tx.objectStore(OWN_SPECIES_STORE).get(key);
          req.onsuccess = () => { res(req.result); db.close(); };
          req.onerror = () => { rej(req.error); db.close(); };
        } catch (e) { rej(e); db.close(); }
      });
    } catch (e) { return null; }
  }

  async function idbPut(key, value) {
    const db = await openSimpleIDB();
    return await new Promise((res, rej) => {
      try {
        const tx = db.transaction(OWN_SPECIES_STORE, 'readwrite');
        tx.objectStore(OWN_SPECIES_STORE).put(value, key);
        tx.oncomplete = () => { db.close(); res(true); };
        tx.onerror = (ev) => { db.close(); rej(tx.error || ev); };
      } catch (e) { try { db.close(); } catch(_){} rej(e); }
    });
  }

  async function idbDelete(key) {
    try {
      const db = await openSimpleIDB();
      return await new Promise((res, rej) => {
        try {
          const tx = db.transaction(OWN_SPECIES_STORE, 'readwrite');
          const req = tx.objectStore(OWN_SPECIES_STORE).delete(key);
          req.onsuccess = () => { db.close(); res(true); };
          req.onerror = () => { db.close(); rej(req.error); };
        } catch (e) { try { db.close(); } catch(_){} rej(e); }
      });
    } catch (e) { return false; }
  }

  // Very small CSV parser tolerant to simple CSVs (handles quoted values and commas)
  function parseCsv(text) {
    if (!text) return [];
    const lines = text.split(/\r?\n/).filter(l => String(l).trim() !== '');
    if (lines.length === 0) return [];
    // split header
    const header = [];
    // simple state machine to split CSV respecting quotes
    function splitLine(line) {
      const out = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { if (inQuotes && line[i+1] === '"') { cur += '"'; i++; } else { inQuotes = !inQuotes; } continue; }
        if (ch === ',' && !inQuotes) { out.push(cur); cur = ''; continue; }
        cur += ch;
      }
      out.push(cur);
      return out.map(s => s.trim());
    }
    const rawHeader = splitLine(lines[0]);
    for (let h of rawHeader) header.push(h || 'col' + header.length);
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = splitLine(lines[i]);
      if (parts.length === 0) continue;
      const obj = {};
      for (let j = 0; j < header.length; j++) {
        obj[header[j]] = parts[j] !== undefined ? parts[j] : '';
      }
      rows.push(obj);
    }
    return rows;
  }

  async function saveParsedSpecies(parsed, meta) {
    try {
      await idbPut(OWN_SPECIES_KEY, parsed);
      if (meta) localStorage.setItem(OWN_SPECIES_META, JSON.stringify(meta));
      return true;
    } catch (e) { console.warn('saveParsedSpecies failed', e); return false; }
  }

  async function loadParsedSpecies() {
    try {
      const parsed = await idbGet(OWN_SPECIES_KEY);
      return parsed || null;
    } catch (e) { return null; }
  }

  function updateOwnStatus(text) {
    try { const el = document.getElementById('ownSpeciesStatus'); if (el) el.textContent = text; } catch (e) {}
  }

  async function setUseOwnSpecies(on) {
    try {
      localStorage.setItem(OWN_SPECIES_TOGGLE, on ? '1' : '0');
      // update runtime species array
      if (on) {
        const parsed = await loadParsedSpecies();
        if (Array.isArray(parsed) && parsed.length) {
          // Flexible normalization: map column headers ignoring case/whitespace
          function pickField(obj, candidates) {
            if (!obj) return '';
            const keys = Object.keys(obj || {});
            const map = {};
            keys.forEach(k => { map[k.toString().toLowerCase().replace(/[^a-z0-9]/g, '')] = k; });
            for (const c of candidates) {
              const ck = c.toLowerCase().replace(/[^a-z0-9]/g, '');
              if (map[ck]) return (obj[map[ck]] || '').toString();
            }
            // fallback: try direct properties
            for (const c of candidates) if (obj[c] !== undefined) return String(obj[c]);
            return '';
          }

          const keyCandidates = ['key','id','species_key','specieskey','code','taxon','taxonid','identifier'];
          const commonCandidates = ['common','commonname','name','common_name','vernacular'];
          const sciCandidates = ['scientific','scientificname','scientific_name','sci','binomial'];

          const norm = parsed.map(r => {
            const key = (pickField(r, keyCandidates) || '').trim();
            const common = (pickField(r, commonCandidates) || '').trim();
            const scientific = (pickField(r, sciCandidates) || '').trim();
            return { key: key, common: common, scientific: scientific };
          }).filter(x => (x.key || x.common || x.scientific));

          window.__speciesRecords = norm;
          try { console.debug && console.debug('[species] setUseOwnSpecies: loaded parsed rows', parsed.length, 'normalized', norm.length, norm.slice(0,3)); } catch (e) {}
          // Try to refresh any species controls immediately in addition to dispatching the event
          try { if (typeof window.wireSpeciesControl === 'function') window.wireSpeciesControl(window.__speciesRecords || []); } catch (e) { console.warn('refresh species control failed', e); }
          // show standardized status without filename
          updateOwnStatus('Using Own species list');
        } else {
          // nothing to use; fall back
          window.__speciesRecords = window.__speciesRecords || [];
          updateOwnStatus('Using default species list');
        }
      } else {
        // revert to default species-data.js (assume it populated window.__speciesRecords)
        try { const defaultRecs = window.__speciesRecordsFromDefault || window.__speciesRecords || []; window.__speciesRecords = defaultRecs; } catch (e) {}
        try { console.debug && console.debug('[species] setUseOwnSpecies: reverted to default, count=', (Array.isArray(window.__speciesRecords) ? window.__speciesRecords.length : 0)); } catch (e) {}
        try { if (typeof window.wireSpeciesControl === 'function') window.wireSpeciesControl(window.__speciesRecords || []); } catch (e) { console.warn('refresh species control failed', e); }
  updateOwnStatus('Using default species list');
      }
      window.dispatchEvent(new CustomEvent('species-source-changed', { detail: { useOwn: !!on } }));
    } catch (e) { console.warn('setUseOwnSpecies failed', e); }
  }

  async function wireOwnSpeciesControls() {
    try {
  const fileEl = document.getElementById('ownSpeciesFile');
  const fileNameLabel = document.getElementById('ownSpeciesFileName');
      const toggle = document.getElementById('useOwnSpeciesToggle');
      const reimport = document.getElementById('ownSpeciesReimport');
      const clearBtn = document.getElementById('ownSpeciesClear');
  const downloadDefaultBtn = document.getElementById('downloadDefaultSpeciesBtn');

      // preserve a copy of original default species records
      try { window.__speciesRecordsFromDefault = Array.isArray(window.__speciesRecords) ? window.__speciesRecords.slice() : (window.__speciesRecordsFromDefault || []); } catch (e) {}

      // initialize status & toggle
  const meta = JSON.parse(localStorage.getItem(OWN_SPECIES_META) || '{}');
      const parsed = await loadParsedSpecies();
      const sessionHasFile = fileEl && fileEl.files && fileEl.files.length > 0;
  try { console.debug('[species][init] parsed exists:', !!(parsed && parsed.length), 'rows=', parsed ? parsed.length : 0, 'sessionHasFile=', !!sessionHasFile); } catch(e){}

      // If a parsed list exists from a previous session, allow the user to clear it,
      // but do NOT enable the "Use Own species" toggle unless a file is selected in
      // the current session. This prevents accidentally re-using previously uploaded
      // lists when the user didn't select a file in this session.
      if (parsed && parsed.length) {
        // previous upload exists
        if (sessionHasFile) {
          updateOwnStatus(`Uploaded species list loaded (${parsed.length} rows)`);
          if (toggle) toggle.disabled = false;
          try { console.debug('[species][init] toggle enabled (session file selected)'); } catch(e){}
        } else {
          // parsed present but no file chosen in this session: do not enable toggle
          updateOwnStatus('Previously uploaded species list available');
          if (toggle) toggle.disabled = true;
          try { console.debug('[species][init] toggle disabled (no session file)'); } catch(e){}
        }
        // Show a persistent filename label: prefer the session file name if present,
        // otherwise use any saved meta name for clarity. Do not clear the label when
        // we intentionally reset the input.value on click so users can still see the
        // last uploaded filename while allowing re-select to trigger `change`.
        try {
          if (sessionHasFile && fileEl && fileEl.files && fileEl.files.length > 0) {
            if (fileNameLabel) fileNameLabel.textContent = fileEl.files[0].name || '';
            if (fileEl) fileEl.title = fileEl.files[0].name || '';
          } else if (meta && meta.name) {
            if (fileNameLabel) fileNameLabel.textContent = meta.name || '';
          } else {
            if (fileNameLabel) fileNameLabel.textContent = '';
            if (fileEl) fileEl.title = '';
          }
        } catch (e) { if (fileNameLabel) fileNameLabel.textContent = ''; }
        if (reimport) reimport.disabled = false;
        if (clearBtn) clearBtn.disabled = false;
      } else {
        // no parsed list present
        updateOwnStatus('Using default species list');
        if (toggle) toggle.disabled = true;
        if (clearBtn) clearBtn.disabled = true;
        try { console.debug('[species][init] no parsed list; toggle disabled; default in use'); } catch(e){}
      }

      // Always default to toggle OFF on load (do not auto-enable persisted preference).
      try { localStorage.setItem(OWN_SPECIES_TOGGLE, '0'); } catch (e) {}
      if (toggle) { toggle.checked = false; }

      if (!fileEl) return;

      // Wire download default species CSV button if present
      try {
        if (downloadDefaultBtn) {
          downloadDefaultBtn.addEventListener('click', function (ev) {
            ev.preventDefault(); ev.stopPropagation();
            try {
              const defaultRecs = Array.isArray(window.__speciesRecordsFromDefault) && window.__speciesRecordsFromDefault.length ? window.__speciesRecordsFromDefault : (Array.isArray(window.__speciesRecords) ? window.__speciesRecords : []);
              if (!defaultRecs || !defaultRecs.length) {
                try { alert('Default species list not available.'); } catch (e) {}
                return;
              }
              // Build CSV with header key,common,scientific
              function quote(v) { if (v === null || v === undefined) return ''; const s = String(v); if (s.includes(',') || s.includes('\"') || s.includes('\n') || s.includes('\r')) return '"' + s.replace(/"/g, '""') + '"'; return s; }
              const header = ['key','common','scientific'];
              const lines = [header.join(',')];
              for (const r of defaultRecs) {
                const k = r && r.key ? r.key : '';
                const c = r && r.common ? r.common : '';
                const s = r && r.scientific ? r.scientific : '';
                lines.push([quote(k), quote(c), quote(s)].join(','));
              }
              const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'default_species_list.csv';
              document.body.appendChild(a);
              a.click();
              setTimeout(() => { try { a.remove(); URL.revokeObjectURL(url); } catch (e) {} }, 200);
            } catch (err) { console.warn('download default species failed', err); try { alert('Failed to create download.'); } catch (e) {} }
          }, true);
        }
      } catch (e) { console.warn('wire downloadDefaultSpeciesBtn failed', e); }

        // Ensure that re-selecting the same file triggers a change event by
        // clearing the input's value just before the picker opens. Some browsers
        // will not fire `change` if the same file is chosen twice unless the
        // input value was cleared first. Keep the visible filename label intact
        // so UI does not lose the filename when we clear input.value programmatically.
      try {
        fileEl.addEventListener('click', () => { try { fileEl.value = ''; } catch (e) {} });
        fileEl.addEventListener('keydown', () => { try { fileEl.value = ''; } catch (e) {} });
      } catch (e) {}

      fileEl.addEventListener('change', async (ev) => {
        const f = (ev.target && ev.target.files && ev.target.files[0]) || null;
        if (!f) return;
        try {
          const text = await f.text();
          const rows = parseCsv(text);
          if (!rows || !rows.length) { updateOwnStatus('Parsed file contains no rows'); toggle.disabled = true; try { console.debug('[species][upload] parsed 0 rows; toggle disabled'); } catch(e){} return; }
          await saveParsedSpecies(rows, { name: f.name, importedAt: Date.now() });
          updateOwnStatus(`Uploaded species list loaded (${rows.length} rows)`);
          // file selected in this session: enable toggle so user can opt-in
          if (toggle) toggle.disabled = false;
          if (toggle) toggle.checked = false; // do not auto-enable
          if (reimport) reimport.disabled = false; if (clearBtn) clearBtn.disabled = false;
          // update persistent visible label
          try { if (fileNameLabel) fileNameLabel.textContent = f.name || ''; if (fileEl) fileEl.title = f.name || ''; } catch (e) {}
          try { console.debug('[species][upload] saved', rows.length, 'rows; toggle enabled; checked=false'); } catch(e){}
        } catch (err) { console.warn(err); updateOwnStatus('Failed to parse file'); toggle.disabled = true; }
      }, true);

      if (toggle) toggle.addEventListener('change', async (ev) => {
        const on = !!ev.target.checked;
        try { console.debug('[species][toggle] change ->', on ? 'ON' : 'OFF'); } catch(e){}
        await setUseOwnSpecies(on);
      }, true);

      if (reimport) reimport.addEventListener('click', async (ev) => {
        // re-open file picker to re-import; some browsers require user gesture
        try { fileEl && fileEl.click(); } catch (e) { console.warn('reimport failed', e); }
      });

        if (clearBtn) clearBtn.addEventListener('click', async (ev) => {
        try {
          // delete persisted list and disable toggle
          await idbDelete(OWN_SPECIES_KEY);
          localStorage.removeItem(OWN_SPECIES_META);
          localStorage.setItem(OWN_SPECIES_TOGGLE, '0');
          // clear the modal file chooser so the previous filename does not remain
          try { if (fileEl) { fileEl.value = ''; fileEl.title = ''; } if (fileNameLabel) fileNameLabel.textContent = ''; } catch (e) {}
          if (toggle) { toggle.checked = false; toggle.disabled = true; }
          updateOwnStatus('Using default species list');
          if (clearBtn) clearBtn.disabled = true; if (reimport) reimport.disabled = true;
          // revert runtime records (ensure event dispatch)
          await setUseOwnSpecies(false);
          try { console.debug('[species][clear] cleared persisted list; toggle disabled; reverted to default'); } catch(e){}
        } catch (e) { console.warn('clear own list failed', e); }
      });
    } catch (e) { console.warn('wireOwnSpeciesControls failed', e); }
  }

  // Called when selection changes
  function onSelectionChanged() {
    if (selectedIds.size === 0) {
      // No bulk selection: restore species control to normal (do not override edit mode behavior)
      const spInput = findSpeciesInputEl();
      const spLabel = findSpeciesLabelEl();
      const spClear = findSpeciesClearBtn();
      if (spInput && typeof spInput.disabled !== 'undefined') {
        // leave disabled state as set by edit_annotations; if not in edit mode it should be enabled already
      }
      // nothing else to do
      return;
    }
    // Bulk mode active: don't clear or change the species input/label on selection.
    // Instead enable the explicit "Update Species" button so user can apply the current species to selected rows.
    try {
      const btn = document.getElementById('bulkUpdateSpeciesBtn');
      if (btn) btn.disabled = false;
    } catch (e) {}
  }

  // Determine if species control is currently disabled by edit mode
  function isSpeciesControlDisabled() {
    const spInput = findSpeciesInputEl();
    const spLabel = findSpeciesLabelEl();
    if (spInput) {
      if (spInput.disabled) return true;
      if (spInput.getAttribute('aria-disabled') === 'true') return true;
    }
    if (spLabel) {
      if (spLabel.getAttribute('aria-disabled') === 'true') return true;
    }
    if (globalThis._editAnnotations && typeof globalThis._editAnnotations.isEditMode === 'function') {
      try { if (globalThis._editAnnotations.isEditMode()) return true; } catch (e) {}
    }
    return false;
  }

  // Note: We rely on the species control to update the label before dispatching 'species-select'.

  // Handle accepted species for bulk application
  function handleSpeciesAccepted(commonName, scientificName) {
    if (selectedIds.size === 0) return;

    // Normalize and escape the incoming commonName for display and application
    const name = commonName && String(commonName).trim() ? String(commonName).trim() : '';
    let sci = scientificName && String(scientificName).trim() ? String(scientificName).trim() : '';
    if (!sci && name) {
      try {
        const recs = Array.isArray(window.__speciesRecords) ? window.__speciesRecords : [];
        const rec = recs.find(r => String((r.common||'')).trim() === name);
        if (rec) sci = rec.scientific || '';
      } catch (e) { sci = ''; }
    }
    const safeNameForMessage = name.replace(/'/g, "\\'");

    // Build confirmation message including the actual name when available
    const msg = safeNameForMessage
      ? `Species will be replaced '${safeNameForMessage}' for the selected rows. OK to proceed?`
      : 'Common name will be replaced for the selected rows. OK to proceed?';

    const ok = window.confirm(msg);
    if (!ok) {
      // Do nothing; keep UI state intact so user can adjust.
      return;
    }

    // Apply changes directly to Tabulator grid
    try {
      const grid = getGrid();
      if (!grid || typeof grid.updateData !== 'function') {
        // Fallback: update authoritative array if grid not available
        const anns = getAnnotations();
        if (!anns || !anns.length) return;
        const idSet = new Set(Array.from(selectedIds));
        const updated = anns.map(a => {
          const aid = String(a.id);
          if (idSet.has(aid)) return { ...a, species: name || '', scientificName: sci || '' };
          return a;
        });
        replaceAnnotations(updated);
      } else {
        const ids = Array.from(selectedIds);
        const updates = ids.map(id => ({ id: (isNaN(id) ? id : Number(id)), species: name || '', scientificName: sci || '' }));
        grid.updateData(updates);
        try { window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: 'bulk-species', ids } })); } catch (e) {}
      }
    } catch (e) {
      console.error('bulk apply failed', e);
    }

    // Post-apply: keep label/input as set by species control for consistency.
  }

  // species-select event handler
  function onSpeciesSelectEvent(ev) {
    // Intentionally do not auto-apply species on selection when rows are selected.
    // Bulk application is controlled by explicit button press.
    return;
  }
  window.addEventListener('species-select', onSpeciesSelectEvent, { passive: true });

  // species clear event handler when bulk active
  function onSpeciesCleared(ev) {
    if (selectedIds.size === 0) return;
    // Do not clear the species UI when rows are selected; keep UI stable.
    // No-op here to avoid surprising the user.
  }
  window.addEventListener('species-select-cleared', onSpeciesCleared, { passive: true });

  // Apply species currently selected in the UI to the selected rows (button handler)
  function applySpeciesFromUI() {
    const keyEl = document.getElementById('selectedSpeciesKey');
    const labelEl = document.getElementById('speciesResult');
    const common = labelEl ? String(labelEl.textContent || '').trim() : '';
    let scientific = '';
    try {
      const recs = Array.isArray(window.__speciesRecords) ? window.__speciesRecords : [];
      const key = keyEl ? String(keyEl.value || '').trim() : '';
      if (key) {
        const rec = recs.find(r => String((r.key||'')).trim() === key);
        scientific = rec ? (rec.scientific || '') : '';
      } else if (common) {
        const rec = recs.find(r => String((r.common||'')).trim() === common);
        scientific = rec ? (rec.scientific || '') : '';
      }
    } catch (e) { scientific = ''; }
    // Reuse existing confirmation + apply flow
    try { handleSpeciesAccepted(common, scientific); } catch (e) { console.error('bulk: applySpeciesFromUI failed', e); }
  }

  // Wire the new button when present
  function wireBulkButton() {
    try {
      const btn = document.getElementById('bulkUpdateSpeciesBtn');
      if (!btn) return;
      if (btn.__bulkWired) return;
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        // ensure there is a selection
        if (selectedIds.size === 0) {
          try { alert('No rows selected. Please select one or more rows to update.'); } catch (e) {}
          return;
        }
        applySpeciesFromUI();
      }, true);
      btn.__bulkWired = true;
    } catch (e) {}
  }

  // Attempt to wire the button on init
  (function waitForBulkBtn(max = 40) {
    try {
      wireBulkButton();
      const btn = document.getElementById('bulkUpdateSpeciesBtn');
      if (!btn && max > 0) setTimeout(() => waitForBulkBtn(max - 1), 120);
    } catch (e) {}
  })();

  // Enter handling is owned by the species control; it dispatches 'species-select' after updating the label.

  // Wire Tabulator selection change listeners
  function wireGridSelectionListeners() {
    const grid = getGrid();
    if (!grid || gridWired) return;
    try {
      const tryHook = (evt) => { try { grid.on(evt, onGridSelectionChanged); } catch (e) {} };
      tryHook('rowSelected');
      tryHook('rowDeselected');
      tryHook('dataLoaded');
      tryHook('dataChanged');
      gridWired = true;
      onGridSelectionChanged();
    } catch (e) { console.warn('bulk: grid wire failed', e); }
  }

  function init() {
    // No keydown wiring here; rely on 'species-select' dispatched by the species UI.

    // Wait for grid and then wire selection listeners
    (function waitForGrid(max = 60) {
      const g = getGrid();
      if (g) {
        wireGridSelectionListeners();
      } else if (max > 0) {
        setTimeout(() => waitForGrid(max - 1), 100);
      }
    })();

    if (globalThis._annotations && typeof globalThis._annotations.onChange === 'function') {
      try { globalThis._annotations.onChange(() => setTimeout(onGridSelectionChanged, 0)); } catch (e) {}
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
      setTimeout(init, 0);
  }

  // wire own-species controls once DOM available
  (function waitForOwnControls(max = 40) {
    try {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(wireOwnSpeciesControls, 0));
        return;
      }
      wireOwnSpeciesControls();
    } catch (e) {
      if (max > 0) setTimeout(() => waitForOwnControls(max - 1), 200);
    }
  })();

  // expose small API
  globalThis._speciesBulkEdit = globalThis._speciesBulkEdit || {};
  globalThis._speciesBulkEdit.getSelectedIds = () => {
    try { return getSelectedRowIdsFromGrid(); } catch (e) { return Array.from(selectedIds); }
  };
  globalThis._speciesBulkEdit.clearSelection = () => {
    try {
      const grid = getGrid();
      if (grid && typeof grid.deselectRow === 'function') {
        const ids = getSelectedRowIdsFromGrid();
        if (ids.length) grid.deselectRow(ids);
      }
    } catch (e) {}
    selectedIds.clear();
    onSelectionChanged();
  };
  // Debug state hook
  globalThis._speciesBulkEdit.__debugState = async () => {
    const parsed = await loadParsedSpecies();
    const toggle = document.getElementById('useOwnSpeciesToggle');
    return {
      parsedCount: Array.isArray(parsed) ? parsed.length : 0,
      toggleDisabled: !!(toggle && toggle.disabled),
      toggleChecked: !!(toggle && toggle.checked),
      useOwnSpeciesLS: (localStorage.getItem(OWN_SPECIES_TOGGLE) || '0'),
    };
  };
})();