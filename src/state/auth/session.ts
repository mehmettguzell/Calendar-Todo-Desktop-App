import {
  avatarToBackfill,
  mergeProfileRow,
  profileFromAuthUser,
  type PlanTier,
  type SubscriptionStatus,
} from "@/domain/auth";
import { supabase } from "@/lib/supabase";
import { hasAuthListener, keepAuthListener } from "./listener";
import type { AuthSliceTools, AuthState } from "../authState";

// Bringing an existing session back and filling in who it belongs to.
export type SessionSlice = Pick<
  AuthState,
  | "initAuth"
  | "hydrateAccountDetails"
  | "fetchProfile"
  | "fetchSubscription"
>;

export function createSessionSlice({ set, get }: AuthSliceTools): SessionSlice {
  return {
    /**
     * Restore the session, then enrich it in the background.
     *
     * Being offline is not being signed out. The session lives in local storage
     * and is enough to identify the user, decide which local document to open and
     * keep working; the profile and subscription rows are decoration that arrives
     * when the network does. Awaiting them here is what used to hold the whole
     * app on a spinner in a tunnel — and, when the fetch failed, leave it looking
     * signed out over a perfectly valid session.
     */
    initAuth: async () => {
      if (!supabase) {
        set({ initialized: true });
        return;
      }
      // `onAuthStateChange` registers a listener that nothing ever releases, so a
      // second call would leave two of them attached to the same client: every
      // sign-in would then set the session twice and hydrate the account twice.
      // React's development double-invoke of effects is enough to reach this.
      if (hasAuthListener()) return;

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        // The session is the identity. Reading the user off it here is what
        // makes the sidebar right the moment the window opens — offline
        // included — instead of an empty card waiting on a request that, in a
        // tunnel, never comes back.
        set({
          session,
          user: session?.user
            ? profileFromAuthUser(session.user, get().user)
            : null,
        });

        if (session?.user) {
          // Deliberately not awaited: see above.
          void get().hydrateAccountDetails(session.user.id);
        }

        // Listen for auth state changes (login, logout, refresh token)
        const { data } = supabase.auth.onAuthStateChange((event, newSession) => {
          // A token refresh that could not reach the server is a network problem,
          // not a sign-out. Only an explicit SIGNED_OUT — or Supabase deciding the
          // refresh token itself is dead — clears the account.
          if (event === "SIGNED_OUT") {
            set({ session: null, user: null, subscription: null });
            return;
          }
          // The recovery link landed back in this window (browser build). The
          // session it carries is only good for setting a password.
          if (event === "PASSWORD_RECOVERY") {
            set({
              session: newSession,
              authModalOpen: true,
              authModalView: "new_password",
            });
            return;
          }
          if (!newSession) {
            if (event === "INITIAL_SESSION") set({ session: null });
            return;
          }
          // Same on every later session — a token refresh included, which is
          // otherwise a moment where the profile could be rebuilt from a row
          // that knows less than the session does.
          set({
            session: newSession,
            user: profileFromAuthUser(newSession.user, get().user),
          });
          void get().hydrateAccountDetails(newSession.user.id);
        });
        keepAuthListener(data.subscription);
      } catch (err) {
        console.error("Failed to initialize auth:", err);
      } finally {
        set({ initialized: true });
      }
    },

    hydrateAccountDetails: async (userId: string) => {
      await Promise.allSettled([
        get().fetchProfile(userId),
        get().fetchSubscription(userId),
      ]);
    },

    /**
     * Enrich the signed-in user with their stored row.
     *
     * *Enrich*, not replace. The session already said who this is; the row adds
     * what only the server knows and corrects what the user has since edited.
     * A column that is null says nothing — see `mergeProfileRow`, which is where
     * the intermittent profile picture came from.
     */
    fetchProfile: async (userId: string) => {
      if (!supabase) return;

      const authUser = get().session?.user;
      const base =
        get().user ??
        (authUser ? profileFromAuthUser(authUser, null) : null);
      if (!base) return;

      try {
        const { data } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", userId)
          .maybeSingle();

        const merged = mergeProfileRow(base, data);
        set({ user: merged });

        const now = new Date().toISOString();
        if (!data) {
          // No row: create it, or `tasks.user_id -> profiles.id` rejects every
          // write this account makes.
          await supabase.from("profiles").upsert(
            {
              id: userId,
              email: merged.email,
              full_name: merged.fullName,
              avatar_url: merged.avatarUrl,
              created_at: merged.createdAt ?? now,
              updated_at: now,
            },
            { onConflict: "id" },
          );
          return;
        }

        // The row exists but has never been told about the provider's picture.
        // Writing it back is what makes this account's other devices — and the
        // next cold start on this one — show the same face.
        const backfill = avatarToBackfill(merged, data);
        if (backfill) {
          await supabase
            .from("profiles")
            .update({ avatar_url: backfill, updated_at: now })
            .eq("id", userId);
        }
      } catch (err) {
        console.warn("Could not fetch or create user profile:", err);
      }
    },

    fetchSubscription: async (userId: string) => {
      if (!supabase) return;
      try {
        const { data, error } = await supabase
          .from("subscriptions")
          .select("*")
          .eq("user_id", userId)
          .single();

        if (error) throw error;
        if (data) {
          set({
            subscription: {
              userId: data.user_id,
              status: data.status as SubscriptionStatus,
              planTier: data.plan_tier as PlanTier,
              trialStartedAt: data.trial_started_at,
              trialEndsAt: data.trial_ends_at,
              earlyBirdDiscountEndsAt: data.early_bird_discount_ends_at,
              hasEarlyBirdDiscount: Boolean(data.has_early_bird_discount),
              stripeCustomerId: data.stripe_customer_id,
              stripeSubscriptionId: data.stripe_subscription_id,
            },
          });
        }
      } catch (err) {
        console.warn("Could not fetch subscription details:", err);
      }
    },
  };
}
