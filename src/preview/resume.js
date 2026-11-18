// Resume preview page functionality
// Configuration is read from data attributes on the body element
//
// The WebSocket and pan/zoom logic mirrors src/preview/script.js so both
// preview pages behave the same way.

(function () {
  // ===== Configuration =====
  const config = {
    resumeId: document.body.dataset.resumeId,
    port: document.body.dataset.port,
    liveEnabled: document.body.dataset.liveEnabled === "true",
  };

  /**
   * Looks up a translated string. Falls back to the key when the i18n module
   * is unavailable, so a broken script shows a key instead of an empty page.
   */
  function t(key, vars) {
    const i18n = window.RPI18n;
    return i18n ? i18n.t(key, vars) : key;
  }

  // ===== Constants =====
  const MIN_SCALE = 0.1;
  const MAX_SCALE = 10;
  const ZOOM_BUTTON_FACTOR = 1.2;
  const WHEEL_ZOOM_FACTOR = 0.001;

  // ===== DOM Elements =====
  const elements = {
    viewport: document.querySelector(".resume-viewport"),
    sheet: document.querySelector(".resume-sheet"),
    statusText: document.getElementById("status-text"),
    statusIndicator: document.getElementById("status-indicator"),
    resetButton: document.getElementById("reset-pan"),
    backButton: document.getElementById("back-button"),
    zoomInButton: document.getElementById("zoom-in"),
    zoomOutButton: document.getElementById("zoom-out"),
    zoomLevel: document.getElementById("zoom-level"),
    exportButton: document.getElementById("export-btn"),
    exportMenu: document.getElementById("export-menu"),
  };

  // ===== Pan/Zoom State =====
  const panState = {
    x: 0,
    y: 0,
    scale: 1,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
  };

  // ===== WebSocket State =====
  const wsState = {
    connection: null,
    reconnectInterval: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 30,
  };

  // ===== Pan/Zoom Functions =====
  function clampScale(value) {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
  }

  function updateZoomLevel() {
    if (elements.zoomLevel) {
      elements.zoomLevel.textContent = `${Math.round(panState.scale * 100)}%`;
    }
  }

  function resetView() {
    panState.x = 0;
    panState.y = 0;
    panState.scale = 1;
    applyTransform();
    updateZoomLevel();
  }

  function applyTransform() {
    if (elements.sheet) {
      elements.sheet.style.transform = `translate(${panState.x}px, ${panState.y}px) scale(${panState.scale})`;
    }
  }

  function zoomAtPoint(newScale, pivotX, pivotY) {
    newScale = clampScale(newScale);
    const ratio = 1 - newScale / panState.scale;
    panState.x += (pivotX - panState.x) * ratio;
    panState.y += (pivotY - panState.y) * ratio;
    panState.scale = newScale;
    applyTransform();
    updateZoomLevel();
  }

  function zoomAtCenter(newScale) {
    if (!elements.viewport) return;
    const rect = elements.viewport.getBoundingClientRect();
    zoomAtPoint(newScale, rect.width / 2, rect.height / 2);
  }

  function normalizeWheelDelta(e) {
    var deltaY = e.deltaY;
    if (e.deltaMode === 1) deltaY *= 40;
    else if (e.deltaMode === 2) deltaY *= 800;
    return deltaY;
  }

  function handleWheel(e) {
    if (!elements.viewport) return;
    e.preventDefault();
    const rect = elements.viewport.getBoundingClientRect();
    const pivotX = e.clientX - rect.left;
    const pivotY = e.clientY - rect.top;
    const newScale = clampScale(panState.scale - normalizeWheelDelta(e) * WHEEL_ZOOM_FACTOR);
    zoomAtPoint(newScale, pivotX, pivotY);
  }

  function handleMouseDown(e) {
    if (!elements.viewport || e.target.closest(".status-bar")) return;
    panState.isDragging = true;
    panState.dragStartX = e.clientX - panState.x;
    panState.dragStartY = e.clientY - panState.y;
    elements.viewport.style.cursor = "grabbing";
    e.preventDefault();
  }

  function handleMouseUp(e) {
    panState.isDragging = false;
    if (elements.viewport) {
      elements.viewport.style.cursor = "grab";
    }
  }

  function handleMouseMove(e) {
    if (!panState.isDragging) return;
    panState.x = e.clientX - panState.dragStartX;
    panState.y = e.clientY - panState.dragStartY;
    applyTransform();
  }

  // ===== Touch Event Handlers =====
  function handleTouchStart(e) {
    if (!elements.viewport) return;
    if (e.touches.length !== 1) return;
    panState.isDragging = true;
    panState.dragStartX = e.touches[0].clientX - panState.x;
    panState.dragStartY = e.touches[0].clientY - panState.y;
    elements.viewport.style.cursor = "grabbing";
    e.preventDefault();
  }

  function handleTouchMove(e) {
    if (!panState.isDragging) return;
    panState.x = e.touches[0].clientX - panState.dragStartX;
    panState.y = e.touches[0].clientY - panState.dragStartY;
    applyTransform();
    e.preventDefault();
  }

  function handleTouchEnd(e) {
    panState.isDragging = false;
  }

  // ===== Status Update Functions =====
  function setStatus(text, isConnected) {
    if (elements.statusText) {
      elements.statusText.textContent = text;
    }
    if (elements.statusIndicator) {
      elements.statusIndicator.classList.toggle("disconnected", !isConnected);
    }
  }

  // ===== WebSocket Functions =====
  function handleWebSocketOpen() {
    console.log("WebSocket connected");
    setStatus(t("preview.statusLive"), true);
    wsState.reconnectAttempts = 0;
    if (wsState.reconnectInterval) {
      clearInterval(wsState.reconnectInterval);
      wsState.reconnectInterval = null;
    }
  }

  function handleWebSocketMessage(event) {
    if (event.data === "reload") {
      console.log("Reloading resume...");
      location.reload();
    }
  }

  function handleWebSocketClose() {
    console.log("WebSocket disconnected");

    if (wsState.reconnectAttempts >= wsState.maxReconnectAttempts) {
      setStatus(t("preview.statusFailed"), false);
      console.warn(
        `Max reconnection attempts (${wsState.maxReconnectAttempts}) reached. Stop reconnecting.`
      );
      return;
    }

    setStatus(t("preview.statusDisconnected"), false);

    if (!wsState.reconnectInterval) {
      wsState.reconnectInterval = setInterval(() => {
        if (wsState.reconnectAttempts >= wsState.maxReconnectAttempts) {
          clearInterval(wsState.reconnectInterval);
          wsState.reconnectInterval = null;
          setStatus(t("preview.statusFailed"), false);
          return;
        }
        wsState.reconnectAttempts++;
        console.log(
          `Attempting to reconnect... (${wsState.reconnectAttempts}/${wsState.maxReconnectAttempts})`
        );
        connectWebSocket();
      }, 2000);
    }
  }

  function handleWebSocketError(error) {
    console.error("WebSocket error:", error);
    if (wsState.connection) {
      wsState.connection.close();
    }
  }

  function connectWebSocket() {
    if (!config.port || !config.resumeId) return;
    wsState.connection = new WebSocket(
      `ws://localhost:${config.port}/resume/${encodeURIComponent(config.resumeId)}`
    );
    wsState.connection.onopen = handleWebSocketOpen;
    wsState.connection.onmessage = handleWebSocketMessage;
    wsState.connection.onclose = handleWebSocketClose;
    wsState.connection.onerror = handleWebSocketError;
  }

  // ===== Export Functions =====
  function getFilename(format) {
    return `${config.resumeId || "resume"}.${format}`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function exportResume(format) {
    if (!config.resumeId) {
      alert(t("preview.exportMissingId"));
      return;
    }

    const exportUrl = `${window.location.origin}/resume/export/${encodeURIComponent(
      config.resumeId
    )}?format=${encodeURIComponent(format)}`;

    fetch(exportUrl)
      .then(function (response) {
        if (!response.ok) {
          throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }
        return response.blob();
      })
      .then(function (blob) {
        downloadBlob(blob, getFilename(format));
      })
      .catch(function (error) {
        console.error("Resume export failed", error);
        alert(t("preview.exportFailed", { message: error.message }));
      });
  }

  function handleExport(format) {
    hideExportMenu();
    exportResume(format);
  }

  function toggleExportMenu() {
    if (elements.exportMenu) {
      elements.exportMenu.classList.toggle("visible");
    }
  }

  function hideExportMenu() {
    if (elements.exportMenu) {
      elements.exportMenu.classList.remove("visible");
    }
  }

  // ===== Initialization =====
  function initializePanZoom() {
    if (elements.viewport) {
      elements.viewport.addEventListener("mousedown", handleMouseDown);
      document.addEventListener("mouseup", handleMouseUp);
      document.addEventListener("mousemove", handleMouseMove);
      elements.viewport.addEventListener("wheel", handleWheel, { passive: false });
      elements.viewport.addEventListener("touchstart", handleTouchStart, { passive: false });
      elements.viewport.addEventListener("touchmove", handleTouchMove, { passive: false });
      elements.viewport.addEventListener("touchend", handleTouchEnd);
      elements.viewport.style.cursor = "grab";
    }
    if (elements.resetButton) {
      elements.resetButton.addEventListener("click", resetView);
    }
    if (elements.backButton) {
      elements.backButton.addEventListener("click", function () {
        if (window.history.length > 1) {
          window.history.back();
        } else {
          window.location.href = "/";
        }
      });
    }
    if (elements.zoomInButton) {
      elements.zoomInButton.addEventListener("click", function () {
        zoomAtCenter(panState.scale * ZOOM_BUTTON_FACTOR);
      });
    }
    if (elements.zoomOutButton) {
      elements.zoomOutButton.addEventListener("click", function () {
        zoomAtCenter(panState.scale / ZOOM_BUTTON_FACTOR);
      });
    }

    if (elements.exportButton) {
      elements.exportButton.addEventListener("click", function (e) {
        e.stopPropagation();
        toggleExportMenu();
      });
    }

    if (elements.exportMenu) {
      elements.exportMenu.querySelectorAll(".export-option").forEach(function (btn) {
        btn.addEventListener("click", function () {
          handleExport(this.dataset.format);
        });
      });
    }

    document.addEventListener("click", function (e) {
      if (!e.target.closest(".export-dropdown")) {
        hideExportMenu();
      }
    });
  }

  function initializeWebSocket() {
    if (!config.liveEnabled) {
      setStatus(t("preview.statusStatic"), false);
      return;
    }
    connectWebSocket();
  }

  function initialize() {
    initializePanZoom();
    initializeWebSocket();
  }

  // Cleanup on page unload
  function cleanup() {
    if (wsState.connection) {
      wsState.connection.close();
      wsState.connection = null;
    }
    if (wsState.reconnectInterval) {
      clearInterval(wsState.reconnectInterval);
      wsState.reconnectInterval = null;
    }
  }

  // Register cleanup handler
  window.addEventListener("beforeunload", cleanup);

  // Start the application. The dictionary has to be in place before the
  // status line shows anything.
  const i18nReady = window.RPI18n ? window.RPI18n.ready : Promise.resolve();
  i18nReady.then(function () {
    initialize();
  });
})();
