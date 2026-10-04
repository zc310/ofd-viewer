import { ZOOM_STEP, createElements, createState } from "./state.js";
import { activateTab, addTab, applyOpened, activeDocument, clearTabDocument, removeTab, tabForDocument, tabForPath } from "./tabs.js";
import { createViewer } from "./viewer.js";
import { createThumbnails } from "./thumbnails.js";
import { createTextLayer } from "./text-layer.js";

const RECENT_FILES_KEY = "ofd-viewer-recent-files";
const RECENT_FILES_LIMIT = 8;
const THUMBNAILS_VISIBLE_KEY = "ofd-viewer-thumbnails-visible";

const state = createState();
const elements = createElements();
let viewer;
let thumbnails;
let textLayer;

function currentTab() {
  return activeDocument(state.tabs);
}

function renderTabBar() {
  elements.tabBar.replaceChildren();
  const tabs = [...state.tabs.tabs.values()].filter((tab) => tab.path || tab.documentId);
  elements.tabBar.hidden = tabs.length < 2;
  for (const tab of tabs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tab${tab.id === state.tabs.activeTabId ? " active" : ""}`;
    button.dataset.tabId = tab.id;
    button.setAttribute("aria-selected", String(tab.id === state.tabs.activeTabId));
    button.setAttribute("role", "tab");
    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = tab.name || tab.path || "正在打开...";
    label.title = tab.path || label.textContent;
    const close = document.createElement("span");
    close.className = "tab-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "关闭标签");
    button.append(label, close);
    button.addEventListener("click", (event) => {
      if (event.target === close) closeTab(tab);
      else switchTab(tab.id);
    });
    elements.tabBar.appendChild(button);
  }
}

function tabHasDocument(tab) {
  return Boolean(tab?.documentId && tab.pages.length);
}

function appBridge() {
  return window.go?.main?.App || null;
}

async function invoke(name, ...args) {
  const bridge = appBridge();
  if (!bridge || typeof bridge[name] !== "function") throw new Error("Wails bridge 尚未准备完成");
  return bridge[name](...args);
}

function setConnection(value, kind = "") {
  elements.connectionStatus.textContent = value;
  elements.connectionStatus.className = `connection-status ${kind}`;
}

function setRenderStatus(value) {
  elements.renderStatus.textContent = value;
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "未知大小";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes;
  let unit = -1;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function formatModifiedAt(value) {
  if (!value) return "未知修改时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知修改时间";
  try {
    return `修改于 ${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date)}`;
  } catch {
    return `修改于 ${date.toLocaleString("zh-CN")}`;
  }
}

function updateFileMetadata() {
  elements.fileMetadata.textContent = state.fileSize
    ? `${formatFileSize(state.fileSize)} · ${formatModifiedAt(state.modifiedAt)}`
    : "未打开文档";
}

function tabForPending(requestId) {
  return state.pending.get(requestId)?.tab || null;
}

function revokeTabCache(tab) {
  for (const url of tab.imageCache.values()) URL.revokeObjectURL(url);
  for (const url of tab.thumbnailCache.values()) URL.revokeObjectURL(url);
  tab.imageCache.clear();
  tab.thumbnailCache.clear();
}

function mountTab(tab, alreadyDeactivated = false) {
  if (!alreadyDeactivated) viewer.deactivate();
  activateTab(state.tabs, tab.id);
  renderTabBar();
  elements.documentName.textContent = tab.name || "未打开文档";
  elements.documentPages.textContent = `${tab.pages.length} 页`;
  updateFileMetadata();
  elements.workerCount.textContent = `${tab.workers || 0} workers`;
  elements.pageTotal.textContent = `/ ${tab.pages.length}`;
  elements.pageInput.max = String(Math.max(1, tab.pages.length));
  elements.pageInput.value = tab.pages.length ? String(tab.currentPage + 1) : "";
  elements.emptyState.hidden = tab.pages.length > 0;
  elements.pageList.hidden = tab.pages.length === 0;
  elements.copyPath.disabled = !tab.path;
  elements.closeDocument.disabled = !tab.documentId;
  elements.rotatePage.disabled = !tab.pages.length;
  elements.copyPageText.disabled = !tab.pages.length;
  elements.copyDocumentText.disabled = !tab.pages.length;
  elements.downloadPage.disabled = !viewer.currentPageURL();
  elements.printPage.disabled = !viewer.currentPageURL();
  elements.searchInput.value = "";
  elements.searchStatus.textContent = tab.searchResults.length ? `找到 ${tab.searchResults.length} 处` : "";
  elements.zoomValue.textContent = `${Math.round(tab.zoom * 100)}%`;
  setButtonLabel(elements.rotatePage, `旋转 ${tab.rotation}°`);
  if (!tab.pages.length) {
    viewer.clearDocumentView();
    renderTabBar();
    return;
  }
  viewer.renderPageShells();
  thumbnails.render();
  viewer.setCurrentPage(tab.currentPage);
  for (const [key, url] of tab.imageCache) {
    const [page, dpi] = key.split(":").map(Number);
    if (Number.isFinite(page) && Number.isFinite(dpi)) viewer.setPageImage(page, url, null, null, dpi);
  }
  const defaultFit = tab.defaultFitPending && !tab.fitMode;
  if (tab.fitMode === "width") viewer.fitWidth();
  else if (tab.fitMode === "page") viewer.fitPage();
  else viewer.updatePageGeometry();
  if (defaultFit) {
    requestAnimationFrame(() => {
      if (currentTab() === tab && tab.defaultFitPending && !tab.fitMode) {
        viewer.fitWidth();
        tab.defaultFitPending = false;
      }
    });
  }
  textLayer.renderSearchHighlights();
  viewer.updateRenderProgress();
  viewer.requestVisiblePages();
  viewer.requestInitialPages();
  elements.viewer.scrollTop = tab.scrollTop || 0;
  viewer.refreshVirtualWindow();
}

function switchTab(tabId) {
  const tab = state.tabs.tabs.get(tabId);
  if (tab && tab.id !== state.tabs.activeTabId) mountTab(tab);
}

function closeTab(tab, notifyBackend = true) {
  if (!tab) return;
  const isActive = tab.id === state.tabs.activeTabId;
  for (const [requestId, pending] of state.pending) {
    if (pending.tab !== tab) continue;
    if (tab.documentId) {
      try { send({ type: "cancel", documentId: tab.documentId, requestId }); } catch { /* Socket may be closed. */ }
    }
    pending.reject?.(new Error("文档已关闭"));
    if (pending.open) state.orphanOpenRequests.add(requestId);
    state.pending.delete(requestId);
  }
  if (notifyBackend && tab.documentId) {
    try { send({ type: "close", documentId: tab.documentId }); } catch { /* Socket may be closed. */ }
  }
  revokeTabCache(tab);
  if (isActive) viewer.deactivate();
  removeTab(state.tabs, tab.id);
  renderTabBar();
  const next = currentTab();
  if (next) mountTab(next, isActive);
  else viewer.clearDocumentView();
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.remove("visible"), 3200);
}

function setButtonLabel(button, label) {
  const icon = button.querySelector(".icon");
  button.replaceChildren(...(icon ? [icon] : []));
  button.setAttribute("aria-label", label);
  button.title = label;
  button.dataset.tooltip = label;
}

function closePopups(except = null) {
  const popups = [
    [elements.recentPanel, elements.recentToggle],
    [elements.settingsPanel, elements.settingsToggle],
    [elements.searchPanel, elements.searchToggle],
  ];
  for (const [panel, toggle] of popups) {
    if (panel === except) continue;
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  }
}


function openAboutDialog() {
  if (!elements.aboutDialog) return;
  if (typeof elements.aboutDialog.showModal === "function") elements.aboutDialog.showModal();
  else elements.aboutDialog.setAttribute("open", "");
  if (elements.aboutClose) elements.aboutClose.focus();
}

function closeAboutDialog() {
  if (!elements.aboutDialog) return;
  if (typeof elements.aboutDialog.close === "function") elements.aboutDialog.close();
  else elements.aboutDialog.removeAttribute("open");
}
function readRecentFiles() {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_FILES_KEY) || "[]");
    if (!Array.isArray(value)) return [];
    return value.map((file) => {
      if (typeof file === "string") return { path: file, name: file.split(/[\\/]/).pop() };
      if (!file || typeof file !== "object" || typeof file.path !== "string" || !file.path) return null;
      return {
        path: file.path,
        name: typeof file.name === "string" && file.name ? file.name : file.path.split(/[\\/]/).pop(),
        openedAt: Number(file.openedAt) || 0,
      };
    }).filter(Boolean).slice(0, RECENT_FILES_LIMIT);
  } catch {
    return [];
  }
}

function renderRecentFiles() {
  elements.recentList.replaceChildren();
  elements.recentEmpty.hidden = state.recentFiles.length > 0;
  for (const file of state.recentFiles) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "recent-item";
    const name = document.createElement("strong");
    name.textContent = file.name;
    const path = document.createElement("small");
    path.textContent = file.path;
    path.title = file.path;
    item.append(name, path);
    item.addEventListener("click", () => {
      elements.recentPanel.hidden = true;
      elements.recentToggle.setAttribute("aria-expanded", "false");
      openPath(file.path);
    });
    elements.recentList.appendChild(item);
  }
}

function rememberRecentFile(path, name) {
  if (!path) return;
  state.recentFiles = [
    { path, name: name || path.split(/[\\/]/).pop(), openedAt: Date.now() },
    ...state.recentFiles.filter((file) => file.path !== path),
  ].slice(0, RECENT_FILES_LIMIT);
  try {
    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(state.recentFiles));
  } catch {
    // Recent history is optional and must not affect document viewing.
  }
  renderRecentFiles();
}

async function copyCurrentPath() {
  if (!state.path) return;
  try {
    await navigator.clipboard.writeText(state.path);
    showToast("文件路径已复制");
  } catch {
    showToast("无法访问剪贴板");
  }
}

async function blobURLBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("无法读取当前页面图像");
  return new Uint8Array(await response.arrayBuffer());
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function downloadCurrentPage() {
  const url = viewer.currentPageURL();
  if (!url) {
    showToast("当前页面尚未渲染完成");
    viewer.requestPage(state.currentPage).catch((error) => showToast(error.message));
    return;
  }
  const baseName = (state.path.split(/[\\/]/).pop() || "ofd-document").replace(/\.ofd$/i, "");
  const filename = `${baseName}-第${state.currentPage + 1}页.png`;
  try {
    if (!appBridge()) {
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      showToast(`已准备下载第 ${state.currentPage + 1} 页`);
      return;
    }
    const bytes = await blobURLBytes(url);
    const savedPath = await invoke("SavePNG", bytesToBase64(bytes), filename);
    if (savedPath) showToast(`已保存到 ${savedPath}`);
  } catch (error) {
    showToast(error.message || "保存 PNG 失败");
  }
}

async function printCurrentPage() {
  const url = viewer.currentPageURL();
  if (!url) {
    showToast("当前页面尚未渲染完成");
    viewer.requestPage(state.currentPage).catch((error) => showToast(error.message));
    return;
  }
  const surface = document.createElement("div");
  surface.className = "print-surface";
  const image = document.createElement("img");
  image.src = url;
  image.alt = `第 ${state.currentPage + 1} 页`;
  surface.appendChild(image);
  document.body.appendChild(surface);
  document.body.classList.add("printing-page");
  const cleanup = () => {
    document.body.classList.remove("printing-page");
    surface.remove();
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup, { once: true });
  try {
    await image.decode();
    if (appBridge()) await invoke("PrintWindow");
    else window.print();
  } catch (error) {
    cleanup();
    showToast(error.message || "打印失败");
  }
}

function send(message) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) throw new Error("渲染服务尚未连接");
  state.socket.send(JSON.stringify(message));
}

function clearImages() {
  viewer.clearImages();
}

function handleSocketMessage(event) {
  if (typeof event.data === "string") {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      showToast("收到无法识别的渲染消息");
      return;
    }
    handleControlMessage(message);
    return;
  }

  const metadata = state.expectedBinaries.shift();
  if (!metadata) {
    showToast("收到没有元数据的 PNG");
    return;
  }
  const pending = state.pending.get(metadata.requestId);
  if (!pending || metadata.documentId !== pending.tab?.documentId) return;
  state.pending.delete(metadata.requestId);
  if (pending.thumbnail) {
    thumbnails.setImage(pending.page, event.data, pending.tab);
    return;
  }
  const url = URL.createObjectURL(new Blob([event.data], { type: "image/png" }));
  const oldUrl = pending.tab.imageCache.get(pending.key);
  if (oldUrl) URL.revokeObjectURL(oldUrl);
  pending.tab.imageCache.set(pending.key, url);
  pending.tab.renderedPages.add(pending.page);
  pending.tab.failedPages.delete(pending.page);
  if (pending.tab === currentTab()) viewer.setPageImage(pending.page, url, metadata.width, metadata.height, pending.dpi);
  if (pending.tab === currentTab()) viewer.updateRenderProgress();
  if (pending.tab === currentTab() && pending.page === state.currentPage && pending.dpi === viewer.currentDPI()) {
    elements.downloadPage.disabled = false;
    elements.printPage.disabled = false;
  }
  if (pending.tab === currentTab()) viewer.updateBusyState();
}

function handleControlMessage(message) {
  switch (message.type) {
    case "opened":
      handleOpened(message);
      break;
    case "rendering":
      if (tabForDocument(state.tabs, message.documentId) === currentTab()) setRenderStatus(`正在渲染第 ${message.page + 1} 页`);
      break;
    case "rendered":
      state.expectedBinaries.push(message);
      break;
    case "text":
      {
        const tab = tabForDocument(state.tabs, message.documentId);
        const pending = state.pending.get(message.requestId);
        if (tab && pending?.tab === tab && pending.text) textLayer.handleTextMessage(message, tab);
      }
      break;
    case "search":
      {
        const tab = tabForDocument(state.tabs, message.documentId);
        const pending = state.pending.get(message.requestId);
        if (tab && pending?.tab === tab && pending.search) textLayer.handleSearchMessage(message, tab);
      }
      break;
    case "closed":
      handleClosed(message);
      break;
    case "error":
      handleErrorMessage(message);
      break;
    default:
      break;
  }
}

function handleErrorMessage(message) {
  if (message.requestId) {
    const pending = state.pending.get(message.requestId);
    if (!pending || (message.documentId && pending.tab?.documentId !== message.documentId)) return;
    state.pending.delete(message.requestId);
    if (pending.open) {
      const isActive = pending.tab === currentTab();
      removeTab(state.tabs, pending.tab.id);
      renderTabBar();
      if (isActive && currentTab()) mountTab(currentTab());
      showToast(message.message || "打开 OFD 失败");
      return;
    }
    if (pending.tab.searchRequestId === message.requestId) pending.tab.searchRequestId = "";
    if (pending?.thumbnail) thumbnails.markFailed(pending.page, pending.tab);
    else if (pending?.text || pending?.search) textLayer.handleError(pending, message);
    else if (pending) {
      pending.tab.failedPages.add(pending.page);
      if (pending.tab === currentTab()) {
        viewer.setPageState(pending.page, "渲染失败");
        viewer.updateRenderProgress();
      }
    }
    if (pending.tab === currentTab()) {
      viewer.updateBusyState();
      showToast(message.message || "渲染失败");
      setRenderStatus("渲染失败");
    }
    return;
  }
  showToast(message.message || "渲染失败");
}

function handleOpened(message) {
  const tab = tabForPending(message.requestId) || tabForPath(state.tabs, message.path);
  if (!tab) {
    if (state.orphanOpenRequests.delete(message.requestId)) {
      try { send({ type: "close", documentId: message.documentId }); } catch { /* Socket may be closed. */ }
    }
    return;
  }
  applyOpened(tab, message);
  if (message.requestId) state.pending.delete(message.requestId);
  rememberRecentFile(tab.path, tab.name);
  renderTabBar();
  if (tab === currentTab()) mountTab(tab);
  setRenderStatus(`${tab.pages.length} 页已载入，等待渲染`);
}

function handleClosed(message) {
  const tab = tabForDocument(state.tabs, message.documentId);
  if (tab) closeTab(tab, false);
}

function applyDisplaySettings() {
  document.body.classList.toggle("dark-reading", state.darkReading);
  document.body.classList.toggle("hide-text-layer", !state.textLayerVisible);
  document.body.classList.toggle("thumbnails-hidden", !state.thumbnailsVisible);
  document.body.classList.toggle("double-thumbnail-layout", state.pageLayout !== "single");
  elements.darkReading.checked = state.darkReading;
  elements.textLayerVisible.checked = state.textLayerVisible;
  elements.pageLayout.value = state.pageLayout;
  setButtonLabel(elements.toggleThumbnails, state.thumbnailsVisible ? "隐藏缩略图" : "显示缩略图");
  elements.pageList.classList.toggle("double-layout", state.pageLayout === "double");
  elements.pageList.classList.toggle("double-odd-layout", state.pageLayout === "double-odd");
  if (state.pages.length) viewer.renderPageShells();
  else viewer.applyPageLayout();
  thumbnails.applyLayout();
  if (state.pageLayout !== "single") viewer.fitWidth();
  else if (state.fitMode === "width") viewer.fitWidth();
  else if (state.fitMode === "page") viewer.fitPage();
  else viewer.updatePageGeometry?.();
}

function readDisplaySettings() {
  try {
    state.darkReading = localStorage.getItem("ofd-viewer-dark-reading") === "true";
    state.textLayerVisible = localStorage.getItem("ofd-viewer-text-layer-visible") !== "false";
    const savedLayout = localStorage.getItem("ofd-viewer-page-layout");
    state.pageLayout = ["single", "double", "double-odd"].includes(savedLayout) ? savedLayout : "single";
    state.thumbnailsVisible = localStorage.getItem(THUMBNAILS_VISIBLE_KEY) === "true";
  } catch {
    state.darkReading = false;
    state.textLayerVisible = true;
    state.pageLayout = "single";
    state.thumbnailsVisible = false;
  }
  applyDisplaySettings();
}

function clearDocumentView() {
  viewer.clearDocumentView();
  viewer.updateRenderProgress();
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    if (document.exitFullscreen) document.exitFullscreen();
    else showToast("当前环境不支持退出全屏");
  } else {
    if (!document.documentElement.requestFullscreen) {
      showToast("当前环境不支持全屏阅读");
      return;
    }
    document.documentElement.requestFullscreen().catch(() => showToast("当前环境不支持全屏阅读"));
  }
}

function movePage(step) {
  if (!state.pages.length) return;
  const next = Math.max(0, Math.min(state.pages.length - 1, state.currentPage + step));
  if (next === state.currentPage) return;
  jumpToPage(next + 1);
}

function jumpToPage(value) {
  const pageNumber = Number(value);
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > state.pages.length) {
    elements.pageInput.value = state.pages.length ? String(state.currentPage + 1) : "";
    if (state.pages.length) showToast(`页码必须在 1 到 ${state.pages.length} 之间`);
    return;
  }
  const page = pageNumber - 1;
  elements.pageList.querySelector(`[data-page="${page}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  viewer.setCurrentPage(page);
  viewer.requestPage(page).catch((error) => showToast(error.message));
}

async function openPath(path, showErrors = true) {
  if (!path) return;
  try {
    const existing = tabForPath(state.tabs, path);
    if (existing) {
      switchTab(existing.id);
      return;
    }
    const tab = addTab(state.tabs, path);
    activateTab(state.tabs, tab.id);
    renderTabBar();
    rememberRecentFile(tab.path, tab.name);
    mountTab(tab);
    if (requestOpenTab(tab)) setRenderStatus("正在解析 OFD 文档");
  } catch (error) {
    if (showErrors) showToast(error.message);
  }
}

function requestOpenTab(tab) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return false;
  if ([...state.pending.values()].some((pending) => pending.tab === tab && pending.open)) return true;
  const requestId = `open-${state.nextRequest++}`;
  state.pending.set(requestId, { tab, open: true });
  try {
    send({ type: "open", requestId, path: tab.path });
    return true;
  } catch {
    state.pending.delete(requestId);
    return false;
  }
}

