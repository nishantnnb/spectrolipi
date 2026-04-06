// update_tags.js
// Bulk-update tags (Sex, Life Stage, Sound Type) via modal overlay.

(function () {
  if (!window || !document) return;

  const BTN_ID = 'updateTagsBtn';
  const MODAL_ID = 'updateTagsModal';

  const selectedIds = new Set(); 

  function getGrid() { try { return window.annotationGrid || null; } catch (e) { return null; } }
  
  function getSelectedRowIdsFromGrid() {
    const grid = getGrid();
    let ids = [];
    if (grid && typeof grid.getSelectedData === 'function' && grid.initialized !== false) {
      try { ids = (grid.getSelectedData() || []).map(r => r && r.id).filter(v => v !== undefined && v !== null); } catch (e) {}
    }
    // Fallback to active edit session if grid selection lags
    if (ids.length === 0) {
      try { if (globalThis._editAnnotations && globalThis._editAnnotations.getEditingId()) ids = [globalThis._editAnnotations.getEditingId()]; } catch(e){}
    }
    return ids;
  }

  function buildModal(groupId, prefill) {
    let wrap = document.getElementById(MODAL_ID);
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = MODAL_ID;
      wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:2147483655;display:none;align-items:center;justify-content:center;backdrop-filter:blur(2px);';
      document.body.appendChild(wrap);
    }

    const card = document.createElement('div');
    card.className = 'card';
    card.style.cssText = 'background:#111;color:#fff;width:95%;max-width:640px;padding:16px;border-radius:10px;box-shadow:0 12px 36px rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.05);font-family:system-ui,sans-serif;max-height:90vh;overflow-y:auto;';

    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="margin:0;font-size:16px;font-weight:600;">Update Tags (Group ID: ${groupId})</h3>
        <button id="ut-close" style="background:transparent;border:0;color:#9ca3af;font-size:22px;cursor:pointer;line-height:1;">&times;</button>
      </div>
      <div style="margin-bottom:12px;font-size:12px;color:#cbd5e1;">Select tags to apply to the selected rows. Select 'Clear' to clear the tag.</div>
      <div id="ut-dynamic-content"></div>
    `;

    const dynamicContentArea = card.querySelector('#ut-dynamic-content');

    const tagGroups = window.__tagGroups ? window.__tagGroups[groupId] : null;

    if (!tagGroups) {
        dynamicContentArea.innerHTML = '<div style="color:#fbb;font-size:14px;">No tag options found for this group ID. Make sure tag-groups.js is loaded.</div>';
    } else {
        const SEX_OPTIONS = tagGroups.sex || [];
        const LIFESTAGE_OPTIONS = tagGroups.life_stage || [];
        const SOUNDTYPE_OPTIONS = tagGroups.sound_type || [];

        const prefillSex = prefill && prefill.sex ? prefill.sex.split(',').map(s=>s.trim()).filter(Boolean) : [];
        const prefillLifeStage = prefill && prefill.lifeStage ? prefill.lifeStage.split(',').map(s=>s.trim()).filter(Boolean) : [];
        const prefillSoundType = prefill && prefill.soundType ? prefill.soundType.split(',').map(s=>s.trim()).filter(Boolean) : [];

        if (SEX_OPTIONS.length) dynamicContentArea.appendChild(createSection('Sex', SEX_OPTIONS, 'sex', prefillSex));
        if (LIFESTAGE_OPTIONS.length) dynamicContentArea.appendChild(createSection('Life Stage', LIFESTAGE_OPTIONS, 'lifestage', prefillLifeStage));
        if (SOUNDTYPE_OPTIONS.length) dynamicContentArea.appendChild(createSection('Sound Type', SOUNDTYPE_OPTIONS, 'soundtype', prefillSoundType));
    }

    function createSection(title, options, prefix, preselectedArr) {
      const sec = document.createElement('div');
      sec.style.marginBottom = '12px';
      sec.style.display = 'flex';
      sec.style.alignItems = 'flex-start';
      sec.style.gap = '8px';

      const heading = document.createElement('div');
      heading.textContent = title + ':';
      heading.style.fontWeight = '600';
      heading.style.color = '#cbd5e1';
      heading.style.fontSize = '12px';
      heading.style.width = '75px';
      heading.style.paddingTop = '6px';
      heading.style.flexShrink = '0';
      sec.appendChild(heading);

      const tagsWrap = document.createElement('div');
      tagsWrap.style.display = 'flex';
      tagsWrap.style.flexWrap = 'wrap';
      tagsWrap.style.gap = '4px';

      const allOptions = [...options, { isClear: true, val: '', label: 'Clear' }];

      allOptions.forEach(optObj => {
        const isClear = typeof optObj === 'object' && optObj.isClear;
        const optVal = isClear ? optObj.val : optObj;
        const optLabel = isClear ? optObj.label : optObj;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.category = prefix;
        btn.dataset.val = optVal;
        btn.textContent = optLabel;
        
        const isSelected = (!isClear && preselectedArr && preselectedArr.includes(optVal));
        
        const defaultBg = isClear ? '#4b2020' : '#374151';
        const defaultColor = isClear ? '#fca5a5' : '#d1d5db';
        const defaultBorder = isClear ? '#7f1d1d' : '#4b5563';
        const activeBg = isClear ? '#ef4444' : '#10b981';
        const activeBorder = isClear ? '#dc2626' : '#059669';

        btn.style.cssText = `background:${isSelected ? activeBg : defaultBg};color:${isSelected ? '#fff' : defaultColor};border:1px solid ${isSelected ? activeBorder : defaultBorder};padding:4px 10px;border-radius:14px;font-size:11px;cursor:pointer;transition:all 0.15s ease;`;
        
        if (isSelected) {
            btn.classList.add('selected-tag');
        }

        btn.onclick = () => {
          const wasSelected = btn.classList.contains('selected-tag');
          
          // Deselect all tags in this category first
          tagsWrap.querySelectorAll('button').forEach(sib => {
            sib.classList.remove('selected-tag');
            const sibIsClear = sib.dataset.val === '';
            sib.style.background = sibIsClear ? '#4b2020' : '#374151';
            sib.style.color = sibIsClear ? '#fca5a5' : '#d1d5db';
            sib.style.borderColor = sibIsClear ? '#7f1d1d' : '#4b5563';
          });

          // If it wasn't selected before, select it now
          if (!wasSelected) { // Only select if it wasn't already selected
            btn.classList.add('selected-tag');
            btn.style.background = activeBg;
            btn.style.color = '#fff';
            btn.style.borderColor = activeBorder;
          }
        };

        tagsWrap.appendChild(btn);
      });

      sec.appendChild(tagsWrap);
      return sec;
    }

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.justifyContent = 'flex-end';
    actions.style.gap = '12px';
    actions.style.marginTop = '16px';
    
    actions.innerHTML = `
      <button id="ut-cancel" class="btn" style="background:transparent;border:1px solid #4b5563;color:#cbd5e1;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px;">Cancel</button>
      <button id="ut-ok" class="btn" style="background:#2196F3;color:#fff;border:none;padding:6px 20px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">OK</button>
    `;
    card.appendChild(actions);

    // Replace existing card or append new one
    const existingCard = wrap.querySelector('.card');
    if (existingCard) {
        wrap.replaceChild(card, existingCard);
    } else {
        wrap.appendChild(card);
    }

    wrap.querySelector('#ut-close').onclick = () => wrap.style.display = 'none';
    wrap.querySelector('#ut-cancel').onclick = () => wrap.style.display = 'none';
    wrap.querySelector('#ut-ok').onclick = applyTags;

    return wrap;
  }

  function openModal() {
    try {
      const grid = getGrid();
      if (!grid) {
        alert('Annotation grid not available.');
        return;
      }

      const allAnnotations = grid.getData();
      const selectedAnnotations = allAnnotations.filter(ann => selectedIds.has(String(ann.id)));

      if (selectedAnnotations.length === 0) {
        alert('No rows selected. Please select one or more rows to update.');
        return;
      }

      const groupIds = new Set();
      let scientificNameNotFound = false;

      let commonSex = undefined;
      let commonLifeStage = undefined;
      let commonSoundType = undefined;
      let first = true;

      for (const ann of selectedAnnotations) {
        const scientificName = ann.scientificName;
        if (!scientificName) {
          scientificNameNotFound = true;
          break;
        }
        let groupId = ann.group_id;
        if (groupId === null || groupId === undefined || groupId === '') {
          const recs = window.__speciesRecords || [];
          const found = recs.find(s => s.scientific && s.scientific.toLowerCase() === String(scientificName).trim().toLowerCase());
          if (found && found.group_id !== undefined) groupId = String(found.group_id);
        }
        if (groupId === null || groupId === undefined || groupId === '') { 
          scientificNameNotFound = true;
          break;
        }
        groupIds.add(String(groupId));

        const sex = ann.sex || '';
        const ls = ann.lifeStage || '';
        const st = ann.soundType || '';
        if (first) {
            commonSex = sex;
            commonLifeStage = ls;
            commonSoundType = st;
            first = false;
        } else {
            if (commonSex !== sex) commonSex = null;
            if (commonLifeStage !== ls) commonLifeStage = null;
            if (commonSoundType !== st) commonSoundType = null;
        }
      }

      if (scientificNameNotFound) {
        alert('Could not determine a consistent taxa group for all selected species. Ensure all selected annotations have a scientific name and a corresponding group_id in species-data.js.');
        return;
      }

      if (groupIds.size > 1) {
        alert('Taxa group not matching for all selected rows.');
        return;
      }

      const singleGroupId = Array.from(groupIds)[0];

      if (singleGroupId === '0') {
        alert('No tags available for this taxa group (Group ID 0).');
        return;
      }

      const prefill = {
          sex: commonSex || '',
          lifeStage: commonLifeStage || '',
          soundType: commonSoundType || ''
      };

      const wrap = buildModal(singleGroupId, prefill);
      wrap.style.display = 'flex';
    } catch (err) {
      console.error("Error opening tags modal:", err);
      alert("An error occurred opening the tags modal. Check the console.");
    }
  }

    // Expose openModal function
    globalThis._openTagModal = function(){
      openModal();
    }

  function applyTags() {
    const wrap = document.getElementById(MODAL_ID);
    if (!wrap) return;

    const sexVals = [];
    const lifeStageVals = [];
    const soundTypeVals = [];

    wrap.querySelectorAll('.selected-tag').forEach(btn => {
      if (btn.dataset.category === 'sex') sexVals.push(btn.dataset.val);
      if (btn.dataset.category === 'lifestage') lifeStageVals.push(btn.dataset.val); // Single selection enforced by UI
      if (btn.dataset.category === 'soundtype') soundTypeVals.push(btn.dataset.val); // Single selection enforced by UI
    });

    const updates = Array.from(selectedIds).map(id => {
      const obj = { id: isNaN(id) ? id : Number(id) };
      if (sexVals.length > 0) obj.sex = sexVals.join(', ');
      if (lifeStageVals.length > 0) obj.lifeStage = lifeStageVals.join(', ');
      if (soundTypeVals.length > 0) obj.soundType = soundTypeVals.join(', ');
      return obj;
    });

    // Only push values to the grid if the user selected at least one tag
    if (updates.length > 0 && (sexVals.length > 0 || lifeStageVals.length > 0 || soundTypeVals.length > 0)) {
      const grid = getGrid();
      if (grid && typeof grid.updateData === 'function') {
        grid.updateData(updates);
        try { window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: 'update-tags', ids: Array.from(selectedIds) } })); } catch (e) {}
      }
    }

    wrap.style.display = 'none';
  }

  function init() {
    const btn = document.getElementById(BTN_ID);
    if (btn) {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        selectedIds.clear();
        getSelectedRowIdsFromGrid().forEach(id => selectedIds.add(String(id)));
         if (selectedIds.size === 0) {
          alert('No rows selected. Please select one or more rows to update.');
          return;
        }
        openModal();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }

})();