export function createThumbnails({ state, elements, send, showToast, setCurrentPage, requestPage, updateBusyState }) {
  const a4Ratio = 297 / 210;
  const overscanRows = 3;
  let groups = [];
  let rowSize = 0;
  let horizontal = false;
  let windowStart = -1;
  let windowEnd = -1;
  let content = null;

  function isHorizontal() {
    return window.matchMedia("(max-width: 620px)").matches;
  }

  function scrollThumbnailIntoView(page) {
    const thumbnail = state.thumbnailElements.get(page);
    if (!thumbnail) {
      const groupIndex = groups.findIndex((group) => group.includes(page));
      if (groupIndex < 0) return;
      const target = groupIndex * rowSize;
      if (isHorizontal()) elements.thumbnailList.scrollTo({ left: target, behavior: "smooth" });
      else elements.thumbnailList.scrollTo({ top: target, behavior: "smooth" });
      refreshWindow(true);
      return;
    }
    if (window.matchMedia("(max-width: 620px)").matches) {
      const target = thumbnail.offsetLeft - (elements.thumbnailList.clientWidth - thumbnail.offsetWidth) / 2;
      elements.thumbnailList.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
      return;
    }
    thumbnail.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function spreadGroups() {
    if (state.pageLayout === "single") return state.pages.map((page) => [page.index]);
    const groups = [];
    if (state.pageLayout === "double") groups.push([-1, 0]);
    const start = state.pageLayout === "double" ? 1 : 0;
    for (let page = start; page < state.pages.length; page += 2) {
      groups.push([page, page + 1 < state.pages.length ? page + 1 : -1]);
    }
    return groups;
  }

  function pageGroups() {
    return isHorizontal() ? state.pages.map((page) => [page.index]) : spreadGroups();
  }

  function measureRow() {
    horizontal = isHorizontal();
    if (horizontal) {
      rowSize = 72;
      return;
    }
    const width = Math.max(80, elements.thumbnailList.clientWidth - 3);
    const columns = state.pageLayout === "single" ? 1 : 2;
    const columnWidth = columns === 1 ? width : Math.max(40, (width - 8) / 2);
    rowSize = columnWidth * a4Ratio + (columns === 1 ? 10 : 8);
  }

  function layoutMetrics() {
    if (horizontal) return { columns: 1, columnWidth: 64, columnGap: 8, rowGap: 8, totalWidth: groups.length * rowSize };
    const width = Math.max(80, elements.thumbnailList.clientWidth - 3);
    const columns = state.pageLayout === "single" ? 1 : 2;
    const columnGap = columns === 1 ? 0 : 8;
    const columnWidth = columns === 1 ? width : Math.max(40, (width - columnGap) / 2);
    return { columns, columnWidth, columnGap, rowGap: columns === 1 ? 10 : 8, totalWidth: width };
  }

  function createThumbnail(page) {
    const thumbnail = document.createElement("button");
    thumbnail.type = "button";
    thumbnail.className = "thumbnail";
    thumbnail.dataset.page = String(page);
    thumbnail.setAttribute("aria-label", `跳转到第 ${page + 1} 页`);
    thumbnail.title = `第 ${page + 1} 页`;
    thumbnail.innerHTML = `<span class="thumbnail-placeholder"></span><span class="thumbnail-number">${page + 1}</span>`;
    thumbnail.addEventListener("click", () => {
      setCurrentPage(page, true);
      requestPage(page).catch((error) => showToast(error.message));
      requestThumbnail(page);
    });
    const cached = state.thumbnailCache.get(page);
    if (cached) {
      const image = document.createElement("img");
      image.alt = `第 ${page + 1} 页缩略图`;
      image.loading = "lazy";
      image.decoding = "async";
      image.src = cached;
      thumbnail.querySelector(".thumbnail-placeholder")?.replaceWith(image);
    }
    if (state.failedPages.has(page) && !cached) {
      thumbnail.classList.add("failed");
      thumbnail.title = "缩略图加载失败，点击重试";
      const error = document.createElement("span");
      error.className = "thumbnail-error";
      error.textContent = "重试";
      thumbnail.appendChild(error);
    }
    state.thumbnailElements.set(page, thumbnail);
    return thumbnail;
  }

  function refreshWindow(force = false) {
    if (!content) return;
    if (!groups.length) {
      elements.thumbnailList.replaceChildren();
      state.thumbnailElements.clear();
      return;
    }
    measureRow();
    const offset = horizontal ? elements.thumbnailList.scrollLeft : elements.thumbnailList.scrollTop;
    const viewport = horizontal ? elements.thumbnailList.clientWidth : elements.thumbnailList.clientHeight;
    const first = Math.max(0, Math.floor(offset / rowSize) - overscanRows);
    const last = Math.min(groups.length, Math.ceil((offset + viewport) / rowSize) + overscanRows);
    if (!force && first === windowStart && last === windowEnd) return;
    windowStart = first;
    windowEnd = last;
    state.thumbnailElements.clear();
    const metrics = layoutMetrics();
    content.style.width = horizontal ? `${metrics.totalWidth}px` : `${metrics.totalWidth}px`;
    content.style.height = horizontal ? "100%" : `${groups.length * rowSize}px`;
    const fragment = document.createDocumentFragment();
    for (let groupIndex = first; groupIndex < last; groupIndex += 1) {
      for (let column = 0; column < groups[groupIndex].length; column += 1) {
        const page = groups[groupIndex][column];
        if (page < 0) {
          continue;
        } else {
          const thumbnail = createThumbnail(page);
          thumbnail.style.width = `${metrics.columnWidth}px`;
          thumbnail.style.left = `${horizontal ? groupIndex * rowSize : column * (metrics.columnWidth + metrics.columnGap)}px`;
          thumbnail.style.top = `${horizontal ? 0 : groupIndex * rowSize}px`;
          fragment.appendChild(thumbnail);
          requestThumbnail(page);
        }
      }
    }
    content.replaceChildren(fragment);
    setCurrentPage(state.currentPage);
  }

  function applyLayout() {
    groups = pageGroups();
    windowStart = -1;
    windowEnd = -1;
    refreshWindow(true);
  }

  function requestThumbnail(page) {
    const tab = state.tabs.tabs.get(state.tabs.activeTabId);
    const thumbnail = state.thumbnailElements.get(page);
    if (!tab || !thumbnail || thumbnail.querySelector("img")) return;
    const pendingKey = `thumbnail:${page}`;
    if (tab.thumbnailRequests.has(pendingKey)) return;
    const dpi = 36;
    const requestId = `thumbnail-${state.nextRequest++}`;
    state.pending.set(requestId, { tab, page, dpi, key: pendingKey, thumbnail: true });
    tab.thumbnailRequests.add(pendingKey);
    thumbnail.classList.remove("failed");
    thumbnail.querySelector(".thumbnail-error")?.remove();
    thumbnail.classList.add("loading");
    try {
      send({ type: "render", documentId: state.documentId, requestId, page, dpi });
    } catch (error) {
      state.pending.delete(requestId);
      tab.thumbnailRequests.delete(pendingKey);
      thumbnail.classList.remove("loading");
      showToast(error.message);
    }
  }

  function requestWindow() {
    if (!state.pages.length) return;
    const first = Math.max(0, state.currentPage - 3);
    const last = Math.min(state.pages.length, state.currentPage + 5);
    for (let page = first; page < last; page += 1) requestThumbnail(page);
  }

  function render() {
    state.thumbnailObserver?.disconnect();
    state.thumbnailElements.clear();
    elements.thumbnailList.replaceChildren();
    content = document.createElement("div");
    content.className = "thumbnail-virtual-content";
    elements.thumbnailList.appendChild(content);
    elements.thumbnailCount.textContent = String(state.pages.length);
    applyLayout();
    scrollThumbnailIntoView(state.currentPage);
    requestWindow();
  }

  function setImage(page, data, tab = state.tabs.tabs.get(state.tabs.activeTabId)) {
    if (!tab) return;
    tab.thumbnailRequests.delete(`thumbnail:${page}`);
    const url = URL.createObjectURL(new Blob([data], { type: "image/png" }));
    const oldUrl = tab.thumbnailCache.get(page);
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    tab.thumbnailCache.set(page, url);
    tab.failedPages.delete(page);
    const thumbnail = elements.thumbnailList.querySelector(`[data-page="${page}"]`);
    if (!thumbnail || tab !== state.tabs.tabs.get(state.tabs.activeTabId)) {
      updateBusyState();
      return;
    }
    const image = document.createElement("img");
    image.alt = `第 ${page + 1} 页缩略图`;
    image.loading = "lazy";
    image.decoding = "async";
    image.src = url;
    thumbnail.querySelector(".thumbnail-placeholder")?.replaceWith(image);
    thumbnail.classList.remove("loading");
    thumbnail.classList.remove("failed");
    thumbnail.querySelector(".thumbnail-error")?.remove();
    updateBusyState();
  }

  function markFailed(page, tab = state.tabs.tabs.get(state.tabs.activeTabId)) {
    if (!tab) return;
    tab.thumbnailRequests.delete(`thumbnail:${page}`);
    tab.failedPages.add(page);
    if (tab !== state.tabs.tabs.get(state.tabs.activeTabId)) return;
    const thumbnail = elements.thumbnailList.querySelector(`[data-page="${page}"]`);
    thumbnail?.classList.remove("loading");
    if (thumbnail) {
      thumbnail.classList.add("failed");
      thumbnail.title = "缩略图加载失败，点击重试";
      const error = document.createElement("span");
      error.className = "thumbnail-error";
      error.textContent = "重试";
      thumbnail.appendChild(error);
    }
    updateBusyState();
  }

  elements.thumbnailList.addEventListener("scroll", () => refreshWindow(), { passive: true });

  return { applyLayout, render, refreshWindow, requestWindow, requestThumbnail, scrollIntoView: scrollThumbnailIntoView, setImage, markFailed };
}