async function chooseFile() {
  try {
    const path = await invoke("OpenFile");
    if (path) await openPath(path);
  } catch (error) {
    showToast(error.message);
  }
}

async function waitForBridge() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const bridge = appBridge();
    if (bridge && typeof bridge.WebSocketConfig === "function") return bridge;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Wails bridge 尚未准备完成");
}

function installFileDrop() {
  try {
    const runtime = window.runtime;
    if (typeof runtime?.OnFileDrop === "function") {
      runtime.OnFileDrop((_x, _y, paths) => {
        const path = paths?.find((candidate) => /\.ofd$/i.test(candidate));
        if (path) openPath(path);
        else showToast("请选择 .ofd 文件");
      }, false);
    }
    if (typeof runtime?.EventsOn === "function") runtime.EventsOn("ofd:open-path", (path) => openPath(path));
  } catch {
    // The Vite browser preview does not provide the native Wails bridge.
  }
}

function installControls() {
  document.querySelector("#open-button").addEventListener("click", chooseFile);
  document.querySelector("#empty-open-button").addEventListener("click", chooseFile);
  document.querySelector("#zoom-out").addEventListener("click", () => viewer.setZoom(state.zoom - ZOOM_STEP));
  document.querySelector("#zoom-in").addEventListener("click", () => viewer.setZoom(state.zoom + ZOOM_STEP));
  document.querySelector("#zoom-reset").addEventListener("click", () => viewer.setZoom(1));
  elements.pageInput.addEventListener("change", (event) => jumpToPage(event.target.value));
  elements.recentToggle.addEventListener("click", () => {
    const open = elements.recentPanel.hidden;
    closePopups(open ? elements.recentPanel : null);
    if (open) {
      state.recentFiles = readRecentFiles();
      renderRecentFiles();
    }
    elements.recentPanel.hidden = !open;
    elements.recentToggle.setAttribute("aria-expanded", String(open));
  });
  elements.recentClear.addEventListener("click", () => {
    state.recentFiles = [];
    try {
      localStorage.removeItem(RECENT_FILES_KEY);
    } catch {
      // Ignore unavailable local storage.
    }
    renderRecentFiles();
  });
  elements.copyPath.addEventListener("click", copyCurrentPath);
  elements.copyPageText.addEventListener("click", () => {
    if (!state.pages.length) return;
    const page = state.currentPage;
    textLayer.requestText(page).then((runs) => copyText(textLayer.textForRuns(runs), `已复制第 ${page + 1} 页文字`)).catch((error) => showToast(error.message));
  });
  elements.copyDocumentText.addEventListener("click", async () => {
    if (!state.pages.length) return;
    try {
      const runs = await Promise.all(state.pages.map((_, page) => textLayer.requestText(page)));
      await copyText(runs.map(textLayer.textForRuns).filter(Boolean).join("\n\n"), "已复制全文文字");
    } catch (error) {
      showToast(error.message);
    }
  });
  elements.downloadPage.addEventListener("click", downloadCurrentPage);
  elements.printPage.addEventListener("click", printCurrentPage);
  elements.rotatePage.addEventListener("click", viewer.rotatePage);
  elements.searchToggle.addEventListener("click", () => {
    const open = elements.searchPanel.hidden;
    closePopups(open ? elements.searchPanel : null);
    elements.searchPanel.hidden = !open;
    elements.searchToggle.setAttribute("aria-expanded", String(open));
    if (open) elements.searchInput.focus();
  });
  elements.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") textLayer.searchDocument();
    if (event.key === "Escape") {
      elements.searchPanel.hidden = true;
      elements.searchToggle.setAttribute("aria-expanded", "false");
    }
  });
  elements.searchPrevious.addEventListener("click", () => textLayer.moveSearchResult(-1));
  elements.searchNext.addEventListener("click", () => textLayer.moveSearchResult(1));
  document.addEventListener("click", (event) => {
    if (event.target.closest(".menu-wrap, .settings-wrap, .search-group")) return;
    closePopups();
  });
  elements.closeDocument.addEventListener("click", () => {
    closeTab(currentTab());
  });
  let dragDepth = 0;
  elements.viewer.addEventListener("dragenter", (event) => {
    event.preventDefault();
    dragDepth += 1;
    elements.viewer.classList.add("drag-over");
  });
  elements.viewer.addEventListener("dragover", (event) => event.preventDefault());
  elements.viewer.addEventListener("dragleave", (event) => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) elements.viewer.classList.remove("drag-over");
  });
  elements.viewer.addEventListener("drop", (event) => {
    event.preventDefault();
    dragDepth = 0;
    elements.viewer.classList.remove("drag-over");
    const file = [...(event.dataTransfer?.files || [])].find((candidate) => /\.ofd$/i.test(candidate.name));
    if (file?.path) openPath(file.path);
    else showToast("请选择 .ofd 文件");
  });
  elements.settingsToggle.addEventListener("click", () => {
    const open = elements.settingsPanel.hidden;
    closePopups(open ? elements.settingsPanel : null);
    elements.settingsPanel.hidden = !open;
    elements.settingsToggle.setAttribute("aria-expanded", String(open));
  });
  if (elements.aboutToggle) {
    elements.aboutToggle.addEventListener("click", () => {
      closePopups();
      openAboutDialog();
    });
  }
  if (elements.aboutClose) elements.aboutClose.addEventListener("click", closeAboutDialog);
  if (elements.aboutDialog && typeof elements.aboutDialog.addEventListener === "function") {
    elements.aboutDialog.addEventListener("click", (event) => {
      if (event.target === elements.aboutDialog) closeAboutDialog();
    });
    elements.aboutDialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeAboutDialog();
    });
  }

  elements.darkReading.addEventListener("change", (event) => {
    state.darkReading = event.target.checked;
    document.body.classList.toggle("dark-reading", state.darkReading);
    try { localStorage.setItem("ofd-viewer-dark-reading", String(state.darkReading)); } catch { /* Ignore unavailable local storage. */ }
  });
  elements.textLayerVisible.addEventListener("change", (event) => {
    state.textLayerVisible = event.target.checked;
    document.body.classList.toggle("hide-text-layer", !state.textLayerVisible);
    try { localStorage.setItem("ofd-viewer-text-layer-visible", String(state.textLayerVisible)); } catch { /* Ignore unavailable local storage. */ }
  });
  elements.pageLayout.addEventListener("change", (event) => {
    state.pageLayout = ["single", "double", "double-odd"].includes(event.target.value) ? event.target.value : "single";
    try { localStorage.setItem("ofd-viewer-page-layout", state.pageLayout); } catch { /* Ignore unavailable local storage. */ }
   applyDisplaySettings();
   viewer.requestVisiblePages();
   requestAnimationFrame(() => {
     if (currentTab()?.pages.length) viewer.fitWidth();
   });
  });
  elements.fullscreenToggle.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", () => setButtonLabel(elements.fullscreenToggle, document.fullscreenElement ? "退出全屏" : "全屏阅读"));
  elements.previousPage.addEventListener("click", () => { if (state.currentPage > 0) jumpToPage(state.currentPage); });
  elements.nextPage.addEventListener("click", () => { if (state.currentPage < state.pages.length - 1) jumpToPage(state.currentPage + 2); });
  elements.fitWidth.addEventListener("click", () => {
    viewer.fitWidth();
    requestAnimationFrame(() => viewer.fitWidth());
  });
  elements.fitPage.addEventListener("click", () => {
    viewer.fitPage();
    requestAnimationFrame(() => viewer.fitPage());
  });
  elements.toggleThumbnails.addEventListener("click", () => {
    state.thumbnailsVisible = !state.thumbnailsVisible;
    document.body.classList.toggle("thumbnails-hidden", !state.thumbnailsVisible);
    try { localStorage.setItem(THUMBNAILS_VISIBLE_KEY, String(state.thumbnailsVisible)); } catch { /* Ignore unavailable local storage. */ }
    applyDisplaySettings();
  });
  elements.backToTop.addEventListener("click", () => elements.viewer.scrollTo({ top: 0, behavior: "smooth" }));
  elements.viewer.addEventListener("scroll", () => {
    elements.backToTop.hidden = elements.viewer.scrollTop < 480;
    if (state.scrollFrame) return;
    state.scrollFrame = requestAnimationFrame(() => {
      state.scrollFrame = 0;
      viewer.updateCurrentPageFromVisible();
    });
  }, { passive: true });
  elements.viewer.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    viewer.setZoom(state.zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
  }, { passive: false });
  elements.viewer.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1 || !state.pages.length) {
      state.touchStart = null;
      return;
    }
    const touch = event.touches[0];
    state.touchStart = { x: touch.clientX, y: touch.clientY };
  }, { passive: true });
  elements.viewer.addEventListener("touchend", (event) => {
    if (!state.touchStart || event.changedTouches.length !== 1) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - state.touchStart.x;
    const deltaY = touch.clientY - state.touchStart.y;
    state.touchStart = null;
    if (Math.abs(deltaX) < 56 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
    movePage(deltaX < 0 ? 1 : -1);
  }, { passive: true });
  elements.viewer.addEventListener("touchcancel", () => { state.touchStart = null; }, { passive: true });
  window.addEventListener("resize", () => {
    viewer.applyPageLayout();
    thumbnails.applyLayout();
    if (state.fitMode === "width") viewer.fitWidth();
    else if (state.fitMode === "page") viewer.fitPage();
    else viewer.updatePageGeometry?.();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closePopups();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
      event.preventDefault();
      chooseFile();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "w") {
      event.preventDefault();
      closeTab(currentTab());
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Tab") {
      event.preventDefault();
      const ids = [...state.tabs.tabs.values()].filter(tabHasDocument).map((tab) => tab.id);
      if (ids.length > 1) {
        const index = ids.indexOf(state.tabs.activeTabId);
        switchTab(ids[(index + (event.shiftKey ? -1 : 1) + ids.length) % ids.length]);
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && /^[1-9]$/.test(event.key)) {
      event.preventDefault();
      const id = [...state.tabs.tabs.values()].filter(tabHasDocument)[Number(event.key) - 1]?.id;
      if (id) switchTab(id);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      closePopups(elements.searchPanel);
      elements.searchPanel.hidden = false;
      elements.searchToggle.setAttribute("aria-expanded", "true");
      elements.searchInput.focus();
      elements.searchInput.select();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
      event.preventDefault();
      printCurrentPage();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      downloadCurrentPage();
    }
    if ((event.ctrlKey || event.metaKey) && (event.key === "+" || event.key === "=")) {
      event.preventDefault();
      viewer.setZoom(state.zoom + ZOOM_STEP);
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "-") {
      event.preventDefault();
      viewer.setZoom(state.zoom - ZOOM_STEP);
    }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        viewer.rotatePage();
      }
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        movePage(-1);
      }
      if (event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault();
        movePage(1);
      }
      if (event.key === "Home") {
        event.preventDefault();
        jumpToPage(1);
      }
      if (event.key === "End") {
        event.preventDefault();
        jumpToPage(state.pages.length);
      }
    }
  });
}

