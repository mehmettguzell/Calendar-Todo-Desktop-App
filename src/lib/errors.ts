/**
 * Safely extracts a readable string message from any error type,
 * including Supabase PostgrestError, AuthError, JavaScript Error, or plain strings/objects.
 */
export function formatErrorMessage(err: unknown): string {
  if (!err) return "Bilinmeyen bir hata oluştu.";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (typeof err === "object") return messageFromObject(err as Record<string, unknown>);
  return String(err);
}

/** The fields a thrown object might carry its message in, in order of trust. */
const MESSAGE_FIELDS = ["message", "error_description", "error", "details"];

function messageFromObject(obj: Record<string, unknown>): string {
  for (const field of MESSAGE_FIELDS) {
    const value = obj[field];
    if (typeof value === "string" && value.trim()) return value;
  }
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}

/* ------------------------------------------------------------------ */
/* Sync failures                                                       */
/* ------------------------------------------------------------------ */

/**
 * What kind of failure sync hit, reduced to something the app can act on.
 *
 * This exists for two reasons. Retrying: a dropped Wi-Fi connection is worth
 * another attempt, a column the cloud project does not have is not — repeating
 * a request that cannot succeed only burns battery and paints the badge red
 * for longer. Disclosure: PostgREST and Postgres messages name tables, columns,
 * constraints, roles and sometimes the offending row's contents. That is
 * internal detail about the backend, and it belongs in the console, not on a
 * user's screen. The UI is given this code and picks its own sentence.
 */
export type SyncFailureKind =
  | "offline"
  | "auth"
  | "schema"
  | "timeout"
  | "server"
  | "unknown";

/** Failures where another attempt could plausibly succeed on its own. */
export function isRetryableSyncFailure(kind: SyncFailureKind): boolean {
  return kind === "offline" || kind === "timeout" || kind === "server" || kind === "unknown";
}

interface Failure {
  code: string;
  status: number;
  message: string;
}

const OFFLINE_SIGNS = [
  "failed to fetch",
  "networkerror",
  "network request failed",
  "err_internet_disconnected",
  "fetch failed",
];

// PGRST301 expired/invalid JWT; 42501 insufficient privilege; RLS refusals.
function isAuthFailure({ code, status, message }: Failure): boolean {
  return (
    status === 401 ||
    status === 403 ||
    code === "PGRST301" ||
    code === "42501" ||
    message.includes("jwt") ||
    message.includes("row-level security") ||
    message.includes("not authenticated")
  );
}

// PGRST204 unknown column, PGRST205 unknown table, 42P01/42703 the same from
// Postgres itself. The cloud project is behind this app's schema.
function isSchemaFailure({ code, message }: Failure): boolean {
  return (
    code === "PGRST204" ||
    code === "PGRST205" ||
    code === "42P01" ||
    code === "42703" ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  );
}

/** What a thrown value tells us, normalised so the predicates stay readable. */
function failureOf(err: unknown): Failure {
  const obj = (err ?? {}) as Record<string, unknown>;
  return {
    code: typeof obj.code === "string" ? obj.code : "",
    status: typeof obj.status === "number" ? obj.status : 0,
    message: formatErrorMessage(err).toLowerCase(),
  };
}

function isTimeout({ message }: Failure): boolean {
  return message.includes("timed out") || message.includes("timeout");
}

function isOffline({ message }: Failure): boolean {
  return OFFLINE_SIGNS.some((sign) => message.includes(sign));
}

function isServerFailure({ status }: Failure): boolean {
  return status === 429 || status >= 500;
}

/** In order: the browser's own answer first, then the most specific cause. */
const CAUSES: [(failure: Failure) => boolean, SyncFailureKind][] = [
  [isTimeout, "timeout"],
  [isOffline, "offline"],
  [isAuthFailure, "auth"],
  [isSchemaFailure, "schema"],
  [isServerFailure, "server"],
];

export function classifySyncError(err: unknown): SyncFailureKind {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  const failure = failureOf(err);
  return CAUSES.find(([matches]) => matches(failure))?.[1] ?? "unknown";
}
