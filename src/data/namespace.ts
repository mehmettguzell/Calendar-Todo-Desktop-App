/**
 * Which account's local document is on screen.
 *
 * Every signed-in user gets a separate local store. Two people using the same
 * machine must not see — or, worse, silently upload — each other's tasks, and
 * that has to hold for edits made while offline too, so the separation lives in
 * storage rather than in a filter over one shared document.
 */

/** The namespace used before anyone signs in. */
export const ANONYMOUS_NAMESPACE = "local";

const ACTIVE_KEY = "tempo.activeNamespace";
const CLAIMED_KEY = "tempo.anonymousClaimedBy";

export type Namespace = string;

/** Namespace for a user id, or the anonymous one when signed out. */
export function namespaceFor(userId: string | null | undefined): Namespace {
  return userId ? userId : ANONYMOUS_NAMESPACE;
}

/**
 * The namespace to open at startup, remembered across restarts.
 *
 * Read from local storage rather than from Supabase, because the first paint
 * cannot wait on a token refresh — and offline that refresh may never land.
 * Auth corrects this the moment it resolves.
 */
export function activeNamespace(): Namespace {
  if (typeof localStorage === "undefined") return ANONYMOUS_NAMESPACE;
  return localStorage.getItem(ACTIVE_KEY) || ANONYMOUS_NAMESPACE;
}

export function setActiveNamespace(namespace: Namespace): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(ACTIVE_KEY, namespace);
}

/**
 * The account, if any, that has already taken over the signed-out document.
 *
 * Someone who tried the app before creating an account expects their tasks to
 * still be there afterwards, so the first sign-in adopts the anonymous
 * document. The second account must not: that would hand one person's work to
 * another. Recording the claim is what tells the two cases apart.
 */
export function anonymousClaimedBy(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(CLAIMED_KEY);
}

export function markAnonymousClaimed(userId: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(CLAIMED_KEY, userId);
}
