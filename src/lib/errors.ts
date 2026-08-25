/**
 * Safely extracts a readable string message from any error type,
 * including Supabase PostgrestError, AuthError, JavaScript Error, or plain strings/objects.
 */
export function formatErrorMessage(err: unknown): string {
  if (!err) return "Bilinmeyen bir hata oluştu.";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (typeof err === "object") {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === "string" && obj.message.trim()) {
      return obj.message;
    }
    if (typeof obj.error_description === "string" && obj.error_description.trim()) {
      return obj.error_description;
    }
    if (typeof obj.error === "string" && obj.error.trim()) {
      return obj.error;
    }
    if (typeof obj.details === "string" && obj.details.trim()) {
      return obj.details;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
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

export function classifySyncError(err: unknown): SyncFailureKind {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";

  const obj = (err ?? {}) as Record<string, unknown>;
  const code = typeof obj.code === "string" ? obj.code : "";
  const status = typeof obj.status === "number" ? obj.status : 0;
  const message = formatErrorMessage(err).toLowerCase();

  if (message.includes("timed out") || message.includes("timeout")) {
    return "timeout";
  }
  if (
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("network request failed") ||
    message.includes("err_internet_disconnected") ||
    message.includes("fetch failed")
  ) {
    return "offline";
  }
  // PGRST301 expired/invalid JWT; 42501 insufficient privilege; RLS refusals.
  if (
    status === 401 ||
    status === 403 ||
    code === "PGRST301" ||
    code === "42501" ||
    message.includes("jwt") ||
    message.includes("row-level security") ||
    message.includes("not authenticated")
  ) {
    return "auth";
  }
  // PGRST204 unknown column, PGRST205 unknown table, 42P01/42703 the same from
  // Postgres itself. The cloud project is behind this app's schema.
  if (
    code === "PGRST204" ||
    code === "PGRST205" ||
    code === "42P01" ||
    code === "42703" ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  ) {
    return "schema";
  }
  if (status === 429 || status >= 500) return "server";
  return "unknown";
}
