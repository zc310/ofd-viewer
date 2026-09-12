# OFD Viewer

一个基于 Go、Wails 和原生 WebView 的 OFD 文档查看器。

OFD Viewer 使用 Go 解析 OFD 文档并按需渲染 PNG 页面，前端负责页面浏览、缩放、文字搜索和阅读设置。文档处理服务只监听本机回环地址，不需要部署额外的 HTTP 服务。

## 功能

- 打开本地 `.ofd` 文件，也支持拖拽打开。
- 支持在一个窗口中打开多个文档标签，并独立保存每个标签的阅读位置和视图状态。
- 按需渲染页面 PNG，适合页数较多的文档。
- 页面和缩略图使用窗口化渲染，大文档切换和滚动时只保留附近节点。
- 页面缩放、重置、适应宽度和适应页面。
- 单页和双页阅读模式。
- 双页模式支持两种页面方向：
  - 双页：第一页左侧留空，第一页显示在右侧。
  - 双页（奇数页在左）：第一页显示在左侧。
- 左侧缩略图导航，双页模式下按展开成对显示。
- 页面旋转、上一页/下一页和页码跳转。
- 文字提取、全文搜索和搜索结果高亮。
- 可选显示文字层，支持在页面上选择文字。
- 复制当前页文字、复制全文和复制文件路径。
- 下载当前页 PNG 和打印当前页。
- 深色阅读背景。
- 全屏阅读。
- 最近打开文件记录。
- 底部状态栏显示连接状态、渲染进度、文件大小和修改时间。
- OFD 文件关联，可作为系统默认查看器使用。
- Material Symbols Rounded 图标已内置到前端，支持离线运行。

渲染 WebSocket 使用协议 `3`。每个会话可以同时持有多个 `documentId`，除 `open` 外的请求必须携带目标文档的 `documentId`。

## 技术结构

```text
ofd-viewer/
├── app.go                 # Wails 应用接口、文件选择、保存和打印
├── main.go                # Wails 应用入口
├── server.go              # 本机 WebSocket 渲染服务和 OFD 操作
├── server_test.go         # WebSocket、渲染、文字和搜索测试
├── wails.json             # Wails 项目配置
├── frontend/
│   ├── src/               # 前端源码
│   ├── dist/              # Wails 嵌入的前端资源
│   ├── build.mjs         # 前端资源构建脚本
│   └── dev-server.mjs    # 开发预览服务器
└── build/
    ├── appicon.png        # 应用图标
    ├── appicon.svg        # SVG 图标候选方案
    ├── darwin/             # macOS 构建资源
    └── windows/            # Windows 构建资源
```

## 环境要求

- Go `1.26.4` 或更高版本。
- Node.js，建议使用当前 LTS 版本。
- Wails CLI `v2.15.0`。
- Linux 构建需要 Wails/WebKitGTK 所需的系统开发库。

项目通过 Go modules 引用 OFD 核心库：

```text
github.com/zc310/ofd
```

首次构建或测试时，Go 会自动下载所需依赖。无需准备同级目录中的本地 `ofd` 项目。

## 开发运行

在项目根目录执行：

```bash
go run github.com/wailsapp/wails/v2/cmd/wails@v2.15.0 dev
```

前端开发服务器使用：

```bash
node frontend/dev-server.mjs
```

默认地址为：

```text
http://127.0.0.1:5173
```

浏览器预览模式主要用于界面调试。完整的本地 OFD 文件选择、原生保存和打印能力需要在 Wails 应用中运行。

## 构建

只构建当前平台的 Wails 应用，不生成安装包：

```bash
go run github.com/wailsapp/wails/v2/cmd/wails@v2.15.0 build -nopackage -nocolour -v 0
```

构建结果默认位于：

```text
build/bin/ofd-viewer
```

手动构建前端资源：

```bash
node frontend/build.mjs
```

Wails 会将 `frontend/dist` 通过 `main.go` 中的 `embed.FS` 嵌入应用。修改 `frontend/src` 后，需要重新执行前端构建，确保 `frontend/dist` 与源码同步。

## 测试和检查

运行 Go 测试：

```bash
go test ./... -count=1
```

运行竞态检测：

```bash
go test -race ./... -count=1
```

运行静态检查：

```bash
go vet ./...
```

检查前端 JavaScript：

```bash
node --check frontend/src/main.js
node --check frontend/build.mjs
node --check frontend/dev-server.mjs
```

检查源码和构建资源是否同步：

```bash
cmp frontend/src/index.html frontend/dist/index.html
cmp frontend/src/main.js frontend/dist/main.js
cmp frontend/src/app.css frontend/dist/app.css
cmp frontend/src/fonts/material-symbols-rounded.woff2 frontend/dist/fonts/material-symbols-rounded.woff2
```

检查补丁格式：

```bash
git diff --check
```

## 文件关联

Wails 配置在 `wails.json` 中声明 `.ofd` 文件关联：

```json
"fileAssociations": [
  {
    "ext": "ofd",
    "name": "OFD",
    "description": "OFD document",
    "iconName": "appicon",
    "role": "Viewer"
  }
]
```

应用图标入口为：

```text
build/appicon.png
```

替换图标后重新执行 Wails 构建即可生成对应平台的图标资源。`build/appicon.svg` 是可编辑的矢量候选图标，不会自动参与当前构建。

## 使用说明

- 使用顶部“打开”按钮选择 OFD 文件，或将 `.ofd` 文件拖入阅读区域。
- 使用工具栏左右箭头翻页，也可以在页码框中输入页码。
- 使用加减按钮调整缩放；按住 `Ctrl` 或 `Cmd` 滚动鼠标滚轮也可以缩放。
- 在设置中切换单页、双页、文字层、深色背景和全屏阅读。
- 点击搜索图标输入关键词，使用上下箭头切换搜索结果。
- 点击下载图标保存当前页 PNG。
- 点击打印图标打印当前页。
- 设置中的“复制本页文字”和“复制全文”依赖 OFD 文档中的文字对象。

## 数据和隐私

- OFD 文件在本机读取和解析。
- 渲染服务只监听 `127.0.0.1` 的随机端口。
- 页面 PNG、文字缓存和搜索结果保存在当前应用进程内存中。
- 最近打开文件列表和阅读设置保存在浏览器 WebView 的本地存储中。
- Material Symbols Rounded 字体已存放在 `frontend/src/fonts/`，运行时不需要访问 Google Fonts。

## 限制

- 当前仅支持 OFD 文件，不提供 PDF 或其他格式的打开入口。
- 单页/双页布局属于阅读布局，不会修改原始 OFD 文件。
- 文字层是否可见取决于文档是否包含可提取的文字对象。
- 极大尺寸页面或极多页文档会受到系统内存、WebView 和渲染耗时影响。
- 应用默认限制 OFD 文件大小为 `256 MB`。

## 许可证

本项目当前许可证信息以仓库中的许可证文件和源代码声明为准。
