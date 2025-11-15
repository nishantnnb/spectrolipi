// spectrogram.js
// Spectrogram generator with live Colormap/Gain, Y max in kHz.
// Behavior: when Generate is pressed we capture the currently visible time (at press).
// After generate/re-render completes, the captured time is positioned at the left edge
// of the viewport so that the view's leftmost time equals the captured time.
// This version: moved wait-overlay control into this file, installs listeners immediately,
// dispatches completion event and hides overlay deterministically when visible content is ready,
// and includes a shorter poll fallback.

(function(){
  function hannWindow(N){ const w=new Float32Array(N); for(let n=0;n<N;n++) w[n]=0.5*(1-Math.cos(2*Math.PI*n/(N-1))); return w; }
  function log10(x){ return Math.log(x)/Math.LN10; }
  function reverseBits(x,bits){ let y=0; for(let i=0;i<bits;i++){ y=(y<<1)|(x&1); x>>>=1; } return y; }
  function fft(real, imag){
    const n = real.length; const levels = Math.log2(n)|0; if((1<<levels)!==n) throw new Error('FFT must be power of two');
    for(let i=0;i<n;i++){ const j=reverseBits(i,levels); if(j>i){ const tr=real[i], ti=imag[i]; real[i]=real[j]; imag[i]=imag[j]; real[j]=tr; imag[j]=ti; } }
    for(let size=2; size<=n; size<<=1){
      const half = size>>>1; const theta = -2*Math.PI/size; const wpr=Math.cos(theta), wpi=Math.sin(theta);
      for(let i=0;i<n;i+=size){
        let wr=1, wi=0;
        for(let j=0;j<half;j++){
          const k=i+j, l=k+half;
          const tr = wr*real[l] - wi*imag[l];
          const ti = wr*imag[l] + wi*real[l];
          real[l] = real[k] - tr; imag[l] = imag[k] - ti;
          real[k] += tr; imag[k] += ti;
          const tmp = wr; wr = tmp*wpr - wi*wpi; wi = tmp*wpi + wi*wpr;
        }
      }
    }
  }

  // DOM refs
  const fileInput = document.getElementById('file');
  const goBtn = document.getElementById('go');
  const cmapSelect = document.getElementById('cmap');
  const xzoomSelect = document.getElementById('xzoom');
  const ymaxInput = document.getElementById('ymax'); // kHz
  const gainInput = document.getElementById('gain');
  const gainVal = document.getElementById('gainVal');
  const axisCanvas = document.getElementById('axisCanvas');
  const axisCtx = axisCanvas && axisCanvas.getContext ? axisCanvas.getContext('2d', { alpha:false }) : null;
  const scrollArea = document.getElementById('scrollArea') || document.body;
  const viewportWrapper = document.getElementById('viewportWrapper');
  const canvas = document.getElementById('spectrogramCanvas');
  const ctx = canvas && canvas.getContext ? canvas.getContext('2d', { alpha:false }) : null;

  // Layout constants
  const AXIS_TOP = 12;
  const AXIS_BOTTOM = 44;
  const VIEWPORT_H = (axisCanvas && axisCanvas.height) ? axisCanvas.height : 240;
  const IMAGE_H = VIEWPORT_H - AXIS_TOP - AXIS_BOTTOM;
  const DEFAULT_FFT_SIZE = 2048;

  // Toolbar mouse readout elements live in the main action bar; keep references here so
  // they can reuse the existing helpers (px-to-sec, ymax resolution, etc.).
  let mouseTimeField = document.getElementById('toolbarMouseTime');
  let mouseFreqField = document.getElementById('toolbarMouseFreq');

  function ensureMouseReadoutTargets() {
    if (!mouseTimeField) mouseTimeField = document.getElementById('toolbarMouseTime');
    if (!mouseFreqField) mouseFreqField = document.getElementById('toolbarMouseFreq');
    return !!(mouseTimeField || mouseFreqField);
  }

  function formatFreqForReadout(v) {
    if (!isFinite(v)) return '-';
    return Math.round(v) + ' Hz';
  }

  function clearMouseReadout() {
    if (!ensureMouseReadoutTargets()) return;
    if (mouseTimeField) mouseTimeField.textContent = 'T: -';
    if (mouseFreqField) mouseFreqField.textContent = 'F: -';
  }

  function formatTimeMinSecMs(sec) {
    if (!isFinite(sec) || sec < 0) return '-';
    const totalMs = Math.max(0, Math.round(sec * 1000));
    const minutes = Math.floor(totalMs / 60000);
    const seconds = Math.floor((totalMs % 60000) / 1000);
    // Show milliseconds as a single digit (hundreds place) per user request.
    const ms = totalMs % 1000;
    const msHundreds = Math.floor(ms / 100); // 0..9
    const secStr = String(seconds).padStart(2, '0');
    return `${minutes}:${secStr}:${msHundreds}`;
  }

  function onSpectrogramPointerMove(ev) {
    if (!ensureMouseReadoutTargets() || !viewportWrapper) return;
    try {
      const rect = viewportWrapper.getBoundingClientRect();
      const axisLeft = globalThis._spectroAxisLeft || (axisCanvas && typeof axisCanvas.clientWidth === 'number' ? axisCanvas.clientWidth : 60);
      const imgH = globalThis._spectroImageHeight || IMAGE_H;
      const imgW = globalThis._spectroImageWidth || 0;
      const viewportWidth = Math.max(1, (scrollArea && scrollArea.clientWidth) ? scrollArea.clientWidth : (rect.width - axisLeft));
      const xViewport = ev.clientX - rect.left - axisLeft;
      const yViewport = ev.clientY - rect.top - AXIS_TOP;

      if (xViewport < 0 || xViewport > viewportWidth || yViewport < 0 || yViewport > imgH) {
        clearMouseReadout();
        return;
      }

      const scrollLeft = scrollArea && typeof scrollArea.scrollLeft === 'number' ? scrollArea.scrollLeft : 0;
      const effectiveImgW = imgW > 0 ? imgW : viewportWidth;
      const absX = Math.max(0, Math.min(effectiveImgW, Math.round(xViewport + scrollLeft)));
      const mapper = (globalThis._spectroMap && typeof globalThis._spectroMap.pxToSec === 'function') ? globalThis._spectroMap : null;
      const sec = mapper ? mapper.pxToSec(absX) : NaN;
      const userY = readUserYmaxHz();
      const ymax = (isFinite(userY) && userY > 0) ? userY : _resolveCurrentYMax();
      const freq = Math.max(0, Math.min(ymax, (1 - (yViewport / Math.max(1, imgH))) * ymax));

      if (mouseTimeField) {
        if (isFinite(sec)) {
          mouseTimeField.textContent = 'T: ' + formatTimeMinSecMs(sec);
        } else {
          mouseTimeField.textContent = 'T: -';
        }
      }
      if (mouseFreqField) {
        if (isFinite(freq)) {
          mouseFreqField.textContent = 'F: ' + Math.round(freq) + ' Hz';
        } else {
          mouseFreqField.textContent = 'F: -';
        }
      }
    } catch (err) {
      clearMouseReadout();
    }
  }

  if (viewportWrapper) {
    try {
      viewportWrapper.addEventListener('pointermove', onSpectrogramPointerMove, { passive: true });
      viewportWrapper.addEventListener('pointerleave', clearMouseReadout, { passive: true });
    } catch (e) {}
  }

  // Global state (sane defaults)
  globalThis._spectroLastGen = globalThis._spectroLastGen || { fileId:null, pxpf:null, sampleRate:null, numFrames:null, fftSize:null, ymax:null };
  globalThis._spectroTiles = globalThis._spectroTiles || null;
  globalThis._spectroSpectra = globalThis._spectroSpectra || null;
  globalThis._spectroSampleRate = globalThis._spectroSampleRate || 44100;
  globalThis._spectroNumFrames = globalThis._spectroNumFrames || 0;
  globalThis._spectroPxPerFrame = globalThis._spectroPxPerFrame || 2;
  globalThis._spectroFramesPerSec = globalThis._spectroFramesPerSec || (globalThis._spectroSampleRate / (DEFAULT_FFT_SIZE/2));
  globalThis._spectroImageWidth = globalThis._spectroImageWidth || 800;
  globalThis._spectroImageIntrinsicWidth = globalThis._spectroImageIntrinsicWidth || globalThis._spectroImageWidth;
  globalThis._spectroDisplayScaleX = (typeof globalThis._spectroDisplayScaleX === 'number' && isFinite(globalThis._spectroDisplayScaleX)) ? globalThis._spectroDisplayScaleX : 1;
  globalThis._spectroImageHeight = globalThis._spectroImageHeight || IMAGE_H;
  globalThis._spectroYMax = globalThis._spectroYMax || (globalThis._spectroSampleRate/2);
  globalThis._spectroAxisLeft = (axisCanvas && typeof axisCanvas.clientWidth === 'number') ? Math.round(axisCanvas.clientWidth) : 70;
  // Rendering consistency: track current colorization parameters and a version stamp
  globalThis._spectroColorVersion = globalThis._spectroColorVersion || 0;
  globalThis._spectroRenderParams = globalThis._spectroRenderParams || { lutName: 'custom', gain: 1, ymaxHz: globalThis._spectroYMax };

  // Ensure display/stretch metadata stays consistent whenever intrinsic width changes.
  function _computeDisplayMetrics(intrinsicWidth, viewportHint){
    const safeIntrinsic = Math.max(0, Number(intrinsicWidth) || 0);
    const scrollEl = scrollArea || document.getElementById('scrollArea');
    const viewport = (isFinite(viewportHint) && viewportHint > 0)
      ? viewportHint
      : (scrollEl && scrollEl.clientWidth ? scrollEl.clientWidth : safeIntrinsic);
    let scale = 1;
    if (safeIntrinsic > 0 && viewport > 0 && safeIntrinsic < viewport) {
      scale = viewport / safeIntrinsic;
    }
    const displayed = safeIntrinsic > 0 ? Math.round(safeIntrinsic * scale) : 0;
    return { intrinsic: safeIntrinsic, displayed, scale, viewport };
  }

  function _applyDisplayMetricsFromComputed(metrics){
    if (!metrics) return metrics;
    globalThis._spectroImageIntrinsicWidth = metrics.intrinsic;
    globalThis._spectroDisplayScaleX = metrics.scale;
    globalThis._spectroImageWidth = metrics.displayed;
    const duration = globalThis._spectroDuration;
    const framesPerSec = Math.max(0, globalThis._spectroFramesPerSec || 0);
    const pxpfIntrinsic = Math.max(0, globalThis._spectroPxPerFrame || 0);
    if (isFinite(duration) && duration > 0 && metrics.displayed > 0) {
      globalThis._spectroPxPerSec = metrics.displayed / duration;
    } else if (framesPerSec && pxpfIntrinsic) {
      const scale = metrics.scale && metrics.scale > 0 ? metrics.scale : 1;
      globalThis._spectroPxPerSec = framesPerSec * pxpfIntrinsic * scale;
    }
    return metrics;
  }

  function _applyDisplayMetricsFromIntrinsic(intrinsicWidth, viewportHint){
    const metrics = _computeDisplayMetrics(intrinsicWidth, viewportHint);
    return _applyDisplayMetricsFromComputed(metrics);
  }

  try {
    globalThis._spectroApplyDisplayScaleFromIntrinsic = _applyDisplayMetricsFromIntrinsic;
  } catch (e) {}

  function _scheduleAnnotationOverlaySync(reason){
    try {
      requestAnimationFrame(() => {
        try { window.resizeAnnotationOverlay && window.resizeAnnotationOverlay(); } catch(e){}
        try { window.renderAllAnnotations && window.renderAllAnnotations(); } catch(e){}
        try { window.renderSelectionOverlay && window.renderSelectionOverlay(); } catch(e){}
        try {
          if (window.DEBUG_ANNOTATION_TIME && window.DEBUG_ANNOTATION_TIME >= 2) {
            console.log('[spectro][overlay-sync]', reason || 'unspecified');
          }
        } catch (_dbg) {}
      });
    } catch(e){}
  }
  try { globalThis._scheduleAnnotationOverlaySync = _scheduleAnnotationOverlaySync; } catch (e) {}

  function _resolveCurrentYMax() {
    const cur = (typeof globalThis._spectroYMax === 'number' && isFinite(globalThis._spectroYMax)) ? globalThis._spectroYMax : NaN;
    const lastY = (globalThis._spectroLastGen && isFinite(globalThis._spectroLastGen.ymax)) ? globalThis._spectroLastGen.ymax : NaN;
    const pick = isFinite(cur) ? cur : lastY;
    return isFinite(pick) ? pick : (globalThis._spectroSampleRate ? globalThis._spectroSampleRate/2 : 22050);
  }

  function _bumpRenderParams(lutName, gainVal, ymaxHz) {
    globalThis._spectroColorVersion = (globalThis._spectroColorVersion|0) + 1;
    globalThis._spectroRenderParams = { lutName, gain: gainVal, ymaxHz };
  }

  // mapping helpers (single authoritative mapping)
  function effectivePxPerSec() {
    if (isFinite(globalThis._spectroPxPerSec) && globalThis._spectroPxPerSec > 0) return globalThis._spectroPxPerSec;
    if (globalThis._spectroPxPerFrame && globalThis._spectroFramesPerSec) return globalThis._spectroPxPerFrame * globalThis._spectroFramesPerSec;
    return 1;
  }
  function pxToSec(px) { return px / Math.max(1, effectivePxPerSec()); }
  function secToPx(sec) { return Math.round(sec * Math.max(1, effectivePxPerSec())); }
  globalThis._spectroMap = { pxToSec, secToPx, pxPerSec: () => effectivePxPerSec() };

  // --- wait-overlay control moved into spectrogram.js (index.html keeps markup & styles) ---
  (function () {
    function _els() {
      return {
        overlay: document.getElementById('waitOverlay'),
        meta: document.getElementById('waitOverlayMeta'),
        eta: document.getElementById('waitOverlayETA')
      };
    }
    function showWaitOverlay(opts = {}) {
      const { overlay, meta, eta } = _els();
      if (!overlay) return;
      // Force the overlay into the top-level document and make it visually above dialogs.
      try {
        // Append to <html> rather than a possibly-transformed container so we escape stacking contexts
        if (overlay.parentNode !== document.documentElement) document.documentElement.appendChild(overlay);
        overlay.style.position = 'fixed';
        overlay.style.top = '0'; overlay.style.left = '0'; overlay.style.right = '0'; overlay.style.bottom = '0';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        // Use a large, but safe z-index and apply !important to override inline styles on modals
        try { overlay.style.setProperty('z-index', '2147483647', 'important'); } catch(e){ overlay.style.zIndex = '2147483647'; }
        overlay.style.pointerEvents = 'auto';

        // Temporarily lower any visible dialogs so the overlay sits above them. We mark them with data-old-z
        try {
          const dialogs = Array.from(document.querySelectorAll('[role="dialog"], dialog, .modal'));
          dialogs.forEach(d => {
            try {
              const cs = window.getComputedStyle(d);
              // Only adjust if element is visible and its z-index could conflict
              if (cs && cs.display !== 'none' && cs.visibility !== 'hidden') {
                const old = d.style.getPropertyValue('z-index') || '';
                d.setAttribute('data-old-z', old);
                // set to slightly less than overlay
                try { d.style.setProperty('z-index', '2147483646', 'important'); } catch(e){ d.style.zIndex = '2147483646'; }
              }
            } catch(e){}
          });
        } catch(e){}
      } catch (e) {
        // swallow — best-effort placement
      }
      if (opts.etaText) {
        if (eta) eta.textContent = opts.etaText;
        if (meta) meta.style.display = 'block';
      } else if (meta) {
        meta.style.display = 'none';
      }
      overlay.style.display = 'flex';
      overlay.setAttribute('aria-hidden', 'false');
      try { document.documentElement.style.overflow = 'hidden'; } catch (e) {}
    }
    function hideWaitOverlay() {
      const { overlay, meta } = _els();
      if (!overlay) return;
      overlay.style.display = 'none';
      overlay.setAttribute('aria-hidden', 'true');
      try { document.documentElement.style.overflow = ''; } catch (e) {}
      if (meta) meta.style.display = 'none';
      // restore any dialogs we temporarily changed
      try {
        const changed = Array.from(document.querySelectorAll('[data-old-z]'));
        changed.forEach(d => {
          try {
            const old = d.getAttribute('data-old-z');
            if (old !== null && old !== undefined && old !== '') {
              try { d.style.setProperty('z-index', old, 'important'); } catch(e){ d.style.zIndex = old; }
            } else {
              // remove inline z-index we added
              try { d.style.removeProperty('z-index'); } catch(e){ d.style.zIndex = ''; }
            }
            d.removeAttribute('data-old-z');
          } catch(e){}
        });
      } catch(e){}
    }
    window.__spectroWait = window.__spectroWait || {};
    window.__spectroWait.show = showWaitOverlay;
    window.__spectroWait.hide = hideWaitOverlay;
  })();

  // placeholders
  drawAxisPlaceholder();
  drawSpectrogramPlaceholder();

  // gain label
  function updateGainLabel(){ if (gainVal) gainVal.textContent = parseFloat(gainInput.value).toFixed(1) + '×'; }
  if (gainInput) { gainInput.addEventListener('input', updateGainLabel); updateGainLabel(); }

  // debounce helper
  function debounce(fn, wait){
    let id = 0;
    return function(...args){
      if (id) clearTimeout(id);
      id = setTimeout(() => { id = 0; try { fn.apply(this, args); } catch(e){ console.error(e); } }, wait);
    };
  }

  // viewport helpers and safe scroll/clamp
  function viewportWidthPx() { return (scrollArea && typeof scrollArea.clientWidth === 'number') ? scrollArea.clientWidth : globalThis._spectroImageWidth || 800; }
  function safeSetScrollLeft(px) {
    const vp = viewportWidthPx();
    const maxScroll = Math.max(0, (globalThis._spectroImageWidth || 0) - vp);
    const clamped = Math.max(0, Math.min(maxScroll, Math.round(px || 0)));
    if (scrollArea && typeof scrollArea.scrollLeft === 'number') scrollArea.scrollLeft = clamped;
    return clamped;
  }
  function alignCanvasLeft() { if (canvas && canvas.style) { canvas.style.left = '0px'; canvas.style.transform = ''; } }

  // read user Y max (kHz -> Hz)
  function readUserYmaxHz() {
    if (!ymaxInput) return NaN;
    const raw = ymaxInput.value;
    if (raw == null || String(raw).trim() === '') return NaN;
    const v = Number(raw);
    if (!isFinite(v)) return NaN;
    return v * 1000;
  }

  // Very safe pause helper: attempts to pause playback if available, bounded by timeoutMs
  async function safePausePlayback(timeoutMs = 800) {
    try {
      const pauseHolder = (globalThis._playbackScrollJump && typeof globalThis._playbackScrollJump.pause === 'function') ? globalThis._playbackScrollJump :
                           (globalThis._playback && typeof globalThis._playback.pause === 'function') ? globalThis._playback : null;
      if (!pauseHolder) return;
      const fn = pauseHolder.pause;
      if (!fn) return;
      const p = fn.call(pauseHolder);
      if (p && typeof p.then === 'function') {
        await Promise.race([p, new Promise((_, r) => setTimeout(r, timeoutMs))]).catch(() => {});
      }
    } catch (e) {}
  }

  // draw X ticks into axisCanvas (axisCanvas stays fixed left column)
  function drawXTicksAxis(sampleRate, totalFrames, imgW, imgH, framesPerSec, pxpf, visibleStartSec = 0){
    if(!axisCtx) return;
    const axisLeft = 0;
    const tickY = AXIS_TOP + imgH;
    axisCtx.clearRect(0, 0, axisCanvas.width, axisCanvas.height);
    axisCtx.fillStyle = '#000';
    axisCtx.fillRect(0, 0, axisCanvas.width, axisCanvas.height);
    axisCtx.fillStyle = '#111';
    axisCtx.fillRect(0, AXIS_TOP, axisCanvas.width, imgH);

    axisCtx.strokeStyle = '#666'; axisCtx.lineWidth = 1; axisCtx.fillStyle = '#fff'; axisCtx.font = '12px sans-serif';
    const pxPerSec = Math.max(1, effectivePxPerSec());
    const vp = viewportWidthPx();
    const visibleDuration = Math.max(0, vp / pxPerSec);
    const niceSteps = [0.1,0.2,0.5,1,2,5,10,15,30,60,120];
    let step = niceSteps[0];
    for (let v of niceSteps) { if (v * pxPerSec >= 60) { step = v; break; } step = v; }
    const startSec = Math.max(0, visibleStartSec);
    const endSec = startSec + visibleDuration;
    const firstTick = Math.ceil(startSec / step) * step;
    axisCtx.textAlign = 'center'; axisCtx.textBaseline = 'top';

    for (let t = firstTick; t <= endSec + 1e-9; t += step) {
      const xPxFloat = (t - visibleStartSec) * pxPerSec;
      const markerX = axisCanvas.clientWidth - 6;
      axisCtx.beginPath(); axisCtx.moveTo(markerX + 0.5, AXIS_TOP); axisCtx.lineTo(markerX + 0.5, AXIS_TOP + 8); axisCtx.stroke();
      const label = (t >= 60) ? ((t / 60).toFixed(0) + 'm') : (t.toFixed((step < 1) ? 1 : 0) + 's');
      axisCtx.fillText(label, axisCanvas.clientWidth / 2, AXIS_TOP + imgH + 2);
    }

    drawYAxis(sampleRate, imgH, globalThis._spectroYMax);
  }

  // compute visibleStartSec from scrollLeft and redraw ticks into axisCanvas
  function updateXTicksFromScroll() {
    if (!globalThis._spectroImageWidth || !globalThis._spectroFramesPerSec || !globalThis._spectroPxPerFrame) {
      drawXTicksAxis(globalThis._spectroSampleRate || 44100, globalThis._spectroNumFrames || 0, globalThis._spectroImageWidth || 800, globalThis._spectroImageHeight || IMAGE_H, globalThis._spectroFramesPerSec || (globalThis._spectroSampleRate/(DEFAULT_FFT_SIZE/2)), globalThis._spectroPxPerFrame || 2, 0);
      return;
    }
    const currentScroll = (scrollArea && typeof scrollArea.scrollLeft === 'number') ? scrollArea.scrollLeft : 0;
    const clamped = safeSetScrollLeft(currentScroll);
    const pxPerSec = Math.max(1, effectivePxPerSec());
    const visibleStartSec = clamped / Math.max(1, pxPerSec);
    drawXTicksAxis(globalThis._spectroSampleRate, globalThis._spectroNumFrames, globalThis._spectroImageWidth, globalThis._spectroImageHeight, globalThis._spectroFramesPerSec, globalThis._spectroPxPerFrame, visibleStartSec);
  }

  // wire scroll updates (debounced)
  if (scrollArea) {
    let id=0;
    scrollArea.addEventListener('scroll', ()=>{ if(id) clearTimeout(id); id=setTimeout(()=>{ id=0; updateXTicksFromScroll(); }, 50); });
  }

  // draw Y axis (into axisCanvas)
  function drawYAxis(sampleRate, imgH, ymax){
    if(!axisCtx) return;
    axisCtx.fillStyle='#000'; axisCtx.fillRect(0,0,axisCanvas.width, axisCanvas.height);
    axisCtx.fillStyle='#111'; axisCtx.fillRect(0, AXIS_TOP, axisCanvas.width, imgH);
    axisCtx.strokeStyle = '#666'; axisCtx.lineWidth = 1; axisCtx.fillStyle = '#fff'; axisCtx.font = '12px sans-serif';
    const nyq = sampleRate / 2;
    const topFreq = (typeof ymax === 'number' && ymax > 0) ? Math.min(nyq, ymax) : nyq;
    const yTicks = 6;
    axisCtx.textAlign = 'right'; axisCtx.textBaseline = 'middle';
    for(let i=0;i<yTicks;i++){
      const t = i / (yTicks - 1);
      const freq = topFreq * (1 - t);
      const yPx = AXIS_TOP + Math.round(t * imgH);
      axisCtx.beginPath(); axisCtx.moveTo(axisCanvas.width - 6, yPx + 0.5); axisCtx.lineTo(axisCanvas.width - 0, yPx + 0.5); axisCtx.stroke();
      const label = (freq >= 1000) ? (Math.round(freq/10)/100).toString() + ' kHz' : Math.round(freq) + ' Hz';
      axisCtx.fillText(label, axisCanvas.width - 8, yPx);
    }
    axisCtx.save(); axisCtx.translate(12, AXIS_TOP + imgH/2); axisCtx.rotate(-Math.PI/2); axisCtx.textAlign='center'; axisCtx.fillStyle='#fff'; axisCtx.fillText('Frequency (kHz)', 0, 0); axisCtx.restore();
  }

  function drawAxisPlaceholder(){ if(!axisCtx) return; axisCtx.fillStyle='#000'; axisCtx.fillRect(0,0,axisCanvas.width, axisCanvas.height); axisCtx.fillStyle='#111'; axisCtx.fillRect(0, AXIS_TOP, axisCanvas.width, IMAGE_H); drawYAxis(44100, IMAGE_H, 22050); }
  function drawSpectrogramPlaceholder(){ const placeholderW = Math.max(300, (scrollArea && scrollArea.clientWidth) ? scrollArea.clientWidth - 20 : 400); const innerW = placeholderW; canvas.width = innerW; canvas.height = AXIS_TOP + IMAGE_H + AXIS_BOTTOM; canvas.style.width = innerW + 'px'; canvas.style.height = VIEWPORT_H + 'px'; canvas.style.background = 'transparent'; ctx.clearRect(0,0,canvas.width,canvas.height); ctx.fillStyle='#111'; ctx.fillRect(0, AXIS_TOP, placeholderW, IMAGE_H); updateXTicksFromScroll(); }

  function formatTime(s){ if(!isFinite(s)||s<0.001) return '0s'; if(s>=3600){ const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=Math.floor(s%60); return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`; } if(s>=60){ const m=Math.floor(s/60), sec=Math.floor(s%60); return `${m}:${String(sec).padStart(2,'0')}`; } return s.toFixed(0) + 's'; }

  // colormap approximations
  function colormapSwitch(t, name){ t=Math.max(0,Math.min(1,t)); switch(name){ case 'viridis': return viridisApprox(t); case 'magma': return magmaApprox(t); case 'grayscale': return grayscale(t); case 'jet': return jetApprox(t); case 'cividis': return cividisApprox(t); default: return customMap(t); } }
  function customMap(t){ let r=0,g=0,b=0; if(t<0.25){ const u=t/0.25; r=0; g=Math.round(30*u); b=Math.round(80+175*u); } else if(t<0.5){ const u=(t-0.25)/0.25; r=0; g=Math.round(30+200*u); b=Math.round(255-55*u); } else if(t<0.75){ const u=(t-0.5)/0.25; r=Math.round(255*u); g=Math.round(230-100*u); b=Math.round(200-200*u); } else { const u=(t-0.75)/0.25; r=Math.round(255-20*(1-u)); g=Math.round(130+125*u); b=Math.round(0+255*u); } return [r,g,b]; }
  function grayscale(t){ const v=Math.round(255*t); return [v,v,v]; }
  function viridisApprox(t){ const r = Math.round(68 + 187 * Math.pow(t,1.0)); const g = Math.round(1 + 210 * Math.pow(t,0.8)); const b = Math.round(84 + 170 * (1 - t)); return [r,g,b]; }
  function magmaApprox(t){ const r = Math.round(10 + 245 * Math.pow(t,0.9)); const g = Math.round(5 + 160 * Math.pow(t,1.2)); const b = Math.round(20 + 120 * (1 - t)); return [r,g,b]; }
  function cividisApprox(t){ const r = Math.round(32 + 180 * t); const g = Math.round(69 + 130 * Math.pow(t,0.9)); const b = Math.round(92 + 60 * (1 - t)); return [r,g,b]; }
  function jetApprox(t){ const r = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(2*t - 1)))); const g = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(2*t)))); const b = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(2*t + 1)))); return [r,g,b]; }
  function buildLUT(name){ const lut=new Uint8ClampedArray(256*3); for(let i=0;i<256;i++){ const t=i/255; const [r,g,b]=colormapSwitch(t,name); lut[i*3]=r; lut[i*3+1]=g; lut[i*3+2]=b; } return lut; }

  // processFile: compute STFT and draw image; updates globals
  async function processFile(file, fftSize, overlapFactor, pxpf, cmap){
    globalThis._spectroTiles = null; globalThis._spectroSpectra = null; globalThis._spectroYMax = null;
    const arrayBuffer = await file.arrayBuffer();
    const CtxClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!CtxClass) throw new Error('AudioContext not supported');
    const audioCtx = new CtxClass();
    let decoded;
    try { decoded = await audioCtx.decodeAudioData(arrayBuffer); } finally { if (audioCtx.close) audioCtx.close().catch(()=>{}); }

    const sr = decoded.sampleRate;
    const channels = decoded.numberOfChannels;
    const length = decoded.length;
    const mono = new Float32Array(length);
    if (channels === 1) mono.set(decoded.getChannelData(0)); else { const ch=[]; for(let c=0;c<channels;c++) ch.push(decoded.getChannelData(c)); for(let i=0;i<length;i++){ let s=0; for(let c=0;c<channels;c++) s+=ch[c][i]; mono[i]=s/channels; } }

    const N = fftSize; if ((N & (N - 1)) !== 0) throw new Error('FFT size must be a power of two');
    const hop = Math.max(1, Math.floor(N / overlapFactor));
    const framesPerSec = sr / hop;
    const window = hannWindow(N);
    const numFrames = Math.max(0, Math.floor((mono.length - N) / hop) + 1);
    if (numFrames <= 0) { alert('Audio too short for FFT size'); return; }
    const bins = N / 2;
    const spectra = new Float32Array(numFrames * bins);

    let minDB = Infinity, maxDB = -Infinity;
    const re = new Float32Array(N), im = new Float32Array(N);
    for (let fIdx = 0; fIdx < numFrames; fIdx++){
      const off = fIdx * hop;
      for (let n=0;n<N;n++){ const s = mono[off+n] || 0; re[n] = s * window[n]; im[n] = 0; }
      fft(re, im);
      for (let b=0;b<bins;b++){ const r=re[b], i=im[b]; const mag=Math.sqrt(r*r+i*i)/N; const db=20*log10(mag+1e-12); if(db<minDB) minDB=db; if(db>maxDB) maxDB=db; spectra[fIdx*bins + b] = mag; }
      if ((fIdx & 127) === 0) await new Promise(r => setTimeout(r,0));
    }

  const DR = 80, top = maxDB, bottom = Math.max(minDB, maxDB - DR);
    const denom = (top - bottom) || 1e-6;
  const imageW = Math.max(1, numFrames * pxpf); // intrinsic spectrogram pixel width (unscaled)
    const imageH = IMAGE_H;
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = imageW;
    const cssHeight = AXIS_TOP + imageH + AXIS_BOTTOM;
    // If the generated spectrogram is narrower than the current viewport, stretch it so
    // boxes can use the full horizontal space (avoid user perception of an 8s "cap").
    const vpW = (scrollArea && scrollArea.clientWidth) ? scrollArea.clientWidth : cssWidth;
    const displayMetrics = _computeDisplayMetrics(imageW, vpW);
    const displayScaleX = (displayMetrics && displayMetrics.scale) ? displayMetrics.scale : 1;
    const displayedCssWidth = (displayMetrics && displayMetrics.displayed) ? displayMetrics.displayed : Math.round(cssWidth * displayScaleX);
    globalThis._spectroDisplayScaleX = displayScaleX;
    globalThis._spectroImageIntrinsicWidth = Math.round(imageW);

    if (scrollArea && scrollArea.style){ scrollArea.style.overflowX='auto'; scrollArea.style.overflowY='hidden'; scrollArea.style.whiteSpace='nowrap'; }

  canvas.style.display = 'block'; canvas.style.maxWidth = 'none';
  canvas.style.width = Math.max(1, displayedCssWidth) + 'px';
  canvas.style.height = cssHeight + 'px';
  // Cap main canvas internal pixel dimensions for very long files
  const SAFE_MAX_MAIN_PIXELS = 32768;
  const scaleMainX = Math.min(dpr, SAFE_MAX_MAIN_PIXELS / Math.max(1, cssWidth));
  const scaleMainY = Math.min(dpr, SAFE_MAX_MAIN_PIXELS / Math.max(1, cssHeight));
  const mainScale = Math.min(scaleMainX, scaleMainY);
  const internalW = Math.max(1, Math.round(cssWidth * mainScale));
  const internalH = Math.max(1, Math.round(cssHeight * mainScale));
  canvas.width = internalW; canvas.height = internalH;

  // Draw in internal pixel space; putImageData ignores transforms so use explicit scaling later
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, internalW, internalH);
  ctx.fillStyle = '#111';
  const mainScaleX = internalW / cssWidth;
  const mainScaleY = internalH / cssHeight;
  // Fill background up to displayed spectrogram width after stretching (avoid unused gap)
  ctx.fillRect(0, Math.round(AXIS_TOP * mainScaleY), Math.round(imageW * mainScaleX * displayScaleX), Math.round(imageH * mainScaleY));

    const lut = buildLUT(cmap);
    const MAX_TILE_W = 8192;
    const tileW = Math.min(MAX_TILE_W, imageW);
    const tiles = [];
    const gain = Math.max(0.0001, parseFloat(gainInput && gainInput.value) || 1);

    // We'll draw tiles; after the first tile(s) that fill visible left region are drawn,
    // dispatch completion and hide overlay immediately so UI can proceed.
    let firstTilePainted = false;

    for (let tileX = 0, tileIndex = 0; tileX < imageW; tileX += tileW, tileIndex++){
      const w = Math.min(tileW, imageW - tileX);
      const tilePixels = new Uint8ClampedArray(w * imageH * 4);

      const nyqLocal = sr / 2; // initial render uses full Nyquist range
      for (let localX = 0; localX < w; localX++){
        const globalX = tileX + localX;
        const frameIdx = Math.floor(globalX / pxpf);
        const baseFrame = Math.min(numFrames - 1, Math.max(0, frameIdx));
        for (let y = 0; y < imageH; y++){
          // Use the same y->frequency mapping as reRenderFromSpectra for consistency
          const ty = y / (imageH - 1);
          const freq = (1 - ty) * nyqLocal; // 0 Hz at bottom row
          const fracBin = (freq / nyqLocal) * (bins - 1);
          const fIdx = Math.floor(fracBin);
          const fFrac = fracBin - fIdx;
          const a = spectra[baseFrame * bins + Math.max(0, Math.min(bins-1, fIdx))];
          const b = spectra[baseFrame * bins + Math.max(0, Math.min(bins-1, fIdx+1))];
          const mag = a + (b - a) * fFrac;
          const magAdj = mag * gain;
          const db = 20 * (Math.log(magAdj + 1e-12) / Math.LN10);
          let v = (db - bottom) / denom; if (!isFinite(v)) v = 0; v = Math.max(0, Math.min(1, v));
          const lutIdx = Math.round(v * 255) | 0;
          const rgbBase = lutIdx * 3;
          const idx = (y * w + localX) * 4;
          tilePixels[idx] = lut[rgbBase]; tilePixels[idx+1] = lut[rgbBase+1]; tilePixels[idx+2] = lut[rgbBase+2]; tilePixels[idx+3] = 255;
        }
      }

      try {
        const tileImage = new ImageData(tilePixels, w, imageH);
        // Create tiles at 1:1 logical pixels to guarantee consistent vertical mapping across renders.
        const tcanvas = document.createElement('canvas');
        tcanvas.width = w; tcanvas.height = imageH;
        const tctx = tcanvas.getContext('2d', { alpha:false });
        tctx.putImageData(tileImage, 0, 0);

        // Draw into main canvas using scaled destination rects
        const dx = Math.round(tileX * mainScaleX);
        const dy = Math.round(AXIS_TOP * mainScaleY);
  // Apply horizontal stretch if needed so the full duration fills viewport width
  const dw = Math.max(1, Math.round(w * mainScaleX * displayScaleX));
        const dh = Math.max(1, Math.round(imageH * mainScaleY));
        ctx.drawImage(tcanvas, 0, 0, tcanvas.width, tcanvas.height, dx, dy, dw, dh);

        // mark that at least one tile has been painted
        if (!firstTilePainted) {
          firstTilePainted = true;
          // visible content is now present; inform listeners and hide overlay immediately (defensive)
          try {
            const durationSec = length / sr;
            const pxPerSecMeta = (displayMetrics && displayMetrics.displayed && durationSec > 0)
              ? (displayMetrics.displayed / durationSec)
              : (framesPerSec * pxpf * displayScaleX);
            const meta = { duration: durationSec, pxPerSec: pxPerSecMeta, imageHeight: imageH, sampleRate: sr, cmap: cmap, fileName: file.name };
            try { window.dispatchEvent(new CustomEvent('spectrogram-generated', { detail: { meta } })); } catch (e) {}
          } catch (e) {}
          try { window.__spectroWait && window.__spectroWait.hide(); } catch (e) {}
        }

        const leftFrameIdx = Math.floor(tileX / pxpf);
        const startTime = Math.max(0, Math.min((numFrames - 1) / framesPerSec, leftFrameIdx / framesPerSec));
        const endTime = Math.min((numFrames - 1) / framesPerSec, ((tileX + w - 1) / pxpf) / framesPerSec);

        tiles.push({ bitmap: tcanvas, cols: w, startCol: tileX, startTime, endTime, colorVersion: globalThis._spectroColorVersion, lutName: cmap, gain, ymax: globalThis._spectroYMax });
      } catch(e){
        console.error('paint tile failed', e);
      }

      if ((tileIndex & 1) === 0) await new Promise(r => setTimeout(r,0));
    }

    // update globals (authoritative)
    globalThis._spectroTiles = tiles;
    globalThis._spectroAudioBuffer = decoded;
    globalThis._spectroDuration = length / sr;
    globalThis._spectroFramesPerSec = framesPerSec;
    globalThis._spectroPxPerFrame = pxpf;
    _applyDisplayMetricsFromComputed(displayMetrics);
    globalThis._spectroAxisLeft = globalThis._spectroAxisLeft || ((axisCanvas && typeof axisCanvas.clientWidth === 'number') ? Math.round(axisCanvas.clientWidth) : 70);
    globalThis._spectroSampleRate = sr;
    globalThis._spectroNumFrames = numFrames;
    globalThis._spectroImageHeight = imageH;
    globalThis._spectroSpectra = spectra;
    globalThis._spectroBins = bins;
    globalThis._spectroFFTSize = N;
    globalThis._spectroTopDB = top;
    globalThis._spectroBottomDB = bottom;
    globalThis._spectroDenom = denom;
    globalThis._spectroYMax = sr / 2;

    // Debug instrumentation: log core mapping numbers immediately after generation
    try {
      if (window.DEBUG_ANNOTATION_TIME) {
        console.log('[spectro][post-process]', {
          file: file && file.name,
          audioBufferDuration: decoded && decoded.duration,
          _spectroDuration: globalThis._spectroDuration,
          imageW,
          viewportW: scrollArea && scrollArea.clientWidth,
          pxPerSec: globalThis._spectroPxPerSec,
          numFrames,
          framesPerSec,
          pxpf,
          SAFE_MAX_MAIN_PIXELS: 32768
        });
      }
    } catch(e){}

    if (ymaxInput) ymaxInput.max = Math.round(sr / 1000);

    globalThis._spectroPageCols = Math.max(1, tileW);
    globalThis._spectroPages = tiles.length;

    alignCanvasLeft();
    drawYAxis(sr, imageH, globalThis._spectroYMax);
    updateXTicksFromScroll();
    // Ensure a spacer element sets the scrollable width (full image width) while we draw only the viewport on the canvas.
    try {
      if (scrollArea) {
        let spacer = document.getElementById('spectroSpacer');
        if (!spacer) {
          spacer = document.createElement('div');
          spacer.id = 'spectroSpacer';
          scrollArea.appendChild(spacer);
        }
        spacer.style.display = 'block';
        spacer.style.width = (globalThis._spectroImageWidth || imageW) + 'px';
        spacer.style.height = (AXIS_TOP + (globalThis._spectroImageHeight || imageH) + AXIS_BOTTOM) + 'px';
        spacer.style.pointerEvents = 'none';
        // Position the canvas absolutely over the spacer
        if (canvas && canvas.style) {
          canvas.style.position = 'sticky';
          canvas.style.left = '0px';
          canvas.style.top = '0px';
          canvas.style.zIndex = '1';
          canvas.style.zIndex = '1';
        }
        if (scrollArea && scrollArea.style && !scrollArea.style.position) scrollArea.style.position = 'relative';
      }
    } catch (e) {}
  try { drawViewportFromTiles && drawViewportFromTiles(); } catch(e) {}
  _scheduleAnnotationOverlaySync('processFile');

    // Final dispatch/hide to cover any remaining edge cases
    try {
      const meta = { duration: globalThis._spectroDuration, pxPerSec: globalThis._spectroPxPerSec, imageHeight: globalThis._spectroImageHeight, sampleRate: globalThis._spectroSampleRate, cmap: cmap, fileName: file.name };
      try { window.dispatchEvent(new CustomEvent('spectrogram-generated', { detail: { meta } })); } catch (e) {}
    } catch (e) {}
    try { window.__spectroWait && window.__spectroWait.hide(); } catch (e) {}
    // Repaint visible slice on scroll
    try {
      if (scrollArea && !scrollArea.__spectroViewportHooked) {
  const onScrollViewport = () => { try { drawViewportFromTiles && drawViewportFromTiles(); } catch(e){} try { if (globalThis._spectroSelectionAbsPx) { const abs = globalThis._spectroSelectionAbsPx; const leftVp = abs.left - (scrollArea && scrollArea.scrollLeft ? scrollArea.scrollLeft : 0); const rightVp = abs.right - (scrollArea && scrollArea.scrollLeft ? scrollArea.scrollLeft : 0); try { renderSelectionOverlay(leftVp, rightVp, formatSec(pxToSec(abs.left)), formatSec(pxToSec(abs.right))); } catch(e){} } } catch(e){} };
  scrollArea.addEventListener('scroll', onScrollViewport, { passive: true });
        window.addEventListener('resize', onScrollViewport, { passive: true });
        scrollArea.__spectroViewportHooked = true;
      }
    } catch (e) {}
  }

  // re-render from spectra (ymax in Hz)
  async function reRenderFromSpectra(ymax){
    if (!globalThis._spectroSpectra) return;
    const spectra = globalThis._spectroSpectra;
    const bins = globalThis._spectroBins;
    const N = globalThis._spectroFFTSize;
    const top = globalThis._spectroTopDB;
    const bottom = globalThis._spectroBottomDB;
    const denom = globalThis._spectroDenom;
    const sr = globalThis._spectroSampleRate;
    const framesPerSec = globalThis._spectroFramesPerSec;
    const pxpf = globalThis._spectroPxPerFrame;
    const imageW = globalThis._spectroImageWidth;
    const imageH = globalThis._spectroImageHeight;

    const dpr = window.devicePixelRatio || 1;
    const nyq = sr / 2;
    const ymaxClamped = Math.max(1, Math.min(nyq, Number(ymax) || nyq));

    const lut = buildLUT(cmapSelect.value || 'custom');
    const gain = Math.max(0.0001, parseFloat(gainInput && gainInput.value) || 1);

    // Prefer updating existing tiles in-place so viewport rendering stays perfectly aligned to the axis.
    const tiles = Array.isArray(globalThis._spectroTiles) ? globalThis._spectroTiles : null;
    const dprLocal = window.devicePixelRatio || 1;

    async function buildTileBitmap(w, h, tilePixels) {
      const tileImage = new ImageData(tilePixels, w, h);
      const tcanvas = document.createElement('canvas');
      tcanvas.width = w; tcanvas.height = h;
      const tctx = tcanvas.getContext('2d', { alpha:false });
      tctx.putImageData(tileImage, 0, 0);
      return tcanvas;
    }

    if (tiles && tiles.length) {
      // Update each tile's bitmap with the new LUT/gain/ymax mapping.
      for (let idxTile = 0; idxTile < tiles.length; idxTile++) {
        const t = tiles[idxTile];
        if (!t) continue;
        const w = t.cols;
        const tileX = t.startCol;
        const tilePixels = new Uint8ClampedArray(w * imageH * 4);

        for (let localX = 0; localX < w; localX++) {
          const globalX = tileX + localX;
          const frameIdx = Math.floor(globalX / pxpf);
          const baseFrame = Math.min(globalThis._spectroNumFrames - 1, Math.max(0, frameIdx));
          for (let y = 0; y < imageH; y++) {
            const ty = y / (imageH - 1);
            const freq = (1 - ty) * ymaxClamped; // map top->high freq, bottom->0 Hz
            const fracBin = (freq / nyq) * (bins - 1);
            const fIdx = Math.floor(fracBin);
            const fFrac = fracBin - fIdx;
            const a = spectra[baseFrame * bins + Math.max(0, Math.min(bins-1, fIdx))];
            const b = spectra[baseFrame * bins + Math.max(0, Math.min(bins-1, fIdx+1))];
            const mag = a + (b - a) * fFrac;
            const magAdj = mag * gain;
            const db = 20 * (Math.log(magAdj + 1e-12) / Math.LN10);
            let v = (db - bottom) / (denom || 1e-12); if (!isFinite(v)) v = 0; v = Math.max(0, Math.min(1, v));
            const lutIdx = Math.round(v * 255) | 0; const rgbBase = lutIdx * 3;
            const pi = (y * w + localX) * 4;
            tilePixels[pi] = lut[rgbBase]; tilePixels[pi+1] = lut[rgbBase+1]; tilePixels[pi+2] = lut[rgbBase+2]; tilePixels[pi+3] = 255;
          }
        }
        try { t.bitmap = await buildTileBitmap(w, imageH, tilePixels); t.colorVersion = (globalThis._spectroColorVersion|0); t.lutName = (cmapSelect && cmapSelect.value) ? cmapSelect.value : 'custom'; t.gain = gain; t.ymax = ymaxClamped; } catch(e) { console.error('tile rebuild failed', e); }
        if ((idxTile & 1) === 0) await new Promise(r => setTimeout(r,0));
      }
    } else {
      // Fallback: no tiles available (unlikely). Do a direct draw like before.
      const MAX_TILE_W = 8192;
      const effectiveTileW = Math.min(MAX_TILE_W, imageW);
      const cssWidth = imageW; const cssHeight = AXIS_TOP + imageH + AXIS_BOTTOM;
      const scaleX = (canvas && canvas.width ? (canvas.width / Math.max(1, cssWidth)) : 1);
      const scaleY = (canvas && canvas.height ? (canvas.height / Math.max(1, cssHeight)) : 1);
      for (let tileX = 0; tileX < imageW; tileX += effectiveTileW) {
        const w = Math.min(effectiveTileW, imageW - tileX);
        const tilePixels = new Uint8ClampedArray(w * imageH * 4);
        for (let localX = 0; localX < w; localX++){
          const globalX = tileX + localX;
          const frameIdx = Math.floor(globalX / pxpf);
          const baseFrame = Math.min(globalThis._spectroNumFrames - 1, Math.max(0, frameIdx));
          for (let y = 0; y < imageH; y++){
            const ty = y / (imageH - 1);
            const freq = (1 - ty) * ymaxClamped;
            const fracBin = (freq / nyq) * (bins - 1);
            const fIdx = Math.floor(fracBin);
            const fFrac = fracBin - fIdx;
            const a = spectra[baseFrame * bins + Math.max(0, Math.min(bins-1, fIdx))];
            const b = spectra[baseFrame * bins + Math.max(0, Math.min(bins-1, fIdx+1))];
            const mag = a + (b - a) * fFrac;
            const magAdj = mag * gain;
            const db = 20 * (Math.log(magAdj + 1e-12) / Math.LN10);
            let v = (db - bottom) / (denom || 1e-12); if (!isFinite(v)) v = 0; v = Math.max(0, Math.min(1, v));
            const lutIdx = Math.round(v * 255) | 0; const rgbBase = lutIdx * 3;
            const pi = (y * w + localX) * 4;
            tilePixels[pi] = lut[rgbBase]; tilePixels[pi+1] = lut[rgbBase+1]; tilePixels[pi+2] = lut[rgbBase+2]; tilePixels[pi+3] = 255;
          }
        }
        const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = imageH;
        const tmpCtx = tmp.getContext('2d', { alpha:false }); tmpCtx.putImageData(new ImageData(tilePixels, w, imageH), 0, 0);
        const dx = Math.round(tileX * scaleX); const dy = Math.round(AXIS_TOP * scaleY);
        const dw = Math.max(1, Math.round(w * scaleX)); const dh = Math.max(1, Math.round(imageH * scaleY));
        ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, dx, dy, dw, dh);
        await new Promise(r => setTimeout(r,0));
      }
    }

  globalThis._spectroYMax = ymaxClamped;
  try { if (globalThis._spectroLastGen) globalThis._spectroLastGen.ymax = ymaxClamped; } catch(e){}
  alignCanvasLeft();
  // Redraw axes and repaint viewport from updated tiles to ensure perfect alignment with Y=0.
  drawYAxis(sr, imageH, ymaxClamped);
  updateXTicksFromScroll();
  try { drawViewportFromTiles && drawViewportFromTiles(); } catch(e) {}
    try {
      if (scrollArea) {
        let spacer = document.getElementById('spectroSpacer');
        if (!spacer) {
          spacer = document.createElement('div');
          spacer.id = 'spectroSpacer';
          scrollArea.appendChild(spacer);
        }
        spacer.style.display = 'block';
        spacer.style.width = (globalThis._spectroImageWidth || imageW) + 'px';
        spacer.style.height = (AXIS_TOP + (globalThis._spectroImageHeight || imageH) + AXIS_BOTTOM) + 'px';
        spacer.style.pointerEvents = 'none';
        if (canvas && canvas.style) {
          canvas.style.position = 'sticky';
          canvas.style.left = '0px';
          canvas.style.top = '0px';
        }
        if (scrollArea && scrollArea.style && !scrollArea.style.position) scrollArea.style.position = 'relative';
      }
    } catch (e) {}
  try { drawViewportFromTiles && drawViewportFromTiles(); } catch(e) {}

  _scheduleAnnotationOverlaySync('reRenderFromSpectra');

    try { window.dispatchEvent(new CustomEvent('spectrogram-generated', { detail: { meta: { ymax: ymaxClamped } } })); } catch(e){}
    try { window.__spectroWait && window.__spectroWait.hide(); } catch(e){}
  }

  // Draw only the visible portion of the spectrogram from precomputed tiles.
  function drawViewportFromTiles() {
    try {
      if (!Array.isArray(globalThis._spectroTiles) || !globalThis._spectroTiles.length) return;
      const tiles = globalThis._spectroTiles;
      const imageW = globalThis._spectroImageWidth || 0;
      const imageH = globalThis._spectroImageHeight || 0;
      if (!imageW || !imageH) return;
  const cssHeight = AXIS_TOP + imageH + AXIS_BOTTOM;
  const viewWidth = Math.max(1, scrollArea.clientWidth || 0);
      if (!viewWidth) return;
  const leftPx = Math.max(0, Math.round(scrollArea && typeof scrollArea.scrollLeft === 'number' ? scrollArea.scrollLeft : 0));
      const dpr = window.devicePixelRatio || 1;
      const curVersion = globalThis._spectroColorVersion|0;
      const curYmax = _resolveCurrentYMax();
      const curGain = Math.max(0.0001, parseFloat(gainInput && gainInput.value) || 1);
      const curLutName = (cmapSelect && cmapSelect.value) ? cmapSelect.value : 'custom';
      const curLut = buildLUT(curLutName);

      // Ensure internal buffer matches viewport
      const SAFE_MAX_MAIN_PIXELS = 32768;
  const internalW = Math.max(1, Math.round(Math.min(dpr, SAFE_MAX_MAIN_PIXELS / Math.max(1, viewWidth)) * viewWidth));
      const internalH = Math.max(1, Math.round(Math.min(dpr, SAFE_MAX_MAIN_PIXELS / Math.max(1, cssHeight)) * cssHeight));
      if (canvas.width !== internalW || canvas.height !== internalH) {
        canvas.width = internalW; canvas.height = internalH;
      }
  if (canvas.style.width !== (viewWidth + 'px')) canvas.style.width = viewWidth + 'px';
      if (canvas.style.height !== (cssHeight + 'px')) canvas.style.height = cssHeight + 'px';

  const scaleX = internalW / viewWidth;
      const scaleY = internalH / cssHeight;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, internalW, internalH);
  ctx.fillStyle = '#111';
  // Fill only up to the visible portion of the spectrogram (avoid black beyond image end)
  const displayedW = globalThis._spectroImageWidth || 0;
  const intrinsicW = globalThis._spectroImageIntrinsicWidth || displayedW;
  const scaleTilesX = (displayedW > 0 && intrinsicW > 0) ? (displayedW / intrinsicW) : 1;
  const maxFillCss = Math.min(viewWidth, Math.max(0, displayedW - leftPx));
  ctx.fillRect(0, Math.round(AXIS_TOP * scaleY), Math.round(maxFillCss * scaleX), Math.round(imageH * scaleY));

  // leftPx computed above for background fill
  const rightPx = Math.min(displayedW, leftPx + viewWidth);

      for (const t of tiles) {
        if (!t || !t.bitmap) continue;
  const tx0 = t.startCol * scaleTilesX;
  const tx1 = (t.startCol + t.cols) * scaleTilesX;
        if (tx1 <= leftPx || tx0 >= rightPx) continue;
        // Ensure tile colorization matches current settings before drawing
        if ((t.colorVersion|0) !== curVersion || t.lutName !== curLutName || Math.abs((t.gain||1) - curGain) > 1e-6 || Math.abs((t.ymax||curYmax) - curYmax) > 1e-3) {
          try { _rebuildTileBitmapSync(t, curYmax, curLut, curGain); t.colorVersion = curVersion; t.lutName = curLutName; t.gain = curGain; t.ymax = curYmax; } catch(e){}
        }
        const interL = Math.max(leftPx, tx0);
        const interR = Math.min(rightPx, tx1);
        const interW = Math.max(0, interR - interL);
        if (interW <= 0) continue;
  const sxCssDisplayed = interL - tx0;
  const swCssDisplayed = interW;
  const sxIntrinsic = sxCssDisplayed / Math.max(1e-9, scaleTilesX);
  const swIntrinsic = swCssDisplayed / Math.max(1e-9, scaleTilesX);
        const dxCss = interL - leftPx;
        const dwCss = interW;
  const pxPerCol = t.bitmap.width / Math.max(1, t.cols);
  const sx = Math.round(sxIntrinsic * pxPerCol);
  const sw = Math.max(1, Math.round(swIntrinsic * pxPerCol));
        const dx = Math.round(dxCss * scaleX);
        const dy = Math.round(AXIS_TOP * scaleY);
        const dw = Math.max(1, Math.round(dwCss * scaleX));
        const dh = Math.max(1, Math.round(imageH * scaleY));
        try { ctx.drawImage(t.bitmap, sx, 0, sw, t.bitmap.height, dx, dy, dw, dh); } catch(e) {}
      }
    } catch (e) { /* non-fatal */ }
  }

  // Synchronous tile recolor used during drawing to avoid mixed colormaps on scroll.
  function _rebuildTileBitmapSync(tile, ymaxHz, lut, gain){
    if (!tile) return;
    const spectra = globalThis._spectroSpectra; if (!spectra) return;
    const bins = globalThis._spectroBins; const sr = globalThis._spectroSampleRate;
    const nyq = sr / 2; const imageH = globalThis._spectroImageHeight; const pxpf = globalThis._spectroPxPerFrame;
    const ymaxClamped = Math.max(1, Math.min(nyq, Number(ymaxHz) || nyq));
    const bottom = globalThis._spectroBottomDB; const denom = globalThis._spectroDenom || 1e-12;
    const w = tile.cols; const tileX = tile.startCol;
    const tilePixels = new Uint8ClampedArray(w * imageH * 4);
    for (let localX=0; localX<w; localX++){
      const globalX = tileX + localX;
      const frameIdx = Math.floor(globalX / pxpf);
      const baseFrame = Math.min(globalThis._spectroNumFrames - 1, Math.max(0, frameIdx));
      for (let y=0; y<imageH; y++){
        const ty = y / (imageH - 1);
        const freq = (1 - ty) * ymaxClamped;
        const fracBin = (freq / nyq) * (bins - 1);
        const fIdx = Math.floor(fracBin);
        const fFrac = fracBin - fIdx;
        const a = spectra[baseFrame * bins + Math.max(0, Math.min(bins-1, fIdx))];
        const b = spectra[baseFrame * bins + Math.max(0, Math.min(bins-1, fIdx+1))];
        const mag = a + (b - a) * fFrac;
        const magAdj = mag * gain;
        const db = 20 * (Math.log(magAdj + 1e-12) / Math.LN10);
        let v = (db - bottom) / denom; if (!isFinite(v)) v = 0; v = Math.max(0, Math.min(1, v));
        const lutIdx = (v * 255) | 0; const rgbBase = lutIdx * 3;
        const pi = (y * w + localX) * 4;
        tilePixels[pi] = lut[rgbBase]; tilePixels[pi+1] = lut[rgbBase+1]; tilePixels[pi+2] = lut[rgbBase+2]; tilePixels[pi+3] = 255;
      }
    }
    const tcanvas = document.createElement('canvas');
    tcanvas.width = w; tcanvas.height = imageH;
    const tctx = tcanvas.getContext('2d', { alpha:false });
    tctx.putImageData(new ImageData(tilePixels, w, imageH), 0, 0);
    tile.bitmap = tcanvas;
  }

  // Rebuild a single tile's bitmap in-place using current spectra, LUT, gain, and ymax.
  async function _rebuildTileBitmapInPlace(tile, ymaxHz, lut, gain){
    try {
      if (!tile) return;
      const spectra = globalThis._spectroSpectra; if (!spectra) return;
      const bins = globalThis._spectroBins; const sr = globalThis._spectroSampleRate;
      const nyq = sr / 2; const imageH = globalThis._spectroImageHeight; const pxpf = globalThis._spectroPxPerFrame;
      const ymaxClamped = Math.max(1, Math.min(nyq, Number(ymaxHz) || nyq));
      const bottom = globalThis._spectroBottomDB; const denom = globalThis._spectroDenom || 1e-12;
      const w = tile.cols; const tileX = tile.startCol;
      const tilePixels = new Uint8ClampedArray(w * imageH * 4);
      for (let localX=0; localX<w; localX++){
        const globalX = tileX + localX;
        const frameIdx = Math.floor(globalX / pxpf);
        const baseFrame = Math.min(globalThis._spectroNumFrames - 1, Math.max(0, frameIdx));
        for (let y=0; y<imageH; y++){
          const ty = y / (imageH - 1);
          const freq = (1 - ty) * ymaxClamped; // 0 Hz at bottom
          const fracBin = (freq / nyq) * (bins - 1);
          const fIdx = Math.floor(fracBin);
          const fFrac = fracBin - fIdx;
          const a = spectra[baseFrame * bins + Math.max(0, Math.min(bins-1, fIdx))];
          const b = spectra[baseFrame * bins + Math.max(0, Math.min(bins-1, fIdx+1))];
          const mag = a + (b - a) * fFrac;
          const magAdj = mag * gain;
          const db = 20 * (Math.log(magAdj + 1e-12) / Math.LN10);
          let v = (db - bottom) / denom; if (!isFinite(v)) v = 0; v = Math.max(0, Math.min(1, v));
          const lutIdx = Math.round(v * 255) | 0; const rgbBase = lutIdx * 3;
          const pi = (y * w + localX) * 4;
          tilePixels[pi] = lut[rgbBase]; tilePixels[pi+1] = lut[rgbBase+1]; tilePixels[pi+2] = lut[rgbBase+2]; tilePixels[pi+3] = 255;
        }
      }
      // Build a bitmap canvas similar to the generation path to avoid DPI-size issues
      const tcanvas = document.createElement('canvas');
      tcanvas.width = w; tcanvas.height = imageH;
      const tctx = tcanvas.getContext('2d', { alpha:false });
      const img = new ImageData(tilePixels, w, imageH);
      tctx.putImageData(img, 0, 0);
      tile.bitmap = tcanvas;
    } catch(e) { /* non-fatal */ }
  }

  // Recolor only tiles in the visible horizontal range; fast path for very long images.
  async function _recolorVisibleTiles(ymaxHz){
    if (!Array.isArray(globalThis._spectroTiles) || !globalThis._spectroTiles.length) return;
    const lut = buildLUT(cmapSelect.value || 'custom');
    const gain = Math.max(0.0001, parseFloat(gainInput && gainInput.value) || 1);
    const viewWidth = viewportWidthPx();
    const leftPx = Math.max(0, Math.round(scrollArea && typeof scrollArea.scrollLeft === 'number' ? scrollArea.scrollLeft : 0));
    const rightPx = leftPx + viewWidth;
    const tiles = globalThis._spectroTiles;
    for (let i=0;i<tiles.length;i++){
      const t = tiles[i]; if (!t || !t.bitmap) continue;
      const tx0 = t.startCol, tx1 = t.startCol + t.cols;
      if (tx1 <= leftPx || tx0 >= rightPx) continue; // not visible
      await _rebuildTileBitmapInPlace(t, ymaxHz, lut, gain);
      if ((i & 1) === 0) await new Promise(r => setTimeout(r,0));
    }
    try { drawViewportFromTiles && drawViewportFromTiles(); } catch(e) {}
  }
  // Expose full rebuild helper for external modules
  try { globalThis._rebuildAllTilesFromSpectra = _rebuildAllTilesFromSpectra; } catch(e){}

  // Recompute spectra for a sub-range of frames and rebuild only the tiles that overlap that range.
  // startFrame and endFrame are inclusive frame indices.
  // options: { progressCb: function(percent) }
  async function _spectrogram_recomputeFrames(startFrame, endFrame, options = {}){
    try {
      if (!globalThis._spectroSpectra) return;
      const bins = globalThis._spectroBins | 0;
      const N = globalThis._spectroFFTSize | 0;
      if (!N || !bins) return;
      const pxpf = Math.max(1, globalThis._spectroPxPerFrame || 1);
      const framesPerSec = globalThis._spectroFramesPerSec || 1;
      const totalFrames = globalThis._spectroNumFrames | 0;
      startFrame = Math.max(0, Math.min(totalFrames - 1, startFrame | 0));
      endFrame = Math.max(startFrame, Math.min(totalFrames - 1, endFrame | 0));

      const frameCount = endFrame - startFrame + 1;
      if (frameCount <= 0) return;

      // Heuristic: if large fraction of frames affected, fallback to full rebuild for simplicity/perf
      const FRACTION_FALLBACK = 0.25; // 25%
      if (frameCount / Math.max(1, totalFrames) >= FRACTION_FALLBACK) {
        try { await _rebuildAllTilesFromSpectra(); return; } catch(e){}
      }

      const hop = Math.max(1, Math.floor(N / 2));
      const audioBuf = globalThis._spectroAudioBuffer;
      const sr = (globalThis._spectroSampleRate || (audioBuf && audioBuf.sampleRate) || 44100);
      const chCount = audioBuf ? audioBuf.numberOfChannels : 1;
      const channels = audioBuf ? Array.from({length: chCount}, (_,i)=> audioBuf.getChannelData(i)) : null;

      // allocate per-frame FFT buffers once
      const re = new Float32Array(N);
      const im = new Float32Array(N);
      const window = hannWindow(N);

      const spectra = globalThis._spectroSpectra;

      // Compute frames in batches and write into spectra
      const BATCH = 32;
      for (let base = startFrame; base <= endFrame; base += BATCH) {
        const to = Math.min(endFrame, base + BATCH - 1);
        for (let f = base; f <= to; f++){
          const off = f * hop;
          // build windowed mono frame into re[]
          for (let n = 0; n < N; n++){
            const idx = off + n;
            let s = 0;
            if (channels) {
              for (let c = 0; c < chCount; c++) { s += (channels[c][idx] || 0); }
              s = s / Math.max(1, chCount);
            } else {
              s = 0;
            }
            re[n] = s * window[n]; im[n] = 0;
          }
          // FFT in-place
          try { fft(re, im); } catch(e){ console.error('FFT failed in incremental recompute', e); }
          // compute magnitudes into spectra array
          const baseIdx = f * bins;
          for (let b = 0; b < bins; b++){
            const r = re[b], i = im[b]; const mag = Math.sqrt(r*r + i*i) / N;
            spectra[baseIdx + b] = mag;
          }
        }
        // yield to UI thread
        await new Promise(r => setTimeout(r, 0));
        // progress callback
        try { if (options.progressCb) options.progressCb(Math.round(100 * (to - startFrame + 1) / Math.max(1, frameCount))); } catch(e){}
      }

      // Now rebuild tiles overlapping the affected pixel range
      const pxStart = startFrame * pxpf;
      const pxEnd = (endFrame + 1) * pxpf;
      const tiles = Array.isArray(globalThis._spectroTiles) ? globalThis._spectroTiles : [];
      const lut = buildLUT((typeof cmapSelect !== 'undefined' && cmapSelect && cmapSelect.value) ? cmapSelect.value : 'custom');
      const gainVal = Math.max(0.0001, parseFloat(gainInput && gainInput.value) || 1);
      const ymaxClamped = _resolveCurrentYMax();

      let rebuilt = 0; const totalTiles = tiles.length;
      for (let i = 0; i < tiles.length; i++){
        const t = tiles[i]; if (!t) continue;
        const tx0 = t.startCol; const tx1 = t.startCol + t.cols;
        if (tx1 <= pxStart || tx0 >= pxEnd) continue;
        // rebuild in-place using existing helper
        try { await _rebuildTileBitmapInPlace(t, ymaxClamped, lut, gainVal); } catch(e){ try { _rebuildTileBitmapSync(t, ymaxClamped, lut, gainVal); } catch(e2){} }
        rebuilt++;
        // yield & progress
        if ((rebuilt & 3) === 0) await new Promise(r => setTimeout(r, 0));
        try { if (options.progressCb) options.progressCb(Math.round(100 * rebuilt / Math.max(1, totalTiles))); } catch(e){}
      }

      // Repaint
      try { drawViewportFromTiles && drawViewportFromTiles(); } catch(e){}
      try { updateXTicksFromScroll && updateXTicksFromScroll(); } catch(e){}

      try { window.dispatchEvent(new CustomEvent('spectrogram-frames-recomputed', { detail: { startFrame, endFrame } })); } catch(e){}
    } catch(err){ console.error('recomputeFrames failed', err); }
  }
  globalThis._spectrogram_recomputeFrames = _spectrogram_recomputeFrames;

  // reset playback helpers (pause/seek to 0) but we will align view to captured start time later
  function resetPlaybackState() {
    try {
      if (globalThis._playback && typeof globalThis._playback.stop === 'function') {
        try { globalThis._playback.stop(); } catch(e){}
      }
      const audioEls = document.getElementsByTagName('audio');
      if (audioEls && audioEls.length) {
        for (let i=0;i<audioEls.length;i++){
          try { audioEls[i].pause(); audioEls[i].currentTime = 0; } catch(e){}
        }
      }
      if (globalThis._playbackScrollJump && typeof globalThis._playbackScrollJump.setPosition === 'function') {
        try { globalThis._playbackScrollJump.setPosition(0); } catch(e){}
      }
      globalThis._spectroPlayheadSec = 0;
      const playheadEl = document.getElementById('playhead');
      if (playheadEl) {
        try { if ('value' in playheadEl) playheadEl.value = 0; else playheadEl.style.left = '0px'; } catch(e){}
      }
    } catch(e){ console.error('resetPlaybackState failed', e); }
  }

  // scroll nudge helper (+0.5s, -0.5s, restore)
  function scrollNudgeHalfSecond() {
    if (!globalThis._spectroFramesPerSec || !globalThis._spectroPxPerFrame || !scrollArea) return;
    const pxPerSec = Math.max(1, effectivePxPerSec());
    const deltaPx = Math.round(0.5 * pxPerSec);
    const vp = viewportWidthPx();
    const maxScroll = Math.max(0, (globalThis._spectroImageWidth || 0) - vp);
    const orig = Math.max(0, Math.min(maxScroll, (scrollArea.scrollLeft || 0)));
    function setScroll(px) {
      const clamped = Math.max(0, Math.min(maxScroll, Math.round(px)));
      scrollArea.scrollLeft = clamped;
      try { updateXTicksFromScroll(); } catch(e) {}
      return clamped;
    }
    setScroll(orig + deltaPx);
    requestAnimationFrame(() => {
      setScroll(orig - deltaPx);
      requestAnimationFrame(() => {
        setScroll(orig);
      });
    });
  }

  // live colormap/gain apply (debounced)
  const debouncedLiveApply = debounce(async ()=>{
    try {
      const LARGE_IMAGE_W = 20000; // px threshold for optimized live updates on very long files
      if (globalThis._spectroSpectra) {
        // Prefer user-provided Y max when present (kHz input -> Hz)
        const userY = readUserYmaxHz();
        const useY = (isFinite(userY) && userY > 0) ? userY : _resolveCurrentYMax();
        const lutName = (cmapSelect && cmapSelect.value) ? cmapSelect.value : 'custom';
        const gainVal = Math.max(0.0001, parseFloat(gainInput && gainInput.value) || 1);
        _bumpRenderParams(lutName, gainVal, useY);
        if (globalThis._spectroImageWidth && globalThis._spectroImageWidth > LARGE_IMAGE_W) {
          await _recolorVisibleTiles(useY);
        } else {
          await reRenderFromSpectra(useY);
        }
        updateXTicksFromScroll();
        try { window.dispatchEvent(new CustomEvent('spectrogram-generated', { detail: { meta: { ymax: useY } } })); } catch(e) {}
        return;
      }
      const placeholderW = Math.max(300, (scrollArea && scrollArea.clientWidth) ? scrollArea.clientWidth - 20 : 400);
      const w = Math.min(placeholderW, 800);
      const h = IMAGE_H;
      const lut = buildLUT(cmapSelect.value || 'custom');
      const gain = Math.max(0.0001, parseFloat(gainInput && gainInput.value) || 1);
      const pixels = new Uint8ClampedArray(w * h * 4);
      for (let x=0;x<w;x++){ const t=x/Math.max(1,w-1); for (let y=0;y<h;y++){ const vbase = 0.2 + 0.8*Math.pow(t,0.7)*(1 - y/Math.max(1,h-1)); let v=Math.max(0, Math.min(1, vbase * gain)); const idx=Math.round(v*255)|0; const rgbBase=idx*3; const pi=(y*w+x)*4; pixels[pi]=lut[rgbBase]; pixels[pi+1]=lut[rgbBase+1]; pixels[pi+2]=lut[rgbBase+2]; pixels[pi+3]=255; } }
      const tileImage = new ImageData(pixels, w, h);
      ctx.clearRect(0, AXIS_TOP, w, h);
      ctx.putImageData(tileImage, 0, AXIS_TOP);
      updateXTicksFromScroll();
    } catch(e){ console.error('liveApply failed', e); }
  }, 150);

  if (cmapSelect) cmapSelect.addEventListener('change', ()=>debouncedLiveApply());
  if (gainInput) { gainInput.addEventListener('input', ()=>{ updateGainLabel(); debouncedLiveApply(); }); gainInput.addEventListener('change', ()=>debouncedLiveApply()); }
  if (ymaxInput) { ymaxInput.addEventListener('input', ()=>{ debouncedLiveApply(); }); ymaxInput.addEventListener('change', ()=>{ debouncedLiveApply(); }); }

  // Generate handler: capture current left-edge time at press and after processing align that time to left edge
  // Strong integration: install finish-listener immediately on invocation, show overlay, and rely on generator to hide quickly when visible pixels are painted.
  async function generateSpectrogram() {
        const f = fileInput && fileInput.files && fileInput.files[0];
        if (!f) { alert('Choose an audio file'); return; }

        const fftSize = DEFAULT_FFT_SIZE;
        const overlapFactor = 2;
        const zoomVal = (xzoomSelect && xzoomSelect.value) ? xzoomSelect.value : '2';
        const pxpf = Math.max(1, Math.min(4, parseInt(String(zoomVal).replace(/\D/g,''), 10) || 2));
        const cmap = cmapSelect.value || 'custom';
        const userYmaxHz = readUserYmaxHz();
        const fileId = `${f.name}|${f.size}|${f.lastModified}`;

        // Capture the currently visible left-edge time (the time at scrollLeft) at the moment Generate is pressed.
        const currentScrollPx = (scrollArea && typeof scrollArea.scrollLeft === 'number') ? scrollArea.scrollLeft : 0;
        const prevPxPerSec = effectivePxPerSec();
        const capturedLeftTimeSec = currentScrollPx / Math.max(1, prevPxPerSec);

        // install finish listener immediately (no race)
        const onceGen = () => { try { window.__spectroWait && window.__spectroWait.hide(); } catch(e){} };
        window.addEventListener('spectrogram-generated', onceGen, { once: true });

        // show overlay now and yield a single tick to allow paint
        try { window.__spectroWait && window.__spectroWait.show({ etaText: 'Generating...' }); } catch(e) {}
        await new Promise(r => setTimeout(r, 20));

        // If playback is active, pause it safely (bounded) before heavy processing so overlays and audio don't conflict.
        try { await safePausePlayback(1000); } catch (e) {}

        const last = globalThis._spectroLastGen || {};
        const needFullCompute = (last.fileId !== fileId) || (last.pxpf !== pxpf) || (last.fftSize !== fftSize);

        try {
          if (needFullCompute) {
            await processFile(f, fftSize, overlapFactor, pxpf, cmap);

            const generatedDefaultYmax = globalThis._spectroYMax || (globalThis._spectroSampleRate ? globalThis._spectroSampleRate/2 : null);
            globalThis._spectroLastGen = { fileId, pxpf, sampleRate: globalThis._spectroSampleRate, numFrames: globalThis._spectroNumFrames, fftSize, ymax: generatedDefaultYmax };

            if (ymaxInput && (ymaxInput.value == null || String(ymaxInput.value).trim() === '')) {
              try { ymaxInput.value = (Math.round((generatedDefaultYmax || 0) / 1000 * 100) / 100).toString(); } catch(e){}
              if (ymaxInput) ymaxInput.max = Math.round((globalThis._spectroSampleRate || 0) / 1000);
            } else {
              if (ymaxInput) ymaxInput.max = Math.round((globalThis._spectroSampleRate || 0) / 1000);
            }

            if (isFinite(userYmaxHz) && Math.abs(userYmaxHz - (generatedDefaultYmax || 0)) > 1) {
              await reRenderFromSpectra(userYmaxHz);
              globalThis._spectroLastGen.ymax = userYmaxHz;
            }

            updateXTicksFromScroll();

            if (last.pxpf !== pxpf) {
              scrollNudgeHalfSecond();
            }

            alignCapturedTimeToLeft(capturedLeftTimeSec, pxpf);

            resetPlaybackState();
          } else {
            const lastY = last.ymax;
            if (isFinite(userYmaxHz) && Math.abs(userYmaxHz - (lastY || 0)) > 1) {
              await reRenderFromSpectra(userYmaxHz);
              globalThis._spectroLastGen.ymax = userYmaxHz;
            } else {
              const useY = (isFinite(lastY) ? lastY : (globalThis._spectroYMax || (globalThis._spectroSampleRate ? globalThis._spectroSampleRate/2 : 22050)));
              await reRenderFromSpectra(useY);
            }

            updateXTicksFromScroll();

            if (last.pxpf !== pxpf) {
              scrollNudgeHalfSecond();
            }

            alignCapturedTimeToLeft(capturedLeftTimeSec, pxpf);

            resetPlaybackState();

            globalThis._spectroLastGen = Object.assign({}, globalThis._spectroLastGen, {
              sampleRate: globalThis._spectroSampleRate,
              numFrames: globalThis._spectroNumFrames,
              fftSize
            });
          }
        } catch (e) {
          console.error(e);
        } finally {
          // ensure overlay hidden if something unexpected skipped the generation path
          try { window.__spectroWait && window.__spectroWait.hide(); } catch (e) {}
          try { window.removeEventListener('spectrogram-generated', onceGen); } catch(e){}
        }
      }

  // Wire button click if present
  if (goBtn) { goBtn.addEventListener('click', generateSpectrogram); }

  // Auto-generate spectrogram when a file is selected (always wire, independent of button presence)
  if (fileInput) {
    fileInput.addEventListener('change', function () {
          const f = fileInput && fileInput.files && fileInput.files[0];
          if (f) {
            // Ensure UI defaults to Create mode when a new file is selected
            try { const wrap = document.getElementById('createEditToggle'); if (wrap) wrap.dispatchEvent(new CustomEvent('mode-change', { detail: { mode: 'create' }, bubbles: true })); } catch(e){}

            // Strict backup lifecycle on file open: combined prompt for annotations + metadata, then restore/purge accordingly
            try {
              const fid = `${f.name}|${f.size||0}|${f.lastModified||0}`;
              const ANN_PREFIX = 'annotations_backup::';
              const META_PREFIX = 'metadata_backup::';
              const annKey = ANN_PREFIX + fid;
              const metaKey = META_PREFIX + fid;

              // purge stale backups for other files (annotations and metadata) if no own backup
              try {
                const allAnn = Object.keys(localStorage).filter(k => typeof k === 'string' && k.startsWith(ANN_PREFIX));
                const hasOwnAnn = !!localStorage.getItem(annKey);
                if (!hasOwnAnn && allAnn.length > 0) allAnn.forEach(k => { try { localStorage.removeItem(k); } catch(e){} });
              } catch (e) {}
              try {
                const allMeta = Object.keys(localStorage).filter(k => typeof k === 'string' && k.startsWith(META_PREFIX));
                const hasOwnMeta = !!localStorage.getItem(metaKey);
                if (!hasOwnMeta && allMeta.length > 0) allMeta.forEach(k => { try { localStorage.removeItem(k); } catch(e){} });
              } catch (e) {}

              const annRaw = localStorage.getItem(annKey);
              const metaRaw = localStorage.getItem(metaKey);

              if (!annRaw && !metaRaw) {
                // nothing to do
              } else {
                let doRestore = false;
                try { doRestore = window.confirm('Unsaved Metadata and/or annotations were found for this file. Restore?'); } catch (e) { doRestore = false; }

                if (doRestore) {
                  // handle annotations (retry until grid ready) if present
                  if (annRaw) {
                    try {
                      const restorePayload = annRaw;
                      const ANN_ALL = ANN_PREFIX;
                      function purgeAllAnnBackups() {
                        try { Object.keys(localStorage).forEach(k => { if (typeof k === 'string' && k.startsWith(ANN_ALL)) { try { localStorage.removeItem(k); } catch(e){} } }); } catch(e){}
                      }
                      try { window.__pendingAnnotationRestore = { fileId: fid, raw: restorePayload, parsed: null, started: false }; } catch(e){}
                      function attemptAnnRestore() {
                        let arr = [];
                        try { arr = JSON.parse(restorePayload); } catch(e){ arr = []; }
                        if (!Array.isArray(arr) || arr.length === 0) return true;
                        const gridReady = window.annotationGrid && typeof window.annotationGrid.replaceData === 'function';
                        if (gridReady) {
                          try {
                            window.__pendingAnnotationRestore = { fileId: fid, raw: restorePayload, parsed: arr, started: true };
                            if (window.__applyPendingAnnotationRestore) {
                              try { window.__applyPendingAnnotationRestore(); } catch(e){}
                            } else {
                              if (globalThis._annotations && typeof globalThis._annotations.import === 'function') globalThis._annotations.import(arr);
                              else window.annotationGrid.replaceData(arr);
                            }
                            try { window.dispatchEvent(new CustomEvent('annotations-changed', { detail: { reason: 'restore-backup', count: arr.length } })); } catch(e){}
                            try { console.info('[backup] restored', arr.length, 'annotations'); } catch(e){}
                            purgeAllAnnBackups();
                            return true;
                          } catch(e){ return false; }
                        }
                        return false;
                      }
                      function scheduleAnnRetries() {
                        const startTs = Date.now();
                        (function loop(){
                          const done = attemptAnnRestore();
                          if (done) return;
                          if (Date.now() - startTs > 10000) {
                            console.warn('[backup] restore timed out: grid not ready; preserving backup');
                            try { localStorage.setItem(ANN_ALL + fid, restorePayload); } catch(e){}
                            return;
                          }
                          setTimeout(loop, 150);
                        })();
                      }
                      try { window.addEventListener('spectrogram-generated', function handler(){ try { window.removeEventListener('spectrogram-generated', handler); } catch(e){} scheduleAnnRetries(); }, { once: true }); } catch(e){ scheduleAnnRetries(); }
                    } catch (e) {}
                  }

                  // handle metadata (apply immediately)
                  if (metaRaw) {
                    try { window.__pendingMetadataRestore = { fileId: fid, raw: metaRaw }; } catch(e){}
                    try { if (window.__applyPendingMetadataRestore) window.__applyPendingMetadataRestore(); } catch(e){}
                  }
                } else {
                  // user declined -> purge both types
                  try { Object.keys(localStorage).forEach(k => { if (typeof k === 'string' && (k.startsWith(ANN_PREFIX) || k.startsWith(META_PREFIX))) { try { localStorage.removeItem(k); } catch(e){} } }); } catch(e){}
                }
              }
            } catch (e) {}

            generateSpectrogram();
            // Move focus to Play/Pause for immediate playback control and blur the file input
            try { const play = document.getElementById('playPause'); if (play && typeof play.focus === 'function') play.focus(); if (fileInput && typeof fileInput.blur === 'function') fileInput.blur(); } catch(e) {}
          }
    });
  }

  // Align a captured left-edge time (seconds) to the left edge using updated globals and pxpf
  function alignCapturedTimeToLeft(capturedLeftTimeSec, newPxpf) {
    const pxPerSec = effectivePxPerSec();
    const imageW = globalThis._spectroImageWidth || 0;
    const vp = viewportWidthPx();
    const desiredScroll = Math.round(capturedLeftTimeSec * pxPerSec);
    const maxScroll = Math.max(0, imageW - vp);
    const clamped = Math.max(0, Math.min(maxScroll, desiredScroll));
    safeSetScrollLeft(clamped);
    updateXTicksFromScroll();
    alignCanvasLeft();
  }

  // reset playback helpers (pause/seek to 0)
  function resetPlaybackState() {
    try {
      if (globalThis._playback && typeof globalThis._playback.stop === 'function') {
        try { globalThis._playback.stop(); } catch(e){}
      }
      const audioEls = document.getElementsByTagName('audio');
      if (audioEls && audioEls.length) {
        for (let i=0;i<audioEls.length;i++){
          try { audioEls[i].pause(); audioEls[i].currentTime = 0; } catch(e){}
        }
      }
      if (globalThis._playbackScrollJump && typeof globalThis._playbackScrollJump.setPosition === 'function') {
        try { globalThis._playbackScrollJump.setPosition(0); } catch(e){}
      }
      globalThis._spectroPlayheadSec = 0;
      const playheadEl = document.getElementById('playhead');
      if (playheadEl) {
        try { if ('value' in playheadEl) playheadEl.value = 0; else playheadEl.style.left = '0px'; } catch(e){}
      }
    } catch(e){ console.error('resetPlaybackState failed', e); }
  }

  // expose re-render for debugging
  globalThis._spectrogram_reRenderFromSpectra = reRenderFromSpectra;

  // Exposed manual dump helper for runtime inspection
  try {
    window.__dumpSpectroState = function(label){
      const obj = {
        label: label || null,
        duration: globalThis._spectroDuration,
        sampleRate: globalThis._spectroSampleRate,
        numFrames: globalThis._spectroNumFrames,
        framesPerSec: globalThis._spectroFramesPerSec,
        pxPerFrame: globalThis._spectroPxPerFrame,
        imageWidth: globalThis._spectroImageWidth,
  imageIntrinsicWidth: globalThis._spectroImageIntrinsicWidth,
  displayScaleX: globalThis._spectroDisplayScaleX,
        viewportWidth: scrollArea && scrollArea.clientWidth,
        pxPerSec: (globalThis._spectroMap && globalThis._spectroMap.pxPerSec && globalThis._spectroMap.pxPerSec()) || globalThis._spectroPxPerSec,
        axisLeft: globalThis._spectroAxisLeft,
        yMax: _resolveCurrentYMax(),
        tiles: Array.isArray(globalThis._spectroTiles) ? globalThis._spectroTiles.length : 0,
        lastGen: globalThis._spectroLastGen,
        selection: globalThis._spectroCurrentSelection || null,
        scrollLeft: scrollArea && scrollArea.scrollLeft,
        devicePixelRatio: window.devicePixelRatio || 1
      };
      try { console.table(obj); } catch(e){ console.log('[__dumpSpectroState]', obj); }
      return obj;
    };
  } catch(e){}

  // Simple one-line debug panel (opt-in) for time mapping diagnostics
  try {
    window.enableSimpleTimeDebug = function(){
      let panel = document.getElementById('simpleTimeDebug');
      if (!panel) {
        panel = document.createElement('div');
        panel.id = 'simpleTimeDebug';
        panel.style.cssText = 'position:fixed;bottom:8px;right:8px;background:#111;color:#0f0;font:12px/1.4 monospace;padding:6px 8px;border:1px solid #333;border-radius:6px;z-index:2147483647;max-width:320px;white-space:pre;';
        panel.textContent = 'TimeDebug panel active';
        document.body.appendChild(panel);
      }
      function fmt(v){ return (v==null?'-': (typeof v==='number'? v.toFixed(4): String(v))); }
      window.__updateSimpleTimeDebug = function(extra){
        try {
          if (!panel) return;
          const duration = globalThis._spectroDuration;
          const imageW = globalThis._spectroImageWidth;
          const vpW = (document.getElementById('scrollArea') && document.getElementById('scrollArea').clientWidth) || 0;
          const pxPerSec = (globalThis._spectroMap && globalThis._spectroMap.pxPerSec && globalThis._spectroMap.pxPerSec()) || globalThis._spectroPxPerSec;
          const secondsVisible = pxPerSec ? (vpW / pxPerSec) : 0;
          const scrollLeft = (document.getElementById('scrollArea') && document.getElementById('scrollArea').scrollLeft) || 0;
          const atRight = scrollLeft + vpW >= imageW - 1;
          const selection = globalThis._spectroCurrentSelection || null;
          const selTxt = selection ? `[sel ${fmt(selection.start)} → ${fmt(selection.end)}]` : '[no sel]';
          const extraTxt = extra ? ('\n' + extra) : '';
          panel.textContent = `Dur=${fmt(duration)}s imageW=${imageW}px vpW=${vpW}px\npxPerSec=${fmt(pxPerSec)} vis≈${fmt(secondsVisible)}s scroll=${scrollLeft}px right?=${atRight}\n${selTxt}${extraTxt}`;
        } catch(e){ panel.textContent = 'TimeDebug error'; }
      };
      // Initial paint
      window.__updateSimpleTimeDebug();
      // Hook basic events
      window.addEventListener('spectrogram-generated', ()=>{ try { window.__updateSimpleTimeDebug('[event spectrogram-generated]'); } catch(e){} });
      window.addEventListener('scroll', (ev)=>{ if (ev.target && ev.target.id === 'scrollArea') { try { window.__updateSimpleTimeDebug('[scroll]'); } catch(e){} } }, true);
    };
  } catch(e){}

})();
// ---- Cut Feature: selection + splice of spectra and audio (integrates with existing globals) ----
(function(){
  // Short note: Includes optional undo (single-level) via in-memory snapshot lasting a short time.

  const AXIS_TOP = 12; // Layout constant, must match main script.
  const scrollArea = document.getElementById('scrollArea');
  const viewportWrapper = document.getElementById('viewportWrapper');
  const cutBtn = document.getElementById('cutBtn');
  const selectBtn = document.getElementById('selectBtn');
  const silenceBtn = document.getElementById('silenceBtn');
  const filtersBtn = document.getElementById('filtersBtn');
  const canvas = document.getElementById('spectrogramCanvas');

  if (!viewportWrapper || !scrollArea || !canvas) return;

  // Ensure spacer exists (defensive).
  (function ensureSpacer(){ try { let s = document.getElementById('spectroSpacer'); if (!s) { s = document.createElement('div'); s.id='spectroSpacer'; scrollArea.appendChild(s); } } catch(e){} })();

  // Elements for selection overlay and interaction glass
  let overlayDiv = document.getElementById('spectroSelectionOverlay');
  if (!overlayDiv) { overlayDiv = document.createElement('div'); overlayDiv.id='spectroSelectionOverlay'; viewportWrapper.appendChild(overlayDiv); }
  let labelDiv = document.getElementById('spectroSelectionLabel');
  if (!labelDiv) { labelDiv = document.createElement('div'); labelDiv.id='spectroSelectionLabel'; viewportWrapper.appendChild(labelDiv); }
  let glass = document.getElementById('spectroCutGlass');
  if (!glass) { glass = document.createElement('div'); glass.id='spectroCutGlass'; viewportWrapper.appendChild(glass); }

  let cutArmed = false;
  let isDragging = false;
  let dragStartX = 0; // viewport CSS px
  let dragEndX = 0;
  let hasSelection = false; // true when a non-zero selection exists
  let pollTimer = null; // playback poll while armed
  let lastSnapshot = null;
  const undoBtn = document.getElementById('undoCutBtn');

  // Allow other modules to push a snapshot onto the spectrogram undo stack so Undo button works
  try {
    globalThis._setSpectroLastSnapshot = function(snap) { try { lastSnapshot = snap; if (undoBtn) undoBtn.disabled = !lastSnapshot; } catch(e){} };
    globalThis._getSpectroLastSnapshot = function(){ return lastSnapshot; };
  } catch(e) {}

  function viewportRect(){ const r = viewportWrapper.getBoundingClientRect(); return { left:r.left, top:r.top, width: viewportWrapper.clientWidth, height: viewportWrapper.clientHeight }; }

  function pxToSec(px) { try { return globalThis._spectroMap && typeof globalThis._spectroMap.pxToSec==='function' ? globalThis._spectroMap.pxToSec(px) : (px / Math.max(1, (globalThis._spectroPxPerSec|| (globalThis._spectroPxPerFrame*globalThis._spectroFramesPerSec)||1))); } catch(e){ return 0; } }
  function secToPx(sec) { try { return globalThis._spectroMap && typeof globalThis._spectroMap.secToPx==='function' ? globalThis._spectroMap.secToPx(sec) : Math.round(sec * Math.max(1, (globalThis._spectroPxPerSec|| (globalThis._spectroPxPerFrame*globalThis._spectroFramesPerSec)||1))); } catch(e){ return 0; } }
  function effectivePxPerSec() { try { return (globalThis._spectroMap && typeof globalThis._spectroMap.pxPerSec==='function') ? globalThis._spectroMap.pxPerSec() : Math.max(1, (globalThis._spectroPxPerSec|| (globalThis._spectroPxPerFrame*globalThis._spectroFramesPerSec)||1)); } catch(e){ return 1; } }

  // Public: enable/disable the Cut button depending on playback status and readiness
  function updateCutButtonEnabled(){
    if (!cutBtn) return;
    const ready = !!(globalThis._spectroSpectra && globalThis._spectroNumFrames && globalThis._spectroImageWidth);
    let playing = false;
    try { if (globalThis._playbackScrollJump && typeof globalThis._playbackScrollJump.status==='function') { const st = globalThis._playbackScrollJump.status(); playing = !!(st && st.playing); } } catch(e){}
    // Respect current annotation mode: selection/cut/filter/undo only allowed in 'edit' mode
    let editActive = false;
    try { editActive = !!(globalThis._editAnnotations && typeof globalThis._editAnnotations.isEditMode === 'function' && globalThis._editAnnotations.isEditMode()); } catch(e){ editActive = false; }

    // Only enable Cut when spectrogram is ready, not playing, a selection exists, and in edit mode
    cutBtn.disabled = !editActive || !ready || playing || !hasSelection;
    // Select and Filters should be disabled when not in edit mode or when playing/not ready
    try {
      if (selectBtn) {
        const wasDisabled = selectBtn.disabled;
        selectBtn.disabled = !editActive || !ready || playing;
        // Only update visual states when not disabled (user requested disabled appearance unchanged)
        if (!selectBtn.disabled) {
          if (cutArmed) {
            try { selectBtn.classList.add('selection-on'); selectBtn.classList.remove('selection-off'); selectBtn.classList.add('active'); } catch(e){}
          } else {
            try { selectBtn.classList.add('selection-off'); selectBtn.classList.remove('selection-on'); selectBtn.classList.remove('active'); } catch(e){}
          }
        }
      }
    } catch(e){}
  try { if (silenceBtn) silenceBtn.disabled = !editActive || !ready || playing || !hasSelection; } catch(e){}
    try { if (filtersBtn) filtersBtn.disabled = !editActive || !ready || playing; } catch(e){}
    // Undo should also be disabled when not in edit mode
    try { if (undoBtn) undoBtn.disabled = !editActive || !lastSnapshot; } catch(e){}
  }
  globalThis.updateCutButtonEnabled = updateCutButtonEnabled;

  function _resolveCurrentYMaxSafe(){ try { return (typeof _resolveCurrentYMax==='function') ? _resolveCurrentYMax() : (globalThis._spectroYMax || (globalThis._spectroSampleRate ? globalThis._spectroSampleRate/2 : 22050)); } catch(e){ return globalThis._spectroSampleRate ? globalThis._spectroSampleRate/2 : 22050; } }

  // Draw selection rectangle and labels over viewport (in CSS px relative to viewport left)
  function renderSelectionOverlay(leftPxViewport, rightPxViewport, c1Text, c2Text){
    const vp = viewportRect();
    const x1 = Math.max(0, Math.min(vp.width, Math.min(leftPxViewport, rightPxViewport)));
    const x2 = Math.max(0, Math.min(vp.width, Math.max(leftPxViewport, rightPxViewport)));
    const width = Math.max(0, x2 - x1);
    overlayDiv.style.display = width>0 ? 'block' : 'none';
    overlayDiv.style.left = (globalThis._spectroAxisLeft || 60) + x1 + 'px';
    overlayDiv.style.top = '12px';
    overlayDiv.style.width = width + 'px';
    overlayDiv.style.height = (globalThis._spectroImageHeight || 0) + 'px';
    labelDiv.style.display = width>0 ? 'block' : 'none';
    labelDiv.textContent = `${c1Text} → ${c2Text}`;
    labelDiv.style.left = (globalThis._spectroAxisLeft || 60) + x1 + 'px';
    labelDiv.style.top = '8px';
    // Track if a non-empty selection exists (width>0)
    hasSelection = width > 0;
    try { updateCutButtonEnabled(); } catch(e){}
  }
  globalThis.renderSelectionOverlay = renderSelectionOverlay;

  function clearSelectionOverlay(){ overlayDiv.style.display='none'; labelDiv.style.display='none'; }

  // Public getter for current selection state
  globalThis._spectroHasSelection = function(){ return !!hasSelection; };

  function formatSec(sec){ if (!isFinite(sec)||sec<0) return '0.000s'; const s = Number(sec).toFixed(3); return s + 's'; }

  // Optional: create a shallow snapshot for undo
  function snapshotSpectrogramState(){
    try {
      const spec = globalThis._spectroSpectra ? new Float32Array(globalThis._spectroSpectra) : null;
      const tiles = Array.isArray(globalThis._spectroTiles) ? globalThis._spectroTiles.slice() : null;
      const buf = globalThis._spectroAudioBuffer || null;
      const scroll = (document.getElementById('scrollArea') && typeof document.getElementById('scrollArea').scrollLeft==='number') ? document.getElementById('scrollArea').scrollLeft : 0;
      // Capture annotations snapshot as well so Undo restores boxes
      let ann = null;
      try {
        if (globalThis._annotations) {
          if (typeof globalThis._annotations.getAll === 'function') ann = (globalThis._annotations.getAll()||[]).map(r=>Object.assign({}, r));
          else if (Array.isArray(globalThis._annotations)) ann = globalThis._annotations.slice().map(r=>Object.assign({}, r));
        } else if (window.annotationGrid && typeof window.annotationGrid.getData==='function') {
          ann = (window.annotationGrid.getData()||[]).map(r=>Object.assign({}, r));
        } else {
          const tbl = document.getElementById('annotationTable') || document.querySelector('.annotation-table');
          if (tbl && tbl.tagName==='TABLE') {
            const hdrs = Array.from(tbl.querySelectorAll('thead th')).map(th => (th.textContent||th.innerText||'').trim());
            const out=[]; Array.from(tbl.querySelectorAll('tbody tr')).forEach(tr=>{ const cells=Array.from(tr.querySelectorAll('td')); const obj={}; for(let i=0;i<cells.length;i++){ obj[hdrs[i]||`col${i+1}`] = (cells[i].textContent||cells[i].innerText||'').trim(); } out.push(obj); });
            ann = out;
          }
        }
      } catch(e) { ann = null; }
      return {
        spectra: spec,
        numFrames: globalThis._spectroNumFrames,
        bins: globalThis._spectroBins,
        pxpf: globalThis._spectroPxPerFrame,
        fps: globalThis._spectroFramesPerSec,
        imgW: globalThis._spectroImageWidth,
  imgIntrinsic: globalThis._spectroImageIntrinsicWidth,
  displayScaleX: globalThis._spectroDisplayScaleX,
        imgH: globalThis._spectroImageHeight,
        tiles,
        pageCols: globalThis._spectroPageCols,
        pages: globalThis._spectroPages,
        sr: globalThis._spectroSampleRate,
        duration: globalThis._spectroDuration,
        audioBuffer: buf,
        annotations: ann,
        scrollLeft: scroll
      };
    } catch(e){ return null; }
  }
  globalThis.snapshotSpectrogramState = snapshotSpectrogramState;

  // Helper: rebuild tiles fully from current spectra (no FFT), honoring current Y max/gain/cmap
  async function _rebuildAllTilesFromSpectra(){
    const spectra = globalThis._spectroSpectra; if (!spectra) return;
    const bins = globalThis._spectroBins|0; const sr = globalThis._spectroSampleRate|0;
    const imageW = globalThis._spectroImageWidth|0; const imageH = globalThis._spectroImageHeight|0; if (!imageW||!imageH) return;
    const pxpf = globalThis._spectroPxPerFrame|0; const numFrames = globalThis._spectroNumFrames|0; const nyq = sr/2;
    const lutName = (document.getElementById('cmap') && document.getElementById('cmap').value) ? document.getElementById('cmap').value : 'custom';
    const gainInput = document.getElementById('gain');
    const gain = Math.max(0.0001, parseFloat(gainInput && gainInput.value) || 1);
    const lut = (function buildLUTLocal(name){
      const lut=new Uint8ClampedArray(256*3);
      function map(t){
        t=Math.max(0,Math.min(1,t));
        switch(name){
          case 'viridis': return [Math.round(68+187*Math.pow(t,1.0)), Math.round(1+210*Math.pow(t,0.8)), Math.round(84+170*(1-t))];
          case 'magma': return [Math.round(10+245*Math.pow(t,0.9)), Math.round(5+160*Math.pow(t,1.2)), Math.round(20+120*(1-t))];
          case 'grayscale': { const v=Math.round(255*t); return [v,v,v]; }
          case 'jet': { const rj=Math.round(255*Math.max(0,Math.min(1,1.5-Math.abs(2*t-1)))); const gj=Math.round(255*Math.max(0,Math.min(1,1.5-Math.abs(2*t)))); const bj=Math.round(255*Math.max(0,Math.min(1,1.5-Math.abs(2*t+1)))); return [rj,gj,bj]; }
          case 'cividis': return [Math.round(32+180*t), Math.round(69+130*Math.pow(t,0.9)), Math.round(92+60*(1-t))];
          default: {
            let r=0,g=0,b=0;
            if(t<0.25){ const u=t/0.25; r=0; g=Math.round(30*u); b=Math.round(80+175*u); }
            else if(t<0.5){ const u=(t-0.25)/0.25; r=0; g=Math.round(30+200*u); b=Math.round(255-55*u); }
            else if(t<0.75){ const u=(t-0.5)/0.25; r=Math.round(255*u); g=Math.round(230-100*u); b=Math.round(200-200*u); }
            else { const u=(t-0.75)/0.25; r=Math.round(255-20*(1-u)); g=Math.round(130+125*u); b=Math.round(0+255*u); }
            return [r,g,b];
          }
        }
      }
      for(let i=0;i<256;i++){ const rgb=map(i/255); lut[i*3]=rgb[0]; lut[i*3+1]=rgb[1]; lut[i*3+2]=rgb[2]; }
      return lut;
    })(lutName);
    const ymax = _resolveCurrentYMaxSafe();
    const bottom = globalThis._spectroBottomDB; const denom = globalThis._spectroDenom || 1e-12; const nyqHz = sr/2;

    const MAX_TILE_W = 8192;
    const tileW = Math.max(1, Math.min(MAX_TILE_W, (globalThis._spectroPageCols||MAX_TILE_W), imageW));
    const tiles = [];
    for (let tileX=0, idx=0; tileX<imageW; tileX+=tileW, idx++){
      const w = Math.min(tileW, imageW - tileX);
      const tilePixels = new Uint8ClampedArray(w * imageH * 4);
      for (let localX=0; localX<w; localX++){
        const globalX = tileX + localX;
        const frameIdx = Math.max(0, Math.min(numFrames-1, Math.floor(globalX / Math.max(1, pxpf))));
        for (let y=0; y<imageH; y++){
          const ty = y / Math.max(1, (imageH - 1));
          const freq = (1 - ty) * Math.max(1, Math.min(nyq, ymax));
          const fracBin = (freq / nyqHz) * (bins - 1);
          const fIdx = Math.max(0, Math.min(bins-1, Math.floor(fracBin)));
          const fFrac = fracBin - fIdx;
          const a = spectra[frameIdx*bins + fIdx];
          const b = spectra[frameIdx*bins + Math.max(0, Math.min(bins-1, fIdx+1))];
          const mag = a + (b - a) * fFrac;
          const magAdj = mag * gain;
          const db = 20 * (Math.log(magAdj + 1e-12) / Math.LN10);
          let v = (db - bottom) / (denom || 1e-12); if (!isFinite(v)) v = 0; v = Math.max(0, Math.min(1, v));
          const lutIdx = Math.round(v * 255) | 0; const rgbBase = lutIdx * 3;
          const pi = (y * w + localX) * 4;
          tilePixels[pi] = lut[rgbBase]; tilePixels[pi+1] = lut[rgbBase+1]; tilePixels[pi+2] = lut[rgbBase+2]; tilePixels[pi+3] = 255;
        }
      }
      const tcanvas = document.createElement('canvas'); tcanvas.width = w; tcanvas.height = imageH;
      const tctx = tcanvas.getContext('2d', { alpha:false }); tctx.putImageData(new ImageData(tilePixels, w, imageH), 0, 0);
      // Estimate time span for the tile
      const leftFrameIdx = Math.floor(tileX / Math.max(1, pxpf));
      const framesPerSec = globalThis._spectroFramesPerSec || ((globalThis._spectroSampleRate||44100) / (globalThis._spectroFFTSize ? (globalThis._spectroFFTSize/2) : 1024));
      const startTime = Math.max(0, Math.min((numFrames - 1) / Math.max(1, framesPerSec), leftFrameIdx / Math.max(1, framesPerSec)));
      const endTime = Math.min((numFrames - 1) / Math.max(1, framesPerSec), ((tileX + w - 1) / Math.max(1, pxpf)) / Math.max(1, framesPerSec));
      tiles.push({ bitmap:tcanvas, cols:w, startCol:tileX, startTime, endTime, colorVersion:(globalThis._spectroColorVersion|0), lutName:lutName, gain, ymax });
      if ((idx & 1) === 0) await new Promise(r => setTimeout(r,0));
    }
    globalThis._spectroTiles = tiles;
    globalThis._spectroPageCols = Math.max(1, tileW);
    globalThis._spectroPages = tiles.length;
  }

  // Splice decoded audio buffer between c1Sec..c2Sec (must be paused). Returns new duration (seconds).
  async function cutAudioBuffer(c1Sec, c2Sec){
    const buf = globalThis._spectroAudioBuffer; if (!buf) throw new Error('Audio buffer not available');
    const sr = buf.sampleRate|0; const ch = buf.numberOfChannels|0; const len = buf.length|0;
    const s1 = Math.max(0, Math.min(len, Math.floor(c1Sec * sr)));
  // Clamp and allow zero-length no-op at sample precision
  const s2 = Math.max(s1, Math.min(len, Math.ceil(c2Sec * sr)));
  if (s2 <= s1) { globalThis._spectroDuration = len / Math.max(1,sr); return globalThis._spectroDuration; }
    const newLen = Math.max(0, len - (s2 - s1));
    if (newLen <= 0) {
      // Edge: cutting entire buffer
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext; if (!Ctx) { globalThis._spectroAudioBuffer = null; globalThis._spectroDuration = 0; return 0; }
      const ctx = new Ctx(); const empty = ctx.createBuffer(Math.max(1,ch), 1, Math.max(1,sr)); if (ctx.close) try { await ctx.close(); } catch(e){}
      globalThis._spectroAudioBuffer = empty; globalThis._spectroDuration = empty.length / sr; return globalThis._spectroDuration;
    }
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext; if (!Ctx) {
      // Fallback: store channel arrays only
      const chans = []; for (let c=0;c<ch;c++){ const data = buf.getChannelData(c); const out = new Float32Array(newLen); out.set(data.subarray(0, s1), 0); out.set(data.subarray(s2), s1); chans.push(out); }
      globalThis._spectroAudioChannelData = chans; globalThis._spectroAudioBuffer = null; globalThis._spectroDuration = newLen / Math.max(1,sr); return globalThis._spectroDuration;
    }
    const ctx = new Ctx();
    const newBuf = ctx.createBuffer(Math.max(1,ch), Math.max(1,newLen), Math.max(1,sr));
    for (let c=0; c<ch; c++){
      const src = buf.getChannelData(c);
      const out = new Float32Array(newLen);
      out.set(src.subarray(0, s1), 0);
      out.set(src.subarray(s2), s1);
      try { newBuf.copyToChannel(out, c, 0); } catch(e){ const dst = newBuf.getChannelData(c); dst.set(out, 0); }
      if ((c & 1) === 0) await new Promise(r => setTimeout(r,0));
    }
    if (ctx.close) try { await ctx.close(); } catch(e){}
    globalThis._spectroAudioBuffer = newBuf;
    globalThis._spectroDuration = newBuf.length / Math.max(1, sr);
    return globalThis._spectroDuration;
  }
  globalThis.cutAudioBuffer = cutAudioBuffer;

  // Atomic cut operation: splice spectra and audio, rebuild tiles, update UI
  async function cutSpectrogramRange(c1Sec, c2Sec){
    // Validate readiness
    if (!globalThis._spectroSpectra || !globalThis._spectroBins || !globalThis._spectroNumFrames) throw new Error('Spectrogram not ready');
    const fps = globalThis._spectroFramesPerSec || 1; const bins = globalThis._spectroBins|0; const pxpf = globalThis._spectroPxPerFrame|0;
    const totalFrames = globalThis._spectroNumFrames|0;
    const Fpre = Math.max(0, globalThis._spectroDuration || (totalFrames / Math.max(1,fps)));
    // Clamp cut to file bounds for robust edge handling
    const rawCS = c1Sec, rawCE = c2Sec;
    let c1C = Math.max(0, Math.min(Fpre, c1Sec));
    let c2C = Math.max(0, Math.min(Fpre, c2Sec));
    // If clamped cut length is 0, treat as no-op with informative log
    if (c2C <= 0) { try { console.info('Cut ends before file start; ignoring'); } catch(_){} return false; }
    if (c1C >= Fpre) { try { console.info('Cut starts after file end; ignoring'); } catch(_){} return false; }
    if (c2C <= c1C) { try { console.info('Zero-length cut after clamp; ignoring'); } catch(_){} return false; }
    // Convert to frame indices WITHOUT forcing at least one frame removal
    const i1 = Math.max(0, Math.floor(c1C * fps));
    const i2 = Math.min(totalFrames, Math.ceil(c2C * fps));
    if (i2 <= i1) { try { console.info('Zero-frame cut after frame alignment; ignoring'); } catch(_){} return false; }
    // Aligned seconds used for audio and annotations
    const c1A = i1 / fps;
    const c2A = i2 / fps;

    // Snapshot (undo)
    lastSnapshot = snapshotSpectrogramState();

    // Splice spectra
    const newFrames = Math.max(0, totalFrames - (i2 - i1));
    const newSpectra = new Float32Array(newFrames * bins);
    // Copy before
    if (i1 > 0) newSpectra.set(globalThis._spectroSpectra.subarray(0, i1 * bins), 0);
    // Copy after
    const tailSrcStart = i2 * bins; const tailDstStart = i1 * bins; const tailLen = (totalFrames * bins) - tailSrcStart; if (tailLen > 0) newSpectra.set(globalThis._spectroSpectra.subarray(tailSrcStart, tailSrcStart + tailLen), tailDstStart);

    // Replace globals
  globalThis._spectroSpectra = newSpectra; globalThis._spectroNumFrames = newFrames;
  const intrinsicWidthAfterCut = Math.max(0, newFrames * Math.max(1, pxpf));

    // Cut audio (must be paused)
    const playing = (function(){ try { const st = globalThis._playbackScrollJump && globalThis._playbackScrollJump.status && globalThis._playbackScrollJump.status(); return !!(st && st.playing); } catch(e){ return false; } })();
    if (playing) throw new Error('Cannot cut while playback is active');
  await cutAudioBuffer(c1A, c2A);
    // Update px-per-sec mapping after duration change using the shared stretch helper.
    try {
      if (typeof globalThis._spectroApplyDisplayScaleFromIntrinsic === 'function') {
        globalThis._spectroApplyDisplayScaleFromIntrinsic(intrinsicWidthAfterCut);
      } else {
        const fpsNowFallback = Math.max(1e-9, globalThis._spectroFramesPerSec || fps);
        const pxpfNowFallback = Math.max(1, globalThis._spectroPxPerFrame || pxpf);
        globalThis._spectroImageWidth = intrinsicWidthAfterCut;
        globalThis._spectroImageIntrinsicWidth = intrinsicWidthAfterCut;
        globalThis._spectroDisplayScaleX = 1;
        const durNow = globalThis._spectroDuration;
        globalThis._spectroPxPerSec = (isFinite(durNow) && durNow > 0 && intrinsicWidthAfterCut > 0)
          ? (intrinsicWidthAfterCut / durNow)
          : (fpsNowFallback * pxpfNowFallback);
      }
      if (window.__updateSimpleTimeDebug) { try { window.__updateSimpleTimeDebug('[recalc after cut]'); } catch(e){} }
    } catch(e){}

    // Update spacer and scroll clamping
    try { const spacer = document.getElementById('spectroSpacer'); if (spacer) { spacer.style.width = (globalThis._spectroImageWidth||0) + 'px'; spacer.style.height = (12 + (globalThis._spectroImageHeight||0) + 44) + 'px'; } } catch(e){}
    try { const vpW = (scrollArea && scrollArea.clientWidth) || 0; const maxScroll = Math.max(0, (globalThis._spectroImageWidth||0) - vpW); if (scrollArea) scrollArea.scrollLeft = Math.max(0, Math.min(maxScroll, scrollArea.scrollLeft||0)); } catch(e){}

    // Rebuild tiles from spectra (full), redraw viewport and ticks
    await _rebuildAllTilesFromSpectra();
    // Prefer invoking the exported re-render so internal drawing helpers are called inside the original module scope
    try {
      if (typeof globalThis._spectrogram_reRenderFromSpectra === 'function') {
        await globalThis._spectrogram_reRenderFromSpectra(_resolveCurrentYMaxSafe());
      }
    } catch(e){}
    // Force a tiny scroll nudge to trigger viewport redraw if needed (in case re-render stub is unavailable)
    try {
      const cur = Math.round(scrollArea && typeof scrollArea.scrollLeft==='number' ? scrollArea.scrollLeft : 0);
      const maxScroll = Math.max(0, (globalThis._spectroImageWidth||0) - ((scrollArea && scrollArea.clientWidth) || 0));
      const target = Math.min(maxScroll, cur + 1);
      if (scrollArea) {
        scrollArea.scrollLeft = target;
        setTimeout(()=>{ try { scrollArea.scrollLeft = cur; } catch(e){} }, 0);
      }
    } catch(e){}
    // Best-effort direct call if accessible (may be undefined in this scope)
    try { if (typeof drawViewportFromTiles==='function') drawViewportFromTiles(); } catch(e){}
    try { if (typeof updateXTicksFromScroll==='function') updateXTicksFromScroll(); } catch(e){}

  // Adjust annotation boxes to reflect the cut (clip/shift/remove), then dispatch event
    try { await adjustAnnotationsForCut(c1A, c2A); } catch(e) { console.warn('adjustAnnotationsForCut failed', e); }
    try { window.dispatchEvent(new CustomEvent('spectrogram-cut', { detail: { startSec: c1Sec, endSec: c2Sec, newDuration: globalThis._spectroDuration } })); } catch(e){}
    _scheduleAnnotationOverlaySync('cutSpectrogramRange');
    return true;
  }
  globalThis.cutSpectrogramRange = cutSpectrogramRange;

  // Adjust annotations after a cut: clip overlapping, shift later ones, remove zero-length
  // and renumber ids/Selection. Implements Option 1 from user.
  async function adjustAnnotationsForCut(c1Sec, c2Sec){
    try {
      // Align cut to frame boundaries to match the spectrogram splice
      const fps = Math.max(1e-9, globalThis._spectroFramesPerSec || 1);
      const i1 = Math.max(0, Math.floor(c1Sec * fps));
      const i2 = Math.max(i1+1, Math.ceil(c2Sec * fps));
      const c1A = i1 / fps;
      const c2A = i2 / fps;
      const cutDur = Math.max(0, c2A - c1A);
      if (cutDur <= 0) return;

      // Get annotations from API, Tabulator or DOM fallback
      let rows = null;
      let usingAPI = false;
      if (globalThis._annotations) {
        try {
          if (typeof globalThis._annotations.getAll === 'function') { rows = (globalThis._annotations.getAll() || []).map(r => Object.assign({}, r)); usingAPI = true; }
          else if (Array.isArray(globalThis._annotations)) { rows = globalThis._annotations.slice().map(r => Object.assign({}, r)); usingAPI = true; }
        } catch(e) { rows = null; }
      }
      if (!rows && window.annotationGrid && typeof window.annotationGrid.getData === 'function') {
        try { rows = (window.annotationGrid.getData() || []).map(r => Object.assign({}, r)); } catch(e) { rows = null; }
      }
      if (!rows) {
        // DOM table fallback
        try {
          const tbl = document.getElementById('annotationTable') || document.querySelector('.annotation-table');
          if (tbl && tbl.tagName === 'TABLE') {
            const hdrs = Array.from(tbl.querySelectorAll('thead th')).map(th => (th.textContent||th.innerText||'').trim());
            const out = [];
            Array.from(tbl.querySelectorAll('tbody tr')).forEach(tr => {
              const cells = Array.from(tr.querySelectorAll('td'));
              const obj = {};
              for (let i=0;i<cells.length;i++){ obj[hdrs[i]||`col${i+1}`] = (cells[i].textContent||cells[i].innerText||'').trim(); }
              out.push(obj);
            });
            rows = out.map(r => Object.assign({}, r));
          }
        } catch(e) { rows = []; }
      }
      if (!Array.isArray(rows)) rows = [];

      const newRows = [];
      const newDuration = globalThis._spectroDuration || 0;

      for (let i=0;i<rows.length;i++){
        const r = Object.assign({}, rows[i]);
        // canonical numeric fields
        let b = Number(r.beginTime != null ? r.beginTime : r.begin_time || r['Begin Time (s)']);
        let e = Number(r.endTime != null ? r.endTime : r.end_time || r['End Time (s)']);
        if (!isFinite(b)) b = 0; if (!isFinite(e)) e = 0;

        // Cases
        if (e <= c1A) {
          // entirely before cut
          // unchanged
        } else if (b >= c2A) {
          // entirely after cut: shift earlier
          b = b - cutDur; e = e - cutDur;
        } else if (b < c1A && e > c1A && e <= c2A) {
          // overlaps left edge into cut: clip end to cut start
          e = c1A;
        } else if (b < c1A && e > c2A) {
          // Cut lies fully inside the box: reduce box length by cut span (merge across)
          e = e - cutDur;
        } else if (b >= c1A && e <= c2A) {
          // fully inside cut: remove
          continue;
        } else if (b < c2A && e > c2A && b >= c1A) {
          // starts inside cut and continues after: shift the tail left
          const tailLen = e - c2A;
          b = c1A;
          e = c1A + tailLen; // same as e - cutDur
        }

        // Clamp to valid bounds
        if (b < 0) b = 0;
        if (e > newDuration) e = newDuration;

        // If after clipping the box has non-positive length, drop it
        if (e <= b) continue;

        // Assign back
        r.beginTime = +b;
        r.endTime = +e;
        newRows.push(r);
      }

      // Shift any remaining rows that are after the cut but we may have already shifted them; ensure order by beginTime
      newRows.sort((a,b)=> (Number(a.beginTime)||0) - (Number(b.beginTime)||0));

      // Renumber ids (a0001...) and Selection
      for (let i=0;i<newRows.length;i++){
        const id = 'a' + String(i+1).padStart(4,'0');
        newRows[i].id = id;
        newRows[i].Selection = String(i+1);
      }

      // Write back using API if present
      if (usingAPI && globalThis._annotations) {
        try {
          if (typeof globalThis._annotations.replaceAll === 'function') { globalThis._annotations.replaceAll(newRows); return; }
          if (typeof globalThis._annotations.import === 'function') { globalThis._annotations.import(newRows); return; }
          if (Array.isArray(globalThis._annotations)) { globalThis._annotations.length = 0; Array.prototype.push.apply(globalThis._annotations, newRows); return; }
        } catch(e){ console.warn('writing annotations via API failed', e); }
      }

      // Tabulator grid write-back
      if (window.annotationGrid && typeof window.annotationGrid.replaceData === 'function') {
        try { await window.annotationGrid.replaceData(newRows); return; } catch(e){ console.warn('annotationGrid.replaceData failed', e); }
      }

      // DOM fallback: rebuild table
      try {
        const tbl = document.getElementById('annotationTable') || document.querySelector('.annotation-table');
        if (tbl && tbl.tagName === 'TABLE') {
          const headers = Object.keys(newRows[0] || {});
          // clear and rebuild head
          tbl.innerHTML = '';
          const thead = document.createElement('thead'); const tr = document.createElement('tr'); headers.forEach(h => { const th=document.createElement('th'); th.textContent=h; tr.appendChild(th); }); thead.appendChild(tr); tbl.appendChild(thead);
          const tbody = document.createElement('tbody');
          newRows.forEach(r=>{ const tr=document.createElement('tr'); headers.forEach(h=>{ const td=document.createElement('td'); td.textContent = r[h] !== undefined ? String(r[h]) : ''; tr.appendChild(td); }); tbody.appendChild(tr); });
          tbl.appendChild(tbody);
        }
      } catch(e){ console.warn('DOM annotation write fallback failed', e); }

    } catch(err) { console.error('adjustAnnotationsForCut error', err); }
  }
  globalThis.adjustAnnotationsForCut = adjustAnnotationsForCut;

  // Adjust annotations when a region is replaced with silence (remove boxes inside and shift later ones by delta)
  async function adjustAnnotationsForSilence(c1Sec, c2Sec, silenceSec){
    try {
      const originalSpan = Math.max(0, c2Sec - c1Sec);
      const insertSpan = Math.max(0, silenceSec);
      const diff = insertSpan - originalSpan;
      const insertEnd = c1Sec + insertSpan;
      const newDuration = Math.max(0, (globalThis._spectroDuration != null ? Number(globalThis._spectroDuration) : (c2Sec + diff)));

      let rows = null;
      let usingAPI = false;
      if (globalThis._annotations) {
        try {
          if (typeof globalThis._annotations.getAll === 'function') { rows = (globalThis._annotations.getAll() || []).map(r => Object.assign({}, r)); usingAPI = true; }
          else if (Array.isArray(globalThis._annotations)) { rows = globalThis._annotations.slice().map(r => Object.assign({}, r)); usingAPI = true; }
        } catch(e) { rows = null; }
      }
      if (!rows && window.annotationGrid && typeof window.annotationGrid.getData === 'function') {
        try { rows = (window.annotationGrid.getData() || []).map(r => Object.assign({}, r)); } catch(e) { rows = null; }
      }
      if (!rows) {
        try {
          const tbl = document.getElementById('annotationTable') || document.querySelector('.annotation-table');
          if (tbl && tbl.tagName === 'TABLE') {
            const hdrs = Array.from(tbl.querySelectorAll('thead th')).map(th => (th.textContent||th.innerText||'').trim());
            const out = [];
            Array.from(tbl.querySelectorAll('tbody tr')).forEach(tr => {
              const cells = Array.from(tr.querySelectorAll('td'));
              const obj = {};
              for (let i=0;i<cells.length;i++){ obj[hdrs[i]||`col${i+1}`] = (cells[i].textContent||cells[i].innerText||'').trim(); }
              out.push(obj);
            });
            rows = out.map(r => Object.assign({}, r));
          }
        } catch(e) { rows = []; }
      }
      if (!Array.isArray(rows)) rows = [];

      const newRows = [];
      for (let i=0;i<rows.length;i++){
        const r = Object.assign({}, rows[i]);
        let b = Number(r.beginTime != null ? r.beginTime : r.begin_time || r['Begin Time (s)']);
        let e = Number(r.endTime != null ? r.endTime : r.end_time || r['End Time (s)']);
        if (!isFinite(b)) b = 0;
        if (!isFinite(e)) e = 0;

        if (e <= c1Sec) {
          // entirely before: unchanged
        } else if (b >= c2Sec) {
          // entirely after: shift by diff
          b = b + diff;
          e = e + diff;
        } else if (b >= c1Sec && e <= c2Sec) {
          // entirely inside replaced region -> drop
          continue;
        } else if (b < c1Sec && e > c1Sec && e <= c2Sec) {
          // overlaps left edge, clip end to c1
          e = c1Sec;
        } else if (b >= c1Sec && b < c2Sec && e > c2Sec) {
          // overlaps right edge: start after silence, shift tail
          const tailLen = e - c2Sec;
          b = insertEnd;
          e = insertEnd + tailLen;
        } else if (b < c1Sec && e > c2Sec) {
          // spans across region: trim to left portion only
          e = c1Sec;
        }

        if (b < 0) b = 0;
        if (e > newDuration) e = newDuration;
        if (e <= b) continue;

        r.beginTime = +b;
        r.endTime = +e;
        newRows.push(r);
      }

      newRows.sort((a,b)=> (Number(a.beginTime)||0) - (Number(b.beginTime)||0));
      for (let i=0;i<newRows.length;i++){
        const id = 'a' + String(i+1).padStart(4,'0');
        newRows[i].id = id;
        newRows[i].Selection = String(i+1);
      }

      if (usingAPI && globalThis._annotations) {
        try {
          if (typeof globalThis._annotations.replaceAll === 'function') { globalThis._annotations.replaceAll(newRows); return; }
          if (typeof globalThis._annotations.import === 'function') { globalThis._annotations.import(newRows); return; }
          if (Array.isArray(globalThis._annotations)) { globalThis._annotations.length = 0; Array.prototype.push.apply(globalThis._annotations, newRows); return; }
        } catch(e){ console.warn('writing annotations via API failed', e); }
      }

      if (window.annotationGrid && typeof window.annotationGrid.replaceData === 'function') {
        try { await window.annotationGrid.replaceData(newRows); return; } catch(e){ console.warn('annotationGrid.replaceData failed', e); }
      }

      try {
        const tbl = document.getElementById('annotationTable') || document.querySelector('.annotation-table');
        if (tbl && tbl.tagName === 'TABLE') {
          const headers = Object.keys(newRows[0] || {});
          tbl.innerHTML = '';
          const thead = document.createElement('thead'); const tr = document.createElement('tr'); headers.forEach(h => { const th=document.createElement('th'); th.textContent=h; tr.appendChild(th); }); thead.appendChild(tr); tbl.appendChild(thead);
          const tbody = document.createElement('tbody');
          newRows.forEach(r=>{ const tr=document.createElement('tr'); headers.forEach(h=>{ const td=document.createElement('td'); td.textContent = r[h] !== undefined ? String(r[h]) : ''; tr.appendChild(td); }); tbody.appendChild(tr); });
          tbl.appendChild(tbody);
        }
      } catch(e){ console.warn('DOM annotation write fallback (silence) failed', e); }

    } catch(err) { console.error('adjustAnnotationsForSilence error', err); }
  }
  globalThis.adjustAnnotationsForSilence = adjustAnnotationsForSilence;

  function disarmCutMode(cancelled=false){
    cutArmed = false; isDragging = false;
    glass.style.display = 'none'; glass.style.cursor = '';
    clearSelectionOverlay();
    // clear any transient selection when disarming unless we are intentionally keeping it
    hasSelection = false;
    try { window.removeEventListener('keydown', onKeyDown, true); } catch(e){}
    try { window.removeEventListener('contextmenu', onContextMenu, true); } catch(e){}
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (cutBtn) cutBtn.classList.remove('active');
    try {
      if (selectBtn) {
        selectBtn.classList.remove('active');
        // reflect OFF state (if not disabled)
        try { if (!selectBtn.disabled) { selectBtn.classList.add('selection-off'); selectBtn.classList.remove('selection-on'); } } catch(e){}
      }
    } catch(e){}
    try { updateCutButtonEnabled(); } catch(e){}
  }
  globalThis.disarmCutMode = disarmCutMode;

  function onKeyDown(ev){ if (ev.key === 'Escape') { ev.preventDefault(); disarmCutMode(true); } if (ev.key === 'Enter') { ev.preventDefault(); confirmCut(); } }
  function onContextMenu(ev){ ev.preventDefault(); try { disarmCutMode(true); updateCutButtonEnabled(); } catch(e){} }

  function armCutMode(){
    if (cutArmed) return; cutArmed = true; isDragging = false; dragStartX = 0; dragEndX = 0;
    if (cutBtn) cutBtn.classList.add('active');
    try { if (selectBtn && !selectBtn.disabled) { selectBtn.classList.add('selection-on'); selectBtn.classList.remove('selection-off'); selectBtn.classList.add('active'); } } catch(e){}
    // Disable during playback
    const st = globalThis._playbackScrollJump && globalThis._playbackScrollJump.status && globalThis._playbackScrollJump.status(); if (st && st.playing) { updateCutButtonEnabled(); cutArmed=false; if (cutBtn) cutBtn.classList.remove('active'); return; }
    // Show glass to capture drags over the viewport area
  const axisLeft = globalThis._spectroAxisLeft || 60; const imgH = globalThis._spectroImageHeight || 0; const vpW = (scrollArea && scrollArea.clientWidth) ? scrollArea.clientWidth : viewportWrapper.clientWidth;
    glass.style.left = axisLeft + 'px'; glass.style.top = '12px'; glass.style.width = vpW + 'px'; glass.style.height = imgH + 'px'; glass.style.display = 'block'; glass.style.cursor = 'crosshair';
    clearSelectionOverlay();
  glass.onpointerdown = (ev)=>{ ev.preventDefault(); if (ev.button===2) { // right-click: cancel selection mode
    try { disarmCutMode(true); updateCutButtonEnabled(); } catch(e){}; return; }
      isDragging = true; glass.setPointerCapture(ev.pointerId); const rect = glass.getBoundingClientRect(); dragStartX = Math.max(0, Math.min(rect.width, ev.clientX - rect.left)); dragEndX = dragStartX; renderSelectionWithTimes(); };
    glass.onpointermove = (ev)=>{ if (!isDragging) return; const rect = glass.getBoundingClientRect(); dragEndX = Math.max(0, Math.min(rect.width, ev.clientX - rect.left)); renderSelectionWithTimes(); };
    glass.onpointerup = (ev)=>{ if (!isDragging) return; const rect = glass.getBoundingClientRect(); dragEndX = Math.max(0, Math.min(rect.width, ev.clientX - rect.left)); isDragging = false; renderSelectionWithTimes(); };
    glass.onpointercancel = (ev)=>{ isDragging = false; };
    // also capture contextmenu directly on glass to confirm
  glass.oncontextmenu = (ev)=>{ ev.preventDefault(); try { disarmCutMode(true); updateCutButtonEnabled(); } catch(e){} };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('contextmenu', onContextMenu, true);
    // Poll playback state while armed; if starts, cancel selection
    pollTimer = setInterval(()=>{ try { const st = globalThis._playbackScrollJump && globalThis._playbackScrollJump.status && globalThis._playbackScrollJump.status(); if (st && st.playing) { disarmCutMode(true); updateCutButtonEnabled(); } } catch(e){} }, 300);
  }
  globalThis.armCutMode = armCutMode;

  function renderSelectionWithTimes(){
    const leftPxViewport = Math.min(dragStartX, dragEndX);
    const rightPxViewport = Math.max(dragStartX, dragEndX);
    const absLeft = leftPxViewport + (scrollArea && scrollArea.scrollLeft ? scrollArea.scrollLeft : 0);
    const absRight = rightPxViewport + (scrollArea && scrollArea.scrollLeft ? scrollArea.scrollLeft : 0);
    const imgW = globalThis._spectroImageWidth || 0;
    const clLeft = Math.max(0, Math.min(imgW, absLeft));
    const clRight = Math.max(0, Math.min(imgW, absRight));
    const c1Sec = pxToSec(clLeft);
    const c2Sec = pxToSec(clRight);
    // Record the current selection in seconds and absolute image px for external modules
    try { globalThis._spectroCurrentSelection = { start: c1Sec, end: c2Sec }; } catch(e){}
    try { globalThis._spectroSelectionAbsPx = { left: clLeft, right: clRight }; } catch(e){}
    renderSelectionOverlay(leftPxViewport, rightPxViewport, formatSec(c1Sec), formatSec(c2Sec));
  }

  async function confirmCut(){
    // Compute selection seconds and validate
    const absLeft = Math.min(dragStartX, dragEndX) + (scrollArea && scrollArea.scrollLeft ? scrollArea.scrollLeft : 0);
    const absRight = Math.max(dragStartX, dragEndX) + (scrollArea && scrollArea.scrollLeft ? scrollArea.scrollLeft : 0);
  const imgW = globalThis._spectroImageWidth || 0;
  const clLeft = Math.max(0, Math.min(imgW, absLeft)); const clRight = Math.max(0, Math.min(imgW, absRight));
  const c1Sec = pxToSec(clLeft); const c2Sec = pxToSec(clRight);
  const fps = globalThis._spectroFramesPerSec || 1; const i1 = Math.max(0, Math.floor(c1Sec * fps)); const i2 = Math.max(i1+1, Math.min(globalThis._spectroNumFrames||0, Math.ceil(c2Sec * fps)));
    if (i2 <= i1) { disarmCutMode(true); return; }
    try {
      await cutSpectrogramRange(c1Sec, c2Sec);
      toast('Cut applied');
      if (undoBtn) { try { undoBtn.disabled = !lastSnapshot; } catch(_){} }
    } catch (e) {
      console.error('Cut failed', e);
      try { alert('Cut failed: ' + (e && e.message ? e.message : e)); } catch(_){}
      // Attempt rollback
      if (lastSnapshot) try { await restoreSnapshot(lastSnapshot); toast('Restored previous state after failure'); } catch(_){}
    } finally { disarmCutMode(false); updateCutButtonEnabled(); }
  }

  function toast(msg){
    try {
      const t = document.createElement('div');
      t.textContent = msg; t.style.position='fixed'; t.style.left='50%'; t.style.transform='translateX(-50%)'; t.style.bottom='20px'; t.style.background='rgba(0,0,0,0.8)'; t.style.color='#fff'; t.style.padding='6px 10px'; t.style.borderRadius='6px'; t.style.zIndex='2147483646';
      document.body.appendChild(t); setTimeout(()=>{ try { t.remove(); } catch(e){} }, 2000);
    } catch(e){}
  }

  async function restoreSnapshot(snap){
    if (!snap) return;
    try {
      if (snap.spectra) globalThis._spectroSpectra = new Float32Array(snap.spectra);
      globalThis._spectroNumFrames = snap.numFrames|0;
      globalThis._spectroBins = snap.bins|0;
      globalThis._spectroFramesPerSec = snap.fps||globalThis._spectroFramesPerSec;
      globalThis._spectroPxPerFrame = snap.pxpf||globalThis._spectroPxPerFrame;
      const intrinsicWidth = (typeof snap.imgIntrinsic === 'number') ? snap.imgIntrinsic : (snap.imgW || globalThis._spectroImageIntrinsicWidth || globalThis._spectroImageWidth || 0);
      globalThis._spectroImageHeight = snap.imgH||globalThis._spectroImageHeight;
      globalThis._spectroTiles = Array.isArray(snap.tiles) ? snap.tiles.slice() : null;
      globalThis._spectroPageCols = snap.pageCols||globalThis._spectroPageCols;
      globalThis._spectroPages = snap.pages||globalThis._spectroPages;
      globalThis._spectroSampleRate = snap.sr||globalThis._spectroSampleRate;
      globalThis._spectroAudioBuffer = snap.audioBuffer||globalThis._spectroAudioBuffer;
      globalThis._spectroDuration = snap.duration||globalThis._spectroDuration;
      try {
        if (typeof globalThis._spectroApplyDisplayScaleFromIntrinsic === 'function') {
          globalThis._spectroApplyDisplayScaleFromIntrinsic(intrinsicWidth);
        } else {
          globalThis._spectroImageWidth = intrinsicWidth;
          globalThis._spectroImageIntrinsicWidth = intrinsicWidth;
          globalThis._spectroDisplayScaleX = 1;
          const fpsNow = Math.max(1e-9, globalThis._spectroFramesPerSec||1);
          const pxpfNow = Math.max(1, globalThis._spectroPxPerFrame||1);
          const durNow = globalThis._spectroDuration;
          globalThis._spectroPxPerSec = (isFinite(durNow) && durNow > 0 && intrinsicWidth > 0)
            ? (intrinsicWidth / durNow)
            : (fpsNow * pxpfNow);
        }
        if (window.__updateSimpleTimeDebug) { try { window.__updateSimpleTimeDebug('[recalc after undo]'); } catch(e){} }
      } catch(_){}
      const spacer = document.getElementById('spectroSpacer'); if (spacer) { spacer.style.width = (globalThis._spectroImageWidth||0) + 'px'; spacer.style.height = (12 + (globalThis._spectroImageHeight||0) + 44) + 'px'; }
      await _rebuildAllTilesFromSpectra();
      try { await (typeof reRenderFromSpectra==='function' ? reRenderFromSpectra(_resolveCurrentYMaxSafe()) : Promise.resolve()); } catch(e){}
      if (typeof drawViewportFromTiles==='function') drawViewportFromTiles();
      if (typeof updateXTicksFromScroll==='function') updateXTicksFromScroll();
      _scheduleAnnotationOverlaySync('restoreSnapshot');
      // Restore scroll position (clamped), and nudge to force overlay redraws
      try {
        const sa = document.getElementById('scrollArea');
        if (sa) {
          const vpW = sa.clientWidth||0;
          const maxScroll = Math.max(0, (globalThis._spectroImageWidth||0) - vpW);
          const target = Math.max(0, Math.min(maxScroll, (snap.scrollLeft||0)));
          sa.scrollLeft = target;
          const cur = sa.scrollLeft|0;
          sa.scrollLeft = Math.min(maxScroll, cur+1);
          setTimeout(()=>{ try { sa.scrollLeft = cur; } catch(e){} }, 0);
        }
      } catch(_){ }
    } catch(e) { console.error('restoreSnapshot failed', e); }
  }

  // Wire Undo button click if present
  if (undoBtn) {
    undoBtn.addEventListener('click', async (ev)=>{
      ev.preventDefault();
      if (!lastSnapshot) return;
      try {
        await restoreSnapshot(lastSnapshot);
        // Restore annotations from snapshot, if present
        if (lastSnapshot.annotations && Array.isArray(lastSnapshot.annotations)) {
          try {
            if (globalThis._annotations) {
              if (typeof globalThis._annotations.replaceAll==='function') globalThis._annotations.replaceAll(lastSnapshot.annotations);
              else if (typeof globalThis._annotations.import==='function') globalThis._annotations.import(lastSnapshot.annotations);
              else if (Array.isArray(globalThis._annotations)) { globalThis._annotations.length=0; Array.prototype.push.apply(globalThis._annotations, lastSnapshot.annotations); }
            } else if (window.annotationGrid && typeof window.annotationGrid.replaceData==='function') {
              await window.annotationGrid.replaceData(lastSnapshot.annotations);
            } else {
              const tbl = document.getElementById('annotationTable') || document.querySelector('.annotation-table');
              if (tbl && tbl.tagName==='TABLE') {
                const headers = Object.keys(lastSnapshot.annotations[0]||{});
                tbl.innerHTML='';
                const thead=document.createElement('thead'); const tr=document.createElement('tr'); headers.forEach(h=>{ const th=document.createElement('th'); th.textContent=h; tr.appendChild(th); }); thead.appendChild(tr); tbl.appendChild(thead);
                const tbody=document.createElement('tbody'); lastSnapshot.annotations.forEach(r=>{ const tr=document.createElement('tr'); headers.forEach(h=>{ const td=document.createElement('td'); td.textContent = r[h]!==undefined? String(r[h]) : ''; tr.appendChild(td); }); tbody.appendChild(tr); }); tbl.appendChild(tbody);
              }
            }
          } catch(_){ }
        }
        toast('Undo applied');
      } finally {
        lastSnapshot = null; if (undoBtn) undoBtn.disabled = true;
      }
    });
  }

  // Wire Cut button
  if (cutBtn) {
    cutBtn.addEventListener('click', (ev)=>{
      ev.preventDefault();
      // Disallow cutting when not in edit mode
      try { const editActive = !!(globalThis._editAnnotations && typeof globalThis._editAnnotations.isEditMode === 'function' && globalThis._editAnnotations.isEditMode()); if (!editActive) { try { toast('Switch to Edit mode to Cut selections.'); } catch(e){}; return; } } catch(e){}
      if (cutBtn.disabled) return;
      // If selection mode is currently armed, treat Cut click as confirmation to apply the selection.
      if (cutArmed) {
        // If user has an active selection (overlay visible or drag completed), confirm the cut.
        try { confirmCut(); } catch(e) { console.error('confirmCut failed', e); }
      } else {
        // Not armed: instruct user to press Select first (more explicit UX) and optionally arm mode.
        try { toast('Press Select then drag to choose a range to cut.'); } catch(e) {}
      }
    });
  }
  // Wire Select button (new UI): enters selection mode so the user can drag to create a selection
  if (selectBtn) {
    selectBtn.addEventListener('click', (ev)=>{
      ev.preventDefault();
      try {
        const editActive = !!(globalThis._editAnnotations && typeof globalThis._editAnnotations.isEditMode === 'function' && globalThis._editAnnotations.isEditMode());
        if (!editActive) { try { toast('Switch to Edit mode to create a selection.'); } catch(e){}; return; }
        // Toggle selection mode: if already armed, disarm and clear selection
        if (cutArmed) {
          try { disarmCutMode(true); if (selectBtn) selectBtn.classList.remove('active'); try { globalThis._spectroCurrentSelection = null; globalThis._spectroSelectionAbsPx = null; } catch(e){} } catch(e){}
          return;
        }
        armCutMode(); if (selectBtn) selectBtn.classList.add('active');
      } catch(e){ console.error('armCutMode failed', e); }
    });
  }
  if (undoBtn) { try { undoBtn.disabled = true; } catch(_){} }

  // Export logic moved to export_sound.js to keep responsibilities separated.
  // Keep Cut button enablement in sync
  updateCutButtonEnabled();
  window.addEventListener('spectrogram-generated', ()=>{ try { updateCutButtonEnabled(); } catch(e){} });
  window.addEventListener('annotation-mode-changed', ()=>{ try { updateCutButtonEnabled(); } catch(e){} });
  setInterval(()=>{ try { updateCutButtonEnabled(); } catch(e){} }, 800);

  // Listen for mode-change events so selection is only possible in Edit mode.
  try {
    window.addEventListener('mode-change', (ev) => {
      try {
        const mode = ev && ev.detail && ev.detail.mode;
        if (mode === 'create') {
          // If selection was armed in edit mode, disarm and clear selection so create mode can proceed.
          try { if (cutArmed) { disarmCutMode(true); } } catch(e){}
          try { if (selectBtn && !selectBtn.disabled) { selectBtn.classList.remove('selection-on'); selectBtn.classList.add('selection-off'); } } catch(e){}
        }
        // If switched to edit, ensure select button shows OFF state (unless armed)
        if (mode === 'edit') {
          try { if (selectBtn && !selectBtn.disabled && !cutArmed) { selectBtn.classList.add('selection-off'); selectBtn.classList.remove('selection-on'); } } catch(e){}
        }
      } catch(e){}
    }, false);
  } catch(e){}

  // Ensure selection overlay follows scroll even before full spectrogram regen hooks are installed
  try {
    if (scrollArea && typeof scrollArea.addEventListener === 'function') {
      scrollArea.addEventListener('scroll', ()=>{
        try {
          if (globalThis._spectroSelectionAbsPx) {
            const abs = globalThis._spectroSelectionAbsPx;
            const leftVp = abs.left - (scrollArea && scrollArea.scrollLeft ? scrollArea.scrollLeft : 0);
            const rightVp = abs.right - (scrollArea && scrollArea.scrollLeft ? scrollArea.scrollLeft : 0);
            try { renderSelectionOverlay(leftVp, rightVp, formatSec(pxToSec(abs.left)), formatSec(pxToSec(abs.right))); } catch(e){}
          }
        } catch(e){}
      }, { passive: true });
    }
  } catch(e){}

})();
