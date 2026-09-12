package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image/color"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/zc310/ofd/pkg/webreader"
)

const (
	webSocketPath       = "/ws"
	defaultRenderDPI    = 96.0
	minRenderDPI        = 36.0
	maxRenderDPI        = 600.0
	maxControlMessage   = 64 << 10
	renderQueueCapacity = 32
	maxRenderWorkers    = 8
	webSocketPingEvery  = 20 * time.Second
	webSocketReadWait   = 60 * time.Second
)

var (
	errRenderQueueFull = errors.New("渲染队列已满")
	errDocumentClosed  = errors.New("文档已经关闭")
)

type webSocketConfig struct {
	URL      string `json:"url"`
	Token    string `json:"token"`
	Protocol int    `json:"protocol"`
}

type renderServer struct {
	ctx    context.Context
	cancel context.CancelFunc

	listener   net.Listener
	httpServer *http.Server
	token      string
	workers    int
	jobs       chan renderJob
	workerDone sync.WaitGroup

	mu        sync.RWMutex
	closed    bool
	sessions  map[*session]struct{}
	closeOnce sync.Once
	closeErr  error
}

func newRenderServer() (*renderServer, error) {
	token, err := randomToken()
	if err != nil {
		return nil, fmt.Errorf("生成 WebSocket 令牌失败: %w", err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("启动本地渲染服务失败: %w", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	server := &renderServer{
		ctx:      ctx,
		cancel:   cancel,
		listener: listener,
		token:    token,
		workers:  renderWorkerCount(),
		jobs:     make(chan renderJob, renderQueueCapacity),
		sessions: make(map[*session]struct{}),
	}
	mux := http.NewServeMux()
	mux.HandleFunc(webSocketPath, server.handleWebSocket)
	server.httpServer = &http.Server{Handler: mux}

	for index := 0; index < server.workers; index++ {
		server.workerDone.Add(1)
		go server.renderWorker()
	}
	go func() {
		if serveErr := server.httpServer.Serve(listener); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			server.mu.Lock()
			if !server.closed {
				server.closeErr = serveErr
			}
			server.mu.Unlock()
		}
	}()
	return server, nil
}

func (s *renderServer) config() (webSocketConfig, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.closed || s.listener == nil {
		return webSocketConfig{}, fmt.Errorf("渲染服务已经关闭")
	}
	return webSocketConfig{
		URL:      "ws://" + s.listener.Addr().String() + webSocketPath + "?token=" + url.QueryEscape(s.token),
		Token:    s.token,
		Protocol: 3,
	}, nil
}

func (s *renderServer) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("token") != s.token {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if !allowedWebSocketOrigin(r.Header.Get("Origin")) {
		http.Error(w, "forbidden origin", http.StatusForbidden)
		return
	}

	s.mu.RLock()
	closed := s.closed
	s.mu.RUnlock()
	if closed {
		http.Error(w, "service closed", http.StatusServiceUnavailable)
		return
	}

	upgrader := websocket.Upgrader{
		ReadBufferSize:  4 << 10,
		WriteBufferSize: 4 << 10,
		CheckOrigin: func(*http.Request) bool {
			return true
		},
	}
	connection, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	connection.EnableWriteCompression(false)
	session := newSession(s, connection)

	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		_ = connection.Close()
		return
	}
	s.sessions[session] = struct{}{}
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		delete(s.sessions, session)
		s.mu.Unlock()
	}()
	session.serve()
}

func (s *renderServer) enqueue(job renderJob) error {
	s.mu.RLock()
	closed := s.closed
	s.mu.RUnlock()
	if closed {
		return fmt.Errorf("渲染服务已经关闭")
	}
	select {
	case s.jobs <- job:
		return nil
	case <-s.ctx.Done():
		return fmt.Errorf("渲染服务已经关闭")
	default:
		return errRenderQueueFull
	}
}

