import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useAuthStore } from "@/state/authStore";
import { useI18n } from "@/lib/i18n";
import {
  AuthDivider,
  AuthFooter,
  EmailField,
  GoogleButton,
  LinkButton,
  NameField,
  PasswordField,
  SubmitButton,
} from "./AuthFields";
import type { AuthViewProps } from "./modalViews";

export function LoginView({ draft, onView }: AuthViewProps) {
  const { t } = useI18n();
  const loading = useAuthStore((s) => s.loading);
  const signInWithEmail = useAuthStore((s) => s.signInWithEmail);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.email.trim() || !draft.password) return;
    await signInWithEmail(draft.email.trim(), draft.password);
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      <GoogleButton
        label={t("authGoogleLogin")}
        disabled={loading}
        onClick={() => signInWithGoogle()}
      />
      <AuthDivider />

      <form onSubmit={submit} className="col" style={{ gap: 10 }}>
        <EmailField value={draft.email} onChange={draft.setEmail} autoFocus />
        <PasswordField
          label={t("authPassword")}
          value={draft.password}
          onChange={draft.setPassword}
          action={
            <LinkButton small onClick={() => onView("forgot_password")}>
              Şifremi unuttum
            </LinkButton>
          }
        />
        <SubmitButton disabled={loading || !draft.email || !draft.password}>
          {loading ? t("authLoggingIn") : t("authLogin")}
        </SubmitButton>
      </form>

      <AuthFooter>
        Hesabınız yok mu?{" "}
        <LinkButton bold onClick={() => onView("register")}>
          14 Gün Ücretsiz Başlayın
        </LinkButton>
      </AuthFooter>
    </div>
  );
}

export function RegisterView({ draft, onView, onInfo }: AuthViewProps) {
  const { t } = useI18n();
  const loading = useAuthStore((s) => s.loading);
  const signUpWithEmail = useAuthStore((s) => s.signUpWithEmail);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.email.trim() || !draft.password) return;
    const res = await signUpWithEmail(
      draft.email.trim(),
      draft.password,
      draft.fullName.trim(),
    );
    if (res.success && res.needsEmailConfirmation) onInfo(t("authRegistered"));
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="auth-trial-promo">
        <Sparkles size={16} className="auth-promo-icon" />
        <div>
          <strong>{t("authTrialTitle")}</strong>
          <p
            className="faint"
            style={{ fontSize: "var(--text-xs)", margin: "2px 0 0 0" }}
          >
            Tüm cihazlarınızda (Masaüstü & Mobil) anlık senkronizasyon ve ilk 7
            güne özel %40 indirim hakkı.
          </p>
        </div>
      </div>

      <GoogleButton
        label={t("authGoogleRegister")}
        disabled={loading}
        onClick={() => signInWithGoogle()}
      />
      <AuthDivider />

      <form onSubmit={submit} className="col" style={{ gap: 10 }}>
        <NameField value={draft.fullName} onChange={draft.setFullName} autoFocus />
        <EmailField value={draft.email} onChange={draft.setEmail} />
        <PasswordField
          label={t("authPasswordMin")}
          value={draft.password}
          onChange={draft.setPassword}
          minLength={6}
        />
        <SubmitButton
          disabled={loading || !draft.email || !draft.password || !draft.fullName}
        >
          {loading ? t("authCreating") : t("authStartMyAccount")}
        </SubmitButton>
      </form>

      <AuthFooter>
        Zaten hesabınız var mı?{" "}
        <LinkButton bold onClick={() => onView("login")}>
          Giriş Yapın
        </LinkButton>
      </AuthFooter>
    </div>
  );
}

