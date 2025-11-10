// annotation_undo.js
// Simple in-memory undo/redo manager (bounded stack) with a tiny toast UI and undo/redo buttons.
(function () {
  const MAX_STACK = 10;

  function getGrid() {
    return window.annotationGrid || null;
  }

  function callRender() {
    try { if (typeof window.renderAllAnnotations === 'function') window.renderAllAnnotations(); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: 'undo-redo' } })); } catch (e) {}
  }

  const manager = {
    stack: [],
    index: -1,
    push(action) {
      // trim forward history
      if (this.index < this.stack.length - 1) this.stack.splice(this.index + 1);
      this.stack.push(action);
      if (this.stack.length > MAX_STACK) this.stack.shift();
      this.index = this.stack.length - 1;
      updateButtons();
    },
    canUndo() { return this.index >= 0; },
    canRedo() { return this.index < this.stack.length - 1; },
    undo() {
      if (!this.canUndo()) return false;
      const act = this.stack[this.index];
      this._applyInverse(act);
      this.index -= 1;
      updateButtons();
      return true;
    },
    redo() {
      if (!this.canRedo()) return false;
      const act = this.stack[this.index + 1];
      this._apply(act);
      this.index += 1;
      updateButtons();
      return true;
    },
    _applyInverse(act) {
      try {
        const g = getGrid();
        switch (act.type) {
          case 'create':
            if (g && typeof g.deleteRow === 'function') { try { g.deleteRow(act.id); } catch (e) {} }
            else if (window._annotations && typeof window._annotations.delete === 'function') try { window._annotations.delete(act.id); } catch (e) {}
            break;
          case 'edit':
            if (g && typeof g.updateRow === 'function') { try { g.updateRow(act.id, act.before); } catch (e) {} }
            else {
              try { const all = window._annotations.getAll(); const idx = (all||[]).findIndex(x=>String(x.id)===String(act.id)); if(idx>=0){ all[idx]=Object.assign({}, all[idx], act.before); if(typeof window._annotations.import==='function') window._annotations.import(all); } } catch(e){}
            }
            break;
          case 'delete':
            if (g && typeof g.addData === 'function') { try { g.addData([act.before]); } catch (e) {} }
            else if (window._annotations && typeof window._annotations.import === 'function') {
              try { const all = window._annotations.getAll(); all.push(act.before); if(typeof window._annotations.import==='function') window._annotations.import(all); } catch (e) {}
            }
            break;
        }
      } catch (e) { console.error('undo failed', e); }
      callRender();
    },
    _apply(act) {
      try {
        const g = getGrid();
        switch (act.type) {
          case 'create':
            if (g && typeof g.addData === 'function') { try { g.addData([act.row]); } catch (e) {} }
            else if (window._annotations && typeof window._annotations.import === 'function') {
              try { const all = window._annotations.getAll(); all.push(act.row); if(typeof window._annotations.import==='function') window._annotations.import(all); } catch (e) {}
            }
            break;
          case 'edit':
            if (g && typeof g.updateRow === 'function') { try { g.updateRow(act.id, act.after); } catch (e) {} }
            else {
              try { const all = window._annotations.getAll(); const idx = (all||[]).findIndex(x=>String(x.id)===String(act.id)); if(idx>=0){ all[idx]=Object.assign({}, all[idx], act.after); if(typeof window._annotations.import==='function') window._annotations.import(all); } } catch(e){}
            }
            break;
          case 'delete':
            if (g && typeof g.deleteRow === 'function') { try { g.deleteRow(act.id); } catch (e) {} }
            else if (window._annotations && typeof window._annotations.delete === 'function') {
              try { window._annotations.delete(act.id); } catch (e) {}
            }
            break;
        }
      } catch (e) { console.error('redo failed', e); }
      callRender();
    }
  };

  // Simple toast/snackbar UI
  let toastEl = null;
  function ensureToast() {
    if (toastEl) return toastEl;
    toastEl = document.createElement('div');
    toastEl.id = 'annotationToast';
    toastEl.style.position = 'fixed';
    toastEl.style.right = '12px';
    toastEl.style.bottom = '12px';
    toastEl.style.minWidth = '220px';
    toastEl.style.padding = '8px 12px';
    toastEl.style.background = 'rgba(0,0,0,0.78)';
    toastEl.style.color = '#fff';
    toastEl.style.borderRadius = '6px';
    toastEl.style.boxShadow = '0 6px 18px rgba(0,0,0,0.4)';
    toastEl.style.display = 'none';
    toastEl.style.zIndex = 120;
    document.body.appendChild(toastEl);
    return toastEl;
  }

  let toastTimer = 0;
  function showToast(message, actions = []) {
    const t = ensureToast();
    t.innerHTML = '';
    const msg = document.createElement('span'); msg.textContent = message; t.appendChild(msg);
    const btnWrap = document.createElement('span'); btnWrap.style.marginLeft = '8px';
    actions.forEach(a => {
      const b = document.createElement('button'); b.textContent = a.label; b.style.marginLeft = '8px'; b.style.background = 'transparent'; b.style.border = '1px solid rgba(255,255,255,0.12)'; b.style.color = '#fff'; b.style.padding = '4px 8px'; b.style.borderRadius = '4px'; b.addEventListener('click', a.onClick); btnWrap.appendChild(b);
    });
    t.appendChild(btnWrap);
    t.style.display = 'block';
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = 0; }
    toastTimer = setTimeout(() => { t.style.display = 'none'; toastTimer = 0; }, 6000);
  }

  // Undo/Redo buttons in the page (small bar)
  function ensureButtons() {
    if (document.getElementById('annotationUndoBtn')) return;
    const wrap = document.createElement('div');
    wrap.style.position = 'fixed'; wrap.style.left = '12px'; wrap.style.bottom = '12px'; wrap.style.zIndex = 120; wrap.style.display = 'flex'; wrap.style.gap = '8px';
    const u = document.createElement('button'); u.id = 'annotationUndoBtn'; u.textContent = 'Undo'; u.title = 'Undo (Ctrl/Cmd+Z)';
    const r = document.createElement('button'); r.id = 'annotationRedoBtn'; r.textContent = 'Redo'; r.title = 'Redo (Ctrl/Cmd+Y)';
    [u, r].forEach(b => { b.style.padding = '6px 10px'; b.style.background = 'rgba(0,0,0,0.6)'; b.style.color = '#fff'; b.style.border = '1px solid rgba(255,255,255,0.08)'; b.style.borderRadius = '6px'; });
    u.addEventListener('click', () => { manager.undo(); });
    r.addEventListener('click', () => { manager.redo(); });
    wrap.appendChild(u); wrap.appendChild(r);
    document.body.appendChild(wrap);
    updateButtons();
  }

  function updateButtons() {
    try {
      const u = document.getElementById('annotationUndoBtn');
      const r = document.getElementById('annotationRedoBtn');
      if (u) u.disabled = !manager.canUndo();
      if (r) r.disabled = !manager.canRedo();
    } catch (e) {}
  }

  // Keyboard bindings: Ctrl/Cmd+Z and Ctrl+Y / Ctrl+Shift+Z
  window.addEventListener('keydown', (ev) => {
    try {
      const mod = ev.ctrlKey || ev.metaKey;
      if (!mod) return;
      if (ev.key === 'z' || ev.key === 'Z') {
        ev.preventDefault(); manager.undo();
      } else if (ev.key === 'y' || ev.key === 'Y') { ev.preventDefault(); manager.redo(); }
    } catch (e) {}
  });

  // Expose API
  window._annotationUndo = manager;
  window._annotationUndo.showToast = showToast;
  window._annotationUndo.ensureButtons = ensureButtons;

  // Init UI when DOM ready
  try { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureButtons); else setTimeout(ensureButtons, 120); } catch (e) { setTimeout(ensureButtons, 120); }

})();
