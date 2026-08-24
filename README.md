# Tempo — Desktop Calendar & Task Manager

A Tauri v2 + React + TypeScript desktop app built to the specification in
[claude.md](claude.md). Calendar and Todo are two views of one `Task` record,
never two record types.

Also in the box: multi-day tasks, natural-language capture, a command palette,
reminders that keep firing after you close the window, one-step undo,
cross-device sync that survives being offline, and a budget ledger over the same
document. Why each of those exists — and what was deliberately left out — is in
[MARKET-GAPS.md](MARKET-GAPS.md); the calls behind the tricky ones are in
[DECISIONS.md](DECISIONS.md).

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

**Reminders are not showing up.** **Settings → Notifications → Send a test
notification** takes the exact path a reminder takes and reports what the OS
said, which separates the app's half of the problem from the system's. Two
things are worth knowing before hunting further:

- Reminders fire only while Tempo is running. There is no background service,
  so a reminder whose moment passes with the app closed is delivered the next
  time it starts, not before.
- A reminder is a separate thing from a due date. New tasks get one by default
  (the switch at the bottom of the New task dialog), but a task created with the
  switch off has a date and no reminder, and will never announce itself.

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
src-tauri/    Rust host: window, notifications, per-account data files
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
| Command palette | the same task list, filtered by the query          |

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

That rule binds the app, not the user: **Activity → Clear activity** erases the
trail on request, and **Trash → Empty trash** purges every deleted task at once.
What the rule forbids is the app dropping an entry as a *side effect* of
something else.

### Persistence

Your tasks live in a single readable file:

```
%USERPROFILE%\Documents\calendar\calendar-data.json
```

It is plain JSON, so it can be backed up, version-controlled or synced like any
other document. The exact path is shown in **Settings → Data file**, and
**Settings → Reset** empties it back to a fresh install.

The file I/O is a Rust command (`save_database`) rather than the fs plugin, so
the location is fixed by the app instead of by a permission scope, and writes
are atomic: the new contents go to `calendar-data.json.tmp` and are then renamed
over the target, so a crash mid-write cannot truncate your task list.

Both adapters sit behind a two-method `Repository` port and are written
debounced, so the UI never waits on disk. The browser build swaps in a
`localStorage` adapter. Moving to SQLite later means one new adapter and one
changed line in `createRepository.ts`.

### Sync

One local document per account, and one stated rule for what happens when two
devices moved the same row: **row-level last-write-wins on `updated_at`, ties to
the cloud**, purges recorded as tombstones that always win. Local writes are the
commit; the cloud is a replica that catches up, so being offline never blocks an
edit and never signs anyone out. See [DECISIONS.md](DECISIONS.md) §11–§14.