func (s *renderServer) renderWorker() {
	defer s.workerDone.Done()
	for {
		select {
		case <-s.ctx.Done():
			return
		case job := <-s.jobs:
			s.processRenderJob(job)
		}
	}
}

func (s *renderServer) processRenderJob(job renderJob) {
	defer job.session.finishRequest(job.request)
	if job.ctx.Err() != nil {
		return
	}
	if job.kind == "text" || job.kind == "search" {
		data, err := job.document.text(job.ctx, job.page, job.query, job.kind == "search")
		if err != nil {
			if job.ctx.Err() == nil && !job.document.isClosed() {
				_ = job.session.sendJSON(errorMessage(job.document.id, job.request.id, err))
			}
			return
		}
		if job.kind == "text" {
			_ = job.session.sendJSONContext(job.ctx, map[string]any{
				"type": "text", "requestId": job.request.id, "documentId": job.document.id,
				"page": job.page, "runs": data,
			})
		} else {
			_ = job.session.sendJSONContext(job.ctx, map[string]any{
				"type": "search", "requestId": job.request.id, "documentId": job.document.id,
				"query": job.query, "results": data,
			})
		}
		return
	}
	if !job.session.sendJSONContext(job.ctx, map[string]any{
		"type":       "rendering",
		"requestId":  job.request.id,
		"documentId": job.document.id,
		"page":       job.page,
	}) {
		return
	}

	pngData, err := job.document.render(job.ctx, job.page, job.dpi)
	if err != nil {
		if job.ctx.Err() == nil && !job.document.isClosed() {
			_ = job.session.sendJSON(errorMessage(job.document.id, job.request.id, err))
		}
		return
	}
	if job.ctx.Err() != nil || job.document.isClosed() {
		return
	}
	page := job.document.pages[job.page]
	width, height := pagePixels(page, job.dpi)
	metadata, err := json.Marshal(map[string]any{
		"type":       "rendered",
		"requestId":  job.request.id,
		"documentId": job.document.id,
		"page":       job.page,
		"dpi":        job.dpi,
		"width":      width,
		"height":     height,
		"format":     "png",
	})
	if err != nil {
		_ = job.session.sendJSON(errorMessage(job.document.id, job.request.id, err))
		return
	}
	job.session.sendBatchContext(job.ctx, []wireMessage{
		{messageType: websocket.TextMessage, data: metadata},
		{messageType: websocket.BinaryMessage, data: pngData},
	})
}

func (s *renderServer) Close() error {
	s.closeOnce.Do(func() {
		s.mu.Lock()
		s.closed = true
		sessions := make([]*session, 0, len(s.sessions))
		for session := range s.sessions {
			sessions = append(sessions, session)
		}
		s.mu.Unlock()

		s.cancel()
		for _, session := range sessions {
			session.close()
		}

		shutdownContext, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if s.httpServer != nil {
			if err := s.httpServer.Shutdown(shutdownContext); err != nil && !errors.Is(err, http.ErrServerClosed) {
				s.mu.Lock()
				s.closeErr = err
				s.mu.Unlock()
			}
		}
		s.workerDone.Wait()
	})
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.closeErr
}

type renderJob struct {
	session  *session
	document *document
	request  *sessionRequest
	page     int
	dpi      float64
	query    string
	kind     string
	ctx      context.Context
}

type wireMessage struct {
	messageType int
	data        []byte
}

type session struct {
	server *renderServer
	conn   *websocket.Conn
	ctx    context.Context
	cancel context.CancelFunc

	outbound  chan []wireMessage
	writeDone chan struct{}
	closeOnce sync.Once

	mu        sync.Mutex
	documents map[string]*document
	requests  map[string]*sessionRequest
}

type sessionRequest struct {
	id         string
	documentID string
	cancel     context.CancelFunc
}

func newSession(server *renderServer, connection *websocket.Conn) *session {
	ctx, cancel := context.WithCancel(server.ctx)
	return &session{
		server:    server,
		conn:      connection,
		ctx:       ctx,
		cancel:    cancel,
		outbound:  make(chan []wireMessage, renderQueueCapacity),
		writeDone: make(chan struct{}),
		documents: make(map[string]*document),
		requests:  make(map[string]*sessionRequest),
	}
}

