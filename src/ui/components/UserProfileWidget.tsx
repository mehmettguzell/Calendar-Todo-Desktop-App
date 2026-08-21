import { Cloud, Crown, LogIn } from "lucide-react";
import { useAuthStore, useTrialStatus } from "@/state/authStore";

export function UserProfileWidget() {
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
        title="Giriş yap ve cihazlar arasında eşitle"
      >
        <div className="sidebar-auth-guest-icon">
          <Cloud size={14} />
        </div>
        <div className="grow truncate">
          <div className="sidebar-auth-guest-title">Giriş Yap / Kaydol</div>
          <div className="sidebar-auth-guest-sub truncate">
            Masaüstü & Mobil Eşitleme
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
      title="Profil & Abonelik Detayları"
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
          {trial.isPro ? (
            <Crown size={12} style={{ color: "#f59e0b", flexShrink: 0 }} />
          ) : trial.isEarlyBirdEligible ? (
            <span
              className="sidebar-early-badge"
              title="İlk hafta %40 indirim aktif!"
            >
              %40 İndirim
            </span>
          ) : null}
        </div>
        <div className="sidebar-user-sub faint truncate">
          {trial.isPro
            ? "Tempo Pro"
            : trial.isExpired
              ? "Deneme Süresi Bitti"
              : `${trial.daysLeftInTrial} gün deneme`}
        </div>
      </div>
    </div>
  );
}
