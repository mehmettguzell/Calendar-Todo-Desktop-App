import { ANONYMOUS_NAMESPACE } from "./namespace";
import { createRepository } from "./createRepository";
import type { Repository } from "./repository";
import type { Database } from "./db";

// Where the local document is written and how often. The UI never waits on the
// disk: writes are coalesced behind a short debounce and flushed on the way out.

let repository: Repository | null = null;

/** Which namespace's file every later write goes to, or null before hydration. */
export function currentRepository(): Repository | null {
  return repository;
}

/** Point every later write at this namespace's file, and hand it back to load. */
export function openDocumentRepository(namespace: string): Repository {
  return adoptRepository(createRepository(namespace));
}

/** For the adoption path, which opens a candidate before deciding to keep it. */
export function adoptRepository(next: Repository): Repository {
  repository = next;
  return next;
}
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSave: { repo: Repository; db: Database } | null = null;

/**
 * How long writes are coalesced before touching the disk.
 *
 * The whole document is rewritten on every save, so a burst of edits — a drag
 * across ten rows, a plan template creating five subtasks — must cost one write
 * rather than ten. Anything longer than a keystroke gap is wasted latency;
 * anything much longer risks losing more work to a crash.
 */
const SAVE_DEBOUNCE_MS = 400;

/** Debounced write-behind: the UI never waits on the disk. */
export function persist(db: Database) {
  if (!repository) return;
  pendingSave = { repo: repository, db };
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void flushPersist();
  }, SAVE_DEBOUNCE_MS);
}

/**
 * Write anything still queued, right now.
 *
 * Called when the window is hidden or closing: a debounced write that never
 * fires is indistinguishable, to the user, from an edit that never happened.
 */
export async function flushPersist(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const queued = pendingSave;
  pendingSave = null;
  if (!queued) return;
  await queued.repo
    .save(queued.db)
    .catch((error) => console.error("[tempo] save failed", error));
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushPersist();
  });
}
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => void flushPersist());
}

/** The namespace every cloud write and local save is currently bound to. */
export function currentNamespace(): string {
  return repository?.namespace ?? ANONYMOUS_NAMESPACE;
}

/**
 * Write immediately, cancelling any pending debounced write.
 *
 * Used by destructive actions: after "reset everything" the file on disk must
 * already be empty, because the next thing the user does may well be to close
 * the app — and a queued write holding the *old* document would then land on
 * top of the reset, or never land at all.
 */
export async function persistNow(db: Database): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  pendingSave = null;
  if (!repository) return;
  await repository.save(db);
}

