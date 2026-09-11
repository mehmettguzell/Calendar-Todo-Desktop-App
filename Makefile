# Tempo - build and run shortcuts. Works on Linux, macOS and Windows.
#
# Requires Node.js and, for anything that produces a binary, the Rust toolchain.
# Platform build tools: Linux needs webkit2gtk + libappindicator (see README),
# macOS needs the Xcode command line tools, Windows needs the MSVC build tools
# and the Windows SDK.

# Detect the platform and pin the shell. Without pinning, make picks cmd.exe or
# sh depending on what happens to be on PATH, and recipes that assume one break
# under the other.
ifeq ($(OS),Windows_NT)
  SHELL := cmd.exe
  .SHELLFLAGS := /C
  PLATFORM := windows
  RELEASE_BIN := src-tauri/target/release/tempo.exe
  # PowerShell rather than taskkill, so this behaves the same from cmd and bash.
  STOP_CMD := powershell -NoProfile -Command "Get-Process tempo -ErrorAction SilentlyContinue | Stop-Process -Force; exit 0"
  CLEAN_DIST := powershell -NoProfile -Command "Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue; exit 0"
else
  UNAME := $(shell uname -s)
  RELEASE_BIN := src-tauri/target/release/tempo
  CLEAN_DIST := rm -rf dist
  ifeq ($(UNAME),Darwin)
    PLATFORM := macos
    # `tauri dev` runs the `tempo` bin; a bundled build runs `Tempo.app` (Tempo).
    STOP_CMD := pkill -x tempo 2>/dev/null; pkill -x Tempo 2>/dev/null; true
  else
    PLATFORM := linux
    STOP_CMD := pkill -x tempo 2>/dev/null; true
  endif
endif

.DEFAULT_GOAL := help
.PHONY: help run exe bundle dev test lint check install stop clean

help:
	@echo Tempo - available targets - platform: $(PLATFORM)
	@echo make run     - launch the app with hot reload, best while writing code
	@echo make exe     - build the standalone release binary, closes a running Tempo first
	@echo make bundle  - build the binary plus the platform installers
	@echo make dev     - run the UI in a browser only, no Rust needed
	@echo make test    - run the test suite
	@echo make lint    - run ESLint (Clean Code size and complexity limits)
	@echo make check   - typecheck, lint, then run the test suite
	@echo make install - install npm dependencies
	@echo make stop    - close a running Tempo window
	@echo make clean   - delete build output, the next build recompiles from scratch

# Hot reload: edits to src/ appear in the window without a rebuild.
run:
	npm run tauri:dev

# A running binary is locked on Windows and can be awkward to overwrite
# elsewhere, so close it first. Tasks are saved continuously to Documents, so
# closing the window loses nothing.
exe: stop
	npx tauri build --no-bundle
	@echo Built $(RELEASE_BIN)

bundle: stop
	npx tauri build

dev:
	npm run dev

test:
	npm test

lint:
	npm run lint

check:
	npm run typecheck
	npm run lint
	npm test

install:
	npm install

stop:
	@$(STOP_CMD)

clean: stop
	@$(CLEAN_DIST)
	cargo clean --manifest-path src-tauri/Cargo.toml
