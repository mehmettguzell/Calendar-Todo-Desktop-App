import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  CircleDot,
  KeyRound,
  Mail,
  Sparkles,
  User,
} from "lucide-react";
import { useAuthStore } from "@/state/authStore";
import { useI18n } from "@/lib/i18n";

export function AuthGate() {
  const { t } = useI18n();
  const loading = useAuthStore((s) => s.loading);
  const errorMessage = useAuthStore((s) => s.errorMessage);
  const signInWithEmail = useAuthStore((s) => s.signInWithEmail);
  const signUpWithEmail = useAuthStore((s) => s.signUpWithEmail);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);
  const resetPassword = useAuthStore((s) => s.resetPassword);

  const [mode, setMode] = useState<"login" | "register" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setInfoMessage(null);
    await signInWithEmail(email.trim(), password);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password || !fullName.trim()) return;
    setInfoMessage(null);
    const res = await signUpWithEmail(email.trim(), password, fullName.trim());
    if (res.success && res.needsEmailConfirmation) {
      setInfoMessage(
        t("authRegistered"),
      );
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setInfoMessage(null);
    const ok = await resetPassword(email.trim());
    if (ok) {
      setInfoMessage(
        t("authResetSent"),
      );
    }
  };

  return (
    <div className="auth-gate-wrapper">
      <div className="auth-gate-card">
        {/* Brand Header */}
        <div className="auth-gate-brand">
          <span className="auth-gate-logo">
            <CircleDot size={24} />
          </span>
          <h1>Tempo</h1>
          <p className="auth-gate-tagline">
            Akıllı Takvim & Görev Yöneticisi • Masaüstü & Mobil Senkronizasyon
          </p>
        </div>

        {/* Alerts */}
        {errorMessage && (
          <div className="auth-alert error" style={{ marginBottom: 12 }}>
            <AlertCircle size={15} />
            <span>{errorMessage}</span>
          </div>
        )}

        {infoMessage && (
          <div className="auth-alert success" style={{ marginBottom: 12 }}>
            <CheckCircle2 size={15} />
            <span>{infoMessage}</span>
          </div>
        )}

        {/* 1. LOGIN MODE */}
        {mode === "login" && (
          <div className="col" style={{ gap: 14 }}>
            <button
              type="button"
              className="btn auth-google-btn"
              disabled={loading}
              onClick={() => signInWithGoogle()}
            >
              <GoogleIcon />
              <span>{t("authGoogleLogin")}</span>
            </button>

            <div className="auth-divider">
              <span>{t("authOrEmail")}</span>
            </div>

            <form onSubmit={handleLogin} className="col" style={{ gap: 10 }}>
              <div className="field">
                <label className="field-label">E-posta</label>
                <div className="input-icon-wrap">
                  <Mail size={15} className="input-icon" />
                  <input
                    type="email"
                    className="input auth-input"
                    placeholder="ornek@gmail.com"
                    autoFocus
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className="field">
                <div
                  className="row"
                  style={{ justifyContent: "space-between" }}
                >
                  <label className="field-label">{t("authPassword")}</label>
                  <button
                    type="button"
                    className="link-btn"
                    style={{ fontSize: 11.5 }}
                    onClick={() => setMode("forgot")}
                  >
                    Şifremi unuttum
                  </button>
                </div>
                <div className="input-icon-wrap">
                  <KeyRound size={15} className="input-icon" />
                  <input
                    type="password"
                    className="input auth-input"
                    placeholder="••••••••"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>

              <button
                type="submit"
                className="btn primary auth-submit-btn"
                disabled={loading || !email || !password}
              >
                {loading ? t("authLoggingIn") : t("authLogin")}
              </button>
            </form>

            <div className="auth-footer-text">
              {t("authNoAccount")}{" "}
              <button
                type="button"
                className="link-btn bold"
                onClick={() => setMode("register")}
              >
                {t("authStartTrial")}
              </button>
            </div>
          </div>
        )}

        {/* 2. REGISTER MODE */}
        {mode === "register" && (
          <div className="col" style={{ gap: 14 }}>
            <div className="auth-trial-promo">
              <Sparkles size={16} className="auth-promo-icon" />
              <div>
                <strong>{t("authTrialTitle")}</strong>
                <p
                  className="faint"
                  style={{ fontSize: 11.5, margin: "2px 0 0 0" }}
                >
                  {t("authTrialBody")}
                </p>
              </div>
            </div>

            <button
              type="button"
              className="btn auth-google-btn"
              disabled={loading}
              onClick={() => signInWithGoogle()}
            >
              <GoogleIcon />
              <span>{t("authGoogleRegister")}</span>
            </button>

            <div className="auth-divider">
              <span>{t("authOrEmail")}</span>
            </div>

            <form onSubmit={handleRegister} className="col" style={{ gap: 10 }}>
              <div className="field">
                <label className="field-label">{t("fullName")}</label>
                <div className="input-icon-wrap">
                  <User size={15} className="input-icon" />
                  <input
                    type="text"
                    className="input auth-input"
                    placeholder={t("fullNamePlaceholder")}
                    autoFocus
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                </div>
              </div>

              <div className="field">
                <label className="field-label">E-posta</label>
                <div className="input-icon-wrap">
                  <Mail size={15} className="input-icon" />
                  <input
                    type="email"
                    className="input auth-input"
                    placeholder="ornek@gmail.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className="field">
                <label className="field-label">{t("authPasswordMin")}</label>
                <div className="input-icon-wrap">
                  <KeyRound size={15} className="input-icon" />
                  <input
                    type="password"
                    className="input auth-input"
                    placeholder="••••••••"
                    minLength={6}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>

              <button
                type="submit"
                className="btn primary auth-submit-btn"
                disabled={loading || !email || !password || !fullName}
              >
                {loading ? t("authCreating") : t("authStartFree")}
              </button>
            </form>

            <div className="auth-footer-text">
              {t("authHaveAccount")}{" "}
              <button
                type="button"
                className="link-btn bold"
                onClick={() => setMode("login")}
              >
                Giriş Yapın
              </button>
            </div>
          </div>
        )}

        {/* 3. FORGOT MODE */}
        {mode === "forgot" && (
          <div className="col" style={{ gap: 14 }}>
            <p className="faint" style={{ fontSize: 13 }}>
              Kayıtlı e-posta adresinizi girin. Şifrenizi sıfırlayabileceğiniz
              bir bağlantı göndereceğiz.
            </p>

            <form onSubmit={handleForgot} className="col" style={{ gap: 10 }}>
              <div className="field">
                <label className="field-label">E-posta</label>
                <div className="input-icon-wrap">
                  <Mail size={15} className="input-icon" />
                  <input
                    type="email"
                    className="input auth-input"
                    placeholder="ornek@gmail.com"
                    autoFocus
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              <button
                type="submit"
                className="btn primary auth-submit-btn"
                disabled={loading || !email}
              >
                {loading ? t("authSending") : t("authSendReset")}
              </button>
            </form>

            <div className="auth-footer-text">
              <button
                type="button"
                className="link-btn bold"
                onClick={() => setMode("login")}
              >
                {t("authBackToLogin")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
      />
    </svg>
  );
}
