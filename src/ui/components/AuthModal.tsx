import { useState } from "react";
import type { AuthModalView } from "@/state/authState";
import { useAuthStore } from "@/state/authStore";
import { useI18n } from "@/lib/i18n";
import { AuthAlert } from "./auth/AuthFields";
import { ProfileView, PricingView } from "./auth/AccountViews";
import {
  ForgotView,
  LoginView,
  NewPasswordView,
  RegisterView,
} from "./auth/SignInViews";
import { useAuthDraft, type AuthViewProps } from "./auth/modalViews";
import { Modal } from "./primitives";

/** Signing in, recovering a password, and the account itself, in one window. */
export function AuthModal() {
  const { t } = useI18n();
  const isOpen = useAuthStore((s) => s.authModalOpen);
  const view = useAuthStore((s) => s.authModalView);
  const close = useAuthStore((s) => s.closeAuthModal);
  const setView = useAuthStore((s) => s.setAuthModalView);
  const errorMessage = useAuthStore((s) => s.errorMessage);
  const [info, setInfo] = useState<string | null>(null);
  const draft = useAuthDraft();

  if (!isOpen) return null;

  const titles: Record<AuthModalView, string> = {
    login: t("authTitleLogin"),
    register: t("authTitleRegister"),
    forgot_password: t("authTitleForgot"),
    new_password: t("authTitleNewPassword"),
    profile: t("authTitleProfile"),
    pricing: "Abonelik & Pro Plan",
  };

  const props: AuthViewProps = { draft, onView: setView, onInfo: setInfo };

  return (
    <Modal title={titles[view]} onClose={close} width={420}>
      <div className="auth-modal-content">
        {errorMessage ? <AuthAlert kind="error" text={errorMessage} /> : null}
        {info ? <AuthAlert kind="success" text={info} /> : null}
        <CurrentView view={view} props={props} />
      </div>
    </Modal>
  );
}

function CurrentView({
  view,
  props,
}: {
  view: AuthModalView;
  props: AuthViewProps;
}) {
  switch (view) {
    case "login":
      return <LoginView {...props} />;
    case "register":
      return <RegisterView {...props} />;
    case "forgot_password":
      return <ForgotView {...props} />;
    case "new_password":
      return <NewPasswordView {...props} />;
    case "profile":
      return <ProfileView {...props} />;
    default:
      return <PricingView />;
  }
}
