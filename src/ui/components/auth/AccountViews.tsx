import { Crown, LogOut } from "lucide-react";
import { getSubscriptionStatusLabel } from "@/domain/auth";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { useAuthStore, useTrialStatus } from "@/state/authStore";
import { Avatar } from "../Avatar";
import type { AuthViewProps } from "./modalViews";

/** The signed-in account: who you are, what you are on, and the way out. */
export function ProfileView({ draft, onView, onInfo }: AuthViewProps) {
  const { t } = useI18n();
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const signOut = useAuthStore((s) => s.signOut);
  const close = useAuthStore((s) => s.closeAuthModal);
  if (!user) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.fullName.trim()) return;
    if (!(await updateProfile(draft.fullName.trim()))) return;
    onInfo(t("authProfileUpdated"));
    setTimeout(() => close(), 1200);
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="auth-profile-card">
        <Avatar
          className="auth-profile-avatar"
          src={user.avatarUrl}
          name={user.fullName || user.email}
        />
        <div className="grow truncate">
          <h3 className="auth-profile-name truncate">
            {user.fullName ?? t("authUser")}
          </h3>
          <p className="auth-profile-email truncate faint">{user.email}</p>
        </div>
      </div>

      <SubscriptionBanner onView={onView} />

      <form onSubmit={submit} className="col" style={{ gap: 10 }}>
        <div className="field">
          <label className="field-label">{t("fullName")}</label>
          <input
            type="text"
            className="input"
            defaultValue={user.fullName ?? ""}
            onChange={(e) => draft.setFullName(e.target.value)}
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
        <button type="button" className="btn danger ghost" onClick={() => signOut()}>
          <LogOut size={14} /> Çıkış Yap
        </button>
        <button type="button" className="btn" onClick={() => onView("pricing")}>
          Planları İncele
        </button>
      </div>
    </div>
  );
}

function SubscriptionBanner({ onView }: Pick<AuthViewProps, "onView">) {
  const { t } = useI18n();
  const trial = useTrialStatus();
  const status = getSubscriptionStatusLabel(trial);

  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
        <span
          className="row"
          style={{ gap: 4, fontWeight: 650, fontSize: "var(--text-sm)" }}
        >
          <Crown size={14} style={{ color: "#f59e0b" }} />
          {t(status.badgeKey as TranslationKey, status.params)}
        </span>
        {!trial.isPro ? (
          <button
            type="button"
            className="btn sm primary"
            onClick={() => onView("pricing")}
          >
            Yükselt
          </button>
        ) : null}
      </div>
      <p className="faint" style={{ fontSize: "var(--text-xs)", margin: 0 }}>
        {t(status.descriptionKey as TranslationKey, status.params)}
      </p>
    </div>
  );
}

export function PricingView() {
  const { t } = useI18n();
  const trial = useTrialStatus();
  const status = getSubscriptionStatusLabel(trial);

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="pricing-status-header">
        <span className="pricing-status-pill">
          {t(status.badgeKey as TranslationKey, status.params)}
        </span>
        {trial.isEarlyBirdEligible ? (
          <span className="pricing-discount-pill">
            🔥 %40 Erken İndirim ({trial.earlyBirdDaysLeft} gün kaldı)
          </span>
        ) : null}
      </div>

      <div className="pricing-cards-grid">
        <PricingCard
          title={t("priceMonthly")}
          fullPrice="₺199"
          offerPrice="₺119"
          period={t("pricePerMonth")}
          discounted={trial.isEarlyBirdEligible}
          features={[
            t("priceFeatureSync"),
            t("priceFeatureUnlimited"),
            t("priceFeatureFocus"),
          ]}
          cta={
            trial.isEarlyBirdEligible ? t("priceStartDiscount") : t("priceGoPro")
          }
        />

        <PricingCard
          highlighted
          badge={t("priceBestValue")}
          title={t("priceYearly")}
          fullPrice="₺1.990"
          offerPrice="₺1.190"
          period={t("pricePerYear")}
          discounted={trial.isEarlyBirdEligible}
          features={[
            t("priceFeatureTwoMonths"),
            t("priceFeatureUnlimitedSync"),
            t("priceFeatureEarlyAccess"),
          ]}
          cta="Yıllık Avantajla Başla"
        />
      </div>
    </div>
  );
}

function PricingCard({
  title,
  badge,
  fullPrice,
  offerPrice,
  period,
  discounted,
  features,
  cta,
  highlighted = false,
}: {
  title: string;
  badge?: string;
  fullPrice: string;
  offerPrice: string;
  period: string;
  discounted: boolean;
  features: string[];
  cta: string;
  highlighted?: boolean;
}) {
  return (
    <div className={highlighted ? "pricing-card highlighted" : "pricing-card"}>
      {badge ? <div className="pricing-card-badge">{badge}</div> : null}
      <div className="pricing-card-title">{title}</div>
      <div className="pricing-card-price">
        {discounted ? <span className="pricing-old-price">{fullPrice}</span> : null}
        <span className="pricing-new-price">
          {discounted ? offerPrice : fullPrice}
        </span>
        <span className="pricing-period">{period}</span>
      </div>
      <ul className="pricing-features">
        {features.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
      <button type="button" className="btn primary" style={{ width: "100%" }}>
        {cta}
      </button>
    </div>
  );
}
