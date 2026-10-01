!(function () {
  window.__setBirdnetCoordinates = function (e, t) {
    const o = null !== e && void 0 !== e ? String(e) : "",
      i = null !== t && void 0 !== t ? String(t) : "",
      s = document.getElementById("bn-lat"),
      a = document.getElementById("bn-lon");
    (s && (s.value = o), a && (a.value = i));
    if (s) s.dispatchEvent(new Event("input"));
  };
  const e = "birdnetOverlayModal";
  let n = !1,
    t = null,
    o = 48e3,
    i = 144e3,
    s = 0.3,
    a = 0.1,
    d = null;
  function l() {
    const l = document.getElementById("runBirdnetBtn");
    l &&
      l.addEventListener("click", (l) => {
        (l.preventDefault(),
          (async function () {
            const u = globalThis._spectroAudioBuffer;
            if (!u)
              return void alert(
                "Please load an audio file in the main viewer first.",
              );
            let b = document.getElementById(e);
            b ||
              ((b = document.createElement("div")),
              (b.id = e),
              (b.style.cssText =
                "position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:2147483650;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);"),
              (b.innerHTML =
                '\n                <div style="background:#222; width:95%; height:90%; border-radius:12px; display:flex; flex-direction:column; border:1px solid #444; position:relative; overflow:hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.5);">\n                    <div style="padding:12px 20px; background:#111; border-bottom:1px solid #333; display:flex; flex-direction:column; gap:5px;">\n                        <div style="display:flex; justify-content:space-between; align-items:center;">\n                            <span style="color:bisque; font-family:monospace; font-weight:bold; font-size:14px;">BirdNET Model V2.4 (tfjs)</span>\n                            <button id="bn-close" style="background:none; border:none; color:#ff6b6b; font-size:28px; cursor:pointer; line-height:1;">&times;</button>\n                        </div>\n                        <div style="font-size:11px; color:#888; line-height:1.3;">\n                            BirdNET AI model by the K. Lisa Yang Center for Conservation Bioacoustics at the Cornell Lab of Ornithology in collaboration with Chemnitz University of Technology. Stefan Kahl, Connor Wood, Maximilian Eibl, Holger Klinck. \n                            <a href="https://github.com/birdnet-team/BirdNET-Analyzer" target="_blank" style="color:#aaa;text-decoration:underline;">BirdNET Analyzer</a>, \n                            <a href="https://zenodo.org/records/15050749" target="_blank" style="color:#aaa;text-decoration:underline;">BirdNET Models</a>\n                        </div>\n                    </div>\n                    <div id="bn-content-wrapper" style="flex:1; display:flex; flex-direction:column; overflow:hidden;"></div>\n                </div>\n            '),
              document.body.appendChild(b),
              (document.getElementById("bn-close").onclick = () => {
                b.style.display = "none";
              }),
              (function (n) {
                n.innerHTML = `\n            <style>${r}</style>\n            <div id="bn-container">\n                \n                \x3c!-- TOP FRAME: Options --\x3e\n                <div id="bn-options-frame">\n                    <header style="display:flex; justify-content:space-between; align-items:center;">\n                        <div id="bn-progress" style="flex:1; margin-right:10px; display:none;">\n                            <progress id="bn-progress_bar" value="0" max="100"></progress>\n                            <span id="bn-progress_text" style="font-size:12px; color:#ccc;"></span>\n                        </div>\n                    </header>\n\n                    <div class="bn-control-grid">\n                        <div class="bn-box">\n                            <div class="bn-row">\n                                <label>Audio Conf:</label>\n                                <span id="bn-audio-confidence-num" style="font-size:12px; width:30px; text-align:right;">0.3</span>\n                                <input id="bn-audio-confidence" type="range" value="0.3" min="0.1" max="1.0" step="0.05" style="flex:1;">\n                            </div>\n                            <div class="bn-row" style="display:none"> \x3c!-- Area confidence hidden as requested previously --\x3e\n                                <label>Area Conf:</label>\n                                <span id="bn-area-confidence-num">0.1</span>\n                                <input id="bn-area-confidence" type="range" value="0.1" min="0" max="10">\n                            </div>\n                            <div class="bn-row">\n                                <label>Overlap (s):</label>\n                                <select id="bn-overlap" style="flex: 0 0 auto; width: 60px;">\n                                    <option value="0" selected>0</option>\n                                    <option value="0.5">0.5</option>\n                                    <option value="1.0">1.0</option>\n                                    <option value="1.5">1.5</option>\n                                    <option value="2.0">2.0</option>\n                                    <option value="2.5">2.5</option>\n                                </select>\n                            </div>\n                        </div>\n\n                        <div class="bn-box" id="bn-location-box">\n                            <div class="bn-row" style="margin-bottom: 8px;">\n                                <input id="bn-use-location" type="checkbox" checked>\n                                <label for="bn-use-location" style="cursor:pointer; flex: 0 0 auto;">Use Location</label>\n                                <select id="bn-saved-locations" style="flex: 1; margin-left: 10px;">\n                                    <option value="">-- Saved Locations --</option>\n                                </select>
                                <button id="bn-delete-location-btn" class="bn-small-btn" style="margin-left: 6px;">Del</button>\n                            </div>\n                            <div class="bn-row" style="margin-bottom: 8px;">\n                                <label style="flex: 0 0 auto; width: 25px;">Lat:</label>\n                                <input id="bn-lat" type="number" step="0.0001" placeholder="Lat" style="flex: 1; min-width: 0;">\n                                <label style="flex: 0 0 auto; width: 25px; margin-left: 8px;">Lon:</label>\n                                <input id="bn-lon" type="number" step="0.0001" placeholder="Lon" style="flex: 1; min-width: 0;">\n                            </div>\n                            <div class="bn-row">\n                                <input id="bn-location-name" type="text" placeholder="Location Name" style="flex: 1; min-width: 0;">\n                                <button id="bn-save-location-btn" class="bn-small-btn" style="margin-left: 6px;">Save</button>\n                                \n                            </div>\n                        </div>\n                        \n                        <div class="bn-box">\n                            <div class="bn-row">\n                                <input id="bn-use-custom-list" type="checkbox">\n                                <label for="bn-use-custom-list" style="cursor:pointer">Custom List</label>\n                            </div>\n                            <div class="bn-row">\n                                <button id="bn-pick-custom-list" class="seg-btn" style="padding:2px 8px; font-size:11px;" disabled>Load List</button>\n                                <input type="file" id="bn-custom-list-file" style="display:none;" accept=".txt,.csv">\n                            </div>\n                            <div class="bn-row">\n                                <span id="bn-custom-list-name" style="font-size:10px; color:#aaa; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"></span>\n                            </div>\n                        </div>\n                    </div>\n                    \n                    <button id="bn-start-btn" disabled>Start Analysis</button>\n                </div>\n\n                \x3c!-- BOTTOM FRAME: Results --\x3e\n                <div id="bn-results-frame">\n                    <div id="bn-error"></div>\n                    <div id="bn-log"></div>\n                    \n                    <div id="bn-results-grid">\n                        <div class="bn-result-col">\n                            <h4>Detected Species</h4>\n                            <ul id="bn-birdslist"></ul>\n                        </div>\n                        <div class="bn-result-col">\n                            <h4 style="display:flex; align-items:center; gap:6px; margin:0 0 5px 0;"><input type="checkbox" id="bn-select-all-unique" checked><label for="bn-select-all-unique" style="cursor:pointer; margin:0;">Unique Species</label></h4>\n                            <ul id="bn-unique-species-list"></ul>\n                        </div>\n                    </div>\n                    \n                    <div style="display: flex; align-items: center; gap: 15px; margin-top: 10px; flex: 0 0 auto; justify-content: flex-end;">\n                        <label style="display: flex; align-items: center; gap: 6px; font-size: 13px; color: #ccc; white-space: nowrap;">\n                            <input type="checkbox" id="bn-merge-detections">\n                            <span>Merge consecutive detections</span>\n                        </label>\n                        <button id="bn-insert-annotations-btn" disabled>Insert Annotations</button>\n                    </div>\n                </div>\n\n                \x3c!-- Hidden inputs preserved for logic --\x3e\n                <input id="bn-year-around" type="checkbox" checked style="display:none">\n                <input id="bn-week" type="number" value="1" style="display:none">\n            </div>\n        `;
                document.getElementById("bn-start-btn").onclick = async () => {
                  const n = globalThis._spectroAudioBuffer;
                  n &&
                    (await (async function (e) {
                      const n = document.getElementById("bn-start-btn");
                      n && (n.disabled = !0);
                      ((document.getElementById("bn-error").innerHTML = ""),
                        (document.getElementById("bn-birdslist").innerHTML =
                          ""),
                        (document.getElementById(
                          "bn-unique-species-list",
                        ).innerHTML = ""),
                        (document.getElementById("bn-log").innerHTML = ""));
                      const l =
                          document.getElementById("bn-use-location").checked,
                        r = document.getElementById("bn-year-around").checked,
                        u =
                          document.getElementById("bn-use-custom-list").checked,
                        b =
                          parseInt(document.getElementById("bn-week").value) ||
                          1,
                        p = document.getElementById("bn-lat").value,
                        m = document.getElementById("bn-lon").value,
                        g = "" !== p.trim() && "" !== m.trim();
                      if (l && g) {
                        const e = parseFloat(p),
                          n = parseFloat(m);
                        ((document.getElementById("bn-progress").style.display =
                          "block"),
                          (document.getElementById(
                            "bn-progress_text",
                          ).innerText = "Updating area model..."));
                        try {
                          await t({
                            message: "area-scores",
                            latitude: e,
                            longitude: n,
                            week: r ? -1 : b,
                          });
                        } catch (e) {
                          document.getElementById("bn-log").innerText =
                            "Area score update failed.";
                        }
                      } else if (u && d) {
                        ((document.getElementById("bn-progress").style.display =
                          "block"),
                          (document.getElementById(
                            "bn-progress_text",
                          ).innerText = "Applying custom species list..."));
                        try {
                          await t({ message: "set_species_list", list: d });
                        } catch (e) {
                          document.getElementById("bn-log").innerText =
                            "Failed to apply custom species list.";
                        }
                      } else {
                        ((document.getElementById("bn-progress").style.display =
                          "block"),
                          (document.getElementById(
                            "bn-progress_text",
                          ).innerText = "Disabling area filter..."));
                        try {
                          await t({ message: "reset-area" });
                        } catch (e) {
                          console.error("Failed to reset area scores", e);
                        }
                      }
                      ((document.getElementById("bn-progress_text").innerText =
                        "Decoding audio file..."),
                        await new Promise((e) => setTimeout(e, 20)));
                      try {
                        await (async function (e) {
                          if (!e) return;
                          ((document.getElementById(
                            "bn-progress",
                          ).style.display = "block"),
                            (document.getElementById("bn-progress_bar").value =
                              0));
                          try {
                            let n = performance.now();
                            const srcBuf = globalThis._spectroAudioBuffer;
                            if (!srcBuf) throw new Error("No audio buffer");
                            let u;
                            if (srcBuf.sampleRate === o) {
                              u = new Float32Array(srcBuf.getChannelData(0));
                            } else {
                              const offCtx = new (
                                globalThis.OfflineAudioContext ||
                                globalThis.webkitOfflineAudioContext
                              )(1, Math.ceil(srcBuf.duration * o), o);
                              const srcNode = offCtx.createBufferSource();
                              srcNode.buffer = srcBuf;
                              srcNode.connect(offCtx.destination);
                              srcNode.start(0);
                              const resampledBuf =
                                await offCtx.startRendering();
                              u = new Float32Array(
                                resampledBuf.getChannelData(0),
                              );
                            }
                            const b = u.length / o;
                            n = performance.now();
                            const p =
                                parseFloat(
                                  document.getElementById("bn-overlap").value,
                                ) || 0,
                              m = i / o,
                              g = Math.max(
                                Math.floor(0.1 * o),
                                Math.floor((m - p) * o),
                              );
                            for (let e = 0; e < u.length; e += g) {
                              let n = u.slice(e, e + i);
                              if (n.length < i) {
                                let e = new Float32Array(i);
                                (e.set(n, 0), (n = e));
                              }
                              const { prediction: d } = await t({
                                message: "predict",
                                pcmAudio: n,
                              });
                              document.getElementById("bn-progress_bar").value =
                                ((e / u.length) * 100) | 0;
                              const l = [];
                              for (let n = 0; n < d.length; n++) {
                                const t = d[n].confidence,
                                  i = d[n].geoscore,
                                  r = e / o,
                                  c = Math.floor(r / 60),
                                  u = (r % 60).toFixed(1),
                                  b = `${c.toString().padStart(2, "0")}:${u.padStart(4, "0")}`,
                                  p = document.createElement("li"),
                                  m = 0.005,
                                  g = t >= s - m && i >= a - m;
                                ((p.style.display = g ? "" : "none"),
                                  (p.innerHTML = `${b} - <span data-geoscore="${i}" data-confidence="${t}" data-start="${e / o}" data-scientific="${d[n].scientific || ""}">${d[n].nameI18n}</span> (${t.toFixed(2)})`),
                                  l.push(p));
                              }
                              document
                                .getElementById("bn-birdslist")
                                .append(...l);
                            }
                            c();
                            const y = (performance.now() - n) / 1e3;
                            ((document.getElementById(
                              "bn-progress",
                            ).style.display = "none"),
                              (document.getElementById("bn-log").innerHTML +=
                                `Inference time: ${y.toFixed(1)}s (x${(b / y) | 0})<br />`));
                          } catch (e) {
                            ((document.getElementById(
                              "bn-progress",
                            ).style.display = "none"),
                              (document.getElementById("bn-error").innerText =
                                "Error processing audio: " + e.message),
                              console.error(e));
                          }
                        })(e);
                      } finally {
                        n && (n.disabled = !1);
                      }
                    })(n));
                };
                document.getElementById("bn-insert-annotations-btn").onclick =
                  () => {
                    const n = new Set(
                        Array.from(
                          document.querySelectorAll(
                            "#bn-unique-species-list input:checked",
                          ),
                        ).map((e) => e.value),
                      ),
                      t = [];
                    (document
                      .querySelectorAll("#bn-birdslist li")
                      .forEach((e) => {
                        const o = e.querySelector("span");
                        if (
                          o &&
                          "none" !== e.style.display &&
                          n.has(o.textContent)
                        ) {
                          const e = parseFloat(o.dataset.start);
                          t.push({
                            start: e,
                            end: e + 3,
                            common: o.textContent,
                            scientific: o.dataset.scientific,
                            confidence: parseFloat(o.dataset.confidence),
                          });
                        }
                      }),
                      0 !== t.length
                        ? (function (n) {
                            if (!window.annotationGrid)
                              return void alert(
                                "Main annotation table not found.",
                              );
                            const t = document.getElementById(
                              "bn-merge-detections",
                            ).checked;
                            let o = n;
                            t &&
                              (o = (function (e) {
                                const n = 1;
                                if (!e || e.length <= 1) return e;
                                const t = e.reduce((e, n) => {
                                    const t = n.common;
                                    return (
                                      e[t] || (e[t] = []),
                                      e[t].push(n),
                                      e
                                    );
                                  }, {}),
                                  o = [];
                                for (const e in t) {
                                  const i = t[e];
                                  if (i.length <= 1) {
                                    o.push(...i);
                                    continue;
                                  }
                                  i.sort((e, n) => e.start - n.start);
                                  const s = [];
                                  let a = { ...i[0] },
                                    d = !1;
                                  for (let e = 1; e < i.length; e++) {
                                    const t = i[e];
                                    t.start - a.end < n
                                      ? ((a.end = Math.max(a.end, t.end)),
                                        (a.confidence = Math.max(
                                          a.confidence,
                                          t.confidence,
                                        )),
                                        (d = !0))
                                      : (d && (a.isMerged = !0),
                                        s.push(a),
                                        (a = { ...t }),
                                        (d = !1));
                                  }
                                  (d && (a.isMerged = !0),
                                    s.push(a),
                                    o.push(...s));
                                }
                                return (o.sort((e, n) => e.start - n.start), o);
                              })(n));
                            const i = o.map((e) => {
                              const n = e.isMerged
                                ? "Birdnet detection: Scores - NA (Merged)"
                                : `Birdnet detection. Score - ${Number(e.confidence).toFixed(2)}`;
                              return {
                                beginTime: e.start,
                                endTime: e.end,
                                lowFreq: 0,
                                highFreq: 15e3,
                                species: e.common,
                                scientificName: e.scientific,
                                sex: "",
                                lifeStage: "",
                                soundType: "",
                                notes: n,
                              };
                            });
                            try {
                              window.annotationUndo &&
                                window.annotationUndo.saveState();
                            } catch (e) {}
                            const s = globalThis._annotations.addMany(
                              i,
                              "birdnet-insert",
                            );
                            alert(
                              `Successfully inserted ${s.length} annotations into the annotation table.`,
                            );
                            const a = document.getElementById(e);
                            a && (a.style.display = "none");
                          })(t)
                        : alert("No detections selected to insert."));
                  };
                const l = document.getElementById("bn-use-location"),
                  u = document.getElementById("bn-lat"),
                  b = document.getElementById("bn-lon"),
                  p = document.getElementById("bn-year-around"),
                  m = document.getElementById("bn-week"),
                  g = document.getElementById("bn-use-custom-list"),
                  y = document.getElementById("bn-pick-custom-list"),
                  f = document.getElementById("bn-custom-list-file"),
                  x = document.getElementById("bn-custom-list-name"),
                  h = document.getElementById("bn-area-confidence");
                function v() {
                  const e = l.checked,
                    n = g.checked;
                  ((u.disabled = !e),
                    (b.disabled = !e),
                    (p.disabled = !e),
                    (m.disabled = !e || p.checked),
                    (y.disabled = !n),
                    (h.disabled = n));
                }
                ((l.onchange = () => {
                  (l.checked && (g.checked = !1), v());
                }),
                  (p.onchange = () => {
                    v();
                  }),
                  (g.onchange = () => {
                    (g.checked && (l.checked = !1), v());
                  }),
                  (y.onclick = () => f.click()),
                  (m.onchange = () => {
                    let e = parseInt(m.value);
                    isNaN(e) || e < 1
                      ? (m.value = 1)
                      : e > 52 && (m.value = 52);
                  }),
                  (f.onchange = async (e) => {
                    const n = e.target.files[0];
                    if (n) {
                      x.textContent = n.name;
                      const e = await n.text();
                      d = e
                        .split("\n")
                        .map((e) => e.trim())
                        .filter(Boolean);
                    } else ((x.textContent = ""), (d = null));
                  }),
                  (document.getElementById("bn-audio-confidence").oninput = (
                    e,
                  ) => {
                    ((s = parseFloat(e.target.value)),
                      (document.getElementById(
                        "bn-audio-confidence-num",
                      ).innerText = s.toFixed(2)),
                      c());
                  }),
                  (document.getElementById("bn-area-confidence").onchange = (
                    e,
                  ) => {
                    ((a = e.target.value / 10),
                      (document.getElementById(
                        "bn-area-confidence-num",
                      ).innerText = a.toFixed(2)),
                      c());
                  }));

                // --- NEW SAVED LOCATIONS LOGIC ---
                const savedLocationsDropdown =
                  document.getElementById("bn-saved-locations");
                const locNameInput =
                  document.getElementById("bn-location-name");
                const saveLocBtn = document.getElementById(
                  "bn-save-location-btn",
                );
                const delLocBtn = document.getElementById(
                  "bn-delete-location-btn",
                );
                const selectAllUnique = document.getElementById(
                  "bn-select-all-unique",
                );
                const uniqueSpeciesList = document.getElementById(
                  "bn-unique-species-list",
                );
                const insertBtn = document.getElementById(
                  "bn-insert-annotations-btn",
                );

                let savedLocations = [];
                try {
                  savedLocations =
                    JSON.parse(
                      localStorage.getItem("birdnet_saved_locations"),
                    ) || [];
                } catch (e) {
                  savedLocations = [];
                }

                function renderDropdown() {
                  savedLocationsDropdown.innerHTML =
                    '<option value="">-- Saved Locations --</option>';
                  savedLocations.forEach((loc) => {
                    const opt = document.createElement("option");
                    opt.value = loc.name;
                    opt.textContent = loc.name;
                    savedLocationsDropdown.appendChild(opt);
                  });
                  updateButtonsState();
                }

                function updateButtonsState() {
                  const useLoc = l.checked;
                  savedLocationsDropdown.disabled = !useLoc;
                  locNameInput.disabled = !useLoc;

                  const validLat =
                    u.value.trim() !== "" && !isNaN(parseFloat(u.value));
                  const validLon =
                    b.value.trim() !== "" && !isNaN(parseFloat(b.value));
                  const validName = locNameInput.value.trim() !== "";

                  saveLocBtn.disabled = !(
                    useLoc &&
                    validLat &&
                    validLon &&
                    validName
                  );

                  const selectedLoc = savedLocationsDropdown.value;
                  delLocBtn.disabled = !(useLoc && selectedLoc !== "");
                }

                renderDropdown();

                // Hook into existing use location change
                const oldV = v;
                v = function () {
                  oldV();
                  updateButtonsState();
                };
                // initial state update
                updateButtonsState();

                [u, b, locNameInput].forEach((el) => {
                  el.addEventListener("input", updateButtonsState);
                });

                let lastSelectedLoc = savedLocationsDropdown.value || "";

                savedLocationsDropdown.addEventListener("change", () => {
                  const selectedName = savedLocationsDropdown.value;

                  if (selectedName === "") {
                    const hasCoords =
                      u.value.trim() !== "" || b.value.trim() !== "";
                    if (hasCoords) {
                      if (
                        confirm(
                          "Are you sure you want to clear the current coordinates?",
                        )
                      ) {
                        u.value = "";
                        b.value = "";
                        locNameInput.value = "";
                        lastSelectedLoc = "";
                        updateButtonsState();
                      } else {
                        savedLocationsDropdown.value = lastSelectedLoc;
                        updateButtonsState();
                      }
                    } else {
                      locNameInput.value = "";
                      lastSelectedLoc = "";
                      updateButtonsState();
                    }
                  } else {
                    const loc = savedLocations.find(
                      (l) => l.name === selectedName,
                    );
                    if (loc) {
                      u.value = loc.lat;
                      b.value = loc.lon;
                      locNameInput.value = loc.name;
                      lastSelectedLoc = selectedName;
                      updateButtonsState();
                    }
                  }
                });

                saveLocBtn.addEventListener("click", () => {
                  const name = locNameInput.value.trim();
                  const lat = parseFloat(u.value);
                  const lon = parseFloat(b.value);
                  if (!name || isNaN(lat) || isNaN(lon)) {
                    alert(
                      "Please enter a valid Name, Latitude, and Longitude.",
                    );
                    return;
                  }
                  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
                    alert(
                      "Latitude must be between -90 and 90. Longitude between -180 and 180.",
                    );
                    return;
                  }

                  const epsilon = 1e-6;
                  const coordMatch = savedLocations.find(
                    (l) =>
                      Math.abs(l.lat - lat) < epsilon &&
                      Math.abs(l.lon - lon) < epsilon,
                  );
                  if (
                    coordMatch &&
                    coordMatch.name.toLowerCase() !== name.toLowerCase()
                  ) {
                    alert(
                      `Same coordinates are available with '${coordMatch.name}' saved location.`,
                    );
                    return;
                  }

                  const existingIndex = savedLocations.findIndex(
                    (l) => l.name.toLowerCase() === name.toLowerCase(),
                  );
                  if (existingIndex >= 0) {
                    if (
                      !confirm(
                        `Location '${name}' already exists. Overwrite with new coordinates?`,
                      )
                    ) {
                      return;
                    }
                    savedLocations[existingIndex] = { name, lat, lon };
                  } else {
                    savedLocations.push({ name, lat, lon });
                  }

                  localStorage.setItem(
                    "birdnet_saved_locations",
                    JSON.stringify(savedLocations),
                  );
                  renderDropdown();
                  savedLocationsDropdown.value = name;
                  lastSelectedLoc = name;
                  updateButtonsState();
                });

                delLocBtn.addEventListener("click", () => {
                  const name = savedLocationsDropdown.value;
                  if (!name) return;
                  if (confirm(`Delete saved location '${name}'?`)) {
                    savedLocations = savedLocations.filter(
                      (l) => l.name !== name,
                    );
                    localStorage.setItem(
                      "birdnet_saved_locations",
                      JSON.stringify(savedLocations),
                    );
                    renderDropdown();
                    locNameInput.value = "";
                    lastSelectedLoc = "";
                    updateButtonsState();
                  }
                });

                // Select All logic
                if (selectAllUnique) {
                  selectAllUnique.addEventListener("change", (e) => {
                    const isChecked = e.target.checked;
                    const checkboxes = uniqueSpeciesList.querySelectorAll(
                      'input[type="checkbox"]',
                    );
                    checkboxes.forEach((cb) => {
                      cb.checked = isChecked;
                    });
                    if (insertBtn)
                      insertBtn.disabled =
                        !isChecked || checkboxes.length === 0;
                  });
                }

                // Delegate click on individual unique species checkboxes
                if (uniqueSpeciesList) {
                  uniqueSpeciesList.addEventListener("change", (e) => {
                    if (e.target && e.target.type === "checkbox") {
                      const checkboxes = Array.from(
                        uniqueSpeciesList.querySelectorAll(
                          'input[type="checkbox"]',
                        ),
                      );
                      const checkedCount = checkboxes.filter(
                        (cb) => cb.checked,
                      ).length;
                      if (selectAllUnique) {
                        selectAllUnique.checked =
                          checkedCount === checkboxes.length &&
                          checkboxes.length > 0;
                        selectAllUnique.indeterminate =
                          checkedCount > 0 && checkedCount < checkboxes.length;
                      }
                      if (insertBtn) insertBtn.disabled = checkedCount === 0;
                    }
                  });
                }
                // --- END NEW LOGIC ---
              })(document.getElementById("bn-content-wrapper")));
            b.style.display = "flex";

            // --- RESET FIELDS ON OPEN ---
            try {
              const drop = document.getElementById("bn-saved-locations");
              if (drop) drop.value = "";
              const nameInp = document.getElementById("bn-location-name");
              if (nameInp) nameInp.value = "";
              const latInp = document.getElementById("bn-lat");
              if (latInp) latInp.value = "";
              const lonInp = document.getElementById("bn-lon");
              if (lonInp) lonInp.value = "";

              // Trigger event to disable buttons if needed
              if (nameInp) nameInp.dispatchEvent(new Event("input"));
            } catch (err) {}
            // ----------------------------

            try {
              const e = window.__lastMetadata
                  ? (window.__lastMetadata.latitude ??
                    window.__lastMetadata.lat ??
                    "")
                  : "",
                t = window.__lastMetadata
                  ? (window.__lastMetadata.longitude ??
                    window.__lastMetadata.lon ??
                    "")
                  : "",
                o = document.getElementById("bn-lat"),
                i = document.getElementById("bn-lon");
              (o && (o.value = null !== e && void 0 !== e ? String(e) : ""),
                i && (i.value = null !== t && void 0 !== t ? String(t) : ""));
            } catch (e) {}
            try {
              if (!n) {
                const e = await (async function ({ version: e = 1 } = {}) {
                  document.getElementById("bn-progress").style.display =
                    "block";
                  let n = 48e3,
                    t = 144e3,
                    o = "birdnet_v2.4.js?lang=" + navigator.language;
                  const i = new Worker(o);
                  async function s(e) {
                    return (
                      i.postMessage(e),
                      new Promise((n) => {
                        function t({ data: o }) {
                          o.message === e.message &&
                            (i.removeEventListener("message", t), n(o));
                        }
                        i.addEventListener("message", t);
                      })
                    );
                  }
                  return (
                    await new Promise((e) => {
                      function n({ data: t }) {
                        (t.progress &&
                          (document.querySelector("#bn-progress_bar").value =
                            t.progress),
                          "load_model" === t.message &&
                            (document.getElementById(
                              "bn-progress_text",
                            ).innerText = "Loading BirdNET model..."),
                          "warmup" === t.message &&
                            (document.getElementById(
                              "bn-progress_text",
                            ).innerText = "BirdNET warmup run..."),
                          "load_labels" === t.message &&
                            (document.getElementById(
                              "bn-progress_text",
                            ).innerText = "Loading bird labels..."),
                          "load_geomodel" === t.message &&
                            (document.getElementById(
                              "bn-progress_text",
                            ).innerText = "Loading geolocation model..."),
                          "loaded" === t.message &&
                            (i.removeEventListener("message", n), e()));
                      }
                      i.addEventListener("message", n);
                    }),
                    (document.getElementById("bn-progress").style.display =
                      "none"),
                    { BirdNetJS: s, SR: n, C3S: t }
                  );
                })();
                ((t = e.BirdNetJS), (o = e.SR), (i = e.C3S), (n = !0));
              }
              const e = document.getElementById("bn-start-btn");
              e && (e.disabled = !1);
            } catch (e) {
              const n = document.getElementById("bn-error");
              n && (n.innerText = e.stack || e.message);
            }
          })());
      });
  }
  const r =
    '\n        #bn-container { padding: 15px; color: #ddd; font-family: system-ui, sans-serif; background: #222; display: flex; flex-direction: column; height: 100%; box-sizing: border-box; }\n        \n        /* Frames */\n        #bn-options-frame { flex: 0 0 auto; display: flex; flex-direction: column; gap: 8px; border-bottom: 1px solid #444; padding-bottom: 10px; margin-bottom: 10px; }\n        #bn-results-frame { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; gap: 10px; }\n\n        /* Options styling */\n        .bn-control-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }\n        .bn-box { background: #333; padding: 8px; border-radius: 4px; border: 1px solid #444; }\n        .bn-row { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }\n        .bn-row:last-child { margin-bottom: 0; }\n        .bn-row label { font-size: 12px; color: #ccc; }\n        .bn-row input[type="number"], .bn-row input[type="text"], .bn-row select { background: #111; border: 1px solid #555; color: #fff; padding: 4px; border-radius: 4px; flex: 1; min-width: 0; }\n        \n        #bn-start-btn { padding: 10px; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; text-transform: uppercase; width: 100%; }\n        #bn-start-btn:hover { background: #1976D2; }\n        #bn-start-btn:disabled { background: #444; color: #888; cursor: not-allowed; }\n\n        /* Results styling */\n        #bn-results-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; flex: 1 1 auto; min-height: 0; }\n        .bn-result-col { display: flex; flex-direction: column; min-height: 0; }\n        .bn-result-col h4 { margin: 0 0 5px 0; font-size: 14px; color: #aaa; }\n        \n        #bn-birdslist, #bn-unique-species-list { \n            list-style: none; padding: 0; margin: 0; \n            background: #111; border: 1px solid #444; border-radius: 4px; \n            overflow-y: auto; flex: 1 1 auto; \n        }\n        \n        #bn-birdslist li:hover, #bn-unique-species-list li:hover { background: #222; }\n        \n        #bn-insert-annotations-btn { padding: 10px 20px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; text-transform: uppercase; flex-shrink: 0; }\n        #bn-insert-annotations-btn:hover { background: #45a049; }\n        #bn-insert-annotations-btn:disabled { background: #444; color: #888; cursor: not-allowed; }\n\n        /* Misc */\n        .bn-loader { width: 20px; height: 20px; border: 2px solid #FFF; border-bottom-color: transparent; border-radius: 50%; animation: bn-rotation 1s linear infinite; display: inline-block; vertical-align: middle; }\n        @keyframes bn-rotation { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }\n        \n        #bn-progress { margin-bottom: 5px; }\n        #bn-progress_bar { width: 100%; height: 8px; }\n        #bn-error { color: #ff6b6b; font-size: 13px; margin-bottom: 5px; }\n        #bn-log { font-size: 12px; color: #888; margin-bottom: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n        .bn-small-btn { padding: 4px 10px; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: bold; text-transform: uppercase; transition: background 0.2s; }\n        .bn-small-btn:disabled { cursor: not-allowed; opacity: 0.4; filter: grayscale(100%); }\n        #bn-save-location-btn { background: #2196F3; }\n        #bn-save-location-btn:hover:not(:disabled) { background: #1976D2; }\n        #bn-delete-location-btn { background: #cc0000; }\n        #bn-delete-location-btn:hover:not(:disabled) { background: #a00000; }\n\n    ';
  function c() {
    const e = new Set();
    document.querySelectorAll("#bn-birdslist span").forEach((n) => {
      const t = Number(n.attributes["data-confidence"].value),
        o =
          Number(n.attributes["data-geoscore"].value) >= a - 0.005 &&
          t >= s - 0.005;
      n.parentNode.style.display = o ? "" : "none";
      if (o) e.add(n.textContent);
    });
    const n = document.getElementById("bn-unique-species-list");
    const t = new Set(
      Array.from(n.querySelectorAll("input:checked")).map((e) => e.value),
    );
    const isFirstTime = n.children.length === 0;
    n.innerHTML = "";
    const o = Array.from(e).sort();
    let allChecked = true;
    o.forEach((e) => {
      let isChecked = isFirstTime ? true : t.has(e);
      if (!isChecked) allChecked = false;
      const li = document.createElement("li");
      li.innerHTML = `<label><input type="checkbox" value="${e}" ${isChecked ? "checked" : ""}> ${e}</label>`;
      n.appendChild(li);
    });
    const i = document.getElementById("bn-insert-annotations-btn");
    i && (i.disabled = 0 === o.length);
    const selectAllCheckbox = document.getElementById("bn-select-all-unique");
    if (selectAllCheckbox) {
      selectAllCheckbox.disabled = o.length === 0;
      selectAllCheckbox.checked = o.length > 0 && allChecked;
      selectAllCheckbox.indeterminate =
        o.length > 0 &&
        !allChecked &&
        n.querySelectorAll("input:checked").length > 0;
    }
  }
  "loading" === document.readyState
    ? document.addEventListener("DOMContentLoaded", l)
    : l();
})();
