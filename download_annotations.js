// download_annotations.js
// Defensive annotations downloader wired to button id = 'saveAnnoBtn' and file input id = 'file'.
// Mirrors annotations formatting in save_annotations.js; reads from globalThis._annotations.getAll().

(function () {
  if (window.__downloadAnnotationsInit) return;
  window.__downloadAnnotationsInit = true;

  const SAVE_BTN_ID = 'saveAnnoBtn';
  const FILE_INPUT_ID = 'file';

  function q(id) { return document.getElementById(id); }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function cellString(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') {
      try { return JSON.stringify(v); } catch (e) { return String(v); }
    }
    return String(v);
  }

  function round4(v) {
    if (v === null || v === undefined || v === '') return '';
    const n = Number(v);
    if (!isFinite(n)) return '';
    return n.toFixed(4);
  }

  const requiredCols = [
    'File',
    'Selection',
    'View',
    'Channel',
    'Begin Time (s)',
    'End Time (s)',
    'Low Freq (Hz)',
    'High Freq (Hz)',
    'Common name',
    'Scientific name',
    'Notes'
  ];

  const aliasSkip = new Set([
    'id',
    'beginTime', 'begin_time', 'begin',
    'endTime', 'end_time', 'end',
    'lowFreq', 'low_freq', 'low',
    'highFreq', 'high_freq', 'high',
    'species',
  'scientificName',
    'file','File',
    'notes', 'note',
    'Selection','View','Channel','Begin Time (s)','End Time (s)','Low Freq (Hz)','High Freq (Hz)','Species','Notes',
    // Internal/admin fields we should never export
    'needsMetadata', 'sccTemplate', 'runNo', 'sccScore'
  ]);


  function buildAnnotationsTSV(annotations) {
    annotations = Array.isArray(annotations) ? annotations : [];

    // Determine selected input filename (full, with extension) to include as first column
    const fileInputEl = q(FILE_INPUT_ID);
    const exportFileName = (fileInputEl && fileInputEl.files && fileInputEl.files.length > 0 && fileInputEl.files[0] && fileInputEl.files[0].name) ? String(fileInputEl.files[0].name) : '';

    const extras = [];
    const seen = new Set();
    annotations.forEach(a => {
      if (!a || typeof a !== 'object') return;
      Object.keys(a).forEach(k => {
        if (aliasSkip.has(k)) return;
        if (seen.has(k)) return;
        seen.add(k);
        extras.push(k);
      });
    });

  // Remove _select from both requiredCols and extras
  const header = requiredCols.concat(extras).filter(k => k !== '_select').join('\t');
    const lines = [header];

    annotations.forEach((a) => {
      // Use real Selection value from row, not index
      const sel = (a && Object.prototype.hasOwnProperty.call(a, 'Selection')) ? String(a.Selection) : '';
      const view = '1';
      const channel = '1';

      const beginRaw = (a && Object.prototype.hasOwnProperty.call(a, 'beginTime')) ? a.beginTime :
                       (a && Object.prototype.hasOwnProperty.call(a, 'begin')) ? a.begin : '';
      const endRaw = (a && Object.prototype.hasOwnProperty.call(a, 'endTime')) ? a.endTime :
                     (a && Object.prototype.hasOwnProperty.call(a, 'end')) ? a.end : '';
      const lowRaw = (a && Object.prototype.hasOwnProperty.call(a, 'lowFreq')) ? a.lowFreq :
                     (a && Object.prototype.hasOwnProperty.call(a, 'low')) ? a.low : '';
      const highRaw = (a && Object.prototype.hasOwnProperty.call(a, 'highFreq')) ? a.highFreq :
                      (a && Object.prototype.hasOwnProperty.call(a, 'high')) ? a.high : '';

      const begin = round4(beginRaw);
      const end = round4(endRaw);
      const low = round4(lowRaw);
      const high = round4(highRaw);

      const species = (a && Object.prototype.hasOwnProperty.call(a, 'species')) ? cellString(a.species) : '';
  const scientificName = (a && Object.prototype.hasOwnProperty.call(a, 'scientificName')) ? cellString(a.scientificName) : '';
      const notes = (a && Object.prototype.hasOwnProperty.call(a, 'notes')) ? cellString(a.notes) : '';

  // Remove _select column if present in extras and row data
  const extrasRow = extras.filter(k => k !== '_select').map(k => (a && Object.prototype.hasOwnProperty.call(a, k)) ? cellString(a[k]) : '');
  lines.push([exportFileName, sel, view, channel, begin, end, low, high, species, scientificName, notes].concat(extrasRow).join('\t'));
    });

    return { content: lines.join('\n') + '\n', filenameSuffix: '_annotations' };
  }

  function fileBaseName() {
    try {
      const f = q(FILE_INPUT_ID);
      if (f && f.files && f.files.length > 0 && f.files[0].name) {
        const name = f.files[0].name;
        const idx = name.lastIndexOf('.');
        return idx > 0 ? name.slice(0, idx) : name;
      }
    } catch (e) {}
    return 'export';
  }

  function updateSaveBtnState() {
    const btn = q(SAVE_BTN_ID);
    const file = q(FILE_INPUT_ID);
    if (!btn) return;
    try {
      const hasFile = file && file.files && file.files.length > 0;
      btn.disabled = !hasFile;
    } catch (e) {
      btn.disabled = true;
    }
  }

  function getAnnotations() {
    if (globalThis._annotations && typeof globalThis._annotations.getAll === 'function') {
      try { return globalThis._annotations.getAll() || []; } catch (e) { console.warn('Failed to read _annotations.getAll()', e); return []; }
    }
    if (Array.isArray(window._annotationsArray)) return window._annotationsArray;
    return [];
  }

  // Disable legacy single-button saver if present
  try {
    if (window.__saveAnnotations && typeof window.__saveAnnotations.saveNow === 'function') {
      window.__saveAnnotations.__disabledBy = 'download_annotations.js';
      window.__saveAnnotations.saveNow = function () { console.warn('Legacy single-button saver disabled by download_annotations.js'); };
    }
  } catch (e) {}

  function wireButtonOnce() {
    const btn = q(SAVE_BTN_ID);
    if (!btn) return;
    if (btn.__downloadAnnoWired) return;
    btn.addEventListener('click', function (ev) {
      try { ev && ev.preventDefault && ev.preventDefault(); } catch (e) {}
      if (btn.disabled) return;
      try {
        const annotations = getAnnotations();
        const base = fileBaseName();
        const an = buildAnnotationsTSV(annotations);
        const anBlob = new Blob([an.content], { type: 'text/plain;charset=utf-8' });
        const anFilename = `${base}${an.filenameSuffix}.txt`;
        downloadBlob(anBlob, anFilename);
        // After successful export, purge ALL backups (strict policy)
        try {
          const keys = Object.keys(localStorage);
          keys.forEach(k => { if (k.startsWith('annotations_backup::')) { try { localStorage.removeItem(k); } catch(e){} } });
        } catch (e) { console.warn('Backup purge after export failed', e); }
      } catch (err) {
        console.error('Download annotations failed', err);
        try { window.alert('Download annotations failed. See console for details.'); } catch (e) {}
      }
    }, true);
    btn.__downloadAnnoWired = true;
  }

  function observeFileInput() {
    const file = q(FILE_INPUT_ID);
    if (!file) {
      setTimeout(observeFileInput, 120);
      return;
    }
    updateSaveBtnState();
    file.addEventListener('change', () => updateSaveBtnState(), true);
    const mo = new MutationObserver(() => updateSaveBtnState());
    mo.observe(file, { attributes: true, attributeFilter: ['value'] });
  }

  function init() {
    wireButtonOnce();
    observeFileInput();
    setTimeout(() => updateSaveBtnState(), 200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else init();

  // Debug API
  window.__downloadAnnotations = {
    downloadNow: function () {
      const annotations = getAnnotations();
      const base = fileBaseName();
      const an = buildAnnotationsTSV(annotations);
      const anBlob = new Blob([an.content], { type: 'text/plain;charset=utf-8' });
      const anFilename = `${base}${an.filenameSuffix}.txt`;
      downloadBlob(anBlob, anFilename);
    }
  };
})();