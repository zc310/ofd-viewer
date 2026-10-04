module github.com/zc310/ofd-viewer

go 1.27

require (
	github.com/gorilla/websocket v1.5.3
	github.com/wailsapp/wails/v2 v2.16.0
	github.com/zc310/ofd v0.1.5-0.20261004130511-32a988aa18ac
)

require (
	codeberg.org/go-latex/latex v0.3.0 // indirect
	codeberg.org/go-pdf/fpdf v0.12.0 // indirect
	git.sr.ht/~jackmordaunt/go-toast/v2 v2.0.3 // indirect
	github.com/BurntSushi/freetype-go v0.0.0-20160129220410-b763ddbfe298 // indirect
	github.com/BurntSushi/graphics-go v0.0.0-20160129215708-b43f31a4a966 // indirect
	github.com/BurntSushi/xgb v0.0.0-20210121224620-deaf085860bc // indirect
	github.com/BurntSushi/xgbutil v0.0.0-20190907113008-ad855c713046 // indirect
	github.com/ByteArena/poly2tri-go v0.0.0-20170716161910-d102ad91854f // indirect
	github.com/Kagami/go-avif v0.1.0 // indirect
	github.com/andybalholm/brotli v1.2.6 // indirect
	github.com/benoitkugler/textlayout v0.3.2 // indirect
	github.com/benoitkugler/textprocessing v0.0.6 // indirect
	github.com/bep/debounce v1.2.1 // indirect
	github.com/dkrisman/gobig2 v0.0.0-20260513123937-51e39052fde6 // indirect
	github.com/emmansun/gmsm v0.45.0 // indirect
	github.com/go-fonts/latin-modern v0.3.3 // indirect
	github.com/go-ole/go-ole v1.3.0 // indirect
	github.com/go-text/typesetting v0.3.5 // indirect
	github.com/goccy/go-json v0.11.2 // indirect
	github.com/godbus/dbus/v5 v5.2.2 // indirect
	github.com/golang/freetype v0.0.0-20170609003504-e2365dfdc4a0 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/h2non/filetype v1.1.3 // indirect
	github.com/jchv/go-winloader v0.0.0-20210711035445-715c2860da7e // indirect
	github.com/klauspost/compress v1.20.1 // indirect
	github.com/kolesa-team/go-webp v1.0.5 // indirect
	github.com/kovidgoyal/go-parallel v1.1.1 // indirect
	github.com/kovidgoyal/imaging v1.8.23 // indirect
	github.com/labstack/echo/v4 v4.13.3 // indirect
	github.com/labstack/gommon v0.4.2 // indirect
	github.com/leaanthony/go-ansi-parser v1.6.1 // indirect
	github.com/leaanthony/gosod v1.0.4 // indirect
	github.com/leaanthony/slicer v1.6.0 // indirect
	github.com/leaanthony/u v1.1.1 // indirect
	github.com/mattn/go-colorable v0.1.13 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/pkg/browser v0.0.0-20240102092130-5ac0b6a4141c // indirect
	github.com/pkg/errors v0.9.1 // indirect
	github.com/rivo/uniseg v0.4.7 // indirect
	github.com/samber/lo v1.49.1 // indirect
	github.com/srwiley/rasterx v0.0.0-20220730225603-2ab79fcdd4ef // indirect
	github.com/srwiley/scanx v0.0.0-20190309010443-e94503791388 // indirect
	github.com/tdewolff/canvas v0.0.0-20260913163248-dd4999d1c76a // indirect
	github.com/tdewolff/font v0.0.0-20260913163313-54f98bb59ee6 // indirect
	github.com/tdewolff/minify/v2 v2.24.19 // indirect
	github.com/tdewolff/parse/v2 v2.8.16 // indirect
	github.com/tkrajina/go-reflector v0.5.8 // indirect
	github.com/valyala/bytebufferpool v1.0.0 // indirect
	github.com/valyala/fasttemplate v1.2.2 // indirect
	github.com/wailsapp/go-webview2 v1.0.22 // indirect
	github.com/wailsapp/mimetype v1.4.1 // indirect
	github.com/wcharczuk/go-chart/v2 v2.1.2 // indirect
	github.com/woozymasta/png v1.2.0 // indirect
	github.com/yuin/goldmark v1.8.6 // indirect
	github.com/zc310/fontfix v0.0.3-0.20260927235621-9e5b20635fc8 // indirect
	golang.org/x/crypto v0.57.0 // indirect
	golang.org/x/image v0.46.0 // indirect
	golang.org/x/net v0.59.0 // indirect
	golang.org/x/sys v0.48.0 // indirect
	golang.org/x/text v0.42.0 // indirect
	gonum.org/v1/plot v0.17.0 // indirect
	modernc.org/knuth v0.6.0 // indirect
	modernc.org/token v1.1.0 // indirect
	star-tex.org/x/tex v0.7.1 // indirect
)

// ofd 的 go.mod 用 fork 替换 canvas 与 font，依赖方不会继承 replace，
// 必须在这里同步镜像同样的版本，否则 canvasconv 编译不过。
replace github.com/tdewolff/font => github.com/zc310/font v0.0.0-20260928001413-b20a21f7a3b5

replace github.com/tdewolff/canvas => github.com/zc310/canvas v0.0.0-20261004015143-31a1cddb8a93
