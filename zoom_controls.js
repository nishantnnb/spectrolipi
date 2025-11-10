// zoom_controls.js
// Add-on zoom controls that DO NOT modify existing code/logic.
// - X zoom: rebuilds tile layout from existing spectra (no FFT), preserves left-edge time
// - Y zoom: calls existing re-render with updated ymax (Hz)
// - Annotations remain aligned because we update the same globals used by overlays
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

  // Build empty tiles (no bitmap yet) for a given pxpf, then rely on the existing
  // re-render function to build bitmaps consistently.
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

    // Update authoritative globals consistent with existing code
    globalThis._spectroTiles = tiles;
    globalThis._spectroImageWidth = imageW;
    globalThis._spectroPxPerFrame = pxpf;
    // Prefer direct computation for px/sec
    const duration = Number(globalThis._spectroDuration || (numFrames/framesPerSec));
    globalThis._spectroPxPerSec = isFinite(duration) && duration > 0 ? (imageW / duration) : (framesPerSec * pxpf);

    ensureSpacerWidth(imageW, imageH);
    return true;
  }

  function currentPxpf(){ return Number(globalThis._spectroPxPerFrame || 0) || 2; }
  const MAX_PXPF = 8; // extended upper limit for X zoom

  async function applyXZoom(newPxpf){
    newPxpf = clamp(Math.round(newPxpf), 1, MAX_PXPF); // extended safe range up to 8
    if (!globalThis._spectroSpectra) return; // nothing loaded yet
    const oldPxpf = currentPxpf();
    if (newPxpf === oldPxpf) return;
    const capturedLeftSec = captureLeftTime();
    // Build tiles synced to new pxpf
    const ok = await buildTilesFromSpectra(newPxpf);
    if (!ok) return;
    // Re-render via existing internal function for perfect alignment
    const useY = readYmaxInputHz();
    try { if (typeof globalThis._spectrogram_reRenderFromSpectra === 'function') await globalThis._spectrogram_reRenderFromSpectra(useY); } catch(e){}
    // Restore left-edge time
    setLeftTime(capturedLeftSec);
    // Notify others defensively
    try { window.dispatchEvent(new CustomEvent('spectrogram-generated', { detail: { meta: { reason: 'x-zoom', pxpf: newPxpf } } })); } catch(e){}
    // Force axis/ticks refresh immediately (without requiring user scroll)
    forceAxisRefresh();
  }

  async function applyYZoom(newYHz){
    if (!globalThis._spectroSpectra) return;
    const nyq = Number(globalThis._spectroSampleRate || 0) / 2 || 22050;
    const clamped = clamp(Number(newYHz)||nyq, 1000, nyq); // keep reasonable lower bound
    // Use core renderer to rebuild spectrogram image for the new Y-max.
    // Remove any overlay if previously active.
    try { await removeYZoomOverlay(); } catch(e){}
    setYmaxInputHz(clamped);
    // Re-render base spectrogram using existing tiles path; if unavailable fall back to tile stretch.
    let rendered = false;
    try {
      if (typeof globalThis._spectrogram_reRenderFromSpectra === 'function') {
        await globalThis._spectrogram_reRenderFromSpectra(clamped);
        rendered = true;
      }
    } catch(e){ rendered = false; }
    if (!rendered) {
      try { await rebuildVerticalScaledTiles(clamped); rendered = true; } catch(e){ console.warn('rebuildVerticalScaledTiles failed', e); }
    }
  globalThis._spectroYMax = clamped;
  try { if (globalThis._spectroLastGen) globalThis._spectroLastGen.ymax = clamped; } catch(e){}
    // Dispatch explicit custom event for overlays/annotation modules to recompute vertical positions.
    try { window.dispatchEvent(new CustomEvent('spectrogram-yzoom', { detail: { ymax: clamped } })); } catch(e){}
    // Ensure axes/ticks redraw even if scroll hasn't changed
    forceAxisRefresh();
    try { window.dispatchEvent(new CustomEvent('spectrogram-generated', { detail: { meta: { reason: 'y-zoom', ymax: clamped } } })); } catch(e){}
  }

  function wireToolbar(){
    try {
      // If toolbar already wired, skip
      const existingBar = document.getElementById('zoomToolbar');
      if (existingBar && existingBar.__zoomWired) return;

      // Create bar only if not present in HTML (declarative markup)
      let bar = existingBar;
      const createdBar = !bar;
      if (createdBar) {
        bar = document.createElement('div');
        bar.id = 'zoomToolbar';
        // Place toolbar inline, intended to be inserted after the Play button in the top controls.
        Object.assign(bar.style, {
          display: 'inline-flex', alignItems: 'center', gap: '8px',
          background:'rgba(17,17,17,0.92)', border:'1px solid rgba(255,255,255,0.08)',
          borderRadius:'8px', padding:'6px 8px', backdropFilter:'blur(2px)', fontFamily:'system-ui, sans-serif',
          color: '#ddd', zIndex: '2147483640'
        });
      }

      // Establish initial Y baseline and helpers
      const computeNyq = ()=>((globalThis._spectroSampleRate||0)/2 || 22050);
      let initialYBase = (function(){
        const fromInput = (function(){ try { return readYmaxInputHz(); } catch(e){ return NaN; } })();
        if (isFinite(fromInput) && fromInput > 0) return fromInput;
        const gy = (typeof globalThis._spectroYMax === 'number' && globalThis._spectroYMax > 0) ? globalThis._spectroYMax : (globalThis._spectroLastGen && globalThis._spectroLastGen.ymax) || computeNyq();
        return gy;
      })();
      let yBaseLocked = false;
      let yLevels = [];
      let yStepIndex = 0;
      function buildYLevels(stepsDesired){
        const nyq = computeNyq();
        const minYRange = 1000;
        const steps = Math.max(2, Math.min(24, Math.floor(stepsDesired||12)));
        const totalSpan = Math.max(0, nyq - minYRange);
        const stepSize = (steps > 1) ? (totalSpan / (steps - 1)) : totalSpan;
        const arr = [];
        for (let i=0; i<steps; i++){
          const yVal = Math.max(minYRange, Math.round(nyq - i*stepSize));
          arr.push(yVal);
        }
        arr[arr.length-1] = minYRange;
        return arr;
      }

      function makeSpinner(label){
        const row = document.createElement('div');
        Object.assign(row.style,{display:'flex',alignItems:'center',gap:'8px'});
        const lbl = document.createElement('div'); lbl.textContent = label; Object.assign(lbl.style,{color:'#ddd',fontSize:'12px',width:'16px'});
        const box = document.createElement('div'); Object.assign(box.style,{display:'inline-flex',alignItems:'center',border:'1px solid rgba(255,255,255,0.10)',borderRadius:'6px',overflow:'hidden'});
        function makeSide(text){ const b=document.createElement('button'); b.textContent=text; Object.assign(b.style,{width:'32px',height:'32px',background:'#2196F3',border:'0',color:'#fff',cursor:'pointer',fontSize:'14px',fontWeight:'600',display:'inline-flex',alignItems:'center',justifyContent:'center'}); return b; }
        const minus = makeSide('-'); minus.title='Decrease '+label;
        const plus = makeSide('+'); plus.title='Increase '+label;
        const mid = document.createElement('div'); Object.assign(mid.style,{minWidth:'16px',height:'32px',padding:'0 4px',display:'flex',alignItems:'center',justifyContent:'center',background:'#fff',color:'#000',fontSize:'14px',fontWeight:'600',boxSizing:'border-box'});
        box.appendChild(minus); box.appendChild(mid); box.appendChild(plus);
        const reset = document.createElement('button'); reset.title='Reset '+label; reset.setAttribute('aria-label','Reset '+label); Object.assign(reset.style,{width:'32px',height:'32px',border:'1px solid rgba(255,255,255,0.10)',borderRadius:'6px',background:'#1e88e5',color:'#fff',cursor:'pointer',display:'inline-flex',alignItems:'center',justifyContent:'center',padding:0});
        reset.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z" fill="#fff"/></svg>';
        row.appendChild(lbl); row.appendChild(box); row.appendChild(reset);
        return {row,minus,plus,mid,reset};
      }

      // If toolbar is declarative (exists), wire to its elements; otherwise create spinners dynamically
      let xSpin, ySpin;
      if (!createdBar) {
        // declarative: expect elements with the following ids
        const yMinus = document.getElementById('yMinus');
        const yPlus = document.getElementById('yPlus');
        const yMid = document.getElementById('yMid');
        const yReset = document.getElementById('yReset');
        const xMinus = document.getElementById('xMinus');
        const xPlus = document.getElementById('xPlus');
        const xMid = document.getElementById('xMid');
        const xReset = document.getElementById('xReset');
        const yRow = bar.querySelector('[data-which="y"]') || (yMinus && yMinus.parentNode && yMinus.parentNode.parentNode) || null;
        const xRow = bar.querySelector('[data-which="x"]') || (xMinus && xMinus.parentNode && xMinus.parentNode.parentNode) || null;
        ySpin = { row: yRow, minus: yMinus, plus: yPlus, mid: yMid, reset: yReset };
        xSpin = { row: xRow, minus: xMinus, plus: xPlus, mid: xMid, reset: xReset };
      } else {
        xSpin = makeSpinner('X');
        ySpin = makeSpinner('Y');
        // Append in desired order: Y controls first, then X controls (both inline)
        bar.appendChild(ySpin.row);
        bar.appendChild(xSpin.row);
      }

      function setXButtonsState(){ const cur=currentPxpf(); const min=1; const max=MAX_PXPF; if(cur<=min){ try{ xSpin.minus.style.background='#9e9e9e'; xSpin.minus.disabled=true; }catch(e){} try{ xSpin.plus.style.background='#2196F3'; xSpin.plus.disabled=false; }catch(e){} } else if(cur>=max){ try{ xSpin.plus.style.background='#9e9e9e'; xSpin.plus.disabled=true; }catch(e){} try{ xSpin.minus.style.background='#2196F3'; xSpin.minus.disabled=false; }catch(e){} } else { try{ xSpin.plus.style.background='#2196F3'; xSpin.plus.disabled=false; xSpin.minus.style.background='#2196F3'; xSpin.minus.disabled=false; }catch(e){} } // keep reset always active
        try { if (xSpin && xSpin.reset) { xSpin.reset.disabled = false; xSpin.reset.style.opacity = '1'; } } catch(e){}
      }

      function setYButtonsState(){
        const lastIdx = yLevels.length ? (yLevels.length - 1) : 0;
        try { if (ySpin && ySpin.minus) { if (yStepIndex <= 0){ ySpin.minus.style.background='#9e9e9e'; ySpin.minus.disabled=true; } else { ySpin.minus.style.background='#2196F3'; ySpin.minus.disabled=false; } } } catch(e){}
        try { if (ySpin && ySpin.plus) { if (yStepIndex >= lastIdx){ ySpin.plus.style.background='#9e9e9e'; ySpin.plus.disabled=true; } else { ySpin.plus.style.background='#2196F3'; ySpin.plus.disabled=false; } } } catch(e){}
        // keep reset always active
        try { if (ySpin && ySpin.reset) { ySpin.reset.disabled = false; ySpin.reset.style.opacity = '1'; } } catch(e){}
      }

      function updateXDisplay(){ try { if (xSpin && xSpin.mid) xSpin.mid.textContent = String(currentPxpf()); } catch(e){} setXButtonsState(); }
      function updateYDisplay(){ try { if (ySpin && ySpin.mid) ySpin.mid.textContent = String((yStepIndex+1)|0); } catch(e){} setYButtonsState(); }

      // Wire events (guard each in case declarative markup is missing pieces)
      try { if (xSpin && xSpin.plus) xSpin.plus.addEventListener('click', async ()=>{ const cur=currentPxpf(); const next = clamp(cur*2,1,MAX_PXPF); await applyXZoom(next); updateXDisplay(); }); } catch(e){}
      try { if (xSpin && xSpin.minus) xSpin.minus.addEventListener('click', async ()=>{ const cur=currentPxpf(); const next = clamp(Math.max(1, Math.round(cur/2)),1,MAX_PXPF); await applyXZoom(next); updateXDisplay(); }); } catch(e){}
      try { if (xSpin && xSpin.reset) xSpin.reset.addEventListener('click', async ()=>{ const base=(globalThis._spectroLastGen&&globalThis._spectroLastGen.pxpf)?globalThis._spectroLastGen.pxpf:2; await applyXZoom(base); updateXDisplay(); }); } catch(e){}

      // Y spinner behavior (linear levels): '+' moves to next smaller Ymax; '-' to previous larger Ymax; levels are precomputed.
      try { if (ySpin && ySpin.plus) ySpin.plus.addEventListener('click', async ()=>{
        if (!yLevels || !yLevels.length) yLevels = buildYLevels(12);
        const lastIdx = yLevels.length - 1;
        if (yStepIndex >= lastIdx) return;
        yStepIndex++;
        const nextY = yLevels[yStepIndex];
        await applyYZoom(nextY);
        setYmaxInputHz(nextY);
        updateYDisplay();
      }); } catch(e){}
      try { if (ySpin && ySpin.minus) ySpin.minus.addEventListener('click', async ()=>{
        if (!yLevels || !yLevels.length) yLevels = buildYLevels(12);
        if (yStepIndex <= 0) return;
        yStepIndex--;
        const nextY = yLevels[yStepIndex];
        await applyYZoom(nextY);
        setYmaxInputHz(nextY);
        updateYDisplay();
      }); } catch(e){}
      try { if (ySpin && ySpin.reset) ySpin.reset.addEventListener('click', async ()=>{ const nyq=(globalThis._spectroSampleRate||0)/2||22050; await removeYZoomOverlay(); setYmaxInputHz(nyq); try { if (typeof globalThis._spectrogram_reRenderFromSpectra==='function') await globalThis._spectrogram_reRenderFromSpectra(nyq);}catch(e){} globalThis._spectroYMax=nyq; try{ if(globalThis._spectroLastGen) globalThis._spectroLastGen.ymax=nyq;}catch(e){} forceAxisRefresh(); updateYDisplay(); try{ window.dispatchEvent(new CustomEvent('spectrogram-generated',{detail:{meta:{reason:'y-zoom-reset',ymax:nyq}}})); }catch(e){} }); } catch(e){}

      // If we created the bar, insert it; otherwise ensure bar is inside placeholder (preserve declarative placement)
      try {
        if (createdBar) {
          const placeholder = document.getElementById('zoomToolbarPlaceholder');
          if (placeholder) placeholder.appendChild(bar);
          else {
            const play = document.getElementById('playPause');
            if (play && play.parentNode) {
              if (play.nextSibling) play.parentNode.insertBefore(bar, play.nextSibling);
              else play.parentNode.appendChild(bar);
            } else document.body.appendChild(bar);
          }
        }
      } catch(e){ if (createdBar && !bar.parentNode) document.body.appendChild(bar); }

      // Build initial Y levels and set proper index
      try {
        yLevels = buildYLevels(12);
        const curYInit = (function(){
          const a = (function(){ try { return readYmaxInputHz(); } catch(e){ return NaN; } })();
          if (isFinite(a) && a > 0) return a;
          const b = (typeof globalThis._spectroYMax === 'number' && globalThis._spectroYMax > 0) ? globalThis._spectroYMax : computeNyq();
          return b;
        })();
        let closestIdx = 0, best = Infinity;
        for (let i=0;i<yLevels.length;i++){ const d = Math.abs(yLevels[i] - curYInit); if (d < best){ best = d; closestIdx = i; } }
        yStepIndex = closestIdx;
      } catch(e){}
      updateXDisplay(); updateYDisplay();

      // Keep display in sync with external events
      try { window.addEventListener('spectrogram-generated', ()=>{ 
        if (!yBaseLocked) {
          try {
            const newBase = (function(){
              const v1 = (function(){ try { return readYmaxInputHz(); } catch(e){ return NaN; } })();
              if (isFinite(v1) && v1 > 0) return v1;
              const gy = (typeof globalThis._spectroYMax === 'number' && globalThis._spectroYMax > 0) ? globalThis._spectroYMax : (globalThis._spectroLastGen && globalThis._spectroLastGen.ymax) || computeNyq();
              return gy;
            })();
            if (isFinite(newBase) && newBase > 0) { initialYBase = newBase; yBaseLocked = true; }
          } catch(e){}
        }
        try {
          yLevels = buildYLevels(12);
          const cur = Number(globalThis._spectroYMax || computeNyq());
          let closestIdx = 0, best = Infinity;
          for (let i=0;i<yLevels.length;i++){ const d = Math.abs(yLevels[i] - cur); if (d < best){ best = d; closestIdx = i; } }
          yStepIndex = closestIdx;
        } catch(e){}
        updateXDisplay(); updateYDisplay(); 
      }, { passive:true }); } catch(e){}
      try { window.addEventListener('spectrogram-yzoom', ()=>{ updateYDisplay(); }, { passive:true }); } catch(e){}

      // Mark wired
      try { bar.__zoomWired = true; } catch(e){}
    } catch(e){}
  }

  function onSpectroReady(){
    // enable toolbar once spectrogram data exists
    wireToolbar();
  }

  whenReady(()=>{
    try { wireToolbar(); } catch(e){}
    try { window.addEventListener('spectrogram-generated', onSpectroReady, { passive: true }); } catch(e){}
    // Bridge: if user changes the built-in Y max input, ensure any legacy overlay is removed so
    // the base spectrogram canvas is visible and updates are not masked by an old overlay.
    try {
      const ymaxEl = document.getElementById('ymax');
      if (ymaxEl) {
        const bridge = ()=>{ try { removeYZoomOverlay(); forceAxisRefresh(); } catch(e){} };
        ymaxEl.addEventListener('input', bridge, { passive:true });
        ymaxEl.addEventListener('change', bridge, { passive:true });
      }
    } catch(e){}
    // Also clear any overlay after a new spectrogram render completes
    try { window.addEventListener('spectrogram-generated', ()=>{ try { removeYZoomOverlay(); } catch(e){} }, { passive:true }); } catch(e){}
  });

  // ---------------- Additional Axis Redraw + Y Zoom Overlay Implementation ----------------

  function redrawAxes(){
    try {
      const axisCanvas = document.getElementById('axisCanvas');
      if (!axisCanvas) return;
      const ctx = axisCanvas.getContext('2d'); if (!ctx) return;
      const AXIS_TOP = 12, AXIS_BOTTOM = 44;
      const imgH = Number(globalThis._spectroImageHeight || (axisCanvas.height - AXIS_TOP - AXIS_BOTTOM));
      const sa = document.getElementById('scrollArea');
      const vpW = sa ? (sa.clientWidth || 800) : 800;
      const pps = Math.max(1, pxPerSec());
      const scrollLeft = sa ? Math.max(0, Math.round(sa.scrollLeft||0)) : 0;
      const visibleStartSec = scrollLeft / pps;
      const visibleDuration = vpW / pps;
      const niceSteps = [0.1,0.2,0.5,1,2,5,10,15,30,60,120];
      let step = niceSteps[0];
      for (let v of niceSteps){ if (v * pps >= 60){ step = v; break; } step = v; }
      // Clear
      ctx.fillStyle = '#000'; ctx.fillRect(0,0,axisCanvas.width,axisCanvas.height);
      ctx.fillStyle = '#111'; ctx.fillRect(0,AXIS_TOP,axisCanvas.width,imgH);
      // Time ticks
      ctx.strokeStyle='#666'; ctx.lineWidth=1; ctx.fillStyle='#fff'; ctx.font='12px sans-serif'; ctx.textAlign='center';
      const endSec = visibleStartSec + visibleDuration;
      const firstTick = Math.ceil(visibleStartSec / step) * step;
      for (let t = firstTick; t <= endSec + 1e-9; t += step){
        const xPx = (t - visibleStartSec) * pps; // relative within viewport
        // Draw a vertical tick marker at right edge (matching existing style) but base design kept minimal
        ctx.beginPath(); ctx.moveTo(axisCanvas.width - 6 + 0.5, AXIS_TOP); ctx.lineTo(axisCanvas.width - 6 + 0.5, AXIS_TOP + 8); ctx.stroke();
        const label = (t >= 60) ? ((t/60).toFixed(0)+'m') : (t.toFixed((step<1)?1:0)+'s');
        ctx.fillText(label, axisCanvas.width/2, AXIS_TOP + imgH + 2);
      }
      // Y axis (using current _spectroYMax)
      const ymaxHz = Number(globalThis._spectroYMax || (globalThis._spectroSampleRate||44100)/2);
      const yTicks = 6; ctx.textAlign='right'; ctx.textBaseline='middle';
      for (let i=0;i<yTicks;i++){
        const t = i/(yTicks-1);
        const freq = ymaxHz * (1 - t);
        const yPx = AXIS_TOP + Math.round(t * imgH);
        ctx.beginPath(); ctx.moveTo(axisCanvas.width - 6, yPx + 0.5); ctx.lineTo(axisCanvas.width - 0, yPx + 0.5); ctx.stroke();
        const label = (freq >= 1000) ? (Math.round(freq/10)/100)+' kHz' : Math.round(freq)+' Hz';
        ctx.fillText(label, axisCanvas.width - 8, yPx);
      }
      ctx.save(); ctx.translate(12, AXIS_TOP + imgH/2); ctx.rotate(-Math.PI/2); ctx.textAlign='center'; ctx.fillStyle='#fff'; ctx.fillText('Frequency (kHz)', 0,0); ctx.restore();
    } catch(e){ /* ignore */ }
  }

  async function buildYZoomOverlay(ymaxHz){
    try {
      const baseCanvas = document.getElementById('spectrogramCanvas'); if (!baseCanvas) return;
      const scrollArea = document.getElementById('scrollArea'); if (!scrollArea) return;
      const AXIS_TOP = 12, AXIS_BOTTOM = 44;
      const imageH = Number(globalThis._spectroImageHeight || (baseCanvas.height - AXIS_TOP - AXIS_BOTTOM));
      const imageW = Number(globalThis._spectroImageWidth || baseCanvas.width);
      const nyq = Number(globalThis._spectroSampleRate || 0)/2 || 22050;
      const spectra = globalThis._spectroSpectra; const bins = globalThis._spectroBins;
      if (!spectra || !bins || !globalThis._spectroNumFrames) return;
      // Create overlay canvas
      let overlay = document.getElementById('spectrogramYZoomCanvas');
      if (!overlay){
        overlay = document.createElement('canvas');
        overlay.id = 'spectrogramYZoomCanvas';
        overlay.style.position='sticky'; overlay.style.left='0px'; overlay.style.top='0px';
        overlay.style.zIndex = '2'; // above original spectrogram
        overlay.style.pointerEvents='none';
        scrollArea.appendChild(overlay);
      }
      overlay.style.display='block';
      // Hide original canvas while zoom overlay active
      baseCanvas.style.visibility='hidden';
      const viewW = Math.max(1, scrollArea.clientWidth || imageW);
      const cssHeight = AXIS_TOP + imageH + AXIS_BOTTOM;
      const dpr = window.devicePixelRatio || 1;
      overlay.style.width = viewW + 'px'; overlay.style.height = cssHeight + 'px';
      const internalW = Math.max(1, Math.round(viewW * Math.min(dpr, 32768/Math.max(1, viewW))));
      const internalH = Math.max(1, Math.round(cssHeight * Math.min(dpr, 32768/Math.max(1, cssHeight))));
      overlay.width = internalW; overlay.height = internalH;
      const octx = overlay.getContext('2d', { alpha:false });
      octx.setTransform(1,0,0,1,0,0);
      octx.clearRect(0,0,internalW,internalH);
      octx.fillStyle='#111';
      const scaleX = internalW / viewW; const scaleY = internalH / cssHeight;
      octx.fillRect(0, Math.round(AXIS_TOP*scaleY), Math.round(viewW*scaleX), Math.round(imageH*scaleY));
      const leftPx = Math.max(0, Math.round(scrollArea.scrollLeft||0));
      const rightPx = Math.min(imageW, leftPx + viewW);
      const pxpf = Number(globalThis._spectroPxPerFrame || 2);
      const gain = (globalThis._spectroRenderParams && globalThis._spectroRenderParams.gain) ? globalThis._spectroRenderParams.gain : 1;
      // LUT reproduction (simple grayscale fallback for performance)
      function lutColor(v){ const c = Math.round(v*255); return [c,c,c]; }
      const maxBin = Math.min(bins - 1, Math.round((ymaxHz / nyq) * (bins - 1)));
      const denomDB = (globalThis._spectroTopDB - globalThis._spectroBottomDB) || 1e-6;
      for (const t of (globalThis._spectroTiles||[])){
        const tx0 = t.startCol; const tx1 = t.startCol + t.cols;
        if (tx1 <= leftPx || tx0 >= rightPx) continue;
        const interL = Math.max(leftPx, tx0); const interR = Math.min(rightPx, tx1); const interW = Math.max(0, interR - interL);
        if (interW <= 0) continue;
        const w = interW; const h = imageH;
        const tilePixels = new Uint8ClampedArray(w * h * 4);
        for (let localX = 0; localX < w; localX++){
          const globalX = interL + localX;
          const frameIdx = Math.floor(globalX / pxpf);
          const baseFrame = Math.min(globalThis._spectroNumFrames - 1, Math.max(0, frameIdx));
          for (let y = 0; y < h; y++){
            // y -> subset bin then stretch to full height
            const ty = y / Math.max(1, h - 1);
            const subsetFrac = ty; // 0..1 within zoomed range
            const binFloat = subsetFrac * maxBin;
            const b0 = Math.floor(binFloat);
            const frac = binFloat - b0;
            const idxA = baseFrame * bins + Math.max(0, Math.min(bins-1, b0));
            const idxB = baseFrame * bins + Math.max(0, Math.min(bins-1, b0+1));
            const mag = spectra[idxA] + (spectra[idxB] - spectra[idxA]) * frac;
            const magAdj = mag * gain;
            const db = 20 * (Math.log(magAdj + 1e-12) / Math.LN10);
            let v = (db - globalThis._spectroBottomDB) / denomDB; if (!isFinite(v)) v = 0; v = Math.max(0, Math.min(1, v));
            const [r,g,b] = lutColor(v);
            const pi = (y * w + localX) * 4;
            tilePixels[pi]=r; tilePixels[pi+1]=g; tilePixels[pi+2]=b; tilePixels[pi+3]=255;
          }
        }
        const img = new ImageData(tilePixels, w, h);
        const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h; const tctx = tmp.getContext('2d'); tctx.putImageData(img,0,0);
        const dxCss = interL - leftPx; const dwCss = w;
        const dx = Math.round(dxCss * scaleX); const dy = Math.round(AXIS_TOP * scaleY);
        const dw = Math.max(1, Math.round(dwCss * scaleX)); const dh = Math.max(1, Math.round(h * scaleY));
        octx.drawImage(tmp, 0,0,w,h, dx, dy, dw, dh);
      }
      globalThis._spectroYZoomActive = true;
    } catch(e){ console.warn('buildYZoomOverlay failed', e); }
  }

  async function removeYZoomOverlay(){
    try {
      const ov = document.getElementById('spectrogramYZoomCanvas');
      const baseCanvas = document.getElementById('spectrogramCanvas');
      if (ov) ov.remove();
      if (baseCanvas) baseCanvas.style.visibility='visible';
      globalThis._spectroYZoomActive = false;
    } catch(e){}
  }

  // Ensure axis ticks refresh when user scrolls with overlay
  try { document.getElementById('scrollArea') && document.getElementById('scrollArea').addEventListener('scroll', function(){ redrawAxes(); }, { passive:true }); } catch(e){}

  function forceAxisRefresh(){
    try {
      const sa = document.getElementById('scrollArea');
      if (sa) {
        sa.dispatchEvent(new Event('scroll'));
      }
      window.dispatchEvent(new Event('resize'));
    } catch(e){}
  }

  // Build a vertically stretched spectrogram (fallback path when full re-render not available).
  async function rebuildVerticalScaledTiles(ymaxHz){
    const spectra = globalThis._spectroSpectra; const tiles = globalThis._spectroTiles; const bins = globalThis._spectroBins;
    if (!spectra || !tiles || !bins) return false;
    const sr = globalThis._spectroSampleRate || 44100; const nyq = sr/2;
    const imageH = globalThis._spectroImageHeight || 0; const pxpf = globalThis._spectroPxPerFrame || 2;
    const ymaxClamped = Math.max(1, Math.min(nyq, Number(ymaxHz)||nyq));
    const bottom = globalThis._spectroBottomDB; const denom = globalThis._spectroDenom || 1e-12;
    const lutName = (globalThis._spectroRenderParams && globalThis._spectroRenderParams.lutName) || ((typeof document!=='undefined' && document.getElementById('cmap')) ? document.getElementById('cmap').value : 'custom');
    const lut = (function(){ const buildLUT = globalThis.buildLUT || (function(name){ const arr=new Uint8ClampedArray(256*3); for(let i=0;i<256;i++){ const v=i; arr[i*3]=v; arr[i*3+1]=v; arr[i*3+2]=v; } return arr; }); return buildLUT(lutName); })();
    const gain = (globalThis._spectroRenderParams && globalThis._spectroRenderParams.gain) || 1;
    for (let idx=0; idx<tiles.length; idx++){
      const t = tiles[idx]; if (!t) continue;
      const w = t.cols; const tileX = t.startCol;
      const pixels = new Uint8ClampedArray(w * imageH * 4);
      for (let localX=0; localX<w; localX++){
        const globalX = tileX + localX;
        const frameIdx = Math.floor(globalX / pxpf);
        const baseFrame = Math.min(globalThis._spectroNumFrames - 1, Math.max(0, frameIdx));
        for (let y=0; y<imageH; y++){
          const ty = y / Math.max(1, imageH - 1);
          const freq = (1 - ty) * ymaxClamped;
          const fracBin = (freq / nyq) * (bins - 1);
          const b0 = Math.floor(fracBin); const frac = fracBin - b0;
          const a = spectra[baseFrame * bins + Math.max(0, Math.min(bins-1, b0))];
          const b = spectra[baseFrame * bins + Math.max(0, Math.min(bins-1, b0+1))];
          const mag = a + (b - a) * frac;
          const magAdj = mag * gain;
          const db = 20 * (Math.log(magAdj + 1e-12) / Math.LN10);
          let v = (db - bottom) / denom; if (!isFinite(v)) v = 0; v = Math.max(0, Math.min(1, v));
          const lutIdx = Math.round(v * 255) | 0; const rgbBase = lutIdx * 3;
          const pi = (y * w + localX) * 4;
          pixels[pi] = lut[rgbBase]; pixels[pi+1] = lut[rgbBase+1]; pixels[pi+2] = lut[rgbBase+2]; pixels[pi+3] = 255;
        }
      }
      const c = document.createElement('canvas'); c.width = w; c.height = imageH; const cx = c.getContext('2d', { alpha:false }); cx.putImageData(new ImageData(pixels, w, imageH), 0, 0); t.bitmap = c; t.ymax = ymaxClamped;
      if ((idx & 1) === 0) await new Promise(r=>setTimeout(r,0));
    }
    try { globalThis._spectroColorVersion = (globalThis._spectroColorVersion|0) + 1; } catch(e){}
    try { drawViewportFromTiles && drawViewportFromTiles(); } catch(e){}
    return true;
  }

  // Public minimal API for diagnostics
  globalThis._zoomDiagnostics = {
    axisRedraw: redrawAxes,
    yZoomActive: ()=>!!globalThis._spectroYZoomActive,
    removeYZoom: removeYZoomOverlay
  };
})();