To enable it, run [supabase/schema.sql](supabase/schema.sql) in the Supabase SQL
editor. It is re-runnable, so running it again after an update is how new tables
and columns arrive. A project that has not run the latest version keeps working
— the engine notices a missing table and syncs everything else rather than
failing the whole pass.

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env`. Without them the
app runs fully locally with sync switched off.

**Password reset** uses the six-digit code from the recovery e-mail, because a
browser cannot hand a session back to a desktop window. For it to work, add
`{{ .Token }}` to the Supabase **Reset Password** e-mail template (Authentication
→ Email Templates) — the default template only contains the link.

### It keeps running after you close it

Closing the window hides Tempo to the system tray rather than quitting it, so a
reminder set this morning still arrives this evening. The tray menu opens it,
captures a task, or quits for real. Settings can also start it with Windows.

`Ctrl + Shift + Space` captures a task **from anywhere**, even when the window is
closed — the natural-language parser is what makes that one keystroke and one
line rather than a form.

The reminder clock is driven by a native thread rather than a browser timer:
WebView2 throttles timers in a hidden window, which is exactly when accuracy
matters. See [DECISIONS.md](DECISIONS.md) §17.

### Undo

`Ctrl/Cmd + Z`, or the toast that appears for eight seconds, takes back the last
delete, completion, roll-over or budget change. One step deep, deliberately —
[DECISIONS.md](DECISIONS.md) §18.

### Export

Settings → Export writes the whole document as JSON, the calendar as `.ics`, and
tasks or the budget ledger as CSV. No account and no connection needed.

### Budget

`domain/money.ts` holds income, expense and investment over the same store.
Amounts are integer minor units (kuruş/cents) and never floats, because a
monthly total that is a few kuruş out is a budget nobody trusts twice.
Categories start as a seeded set and grow from whatever the user types, and each
can carry a monthly ceiling that warns at 80% and flags going over.

An entry can repeat — rent, salary, insurance. The rule makes it a template, and
the entries it owes are produced as real, editable rows when the budget is
opened, catching up on however long the app was closed. February's rent being
different is then a one-field edit rather than a special case.

## Testing

- `src/domain/__tests__/` — status derivation, snooze semantics, recurrence
  expansion, including the spec's worked example (Aug 25 14:00 → Aug 26 14:00).
- `src/domain/__tests__/reminders.test.ts` — when a reminder comes due, and
  when it stays quiet: before its offset, after delivery, once completed.
- `src/test/singleSourceOfTruth.test.tsx` — mounts the real app and asserts
  §3: one task appears in Today and the calendar, completing it anywhere
  completes it everywhere, and rescheduling records history.
- `src/test/destructiveActions.test.ts` — that emptying the trash, clearing the
  activity trail and resetting each stop exactly where they are meant to.
- `src/domain/__tests__/multiDay.test.ts` — a task with an end date lands on
  every day it covers, as one row, and is not painted overdue mid-run.
- `src/domain/__tests__/naturalLanguage.test.ts` — what the quick-add parser
  understands in Turkish and English, and what it refuses to guess at.
- `src/domain/__tests__/notification.test.ts` — what a reminder banner says, and
  every case where it must stay silent.
- `src/domain/__tests__/money.test.ts` — amount parsing in both decimal
  conventions, period windows, and totals that never lose a kuruş.
- `src/test/rollOver.test.ts` — moving yesterday's unfinished work forward, and
  everything it must refuse to move.
- `src/test/undo.test.ts` — that each reversal restores exactly the prior state,
  through the ordinary store action, one step deep.
- `src/test/syncMerge.test.ts` — the conflict rule itself: newer wins, ties go to
  the cloud, tombstones are never overruled.
- `src/test/accountIsolation.test.ts` — that a second account on the same machine
  cannot see the first one's work.
- `src/domain/__tests__/budgetRecurring.test.ts` — repeating entries are
  idempotent, resume where they stopped, and never run ahead of today.
- `src/domain/__tests__/export.test.ts` — valid iCalendar, and CSV that cannot
  smuggle a formula into someone else's spreadsheet.

## Moving work around the calendar

Right-click anything on the calendar. A task offers copy, cut, duplicate, copy
to tomorrow, complete and trash; empty space offers paste and a new task. Drag a
task to another day to move it, or hold `Ctrl` while dropping to leave the
original where it is. Every move and every copy can be taken back with a single
`Ctrl/Cmd+Z`.

A repeating task is laid out by its rule, so it cannot be dragged or cut — one
occurrence cannot move without dragging the rest of the series with it. Copying
it still works, and produces a plain one-off task on the day you drop it.

### The same task on more than one day

Open a task and use **Bu hafta ayrıca / Also this week**: seven chips, one per
day of that task's week. Ticking Thursday does not copy anything — the task
starts occurring on Thursday too, as one record, and each day is completed on its
own. Unticking them hands back exactly the single-day task you started with.

Copying is the other answer, for when you want *another* task like this one: a
new row, starting fresh, with its subtasks and none of the original's history.

## Bringing a bank statement in

Budget → **Ekstre yükle / Import statement**. Drop the CSV or `.xls` your bank
gives you, or paste the text straight out of a PDF statement. Nothing is written
until you have seen the preview.

The importer works out the column layout itself, reads Turkish amounts
(`1.234,56`), and recognises the shop behind the descriptor — so twelve spellings
of `MIGROS TIC.A.S.-5M ATAŞEHİR İSTANBUL TR` become one merchant called Migros,
already filed under Market. Rows it cannot read are listed with a reason rather
than dropped.

Two things it does on your behalf, because getting them wrong is expensive:

- **The card payment is not spending.** It arrives unticked — importing it would
  count every purchase it settled a second time.
- **A refund is negative spending.** It is subtracted from that shop's total
  rather than counted as income.

Re-importing the same month, or a statement that overlaps one you already loaded,
adds nothing: every row carries a fingerprint, and the ones already in the ledger
show up marked "zaten var".

### Where the money went

Under the same view, spending breaks down by category **and by shop inside it**:

```
🛒 Market            ₺2.662,40   %31
   Migros            ₺1.820,10   2 kez   ort. ₺970,05   −₺120,00 iade
   CarrefourSA         ₺842,30   1 kez   ort. ₺842,30
```

The search box answers the other question — "just Migros", across every category
it appears in — and each category carries its change against the previous month,
so a month that came out level cannot hide a category that doubled.

## Keyboard

`Ctrl/Cmd+K` command palette · `n` new task · `t` jump to today · `Esc` close ·
`Ctrl/Cmd+C` copy the open task · `Ctrl/Cmd+X` cut it · `Ctrl/Cmd+V` paste it on
the day you last clicked

### Quick add understands plain language

Type it the way you would say it — Turkish and English, mixed freely:

```
yarın 14:00-16:00 proje sunumu hazırla #iş !1 @ofis ~90dk
every monday standup at 9am #work
25 Ağustos Berlin konferansı
```

`#` category · `@` tag · `!1`–`!4` or `!yüksek` priority · `~90dk` estimate ·
`her salı` / `every week` recurrence. Whatever it understood is shown as chips
before the task is created, and anything it does not understand is simply left
in the title.
