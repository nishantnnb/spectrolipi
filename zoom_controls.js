// zoom_controls.js
(function(){
  function whenReady(cb){ if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', cb); else setTimeout(cb,0); }

  function $(id){ return document.getElementById(id); }

  function pxPerSec(){
    try {
      if (typeof globalThis._spectroPxPerSec === 'number' && isFinite(globalThis._spectroPxPerSec) && globalThis._spectroPxPerSec > 0)
        return globalThis._spectroPxPerSec;
      if (typeof globalThis._spectroFramesPerSec === 'number' && typeof globalThis._spectroPxPerFrame === 'number')
        return Math.max(1, globalThis._spectroFramesPerSec * globalThis._spectroPxPerFrame);
    } catch(e){}
    return 1;
  }

  function clamp(val, lo, hi){ return Math.max(lo, Math.min(hi, val)); }

  function readYmaxInputHz(){
    try {
      const el = $('ymax');
      if (!el) return (typeof globalThis._spectroYMax === 'number') ? globalThis._spectroYMax : NaN;
      const raw = (el.value == null) ? '' : String(el.value).trim();
      if (!raw) return (typeof globalThis._spectroYMax === 'number') ? globalThis._spectroYMax : NaN;
      const kHz = Number(raw);
      if (!isFinite(kHz) || kHz <= 0) return (typeof globalThis._spectroYMax === 'number') ? globalThis._spectroYMax : NaN;
      return kHz * 1000;
    } catch(e){ return (typeof globalThis._spectroYMax === 'number') ? globalThis._spectroYMax : NaN; }
  }

  function setYmaxInputHz(hz){
    try { const el = $('ymax'); if (!el) return; const k = (hz/1000); el.value = String(Math.round(k * 100) / 100); } catch(e){}
  }

  function ensureSpacerWidth(imageW, imageH){
    try {
      const scrollArea = $('scrollArea'); if (!scrollArea) return;
      let spacer = document.getElementById('spectroSpacer');
      if (!spacer) { spacer = document.createElement('div'); spacer.id = 'spectroSpacer'; scrollArea.appendChild(spacer); }
      spacer.style.display = 'block';
      spacer.style.width = Math.max(1, imageW) + 'px';
      const AXIS_TOP = 12, AXIS_BOTTOM = 44;
      spacer.style.height = (AXIS_TOP + Math.max(1, imageH) + AXIS_BOTTOM) + 'px';
      spacer.style.pointerEvents = 'none';
      if (!scrollArea.style.position) scrollArea.style.position = 'relative';
    } catch(e){}
  }

  function captureLeftTime(){
    try {
      const sa = $('scrollArea'); if (!sa) return 0;
      const curPx = Math.max(0, Math.round(sa.scrollLeft || 0));
      return curPx / Math.max(1, pxPerSec());
    } catch(e){ return 0; }
  }

  function setLeftTime(sec){
    try {
      const sa = $('scrollArea'); if (!sa) return;
      const imageW = Number(globalThis._spectroImageWidth || 0) || 0;
      const vp = Math.max(1, sa.clientWidth || 0);
      const desired = Math.round(sec * Math.max(1, pxPerSec()));
      const clamped = Math.max(0, Math.min(Math.max(0, imageW - vp), desired));
      sa.scrollLeft = clamped;
    } catch(e){}
  }

  async function buildTilesFromSpectra(pxpf){
    const numFrames = Number(globalThis._spectroNumFrames || 0);
    const framesPerSec = Number(globalThis._spectroFramesPerSec || 0);
    const sr = Number(globalThis._spectroSampleRate || 0);
    const imageH = Number(globalThis._spectroImageHeight || 0) || 300;
    if (!numFrames || !framesPerSec || !sr) return false;

    const imageW = Math.max(1, Math.round(numFrames * pxpf));
    const tileW = Math.min(8192, imageW);
    const tiles = [];
    for (let tileX = 0; tileX < imageW; tileX += tileW) {
      const w = Math.min(tileW, imageW - tileX);
      const leftFrameIdx = Math.floor(tileX / pxpf);
      const startTime = Math.max(0, leftFrameIdx / framesPerSec);
      const endTime = Math.min((numFrames - 1) / framesPerSec, ((tileX + w - 1) / pxpf) / framesPerSec);
      tiles.push({ bitmap: null, cols: w, startCol: tileX, startTime, endTime, colorVersion: (globalThis._spectroColorVersion|0), lutName: (globalThis._spectroRenderParams && globalThis._spectroRenderParams.lutName) || 'custom', gain: (globalThis._spectroRenderParams && globalThis._spectroRenderParams.gain) || 1, ymax: Number(globalThis._spectroYMax || sr/2) });
      if ((tiles.length & 3) === 0) await new Promise(r=>setTimeout(r,0));
    }

    globalThis._spectroTiles = tiles;
    globalThis._spectroPxPerFrame = pxpf;
    const duration = Number(globalThis._spectroDuration || (numFrames/framesPerSec));
    if (typeof globalThis._spectroApplyDisplayScaleFromIntrinsic === 'function') {
      globalThis._spectroApplyDisplayScaleFromIntrinsic(imageW);
    } else {
      globalThis._spectroImageWidth = imageW;
      globalThis._spectroImageIntrinsicWidth = imageW;
      globalThis._spectroDisplayScaleX = 1;
      globalThis._spectroPxPerSec = isFinite(duration) && duration > 0 ? (imageW / duration) : (framesPerSec * pxpf);
    }
    try { globalThis._scheduleAnnotationOverlaySync && globalThis._scheduleAnnotationOverlaySync('zoom-buildTiles'); } catch (e) {}

    ensureSpacerWidth(imageW, imageH);
    return true;
  }

  function currentPxpf(){ return Number(globalThis._spectroPxPerFrame || 0) || 2; }
  const MAX_PXPF = 16; 

  async function applyXZoom(newPxpf){
    if (newPxpf === 'entire') {
        const numFrames = Number(globalThis._spectroNumFrames || 0);
        const scrollArea = $('scrollArea');
        if (numFrames > 0 && scrollArea && scrollArea.clientWidth > 0) {
            newPxpf = scrollArea.clientWidth / numFrames;
        } else {
            newPxpf = 1; // Fallback
        }
    }
    newPxpf = clamp(newPxpf, 0.01, MAX_PXPF);
    if (!globalThis._spectroSpectra) return;
    const oldPxpf = currentPxpf();
    if (Math.abs(newPxpf - oldPxpf) < 0.01) return;
    const capturedLeftSec = captureLeftTime();
    const ok = await buildTilesFromSpectra(newPxpf);
    if (!ok) return;
    const useY = readYmaxInputHz();
    try { if (typeof globalThis._spectrogram_reRenderFromSpectra === 'function') await globalThis._spectrogram_reRenderFromSpectra(useY); } catch(e){}
    setLeftTime(capturedLeftSec);
    try { window.dispatchEvent(new CustomEvent('spectrogram-generated', { detail: { meta: { reason: 'x-zoom', pxpf: newPxpf } } })); } catch(e){}
    forceAxisRefresh();
  }

  async function applyYZoom(newYHz){
    if (!globalThis._spectroSpectra) return;
    const nyq = globalThis._spectroOriginalNyquist || (Number(globalThis._spectroSampleRate || 0) / 2 || 22050);
    const clamped = clamp(Number(newYHz)||nyq, 1000, nyq);
    setYmaxInputHz(clamped);
    let rendered = false;
    try {
      if (typeof globalThis._spectrogram_reRenderFromSpectra === 'function') {
        await globalThis._spectrogram_reRenderFromSpectra(clamped);
        rendered = true;
      }
    } catch(e){ rendered = false; }
    
    globalThis._spectroYMax = clamped;
    try { if (globalThis._spectroLastGen) globalThis._spectroLastGen.ymax = clamped; } catch(e){}
    try { window.dispatchEvent(new CustomEvent('spectrogram-yzoom', { detail: { ymax: clamped } })); } catch(e){}
    forceAxisRefresh();
    try { window.dispatchEvent(new CustomEvent('spectrogram-generated', { detail: { meta: { reason: 'y-zoom', ymax: clamped } } })); } catch(e){}
  }

  function setOverlaysOpacity(opacity) {
      const annotationOverlay = document.getElementById('annotationOverlay');
      const editHighlightOverlay = document.getElementById('editHighlightOverlay');
      const annotationLabelContainer = document.getElementById('annotationLabelContainer_v1');
      if(annotationOverlay) annotationOverlay.style.opacity = opacity;
      if(editHighlightOverlay) editHighlightOverlay.style.opacity = opacity;
      if(annotationLabelContainer) annotationLabelContainer.style.opacity = opacity;
  }

  function updateZoomControlsDisabledState() {
      const yZoomSelect = $('yZoomSelect');
      const xZoomSelect = $('xZoomSelect');
      const disabled = !globalThis._spectroSpectra;
      if(yZoomSelect) yZoomSelect.disabled = disabled;
      if(xZoomSelect) xZoomSelect.disabled = disabled;
  }

  function wireToolbar(){
    try {
      const bar = document.getElementById('zoomToolbar');
      if (bar && bar.__zoomWired) return;

      const yZoomSelect = $('yZoomSelect');
      const xZoomSelect = $('xZoomSelect');

      if (yZoomSelect) {
          yZoomSelect.addEventListener('change', async (e) => {
              setOverlaysOpacity(0);
              await applyYZoom(parseFloat(e.target.value));
              setOverlaysOpacity(1);
          });
      }

      if (xZoomSelect) {
          xZoomSelect.addEventListener('change', async (e) => {
              setOverlaysOpacity(0);
              await applyXZoom(e.target.value === 'entire' ? 'entire' : parseFloat(e.target.value));
              setOverlaysOpacity(1);
          });
      }

      if (bar) bar.__zoomWired = true;
    } catch(e){}
  }

  function onSpectroReady(){
    updateZoomControlsDisabledState();
  }

  whenReady(()=>{
    try { 
        wireToolbar();
        updateZoomControlsDisabledState();
        window.addEventListener('spectrogram-generated', onSpectroReady, { passive: true });
    } catch(e){}
  });

  function forceAxisRefresh(){
    try {
      const sa = document.getElementById('scrollArea');
      if (sa) {
        sa.dispatchEvent(new Event('scroll'));
      }
      window.dispatchEvent(new Event('resize'));
    } catch(e){}
  }
})();
