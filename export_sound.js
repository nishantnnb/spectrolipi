// export_sound.js
// Moved export UI & WAV encoding logic from spectrogram.js into its own file.
(function(){
  // DOM refs for export modal
  const exportBtn = document.getElementById('exportBtn');
  const exportModal = document.getElementById('exportModal');
  const exportInfo = document.getElementById('exportInfo');
  const exportSampleRate = document.getElementById('exportSampleRate');
  const exportEncoding = document.getElementById('exportEncoding');
  const exportEstimate = document.getElementById('exportEstimate');
  const exportCancel = document.getElementById('exportCancel');
  const exportDo = document.getElementById('exportDo');

  function humanBytes(n){ if(!isFinite(n)) return '—'; const units=['B','KB','MB','GB']; let i=0; while(n>=1024 && i<units.length-1){ n/=1024; i++; } return n.toFixed(2)+' '+units[i]; }

  function updateExportInfo(){
    const buf = globalThis._spectroAudioBuffer;
    if (!buf) { if (exportInfo) exportInfo.textContent = 'No audio loaded'; if (exportEstimate) exportEstimate.textContent = 'Estimated size: —'; if (exportDo) exportDo.disabled=true; return; }
    const origSR = buf.sampleRate || 44100; const chans = buf.numberOfChannels || 1; const dur = buf.duration || (buf.length / origSR);
    if (exportInfo) exportInfo.textContent = `Detected: ${origSR} Hz · ${chans} ch · ${dur.toFixed(2)} s`;
    const srSel = (exportSampleRate && exportSampleRate.value) ? exportSampleRate.value : 'orig';
    const targetSR = (srSel==='orig') ? origSR : Number(srSel);
    const enc = (exportEncoding && exportEncoding.value) ? exportEncoding.value : '24';
    const bytesPerSample = enc==='16' ? 2 : (enc==='24' ? 3 : 4);
    const est = Math.round(dur * targetSR * chans * bytesPerSample);
    if (exportEstimate) exportEstimate.textContent = 'Estimated size: ' + humanBytes(est);
    if (exportDo) exportDo.disabled = false;
  }

  if (exportBtn) exportBtn.addEventListener('click', (ev)=>{ ev.preventDefault(); if (!exportModal) return; try { exportModal.style.display='block'; updateExportInfo(); } catch(e){} });
  if (exportCancel) exportCancel.addEventListener('click', (ev)=>{ ev.preventDefault(); if (!exportModal) return; exportModal.style.display='none'; });

  if (exportSampleRate) exportSampleRate.addEventListener('change', updateExportInfo);
  if (exportEncoding) exportEncoding.addEventListener('change', updateExportInfo);

  function showWaitOverlay(msg){ try { const w = document.getElementById('waitOverlay'); if (w) { w.style.display='block'; const m = document.querySelector('#waitOverlay .msg'); if (m) m.textContent = msg || 'Exporting...'; } } catch(e){} }
  function hideWaitOverlay(){ try { const w = document.getElementById('waitOverlay'); if (w) { w.style.display='none'; } } catch(e){} }

  async function resampleIfNeeded(buf, targetSR){
    if (!buf) return null;
    if (!targetSR || targetSR === buf.sampleRate) return buf;
    try {
      const numCh = buf.numberOfChannels || 1;
      const offline = new (globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext)(numCh, Math.ceil(buf.duration * targetSR), targetSR);
      const src = offline.createBufferSource();
      src.buffer = buf;
      src.connect(offline.destination);
      src.start(0);
      const rendered = await offline.startRendering();
      return rendered;
    } catch(e){ console.warn('Resample failed', e); return buf; }
  }

  function encodeWAV(buffer, bitDepth){
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length;
    const bytesPerSample = (bitDepth === 16) ? 2 : (bitDepth === 24 ? 3 : 4);
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = length * blockAlign;
    const bufferOut = new ArrayBuffer(44 + dataSize);
    const view = new DataView(bufferOut);
    function writeString(view, offset, str){ for (let i=0;i<str.length;i++) view.setUint8(offset+i, str.charCodeAt(i)); }
    writeString(view, 0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true); view.setUint32(24, sampleRate, true); view.setUint32(28, byteRate, true); view.setUint16(32, blockAlign, true); view.setUint16(34, bytesPerSample*8, true);
    writeString(view, 36, 'data'); view.setUint32(40, dataSize, true);
    let offset = 44;
    const chData = [];
    for (let c=0;c<numChannels;c++) chData.push(buffer.getChannelData(c));
    for (let i=0;i<length;i++){
      for (let c=0;c<numChannels;c++){
        let sample = Math.max(-1, Math.min(1, chData[c][i] || 0));
        if (bitDepth === 16){ const s = Math.round(sample * 32767); view.setInt16(offset, s, true); offset += 2; }
        else if (bitDepth === 24){ const v = Math.round(sample * 8388607); view.setUint8(offset, v & 0xFF); view.setUint8(offset+1, (v >> 8) & 0xFF); view.setUint8(offset+2, (v >> 16) & 0xFF); offset += 3; }
        else { view.setFloat32(offset, sample, true); offset += 4; }
      }
    }
    return new Blob([view], { type: 'audio/wav' });
  }

  async function doExport(){
    try {
      const buf = globalThis._spectroAudioBuffer;
      if (!buf) { alert('No audio to export'); return; }
      const origSR = buf.sampleRate || 44100;
      const srSel = (exportSampleRate && exportSampleRate.value) ? exportSampleRate.value : 'orig';
      const targetSR = (srSel==='orig') ? origSR : Number(srSel);
      const enc = (exportEncoding && exportEncoding.value) ? exportEncoding.value : '24';
      const bitDepth = (enc === '16') ? 16 : (enc === '24' ? 24 : 32);
      if (exportModal) exportModal.style.display = 'none';
      showWaitOverlay('Preparing export...');
      const useBuf = await resampleIfNeeded(buf, targetSR);
      showWaitOverlay('Encoding WAV...');
      const blob = encodeWAV(useBuf, bitDepth);
      const origName = (window.__currentFileName || (document.getElementById('file') && document.getElementById('file').files && document.getElementById('file').files[0] && document.getElementById('file').files[0].name)) || 'export';
      const base = origName.replace(/\.[^.]+$/, '') + '_edited.wav';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = base; document.body.appendChild(a); a.click(); setTimeout(()=>{ try{ URL.revokeObjectURL(url); a.remove(); } catch(e){} }, 2000);
      hideWaitOverlay();
      // small toast
      try { const t = document.createElement('div'); t.textContent = 'Export complete'; t.style.position='fixed'; t.style.left='50%'; t.style.transform='translateX(-50%)'; t.style.bottom='20px'; t.style.background='rgba(0,0,0,0.8)'; t.style.color='#fff'; t.style.padding='6px 10px'; t.style.borderRadius='6px'; t.style.zIndex='2147483646'; document.body.appendChild(t); setTimeout(()=>{ try { t.remove(); } catch(e){} }, 2000); } catch(e){}
    } catch (e) {
      hideWaitOverlay();
      console.error('Export failed', e);
      alert('Export failed: ' + (e && e.message ? e.message : e));
    }
  }

  if (exportDo) exportDo.addEventListener('click', async (ev)=>{ ev.preventDefault(); exportDo.disabled = true; try { await doExport(); } finally { exportDo.disabled = false; } });

  // Initial update if modal exists
  try { updateExportInfo(); } catch(e){}

})();
