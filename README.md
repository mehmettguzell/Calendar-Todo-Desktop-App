# Tempo — Desktop Calendar & Task Manager

A Tauri v2 + React + TypeScript desktop app built to the specification in
[claude.md](claude.md). Calendar and Todo are two views of one `Task` record,
never two record types.

## Setup

### Prerequisites

| Tool | Needed for | Notes |
| --- | --- | --- |
| **Node.js 20+** | everything | ships with npm — `node -v` to check |
| **Rust 1.77.2+** | the desktop app | install via [rustup](https://rustup.rs) |
| **MSVC build tools + Windows SDK** | the desktop app | "Desktop development with C++" in the Visual Studio Installer |
| **WebView2** | running the desktop app | preinstalled on Windows 11; [download](https://developer.microsoft.com/microsoft-edge/webview2/) on older Windows |

Only Node.js is needed for `npm run dev`, the browser-only build. The Rust
toolchain is what turns it into a desktop app.

### Install

```bash
git clone <repo-url> Calendar-Todo-Desktop-App
cd Calendar-Todo-Desktop-App
npm install
```

The first `tauri dev` or `tauri build` also compiles every Rust dependency from
scratch — expect several minutes. Later builds reuse `src-tauri/target` and
take seconds.

### Everyday commands

Each one has a `make` shortcut (`make help` lists them) and a plain npm
equivalent; use whichever you prefer.

| make | npm | What it does |
| --- | --- | --- |
| `make run` | `npm run tauri:dev` | the desktop app with hot reload — the normal way to work |
| `make dev` | `npm run dev` | UI only, in a browser, no Rust, data in `localStorage` |
| `make test` | `npm test` | the test suite |
| `make check` | `npm run typecheck && npm test` | typecheck, then the tests |
| `make exe` | `npx tauri build --no-bundle` | the standalone `tempo.exe` |
| `make bundle` | `npm run tauri:build` | the exe plus the MSI and setup.exe installers |
| `make stop` | — | close a running Tempo window |
| `make clean` | — | drop `dist` and the Rust build cache |

`make exe` and `make bundle` close a running Tempo first: Windows locks a
running exe, so the build cannot overwrite it. Your tasks are saved
continuously, so closing the window loses nothing.

### Installing the built app

`make bundle` produces, under `src-tauri/target/release/`:

| Artifact | Use |
| --- | --- |
| `tempo.exe` | the standalone app — double-click, no install |
| `bundle/nsis/Tempo_0.1.0_x64-setup.exe` | installer (Start menu shortcut, uninstaller) |
| `bundle/msi/Tempo_0.1.0_x64_en-US.msi` | MSI, for managed or silent deployment |

Uninstalling removes the app but never your tasks — those live outside the
install directory, in `Documents\calendar` (see [Persistence](#persistence)).

### Troubleshooting

**`Port 1420 is already in use`.** The dev port is pinned and `strictPort` makes
Vite fail loudly instead of quietly moving to 1421, because Tauri loads
`http://localhost:1420` and nothing else. Usually a Vite process from an earlier
run — or from another copy of the project — is still holding it:

```powershell
Get-NetTCPConnection -LocalPort 1420 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

**`linker 'link.exe' not found`.** The MSVC build tools are missing. Install
"Desktop development with C++", then reopen the terminal so the new PATH is
picked up.

**The exe builds but the window is blank.** WebView2 is missing — install the
Evergreen runtime.

**`make` is not recognised.** Either install GNU Make (winget or Chocolatey
both carry it) or use the npm commands from the table above.

## Architecture

```
src/
  domain/     pure logic, no React, no I/O — the rules live here
  data/       persistence port + Tauri-store and localStorage adapters
  state/      the single zustand store, and read-side projections
  services/   desktop notifications, the reminder scheduler
  ui/         views and components, all reading the same projections
src-tauri/    Rust host: window, notification plugin, store plugin
```

The dependency direction is strictly one-way: `ui → state → domain`, with
`data` and `services` plugged in at the edges. Nothing in `domain/` imports
React, which is why the rules are directly testable.

### One task, many views

Every view calls the same projection functions in `state/selectors.ts`:

| View            | Projection                                        |
| --------------- | ------------------------------------------------- |
| Month/Week/Day  | `useInstancesInRange(from, to)`                   |
| Today           | `useInstancesInRange(today, today)` + urgency      |
| Tasks (Todo)    | `useTodoGroups()`                                 |
| Search          | the same projections, with a `query` filter        |
| Reminders       | `collectDueReminders()` over the same rows         |

None of them own data. Completing a task in the calendar and completing it in
the Todo list are the same call into the same store, so the two cannot drift.

### Derived status

`TODO`, `IN_PROGRESS` and `COMPLETED` are stored — they are user intent.
`OVERDUE` and `SNOOZED` are **derived on read** from the clock, because a
persisted `OVERDUE` would be wrong the moment the app is closed overnight.
`effectiveStatus()` resolves them with a deliberate precedence:

```
COMPLETED  >  SNOOZED  >  OVERDUE  >  stored status
```

A snoozed task therefore never reads as overdue, and never as completed
(spec §5.4).

### Recurrence

A repeating task is **one row**. Occurrences are computed from the rule on
read (`expandOccurrences`), so scrolling the calendar to 2030 creates nothing.
Only per-occurrence *situational* state — done, snoozed — is materialised, in
the `occurrences` table, keyed `taskId::YYYY-MM-DD`.

Consequence, applied consistently: **status is per-occurrence, content and
schedule are per-series.** Ticking off Monday's standup leaves Tuesday's alone;
changing the time changes it for the whole series.

### History

`history` is append-only. Nothing rewrites or removes an entry, so a
rescheduled task keeps every date it ever had (spec §5.5). Deleting is a soft
delete; even a permanent purge leaves the history rows behind.

### Persistence

Your tasks live in a single readable file:

```
%USERPROFILE%\Documents\calendar\calendar-data.json
```

It is plain JSON, so it can be backed up, version-controlled or synced like any
other document. The exact path is shown in **Settings → Data file**.

The file I/O is a Rust command (`save_database`) rather than the fs plugin, so
the location is fixed by the app instead of by a permission scope, and writes
are atomic: the new contents go to `calendar-data.json.tmp` and are then renamed
over the target, so a crash mid-write cannot truncate your task list.

Both adapters sit behind a two-method `Repository` port and are written
debounced, so the UI never waits on disk. The browser build swaps in a
`localStorage` adapter. Moving to SQLite later means one new adapter and one
changed line in `createRepository.ts`.

## Testing

- `src/domain/__tests__/` — status derivation, snooze semantics, recurrence
  expansion, including the spec's worked example (Aug 25 14:00 → Aug 26 14:00).
- `src/test/singleSourceOfTruth.test.tsx` — mounts the real app and asserts
  §3: one task appears in Today and the calendar, completing it anywhere
  completes it everywhere, and rescheduling records history.

## Keyboard

`n` new task · `t` jump to today · `Esc` close the detail panel