async function copyText(text, success) {
  if (!text) {
    showToast("没有可复制的文字");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast(success);
  } catch {
    showToast("无法访问剪贴板");
  }
}

function closeSocket() {
  if (!state.socket) return;
  state.socket.onclose = null;
  state.socket.close();
  state.socket = null;
}

function scheduleReconnect() {
  if (state.reconnectTimer || !state.socketConfig) return;
  const delay = state.reconnectDelay;
  state.reconnectDelay = Math.min(4000, state.reconnectDelay * 2);
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connectSocket();
  }, delay);
}

function connectSocket() {
  if (!state.socketConfig) return;
  closeSocket();
  setConnection("连接中", "connecting");
  const socket = new WebSocket(state.socketConfig.url);
  socket.binaryType = "arraybuffer";
  state.socket = socket;
  socket.onopen = () => {
    state.reconnectDelay = 250;
    setConnection("已连接", "connected");
    setRenderStatus("渲染服务已连接");
    for (const tab of state.tabs.tabs.values()) {
      if (!tab.path) continue;
      if (tab.documentId) continue;
      revokeTabCache(tab);
      tab.thumbnailRequests.clear();
      requestOpenTab(tab);
    }
  };
  socket.onmessage = handleSocketMessage;
  socket.onerror = () => setConnection("连接错误", "error");
  socket.onclose = () => {
    if (state.socket !== socket) return;
    state.socket = null;
    for (const [requestId, pending] of state.pending) {
      pending.reject?.(new Error("渲染服务连接已断开"));
      if (pending.text) {
        pending.tab.textRequests.delete(pending.page);
        pending.tab.textPromises.delete(pending.page);
      }
      if (pending.search && pending.tab.searchRequestId === requestId) pending.tab.searchRequestId = "";
    }
    state.pending.clear();
    state.expectedBinaries.length = 0;
    for (const tab of state.tabs.tabs.values()) {
      revokeTabCache(tab);
      clearTabDocument(tab);
      tab.thumbnailRequests.clear();
    }
    const active = currentTab();
    if (active) mountTab(active);
    else clearDocumentView();
    setConnection("等待重连", "error");
    scheduleReconnect();
  };
}