export function ForgotView({ draft, onView, onInfo }: AuthViewProps) {
  const { t } = useI18n();
  const loading = useAuthStore((s) => s.loading);
  const resetPassword = useAuthStore((s) => s.resetPassword);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.email.trim()) return;
    if (!(await resetPassword(draft.email.trim()))) return;
    // Straight on to the code screen: sending the mail is a step, not a
    // destination, and leaving the user on a "check your inbox" dead end is
    // where this flow used to stop.
    onInfo(t("authCodeSent"));
    onView("new_password");
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      <p className="faint" style={{ fontSize: "var(--text-sm)" }}>
        Kayıtlı e-posta adresinizi girin. Şifrenizi sıfırlayabileceğiniz güvenli
        bir bağlantı göndereceğiz.
      </p>

      <form onSubmit={submit} className="col" style={{ gap: 10 }}>
        <EmailField value={draft.email} onChange={draft.setEmail} autoFocus />
        <SubmitButton disabled={loading || !draft.email}>
          {loading ? t("authSending") : t("authSendReset")}
        </SubmitButton>
      </form>

      <AuthFooter>
        <LinkButton bold onClick={() => onView("login")}>
          {t("authBackToLogin")}
        </LinkButton>
      </AuthFooter>
    </div>
  );
}

export function NewPasswordView({ draft, onView, onInfo }: AuthViewProps) {
  const { t } = useI18n();
  const loading = useAuthStore((s) => s.loading);
  const resetPassword = useAuthStore((s) => s.resetPassword);
  const completePasswordReset = useAuthStore((s) => s.completePasswordReset);
  const updatePassword = useAuthStore((s) => s.updatePassword);

  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  // Client-side complaints (mismatch, too short) that never reach the server.
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const complaint = checkPassword(password, again, t);
    setLocalError(complaint);
    if (complaint) return;

    // With a code: verify it, then set the password. Without one, the session
    // is already recovered (the link came back to this window) and the update
    // is all that is left.
    const ok = code.trim()
      ? await completePasswordReset(draft.email.trim(), code, password)
      : await updatePassword(password);
    if (!ok) return;

    onInfo(t("authPasswordUpdated"));
    setCode("");
    setPassword("");
    setAgain("");
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      <p className="faint" style={{ fontSize: "var(--text-sm)", lineHeight: 1.5 }}>
        E-postanıza gelen 6 haneli kodu girin ve yeni şifrenizi belirleyin. Kod
        gelmediyse spam klasörünü kontrol edin.
      </p>

      <form onSubmit={submit} className="col" style={{ gap: 10 }}>
        <EmailField value={draft.email} onChange={draft.setEmail} placeholder="" />

        <div className="field">
          <label className="field-label">{t("authCode")}</label>
          <input
            className="input auth-input auth-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            placeholder="123456"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>

        <PasswordField
          label={t("authNewPassword")}
          value={password}
          onChange={setPassword}
          placeholder={t("passwordMin")}
        />
        <PasswordField
          label={t("authNewPasswordAgain")}
          value={again}
          onChange={setAgain}
          placeholder=""
        />

        {localError ? (
          <p
            style={{
              color: "var(--danger)",
              fontSize: "var(--text-xs)",
              margin: 0,
            }}
          >
            {localError}
          </p>
        ) : null}

        <SubmitButton disabled={loading || !password}>
          {loading ? t("authSaving") : t("authUpdatePassword")}
        </SubmitButton>
      </form>

      <AuthFooter>
        <LinkButton
          disabled={loading || !draft.email.trim()}
          onClick={() => void resetPassword(draft.email.trim())}
        >
          Kodu tekrar gönder
        </LinkButton>
        {" · "}
        <LinkButton bold onClick={() => onView("login")}>
          Giriş Ekranı
        </LinkButton>
      </AuthFooter>
    </div>
  );
}

function checkPassword(
  password: string,
  again: string,
  t: (key: "authPasswordTooShort" | "authPasswordMismatch") => string,
): string | null {
  if (password.length < 6) return t("authPasswordTooShort");
  if (password !== again) return t("authPasswordMismatch");
  return null;
}