func (s *session) serve() {
	go s.writeLoop()
	s.readLoop()
	s.close()
	<-s.writeDone
}

func (s *session) readLoop() {
	s.conn.SetReadLimit(maxControlMessage)
	_ = s.conn.SetReadDeadline(time.Now().Add(webSocketReadWait))
	s.conn.SetPongHandler(func(string) error {
		return s.conn.SetReadDeadline(time.Now().Add(webSocketReadWait))
	})
	for {
		messageType, data, err := s.conn.ReadMessage()
		if err != nil {
			return
		}
		if messageType != websocket.TextMessage {
			_ = s.sendJSON(errorMessage("", "", fmt.Errorf("只接受 JSON 控制消息")))
			continue
		}
		var message clientMessage
		if err := json.Unmarshal(data, &message); err != nil {
			_ = s.sendJSON(errorMessage(message.DocumentID, message.RequestID, fmt.Errorf("控制消息格式错误: %w", err)))
			continue
		}
		s.handleMessage(message)
	}
}

func (s *session) handleMessage(message clientMessage) {
	switch strings.ToLower(strings.TrimSpace(message.Type)) {
	case "open":
		s.handleOpen(message)
	case "render":
		s.handleRender(message)
	case "text":
		s.handleText(message)
	case "search":
		s.handleSearch(message)
	case "cancel":
		s.cancelRequest(message.DocumentID, message.RequestID)
	case "close":
		s.closeDocument(message.DocumentID, true)
	default:
		_ = s.sendJSON(errorMessage(message.DocumentID, message.RequestID, fmt.Errorf("未知消息类型: %q", message.Type)))
	}
}

func (s *session) handleText(message clientMessage) {
	requestID := strings.TrimSpace(message.RequestID)
	if requestID == "" || len(requestID) > 128 {
		_ = s.sendJSON(errorMessage(message.DocumentID, requestID, fmt.Errorf("text 请求缺少有效 requestId")))
		return
	}
	ctx, request, document, err := s.beginRequest(message.DocumentID, requestID)
	if err != nil {
		_ = s.sendJSON(errorMessage(message.DocumentID, requestID, err))
		return
	}
	job := renderJob{session: s, document: document, request: request, page: message.Page, ctx: ctx, kind: "text"}
	if err := s.server.enqueue(job); err != nil {
		s.finishRequest(request)
		_ = s.sendJSON(errorMessage(message.DocumentID, requestID, err))
	}
}

func (s *session) handleSearch(message clientMessage) {
	requestID := strings.TrimSpace(message.RequestID)
	query := strings.TrimSpace(message.Query)
	if requestID == "" || len(requestID) > 128 {
		_ = s.sendJSON(errorMessage(message.DocumentID, requestID, fmt.Errorf("search 请求缺少有效 requestId")))
		return
	}
	if len([]rune(query)) > 256 {
		_ = s.sendJSON(errorMessage(message.DocumentID, requestID, fmt.Errorf("搜索文字过长")))
		return
	}
	ctx, request, document, err := s.beginRequest(message.DocumentID, requestID)
	if err != nil {
		_ = s.sendJSON(errorMessage(message.DocumentID, requestID, err))
		return
	}
	job := renderJob{session: s, document: document, request: request, query: query, ctx: ctx, kind: "search"}
	if err := s.server.enqueue(job); err != nil {
		s.finishRequest(request)
		_ = s.sendJSON(errorMessage(message.DocumentID, requestID, err))
	}
}

