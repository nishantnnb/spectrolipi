(function () {
  if (window.__uploadXcInit) return;
  window.__uploadXcInit = true;

  // DOM builder helper
  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    if (props) {
      for (const k in props) {
        if (k === 'cls') node.className = props[k];
        else if (k === 'html') node.innerHTML = props[k];
        else if (k && k.startsWith && k.startsWith('aria-')) node.setAttribute(k, props[k]);
        else node[k] = props[k];
      }
    }
    children.forEach(c => {
      if (c == null) return;
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    });
    return node;
  }

  function buildModalDom() {
    const style = document.createElement('style');
    style.id = 'xc-modal-styles';
    style.textContent = `
    #xcOverlay { position:fixed; inset:0; background: rgba(18,22,26,0.45); display:flex; align-items:center; justify-content:center; z-index:2147483646; -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); }
    #xcCard { width:96%; max-width:860px; background:#fff; border-radius:10px; box-shadow:0 10px 40px rgba(0,0,0,0.25); padding:18px; color:#111; font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial; max-height:88vh; overflow:auto; }
    #xcCard h4 { margin:0 0 16px 0; font-size:16px; }
    .xc-grid { display:grid; grid-template-columns: repeat(4, 1fr); gap:12px; align-items:center; margin-bottom:16px; }
    .xc-row-full { grid-column:1 / -1; }
    .xc-label { font-size:13px; color:#333; margin-bottom:6px; display:block; font-weight: 500; }
    .xc-input, .xc-select { width:90%; box-sizing:border-box; padding:8px 10px; border:1px solid #d0d4d7; border-radius:6px; font-size:14px; background:#fff; color:#111; }
    .xc-actions { display:flex; gap:10px; justify-content:flex-end; margin-top:12px; }
    .btn { padding:8px 12px; border-radius:8px; border:1px solid transparent; font-size:14px; cursor:pointer; }
    .btn-muted { background:#f6f7f8; color:#222; border-color:#e0e3e6; }
    .btn-primary { background:#0b66ff; color:#fff; border-color:#075be0; box-shadow: 0 6px 18px rgba(11,102,255,0.12); }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; filter: grayscale(100%); }
    .xc-checkbox-wrap { display:flex; gap: 8px; align-items: center; margin-bottom: 10px; font-size: 14px; color:#333; cursor:pointer; }
    @media (max-width:640px) { .xc-grid { grid-template-columns:1fr; } .xc-actions { justify-content:stretch; } }
    `;
    document.head.appendChild(style);

    const overlay = el('div', { id: 'xcOverlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Upload to Xeno-Canto' });
    const card = el('div', { id: 'xcCard' });
    card.appendChild(el('h4', null, 'Upload to Xeno-Canto'));
    const grid = el('div', { cls: 'xc-grid' });

    const xcFileNoWrap = el('div', null,
      el('label', { cls: 'xc-label', html: 'Xeno-canto file no <span style="color:#d32f2f">(Mandatory)</span>:' }),
      el('input', { type: 'text', className: 'xc-input', id: 'xc-fileno', placeholder: 'e.g. 666145', title: 'Mandatory for XC upload' })
    );
    const setNameWrap = el('div', null,
      el('label', { cls: 'xc-label', html: 'Annotation set name:' }),
      el('input', { type: 'text', className: 'xc-input', id: 'xc-setname', placeholder: '', title: 'Optional for XC upload' })
    );
    const setCreatorWrap = el('div', null,
      el('label', { cls: 'xc-label', html: 'Set creator:' }),
      el('input', { type: 'text', className: 'xc-input', id: 'xc-setcreator', placeholder: '', title: 'Optional for XC upload' })
    );
    const setOwnerWrap = el('div', null,
      el('label', { cls: 'xc-label', html: 'Set owner:' }),
      el('input', { type: 'text', className: 'xc-input', id: 'xc-setowner', placeholder: '', title: 'Optional for XC upload' })
    );
    const setSourceWrap = el('div', null,
      el('label', { cls: 'xc-label', html: 'Set source:' }),
      el('input', { type: 'text', className: 'xc-input', id: 'xc-setsource', placeholder: '', title: 'Optional for XC upload' })
    );
    const setUriWrap = el('div', null,
      el('label', { cls: 'xc-label', html: 'Set URL:' }),
      el('input', { type: 'text', className: 'xc-input', id: 'xc-seturi', placeholder: '', title: 'Optional for XC upload' })
    );
    const projectWrap = el('div', null,
      el('label', { cls: 'xc-label', html: 'Project:' }),
      el('input', { type: 'text', className: 'xc-input', id: 'xc-project', placeholder: '', title: 'Optional for XC upload' })
    );
    const projectUriWrap = el('div', null,
      el('label', { cls: 'xc-label', html: 'Project URL:' }),
      el('input', { type: 'text', className: 'xc-input', id: 'xc-projecturi', placeholder: '', title: 'Optional for XC upload' })
    );
    const fundingWrap = el('div', null,
      el('label', { cls: 'xc-label', html: 'Funding:' }),
      el('input', { type: 'text', className: 'xc-input', id: 'xc-funding', placeholder: '', title: 'Optional for XC upload' })
    );
    const taxonWrap = el('div', null,
      el('label', { cls: 'xc-label', html: 'Taxon coverage:' }),
      el('input', { type: 'text', className: 'xc-input', id: 'xc-taxon', placeholder: '', title: 'Optional for XC upload' })
    );
    const completenessWrap = el('div', null,
      el('label', { cls: 'xc-label', html: 'Completeness:' }),
      el('select', { className: 'xc-select', id: 'xc-completeness', title: 'Optional for XC upload' },
        el('option', { value: '' }, ''),
        el('option', { value: 'all' }, 'all'),
        el('option', { value: 'part' }, 'part')
      )
    );

    grid.appendChild(xcFileNoWrap);
    grid.appendChild(setNameWrap);
    grid.appendChild(setCreatorWrap);
    grid.appendChild(setOwnerWrap);
    grid.appendChild(setSourceWrap);
    grid.appendChild(setUriWrap);
    grid.appendChild(projectWrap);
    grid.appendChild(projectUriWrap);
    grid.appendChild(fundingWrap);
    grid.appendChild(taxonWrap);
    grid.appendChild(completenessWrap);

    // API Settings section
    const apiSettingsWrap = el('div', { cls: 'xc-row-full', style: 'margin-top: 8px; border-top: 1px solid #eee; padding-top: 16px;' });
    apiSettingsWrap.appendChild(el('div', { cls: 'xc-label', html: 'API Configuration & Defaults (Saved locally):' }));
    
    const apiGrid = el('div', { cls: 'xc-grid', style: 'margin-bottom: 12px;' });
    
    const apiKeyWrap = el('div', null,
      el('label', { cls: 'xc-label', html: 'API key:' }),
      el('div', { style: 'position:relative;display:flex;align-items:center;width:90%;' },
        el('input', { type: 'password', className: 'xc-input', id: 'xc-apikey', placeholder: '', style: 'width:100%;padding-right:48px;' }),
        el('button', { type: 'button', id: 'xc-api-toggle', style: 'position:absolute;right:8px;background:transparent;border:none;color:#555;cursor:pointer;font-size:12px;padding:4px;' }, 'Show')
      )
    );
    
    const annotatorNameWrap = el('div', null,
      el('label', { cls: 'xc-label', html: 'Annotator display name:' }),
      el('input', { type: 'text', className: 'xc-input', id: 'xc-annname', placeholder: '' })
    );

    const licenseWrap = el('div', null,
      el('label', { cls: 'xc-label', html: 'Default Annotation license:' }),
      el('select', { className: 'xc-select', id: 'xc-license' },
        el('option', { value: '' }, ''),
        el('option', { value: 'CC-BY-4.0' }, 'CC-BY-4.0'),
        el('option', { value: 'CC-BY-NC-4.0' }, 'CC-BY-NC-4.0')
      )
    );

    const apiEndpointWrap = el('div', { style: 'display: none;' },
      el('label', { cls: 'xc-label', html: 'API endpoint:' }),
      el('input', { type: 'text', className: 'xc-input', id: 'xc-endpoint', placeholder: 'https://xeno-canto.org/api/3/upload/annotation-set' })
    );

    apiGrid.appendChild(apiKeyWrap);
    apiGrid.appendChild(annotatorNameWrap);
    apiGrid.appendChild(licenseWrap);
    apiGrid.appendChild(apiEndpointWrap);

    const saveSettingsWrap = el('div', { style: 'display:flex; gap:10px; align-items:center; padding-top:24px;' });
    const saveSettingsBtn = el('button', { type: 'button', className: 'btn btn-muted', id: 'xc-save-settings' }, 'Save defaults');
    const statusDiv = el('div', { id: 'xc-modal-status', style: 'color:#059669;font-size:13px;' });
    saveSettingsWrap.appendChild(saveSettingsBtn);
    saveSettingsWrap.appendChild(statusDiv);
    apiGrid.appendChild(saveSettingsWrap);
    apiSettingsWrap.appendChild(apiGrid);

    grid.appendChild(apiSettingsWrap);

    // Checkboxes section
    const optionsWrap = el('div', { cls: 'xc-row-full', style: 'margin-top: 8px; border-top: 1px solid #eee; padding-top: 16px;' });
    optionsWrap.appendChild(el('div', { cls: 'xc-label', html: 'Upload Options:' }));
    
    const bottomRow = el('div', { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;' });
    const checkboxesRow = el('div', { style: 'display: flex; gap: 24px; align-items: center;' });

    const exportJsonWrap = el('label', { cls: 'xc-checkbox-wrap', style: 'margin-bottom: 0;' },
        el('input', { type: 'checkbox', id: 'xc-export-json' }),
        'Export JSON'
    );
    const directUploadWrap = el('label', { cls: 'xc-checkbox-wrap', style: 'margin-bottom: 0;' },
        el('input', { type: 'checkbox', id: 'xc-direct-upload' }),
        'Direct Upload with API'
    );
    checkboxesRow.appendChild(exportJsonWrap);
    checkboxesRow.appendChild(directUploadWrap);
    bottomRow.appendChild(checkboxesRow);

    const actions = el('div', { cls: 'xc-actions', style: 'margin-top: 0;' });
    const cancelBtn = el('button', { type: 'button', className: 'btn btn-muted', id: 'xc-cancel' }, 'Cancel');
    const proceedBtn = el('button', { type: 'button', className: 'btn btn-primary', id: 'xc-proceed' }, 'Proceed');
    actions.appendChild(cancelBtn);
    actions.appendChild(proceedBtn);
    bottomRow.appendChild(actions);

    optionsWrap.appendChild(bottomRow);
    grid.appendChild(optionsWrap);

    card.appendChild(grid);
    overlay.appendChild(card);

    return { overlay, fileno: overlay.querySelector('#xc-fileno'), setname: overlay.querySelector('#xc-setname') };
  }

  function nodesSafeSet(id, val) {
    try {
      const n = document.getElementById(id);
      if (n) n.value = val === undefined || val === null ? '' : val;
    } catch (e) {}
  }

  function openUploadXcModal() {
    const existing = document.getElementById('xcOverlay');
    if (existing) return; // Prevent duplicates

    const meta = buildModalDom();
    document.body.appendChild(meta.overlay);

    const overlayScope = meta.overlay;
    const nodes = {
      fileno: overlayScope.querySelector('#xc-fileno'),
      license: overlayScope.querySelector('#xc-license'),
      annname: overlayScope.querySelector('#xc-annname'),
      setname: overlayScope.querySelector('#xc-setname'),
      setcreator: overlayScope.querySelector('#xc-setcreator'),
      setowner: overlayScope.querySelector('#xc-setowner'),
      setsource: overlayScope.querySelector('#xc-setsource'),
      seturi: overlayScope.querySelector('#xc-seturi'),
      project: overlayScope.querySelector('#xc-project'),
      projecturi: overlayScope.querySelector('#xc-projecturi'),
      funding: overlayScope.querySelector('#xc-funding'),
      taxon: overlayScope.querySelector('#xc-taxon'),
      completeness: overlayScope.querySelector('#xc-completeness'),
      apiKey: overlayScope.querySelector('#xc-apikey'),
      apiToggle: overlayScope.querySelector('#xc-api-toggle'),
      endpoint: overlayScope.querySelector('#xc-endpoint'),
      saveSettings: overlayScope.querySelector('#xc-save-settings'),
      status: overlayScope.querySelector('#xc-modal-status'),
      exportJson: overlayScope.querySelector('#xc-export-json'),
      directUpload: overlayScope.querySelector('#xc-direct-upload'),
      proceed: overlayScope.querySelector('#xc-proceed'),
      cancel: overlayScope.querySelector('#xc-cancel')
    };

    const fileInput = document.getElementById('file');
    const hasFile = fileInput && fileInput.files && fileInput.files.length > 0;

    if (!hasFile) {
       nodes.fileno.disabled = true;
       nodes.setname.disabled = true;
       nodes.setcreator.disabled = true;
       nodes.setowner.disabled = true;
       nodes.setsource.disabled = true;
       nodes.seturi.disabled = true;
       nodes.project.disabled = true;
       nodes.projecturi.disabled = true;
       nodes.funding.disabled = true;
       nodes.taxon.disabled = true;
       nodes.completeness.disabled = true;
       nodes.exportJson.disabled = true;
       nodes.directUpload.disabled = true;
       nodes.proceed.disabled = true;
    }

    if (nodes.apiToggle && nodes.apiKey) {
      nodes.apiToggle.addEventListener('click', () => {
        if (nodes.apiKey.type === 'password') {
          nodes.apiKey.type = 'text';
          nodes.apiToggle.textContent = 'Hide';
        } else {
          nodes.apiKey.type = 'password';
          nodes.apiToggle.textContent = 'Show';
        }
      });
    }

    // Load existing XC metadata, independent from standard metadata
    const source = Object.assign({}, window.__xcMetadata || {});
    try {
      const fi = document.getElementById('file');
      if (fi && fi.files && fi.files.length > 0) {
        const match = fi.files[0].name.match(/^XC(\d+)/i);
        if (match) {
          if (source.xcfileno === undefined) source.xcfileno = match[1];
          if (source.setname === undefined) source.setname = 'Annotation set for ' + match[1];
        }
      }
    } catch(e) {}

    nodesSafeSet('xc-fileno', source.xcfileno || '');

    // Load settings to prefill Annotator Name and Annotation License defaults
    let settings = null;
    try {
      if (window.__getXcSettings) settings = window.__getXcSettings();
      else if (window.getSettings) settings = window.getSettings();
      else if (window.__xcSettings) settings = window.__xcSettings;
      else if (typeof getSettings === 'function') settings = getSettings();
      else {
        const raw = localStorage.getItem('xc.settings.v1');
        if (raw) settings = JSON.parse(raw);
      }
    } catch (e) {}

    let prefillLicense = source.set_license;
    if (!prefillLicense && settings && settings.license) prefillLicense = settings.license;
    nodesSafeSet('xc-license', prefillLicense || '');

    let prefillAnnotatorName = source.annname;
    if (!prefillAnnotatorName && settings && settings.annotatorName) {
      prefillAnnotatorName = settings.annotatorName;
    }
    nodesSafeSet('xc-annname', prefillAnnotatorName || '');
    const fallbackEndpoint = 'https://xeno-canto.org/api/3/upload/annotation-set';
    nodesSafeSet('xc-apikey', settings && settings.apiKey ? settings.apiKey : '');
    nodesSafeSet('xc-endpoint', settings && settings.endpoint ? settings.endpoint : fallbackEndpoint);
    nodesSafeSet('xc-project', source.project || '');
    nodesSafeSet('xc-setsource', source.setsource || '');
    nodesSafeSet('xc-seturi', source.seturi || '');
    nodesSafeSet('xc-projecturi', source.projecturi || '');
    nodesSafeSet('xc-funding', source.funding || '');
    nodesSafeSet('xc-taxon', source.taxon || '');
    nodesSafeSet('xc-completeness', source.completeness || '');
    nodesSafeSet('xc-setname', source.setname || '');
    nodesSafeSet('xc-setcreator', source.setcreator || '');
    nodesSafeSet('xc-setowner', source.setowner || '');

    // Auto-populate annotation set name when XC file no loses focus
    if (nodes.fileno && nodes.setname) {
      nodes.fileno.addEventListener('input', () => {
        const val = nodes.fileno.value.trim();
        const currentSetName = nodes.setname.value.trim();
        if (val) {
          if (!currentSetName || /^Annotation set for/i.test(currentSetName)) {
            const num = val.replace(/^XC/i, '');
            nodes.setname.value = 'Annotation set for ' + num;
          }
        } else {
          if (/^Annotation set for/i.test(currentSetName)) {
            nodes.setname.value = '';
          }
        }
      });
    }

    function updateProceedState() {
      const hasOption = nodes.exportJson.checked || nodes.directUpload.checked;
      const hasFileNo = nodes.fileno.value.trim() !== '';
      nodes.proceed.disabled = !(hasOption && hasFileNo);
    }
    nodes.exportJson.addEventListener('change', updateProceedState);
    nodes.directUpload.addEventListener('change', updateProceedState);
    if (nodes.fileno) nodes.fileno.addEventListener('input', updateProceedState);
    updateProceedState();

    const saveConfig = () => {
      const apiKey = nodes.apiKey.value.trim();
      const annotatorName = nodes.annname.value.trim();
      const license = nodes.license.value.trim();
      const endpoint = nodes.endpoint.value.trim() || fallbackEndpoint;
      if (typeof window.__setXcSettings === 'function') {
        window.__setXcSettings({ apiKey, annotatorName, license, endpoint });
      }
    };

    if (nodes.saveSettings) {
      nodes.saveSettings.addEventListener('click', () => {
        saveConfig();
        if (nodes.status) {
          nodes.status.textContent = 'Settings saved locally.';
          setTimeout(() => { nodes.status.textContent = ''; }, 3000);
        }
      });
    }

    // OK Handler: Gather values and persist them to __xcMetadata
    nodes.proceed.addEventListener('click', () => {
      const fileno = nodes.fileno.value.trim();
      if (!fileno) {
        alert("Please fill at least 'Xeno-canto file no' in the Upload Options before continuing.");
        return;
      }
      
      if (nodes.directUpload.checked && !nodes.apiKey.value.trim()) {
        alert('API key is required for Direct Upload.');
        return;
      }

      saveConfig();

      let anns = [];
      if (globalThis._annotations && typeof globalThis._annotations.getAll === 'function') anns = globalThis._annotations.getAll() || [];
      else if (window.annotationGrid && typeof window.annotationGrid.getData === 'function') anns = window.annotationGrid.getData() || [];
      if (!anns || !anns.length) {
        alert('Please create annotations before exporting or uploading.');
        return;
      }

      window.__xcMetadata = Object.assign({}, window.__xcMetadata || {}, {
        xcfileno: nodes.fileno.value.trim(),
        set_license: nodes.license.value.trim(),
        annname: nodes.annname.value.trim(),
        setname: nodes.setname.value.trim(),
        setcreator: nodes.setcreator.value.trim(),
        setowner: nodes.setowner.value.trim(),
        project: nodes.project.value.trim(),
        setsource: nodes.setsource.value.trim(),
        seturi: nodes.seturi.value.trim(),
        projecturi: nodes.projecturi.value.trim(),
        funding: nodes.funding.value.trim(),
        taxon: nodes.taxon.value.trim(),
        completeness: nodes.completeness.value.trim()
      });

      if (nodes.exportJson.checked) {
        if (typeof window.exportXenoCantoJSON === 'function') {
          window.exportXenoCantoJSON();
        } else {
          console.warn('exportXenoCantoJSON not available');
        }
      }
      if (nodes.directUpload.checked) {
        if (typeof window.uploadXenoCantoAnnotationSet === 'function') {
          window.uploadXenoCantoAnnotationSet();
        } else {
          console.warn('uploadXenoCantoAnnotationSet not available');
        }
      }

      closeModal();
    });

    nodes.cancel.addEventListener('click', () => {
      closeModal();
    });

    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape' && document.getElementById('xcOverlay')) {
        document.removeEventListener('keydown', escHandler);
        closeModal();
      }
    });
  }

  function closeModal() {
    const ov = document.getElementById('xcOverlay'); if (ov) ov.remove();
    const st = document.getElementById('xc-modal-styles'); if (st) st.remove();
  }

  // Expose this method to the global object so the menu item can trigger it
  window.__openUploadXcModal = openUploadXcModal;

})();

