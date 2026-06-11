// spectrogram_settings.js
// Handles the Spectrogram Settings modal from the hamburger menu.
// Saves defaults for Y-Max and FFT size.

(function() {
  function getSettings() {
    try {
      const raw = localStorage.getItem('spectrolipi.settings.v1');
      if (raw) return JSON.parse(raw);
    } catch(e) {}
    return { defaultYMax: 'Nyquist', fftSize: 1024, magnifierEnabled: false, annotationMode: 'time-freq', magicPad: 5, magicRepeatSensitivity: false, defaultSpeciesFormat: 'scientific' };
  }

  function saveSettings(s) {
    localStorage.setItem('spectrolipi.settings.v1', JSON.stringify(s));
  }

  function buildModal() {
    const id = 'spectroSettingsModal';
    let wrap = document.getElementById(id);
    if (wrap) return wrap;

    wrap = document.createElement('div');
    wrap.id = id;
    wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:2147483650;display:none;align-items:center;justify-content:center;backdrop-filter:blur(2px);';
    wrap.innerHTML = `
      <div style="background:#111;color:#fff;width:95%;max-width:540px;padding:20px;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.1);font-family:system-ui,sans-serif;">
        <h3 style="margin:0 0 16px 0;font-size:18px;font-weight:600;">Spectrolipi settings</h3>
        
        <div style="display:flex;flex-direction:column;gap:16px;">
          <div>
            <label style="display:block;font-size:13px;color:#ccc;margin-bottom:8px;">Annotation Mode</label>
            <div style="display:flex; gap:16px; flex-wrap: wrap;">
              <label style="font-size:13px;color:#fff;display:flex;align-items:center;gap:6px;cursor:pointer;">
                <input type="radio" name="ss-anno-mode" value="time-freq"> Time-Frequency (Boxes)
              </label>
              <label style="font-size:13px;color:#fff;display:flex;align-items:center;gap:6px;cursor:pointer;">
                <input type="radio" name="ss-anno-mode" value="temporal"> Temporal (Intervals)
              </label>
            </div>
          </div>
          
          <div style="display:flex; align-items:center; gap:8px;">
            <label style="font-size:13px;color:#ccc;">Magic box pad (px)</label>
            <input type="number" id="ss-magic-pad" min="0" max="20" style="width:60px;background:#222;border:1px solid #444;color:#fff;padding:6px;border-radius:4px;">
            <label style="font-size:13px;color:#ccc;display:flex;align-items:center;gap:4px;margin-left:12px;cursor:pointer;">
              <input type="checkbox" id="ss-magic-repeat-sens"> Repeat last sensitivity?
            </label>
            <label style="font-size:13px;color:#ccc;margin-left:12px;">Default species format:</label>
            <select id="ss-species-format" style="width:120px;background:#222;border:1px solid #444;color:#fff;padding:4px;border-radius:4px;font-size:13px;">
              <option value="common">Common name</option>
              <option value="scientific">Scientific name</option>
            </select>
          </div>

          <div style="border-top:1px solid #333; padding-top:12px;">
            <h4 style="margin:0 0 12px 0; font-size:14px; color:#2196F3; font-weight:600;">Spectrogram settings</h4>
            
            <div style="display:flex; gap:16px; align-items: flex-start;">
              <div style="flex: 1;">
                <label style="display:block;font-size:12px;color:#ccc;margin-bottom:4px;">Default Y Max</label>
                <select id="ss-ymax" style="width:100%;background:#222;border:1px solid #444;color:#fff;padding:6px;border-radius:4px;"></select>
              </div>
              <div style="flex: 1;">
                <label style="display:block;font-size:12px;color:#ccc;margin-bottom:4px;">FFT size</label>
                <select id="ss-fft" style="width:100%;background:#222;border:1px solid #444;color:#fff;padding:6px;border-radius:4px;">
                  <option value="512">512</option>
                  <option value="1024">1024</option>
                  <option value="2048">2048</option>
                  <option value="4096">4096</option>
                </select>
              </div>
            </div>
            <div style="font-size:11px;color:#888;margin-top:8px;">Higher FFT size improves frequency resolution. Actual Y max adjusts per file Nyquist.</div>
          </div>
          <div style="display:flex; gap:16px;">
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#ccc;cursor:pointer;">
              <input type="checkbox" id="ss-recent-species" style="cursor:pointer;" checked>
              Turn on Smart list
            </label>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#ccc;cursor:pointer;">
              <input type="checkbox" id="ss-magnifier" style="cursor:pointer;">
              Turn On Magnifier
            </label>
          </div>
          </div>

        <div style="margin-top:24px;display:flex;justify-content:flex-end;gap:10px;">
          <button id="ss-cancel" type="button" style="background:transparent;border:1px solid #444;color:#ccc;padding:6px 16px;border-radius:4px;cursor:pointer;">Cancel</button>
          <button id="ss-save" type="button" class="seg-btn" style="width:auto;padding:6px 22px;font-size:14px;white-space:nowrap;">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);

    const yMaxSelect = wrap.querySelector('#ss-ymax');
    const fftSelect = wrap.querySelector('#ss-fft');
    const magnifierCb = wrap.querySelector('#ss-magnifier');
    const recentSpeciesCb = wrap.querySelector('#ss-recent-species');
    const modeRadios = wrap.querySelectorAll('input[name="ss-anno-mode"]');
    const magicPadInput = wrap.querySelector('#ss-magic-pad');
    const magicRepeatSensCb = wrap.querySelector('#ss-magic-repeat-sens');
    const speciesFormatSelect = wrap.querySelector('#ss-species-format');

    if (magicPadInput) {
      magicPadInput.addEventListener('input', (e) => {
        let v = parseInt(e.target.value, 10);
        if (!isNaN(v)) {
          if (v < 0) e.target.value = 0;
          if (v > 20) e.target.value = 20;
        }
      });
    }

    wrap.querySelector('#ss-cancel').onclick = () => { wrap.style.display = 'none'; };
    wrap.querySelector('#ss-save').onclick = async () => {
      const checkedModeEl = wrap.querySelector('input[name="ss-anno-mode"]:checked');
      const selectedMode = checkedModeEl ? checkedModeEl.value : 'time-freq';
      const s = { defaultYMax: yMaxSelect.value, fftSize: parseInt(fftSelect.value), magnifierEnabled: magnifierCb.checked, recentSpeciesEnabled: recentSpeciesCb.checked, annotationMode: selectedMode, magicPad: parseInt(wrap.querySelector('#ss-magic-pad').value), magicRepeatSensitivity: magicRepeatSensCb.checked, defaultSpeciesFormat: speciesFormatSelect.value };
      saveSettings(s);
      if (typeof window.setFloatingMagnifier === 'function') window.setFloatingMagnifier(s.magnifierEnabled);
      if (typeof window.setFloatingRecentSpecies === 'function') window.setFloatingRecentSpecies(s.recentSpeciesEnabled);
      wrap.style.display = 'none';
      window.dispatchEvent(new CustomEvent('annotation-mode-changed', { detail: { mode: selectedMode } }));
      // If a spectrogram was already computed, re-generate to apply changes
      if ((globalThis._spectroAudioBuffer || globalThis._spectroSpectra) && typeof globalThis._generateSpectrogram === 'function') {
        globalThis._generateSpectrogram();
      }
    };

    return wrap;
  }

  window.__openSpectrogramSettingsModal = function() {
    const wrap = buildModal();
    const yMaxSelect = wrap.querySelector('#ss-ymax');
    const fftSelect = wrap.querySelector('#ss-fft');
    const magicPadInput = wrap.querySelector('#ss-magic-pad');
    const magicRepeatSensCb = wrap.querySelector('#ss-magic-repeat-sens');
    const magnifierCb = wrap.querySelector('#ss-magnifier');
    const recentSpeciesCb = wrap.querySelector('#ss-recent-species');
    const modeRadios = wrap.querySelectorAll('input[name="ss-anno-mode"]');
    const speciesFormatSelect = wrap.querySelector('#ss-species-format');
    const settings = getSettings();
    
    fftSelect.value = String(settings.fftSize || 1024);
    magicPadInput.value = String(settings.magicPad !== undefined && !isNaN(settings.magicPad) ? settings.magicPad : 5);
    magicRepeatSensCb.checked = !!settings.magicRepeatSensitivity;
    magnifierCb.checked = !!settings.magnifierEnabled;
    recentSpeciesCb.checked = settings.recentSpeciesEnabled !== false;
    speciesFormatSelect.value = settings.defaultSpeciesFormat || 'common';

    const currentMode = settings.annotationMode || 'time-freq';
    modeRadios.forEach(r => {
      r.checked = (r.value === currentMode);
    });

    yMaxSelect.innerHTML = '';
    const optNyq = document.createElement('option');
    optNyq.value = 'Nyquist'; optNyq.textContent = 'Nyquist';
    yMaxSelect.appendChild(optNyq);
    const fixedOptions = [24, 21, 18, 15, 12, 9, 6, 3];
    for (const val of fixedOptions) {
        const option = document.createElement('option'); 
        option.value = val; 
        option.textContent = val + ' kHz'; 
        yMaxSelect.appendChild(option);
    }
    if (settings.defaultYMax === 'Nyquist') { yMaxSelect.value = 'Nyquist'; } else { let closest = null; let minDiff = Infinity; const target = parseFloat(settings.defaultYMax); if (!isNaN(target)) { for (let i = 1; i < yMaxSelect.options.length; i++) { const optVal = parseFloat(yMaxSelect.options[i].value); if (Math.abs(optVal - target) < minDiff) { minDiff = Math.abs(optVal - target); closest = yMaxSelect.options[i].value; } } if (closest) yMaxSelect.value = closest; } }
    wrap.style.display = 'flex';
  };

  // Expose alias for main menu
  window.__openSpectrolipiSettingsModal = window.__openSpectrogramSettingsModal;
})();