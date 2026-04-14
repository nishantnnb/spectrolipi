// magnifier.js
// Implements a floating, draggable magnifier tool for precision annotation.

(function () {
  if (window.__magnifierInit) return;
  window.__magnifierInit = true;

  const MAGNIFIER_SIZE = 300; // Size of the floating window (px)
  const ZOOM_LEVEL = 4;       // 4x zoom (so it captures a 50x50 area)
  const SOURCE_SIZE = MAGNIFIER_SIZE / ZOOM_LEVEL;

  let isActive = false;
  let container, magCanvas, magCtx, header;

  function init() {
    // 1. Create the floating UI
    container = document.createElement('div');
    container.id = 'floatingMagnifier';
    container.style.position = 'fixed';
    const initialLeft = Math.max(20, window.innerWidth - MAGNIFIER_SIZE - 40);
    container.style.left = `${initialLeft}px`;
    container.style.top = '80px';
    container.style.width = `${MAGNIFIER_SIZE}px`;
    container.style.background = '#111';
    container.style.border = '2px solid #2196F3';
    container.style.borderRadius = '8px';
    container.style.boxShadow = '0 8px 32px rgba(0,0,0,0.6)';
    container.style.zIndex = '999999';
    container.style.display = 'none';
    container.style.flexDirection = 'column';
    container.style.overflow = 'hidden';
    container.style.fontFamily = 'system-ui, sans-serif';

    // Draggable Header
    header = document.createElement('div');
    header.style.background = '#2196F3';
    header.style.color = '#fff';
    header.style.padding = '4px 8px';
    header.style.fontSize = '12px';
    header.style.fontWeight = 'bold';
    header.style.cursor = 'grab';
    header.style.userSelect = 'none';
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    
    const title = document.createElement('span');
    title.textContent = 'Magnifier (4x)';
    title.style.pointerEvents = 'none';
    header.appendChild(title);
    
    const closeBtn = document.createElement('span');
    closeBtn.textContent = '✕';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.padding = '0 4px';
    closeBtn.onpointerdown = (e) => e.stopPropagation();
    closeBtn.onclick = (e) => { e.stopPropagation(); toggleMagnifier(); };
    header.appendChild(closeBtn);
    
    // Magnifier Canvas
    magCanvas = document.createElement('canvas');
    magCanvas.width = MAGNIFIER_SIZE;
    magCanvas.height = MAGNIFIER_SIZE;
    magCanvas.style.display = 'block';
    magCanvas.style.width = `${MAGNIFIER_SIZE}px`;
    magCanvas.style.height = `${MAGNIFIER_SIZE}px`;
    magCanvas.style.pointerEvents = 'none'; // Click through the canvas
    
    // Center Crosshair for the magnifier
    magCtx = magCanvas.getContext('2d', { alpha: false });
    if (magCtx) magCtx.imageSmoothingEnabled = false; // Keep pixels sharp

    container.appendChild(header);
    container.appendChild(magCanvas);
    document.body.appendChild(container);

    // 2. Make the window draggable
    let isDragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    header.addEventListener('pointerdown', (e) => {
      isDragging = true;
      header.style.cursor = 'grabbing';
      const rect = container.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      try { header.setPointerCapture(e.pointerId); } catch(err) {}
    });

    header.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      let newLeft = e.clientX - dragOffsetX;
      let newTop = e.clientY - dragOffsetY;
      
      const rect = container.getBoundingClientRect();
      const maxLeft = window.innerWidth - rect.width;
      const maxTop = window.innerHeight - rect.height;
      
      container.style.left = `${Math.max(0, Math.min(newLeft, maxLeft))}px`;
      container.style.top = `${Math.max(0, Math.min(newTop, maxTop))}px`;
    });

    header.addEventListener('pointerup', (e) => {
      isDragging = false;
      header.style.cursor = 'grab';
      try { header.releasePointerCapture(e.pointerId); } catch(err) {}
    });

    // Hook into the main window pointer movement
    window.addEventListener('pointermove', updateMagnifier, { passive: true });

    // Restore saved state on load safely
    try {
      const raw = localStorage.getItem('spectrolipi.settings.v1');
      if (raw) {
        const s = JSON.parse(raw);
        if (s.magnifierEnabled) setMagnifier(true);
      }
    } catch (e) {}
  }

  // 3 & 4. Inspect the Spectrogram via Matrix Transformation
  function updateMagnifier(e) {
    if (!isActive || !magCtx) return;
    
    const specCanvas = document.getElementById('spectrogramCanvas');
    if (!specCanvas) return;

    const baseRect = specCanvas.getBoundingClientRect();
    
    // Only update if mouse is actively inside the spectrogram
    if (e.clientX < baseRect.left || e.clientX > baseRect.right || e.clientY < baseRect.top || e.clientY > baseRect.bottom) {
      return; 
    }

    const mouseX = e.clientX - baseRect.left;
    const mouseY = e.clientY - baseRect.top;

    // Clear and draw background
    magCtx.fillStyle = '#111';
    magCtx.fillRect(0, 0, MAGNIFIER_SIZE, MAGNIFIER_SIZE);

    magCtx.save();
    // Center the rendering context
    magCtx.translate(MAGNIFIER_SIZE / 2, MAGNIFIER_SIZE / 2);
    // Scale up
    magCtx.scale(ZOOM_LEVEL, ZOOM_LEVEL);
    // Shift by the mouse position so the mouse coordinate becomes the origin (0,0)
    magCtx.translate(-mouseX, -mouseY);

    // Safely draw all layers using their CSS layout dimensions
    const layers = ['spectrogramCanvas', 'annotationOverlay', 'annotationSelectionOverlay', 'editHighlightOverlay'];
    for (const id of layers) {
        const canvas = document.getElementById(id);
        if (canvas && canvas.width > 0 && canvas.height > 0) {
            const rect = canvas.getBoundingClientRect();
            const dx = rect.left - baseRect.left;
            const dy = rect.top - baseRect.top;
            try { magCtx.drawImage(canvas, dx, dy, canvas.clientWidth, canvas.clientHeight); } catch(err) {}
        }
    }
    magCtx.restore();
    
    // Draw a subtle crosshair in the center of the magnifier
    magCtx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    magCtx.lineWidth = 1;
    magCtx.beginPath();
    magCtx.moveTo(MAGNIFIER_SIZE / 2, 0);
    magCtx.lineTo(MAGNIFIER_SIZE / 2, MAGNIFIER_SIZE);
    magCtx.moveTo(0, MAGNIFIER_SIZE / 2);
    magCtx.lineTo(MAGNIFIER_SIZE, MAGNIFIER_SIZE / 2);
    magCtx.stroke();
  }

  // 5. Toggle and Set Visibility
  function setMagnifier(state) {
    isActive = !!state;
    if (container) {
      container.style.display = isActive ? 'flex' : 'none';
    }

    try {
      const raw = localStorage.getItem('spectrolipi.settings.v1');
      if (raw) {
        const s = JSON.parse(raw);
        if (s.magnifierEnabled !== isActive) {
          s.magnifierEnabled = isActive;
          localStorage.setItem('spectrolipi.settings.v1', JSON.stringify(s));
        }
      }
    } catch (e) {}
  }

  function toggleMagnifier() {
    setMagnifier(!isActive);
  }

  // Expose toggle to the global scope so a toolbar button can call it
  window.toggleFloatingMagnifier = toggleMagnifier;
  window.setFloatingMagnifier = setMagnifier;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();