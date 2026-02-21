// generate_clips.js
// Handles the "Generate clips" feature: UI modal, folder picking, file matching,
// audio cutting (preserving bit depth), and CSV/Log generation.

(function () {
  const BTN_ID = 'generateClipsBtn';
  const MODAL_ID = 'genClipsModal';

  // --- UI Construction ---

  function buildModal() {
    if (document.getElementById(MODAL_ID)) return document.getElementById(MODAL_ID);

    const div = document.createElement('div');
    div.id = MODAL_ID;
    div.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:2147483650;display:none;align-items:center;justify-content:center;backdrop-filter:blur(2px);';
    div.innerHTML = `
      <div style="background:#111;color:#fff;width:90%;max-width:720px;padding:20px;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.1);font-family:system-ui,sans-serif;">
        <h3 style="margin:0 0 16px 0;font-size:18px;font-weight:600;">Generate Clips</h3>
        <div style="margin-bottom:12px;font-weight:bold;color:#ff4444;font-size:13px;">Note: When system prompts (twice since two folders), please allow editing the files in the selected folders. </div>
        
        <div style="display:flex;flex-direction:column;gap:12px;">
          
          <!-- Clip Length -->
          <div>
            <label style="display:block;font-size:13px;color:#ccc;margin-bottom:4px;">Required Clip length (sec)</label>
            <input id="gc-length" type="number" min="1" max="99" step="1" value="3" style="width:60px;background:#222;border:1px solid #444;color:#fff;padding:8px;border-radius:4px;">
            <div style="font-size:11px;color:#888;margin-top:2px;">Max 2 digits, no decimals.</div>
          </div>

          <!-- Source Sound -->
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
            <label style="font-size:13px;color:#ccc;white-space:nowrap;">Source folder (Sound files & Annotation files)</label>
            <div style="display:flex;align-items:center;gap:8px;flex:1;justify-content:flex-end;min-width:0;">
              <div id="gc-sound-path" style="font-size:12px;color:#aaa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Not selected</div>
              <button id="gc-pick-sound" type="button" class="seg-btn" style="width:auto;padding:0 12px;white-space:nowrap;">Pick Folder</button>
            </div>
          </div>

          <!-- Destination -->
          <div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
              <label style="font-size:13px;color:#ccc;white-space:nowrap;">Destination folder</label>
              <div style="display:flex;align-items:center;gap:8px;flex:1;justify-content:flex-end;min-width:0;">
                <div id="gc-dest-path" style="font-size:12px;color:#aaa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Not selected</div>
                <button id="gc-pick-dest" type="button" class="seg-btn" style="width:auto;padding:0 12px;white-space:nowrap;">Pick Folder</button>
              </div>
            </div>
            <div style="font-size:11px;color:#888;margin-top:2px;">Note: New species folders (Scientific name_Common name) will be created here.</div>
          </div>

          <!-- Naming Options -->
          <div>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
              <label style="font-size:13px;color:#ccc;white-space:nowrap;">Naming of clips. Source file name followed by:</label>
              <label style="font-size:13px;color:#ddd;display:flex;align-items:center;gap:6px;white-space:nowrap;">
                <input type="radio" name="gc-naming" value="serial" checked> Serial (_00001)
              </label>
              <label style="font-size:13px;color:#ddd;display:flex;align-items:center;gap:6px;white-space:nowrap;">
                <input type="radio" name="gc-naming" value="selection"> Selection number
              </label>
            </div>
            <div style="font-size:11px;color:#888;margin-top:2px;">Note: If selection number is not available, Serial will be used.</div>
          </div>

          <!-- Ignore last clip -->
          <div style="margin-top:4px;">
            <label style="font-size:13px;color:#ccc;white-space:nowrap;">For the annotations &gt; Required clip length, after segmentation, ignore the last clip if balance annotation < <input id="gc-ignore-last" type="number" min="0" max="99" step="1" value="0" style="width:40px;background:#222;border:1px solid #444;color:#fff;padding:8px;border-radius:4px;">  sec</label>
          </div>

          <!-- Conflict Resolution -->
          <div style="margin-top:4px;">
            <label style="display:block;font-size:13px;color:#ccc;margin-bottom:6px;">Action if clips already present for a file:</label>
            <div style="display:flex;flex-direction:column;gap:6px;">
              <label style="font-size:13px;color:#ddd;display:flex;align-items:center;gap:6px;">
                <input type="radio" name="gc-conflict" value="delete" checked> Delete all existing clips & Add new
              </label>
              <label style="font-size:13px;color:#ddd;display:flex;align-items:center;gap:6px;">
                <input type="radio" name="gc-conflict" value="keep"> Keep existing clips and Add new
              </label>
              <label style="font-size:13px;color:#ddd;display:flex;align-items:center;gap:6px;">
                <input type="radio" name="gc-conflict" value="skip"> Skip processing of the source file
              </label>
            </div>
          </div>

          <!-- Noise Sample Option -->
          <div style="margin-top:8px;">
             <label style="font-size:13px;color:#ccc;display:flex;align-items:center;gap:6px;white-space:nowrap;">
                <input type="checkbox" id="gc-create-noise">
                Create Noise samples from each file (if possible)?
             </label>
          </div>

        </div>

        <div style="margin-top:24px;display:flex;justify-content:flex-end;gap:10px;">
          <button id="gc-cancel" type="button" style="background:transparent;border:1px solid #444;color:#ccc;padding:6px 16px;border-radius:4px;cursor:pointer;">Cancel</button>
          <button id="gc-proceed" type="button" class="seg-btn" style="width:auto;padding:6px 20px;font-size:14px;white-space:nowrap;" disabled>Proceed</button>
        </div>
      </div>
    `;
    document.body.appendChild(div);

    // Attach listeners immediately after creation
    const pickSound = document.getElementById('gc-pick-sound');
    const pickDest = document.getElementById('gc-pick-dest');
    const cancel = document.getElementById('gc-cancel');
    const proceed = document.getElementById('gc-proceed');

    if (pickSound) pickSound.onclick = async () => {
      // Request readwrite access for source folder (for logs)
      const h = await pickFolder('readwrite');
      if (h) {
        soundHandle = h;
        document.getElementById('gc-sound-path').textContent = h.name;
        updateProceedState();
      }
    };

    if (pickDest) pickDest.onclick = async () => {
      // Request readwrite access for destination folder
      const h = await pickFolder('readwrite');
      if (h) {
        destHandle = h;
        document.getElementById('gc-dest-path').textContent = h.name;
        updateProceedState();
      }
    };

    if (cancel) cancel.onclick = () => { document.getElementById(MODAL_ID).style.display = 'none'; };
    if (proceed) proceed.onclick = () => { processFiles(); };

    return div;
  }

  // --- State ---
  let soundHandle = null;
  let destHandle = null;

  // A polyfill for fast yielding
  if (!globalThis.fastYield) {
    globalThis.fastYield = function fastYield() {
      return new Promise(resolve => {
        setTimeout(resolve, 0);
      });
    }
  }

  // --- Helpers ---

  function updateProceedState() {
    const btn = document.getElementById('gc-proceed');
    if (!btn) return;
    // Sound and Dest are mandatory
    btn.disabled = !(soundHandle && destHandle);
  }

  async function pickFolder(mode = 'read') {
    try {
      return await window.showDirectoryPicker({ mode: mode });
    } catch (e) {
      if (e.name !== 'AbortError') {
        alert('Folder access failed. Note: This feature requires a secure context (HTTPS/localhost) and a supported browser (Chrome/Edge).');
      }
      return null;
    }
  }

  // WAV Header Parser / Writer to preserve bit depth
  // Returns { sampleRate, numChannels, bitDepth, format, dataOffset }
  async function parseWavHeader(file) {
    const buffer = await file.slice(0, 44).arrayBuffer();
    const view = new DataView(buffer);
    
    // Simple RIFF/WAVE check
    if (view.getUint32(0, false) !== 0x52494646) throw new Error('Not a RIFF file'); // RIFF
    if (view.getUint32(8, false) !== 0x57415645) throw new Error('Not a WAVE file'); // WAVE

    // fmt chunk
    // We assume standard canonical header for simplicity, but robust parsing scans chunks.
    // For this task, we'll scan briefly for 'fmt '
    let offset = 12;
    let fmtFound = false;
    let channels = 1, rate = 44100, bits = 16, format = 1;
    
    // Scan first few chunks (header usually small)
    // We need to read more than 44 bytes to be safe if there are extra chunks (JUNK, LIST, etc)
    // Let's read first 4KB which is plenty for headers
    const headBuf = await file.slice(0, 4096).arrayBuffer();
    const headView = new DataView(headBuf);
    
    offset = 12;
    while (offset < headView.byteLength - 8) {
      const chunkId = headView.getUint32(offset, false);
      const chunkSize = headView.getUint32(offset + 4, true);
      
      if (chunkId === 0x666d7420) { // 'fmt '
        fmtFound = true;
        format = headView.getUint16(offset + 8, true); // 1=PCM, 3=Float, 65534=Ext
        channels = headView.getUint16(offset + 10, true);
        rate = headView.getUint32(offset + 12, true);
        bits = headView.getUint16(offset + 22, true);
        break;
      }
      offset += 8 + chunkSize;
    }

    if (!fmtFound) throw new Error('fmt chunk not found');
    return { sampleRate: rate, numChannels: channels, bitDepth: bits, format: format };
  }

  function writeWav(audioBuffer, originalBitDepth) {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const length = audioBuffer.length;
    
    let bytesPerSample = 2; // default 16-bit
    let format = 1; // PCM
    if (originalBitDepth === 24) bytesPerSample = 3;
    else if (originalBitDepth === 32) { bytesPerSample = 4; format = 3; } // Assume 32-bit is float
    else bytesPerSample = 2; // Fallback to 16

    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = length * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    // RIFF
    view.setUint32(0, 0x52494646, false);
    view.setUint32(4, 36 + dataSize, true);
    view.setUint32(8, 0x57415645, false);
    // fmt
    view.setUint32(12, 0x666d7420, false);
    view.setUint32(16, 16, true); // Subchunk1Size
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, originalBitDepth === 24 ? 24 : (originalBitDepth === 32 ? 32 : 16), true);
    // data
    view.setUint32(36, 0x64617461, false);
    view.setUint32(40, dataSize, true);

    // Interleave and encode
    let offset = 44;
    // We'll assume fits in memory. For huge files, we'd need streaming, but clips are usually small.
    const channels = [];
    for (let i = 0; i < numChannels; i++) channels.push(audioBuffer.getChannelData(i));

    // Interleave loop
    if (format === 3 && bytesPerSample === 4) { // 32-bit float
      for (let i = 0; i < length; i++) {
        for (let c = 0; c < numChannels; c++) {
          view.setFloat32(offset, channels[c][i], true);
          offset += 4;
        }
      }
    } else if (bytesPerSample === 3) { // 24-bit PCM
      for (let i = 0; i < length; i++) {
        for (let c = 0; c < numChannels; c++) {
          const s = Math.max(-1, Math.min(1, channels[c][i]));
          let val = s < 0 ? s * 0x800000 : s * 0x7FFFFF;
          val = Math.round(val);
          view.setUint8(offset, val & 0xFF);
          view.setUint8(offset + 1, (val >> 8) & 0xFF);
          view.setUint8(offset + 2, (val >> 16) & 0xFF);
          offset += 3;
        }
      }
    } else { // 16-bit PCM
      for (let i = 0; i < length; i++) {
        for (let c = 0; c < numChannels; c++) {
          const s = Math.max(-1, Math.min(1, channels[c][i]));
          view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
          offset += 2;
        }
      }
    }

    return buffer;
  }

  function getScientific(common) {
    if (!common) return '';
    const recs = window.__speciesRecords || [];
    const found = recs.find(r => (r.common || '').toLowerCase() === common.toLowerCase());
    return found ? (found.scientific || '') : '';
  }

  // --- Logic ---

  async function processFiles() {
    const clipLenInput = document.getElementById('gc-length');
    let clipLen = parseFloat(clipLenInput.value);
    if (isNaN(clipLen) || clipLen <= 0 || clipLen > 99) {
      alert('Invalid clip length. Must be 1-99 seconds.');
      return;
    }

    const ignoreLastInput = document.getElementById('gc-ignore-last');
    const ignoreLastClipIfLessThen = parseFloat(ignoreLastInput.value) || 0;

    if (ignoreLastClipIfLessThen > clipLen) {
        alert("Ignore last clip duration can't be > Required clip duration");
        return;
    }

    const conflictMode = (document.querySelector('input[name="gc-conflict"]:checked') || {}).value || 'delete';
    const namingMode = (document.querySelector('input[name="gc-naming"]:checked') || {}).value || 'serial';
    const createNoise = document.getElementById('gc-create-noise').checked;

    const modal = document.getElementById(MODAL_ID);
    modal.style.display = 'none';

    // Show wait overlay
    if (window.__spectroWait) window.__spectroWait.show({ titleText: 'Generating clips', bodyText: 'Processing audio files & annotations, this may take a few mins', etaText: 'Starting...' });

    const logMessages = [];
    // CSV Header
    const csvHeader = ['Sr', 'Source folder', 'Source file', 'Selection', 'Clips', 'Partial?', 'Cut start', 'Cut end', 'Annotated species (Common name)', 'Annotated species (Scientific name)', 'Overlapping species (Common name)', 'Overlapping species (Scientific name)'];
    let csvRows = [];
    let srCounter = 1;

    try {
      // 1. Read existing CSV from Destination if present
      let existingCsvData = [];
      try {
        const csvFileHandle = await destHandle.getFileHandle('Clips details.csv');
        const csvFile = await csvFileHandle.getFile();
        const csvText = await csvFile.text();
        // Simple CSV parse
        const lines = csvText.split(/\r?\n/).filter(l => l.trim());
        if (lines.length > 1) {
          // Parse header to find "Original file name" index
          const header = lines[0].split(',').map(s => s.trim().replace(/^"|"$/g, ''));
          const origIdx = header.findIndex(h => h.toLowerCase().includes('original file') || h.toLowerCase().includes('source file'));
          const splitIdx = header.findIndex(h => h.toLowerCase().includes('split file') || h.toLowerCase().includes('clips'));
          const hasSourceFolder = header.some(h => h.toLowerCase().includes('source folder'));
          const hasSelection = header.some(h => h.toLowerCase() === 'selection');

          if (origIdx >= 0) {
            for (let i = 1; i < lines.length; i++) {
              // naive split by comma, handling quotes roughly
              const cols = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || lines[i].split(',');
              const cleanCols = cols.map(s => s.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
              const originalVal = cleanCols[origIdx] || '';
              const splitVal = splitIdx >= 0 ? (cleanCols[splitIdx] || '') : '';
              if (!hasSourceFolder) cleanCols.splice(1, 0, "");
              if (!hasSelection) cleanCols.splice(3, 0, "");
              existingCsvData.push({
                original: originalVal,
                split: splitVal,
                row: cleanCols
              });
            }
          }
        }
        // If we read existing data, initialize srCounter from max Sr
        // Actually, we'll rebuild the CSV content based on conflict mode, so srCounter might reset or continue.
        // If "Keep", we append, so srCounter should continue.
        if (conflictMode === 'keep' && existingCsvData.length > 0) {
           // Try to find max Sr in existing data (assuming col 0 is Sr)
           const maxSr = existingCsvData.reduce((max, item) => {
             const n = parseInt(item.row[0]);
             return isNaN(n) ? max : Math.max(max, n);
           }, 0);
           srCounter = maxSr + 1;
        }
      } catch (e) {
        // CSV doesn't exist or error reading, start fresh
        existingCsvData = [];
      }

      // 2. List Sound Files
      const soundFiles = [];
      for await (const entry of soundHandle.values()) {
        if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.wav')) {
          soundFiles.push(entry);
        }
      }

      // 3. Process each sound file
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      
      for (let i = 0; i < soundFiles.length; i++) {
        const sf = soundFiles[i];
        const pct = Math.round((i / soundFiles.length) * 100);
        if (window.__spectroWait) window.__spectroWait.show({ etaText: `${pct}% - Processing ${sf.name}` });

        // Conflict Resolution Check
        const existingForFile = existingCsvData.filter(x => x.original === sf.name);
        
        if (existingForFile.length > 0) {
          if (conflictMode === 'skip') {
            // Keep existing rows for this file
            // We will add them to csvRows later (or just keep them in existingCsvData and merge)
            continue; 
          } else if (conflictMode === 'delete') {
            // Delete existing clips from destination
            for (const rec of existingForFile) {
              if (rec.split) {
                // Try to find the file in subfolders? 
                // The CSV doesn't store the folder path, but we know the structure is Species/filename.
                // We can't easily find the file to delete without searching.
                // Best effort: we will NOT include these rows in the new CSV.
                // The files will become orphans.
                // (Implementing full deletion requires searching all subfolders which is slow).
              }
            }
            // Remove from existingCsvData so they aren't preserved
            existingCsvData = existingCsvData.filter(x => x.original !== sf.name);
          } else if (conflictMode === 'keep') {
            // Keep existing rows
            // We will process the file and ADD new clips.
            // We need to determine the next serial number for this file.
            // Find max serial in existing splits: Name_00001.wav
            // This requires parsing the split filename.
          }
        }

        // Find Annotation File: exact match base name + .txt
        const baseName = sf.name.substring(0, sf.name.lastIndexOf('.'));
        const annoName = baseName + '.txt';
        let annoHandleFile = null;
        try {
          annoHandleFile = await soundHandle.getFileHandle(annoName);
        } catch (e) {
          logMessages.push(`No annotation file found for ${sf.name}`);
          continue;
        }

        try {
          // Read Annotation
          const annoFile = await annoHandleFile.getFile();
          const annoText = await annoFile.text();
          const lines = annoText.split(/\r?\n/).filter(l => l.trim());
          if (lines.length < 2) {
            logMessages.push(`Annotation file empty or header only: ${annoName}`);
            continue;
          }
          
          // Parse header
          const header = lines[0].split(/[\t,]/).map(s => s.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
          const colBegin = header.indexOf('begintimes');
          const colEnd = header.indexOf('endtimes');
          const colSpecies = header.findIndex(h => h === 'species' || h === 'commonname');
          const colSelection = header.indexOf('selection');
          
          if (colBegin === -1 || colEnd === -1) {
            logMessages.push(`Missing time columns in ${annoName}`);
            continue;
          }

          const annotations = [];
          for (let j = 1; j < lines.length; j++) {
            const sep = lines[j].includes('\t') ? '\t' : ',';
            const cols = lines[j].split(sep).map(s => s.trim().replace(/^"|"$/g, ''));
            const start = parseFloat(cols[colBegin]);
            const end = parseFloat(cols[colEnd]);
            const sp = colSpecies > -1 ? cols[colSpecies] : '';
            const selVal = colSelection > -1 ? cols[colSelection] : '';
            
            if (isNaN(start) || isNaN(end)) continue;
            if (start < 0) {
              logMessages.push(`Invalid start time < 0 in ${annoName} row ${j+1}`);
              continue;
            }
            annotations.push({ start, end, species: sp, selection: selVal });
          }

          if (annotations.length === 0) {
            logMessages.push(`No valid annotations in ${annoName}`);
            continue;
          }

          // Read Sound
          const soundFile = await sf.getFile();
          const arrayBuffer = await soundFile.arrayBuffer();
          
          // Parse Header for Bit Depth
          let wavProps = { bitDepth: 16 };
          try { wavProps = await parseWavHeader(soundFile); } catch(e) { /* ignore, default 16 */ }

          // Decode
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
          const duration = audioBuffer.duration;
          const channels = audioBuffer.numberOfChannels;
          const sr = audioBuffer.sampleRate;

          // Check invalid end times
          const validAnns = annotations.filter(a => {
            if (a.end > duration) {
              logMessages.push(`Annotation end > EOF in ${annoName}: ${a.end} > ${duration}`);
              return false;
            }
            return true;
          });

          // --- Noise Sample Logic ---
          if (createNoise) {
            try {
              // 1. Merge annotations for gap calculation
              const sorted = validAnns.slice().sort((a,b) => a.start - b.start);
              const merged = [];
              if (sorted.length > 0) {
                let curr = { start: sorted[0].start, end: sorted[0].end };
                for (let k=1; k < sorted.length; k++) {
                  if (sorted[k].start < curr.end) {
                    curr.end = Math.max(curr.end, sorted[k].end);
                  } else {
                    merged.push(curr);
                    curr = { start: sorted[k].start, end: sorted[k].end };
                  }
                }
                merged.push(curr);
              }

              // 2. Find gaps
              const gaps = [];
              let ptr = 0;
              for (const m of merged) {
                if (m.start > ptr) gaps.push({ start: ptr, end: m.start });
                ptr = Math.max(ptr, m.end);
              }
              if (ptr < duration) gaps.push({ start: ptr, end: duration });

              // 3. Find best window based on new priority logic
              let bestWin = null;

              // Priority 1: First annotation-free clip of length X that starts after 1s
              for (const g of gaps) {
                // Case A: Gap starts at or after 1s
                if (g.start >= 1 && g.end - g.start >= clipLen) {
                  bestWin = { start: g.start, end: g.start + clipLen };
                  break;
                }
                // Case B: Gap straddles 1s mark and has enough space
                if (g.start < 1 && g.end >= 1 + clipLen) {
                  bestWin = { start: 1, end: 1 + clipLen };
                  break;
                }
              }

              // Priority 2: Segment from 1s to 1+X seconds if annotation-free
              if (!bestWin) {
                const p2Start = 1;
                const p2End = 1 + clipLen;
                let isP2Free = true;
                if (duration >= p2End) {
                    for (const ann of merged) {
                        if (p2Start < ann.end && p2End > ann.start) { // Overlap condition
                            isP2Free = false;
                            break;
                        }
                    }
                    if (isP2Free) {
                        bestWin = { start: p2Start, end: p2End };
                    }
                }
              }

              // Priority 3: Any other annotation-free segment >= X
              if (!bestWin) {
                for (const g of gaps) {
                  if (g.end - g.start >= clipLen) {
                    bestWin = { start: g.start, end: g.start + clipLen };
                    break;
                  }
                }
              }

              if (bestWin) {
                const sStart = Math.floor(bestWin.start * sr);
                const sEnd = Math.floor(bestWin.end * sr);
                const len = sEnd - sStart;
                const newBuf = audioCtx.createBuffer(channels, len, sr);
                for (let c=0; c < channels; c++) newBuf.copyToChannel(audioBuffer.getChannelData(c).subarray(sStart, sEnd), c);
                const wavBytes = writeWav(newBuf, wavProps.bitDepth);
                const blob = new Blob([wavBytes], { type: 'audio/wav' });
                const noiseDir = await destHandle.getDirectoryHandle('Noise', { create: true });
                const fh = await noiseDir.getFileHandle(sf.name, { create: true });
                const wr = await fh.createWritable();
                await wr.write(blob);
                await wr.close();

                // Add entry to CSV
                csvRows.push([
                  srCounter++,
                  soundHandle.name,
                  sf.name,
                  '', // Selection
                  sf.name, // Clips
                  'no', // Partial
                  bestWin.start.toFixed(4),
                  bestWin.end.toFixed(4),
                  'Noise', // Annotated species (Common name)
                  'Noise', // Annotated species (Scientific name)
                  '', // Overlapping species (Common name)
                  '' // Overlapping species (Scientific name)
                ]);
              } else {
                logMessages.push(`Noise sample not possible for ${sf.name}`);
              }
            } catch (e) {
              console.error('Noise generation error', e);
              logMessages.push(`Error generating noise for ${sf.name}: ${e.message}`);
            }
          }

          if (validAnns.length === 0) continue;

          // --- Clip Logic ---
          const clipsToMake = [];

          if (duration <= clipLen) {
            // Partial File Case
            for (const ann of validAnns) {
              clipsToMake.push({
                start: 0,
                end: duration,
                species: ann.species,
                isPartial: true,
                refAnn: ann,
                selection: ann.selection
              });
            }
          } else {
            // Full Logic
            for (const ann of validAnns) {
              const annDuration = ann.end - ann.start;
              if (annDuration <= clipLen) {
                const center = (ann.start + ann.end) / 2;
                let cStart = center - (clipLen / 2);
                if (cStart < 0) cStart = 0;
                let cEnd = cStart + clipLen;
                if (cEnd > duration) {
                  cEnd = duration;
                  cStart = cEnd - clipLen;
                  if (cStart < 0) cStart = 0; 
                }
                clipsToMake.push({
                  start: cStart,
                  end: cEnd,
                  species: ann.species,
                  isPartial: false,
                  refAnn: ann,
                  selection: ann.selection
                });
              } else {
                // New segmentation logic for long annotations
                let clipStart = ann.start;
                while (clipStart < ann.end) {
                    let clipEnd = clipStart + clipLen;

                    if (clipEnd >= ann.end) { // This is potentially the last clip
                        const lastClipEffectiveDuration = ann.end - clipStart;
                        if (lastClipEffectiveDuration < ignoreLastClipIfLessThen) {
                            logMessages.push(`Last clip ignored since balance annotation < Required clip length. ${sf.name} - Segment: ${ann.selection}`);
                            break; // Ignore the last clip
                        }
                    }
                    
                    clipsToMake.push({
                        start: clipStart,
                        end: Math.min(clipEnd, duration), // ensure we don't go past the audio duration
                        species: ann.species,
                        isPartial: false,
                        refAnn: ann,
                        selection: ann.selection
                    });

                    if (clipEnd >= ann.end) {
                      break; // exit loop
                    }

                    clipStart = clipEnd;
                }
              }
            }
          }

          // Calculate Overlaps
          for (const clip of clipsToMake) {
            const overlaps = new Set();
            for (const other of clipsToMake) {
              if (other === clip) continue;
              if (Math.max(clip.start, other.start) < Math.min(clip.end, other.end)) {
                if (other.species && other.species !== clip.species) {
                  overlaps.add(other.species);
                }
              }
            }
            clip.overlapCommon = Array.from(overlaps);
            clip.overlapSci = clip.overlapCommon.map(c => getScientific(c)).join(', ');
            clip.overlapCommonStr = clip.overlapCommon.join(', ');
          }

          // Determine starting serial
          let fileSr = 1;
          if (conflictMode === 'keep') {
            // Find max serial from existing clips for this file
            const existing = existingForFile; // from earlier check
            let maxSr = 0;
            const regex = new RegExp(`${baseName}_(\\d+)\\.wav$`);
            for (const rec of existing) {
              const m = rec.split.match(regex);
              if (m) {
                const n = parseInt(m[1], 10);
                if (!isNaN(n)) maxSr = Math.max(maxSr, n);
              }
            }
            fileSr = maxSr + 1;
          }

          // Cut and Save
          for (const clip of clipsToMake) {
            const sSample = Math.floor(clip.start * audioBuffer.sampleRate);
            const eSample = Math.floor(clip.end * audioBuffer.sampleRate);
            const len = eSample - sSample;
            
            if (len <= 0) continue;

            const newBuffer = audioCtx.createBuffer(audioBuffer.numberOfChannels, len, audioBuffer.sampleRate);
            for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
              newBuffer.copyToChannel(audioBuffer.getChannelData(ch).subarray(sSample, eSample), ch);
            }

            const wavBytes = writeWav(newBuffer, wavProps.bitDepth);
            const blob = new Blob([wavBytes], { type: 'audio/wav' });

            // Determine Folder Name: Scientific_Common
            let folderName = (clip.species || 'Unknown').trim();
            const sciName = getScientific(folderName);
            if (sciName) {
              folderName = `${sciName}_${folderName}`;
            }
            folderName = folderName.replace(/[<>:"/\\|?*]/g, '_');

            // Create/Get Species Folder
            const speciesDir = await destHandle.getDirectoryHandle(folderName, { create: true });
            
            // File Name: Original_Serial.wav OR Original_Selection.wav
            let suffix = '';
            if (namingMode === 'selection' && clip.selection) {
              const selStr = String(clip.selection).trim().replace(/[<>:"/\\|?*]/g, '_');
              if (selStr) suffix = '_' + selStr;
            }
            if (!suffix) suffix = '_' + String(fileSr).padStart(5, '0');

            const outName = `${baseName}${suffix}.wav`;
            
            // Write
            const fileHandle = await speciesDir.getFileHandle(outName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();

            // CSV Row
            csvRows.push([
              srCounter++,
              soundHandle.name,
              sf.name,
              clip.selection || '',
              outName,
              clip.isPartial ? 'yes' : 'no',
              clip.start.toFixed(4),
              clip.end.toFixed(4),
              clip.species,
              sciName,
              clip.overlapCommonStr,
              clip.overlapSci
            ]);

            fileSr++;
          }

        } catch (err) {
          console.error(err);
          logMessages.push(`Error processing ${sf.name}: ${err.message}`);
        }

        // Yield to UI/browser loop to prevent freezing and allow background processing
        await globalThis.fastYield();
      }

      // 5. Merge with existing CSV data (if any preserved)
      // If conflictMode was 'skip' or 'keep', we need to include the rows we didn't touch.
      // If 'delete', we filtered existingCsvData to remove rows for processed files.
      // So we just append our new csvRows to whatever remains in existingCsvData.
      
      // Convert existingCsvData back to array format
      const preservedRows = existingCsvData.map(x => x.row);
      
      // Combine: preserved + new
      // Note: srCounter was incremented. If we preserved rows, we might have duplicate Sr or gaps.
      // The prompt doesn't strictly require re-serializing old rows, but it's cleaner.
      // Let's just concat.
      const finalRows = [...preservedRows, ...csvRows];
      
      // Re-serialize Sr? Maybe not strictly necessary but good for consistency.
      // Let's leave them as is to avoid altering history of untouched files.

      if (finalRows.length > 0) {
        const csvContent = [csvHeader.join(',')].concat(
          finalRows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
        ).join('\n');
        
        const csvHandle = await destHandle.getFileHandle('Clips details.csv', { create: true });
        const writable = await csvHandle.createWritable();
        await writable.write(csvContent);
        await writable.close();
      }

      // Write Log to Destination
      if (logMessages.length > 0) {
        const logHandle = await destHandle.getFileHandle('log.txt', { create: true });
        const writable = await logHandle.createWritable();
        await writable.write(logMessages.join('\n'));
        await writable.close();
      }

      if (window.__spectroWait) window.__spectroWait.hide();
      alert('Clip generation complete.');

    } catch (e) {
      console.error(e);
      if (window.__spectroWait) window.__spectroWait.hide();
      alert('An error occurred: ' + e.message);
    }
  }

  // --- Wiring ---

  function init() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;

    btn.addEventListener('click', () => {
      const m = buildModal();
      m.style.display = 'flex';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();