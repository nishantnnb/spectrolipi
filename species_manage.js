// species_manage.js
// Manage Species modal: search/edit/create/delete single species, bulk upload (merge/replace), download CSV.
// Persists changes to localStorage key 'species_records' and updates window.__speciesRecords.

(function () {
  if (window.__speciesManageInit) return;
  window.__speciesManageInit = true;

  const STORAGE_KEY = 'species_records';
  const BTN_ID = 'manageSpeciesBtn';

  function q(id) { return document.getElementById(id); }

  function loadRecords() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) { console.warn('species_manage: failed to load from storage', e); }
    // fall back to in-memory global file data
    try { return Array.isArray(window.__speciesRecords) ? window.__speciesRecords.slice() : []; } catch (e) { return []; }
  }

  function saveRecords(arr) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    } catch (e) { console.warn('species_manage: failed to persist to localStorage', e); }
    try { window.__speciesRecords = Array.isArray(arr) ? arr.slice() : []; } catch (e) {}
    try { document.dispatchEvent(new CustomEvent('species-updated', { detail: { count: (arr||[]).length } })); } catch (e) {}
  }

  function normalizeKey(k) { return String(k||'').trim().toUpperCase(); }

  function buildModal() {
    const overlay = document.createElement('div');
    overlay.id = '__species_manage_overlay';
    overlay.setAttribute('role','dialog');
    overlay.setAttribute('aria-modal','true');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '2147483650';
    overlay.style.background = 'rgba(10,10,12,0.6)';

  const card = document.createElement('div');
  // Make form 50% width (viewport) and 80% height as requested, but remain responsive
  card.style.width = '50vw';
  card.style.maxWidth = '96%';
  card.style.height = '80vh';
  card.style.maxHeight = '96%';
  card.style.overflow = 'auto';
    card.style.background = '#0f0f10';
    card.style.color = '#fff';
    card.style.borderRadius = '8px';
    card.style.padding = '12px';
    card.style.boxShadow = '0 8px 30px rgba(0,0,0,0.6)';
    card.style.fontFamily = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial';

    // Title row
    const titleRow = document.createElement('div');
    titleRow.style.display = 'flex';
    titleRow.style.justifyContent = 'space-between';
    titleRow.style.alignItems = 'center';
    titleRow.style.marginBottom = '8px';
    const title = document.createElement('div');
    title.textContent = 'Manage Species';
    title.style.fontSize = '16px';
    title.style.fontWeight = '600';
    titleRow.appendChild(title);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.style.background = 'transparent';
    closeBtn.style.border = '0';
    closeBtn.style.color = '#fff';
    closeBtn.style.fontSize = '18px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.setAttribute('aria-label','Close species manager');
    titleRow.appendChild(closeBtn);
    card.appendChild(titleRow);

    // Two-column layout: left = search & single-edit, right = bulk upload / download
    const container = document.createElement('div');
    container.style.display = 'grid';
    container.style.gridTemplateColumns = '1fr 1fr';
    container.style.gap = '10px';

    // LEFT: Search + single record editor
    const left = document.createElement('div');

    // search box
    const searchWrap = document.createElement('div');
    searchWrap.style.marginBottom = '8px';
    const searchLabel = document.createElement('label');
    searchLabel.textContent = 'Search (key or common)';
    searchLabel.style.fontSize = '12px';
    searchLabel.style.display = 'block';
    searchLabel.style.marginBottom = '4px';
    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'meta-input';
    searchInput.style.width = '100%';
    searchInput.style.padding = '8px';
    searchInput.style.borderRadius = '6px';
    searchInput.style.border = '1px solid rgba(255,255,255,0.06)';
    searchInput.style.background = '#111';
    searchInput.style.color = '#fff';
    searchWrap.appendChild(searchLabel);
    searchWrap.appendChild(searchInput);
    left.appendChild(searchWrap);

    // Editable single-row grid (key/common/scientific)
    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = '1fr 1fr';
    grid.style.gap = '8px';

    function labeledInput(id, labelText, placeholder) {
      const w = document.createElement('div');
      const lab = document.createElement('label'); lab.textContent = labelText; lab.style.fontSize='12px'; lab.style.display='block'; lab.style.marginBottom='4px';
      const inp = document.createElement('input'); inp.type='text'; inp.id = id; inp.placeholder = placeholder; inp.style.width='100%'; inp.style.padding='8px'; inp.style.borderRadius='6px'; inp.style.border='1px solid rgba(255,255,255,0.06)'; inp.style.background='#111'; inp.style.color='#fff';
      w.appendChild(lab); w.appendChild(inp); return w;
    }

  const keyWrap = labeledInput('__sp_key', 'Key', 'e.g. ABCD');
  const commonWrap = labeledInput('__sp_common', 'Common name', 'Common name');
  const sciWrap = labeledInput('__sp_scientific', 'Scientific name', 'Scientific name');
    // Arrange: key + common on first row, scientific spans full width below
    const topRow = document.createElement('div'); topRow.style.display='grid'; topRow.style.gridTemplateColumns='1fr 1fr'; topRow.style.gap='8px'; topRow.appendChild(keyWrap); topRow.appendChild(commonWrap);
    grid.appendChild(topRow);
    const sciRow = document.createElement('div'); sciRow.appendChild(sciWrap); grid.appendChild(sciRow);

  left.appendChild(grid);

  // grab direct references to inputs (use these instead of document.getElementById)
  const keyInput = keyWrap.querySelector('input');
  const commonInput = commonWrap.querySelector('input');
  const sciInput = sciWrap.querySelector('input');
  // style sizes: key smaller, common & scientific larger
  keyInput.style.maxWidth = '120px';
  commonInput.style.width = '100%'; commonInput.style.padding = '10px';
  sciInput.style.width = '100%'; sciInput.style.padding = '10px';

    // single record action buttons: Update, Create new, Delete
    const singleActions = document.createElement('div'); singleActions.style.display='flex'; singleActions.style.gap='8px'; singleActions.style.marginTop='8px'; singleActions.style.flexWrap='wrap';
  const updateBtn = document.createElement('button'); updateBtn.type='button'; updateBtn.textContent='Update'; updateBtn.className='btn'; updateBtn.style.background='#1565c0'; updateBtn.style.border='1px solid rgba(0,0,0,0.15)'; updateBtn.style.color='#fff'; updateBtn.disabled = true;
  const createBtn = document.createElement('button'); createBtn.type='button'; createBtn.textContent='Create new'; createBtn.className='btn'; createBtn.style.background='#2196F3'; createBtn.style.color='#fff'; createBtn.disabled=false;
  const deleteBtn = document.createElement('button'); deleteBtn.type='button'; deleteBtn.textContent='Delete'; deleteBtn.className='btn'; deleteBtn.style.background='#b43a3a'; deleteBtn.style.color='#fff'; deleteBtn.disabled=false;
    singleActions.appendChild(updateBtn); singleActions.appendChild(createBtn); singleActions.appendChild(deleteBtn);
    left.appendChild(singleActions);

    // quick status area
    const status = document.createElement('div'); status.id='__sp_manage_status'; status.style.marginTop='8px'; status.style.fontSize='13px'; status.style.color='#cde'; left.appendChild(status);

    // RIGHT: Bulk upload/Download
    const right = document.createElement('div');
    // bulk upload label
    const bulkLabel = document.createElement('label'); bulkLabel.textContent='Bulk upload (CSV/TSV)'; bulkLabel.style.display='block'; bulkLabel.style.fontSize='12px'; bulkLabel.style.marginBottom='6px';
  const fileInput = document.createElement('input'); fileInput.type='file'; fileInput.accept='.csv,.txt,.tsv,text/csv,text/tab-separated-values,text/plain'; fileInput.id='__sp_bulk_file'; fileInput.style.display='block';
    right.appendChild(bulkLabel); right.appendChild(fileInput);

    // replace/merge option
    const optWrap = document.createElement('div'); optWrap.style.marginTop='8px'; optWrap.style.display='flex'; optWrap.style.gap='8px';
    const rLabel = document.createElement('label'); const rRadio = document.createElement('input'); rRadio.type='radio'; rRadio.name='__sp_bulk_mode'; rRadio.value='merge'; rRadio.checked = true; rLabel.appendChild(rRadio); rLabel.appendChild(document.createTextNode(' Merge (update existing by key, add new)'));
    const pLabel = document.createElement('label'); const pRadio = document.createElement('input'); pRadio.type='radio'; pRadio.name='__sp_bulk_mode'; pRadio.value='replace'; pLabel.appendChild(pRadio); pLabel.appendChild(document.createTextNode(' Replace (replace all with uploaded)'));
    optWrap.appendChild(rLabel); optWrap.appendChild(pLabel); right.appendChild(optWrap);

  const bulkActions = document.createElement('div'); bulkActions.style.display='flex'; bulkActions.style.gap='8px'; bulkActions.style.marginTop='8px';
  const bulkBtn = document.createElement('button'); bulkBtn.type='button'; bulkBtn.textContent='Bulk upload'; bulkBtn.className='btn'; bulkBtn.style.background='#2a2f36'; bulkBtn.style.color='#fff';
  const downloadBtn = document.createElement('button'); downloadBtn.type='button'; downloadBtn.textContent='Download species'; downloadBtn.className='btn'; downloadBtn.style.background='#2196F3'; downloadBtn.style.color='#fff';
  const exportJsBtn = document.createElement('button'); exportJsBtn.type='button'; exportJsBtn.textContent='Export to species-data.js'; exportJsBtn.className='btn'; exportJsBtn.style.background='#0b66ff'; exportJsBtn.style.color='#fff';
  bulkActions.appendChild(bulkBtn); bulkActions.appendChild(downloadBtn); bulkActions.appendChild(exportJsBtn); right.appendChild(bulkActions);

    // small guidance
    const help = document.createElement('div'); help.style.marginTop='10px'; help.style.fontSize='12px'; help.style.color='#cbd'; help.textContent = 'Upload format: key,common,scientific (header optional). Keys are case-insensitive and must be unique.';
    right.appendChild(help);

    container.appendChild(left); container.appendChild(right);
    card.appendChild(container);
    overlay.appendChild(card);

    // wiring helpers
  function setStatus(msg, isErr) { status.textContent = msg || ''; status.style.color = isErr ? '#fbb' : '#bfe'; }

    function findRecordByKey(records, key) { const nk = normalizeKey(key); return (records||[]).find(r => normalizeKey(r.key) === nk); }

    // when search input changes, populate fields with first matched record
    function onSearchChange() {
      const qv = (searchInput.value || '').trim();
      if (!qv) { keyInput.value=''; commonInput.value=''; sciInput.value=''; updateBtn.disabled = true; lastLoaded = { key:'', common:'', scientific:'' }; return; }
      const records = loadRecords();
      const found = records.find(r => (r.key && r.key.toLowerCase() === qv.toLowerCase()) || (r.common && r.common.toLowerCase().includes(qv.toLowerCase())));
      if (found) {
        keyInput.value = found.key || '';
        commonInput.value = found.common || '';
        sciInput.value = found.scientific || '';
        setStatus('Loaded matching species: ' + (found.common || found.key));
        lastLoaded = { key: found.key||'', common: found.common||'', scientific: found.scientific||'' };
        updateBtn.disabled = true; // no changes yet
      } else {
        // clear fields but allow create
        keyInput.value = qv;
        commonInput.value = '';
        sciInput.value = '';
        lastLoaded = { key: '', common: '', scientific: '' };
        setStatus('No matching species. You may create a new one.');
        updateBtn.disabled = true;
      }
    }

    searchInput.addEventListener('input', debounce(onSearchChange, 160));

    // enable update button when any field changes relative to loaded record
    let lastLoaded = { key: '', common: '', scientific: '' };
    function recordFieldsChanged() {
      const k = (keyInput && keyInput.value) ? keyInput.value : '';
      const c = (commonInput && commonInput.value) ? commonInput.value : '';
      const s = (sciInput && sciInput.value) ? sciInput.value : '';
      return k !== (lastLoaded.key||'') || c !== (lastLoaded.common||'') || s !== (lastLoaded.scientific||'');
    }

    function refreshLastLoadedFromKey(key) {
      const records = loadRecords();
      const rec = findRecordByKey(records, key) || { key: '', common: '', scientific: '' };
      lastLoaded = { key: rec.key || '', common: rec.common || '', scientific: rec.scientific || '' };
    }

    [keyInput, commonInput, sciInput].forEach(el => {
      if (!el) return;
      el.addEventListener('input', () => {
        // update button state
        const changed = recordFieldsChanged();
        updateBtn.disabled = !changed;
      });
    });

    // Helper: apply update
    updateBtn.addEventListener('click', () => {
      try {
    const k = (keyInput.value || '').trim();
        if (!k) { setStatus('Key is required for update.', true); return; }
        const records = loadRecords();
        const existing = findRecordByKey(records, k);
        if (!existing) { setStatus('Species not found for update. Use Create new to add.', true); return; }
        // check new key collision (if key field was changed to another key)
        const newKey = normalizeKey(k);
        const other = (records||[]).find(r => normalizeKey(r.key) === newKey && r !== existing);
        if (other) { setStatus('Species already exists.', true); return; }
  existing.key = k;
  existing.common = (commonInput.value || '').trim();
  existing.scientific = (sciInput.value || '').trim();
        saveRecords(records);
        refreshLastLoadedFromKey(k);
        updateBtn.disabled = true;
        setStatus('Species updates successfully.');
      } catch (e) { console.error(e); setStatus('Update failed: ' + String(e), true); }
    });

    // Create new
    createBtn.addEventListener('click', () => {
      try {
        const k = (keyInput.value || '').trim();
        if (!k) { setStatus('Key is required to create new species.', true); return; }
        const records = loadRecords();
        if (findRecordByKey(records, k)) { setStatus('Species already exists.', true); return; }
          const newRec = { key: k, common: (commonInput.value || '').trim(), scientific: (sciInput.value || '').trim() };
        records.push(newRec);
        saveRecords(records);
        refreshLastLoadedFromKey(k);
        updateBtn.disabled = true;
        setStatus('Species created successfully.');
      } catch (e) { console.error(e); setStatus('Create failed: ' + String(e), true); }
    });

    // Delete
    deleteBtn.addEventListener('click', () => {
      try {
    const k = (keyInput.value || '').trim();
        if (!k) { setStatus('Key is required to delete species.', true); return; }
        let records = loadRecords();
        const nk = normalizeKey(k);
        const idx = records.findIndex(r => normalizeKey(r.key) === nk);
        if (idx === -1) { setStatus('Species not available.', true); return; }
        records.splice(idx,1);
        saveRecords(records);
        // clear fields
  keyInput.value=''; commonInput.value=''; sciInput.value='';
        refreshLastLoadedFromKey('');
        updateBtn.disabled = true;
        setStatus('Species deleted successfully.');
      } catch (e) { console.error(e); setStatus('Delete failed: ' + String(e), true); }
    });

    // Bulk upload
    bulkBtn.addEventListener('click', async () => {
      try {
        const f = fileInput.files && fileInput.files[0];
        if (!f) { setStatus('No file selected for bulk upload.', true); return; }
        const text = await readFileAsText(f);
        const parsed = parseTableText(text);
        if (!parsed || !parsed.rows || parsed.rows.length === 0) { setStatus('Uploaded file empty or malformed.', true); return; }
        // Expect first three columns to be key, common, scientific or headers
  const rows = parsed.rows.map(r => r.slice(0,3));
        const mapped = rows.map(r => ({ key: (r[0]||'').trim(), common: (r[1]||'').trim(), scientific: (r[2]||'').trim() })).filter(rr => (rr.key || rr.common || rr.scientific));
        if (mapped.length === 0) { setStatus('No usable rows found in upload.', true); return; }
        const mode = (document.querySelector('input[name="__sp_bulk_mode"]:checked') || { value: 'merge' }).value;
        let records = loadRecords();
        if (mode === 'replace') {
          // replace all with mapped, but normalize keys
          records = mapped.map(m => ({ key: m.key || m.common || generateKeyFromName(m.common || m.scientific || 'SP'), common: m.common || '', scientific: m.scientific || '' }));
        } else {
          // merge: update by key (if present), else add
          const byKey = {};
          records.forEach(r => { byKey[normalizeKey(r.key)] = r; });
          mapped.forEach(m => {
            const nk = normalizeKey(m.key || '');
            if (nk && byKey[nk]) {
              byKey[nk].common = m.common || byKey[nk].common;
              byKey[nk].scientific = m.scientific || byKey[nk].scientific;
            } else {
              const newk = m.key || m.common || generateKeyFromName(m.common || m.scientific || 'SP');
              records.push({ key: newk, common: m.common || '', scientific: m.scientific || '' });
            }
          });
        }
  saveRecords(records);
  setStatus('Species updated.');
      } catch (e) { console.error(e); setStatus('Bulk upload failed: ' + String(e), true); }
    });

    // Download CSV
  downloadBtn.addEventListener('click', () => {
      try {
        const records = loadRecords();
        const lines = ['key,common,scientific'];
        records.forEach(r => lines.push([escapeCsv(r.key || ''), escapeCsv(r.common || ''), escapeCsv(r.scientific || '')].join(',')));
        const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'species_list.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000);
        setStatus('Download ready.');
      } catch (e) { console.error(e); setStatus('Download failed: ' + String(e), true); }
    });

    // Export species-data.js (download a JS file that sets window.__speciesRecords)
    exportJsBtn.addEventListener('click', () => {
      try {
        const records = loadRecords();
        const content = 'window.__speciesRecords = ' + JSON.stringify(records, null, 2) + ';\n';
        const blob = new Blob([content], { type: 'application/javascript;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'species-data.js'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000);
        setStatus('species-data.js download ready. Replace your repository file to persist changes.');
      } catch (e) { console.error(e); setStatus('Export failed: ' + String(e), true); }
    });

    // Helpers
    function generateKeyFromName(name) {
      const n = (name || '').replace(/[^A-Za-z0-9]/g,'').toUpperCase().slice(0,4) || 'SP';
      return n + Math.floor(Math.random()*9000 + 1000);
    }

    function escapeCsv(s) { return '"' + String(s||'').replace(/"/g,'""') + '"'; }

    function readFileAsText(file) {
      return new Promise((resolve, reject) => {
        const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error('Read failed')); r.readAsText(file, 'utf-8');
      });
    }

    function parseTableText(text) {
      if (!text) return null;
      text = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
      const sep = text.indexOf('\t') >= 0 ? '\t' : (text.indexOf(',') >= 0 ? ',' : ',');
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      if (!lines.length) return null;
      const rows = lines.map(l => {
        // naive CSV/TSV split that handles simple quoted values
        const out = [];
        let cur = '', inQ = false;
        for (let i=0;i<l.length;i++){
          const ch = l[i];
          if (ch === '"') { if (inQ && l[i+1] === '"') { cur += '"'; i++; } else { inQ = !inQ; } continue; }
          if (!inQ && l.substr(i, sep.length) === sep) { out.push(cur); cur = ''; i += sep.length-1; continue; }
          cur += ch;
        }
        out.push(cur);
        return out;
      });
      // if first row looks like header (non-alphanumeric in first cell or contains letters), keep rows as-is but caller will slice
      return { rows: rows, headers: [] };
    }

    function debounce(fn, ms) { let t = null; return function(...a){ clearTimeout(t); t = setTimeout(()=>fn.apply(this,a), ms); }; }

    // close
    closeBtn.addEventListener('click', () => { overlay.remove(); });
    document.addEventListener('keydown', function escHandler(e){ if (e.key === 'Escape') { if (document.getElementById('__species_manage_overlay')) document.getElementById('__species_manage_overlay').remove(); } });

    return overlay;
  }

  function openModal() {
    const existing = document.getElementById('__species_manage_overlay');
    if (existing) return;
    const modal = buildModal();
    document.body.appendChild(modal);
  }

  // wire button
  function init() {
    const btn = q(BTN_ID);
    if (!btn) {
      // wait for button if DOM not yet present
      const mo = new MutationObserver((muts, obs) => { if (q(BTN_ID)) { obs.disconnect(); init(); } });
      mo.observe(document.body, { childList:true, subtree:true });
      return;
    }
    btn.addEventListener('click', (ev) => { ev.preventDefault(); openModal(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

})();
