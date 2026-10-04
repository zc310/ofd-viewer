package main

// Version 是发行版本号，也是本仓库唯一的版本号来源。
//
// 构建期由 Makefile 的 VERSION 注入：
//
//	-ldflags "-X main.Version=$(VERSION)"
//
// 未经 Makefile 构建时（go run、go test、wails dev）使用这个兜底值，因此它必须与
// Makefile 的 VERSION 保持一致——TestVersionMatchesMakefile 会守住这一点。
//
// Version 是裸版本号，不带 v 前缀；`v` 前缀属于展示层，由关于对话框补上。
var Version = "0.0.4"