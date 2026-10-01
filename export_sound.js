!function() {
  const exportBtn = document.getElementById("exportBtn");
  const exportModal = document.getElementById("exportModal");
  const exportInfo = document.getElementById("exportInfo");
  const exportSampleRate = document.getElementById("exportSampleRate");
  const exportEncoding = document.getElementById("exportEncoding");
  const exportEstimate = document.getElementById("exportEstimate");
  const exportCancel = document.getElementById("exportCancel");
  const exportDo = document.getElementById("exportDo");
  const exportFileNameInput = document.getElementById("exportFileNameInput");

  function updateUiState() {
    const audioBuf = globalThis._spectroAudioBuffer;
    if (!audioBuf) {
      if (exportInfo) exportInfo.textContent = "No audio loaded";
      if (exportEstimate) exportEstimate.textContent = "Estimated size: —";
      if (exportDo) exportDo.disabled = true;
      return;
    }
    const sr = audioBuf.sampleRate || 44100;
    const ch = audioBuf.numberOfChannels || 1;
    const dur = audioBuf.duration || audioBuf.length / sr;
    if (exportInfo) exportInfo.textContent = `Detected: ${sr} Hz · ${ch} ch · ${dur.toFixed(2)} s`;
    
    const srSel = exportSampleRate && exportSampleRate.value ? exportSampleRate.value : "orig";
    const outSr = srSel === "orig" ? sr : Number(srSel);
    
    const encSel = exportEncoding && exportEncoding.value ? exportEncoding.value : "24";
    const bytesPerSamp = encSel === "16" ? 2 : encSel === "24" ? 3 : 4;
    
    const estimatedBytes = Math.round(dur * outSr * ch * bytesPerSamp);
    if (exportEstimate) {
      exportEstimate.textContent = "Estimated size: " + (function(bytes) {
        if (!isFinite(bytes)) return "—";
        const units = ["B", "KB", "MB", "GB"];
        let u = 0;
        while (bytes >= 1024 && u < units.length - 1) {
          bytes /= 1024;
          u++;
        }
        return bytes.toFixed(2) + " " + units[u];
      })(estimatedBytes);
    }
    
    if (exportFileNameInput) {
      let baseName = globalThis.latestSavedAudioFileName || "export.wav";
      if (globalThis.isAudioDirty) {
        baseName = baseName.replace(/\.[^.]+$/, "") + "_edited.wav";
      }
      exportFileNameInput.value = baseName;
    }
    if (exportDo) exportDo.disabled = false;
  }

  function showWait(msg) {
    try {
      const waitOverlay = document.getElementById("waitOverlay");
      if (waitOverlay) {
        waitOverlay.style.display = "block";
        const msgEl = document.querySelector("#waitOverlay .msg");
        if (msgEl) msgEl.textContent = msg || "Exporting...";
      }
    } catch(e) {}
  }

  function hideWait() {
    try {
      const waitOverlay = document.getElementById("waitOverlay");
      if (waitOverlay) waitOverlay.style.display = "none";
    } catch(e) {}
  }

  async function performExport() {
    try {
      const audioBuf = globalThis._spectroAudioBuffer;
      if (!audioBuf) {
        alert("No audio to export");
        return;
      }
      const sr = audioBuf.sampleRate || 44100;
      
      const srSel = exportSampleRate && exportSampleRate.value ? exportSampleRate.value : "orig";
      const outSr = srSel === "orig" ? sr : Number(srSel);
      
      const encSel = exportEncoding && exportEncoding.value ? exportEncoding.value : "24";
      const bitDepth = encSel === "16" ? 16 : encSel === "24" ? 24 : 32;
      
      if (exportModal) exportModal.style.display = "none";
      showWait("Preparing export...");
      
      const resampledBuf = await (async function(buf, targetSr) {
        if (!buf) return null;
        if (!targetSr || targetSr === buf.sampleRate) return buf;
        try {
          const ch = buf.numberOfChannels || 1;
          const OfflineCtx = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
          const octx = new OfflineCtx(ch, Math.ceil(buf.duration * targetSr), targetSr);
          const src = octx.createBufferSource();
          src.buffer = buf;
          src.connect(octx.destination);
          src.start(0);
          return await octx.startRendering();
        } catch(e) {
          console.warn("Resample failed", e);
          return buf;
        }
      })(audioBuf, outSr);
      
      showWait("Encoding WAV...");
      
      const wavBlob = (function(buf, depth) {
        const ch = buf.numberOfChannels;
        const sRate = buf.sampleRate;
        const len = buf.length;
        const bytesPerSamp = depth === 16 ? 2 : depth === 24 ? 3 : 4;
        const blockAlign = ch * bytesPerSamp;
        const byteRate = sRate * blockAlign;
        const dataSize = len * blockAlign;
        
        const ab = new ArrayBuffer(44 + dataSize);
        const view = new DataView(ab);
        
        function writeStr(v, offset, str) {
          for (let i = 0; i < str.length; i++) {
            v.setUint8(offset + i, str.charCodeAt(i));
          }
        }
        
        writeStr(view, 0, "RIFF");
        view.setUint32(4, 36 + dataSize, true);
        writeStr(view, 8, "WAVE");
        writeStr(view, 12, "fmt ");
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); 
        view.setUint16(22, ch, true);
        view.setUint32(24, sRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, depth, true);
        writeStr(view, 36, "data");
        view.setUint32(40, dataSize, true);
        
        let offset = 44;
        const channels = [];
        for (let i = 0; i < ch; i++) channels.push(buf.getChannelData(i));
        
        for (let i = 0; i < len; i++) {
          for (let c = 0; c < ch; c++) {
            let sample = Math.max(-1, Math.min(1, channels[c][i] || 0));
            if (depth === 16) {
              const val = Math.round(32767 * sample);
              view.setInt16(offset, val, true);
              offset += 2;
            } else if (depth === 24) {
              const val = Math.round(8388607 * sample);
              view.setUint8(offset, val & 255);
              view.setUint8(offset + 1, (val >> 8) & 255);
              view.setUint8(offset + 2, (val >> 16) & 255);
              offset += 3;
            } else {
              view.setFloat32(offset, sample, true);
              offset += 4;
            }
          }
        }
        return new Blob([view], { type: "audio/wav" });
      })(resampledBuf, bitDepth);
      
      let fileName = exportFileNameInput && exportFileNameInput.value.trim() ? exportFileNameInput.value.trim() : "export_edited.wav";
      if (!fileName.toLowerCase().endsWith(".wav")) fileName += ".wav";
      
      const objUrl = URL.createObjectURL(wavBlob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      
      setTimeout(() => {
        try {
          URL.revokeObjectURL(objUrl);
          a.remove();
        } catch(e) {}
      }, 2000);
      hideWait();
      
      globalThis.latestSavedAudioFileName = fileName;
      globalThis.isAudioDirty = false;
      
      if (typeof window.__onExportSuccess === "function") {
        window.__onExportSuccess();
        window.__onExportSuccess = null;
      }
      
      try {
        const toast = document.createElement("div");
        toast.textContent = "Export complete";
        toast.style.position = "fixed";
        toast.style.left = "50%";
        toast.style.transform = "translateX(-50%)";
        toast.style.bottom = "20px";
        toast.style.background = "rgba(0,0,0,0.8)";
        toast.style.color = "#fff";
        toast.style.padding = "6px 10px";
        toast.style.borderRadius = "6px";
        toast.style.zIndex = "2147483646";
        document.body.appendChild(toast);
        setTimeout(() => { try { toast.remove(); } catch(e){} }, 2000);
      } catch(e) {}
      
    } catch(e) {
      hideWait();
      console.error("Export failed", e);
      alert("Export failed: " + (e && e.message ? e.message : e));
    }
  }

  if (exportBtn) {
    exportBtn.addEventListener("click", ev => {
      ev.preventDefault();
      if (exportModal) {
        try {
          exportModal.style.display = "block";
          updateUiState();
        } catch(e) {}
      }
    });
  }
  
  if (exportCancel) {
    exportCancel.addEventListener("click", ev => {
      ev.preventDefault();
      if (exportModal) exportModal.style.display = "none";
      if (typeof window.__onExportCancel === "function") {
        window.__onExportCancel();
        window.__onExportCancel = null;
      }
    });
  }
  
  if (exportSampleRate) exportSampleRate.addEventListener("change", updateUiState);
  if (exportEncoding) exportEncoding.addEventListener("change", updateUiState);
  
  if (exportDo) {
    exportDo.addEventListener("click", async ev => {
      ev.preventDefault();
      exportDo.disabled = true;
      try {
        await performExport();
      } finally {
        exportDo.disabled = false;
      }
    });
  }
  
  try { updateUiState(); } catch(e) {}
}();