import type { Session } from "@supabase/supabase-js";
import type { UserProfile, UserSubscription } from "@/domain/auth";

// The whole auth contract in one place. Slices implement a `Pick<>` of it, so
// every action the UI can call is declared exactly once.

export type AuthModalView =
  | "login"
  | "register"
  | "forgot_password"
  /** Entering the code from the recovery e-mail, and a new password. */
  | "new_password"
  | "profile"
  | "pricing";

export interface AuthState {
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

/** What an auth slice is handed: the store's own `set` and `get`. */
export interface AuthSliceTools {
  set: (
    partial: Partial<AuthState> | ((state: AuthState) => Partial<AuthState>),
  ) => void;
  get: () => AuthState;
}
