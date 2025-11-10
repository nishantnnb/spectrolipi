// download_metadata.js
// Defensive metadata downloader wired to button id = 'saveMetaBtn' and file input id = 'file'.
// Mirrors metadata formatting in save_annotations.js and disables previous global single-save if present.

(function () {
  if (window.__downloadMetadataInit) return;
  window.__downloadMetadataInit = true;

  const SAVE_BTN_ID = 'saveMetaBtn';
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

  function formatDateAndTimeFromISO(iso) {
    if (!iso) return { date: '', time: '' };
    try {
      const s = String(iso).trim();
      if (s === '') return { date: '', time: '' };
      const d = new Date(s);
      if (isNaN(d)) return { date: '', time: '' };
      const pad = (n) => String(n).padStart(2, '0');
      const dd = pad(d.getDate());
      const mm = pad(d.getMonth() + 1);
      const yyyy = d.getFullYear();
      const hh = pad(d.getHours());
      const min = pad(d.getMinutes());
      return { date: `${dd}-${mm}-${yyyy}`, time: `${hh}:${min}` };
    } catch (e) {
      return { date: '', time: '' };
    }
  }

  function normalizeComments(s) {
    if (s === null || s === undefined) return '';
    try {
      return String(s).replace(/\r\n|\r|\n/g, ' ').replace(/\s+/g, ' ').trim();
    } catch (e) {
      return String(s).replace(/\r\n|\r|\n/g, ' ');
    }
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

  function buildMetadataTSV_usingLabels(meta) {
    meta = meta || {};
    const latitude = meta.latitude !== undefined && meta.latitude !== null ? cellString(meta.latitude) : '';
    const longitude = meta.longitude !== undefined && meta.longitude !== null ? cellString(meta.longitude) : '';

    // ONLY use meta.datetime (no fallback)
    const dtIso = (meta.datetime !== undefined && meta.datetime !== null && String(meta.datetime).trim() !== '') ? String(meta.datetime).trim() : null;
    const dt = formatDateAndTimeFromISO(dtIso);

    const typeOfRecording = meta.type || '';
    const targetSpecies = meta.species || '';
    // Determine scientific name: only include if metadata explicitly provides it
    // or if a common name is present in the metadata row (do not fall back to global UI selection).
    const scientificName = (function(){
      try {
        // Prefer explicit meta.scientific if present
        if (meta && meta.scientific) return String(meta.scientific);
        const recs = Array.isArray(window.__speciesRecords) ? window.__speciesRecords : [];
        // Only attempt to map common -> scientific if a Target species (common name) is present in this metadata row
        if (targetSpecies) {
          const rec2 = recs.find(r => String((r.common||'')).trim() === String(targetSpecies).trim());
          if (rec2) return rec2.scientific || '';
        }
      } catch (e) {}
      return '';
    })();
    const recorder = meta.recorder || '';
    const microphone = meta.microphone || '';
    const accessories = meta.accessories || '';
  // rating is stored in metadata.js as a number (1-5) or null
  const rating = meta.rating !== undefined && meta.rating !== null ? cellString(meta.rating) : '';

    let contributors = '';
    if (Array.isArray(meta.contributors)) {
      contributors = meta.contributors.map(c => String(c).trim()).filter(Boolean).join(', ');
    } else if (meta.contributors) {
      contributors = cellString(meta.contributors);
    }

    const comments = normalizeComments(meta.comments || '');

    // Include File as first column and Scientific name next to Target species
    const fileInputEl = q(FILE_INPUT_ID);
    const exportFileName = (fileInputEl && fileInputEl.files && fileInputEl.files.length > 0 && fileInputEl.files[0] && fileInputEl.files[0].name) ? String(fileInputEl.files[0].name) : '';

    const headers = [
      'File',
      'Latitude',
      'Longitude',
      'Recording date',
      'Recording time',
      'Rating',
      'Type of recording',
      'Target species',
      'Scientific name',
      'Recorder',
      'Microphone',
      'Accessories',
      'Contributor(s)',
      'Overall comments'
    ];

    const row = [
      exportFileName,
      latitude,
      longitude,
      dt.date,
      dt.time,
      cellString(rating),
      cellString(typeOfRecording),
      cellString(targetSpecies),
      cellString(scientificName),
      cellString(recorder),
      cellString(microphone),
      cellString(accessories),
      cellString(contributors),
      cellString(comments)
    ];

    return { content: headers.join('\t') + '\n' + row.join('\t') + '\n', filenameSuffix: '_Matadata' };
  }

  // Disable legacy single-button saver if present so it does not download both files
  try {
    if (window.__saveAnnotations && typeof window.__saveAnnotations.saveNow === 'function') {
      // replace with noop but keep ref for debug
      window.__saveAnnotations.__disabledBy = 'download_metadata.js';
      window.__saveAnnotations.saveNow = function () { console.warn('Legacy single-button saver disabled by download_metadata.js'); };
    }
  } catch (e) {}

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

  function wireButtonOnce() {
    const btn = q(SAVE_BTN_ID);
    if (!btn) return;
    if (btn.__downloadMetaWired) return;
    btn.addEventListener('click', function (ev) {
      try { ev && ev.preventDefault && ev.preventDefault(); } catch (e) {}
      if (btn.disabled) return;
      try {
        const metadata = window.__lastMetadata || {};
        const base = fileBaseName();
        const md = buildMetadataTSV_usingLabels(metadata);
        const mdBlob = new Blob([md.content], { type: 'text/plain;charset=utf-8' });
        const mdFilename = `${base}${md.filenameSuffix}.txt`;
        downloadBlob(mdBlob, mdFilename);
          // Per strict backup policy: purge all metadata backups after successful export
          try { Object.keys(localStorage).forEach(k => { if (k && k.startsWith('metadata_backup::')) { try { localStorage.removeItem(k); } catch(e){} } }); } catch(e){}
      } catch (err) {
        console.error('Download metadata failed', err);
        try { window.alert('Download metadata failed. See console for details.'); } catch (e) {}
      }
    }, true);
    btn.__downloadMetaWired = true;
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
  window.__downloadMetadata = {
    downloadNow: function () {
      const metadata = window.__lastMetadata || {};
      const base = fileBaseName();
      const md = buildMetadataTSV_usingLabels(metadata);
      const mdBlob = new Blob([md.content], { type: 'text/plain;charset=utf-8' });
      const mdFilename = `${base}${md.filenameSuffix}.txt`;
      downloadBlob(mdBlob, mdFilename);
    }
  };
})();