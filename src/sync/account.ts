import { auth } from "./ports";

/** The id every cloud write is keyed by, or null while signed out. */
export function currentUserId(): string | null {
  return auth().currentUserId();
}
