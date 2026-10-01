!function() {
  if (window.__downloadAnnotationsInit) return;
  window.__downloadAnnotationsInit = true;

  function triggerDownload(blob, filename) {
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
  }

  function safeStr(val) {
    if (val == null) return "";
    if (typeof val === "object") {
      try { return JSON.stringify(val); } catch(e) { return String(val); }
    }
    return String(val);
  }

  function formatNum(val) {
    if (val == null || val === "") return "";
    const n = Number(val);
    return isFinite(n) ? n.toFixed(4) : "";
  }

  const standardHeaders = [
    "File", "Selection", "View", "Channel", "Begin Time (s)", "End Time (s)",
    "Low Freq (Hz)", "High Freq (Hz)", "Common name", "Scientific name", "Sex",
    "Life stage", "Sound type(s)", "Notes"
  ];
  const standardKeys = new Set([
    "id", "beginTime", "begin_time", "begin", "endTime", "end_time", "end",
    "lowFreq", "low_freq", "low", "highFreq", "high_freq", "high", "species",
    "scientificName", "sex", "lifeStage", "soundType", "Sex", "Life stage",
    "Sound type(s)", "file", "File", "notes", "note", "Selection", "View",
    "Channel", "Begin Time (s)", "End Time (s)", "Low Freq (Hz)", "High Freq (Hz)",
    "Species", "Notes", "needsMetadata"
  ]);

  function generateTsvData(annotations) {
    annotations = Array.isArray(annotations) ? annotations : [];
    
    // File column uses the latestSavedAudioFileName
    const fileColValue = globalThis.latestSavedAudioFileName || "export.wav";
    
    const extraHeaders = [];
    const seenExtra = new Set();
    
    annotations.forEach(ann => {
      if (ann && typeof ann === "object") {
        Object.keys(ann).forEach(key => {
          if (!standardKeys.has(key) && !seenExtra.has(key)) {
            seenExtra.add(key);
            extraHeaders.push(key);
          }
        });
      }
    });

    const lines = [standardHeaders.concat(extraHeaders).filter(h => h !== "_select").join("\t")];

    annotations.forEach(ann => {
      const sel = ann && Object.prototype.hasOwnProperty.call(ann, "Selection") ? String(ann.Selection) : "";
      const bTime = ann && Object.prototype.hasOwnProperty.call(ann, "beginTime") ? ann.beginTime : ann && Object.prototype.hasOwnProperty.call(ann, "begin") ? ann.begin : "";
      const eTime = ann && Object.prototype.hasOwnProperty.call(ann, "endTime") ? ann.endTime : ann && Object.prototype.hasOwnProperty.call(ann, "end") ? ann.end : "";
      const lFreq = ann && Object.prototype.hasOwnProperty.call(ann, "lowFreq") ? ann.lowFreq : ann && Object.prototype.hasOwnProperty.call(ann, "low") ? ann.low : "";
      const hFreq = ann && Object.prototype.hasOwnProperty.call(ann, "highFreq") ? ann.highFreq : ann && Object.prototype.hasOwnProperty.call(ann, "high") ? ann.high : "";
      
      const u = ann && Object.prototype.hasOwnProperty.call(ann, "species") ? safeStr(ann.species) : "";
      const h = ann && Object.prototype.hasOwnProperty.call(ann, "scientificName") ? safeStr(ann.scientificName) : "";
      const b = ann && Object.prototype.hasOwnProperty.call(ann, "sex") ? safeStr(ann.sex) : "";
      const g = ann && Object.prototype.hasOwnProperty.call(ann, "lifeStage") ? safeStr(ann.lifeStage) : "";
      const m = ann && Object.prototype.hasOwnProperty.call(ann, "soundType") ? safeStr(ann.soundType) : "";
      const O = ann && Object.prototype.hasOwnProperty.call(ann, "notes") ? safeStr(ann.notes) : "";
      
      const extraVals = extraHeaders.filter(h => h !== "_select").map(hdr => {
        return ann && Object.prototype.hasOwnProperty.call(ann, hdr) ? safeStr(ann[hdr]) : "";
      });
      
      lines.push([
        fileColValue, sel, "1", "1", formatNum(bTime), formatNum(eTime), formatNum(lFreq), formatNum(hFreq),
        u, h, b, g, m, O
      ].concat(extraVals).join("\t"));
    });

    return { content: lines.join("\n") + "\n" };
  }

  function getActiveAnnotations() {
    if (globalThis._annotations && typeof globalThis._annotations.getAll === "function") {
      try { return globalThis._annotations.getAll() || []; } catch(e) {
        console.warn("Failed to read _annotations.getAll()", e);
        return [];
      }
    }
    return Array.isArray(window._annotationsArray) ? window._annotationsArray : [];
  }

  function updateButtonState() {
    const btn = document.getElementById("saveAnnoBtn");
    const fileInput = document.getElementById("file");
    if (btn) {
      try {
        const hasFile = fileInput && fileInput.files && fileInput.files.length > 0;
        const o = hasFile || globalThis.latestSavedAudioFileName;
        const activeAnnos = getActiveAnnotations();
        const hasAnnos = activeAnnos && activeAnnos.length > 0;
        btn.disabled = !(o && (hasAnnos || globalThis.isAudioDirty || globalThis.isAnnotationsDirty));
      } catch(e) {
        btn.disabled = true;
      }
    }
  }

  try {
    if (window.__saveAnnotations && typeof window.__saveAnnotations.saveNow === "function") {
      window.__saveAnnotations.__disabledBy = "download_annotations.js";
      window.__saveAnnotations.saveNow = function() {
        console.warn("Legacy single-button saver disabled by download_annotations.js");
      };
    }
  } catch(e) {}

  function watchFile() {
    const fileInput = document.getElementById("file");
    if (!fileInput) {
      setTimeout(watchFile, 120);
      return;
    }
    updateButtonState();
    fileInput.addEventListener("change", updateButtonState, true);
    new MutationObserver(updateButtonState).observe(fileInput, { attributes: true, attributeFilter: ["value"] });
    setInterval(updateButtonState, 500);
  }

  function performAnnotationSave() {
    try {
      const annotations = getActiveAnnotations();
      
      if ((!annotations || annotations.length === 0) && !globalThis.isAnnotationsDirty) {
        if (typeof window.__onCompleteSaveAndOpenNewFile === "function") {
          setTimeout(window.__onCompleteSaveAndOpenNewFile, 500);
          window.__onCompleteSaveAndOpenNewFile = null;
        }
        return;
      }

      const tsvData = generateTsvData(annotations);
      
      // Filename should precisely match latestSavedAudioFileName but with .txt
      let baseName = globalThis.latestSavedAudioFileName || "export.wav";
      const filename = baseName.replace(/\.[^.]+$/, "") + ".txt";
      
      triggerDownload(new Blob([tsvData.content], { type: "text/plain;charset=utf-8" }), filename);
      
      globalThis.isAnnotationsDirty = false;
      
      try {
        Object.keys(localStorage).forEach(key => {
          if (key.startsWith("annotations_backup::")) {
            try { localStorage.removeItem(key); } catch(e) {}
          }
        });
      } catch(e) {
        console.warn("Backup purge after export failed", e);
      }
      if (typeof window.__onCompleteSaveAndOpenNewFile === "function") {
        setTimeout(window.__onCompleteSaveAndOpenNewFile, 500);
        window.__onCompleteSaveAndOpenNewFile = null;
      }
    } catch(e) {
      console.error("Download annotations failed", e);
      try { window.alert("Download annotations failed. See console for details."); } catch(ex) {}
    }
  }

  function init() {
    const btn = document.getElementById("saveAnnoBtn");
    if (btn && !btn.__downloadAnnoWired) {
      btn.addEventListener("click", function(e) {
        try { if (e && e.preventDefault) e.preventDefault(); } catch(ex) {}
        if (!btn.disabled) {
          if (globalThis.isAudioDirty) {
            window.__onExportSuccess = () => {
              setTimeout(performAnnotationSave, 600);
            };
            window.__onExportCancel = () => {};
            const exportBtn = document.getElementById("exportBtn");
            if (exportBtn) exportBtn.click();
          } else {
            performAnnotationSave();
          }
        }
      }, true);
      btn.__downloadAnnoWired = true;
    }
    watchFile();
    setTimeout(updateButtonState, 200);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.__downloadAnnotations = {
    downloadNow: performAnnotationSave
  };
}();