// --- Merged from xc.js ---
(function(){
  const STORAGE_KEY = 'xc.settings.v1';
  const DEFAULT_SETTINGS = {
    apiKey: '',
    annotatorName: '',
    license: '',
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

  function getXcMetadata() {
    return window.__xcMetadata ? { ...window.__xcMetadata } : {};
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
    const xcMeta = getXcMetadata() || {};
    const anns = getAnnotations();
    const settings = getSettings();
    const xcFileNo = xcMeta['xcfileno'] || '';
    if (!xcFileNo || !String(xcFileNo).trim()) {
      return { ok: false, reason: "Please fill at least 'Xeno-canto file no' in the Upload Options before continuing." };
    }
    if (!anns || !anns.length) {
      return { ok: false, reason: 'Please create annotations before exporting or uploading.' };
    }
    const projectName = xcMeta['project'] || '';
    const annotator = safeField(xcMeta['annname'] || settings.annotatorName);
    const taxonCoverage = xcMeta['taxon'] || '';
    const completeness = xcMeta['completeness'] || '';

    const annotations = anns.map(row => ({
      annotation_source_id: safeField(row.Selection || row.selection || row['Selection']),
      sound_file: '',
      xc_nr: safeField(xcFileNo),
      annotator: safeField(annotator),
      annotator_xc_id: '',
      frequency_high: safeField(row.highFreq ?? row.highfreq ?? row['High Freq (Hz)']),
      frequency_low: safeField(row.lowFreq ?? row.lowfreq ?? row['Low Freq (Hz)']),
      start_time: (row.beginTime ?? row['Begin Time (s)']) === 0 ? 0 : safeField(row.beginTime ?? row['Begin Time (s)']),
      end_time: (row.endTime ?? row['End Time (s)']) === 0 ? 0 : safeField(row.endTime ?? row['End Time (s)']),
      scientific_name: safeField(row.scientificName ?? row['Scientific Name']),
      sound_type: safeField(row.soundType ?? row['Sound type(s)']),
      date_identified: '',
      sex: safeField(row.sex ?? row['Sex']),
      life_stage: safeField(row.lifeStage ?? row['Life stage']),
      animal_seen: '',
      playback_used: '',
      collection_date: '',
      collection_specimen: '',
      temperature: '',
      annotation_remarks: safeField(row.notes ?? row['Notes']),
      overlap: ''
    }));

    const payload = {
      set_source: xcMeta.setsource || '',
      set_uri: xcMeta.seturi || '',
      set_name: xcMeta.setname || '',
      annotation_software_name_and_version: 'Spectrolipi',
      set_creator: xcMeta.setcreator || '',
      set_creator_id: '',
      set_owner: xcMeta.setowner || '',
      set_license: xcMeta.set_license || '',
      project_uri: xcMeta.projecturi || '',
      project_name: projectName,
      funding: xcMeta.funding || '',
      scope: [
        {
          taxon_coverage: taxonCoverage,
          completeness: completeness
        }
      ],
      annotations
    };
    return { ok: true, data: payload, meta: { annotationsCount: annotations.length, xcFileNo } };
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
      if (/Upload Options/i.test(built.reason || '')) {
        try { window.__openUploadXcModal && window.__openUploadXcModal(); } catch (e) {}
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
    ensureResultModal();
    const settings = getSettings();
    if (!settings.apiKey) {
      alert('Please configure your Xeno-canto API key in the Upload modal before uploading.');
      return;
    }
    const built = buildAnnotationSet();
    if (!built.ok) {
      alert(built.reason || 'Unable to build Xeno-canto JSON.');
      if (/Upload Options/i.test(built.reason || '')) {
        try { window.__openUploadXcModal && window.__openUploadXcModal(); } catch (e) {}
      }
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

  // Initialize result modal lazily
  ensureResultModal();

  window.exportXenoCantoJSON = exportXenoCantoJSON;
  window.uploadXenoCantoAnnotationSet = uploadXenoCantoAnnotationSet;
  window.__getXcSettings = getSettings;
  window.__setXcSettings = persistSettings;
})();