function createModules() {
  thumbnails = createThumbnails({
    state, elements, send, showToast,
    setCurrentPage: (...args) => viewer.setCurrentPage(...args),
    requestPage: (...args) => viewer.requestPage(...args),
    updateBusyState: () => viewer.updateBusyState(),
  });
  textLayer = createTextLayer({
    state, elements, send, showToast,
    cancelRequest: (...args) => viewer.cancelRequest(...args),
    setCurrentPage: (...args) => viewer.setCurrentPage(...args),
  });
  viewer = createViewer({ state, elements, send, showToast, setButtonLabel, thumbnails, textLayer });
}

async function bootstrap() {
  createModules();
  installControls();
  installFileDrop();
  try {
    readDisplaySettings();
  } catch (error) {
    state.darkReading = false;
    state.textLayerVisible = true;
    state.pageLayout = "single";
    state.thumbnailsVisible = false;
    applyDisplaySettings();
    console.error("读取显示设置失败", error);
  }
  try {
    state.recentFiles = readRecentFiles();
    renderRecentFiles();
  } catch (error) {
    state.recentFiles = [];
    elements.recentList.replaceChildren();
    elements.recentEmpty.hidden = false;
    console.error("读取最近文件失败", error);
  }
  try {
    await waitForBridge();
    state.socketConfig = await invoke("WebSocketConfig");
    const initialPath = await invoke("InitialPath");
    const pendingPaths = await invoke("PendingPaths");
    const paths = [initialPath, ...(pendingPaths || [])].filter(Boolean);
    connectSocket();
    for (const path of paths) openPath(path, false);
    try {
      const info = await invoke("AppInfo");
      if (elements.aboutVersion && info && typeof info.version === "string") elements.aboutVersion.textContent = info.version;
      if (elements.aboutGoVersion && info && typeof info.goVersion === "string") elements.aboutGoVersion.textContent = info.goVersion;
      if (elements.aboutHomepage && info && typeof info.homepage === "string") {
        elements.aboutHomepage.href = info.homepage;
        elements.aboutHomepage.textContent = info.homepage;
      }
    } catch {}
  } catch (error) {
    console.error("初始化 Wails 渲染服务失败", error);
    setConnection("浏览器预览", "connecting");
    setRenderStatus(error.message || "请在 Wails 应用中打开 OFD 文件");
    try {
      const info = await invoke("AppInfo");
      if (elements.aboutVersion && info && typeof info.version === "string") elements.aboutVersion.textContent = info.version;
      if (elements.aboutGoVersion && info && typeof info.goVersion === "string") elements.aboutGoVersion.textContent = info.goVersion;
      if (elements.aboutHomepage && info && typeof info.homepage === "string") {
        elements.aboutHomepage.href = info.homepage;
        elements.aboutHomepage.textContent = info.homepage;
      }
    } catch {}
  }
}

elements.zoomValue.textContent = "100%";
elements.previousPage.disabled = true;
elements.nextPage.disabled = true;
bootstrap();
