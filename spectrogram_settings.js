// spectrogram_settings.js
// Handles the Spectrogram Settings modal from the hamburger menu.
// Saves defaults for Y-Max and FFT size.

(function() {
  function getSettings() {
    try {
      const raw = localStorage.getItem('spectrolipi.settings.v1');
      if (raw) return JSON.parse(raw);
    } catch(e) {}
    return { defaultYMax: 'Nyquist', fftSize: 1024 };
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
      <div style="background:#111;color:#fff;width:90%;max-width:400px;padding:20px;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.1);font-family:system-ui,sans-serif;">
        <h3 style="margin:0 0 16px 0;font-size:18px;font-weight:600;">Spectrogram Settings</h3>
        
        <div style="display:flex;flex-direction:column;gap:16px;">
          <div>
            <label style="display:block;font-size:13px;color:#ccc;margin-bottom:6px;">Default Y Max</label>
            <select id="ss-ymax" style="width:100%;background:#222;border:1px solid #444;color:#fff;padding:8px;border-radius:4px;"></select>
          </div>
          <div>
            <label style="display:block;font-size:13px;color:#ccc;margin-bottom:6px;">FFT size</label>
            <select id="ss-fft" style="width:100%;background:#222;border:1px solid #444;color:#fff;padding:8px;border-radius:4px;">
              <option value="512">512</option>
              <option value="1024">1024</option>
              <option value="2048">2048</option>
              <option value="4096">4096</option>
            </select>
            <div style="font-size:11px;color:#888;margin-top:4px;">Higher FFT size improves frequency resolution but decreases temporal resolution.</div>
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

    wrap.querySelector('#ss-cancel').onclick = () => { wrap.style.display = 'none'; };
    wrap.querySelector('#ss-save').onclick = async () => {
      const s = { defaultYMax: yMaxSelect.value, fftSize: parseInt(fftSelect.value) };
      saveSettings(s);
      wrap.style.display = 'none';
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
    const settings = getSettings();
    
    fftSelect.value = String(settings.fftSize || 1024);
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
})();