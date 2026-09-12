const documentKeys = [
  "documentId", "path", "name", "fileSize", "modifiedAt", "workers", "pages",
  "currentPage", "zoom", "imageCache", "thumbnailCache", "renderedPages", "failedPages",
  "thumbnailRequests", "textCache", "textRequests", "textPromises", "searchResults", "activeSearchResult",
  "searchRequestId", "rotation", "fitMode", "defaultFitPending", "scrollTop",
];

export function createDocumentTab(id, path = "") {
  return {
    id, documentId: "", path,
    name: path ? path.split(/[\\/]/).pop() : "",
    fileSize: 0, modifiedAt: "", workers: 0, pages: [], currentPage: 0, zoom: 1,
    imageCache: new Map(), thumbnailCache: new Map(), renderedPages: new Set(), failedPages: new Set(),
    thumbnailRequests: new Set(),
    textCache: new Map(), textRequests: new Set(), textPromises: new Map(), searchResults: [],
     activeSearchResult: -1, searchRequestId: "", rotation: 0, fitMode: "", defaultFitPending: true, scrollTop: 0,
  };
}

export function createTabState() {
  const empty = createDocumentTab("tab-0");
  return { tabs: new Map([[empty.id, empty]]), activeTabId: empty.id, nextTabId: 1 };
}

export function activeDocument(tabState) {
  return tabState.activeTabId ? tabState.tabs.get(tabState.activeTabId) || null : null;
}

export function tabForDocument(tabState, documentId) {
  if (!documentId) return null;
  for (const tab of tabState.tabs.values()) if (tab.documentId === documentId) return tab;
  return null;
}

export function tabForPath(tabState, path) {
  for (const tab of tabState.tabs.values()) if (tab.path === path) return tab;
  return null;
}

export function addTab(tabState, path = "") {
  const tab = createDocumentTab(`tab-${tabState.nextTabId++}`, path);
  tabState.tabs.set(tab.id, tab);
  if (!tabState.activeTabId) tabState.activeTabId = tab.id;
  return tab;
}

export function activateTab(tabState, tabId) {
  if (!tabState.tabs.has(tabId)) return null;
  tabState.activeTabId = tabId;
  return activeDocument(tabState);
}

export function removeTab(tabState, tabId) {
  const ids = [...tabState.tabs.keys()];
  const index = ids.indexOf(tabId);
  tabState.tabs.delete(tabId);
  if (tabState.activeTabId === tabId) {
    const nextId = ids[index + 1] || ids[index - 1] || null;
    tabState.activeTabId = nextId && tabState.tabs.has(nextId) ? nextId : null;
  }
  return activeDocument(tabState);
}

export function applyOpened(tab, message) {
  Object.assign(tab, {
    documentId: message.documentId || "", name: message.name || tab.name || "未命名 OFD",
    path: message.path || tab.path, fileSize: Number(message.fileSize) || 0,
    modifiedAt: message.modifiedAt || "", workers: Number(message.workers) || 1,
    pages: Array.isArray(message.pages) ? message.pages : [],
    currentPage: Math.min(tab.currentPage, Math.max(0, (message.pages?.length || 1) - 1)),
  });
  tab.renderedPages = new Set([...tab.renderedPages].filter((page) => page < tab.pages.length));
  tab.failedPages = new Set([...tab.failedPages].filter((page) => page < tab.pages.length));
  return tab;
}

export function clearTabDocument(tab) {
  tab.documentId = ""; tab.fileSize = 0; tab.modifiedAt = ""; tab.workers = 0;
  tab.pages = []; tab.renderedPages.clear(); tab.failedPages.clear(); tab.thumbnailRequests.clear();
  tab.textCache.clear(); tab.textRequests.clear(); tab.textPromises.clear();
  tab.searchResults = []; tab.activeSearchResult = -1; tab.searchRequestId = "";
}

export function isDocumentKey(key) { return documentKeys.includes(key); }