func (s *session) handleOpen(message clientMessage) {
	path, err := normalizeOFDPath(message.Path)
	if err != nil {
		_ = s.sendJSON(errorMessage(message.DocumentID, message.RequestID, err))
		return
	}
	document, err := openDocument(path, s.server.workers)
	if err != nil {
		_ = s.sendJSON(errorMessage(message.DocumentID, message.RequestID, err))
		return
	}
	if s.ctx.Err() != nil {
		_ = document.Close()
		return
	}
	if err := s.addDocument(document); err != nil {
		_ = document.Close()
		_ = s.sendJSON(errorMessage(document.id, message.RequestID, err))
		return
	}
	pages := make([]map[string]any, 0, len(document.pages))
	for index, page := range document.pages {
		pages = append(pages, map[string]any{
			"index":  index,
			"width":  page.Width,
			"height": page.Height,
		})
	}
	_ = s.sendJSON(map[string]any{
		"type":       "opened",
		"requestId":  message.RequestID,
		"documentId": document.id,
		"name":       filepath.Base(path),
		"path":       path,
		"fileSize":   document.fileSize,
		"modifiedAt": document.modifiedAt.Format(time.RFC3339Nano),
		"pageCount":  len(pages),
		"pages":      pages,
		"workers":    len(document.readers),
	})
}

func (s *session) addDocument(document *document) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ctx.Err() != nil {
		return fmt.Errorf("连接已经关闭")
	}
	if _, exists := s.documents[document.id]; exists {
		return fmt.Errorf("文档标识已经在使用: %s", document.id)
	}
	s.documents[document.id] = document
	return nil
}

func (s *session) documentByID(documentID string) (*document, error) {
	documentID = strings.TrimSpace(documentID)
	if documentID == "" {
		return nil, fmt.Errorf("请求缺少有效 documentId")
	}
	s.mu.Lock()
	document := s.documents[documentID]
	s.mu.Unlock()
	if document == nil {
		return nil, fmt.Errorf("文档不存在: %s", documentID)
	}
	return document, nil
}

func (s *session) removeDocument(documentID string) (*document, []context.CancelFunc, error) {
	documentID = strings.TrimSpace(documentID)
	if documentID == "" {
		return nil, nil, fmt.Errorf("close 请求缺少有效 documentId")
	}
	s.mu.Lock()
	document := s.documents[documentID]
	if document == nil {
		s.mu.Unlock()
		return nil, nil, fmt.Errorf("文档不存在: %s", documentID)
	}
	delete(s.documents, documentID)
	cancels := make([]context.CancelFunc, 0)
	for requestID, request := range s.requests {
		if request.documentID != documentID {
			continue
		}
		cancels = append(cancels, request.cancel)
		delete(s.requests, requestID)
	}
	s.mu.Unlock()
	return document, cancels, nil
}

func (s *session) closeDocument(documentID string, notify bool) {
	document, cancels, err := s.removeDocument(documentID)
	if err != nil {
		if notify {
			_ = s.sendJSON(errorMessage(documentID, "", err))
		}
		return
	}
	for _, cancel := range cancels {
		cancel()
	}
	if err := document.Close(); err != nil {
		fmt.Fprintln(os.Stderr, "关闭 OFD 文档失败:", err)
	}
	if notify {
		_ = s.sendJSON(map[string]any{"type": "closed", "documentId": document.id})
	}
}

func (s *session) closeAllDocuments() {
	s.mu.Lock()
	documents := make([]*document, 0, len(s.documents))
	for documentID, document := range s.documents {
		documents = append(documents, document)
		delete(s.documents, documentID)
	}
	requests := make([]*sessionRequest, 0, len(s.requests))
	for requestID, request := range s.requests {
		requests = append(requests, request)
		delete(s.requests, requestID)
	}
	s.mu.Unlock()
	for _, request := range requests {
		request.cancel()
	}
	for _, document := range documents {
		if err := document.Close(); err != nil {
			fmt.Fprintln(os.Stderr, "关闭 OFD 文档失败:", err)
		}
	}
}

