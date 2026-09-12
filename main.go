package main

import (
	"context"
	"embed"
	"fmt"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app, err := NewApp()
	if err != nil {
		_, _ = fmt.Fprintln(os.Stderr, "初始化 OFD Viewer 失败:", err)
		return
	}
	defer app.shutdown(context.Background())

	err = wails.Run(&options.App{
		Title:                    "OFD Viewer",
		Width:                    1280,
		Height:                   860,
		MinWidth:                 880,
		MinHeight:                560,
		EnableDefaultContextMenu: true,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 20, G: 23, B: 29, A: 255},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Mac: &mac.Options{
			OnFileOpen: func(path string) {
				app.queueOpenPath(path)
			},
		},
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: "ofd-viewer-zc310-tech",
			OnSecondInstanceLaunch: func(data options.SecondInstanceData) {
				for _, arg := range data.Args {
					if isOFDPath(arg) {
						app.queueOpenPath(arg)
						break
					}
				}
			},
		},
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop: true,
		},
		Linux: &linux.Options{
			WebviewGpuPolicy: linux.WebviewGpuPolicyAlways,
			ProgramName:      "ofd-viewer",
		},
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		_, _ = fmt.Fprintln(os.Stderr, "运行 OFD Viewer 失败:", err)
	}
}
