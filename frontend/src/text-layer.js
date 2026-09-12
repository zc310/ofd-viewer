export function createTextLayer({ state, elements, send, cancelRequest, showToast, setCurrentPage }) {
  function requestText(page) {
    const tab = state.tabs.tabs.get(state.tabs.activeTabId);
    if (!state.pages[page]) return Promise.resolve([]);
    if (tab.textCache.has(page)) return Promise.resolve(tab.textCache.get(page));
    if (tab.textPromises.has(page)) return tab.textPromises.get(page).promise;
    const requestId = `text-${state.nextRequest++}`;
    tab.textRequests.add(page);
    let resolveRequest;
    let rejectRequest;
    const promise = new Promise((resolve, reject) => {
      resolveRequest = resolve;
      rejectRequest = reject;
    });
    tab.textPromises.set(page, { promise, resolve: resolveRequest, reject: rejectRequest });
    state.pending.set(requestId, { tab, page, text: true, reject: rejectRequest });
    try {
      send({ type: "text", documentId: state.documentId, requestId, page });
    } catch (error) {
      state.pending.delete(requestId);
      tab.textRequests.delete(page);
      tab.textPromises.delete(page);
      rejectRequest(error);
      showToast(error.message);
    }
    return promise;
  }

  function render(page) {
    const tab = state.tabs.tabs.get(state.tabs.activeTabId);
    const shell = state.pageElements.get(page);
    const runs = tab.textCache.get(page);
    const layer = state.pageParts.get(page)?.textLayer || shell?.querySelector(".text-layer");
    if (!layer || !runs) return;
    layer.replaceChildren();
    const pageInfo = state.pages[page];
    const content = shell.querySelector(".page-content");
    const scaleX = content.clientWidth / pageInfo.width;
    const scaleY = content.clientHeight / pageInfo.height;
    for (const run of runs) {
      if (!run.text) continue;
      const item = document.createElement("span");
      item.className = "text-run";
      item.textContent = run.text;
      item.style.left = `${run.x * scaleX}px`;
      item.style.top = `${run.y * scaleY}px`;
      item.style.width = `${Math.max(1, run.width * scaleX)}px`;
      item.style.height = `${Math.max(1, run.height * scaleY)}px`;
      item.style.fontSize = `${Math.max(1, (run.size || run.height) * scaleY)}px`;
      if (run.fontFamily) item.style.fontFamily = `'${run.fontFamily}', sans-serif`;
      item.style.fontWeight = run.weight > 0 ? String(run.weight) : (run.bold ? "700" : "400");
      item.style.fontStyle = run.italic ? "italic" : "normal";
      const runAngle = run.glyphs?.[0]?.angle ?? run.charDirection ?? 0;
      item.style.transformOrigin = "top left";
      item.style.transform = `rotate(${runAngle}deg)`;
      layer.appendChild(item);
    }
    renderSearchHighlights();
  }

  function updateSearchStatus(value) {
    elements.searchStatus.textContent = value;
  }

  function renderSearchHighlights() {
    const tab = state.tabs.tabs.get(state.tabs.activeTabId);
    elements.pageList.querySelectorAll(".search-highlight").forEach((item) => item.remove());
    for (const [index, result] of tab.searchResults.entries()) {
      const shell = state.pageElements.get(result.page);
      const page = state.pages[result.page];
      if (!shell || !page) continue;
      const layer = state.pageParts.get(result.page)?.textLayer || shell.querySelector(".text-layer");
      const scaleX = layer.clientWidth / page.width;
      const scaleY = layer.clientHeight / page.height;
      for (const rect of result.rects || []) {
        const highlight = document.createElement("span");
        highlight.className = `search-highlight${index === tab.activeSearchResult ? " active" : ""}`;
        highlight.style.left = `${rect.x * scaleX}px`;
        highlight.style.top = `${rect.y * scaleY}px`;
        highlight.style.width = `${Math.max(1, rect.width * scaleX)}px`;
        highlight.style.height = `${Math.max(1, rect.height * scaleY)}px`;
        if (rect.angle) {
          highlight.style.transformOrigin = "top left";
          highlight.style.transform = `rotate(${rect.angle}deg)`;
        }
        highlight.setAttribute("aria-hidden", "true");
        layer.appendChild(highlight);
      }
    }
  }

  function focusSearchResult() {
    const tab = state.tabs.tabs.get(state.tabs.activeTabId);
    const result = tab.searchResults[tab.activeSearchResult];
    if (!result) return;
    setCurrentPage(result.page, true);
    updateSearchStatus(`第 ${tab.activeSearchResult + 1} / ${tab.searchResults.length} 处`);
    renderSearchHighlights();
  }

  function moveSearchResult(step) {
    const tab = state.tabs.tabs.get(state.tabs.activeTabId);
    if (!tab.searchResults.length) return;
    tab.activeSearchResult = (tab.activeSearchResult + step + tab.searchResults.length) % tab.searchResults.length;
    focusSearchResult();
  }

  function searchDocument() {
    const tab = state.tabs.tabs.get(state.tabs.activeTabId);
    const query = elements.searchInput.value.trim();
    tab.searchResults = [];
    tab.activeSearchResult = -1;
    if (tab.searchRequestId) cancelRequest(tab.searchRequestId);
    tab.searchRequestId = "";
    renderSearchHighlights();
    if (!query || !state.pages.length) {
      updateSearchStatus("");
      return;
    }
    const requestId = `search-${state.nextRequest++}`;
    tab.searchRequestId = requestId;
    state.pending.set(requestId, { tab, search: true });
    updateSearchStatus("搜索中...");
    try {
      send({ type: "search", documentId: state.documentId, requestId, query });
    } catch (error) {
      state.pending.delete(requestId);
      tab.searchRequestId = "";
      showToast(error.message);
    }
  }

  function handleSearchMessage(message, tab = state.tabs.tabs.get(state.tabs.activeTabId)) {
    if (tab.searchRequestId !== message.requestId) return;
    state.pending.delete(message.requestId);
    tab.searchRequestId = "";
    tab.searchResults = Array.isArray(message.results) ? message.results : [];
    tab.activeSearchResult = tab.searchResults.length ? 0 : -1;
    if (tab !== state.tabs.tabs.get(state.tabs.activeTabId)) return;
    updateSearchStatus(tab.searchResults.length ? `找到 ${tab.searchResults.length} 处` : "无匹配");
    renderSearchHighlights();
    if (tab.activeSearchResult >= 0) focusSearchResult();
  }

  function handleTextMessage(message, tab = state.tabs.tabs.get(state.tabs.activeTabId)) {
    tab.textRequests.delete(message.page);
    state.pending.delete(message.requestId);
    const runs = Array.isArray(message.runs) ? message.runs : [];
    tab.textCache.set(message.page, runs);
    tab.textPromises.get(message.page)?.resolve(runs);
    tab.textPromises.delete(message.page);
    if (tab === state.tabs.tabs.get(state.tabs.activeTabId)) render(message.page);
  }

  function handleError(pending, message) {
    if (pending?.text) {
      pending.tab.textRequests.delete(pending.page);
      pending.reject?.(new Error(message.message || "文字读取失败"));
      pending.tab.textPromises.delete(pending.page);
    } else if (pending?.search) {
      if (pending.tab === state.tabs.tabs.get(state.tabs.activeTabId)) updateSearchStatus("搜索失败");
    }
  }

  function textForRuns(runs) {
    return (runs || []).map((run) => run.text || "").join("").trim();
  }

  return { requestText, render, renderSearchHighlights, searchDocument, moveSearchResult, handleSearchMessage, handleTextMessage, handleError, textForRuns };
}
