// recent_species.js
// Provides a floating panel showing the last 10 selected species.

(function() {
  const MAX_SPECIES = 10;
  let recentSpecies = [];
  let displayMode = 'common'; // 'common' or 'scientific'
  let isActive = true;
  let isSpectrogramLoaded = !!(globalThis._spectroAudioBuffer || globalThis._spectroSpectra);

  // Initialize from settings and load saved recent species
  try {
    const raw = localStorage.getItem('spectrolipi.settings.v1');
    if (raw) {
      const s = JSON.parse(raw);
      if (s.defaultSpeciesFormat) displayMode = s.defaultSpeciesFormat;
      if (s.recentSpeciesEnabled === false) isActive = false;
    }
    
    // Load recent species list
    const rawList = localStorage.getItem('spectrolipi.recentSpecies.v1');
    if (rawList) {
      recentSpecies = JSON.parse(rawList);
    }
  } catch(e) {}

  // Create UI
  const container = document.createElement('div');
  container.id = 'recentSpeciesPanel';
  container.style.cssText = `
    position: fixed;
    right: 14px;
    top: 80px;
    width: 200px;
    background: rgba(17, 17, 17, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 6px;
    z-index: 999990;
    backdrop-filter: blur(4px);
    display: none;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
  `;

  // Header with toggle button
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.5);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    cursor: grab;
    user-select: none;
  `;
  
  const titleGroup = document.createElement('div');
  titleGroup.style.cssText = 'display:flex; align-items:center; gap:6px; pointer-events: none;';
  
  const title = document.createElement('div');
  title.textContent = 'Recent Species';
  title.style.cssText = 'font-size: 11px; font-weight: 600; color: #aaa; text-transform: uppercase; pointer-events: none;';
  
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'mode-btn';
  toggleBtn.title = 'Cycle display mode: Scientific / Common';
  toggleBtn.style.cssText = 'padding: 2px 6px; font-size: 11px; height: 20px; pointer-events: auto;';
  
  const badgeClasses = {
    'common': 'mode-badge m-Common',
    'scientific': 'mode-badge m-Sci'
  };
  const badgeLabels = {
    'common': 'Com',
    'scientific': 'Sci'
  };
  
  function updateToggleUI() {
    toggleBtn.innerHTML = `<span class="${badgeClasses[displayMode]}">${badgeLabels[displayMode]}</span>`;
  }
  updateToggleUI();

  toggleBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    displayMode = displayMode === 'scientific' ? 'common' : 'scientific';
    updateToggleUI();
    renderList();
  });

  const closeBtn = document.createElement('span');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'cursor: pointer; padding: 0 4px; font-size: 12px; color: #ccc; pointer-events: auto;';
  closeBtn.onpointerdown = (e) => e.stopPropagation();
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    setFloatingRecentSpecies(false);
  };

  titleGroup.appendChild(title);
  titleGroup.appendChild(toggleBtn);
  header.appendChild(titleGroup);
  header.appendChild(closeBtn);
  container.appendChild(header);

  // Dragging logic
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  header.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || e.target === closeBtn) return;
    isDragging = true;
    header.style.cursor = 'grabbing';
    const rect = container.getBoundingClientRect();
    
    // offset relative to the container's position
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    
    try { header.setPointerCapture(e.pointerId); } catch(err) {}
  });

  header.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    
    let newLeft = e.clientX - dragOffsetX;
    let newTop = e.clientY - dragOffsetY;
    
    const maxLeft = window.innerWidth - container.offsetWidth;
    const maxTop = window.innerHeight - container.offsetHeight;
    
    container.style.right = 'auto'; // Disable 'right' so 'left' takes over
    container.style.left = `${Math.max(0, Math.min(newLeft, maxLeft))}px`;
    container.style.top = `${Math.max(0, Math.min(newTop, maxTop))}px`;
  });

  header.addEventListener('pointerup', (e) => {
    isDragging = false;
    header.style.cursor = 'grab';
    try { header.releasePointerCapture(e.pointerId); } catch(err) {}
  });

  // List container
  const listContainer = document.createElement('div');
  listContainer.style.cssText = `
    display: flex;
    flex-direction: column;
    max-height: none;
  `;
  container.appendChild(listContainer);

  function renderList() {
    if (recentSpecies.length === 0 || !isActive || !isSpectrogramLoaded) {
      container.style.display = 'none';
      return;
    }
    
    container.style.display = 'flex';
    listContainer.innerHTML = '';
    
    recentSpecies.forEach((sp, idx) => {
      const row = document.createElement('div');
      row.style.cssText = `
        padding: 6px 10px;
        font-size: 12px;
        color: #fff;
        cursor: pointer;
        border-bottom: 1px solid rgba(255,255,255,0.05);
        transition: background 0.1s;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      `;
      if (idx === recentSpecies.length - 1) {
        row.style.borderBottom = 'none';
      }
      
      const primaryText = displayMode === 'common' ? (sp.common || sp.scientific) : (sp.scientific || sp.common);
      row.textContent = primaryText;
      
      row.addEventListener('mouseenter', () => {
        row.style.background = 'rgba(21, 101, 192, 0.7)';
      });
      row.addEventListener('mouseleave', () => {
        row.style.background = 'transparent';
      });
      
      row.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        triggerSelection(sp);
      });
      
      listContainer.appendChild(row);
    });
  }

  function setFloatingRecentSpecies(state) {
    isActive = !!state;
    renderList();
    
    try {
      const raw = localStorage.getItem('spectrolipi.settings.v1');
      if (raw) {
        const s = JSON.parse(raw);
        if (s.recentSpeciesEnabled !== isActive) {
          s.recentSpeciesEnabled = isActive;
          localStorage.setItem('spectrolipi.settings.v1', JSON.stringify(s));
          // Update the checkbox in the settings modal if it's open
          const cb = document.getElementById('ss-recent-species');
          if (cb) cb.checked = isActive;
        }
      }
    } catch (e) {}
  }
  window.setFloatingRecentSpecies = setFloatingRecentSpecies;

  function triggerSelection(sp) {
     const elHidden = document.getElementById('selectedSpeciesKey');
     const elResult = document.getElementById('speciesResult');
     const elClear = document.getElementById('speciesClearBtn');
     const elResultWrap = document.querySelector('.species-result-wrap');
     if (!elHidden || !elResult || !elResultWrap) return;
     
     if (elHidden.value === sp.scientific && elResult.textContent === (sp.scientific || sp.common)) {
         return; 
     }

     elHidden.value = sp.scientific || '';
     elResult.textContent = sp.scientific || sp.common || '';
     elResult.title = sp.scientific || sp.common || '';
     elResult.dataset.common = sp.common || '';
     elResult.dataset.scientific = sp.scientific || '';
     if (elClear) elClear.style.display = 'inline-flex';
     elResultWrap.classList.remove('empty');
     elHidden.dispatchEvent(new Event('input', { bubbles: true }));
     
     const wrapper = document.querySelector('.species-search');
     if (wrapper) wrapper.dispatchEvent(new CustomEvent('species-select', { detail: { common: sp.common, scientific: sp.scientific }, bubbles: true }));
  }

  function injectContainer() {
    const parent = document.body;
    if (parent && !document.getElementById('recentSpeciesPanel')) {
      parent.appendChild(container);
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    injectContainer();
    renderList(); // Initial render for persisted items
  });
  injectContainer();
  renderList(); // Initial render if DOM already loaded

  window.addEventListener('spectrogram-generated', () => {
    isSpectrogramLoaded = true;
    renderList();
  });

  // Listen for species selections globally
  document.addEventListener('species-select', (e) => {
    if (!e.detail || (!e.detail.scientific && !e.detail.common)) return;
    
    const sp = {
      common: e.detail.common || '',
      scientific: e.detail.scientific || ''
    };
    
    recentSpecies = recentSpecies.filter(x => (x.scientific || x.common) !== (sp.scientific || sp.common));
    recentSpecies.unshift(sp);
    
    if (recentSpecies.length > MAX_SPECIES) {
      recentSpecies.pop();
    }
    
    // Save updated list to localStorage
    try {
      localStorage.setItem('spectrolipi.recentSpecies.v1', JSON.stringify(recentSpecies));
    } catch(err) {}
    
    renderList();
  });

})();