func (s *session) beginRequest(documentID, requestID string) (context.Context, *sessionRequest, *document, error) {
	requestID = strings.TrimSpace(requestID)
	documentID = strings.TrimSpace(documentID)
	if documentID == "" {
		return nil, nil, nil, fmt.Errorf("请求缺少有效 documentId")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ctx.Err() != nil {
		return nil, nil, nil, fmt.Errorf("连接已经关闭")
	}
	document := s.documents[documentID]
	if document == nil {
		return nil, nil, nil, fmt.Errorf("文档不存在: %s", documentID)
	}
	if _, exists := s.requests[requestID]; exists {
		return nil, nil, nil, fmt.Errorf("requestId 已经在使用: %s", requestID)
	}
	ctx, cancel := context.WithCancel(s.ctx)
	request := &sessionRequest{id: requestID, documentID: documentID, cancel: cancel}
	s.requests[requestID] = request
	return ctx, request, document, nil
}

func (s *session) finishRequest(request *sessionRequest) {
	if request == nil {
		return
	}
	s.mu.Lock()
	if current := s.requests[request.id]; current == request {
		delete(s.requests, request.id)
	}
	s.mu.Unlock()
	request.cancel()
}

func (s *session) cancelRequest(documentID, requestID string) {
	s.mu.Lock()
	requestID = strings.TrimSpace(requestID)
	request := s.requests[requestID]
	if request != nil && request.documentID == strings.TrimSpace(documentID) {
		delete(s.requests, requestID)
	}
	s.mu.Unlock()
	if request != nil && request.documentID == strings.TrimSpace(documentID) {
		request.cancel()
	}
}

func (s *session) handleRender(message clientMessage) {
	requestID := strings.TrimSpace(message.RequestID)
	if requestID == "" || len(requestID) > 128 {
		_ = s.sendJSON(errorMessage(message.DocumentID, requestID, fmt.Errorf("render 请求缺少有效 requestId")))
		return
	}
	dpi := message.DPI
	if dpi == 0 {
		dpi = defaultRenderDPI
	}
	if math.IsNaN(dpi) || math.IsInf(dpi, 0) || dpi < minRenderDPI || dpi > maxRenderDPI {
		_ = s.sendJSON(errorMessage(message.DocumentID, requestID, fmt.Errorf("DPI 必须在 %.0f 到 %.0f 之间", minRenderDPI, maxRenderDPI)))
		return
	}
	ctx, request, document, err := s.beginRequest(message.DocumentID, requestID)
	if err != nil {
		_ = s.sendJSON(errorMessage(message.DocumentID, requestID, err))
		return
	}
	job := renderJob{
		session:  s,
		document: document,
		request:  request,
		page:     message.Page,
		dpi:      dpi,
		ctx:      ctx,
	}
	if err := s.server.enqueue(job); err != nil {
		s.finishRequest(request)
		_ = s.sendJSON(errorMessage(message.DocumentID, requestID, err))
	}
}

func (s *session) close() {
	s.closeOnce.Do(func() {
		s.cancel()
		s.closeAllDocuments()
		_ = s.conn.Close()
	})
}

func (s *session) sendJSON(value any) bool {
	data, err := json.Marshal(value)
	if err != nil {
		return false
	}
	return s.sendBatch([]wireMessage{{messageType: websocket.TextMessage, data: data}})
}

func (s *session) sendJSONContext(ctx context.Context, value any) bool {
	data, err := json.Marshal(value)
	if err != nil {
		return false
	}
	return s.sendBatchContext(ctx, []wireMessage{{messageType: websocket.TextMessage, data: data}})
}

func (s *session) sendBatch(batch []wireMessage) bool {
	return s.sendBatchContext(s.ctx, batch)
}

func (s *session) sendBatchContext(ctx context.Context, batch []wireMessage) bool {
	select {
	case s.outbound <- batch:
		return true
	case <-ctx.Done():
		return false
	case <-s.ctx.Done():
		return false
	}
}

func (s *session) writeLoop() {
	defer close(s.writeDone)
	ticker := time.NewTicker(webSocketPingEvery)
	defer ticker.Stop()
	for {
		select {
		case batch := <-s.outbound:
			for _, message := range batch {
				_ = s.conn.SetWriteDeadline(time.Now().Add(30 * time.Second))
				if err := s.conn.WriteMessage(message.messageType, message.data); err != nil {
					s.close()
					return
				}
			}
		case <-ticker.C:
			_ = s.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := s.conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(10*time.Second)); err != nil {
				s.close()
				return
			}
		case <-s.ctx.Done():
			return
		}
	}
}

