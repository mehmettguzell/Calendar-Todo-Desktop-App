import { AlertCircle, CheckCircle2, KeyRound, Mail, User } from "lucide-react";
import { useI18n } from "@/lib/i18n";

/**
 * The pieces every auth screen is built from.
 *
 * The sign-in gate and the account modal ask the same three questions, and
 * before this they asked them in two hand-written copies apiece — which is how
 * one of them ended up with an icon the other did not have.
 */

export function AuthAlert({
  kind,
  text,
  spaced = false,
}: {
  kind: "error" | "success";
  text: string;
  /** The gate sets its own gap; the modal's stack already has one. */
  spaced?: boolean;
}) {
  return (
    <div
      className={`auth-alert ${kind}`}
      style={spaced ? { marginBottom: 12 } : undefined}
    >
      {kind === "error" ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
      <span>{text}</span>
    </div>
  );
}

export function AuthDivider() {
  const { t } = useI18n();
  return (
    <div className="auth-divider">
      <span>{t("authOrEmail")}</span>
    </div>
  );
}

export function GoogleButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="btn auth-google-btn"
      disabled={disabled}
      onClick={onClick}
    >
      <GoogleIcon />
      <span>{label}</span>
    </button>
  );
}

export function EmailField({
  value,
  onChange,
  autoFocus = false,
  placeholder = "ornek@gmail.com",
}: {
  value: string;
  onChange: (next: string) => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="field">
      <label className="field-label">E-posta</label>
      <div className="input-icon-wrap">
        <Mail size={15} className="input-icon" />
        <input
          type="email"
          className="input auth-input"
          placeholder={placeholder}
          autoFocus={autoFocus}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

export function PasswordField({
  label,
  value,
  onChange,
  action,
  minLength,
  placeholder = "••••••••",
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  /** A control on the right of the label, e.g. "forgot my password". */
  action?: React.ReactNode;
  minLength?: number;
  placeholder?: string;
}) {
  return (
    <div className="field">
      {action ? (
        <div className="row" style={{ justifyContent: "space-between" }}>
          <label className="field-label">{label}</label>
          {action}
        </div>
      ) : (
        <label className="field-label">{label}</label>
      )}
      <div className="input-icon-wrap">
        <KeyRound size={15} className="input-icon" />
        <input
          type="password"
          className="input auth-input"
          placeholder={placeholder}
          minLength={minLength}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

export function NameField({
  value,
  onChange,
  autoFocus = false,
}: {
  value: string;
  onChange: (next: string) => void;
  autoFocus?: boolean;
}) {
  const { t } = useI18n();

  return (
    <div className="field">
      <label className="field-label">{t("fullName")}</label>
      <div className="input-icon-wrap">
        <User size={15} className="input-icon" />
        <input
          type="text"
          className="input auth-input"
          placeholder={t("fullNamePlaceholder")}
          autoFocus={autoFocus}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

export function SubmitButton({
  disabled,
  children,
}: {
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      className="btn primary auth-submit-btn"
      disabled={disabled}
    >
      {children}
    </button>
  );
}

/** Links under a form: "no account yet?", "back to sign-in". */
export function AuthFooter({ children }: { children: React.ReactNode }) {
  return <div className="auth-footer-text">{children}</div>;
}

export function LinkButton({
  bold = false,
  small = false,
  disabled = false,
  onClick,
  children,
}: {
  bold?: boolean;
  small?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={bold ? "link-btn bold" : "link-btn"}
      style={small ? { fontSize: "var(--text-2xs)" } : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
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
