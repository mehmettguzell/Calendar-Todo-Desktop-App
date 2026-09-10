# Tempo — Context

Tempo is a local-first calendar and task manager (Tauri + React + TypeScript),
with a budget ledger over the same document. It targets **desktop and, later,
mobile**. The app is fully usable offline; Supabase is a replica that catches up.

## Glossary

Use these terms exactly in issues, tests, ADRs, and code. Don't drift to synonyms.

- **Task** — the single source of truth. A calendar event and a to-do are two
  *views* of one `Task` record, never two record types.
- **Occurrence** — the per-day state of a recurring Task (e.g. Monday's run is
  done). A recurring Task is one row; the Occurrence carries what that row can't.
- **Reminder** — a pending/fired/dismissed alert attached to a Task; keeps
  firing after the window closes.
- **Soft delete** — `is_deleted = true`. An ordinary field change; syncs and
  resolves like any other edit.
- **Purge** — the row is physically gone. Leaves a **tombstone**, which always
  wins over any live row so deleted items can't reappear.
- **Sync** — row-level reconciliation. The unit of conflict is one row; fields
  are never merged. Winner is the greater `updated_at`; **ties go to the cloud**
  (same tie-break on every device → convergence).
- **Fingerprint** — a stable digest of exactly the fields sync writes to the
  cloud. Equal fingerprints ⇒ identical for sync purposes ⇒ no write.
- **Watermark** — how far the last successful pull got, per table. Incremental
  reads are a saving, not a source of truth; a periodic full pass backs them up.
- **Namespace** — the storage boundary for one account. Switching accounts
  creates a new repository rather than filtering a shared one.
- **Minor units** — money is stored as an integer in kuruş/cents
  (`amount_minor`), never a float.
- **Wishlist** — intended purchases. Not money: never in any total until the
  user says they bought it, which creates a **Transaction**.
- **Statement batch** — a group of transactions imported together from a bank
  statement, recoverable as a unit.

## Engineering standards

Standing rules for this repo. They override default habits. Decision record:
[`docs/adr/0001-client-side-layering.md`](docs/adr/0001-client-side-layering.md).

1. **Backend = Supabase, local-first.** No custom server. Supabase is Postgres +
   Auth + RLS + PostgREST (+ Edge Functions only where server-side logic is
   unavoidable). The app works offline; the cloud is a catching-up replica.
2. **Clean Code, frontend and backend.** Meaningful names, one responsibility per
   unit, a pure core with side effects at the edges.
3. **Clear architectural separation, applied client-side:**

   | Layer | Directory | Role |
   | --- | --- | --- |
   | Entity + business rules | `src/domain/` | pure, no I/O |
   | DTO + mappers | `src/data/dto/` | Supabase row types, `to*Row`/`from*Row` |
   | Repository / gateway | `src/data/` , `src/data/supabase/` | persistence access |
   | Sync services | `src/sync/` | reconciliation, queue, pull, realtime |
   | Use-cases | `src/services/` | application operations |
   | State | `src/state/` | thin Zustand stores (UI state, delegate out) |
   | Controller-equivalent | `src/ui/` hooks/handlers | translate user intent |

   Dependencies point one way. `src/sync/` never imports a store — it talks
   through **ports** (`LocalDocumentPort`, `AuthPort`, `StatusPort`).

4. **Files short and single-purpose.** Target ≤ 200 lines, hard cap 400, one
   export / one responsibility per file. Exempt: test files, `src/lib/i18n.ts`.
5. **Methods short, names clear, no pass-through-only layers.** Target ≤ 30
   lines, cap ~50. Don't create a function whose only job is to call one other
   function — over-splitting is also complexity.

Enforced by ESLint (`max-lines` 400, `max-lines-per-function` 50, `complexity`):
**error** under `src/sync/` and the rebuilt `src/data/` layers (`dto/`,
`supabase/`), **warn** elsewhere. Existing files (`src/data/db.ts`, the views,
`store.ts`) graduate to **error** when their own refactor pass lands. Run
`make lint`.

### How refactors proceed

One long file at a time, in passes, behavior-preserving, existing tests stay
green. Wait for the repo owner to evaluate a pass before starting the next.
Known long files awaiting a pass: `state/store.ts`, `domain/money.ts`,
`domain/statement.ts`, `domain/merchant.ts`, `ui/views/PlansView.tsx`,
`ui/task/TaskPanel.tsx`.
