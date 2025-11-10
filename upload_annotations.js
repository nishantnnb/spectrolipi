// upload_annotations.js
// Upload annotations (TSV/CSV). Defensive wiring: ensures upload button stays enabled and click handler is attached.
// Integrates with globalThis._annotations.import when available. Validates numeric fields and assigns canonical ids.
// Uses an accessible in-DOM modal (Merge / Replace / Cancel) shown every time when existing annotations are present.
// Modal is single-instance and robust against focus/race/duplicate handlers.
//
// Drop-in replacement for previous upload_annotations.js
//
// Fix included: tolerant header mapping so "Common name", "common-name", "CommonName" etc map to species
// (no changes required in create_annotations.js). Header matching is normalized (non-alphanumerics removed).

(function () {
  if (window.__uploadAnnotationsInit) return;
  window.__uploadAnnotationsInit = true;

  const UPLOAD_BTN_ID = 'uploadAnnoBtn';
  const INTERNAL_FILE_INPUT_ID = '__upload_annotations_file_input__';
  const DIALOG_TITLE = 'Annotations already present. Please select an option';
  const MANDATORY_COLS = ['Begin Time (s)', 'End Time (s)', 'Low Freq (Hz)', 'High Freq (Hz)'];

  function q(id) { return document.getElementById(id); }

  // Private hidden input (never touch audio #file)
  function ensurePrivateFileInput() {
    let fi = q(INTERNAL_FILE_INPUT_ID);
    if (fi) return fi;
    fi = document.createElement('input');
    fi.type = 'file';
    fi.accept = '.txt,.tsv,.csv,text/tab-separated-values,text/plain';
    fi.id = INTERNAL_FILE_INPUT_ID;
    fi.style.display = 'none';
    fi.setAttribute('aria-hidden', 'true');
    document.body.appendChild(fi);
    return fi;
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error('File read error'));
      r.onload = () => resolve(String(r.result));
      r.readAsText(file, 'utf-8');
    });
  }

  // Robust TSV/CSV parser with quoted fields
  function parseTableText(text) {
    if (!text || typeof text !== 'string') return null;
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const sep = text.indexOf('\t') >= 0 ? '\t' : (text.indexOf(',') >= 0 ? ',' : '\t');

    const rows = [];
    let cur = [];
    let curField = '';
    let inQuotes = false;
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { curField += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        curField += ch; i++; continue;
      } else {
        if (ch === '"') { inQuotes = true; i++; continue; }
        if (ch === sep) { cur.push(curField); curField = ''; i++; continue; }
        if (ch === '\n') { cur.push(curField); rows.push(cur); cur = []; curField = ''; i++; continue; }
        curField += ch; i++; continue;
      }
    }
    if (inQuotes) return null;
    if (curField !== '' || cur.length > 0) { cur.push(curField); rows.push(cur); }

    if (rows.length === 0) return null;
    const headers = rows[0].map(h => (h || '').trim());
    const dataRows = rows.slice(1).map(r => {
      const obj = {};
      for (let c = 0; c < r.length; c++) {
        const key = headers[c] !== undefined && headers[c].length > 0 ? headers[c] : `col${c+1}`;
        obj[key] = r[c];
      }
      for (let h = 0; h < headers.length; h++) {
        const k = headers[h] || `col${h+1}`;
        if (!Object.prototype.hasOwnProperty.call(obj, k)) obj[k] = '';
      }
      return obj;
    });

    return { headers: headers, rows: dataRows };
  }

  // Get existing annotations via API or DOM fallback
  function getExistingAnnotations() {
    try {
      if (globalThis._annotations) {
        if (typeof globalThis._annotations.getAll === 'function') return globalThis._annotations.getAll() || [];
        if (Array.isArray(globalThis._annotations)) return globalThis._annotations;
      }
    } catch (e) {}
    const tbl = q('annotationTable') || document.querySelector('.annotation-table');
    if (tbl && tbl.tagName === 'TABLE') {
      const out = [];
      const ths = tbl.querySelectorAll('thead th');
      const hdrs = [];
      if (ths && ths.length) ths.forEach(t => hdrs.push((t.textContent || t.innerText || '').trim()));
      const rows = tbl.querySelectorAll('tbody tr');
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        const obj = {};
        for (let i = 0; i < cells.length; i++) {
          const key = hdrs[i] || `col${i+1}`;
          obj[key] = (cells[i].textContent || cells[i].innerText || '').trim();
        }
        out.push(obj);
      });
      return out;
    }
    return [];
  }

  // API-first insertion; prefer .import, fallback to common names, mutate array as last resort.
  function tryInsertAnnotationsViaAPI(mode, annotationsArray) {
    try {
      if (!globalThis._annotations) return false;

      if (typeof globalThis._annotations.import === 'function') {
        if (mode === 'replace') {
          globalThis._annotations.import(annotationsArray.slice());
          try { window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: 'upload-replace', count: annotationsArray.length } })); } catch (e) {}
          return true;
        } else {
          const cur = (typeof globalThis._annotations.getAll === 'function') ? (globalThis._annotations.getAll() || []) : [];
          globalThis._annotations.import(cur.concat(annotationsArray.slice()));
          try { window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: 'upload-merge', count: annotationsArray.length } })); } catch (e) {}
          return true;
        }
      }

      if (typeof globalThis._annotations.replaceAll === 'function') {
        if (mode === 'replace') {
          globalThis._annotations.replaceAll(annotationsArray.slice());
          try { window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: 'upload-replace', count: annotationsArray.length } })); } catch (e) {}
          return true;
        } else {
          if (typeof globalThis._annotations.addMany === 'function') {
            globalThis._annotations.addMany(annotationsArray.slice());
            try { window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: 'upload-merge', count: annotationsArray.length } })); } catch (e) {}
            return true;
          }
          if (typeof globalThis._annotations.getAll === 'function') {
            const cur = globalThis._annotations.getAll() || [];
            globalThis._annotations.replaceAll(cur.concat(annotationsArray.slice()));
            try { window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: 'upload-merge', count: annotationsArray.length } })); } catch (e) {}
            return true;
          }
        }
      }

      if (typeof globalThis._annotations.setAll === 'function') {
        if (mode === 'replace') {
          globalThis._annotations.setAll(annotationsArray.slice());
          try { window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: 'upload-replace', count: annotationsArray.length } })); } catch (e) {}
          return true;
        } else {
          const cur = typeof globalThis._annotations.getAll === 'function' ? (globalThis._annotations.getAll() || []) : [];
          globalThis._annotations.setAll(cur.concat(annotationsArray.slice()));
          try { window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: 'upload-merge', count: annotationsArray.length } })); } catch (e) {}
          return true;
        }
      }

      if (mode === 'merge' && typeof globalThis._annotations.addMany === 'function') {
        globalThis._annotations.addMany(annotationsArray.slice());
        try { window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: 'upload-merge', count: annotationsArray.length } })); } catch (e) {}
        return true;
      }

      if (mode === 'merge' && typeof globalThis._annotations.add === 'function') {
        annotationsArray.forEach(a => globalThis._annotations.add(a));
        try { window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: 'upload-merge', count: annotationsArray.length } })); } catch (e) {}
        return true;
      }

      if (Array.isArray(globalThis._annotations)) {
        if (mode === 'replace') {
          globalThis._annotations.length = 0;
          Array.prototype.push.apply(globalThis._annotations, annotationsArray.slice());
        } else {
          Array.prototype.push.apply(globalThis._annotations, annotationsArray.slice());
        }
        try { window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: mode === 'replace' ? 'upload-replace' : 'upload-merge', count: annotationsArray.length } })); } catch (e) {}
        return true;
      }
    } catch (e) {
      console.warn('Annotation API insertion failed', e);
    }
    return false;
  }

  // DOM table fallback helpers
  function ensureDOMTableExistsAndReturn(headers) {
    const existing = q('annotationTable') || document.querySelector('.annotation-table');
    if (existing && existing.tagName === 'TABLE') return existing;

    const tbl = document.createElement('table');
    tbl.id = 'annotationTable';
    tbl.className = 'annotation-table';
    tbl.style.width = '100%';
    tbl.style.borderCollapse = 'collapse';
    tbl.style.marginTop = '8px';
    tbl.style.border = '1px solid rgba(255,255,255,0.04)';

    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    headers.forEach(h => {
      const th = document.createElement('th');
      th.textContent = h;
      th.style.padding = '6px 8px';
      th.style.textAlign = 'left';
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    tbl.appendChild(thead);

    const tbody = document.createElement('tbody');
    tbl.appendChild(tbody);

    const container = document.getElementById('annotationTableContainer') || document.getElementById('annotationControls') || document.body;
    container.appendChild(tbl);
    return tbl;
  }

  function insertRowsIntoTableElement(tbl, headers, rows, mode) {
    const thead = tbl.tHead || tbl.querySelector('thead');
    let curHeaders = [];
    if (thead) {
      curHeaders = Array.from(thead.querySelectorAll('th')).map(th => (th.textContent || '').trim());
    } else {
      curHeaders = headers.slice();
      const newThead = document.createElement('thead');
      const tr = document.createElement('tr');
      curHeaders.forEach(h => {
        const th = document.createElement('th'); th.textContent = h; th.style.padding = '6px 8px'; tr.appendChild(th);
      });
      newThead.appendChild(tr);
      tbl.insertBefore(newThead, tbl.firstChild);
    }

    const missing = headers.filter(h => !curHeaders.includes(h));
    if (missing.length) {
      const headRow = tbl.tHead.querySelector('tr');
      missing.forEach(h => {
        const th = document.createElement('th'); th.textContent = h; th.style.padding = '6px 8px'; headRow.appendChild(th); curHeaders.push(h);
      });
    }

    const tbody = tbl.tBodies && tbl.tBodies[0] ? tbl.tBodies[0] : (function(){ const b = document.createElement('tbody'); tbl.appendChild(b); return b; })();

    function createTR(rowObj) {
      const tr = document.createElement('tr');
      curHeaders.forEach(h => {
        const td = document.createElement('td');
        td.textContent = (rowObj[h] !== undefined && rowObj[h] !== null) ? String(rowObj[h]) : '';
        td.style.padding = '6px 8px';
        tr.appendChild(td);
      });
      return tr;
    }

    if (mode === 'replace') {
      tbody.innerHTML = '';
      rows.forEach(r => tbody.appendChild(createTR(r)));
    } else {
      rows.forEach(r => tbody.appendChild(createTR(r)));
    }
    try { window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: mode === 'replace' ? 'upload-replace-dom' : 'upload-merge-dom', count: rows.length } })); } catch (e) {}
  }

  // Utility: normalize header text for tolerant matching
  function normalizeHeaderKey(h) {
    if (!h) return '';
    return String(h).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // New: normalize parsed rows to canonical annotation objects and validate numeric fields
  function normalizeParsedRowsToAnnotations(parsed) {
    const parsedHeaders = parsed.headers || [];
    const parsedRows = parsed.rows || [];

    // Build dynamic header mapping using normalization so "common name" or "Species" both map to species
    const headerNormalizedToOriginal = {}; // normalized -> original header string
    for (let i = 0; i < parsedHeaders.length; i++) {
      const h = parsedHeaders[i] || '';
      const n = normalizeHeaderKey(h);
      if (!n) continue;
      headerNormalizedToOriginal[n] = h;
    }

    // canonical normalized keys for critical fields
    const normalizedBegin = normalizeHeaderKey('Begin Time (s)');
    const normalizedEnd = normalizeHeaderKey('End Time (s)');
    const normalizedLow = normalizeHeaderKey('Low Freq (Hz)');
    const normalizedHigh = normalizeHeaderKey('High Freq (Hz)');

    // species variants accepted
    const speciesVariants = new Set(['species', 'commonname', 'common_name', 'common-name', 'commonname']);

    const out = [];
    const badRows = [];

    parsedRows.forEach((r, rowIdx) => {
      const obj = {};
  obj.beginTime = NaN;
  obj.endTime = NaN;
  obj.lowFreq = NaN;
  obj.highFreq = NaN;
  obj.species = '';
  obj.scientificName = '';
  obj.notes = '';

      // iterate original headers to preserve other columns
      parsedHeaders.forEach(h => {
        const raw = r[h] !== undefined && r[h] !== null ? String(r[h]).trim() : '';
        const nh = normalizeHeaderKey(h);
        if (nh === normalizedBegin) {
          const n = Number(raw);
          if (!isFinite(n)) badRows.push({ rowIndex: rowIdx + 2, header: h, value: raw });
          else obj.beginTime = Number(Number(n).toFixed(6));
        } else if (nh === normalizedEnd) {
          const n = Number(raw);
          if (!isFinite(n)) badRows.push({ rowIndex: rowIdx + 2, header: h, value: raw });
          else obj.endTime = Number(Number(n).toFixed(6));
        } else if (nh === normalizedLow) {
          const n = Number(raw);
          if (!isFinite(n)) badRows.push({ rowIndex: rowIdx + 2, header: h, value: raw });
          else obj.lowFreq = Number(Number(n).toFixed(6));
        } else if (nh === normalizedHigh) {
          const n = Number(raw);
          if (!isFinite(n)) badRows.push({ rowIndex: rowIdx + 2, header: h, value: raw });
          else obj.highFreq = Number(Number(n).toFixed(6));
        } else if (speciesVariants.has(nh)) {
          obj.species = raw;
        } else if (nh === 'scientificname' || nh === 'scientific_name' || nh === 'scientific-name') {
          obj.scientificName = raw;
        } else if (nh === normalizeHeaderKey('Notes')) {
          obj.notes = raw;
        } else if (nh === normalizeHeaderKey('Selection')) {
          obj.Selection = raw;
        } else {
          // Explicitly ignore 'View', 'Channel' and 'File' columns (do not import them)
          if (nh === 'view' || nh === 'channel' || nh === 'file') return;
          // keep any other column under original header name for DOM fallback
          obj[h] = raw;
        }
      });

      out.push(obj);
    });

    if (badRows.length) {
      const sample = badRows.slice(0,5).map(b => `Row ${b.rowIndex} (${b.header}="${b.value}")`).join('\n');
      try { window.alert('Numeric parsing failed for uploaded file. Non-numeric values found:\n' + sample); } catch (e) {}
      return null;
    }

    return out;
  }

  // Renumber Selection starting at startIndex (1-based)
  function renumberSelection(arr, startIndex) {
    for (let i = 0; i < arr.length; i++) {
      arr[i]['Selection'] = String(startIndex + i);
    }
  }

  function missingMandatoryColumns(headers) {
    const found = new Set((headers || []).map(h => normalizeHeaderKey(h)));
    const requiredNormals = MANDATORY_COLS.map(h => normalizeHeaderKey(h));
    for (let i = 0; i < requiredNormals.length; i++) {
      if (!found.has(requiredNormals[i])) return true;
    }
    return false;
  }

  // Robust single-instance modal returning Promise<'merge'|'replace'|'cancel'>
  let __uploadModalOpen = false;
  function showThreeOptionModal(context = { existingCount: 0, newCount: 0 }) {
    return new Promise((resolve) => {
      if (__uploadModalOpen) {
        const existingDialog = document.querySelector('.__upload_modal_dialog');
        if (existingDialog && typeof existingDialog.focus === 'function') try { existingDialog.focus(); } catch (e) {}
        return setTimeout(() => resolve('cancel'), 0);
      }
      __uploadModalOpen = true;

      const overlay = document.createElement('div');
      overlay.className = '__upload_modal_overlay';
      overlay.style.position = 'fixed';
      overlay.style.left = '0';
      overlay.style.top = '0';
      overlay.style.right = '0';
      overlay.style.bottom = '0';
      overlay.style.background = 'rgba(0,0,0,0.45)';
      overlay.style.zIndex = '2147483647';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.padding = '16px';
      overlay.style.pointerEvents = 'auto';

      const dialog = document.createElement('div');
      dialog.className = '__upload_modal_dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('tabindex', '-1');
      dialog.style.background = '#0f0f0f';
      dialog.style.color = '#eee';
      dialog.style.borderRadius = '8px';
      dialog.style.boxShadow = '0 6px 30px rgba(0,0,0,0.6)';
      dialog.style.maxWidth = '520px';
      dialog.style.width = '100%';
      dialog.style.padding = '18px';
      dialog.style.fontFamily = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial';
      dialog.style.outline = 'none';
      dialog.style.pointerEvents = 'auto';

      const title = document.createElement('div');
      title.id = '__upload_modal_title';
      title.style.fontSize = '16px';
      title.style.fontWeight = 700;
      title.style.marginBottom = '8px';
      title.textContent = 'Annotations already present. Please select an option';

      const desc = document.createElement('div');
      desc.style.fontSize = '13px';
      desc.style.marginBottom = '12px';
      const existingText = context.existingCount > 0 ? `${context.existingCount} existing` : 'No existing';
      const newText = context.newCount > 0 ? `${context.newCount} new` : '0';
      desc.textContent = `${existingText} annotations will be affected. Upload contains ${newText} annotation row(s).`;

      const btnRow = document.createElement('div');
      btnRow.style.display = 'flex';
      btnRow.style.gap = '8px';
      btnRow.style.justifyContent = 'flex-end';
      btnRow.style.marginTop = '8px';

      const btnCancel = document.createElement('button');
      btnCancel.type = 'button';
      btnCancel.textContent = 'Cancel';
      btnCancel.style.background = 'transparent';
      btnCancel.style.color = '#ddd';
      btnCancel.style.border = '1px solid rgba(255,255,255,0.06)';
      btnCancel.style.padding = '8px 12px';
      btnCancel.style.borderRadius = '6px';
      btnCancel.style.cursor = 'pointer';

      const btnMerge = document.createElement('button');
      btnMerge.type = 'button';
      btnMerge.textContent = 'Merge';
      btnMerge.style.background = '#2a2f36';
      btnMerge.style.color = '#fff';
      btnMerge.style.border = '1px solid rgba(255,255,255,0.06)';
      btnMerge.style.padding = '8px 12px';
      btnMerge.style.borderRadius = '6px';
      btnMerge.style.cursor = 'pointer';

      const btnReplace = document.createElement('button');
      btnReplace.type = 'button';
      btnReplace.textContent = 'Replace';
      btnReplace.style.background = '#b43a3a';
      btnReplace.style.color = '#fff';
      btnReplace.style.border = '1px solid rgba(255,255,255,0.06)';
      btnReplace.style.padding = '8px 12px';
      btnReplace.style.borderRadius = '6px';
      btnReplace.style.cursor = 'pointer';

      btnRow.appendChild(btnCancel);
      btnRow.appendChild(btnMerge);
      btnRow.appendChild(btnReplace);

      dialog.appendChild(title);
      dialog.appendChild(desc);
      dialog.appendChild(btnRow);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      const previouslyFocused = document.activeElement;

      // Focus after next paint to avoid first-click focus-eating
      requestAnimationFrame(() => {
        try { btnMerge.focus(); } catch (e) {}
      });

      function onKeyDown(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          cleanup('cancel');
        } else if (e.key === 'Tab') {
          const focusable = [btnCancel, btnMerge, btnReplace];
          const idx = focusable.indexOf(document.activeElement);
          if (e.shiftKey) {
            if (idx <= 0) { focusable[focusable.length - 1].focus(); e.preventDefault(); }
          } else {
            if (idx === -1 || idx === focusable.length - 1) { focusable[0].focus(); e.preventDefault(); }
          }
        }
      }

      // click outside dialog cancels
      const onOverlayClick = (ev) => {
        if (ev.target === overlay) cleanup('cancel');
      };
      overlay.addEventListener('click', onOverlayClick, true);

      // single-run handlers
      const onCancel = () => cleanup('cancel');
      const onMerge = () => cleanup('merge');
      const onReplace = () => cleanup('replace');
      btnCancel.addEventListener('click', onCancel, { once: true });
      btnMerge.addEventListener('click', onMerge, { once: true });
      btnReplace.addEventListener('click', onReplace, { once: true });

      document.addEventListener('keydown', onKeyDown, true);

      function cleanup(choice) {
        __uploadModalOpen = false;
        try { document.removeEventListener('keydown', onKeyDown, true); } catch (e) {}
        try { overlay.removeEventListener('click', onOverlayClick, true); } catch (e) {}
        try { overlay.remove(); } catch (e) {}
        try { if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus(); } catch (e) {}
        // resolve after next tick to avoid re-entrancy issues
        setTimeout(() => resolve(choice), 0);
      }
    });
  }

  // Assign canonical ids matching create_annotations ("aNNNN")
  function assignCanonicalIds(toInsert, existing) {
    let maxN = 0;
    try {
      (existing || []).forEach(e => {
        const id = (e && (e.id || e.ID || e.Id || e.aid)) ? String(e.id || e.ID || e.Id || e.aid) : null;
        if (!id) return;
        const m = id.match(/^a0*([0-9]+)$/i);
        if (m) {
          const n = Number(m[1]);
          if (isFinite(n) && n > maxN) maxN = n;
        }
      });
    } catch (e) {}
    let next = Math.max(1, maxN + 1);
    toInsert.forEach(item => {
      const hasId = item && (item.id || item.ID || item.Id);
      if (!hasId) {
        item.id = 'a' + String(next++).padStart(4, '0');
      } else {
        item.id = item.id || item.ID || item.Id;
      }
    });
  }

  // Defensive enable + wiring for upload button
  function ensureUploadButtonEnabled(btn) {
    try {
      if (!btn) return;
      btn.disabled = false;
      btn.removeAttribute('aria-disabled');
      btn.style.pointerEvents = 'auto';
      if (btn.style.opacity === '0' || btn.style.opacity === '0.45') btn.style.opacity = '';
      if (!btn.style.cursor || btn.style.cursor === 'default') btn.style.cursor = 'pointer';
    } catch (e) { /* ignore */ }
  }

  // Main upload flow
  async function onUploadClick() {
    const fi = ensurePrivateFileInput();
    // Pause playback safely before opening file chooser to avoid background audio interfering
    async function safePausePlayback(timeoutMs = 800) {
      try {
        const pauseFn = (globalThis._playbackScrollJump && typeof globalThis._playbackScrollJump.pause === 'function') ? globalThis._playbackScrollJump.pause :
                        (globalThis._playback && typeof globalThis._playback.pause === 'function') ? globalThis._playback.pause : null;
        if (!pauseFn) return;
        // call and await but bound by timeout to avoid hanging
        const p = pauseFn.call(globalThis._playbackScrollJump || globalThis._playback);
        if (p && typeof p.then === 'function') {
          await Promise.race([p, new Promise((_, r) => setTimeout(r, timeoutMs))]).catch(() => {});
        }
      } catch (e) {}
    }
    const onFileChosen = async function (ev) {
      fi.removeEventListener('change', onFileChosen);
      const f = fi.files && fi.files[0];
      if (!f) return;

      let text;
      try { text = await readFileAsText(f); } catch (e) { console.error('Failed to read upload file', e); try { window.alert('Failed to read file. See console for details.'); } catch (e) {} return; }

      const parsed = parseTableText(text);
      if (!parsed) { try { window.alert('Uploaded file is empty or malformed. Expecting TSV/CSV with header row.'); } catch (e) {} return; }

      if (missingMandatoryColumns(parsed.headers)) {
        try { window.alert('Mandatory columns for Box coordinates are missing.'); } catch (e) {}
        try { fi.value = ''; } catch (e) {}
        return;
      }

      const normalized = normalizeParsedRowsToAnnotations(parsed);
      if (!normalized) {
        try { fi.value = ''; } catch (e) {}
        return;
      }

      const existing = getExistingAnnotations() || [];
      const existingCount = Array.isArray(existing) ? existing.length : 0;
      let action = 'replace';

      if (existingCount > 0) {
        action = await showThreeOptionModal({ existingCount: existingCount, newCount: normalized.length });
      }

      if (action === 'cancel') { try { fi.value = ''; } catch (e) {} return; }

      let toInsert = normalized.slice();

      // --- DYNAMIC TABULATOR COLUMN HANDLING ---
      // Get current Tabulator columns (fields and titles)
      let grid = window.annotationGrid;
      let currentColumns = [];
      let currentTitles = [];
      if (grid && typeof grid.getColumns === 'function') {
        const cols = grid.getColumns();
        currentColumns = cols.map(c => c.getField());
        currentTitles = cols.map(c => {
          try { const d = c.getDefinition && c.getDefinition(); return (d && d.title) ? String(d.title) : ''; } catch (e) { return ''; }
        }).filter(Boolean);
      }

      // Required columns (in order)
      const requiredFields = ["id", "Selection", "beginTime", "endTime", "lowFreq", "highFreq", "species", "notes"];

  // Identify columns in upload file that are not present in grid (prefer direct title match; fallback to normalized mapping)
      let newColumnsToAdd = [];
      if (parsed && parsed.headers) {
        const nBegin = normalizeHeaderKey('Begin Time (s)');
        const nEnd = normalizeHeaderKey('End Time (s)');
        const nLow = normalizeHeaderKey('Low Freq (Hz)');
        const nHigh = normalizeHeaderKey('High Freq (Hz)');
        const nNotes = normalizeHeaderKey('Notes');
        const nSel = normalizeHeaderKey('Selection');
        const speciesNorms = new Set(['species','commonname','common_name','common-name']);

        function headerMapsToKnownField(header) {
          const nh = normalizeHeaderKey(header);
          if (!nh) return false;
          if (nh === nBegin || nh === nEnd || nh === nLow || nh === nHigh) return true; // numeric fields
          if (nh === nNotes) return true;
          if (nh === nSel) return true;
          if (nh === 'id') return true;
          if (speciesNorms.has(nh)) return true;
          return false;
        }

        parsed.headers.forEach(h => {
          const header = (h || '').trim();
          if (!header) return;
          const nh = normalizeHeaderKey(header);
          if (nh === 'view' || nh === 'channel' || nh === 'file') return; // never treat these as new/imported columns
          if (header === '_select') return; // ignore selection checkbox
          // If header matches any existing grid column title, it's not new
          if (currentTitles.some(t => String(t).trim() === header)) return;
          // If header equals an existing field name, it's not new
          if (currentColumns.includes(header)) return;
          // If header normalizes to a known grid field, it's not new
          if (headerMapsToKnownField(header)) return;
          newColumnsToAdd.push(header);
        });
      }

      // Insert all new columns together after 'notes' column
      if (grid && typeof grid.addColumn === 'function' && newColumnsToAdd.length > 0) {
        // 1) Add any missing columns (position doesn't matter yet)
        for (const field of newColumnsToAdd) {
          const exists = grid.getColumns().some(c => c.getField() === field);
          if (!exists) {
            grid.addColumn({
              title: field,
              field: field,
              headerSort: true,
              editor: "input",
              resizable: true
            });
          }
        }
        // 2) Reorder them to be immediately to the right of Notes, preserving the file order
        if (typeof grid.moveColumn === 'function') {
          let anchor = 'notes';
          for (const field of newColumnsToAdd) {
            try { grid.moveColumn(field, anchor, 'right'); } catch (e) { /* ignore */ }
            anchor = field; // next one goes to the right of the previously moved one
          }
        }
      }

      try {
        // Build grid rows with numeric id/Selection and carry extra columns
        const requiredSet = new Set(["id","Selection","beginTime","endTime","lowFreq","highFreq","species","notes"]);
        const nBeginR = normalizeHeaderKey('Begin Time (s)');
        const nEndR = normalizeHeaderKey('End Time (s)');
        const nLowR = normalizeHeaderKey('Low Freq (Hz)');
        const nHighR = normalizeHeaderKey('High Freq (Hz)');
        const nNotesR = normalizeHeaderKey('Notes');
        const nSelR = normalizeHeaderKey('Selection');
        const speciesNormsR = new Set(['species','commonname','common_name','common-name']);
        function isKnownHeaderName(k) {
          const nk = normalizeHeaderKey(k);
          if (!nk) return false;
          if (nk === nBeginR || nk === nEndR || nk === nLowR || nk === nHighR) return true;
          if (nk === nNotesR || nk === nSelR) return true;
          if (nk === 'id') return true;
          if (speciesNormsR.has(nk)) return true;
          return false;
        }
        const round4 = (v) => Number(Number(v).toFixed(4));

        const buildRows = (startIndex) => toInsert.map((obj, idx) => {
          const base = {
            id: startIndex + idx,
            Selection: String(startIndex + idx),
            beginTime: round4(obj.beginTime || 0),
            endTime: round4(obj.endTime || (obj.beginTime || 0)),
            lowFreq: round4(obj.lowFreq || 0),
            highFreq: round4(obj.highFreq || 0),
            species: obj.species || '',
            scientificName: obj.scientificName || '',
            notes: obj.notes || ''
          };
          // If scientific name is missing but we have a common name, try to map it
          try {
            if ((!base.scientificName || !String(base.scientificName).trim()) && base.species) {
              const recs = Array.isArray(window.__speciesRecords) ? window.__speciesRecords : [];
              const rec = recs.find(r => String((r.common||'')).trim() === String(base.species).trim());
              if (rec) base.scientificName = rec.scientific || '';
            }
          } catch (e) {}
          // preserve extra columns
          Object.keys(obj).forEach(k => {
            if (requiredSet.has(k)) return;
            if (isKnownHeaderName(k)) return; // don't duplicate known headers like "Begin Time (s)"
            const nk = normalizeHeaderKey(k);
            if (nk === 'view' || nk === 'channel' || nk === 'file') return; // explicitly skip these columns
            base[k] = obj[k];
          });
          return base;
        });

        if (grid && typeof grid.getData === 'function') {
          if (action === 'replace' || existingCount === 0) {
            const rows = buildRows(1);
            if (typeof grid.replaceData === 'function') {
              await grid.replaceData(rows);
            } else if (typeof grid.setData === 'function') {
              await grid.setData(rows);
            } else if (typeof grid.clearData === 'function' && typeof grid.addData === 'function') {
              grid.clearData();
              await grid.addData(rows, true);
            } else {
              // Fallback to API/DOM
              const handledAPI = tryInsertAnnotationsViaAPI('replace', rows);
              if (!handledAPI) {
                const tbl = ensureDOMTableExistsAndReturn(parsed.headers.length ? parsed.headers : Object.keys(rows[0] || {}));
                insertRowsIntoTableElement(tbl, parsed.headers.length ? parsed.headers : Object.keys(rows[0] || {}), rows, 'replace');
              }
            }
            try { window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: 'upload-replace', count: toInsert.length } })); } catch (e) {}
            try { fi.value = ''; } catch (e) {}
            return;
          }

          if (action === 'merge') {
            const startIndex = (grid.getData() || []).length + 1;
            const rows = buildRows(startIndex);
            if (typeof grid.addData === 'function') {
              await grid.addData(rows, true);
            } else {
              // Fallback to API/DOM
              const handledAPI = tryInsertAnnotationsViaAPI('merge', rows);
              if (!handledAPI) {
                const tbl = ensureDOMTableExistsAndReturn(parsed.headers.length ? parsed.headers : Object.keys(rows[0] || {}));
                insertRowsIntoTableElement(tbl, parsed.headers.length ? parsed.headers : Object.keys(rows[0] || {}), rows, 'merge');
              }
            }
            try { window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: 'upload-merge', count: toInsert.length } })); } catch (e) {}
            try { fi.value = ''; } catch (e) {}
            return;
          }
        }
      } catch (e) {
        console.error('Upload processing failed', e);
        try { window.alert('Upload failed. See console for details.'); } catch (e) {}
      } finally {
        try { fi.value = ''; } catch (e) {}
      }
    };

    fi.addEventListener('change', onFileChosen, { once: true });
    try {
      try { if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur(); } catch (e) {}
      // attempt to pause playback before opening file chooser (very safe: bounded timeout)
      try { await safePausePlayback(800); } catch (e) {}
      fi.click();
    } catch (e) { try { window.alert('Unable to open file chooser programmatically.'); } catch (e) {} }
  }

  function wireUploadButtonOnce() {
    const btn = q(UPLOAD_BTN_ID);
    if (!btn) return;
    ensureUploadButtonEnabled(btn);
    if (btn.__uploadWired) return;
    btn.addEventListener('click', function (ev) {
      try { ev && ev.preventDefault && ev.preventDefault(); } catch (e) {}
      onUploadClick();
    }, true);

    // Observe attribute/style changes that set disabled and restore
    try {
      const mo = new MutationObserver((mutations) => {
        mutations.forEach(m => {
          if ((m.attributeName === 'disabled') || (m.attributeName === 'aria-disabled') || (m.attributeName === 'style')) {
            ensureUploadButtonEnabled(btn);
          }
        });
      });
      mo.observe(btn, { attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'style'] });
      btn.__uploadEnableObserver = mo;
    } catch (e) {}
    btn.__uploadWired = true;
  }

  function init() {
    wireUploadButtonOnce();
    if (!q(UPLOAD_BTN_ID)) {
      const bodyObserver = new MutationObserver((mutations, obs) => {
        if (q(UPLOAD_BTN_ID)) {
          wireUploadButtonOnce();
          obs.disconnect();
        }
      });
      bodyObserver.observe(document.body, { childList: true, subtree: true });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  // Debug helpers
  window.__uploadAnnotations = {
    parseTableText: function (text) { return parseTableText(text); },
    readFileAsText: readFileAsText,
    showThreeOptionModal: showThreeOptionModal
  };
})();
