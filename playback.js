(function () {
  const viewportWrapper = document.getElementById('viewportWrapper');
  const scrollArea = document.getElementById('scrollArea');
  const axisCanvas = document.getElementById('axisCanvas');
  const info = document.getElementById('info');
  const controls = document.getElementById('controls');

  // Play/Pause UI
  // Play button is expected to be present in the page (moved to index.html).
  // Acquire it by id. Do not create it here; if missing, log a warning so pages
  // that embed this script must add the button markup themselves.
  let playBtn = document.getElementById('playPause');
  if (!playBtn) {
    try { console.warn('playPause button not found in DOM. Please add <button id="playPause">Play</button> to index.html'); } catch (e) {}
  }

  // Playhead overlay
  const overlay = document.createElement('canvas');
  overlay.id = 'playheadOverlay';
  overlay.style.position = 'absolute';
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = 60;
  viewportWrapper.style.position = viewportWrapper.style.position || 'relative';
  viewportWrapper.appendChild(overlay);
  const overlayCtx = overlay.getContext('2d', { alpha: true });

  // X-axis overlay (interactive)
  let xAxisCanvas = document.getElementById('xAxisOverlay');
  if (!xAxisCanvas) {
    xAxisCanvas = document.createElement('canvas');
    xAxisCanvas.id = 'xAxisOverlay';
    xAxisCanvas.style.position = 'absolute';
    xAxisCanvas.style.zIndex = 45;
    xAxisCanvas.style.pointerEvents = 'auto';
    viewportWrapper.appendChild(xAxisCanvas);
  }
  const xAxisCtx = xAxisCanvas.getContext('2d', { alpha: true });

  // Footer/time canvas
  let footer = document.getElementById('timeFooter');
  if (!footer) {
    footer = document.createElement('canvas');
    footer.id = 'timeFooter';
    footer.style.position = 'absolute';
    viewportWrapper.appendChild(footer);
  }
  const fCtx = footer.getContext('2d', { alpha: false });

  // Controls we must disable during playback
  const xzoomSelect = document.getElementById('xzoom');
  const ymaxInput = document.getElementById('ymax');
  const regenBtn = document.getElementById('go');

  // Timing/state
  let audioCtx = null;
  let source = null;
  let startedAt = 0;
  let pausedAt = 0;
  let playbackMeta = null;
  let isPlaying = false;
  let rafId = null;
  let startInProgress = false;
  let reachedEOF = false; // tracks natural EOF
  const EPS = 1e-6;
  const dpr = window.devicePixelRatio || 1;
  const SAMPLE_RATE = globalThis._spectroSampleRate || 44100;

  function quantizeToSample(sec) { const frames = Math.round(sec * SAMPLE_RATE); return frames / SAMPLE_RATE; }

  function readAudioTimestamp() {
    if (!audioCtx) return { ok: false };
    if (typeof audioCtx.getOutputTimestamp === 'function') {
      try {
        const ts = audioCtx.getOutputTimestamp();
        return { ok: true, method: 'getOutputTimestamp', contextTime: ts.contextTime, performanceTime: ts.performanceTime };
      } catch (e) {}
    }
    return { ok: true, method: 'currentTime', contextTime: audioCtx.currentTime, performanceTime: performance.now() / 1000 };
  }

  const START_WAIT_DELTA = 0.001;
  const START_WAIT_TIMEOUT_MS = 250;
  async function waitForAudioTimeAdvance(base) {
    const deadline = performance.now() + START_WAIT_TIMEOUT_MS;
    while (audioCtx && audioCtx.currentTime <= base + START_WAIT_DELTA && performance.now() < deadline) {
      await new Promise(r => setTimeout(r, 4));
    }
  }

  function spectro() {
    return {
      tiles: Array.isArray(globalThis._spectroTiles) ? globalThis._spectroTiles : [],
      pxPerSec: globalThis._spectroPxPerSec || 0,
      imageWidth: globalThis._spectroImageWidth || 0,
      duration: globalThis._spectroDuration || (globalThis._spectroAudioBuffer ? globalThis._spectroAudioBuffer.duration : 0),
      axisLeft: (typeof globalThis._spectroAxisLeft === 'number') ? globalThis._spectroAxisLeft : (axisCanvas ? Math.max(40, axisCanvas.clientWidth || 60) : 60),
      imageHeight: globalThis._spectroImageHeight || 0
    };
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // helper: format seconds as M:SS (zero-padded seconds)
  function formatMMSS(t) {
    const total = Math.max(0, Math.round(t));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ':' + (s < 10 ? '0' + s : s);
  }

  // Format time for a tick given the tick step. If step < 1s, include fractional seconds
  // with enough decimals to represent the step (but clamped to 3 decimals).
  function formatTimeForTick(t, step) {
    if (!isFinite(t) || t < 0) t = 0;
    if (!isFinite(step) || step >= 1) return formatMMSS(t);
    // determine decimals from step (e.g., step=0.1 -> 1 decimal)
    let decimals = Math.ceil(-Math.log10(step));
    if (!isFinite(decimals) || decimals < 1) decimals = 1;
    decimals = Math.min(3, decimals);
    const total = Math.max(0, t);
    const m = Math.floor(total / 60);
    const s = total - m * 60;
    // seconds with decimals, ensure leading zero for seconds < 10
    const secFmt = s.toFixed(decimals);
    // ensure integer seconds are zero-padded to 2 digits when no decimal point
    let secStr = secFmt;
    if (decimals === 0) secStr = (Math.floor(s) < 10 ? '0' + Math.floor(s) : String(Math.floor(s)));
    return m + ':' + secStr;
  }

  // Axis readiness: do not draw or show axis/footer until spectrogram ready
  let axisReady = false;
  function hideAxisCanvases() {
    if (xAxisCanvas) xAxisCanvas.style.display = 'none';
    if (footer) footer.style.display = 'none';
  }
  function showAxisCanvases() {
    if (xAxisCanvas) xAxisCanvas.style.display = '';
    if (footer) footer.style.display = '';
  }
  function isSpectroReady() {
    const s = spectro();
    return Array.isArray(s.tiles) && s.tiles.length && s.pxPerSec && s.imageWidth;
  }

  // Start hidden
  hideAxisCanvases();

  function resizeOverlayToSpectrogram() {
    const s = spectro();
    const axisLeft = s.axisLeft || 60;
    const viewWidth = Math.max(1, scrollArea.clientWidth);
    const viewHeight = Math.max(1, s.imageHeight || (viewportWrapper.clientHeight - 12));

    // Diagnostic: log key values when pxPerSec is large (high zoom) to help debug missing image
    try {
      const pxPerSec = s.pxPerSec || 0;
      if (pxPerSec > 1000 || viewWidth <= 0 || !s.imageWidth) {
        console.warn('[playback] resizeOverlayToSpectrogram diagnostic', { pxPerSec, viewWidth, viewHeight, imageWidth: s.imageWidth, imageHeight: s.imageHeight, tiles: (s.tiles||[]).length });
      }
    } catch (e) { console.warn('[playback] diagnostic log failed', e); }

    overlay.style.left = axisLeft + 'px';
    overlay.style.top = '12px';
    overlay.style.width = viewWidth + 'px';
    overlay.style.height = viewHeight + 'px';
    overlay.width = Math.round(viewWidth * dpr);
    overlay.height = Math.round(viewHeight * dpr);
    overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    xAxisCanvas.style.left = axisLeft + 'px';
    xAxisCanvas.style.top = (12 + viewHeight) + 'px';
    xAxisCanvas.style.width = viewWidth + 'px';
    xAxisCanvas.style.height = '28px';
    xAxisCanvas.width = Math.round(viewWidth * dpr);
    xAxisCanvas.height = Math.round(28 * dpr);
    xAxisCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    footer.style.left = axisLeft + 'px';
    footer.style.top = (12 + viewHeight) + 'px';
    footer.style.width = viewWidth + 'px';
    footer.style.height = '28px';
    footer.width = Math.round(viewWidth);
    footer.height = 28;
  }

  function drawPlayheadAt(screenX) {
    overlayCtx.clearRect(0, 0, overlay.width / dpr, overlay.height / dpr);
    overlayCtx.strokeStyle = '#ff6b6b';
    overlayCtx.lineWidth = Math.max(1, 2);
    const x = Math.max(0, Math.min(overlay.width / dpr - 1, Math.round(screenX)));
    overlayCtx.beginPath();
    overlayCtx.moveTo(x + 0.5, 0);
    overlayCtx.lineTo(x + 0.5, overlay.height / dpr);
    overlayCtx.stroke();
  }

  function renderXAxisTicks() {
    if (!axisReady) return;
    const s = spectro();
    const viewWidth = Math.max(1, scrollArea.clientWidth);
    const leftCol = Math.round(scrollArea.scrollLeft || 0);
    const pxPerSec = s.pxPerSec || 1;
    const leftTime = leftCol / Math.max(1, pxPerSec);

    xAxisCtx.clearRect(0, 0, xAxisCanvas.width / dpr, xAxisCanvas.height / dpr);
    xAxisCtx.fillStyle = '#111';
    xAxisCtx.fillRect(0, 0, viewWidth, 28);

    const secondsVisible = viewWidth / pxPerSec;
    const niceSteps = [0.1,0.2,0.5,1,2,5,10,15,30,60,120];
    let step = niceSteps[0];
    for (let v of niceSteps) { if (v * pxPerSec >= 60) { step = v; break; } step = v; }

    const rightTime = leftTime + secondsVisible;
    const firstTick = Math.floor(leftTime / step) * step;
    xAxisCtx.strokeStyle = 'rgba(255,255,255,0.06)';
    xAxisCtx.fillStyle = '#ddd';
    xAxisCtx.font = '12px sans-serif';
    xAxisCtx.textBaseline = 'top';
    xAxisCtx.textAlign = 'center';

    let lastLabel = null;
    for (let t = firstTick; t <= rightTime + 1e-9; t += step) {
      const cx = Math.round((t - leftTime) * pxPerSec);
      xAxisCtx.beginPath();
      xAxisCtx.moveTo(cx + 0.5, 0);
      xAxisCtx.lineTo(cx + 0.5, 8);
      xAxisCtx.stroke();
      const label = formatTimeForTick(t, step);
      // Avoid drawing duplicate labels (can happen when formatting rounds adjacent ticks to same text)
      if (label !== lastLabel) {
        xAxisCtx.fillText(label, cx, 10);
        lastLabel = label;
      }
    }
  }

  function drawTimeFooter(leftTime) {
    if (!axisReady) return;
    const s = spectro();
    const W = Math.max(1, scrollArea.clientWidth);
    const H = 28;
    fCtx.clearRect(0, 0, W, H);
    fCtx.fillStyle = '#111';
    fCtx.fillRect(0, 0, W, H);
    if (!s.pxPerSec || !s.duration) {
      fCtx.fillStyle = '#888';
      fCtx.font = '12px sans-serif';
      fCtx.textAlign = 'center';
      fCtx.fillText('Time', W / 2, H / 2);
      return;
    }
    const pxPerSec = s.pxPerSec || 1;
    const secondsVisible = W / pxPerSec;
    const niceSteps = [0.1,0.2,0.5,1,2,5,10,15,30,60];
    let step = niceSteps[0];
    for (let v of niceSteps) { if (v * pxPerSec >= 60) { step = v; break; } step = v; }
    const rightTime = leftTime + secondsVisible;
    const firstTick = Math.floor(leftTime / step) * step;
    fCtx.strokeStyle = 'rgba(255,255,255,0.06)';
    fCtx.fillStyle = '#ddd';
    fCtx.font = '12px sans-serif';
    fCtx.textBaseline = 'top';
    fCtx.textAlign = 'center';
    let lastLabelF = null;
    for (let t = firstTick; t <= rightTime + 1e-9; t += step) {
      const cx = Math.round((t - leftTime) * pxPerSec);
      fCtx.beginPath();
      fCtx.moveTo(cx + 0.5, 0);
      fCtx.lineTo(cx + 0.5, 8);
      fCtx.stroke();
      const label = formatTimeForTick(t, step);
      if (label !== lastLabelF) {
        fCtx.fillText(label, cx, 10);
        lastLabelF = label;
      }
    }
  }

  function timeToGlobalX(timeSec) {
    const s = spectro();
    return s.pxPerSec * timeSec;
  }

  // compute authoritative played time
  function computePlayedTimeFromMeta() {
    let played = 0;
    const ts = readAudioTimestamp();
    if (playbackMeta && playbackMeta.method === 'getOutputTimestamp' && ts.ok && ts.method === 'getOutputTimestamp') {
      const elapsed = Math.max(0, ts.contextTime - playbackMeta.startupContextTime);
      played = playbackMeta.startOffset + elapsed;
    } else if (playbackMeta && playbackMeta.method === 'currentTime') {
      const now = audioCtx.currentTime;
      const elapsed = Math.max(0, now - playbackMeta.startupContextTime);
      played = playbackMeta.startOffset + elapsed;
    } else {
      const now = audioCtx ? audioCtx.currentTime : 0;
      played = (now - startedAt) + pausedAt;
    }
    return played;
  }

  function frame() {
    if (!isPlaying) return;
    const s = spectro();
    if (!s.tiles.length || !s.pxPerSec || !s.imageWidth) {
      info && (info.textContent = 'Playback: missing spectrogram or mapping');
      stopAndCleanup(true);
      return;
    }

    const played = computePlayedTimeFromMeta();
    const duration = s.duration || (globalThis._spectroAudioBuffer ? globalThis._spectroAudioBuffer.duration : 0);
    if (played >= duration - EPS) {
      finalizeAtEOF(s);
      return;
    }

    const globalX = Math.round(timeToGlobalX(played));
    const viewWidth = Math.max(1, scrollArea.clientWidth);
    const maxScroll = Math.max(0, s.imageWidth - viewWidth);
    let currentScroll = Math.round(scrollArea.scrollLeft || 0);
    let screenX = globalX - currentScroll;

    if (screenX >= viewWidth - 1) {
      const newScroll = clamp(globalX, 0, maxScroll);
      scrollArea.scrollLeft = newScroll;
      currentScroll = newScroll;
      screenX = globalX - currentScroll;
      resizeOverlayToSpectrogram();
      renderXAxisTicks();
      drawTimeFooter(currentScroll / s.pxPerSec);
    }

    const screenXClamped = clamp(screenX, 0, viewWidth - 1);
    drawPlayheadAt(screenXClamped);
    renderXAxisTicks();

    rafId = requestAnimationFrame(frame);
  }

  function finalizeAtEOF(s) {
    const viewWidth = Math.max(1, scrollArea.clientWidth);
    const maxScroll = Math.max(0, s.imageWidth - viewWidth);
    scrollArea.scrollLeft = maxScroll;
    resizeOverlayToSpectrogram();
    const finalImageX = Math.min(s.imageWidth - 1, Math.round(timeToGlobalX(s.duration)));
    const screenX = clamp(finalImageX - maxScroll, 0, viewWidth - 1);
    drawPlayheadAt(screenX);
    renderXAxisTicks();
    drawTimeFooter(maxScroll / s.pxPerSec);
    stopAndCleanup(true);

    // mark that playback reached EOF naturally
    reachedEOF = true;
  }

  function setControlsWhilePlaying(disabled) {
    if (xzoomSelect) xzoomSelect.disabled = !!disabled;
    if (ymaxInput) ymaxInput.disabled = !!disabled;
    if (regenBtn) regenBtn.disabled = !!disabled;
  }

  function stopAndCleanup(resetOffset) {
    if (source) {
      try { source.onended = null; source.stop(0); source.disconnect(); } catch (e) {}
      source = null;
    }
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (resetOffset) pausedAt = 0;
  isPlaying = false;
  playbackMeta = null;
  if (playBtn) playBtn.textContent = 'Play';
    info && (info.textContent = 'Stopped.');

    // If resetOffset requested (explicit stop/reset), clear EOF flag as well
    if (resetOffset) reachedEOF = false;

    // Re-enable controls now that playback stopped
    setControlsWhilePlaying(false);
  }

  async function captureStartupTimestamp(startOffset) {
    const ts = readAudioTimestamp();
    playbackMeta = { startupContextTime: ts.contextTime, startOffset: startOffset, method: ts.method || 'currentTime' };
    if (playbackMeta.method === 'currentTime' && audioCtx) {
      await waitForAudioTimeAdvance(playbackMeta.startupContextTime);
    }
  }

  async function computePausedAtFromTimestamp() {
    if (!audioCtx) return pausedAt;
    const ts = readAudioTimestamp();
    if (!ts.ok) {
      const now = audioCtx.currentTime;
      const elapsed = Math.max(0, now - startedAt);
      let p = pausedAt + elapsed;
      p = quantizeToSample(p);
      pausedAt = p;
      return pausedAt;
    }
    if (playbackMeta && playbackMeta.startupContextTime != null) {
      const elapsed = Math.max(0, ts.contextTime - playbackMeta.startupContextTime);
      let p = playbackMeta.startOffset + elapsed;
      p = quantizeToSample(p);
      pausedAt = p;
      return pausedAt;
    }
    const now = audioCtx.currentTime;
    const elapsed = Math.max(0, now - startedAt);
    let p = pausedAt + elapsed;
    p = quantizeToSample(p);
    pausedAt = p;
    return pausedAt;
  }

  async function pauseNow() {
    if (startInProgress) {
      const deadline = performance.now() + START_WAIT_TIMEOUT_MS;
      while (startInProgress && performance.now() < deadline) { await new Promise(r => setTimeout(r, 8)); }
    }
    await computePausedAtFromTimestamp();
    if (source) {
      try { source.onended = null; source.stop(0); source.disconnect(); } catch (e) {}
      source = null;
    }
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  isPlaying = false;
  if (playBtn) playBtn.textContent = 'Play';
    info && (info.textContent = 'Paused.');

    // Re-enable controls when paused
    setControlsWhilePlaying(false);
  }

  async function startPlayback() {
    const s = spectro();
    if (!s.tiles.length) { info && (info.textContent = 'Playback: no tiles available (generate spectrogram first)'); return; }
    if (!globalThis._spectroAudioBuffer) { info && (info.textContent = 'Playback: missing audio buffer'); return; }

    // If we are about to start play after reaching EOF and the play offset is at start,
    // automatically reset scroll to leftmost so visual context begins at start.
    if (reachedEOF && pausedAt <= EPS) {
      scrollArea.scrollLeft = 0;
      // Only resize/draw if axis is ready; if not ready, we'll show/draw when spectrogram completes.
      if (axisReady) {
        resizeOverlayToSpectrogram();
        renderXAxisTicks();
        drawTimeFooter(0);
      }
      // clear flag so subsequent resumes behave normally
      reachedEOF = false;
    }

    if (!audioCtx) {
      const CtxClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!CtxClass) { info && (info.textContent = 'AudioContext not supported'); return; }
      audioCtx = new CtxClass();
    }

    // If spectrogram not ready we still must allow audio playback, but visual overlays remain disabled until ready.
    if (axisReady) resizeOverlayToSpectrogram();

    if (pausedAt >= s.duration - EPS) pausedAt = 0;

  startInProgress = true;
  if (playBtn) playBtn.disabled = true;

    // Disable controls while we start/play
    setControlsWhilePlaying(true);

    if (audioCtx.state === 'suspended' && audioCtx.resume) {
      try { await audioCtx.resume(); } catch (e) {}
    }

    if (source) {
      try { source.onended = null; source.stop(0); source.disconnect(); } catch (e) {}
      source = null;
    }

    source = audioCtx.createBufferSource();
    source.buffer = globalThis._spectroAudioBuffer;
    source.connect(audioCtx.destination);

    const startOffset = Math.max(0, pausedAt);
    try {
      source.start(0, startOffset);
    } catch (e) {
      const safeOffset = Math.min(Math.max(0, startOffset), Math.max(0, source.buffer.duration || 0));
      source.start(0, safeOffset);
      playbackMeta = { startupContextTime: audioCtx.currentTime, startOffset: safeOffset, method: 'currentTime' };
    }

    startedAt = audioCtx.currentTime;

    await captureStartupTimestamp(startOffset);

    // ensure initial playhead is visible when user has scrolled ahead:
    // if playhead globalX is left of current viewport, align it to left edge
    try {
      const s2 = spectro();
      const globalX = Math.round(startOffset * (s2.pxPerSec || 1));
      const viewWidth = Math.max(1, scrollArea.clientWidth);
      const maxScroll = Math.max(0, s2.imageWidth - viewWidth);
      const currentScroll = Math.round(scrollArea.scrollLeft || 0);
      if (globalX < currentScroll) {
        const newScroll = Math.max(0, Math.min(maxScroll, globalX));
        scrollArea.scrollLeft = newScroll;
        if (axisReady) {
          resizeOverlayToSpectrogram();
          renderXAxisTicks();
          drawTimeFooter(newScroll / Math.max(1, s2.pxPerSec || 1));
        }
      }
    } catch (e) { /* non-fatal */ }

    source.onended = () => {
      setTimeout(() => { if (isPlaying) finalizeAtEOF(spectro()); }, 50);
    };

  startInProgress = false;
  if (playBtn) playBtn.disabled = false;

  isPlaying = true;
  if (playBtn) playBtn.textContent = 'Pause';
    info && (info.textContent = 'Playing...');

    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    rafId = requestAnimationFrame(frame);

    // optional debug (silent when console disabled)
    try { console.debug && console.debug('[START] startedAt:', startedAt, 'playbackMeta:', playbackMeta, 'pausedAt(before):', pausedAt); } catch(e){}
  }

  // Play/Pause button handler
  if (playBtn) {
    playBtn.addEventListener('click', async () => {
    if (isPlaying) {
      await pauseNow();
      return;
    }
    // Only resize/draw if axis is ready
    if (axisReady) resizeOverlayToSpectrogram();
    const s = spectro();

    // If previous playback ended at EOF, and user presses play (pausedAt ≈ 0), auto-scroll to start.
    if (reachedEOF && pausedAt <= EPS) {
      scrollArea.scrollLeft = 0;
      if (axisReady) {
        resizeOverlayToSpectrogram();
        renderXAxisTicks();
        drawTimeFooter(0);
      }
      reachedEOF = false;
    }

    // Do NOT force scrollLeft to left edge on normal resume.
    const globalX = Math.round(pausedAt * (s.pxPerSec || 1));
    const currentScroll = Math.round(scrollArea.scrollLeft || 0);
    const screenX = globalX - currentScroll;
    if (axisReady) {
      drawPlayheadAt(screenX);
      renderXAxisTicks();
      drawTimeFooter(currentScroll / Math.max(1, s.pxPerSec || 1));
    }

    // Disable controls now that playback will start
    setControlsWhilePlaying(true);

    await startPlayback();
    });
  } else {
    // If the play button is missing, ensure keyboard space toggle still works and warn.
    try { console.warn('playPause button missing: Play/Pause click handler not attached. Use Space to toggle playback.'); } catch (e) {}
  }

  // Interactive axis: cursor and events
  (function setupAxisInteraction(){
    let isPointerDown = false;
    let wasPlayingBeforeDrag = false;
    let lastClientX = 0;

    xAxisCanvas.style.cursor = 'pointer';

    xAxisCanvas.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      // If axis not ready, ignore pointer interactions
      if (!axisReady) return;
      xAxisCanvas.setPointerCapture(ev.pointerId);
      isPointerDown = true;
      lastClientX = ev.clientX;
      wasPlayingBeforeDrag = isPlaying;
      handleAxisSeekPreview(ev.clientX, /*commit*/ false);
    });

    xAxisCanvas.addEventListener('pointermove', (ev) => {
      ev.preventDefault();
      if (!axisReady) return;
      if (isPointerDown) xAxisCanvas.style.cursor = 'col-resize';
      lastClientX = ev.clientX;
      if (isPointerDown) {
        handleAxisSeekPreview(ev.clientX, /*commit*/ false);
      } else {
        xAxisCanvas.style.cursor = 'pointer';
      }
    });

    xAxisCanvas.addEventListener('pointerup', async (ev) => {
      ev.preventDefault();
      if (!axisReady) return;
      xAxisCanvas.releasePointerCapture(ev.pointerId);
      isPointerDown = false;
      xAxisCanvas.style.cursor = 'pointer';
      lastClientX = ev.clientX;
      await handleAxisSeekPreview(ev.clientX, /*commit*/ true);
      if (wasPlayingBeforeDrag) {
        if (!isPlaying) await startPlayback(); // ensure playback resumes
      } else {
        renderXAxisTicks();
        drawTimeFooter((scrollArea.scrollLeft || 0) / Math.max(1, spectro().pxPerSec || 1));
      }
    });

    xAxisCanvas.addEventListener('click', async (ev) => {
      ev.preventDefault();
      if (!axisReady) return;
      const clickedTime = clientXToTime_onAxis(ev.clientX);
      const commitTime = quantizeToSample(clickedTime);

      // Do NOT change scrollLeft. Just position playhead at the clicked screen position.
      pausedAt = commitTime;

      // Update visuals: compute screenX relative to current scrollLeft
      const s = spectro();
      const globalX = Math.round(commitTime * s.pxPerSec);
      const screenX = globalX - Math.round(scrollArea.scrollLeft || 0);
      drawPlayheadAt(screenX);
      renderXAxisTicks();
      drawTimeFooter((scrollArea.scrollLeft || 0) / Math.max(1, s.pxPerSec || 1));

      // If playing, restart source at pausedAt; if not, remain paused
      if (isPlaying) {
        if (source) {
          try { source.onended = null; source.stop(0); source.disconnect(); } catch (e) {}
          source = null;
        }
        await startPlayback();
      } else {
        if (playBtn) playBtn.textContent = 'Play';
      }
    });

    async function handleAxisSeekPreview(clientX, commit) {
      const s = spectro();
      if (!s.pxPerSec || !s.duration) return;
      const desiredTime = clientXToTime_onAxis(clientX);
      const previewTime = clamp(desiredTime, 0, s.duration);
      const previewGlobalX = Math.round(previewTime * s.pxPerSec);

      // IMPORTANT: Do NOT change scrollLeft here (no left-align). Only update visuals in current view.
      const screenX = previewGlobalX - Math.round(scrollArea.scrollLeft || 0);
      // For preview, clamp screenX to visible range but still show at edges if slightly outside
      const viewWidth = Math.max(1, scrollArea.clientWidth);
      const screenXClamped = clamp(screenX, -2, viewWidth + 2); // allow small overflow for visual feedback
      drawPlayheadAt(screenXClamped);
      renderXAxisTicks();
      drawTimeFooter((scrollArea.scrollLeft || 0) / Math.max(1, s.pxPerSec || 1));

      if (commit) {
        const commitTime = quantizeToSample(previewTime);
        pausedAt = commitTime;
        // if playing, restart audio at pausedAt
        if (isPlaying) {
          if (source) {
            try { source.onended = null; source.stop(0); source.disconnect(); } catch (e) {}
            source = null;
          }
          await startPlayback();
        }
      }
    }

    function clientXToTime_onAxis(clientX) {
      const s = spectro();
      const rect = xAxisCanvas.getBoundingClientRect();
      const localX = clientX - rect.left;             // CSS px inside axis overlay
      const leftCol = Math.round(scrollArea.scrollLeft || 0);
      const globalX = leftCol + localX;               // CSS px into full spectrogram
      const desiredTime = clamp(globalX / Math.max(1, s.pxPerSec || 1), 0, s.duration || 0);
      return desiredTime;
    }

    xAxisCanvas.addEventListener('pointercancel', async (ev) => {
      if (!axisReady) return;
      if (!isPointerDown) return;
      isPointerDown = false;
      xAxisCanvas.releasePointerCapture(ev.pointerId);
      await handleAxisSeekPreview(lastClientX, true);
      renderXAxisTicks();
      drawTimeFooter((scrollArea.scrollLeft || 0) / Math.max(1, spectro().pxPerSec || 1));
    });

  })();

  // Sync ticks on manual scroll
  let scrollTickRAF = null;
  scrollArea.addEventListener('scroll', () => {
    // resize overlay regardless (overlay sizing is harmless), but only draw axis when ready
    if (axisReady) resizeOverlayToSpectrogram();
    if (scrollTickRAF) cancelAnimationFrame(scrollTickRAF);
    scrollTickRAF = requestAnimationFrame(() => {
      if (!axisReady) return;
      renderXAxisTicks();
      const s = spectro();
      drawTimeFooter((scrollArea.scrollLeft || 0) / Math.max(1, s.pxPerSec || 1));
    });
  });

  // Spacebar toggles Play/Pause when focus is not in an editable control
  window.addEventListener('keydown', (ev) => {
    try {
      const isSpace = (ev.code === 'Space' || ev.key === ' ' || ev.key === 'Spacebar');
      if (!isSpace) return;
      const active = document.activeElement;
      if (active) {
        const tag = (active.tagName || '').toUpperCase();
        const type = active.getAttribute && (active.getAttribute('type') || '').toLowerCase();
        // ignore when typing in text fields, textareas, or contenteditable elements
        if (tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable) return;
        // also ignore when an input-like control (e.g., range/select) has focus
        if (tag === 'SELECT' || (tag === 'INPUT' && (type === 'text' || type === 'search' || type === 'password' || type === 'email' || type === 'number'))) return;
      }
      // prevent default page scrolling
      ev.preventDefault();
      // toggle play/pause
      if (isPlaying) {
        pauseNow().catch(() => {});
      } else {
        // Only resize/draw if axis is ready (same flow as click handler)
        if (axisReady) resizeOverlayToSpectrogram();
        startPlayback().catch(() => {});
      }
    } catch (e) { /* swallow errors */ }
  });

  // API
  globalThis._playbackScrollJump = {
    start: async () => { if (!isPlaying) await startPlayback(); },
    pause: async () => { if (isPlaying) await pauseNow(); },
    stopAndReset: () => {
      stopAndCleanup(true);
      scrollArea.scrollLeft = 0;
      // only draw if axis is ready
      if (axisReady) {
        resizeOverlayToSpectrogram();
        drawPlayheadAt(0);
        renderXAxisTicks();
        drawTimeFooter(0);
      }
      reachedEOF = false;
    },
    status: () => ({ playing: isPlaying, pausedAt, playbackMeta, audioState: audioCtx ? audioCtx.state : 'none' })
  };

  // Called when spectrogram generator finishes and spectro() becomes ready.
  function onSpectrogramReady() {
    if (axisReady) return;
    axisReady = true;
    showAxisCanvases();
    resizeOverlayToSpectrogram();
    drawPlayheadAt(0);
    renderXAxisTicks();
    drawTimeFooter(0);
    info && (info.textContent = 'Spectrogram ready. Click the X axis to seek and play.');
    // Ensure controls are enabled now that axis exists
    setControlsWhilePlaying(false);
  }

  // initial check and polite polling until spectrogram ready
  (function waitForSpectroThenInit() {
    const s = spectro();
    if (isSpectroReady()) {
      onSpectrogramReady();
      return;
    }
    info && (info.textContent = 'No tiles found. Waiting for spectrogram...');
    const pollId = setInterval(() => {
      if (isSpectroReady()) {
        clearInterval(pollId);
        onSpectrogramReady();
      }
    }, 120);
  })();

  window.addEventListener('resize', () => {
    if (!axisReady) return;
    resizeOverlayToSpectrogram();
    renderXAxisTicks();
  });

})();