import { create } from "zustand";
import type { Session } from "@supabase/supabase-js";
import {
  calculateTrialStatus,
  type PlanTier,
  type SubscriptionStatus,
  type TrialCalculation,
  type UserProfile,
  type UserSubscription,
} from "@/domain/auth";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { formatErrorMessage } from "@/lib/errors";

export type AuthModalView =
  | "login"
  | "register"
  | "forgot_password"
  /** Entering the code from the recovery e-mail, and a new password. */
  | "new_password"
  | "profile"
  | "pricing";

interface AuthState {
  isConfigured: boolean;
  initialized: boolean;
  loading: boolean;
  session: Session | null;
  user: UserProfile | null;
  subscription: UserSubscription | null;
  authModalOpen: boolean;
  authModalView: AuthModalView;
  errorMessage: string | null;

  // Modal actions
  openAuthModal: (view?: AuthModalView) => void;
  closeAuthModal: () => void;
  setAuthModalView: (view: AuthModalView) => void;
  clearError: () => void;

  // Auth actions
  signInWithEmail: (email: string, password: string) => Promise<boolean>;
  signUpWithEmail: (
    email: string,
    password: string,
    fullName: string,
  ) => Promise<{ success: boolean; needsEmailConfirmation?: boolean }>;
  signInWithGoogle: () => Promise<void>;
  resetPassword: (email: string) => Promise<boolean>;
  /** Finish a reset with the 6-digit code from the recovery e-mail. */
  completePasswordReset: (
    email: string,
    code: string,
    newPassword: string,
  ) => Promise<boolean>;
  /** Set a new password for a session that is already recovered. */
  updatePassword: (newPassword: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  updateProfile: (fullName: string, avatarUrl?: string) => Promise<boolean>;
  fetchSubscription: (userId: string) => Promise<void>;
  fetchProfile: (userId: string) => Promise<void>;
  /** Profile + subscription, fetched together and allowed to fail quietly. */
  hydrateAccountDetails: (userId: string) => Promise<void>;
  initAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isConfigured: isSupabaseConfigured(),
  initialized: false,
  loading: false,
  session: null,
  user: null,
  subscription: null,
  authModalOpen: false,
  authModalView: "login",
  errorMessage: null,

  openAuthModal: (view: AuthModalView = "login") => {
    set({ authModalOpen: true, authModalView: view, errorMessage: null });
  },

  closeAuthModal: () => {
    set({ authModalOpen: false, errorMessage: null });
  },

  setAuthModalView: (view: AuthModalView) => {
    set({ authModalView: view, errorMessage: null });
  },

  clearError: () => {
    set({ errorMessage: null });
  },

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

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      set({ session });

      if (session?.user) {
        // Deliberately not awaited: see above.
        void get().hydrateAccountDetails(session.user.id);
      }

      // Listen for auth state changes (login, logout, refresh token)
      supabase.auth.onAuthStateChange((event, newSession) => {
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
        set({ session: newSession });
        void get().hydrateAccountDetails(newSession.user.id);
      });
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

  fetchProfile: async (userId: string) => {
    if (!supabase) return;
    try {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();

      if (data) {
        set({
          user: {
            id: data.id,
            email: data.email,
            fullName: data.full_name,
            avatarUrl: data.avatar_url,
            createdAt: data.created_at,
            updatedAt: data.updated_at,
          },
        });
      } else {
        // Fallback: If profile row is missing in public.profiles table, create it immediately
        // so that foreign key constraints on public.tasks (user_id -> profiles.id) succeed!
        const session = get().session;
        const authUser = session?.user;
        const email = authUser?.email ?? "";
        const fullName =
          (authUser?.user_metadata?.full_name as string) ??
          email.split("@")[0] ??
          "User";
        const now = new Date().toISOString();

        const profileRecord = {
          id: userId,
          email,
          full_name: fullName,
          avatar_url: (authUser?.user_metadata?.avatar_url as string) ?? null,
          created_at: authUser?.created_at ?? now,
          updated_at: now,
        };

        await supabase
          .from("profiles")
          .upsert(profileRecord, { onConflict: "id" });
        set({
          user: {
            id: profileRecord.id,
            email: profileRecord.email,
            fullName: profileRecord.full_name,
            avatarUrl: profileRecord.avatar_url ?? undefined,
            createdAt: profileRecord.created_at,
            updatedAt: profileRecord.updated_at,
          },
        });
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

  signInWithEmail: async (email: string, password: string) => {
    if (!supabase) {
      set({ errorMessage: "Supabase bağlantısı henüz yapılandırılmadı." });
      return false;
    }

    set({ loading: true, errorMessage: null });
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        set({
          errorMessage:
            error.message === "Invalid login credentials"
              ? "E-posta veya şifre hatalı."
              : error.message,
          loading: false,
        });
        return false;
      }

      if (data.session) {
        const authUser = data.session.user;
        const initialUser: UserProfile = {
          id: authUser.id,
          email: authUser.email ?? "",
          fullName:
            (authUser.user_metadata?.full_name as string) ??
            authUser.email?.split("@")[0] ??
            "User",
          avatarUrl: (authUser.user_metadata?.avatar_url as string) ?? null,
          createdAt: authUser.created_at,
          updatedAt: new Date().toISOString(),
        };
        set({
          session: data.session,
          user: initialUser,
          authModalOpen: false,
          loading: false,
        });
        void get().hydrateAccountDetails(data.session.user.id);
        return true;
      }
      return false;
    } catch (err: unknown) {
      set({
        errorMessage: formatErrorMessage(err),
        loading: false,
      });
      return false;
    }
  },

  signUpWithEmail: async (
    email: string,
    password: string,
    fullName: string,
  ) => {
    if (!supabase) {
      set({ errorMessage: "Supabase bağlantısı henüz yapılandırılmadı." });
      return { success: false };
    }

    set({ loading: true, errorMessage: null });
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
          },
        },
      });

      if (error) {
        set({
          errorMessage: error.message.includes("already registered")
            ? "Bu e-posta adresi ile zaten bir hesap var."
            : error.message,
          loading: false,
        });
        return { success: false };
      }

      if (data.session) {
        const authUser = data.session.user;
        const initialUser: UserProfile = {
          id: authUser.id,
          email: authUser.email ?? "",
          fullName: fullName || authUser.email?.split("@")[0] || "User",
          avatarUrl: (authUser.user_metadata?.avatar_url as string) ?? null,
          createdAt: authUser.created_at,
          updatedAt: new Date().toISOString(),
        };
        set({
          session: data.session,
          user: initialUser,
          authModalOpen: false,
          loading: false,
        });
        void get().hydrateAccountDetails(data.session.user.id);
        return { success: true, needsEmailConfirmation: false };
      }

      // If Supabase has email confirmation enabled
      set({ loading: false });
      return { success: true, needsEmailConfirmation: true };
    } catch (err: unknown) {
      set({
        errorMessage: formatErrorMessage(err),
        loading: false,
      });
      return { success: false };
    }
  },

  signInWithGoogle: async () => {
    if (!supabase) {
      set({ errorMessage: "Supabase bağlantısı henüz yapılandırılmadı." });
      return;
    }

    set({ loading: true, errorMessage: null });
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
        },
      });

      if (error) {
        const msg = error.message.includes("provider is not enabled")
          ? "Supabase panelinizde Google sağlayıcısı henüz aktif edilmemiş. Authentication -> Providers -> Google sekmesinden aktif edebilir veya E-posta & Şifre ile kayıt olabilirsiniz."
          : error.message;
        set({ errorMessage: msg, loading: false });
      }
    } catch (err: unknown) {
      set({
        errorMessage: formatErrorMessage(err),
        loading: false,
      });
    }
  },

  resetPassword: async (email: string) => {
    if (!supabase) {
      set({ errorMessage: "Supabase bağlantısı henüz yapılandırılmadı." });
      return false;
    }

    set({ loading: true, errorMessage: null });
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        // Sent so the link works where the app can receive it (the browser
        // build). A desktop window cannot be redirected into from a browser,
        // which is why the code path below exists alongside it.
        redirectTo: window.location.origin,
      });

      if (error) {
        set({ errorMessage: error.message, loading: false });
        return false;
      }

      set({ loading: false });
      return true;
    } catch (err: unknown) {
      set({
        errorMessage: formatErrorMessage(err),
        loading: false,
      });
      return false;
    }
  },

  /**
   * Sign out locally whatever the server says.
   *
   * `signOut()` revokes the refresh token, which needs a network. Offline it
   * throws — and leaving the person signed in because the server could not be
   * told is the wrong answer on a shared machine. The local session is cleared
   * either way; a stale refresh token expires on its own.
   */
  /**
   * Finish a reset without ever leaving the app.
   *
   * A recovery e-mail carries both a link and a six-digit code. The link opens
   * in a browser, which cannot hand a session back to a desktop window — so the
   * code is the path that actually works here. `verifyOtp` exchanges it for a
   * recovered session, and the password change is an ordinary update on it.
   */
  completePasswordReset: async (email, code, newPassword) => {
    if (!supabase) {
      set({ errorMessage: "Supabase bağlantısı henüz yapılandırılmadı." });
      return false;
    }

    set({ loading: true, errorMessage: null });
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: "recovery",
      });
      if (error) {
        set({
          errorMessage:
            /expired/i.test(error.message)
              ? "Kodun süresi dolmuş. Yeni bir kod isteyin."
              : "Kod doğrulanamadı. E-postadaki 6 haneli kodu kontrol edin.",
          loading: false,
        });
        return false;
      }
      return await get().updatePassword(newPassword);
    } catch (err: unknown) {
      set({ errorMessage: formatErrorMessage(err), loading: false });
      return false;
    }
  },

  updatePassword: async (newPassword) => {
    if (!supabase) return false;
    set({ loading: true, errorMessage: null });
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        set({ errorMessage: error.message, loading: false });
        return false;
      }
      set({ loading: false, authModalOpen: false, authModalView: "login" });
      return true;
    } catch (err: unknown) {
      set({ errorMessage: formatErrorMessage(err), loading: false });
      return false;
    }
  },

  signOut: async () => {
    if (!supabase) return;
    set({ loading: true });
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn("Sign out could not reach the server:", err);
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    } finally {
      set({
        session: null,
        user: null,
        subscription: null,
        authModalOpen: false,
        loading: false,
      });
    }
  },

  updateProfile: async (fullName: string, avatarUrl?: string) => {
    const user = get().user;
    if (!supabase || !user) return false;

    set({ loading: true, errorMessage: null });
    try {
      const updates: {
        full_name: string;
        avatar_url?: string;
        updated_at: string;
      } = {
        full_name: fullName,
        updated_at: new Date().toISOString(),
      };
      if (avatarUrl !== undefined) updates.avatar_url = avatarUrl;

      const { error } = await supabase
        .from("profiles")
        .update(updates)
        .eq("id", user.id);

      if (error) throw error;

      set((state) => ({
        user: state.user
          ? {
              ...state.user,
              fullName,
              avatarUrl:
                avatarUrl !== undefined ? avatarUrl : state.user.avatarUrl,
            }
          : null,
        loading: false,
      }));

      return true;
    } catch (err: unknown) {
      set({
        errorMessage: formatErrorMessage(err),
        loading: false,
      });
      return false;
    }
  },
}));

/**
 * Hook to get the computed trial calculation and pricing eligibility
 */
export function useTrialStatus(): TrialCalculation {
  const subscription = useAuthStore((s) => s.subscription);
  return calculateTrialStatus(subscription);
}