type clientMessage struct {
	Type       string  `json:"type"`
	DocumentID string  `json:"documentId"`
	RequestID  string  `json:"requestId"`
	Path       string  `json:"path"`
	Page       int     `json:"page"`
	DPI        float64 `json:"dpi"`
	Query      string  `json:"query"`
}

func errorMessage(documentID, requestID string, err error) map[string]any {
	message := map[string]any{"type": "error", "message": err.Error()}
	if documentID != "" {
		message["documentId"] = documentID
	}
	if requestID != "" {
		message["requestId"] = requestID
	}
	return message
}

type document struct {
	id         string
	path       string
	data       []byte
	pages      []webreader.PageInfo
	readers    []*webreader.Reader
	fileSize   int64
	modifiedAt time.Time

	available chan *webreader.Reader
	mu        sync.Mutex
	closed    bool
	inFlight  sync.WaitGroup
	closeOnce sync.Once
	closeErr  error
}

func openDocument(path string, readerCount int) (*document, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("获取 OFD 文件信息失败: %w", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("读取 OFD 文件失败: %w", err)
	}
	reader, err := webreader.Open(data)
	if err != nil {
		return nil, fmt.Errorf("解析 OFD 文件失败: %w", err)
	}
	pages, err := reader.Pages()
	if err != nil {
		_ = reader.Close()
		return nil, fmt.Errorf("读取 OFD 页面失败: %w", err)
	}
	if len(pages) == 0 {
		_ = reader.Close()
		return nil, fmt.Errorf("OFD 文档没有页面")
	}
	if readerCount < 1 {
		readerCount = 1
	}
	if readerCount > len(pages) {
		readerCount = len(pages)
	}
	documentID, err := randomToken()
	if err != nil {
		_ = reader.Close()
		return nil, fmt.Errorf("生成文档标识失败: %w", err)
	}
	document := &document{
		id:         documentID,
		path:       path,
		data:       data,
		pages:      pages,
		readers:    []*webreader.Reader{reader},
		fileSize:   info.Size(),
		modifiedAt: info.ModTime(),
		available:  make(chan *webreader.Reader, readerCount),
	}
	document.available <- reader
	for index := 1; index < readerCount; index++ {
		clone, cloneErr := webreader.Open(data)
		if cloneErr != nil {
			_ = document.Close()
			return nil, fmt.Errorf("创建并行渲染器失败: %w", cloneErr)
		}
		document.readers = append(document.readers, clone)
		document.available <- clone
	}
	return document, nil
}

