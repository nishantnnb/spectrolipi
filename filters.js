// filters.js
// UI + destructive filter application using Web Audio API.
// - Button: #filtersBtn (added in index.html)
// - Uses globalThis._spectroCurrentSelection (start/end seconds) if present, otherwise whole audio
// - Uses globalThis._spectroAudioBuffer as authoritative audio; writes back modified buffer
// - Pushes snapshot via globalThis._setSpectroLastSnapshot so the existing Undo button can revert

(function(){
  function $(id){ return document.getElementById(id); }
  const filtersBtn = $('filtersBtn');
  const silenceBtn = $('silenceBtn');
  const undoBtn = $('undoCutBtn');
  const MIN_SILENCE_SEC = 0.05;
  const MAX_SILENCE_SEC = 10;
  if (!filtersBtn && !silenceBtn) return;

  function formatSeconds(sec){
    if (!isFinite(sec)) return '0.000 s';
    const clamped = Math.max(0, sec);
    return clamped.toFixed(3) + ' s';
  }

  function clampSilenceDuration(value){
    if (!isFinite(value)) return 1;
    return Math.max(MIN_SILENCE_SEC, Math.min(MAX_SILENCE_SEC, value));
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

  if (filtersBtn) {
  // Build modal dynamically
  const modal = document.createElement('div');
  modal.id = 'filtersModal';
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
  modal.style.width = '360px';
  modal.style.boxShadow = '0 6px 30px rgba(0,0,0,0.6)';

  modal.innerHTML = `
    <h3 style="margin:0 0 8px 0;font-size:1rem">Filters</h3>
    <div style="font-size:0.9rem;margin-bottom:8px;color:#ccc">Apply a High-Pass or Low-Pass filter to the selected time span or the whole audio.</div>
    <label style="display:block;margin-top:6px;color:#ddd">Type</label>
    <div style="display:flex;gap:12px;margin-top:6px">
      <label style="display:inline-flex;align-items:center;gap:8px"><input type="radio" name="filterType" value="highpass" checked /> High-Pass</label>
      <label style="display:inline-flex;align-items:center;gap:8px"><input type="radio" name="filterType" value="lowpass" /> Low-Pass</label>
    </div>
    <label style="display:block;margin-top:10px;color:#ddd">Cutoff frequency (Hz)</label>
    <input id="filterCutoff" type="number" value="1000" min="10" max="96000" style="width:20%;margin-top:6px;padding:6px;background:#111;border:1px solid rgba(255,255,255,0.06);color:#fff;border-radius:4px" />
    <label style="display:block;margin-top:10px;color:#ddd">Roll-off (dB/oct)</label>
    <select id="filterRollOff" style="width:50%;margin-top:6px;padding:6px;background:#111;border:1px solid rgba(255,255,255,0.06);color:#fff;border-radius:4px">
      <option value="6">6 dB/oct</option>
      <option value="12">12 dB/oct</option>
      <option value="24">24 dB/oct</option>
      <option value="36">36 dB/oct</option>
      <option value="48">48 dB/oct</option>
    </select>
    <div id="filtersNote" style="font-size:0.85rem;color:#bbb;margin-top:8px">Note: filtering modifies the audio buffer for export. Visual spectrogram may not update automatically.</div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
      <button id="filterCancel" class="seg-top-btn" type="button">Cancel</button>
      <button id="filterApply" class="seg-top-btn" type="button">Apply</button>
    </div>
  `;

  document.body.appendChild(modal);

  const cancelBtn = $('filterCancel');
  const applyBtn = $('filterApply');
  const cutoffEl = $('filterCutoff');
  const rollEl = $('filterRollOff');

  function showModal(){ modal.style.display = 'block'; }
  function hideModal(){ modal.style.display = 'none'; }

  filtersBtn.addEventListener('click', (ev)=>{
    ev.preventDefault();
    // Ensure in Edit mode
    try { const editActive = !!(globalThis._editAnnotations && typeof globalThis._editAnnotations.isEditMode === 'function' && globalThis._editAnnotations.isEditMode()); if (!editActive) { try { toast('Switch to Edit mode to apply filters.'); } catch(e){}; return; } } catch(e){}
    // Ensure spectrogram/audio ready
    if (!globalThis._spectroAudioBuffer) {
      alert('No audio loaded. Generate a spectrogram or open a file first.');
      return;
    }
    showModal();
  });

  cancelBtn.addEventListener('click', (ev)=>{ ev.preventDefault(); hideModal(); });

  const SUPPORTED_SLOPES = Object.freeze([6, 12, 24, 36, 48]);

  function buildFilterChain(ctx, type, cutoff, slope){
    const nodes = [];
    const sr = ctx.sampleRate;
    if (slope === 6) {
      const nyquist = sr * 0.5;
      const limitedCutoff = Math.min(Math.max(10, cutoff), nyquist * 0.995);
      if (typeof ctx.createIIRFilter === 'function') {
        const K = Math.tan(Math.PI * (limitedCutoff / sr));
        if (!Number.isFinite(K) || K <= 0) {
          throw new Error('Invalid coefficient for 6 dB filter');
        }
        const norm = 1 / (1 + K);
        let feedforward;
        if (type === 'lowpass') {
          const b = K * norm;
          feedforward = [b, b];
        } else {
          const b = norm;
          feedforward = [b, -b];
        }
        const a1 = (K - 1) / (K + 1);
        nodes.push(ctx.createIIRFilter(feedforward, [1, a1]));
      } else {
        console.warn('IIRFilterNode not supported; approximating 6 dB/oct filter with BiquadFilterNode.');
        const fallback = ctx.createBiquadFilter();
        fallback.type = type;
        fallback.frequency.value = limitedCutoff;
        fallback.Q.value = Math.SQRT1_2;
        nodes.push(fallback);
      }
      return nodes;
    }

    const sectionCount = slope / 12;
    if (!Number.isInteger(sectionCount) || sectionCount <= 0) throw new Error('Unsupported slope: ' + slope);
    for (let i = 0; i < sectionCount; i++) {
      const bq = ctx.createBiquadFilter();
      bq.type = type;
      bq.frequency.value = cutoff;
      bq.Q.value = Math.SQRT1_2; // Butterworth-like second-order stage
      nodes.push(bq);
    }
    return nodes;
  }

  // Helper: create offline rendering and apply filter to a Float32Array segment based on slope
  async function processSegment(midBuffer, type, cutoff, slope){
    const ch = midBuffer.numberOfChannels;
    const sr = midBuffer.sampleRate;
    const len = midBuffer.length;
    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineCtx) throw new Error('OfflineAudioContext not supported');
    const offline = new OfflineCtx(ch, len, sr);

    const srcBuf = offline.createBuffer(ch, len, sr);
    for (let c = 0; c < ch; c++) {
      srcBuf.copyToChannel(midBuffer.getChannelData(c), c, 0);
    }

    const src = offline.createBufferSource();
    src.buffer = srcBuf;

    const chain = buildFilterChain(offline, type, cutoff, slope);
    let current = src;
    if (chain.length === 0) {
      current.connect(offline.destination);
    } else {
      for (let i = 0; i < chain.length; i++) {
        current.connect(chain[i]);
        current = chain[i];
      }
      current.connect(offline.destination);
    }

    src.start(0);
    const rendered = await offline.startRendering();
    return rendered;
  }

  // Apply: read selection (if any), run processSegment, and splice back into global buffer
  applyBtn.addEventListener('click', async (ev)=>{
    ev.preventDefault();
    try {
      applyBtn.disabled = true; cancelBtn.disabled = true; filtersBtn.disabled = true;
      const type = (document.querySelector('input[name="filterType"]:checked') || {}).value || 'highpass';
      const cutoff = Math.max(10, Number(cutoffEl.value) || 1000);
      const slope = Number(rollEl.value) || 12;
      if (!SUPPORTED_SLOPES.includes(slope)) {
        alert('Unsupported roll-off: ' + slope + ' dB/oct');
        return;
      }

      const audioBuf = globalThis._spectroAudioBuffer;
      if (!audioBuf) { alert('No audio buffer found'); return; }

      // Determine selection before capturing snapshot so undo metadata is accurate
      let sel = null;
      try { if (typeof window._spectroHasSelection === 'function' && window._spectroHasSelection()) sel = window._spectroCurrentSelection || null; } catch(e){ sel = null; }

      const sr = audioBuf.sampleRate;
      const ch = audioBuf.numberOfChannels;
      const totalLen = audioBuf.length;

      let s1 = 0, s2 = totalLen;
      if (sel && isFinite(sel.start) && isFinite(sel.end)){
        s1 = Math.max(0, Math.min(totalLen, Math.floor(sel.start * sr)));
        s2 = Math.max(s1, Math.min(totalLen, Math.ceil(sel.end * sr)));
      }
      if (sel && s2 <= s1) { alert('Selection length is zero.'); return; }
      const regionMeta = sel ? { start: s1 / sr, end: s2 / sr } : null;

      // Snapshot for Undo
      let snap = null;
      try { if (typeof window.snapshotSpectrogramState === 'function') snap = await window.snapshotSpectrogramState(); } catch(e) { snap = null; }
      if (snap) {
        try { snap.undoMeta = { type, cutoff, slope, region: regionMeta }; } catch(e){}
      }
      try { if (snap && typeof window._setSpectroLastSnapshot === 'function') window._setSpectroLastSnapshot(snap); } catch(e){}

      // Pause playback if any (and remember whether it was playing so we can resume)
      let wasPlaying = false;
      try {
        if (globalThis._playbackScrollJump && typeof globalThis._playbackScrollJump.status === 'function') {
          const st = globalThis._playbackScrollJump.status(); wasPlaying = !!(st && st.playing);
        } else if (globalThis._playback && typeof globalThis._playback.status === 'function') {
          const st = globalThis._playback.status(); wasPlaying = !!(st && st.playing);
        }
      } catch(e) { wasPlaying = false; }
      try { if (globalThis._playbackScrollJump && typeof globalThis._playbackScrollJump.pause === 'function') await globalThis._playbackScrollJump.pause(); else if (globalThis._playback && typeof globalThis._playback.pause === 'function') await globalThis._playback.pause(); } catch(e){}

      // Build mid AudioBuffer representing the segment
      const midLen = s2 - s1;
      const CtxClass = window.AudioContext || window.webkitAudioContext;
      let tempCtx = null;
      try { tempCtx = new CtxClass(); } catch(e) { tempCtx = null; }
      // If no AudioContext available, throw
      if (!tempCtx) { alert('AudioContext not available'); return; }
      const midBuf = tempCtx.createBuffer(ch, midLen, sr);
      for (let c=0;c<ch;c++){ const src = audioBuf.getChannelData(c); const dst = midBuf.getChannelData(c); dst.set(src.subarray(s1, s2)); }

      // Show a quick modal spinner/note while rendering
      const prevNote = $('filtersNote'); if (prevNote) prevNote.textContent = 'Applying filter — processing...';

      // Process according to slope mapping
      const rendered = await processSegment(midBuf, type, cutoff, slope);

      // Compose new AudioBuffer: pre + rendered + post
      const renderedLen = rendered.length;
      const newLen = s1 + renderedLen + (totalLen - s2);
      const newBuf = tempCtx.createBuffer(ch, Math.max(1,newLen), sr);
      for (let c=0;c<ch;c++){
        const dst = newBuf.getChannelData(c);
        // pre
        if (s1 > 0) dst.set(audioBuf.getChannelData(c).subarray(0, s1), 0);
        // rendered
        dst.set(rendered.getChannelData(c), s1);
        // post
        if (s2 < totalLen) dst.set(audioBuf.getChannelData(c).subarray(s2), s1 + renderedLen);
      }

      // Close temp ctx if possible
      try { if (typeof tempCtx.close === 'function') await tempCtx.close(); } catch(e){}

      // Replace global buffer
      globalThis._spectroAudioBuffer = newBuf;
      globalThis._spectroDuration = newBuf.length / Math.max(1, newBuf.sampleRate);

      // Notify listeners and update UI
      try { window.dispatchEvent(new CustomEvent('spectrogram-filter-applied', { detail: { startSample: s1, endSample: s2, startSec: s1/sr, endSec: s2/sr, newDuration: globalThis._spectroDuration } })); } catch(e){}
      try { if (prevNote) prevNote.textContent = 'Filter applied — audio buffer updated.'; } catch(e){}

      // Re-enable buttons
      hideModal();

      // Recompute spectrogram (incremental when possible) so visuals match audio.
      try {
        // compute affected frame range from sample indices using FFT size/hop
        const N = (globalThis._spectroFFTSize || 2048);
        const hop = Math.max(1, Math.floor(N / 2));
        const totalFrames = Math.max(1, globalThis._spectroNumFrames || Math.floor(((globalThis._spectroAudioBuffer && globalThis._spectroAudioBuffer.length) || 0) / hop));
        const frameStart = Math.max(0, Math.floor((s1 - N + 1) / hop));
        const frameEnd = Math.max(frameStart, Math.min(totalFrames - 1, Math.floor(s2 / hop)));

        // Heuristic fallback threshold (same as spectrogram helper): delegate decision there too
        if (sel) {
          if (typeof window._spectrogram_recomputeFrames === 'function') {
            try {
              if (prevNote) prevNote.textContent = 'Recomputing spectrogram image for edited region...';
              await window._spectrogram_recomputeFrames(frameStart, frameEnd, { progressCb: (p) => { try { if (prevNote) prevNote.textContent = 'Recomputing spectrogram: ' + p + '%'; } catch(e){} } });
              try { if (prevNote) prevNote.textContent = 'Spectrogram region updated.'; } catch(e){}
            } catch (e) {
              console.warn('incremental spectrogram recompute failed, falling back', e);
              try { if (typeof window._rebuildAllTilesFromSpectra === 'function') await window._rebuildAllTilesFromSpectra(); } catch(e2){}
            }
          } else if (typeof window._rebuildAllTilesFromSpectra === 'function') {
            try { if (prevNote) prevNote.textContent = 'Rebuilding spectrogram...'; await window._rebuildAllTilesFromSpectra(); } catch(e){}
          }
        } else {
          // whole-file edit: recompute spectra from the (modified) audio buffer and rebuild the image.
            try {
              // show same wait overlay used for initial generation
              try { window.__spectroWait && window.__spectroWait.show({ etaText: 'Recomputing spectrogram...' }); } catch(e){}
              if (prevNote) prevNote.textContent = 'Recomputing full spectrogram (this may take a moment)...';

              const totalFrames = Math.max(0, globalThis._spectroNumFrames || 0);
              const bins = Math.max(0, globalThis._spectroBins || 0);
              // ensure spectra buffer exists so the recompute helper will run
              try { if (!globalThis._spectroSpectra || !(globalThis._spectroSpectra instanceof Float32Array) || globalThis._spectroSpectra.length !== (totalFrames * bins)) {
                if (totalFrames > 0 && bins > 0) globalThis._spectroSpectra = new Float32Array(totalFrames * bins);
              } } catch(e){}

              if (typeof window._spectrogram_recomputeFrames === 'function' && totalFrames > 0) {
                await window._spectrogram_recomputeFrames(0, Math.max(0, totalFrames - 1), { progressCb: (p) => { try { if (prevNote) prevNote.textContent = 'Recomputing spectrogram: ' + p + '%'; } catch(e){} } });
              } else if (typeof window._rebuildAllTilesFromSpectra === 'function') {
                // fallback: if recompute helper not present, rebuild tiles from existing spectra
                try { await window._rebuildAllTilesFromSpectra(); } catch(e){}
              }
              try { if (prevNote) prevNote.textContent = 'Full spectrogram rebuilt.'; } catch(e){}
            } catch(e) {
              console.warn('full spectrogram recompute failed', e);
            } finally {
              try { window.__spectroWait && window.__spectroWait.hide(); } catch(e){}
            }
        }
      } catch(e) { console.warn('spectrogram re-render after filter failed', e); }

      // If playback was active prior to filtering, resume playback so user can hear the change immediately
      try {
        if (wasPlaying) {
          if (globalThis._playbackScrollJump && typeof globalThis._playbackScrollJump.start === 'function') {
            try { await globalThis._playbackScrollJump.start(); } catch(e) { console.warn('resume playback failed', e); }
          } else if (globalThis._playback && typeof globalThis._playback.start === 'function') {
            try { await globalThis._playback.start(); } catch(e) { console.warn('resume playback failed', e); }
          }
        }
      } catch(e){}

  // user-visible final alert removed: spectrogram is regenerated by the app flow when needed
    } catch (err) {
      console.error('Filter apply failed', err);
      alert('Filter failed: ' + (err && err.message ? err.message : String(err)));
    } finally {
      applyBtn.disabled = false; cancelBtn.disabled = false; try { filtersBtn.disabled = false; } catch(e){}
    }
  });

  }

  if (silenceBtn) {
    const silenceModal = document.createElement('div');
    silenceModal.id = 'silenceModal';
    silenceModal.style.position = 'fixed';
    silenceModal.style.left = '50%';
    silenceModal.style.top = '50%';
    silenceModal.style.transform = 'translate(-50%,-50%)';
    silenceModal.style.background = '#0f0f0f';
    silenceModal.style.color = '#fff';
    silenceModal.style.padding = '12px';
    silenceModal.style.borderRadius = '8px';
    silenceModal.style.zIndex = 2147483651;
    silenceModal.style.display = 'none';
    silenceModal.style.width = '360px';
    silenceModal.style.boxShadow = '0 6px 30px rgba(0,0,0,0.6)';
    silenceModal.setAttribute('role', 'dialog');
    silenceModal.setAttribute('aria-modal', 'true');
    silenceModal.setAttribute('aria-hidden', 'true');

    silenceModal.innerHTML = `
      <h3 style="margin:0 0 8px 0;font-size:1rem">Silence</h3>
      <div style="font-size:0.9rem;margin-bottom:8px;color:#ccc">Replace the selected time span with silence.</div>
      <div style="font-size:0.85rem;color:#bbb;margin-bottom:6px">Selection length: <span id="silenceSelectionLength">0.000 s</span></div>
      <label style="display:block;margin-top:6px;color:#ddd">Silence duration (seconds)</label>
      <input id="silenceDuration" type="number" value="1.000" min="${MIN_SILENCE_SEC}" max="${MAX_SILENCE_SEC}" step="0.05" style="width:20%;margin-top:6px;padding:6px;background:#111;border:1px solid rgba(255,255,255,0.06);color:#fff;border-radius:4px" />
      <div id="silenceNote" style="font-size:0.85rem;color:#bbb;margin-top:8px">Duration must be between ${MIN_SILENCE_SEC.toFixed(2)} and ${MAX_SILENCE_SEC.toFixed(2)} seconds.</div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
        <button id="silenceCancel" class="seg-top-btn" type="button">Cancel</button>
        <button id="silenceApply" class="seg-top-btn" type="button">Apply</button>
      </div>
    `;
    document.body.appendChild(silenceModal);

    const silenceCancel = $('silenceCancel');
    const silenceApply = $('silenceApply');
    const silenceInput = $('silenceDuration');
    const silenceNote = $('silenceNote');
    const silenceSelectionLen = $('silenceSelectionLength');
    let lastSilenceSelection = null;

    function showSilenceModal(sel){
      const len = sel ? Math.max(0, sel.end - sel.start) : 0;
      if (silenceSelectionLen) silenceSelectionLen.textContent = formatSeconds(len);
      const preset = clampSilenceDuration(len > 0 ? len : 1);
      if (silenceInput) {
        silenceInput.value = preset.toFixed(3);
        silenceInput.min = String(MIN_SILENCE_SEC);
        silenceInput.max = String(MAX_SILENCE_SEC);
      }
      if (silenceNote) silenceNote.textContent = `Duration must be between ${MIN_SILENCE_SEC.toFixed(2)} and ${MAX_SILENCE_SEC.toFixed(2)} seconds.`;
      silenceModal.style.display = 'block';
      try { silenceModal.setAttribute('aria-hidden','false'); } catch(e){}
      try { if (silenceInput) { silenceInput.focus(); silenceInput.select(); } } catch(e){}
    }

    function hideSilenceModal(){
      silenceModal.style.display = 'none';
      try { silenceModal.setAttribute('aria-hidden','true'); } catch(e){}
    }

    silenceBtn.addEventListener('click', (ev)=>{
      ev.preventDefault();
      let editActive = false;
      try { editActive = !!(globalThis._editAnnotations && typeof globalThis._editAnnotations.isEditMode === 'function' && globalThis._editAnnotations.isEditMode()); } catch(e){ editActive = false; }
      if (!editActive) { try { toast('Switch to Edit mode to insert silence.'); } catch(e){ alert('Switch to Edit mode to insert silence.'); } return; }
      if (!globalThis._spectroAudioBuffer) { alert('No audio loaded. Generate a spectrogram or open a file first.'); return; }
      const sel = getActiveSelection();
      if (!sel) { alert('Select a time span on the spectrogram first.'); return; }
      lastSilenceSelection = sel;
      showSilenceModal(sel);
    });

    if (silenceCancel) {
      silenceCancel.addEventListener('click', (ev)=>{ ev.preventDefault(); hideSilenceModal(); lastSilenceSelection = null; });
    }

    silenceModal.addEventListener('keydown', (ev)=>{
      if (ev.key === 'Escape') {
        ev.preventDefault();
        hideSilenceModal();
        lastSilenceSelection = null;
      }
    });

    if (silenceApply) {
      silenceApply.addEventListener('click', async (ev)=>{
        ev.preventDefault();
        const noteEl = silenceNote;
        const sel = getActiveSelection() || lastSilenceSelection;
        if (!sel) { alert('Selection is required to insert silence.'); return; }
        if (!globalThis._spectroAudioBuffer) { alert('No audio buffer found.'); return; }
        let silenceSec = clampSilenceDuration(Number(silenceInput ? silenceInput.value : 1));
        if (!isFinite(silenceSec) || silenceSec <= 0) {
          alert(`Enter a silence duration between ${MIN_SILENCE_SEC} and ${MAX_SILENCE_SEC} seconds.`);
          return;
        }
        if (silenceInput) silenceInput.value = clampSilenceDuration(silenceSec).toFixed(3);
        if (noteEl) noteEl.textContent = 'Applying silence...';
        silenceApply.disabled = true;
        if (silenceCancel) silenceCancel.disabled = true;
        silenceBtn.disabled = true;
        let wasPlaying = false;
        try {
          // Show global wait overlay (index.html contains markup; spectrogram.js wires show/hide)
          try { window.__spectroWait && window.__spectroWait.show({ etaText: 'Applying silence...' }); } catch(e){}
          await captureSnapshot({ type: 'silence', selection: { start: sel.start, end: sel.end }, silenceSeconds: silenceSec });
          wasPlaying = await pausePlaybackIfNeeded();

          const audioBuf = globalThis._spectroAudioBuffer;
          const sr = Math.max(1, Math.floor(audioBuf.sampleRate || globalThis._spectroSampleRate || 44100));
          const ch = Math.max(1, audioBuf.numberOfChannels || 1);
          const totalLen = audioBuf.length;
          const startSample = Math.max(0, Math.min(totalLen, Math.floor(sel.start * sr)));
          const endSample = Math.max(startSample + 1, Math.min(totalLen, Math.ceil(sel.end * sr)));
          if (endSample <= startSample) { throw new Error('Selection length is zero.'); }
          const selectedDuration = (endSample - startSample) / sr;
          silenceSec = clampSilenceDuration(silenceSec);
          if (silenceInput) silenceInput.value = silenceSec.toFixed(3);
          const deltaSec = silenceSec - selectedDuration;
          const insertSamples = Math.max(1, Math.round(silenceSec * sr));
          const CtxClass = window.AudioContext || window.webkitAudioContext;
          let tempCtx = null;
          try { tempCtx = new CtxClass(); } catch(e) { tempCtx = null; }
          if (!tempCtx) { throw new Error('AudioContext not available'); }
          const newTotalSamples = startSample + insertSamples + (totalLen - endSample);
          const newBuf = tempCtx.createBuffer(ch, Math.max(1, newTotalSamples), sr);
          for (let c=0;c<ch;c++){
            const src = audioBuf.getChannelData(c);
            const dst = newBuf.getChannelData(c);
            if (startSample > 0) dst.set(src.subarray(0, startSample), 0);
            if (endSample < totalLen) dst.set(src.subarray(endSample), startSample + insertSamples);
          }
          try { if (typeof tempCtx.close === 'function') await tempCtx.close(); } catch(e){}

          const newDuration = newBuf.length / sr;
          const fps = Math.max(1e-6, globalThis._spectroFramesPerSec || (sr / Math.max(1, (globalThis._spectroFFTSize || 2048) / 2)));
          const pxpf = Math.max(1, globalThis._spectroPxPerFrame || 1);
          const totalFrames = Math.max(0, globalThis._spectroNumFrames || 0);
          const bins = Math.max(0, globalThis._spectroBins || 0);
          const frameStart = Math.max(0, Math.floor(sel.start * fps));
          let frameEnd = Math.max(frameStart + 1, Math.ceil(sel.end * fps));
          frameEnd = Math.min(Math.max(frameStart + 1, frameEnd), Math.max(frameStart + 1, totalFrames));
          const framesAfter = Math.max(0, totalFrames - frameEnd);
          const insertFrames = Math.max(1, Math.round(silenceSec * fps));
          let newFrames = frameStart + insertFrames + framesAfter;
          if (newFrames <= 0 || !isFinite(newFrames)) newFrames = Math.max(1, Math.round(newDuration * fps));

          let fallbackFullRebuild = false;
          let newSpectra = null;
          if (globalThis._spectroSpectra && bins > 0 && totalFrames > 0) {
            try {
              newSpectra = new Float32Array(newFrames * bins);
              if (frameStart > 0) newSpectra.set(globalThis._spectroSpectra.subarray(0, frameStart * bins), 0);
              if (framesAfter > 0) {
                const tailSrcStart = frameEnd * bins;
                const tailDstStart = (frameStart + insertFrames) * bins;
                newSpectra.set(globalThis._spectroSpectra.subarray(tailSrcStart, tailSrcStart + framesAfter * bins), tailDstStart);
              }
            } catch(e) {
              console.warn('spectra resize failed', e);
              fallbackFullRebuild = true;
              newSpectra = null;
            }
          } else {
            fallbackFullRebuild = true;
          }

          if (!newSpectra && bins > 0 && newFrames > 0) {
            try { newSpectra = new Float32Array(newFrames * bins); } catch(e){ newSpectra = null; fallbackFullRebuild = true; }
          }

          if (newSpectra) {
            globalThis._spectroSpectra = newSpectra;
          } else if (fallbackFullRebuild && bins > 0 && newFrames > 0) {
            globalThis._spectroSpectra = new Float32Array(newFrames * bins);
          } else if (fallbackFullRebuild) {
            globalThis._spectroSpectra = null;
          }

          globalThis._spectroAudioBuffer = newBuf;
          globalThis._spectroDuration = newDuration;
          globalThis._spectroNumFrames = newFrames;
          const intrinsicWidth = Math.max(0, newFrames * pxpf);
          try {
            if (typeof globalThis._spectroApplyDisplayScaleFromIntrinsic === 'function') {
              globalThis._spectroApplyDisplayScaleFromIntrinsic(intrinsicWidth);
            } else {
              globalThis._spectroImageWidth = intrinsicWidth;
              globalThis._spectroImageIntrinsicWidth = intrinsicWidth;
              globalThis._spectroDisplayScaleX = 1;
              const fpsNow = Math.max(1e-9, globalThis._spectroFramesPerSec || fps);
              globalThis._spectroPxPerSec = fpsNow * pxpf;
            }
            try { globalThis._scheduleAnnotationOverlaySync && globalThis._scheduleAnnotationOverlaySync('filters-apply'); } catch (_) {}
          } catch(e){}
          try { if (globalThis._spectroLastGen) { globalThis._spectroLastGen.numFrames = newFrames; globalThis._spectroLastGen.duration = newDuration; } } catch(e){}

          const scrollArea = document.getElementById('scrollArea');
          if (scrollArea) {
            const vpW = scrollArea.clientWidth || 0;
            const maxScroll = Math.max(0, (globalThis._spectroImageWidth || 0) - vpW);
            scrollArea.scrollLeft = Math.max(0, Math.min(maxScroll, scrollArea.scrollLeft || 0));
          }
          const spacer = document.getElementById('spectroSpacer');
          if (spacer) {
            spacer.style.width = (globalThis._spectroImageWidth || 0) + 'px';
            spacer.style.height = (12 + (globalThis._spectroImageHeight || 0) + 44) + 'px';
          }

          if (typeof window.__spectroWait !== 'undefined' && window.__spectroWait && typeof window.__spectroWait.show === 'function' && fallbackFullRebuild) {
            try { window.__spectroWait.show({ etaText: 'Recomputing spectrogram...' }); } catch(e){}
          }

          try {
            if (!fallbackFullRebuild && typeof window._rebuildAllTilesFromSpectra === 'function') {
              if (noteEl) noteEl.textContent = 'Rebuilding spectrogram tiles...';
              await window._rebuildAllTilesFromSpectra();
            } else if (typeof window._spectrogram_recomputeFrames === 'function' && globalThis._spectroNumFrames > 0) {
              if (noteEl) noteEl.textContent = 'Recomputing spectrogram...';
              await window._spectrogram_recomputeFrames(0, Math.max(0, globalThis._spectroNumFrames - 1));
            } else if (typeof window._rebuildAllTilesFromSpectra === 'function') {
              if (noteEl) noteEl.textContent = 'Rebuilding spectrogram tiles...';
              await window._rebuildAllTilesFromSpectra();
            }
          } finally {
            try { window.__spectroWait && window.__spectroWait.hide(); } catch(e){}
          }

          const ymax = (globalThis._spectroYMax || (globalThis._spectroSampleRate ? globalThis._spectroSampleRate / 2 : 22050));
          try { if (typeof globalThis._spectrogram_reRenderFromSpectra === 'function') await globalThis._spectrogram_reRenderFromSpectra(ymax); } catch(e){}

          try { if (typeof window.adjustAnnotationsForSilence === 'function') await window.adjustAnnotationsForSilence(sel.start, sel.end, silenceSec); } catch(e){ console.warn('adjustAnnotationsForSilence failed', e); }

          try { window.dispatchEvent(new CustomEvent('spectrogram-silence-applied', { detail: { startSec: sel.start, endSec: sel.end, silenceSec, deltaSec, newDuration } })); } catch(e){}

          if (noteEl) noteEl.textContent = 'Silence applied.';
          try { globalThis._spectroCurrentSelection = { start: sel.start, end: sel.start + silenceSec }; } catch(e){}
          if (typeof globalThis.disarmCutMode === 'function') {
            try { globalThis.disarmCutMode(false); } catch(e){}
          }
          try { window.updateCutButtonEnabled && window.updateCutButtonEnabled(); } catch(e){}
          hideSilenceModal();
          lastSilenceSelection = null;
        } catch(err) {
          console.error('Silence apply failed', err);
          if (noteEl) noteEl.textContent = 'Silence failed. Please adjust the input and try again.';
          alert('Silence failed: ' + (err && err.message ? err.message : String(err)));
          try { window.__spectroWait && window.__spectroWait.hide(); } catch(e){}
        } finally {
          await resumePlaybackIfNeeded(wasPlaying);
          try { window.__spectroWait && window.__spectroWait.hide(); } catch(e){}
          silenceApply.disabled = false;
          if (silenceCancel) silenceCancel.disabled = false;
          silenceBtn.disabled = false;
        }
      });
    }
  }
})();
