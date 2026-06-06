// display_label.js (Tabulator version)
(function () {
  if (!window || !document) return;

  const LABEL_CONTAINER_ID = 'annotationLabelContainer_v1';
  const AXIS_TOP = 12;
  const LABEL_CLASS = 'ann-toplabel-v1';
  const UPDATE_DEBOUNCE_MS = 60;
  const DEFAULT_SELECTED_COLOR = '#ffff66';

  globalThis._displayAnnotationLabels = globalThis._displayAnnotationLabels || {};
  globalThis._displayAnnotationLabels.options = globalThis._displayAnnotationLabels.options || {
    defaultTextColor: '#fff',
    selectedTextColorFallback: DEFAULT_SELECTED_COLOR,
    fontWeight: '600',
    textShadow: '0 1px 2px rgba(0,0,0,0.9)'
  };

  function getOptions() {
    return globalThis._displayAnnotationLabels.options;
  }

  function getAnnotations() {
    try {
      if (globalThis._annotations && typeof globalThis._annotations.getAll === 'function') {
        return globalThis._annotations.getAll() || [];
      }
    } catch (e) {}
    return [];
  }

  function getMapping() {
    const pxPerSec = (globalThis._spectroMap && typeof globalThis._spectroMap.pxPerSec === 'function')
      ? globalThis._spectroMap.pxPerSec()
      : (globalThis._spectroPxPerSec || 1);
    const imageHeight = (typeof globalThis._spectroImageHeight === 'number' && globalThis._spectroImageHeight > 0)
      ? globalThis._spectroImageHeight
      : Math.max(1, ((document.getElementById('spectrogramCanvas') && document.getElementById('spectrogramCanvas').clientHeight) || 300) - AXIS_TOP - 44);
    const ymaxHz = (typeof globalThis._spectroYMax === 'number' && globalThis._spectroYMax > 0)
      ? globalThis._spectroYMax
      : (globalThis._spectroSampleRate ? globalThis._spectroSampleRate / 2 : 22050);
    const yminHz = (typeof globalThis._spectroYMin === 'number') ? globalThis._spectroYMin : 0;
    const axisLeft = (typeof globalThis._spectroAxisLeft === 'number') ? globalThis._spectroAxisLeft : 70;
    return { pxPerSec, imageHeight, ymaxHz, yminHz, axisLeft };
  }

  function buildAnnotationRowMap() {
    const map = new Map();
    try {
      if (window.annotationGrid && typeof window.annotationGrid.getData === 'function') {
        const gridData = window.annotationGrid.getData();
        for (let i = 0; i < gridData.length; i++) {
          const row = gridData[i];
          const aid = row.id;
          if (!aid) continue;
          let species = '';
          if (row.species !== undefined && row.species !== null) {
            species = String(row.species).trim();
          }
          let scientificName = '';
          if (row.scientificName !== undefined && row.scientificName !== null) {
            scientificName = String(row.scientificName).trim();
          }
          // Use numeric index for Selection if possible, else fallback to string
          let index = row.Selection;
          if (typeof index !== 'number') {
            if (!isNaN(Number(index))) index = Number(index);
          }
          map.set(String(aid), { index: index, species: species, scientificName: scientificName });
        }
      }
    } catch (e) {}
    return map;
  }

  function annotationToRectPx(ann) {
    const scrollArea = document.getElementById('scrollArea');
    if (!scrollArea) return null;
  const { pxPerSec, imageHeight, ymaxHz, yminHz } = getMapping();
  // Use Tabulator grid columns for coordinates
  const begin = (typeof ann.beginTime !== 'undefined') ? ann.beginTime : (typeof ann['Begin Time (s)'] !== 'undefined' ? ann['Begin Time (s)'] : 0);
  const end = (typeof ann.endTime !== 'undefined') ? ann.endTime : (typeof ann['End Time (s)'] !== 'undefined' ? ann['End Time (s)'] : 0);
  const low = (typeof ann.lowFreq !== 'undefined') ? ann.lowFreq : (typeof ann['Low Freq (Hz)'] !== 'undefined' ? ann['Low Freq (Hz)'] : 0);
  const high = (typeof ann.highFreq !== 'undefined') ? ann.highFreq : (typeof ann['High Freq (Hz)'] !== 'undefined' ? ann['High Freq (Hz)'] : 0);
  const left = begin * pxPerSec - (scrollArea.scrollLeft || 0);
  const right = end * pxPerSec - (scrollArea.scrollLeft || 0);
  const top = imageHeight * ((ymaxHz - high) / Math.max(1, ymaxHz - yminHz));
  const bottom = imageHeight * ((ymaxHz - low) / Math.max(1, ymaxHz - yminHz));
  const topPercent = ((ymaxHz - high) / Math.max(1, ymaxHz - yminHz)) * 100;
  return { left, right, top, bottom, topPercent };
  }

  function ensureLabelContainer() {
    let container = document.getElementById(LABEL_CONTAINER_ID);
    if (!container) {
      container = document.createElement('div');
      container.id = LABEL_CONTAINER_ID;
      container.style.position = 'absolute';
      container.style.left = '0px';
      container.style.width = '100%';
      container.style.pointerEvents = 'none';
      container.style.zIndex = '100';
      const parent = document.getElementById('viewportWrapper');
      if (parent) parent.appendChild(container);
    }
    const map = getMapping();
    container.style.top = AXIS_TOP + 'px';
    container.style.height = map.imageHeight + 'px';
    return container;
  }

  function createOrUpdateLabel(container, aidStr, rectPx, rowInfo) {
    if (!rectPx) return;
    const id = 'ann_label_' + aidStr;
    let el = document.getElementById(id);
    // Use numeric index if available, else fallback to string
    let labelIndex = '?';
    if (rowInfo && rowInfo.index !== undefined && rowInfo.index !== null) {
      labelIndex = typeof rowInfo.index === 'number' ? rowInfo.index : String(rowInfo.index);
    }

    const toggleBtn = document.getElementById('toggleNameBtn');
    const labelMode = toggleBtn ? (toggleBtn.dataset.mode || 'common') : 'common';
    let nameToShow = '';
    if (rowInfo) {
      if (labelMode === 'common') {
        nameToShow = rowInfo.species || '';
      } else if (labelMode === 'scientific') {
        nameToShow = rowInfo.scientificName || rowInfo.species || '';
      }
    }

    const labelText = labelIndex + '|' + nameToShow;
    const opts = getOptions();
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.className = LABEL_CLASS;
      Object.assign(el.style, {
        position: 'absolute',
        left: '0px',
        top: '0px',
        pointerEvents: 'none',
        background: 'transparent',
        color: opts.defaultTextColor || '#fff',
        padding: '2px 6px',
        fontSize: '12px',
        lineHeight: '16px',
        borderRadius: '3px',
        whiteSpace: 'nowrap',
        transform: 'translate(-2px, -16px)',
        textShadow: opts.textShadow || '0 1px 2px rgba(0,0,0,0.9)',
        fontWeight: opts.fontWeight || '600'
      });
      container.appendChild(el);
    }
    if (labelMode === 'none') {
      el.style.display = 'none';
    } else {
      el.style.display = 'block';
      el.textContent = labelText;
    }
  // Always subtract scrollArea.scrollLeft from left coordinate
  const axisLeft = getMapping().axisLeft || 70;
  const leftPx = Math.round(axisLeft + (rectPx.left || 0));
  el.style.left = leftPx + 'px';
  if (typeof rectPx.topPercent === 'number') {
    const isClamped = rectPx.topPercent < 0;
    el.style.top = Math.max(0, rectPx.topPercent) + '%';
    el.style.transform = isClamped ? 'translate(-2px, 2px)' : 'translate(-2px, -16px)';
  } else {
    const isClamped = (rectPx.top || 0) < 0;
    el.style.top = Math.max(0, Math.round(rectPx.top || 0)) + 'px';
    el.style.transform = isClamped ? 'translate(-2px, 2px)' : 'translate(-2px, -16px)';
  }
  }

  function removeLabelIfExists(aidStr) {
    const id = 'ann_label_' + aidStr;
    const el = document.getElementById(id);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function updateLabelColors() {
    try {
      const opts = getOptions();
      const defaultColor = opts.defaultTextColor || '#fff';
      const selectedFallback = opts.selectedTextColorFallback || DEFAULT_SELECTED_COLOR;
      const editingId = (globalThis._editAnnotations && typeof globalThis._editAnnotations.getEditingId === 'function')
        ? globalThis._editAnnotations.getEditingId() : null;

      const container = document.getElementById(LABEL_CONTAINER_ID);
      if (!container) return;
      const children = Array.from(container.children || []);
      for (const ch of children) {
        ch.style.color = defaultColor;
      }

      if (editingId === null || editingId === undefined) return;

      const aidStr = String(editingId);
      const anns = getAnnotations();
      const ann = anns.find(a => String(a.id) === aidStr);
      const color = (ann && ann.color) ? String(ann.color) : selectedFallback;

      const el = document.getElementById('ann_label_' + aidStr);
      if (el) {
        el.style.color = color;
      }
    } catch (e) {
      console.error('updateLabelColors error', e);
    }
  }

  function syncAllLabels() {
    try {
      const container = ensureLabelContainer();
      const anns = getAnnotations();
      const rowMap = buildAnnotationRowMap();
      const currentIds = new Set(anns.map(a => String(a.id)));

      for (const a of anns) {
        const aidStr = String(a.id);
        const rect = annotationToRectPx(a);
        createOrUpdateLabel(container, aidStr, rect, rowMap.get(aidStr) || { index: '?', species: '', scientificName: '' });
      }

      const children = Array.from(container.children || []);
      for (const ch of children) {
        if (!ch.id) continue;
        const m = ch.id.match(/^ann_label_(.+)$/);
        if (!m) continue;
        const aid = String(m[1]);
        if (!currentIds.has(aid)) ch.remove();
      }

      updateLabelColors();
    } catch (e) {
      console.error('syncAllLabels error', e);
    }
  }

  let debounceTimer = null;
  function scheduleSync() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { syncAllLabels(); debounceTimer = null; }, UPDATE_DEBOUNCE_MS);
  }

  function installEventListeners() {
    window.addEventListener('annotations-changed', () => scheduleSync(), { passive: true });
    window.addEventListener('edit-selection-changed', () => scheduleSync(), { passive: true });

    // Tabulator grid event listeners for immediate label sync
    if (window.annotationGrid) {
      window.annotationGrid.on('dataLoaded', scheduleSync);
      window.annotationGrid.on('rowAdded', scheduleSync);
      window.annotationGrid.on('rowUpdated', scheduleSync);
      window.annotationGrid.on('rowDeleted', scheduleSync);
      window.annotationGrid.on('renderComplete', scheduleSync);
    }

    const scrollArea = document.getElementById('scrollArea');
    if (scrollArea) scrollArea.addEventListener('scroll', () => scheduleSync(), { passive: true });
    window.addEventListener('resize', () => scheduleSync(), { passive: true });

    const toggleBtn = document.getElementById('toggleNameBtn');
    const toggleBadge = document.getElementById('toggleNameBadge');
    if (toggleBtn && toggleBadge) {
      const MODES = ['common', 'scientific', 'none'];
      const MODE_LABELS = {
        'common': 'Common',
        'scientific': 'Scientific',
        'none': 'No Label'
      };
      const BADGE_CLASSES = {
        'common': 'mode-badge m-Common',
        'scientific': 'mode-badge m-Sci',
        'none': 'mode-badge m-None'
      };

      // Set initial mode from settings
      let defaultMode = 'common';
      try {
        const raw = localStorage.getItem('spectrolipi.settings.v1');
        if (raw) {
          const s = JSON.parse(raw);
          if (s.defaultSpeciesFormat) defaultMode = s.defaultSpeciesFormat;
        }
      } catch(e) {}
      toggleBtn.dataset.mode = defaultMode;
      toggleBadge.textContent = MODE_LABELS[defaultMode];
      toggleBadge.className = BADGE_CLASSES[defaultMode];

      toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const currentMode = toggleBtn.dataset.mode || 'common';
        const nextIndex = (MODES.indexOf(currentMode) + 1) % MODES.length;
        const nextMode = MODES[nextIndex];

        toggleBtn.dataset.mode = nextMode;
        toggleBadge.textContent = MODE_LABELS[nextMode];
        toggleBadge.className = BADGE_CLASSES[nextMode];

        scheduleSync();
        try {
          toggleBtn.blur();
          const playPauseBtn = document.getElementById('playPause');
          if (playPauseBtn) playPauseBtn.focus();
        } catch(err){}
      });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(scheduleSync, 60));
    else setTimeout(scheduleSync, 60);
  }

  globalThis._displayAnnotationLabels = globalThis._displayAnnotationLabels || {};
  globalThis._displayAnnotationLabels.sync = syncAllLabels;
  globalThis._displayAnnotationLabels.schedule = scheduleSync;
  globalThis._displayAnnotationLabels.updateLabelColors = updateLabelColors;
  globalThis._displayAnnotationLabels.setOption = function (k, v) {
    globalThis._displayAnnotationLabels.options = globalThis._displayAnnotationLabels.options || {};
    globalThis._displayAnnotationLabels.options[k] = v;
    scheduleSync();
  };

  ensureLabelContainer();
  installEventListeners();

})();
