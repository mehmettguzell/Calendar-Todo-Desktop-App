import { supabase } from "@/lib/supabase";
import { auth } from "./ports";
import { withTimeout } from "./cloudRequest";

// `public.tasks.user_id` has a FK onto `public.profiles`, so a missing profile
// row fails every task write with 23503. The signup trigger normally creates
// it; accounts that predate the trigger need it backfilled.

const verifiedProfiles = new Set<string>();

export async function ensureProfileRow(userId: string): Promise<void> {
  if (!supabase || verifiedProfiles.has(userId)) return;
  const { email, fullName } = auth().identity();

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
