import { createTabState, isDocumentKey, activeDocument } from "./tabs.js";

export const DEFAULT_DPI = 96;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 4;
export const ZOOM_STEP = 0.25;

export function createElements() {
  return {
    connectionStatus: document.querySelector("#connection-status"),
    tabBar: document.querySelector("#tab-bar"),
    documentName: document.querySelector("#document-name"),
    documentPages: document.querySelector("#document-pages"),
    workerCount: document.querySelector("#worker-count"),
    renderStatus: document.querySelector("#render-status"),
    emptyState: document.querySelector("#empty-state"),
    pageList: document.querySelector("#page-list"),
    pageInput: document.querySelector("#page-input"),
    pageTotal: document.querySelector("#page-total"),
    zoomValue: document.querySelector("#zoom-value"),
    toast: document.querySelector("#toast"),
    viewer: document.querySelector("#viewer"),
    thumbnailList: document.querySelector("#thumbnail-list"),
    thumbnailCount: document.querySelector("#thumbnail-count"),
    previousPage: document.querySelector("#previous-page"),
    nextPage: document.querySelector("#next-page"),
    fitWidth: document.querySelector("#fit-width"),
    toggleThumbnails: document.querySelector("#toggle-thumbnails"),
    backToTop: document.querySelector("#back-to-top"),
    recentToggle: document.querySelector("#recent-toggle"),
    recentPanel: document.querySelector("#recent-panel"),
    recentList: document.querySelector("#recent-list"),
    recentEmpty: document.querySelector("#recent-empty"),
    recentClear: document.querySelector("#recent-clear"),
    copyPath: document.querySelector("#copy-path"),
    closeDocument: document.querySelector("#close-document"),
    downloadPage: document.querySelector("#download-page"),
    printPage: document.querySelector("#print-page"),
    copyPageText: document.querySelector("#copy-page-text"),
    copyDocumentText: document.querySelector("#copy-document-text"),
    fitPage: document.querySelector("#fit-page"),
    renderProgress: document.querySelector("#render-progress"),
    renderProgressLabel: document.querySelector("#render-progress-label"),
    fileMetadata: document.querySelector("#file-metadata"),
    settingsToggle: document.querySelector("#settings-toggle"),
    settingsPanel: document.querySelector("#settings-panel"),
    darkReading: document.querySelector("#dark-reading"),
    textLayerVisible: document.querySelector("#text-layer-visible"),
    pageLayout: document.querySelector("#page-layout"),
    fullscreenToggle: document.querySelector("#fullscreen-toggle"),
    rotatePage: document.querySelector("#rotate-page"),
    searchToggle: document.querySelector("#search-toggle"),
    searchPanel: document.querySelector("#search-panel"),
    searchInput: document.querySelector("#search-input"),
    searchPrevious: document.querySelector("#search-previous"),
    searchNext: document.querySelector("#search-next"),
    searchStatus: document.querySelector("#search-status"),
  };
}

export function createState() {
  const shared = {
    socket: null,
    socketConfig: null,
    nextRequest: 1,
    pending: new Map(),
    orphanOpenRequests: new Set(),
    expectedBinaries: [],
    observer: null,
    currentPageObserver: null,
    visiblePages: new Map(),
    pageElements: new Map(),
    pageParts: new Map(),
    reconnectTimer: null,
    reconnectDelay: 250,
    thumbnailsVisible: false,
    thumbnailObserver: null,
    thumbnailElements: new Map(),
    recentFiles: [],
    pageLayout: "single",
    darkReading: false,
    textLayerVisible: true,
    touchStart: null,
    scrollFrame: 0,
    tabs: createTabState(),
  };
  return new Proxy(shared, {
    get(target, key, receiver) {
      if (typeof key === "string" && isDocumentKey(key)) return activeDocument(target.tabs)?.[key];
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      if (typeof key === "string" && isDocumentKey(key)) {
        const document = activeDocument(target.tabs);
        if (document) document[key] = value;
        return true;
      }
      return Reflect.set(target, key, value, receiver);
    },
  });
}
