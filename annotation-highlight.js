(function(){
  // Simplified bidirectional highlight coordinator
  // Ensures annotation overlay redraws on selection/scroll events and syncs edit-mode
  const THEME_BLUE = '33,150,243';

  function whenReady(cb){ if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', cb); else setTimeout(cb,0); }

  whenReady(()=>{
    try {
      const scrollArea = document.getElementById('scrollArea');
      if (!scrollArea) return;

      // Style for selected Tabulator rows (non-destructive)
      try {
        if(!document.querySelector('style[data-generated="annotation-highlight"]')){
          const css = `.tabulator-row.tabulator-selected { background-color: rgba(${THEME_BLUE},0.10) !important; } .tabulator-row.tabulator-selected .tabulator-cell { outline: 2px solid rgba(${THEME_BLUE},0.18) !important; }`;
          const st = document.createElement('style'); st.dataset.generated='annotation-highlight'; st.appendChild(document.createTextNode(css)); document.head.appendChild(st);
        }
      } catch(e){}

      function redraw(){
        try { if (typeof window.renderAllAnnotations === 'function') window.renderAllAnnotations(); } catch(e){}
        try { if (typeof window.renderSelectionOverlay === 'function') window.renderSelectionOverlay(); } catch(e){}
      }

      function hookGrid(){
        try {
          const g = window.annotationGrid; if(!g || !g.on) return;
          if(g.__annoHLHooked) return;
          g.on('rowSelectionChanged', redraw);
          g.on('dataChanged', redraw);
          g.on('dataLoaded', redraw);
          g.on('rowUpdated', redraw);
          g.on('rowDeleted', redraw);
          g.__annoHLHooked = true;
        } catch(e){}
      }

      // Spectrogram -> grid sync already handled in edit_annotations.js; still listen for event to force redraw
      window.addEventListener('edit-selection-changed', function(ev){
        try {
          const id = ev && ev.detail && ev.detail.editingId;
          if (id && typeof window.renderSelectionOverlay === 'function') window.renderSelectionOverlay([id]);
          redraw();
        } catch(e){}
      }, { passive: true });

      // Generic events updating overlays
      scrollArea.addEventListener('scroll', function(){ redraw(); }, { passive:true });
      window.addEventListener('resize', function(){ redraw(); }, { passive:true });
      window.addEventListener('annotations-changed', function(){ redraw(); }, { passive:true });
      window.addEventListener('spectrogram-generated', function(){ setTimeout(redraw, 30); }, { passive:true });

      // Poll until grid ready to hook events
      (function waitGrid(max=6000){
        const start=Date.now();
        (function loop(){ if(window.annotationGrid){ hookGrid(); redraw(); return; } if(Date.now()-start>max) return; setTimeout(loop,120); })();
      })();

      // Expose manual redraw for diagnostics
      window.__annotationHighlighter = { redraw };
    } catch(err){ console.error('annotation-highlight simplified init failed', err); }
  });
})();
