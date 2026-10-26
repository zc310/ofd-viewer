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
// 构建时传入 Wails 3 Taskfile，go build / wails3 dev 未经 Makefile 时使用后者。
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

// TestBuildTasksInjectVersion 确认 Makefile 传递 VERSION，且平台 Taskfile 会注入版本。
//
// 只声明 VERSION 却忘了传入 Taskfile 时，关于对话框会一直显示兜底值。
func TestBuildTasksInjectVersion(t *testing.T) {
	makefile, err := findMakefile()
	if err != nil {
		t.Fatalf("定位 Makefile 失败: %v", err)
	}
	raw, err := os.ReadFile(makefile)
	if err != nil {
		t.Fatalf("读取 Makefile 失败: %v", err)
	}
	if !strings.Contains(string(raw), `VERSION="$(VERSION)" $(WAILS3) task`) {
		t.Error("Makefile 没有把 VERSION 传给 Wails 3 Taskfile")
	}
	root := filepath.Dir(makefile)
	for _, name := range []string{"linux", "windows", "darwin"} {
		taskfile, err := os.ReadFile(filepath.Join(root, "build", "Taskfile."+name+".yml"))
		if err != nil {
			t.Fatalf("读取 %s Taskfile 失败: %v", name, err)
		}
		if !strings.Contains(string(taskfile), "-X main.Version={{.VERSION}}") {
			t.Errorf("%s Taskfile 没有注入版本号", name)
		}
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
