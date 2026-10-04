package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	openPathEvent = "ofd:open-path"
	maxOFDSize    = 256 << 20
	// appName 与 homepage 是关于对话框展示的固定文案。
	appName  = "OFD Viewer"
	homepage = "https://github.com/zc310/ofd"
)

type App struct {
	ctx       context.Context
	ctxMu     sync.RWMutex
	server    *renderServer
	openMu    sync.Mutex
	openQueue []string
}

// appInfo 是关于对话框展示的应用信息。
type appInfo struct {
	Name      string `json:"name"`
	Version   string `json:"version"`
	GoVersion string `json:"goVersion"`
	Homepage  string `json:"homepage"`
}

func newAppInfo() appInfo {
	return appInfo{
		Name:      appName,
		Version:   Version,
		GoVersion: goruntime.Version(),
		Homepage:  homepage,
	}
}

func NewApp() (*App, error) {
	server, err := newRenderServer()
	if err != nil {
		return nil, err
	}
	return &App{server: server}, nil
}

func (a *App) startup(ctx context.Context) {
	a.ctxMu.Lock()
	a.ctx = ctx
	a.ctxMu.Unlock()
}

func (a *App) shutdown(context.Context) {
	if a.server == nil {
		return
	}
	if err := a.server.Close(); err != nil {
		fmt.Fprintln(os.Stderr, "关闭渲染服务失败:", err)
	}
}

// WebSocketConfig 返回前端连接本地 PNG 渲染服务所需的配置。
func (a *App) WebSocketConfig() (webSocketConfig, error) {
	if a.server == nil {
		return webSocketConfig{}, fmt.Errorf("渲染服务未初始化")
	}
	return a.server.config()
}

// AppInfo 返回关于对话框需要的名称、版本与项目地址。
func (a *App) AppInfo() appInfo {
	return newAppInfo()
}

// OpenFile 打开系统文件选择器，并返回一个 OFD 文件的绝对路径。
func (a *App) OpenFile() (string, error) {
	a.ctxMu.RLock()
	ctx := a.ctx
	a.ctxMu.RUnlock()
	if ctx == nil {
		return "", fmt.Errorf("应用尚未准备完成")
	}
	path, err := runtime.OpenFileDialog(ctx, runtime.OpenDialogOptions{
		Title: "打开 OFD 文件",
		Filters: []runtime.FileFilter{
			{DisplayName: "OFD 文件 (*.ofd)", Pattern: "*.ofd"},
			{DisplayName: "所有文件 (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil {
		return "", fmt.Errorf("打开文件选择器失败: %w", err)
	}
	if path == "" {
		return "", nil
	}
	return normalizeOFDPath(path)
}

// SavePNG opens the native save dialog and writes PNG data supplied by the viewer.
func (a *App) SavePNG(dataBase64, filename string) (string, error) {
	if strings.TrimSpace(dataBase64) == "" {
		return "", fmt.Errorf("PNG 数据为空")
	}
	data, err := base64.StdEncoding.DecodeString(dataBase64)
	if err != nil {
		return "", fmt.Errorf("PNG 数据无效: %w", err)
	}
	a.ctxMu.RLock()
	ctx := a.ctx
	a.ctxMu.RUnlock()
	if ctx == nil {
		return "", fmt.Errorf("应用尚未准备完成")
	}
	if filename == "" {
		filename = "ofd-page.png"
	}
	path, err := runtime.SaveFileDialog(ctx, runtime.SaveDialogOptions{
		Title:           "保存页面 PNG",
		DefaultFilename: filepath.Base(filename),
		Filters:         []runtime.FileFilter{{DisplayName: "PNG 图片 (*.png)", Pattern: "*.png"}},
	})
	if err != nil {
		return "", fmt.Errorf("打开保存对话框失败: %w", err)
	}
	if path == "" {
		return "", nil
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		return "", fmt.Errorf("保存 PNG 失败: %w", err)
	}
	return path, nil
}

// PrintWindow prints the current Wails window using the native print facility.
func (a *App) PrintWindow() error {
	a.ctxMu.RLock()
	ctx := a.ctx
	a.ctxMu.RUnlock()
	if ctx == nil {
		return fmt.Errorf("应用尚未准备完成")
	}
	runtime.WindowPrint(ctx)
	return nil
}

// InitialPath 返回启动参数中的 OFD 文件路径。
func (a *App) InitialPath() string {
	for _, arg := range os.Args[1:] {
		if isOFDPath(arg) {
			path, err := normalizeOFDPath(arg)
			if err == nil {
				return path
			}
		}
	}
	return ""
}

// PendingPaths 返回启动阶段或前一个实例传入的待打开文件。
func (a *App) PendingPaths() []string {
	a.openMu.Lock()
	defer a.openMu.Unlock()
	paths := append([]string(nil), a.openQueue...)
	a.openQueue = nil
	return paths
}

func (a *App) queueOpenPath(path string) {
	path, err := normalizeOFDPath(path)
	if err != nil {
		return
	}
	a.ctxMu.RLock()
	ctx := a.ctx
	a.ctxMu.RUnlock()
	if ctx == nil {
		a.openMu.Lock()
		a.openQueue = append(a.openQueue, path)
		a.openMu.Unlock()
		return
	}
	runtime.WindowUnminimise(ctx)
	runtime.WindowShow(ctx)
	runtime.EventsEmit(ctx, openPathEvent, path)
}

func normalizeOFDPath(path string) (string, error) {
	path = strings.Trim(strings.TrimSpace(path), `"`)
	if path == "" {
		return "", fmt.Errorf("OFD 文件路径为空")
	}
	if !isOFDPath(path) {
		return "", fmt.Errorf("只支持 .ofd 文件")
	}
	absPath, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("无效的 OFD 文件路径: %w", err)
	}
	info, err := os.Stat(absPath)
	if err != nil {
		return "", fmt.Errorf("无法访问 OFD 文件: %w", err)
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("路径不是普通文件")
	}
	if info.Size() <= 0 {
		return "", fmt.Errorf("OFD 文件为空")
	}
	if info.Size() > maxOFDSize {
		return "", fmt.Errorf("OFD 文件超过 %d MB 限制", maxOFDSize>>20)
	}
	return filepath.Clean(absPath), nil
}

func isOFDPath(path string) bool {
	return strings.EqualFold(filepath.Ext(strings.Trim(strings.TrimSpace(path), `"`)), ".ofd")
}
