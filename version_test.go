package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestVersionMatchesMakefile 守住版本号的单一来源约定。
//
// Makefile 的 VERSION 与 version.go 的 Version 是同一个版本号的两份文本：Makefile
// 构建时注入前者，go build / wails dev 未经 Makefile 时用后者。wails.json 的
// info.productVersion 也记了一份，但它只影响 Windows 文件属性，无法从 Makefile
// 引用，因此由人工同步。
func TestVersionMatchesMakefile(t *testing.T) {
	makefile, err := findMakefile()
	if err != nil {
		t.Fatalf("定位 Makefile 失败: %v", err)
	}
	raw, err := os.ReadFile(makefile)
	if err != nil {
		t.Fatalf("读取 Makefile 失败: %v", err)
	}
	const prefix = "VERSION ?= "
	var declared string
	for _, line := range strings.Split(string(raw), "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, prefix) {
			declared = strings.TrimSpace(strings.TrimPrefix(trimmed, prefix))
			break
		}
	}
	if declared == "" {
		t.Fatal("Makefile 里找不到 VERSION ?= 赋值")
	}
	if declared != Version {
		t.Errorf("版本号不一致：Makefile VERSION=%s，version.go Version=%s；改动时两处都要更新",
			declared, Version)
	}
}

// TestVersionHasNoVPrefix 裸版本号不带 v 前缀。
//
// 关于对话框自己补 `v`；写成 "v0.0.4" 会让关于对话框出现 "vv0.0.4"。
func TestVersionHasNoVPrefix(t *testing.T) {
	if strings.HasPrefix(Version, "v") {
		t.Errorf("Version = %q，不应带 v 前缀", Version)
	}
	if strings.TrimSpace(Version) != Version || Version == "" {
		t.Errorf("Version = %q，应为不含空白的非空版本号", Version)
	}
}

// TestMakefileInjectsVersion 确认 Makefile 真的把 VERSION 传进了 ldflags。
//
// 只声明 VERSION 却忘了接到 wails build 上时，构建能过、版本号却永远是兜底值，
// 关于对话框会一直显示旧版本；这条测试盯的是 ldflags 而不是 VERSION 本身。
func TestMakefileInjectsVersion(t *testing.T) {
	makefile, err := findMakefile()
	if err != nil {
		t.Fatalf("定位 Makefile 失败: %v", err)
	}
	raw, err := os.ReadFile(makefile)
	if err != nil {
		t.Fatalf("读取 Makefile 失败: %v", err)
	}
	if !strings.Contains(string(raw), "-X main.Version=$(VERSION)") {
		t.Error("Makefile 里找不到 -X main.Version=$(VERSION)；版本号不会被注入，关于对话框会一直显示兜底值")
	}
}

// findMakefile 向上查找 Makefile，不写死相对层数：测试文件一旦搬家，
// 写死 "../Makefile" 的测试会以"文件不存在"失败，而那与版本号无关。
func findMakefile() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		candidate := filepath.Join(dir, "Makefile")
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", os.ErrNotExist
		}
		dir = parent
	}
}