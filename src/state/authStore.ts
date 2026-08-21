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

export type AuthModalView =
  | "login"
  | "register"
  | "forgot_password"
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
  signOut: () => Promise<void>;
  updateProfile: (fullName: string, avatarUrl?: string) => Promise<boolean>;
  fetchSubscription: (userId: string) => Promise<void>;
  fetchProfile: (userId: string) => Promise<void>;
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

  initAuth: async () => {
    if (!supabase) {
      set({ initialized: true });
      return;
    }

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.user) {
        set({ session });
        await Promise.all([
          get().fetchProfile(session.user.id),
          get().fetchSubscription(session.user.id),
        ]);
      }

      // Listen for auth state changes (login, logout, refresh token)
      supabase.auth.onAuthStateChange(async (_event, newSession) => {
        set({ session: newSession });
        if (newSession?.user) {
          await Promise.all([
            get().fetchProfile(newSession.user.id),
            get().fetchSubscription(newSession.user.id),
          ]);
        } else {
          set({ user: null, subscription: null });
        }
      });
    } catch (err) {
      console.error("Failed to initialize auth:", err);
    } finally {
      set({ initialized: true });
    }
  },

  fetchProfile: async (userId: string) => {
    if (!supabase) return;
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (error) throw error;
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
      }
    } catch (err) {
      console.warn("Could not fetch user profile:", err);
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
        set({ session: data.session, authModalOpen: false, loading: false });
        await Promise.all([
          get().fetchProfile(data.session.user.id),
          get().fetchSubscription(data.session.user.id),
        ]);
        return true;
      }
      return false;
    } catch (err: unknown) {
      set({
        errorMessage:
          err instanceof Error
            ? err.message
            : "Giriş yapılırken bir hata oluştu.",
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
        set({ session: data.session, authModalOpen: false, loading: false });
        await Promise.all([
          get().fetchProfile(data.session.user.id),
          get().fetchSubscription(data.session.user.id),
        ]);
        return { success: true, needsEmailConfirmation: false };
      }

      // If Supabase has email confirmation enabled
      set({ loading: false });
      return { success: true, needsEmailConfirmation: true };
    } catch (err: unknown) {
      set({
        errorMessage:
          err instanceof Error ? err.message : "Kayıt olurken bir hata oluştu.",
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
        errorMessage:
          err instanceof Error
            ? err.message
            : "Google ile giriş yapılırken bir hata oluştu.",
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
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) {
        set({ errorMessage: error.message, loading: false });
        return false;
      }

      set({ loading: false });
      return true;
    } catch (err: unknown) {
      set({
        errorMessage:
          err instanceof Error
            ? err.message
            : "Şifre sıfırlama bağlantısı gönderilemedi.",
        loading: false,
      });
      return false;
    }
  },

  signOut: async () => {
    if (!supabase) return;
    set({ loading: true });
    try {
      await supabase.auth.signOut();
      set({
        session: null,
        user: null,
        subscription: null,
        authModalOpen: false,
        loading: false,
      });
    } catch (err) {
      console.error("Sign out error:", err);
      set({ loading: false });
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
        errorMessage:
          err instanceof Error ? err.message : "Profil güncellenemedi.",
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
