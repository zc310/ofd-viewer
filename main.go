package main

import (
	"embed"
	"fmt"
	"os"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	service, err := NewApp()
	if err != nil {
		_, _ = fmt.Fprintln(os.Stderr, "初始化 OFD Viewer 失败:", err)
		return
	}

	app := application.New(application.Options{
		Name:             appName,
		Description:      "A native Go OFD document viewer",
		FileAssociations: []string{".ofd"},
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "ofd-viewer-zc310-tech",
			OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
				for _, arg := range data.Args {
					if isOFDPath(arg) {
						service.queueOpenPath(arg)
						break
					}
				}
			},
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Linux: application.LinuxOptions{
			ProgramName: "ofd-viewer",
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:                       "main",
		Title:                      appName,
		URL:                        "/",
		Width:                      1280,
		Height:                     860,
		MinWidth:                   880,
		MinHeight:                  560,
		BackgroundColour:           application.NewRGBA(20, 23, 29, 255),
		EnableFileDrop:             true,
		DefaultContextMenuDisabled: false,
		Linux: application.LinuxWindow{
			WebviewGpuPolicy: application.WebviewGpuPolicyAlways,
		},
	})
	service.app = app
	service.window = window
	app.RegisterService(application.NewService(service))
	app.OnShutdown(service.shutdown)
	app.Event.OnApplicationEvent(events.Common.ApplicationOpenedWithFile, func(event *application.ApplicationEvent) {
		for _, path := range event.Context().OpenedFiles() {
			service.queueOpenPath(path)
		}
	})
	window.OnWindowEvent(events.Common.WindowFilesDropped, func(event *application.WindowEvent) {
		for _, path := range event.Context().DroppedFiles() {
			service.queueOpenPath(path)
		}
	})
	window.Show()

	if err := app.Run(); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, "运行 OFD Viewer 失败:", err)
	}
}
