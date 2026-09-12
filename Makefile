SHELL := /bin/sh

APP      := ofd-viewer
VERSION  ?= 0.0.3
WAILS    ?= wails
DIST     := dist
BIN      := build/bin
LINUX    := $(BIN)/$(APP)
LINUX_ARM64 := $(BIN)/$(APP)-arm64
WINDOWS  := $(BIN)/$(APP).exe
WINDOWS_INSTALLER := $(BIN)/$(APP)-amd64-installer.exe
WINDOWS_BUILD_STAMP := $(BIN)/.$(APP)-windows-amd64-built
WINDOWS_INSTALLER_STAMP := $(BIN)/.$(APP)-windows-amd64-installer-built
WINDOWS_ARM64 := $(BIN)/$(APP)-arm64.exe
WINDOWS_ARM64_INSTALLER := $(BIN)/$(APP)-arm64-installer.exe
WINDOWS_ARM64_BUILD_STAMP := $(BIN)/.$(APP)-windows-arm64-built
WINDOWS_ARM64_INSTALLER_STAMP := $(BIN)/.$(APP)-windows-arm64-installer-built
WINDOWS_ARM64_CC ?= $(if $(filter undefined default,$(origin CC)),aarch64-w64-mingw32-clang,$(CC))
WINDOWS_ARM64_CXX ?= $(if $(filter undefined default,$(origin CXX)),aarch64-w64-mingw32-clang++,$(CXX))
LINUX_ARM64_BUILD_STAMP := $(BIN)/.$(APP)-linux-arm64-built
LINUX_ARM64_CC ?= $(if $(filter undefined default,$(origin CC)),aarch64-linux-gnu-gcc,$(CC))
LINUX_ARM64_CXX ?= $(if $(filter undefined default,$(origin CXX)),aarch64-linux-gnu-g++,$(CXX))
LINUX_PKG   := $(DIST)/$(APP)-linux-amd64
LINUX_ARM64_PKG := $(DIST)/$(APP)-linux-arm64
WINDOWS_PKG := $(DIST)/$(APP)-windows-amd64
WINDOWS_INSTALLER_PKG := $(DIST)/$(APP)-windows-amd64-installer
WINDOWS_ARM64_PKG := $(DIST)/$(APP)-windows-arm64
WINDOWS_ARM64_INSTALLER_PKG := $(DIST)/$(APP)-windows-arm64-installer

.PHONY: all build build-linux build-linux-arm64 build-windows build-windows-arm64 build-windows-installer build-windows-arm64-installer package package-linux package-linux-arm64 package-windows package-windows-arm64 package-windows-installer package-windows-arm64-installer clean test help FORCE

all: package

build: build-linux build-windows build-windows-arm64

build-linux:
	$(WAILS) build --platform linux/amd64 --tags webkit2_41 -m -nopackage

build-linux-arm64:
	$(MAKE) $(LINUX_ARM64_BUILD_STAMP)

$(LINUX_ARM64_BUILD_STAMP): FORCE
	CC="$(LINUX_ARM64_CC)" CXX="$(LINUX_ARM64_CXX)" $(WAILS) build --platform linux/arm64 -o "$(notdir $(LINUX_ARM64))" --tags webkit2_41 -m -nopackage
	@test -f "$(LINUX_ARM64)" || (printf 'Linux ARM64 executable was not created. Check the cross compiler and target libraries and try again.\n' >&2; exit 1)
	@touch "$@"

build-windows:
	$(MAKE) $(WINDOWS_BUILD_STAMP)

$(WINDOWS_BUILD_STAMP): FORCE
	$(WAILS) build --platform windows/amd64 -m -nopackage
	@touch "$@"

build-windows-arm64:
	$(MAKE) $(WINDOWS_ARM64_BUILD_STAMP)

$(WINDOWS_ARM64_BUILD_STAMP): FORCE
	CC="$(WINDOWS_ARM64_CC)" CXX="$(WINDOWS_ARM64_CXX)" $(WAILS) build --platform windows/arm64 -o "$(notdir $(WINDOWS_ARM64))" -m -nopackage
	@test -f "$(WINDOWS_ARM64)" || (printf 'Windows ARM64 executable was not created. Check the cross compiler and try again.\n' >&2; exit 1)
	@touch "$@"

build-windows-installer:
	$(MAKE) $(WINDOWS_INSTALLER_STAMP)

$(WINDOWS_INSTALLER_STAMP): FORCE
	@rm -f "$(WINDOWS_INSTALLER)"
	$(WAILS) build --platform windows/amd64 --nsis -m
	@test -f "$(WINDOWS_INSTALLER)" || (printf 'Windows installer was not created. Install NSIS (makensis) and try again.\n' >&2; exit 1)
	@touch "$@"

build-windows-arm64-installer:
	$(MAKE) $(WINDOWS_ARM64_INSTALLER_STAMP)

$(WINDOWS_ARM64_INSTALLER_STAMP): FORCE
	@rm -f "$(WINDOWS_ARM64_INSTALLER)"
	CC="$(WINDOWS_ARM64_CC)" CXX="$(WINDOWS_ARM64_CXX)" $(WAILS) build --platform windows/arm64 -o "$(notdir $(WINDOWS_ARM64))" --nsis -m
	@test -f "$(WINDOWS_ARM64_INSTALLER)" || (printf 'Windows ARM64 installer was not created. Install NSIS (makensis) and try again.\n' >&2; exit 1)
	@touch "$@"

package: package-linux package-windows package-windows-arm64 package-windows-installer package-windows-arm64-installer