func (d *document) render(ctx context.Context, page int, dpi float64) ([]byte, error) {
	d.mu.Lock()
	if d.closed {
		d.mu.Unlock()
		return nil, errDocumentClosed
	}
	if page < 0 || page >= len(d.pages) {
		d.mu.Unlock()
		return nil, fmt.Errorf("页面索引超出范围: %d", page)
	}
	d.inFlight.Add(1)
	d.mu.Unlock()
	defer d.inFlight.Done()

	var reader *webreader.Reader
	select {
	case reader = <-d.available:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	d.mu.Lock()
	closed := d.closed
	d.mu.Unlock()
	if closed {
		d.available <- reader
		return nil, errDocumentClosed
	}
	defer func() {
		d.available <- reader
	}()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	pngData, err := reader.RenderPage(page, webreader.RenderOptions{
		DPI:        dpi,
		Background: color.White,
	})
	if err != nil {
		return nil, fmt.Errorf("渲染第 %d 页失败: %w", page+1, err)
	}
	d.mu.Lock()
	closed = d.closed
	d.mu.Unlock()
	if closed {
		return nil, errDocumentClosed
	}
	return pngData, nil
}

func (d *document) text(ctx context.Context, page int, query string, search bool) (any, error) {
	d.mu.Lock()
	if d.closed {
		d.mu.Unlock()
		return nil, errDocumentClosed
	}
	if !search && (page < 0 || page >= len(d.pages)) {
		d.mu.Unlock()
		return nil, fmt.Errorf("页面索引超出范围: %d", page)
	}
	d.inFlight.Add(1)
	d.mu.Unlock()
	defer d.inFlight.Done()

	var reader *webreader.Reader
	select {
	case reader = <-d.available:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	defer func() { d.available <- reader }()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if search {
		results, err := reader.Search(query)
		if err != nil {
			return nil, fmt.Errorf("搜索文字失败: %w", err)
		}
		output := make([]map[string]any, 0, len(results))
		for _, result := range results {
			rects := make([]map[string]any, 0, len(result.Rects))
			for _, rect := range result.Rects {
				rects = append(rects, map[string]any{"x": rect.X, "y": rect.Y, "width": rect.Width, "height": rect.Height, "angle": rect.Angle})
			}
			output = append(output, map[string]any{
				"page": result.Page, "run": result.Run, "text": result.Text,
				"start": result.Start, "end": result.End, "rects": rects,
			})
		}
		return output, nil
	}
	runs, err := reader.Text(page)
	if err != nil {
		return nil, fmt.Errorf("读取第 %d 页文字失败: %w", page+1, err)
	}
	output := make([]map[string]any, 0, len(runs))
	for _, run := range runs {
		glyphs := make([]map[string]any, 0, len(run.Glyphs))
		for _, glyph := range run.Glyphs {
			glyphs = append(glyphs, map[string]any{
				"text": glyph.Text, "x": glyph.X, "y": glyph.Y,
				"width": glyph.Width, "height": glyph.Height, "angle": glyph.Angle,
			})
		}
		output = append(output, map[string]any{
			"text": run.Text, "x": run.X, "y": run.Y, "width": run.Width, "height": run.Height,
			"font": run.Font, "size": run.Size, "weight": run.Weight, "fontFamily": run.FontFamily,
			"bold": run.Bold, "italic": run.Italic, "charDirection": run.CharDirection,
			"glyphs": glyphs,
		})
	}
	return output, nil
}

func (d *document) isClosed() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.closed
}

func (d *document) Close() error {
	d.closeOnce.Do(func() {
		d.mu.Lock()
		d.closed = true
		d.mu.Unlock()
		d.inFlight.Wait()
		for _, reader := range d.readers {
			if err := reader.Close(); err != nil && d.closeErr == nil {
				d.closeErr = err
			}
		}
		d.data = nil
	})
	return d.closeErr
}

func renderWorkerCount() int {
	if value, err := strconv.Atoi(strings.TrimSpace(os.Getenv("OFD_VIEWER_RENDER_WORKERS"))); err == nil && value > 0 {
		if value > maxRenderWorkers {
			return maxRenderWorkers
		}
		return value
	}
	count := runtime.GOMAXPROCS(0)
	if count < 1 {
		return 1
	}
	if count > maxRenderWorkers {
		return maxRenderWorkers
	}
	return count
}

func pagePixels(page webreader.PageInfo, dpi float64) (int, int) {
	width := int(math.Round(page.Width * dpi / 25.4))
	height := int(math.Round(page.Height * dpi / 25.4))
	if width < 1 {
		width = 1
	}
	if height < 1 {
		height = 1
	}
	return width, height
}

func randomToken() (string, error) {
	data := make([]byte, 32)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func allowedWebSocketOrigin(origin string) bool {
	origin = strings.TrimSpace(origin)
	if origin == "" || origin == "wails://wails" || origin == "wails://wails.localhost" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "wails.localhost"
}
