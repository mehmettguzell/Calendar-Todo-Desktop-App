import type { SyncFailureKind } from "@/lib/errors";
import type { Database } from "@/data/db";

export type SyncPhase =
  | "idle"
  | "syncing"
  | "offline"
  /** The last attempt failed; local edits are queued and will be retried. */
  | "error"
  /** Signed out, or Supabase is not configured. Purely local operation. */
  | "disabled";

/** One local row the cloud will not accept, named so the UI can say how many. */
export interface SkippedRow {
  table: string;
  id: string;
}

/**
 * What `src/sync/` is allowed to know about the rest of the app.
 *
 * The dependency runs one way: sync reports what it did and asks for what it
 * needs, and `wiring.ts` is the single place that says which store answers.
 * Without this the engine imports the UI's state directly, which makes the
 * "does the cloud have this row?" logic impossible to exercise without mounting
 * the app — and impossible to reuse from a second client.
 */

/** Where the engine says how it is getting on. */
export interface StatusPort {
  setPhase(phase: SyncPhase, failure?: SyncFailureKind | null): void;
  setPending(count: number): void;
  setRetry(attempt: number, paused: boolean): void;
  setRealtime(state: "connected" | "connecting" | "down"): void;
  /** A row left out of the push because the cloud would reject it. */
  noteSkipped(row: SkippedRow): void;
  clearSkipped(): void;
  markSynced(): void;
  currentPhase(): SyncPhase;
  /** True once the retry budget is spent and only a condition can revive it. */
  retryPaused(): boolean;
  realtimeState(): "connected" | "connecting" | "down";
  lastFailure(): SyncFailureKind | null;
  /** Pessimistic by design: unknown counts as online. */
  isOnline(): boolean;
}

/** Who the engine is syncing as. */
export interface AuthPort {
  currentUserId(): string | null;
  /** Enough to backfill a `profiles` row for an account that predates the trigger. */
  identity(): { email: string; fullName: string };
  /** Fires when the signed-in account changes, never for other auth traffic. */
  onAccountChange(handle: (userId: string | null) => void): void;
}

/** The local document, and the only ways the engine may touch it. */
export interface LocalDocumentPort {
  read(): Database;
  /**
   * Replace the document in memory. Deliberately does not write to disk: a pass
   * applies many rows and then calls `flush` once, rather than paying for a
   * whole-document write per row.
   */
  apply(next: (db: Database) => Database): void;
  /** Write whatever is in memory to disk now. */
  flush(): void;
  /** Fires on every local change, with the document before and after. */
  subscribe(handle: (next: Database, previous: Database) => void): void;
  /** Open the document belonging to `userId`, or the signed-out one for null. */
  switchAccount(userId: string | null): Promise<void>;
  /**
   * When the standing undo offer lapses, or null if none stands.
   *
   * An edit that can still be taken back is not settled, and settling is what
   * the flush is waiting for — writing it and then writing it away again costs
   * two round trips for a document that ends where it started.
   */
  undoOfferExpiresAt(): number | null;
}

export interface SyncPorts {
  status: StatusPort;
  auth: AuthPort;
  document: LocalDocumentPort;
}

let ports: SyncPorts | null = null;

/** Called once, from `wiring.ts`. Everything below reads what it installed. */
export function installPorts(next: SyncPorts): void {
  ports = next;
}

function installed(): SyncPorts {
  if (!ports) throw new Error("[tempo sync] ports used before installPorts()");
  return ports;
}

export const status = (): StatusPort => installed().status;
export const auth = (): AuthPort => installed().auth;
export const document = (): LocalDocumentPort => installed().document;
