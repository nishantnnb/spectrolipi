const fs = require('fs');
let code = `!function(){const e="fastVideoExportModal";let t=null,o=null,n=null,i=!1;function a(){let a=document.getElementById(e);if(a)return a;a=document.createElement("div"),a.id=e,a.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:2147483655;display:none;align-items:center;justify-content:center;backdrop-filter:blur(2px);",a.innerHTML='\n      <div style="background:#111;color:#fff;width:95%;max-width:420px;padding:20px;border-radius:10px;border:1px solid rgba(255,255,255,0.05);font-family:system-ui,sans-serif;box-shadow:0 12px 36px rgba(0,0,0,0.4);">\n        <h3 style="margin:0 0 12px 0;font-size:18px;">Fast Video Export</h3>\n        <p style="font-size:13px;color:#ccc;line-height:1.4;margin-bottom:16px;">\n          Export a video of the spectrogram using WebCodecs. \n          This is significantly faster than real-time playback.\n        </p>\n        <div style="background:#1a1a1a;padding:12px;border-radius:6px;border:1px solid #333;margin-bottom:16px;">\n          <div style="display:flex; align-items:center; gap:12px; margin-bottom:10px;">\n            <label style="font-size:13px; color:#ddd; white-space:nowrap; width:115px;">Start at (mm:ss):</label>\n            <div style="display:flex; align-items:center; gap:4px;">\n                <input id="fve-start-m" type="text" inputmode="numeric" value="0" style="width:45px;padding:4px;background:#111;color:#fff;border:1px solid #555;border-radius:4px;text-align:center;font-size:13px;">\n                <span style="color:#fff;font-weight:bold;">:</span>\n                <input id="fve-start-s" type="text" inputmode="numeric" value="0" style="width:45px;padding:4px;background:#111;color:#fff;border:1px solid #555;border-radius:4px;text-align:center;font-size:13px;">\n            </div>\n          </div>\n          <div style="display:flex; align-items:center; gap:12px;">\n            <label style="font-size:13px; color:#ddd; white-space:nowrap; width:115px;">Video duration (s):</label>\n            <div style="display:flex; align-items:center; gap:10px;">\n                <label style="font-size:13px; color:#fff; display:flex; align-items:center; gap:4px; cursor:pointer;"><input type="radio" name="fve-duration" value="30"> 30</label>\n                <label style="font-size:13px; color:#fff; display:flex; align-items:center; gap:4px; cursor:pointer;"><input type="radio" name="fve-duration" value="60" checked> 60</label>\n            </div>\n          </div>\n          <div id="fve-range-warning" style="font-size:12px;color:#ff6b6b;margin-top:10px;display:none;"></div>\n        </div>\n        <div style="background:#1a1a1a;padding:12px;border-radius:6px;border:1px solid #333;margin-bottom:16px;">\n          <div style="font-size:13px;color:#aaa;margin-bottom:6px;">Video Format (Dimensions):</div>\n          <select id="fve-format" style="width:100%;padding:8px;background:#111;color:#fff;border:1px solid #444;border-radius:4px;font-size:13px;">\n            <option value="reel" selected>Reel (1080 x 1920)</option>\n            <option value="portrait">Portrait feed (1080 x 1350)</option>\n            <option value="square">Square feed (1080 x 1080)</option>\n          </select>\n        </div>\n        <div style="display:flex;justify-content:flex-end;gap:10px;">\n          <button id="fve-cancel" style="background:transparent;border:1px solid #4b5563;color:#cbd5e1;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:13px;">Cancel</button>\n          <button id="fve-start" style="background:#2196F3;color:#fff;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">Export video</button>\n        </div>\n      </div>\n    ';document.body.appendChild(a);
    a.querySelector("#fve-cancel").onclick=()=>{a.style.display="none"};
    a.querySelector("#fve-start").onclick=()=>{a.style.display="none"; (async function(){
    if(i)return;const e=l();if(!e)return;
    try{globalThis._playbackScrollJump&&"function"==typeof globalThis._playbackScrollJump.pause&&await globalThis._playbackScrollJump.pause()}catch(err){}
    i=!0;window.__spectroWait&&window.__spectroWait.show({titleText:"Exporting Video",etaText:"Encoding Fast Video..."});
    const a=document.getElementById("scrollArea"),r=(document.getElementById("axisCanvas"),document.getElementById("spectrogramCanvas")),s=document.getElementById("annotationOverlay"),d=document.getElementById("annotationSelectionOverlay"),c=document.getElementById("editHighlightOverlay"),p=0,u=a.clientWidth,f=globalThis._spectroImageHeight||300,g=document.getElementById("fve-format"),m=g?g.value:"reel",x=12+f+44;let y,b,h,v;"square"===m?(y=1080,b=1080):"portrait"===m?(y=1080,b=1350):(y=1080,b=1920);h=Math.round(x*(y/b)),v=h-p,v<50&&(v=50);const w=document.createElement("canvas");w.width=h,w.height=x;const S=w.getContext("2d",{alpha:!1}),T=document.createElement("canvas");T.width=y,T.height=b;const k=T.getContext("2d",{alpha:!1});
    
    if (typeof window.Mp4Muxer === "undefined") { alert("Mp4Muxer library not loaded!"); i = false; window.__spectroWait&&window.__spectroWait.hide(); return; }
    const audioBuf = globalThis._spectroAudioBuffer;
    if (!audioBuf) { alert("No audio buffer!"); i = false; window.__spectroWait&&window.__spectroWait.hide(); return; }
    
    try {
        const fps = 30;
        const totalFrames = Math.ceil(e.duration * fps);
        const sampleRate = audioBuf.sampleRate;
        const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const offlineCtx = new OfflineCtx(audioBuf.numberOfChannels, Math.ceil(e.duration * sampleRate), sampleRate);
        const source = offlineCtx.createBufferSource();
        source.buffer = audioBuf;
        source.connect(offlineCtx.destination);
        source.start(0, e.startSec, e.duration);
        const renderedBuffer = await offlineCtx.startRendering();

        let muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: "avc", width: y, height: b }, audio: { codec: "aac", sampleRate: renderedBuffer.sampleRate, numberOfChannels: renderedBuffer.numberOfChannels }, fastStart: "in-memory" });

        let videoEncoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: err => console.error("VideoEncoder Error:", err) });
        videoEncoder.configure({ codec: "avc1.42E01F", width: y, height: b, hardwareAcceleration: "prefer", bitrate: 5000000 });

        let audioEncoder = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: err => console.error("AudioEncoder Error:", err) });
        audioEncoder.configure({ codec: "mp4a.40.2", sampleRate: renderedBuffer.sampleRate, numberOfChannels: renderedBuffer.numberOfChannels, bitrate: 128000 });

        const AUDIO_CHUNK_FRAMES = renderedBuffer.sampleRate;
        for (let idx = 0; idx < renderedBuffer.length; idx += AUDIO_CHUNK_FRAMES) {
            const chunkLen = Math.min(AUDIO_CHUNK_FRAMES, renderedBuffer.length - idx);
            const pcm = new Float32Array(chunkLen * renderedBuffer.numberOfChannels);
            let offset = 0;
            for (let ch = 0; ch < renderedBuffer.numberOfChannels; ch++) { pcm.set(renderedBuffer.getChannelData(ch).subarray(idx, idx + chunkLen), offset); offset += chunkLen; }
            const audioData = new AudioData({ format: "f32-planar", sampleRate: renderedBuffer.sampleRate, numberOfFrames: chunkLen, numberOfChannels: renderedBuffer.numberOfChannels, timestamp: (idx / renderedBuffer.sampleRate) * 1000000, data: pcm });
            audioEncoder.encode(audioData);
            audioData.close();
        }

        const gPx = globalThis._spectroPxPerSec || 1;
        const originalScrollLeft = a ? a.scrollLeft : 0;

        for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
            const currentTime = frameIdx / fps;
            const absTime = e.startSec + currentTime;
            const absPx = absTime * gPx;

            let L = Math.max(0, absPx - v / 2);
            const maxL = Math.max(0, (globalThis._spectroImageWidth || u) - v);
            L = Math.min(maxL, L);

            if (a) { a.scrollLeft = L; }
            if (typeof globalThis.drawViewportFromTiles === "function") { globalThis.drawViewportFromTiles(); }

            const _px = 0; 
            S.fillStyle = "#111";
            S.fillRect(0, 0, w.width, w.height);

            [document.getElementById("webglSpectrogramCanvas"), r].forEach(canvas => {
                if (canvas) {
                    const eRatio = canvas.width / (canvas.clientWidth || 1);
                    const tRatio = canvas.height / (canvas.clientHeight || 1);
                    const isGL = canvas.id === "webglSpectrogramCanvas";
                    S.drawImage(canvas, _px * eRatio, isGL ? 0 : 12 * tRatio, v * eRatio, f * tRatio, p, 12, v, f);
                }
            });

            const E=window.devicePixelRatio||1;
            const g = gPx;
            const _ = _px;
            if([s,d,c].forEach(el=>{el&&el.width>0&&"none"!==el.style.display&&S.drawImage(el,_*E,0,v*E,el.height,p,12,v,f)}),globalThis._annotations&&"function"==typeof globalThis._annotations.getAll){const annots=globalThis._annotations.getAll();S.textAlign="left",S.textBaseline="top";const t=globalThis._spectroYMax||22050,o=L/g,n=o+v/g;for(const ann of annots){if(ann.endTime<o||ann.beginTime>n)continue;const lbl=ann.species||ann.scientificName||"";if(lbl){const pxx=p+(ann.beginTime-o)*g,pxy=12+(1-ann.highFreq/t)*f;S.font="11px sans-serif";const lblw=S.measureText(lbl).width;S.fillStyle="rgba(0,0,0,0.65)",S.fillRect(pxx,pxy-16,lblw+6,16),S.fillStyle="#fff",S.fillText(lbl,pxx+3,pxy-13)}}}
            const B=6;S.strokeStyle="rgba(255,255,255,0.4)",S.lineWidth=1,S.fillStyle="#fff",S.font="9px sans-serif",S.textAlign="left",S.textBaseline="top";const I=globalThis._spectroYMax||22050;for(let idx=0;idx<B;idx++){const rat=idx/(B-1),ohz=I*(1-rat),npy=12+Math.round(rat*f);S.beginPath(),S.moveTo(0,npy),S.lineTo(5,npy),S.stroke();const lblhz=ohz>=1e3?(Math.round(ohz/10)/100).toString()+"k":Math.round(ohz).toString();S.shadowColor="rgba(0,0,0,0.8)",S.shadowBlur=3,S.fillText(lblhz,8,npy+2),S.shadowBlur=0}S.fillStyle="#111",S.fillRect(p,0,v,12),S.fillRect(p,12+f,v,44);const A=L/g,R=A+v/g,q=[.1,.2,.5,1,2,5,10,15,30,60];let z=q[0];const W=globalThis._spectroPxPerFrame;if(1===W)z=2;else if(2===W)z=1;else if(4===W)z=.5;else if(8===W)z=.25;else for(let iv of q){if(iv*g>=60){z=iv;break}z=iv}const P=Math.floor(A/z)*z;S.strokeStyle="rgba(255,255,255,0.06)",S.fillStyle="#ddd",S.font="9px sans-serif",S.textAlign="center",S.textBaseline="top";for(let tm=P;tm<=R;tm+=z){const tpx=p+(tm-A)*g;S.beginPath(),S.moveTo(tpx,0),S.lineTo(tpx,8),S.stroke(),S.beginPath(),S.moveTo(tpx,12+f),S.lineTo(tpx,12+f+8),S.stroke();let dp=z%1!=0?z.toString().split(".")[1].length:0,ts=tm.toFixed(dp)+"s";tm>=60&&(ts=Math.floor(tm/60)+":"+String(Math.floor(tm%60)).padStart(2,"0")),S.fillText(ts,tpx,12+f+10)}S.fillStyle="rgba(255,255,255,0.4)",S.font="10px sans-serif",S.textAlign="center",S.fillText("Spectrolipi",p+v/2,12+f+26),S.strokeStyle="#ff6b6b",S.lineWidth=2,S.beginPath();
            
            const playheadX = absPx - L; 
            S.moveTo(p+playheadX,12); S.lineTo(p+playheadX,12+f); S.stroke();

            k.fillStyle = "#000";
            k.fillRect(0, 0, y, b);
            k.drawImage(w, 0, 0, y, b);

            const frame = new VideoFrame(T, { timestamp: (frameIdx / fps) * 1000000, duration: (1 / fps) * 1000000 });
            videoEncoder.encode(frame);
            frame.close();

            if (frameIdx % 10 === 0) {
                window.__spectroWait&&window.__spectroWait.show({etaText:`Encoding... ${Math.round((frameIdx / totalFrames) * 100)}%`});
                await new Promise(r2 => setTimeout(r2, 0));
            }
        }
        
        if (a) { a.scrollLeft = originalScrollLeft; }

        window.__spectroWait&&window.__spectroWait.show({etaText:"Finalizing MP4..."});
        
        await videoEncoder.flush();
        await audioEncoder.flush();
        videoEncoder.close();
        audioEncoder.close();
        muxer.finalize();

        const buffer = muxer.target.buffer;
        const blob = new Blob([buffer], { type: "video/mp4" });
        const url = URL.createObjectURL(blob);
        const fileName = (document.getElementById("file") && document.getElementById("file").files[0] && document.getElementById("file").files[0].name || "export").replace(/\.[^.]+$/, "") + "_fast_" + y + "x" + b + ".mp4";
        
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        
        setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 2000);

        i = false;
        window.__spectroWait&&window.__spectroWait.hide();
        
        const successMsg = document.createElement("div");
        successMsg.textContent = "Fast Video exported successfully";
        successMsg.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:20px;background:rgba(0,0,0,0.8);color:#fff;padding:6px 10px;border-radius:6px;z-index:2147483646;";
        document.body.appendChild(successMsg);
        setTimeout(() => successMsg.remove(), 3000);

    } catch (err) {
        console.error(err);
        alert("Fast Export failed: " + err.message);
        i = false;
        window.__spectroWait&&window.__spectroWait.hide();
    }
    })();
    };
    return a.querySelector("#fve-start-m").addEventListener("input",s),a.querySelector("#fve-start-s").addEventListener("input",s),a.querySelectorAll('input[name="fve-duration"]').forEach(e=>e.addEventListener("change",r)),a
}
function l(t){const o=t||document.getElementById(e);if(!o)return null;const n=globalThis._spectroAudioBuffer?globalThis._spectroAudioBuffer.duration:0,i=60*(parseInt(o.querySelector("#fve-start-m").value)||0)+(parseInt(o.querySelector("#fve-start-s").value)||0),a=parseInt(o.querySelector('input[name="fve-duration"]:checked').value)||60,l=o.querySelector("#fve-range-warning"),r=o.querySelector("#fve-start");if(i>=n){l.textContent=`Start time cannot exceed audio length (${Math.floor(n/60)}:${Math.floor(n%60).toString().padStart(2,"0")}).`;l.style.color="#ff6b6b";l.style.display="block";r.disabled=!0;r.style.opacity="0.5";r.style.cursor="not-allowed";return null}if(i+a>n){const e=n-i;l.textContent=`Note: Video will end at audio length (Duration: ${e.toFixed(1)}s).`;l.style.color="#cbd5e1";l.style.display="block";r.disabled=!1;r.style.opacity="1";r.style.cursor="pointer";return{startSec:i,endSec:n,duration:e}}l.style.display="none";r.disabled=!1;r.style.opacity="1";r.style.cursor="pointer";return{startSec:i,endSec:i+a,duration:a};}
window.__openFastVideoExportModal=function(){if(!globalThis._spectroAudioBuffer)return void alert("No audio loaded. Please load an audio file and generate a spectrogram first.");const e=a();let t=0,o=60;if("function"==typeof window._spectroHasSelection&&window._spectroHasSelection()){const e=globalThis._spectroCurrentSelection;e&&isFinite(e.start)&&isFinite(e.end)&&(t=e.start,o=e.end-e.start)}let n=Math.floor(t/60);const i=Math.floor(t%60);n>59&&(n=59),e.querySelector("#fve-start-m").value=n,e.querySelector("#fve-start-s").value=i;const r=e.querySelectorAll('input[name="fve-duration"]');let s=1/0,d="60";r.forEach(e=>{const t=Math.abs(Number(e.value)-o);t<s&&(s=t,d=e.value)}),r.forEach(e=>e.checked=e.value===d),l(e),e.style.display="flex"}
}();
`;
fs.writeFileSync('fast_video_export.js', code);
console.log('Fixed completely!');
