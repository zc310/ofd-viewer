import { DEFAULT_DPI, MIN_ZOOM, MAX_ZOOM, ZOOM_STEP } from "./state.js";

export function createViewer({ state, elements, send, showToast, setButtonLabel, thumbnails, textLayer }) {
  let pageMetrics = [];
  let pageListWidth = 0;
  let pageListHeight = 0;
  let refreshingVirtualWindow = false;
  const virtualOverscan = 1200;

  function currentDPI() {
    return Math.min(600, Math.max(36, DEFAULT_DPI * state.zoom));
  }

  function currentZoomLabel() {
    return `${Math.round(state.zoom * 100)}%`;
  }

  function currentPageURL() {
    const page = state.pages[state.currentPage];
    return page ? state.imageCache.get(`${page.index}:${currentDPI()}`) || "" : "";
  }

  function updateRenderProgress() {
    const total = state.pages.length;
    if (!total) {
      elements.renderProgress.hidden = true;
      elements.renderProgressLabel.hidden = true;
      return;
    }
    elements.renderProgress.max = total;
    elements.renderProgress.value = state.renderedPages.size;
    elements.renderProgressLabel.textContent = `${state.renderedPages.size}/${total}`;
    elements.renderProgress.hidden = false;
    elements.renderProgressLabel.hidden = false;
  }

  function setCurrentPage(page, scroll = false) {
    if (!state.pages.length) return;
    const previousPage = state.currentPage;
    const changed = state.currentPage !== page;
    state.currentPage = Math.max(0, Math.min(state.pages.length - 1, page));
    elements.pageInput.value = String(state.currentPage + 1);
    elements.previousPage.disabled = state.currentPage === 0;
    elements.nextPage.disabled = state.currentPage === state.pages.length - 1;
    elements.downloadPage.disabled = !currentPageURL();
    elements.printPage.disabled = !currentPageURL();
    elements.rotatePage.disabled = !state.pages.length;
    elements.copyPageText.disabled = !state.pages.length;
    elements.copyDocumentText.disabled = !state.pages.length;
    if (changed) {
      const previousThumbnail = state.thumbnailElements.get(previousPage);
      const currentThumbnail = state.thumbnailElements.get(state.currentPage);
      previousThumbnail?.classList.remove("active");
      previousThumbnail?.removeAttribute("aria-current");
      currentThumbnail?.classList.add("active");
      currentThumbnail?.setAttribute("aria-current", "page");
    } else {
      const currentThumbnail = state.thumbnailElements.get(state.currentPage);
      currentThumbnail?.classList.add("active");
      currentThumbnail?.setAttribute("aria-current", "page");
    }
    if (scroll) {
      const metric = pageMetrics[state.currentPage];
      if (metric) {
        mountPage(state.currentPage);
        elements.viewer.scrollTo({ top: Math.max(0, metric.y - 20), behavior: "smooth" });
        refreshVirtualWindow();
      }
    }
    if (changed) thumbnails.scrollIntoView(state.currentPage);
  }

  function pageSize(page) {
    const width = Number(page?.width);
    const height = Number(page?.height);
    return {
      width: Number.isFinite(width) && width > 0 ? width : 210,
      height: Number.isFinite(height) && height > 0 ? height : 297,
    };
  }

  function pageNaturalWidth(page) {
    return pageSize(page).width * DEFAULT_DPI / 25.4 * state.zoom;
  }

  function isDoubleSpread() {
    return state.pageLayout !== "single" && window.innerWidth > 900;
  }

  function spreadPages(page) {
    if (!isDoubleSpread()) return [page];
    if (state.pageLayout === "double") {
      if (page === 0) return [page];
      const first = page % 2 === 1 ? page : page - 1;
      return [first, first + 1].filter((index) => state.pages[index]);
    }
    const first = page - (page % 2);
    return [first, first + 1].filter((index) => state.pages[index]);
  }

  function pageDisplayMetrics(page) {
    const size = pageSize(page);
    const contentWidth = pageNaturalWidth(page);
    const contentHeight = contentWidth * size.height / size.width;
    const rotated = state.rotation % 180 !== 0;
    return {
      page: page.index,
      width: Math.max(180, rotated ? contentHeight : contentWidth),
      height: (rotated ? contentWidth : contentHeight) + 28,
      frameWidth: Math.max(180, rotated ? contentHeight : contentWidth),
      frameHeight: rotated ? contentWidth : contentHeight,
      contentWidth,
      contentHeight,
      x: 0,
      y: 0,
    };
  }

  function applyPageGeometry(page, metric = pageMetrics[page]) {
    const shell = state.pageElements.get(page);
    if (!shell || !metric) return;
    shell.style.width = `${metric.width}px`;
    shell.style.height = `${metric.height}px`;
    shell.style.left = `${metric.x}px`;
    shell.style.top = `${metric.y}px`;
    const parts = state.pageParts.get(page);
    if (!parts) return;
    const { frame, content, image } = parts;
    frame.style.width = `${metric.frameWidth}px`;
    frame.style.height = `${metric.frameHeight}px`;
    content.style.width = `${metric.contentWidth}px`;
    content.style.height = `${metric.contentHeight}px`;
    if (image?.src) {
      image.style.width = `${metric.contentWidth}px`;
      image.style.height = `${metric.contentHeight}px`;
    }
    applyPageRotation(shell, state.pages[page]);
  }

  function rebuildPageMetrics() {
    const style = getComputedStyle(elements.pageList);
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingRight = parseFloat(style.paddingRight) || 0;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const paddingBottom = parseFloat(style.paddingBottom) || 0;
    const rowGap = parseFloat(style.rowGap || style.gap) || 28;
    const columnGap = parseFloat(style.columnGap || style.gap) || 18;
    pageMetrics = state.pages.map(pageDisplayMetrics);
    const double = isDoubleSpread();
    const innerWidth = Math.max(180, elements.viewer.clientWidth - paddingLeft - paddingRight);
    if (!double) {
      let top = paddingTop;
      let maxWidth = 0;
      for (const metric of pageMetrics) {
        metric.x = 0;
        metric.y = top;
        top += metric.height + rowGap;
        maxWidth = Math.max(maxWidth, metric.width);
      }
      pageListWidth = Math.max(elements.viewer.clientWidth, maxWidth + paddingLeft + paddingRight);
      for (const metric of pageMetrics) metric.x = paddingLeft + Math.max(0, (innerWidth - metric.width) / 2);
      pageListHeight = Math.max(paddingTop + paddingBottom, top - rowGap + paddingBottom);
    } else {
      const leftPages = [];
      const rightPages = [];
      const groups = [];
      const start = state.pageLayout === "double" ? 1 : 0;
      if (state.pageLayout === "double") groups.push([-1, 0]);
      for (let page = start; page < state.pages.length; page += 2) {
        groups.push([page, page + 1 < state.pages.length ? page + 1 : -1]);
      }
      for (const [left, right] of groups) {
        if (left >= 0) leftPages.push(pageMetrics[left]);
        if (right >= 0) rightPages.push(pageMetrics[right]);
      }
      const targetColumnWidth = Math.max(180, (innerWidth - columnGap) / 2);
      const leftWidth = Math.max(targetColumnWidth, ...leftPages.map((metric) => metric.width), 180);
      const rightWidth = Math.max(targetColumnWidth, ...rightPages.map((metric) => metric.width), 180);
      let top = paddingTop;
      for (const [left, right] of groups) {
        const leftMetric = left >= 0 ? pageMetrics[left] : null;
        const rightMetric = right >= 0 ? pageMetrics[right] : null;
        const rowHeight = Math.max(leftMetric?.height || 0, rightMetric?.height || 0, 180);
        if (leftMetric) {
          leftMetric.x = paddingLeft + (leftWidth - leftMetric.width) / 2;
          leftMetric.y = top;
        }
        if (rightMetric) {
          rightMetric.x = paddingLeft + leftWidth + columnGap + (rightWidth - rightMetric.width) / 2;
          rightMetric.y = top;
        }
        top += rowHeight + rowGap;
      }
      pageListWidth = Math.max(elements.viewer.clientWidth, paddingLeft + leftWidth + columnGap + rightWidth + paddingRight);
      pageListHeight = Math.max(paddingTop + paddingBottom, top - rowGap + paddingBottom);
    }
    elements.pageList.style.width = `${pageListWidth}px`;
    elements.pageList.style.height = `${pageListHeight}px`;
    elements.pageList.style.minHeight = `${pageListHeight}px`;
    for (const [page] of state.pageElements) applyPageGeometry(page);
  }

  function mountPage(page) {
    if (state.pageElements.has(page)) return;
    const pageInfo = state.pages[page];
    const metric = pageMetrics[page];
    if (!pageInfo || !metric) return;
    const shell = document.createElement("article");
    shell.className = "page-shell";
    shell.dataset.page = String(page);
    shell.innerHTML = `
      <div class="page-caption"><span>PAGE ${String(page + 1).padStart(3, "0")}</span><span class="page-state">待渲染</span></div>
        <div class="page-frame" style="aspect-ratio: ${pageInfo.width} / ${pageInfo.height}">
        <div class="page-content">
          <div class="page-placeholder"><span></span><small>等待进入视口</small></div>
          <img alt="第 ${page + 1} 页" decoding="async" draggable="false" hidden />
          <div class="text-layer" aria-label="第 ${page + 1} 页文字"></div>
        </div>
      </div>`;
    elements.pageList.appendChild(shell);
    state.pageElements.set(page, shell);
    state.pageParts.set(page, {
      frame: shell.querySelector(".page-frame"),
      content: shell.querySelector(".page-content"),
      image: shell.querySelector("img"),
      placeholder: shell.querySelector(".page-placeholder"),
      textLayer: shell.querySelector(".text-layer"),
      stateLabel: shell.querySelector(".page-state"),
    });
    applyPageGeometry(page, metric);
    const dpi = currentDPI();
    const cached = state.imageCache.get(`${page}:${dpi}`);
    if (cached) setPageImage(page, cached, null, null, dpi);
    else requestPage(page).catch((error) => showToast(error.message));
    if (state.textCache.has(page)) textLayer.render(page);
    else textLayer.requestText(page).catch(() => {});
  }

  function unmountPage(page) {
    const shell = state.pageElements.get(page);
    if (!shell) return;
    shell.remove();
    state.pageElements.delete(page);
    state.pageParts.delete(page);
  }

  function refreshVirtualWindow() {
    if (refreshingVirtualWindow || !state.pages.length || !pageMetrics.length) return;
    refreshingVirtualWindow = true;
    try {
      const maxScrollTop = Math.max(0, pageListHeight - elements.viewer.clientHeight);
      if (elements.viewer.scrollTop > maxScrollTop) elements.viewer.scrollTop = maxScrollTop;
      const start = Math.max(0, elements.viewer.scrollTop - virtualOverscan);
      const end = elements.viewer.scrollTop + elements.viewer.clientHeight + virtualOverscan;
      const wanted = new Set();
      for (const metric of pageMetrics) {
        if (metric.y + metric.height >= start && metric.y <= end) wanted.add(metric.page);
      }
      for (const page of spreadPages(state.currentPage)) wanted.add(page);
      for (const page of state.pageElements.keys()) if (!wanted.has(page)) unmountPage(page);
      for (const page of wanted) mountPage(page);
    } finally {
      refreshingVirtualWindow = false;
    }
  }

  function updatePageGeometry(onlyPage = null) {
    if (onlyPage !== null && pageMetrics[onlyPage]) applyPageGeometry(onlyPage);
    else rebuildPageMetrics();
    refreshVirtualWindow();
  }

  function applyPageRotation(shell, page) {
    const content = state.pageParts.get(page.index)?.content || shell.querySelector(".page-content");
    content.dataset.rotation = String(state.rotation);
    content.style.transform = `rotate(${state.rotation}deg)`;
    content.style.transformOrigin = "center center";
    textLayer.render(page.index);
  }

  function renderPageShells() {
    state.observer?.disconnect();
    state.currentPageObserver?.disconnect();
    state.visiblePages.clear();
    state.pageElements.clear();
    state.pageParts.clear();
    elements.pageList.replaceChildren();
    elements.pageList.classList.add("virtualized");
    rebuildPageMetrics();
    refreshVirtualWindow();
    if (typeof IntersectionObserver !== "function") return;
    state.observer = new IntersectionObserver(onPageIntersection, {
      root: elements.viewer,
      rootMargin: "900px 0px",
      threshold: 0,
    });
    state.currentPageObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const page = Number(entry.target.dataset.page);
        if (entry.isIntersecting) state.visiblePages.set(page, entry);
        else state.visiblePages.delete(page);
      }
      updateCurrentPageFromVisible();
    }, { root: elements.viewer, rootMargin: "-20px 0px -65% 0px", threshold: [0, 0.01] });
    elements.pageList.querySelectorAll(".page-shell").forEach((shell) => state.observer.observe(shell));
    elements.pageList.querySelectorAll(".page-shell").forEach((shell) => state.currentPageObserver.observe(shell));
  }

  function requestInitialPages() {
    if (!state.pages.length) return;
    const first = Math.max(0, state.currentPage - 1);
    const last = Math.min(state.pages.length, state.currentPage + 2);
    for (let page = first; page < last; page += 1) {
      requestPage(page).catch((error) => showToast(error.message));
      textLayer.requestText(page).catch(() => {});
    }
  }

  function applyPageLayout() {
    rebuildPageMetrics();
    refreshVirtualWindow();
  }

  function updateCurrentPageFromVisible() {
    refreshVirtualWindow();
    if (!pageMetrics.length) return;
    const target = elements.viewer.scrollTop + 20;
    let low = 0;
    let high = pageMetrics.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (pageMetrics[middle].y <= target) low = middle;
      else high = middle - 1;
    }
    const previous = pageMetrics[Math.max(0, low - 1)];
    const current = pageMetrics[low];
    const closestPage = previous && target - previous.y < current.y - target ? previous.page : current.page;
    setCurrentPage(closestPage);
    thumbnails.requestWindow();
  }

  function onPageIntersection(entries) {
    void entries;
    refreshVirtualWindow();
  }

  function requestVisiblePages() {
    if (!state.pages.length) return;
    const first = Math.max(0, state.currentPage - 2);
    const last = Math.min(state.pages.length, state.currentPage + 3);
    for (let page = first; page < last; page += 1) {
      requestPage(page).catch((error) => showToast(error.message));
      textLayer.requestText(page).catch(() => {});
    }
  }

  function requestPage(page, force = false) {
    if (!state.pages[page]) return Promise.resolve();
    const tab = state.tabs.tabs.get(state.tabs.activeTabId);
    const dpi = currentDPI();
    const key = `${page}:${dpi}`;
    const cached = state.imageCache.get(key);
    if (!force && cached) {
      setPageImage(page, cached, null, null, dpi);
      return Promise.resolve();
    }
    for (const [requestId, pending] of state.pending) {
      if (pending.tab !== tab) continue;
      if (pending.page === page && pending.dpi === dpi) return Promise.resolve();
      if (pending.page === page && pending.dpi !== dpi) cancelRequest(requestId);
    }
    const requestId = `render-${state.nextRequest++}`;
    state.pending.set(requestId, { tab, page, dpi, key });
    try {
      send({ type: "render", documentId: state.documentId, requestId, page, dpi });
    } catch (error) {
      state.pending.delete(requestId);
      throw error;
    }
    setPageState(page, "渲染中");
    elements.renderStatus.textContent = `正在请求第 ${page + 1} 页`;
    return Promise.resolve();
  }

  function cancelRequest(requestId) {
    const pending = state.pending.get(requestId);
    try {
      send({ type: "cancel", documentId: pending?.tab?.documentId || state.documentId, requestId });
    } catch {
      // The socket may have closed while a zoom gesture was in progress.
    }
    state.pending.delete(requestId);
    pending?.reject?.(new Error("请求已取消"));
    if (pending?.text) {
      pending.tab.textRequests.delete(pending.page);
      pending.tab.textPromises.delete(pending.page);
    }
    if (pending?.thumbnail) pending.tab.thumbnailRequests.delete(pending.key);
  }

  function cancelAllRequests() {
    for (const requestId of [...state.pending.keys()]) cancelRequest(requestId);
    state.expectedBinaries.length = 0;
    updateBusyState();
  }

  function setPageImage(page, url, width, height, dpi) {
    const shell = state.pageElements.get(page);
    if (!shell) return;
    const parts = state.pageParts.get(page);
    const image = parts?.image || shell.querySelector("img");
    const placeholder = parts?.placeholder || shell.querySelector(".page-placeholder");
    image.src = url;
    image.hidden = false;
    if (width && height) {
      image.dataset.width = String(width);
      image.dataset.height = String(height);
    }
    image.dataset.dpi = String(dpi);
    placeholder.hidden = true;
    updatePageGeometry(page);
    setPageState(page, "已渲染");
  }

  function setPageState(page, value) {
    const label = state.pageParts.get(page)?.stateLabel;
    if (label) label.textContent = value;
  }

  function updateBusyState() {
    const tab = state.tabs.tabs.get(state.tabs.activeTabId);
    const busy = [...state.pending.values()].some((pending) => pending.tab === tab);
    if (!busy) elements.renderStatus.textContent = state.pages.length ? "页面已就绪" : "准备就绪";
  }

  function setZoom(value, snap = true, fitMode = "") {
    if (!fitMode) state.defaultFitPending = false;
    state.fitMode = fitMode;
    const normalized = snap ? Math.round(value / ZOOM_STEP) * ZOOM_STEP : value;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, normalized));
    if (next === state.zoom) {
      elements.zoomValue.textContent = currentZoomLabel();
      updatePageGeometry();
      requestVisiblePages();
      return;
    }
    state.zoom = next;
    elements.zoomValue.textContent = currentZoomLabel();
    for (const [requestId, pending] of [...state.pending]) {
      if (pending.tab !== state.tabs.tabs.get(state.tabs.activeTabId)) continue;
      if (!pending.thumbnail) cancelRequest(requestId);
    }
    state.expectedBinaries = state.expectedBinaries.filter((metadata) => {
      const pending = state.pending.get(metadata.requestId);
      return pending && pending.tab !== state.tabs.tabs.get(state.tabs.activeTabId);
    });
    for (const url of state.imageCache.values()) URL.revokeObjectURL(url);
    state.imageCache.clear();
    for (const [page, parts] of state.pageParts) {
      parts.image.hidden = true;
      parts.image.removeAttribute("src");
      parts.placeholder.hidden = false;
      setPageState(page, "待渲染");
    }
    updatePageGeometry();
    if (fitMode && pageMetrics[state.currentPage]) {
      const maxScrollTop = Math.max(0, pageListHeight - elements.viewer.clientHeight);
      elements.viewer.scrollTop = Math.min(maxScrollTop, Math.max(0, pageMetrics[state.currentPage].y - 20));
      refreshVirtualWindow();
    }
    elements.renderStatus.textContent = `缩放至 ${currentZoomLabel()}，重新请求 PNG`;
    requestVisiblePages();
  }

  function availablePageArea() {
    const pageListStyle = getComputedStyle(elements.pageList);
    const horizontalPadding = (parseFloat(pageListStyle.paddingLeft) || 0) + (parseFloat(pageListStyle.paddingRight) || 0);
    const verticalPadding = parseFloat(pageListStyle.paddingTop) || 0;
    const viewerBounds = elements.viewer.getBoundingClientRect();
    const viewerWidth = elements.viewer.clientWidth || viewerBounds.width || window.innerWidth || 0;
    const viewerHeight = elements.viewer.clientHeight || viewerBounds.height || window.innerHeight || 0;
    const currentShell = state.pageElements.get(state.currentPage);
    const captionHeight = currentShell?.querySelector(".page-caption")?.getBoundingClientRect().height || 20;
    return {
      width: Math.max(180, viewerWidth - horizontalPadding - 6),
      height: Math.max(180, viewerHeight - verticalPadding - captionHeight - 8),
    };
  }

  function fitWidth() {
    const page = state.pages[state.currentPage];
    if (!page) return;
    for (const pageIndex of spreadPages(state.currentPage)) mountPage(pageIndex);
    updatePageGeometry();
    const available = availablePageArea();
    const spreadGap = isDoubleSpread() ? 18 : 0;
    const targetWidth = isDoubleSpread() ? Math.max(180, (available.width - spreadGap) / 2) : available.width;
    const pages = spreadPages(state.currentPage);
    const widestPage = Math.max(...pages.map((candidate) => {
      const size = pageSize(candidate);
      return state.rotation % 180 ? size.height : size.width;
    }));
    const baseWidth = widestPage * DEFAULT_DPI / 25.4;
    setZoom(targetWidth / baseWidth, false, "width");
  }

  function fitPage() {
    const page = state.pages[state.currentPage];
    if (!page) return;
    for (const pageIndex of spreadPages(state.currentPage)) mountPage(pageIndex);
    updatePageGeometry();
    const available = availablePageArea();
    const spreadGap = isDoubleSpread() ? 18 : 0;
    const targetWidth = isDoubleSpread() ? Math.max(180, (available.width - spreadGap) / 2) : available.width;
    const rotated = state.rotation % 180 !== 0;
    const pages = spreadPages(state.currentPage);
    const baseWidth = Math.max(...pages.map((candidate) => {
      const size = pageSize(candidate);
      return rotated ? size.height : size.width;
    })) * DEFAULT_DPI / 25.4;
    const baseHeight = Math.max(...pages.map((candidate) => {
      const size = pageSize(candidate);
      return rotated ? size.width : size.height;
    })) * DEFAULT_DPI / 25.4;
    setZoom(Math.min(targetWidth / baseWidth, available.height / baseHeight), false, "page");
  }

  function rotatePage() {
    if (!state.pages.length) return;
    state.rotation = (state.rotation + 90) % 360;
    setButtonLabel(elements.rotatePage, `旋转 ${state.rotation}°`);
    if (state.fitMode === "width") fitWidth();
    else if (state.fitMode === "page") fitPage();
    else updatePageGeometry();
    textLayer.renderSearchHighlights();
  }

  function deactivate() {
    state.scrollTop = elements.viewer.scrollTop;
    state.observer?.disconnect();
    state.currentPageObserver?.disconnect();
    state.thumbnailObserver?.disconnect();
    state.observer = null;
    state.currentPageObserver = null;
    state.thumbnailObserver = null;
    state.visiblePages.clear();
    state.pageElements.clear();
    state.pageParts.clear();
    state.thumbnailElements.clear();
    pageMetrics = [];
    pageListWidth = 0;
    pageListHeight = 0;
    refreshingVirtualWindow = false;
    elements.pageList.replaceChildren();
    elements.thumbnailList.replaceChildren();
  }

  function clearImages() {
    if (!state.tabs.tabs.get(state.tabs.activeTabId)) return;
    for (const [requestId, pending] of state.pending) {
      if (pending.tab === state.tabs.tabs.get(state.tabs.activeTabId)) cancelRequest(requestId);
    }
    for (const url of state.imageCache.values()) URL.revokeObjectURL(url);
    for (const url of state.thumbnailCache.values()) URL.revokeObjectURL(url);
    for (const shell of state.pageElements.values()) shell.remove();
    state.imageCache.clear();
    state.thumbnailCache.clear();
    state.thumbnailRequests.clear();
    state.expectedBinaries = state.expectedBinaries.filter((metadata) => {
      const pending = state.pending.get(metadata.requestId);
      return pending && pending.tab !== state.tabs.tabs.get(state.tabs.activeTabId);
    });
    state.textCache.clear();
    state.textRequests.clear();
    state.textPromises.clear();
    state.searchResults = [];
    state.activeSearchResult = -1;
    state.searchRequestId = "";
    state.visiblePages.clear();
    state.pageElements.clear();
    state.pageParts.clear();
  }

  function clearDocumentView() {
    if (state.tabs.tabs.get(state.tabs.activeTabId)) clearImages();
    state.observer?.disconnect();
    state.currentPageObserver?.disconnect();
    state.thumbnailObserver?.disconnect();
    state.thumbnailElements.clear();
    state.visiblePages.clear();
    elements.pageList.replaceChildren();
    elements.thumbnailList.replaceChildren();
    elements.thumbnailCount.textContent = "0";
    elements.pageList.hidden = true;
    elements.emptyState.hidden = false;
    elements.documentName.textContent = "未打开文档";
    elements.documentPages.textContent = "0 页";
    elements.fileMetadata.textContent = "未打开文档";
    elements.pageTotal.textContent = "/ 0";
    elements.copyPath.disabled = true;
    elements.closeDocument.disabled = true;
    elements.downloadPage.disabled = true;
    elements.printPage.disabled = true;
    elements.rotatePage.disabled = true;
    elements.copyPageText.disabled = true;
    elements.copyDocumentText.disabled = true;
    updateRenderProgress();
    elements.renderStatus.textContent = "准备就绪";
  }

  return {
    currentDPI, currentPageURL, currentZoomLabel, updateRenderProgress, setCurrentPage,
    renderPageShells, applyPageLayout, updateCurrentPageFromVisible, requestVisiblePages, requestInitialPages,
    requestPage, cancelRequest, cancelAllRequests, setPageImage, setPageState, updateBusyState,
    setZoom, fitWidth, fitPage, rotatePage, renderSearchHighlights: textLayer.renderSearchHighlights,
    updatePageGeometry, refreshVirtualWindow, clearImages, clearDocumentView, deactivate,
  };
}
