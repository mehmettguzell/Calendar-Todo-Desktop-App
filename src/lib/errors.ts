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
