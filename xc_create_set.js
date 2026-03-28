// xc_create_set.js
// Combines multiple local annotation files into a single XC Set payload

(function() {
    const MODAL_ID = 'xcCreateSetModal';
    let selectedFolderHandle = null;
  
    function q(id) { return document.getElementById(id); }
  
    function buildModal() {
      const overlay = document.createElement('div');
      overlay.id = MODAL_ID;
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:2147483655;display:none;align-items:center;justify-content:center;backdrop-filter:blur(2px);';
  
      const card = document.createElement('div');
      card.style.cssText = 'background:#111;color:#fff;width:95%;max-width:850px;padding:20px;border-radius:10px;box-shadow:0 12px 36px rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.05);font-family:system-ui,sans-serif;max-height:90vh;overflow-y:auto;';
  
      card.innerHTML = `
        <style>
          #xc-cs-proceed:disabled {
            background: #444 !important;
            color: #888 !important;
            cursor: not-allowed !important;
          }
        </style>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="margin:0;font-size:18px;font-weight:600;">Create Xeno-canto Set</h3>
          <button id="xc-cs-close" style="background:transparent;border:0;color:#9ca3af;font-size:24px;cursor:pointer;line-height:1;">&times;</button>
        </div>
        
        <div style="margin-bottom:16px; display:flex; align-items:center; gap:12px;">
          <button id="xc-cs-pick-folder" type="button" class="seg-btn" style="width:70px;height:auto;padding:4px 8px;font-size:12px;line-height:1.2;white-space:normal;">Select<br>Folder</button>
          <span id="xc-cs-folder-name" style="font-size:13px;color:#aaa;">No folder selected</span>
        </div>
  
        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; margin-bottom:20px;">
          ${createInput('Set Source', 'xc-cs-source', '')}
          ${createInput('Set URI', 'xc-cs-uri', '')}
          ${createInput('Set Name *', 'xc-cs-name', '')}
          ${createInput('Set Creator', 'xc-cs-creator', '')}
          ${createInput('Set Creator ID', 'xc-cs-creator-id', '')}
          ${createInput('Set Owner', 'xc-cs-owner', '')}
          ${createSelect('Set License', 'xc-cs-license', [{value:'',text:''},{value:'CC-BY-4.0',text:'CC-BY-4.0'},{value:'CC-BY-NC-4.0',text:'CC-BY-NC-4.0'}])}
          ${createInput('Project URI', 'xc-cs-project-uri', '')}
          ${createInput('Project Name', 'xc-cs-project-name', '')}
          ${createInput('Funding', 'xc-cs-funding', '')}
          ${createInput('Taxon Coverage', 'xc-cs-taxon', '')}
          ${createInput('Completeness', 'xc-cs-completeness', '')}
        </div>
  
        <div style="margin-bottom:20px;background:#1a1a1a;padding:12px;border-radius:6px;border:1px solid #333;display:flex;gap:24px;">
          <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer;font-size:14px;">
            <input type="checkbox" id="xc-cs-action-export"> Save JSON to selected folder
          </label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:14px;">
            <input type="checkbox" id="xc-cs-action-upload"> Upload directly to Xeno-canto
          </label>
        </div>
  
        <div id="xc-cs-status" style="margin-bottom:12px;font-size:13px;color:#34d399;display:none;"></div>
  
        <div style="display:flex;justify-content:flex-end;gap:10px;">
          <button id="xc-cs-cancel" type="button" style="background:transparent;border:1px solid #4b5563;color:#cbd5e1;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:14px;">Cancel</button>
          <button id="xc-cs-proceed" type="button" class="btn" style="background:#2196F3;color:#fff;border:none;padding:8px 24px;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;" disabled>Create Set</button>
        </div>
      `;
  
      overlay.appendChild(card);

      function updateProceedState() {
          const btn = overlay.querySelector('#xc-cs-proceed');
          const exp = overlay.querySelector('#xc-cs-action-export').checked;
          const upl = overlay.querySelector('#xc-cs-action-upload').checked;
          const nameVal = overlay.querySelector('#xc-cs-name').value.trim();
          btn.disabled = !(selectedFolderHandle && (exp || upl) && nameVal !== '');
      }
      
      // Wiring events
      overlay.querySelector('#xc-cs-close').onclick = () => overlay.style.display = 'none';
      overlay.querySelector('#xc-cs-cancel').onclick = () => overlay.style.display = 'none';
      overlay.querySelector('#xc-cs-pick-folder').onclick = async () => {
          try {
              selectedFolderHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
              q('xc-cs-folder-name').textContent = selectedFolderHandle.name;
              updateProceedState();
          } catch (e) {
              // AbortError is typical if user cancels the picker
              if (e.name !== 'AbortError') alert('Folder picker failed: ' + e.message);
          }
      };
      overlay.querySelector('#xc-cs-proceed').onclick = processFiles;
      overlay.querySelector('#xc-cs-action-export').onchange = updateProceedState;
      overlay.querySelector('#xc-cs-action-upload').onchange = updateProceedState;
      overlay.querySelector('#xc-cs-name').addEventListener('input', updateProceedState);
  
      return overlay;
    }
  
    function createInput(label, id, defaultVal) {
      return `
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label style="font-size:12px;color:#aaa;">${label}</label>
          <input id="${id}" type="text" value="${defaultVal}" style="padding:6px;border-radius:4px;border:1px solid #333;background:#000;color:#fff;font-size:13px;">
        </div>
      `;
    }
  
    function createSelect(label, id, options) {
      const optsHtml = options.map(o => `<option value="${o.value}">${o.text}</option>`).join('');
      return `
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label style="font-size:12px;color:#aaa;">${label}</label>
          <select id="${id}" style="padding:6px;border-radius:4px;border:1px solid #333;background:#000;color:#fff;font-size:13px;">
            ${optsHtml}
          </select>
        </div>
      `;
    }
  
    async function processFiles() {
      const btn = q('xc-cs-proceed');
      const status = q('xc-cs-status');
      btn.disabled = true;
      status.style.display = 'block';
      status.textContent = 'Processing files...';
  
      try {
          const files = [];
          for await (const entry of selectedFolderHandle.values()) {
              if (entry.kind === 'file') {
                  const n = entry.name.toLowerCase();
                  if (n.endsWith('.json')) {
                      files.push(entry);
                  }
              }
          }
          
          if (files.length === 0) {
              alert('No .json files found in the selected folder.');
              btn.disabled = false;
              status.style.display = 'none';
              return;
          }
  
          const xcMap = new Map(); // xc_nr -> { name: string, records: [] }
          const fileLogs = []; // Array of log entries to preserve sequence
          
          for (const entry of files) {
              const file = await entry.getFile();
              
              let text;
              try {
                  text = await file.text();
              } catch (e) {
                  fileLogs.push({ fileName: entry.name, xc_nr: 'N/A', status: 'Failed', reason: 'File read error' });
                  continue;
              }

              let records = [];
              try {
                  const obj = JSON.parse(text);
                  records = obj.annotations || [];
              } catch(e) {
                  fileLogs.push({ fileName: entry.name, xc_nr: 'N/A', status: 'Failed', reason: 'Wrong format / Invalid JSON' });
                  continue;
              }
              
              if (records.length === 0) {
                  fileLogs.push({ fileName: entry.name, xc_nr: 'N/A', status: 'Failed', reason: 'No annotations found in file' });
                  continue;
              }

              // Group records by xc_nr within this file
              const groups = new Map();
              const fallbackMatch = entry.name.match(/XC0*(\d+)/i);
              const fallbackXc = fallbackMatch ? Number(fallbackMatch[1]) : null;

              for (const rec of records) {
                  let nr = rec.xc_nr ? String(rec.xc_nr).trim() : (fallbackXc ? String(fallbackXc) : null);
                  if (!nr) {
                      nr = 'Unknown';
                  }
                  if (!groups.has(nr)) groups.set(nr, []);
                  groups.get(nr).push(rec);
              }

              for (const [xc_nr, grpRecords] of groups.entries()) {
                  const logEntry = { fileName: entry.name, xc_nr: xc_nr, status: 'Pending', reason: '' };
                  fileLogs.push(logEntry);

                  if (xc_nr === 'Unknown') {
                      logEntry.status = 'Failed';
                      logEntry.reason = 'XC record number not available';
                      continue;
                  }

                  const existing = xcMap.get(xc_nr);
                  if (!existing) {
                      xcMap.set(xc_nr, { name: entry.name, records: grpRecords });
                  } else {
                      // Tiebreaker logic: most records, or alphabetical
                      let newWins = false;
                      if (grpRecords.length > existing.records.length) {
                          newWins = true;
                      } else if (grpRecords.length === existing.records.length) {
                          if (entry.name.localeCompare(existing.name) < 0) {
                              newWins = true;
                          }
                      }

                      if (newWins) {
                          xcMap.set(xc_nr, { name: entry.name, records: grpRecords });
                      }
                  }
              }
          }

          // Finalize log entries based on the ultimate winner for each XC number
          for (const log of fileLogs) {
              if (log.status === 'Pending') {
                  const winner = xcMap.get(log.xc_nr);
                  if (winner && winner.name === log.fileName) {
                      log.status = 'Success';
                      log.reason = 'Included';
                  } else if (winner) {
                      log.status = 'Failed';
                      log.reason = `XC record number covered in ${winner.name}`;
                  }
              }
          }
  
          // Assemble final annotations array
          const finalAnnotations = [];
          for (const [xc_nr, data] of xcMap.entries()) {
              for (const rec of data.records) {
                  finalAnnotations.push({ ...rec, xc_nr: xc_nr });
              }
          }
  
          const d = new Date();
          const pad = n => String(n).padStart(2, '0');
          const formattedDate = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}`;
          const baseFileName = `XC_Annotation_Set_${formattedDate}`;

          // Always auto-download the Log file
          let logCsv = 'Serial,JSON file name,XC record number,Success / Failed,Reason\n';
          fileLogs.forEach((log, idx) => {
              const safeName = `"${log.fileName.replace(/"/g, '""')}"`;
              const safeReason = `"${log.reason.replace(/"/g, '""')}"`;
              logCsv += `${idx + 1},${safeName},${log.xc_nr},${log.status},${safeReason}\n`;
          });
          
          try {
              const logHandle = await selectedFolderHandle.getFileHandle(`Log_${baseFileName}.csv`, { create: true });
              const writable = await logHandle.createWritable();
              await writable.write(logCsv);
              await writable.close();
          } catch(e) {
              console.warn('Could not write log directly, falling back to download', e);
              const logBlob = new Blob([logCsv], { type: 'text/csv;charset=utf-8' });
              const logUrl = URL.createObjectURL(logBlob);
              const logA = document.createElement('a');
              logA.href = logUrl;
              logA.download = `Log_${baseFileName}.csv`;
              document.body.appendChild(logA);
              logA.click();
              logA.remove();
              setTimeout(() => URL.revokeObjectURL(logUrl), 2000);
          }

          if (finalAnnotations.length === 0) {
              alert('No valid annotations with XC file numbers were found. Please check the downloaded Log file for details.');
              btn.disabled = false;
              status.style.display = 'none';
              return;
          }
  
          // Construct JSON Header
          const finalJson = {
              set_source: q('xc-cs-source').value.trim(),
              set_uri: q('xc-cs-uri').value.trim(),
              set_name: q('xc-cs-name').value.trim(),
              annotation_software_name_and_version: 'Spectrolipi',
              set_creator: q('xc-cs-creator').value.trim(),
              set_creator_id: q('xc-cs-creator-id').value.trim(),
              set_owner: q('xc-cs-owner').value.trim(),
              set_license: q('xc-cs-license').value.trim(),
              project_uri: q('xc-cs-project-uri').value.trim(),
              project_name: q('xc-cs-project-name').value.trim(),
              funding: q('xc-cs-funding').value.trim(),
              scope: [
                  {
                      taxon_coverage: q('xc-cs-taxon').value.trim(),
                      completeness: q('xc-cs-completeness').value.trim()
                  }
              ],
              annotations: finalAnnotations
          };
  
          const doExport = q('xc-cs-action-export').checked;
          const doUpload = q('xc-cs-action-upload').checked;
  
          if (doExport) {
              status.textContent = 'Exporting JSON...';
              try {
                  const jsonHandle = await selectedFolderHandle.getFileHandle(`${baseFileName}.json`, { create: true });
                  const writable = await jsonHandle.createWritable();
                  await writable.write(JSON.stringify(finalJson, null, 2));
                  await writable.close();
              } catch(e) {
                  console.warn('Could not write JSON directly, falling back to download', e);
                  const blob = new Blob([JSON.stringify(finalJson, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${baseFileName}.json`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  setTimeout(() => URL.revokeObjectURL(url), 2000);
              }
          }
  
          if (doUpload) {
              status.textContent = 'Uploading to Xeno-canto API...';
              const raw = localStorage.getItem('xc.settings.v1');
              if (!raw) throw new Error('XC settings not found. Please configure Xeno-canto settings first.');
              const settings = JSON.parse(raw);
              const token = settings.apiToken || settings.token || '';
              if (!token) throw new Error('XC API token missing in settings.');
  
              const res = await fetch('https://xeno-canto.org/api/2/annotations', {
                  method: 'POST',
                  headers: {
                      'Authorization': `Bearer ${token}`,
                      'Content-Type': 'application/json',
                      'Accept': 'application/json'
                  },
                  body: JSON.stringify(finalJson)
              });
  
              if (!res.ok) {
                  const text = await res.text();
                  throw new Error(`Upload failed (${res.status}): ${text}`);
              }
          }
  
          status.textContent = `Success! Included ${xcMap.size} XC records (${finalAnnotations.length} annotations) from ${files.length} files scanned.`;
          setTimeout(() => q(MODAL_ID).style.display = 'none', 3500);
      } catch (err) {
          alert('Error creating set: ' + err.message);
          status.style.display = 'none';
      } finally {
          btn.disabled = false;
      }
    }
  
    window.__openXcCreateSetModal = function() {
      let m = document.getElementById(MODAL_ID);
      if (!m) { m = buildModal(); document.body.appendChild(m); }
      
      const nameEl = document.getElementById('xc-cs-name');
      if (nameEl) {
          const d = new Date();
          const pad = n => String(n).padStart(2, '0');
          nameEl.value = `Annotation set created on ${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
          nameEl.dispatchEvent(new Event('input')); // Trigger validation state
      }
      
      m.style.display = 'flex';
    }
  })();