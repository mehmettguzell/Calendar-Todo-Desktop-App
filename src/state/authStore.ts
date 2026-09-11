import { create } from "zustand";
import {
  calculateTrialStatus,
  type TrialCalculation,
} from "@/domain/auth";
import {
  isSupabaseConfigured,
} from "@/lib/supabase";
import type { AuthModalView, AuthState } from "./authState";
import { createCredentialsSlice } from "./auth/credentials";
import { createSessionSlice } from "./auth/session";

export { disposeAuthListener } from "./auth/listener";

export const useAuthStore = create<AuthState>((set, get) => {
  const tools = { set, get };

  return {
    ...createSessionSlice(tools),
    ...createCredentialsSlice(tools),

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
  };
});

/**
 * Hook to get the computed trial calculation and pricing eligibility
 */
export function useTrialStatus(): TrialCalculation {
  const subscription = useAuthStore((s) => s.subscription);
  return calculateTrialStatus(subscription);
}
