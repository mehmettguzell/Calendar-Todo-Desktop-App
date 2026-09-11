import { useState } from "react";
import { CircleDot, Sparkles } from "lucide-react";
import { useAuthStore } from "@/state/authStore";
import { useI18n } from "@/lib/i18n";
import {
  AuthAlert,
  AuthDivider,
  AuthFooter,
  EmailField,
  GoogleButton,
  LinkButton,
  NameField,
  PasswordField,
  SubmitButton,
} from "./auth/AuthFields";

type GateMode = "login" | "register" | "forgot";

/** The sign-in wall: the only screen a signed-out account can reach. */
export function AuthGate() {
  const [mode, setMode] = useState<GateMode>("login");
  const [info, setInfo] = useState<string | null>(null);
  const errorMessage = useAuthStore((s) => s.errorMessage);

  const show = (next: GateMode) => {
    setInfo(null);
    setMode(next);
  };

  return (
    <div className="auth-gate-wrapper">
      <div className="auth-gate-card">
        <BrandHeader />

        {errorMessage ? (
          <AuthAlert kind="error" text={errorMessage} spaced />
        ) : null}
        {info ? <AuthAlert kind="success" text={info} spaced /> : null}

        {mode === "login" ? <GateLogin onMode={show} /> : null}
        {mode === "register" ? <GateRegister onMode={show} onInfo={setInfo} /> : null}
        {mode === "forgot" ? <GateForgot onMode={show} onInfo={setInfo} /> : null}
      </div>
    </div>
  );
}

function BrandHeader() {
  return (
    <div className="auth-gate-brand">
      <span className="auth-gate-logo">
        <CircleDot size={24} />
      </span>
      <h1>Tempo</h1>
      <p className="auth-gate-tagline">
        Akıllı Takvim & Görev Yöneticisi • Masaüstü & Mobil Senkronizasyon
      </p>
    </div>
  );
}

function GateLogin({ onMode }: { onMode: (mode: GateMode) => void }) {
  const { t } = useI18n();
  const loading = useAuthStore((s) => s.loading);
  const signInWithEmail = useAuthStore((s) => s.signInWithEmail);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    await signInWithEmail(email.trim(), password);
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
        <EmailField value={email} onChange={setEmail} autoFocus />
        <PasswordField
          label={t("authPassword")}
          value={password}
          onChange={setPassword}
          action={
            <LinkButton small onClick={() => onMode("forgot")}>
              Şifremi unuttum
            </LinkButton>
          }
        />
        <SubmitButton disabled={loading || !email || !password}>
          {loading ? t("authLoggingIn") : t("authLogin")}
        </SubmitButton>
      </form>

      <AuthFooter>
        {t("authNoAccount")}{" "}
        <LinkButton bold onClick={() => onMode("register")}>
          {t("authStartTrial")}
        </LinkButton>
      </AuthFooter>
    </div>
  );
}

function GateRegister({
  onMode,
  onInfo,
}: {
  onMode: (mode: GateMode) => void;
  onInfo: (text: string) => void;
}) {
  const { t } = useI18n();
  const loading = useAuthStore((s) => s.loading);
  const signUpWithEmail = useAuthStore((s) => s.signUpWithEmail);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password || !fullName.trim()) return;
    const res = await signUpWithEmail(email.trim(), password, fullName.trim());
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
            style={{ fontSize: "var(--text-2xs)", margin: "2px 0 0 0" }}
          >
            {t("authTrialBody")}
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
        <NameField value={fullName} onChange={setFullName} autoFocus />
        <EmailField value={email} onChange={setEmail} />
        <PasswordField
          label={t("authPasswordMin")}
          value={password}
          onChange={setPassword}
          minLength={6}
        />
        <SubmitButton disabled={loading || !email || !password || !fullName}>
          {loading ? t("authCreating") : t("authStartFree")}
        </SubmitButton>
      </form>

      <AuthFooter>
        {t("authHaveAccount")}{" "}
        <LinkButton bold onClick={() => onMode("login")}>
          Giriş Yapın
        </LinkButton>
      </AuthFooter>
    </div>
  );
}

function GateForgot({
  onMode,
  onInfo,
}: {
  onMode: (mode: GateMode) => void;
  onInfo: (text: string) => void;
}) {
  const { t } = useI18n();
  const loading = useAuthStore((s) => s.loading);
  const resetPassword = useAuthStore((s) => s.resetPassword);
  const [email, setEmail] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    if (await resetPassword(email.trim())) onInfo(t("authResetSent"));
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      <p className="faint" style={{ fontSize: "var(--text-sm)" }}>
        Kayıtlı e-posta adresinizi girin. Şifrenizi sıfırlayabileceğiniz bir
        bağlantı göndereceğiz.
      </p>

      <form onSubmit={submit} className="col" style={{ gap: 10 }}>
        <EmailField value={email} onChange={setEmail} autoFocus />
        <SubmitButton disabled={loading || !email}>
          {loading ? t("authSending") : t("authSendReset")}
        </SubmitButton>
      </form>

      <AuthFooter>
        <LinkButton bold onClick={() => onMode("login")}>
          {t("authBackToLogin")}
        </LinkButton>
      </AuthFooter>
    </div>
  );
}