package-linux: build-linux
	@rm -rf "$(LINUX_PKG)" "$(LINUX_PKG).zip"
	@mkdir -p "$(LINUX_PKG)"
	@cp "$(LINUX)" "$(LINUX_PKG)/$(APP)"
	@cp README.md "$(LINUX_PKG)/README.md"
	@cd "$(DIST)" && zip -qr "$(APP)-linux-amd64.zip" "$(APP)-linux-amd64"
	@printf 'Created %s\n' "$(DIST)/$(APP)-linux-amd64.zip"

package-linux-arm64: build-linux-arm64
	@rm -rf "$(LINUX_ARM64_PKG)" "$(LINUX_ARM64_PKG).zip"
	@mkdir -p "$(LINUX_ARM64_PKG)"
	@cp "$(LINUX_ARM64)" "$(LINUX_ARM64_PKG)/$(APP)"
	@cp README.md "$(LINUX_ARM64_PKG)/README.md"
	@cd "$(DIST)" && zip -qr "$(APP)-linux-arm64.zip" "$(APP)-linux-arm64"
	@printf 'Created %s\n' "$(DIST)/$(APP)-linux-arm64.zip"

package-windows: build-windows-installer
	@rm -rf "$(WINDOWS_PKG)" "$(WINDOWS_PKG).zip"
	@mkdir -p "$(WINDOWS_PKG)"
	@cp "$(WINDOWS)" "$(WINDOWS_PKG)/$(APP).exe"
	@cp README.md "$(WINDOWS_PKG)/README.md"
	@cd "$(DIST)" && zip -qr "$(APP)-windows-amd64.zip" "$(APP)-windows-amd64"
	@printf 'Created %s\n' "$(DIST)/$(APP)-windows-amd64.zip"

package-windows-arm64: build-windows-arm64
	@rm -rf "$(WINDOWS_ARM64_PKG)" "$(WINDOWS_ARM64_PKG).zip"
	@mkdir -p "$(WINDOWS_ARM64_PKG)"
	@cp "$(WINDOWS_ARM64)" "$(WINDOWS_ARM64_PKG)/$(APP).exe"
	@cp README.md "$(WINDOWS_ARM64_PKG)/README.md"
	@cd "$(DIST)" && zip -qr "$(APP)-windows-arm64.zip" "$(APP)-windows-arm64"
	@printf 'Created %s\n' "$(DIST)/$(APP)-windows-arm64.zip"

package-windows-installer: build-windows-installer
	@rm -rf "$(WINDOWS_INSTALLER_PKG)" "$(WINDOWS_INSTALLER_PKG).zip"
	@mkdir -p "$(WINDOWS_INSTALLER_PKG)"
	@cp "$(WINDOWS_INSTALLER)" "$(WINDOWS_INSTALLER_PKG)/$(APP)-installer.exe"
	@cp README.md "$(WINDOWS_INSTALLER_PKG)/README.md"
	@cd "$(DIST)" && zip -qr "$(APP)-windows-amd64-installer.zip" "$(APP)-windows-amd64-installer"
	@printf 'Created %s\n' "$(DIST)/$(APP)-windows-amd64-installer.zip"

package-windows-arm64-installer: build-windows-arm64-installer
	@rm -rf "$(WINDOWS_ARM64_INSTALLER_PKG)" "$(WINDOWS_ARM64_INSTALLER_PKG).zip"
	@mkdir -p "$(WINDOWS_ARM64_INSTALLER_PKG)"
	@cp "$(WINDOWS_ARM64_INSTALLER)" "$(WINDOWS_ARM64_INSTALLER_PKG)/$(APP)-installer.exe"
	@cp README.md "$(WINDOWS_ARM64_INSTALLER_PKG)/README.md"
	@cd "$(DIST)" && zip -qr "$(APP)-windows-arm64-installer.zip" "$(APP)-windows-arm64-installer"
	@printf 'Created %s\n' "$(DIST)/$(APP)-windows-arm64-installer.zip"

test:
	go test ./...
	go vet ./...

clean:
	rm -rf "$(DIST)"
	rm -f "$(WINDOWS_BUILD_STAMP)" "$(WINDOWS_INSTALLER_STAMP)" "$(LINUX_ARM64_BUILD_STAMP)" "$(WINDOWS_ARM64_BUILD_STAMP)" "$(WINDOWS_ARM64_INSTALLER_STAMP)"

FORCE:

help:
	@printf '%s\n' \
	  'make build            Build Linux and Windows amd64/ARM64 executables' \
	  'make build-linux      Build Linux amd64 executable' \
	  'make build-linux-arm64  Build Linux ARM64 executable' \
	  'make build-windows    Build Windows amd64 executable' \
	  'make build-windows-arm64  Build Windows ARM64 executable' \
	  'make build-windows-installer  Build Windows NSIS installer' \
	  'make build-windows-arm64-installer  Build Windows ARM64 NSIS installer' \
	  'make package          Build all platforms/architectures, installers, and ZIP files' \
	  'make package-linux    Create the Linux ZIP package' \
	  'make package-linux-arm64  Create the Linux ARM64 ZIP package' \
	  'make package-windows  Create the Windows ZIP package' \
	  'make package-windows-arm64  Create the Windows ARM64 ZIP package' \
	  'make package-windows-installer  Create the Windows installer ZIP package' \
	  'make package-windows-arm64-installer  Create the Windows ARM64 installer ZIP package' \
	  'make test             Run Go tests and vet' \
	  'make clean            Remove generated ZIP packages' \
	  'WAILS=/path/to/wails make package' \
	  'CC=... CXX=... make build-windows-arm64' \
	  'CC=... CXX=... make build-linux-arm64'
