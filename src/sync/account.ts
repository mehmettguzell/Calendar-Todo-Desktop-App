import { useAuthStore } from "@/state/authStore";

// The id every cloud write is keyed by. `user` (the `public.profiles` row) can
// be null for a while or forever, so the auth session is the fallback.
export function currentUserId(): string | null {
  const auth = useAuthStore.getState();
  return auth.user?.id ?? auth.session?.user?.id ?? null;
}
