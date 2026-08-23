import { Cloud, Crown, LogIn } from "lucide-react";
import { useAuthStore, useTrialStatus } from "@/state/authStore";
import { useI18n } from "@/lib/i18n";

export function UserProfileWidget() {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);
  const openAuthModal = useAuthStore((s) => s.openAuthModal);
  const trial = useTrialStatus();

  if (!user) {
    return (
      <div
        className="sidebar-auth-guest-card"
        onClick={() => openAuthModal("login")}
        role="button"
        tabIndex={0}
        title={t("signInSync")}
      >
        <div className="sidebar-auth-guest-icon">
          <Cloud size={14} />
        </div>
        <div className="grow truncate">
          <div className="sidebar-auth-guest-title">{t("authGuestTitle")}</div>
          <div className="sidebar-auth-guest-sub truncate">
            {t("authGuestSub")}
          </div>
        </div>
        <LogIn size={13} className="faint" />
      </div>
    );
  }

  const initial = (user.fullName || user.email || "U").charAt(0).toUpperCase();

  return (
    <div
      className="sidebar-user-card"
      onClick={() => openAuthModal("profile")}
      role="button"
      tabIndex={0}
      title={t("profileDetails")}
    >
      <div className="sidebar-user-avatar">
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt={user.fullName ?? "User"} />
        ) : (
          <span>{initial}</span>
        )}
      </div>

      <div className="grow truncate">
        <div className="sidebar-user-name-row">
          <span className="sidebar-user-name truncate">
            {user.fullName ?? user.email}
          </span>
          {user.role === "ADMIN" ? (
            <span
              className="sidebar-early-badge"
              style={{
                background: "var(--accent-soft)",
                color: "var(--accent)",
              }}
            >
              Admin 👑
            </span>
          ) : trial.isPro ? (
            <Crown size={12} style={{ color: "#f59e0b", flexShrink: 0 }} />
          ) : trial.isEarlyBirdEligible ? (
            <span
              className="sidebar-early-badge"
              title={t("earlyBirdActive")}
            >
              %40 İndirim
            </span>
          ) : null}
        </div>
        <div className="sidebar-user-sub faint truncate">
          {user.role === "ADMIN"
            ? t("roleAdmin")
            : trial.isPro
              ? t("rolePro")
              : trial.isExpired
                ? t("roleTrialOver")
                : `${trial.daysLeftInTrial} gün deneme`}
        </div>
      </div>
    </div>
  );
}
