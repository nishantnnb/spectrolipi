// xc.js - Xeno-canto integration (export + upload + settings)
(function(){
  const STORAGE_KEY = 'xc.settings.v1';
  const DEFAULT_SETTINGS = {
    apiKey: '',
    annotatorName: '',
    annotatorId: '',
    // endpoint: 'https://dev.xeno-canto.org/api/3/upload/annotation-set'
    endpoint: 'https://xeno-canto.org/api/3/upload/annotation-set'
  };
  let __xcSettings = loadSettings();

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...(parsed || {}) };
    } catch (e) {
      return { ...DEFAULT_SETTINGS };
    }
  }
  function persistSettings(next) {
    __xcSettings = { ...DEFAULT_SETTINGS, ...next };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(__xcSettings)); } catch (e) {}
    return { ...__xcSettings };
  }
  function getSettings() { return { ...__xcSettings }; }

  function getMetadata() {
    if (window.__lastMetadata) return window.__lastMetadata;
    if (typeof window.__openMetadataModal === 'function') {
      try {
        const modal = window.__openMetadataModal();
        if (modal && typeof modal.getValues === 'function') return modal.getValues();
      } catch(e){}
    }
    return {};
  }
  function getAnnotations() {
    if (globalThis._annotations && typeof globalThis._annotations.getAll === 'function') {
      try { return globalThis._annotations.getAll() || []; } catch (e) { return []; }
    }
    if (window.annotationGrid && typeof window.annotationGrid.getData === 'function') {
      try { return window.annotationGrid.getData() || []; } catch (e) { return []; }
    }
    return [];
  }

  function safeField(val) {
    return (val === 0 || val === false) ? val : (val != null && val !== '' ? val : '');
  }

  function buildAnnotationSet() {
    const meta = getMetadata() || {};
    const anns = getAnnotations();
    const settings = getSettings();
    const xcFileNo = meta['xcfileno'] || meta['Xeno-canto file no'] || meta['Xeno-canto file no:'] || meta['meta-xcfileno'] || '';
    if (!xcFileNo || !String(xcFileNo).trim()) {
      return { ok: false, reason: "Please fill at least 'Xeno-canto file no' in metadata before continuing." };
    }
    if (!anns || !anns.length) {
      return { ok: false, reason: 'Please create annotations before exporting or uploading.' };
    }
    const projectName = meta['project'] || meta['Project'] || meta['meta-project'] || meta['project_name'] || '';
    const annotator = safeField(meta['annname'] || meta['Name of the Annotator'] || meta['meta-annname'] || meta['annotator'] || settings.annotatorName);
    const annotatorXCId = safeField(meta['xcannid'] || meta['Xeno-canto ID of the Annotator'] || meta['meta-xcannid'] || meta['annotator_xc_id'] || settings.annotatorId);
    if (!annotatorXCId) {
      return { ok: false, reason: 'Annotator Xeno-canto ID is required. Please set it via metadata or Xeno-canto Settings.' };
    }
    const taxonCoverage = meta['taxon_coverage'] || meta['taxonCoverage'] || '';
    const completeness = meta['completeness'] || meta['set_completeness'] || '';

    const annotations = anns.map(row => ({
      annotation_xc_id: '',
      annotation_source_id: safeField(row.Selection || row.selection || row['Selection']),
      sound_file: '',
      xc_nr: safeField(xcFileNo),
      annotator: safeField(annotator),
      annotator_xc_id: safeField(annotatorXCId),
      frequency_high: safeField(row.highFreq ?? row.highfreq ?? row['High Freq (Hz)']),
      frequency_low: safeField(row.lowFreq ?? row.lowfreq ?? row['Low Freq (Hz)']),
      start_time: (row.beginTime ?? row['Begin Time (s)']) === 0 ? 0 : safeField(row.beginTime ?? row['Begin Time (s)']),
      end_time: (row.endTime ?? row['End Time (s)']) === 0 ? 0 : safeField(row.endTime ?? row['End Time (s)']),
      scientific_name: safeField(row.scientificName ?? row['Scientific Name']),
      sound_type: '',
      date_identified: '',
      sex: '',
      life_stage: '',
      animal_seen: '',
      playback_used: '',
      collection_date: '',
      collection_specimen: '',
      temperature: '',
      annotation_remarks: safeField(row.notes ?? row['Notes']),
      signal_noise_ratio: '',
      overlap: '',
      annotation_speed_ratio: ''
    }));

    const payload = {
      set_source: '',
      set_uri: '',
      set_name: meta.setname || '',
      annotation_software_name_and_version: 'Spectrolipi',
      set_creator: meta.setcreator || '',
      set_creator_id: '',
      set_owner: '',
      set_license: meta.set_license || '',
      project_uri: '',
      project_name: projectName,
      funding: '',
      scope: [
        {
          taxon_coverage: taxonCoverage,
          completeness: completeness
        }
      ],
      set_creation_date: '',
      annotations
    };
    return { ok: true, data: payload, meta: { annotationsCount: annotations.length, xcFileNo, annotatorXCId } };
  }

  function downloadJSON(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  function exportXenoCantoJSON() {
    const built = buildAnnotationSet();
    if (!built.ok) {
      alert(built.reason || 'Unable to build Xeno-canto JSON.');
      if (/metadata/i.test(built.reason || '')) {
        try { window.__openMetadataModal && window.__openMetadataModal(); } catch (e) {}
      }
      return;
    }
    let exportFileName = 'xeno-canto-export.json';
    try {
      const fileInput = document.getElementById('file');
      if (fileInput && fileInput.files && fileInput.files.length > 0) {
        const origName = fileInput.files[0].name;
        exportFileName = origName.replace(/\.[^.]+$/, '') + '.json';
      }
    } catch (e) {}
    downloadJSON(built.data, exportFileName);
  }

  function ensureSettingsModal() {
    if (document.getElementById('xcSettingsBackdrop')) return;
    const backdrop = document.createElement('div');
    backdrop.id = 'xcSettingsBackdrop';
    backdrop.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(15,15,20,0.7);z-index:2147483651;align-items:center;justify-content:center;';
    const modal = document.createElement('div');
    modal.id = 'xcSettingsModal';
    modal.setAttribute('role','dialog');
    modal.setAttribute('aria-modal','true');
    modal.style.cssText = 'width:420px;max-width:90%;background:#0f1117;color:#fff;border-radius:10px;padding:16px;box-shadow:0 12px 36px rgba(0,0,0,0.55);';
    modal.innerHTML = [
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">',
      '<h3 style="margin:0;font-size:1rem;">Xeno-canto Settings</h3>',
      '<button type="button" id="xcSettingsClose" aria-label="Close settings" style="background:transparent;border:0;color:#bbb;font-size:20px;line-height:1;cursor:pointer;">&times;</button>',
      '</div>',
      '<label for="xcApiKeyInput" style="display:block;font-size:0.85rem;margin-top:6px;color:#ddd;">API key</label>',
      '<input id="xcApiKeyInput" type="text" autocomplete="off" spellcheck="false" style="width:100%;margin-top:4px;padding:8px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:#111;color:#fff;" />',
      '<label for="xcAnnotatorNameInput" style="display:block;font-size:0.85rem;margin-top:10px;color:#ddd;">Annotator display name</label>',
      '<input id="xcAnnotatorNameInput" type="text" autocomplete="off" style="width:100%;margin-top:4px;padding:8px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:#111;color:#fff;" />',
      '<label for="xcAnnotatorIdInput" style="display:block;font-size:0.85rem;margin-top:10px;color:#ddd;">Annotator Xeno-canto ID</label>',
      '<input id="xcAnnotatorIdInput" type="text" autocomplete="off" style="width:100%;margin-top:4px;padding:8px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:#111;color:#fff;" />',
      '<details id="xcAdvancedSection" style="margin-top:12px;color:#ddd;">',
      '<summary style="cursor:pointer;">Advanced</summary>',
      '<label for="xcEndpointInput" style="display:block;font-size:0.8rem;margin-top:6px;color:#bbb;">API endpoint</label>',
      '<input id="xcEndpointInput" type="text" style="width:100%;margin-top:4px;padding:8px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:#111;color:#fff;" />',
      '</details>',
      '<div id="xcSettingsStatus" style="min-height:18px;color:#9fe3b2;font-size:0.8rem;margin-top:8px;"></div>',
      '<div style="display:flex;justify-content:flex-end;gap:10px;margin-top:12px;">',
      '<button type="button" id="xcSettingsCancel" class="seg-top-btn">Cancel</button>',
      '<button type="button" id="xcSettingsSave" class="seg-top-btn">Save</button>',
      '</div>'
    ].join('');
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    function close() {
      backdrop.style.display = 'none';
      backdrop.setAttribute('aria-hidden','true');
    }
    function open() {
      const s = getSettings();
      document.getElementById('xcApiKeyInput').value = s.apiKey || '';
      document.getElementById('xcAnnotatorNameInput').value = s.annotatorName || '';
      document.getElementById('xcAnnotatorIdInput').value = s.annotatorId || '';
      document.getElementById('xcEndpointInput').value = s.endpoint || DEFAULT_SETTINGS.endpoint;
      document.getElementById('xcSettingsStatus').textContent = '';
      backdrop.style.display = 'flex';
      backdrop.setAttribute('aria-hidden','false');
      setTimeout(() => document.getElementById('xcApiKeyInput').focus(), 30);
    }
    function save() {
      const apiKey = document.getElementById('xcApiKeyInput').value.trim();
      const annotatorName = document.getElementById('xcAnnotatorNameInput').value.trim();
      const annotatorId = document.getElementById('xcAnnotatorIdInput').value.trim();
      const endpoint = document.getElementById('xcEndpointInput').value.trim() || DEFAULT_SETTINGS.endpoint;
      if (!apiKey) {
        document.getElementById('xcSettingsStatus').textContent = 'API key is required.';
        document.getElementById('xcSettingsStatus').style.color = '#ffb4b4';
        return;
      }
      if (!annotatorId) {
        document.getElementById('xcSettingsStatus').textContent = 'Annotator Xeno-canto ID is required.';
        document.getElementById('xcSettingsStatus').style.color = '#ffb4b4';
        return;
      }
      persistSettings({ apiKey, annotatorName, annotatorId, endpoint });
      const status = document.getElementById('xcSettingsStatus');
      status.style.color = '#9fe3b2';
      status.textContent = 'Saved.';
      setTimeout(() => { close(); }, 600);
    }
    document.getElementById('xcSettingsClose').addEventListener('click', () => close());
    document.getElementById('xcSettingsCancel').addEventListener('click', () => close());
    document.getElementById('xcSettingsSave').addEventListener('click', () => save());
    backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) close(); });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && backdrop.style.display === 'flex') close();
    });

    window.__openXcSettingsModal = open;
  }

  function ensureResultModal() {
    if (document.getElementById('xcResultBackdrop')) return;
    const wrap = document.createElement('div');
    wrap.id = 'xcResultBackdrop';
    wrap.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:2147483652;align-items:center;justify-content:center;';
    wrap.innerHTML = '<div id="xcResultModal" role="dialog" aria-modal="true" style="width:480px;max-width:92%;background:#10131c;color:#fff;border-radius:10px;padding:18px;box-shadow:0 16px 36px rgba(0,0,0,0.6);">\
      <div style="display:flex;justify-content:space-between;align-items:center;">\
        <h3 id="xcResultTitle" style="margin:0;font-size:1rem;">Upload result</h3>\
        <button type="button" id="xcResultClose" style="background:transparent;border:0;color:#bbb;font-size:20px;line-height:1;cursor:pointer;">&times;</button>\
      </div>\
      <div id="xcResultSummary" style="margin-top:8px;color:#cbd5f5;font-size:0.9rem;"></div>\
      <div id="xcResultDetails" style="margin-top:10px;max-height:220px;overflow:auto;font-size:0.85rem;color:#d4d7e1;"></div>\
      <div style="display:flex;justify-content:flex-end;margin-top:14px;">\
        <button type="button" id="xcResultDismiss" class="seg-top-btn">Close</button>\
      </div>\
    </div>';
    document.body.appendChild(wrap);
    function close() {
      wrap.style.display = 'none';
      wrap.setAttribute('aria-hidden','true');
    }
    document.getElementById('xcResultClose').addEventListener('click', close);
    document.getElementById('xcResultDismiss').addEventListener('click', close);
    wrap.addEventListener('click', (ev) => { if (ev.target === wrap) close(); });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && wrap.style.display === 'flex') close(); });
    window.__showXcResultModal = function({ title, summary, detailsHtml }) {
      document.getElementById('xcResultTitle').textContent = title || 'Upload result';
      document.getElementById('xcResultSummary').textContent = summary || '';
      document.getElementById('xcResultDetails').innerHTML = detailsHtml || '';
      wrap.style.display = 'flex';
      wrap.setAttribute('aria-hidden','false');
    };
  }

  async function uploadXenoCantoAnnotationSet() {
    ensureSettingsModal();
    ensureResultModal();
    const settings = getSettings();
    if (!settings.apiKey || !settings.annotatorId) {
      alert('Please configure your Xeno-canto API key and annotator ID before uploading.');
      window.__openXcSettingsModal && window.__openXcSettingsModal();
      return;
    }
    const built = buildAnnotationSet();
    if (!built.ok) {
      alert(built.reason || 'Unable to build Xeno-canto JSON.');
      return;
    }
    const endpoint = settings.endpoint || DEFAULT_SETTINGS.endpoint;
    const payload = JSON.stringify(built.data);
    try {
      window.__spectroWait && window.__spectroWait.show({
        titleText: 'Uploading to Xeno-canto',
        bodyText: 'Sending annotation set to Xeno-canto API. This may take a few seconds.',
        etaText: 'Uploading...'
      });
    } catch (e) {}
    let responseBody = null;
    let responseText = '';
    let statusOk = false;
    let warnings = [];
    let errors = [];
    let message = '';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'key': settings.apiKey,
          'Authorization': 'Basic ' + btoa('xc:xc')
        },
        body: payload
      });
      responseText = await res.text();
      try { responseBody = responseText ? JSON.parse(responseText) : null; } catch (e) { responseBody = null; }
      statusOk = res.ok;
      if (responseBody && Array.isArray(responseBody.warnings)) warnings = responseBody.warnings;
      if (responseBody && Array.isArray(responseBody.errors)) errors = responseBody.errors;
      message = (responseBody && (responseBody.message || responseBody.status)) || res.statusText || '';
    } catch (err) {
      errors = [err && err.message ? err.message : String(err)];
      statusOk = false;
    } finally {
      try { window.__spectroWait && window.__spectroWait.hide(); } catch (e) {}
    }

    const summary = statusOk && !errors.length ? 'Upload completed.' : 'Upload failed.';
    const detailParts = [];
    if (message) detailParts.push(`<p>${escapeHtml(String(message))}</p>`);
    if (warnings.length) {
      detailParts.push('<div style="margin-top:8px;"><strong>Warnings</strong><ul>' + warnings.map(w => `<li>${escapeHtml(String(w))}</li>`).join('') + '</ul></div>');
    }
    if (errors.length) {
      detailParts.push('<div style="margin-top:8px;color:#ffb4b4;"><strong>Errors</strong><ul>' + errors.map(w => `<li>${escapeHtml(String(w))}</li>`).join('') + '</ul></div>');
    }
    if (!warnings.length && !errors.length && responseText) {
      detailParts.push('<pre style="background:#0b0d14;padding:8px;border-radius:6px;white-space:pre-wrap;max-height:160px;overflow:auto;">' + escapeHtml(responseText) + '</pre>');
    }
    const detailHtml = detailParts.join('');
    window.__showXcResultModal && window.__showXcResultModal({ title: 'Xeno-canto upload', summary, detailsHtml: detailHtml });
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] || c));
  }

  // Initialize settings modal lazily
  ensureSettingsModal();
  ensureResultModal();

  window.exportXenoCantoJSON = exportXenoCantoJSON;
  window.uploadXenoCantoAnnotationSet = uploadXenoCantoAnnotationSet;
  window.__getXcSettings = getSettings;
})();
