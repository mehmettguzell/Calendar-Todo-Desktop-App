import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/state/authStore";
import { withTimeout } from "./cloudRequest";

// `public.tasks.user_id` has a FK onto `public.profiles`, so a missing profile
// row fails every task write with 23503. The signup trigger normally creates
// it; accounts that predate the trigger need it backfilled.

const verifiedProfiles = new Set<string>();

type AuthState = ReturnType<typeof useAuthStore.getState>;

function profileFields(auth: AuthState): { email: string; fullName: string } {
  const email = auth.user?.email ?? auth.session?.user?.email ?? "";
  const fullName =
    auth.user?.fullName ??
    (auth.session?.user?.user_metadata?.full_name as string) ??
    email.split("@")[0] ??
    "User";
  return { email, fullName };
}

export async function ensureProfileRow(userId: string): Promise<void> {
  if (!supabase || verifiedProfiles.has(userId)) return;
  const { email, fullName } = profileFields(useAuthStore.getState());

  // Look before upserting, to avoid a 403 RLS violation.
  const { data: existing } = await withTimeout(
    supabase.from("profiles").select("id").eq("id", userId).maybeSingle(),
    "profile lookup",
  );

  if (existing) {
    verifiedProfiles.add(userId);
    return;
  }

  const { error } = await withTimeout(
    supabase.from("profiles").upsert(
      {
        id: userId,
        email,
        full_name: fullName,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    ),
    "profile create",
  );
  if (error) {
    console.warn("[tempo sync] Could not ensure profile row:", error.message);
  } else {
    verifiedProfiles.add(userId);
  }
}
