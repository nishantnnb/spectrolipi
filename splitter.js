// splitter.js
// Handles horizontal splitter to resize spectrogram and annotation grid seamlessly

(function() {
  const splitter = document.getElementById('uiSplitter');
  const viewportWrapper = document.getElementById('viewportWrapper');
  const scrollArea = document.getElementById('scrollArea');
  const axisCanvas = document.getElementById('axisCanvas');
  const spectrogramCanvas = document.getElementById('spectrogramCanvas');

  if (!splitter || !viewportWrapper) return;

  // Style the splitter slightly on hover for visual feedback
  splitter.addEventListener('mouseenter', () => { if (!isDragging) splitter.style.background = '#2a313e'; });
  splitter.addEventListener('mouseleave', () => { if (!isDragging) splitter.style.background = '#1e222b'; });

  let isDragging = false;
  let startY = 0;
  let startH = 0;

  splitter.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;
    isDragging = true;
    startY = e.clientY;
    startH = viewportWrapper.clientHeight || 420;
    document.body.style.cursor = 'ns-resize';
    splitter.style.background = '#1d4ed8'; // Highlight primary blue while dragging
    e.preventDefault();
  });

  window.addEventListener('mousemove', function(e) {
    if (!isDragging) return;
    const dy = e.clientY - startY;
    let newH = startH + dy;
    
    // Enforce reasonable boundaries so UI doesn't collapse
    if (newH < 150) newH = 150;
    const maxH = window.innerHeight - 150;
    if (newH > maxH) newH = maxH;
    
    // Instantly CSS stretch for 60fps dragging
    viewportWrapper.style.height = newH + 'px';
    if (spectrogramCanvas) spectrogramCanvas.style.height = newH + 'px';
    
    // Stretch all interaction overlays 
    const annotationOverlay = document.getElementById('annotationOverlay');
    const selectionOverlay = document.getElementById('annotationSelectionOverlay');
    const highlightOverlay = document.getElementById('editHighlightOverlay');
    const pointerLayer = document.getElementById('editPointerLayer');
    const glass = document.getElementById('spectroCutGlass');
    const xAxisOverlay = document.getElementById('xAxisOverlay');
    const timeFooter = document.getElementById('timeFooter');
    const labelContainer = document.getElementById('annotationLabelContainer_v1');

    const AXIS_TOP = 12;
    const AXIS_BOTTOM = 44;
    const imageH = Math.max(1, newH - AXIS_TOP - AXIS_BOTTOM);

    // Update global height so mathematical element positioning stays accurate
    globalThis._spectroImageHeight = imageH;

    if (annotationOverlay) annotationOverlay.style.height = imageH + 'px';
    if (selectionOverlay) selectionOverlay.style.height = imageH + 'px';
    if (highlightOverlay) highlightOverlay.style.height = imageH + 'px';
    if (pointerLayer) pointerLayer.style.height = imageH + 'px';
    if (glass) glass.style.height = imageH + 'px';
    
    if (xAxisOverlay) xAxisOverlay.style.top = (AXIS_TOP + imageH) + 'px';
    if (timeFooter) timeFooter.style.top = (AXIS_TOP + imageH) + 'px';
    if (labelContainer) labelContainer.style.height = imageH + 'px';

  });

  window.addEventListener('mouseup', function(e) {
    if (!isDragging) return;
    isDragging = false;
    document.body.style.cursor = '';
    splitter.style.background = '#1e222b';
    applyResize(); // Redraw crisp FFTs based on final size
  });

  // Double-click snaps it back to default size!
  splitter.addEventListener('dblclick', function() {
    viewportWrapper.style.height = '420px';
    if (axisCanvas) axisCanvas.style.height = '420px';
    if (spectrogramCanvas) spectrogramCanvas.style.height = '420px';
    applyResize();
  });

  function applyResize() {
    const AXIS_TOP = 12;
    const AXIS_BOTTOM = 44;
    const currentH = viewportWrapper.clientHeight;
    
    globalThis._spectroImageHeight = Math.max(1, currentH - AXIS_TOP - AXIS_BOTTOM);

    if (axisCanvas) {
       axisCanvas.height = currentH;
       axisCanvas.style.height = currentH + 'px';
    }

    if (globalThis._spectrogram_reRenderFromSpectra) {
      const ymax = globalThis._spectroYMax || (globalThis._spectroSampleRate ? globalThis._spectroSampleRate / 2 : 22050);
      globalThis._spectrogram_reRenderFromSpectra(ymax).then(() => {
        adjustTableHeight();
        window.dispatchEvent(new Event('resize'));
      }).catch(err => {
        adjustTableHeight();
        window.dispatchEvent(new Event('resize'));
      });
    } else {
      adjustTableHeight();
      window.dispatchEvent(new Event('resize'));
    }
  }

  // Dynamically calculate and set Tabulator grid to exactly fill the remaining bottom space
  function adjustTableHeight() {
    if (window.annotationGrid) {
      const gridEl = document.getElementById('annotationGrid');
      if (gridEl) {
        const rect = gridEl.getBoundingClientRect();
        let remaining = window.innerHeight - rect.top - 16;
        if (remaining < 150) remaining = 150;
        gridEl.style.height = remaining + "px";
        if (typeof window.annotationGrid.setHeight === 'function') {
          window.annotationGrid.setHeight(remaining);
          window.annotationGrid.redraw(true); // Force Tabulator to refresh Virtual DOM row sequences
        }
      }
    }
  }

  window.addEventListener('resize', () => { if (!isDragging) adjustTableHeight(); });
  setTimeout(adjustTableHeight, 300);
  setTimeout(adjustTableHeight, 1000);
})();