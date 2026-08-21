# Tempo - build and run shortcuts.
#
# Requires Node.js and, for anything that produces an exe, the Rust toolchain
# plus the MSVC build tools and Windows SDK.

# Pin the shell. Without this, make picks cmd.exe or sh depending on what
# happens to be on PATH, and recipes that work in one fail in the other.
ifeq ($(OS),Windows_NT)
SHELL := cmd.exe
.SHELLFLAGS := /C
endif

.DEFAULT_GOAL := help
.PHONY: help run exe bundle dev test check install stop clean

RELEASE_EXE := src-tauri/target/release/tempo.exe

help:
	@echo Tempo - available targets:
	@echo make run - launch the app with hot reload, best while writing code
	@echo make exe - build the standalone release exe, closes a running Tempo first
	@echo make bundle - build the exe plus the MSI and setup.exe installers
	@echo make dev - run the UI in a browser only, no Rust needed
	@echo make test - run the test suite
	@echo make check - typecheck, then run the test suite
	@echo make install - install npm dependencies
	@echo make stop - close a running Tempo window
	@echo make clean - delete build output, the next build recompiles from scratch

# Hot reload: edits to src/ appear in the window without a rebuild.
run:
	npm run tauri:dev

# Windows locks a running exe, so the build cannot overwrite it. Your tasks are
# saved continuously to Documents/calendar, so closing the window loses nothing.
exe: stop
	npx tauri build --no-bundle
	@echo Built $(RELEASE_EXE)

bundle: stop
	npx tauri build

dev:
	npm run dev

test:
	npm test

check:
	npm run typecheck
	npm test

install:
	npm install

# PowerShell rather than taskkill, so this behaves the same from cmd and bash.
stop:
	@powershell -NoProfile -Command "Get-Process tempo -ErrorAction SilentlyContinue | Stop-Process -Force; exit 0"

clean: stop
	@powershell -NoProfile -Command "Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue; exit 0"
	cargo clean --manifest-path src-tauri/Cargo.toml
