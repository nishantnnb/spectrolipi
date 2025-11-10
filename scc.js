// scc.js
// Spectrogram Cross-Correlation (SCC) auto-annotation
// UI: Run SCC button opens dialog to configure options and run detections from selected grid rows.
// Algorithm: generate pitch/time variants of template(s), compute normalized 2D cross-correlation on spectrogram magnitudes,
// peak-pick with guard bands, convert to time/frequency boxes, NMS by IoU, and insert into the grid.

(function(){
  const RUN_BTN_ID = 'runSccBtn';
  const MODAL_ID = 'sccModal';
  const STYLE_ID = 'sccModalStyles';

  // Small helpers
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const round4 = (v) => Number(v).toFixed(4);

  // Very safe pause helper: attempts to pause playback if available, bounded by timeoutMs
  async function safePausePlayback(timeoutMs = 800) {
    try {
      const holder = (globalThis._playbackScrollJump && typeof globalThis._playbackScrollJump.pause === 'function') ? globalThis._playbackScrollJump :
                     (globalThis._playback && typeof globalThis._playback.pause === 'function') ? globalThis._playback : null;
      if (!holder) return;
      const p = holder.pause && holder.pause.call(holder);
      if (p && typeof p.then === 'function') {
        await Promise.race([p, new Promise((_, r) => setTimeout(r, timeoutMs))]).catch(() => {});
      }
    } catch (e) {}
  }

  // Merge adjacent detections if their gap is less than maxGapSec.
  // Each detection is an object with at least {t1,t2,f1,f2,score}.
  function mergeDetectionsByGap(dets, maxGapSec){
    try {
      const arr = Array.isArray(dets) ? dets.slice() : [];
      if (arr.length <= 1) return arr;
      // sort by begin time, then end time
      arr.sort((a,b) => (a.t1 - b.t1) || (a.t2 - b.t2));
      const out = [];
      let cur = { ...arr[0] };
      for (let i=1;i<arr.length;i++){
        const nxt = arr[i];
        const gap = (nxt.t1 - cur.t2);
        if (gap < maxGapSec){
          // merge into cur: extend end time, expand freq range, keep max score
          cur.t2 = Math.max(cur.t2, nxt.t2);
          cur.f1 = Math.min(cur.f1, nxt.f1);
          cur.f2 = Math.max(cur.f2, nxt.f2);
          const s1 = (typeof cur.score === 'number') ? cur.score : Number(cur.score||0);
          const s2 = (typeof nxt.score === 'number') ? nxt.score : Number(nxt.score||0);
          cur.score = Math.max(isFinite(s1)?s1:0, isFinite(s2)?s2:0);
        } else {
          out.push(cur);
          cur = { ...nxt };
        }
      }
      out.push(cur);
      return out;
    } catch(e){ return Array.isArray(dets) ? dets : []; }
  }

  function getGridSelectedTemplates() {
    try {
      if (!window.annotationGrid || typeof window.annotationGrid.getSelectedRows !== 'function') return [];
      const rows = window.annotationGrid.getSelectedRows();
      return rows.map(r => r.getData());
    } catch (e) { return []; }
  }

  function getSpectroMeta() {
    return {
      spectra: globalThis._spectroSpectra || null,
      bins: globalThis._spectroBins || 0,
      framesPerSec: globalThis._spectroFramesPerSec || 0,
      sampleRate: globalThis._spectroSampleRate || 44100
    };
  }

  function hzToBin(hz, sr, bins) {
    const nyq = sr / 2;
    const frac = clamp(hz / Math.max(1e-9, nyq), 0, 1);
    return Math.min(bins - 1, Math.max(0, Math.floor(frac * (bins - 1))));
  }
  function timeToFrame(t, fps, maxFrames) {
    const idx = Math.floor(clamp(t, 0, Number.MAX_SAFE_INTEGER) * Math.max(1e-9, fps));
    if (typeof maxFrames === 'number' && isFinite(maxFrames)) return Math.min(Math.max(0, idx), Math.max(0, maxFrames - 1));
    return Math.max(0, idx);
  }

  function extractTemplate2D(spectra, bins, fps, sr, t0, t1, fLow, fHigh) {
    // Quantize template to exact frame & bin boundaries and add a 1-frame/bin padding to
    // reduce sensitivity to tiny redraw differences. This makes extraction deterministic
    // for slightly different user-drawn box coordinates.
    const b0 = hzToBin(fLow, sr, bins);
    const b1 = hzToBin(fHigh, sr, bins);
    let bb0 = Math.min(b0, b1), bb1 = Math.max(b0, b1);
    const padBins = 1;
    bb0 = Math.max(0, bb0 - padBins);
    bb1 = Math.min(bins - 1, bb1 + padBins);
    const h = Math.max(1, bb1 - bb0 + 1);

    const totalFrames = Math.max(1, Math.floor((spectra.length || 0) / bins));
    const f0 = timeToFrame(t0, fps, totalFrames);
    const f1 = timeToFrame(t1, fps, totalFrames);
    let ff0 = Math.min(f0, f1), ff1 = Math.max(f0, f1);
    const padFrames = 1;
    ff0 = Math.max(0, ff0 - padFrames);
    ff1 = Math.min(totalFrames - 1, ff1 + padFrames);
    const w = Math.max(1, ff1 - ff0 + 1);

    const out = new Float32Array(h * w);
    for (let x = 0; x < w; x++){
      const frameIdx = ff0 + x;
      const base = frameIdx * bins;
      for (let y = 0; y < h; y++){
        const binIdx = bb0 + y;
        out[y * w + x] = spectra[base + binIdx] || 0;
      }
    }
    return { data: out, width: w, height: h, frameStart: ff0, frameEnd: ff1, binStart: bb0, binEnd: bb1 };
  }

  // Simple resize (bilinear-like along independent axes)
  function resize2D(arr, w, h, newW, newH) {
    if (newW === w && newH === h) return { data: arr.slice(0), width: w, height: h };
    const out = new Float32Array(newW * newH);
    const sx = (w - 1) / Math.max(1, (newW - 1));
    const sy = (h - 1) / Math.max(1, (newH - 1));
    for (let yy = 0; yy < newH; yy++){
      const srcY = yy * sy;
      const y0 = Math.floor(srcY), y1 = Math.min(h - 1, y0 + 1);
      const wy = srcY - y0;
      for (let xx = 0; xx < newW; xx++){
        const srcX = xx * sx;
        const x0 = Math.floor(srcX), x1 = Math.min(w - 1, x0 + 1);
        const wx = srcX - x0;
        const a = arr[y0 * w + x0];
        const b = arr[y0 * w + x1];
        const c = arr[y1 * w + x0];
        const d = arr[y1 * w + x1];
        const top = a + (b - a) * wx;
        const bot = c + (d - c) * wx;
        out[yy * newW + xx] = top + (bot - top) * wy;
      }
    }
    return { data: out, width: newW, height: newH };
  }

  function downsample2D(arr, w, h, strideX, strideY) {
    const sX = Math.max(1, Math.floor(strideX || 1));
    const sY = Math.max(1, Math.floor(strideY || 1));
    const newW = Math.max(1, Math.floor((w + sX - 1) / sX));
    const newH = Math.max(1, Math.floor((h + sY - 1) / sY));
    const out = new Float32Array(newW * newH);
    for (let yy = 0; yy < newH; yy++){
      const y0 = yy * sY;
      const y1 = Math.min(h, y0 + sY);
      for (let xx = 0; xx < newW; xx++){
        const x0 = xx * sX;
        const x1 = Math.min(w, x0 + sX);
        let sum = 0; let cnt = 0;
        for (let y = y0; y < y1; y++){
          let off = y * w + x0;
          for (let x = x0; x < x1; x++) { sum += arr[off++] || 0; cnt++; }
        }
        out[yy * newW + xx] = cnt ? (sum / cnt) : 0;
      }
    }
    return { data: out, width: newW, height: newH, strideX: sX, strideY: sY };
  }

  function meanStd(arr) {
    const n = arr.length || 1;
    let sum = 0, sum2 = 0;
    for (let i = 0; i < n; i++){ const v = arr[i]; sum += v; sum2 += v * v; }
    const mu = sum / n;
    const varr = Math.max(0, (sum2 / n) - mu * mu);
    const sd = Math.sqrt(varr + 1e-12);
    return { mean: mu, std: sd };
  }

  function zeroMeanUnit(arr) {
    const out = new Float32Array(arr.length);
    const s = meanStd(arr);
    for (let i = 0; i < arr.length; i++) out[i] = (arr[i] - s.mean) / (s.std || 1e-6);
    return { data: out, stat: s };
  }

  // Exact NCC on a same-size image patch vs template (both in full resolution), returns [-1,1]
  function nccScorePatch(img, iw, ih, x0, y0, tw, th, templ) {
    if (x0 < 0 || y0 < 0 || x0 + tw > iw || y0 + th > ih) return -1;
    const n = tw * th;
    let sumI = 0, sumI2 = 0, sumT = 0, sumT2 = 0, sumIT = 0;
    for (let yy = 0; yy < th; yy++) {
      const iOff = (y0 + yy) * iw + x0;
      const tOff = yy * tw;
      for (let xx = 0; xx < tw; xx++) {
        const I = img[iOff + xx];
        const T = templ[tOff + xx];
        sumI += I; sumI2 += I * I;
        sumT += T; sumT2 += T * T;
        sumIT += I * T;
      }
    }
    const muI = sumI / n;
    const muT = sumT / n;
    const sI2 = Math.max(0, sumI2 / n - muI * muI);
    const sT2 = Math.max(0, sumT2 / n - muT * muT);
    const sI = Math.sqrt(sI2);
    const sT = Math.sqrt(sT2);
    if (sI < 1e-4 || sT < 1e-4) return -1; // too flat, unreliable
    const num = sumIT / n - muI * muT;
    return clamp(num / (sI * sT), -1, 1);
  }

  // Integral image helpers (prefix sum and prefix sum squares)
  function integralImage(arr, w, h) {
    const S = new Float64Array((w + 1) * (h + 1));
    for (let y = 1; y <= h; y++){
      let rowSum = 0;
      for (let x = 1; x <= w; x++){
        const v = arr[(y - 1) * w + (x - 1)] || 0;
        rowSum += v;
        const idx = y * (w + 1) + x;
        S[idx] = S[(y - 1) * (w + 1) + x] + rowSum;
      }
    }
    return { data: S, width: w + 1, height: h + 1 };
  }
  function rectSum(S, w1, h1, x, y, rw, rh) {
    // S is (w1 x h1) prefix array, arr was (w x h); x,y 1-based offset inside S
    const x2 = x + rw;
    const y2 = y + rh;
    const A = S[y * w1 + x];
    const B = S[y * w1 + x2];
    const C = S[y2 * w1 + x];
    const D = S[y2 * w1 + x2];
    return D - B - C + A;
  }

  // NCC: normalized cross-correlation (zero-mean) using integral images for patch mean/std and naive dot for sum(I*T)
  // Optional precomputed integrals (precomputed = { S, S2 }) avoid recomputing them per call.
  async function nccMap(image, iw, ih, templZ, tw, th, yieldEvery = 2000, precomputed) {
    const outW = Math.max(1, iw - tw + 1);
    const outH = Math.max(1, ih - th + 1);
    const out = new Float32Array(outW * outH);

    let S, S2;
    if (precomputed && precomputed.S && precomputed.S2 && precomputed.S.width === (iw + 1)) {
      S = precomputed.S;
      S2 = precomputed.S2;
    } else {
      S = integralImage(image, iw, ih);
      const imageSq = new Float32Array(iw * ih);
      for (let i = 0; i < image.length; i++) { const v = image[i]; imageSq[i] = v * v; }
      S2 = integralImage(imageSq, iw, ih);
    }

    const templStat = meanStd(templZ); // templZ is already zero-mean if from zeroMeanUnit, but compute std for safety
    const tStd = Math.max(templStat.std, 1e-6);
    const n = tw * th;

    let iter = 0;
    for (let y = 0; y < outH; y++){
      const sy = y + 1;
      for (let x = 0; x < outW; x++){
        const sx = x + 1;
        const sumI = rectSum(S.data, S.width, S.height, sx, sy, tw, th);
        const sumI2 = rectSum(S2.data, S2.width, S2.height, sx, sy, tw, th);
        const muI = sumI / n;
        const varI = Math.max(0, sumI2 / n - muI * muI);
        const sI = Math.sqrt(varI + 1e-12);
        // dot(I - muI, Tz)
        let dot = 0;
        for (let yy = 0; yy < th; yy++){
          const iOff = (y + yy) * iw + x;
          const tOff = yy * tw;
          for (let xx = 0; xx < tw; xx++){
            dot += (image[iOff + xx] - muI) * templZ[tOff + xx];
          }
        }
        const denom = (sI * tStd * n) || 1e-9;
        const score = clamp(dot / denom, -1, 1);
        out[y * outW + x] = score;

        iter++;
        if ((iter % yieldEvery) === 0) await new Promise(r => setTimeout(r, 0));
      }
    }
    return { data: out, width: outW, height: outH };
  }

  // Peak picking with guard bands; deterministic ordering (score desc, then x asc, then y asc)
  function pickPeaks(corr, cw, ch, threshold, guardX, guardY, maxPeaks = 10000) {
    const peaks = [];
    for (let y = 0; y < ch; y++){
      for (let x = 0; x < cw; x++){
        const s = corr[y * cw + x];
        if (s < threshold) continue;
        peaks.push({ x, y, s });
      }
    }
    peaks.sort((a,b) => (b.s - a.s) || (a.x - b.x) || (a.y - b.y));
    const out = [];
    const taken = new Uint8Array(cw * ch);
    const gx = Math.max(1, Math.floor(guardX));
    const gy = Math.max(1, Math.floor(guardY));
    for (const p of peaks) {
      let suppressed = false;
      for (let yy = Math.max(0, p.y - gy); yy <= Math.min(ch - 1, p.y + gy) && !suppressed; yy++){
        for (let xx = Math.max(0, p.x - gx); xx <= Math.min(cw - 1, p.x + gx); xx++){
          if (taken[yy * cw + xx]) { suppressed = true; break; }
        }
      }
      if (suppressed) continue;
      out.push(p);
      // mark guard area
      for (let yy = Math.max(0, p.y - gy); yy <= Math.min(ch - 1, p.y + gy); yy++){
        for (let xx = Math.max(0, p.x - gx); xx <= Math.min(cw - 1, p.x + gx); xx++){
          taken[yy * cw + xx] = 1;
        }
      }
      if (out.length >= maxPeaks) break;
    }
    return out;
  }

  function iouRect(a, b) {
    const x1 = Math.max(a.t1, b.t1);
    const y1 = Math.max(a.f1, b.f1);
    const x2 = Math.min(a.t2, b.t2);
    const y2 = Math.min(a.f2, b.f2);
    const iw = Math.max(0, x2 - x1);
    const ih = Math.max(0, y2 - y1);
    const inter = iw * ih;
    const areaA = Math.max(0, (a.t2 - a.t1)) * Math.max(0, (a.f2 - a.f1));
    const areaB = Math.max(0, (b.t2 - b.t1)) * Math.max(0, (b.f2 - b.f1));
    const uni = Math.max(1e-12, areaA + areaB - inter);
    return inter / uni;
  }

  function nms(boxes, iouThresh = 0.3) {
    // boxes sorted by score desc prior to call
    const kept = [];
    for (const b of boxes) {
      let mergedInto = null;
      for (const k of kept) {
        if (iouRect(b, k) > iouThresh) {
          // keep highest score (already in kept), but merge contributing template IDs
          try {
            const a = new Set(k.templateIds || []);
            (b.templateIds || []).forEach(id => a.add(id));
            k.templateIds = Array.from(a);
          } catch (e) {}
          mergedInto = k;
          break;
        }
      }
      if (!mergedInto) kept.push(b);
    }
    return kept;
  }

  function parseBandMask(str) {
    // format: "0-200, 4000-5000" (Hz)
    if (!str) return [];
    return String(str).split(',').map(s => s.trim()).map(tok => {
      const m = tok.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
      if (!m) return null;
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (!isFinite(a) || !isFinite(b)) return null;
      return { f1: Math.min(a,b), f2: Math.max(a,b) };
    }).filter(Boolean);
  }

  function intersectsBandMask(f1, f2, mask) {
    if (!Array.isArray(mask) || !mask.length) return false;
    for (const r of mask) {
      const lo = Math.max(f1, r.f1);
      const hi = Math.min(f2, r.f2);
      if (hi > lo) return true;
    }
    return false;
  }

  function buildModal() {
    if (document.getElementById(MODAL_ID)) return document.getElementById(MODAL_ID);
    if (!document.getElementById(STYLE_ID)) {
  const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = `
#${MODAL_ID} { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; z-index: 2147483600; background: rgba(0,0,0,0.45); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);} 
  #${MODAL_ID} .card { position: relative; width: 96%; max-width: 760px; max-height: 90vh; overflow: auto; background: #0f1216; color: #fff; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 12px 36px rgba(0,0,0,0.35); padding: 14px; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; }
  #${MODAL_ID} h3 { margin: 4px 0 10px 0; font-size: 16px; font-weight: 600; }
  #${MODAL_ID} .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: start; }
  /* Each .row is a horizontal label+control pair so the form appears as two compact columns */
  #${MODAL_ID} .row { display: flex; flex-direction: row; align-items: center; gap: 8px; padding: 6px 0; }
  #${MODAL_ID} label { font-size: 12px; color: #cbd5e1; margin: 0; display: inline-block; flex: 0 0 36%; min-width: 110px; }
  /* controls occupy remaining space but are capped to avoid overly wide inputs */
  #${MODAL_ID} input[type="number"], #${MODAL_ID} input[type="text"], #${MODAL_ID} select {
    flex: 1 1 160px; max-width: 260px; box-sizing: border-box; background: #0b0e12; color: #fff; border: 1px solid #1f2937; border-radius: 6px; padding: 6px 8px; font-size: 13px;
  }
  #${MODAL_ID} input[type="number"]::-webkit-outer-spin-button, #${MODAL_ID} input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  /* Mobile: stack label above control and use full width */
  @media (max-width: 640px) { 
    #${MODAL_ID} .grid { grid-template-columns: 1fr; }
    #${MODAL_ID} .row { flex-direction: column; align-items: stretch; }
    #${MODAL_ID} label { flex: 0 0 auto; min-width: 0; margin-bottom: 6px; }
    #${MODAL_ID} input[type="number"], #${MODAL_ID} input[type="text"], #${MODAL_ID} select { max-width: 100%; }
  }
  #${MODAL_ID} .actions { margin-top: 12px; display: flex; gap: 10px; justify-content: flex-end; }
  #${MODAL_ID} .btn { background: #2196F3; color: #fff; border: none; border-radius: 6px; padding: 8px 12px; font-size: 13px; cursor: pointer; }
  #${MODAL_ID} .btn[disabled] { opacity: 0.6; cursor: not-allowed; }
  #${MODAL_ID} .progress { margin-top: 6px; font-size: 12px; color: #9ca3af; }
  @media (max-width: 640px) { #${MODAL_ID} .grid { grid-template-columns: 1fr; } }
        `;
        document.head.appendChild(st);
      }

    const wrap = document.createElement('div');
    wrap.id = MODAL_ID;
    wrap.innerHTML = `
      <div class="card" role="dialog" aria-modal="true" aria-label="Run SCC options">
        <h3>Run Spectrogram Cross-Correlation (SCC)</h3>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div style="font-size:13px;color:#cbd5e1;font-weight:600">Search SCC parameters</div>
          <div>
            <button id="scc-scan" class="btn" style="background:#10b981;padding:6px 10px;font-size:13px;">Search SCC parameters</button>
            <button id="scc-stop" class="btn" style="background:#ef4444;padding:6px 10px;font-size:13px;display:none;margin-left:6px;">Stop</button>
          </div>
        </div>

  <div style="margin-bottom:8px;color:#f1f5f9;font-size:13px">Note: Auto annotations may not be accurate. Please review the results carefully and do the necessary edits.</div>

        <div class="grid">
          <div class="row">
            <label for="scc-mindur">Min duration (ms)</label>
            <input id="scc-mindur" type="number" min="0" max="10000" step="10" value="50">
          </div>
          <div class="row">
            <label for="scc-minfreq">Frequency include: Min (Hz)</label>
            <input id="scc-minfreq" type="number" min="0" step="1" value="0">
          </div>
          <div class="row">
            <label for="scc-maxfreq">Frequency include: Max (Hz)</label>
            <input id="scc-maxfreq" type="number" min="0" step="1" value="22050">
          </div>
        </div>
  <div class="progress" id="scc-progress" aria-live="polite"></div>
  <div id="scc-presets-area" style="margin-top:8px;margin-bottom:8px;display:none;background:#071018;padding:8px;border-radius:6px;border:1px solid rgba(255,255,255,0.03)"></div>
  <div class="actions" style="align-items:center;">
          <label id="scc-merge-label" title="This combines the annotations with distance less than the input duration." style="display:flex;align-items:center;gap:8px;margin-right:auto;font-size:13px;color:#cbd5e1;white-space:nowrap">
            <input type="checkbox" id="scc-merge" />
            <span>Merge detections below</span>
            <input id="scc-merge-gap" type="number" min="0" max="10" step="0.1" value="1.0" style="width:68px;background:#0b1523;border:1px solid rgba(255,255,255,0.08);color:#e5e7eb;padding:4px 6px;border-radius:4px"> 
            <span>sec apart</span>
          </label>
        </div>
        <!-- top-right standard close button (X) -->
        <button id="scc-close-x" aria-label="Close" title="Close" style="position:absolute;top:10px;right:12px;background:transparent;border:none;color:#9ca3af;font-size:20px;line-height:1;cursor:pointer;padding:6px;border-radius:6px">&times;</button>
      </div>`;
    document.body.appendChild(wrap);
    return wrap;
  }

  function showModal() { const m = buildModal(); m.style.display = 'flex'; return m; }
  function hideModal() { const m = document.getElementById(MODAL_ID); if (m) m.style.display = 'none'; }
  // prevent background scrolling when modal is open
  const __bodyOverflowBackup = { val: null };
  // modal scroll interception handlers (prevent background scroll while modal open)
  const __scc_modal_handlers = { wheel: null, touch: null };
  // last scan state (keeps preset scan results and last selected preset index)
  let __scc_lastScanRows = null;
  let __scc_lastSelectedPresetIndex = null;
  // active scan abort token (used to cancel long-running preset scans)
  let __scc_currentScan = null;
  // run counter for labeling runs (used to prefix notes)
  let __scc_runCounter = 0;
  function _showModal() {
    const m = showModal();
    __bodyOverflowBackup.val = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // add capturing handlers to stop scroll events from reaching background when the event target is outside the modal card
    try {
      const wheelHandler = function (ev) {
        try {
          const modal = document.getElementById(MODAL_ID);
          if (!modal) return;
          const card = modal.querySelector('.card');
          if (!card) return;
          // If the wheel target is outside the card, always prevent background scroll
          if (!card.contains(ev.target)) { ev.preventDefault(); ev.stopPropagation(); return; }

          // If the wheel target is inside the card, allow the scroll only if some ancestor
          // inside the card can actually scroll in the wheel direction. Otherwise prevent it
          // so the page behind doesn't move when card content is already at its limit.
          let node = ev.target;
          let allow = false;
          const deltaY = ev.deltaY || 0;
          while (node && node !== card) {
            try {
              const style = window.getComputedStyle(node);
              const overflowY = style.overflowY;
              const canScroll = (overflowY === 'auto' || overflowY === 'scroll');
              if (canScroll) {
                const st = node.scrollTop || 0;
                const sh = node.scrollHeight || 0;
                const ch = node.clientHeight || 0;
                if (deltaY < 0 && st > 0) { allow = true; break; }
                if (deltaY > 0 && (st + ch) < sh) { allow = true; break; }
              }
            } catch (e) {}
            node = node.parentElement;
          }
          if (!allow) { ev.preventDefault(); ev.stopPropagation(); }
        } catch (e) {}
      };
      const touchHandler = function (ev) {
        try {
          const modal = document.getElementById(MODAL_ID);
          if (!modal) return;
          const card = modal.querySelector('.card');
          if (!card) return;
          if (!card.contains(ev.target)) { ev.preventDefault(); ev.stopPropagation(); }
        } catch (e) {}
      };
      __scc_modal_handlers.wheel = wheelHandler;
      __scc_modal_handlers.touch = touchHandler;
      document.addEventListener('wheel', wheelHandler, { passive: false, capture: true });
      document.addEventListener('touchmove', touchHandler, { passive: false, capture: true });
    } catch (e) {}
    return m;
  }
  function _hideModal() {
    const m = document.getElementById(MODAL_ID);
    if (m) m.style.display = 'none';
    // cancel any ongoing preset scan when modal is closed
    try { if (__scc_currentScan) __scc_currentScan.cancelled = true; } catch (e) {}
    document.body.style.overflow = __bodyOverflowBackup.val || '';
    try {
      if (__scc_modal_handlers.wheel) {
        document.removeEventListener('wheel', __scc_modal_handlers.wheel, { capture: true });
        __scc_modal_handlers.wheel = null;
      }
      if (__scc_modal_handlers.touch) {
        document.removeEventListener('touchmove', __scc_modal_handlers.touch, { capture: true });
        __scc_modal_handlers.touch = null;
      }
    } catch (e) {}
    // If the UI is currently in 'create' mode, switch to 'edit' after closing SCC modal
    try {
      const wrap = document.getElementById('createEditToggle');
      if (wrap && String(wrap.dataset.mode || '').toLowerCase() === 'create') {
        wrap.dispatchEvent(new CustomEvent('mode-change', { detail: { mode: 'edit' }, bubbles: true }));
      }
    } catch (e) {}
  }
  function setProgress(txt){ const el = document.getElementById('scc-progress'); if (el) el.textContent = String(txt || ''); }
  function setDisabled(dis){ const run = document.getElementById('scc-run'); const cancel = document.getElementById('scc-cancel'); if (run) run.disabled = !!dis; if (cancel) cancel.disabled = !!dis; }

  function computeQualityStrides(quality){
    switch(String(quality||'balanced')){
      case 'fast': return { sx: 3, sy: 3 };
      case 'accurate': return { sx: 1, sy: 1 };
      default: return { sx: 2, sy: 2 };
    }
  }

  // Lightweight detection helper usable for trial runs (returns counts and candidate list)
  async function detectCandidatesForParams(meta, extractSearch, templatesToUse, localOpts, allowLowVar, abortToken) {
    const tStart = Date.now();
    const found = [];
    let coarse = 0, rawc = 0;
    let variantsTried = 0, skippedLowVar = 0, skippedTooLarge = 0;
    const qualityStrides = computeQualityStrides(localOpts.quality);
    // Force a coarse downsample for scanning to bound runtime even when quality='accurate'
    const coarseSX = Math.max(1, Number(localOpts.coarseSX) || Math.max(2, qualityStrides.sx));
    const coarseSY = Math.max(1, Number(localOpts.coarseSY) || Math.max(2, qualityStrides.sy));
    const localSearch = downsample2D(extractSearch.data, extractSearch.width, extractSearch.height, coarseSX, coarseSY);
    // Precompute integrals for localSearch so template variants reuse them
    const __precomp = (function(){
      try {
        const imageSq = new Float32Array(localSearch.data.length);
        for (let i = 0; i < localSearch.data.length; i++) { const v = localSearch.data[i]; imageSq[i] = v * v; }
        const S = integralImage(localSearch.data, localSearch.width, localSearch.height);
        const S2 = integralImage(imageSq, localSearch.width, localSearch.height);
        return { S, S2 };
      } catch(e) { return null; }
    })();
    const localEnergyThresh = percentile(localSearch.data, localOpts.energyPct);
    const localPitchScales = buildScales(localOpts.pitchTolPct, localOpts.pitchSteps);
    const localTimeScales = buildScales(localOpts.timeTolPct, localOpts.timeSteps);

    for (let ti = 0; ti < templatesToUse.length; ti++){
      if (abortToken && abortToken.cancelled) {
        const elapsedMs = Date.now() - tStart;
        return { detections: found, coarsePeaks: coarse, rawCandidates: rawc, variantsTried, skippedLowVar, skippedTooLarge, elapsedMs, aborted: true };
      }
      const Tbase = templatesToUse[ti];
      for (let ps = 0; ps < localPitchScales.length; ps++){
        for (let ts = 0; ts < localTimeScales.length; ts++){
          if (abortToken && abortToken.cancelled) {
            const elapsedMs = Date.now() - tStart;
            return { detections: found, coarsePeaks: coarse, rawCandidates: rawc, variantsTried, skippedLowVar, skippedTooLarge, elapsedMs, aborted: true };
          }
          const sF = localPitchScales[ps];
          const sT = localTimeScales[ts];
          const newH = Math.max(3, Math.round(Tbase.height * sF));
          const newW = Math.max(3, Math.round(Tbase.width * sT));
          const Tscaled = resize2D(Tbase.data, Tbase.width, Tbase.height, newW, newH);
          const preStat = meanStd(Tscaled.data);
          variantsTried++;
          // During trial scans we may want to avoid rejecting low-variance variants so the
          // user can see counts based purely on other parameters. Only enforce the
          // low-variance skip when allowLowVar is false.
          if (!allowLowVar) {
            const varThresh = 1e-3;
            if (preStat.std < varThresh) { skippedLowVar++; continue; }
          }
          const Tds = downsample2D(Tscaled.data, Tscaled.width, Tscaled.height, coarseSX, coarseSY);
          if (localSearch.width < Tds.width || localSearch.height < Tds.height) { skippedTooLarge++; continue; }
          const Tnorm = zeroMeanUnit(Tds.data);
          const TfullZ = zeroMeanUnit(Tscaled.data);

          // NCC over downsampled search image
          const corr = await nccMap(localSearch.data, localSearch.width, localSearch.height, Tnorm.data, Tds.width, Tds.height, 2000, __precomp);

          // Peak picking
          const guardX = Math.max(2, Math.floor(Tds.width * 0.9));
          const guardY = Math.max(2, Math.floor(Tds.height * 0.7));
          // Allow a preset-configurable cap on how many coarse peaks to consider for refinement.
          // This prevents extremely large peak lists from causing long-running fine NCC passes.
          const maxPeaks = (localOpts && Number(localOpts.maxCandidates)) ? Math.max(1, Number(localOpts.maxCandidates)) : 50000;
          // Non-negative coarse threshold prunes weak matches early (default 0)
          const coarseThresh = (typeof localOpts.coarseThresh === 'number') ? Math.max(-1, Math.min(1, localOpts.coarseThresh)) : 0;
          const peaks = pickPeaks(corr.data, corr.width, corr.height, coarseThresh, guardX, guardY, maxPeaks);
          coarse += peaks.length;

          // refine only the top-N peaks to avoid expensive full-resolution NCC on every coarse peak
          // peaks is already sorted by coarse score desc from pickPeaks; choose topN based on localOpts.maxRefine
          const defaultRefineCount = Math.max(200, Math.floor(peaks.length * 0.05)); // at least 200 or 5%
          const maxRefine = (localOpts && Number(localOpts.maxRefine)) ? Math.max(1, Number(localOpts.maxRefine)) : Math.min(peaks.length, defaultRefineCount);
          for (let pi = 0; pi < peaks.length && pi < maxRefine; pi++) {
            const p = peaks[pi];
            const x_ds = p.x; const y_ds = p.y;
            const w_ds = Tds.width; const h_ds = Tds.height;
            const x0_img = x_ds * coarseSX;
            const y0_img = y_ds * coarseSY;

            const frameStart = extractSearch.frameStart + x0_img;
            const frameEnd = frameStart + (w_ds * coarseSX) - 1;
            const binStart = extractSearch.binStart + y0_img;
            const binEnd = binStart + (h_ds * coarseSY) - 1;

            const tStart = frameStart / Math.max(1e-9, meta.framesPerSec);
            const tEnd = (frameEnd + 1) / Math.max(1e-9, meta.framesPerSec);
            const nyq = meta.sampleRate / 2;
            const fLow = (binStart / Math.max(1, meta.bins - 1)) * nyq;
            const fHigh = (binEnd / Math.max(1, meta.bins - 1)) * nyq;

            const durMs = Math.max(0, (tEnd - tStart) * 1000);
            if (durMs < localOpts.minDurMs) continue;
            // frequency include range: skip if outside
            if (typeof localOpts.minFreq === 'number' && typeof localOpts.maxFreq === 'number') {
              if (fHigh < localOpts.minFreq || fLow > localOpts.maxFreq) continue;
            }

            // Energy filter
            let eSum = 0, eCount = 0;
            for (let yy = 0; yy < h_ds; yy++){
              const imgOff = (y_ds + yy) * localSearch.width + x_ds;
              for (let xx = 0; xx < w_ds; xx++){ eSum += localSearch.data[imgOff + xx] || 0; eCount++; }
            }
            const eMean = eSum / Math.max(1, eCount);
            if (eMean < localEnergyThresh) continue;

            const fineScore = nccScorePatch(
              extractSearch.data,
              extractSearch.width,
              extractSearch.height,
              x0_img,
              y0_img,
              Tscaled.width,
              Tscaled.height,
              TfullZ.data
            );
            if (!(fineScore > -0.999)) continue;

            rawc++;
            found.push({ t1: tStart, t2: tEnd, f1: fLow, f2: fHigh, score: fineScore, variant: { pitchScale: sF, timeScale: sT }, templateIds: Tbase.srcIdList.slice() });
          }
          await new Promise(r => setTimeout(r, 0));
          if (abortToken && abortToken.cancelled) {
            const elapsedMs = Date.now() - tStart;
            return { detections: found, coarsePeaks: coarse, rawCandidates: rawc, variantsTried, skippedLowVar, skippedTooLarge, elapsedMs, aborted: true };
          }
        }
      }
    }
    const elapsedMs = Date.now() - tStart;
    return { detections: found, coarsePeaks: coarse, rawCandidates: rawc, variantsTried, skippedLowVar, skippedTooLarge, elapsedMs };
  }

  function buildScales(tolPct, stepsOdd){
    const tol = Math.max(0, Number(tolPct)||0) / 100;
    let steps = Math.max(1, Math.min(11, Math.round(Number(stepsOdd)||1)));
    if ((steps % 2) === 0) steps += 1; // force odd
    if (steps <= 1 || tol <= 0) return [1.0];
    const half = (steps - 1) / 2;
    const arr = [];
    for (let i = -half; i <= half; i++) { arr.push(1.0 + (i * tol / half)); }
    return arr;
  }

  function composeTemplates(templates, mode){
    if (!templates.length || mode === 'none') return null;
    const ref = templates[0];
    const tw = ref.width, th = ref.height;
    const mats = templates.map(t => (t.width === tw && t.height === th) ? t.data : resize2D(t.data, t.width, t.height, tw, th).data);
    const out = new Float32Array(tw * th);
    if (mode === 'mean') {
      for (let i = 0; i < out.length; i++){
        let s = 0; for (let k = 0; k < mats.length; k++) s += mats[k][i];
        out[i] = s / mats.length;
      }
    } else {
      const tmp = new Float32Array(mats.length);
      for (let i = 0; i < out.length; i++){
        for (let k = 0; k < mats.length; k++) tmp[k] = mats[k][i];
        // median
        const arr = Array.from(tmp).sort((a,b)=>a-b);
        out[i] = arr[Math.floor(arr.length/2)];
      }
    }
    return { data: out, width: tw, height: th };
  }

  function percentile(arr, p){
    if (!arr.length) return 0;
    const a = Array.from(arr).sort((x,y)=>x-y);
    const idx = clamp(Math.floor((p/100) * (a.length-1)), 0, a.length-1);
    return a[idx];
  }

  // Small UI: create a circular 5-segment overlay to show preset scan progress
  function createScanOverlay(parentEl, totalSegments) {
    try {
      if (!parentEl) return null;
      const wrap = document.createElement('div');
      wrap.className = 'scc-scan-overlay';
      wrap.style.position = 'absolute';
      wrap.style.inset = '0';
      wrap.style.display = 'flex';
      wrap.style.alignItems = 'center';
      wrap.style.justifyContent = 'center';
      wrap.style.pointerEvents = 'none';

  const box = document.createElement('div');
  box.className = 'scc-scan-box';
  box.style.pointerEvents = 'auto';
  // make a horizontal rectangle: spinner left, logo+text right
  box.style.width = '460px';
  box.style.height = '120px';
  box.style.display = 'flex';
  box.style.flexDirection = 'row';
  box.style.alignItems = 'center';
  box.style.justifyContent = 'flex-start';
  box.style.background = 'rgba(6,8,10,0.80)';
  box.style.borderRadius = '10px';
  box.style.padding = '12px 14px';
  box.style.gap = '8px';

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  // smaller circular spinner on the left
  svg.setAttribute('width','96'); svg.setAttribute('height','96'); svg.setAttribute('viewBox','0 0 96 96');

  const cx = 48, cy = 48, rOut = 42, rIn = 28;
      const segs = [];
      function wedgePath(a0, a1) {
        const large = (a1 - a0) > Math.PI ? 1 : 0;
        const x0 = cx + rOut * Math.cos(a0);
        const y0 = cy + rOut * Math.sin(a0);
        const x1 = cx + rOut * Math.cos(a1);
        const y1 = cy + rOut * Math.sin(a1);
        const xi1 = cx + rIn * Math.cos(a1);
        const yi1 = cy + rIn * Math.sin(a1);
        const xi0 = cx + rIn * Math.cos(a0);
        const yi0 = cy + rIn * Math.sin(a0);
        return `M ${x0} ${y0} A ${rOut} ${rOut} 0 ${large} 1 ${x1} ${y1} L ${xi1} ${yi1} A ${rIn} ${rIn} 0 ${large} 0 ${xi0} ${yi0} Z`;
      }

      for (let i = 0; i < Math.max(1, totalSegments || 5); i++) {
        const a0 = (i/totalSegments) * Math.PI * 2 - Math.PI/2;
        const a1 = ((i+1)/totalSegments) * Math.PI * 2 - Math.PI/2;
        const p = document.createElementNS(svgNS,'path');
        p.setAttribute('d', wedgePath(a0,a1));
        p.setAttribute('fill','#334155');
        p.setAttribute('stroke','rgba(255,255,255,0.03)');
        p.style.transition = 'fill 180ms linear';
        p.dataset.idx = String(i);
        svg.appendChild(p);
        segs.push(p);
      }

      const inner = document.createElementNS(svgNS,'circle');
      inner.setAttribute('cx',String(cx)); inner.setAttribute('cy',String(cy)); inner.setAttribute('r',String(rIn-6));
      inner.setAttribute('fill','#071018');
      svg.appendChild(inner);

      // Left column: spinner with status below it
      const leftCol = document.createElement('div');
      leftCol.style.display = 'flex';
      leftCol.style.flexDirection = 'column';
      leftCol.style.alignItems = 'center';
      leftCol.style.justifyContent = 'center';
      leftCol.style.gap = '6px';
      leftCol.style.flex = '0 0 auto';

      const statusLabel = document.createElement('div');
      statusLabel.className = 'scc-scan-label';
      statusLabel.style.color = '#cbd5e1';
      statusLabel.style.fontSize = '13px';
      statusLabel.style.textAlign = 'center';
      statusLabel.textContent = `Scanning 0 / ${totalSegments}`;

      leftCol.appendChild(svg);
      leftCol.appendChild(statusLabel);

      // Right column: logo only (closer to spinner)
      const rightCol = document.createElement('div');
      rightCol.style.display = 'flex';
      rightCol.style.flexDirection = 'column';
      rightCol.style.alignItems = 'center';
      rightCol.style.justifyContent = 'center';
      rightCol.style.gap = '6px';
      rightCol.style.flex = '0 0 auto';
      rightCol.style.minWidth = '80px';

      // Add branding logo into the right column (non-interactive)
      try {
        const logoImg = document.createElement('img');
        logoImg.className = 'scc-scan-logo';
        logoImg.src = '001Logo%26name.png';
        logoImg.alt = 'Logo';
        logoImg.style.pointerEvents = 'none';
        logoImg.style.display = 'block';
        logoImg.style.margin = '0 auto';
        rightCol.appendChild(logoImg);
      } catch (e) {}

      // Append left and right columns
      box.appendChild(leftCol);
      box.appendChild(rightCol);
      wrap.appendChild(box);

      // attach overlay to parent (position parent relative if needed)
      try {
        const st = window.getComputedStyle(parentEl);
        if (st.position === 'static' || !st.position) parentEl.style.position = 'relative';
      } catch (e) {}
      parentEl.appendChild(wrap);

      return {
        markDone(i) { try { if (segs[i]) segs[i].setAttribute('fill','#10b981'); statusLabel.textContent = `Scanning ${i+1} / ${segs.length}`;} catch (e) {} },
        setStatus(txt) { try { statusLabel.textContent = String(txt||''); } catch (e) {} },
        hide() { try { wrap.remove(); } catch (e) {} }
      };
    } catch (e) { return null; }
  }

  function nextIdFromGrid(){
    try {
      const data = window.annotationGrid.getData();
      if (!data || !data.length) return 1;
      return Math.max(...data.map(r => Number(r.id)||0)) + 1;
    } catch (e) { return 1; }
  }

  async function runSccWithOptions(opts){
    const sel = getGridSelectedTemplates();
    if (!sel.length) { alert('Select one or more template rows in the grid first.'); return; }

    const meta = getSpectroMeta();
    if (!meta.spectra || !meta.bins || !meta.framesPerSec) { alert('Spectrogram not ready. Generate it first.'); return; }

  // Pause playback safely before heavy SCC work to avoid overlays/audio conflicts
  try { await safePausePlayback(1000); } catch (e) {}
  setDisabled(true);
  // show wait overlay for long runs
  try { window.__spectroWait && window.__spectroWait.show({ etaText: 'Running SCC...' }); } catch (e) {}
  // yield briefly so the overlay can paint before heavy synchronous work begins
  try { await new Promise(r => setTimeout(r, 50)); } catch (e) {}
  // assign a run number for this invocation
  const runNumber = (++__scc_runCounter);
  // instrumentation counters
    let totalCoarsePeaks = 0;
    let totalRawCandidates = 0;

    // Build template matrices from selections
    const templates = sel.map(r => extractTemplate2D(
      meta.spectra, meta.bins, meta.framesPerSec, meta.sampleRate,
      Number(r.beginTime)||0, Number(r.endTime)||0, Number(r.lowFreq)||0, Number(r.highFreq)||0
    ));

    

  let runResult = { added: 0, raw: 0, coarse: 0, dedup: 0 };
  try {

    // Optionally composite
    let composite = null;
    if (opts.composite !== 'none' && templates.length >= 1) {
      composite = composeTemplates(templates, opts.composite);
    }

  // Build search image = frequency include range. Use user-provided minFreq/maxFreq if present,
  // otherwise default to templates range +/-100Hz.
  const tplMin = Math.max(0, Math.min(...sel.map(r => Number(r.lowFreq)||0)));
  const tplMax = Math.max(...sel.map(r => Number(r.highFreq)||0));
  const f1Search = (typeof opts.minFreq === 'number' && !isNaN(opts.minFreq)) ? Math.max(0, opts.minFreq) : Math.max(0, tplMin - 100);
  const f2Search = (typeof opts.maxFreq === 'number' && !isNaN(opts.maxFreq)) ? Math.min(meta.sampleRate/2, opts.maxFreq) : Math.min(meta.sampleRate/2, tplMax + 100);

  const fullDuration = (typeof globalThis._spectroDuration === 'number' && isFinite(globalThis._spectroDuration)) ? globalThis._spectroDuration : Math.max(...sel.map(r => Number(r.endTime)||0));
  const extractSearch = extractTemplate2D(meta.spectra, meta.bins, meta.framesPerSec, meta.sampleRate, 0, fullDuration, f1Search, f2Search);

    // Downsample according to quality
    const strides = computeQualityStrides(opts.quality);
    const searchDS = downsample2D(extractSearch.data, extractSearch.width, extractSearch.height, strides.sx, strides.sy);
  // debug logs removed

  // Energy floor precompute over search image (mean magnitude per patch approximately via direct values)
  const energyVals = searchDS.data; // approximate energy with magnitudes
  const energyThresh = percentile(energyVals, opts.energyPct);
  // debug logs removed

    // Build template variants
    const pitchScales = buildScales(opts.pitchTolPct, opts.pitchSteps);
    const timeScales = buildScales(opts.timeTolPct, opts.timeSteps);

    const templatesToUse = composite ? [{ ...composite, srcIdList: sel.map(r => r.id) }] : templates.map((t,i) => ({ ...t, srcIdList: [sel[i].id] }));

  // debug logs removed

  // Run detection pass for the user options (single pass; no automatic relaxed rerun)
  const pass1 = await detectCandidatesForParams(meta, extractSearch, templatesToUse, opts, !!opts.allowLowVar);
    let detections = pass1.detections;
    totalCoarsePeaks = pass1.coarsePeaks;
    totalRawCandidates = pass1.rawCandidates;

  // Sort by score desc then t1 asc
  detections.sort((a,b) => (b.score - a.score) || (a.t1 - b.t1) || (a.f1 - b.f1));
  // debug logs removed

  setProgress(`Deduplicating (${detections.length} raw detections)...`);
  const dedupAll = nms(detections, 0.5);

  // Apply user threshold after deduplication so threshold only filters final detections
  const dedup = dedupAll.filter(d => (d.score || -1) >= opts.threshold);
  // debug logs removed

    // Insert into grid
    const speciesGuess = (function(){
      try {
        // If all selected rows share same species, use it; else fallback to UI selected label
        const uniq = Array.from(new Set(sel.map(r => (r.species||'').trim()))).filter(Boolean);
        if (uniq.length === 1) return uniq[0];
        const spLbl = document.getElementById('speciesResult');
        return spLbl ? (spLbl.textContent||'').trim() : '';
      } catch (e) { return ''; }
    })();
    // Determine scientific name for the species guess
    const speciesScientificGuess = (function(){
      try {
        const keyEl = document.getElementById('selectedSpeciesKey');
        const key = keyEl ? String(keyEl.value||'').trim() : '';
        const recs = Array.isArray(window.__speciesRecords) ? window.__speciesRecords : [];
        if (key) {
          const rec = recs.find(r => String((r.key||'')).trim() === key);
          return rec ? (rec.scientific || '') : '';
        }
        if (speciesGuess) {
          const rec = recs.find(r => String((r.common||'')).trim() === String(speciesGuess).trim());
          return rec ? (rec.scientific || '') : '';
        }
      } catch (e) {}
      return '';
    })();

    // Optionally merge by gap < 1s, based on checkbox
    let finalDetections = dedup;
    try {
      const mergeFlag = !!(document.getElementById('scc-merge') && document.getElementById('scc-merge').checked);
      let gapSec = 1.0; try { const el = document.getElementById('scc-merge-gap'); const v = parseFloat(el && el.value); if (!isNaN(v)) gapSec = Math.max(0, v); } catch(e){}
      if (mergeFlag) finalDetections = mergeDetectionsByGap(dedup, gapSec);
    } catch(e){}

    let nextId = nextIdFromGrid();
    const rowsToAdd = finalDetections.map((d,i) => {
      // Do not auto-populate notes per user preference; keep empty for manual editing
      const notes = '';
        return {
        id: nextId + i,
        Selection: String(nextId + i),
        beginTime: Number(round4(d.t1)),
        endTime: Number(round4(d.t2)),
        lowFreq: Number(round4(d.f1)),
        highFreq: Number(round4(d.f2)),
        species: speciesGuess,
        scientificName: speciesScientificGuess,
        runNo: runNumber,
        sccScore: (typeof d.score === 'number') ? d.score : Number(d.score || 0),
        notes
      };
    });

    if (rowsToAdd.length) {
      try { window.annotationGrid.addData(rowsToAdd); } catch (e) {}
      // Deselect previously-selected template rows and select newly added rows for convenience
      try {
        const grid = window.annotationGrid;
        const addedIds = rowsToAdd.map(r => r.id);
        if (grid) {
          // Try to deselect any currently selected rows
          try {
            if (typeof grid.getSelectedRows === 'function') {
              const prev = grid.getSelectedRows();
              if (Array.isArray(prev)) prev.forEach(rObj => { try { if (typeof rObj.deselect === 'function') rObj.deselect(); else if (typeof grid.deselectRow === 'function') grid.deselectRow(rObj); } catch(e){} });
            } else if (typeof grid.deselectRow === 'function') {
              const selIds = sel.map(s => s.id);
              selIds.forEach(id => { try { grid.deselectRow(id); } catch(e){} });
            }
          } catch (e) {}

          // Select the newly added rows
          try {
            if (typeof grid.selectRow === 'function') {
              for (const id of addedIds) { try { grid.selectRow(id); } catch(e){} }
            } else if (typeof grid.getRow === 'function') {
              for (const id of addedIds) { try { const r = grid.getRow(id); if (r && typeof r.select === 'function') r.select(); } catch(e){} }
            }
          } catch (e) {}
        }
      } catch (e) {}
    }

    runResult = { added: rowsToAdd.length, raw: totalRawCandidates, coarse: totalCoarsePeaks, dedup: dedup.length };

    setProgress(`${rowsToAdd.length} detections added.`);
    } catch (e) {
      throw e;
    } finally {
      // hide wait overlay when finished
      try { window.__spectroWait && window.__spectroWait.hide(); } catch (e) {}
      setDisabled(false);
    }

    return runResult;

  }

    // end runSccWithOptions


  function wireButton(){
    const btn = document.getElementById(RUN_BTN_ID);
    if (!btn) return;
    if (btn.__sccWired) return;
    btn.addEventListener('click', async () => {
      // Before opening SCC modal, ensure selected templates belong to a single species.
      try {
        const selRows = getGridSelectedTemplates() || [];
        if (!selRows || !selRows.length) {
          alert('Select one or more template rows in the grid first.');
          return;
        }
        const uniq = Array.from(new Set(selRows.map(r => (r.species||'').trim()).filter(Boolean)));
        if (uniq.length === 0) {
          alert('Selected templates contain no Species. Please set the Species for your template rows before running SCC.');
          return;
        }
        if (uniq.length > 1) {
          alert('Selected templates contains more than one type of Species. SCC can run only on 1 type of species.');
          return;
        }
      } catch (e) { /* continue to open modal on unexpected error */ }
  // pause playback before opening modal to avoid background audio and focus races
  try { await safePausePlayback(800); } catch (e) {}
  const modal = _showModal();
      const $ = (id) => document.getElementById(id);
      // Prefill frequency include defaults based on selected templates
      try {
        const selRows = getGridSelectedTemplates();
        if (selRows && selRows.length) {
          const minF = Math.max(0, Math.min(...selRows.map(r => Number(r.lowFreq)||0)) - 100);
          const maxF = Math.min((globalThis._spectroSampleRate||44100)/2, Math.max(...selRows.map(r => Number(r.highFreq)||0)) + 100);
          const minEl = $('scc-minfreq'); const maxEl = $('scc-maxfreq');
          if (minEl) minEl.value = String(Math.max(0, Math.floor(minF)));
          if (maxEl) maxEl.value = String(Math.max(0, Math.ceil(maxF)));
          // Default min duration: 25% of the longest selected template duration (ms), floor 10ms
          try {
            const durations = selRows.map(r => {
              const b = Number(r.beginTime) || 0; const e = Number(r.endTime) || 0; return Math.max(0, e - b);
            });
            const maxDur = durations.length ? Math.max(...durations) : 0; // seconds
            const defaultMinDurMs = Math.max(10, Math.round(maxDur * 1000 * 0.25));
            const minDurEl = $('scc-mindur');
            if (minDurEl) minDurEl.value = String(defaultMinDurMs);
          } catch (e) {}
        }
      } catch (e) {}
  const run = $('scc-run');
  const cancel = $('scc-cancel');
  const close = () => _hideModal();
  // ensure cancel also aborts any in-flight scan (guarded in case the element was removed from the UI)
  if (cancel) cancel.onclick = () => { try { if (__scc_currentScan) __scc_currentScan.cancelled = true; } catch (e) {} close(); };
  // wire top-right X close button, if present
  try {
    const closeX = $('scc-close-x');
    if (closeX && !closeX.__wired) { closeX.addEventListener('click', close); closeX.__wired = true; }
  } catch(e) {}
      // Wire the preset scan and stop buttons
      const scanBtn = $('scc-scan');
      const stopBtn = $('scc-stop');
      const presetsArea = document.getElementById('scc-presets-area');
      if (stopBtn && !stopBtn.__wired) {
        stopBtn.addEventListener('click', () => {
          try { if (__scc_currentScan) __scc_currentScan.cancelled = true; } catch (e) {}
        });
        stopBtn.__wired = true;
      }
      if (scanBtn && !scanBtn.__scanned) {
        scanBtn.addEventListener('click', async () => {
          if (!presetsArea) return;
              // validate selection first; do not clear existing presets area on invalid selection
              const sel = getGridSelectedTemplates();
              const onlySccTemplates = Array.isArray(sel) && sel.length > 0 && sel.every(r => !!r.sccTemplate);
              if (!onlySccTemplates) { alert('Process can be applied only on SCC template(s). Pls deselect other rows.'); return; }
              // proceed and show searching message
              presetsArea.style.display = 'block';
              presetsArea.innerHTML = '<div style="color:#9ca3af">Searching presets, please wait...</div>';
              // cancel any previous scan and start a fresh one
              try { if (__scc_currentScan) __scc_currentScan.cancelled = true; } catch (e) {}
              __scc_currentScan = { cancelled: false };
              try { scanBtn.disabled = true; if (run) run.disabled = true; } catch (e) {}
              if (stopBtn) { stopBtn.style.display = 'inline-block'; stopBtn.disabled = false; }
          try {
            const sel = getGridSelectedTemplates();
            const onlySccTemplates = Array.isArray(sel) && sel.length > 0 && sel.every(r => !!r.sccTemplate);
            if (!onlySccTemplates) {
              presetsArea.innerHTML = '<div style="color:#f97316">Process can be applied only on SCC template(s). Pls deselect other rows.</div>';
              return;
            }
            const meta = getSpectroMeta();
            if (!meta.spectra || !meta.bins || !meta.framesPerSec) { presetsArea.innerHTML = '<div style="color:#f97316">Spectrogram not ready.</div>'; return; }
            // frequency include from inputs
            const minFreq = Number(($('scc-minfreq').value||'0')) || 0;
            const maxFreq = Number(($('scc-maxfreq').value||String(Math.max(1000, (meta.sampleRate||44100)/2)))) || Math.max(1000, (meta.sampleRate||44100)/2);
            const fullDuration = (typeof globalThis._spectroDuration === 'number' && isFinite(globalThis._spectroDuration)) ? globalThis._spectroDuration : Math.max(...sel.map(r => Number(r.endTime)||0));
            const extractSearch = extractTemplate2D(meta.spectra, meta.bins, meta.framesPerSec, meta.sampleRate, 0, fullDuration, minFreq, maxFreq);
            // build templates
            const templates = sel.map(r => extractTemplate2D(meta.spectra, meta.bins, meta.framesPerSec, meta.sampleRate, Number(r.beginTime)||0, Number(r.endTime)||0, Number(r.lowFreq)||0, Number(r.highFreq)||0));

            // Preset definitions
            const presets = [
              { name: 'Quick Scan', opts: { threshold: 0.30, quality: 'fast', pitchTolPct:5, pitchSteps:3, timeTolPct:0, timeSteps:1, composite:'none', energyPct:20, minDurMs:30 } },
              { name: 'Fast Balanced', opts: { threshold: 0.40, quality: 'balanced', pitchTolPct:10, pitchSteps:5, timeTolPct:5, timeSteps:1, composite:'none', energyPct:10, minDurMs:50 } },
              { name: 'Balanced Accurate', opts: { threshold: 0.55, quality: 'balanced', pitchTolPct:10, pitchSteps:7, timeTolPct:5, timeSteps:1, composite:'mean', energyPct:8, minDurMs:50 } },
              // Thorough: still accurate but use coarse downsample + caps to bound runtime.
              { name: 'Thorough', opts: { threshold: 0.65, quality: 'accurate', pitchTolPct:15, pitchSteps:9, timeTolPct:10, timeSteps:3, composite:'none', energyPct:5, minDurMs:40, coarseSX: 2, coarseSY: 2, coarseThresh: 0.05, maxCandidates: 2500, maxRefine: 800 } },
              { name: 'High Recall', opts: { threshold: 0.30, quality: 'balanced', pitchTolPct:20, pitchSteps:11, timeTolPct:10, timeSteps:3, composite:'none', energyPct:0, minDurMs:20 } }
            ];

            const rows = [];
            // create scan overlay (5 segments) and attach to presets area
            let __overlay = null;
            try { __overlay = createScanOverlay(presetsArea, presets.length); if (__scc_currentScan) __scc_currentScan.overlay = __overlay; } catch (e) { __overlay = null; }
            for (let i=0;i<presets.length;i++){
              const p = presets[i];
              // prepare opts with frequency include and the current Min duration input
              const currentMinDurMs = Math.max(0, Number(($('scc-mindur').value||'0')) || 0);
              const pOpts = Object.assign({}, p.opts, { minFreq, maxFreq, minDurMs: currentMinDurMs });
              // prepare templatesToUse according to composite
              const templatesToUse = (pOpts.composite && pOpts.composite !== 'none') ? [{ ...composeTemplates(templates, pOpts.composite), srcIdList: sel.map(r => r.id) }] : templates.map((t,idx)=> ({ ...t, srcIdList: [sel[idx].id] }));
                // For preset scanning we want counts based on the parameter values only —
                // allow low-variance templates during trial runs so the scan reports numbers
                // even if the template would normally be skipped in a strict run.
                const res = await detectCandidatesForParams(meta, extractSearch, templatesToUse, pOpts, true, __scc_currentScan);
                if (__scc_currentScan && __scc_currentScan.cancelled) { presetsArea.innerHTML = '<div style="color:#f59e0b">Search cancelled.</div>'; break; }
                // compute final dedup+threshold count
                let dets = res.detections || [];
                dets.sort((a,b) => (b.score - a.score) || (a.t1 - b.t1) || (a.f1 - b.f1));
                const dedupAll = nms(dets, 0.5);
                const final = dedupAll.filter(d => (d.score || -1) >= pOpts.threshold);
                rows.push({ name: p.name, count: final.length, opts: pOpts, detections: final, stats: { coarse: res.coarsePeaks, raw: res.rawCandidates, variantsTried: res.variantsTried, skippedLowVar: res.skippedLowVar, skippedTooLarge: res.skippedTooLarge, elapsedMs: res.elapsedMs || 0 } });
                try { if (__overlay) __overlay.markDone(i); if (__overlay) __overlay.setStatus(`${p.name}: ${final.length} detections`); } catch (e) {}
              // small yield to keep UI responsive
              await new Promise(r=>setTimeout(r,0));
              if (__scc_currentScan && __scc_currentScan.cancelled) { presetsArea.innerHTML = '<div style="color:#f59e0b">Search cancelled.</div>'; break; }
            }

            // store scan rows for later comparison
            __scc_lastScanRows = rows;

            // render results as a 2-column grid to reduce vertical scrolling
            let html = '<div style="color:#cbd5e1;margin-bottom:6px;font-size:13px">Presets results (select one to apply to the form below):</div>';
            html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
            for (let i=0;i<rows.length;i++){ const r=rows[i];
              html += `<label style="display:flex;align-items:flex-start;padding:8px;background:#071722;border-radius:6px;border:1px solid rgba(255,255,255,0.03)"><input type=radio name=scc-preset value=${i} style="margin-right:10px;margin-top:6px"><div style="flex:1"><div style="font-weight:600">${r.name}</div><div style="color:#9ca3af;font-size:12px;margin-top:4px">variants:${r.stats.variantsTried} skippedLow:${r.stats.skippedLowVar} skippedSize:${r.stats.skippedTooLarge}</div></div><div style="text-align:right;font-weight:600;margin-left:8px">${r.count}<div style="color:#9ca3af;font-size:12px;margin-top:4px">coarse:${r.stats.coarse} raw:${r.stats.raw} time:${r.stats.elapsedMs}ms</div></div></label>`;
            }
        html += '</div>';
          // Apply selected preset button (use main merge controls; do not duplicate inside presets)
        html += '<div style="margin-top:8px; display:flex; align-items:center; justify-content:flex-end; gap:12px">'
          + '<button id="scc-apply" class="btn" style="background:#0ea5e9; padding:6px 10px; font-size:13px;" disabled>Apply selected preset</button>'
          + '</div>';
            if (!(__scc_currentScan && __scc_currentScan.cancelled)) {
              presetsArea.innerHTML = html;
            }
            try { if (__overlay) __overlay.hide(); } catch (e) {}

            // radio change handler fills form values and records selection
            const radios = presetsArea.querySelectorAll('input[name="scc-preset"]');
            const applyBtn = presetsArea.querySelector('#scc-apply');
            const mergeApply = presetsArea.querySelector('#scc-merge-apply');
            const mergeGapApply = presetsArea.querySelector('#scc-merge-gap-apply');
            // sync with main checkbox if present
            try {
              const mergeMain = document.getElementById('scc-merge');
              const mergeGapMain = document.getElementById('scc-merge-gap');
              if (mergeMain && mergeApply) {
                mergeApply.checked = !!mergeMain.checked;
                mergeApply.addEventListener('change',()=>{ mergeMain.checked = mergeApply.checked; });
                mergeMain.addEventListener('change',()=>{ mergeApply.checked = mergeMain.checked; });
              }
              if (mergeGapMain && mergeGapApply) {
                mergeGapApply.value = mergeGapMain.value;
                mergeGapApply.addEventListener('input',()=>{ mergeGapMain.value = mergeGapApply.value; });
                mergeGapMain.addEventListener('input',()=>{ mergeGapApply.value = mergeGapMain.value; });
              }
            } catch(e){}
            radios.forEach(rb => rb.addEventListener('change', (ev) => {
              const idx = Number(ev.target.value);
              __scc_lastSelectedPresetIndex = idx;
              const selPreset = rows[idx];
              if (!selPreset) return;
              // populate only the three kept form fields (min duration, min freq, max freq)
              try { if (document.getElementById('scc-mindur')) document.getElementById('scc-mindur').value = String(selPreset.opts.minDurMs || selPreset.opts.minDur || 50); } catch(e){}
              try { if (document.getElementById('scc-minfreq')) document.getElementById('scc-minfreq').value = String(Math.max(0, Math.floor(selPreset.opts.minFreq||0))); } catch(e){}
              try { if (document.getElementById('scc-maxfreq')) document.getElementById('scc-maxfreq').value = String(Math.max(0, Math.ceil(selPreset.opts.maxFreq||0))); } catch(e){}
              if (applyBtn) applyBtn.disabled = !(selPreset && Array.isArray(selPreset.detections) && selPreset.detections.length);
            }));

            // Wire Apply selected preset: insert cached detection rows
            if (applyBtn && !applyBtn.__wired) {
              applyBtn.addEventListener('click', async () => {
                try {
                  // ensure selection present
                  const idx = (typeof __scc_lastSelectedPresetIndex === 'number') ? __scc_lastSelectedPresetIndex : -1;
                  if (idx < 0 || !rows[idx]) { alert('Select a preset first.'); return; }
                  const presetRow = rows[idx];
                  const dets = Array.isArray(presetRow.detections) ? presetRow.detections : [];
                  if (!dets.length) { alert('No detections cached for the selected preset.'); return; }

                  // show overlay
                  try { window.__spectroWait && window.__spectroWait.show({ etaText: 'Applying preset…' }); } catch(e){}
                  try { await new Promise(r=>setTimeout(r,20)); } catch(e){}

                  // species guess (match run behavior)
                  const selRows = getGridSelectedTemplates();
                  const speciesGuess = (function(){
                    try {
                      const uniq = Array.from(new Set(selRows.map(r => (r.species||'').trim()))).filter(Boolean);
                      if (uniq.length === 1) return uniq[0];
                      const spLbl = document.getElementById('speciesResult');
                      return spLbl ? (spLbl.textContent||'').trim() : '';
                    } catch (e) { return ''; }
                  })();

                  // Determine scientific name for the species guess (same logic as used by run)
                  const speciesScientificGuess = (function(){
                    try {
                      const keyEl = document.getElementById('selectedSpeciesKey');
                      const key = keyEl ? String(keyEl.value||'').trim() : '';
                      const recs = Array.isArray(window.__speciesRecords) ? window.__speciesRecords : [];
                      if (key) {
                        const rec = recs.find(r => String((r.key||'')).trim() === key);
                        return rec ? (rec.scientific || '') : '';
                      }
                      if (speciesGuess) {
                        const rec = recs.find(r => String((r.common||'')).trim() === String(speciesGuess).trim());
                        return rec ? (rec.scientific || '') : '';
                      }
                    } catch (e) {}
                    return '';
                  })();

                  // assign a new run number
                  const runNumber = (++__scc_runCounter);
                  let nextId = nextIdFromGrid();
                  // Optionally merge by gap < 1s
                  let toInsert = dets;
                  try {
                    const mergeFlag = !!(document.getElementById('scc-merge-apply') && document.getElementById('scc-merge-apply').checked) || !!(document.getElementById('scc-merge') && document.getElementById('scc-merge').checked);
                    let gapSec = 1.0;
                    try {
                      const elA = document.getElementById('scc-merge-gap-apply');
                      const elM = document.getElementById('scc-merge-gap');
                      const v = parseFloat(elA && elA.value || elM && elM.value);
                      if (!isNaN(v)) gapSec = Math.max(0, v);
                    } catch(e){}
                    if (mergeFlag) toInsert = mergeDetectionsByGap(dets, gapSec);
                  } catch(e){}
                  const rowsToAdd = toInsert.map((d,i) => ({
                    id: nextId + i,
                    Selection: String(nextId + i),
                    beginTime: Number(round4(d.t1)),
                    endTime: Number(round4(d.t2)),
                    lowFreq: Number(round4(d.f1)),
                    highFreq: Number(round4(d.f2)),
                    species: speciesGuess,
                    scientificName: speciesScientificGuess,
                    runNo: runNumber,
                    sccScore: (typeof d.score === 'number') ? d.score : Number(d.score || 0),
                    notes: ''
                  }));

                  if (rowsToAdd.length) {
                    try { window.annotationGrid.addData(rowsToAdd); } catch (e) {}
                    try {
                      // Deselect previous, select newly-added
                      const grid = window.annotationGrid;
                      if (grid && typeof grid.getSelectedRows === 'function') {
                        const prev = grid.getSelectedRows();
                        if (Array.isArray(prev)) prev.forEach(rObj => { try { if (typeof rObj.deselect === 'function') rObj.deselect(); else if (typeof grid.deselectRow === 'function') grid.deselectRow(rObj); } catch(e){} });
                      }
                      if (grid && typeof grid.selectRow === 'function') {
                        for (const r of rowsToAdd) { try { grid.selectRow(r.id); } catch(e){} }
                      }
                    } catch(e){}
                  }

                } catch (e) {
                  alert('Apply failed: ' + (e && e.message ? e.message : String(e)));
                } finally {
                  try { window.__spectroWait && window.__spectroWait.hide(); } catch(e){}
                }
              });
              applyBtn.__wired = true;
            }

          } catch (e) {
            if (__scc_currentScan && __scc_currentScan.cancelled) {
              presetsArea.innerHTML = '<div style="color:#f59e0b">Search cancelled.</div>';
            } else {
              presetsArea.innerHTML = '<div style="color:#f97316">Search failed: ' + (e && e.message ? e.message : String(e)) + '</div>';
            }
          } finally {
            try { scanBtn.disabled = false; } catch (e) {}
            try { if (run) run.disabled = false; } catch (e) {}
            if (stopBtn) { stopBtn.style.display = 'none'; }
            __scc_currentScan = null;
          }
        });
        scanBtn.__scanned = true;
      }
      // The "Run" button was removed from the modal UI per simplified workflow; keep wiring complete but do not attach a run handler here.
    });
    btn.__sccWired = true;
  }

  // Defer wire until DOM ready
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireButton);
  else wireButton();
})();
