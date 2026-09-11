import { profileFromAuthUser } from "@/domain/auth";
import { formatErrorMessage } from "@/lib/errors";
import { supabase } from "@/lib/supabase";
import type { AuthSliceTools, AuthState } from "../authState";

// Every way in and out: e-mail, Google, password recovery, sign-out.
export type CredentialsSlice = Pick<
  AuthState,
  | "signInWithEmail"
  | "signUpWithEmail"
  | "signInWithGoogle"
  | "resetPassword"
  | "completePasswordReset"
  | "updatePassword"
  | "signOut"
  | "updateProfile"
>;

export function createCredentialsSlice({ set, get }: AuthSliceTools): CredentialsSlice {
  return {
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
          set({
            session: data.session,
            user: profileFromAuthUser(data.session.user, get().user),
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
          const fromSession = profileFromAuthUser(data.session.user, get().user);
          set({
            session: data.session,
            // The name they just typed beats whatever the session inferred from
            // the address; the row that carries it may not exist yet.
            user: { ...fromSession, fullName: fullName || fromSession.fullName },
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
  };
}
