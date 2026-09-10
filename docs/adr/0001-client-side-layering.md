# ADR-0001 — Client-side layering, no custom backend

- Status: accepted
- Date: 2026-09-10

## Context

The repo owner asked for a solid architecture following Clean Code, with clear
`controller / service / entity / dto / repository` separation, and flagged two
files as unmaintainable: `state/syncEngine.ts` (3569 lines) and
`state/store.ts` (2939 lines).

`controller/service/repository` is a server-side pattern. Tempo has no server:
it is a local-first Tauri + React app that stores the whole document locally
(file on desktop, `localStorage` in the browser) and uses Supabase as a sync
replica. Offline-first sync is the product's core value.

Two ways to honour the request:

1. **Keep local-first.** No custom server. Supabase stays Postgres + Auth + RLS
   + PostgREST. Apply the layering *client-side*.
2. **Add a backend server** (e.g. NestJS) between the apps and Supabase; desktop
   and mobile become thin clients.

## Decision

Take option 1.

- No custom backend server is added. Supabase is the backend; Edge Functions
  cover the rare server-side-only logic.
- The `controller / service / entity / dto / repository` separation is applied
  **client-side**, per the table in `CONTEXT.md` § Engineering standards.
- `state/syncEngine.ts` is dissolved into `src/sync/`. As built: `account`,
  `queue`, `writeFlush`, `cloudWrites`, `cloudRequest`, `collectionSpecs`,
  `writePlan`, `flushSchedule`, `reconcile`, `cloudSnapshot`, `differences`,
  `mergeCategories`, `mergeTasks`, `mergeTrail`, `pullCursor`, `watermark`,
  `realtime`, `realtimeApply`, `remoteEcho`, `remoteApply`, `retry`,
  `connectivity`, `schemaCapability`, `skippedRows`, `profile`, `syncedState`,
  `storeBridge`, `lifecycle`, `index`.
- Shared mutable sync state stays module-level, but each piece is owned by one
  module (`queue`, `syncedState`, `pullCursor`, `retry`, `realtime`) rather
  than pooled in one file. No `SyncEngine` class, and no `SyncContext` object:
  a context threaded through thirty call sites would have been ceremony, not
  clarity.
- Cloud rows get explicit DTO types (`src/data/dto/`) with `to*Row` / `from*Row`
  mappers; fingerprints and the write plan consume the mappers instead of
  hand-ordering fields.
- Import paths change from `@/state/syncEngine` to `@/sync` with no
  compatibility shim; tests are updated in the same pass.

### Not done yet: the port boundary

`src/sync/` still imports the Zustand stores directly (`useStore`,
`useAuthStore`, `useSyncStore`). Only `retry`, `connectivity` and `realtime`
take injected dependencies. `LocalDocumentPort` / `AuthPort` / `StatusPort`
remain the intended end state; inverting the remaining call sites is its own
pass, tracked separately from this split.

## Consequences

- Offline-first behaviour is preserved; no rewrite of the sync engine's logic.
- The refactor is behaviour-preserving and gated on the existing test suite
  staying green (`npm test`, `npm run typecheck`, `npm run lint`).
- ESLint is introduced with `max-lines` / `max-lines-per-function` / `complexity`
  (error under `sync/` and `data/`, warn elsewhere).
- `state/store.ts` and other long files are handled in later passes, each
  evaluated by the repo owner before the next begins.
- If server-side-only needs grow (heavy aggregation, third-party webhooks,
  secrets that can't reach a client), revisit with a follow-up ADR for Edge
  Functions or a small service — not a wholesale thin-client migration.
