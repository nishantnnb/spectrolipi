// normalize.js
// UI and processing for audio normalization with optional selection support.

(function(){
  function $(id){ return document.getElementById(id); }
  const normalizeBtn = $('normalizeBtn');
  if (!normalizeBtn) return;

  const modal = document.createElement('div');
  modal.id = 'normalizeModal';
  modal.style.position = 'fixed';
  modal.style.left = '50%';
  modal.style.top = '50%';
  modal.style.transform = 'translate(-50%,-50%)';
  modal.style.background = '#0f0f0f';
  modal.style.color = '#fff';
  modal.style.padding = '12px';
  modal.style.borderRadius = '8px';
  modal.style.zIndex = 2147483651;
  modal.style.display = 'none';
  modal.style.width = '320px';
  modal.style.boxShadow = '0 6px 30px rgba(0,0,0,0.6)';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  modal.innerHTML = (
    '<h3 id="normalizeTitle" style="margin:0 0 8px 0;font-size:1rem">Normalize</h3>' +
    '<div style="font-size:0.9rem;margin-bottom:8px;color:#ccc">Remove DC offset and scale audio to a target peak level.</div>' +
    '<div id="normalizeRange" style="font-size:0.85rem;color:#bbb;margin-bottom:8px">Range: entire audio</div>' +
    '<label for="normalizeTargetDb" style="display:block;margin-top:6px;color:#ddd">Target peak (dBFS)</label>' +
    '<input id="normalizeTargetDb" type="text" value="-3" maxlength="3" inputmode="numeric" pattern="-?[0-9]*" style="width:72px;margin-top:6px;padding:6px;background:#111;border:1px solid rgba(255,255,255,0.06);color:#fff;border-radius:4px;text-align:center" />' +
    '<div id="normalizeNote" style="font-size:0.8rem;color:#bbb;margin-top:8px">Normalization removes DC offset before scaling.</div>' +
    '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">' +
    '  <button id="normalizeCancel" class="seg-top-btn" type="button">Cancel</button>' +
    '  <button id="normalizeApply" class="seg-top-btn" type="button">Apply</button>' +
    '</div>'
  );

  document.body.appendChild(modal);

  const targetInput = $('normalizeTargetDb');
  // Sanitize input to allow only optional leading '-' and digits; prevent decimals
  if (targetInput) {
    targetInput.addEventListener('input', (ev)=>{
      try {
        let v = targetInput.value || '';
        // Remove any characters except digits and minus
        v = v.replace(/[^0-9\-]/g, '');
        // Keep at most one leading minus
        if (v.indexOf('-') > 0) {
          v = v.replace(/-/g, '');
          v = '-' + v;
        }
        // Limit length to 3 (e.g. -60)
        if (v.length > 3) v = v.slice(0, 3);
        // Prevent multiple leading zeros like 00 -> 0
        if (/^0[0-9]+/.test(v)) v = v.replace(/^0+/, '0');
        targetInput.value = v;
      } catch(e){}
    });
    // On blur, clamp to allowed range and ensure integer
    targetInput.addEventListener('blur', ()=>{
      try {
        const v = clampDbValue(targetInput.value);
        targetInput.value = String(v);
      } catch(e){}
    });
  }
  const cancelBtn = $('normalizeCancel');
  const applyBtn = $('normalizeApply');
  const rangeLabel = $('normalizeRange');
  const noteField = $('normalizeNote');

  let keyHandlerAttached = false;

  function formatSeconds(sec){
    if (!isFinite(sec) || sec < 0) return '0.000 s';
    return sec.toFixed(3) + ' s';
  }

  function getActiveSelection(){
    try {
      if (typeof window._spectroHasSelection === 'function' && !window._spectroHasSelection()) return null;
    } catch(e){}
    const sel = globalThis._spectroCurrentSelection;
    if (!sel) return null;
    const start = Number(sel.start);
    const end = Number(sel.end);
    if (!isFinite(start) || !isFinite(end)) return null;
    if (end <= start) return null;
    return { start, end };
  }

  function updateRangeSummary(){
    const sel = getActiveSelection();
    if (!rangeLabel) return;
      if (sel) {
        rangeLabel.textContent = 'Range: ' + formatSeconds(sel.start) + ' -> ' + formatSeconds(sel.end);
    } else {
      rangeLabel.textContent = 'Range: entire audio';
    }
  }

  function onModalKey(ev){
    if (modal.style.display !== 'block') return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      hideModal();
    } else if (ev.key === 'Enter' && ev.target === targetInput) {
      ev.preventDefault();
      applyBtn && applyBtn.click();
    }
  }

  function showModal(){
    updateRangeSummary();
    if (noteField) noteField.textContent = 'Normalization removes DC offset before scaling.';
    modal.style.display = 'block';
    setTimeout(()=>{
      try { if (targetInput) { targetInput.focus(); targetInput.select(); } } catch(e){}
    }, 0);
    if (!keyHandlerAttached) {
      document.addEventListener('keydown', onModalKey, true);
      keyHandlerAttached = true;
    }
  }

  function hideModal(){
    modal.style.display = 'none';
    if (keyHandlerAttached) {
      document.removeEventListener('keydown', onModalKey, true);
      keyHandlerAttached = false;
    }
  }

  function clampDbValue(value){
    // Accept string or number, return integer in [-60, 0], default -3 when invalid
    try {
      if (value === undefined || value === null) return -3;
      const s = String(value).trim();
      if (!s) return -3;
      // parse integer (ignore trailing non-digits); disallow decimals by using parseInt
      const n = parseInt(s, 10);
      if (!Number.isFinite(n) || Number.isNaN(n)) return -3;
      const clamped = Math.max(-60, Math.min(0, n));
      return clamped;
    } catch (e) { return -3; }
  }

  async function captureSnapshot(meta){
    let snap = null;
    try { if (typeof window.snapshotSpectrogramState === 'function') snap = await window.snapshotSpectrogramState(); } catch(e) { snap = null; }
    if (snap && meta) {
      try { snap.undoMeta = meta; } catch(e){}
    }
    try { if (snap && typeof window._setSpectroLastSnapshot === 'function') window._setSpectroLastSnapshot(snap); } catch(e){}
    return snap;
  }

  async function pausePlaybackIfNeeded(){
    let wasPlaying = false;
    try {
      if (globalThis._playbackScrollJump && typeof globalThis._playbackScrollJump.status === 'function') {
        const st = globalThis._playbackScrollJump.status(); wasPlaying = !!(st && st.playing);
      } else if (globalThis._playback && typeof globalThis._playback.status === 'function') {
        const st = globalThis._playback.status(); wasPlaying = !!(st && st.playing);
      }
    } catch(e) { wasPlaying = false; }
    try {
      if (globalThis._playbackScrollJump && typeof globalThis._playbackScrollJump.pause === 'function') {
        await globalThis._playbackScrollJump.pause();
      } else if (globalThis._playback && typeof globalThis._playback.pause === 'function') {
        await globalThis._playback.pause();
      }
    } catch(e){}
    return wasPlaying;
  }

  async function resumePlaybackIfNeeded(wasPlaying){
    if (!wasPlaying) return;
    try {
      if (globalThis._playbackScrollJump && typeof globalThis._playbackScrollJump.start === 'function') {
        await globalThis._playbackScrollJump.start();
      } else if (globalThis._playback && typeof globalThis._playback.start === 'function') {
        await globalThis._playback.start();
      }
    } catch(e) { console.warn('resume playback failed', e); }
  }

  async function recomputeSpectrogramForSamples(startSample, endSample, options = {}){
    const totalFrames = Math.max(0, globalThis._spectroNumFrames || 0);
    if (!totalFrames) {
      if (typeof window._rebuildAllTilesFromSpectra === 'function') {
        await window._rebuildAllTilesFromSpectra();
      }
      return;
    }
    const N = globalThis._spectroFFTSize || 2048;
    const hop = Math.max(1, Math.floor(N / 2));
    const frameStart = Math.max(0, Math.floor((startSample - N + 1) / hop));
    const frameEnd = Math.max(frameStart, Math.min(totalFrames - 1, Math.floor(endSample / hop)));
    if (frameEnd < frameStart) return;
    const frameSpan = frameEnd - frameStart + 1;
    if (frameSpan <= 0) return;

    if (typeof window._spectrogram_recomputeFrames !== 'function') {
      if (typeof window._rebuildAllTilesFromSpectra === 'function') {
        await window._rebuildAllTilesFromSpectra();
      }
      return;
    }

    if (totalFrames <= 4) {
      await window._spectrogram_recomputeFrames(frameStart, frameEnd, {
        progressCb: options.progressCb ? (p)=>{ try { options.progressCb(Math.max(0, Math.min(100, p))); } catch(e){} } : undefined
      });
      return;
    }

    const maxChunk = Math.max(1, Math.floor(totalFrames * 0.24));
    let processed = 0;
    for (let cursor = frameStart; cursor <= frameEnd;) {
      let chunkEnd = Math.min(frameEnd, cursor + maxChunk - 1);
      if ((chunkEnd - cursor + 1) / totalFrames >= 0.25 && totalFrames > 4) {
        chunkEnd = Math.min(frameEnd, cursor + Math.max(1, maxChunk - 1));
      }
      const localCount = chunkEnd - cursor + 1;
      await window._spectrogram_recomputeFrames(cursor, chunkEnd, {
        progressCb: options.progressCb ? (percent) => {
          const clamped = Math.max(0, Math.min(100, percent || 0));
          const chunkProgress = clamped / 100;
          const overall = Math.round(100 * (processed + chunkProgress * localCount) / Math.max(1, frameSpan));
          try { options.progressCb(overall); } catch(e){}
        } : undefined
      });
      processed += localCount;
      if (options.progressCb) {
        const overall = Math.round(100 * processed / Math.max(1, frameSpan));
        try { options.progressCb(Math.max(0, Math.min(100, overall))); } catch(e){}
      }
      cursor = chunkEnd + 1;
    }
  }

  async function performNormalization(targetDb){
    const audioBuf = globalThis._spectroAudioBuffer;
    if (!audioBuf) throw new Error('No audio loaded. Generate a spectrogram first.');

    const sel = getActiveSelection();
    const sr = audioBuf.sampleRate || globalThis._spectroSampleRate || 44100;
    const totalLen = audioBuf.length || 0;

    let startSample = 0;
    let endSample = totalLen;
    if (sel) {
      startSample = Math.max(0, Math.min(totalLen, Math.floor(sel.start * sr)));
      endSample = Math.max(startSample + 1, Math.min(totalLen, Math.ceil(sel.end * sr)));
    }
    const segmentLen = endSample - startSample;
    if (segmentLen <= 0) throw new Error('Selection length is zero.');

    await captureSnapshot({ action: 'normalize', targetDb, region: sel ? { start: sel.start, end: sel.end } : null });

    const wasPlaying = await pausePlaybackIfNeeded();
    const overlay = window.__spectroWait || null;

    try {
      if (overlay && typeof overlay.show === 'function') {
        try { overlay.show({ etaText: 'Normalizing audio...' }); } catch(e){}
      }
      if (noteField) noteField.textContent = 'Removing DC offset...';
      await new Promise(r => setTimeout(r, 0));

      const channels = Math.max(1, audioBuf.numberOfChannels || 1);
      let peak = 0;
      for (let c = 0; c < channels; c++) {
        const data = audioBuf.getChannelData(c);
        let sum = 0;
        for (let i = startSample; i < endSample; i++) {
          sum += data[i];
        }
        const mean = sum / segmentLen;
        for (let i = startSample; i < endSample; i++) {
          const centered = data[i] - mean;
          data[i] = centered;
          const absVal = Math.abs(centered);
          if (absVal > peak) peak = absVal;
        }
      }

      if (!(peak > 0)) {
        throw new Error('Selection is silent after removing DC offset.');
      }

      if (noteField) noteField.textContent = 'Scaling audio...';
      const targetAmp = Math.pow(10, targetDb / 20);
      const clampedTarget = Math.min(0.999, Math.max(1e-6, targetAmp));
      const gain = clampedTarget / peak;
      for (let c = 0; c < Math.max(1, audioBuf.numberOfChannels || 1); c++) {
        const data = audioBuf.getChannelData(c);
        for (let i = startSample; i < endSample; i++) {
          let sample = data[i] * gain;
          if (sample > 1) sample = 1;
          else if (sample < -1) sample = -1;
          data[i] = sample;
        }
      }

      if (noteField) noteField.textContent = 'Updating spectrogram...';
      if (overlay && typeof overlay.show === 'function') {
        try { overlay.show({ etaText: 'Updating spectrogram...' }); } catch(e){}
      }
      await recomputeSpectrogramForSamples(startSample, endSample, {
        progressCb(percent){
          if (overlay && typeof overlay.show === 'function') {
            try { overlay.show({ etaText: 'Updating spectrogram... ' + percent + '%' }); } catch(e){}
          }
          if (noteField) {
            try { noteField.textContent = 'Updating spectrogram (' + percent + '%)...'; } catch(e){}
          }
        }
      });

      try {
        window.dispatchEvent(new CustomEvent('spectrogram-normalized', {
          detail: {
            targetDb,
            gain,
            startSample,
            endSample,
            startSec: startSample / Math.max(1, sr),
            endSec: endSample / Math.max(1, sr)
          }
        }));
      } catch(e){}

      if (noteField) noteField.textContent = 'Normalization applied.';
      return { gain, selection: sel };
    } finally {
      if (overlay && typeof overlay.hide === 'function') {
        try { overlay.hide(); } catch(e){}
      }
      await resumePlaybackIfNeeded(wasPlaying);
    }
  }

  normalizeBtn.addEventListener('click', (ev)=>{
    ev.preventDefault();
    try {
      const editActive = !!(globalThis._editAnnotations && typeof globalThis._editAnnotations.isEditMode === 'function' && globalThis._editAnnotations.isEditMode());
      if (!editActive) {
        try { toast('Switch to Edit mode to normalize audio.'); } catch(e){ alert('Switch to Edit mode to normalize audio.'); }
        return;
      }
    } catch(e){}
    if (!globalThis._spectroAudioBuffer) {
      alert('No audio loaded. Generate a spectrogram first.');
      return;
    }
    showModal();
  });

  cancelBtn && cancelBtn.addEventListener('click', (ev)=>{ ev.preventDefault(); hideModal(); });

  applyBtn && applyBtn.addEventListener('click', async (ev)=>{
    ev.preventDefault();
    if (!applyBtn || applyBtn.disabled) return;
    const value = clampDbValue(targetInput ? targetInput.value : '-3');
    if (targetInput) targetInput.value = String(value);

    applyBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    try { if (typeof normalizeBtn.disabled === 'boolean') normalizeBtn.disabled = true; } catch(e){}
    if (noteField) noteField.textContent = 'Starting normalization...';

    try {
      const result = await performNormalization(value);
      hideModal();
      try {
        toast('Normalization applied' + (result && result.gain ? ' (gain ' + result.gain.toFixed(2) + '×)' : ''));
      } catch(e){}
    } catch(err) {
      console.error('Normalization failed', err);
      alert('Normalization failed: ' + (err && err.message ? err.message : String(err)));
      if (noteField) noteField.textContent = 'Normalization failed.';
    } finally {
      applyBtn.disabled = false;
      if (cancelBtn) cancelBtn.disabled = false;
      if (typeof window.updateCutButtonEnabled === 'function') {
        try { window.updateCutButtonEnabled(); } catch(e){}
      } else {
        try { normalizeBtn.disabled = false; } catch(e){}
      }
    }
  });

  window.addEventListener('spectrogram-generated', ()=>{
    if (typeof window.updateCutButtonEnabled === 'function') {
      try { window.updateCutButtonEnabled(); } catch(e){}
    }
  });
})();
