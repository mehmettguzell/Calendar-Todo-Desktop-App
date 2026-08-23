import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Crown,
  KeyRound,
  LogOut,
  Mail,
  Sparkles,
  User,
} from "lucide-react";
import {
  useAuthStore,
  useTrialStatus,
  type AuthModalView,
} from "@/state/authStore";
import { getSubscriptionStatusLabel } from "@/domain/auth";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { Modal } from "./primitives";

export function AuthModal() {
  const { t } = useI18n();
  const isOpen = useAuthStore((s) => s.authModalOpen);
  const view = useAuthStore((s) => s.authModalView);
  const close = useAuthStore((s) => s.closeAuthModal);
  const setView = useAuthStore((s) => s.setAuthModalView);
  const errorMessage = useAuthStore((s) => s.errorMessage);
  const loading = useAuthStore((s) => s.loading);
  const user = useAuthStore((s) => s.user);
  const trial = useTrialStatus();

  const signInWithEmail = useAuthStore((s) => s.signInWithEmail);
  const signUpWithEmail = useAuthStore((s) => s.signUpWithEmail);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);
  const resetPassword = useAuthStore((s) => s.resetPassword);
  const completePasswordReset = useAuthStore((s) => s.completePasswordReset);
  const updatePassword = useAuthStore((s) => s.updatePassword);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const signOut = useAuthStore((s) => s.signOut);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [successInfo, setSuccessInfo] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordAgain, setNewPasswordAgain] = useState("");
  // Client-side complaints (mismatch, too short) that never reach the server.
  const [localError, setLocalError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    await signInWithEmail(email.trim(), password);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    const res = await signUpWithEmail(email.trim(), password, fullName.trim());
    if (res.success && res.needsEmailConfirmation) {
      setSuccessInfo(
        t("authRegistered"),
      );
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    const ok = await resetPassword(email.trim());
    if (ok) {
      // Straight on to the code screen: sending the mail is a step, not a
      // destination, and leaving the user on a "check your inbox" dead end is
      // where this flow used to stop.
      setSuccessInfo(t("authCodeSent"));
      setView("new_password");
    }
  };

  const handleNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      setLocalError(t("authPasswordTooShort"));
      return;
    }
    if (newPassword !== newPasswordAgain) {
      setLocalError(t("authPasswordMismatch"));
      return;
    }
    setLocalError(null);

    // With a code: verify it, then set the password. Without one, the session
    // is already recovered (the link came back to this window) and the update
    // is all that is left.
    const ok = recoveryCode.trim()
      ? await completePasswordReset(email.trim(), recoveryCode, newPassword)
      : await updatePassword(newPassword);

    if (ok) {
      setSuccessInfo(t("authPasswordUpdated"));
      setRecoveryCode("");
      setNewPassword("");
      setNewPasswordAgain("");
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) return;
    const ok = await updateProfile(fullName.trim());
    if (ok) {
      setSuccessInfo(t("authProfileUpdated"));
      setTimeout(() => close(), 1200);
    }
  };

  const titles: Record<AuthModalView, string> = {
    login: t("authTitleLogin"),
    register: t("authTitleRegister"),
    forgot_password: t("authTitleForgot"),
    new_password: t("authTitleNewPassword"),
    profile: t("authTitleProfile"),
    pricing: "Abonelik & Pro Plan",
  };

  return (
    <Modal title={titles[view]} onClose={close} width={420}>
      <div className="auth-modal-content">
        {errorMessage && (
          <div className="auth-alert error">
            <AlertCircle size={15} />
            <span>{errorMessage}</span>
          </div>
        )}

        {successInfo && (
          <div className="auth-alert success">
            <CheckCircle2 size={15} />
            <span>{successInfo}</span>
          </div>
        )}

        {/* 1. LOGIN VIEW */}
        {view === "login" && (
          <div className="col" style={{ gap: 14 }}>
            {/* Google OAuth button */}
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
                    onClick={() => setView("forgot_password")}
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
              Hesabınız yok mu?{" "}
              <button
                type="button"
                className="link-btn bold"
                onClick={() => setView("register")}
              >
                14 Gün Ücretsiz Başlayın
              </button>
            </div>
          </div>
        )}

        {/* 2. REGISTER VIEW */}
        {view === "register" && (
          <div className="col" style={{ gap: 14 }}>
            {/* Promo banner */}
            <div className="auth-trial-promo">
              <Sparkles size={16} className="auth-promo-icon" />
              <div>
                <strong>{t("authTrialTitle")}</strong>
                <p
                  className="faint"
                  style={{ fontSize: 12, margin: "2px 0 0 0" }}
                >
                  Tüm cihazlarınızda (Masaüstü & Mobil) anlık senkronizasyon ve
                  ilk 7 güne özel %40 indirim hakkı.
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
                {loading ? t("authCreating") : t("authStartMyAccount")}
              </button>
            </form>

            <div className="auth-footer-text">
              Zaten hesabınız var mı?{" "}
              <button
                type="button"
                className="link-btn bold"
                onClick={() => setView("login")}
              >
                Giriş Yapın
              </button>
            </div>
          </div>
        )}

        {/* 3. FORGOT PASSWORD VIEW */}
        {view === "forgot_password" && (
          <div className="col" style={{ gap: 14 }}>
            <p className="faint" style={{ fontSize: 13 }}>
              Kayıtlı e-posta adresinizi girin. Şifrenizi sıfırlayabileceğiniz
              güvenli bir bağlantı göndereceğiz.
            </p>

            <form
              onSubmit={handleResetPassword}
              className="col"
              style={{ gap: 10 }}
            >
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
                onClick={() => setView("login")}
              >
                {t("authBackToLogin")}
              </button>
            </div>
          </div>
        )}

        {view === "new_password" && (
          <div className="col" style={{ gap: 14 }}>
            <p className="faint" style={{ fontSize: 13, lineHeight: 1.5 }}>
              E-postanıza gelen 6 haneli kodu girin ve yeni şifrenizi belirleyin.
              Kod gelmediyse spam klasörünü kontrol edin.
            </p>

            <form onSubmit={handleNewPassword} className="col" style={{ gap: 10 }}>
              <div className="field">
                <label className="field-label">E-posta</label>
                <div className="input-icon-wrap">
                  <Mail size={15} className="input-icon" />
                  <input
                    type="email"
                    className="input auth-input"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className="field">
                <label className="field-label">{t("authCode")}</label>
                <input
                  className="input auth-input auth-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  placeholder="123456"
                  autoFocus
                  value={recoveryCode}
                  onChange={(e) => setRecoveryCode(e.target.value)}
                />
              </div>

              <div className="field">
                <label className="field-label">{t("authNewPassword")}</label>
                <div className="input-icon-wrap">
                  <KeyRound size={15} className="input-icon" />
                  <input
                    type="password"
                    className="input auth-input"
                    placeholder={t("passwordMin")}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>
              </div>

              <div className="field">
                <label className="field-label">{t("authNewPasswordAgain")}</label>
                <div className="input-icon-wrap">
                  <KeyRound size={15} className="input-icon" />
                  <input
                    type="password"
                    className="input auth-input"
                    required
                    value={newPasswordAgain}
                    onChange={(e) => setNewPasswordAgain(e.target.value)}
                  />
                </div>
              </div>

              {localError ? (
                <p style={{ color: "var(--danger)", fontSize: 12.5, margin: 0 }}>
                  {localError}
                </p>
              ) : null}

              <button
                type="submit"
                className="btn primary auth-submit-btn"
                disabled={loading || !newPassword}
              >
                {loading ? t("authSaving") : t("authUpdatePassword")}
              </button>
            </form>

            <div className="auth-footer-text">
              <button
                type="button"
                className="link-btn"
                onClick={() => void resetPassword(email.trim())}
                disabled={loading || !email.trim()}
              >
                Kodu tekrar gönder
              </button>
              {" · "}
              <button
                type="button"
                className="link-btn bold"
                onClick={() => setView("login")}
              >
                Giriş Ekranı
              </button>
            </div>
          </div>
        )}

        {/* 4. PROFILE VIEW */}
        {view === "profile" && user && (
          <div className="col" style={{ gap: 16 }}>
            <div className="auth-profile-card">
              <div className="auth-profile-avatar">
                {user.avatarUrl ? (
                  <img src={user.avatarUrl} alt={user.fullName ?? "User"} />
                ) : (
                  <span>
                    {(user.fullName || user.email || "U")
                      .charAt(0)
                      .toUpperCase()}
                  </span>
                )}
              </div>
              <div className="grow truncate">
                <h3 className="auth-profile-name truncate">
                  {user.fullName ?? t("authUser")}
                </h3>
                <p className="auth-profile-email truncate faint">
                  {user.email}
                </p>
              </div>
            </div>

            {/* Subscription status banner */}
            <div className="card" style={{ padding: 12 }}>
              <div
                className="row"
                style={{ justifyContent: "space-between", marginBottom: 6 }}
              >
                <span
                  className="row"
                  style={{ gap: 4, fontWeight: 650, fontSize: 13 }}
                >
                  <Crown size={14} style={{ color: "#f59e0b" }} />
                  {t(getSubscriptionStatusLabel(trial).badgeKey as TranslationKey, getSubscriptionStatusLabel(trial).params)}
                </span>
                {!trial.isPro && (
                  <button
                    type="button"
                    className="btn sm primary"
                    onClick={() => setView("pricing")}
                  >
                    Yükselt
                  </button>
                )}
              </div>
              <p className="faint" style={{ fontSize: 12, margin: 0 }}>
                {t(getSubscriptionStatusLabel(trial).descriptionKey as TranslationKey, getSubscriptionStatusLabel(trial).params)}
              </p>
            </div>

            <form
              onSubmit={handleUpdateProfile}
              className="col"
              style={{ gap: 10 }}
            >
              <div className="field">
                <label className="field-label">{t("fullName")}</label>
                <input
                  type="text"
                  className="input"
                  defaultValue={user.fullName ?? ""}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={t("fullNamePlaceholder")}
                />
              </div>

              <button type="submit" className="btn primary" disabled={loading}>
                Profili Kaydet
              </button>
            </form>

            <div
              className="row"
              style={{
                justifyContent: "space-between",
                borderTop: "1px solid var(--border)",
                paddingTop: 12,
              }}
            >
              <button
                type="button"
                className="btn danger ghost"
                onClick={() => signOut()}
              >
                <LogOut size={14} /> Çıkış Yap
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setView("pricing")}
              >
                Planları İncele
              </button>
            </div>
          </div>
        )}

        {/* 5. PRICING VIEW */}
        {view === "pricing" && (
          <div className="col" style={{ gap: 14 }}>
            {/* Trial Status Header */}
            <div className="pricing-status-header">
              <span className="pricing-status-pill">
                {t(getSubscriptionStatusLabel(trial).badgeKey as TranslationKey, getSubscriptionStatusLabel(trial).params)}
              </span>
              {trial.isEarlyBirdEligible && (
                <span className="pricing-discount-pill">
                  🔥 %40 Erken İndirim ({trial.earlyBirdDaysLeft} gün kaldı)
                </span>
              )}
            </div>

            {/* Plans comparison */}
            <div className="pricing-cards-grid">
              {/* Monthly Plan */}
              <div className="pricing-card">
                <div className="pricing-card-title">{t("priceMonthly")}</div>
                <div className="pricing-card-price">
                  {trial.isEarlyBirdEligible ? (
                    <>
                      <span className="pricing-old-price">₺199</span>
                      <span className="pricing-new-price">₺119</span>
                      <span className="pricing-period">{t("pricePerMonth")}</span>
                    </>
                  ) : (
                    <>
                      <span className="pricing-new-price">₺199</span>
                      <span className="pricing-period">{t("pricePerMonth")}</span>
                    </>
                  )}
                </div>
                <ul className="pricing-features">
                  <li>{t("priceFeatureSync")}</li>
                  <li>{t("priceFeatureUnlimited")}</li>
                  <li>{t("priceFeatureFocus")}</li>
                </ul>
                <button
                  type="button"
                  className="btn primary"
                  style={{ width: "100%" }}
                >
                  {trial.isEarlyBirdEligible
                    ? t("priceStartDiscount")
                    : t("priceGoPro")}
                </button>
              </div>

              {/* Annual Plan (Best Value) */}
              <div className="pricing-card highlighted">
                <div className="pricing-card-badge">{t("priceBestValue")}</div>
                <div className="pricing-card-title">{t("priceYearly")}</div>
                <div className="pricing-card-price">
                  {trial.isEarlyBirdEligible ? (
                    <>
                      <span className="pricing-old-price">₺1.990</span>
                      <span className="pricing-new-price">₺1.190</span>
                      <span className="pricing-period">{t("pricePerYear")}</span>
                    </>
                  ) : (
                    <>
                      <span className="pricing-new-price">₺1.990</span>
                      <span className="pricing-period">{t("pricePerYear")}</span>
                    </>
                  )}
                </div>
                <ul className="pricing-features">
                  <li>{t("priceFeatureTwoMonths")}</li>
                  <li>{t("priceFeatureUnlimitedSync")}</li>
                  <li>{t("priceFeatureEarlyAccess")}</li>
                </ul>
                <button
                  type="button"
                  className="btn primary"
                  style={{ width: "100%" }}
                >
                  Yıllık Avantajla Başla
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
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
