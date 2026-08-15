// recent_species.js
// Provides a floating panel showing the last 10 selected species.

(function () {
  const MAX_SPECIES = 10;
  let recentSpecies = [];
  let displayMode = "common"; // 'common' or 'scientific'
  let isActive = true;
  let isCollapsed = false;
  let isSpectrogramLoaded = !!(
    globalThis._spectroAudioBuffer || globalThis._spectroSpectra
  );

  // Initialize from settings and load saved recent species
  try {
    const raw = localStorage.getItem("spectrolipi.settings.v1");
    if (raw) {
      const s = JSON.parse(raw);
      if (s.defaultSpeciesFormat) displayMode = s.defaultSpeciesFormat;
      if (s.recentSpeciesEnabled === false) isActive = false;
    }
  } catch (e) {}

  function loadRecentSpeciesFromStorage() {
    try {
      const rawList = localStorage.getItem("spectrolipi.recentSpecies.v1");
      if (rawList) {
        recentSpecies = JSON.parse(rawList);
        recentSpecies.forEach((sp, idx) => {
          if (!sp.addedAt) {
            sp.addedAt = Date.now() - idx * 1000;
          }
        });
      } else {
        recentSpecies = [];
      }
    } catch (e) {}
  }

  // Initial load
  loadRecentSpeciesFromStorage();

  window.__reloadSmartList = function () {
    loadRecentSpeciesFromStorage();
    if (typeof renderList === "function") renderList();
  };

  function saveRecentSpecies() {
    try {
      localStorage.setItem(
        "spectrolipi.recentSpecies.v1",
        JSON.stringify(recentSpecies),
      );
    } catch (err) {}
  }

  function sortRecentSpecies() {
    recentSpecies.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return (b.addedAt || 0) - (a.addedAt || 0);
    });
  }

  // Create UI
  const container = document.createElement("div");
  container.id = "recentSpeciesPanel";
  container.style.cssText = `
    position: fixed;
    right: 14px;
    top: 80px;
    width: 240px;
    background: rgba(17, 17, 17, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 6px;
    z-index: 999990;
    backdrop-filter: blur(4px);
    display: none;
    flex-direction: column;
    overflow: visible;
    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
  `;

  // Collapsed View
  const collapsedView = document.createElement("div");
  collapsedView.style.cssText = `
    display: none;
    width: 50px;
    height: 50px;
    border-radius: 25px;
    background: rgba(30, 30, 30, 0.85);
    border: 2px solid #555;
    color: white;
    font-size: 10px;
    font-weight: bold;
    text-align: center;
    align-items: center;
    justify-content: center;
    cursor: grab;
    user-select: none;
    line-height: 1.2;
    box-sizing: border-box;
  `;
  collapsedView.innerHTML = `Smart<br>List`;

  collapsedView.addEventListener("mouseenter", () => {
    collapsedView.style.background = "rgba(50, 50, 50, 0.95)";
    collapsedView.style.border = "2px solid #777";
  });
  collapsedView.addEventListener("mouseleave", () => {
    collapsedView.style.background = "rgba(30, 30, 30, 0.85)";
    collapsedView.style.border = "2px solid #555";
  });

  // Expanded View
  const expandedView = document.createElement("div");
  expandedView.style.cssText = `
    display: flex;
    flex-direction: column;
    width: 100%;
  `;

  // Header with toggle button
  const header = document.createElement("div");
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.5);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    cursor: grab;
    user-select: none;
  `;

  const titleGroup = document.createElement("div");
  titleGroup.style.cssText =
    "display:flex; align-items:center; gap:6px; pointer-events: none;";

  const title = document.createElement("div");
  title.textContent = "Smart List";
  title.style.cssText =
    "font-size: 11px; font-weight: 600; color: #aaa; text-transform: uppercase; pointer-events: none;";

  const toggleBtn = document.createElement("button");
  toggleBtn.className = "mode-btn";
  toggleBtn.title = "Cycle display mode: Scientific / Common";
  toggleBtn.style.cssText =
    "padding: 2px 6px; font-size: 11px; height: 20px; pointer-events: auto;";

  const badgeClasses = {
    common: "mode-badge m-Common",
    scientific: "mode-badge m-Sci",
  };
  const badgeLabels = {
    common: "Com",
    scientific: "Sci",
  };

  function updateToggleUI() {
    toggleBtn.innerHTML = `<span class="${badgeClasses[displayMode]}">${badgeLabels[displayMode]}</span>`;
  }
  updateToggleUI();

  toggleBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    displayMode = displayMode === "scientific" ? "common" : "scientific";
    updateToggleUI();
    renderList();
  });

  const closeBtn = document.createElement("span");
  closeBtn.textContent = "✕";
  closeBtn.style.cssText =
    "cursor: pointer; padding: 0 4px; font-size: 12px; color: #ccc; pointer-events: auto;";
  closeBtn.onpointerdown = (e) => e.stopPropagation();
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    isCollapsed = true;
    renderList();
  };

  titleGroup.appendChild(title);
  titleGroup.appendChild(toggleBtn);
  header.appendChild(titleGroup);
  header.appendChild(closeBtn);
  expandedView.appendChild(header);

  // Dragging logic
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let dragMoved = false;

  function onDragStart(e, target) {
    if (e.target.closest("button") || e.target === closeBtn) return;
    isDragging = true;
    dragMoved = false;
    target.style.cursor = "grabbing";
    const rect = container.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    try {
      target.setPointerCapture(e.pointerId);
    } catch (err) {}
  }

  function onDragMove(e) {
    if (!isDragging) return;
    dragMoved = true;
    let newLeft = e.clientX - dragOffsetX;
    let newTop = e.clientY - dragOffsetY;

    let maxLeft = window.innerWidth - container.offsetWidth;
    let maxTop = window.innerHeight - container.offsetHeight;
    let minLeft = 0;
    let minTop = 0;

    const viewport =
      document.getElementById("viewportWrapper") ||
      document.getElementById("spectrogramCanvas");
    if (viewport) {
      const vRect = viewport.getBoundingClientRect();
      minLeft = vRect.left;
      minTop = vRect.top;
      maxLeft = vRect.right - container.offsetWidth;
      maxTop = vRect.bottom - container.offsetHeight;
    }

    container.style.right = "auto"; // Disable 'right' so 'left' takes over
    container.style.left = Math.max(minLeft, Math.min(newLeft, maxLeft)) + "px";
    container.style.top = Math.max(minTop, Math.min(newTop, maxTop)) + "px";
  }

  function onDragEnd(e, target) {
    isDragging = false;
    target.style.cursor = "grab";
    try {
      target.releasePointerCapture(e.pointerId);
    } catch (err) {}
  }

  header.addEventListener("pointerdown", (e) => onDragStart(e, header));
  header.addEventListener("pointermove", onDragMove);
  header.addEventListener("pointerup", (e) => onDragEnd(e, header));

  collapsedView.addEventListener("pointerdown", (e) =>
    onDragStart(e, collapsedView),
  );
  collapsedView.addEventListener("pointermove", onDragMove);
  collapsedView.addEventListener("pointerup", (e) => {
    onDragEnd(e, collapsedView);
    if (!dragMoved) {
      isCollapsed = false;
      renderList();
    }
  });

  // List container
  const listContainer = document.createElement("div");
  listContainer.style.cssText = `
    display: flex;
    flex-direction: column;
    max-height: 420px;
    overflow-y: auto;
  `;
  expandedView.appendChild(listContainer);

  container.appendChild(collapsedView);
  container.appendChild(expandedView);

  function renderList() {
    // Dynamic fallback: if the spectrogram-generated event was missed, check globals directly
    if (!isSpectrogramLoaded) {
      isSpectrogramLoaded = !!(
        globalThis._spectroAudioBuffer || globalThis._spectroSpectra
      );
    }
    if (!isActive || !isSpectrogramLoaded) {
      container.style.display = "none";
      return;
    }

    container.style.display = "flex";

    if (isCollapsed) {
      expandedView.style.display = "none";
      collapsedView.style.display = "flex";
      container.style.width = "50px";
      container.style.height = "50px";
      container.style.borderRadius = "25px";
      container.style.background = "transparent";
      container.style.border = "none";
      container.style.boxShadow = "none";
      container.style.overflow = "visible";
      container.style.backdropFilter = "none";
      return; // Nothing else to render when collapsed
    } else {
      collapsedView.style.display = "none";
      expandedView.style.display = "flex";
      container.style.width = "240px";
      container.style.height = "auto";
      container.style.borderRadius = "6px";
      container.style.background = "rgba(17, 17, 17, 0.85)";
      container.style.border = "1px solid rgba(255, 255, 255, 0.15)";
      container.style.boxShadow = "0 4px 12px rgba(0,0,0,0.5)";
      container.style.overflow = "hidden";
      container.style.backdropFilter = "blur(4px)";
    }

    listContainer.innerHTML = "";
    const elHidden = document.getElementById("selectedSpeciesKey");
    const elResult = document.getElementById("speciesResult");
    const selSci = elHidden ? elHidden.value || "" : "";
    const selText = elResult ? elResult.textContent || "" : "";
    const isResultEmpty =
      elResult && elResult.parentElement
        ? elResult.parentElement.classList.contains("empty")
        : true;

    recentSpecies.forEach((sp, idx) => {
      let isSelected = false;
      if (!isResultEmpty) {
        if (
          selSci &&
          sp.scientific &&
          selSci.toLowerCase() === sp.scientific.toLowerCase()
        ) {
          isSelected = true;
        } else if (
          !selSci &&
          selText &&
          (selText.toLowerCase() === (sp.common || "").toLowerCase() ||
            selText.toLowerCase() === (sp.scientific || "").toLowerCase())
        ) {
          isSelected = true;
        }
      }

      const row = document.createElement("div");
      const baseBg = isSelected ? "rgba(255, 167, 38, 0.35)" : "transparent";
      row.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 10px;
        font-size: 12px;
        color: #fff;
        cursor: pointer;
        border-bottom: 1px solid rgba(255,255,255,0.05);
        transition: background 0.1s;
        background: ${baseBg};
        font-weight: ${isSelected ? "600" : "normal"};
      `;
      if (idx === recentSpecies.length - 1) {
        row.style.borderBottom = "none";
      }

      const textSpan = document.createElement("span");
      textSpan.style.cssText =
        "white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;";
      const primaryText =
        displayMode === "common"
          ? sp.common || sp.scientific
          : sp.scientific || sp.common;
      textSpan.textContent = primaryText;

      const actionContainer = document.createElement("div");
      actionContainer.style.cssText =
        "display: flex; align-items: center; gap: 4px;";

      const removeBtn = document.createElement("div");
      removeBtn.title = "Remove species";
      removeBtn.style.cssText = `
        padding: 2px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #ff5252;
        opacity: 0;
        transition: opacity 0.2s, background 0.2s;
        border-radius: 3px;
      `;
      removeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

      removeBtn.addEventListener("mouseenter", () => {
        removeBtn.style.background = "rgba(255, 0, 0, 0.2)";
      });
      removeBtn.addEventListener("mouseleave", () => {
        removeBtn.style.background = "transparent";
      });

      removeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        recentSpecies.splice(idx, 1);
        saveRecentSpecies();
        renderList();
      });

      const pinBtn = document.createElement("div");
      pinBtn.title = sp.isPinned ? "Unpin species" : "Pin species";
      pinBtn.style.cssText = `
        padding: 2px 4px;
        margin-left: 6px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: opacity 0.2s, color 0.2s;
        color: ${sp.isPinned ? "#64B5F6" : "#aaa"};
        opacity: ${sp.isPinned ? "1" : "0.6"};
      `;

      const iconHtmlSolid = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <g transform="translate(12,12) rotate(45) translate(-12,-12)">
          <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h4.5v6.5l.5.5.5-.5V16H16v-2l-2-2z"/>
        </g>
      </svg>`;

      const iconHtmlUnpinned = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <mask id="pin-slash-mask-${idx}">
          <rect width="24" height="24" fill="white"/>
          <line x1="3" y1="3" x2="21" y2="21" stroke="black" stroke-width="4" stroke-linecap="round"/>
        </mask>
        <g mask="url(#pin-slash-mask-${idx})">
          <g transform="translate(12,12) rotate(45) translate(-12,-12)">
            <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h4.5v6.5l.5.5.5-.5V16H16v-2l-2-2z"/>
          </g>
        </g>
        <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
      </svg>`;

      pinBtn.innerHTML = sp.isPinned ? iconHtmlSolid : iconHtmlUnpinned;

      pinBtn.addEventListener("mouseenter", () => {
        if (!sp.isPinned) pinBtn.style.opacity = "1";
      });
      pinBtn.addEventListener("mouseleave", () => {
        if (!sp.isPinned) pinBtn.style.opacity = "0.6";
      });

      pinBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        sp.isPinned = !sp.isPinned;
        sortRecentSpecies();
        saveRecentSpecies();
        renderList();
      });

      row.addEventListener("mouseenter", () => {
        row.style.background = "rgba(21, 101, 192, 0.7)";
        removeBtn.style.opacity = "1";
      });
      row.addEventListener("mouseleave", () => {
        row.style.background = baseBg;
        removeBtn.style.opacity = "0";
      });

      row.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        triggerSelection(sp);
      });

      actionContainer.appendChild(removeBtn);
      actionContainer.appendChild(pinBtn);

      row.appendChild(textSpan);
      row.appendChild(actionContainer);
      listContainer.appendChild(row);
    });
  }

  function setFloatingRecentSpecies(state) {
    isActive = !!state;
    renderList();

    try {
      const raw = localStorage.getItem("spectrolipi.settings.v1");
      if (raw) {
        const s = JSON.parse(raw);
        if (s.recentSpeciesEnabled !== isActive) {
          s.recentSpeciesEnabled = isActive;
          localStorage.setItem("spectrolipi.settings.v1", JSON.stringify(s));
          // Update the checkbox in the settings modal if it's open
          const cb = document.getElementById("ss-recent-species");
          if (cb) cb.checked = isActive;
        }
      }
    } catch (e) {}
  }
  window.setFloatingRecentSpecies = setFloatingRecentSpecies;

  function triggerSelection(sp) {
    const elHidden = document.getElementById("selectedSpeciesKey");
    const elResult = document.getElementById("speciesResult");
    const elClear = document.getElementById("speciesClearBtn");
    const elResultWrap = document.querySelector(".species-result-wrap");
    if (!elHidden || !elResult || !elResultWrap) return;

    if (
      elHidden.value === sp.scientific &&
      elResult.textContent === (sp.scientific || sp.common)
    ) {
      return;
    }

    elHidden.value = sp.scientific || "";
    elResult.textContent = sp.scientific || sp.common || "";
    elResult.title = sp.scientific || sp.common || "";
    elResult.dataset.common = sp.common || "";
    elResult.dataset.scientific = sp.scientific || "";
    if (elClear) elClear.style.display = "inline-flex";
    elResultWrap.classList.remove("empty");
    elHidden.dispatchEvent(new Event("input", { bubbles: true }));

    const wrapper = document.querySelector(".species-search");
    if (wrapper)
      wrapper.dispatchEvent(
        new CustomEvent("species-select", {
          detail: { common: sp.common, scientific: sp.scientific },
          bubbles: true,
        }),
      );
  }

  function injectContainer() {
    const parent = document.body;
    if (parent && !document.getElementById("recentSpeciesPanel")) {
      parent.appendChild(container);
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    injectContainer();
    renderList(); // Initial render for persisted items
  });
  injectContainer();
  renderList(); // Initial render if DOM already loaded

  window.addEventListener("spectrogram-generated", () => {
    isSpectrogramLoaded = true;
    if (_spectroPoller) {
      clearInterval(_spectroPoller);
      _spectroPoller = null;
    }
    renderList();
  });

  // Fallback poller: the spectrogram-generated event doesn't always reach this
  // listener (last script loaded), so poll the globals until spectrogram is detected.
  let _spectroPoller = !isSpectrogramLoaded
    ? setInterval(() => {
        if (globalThis._spectroAudioBuffer || globalThis._spectroSpectra) {
          isSpectrogramLoaded = true;
          clearInterval(_spectroPoller);
          _spectroPoller = null;
          renderList();
        }
      }, 500)
    : null;

  // Listen for species selections globally
  window.addEventListener("species-select", (e) => {
    if (!e.detail || (!e.detail.scientific && !e.detail.common)) return;

    const sp = {
      common: e.detail.common || "",
      scientific: e.detail.scientific || "",
    };

    const isExisting = recentSpecies.some(
      (x) => (x.scientific || x.common) === (sp.scientific || sp.common),
    );
    if (isExisting) {
      // FIFO: If already in the list, no action is taken to preserve its exact chronological position
      renderList(); // Still need to render to update the highlight!
      return;
    }

    const pinnedCount = recentSpecies.filter((x) => x.isPinned).length;
    if (pinnedCount >= MAX_SPECIES) {
      // List is completely filled with pinned species; cannot add new unpinned item
      return;
    }

    sp.isPinned = false;
    sp.addedAt = Date.now();
    recentSpecies.push(sp);
    sortRecentSpecies();

    if (recentSpecies.length > MAX_SPECIES) {
      // The array is sorted: Pinned first, then Unpinned newest->oldest
      // Thus, the very last element is guaranteed to be the oldest unpinned item.
      recentSpecies.pop();
    }

    saveRecentSpecies();
    renderList();
  });

  window.addEventListener("species-select-cleared", () => {
    renderList();
  });
})();
