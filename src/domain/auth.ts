/**
 * Authentication, User Profiles, and 14-Day Free Trial & Pricing Domain Logic
 */

export type SubscriptionStatus =
  | "TRIAL"
  | "PRO_ACTIVE"
  | "EXPIRED"
  | "CANCELLED";

export type PlanTier = "FREE" | "PRO_MONTHLY" | "PRO_ANNUAL" | "LIFETIME";

export interface UserProfile {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface UserSubscription {
  userId: string;
  status: SubscriptionStatus;
  planTier: PlanTier;
  trialStartedAt: string;
  trialEndsAt: string;
  earlyBirdDiscountEndsAt: string;
  hasEarlyBirdDiscount: boolean;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}

export interface TrialCalculation {
  status: SubscriptionStatus;
  planTier: PlanTier;
  isPro: boolean;
  isTrialActive: boolean;
  isExpired: boolean;
  daysLeftInTrial: number;
  hoursLeftInTrial: number;
  isEarlyBirdEligible: boolean;
  earlyBirdDaysLeft: number;
  earlyBirdHoursLeft: number;
}

/**
 * Calculates accurate trial remaining time and early bird discount eligibility.
 */
export function calculateTrialStatus(
  subscription: UserSubscription | null,
  now: Date = new Date(),
): TrialCalculation {
  if (!subscription) {
    // Default offline/guest trial state (14 days)
    return {
      status: "TRIAL",
      planTier: "FREE",
      isPro: false,
      isTrialActive: true,
      isExpired: false,
      daysLeftInTrial: 14,
      hoursLeftInTrial: 14 * 24,
      isEarlyBirdEligible: true,
      earlyBirdDaysLeft: 7,
      earlyBirdHoursLeft: 7 * 24,
    };
  }

  const isPro = subscription.status === "PRO_ACTIVE";
  if (isPro) {
    return {
      status: "PRO_ACTIVE",
      planTier: subscription.planTier,
      isPro: true,
      isTrialActive: false,
      isExpired: false,
      daysLeftInTrial: 0,
      hoursLeftInTrial: 0,
      isEarlyBirdEligible: false,
      earlyBirdDaysLeft: 0,
      earlyBirdHoursLeft: 0,
    };
  }

  const currentTime = now.getTime();
  const trialEndTime = new Date(subscription.trialEndsAt).getTime();
  const earlyBirdEndTime = new Date(
    subscription.earlyBirdDiscountEndsAt,
  ).getTime();

  const trialDiffMs = trialEndTime - currentTime;
  const earlyBirdDiffMs = earlyBirdEndTime - currentTime;

  const isTrialActive =
    trialDiffMs > 0 &&
    subscription.status !== "EXPIRED" &&
    subscription.status !== "CANCELLED";
  const isExpired = !isTrialActive && !isPro;

  const daysLeftInTrial = Math.max(
    0,
    Math.ceil(trialDiffMs / (1000 * 60 * 60 * 24)),
  );
  const hoursLeftInTrial = Math.max(
    0,
    Math.ceil(trialDiffMs / (1000 * 60 * 60)),
  );

  const isEarlyBirdEligible =
    subscription.hasEarlyBirdDiscount && earlyBirdDiffMs > 0 && isTrialActive;
  const earlyBirdDaysLeft = Math.max(
    0,
    Math.ceil(earlyBirdDiffMs / (1000 * 60 * 60 * 24)),
  );
  const earlyBirdHoursLeft = Math.max(
    0,
    Math.ceil(earlyBirdDiffMs / (1000 * 60 * 60)),
  );

  return {
    status: isExpired ? "EXPIRED" : subscription.status,
    planTier: subscription.planTier,
    isPro,
    isTrialActive,
    isExpired,
    daysLeftInTrial,
    hoursLeftInTrial,
    isEarlyBirdEligible,
    earlyBirdDaysLeft,
    earlyBirdHoursLeft,
  };
}

/**
 * Returns human-friendly Turkish labels for subscription status.
 */
export function getSubscriptionStatusLabel(calc: TrialCalculation): {
  badge: string;
  description: string;
  isUrgent: boolean;
} {
  if (calc.isPro) {
    return {
      badge: "Tempo Pro 👑",
      description:
        "Tüm cihazlarda sınırsız kullanım ve anlık senkronizasyon aktif.",
      isUrgent: false,
    };
  }

  if (calc.isExpired) {
    return {
      badge: "Deneme Süresi Doldu ⚠️",
      description:
        "Uygulamayı tüm cihazlarınızda kullanmaya devam etmek için Pro sürüme geçin.",
      isUrgent: true,
    };
  }

  if (calc.isEarlyBirdEligible) {
    return {
      badge: `Ücretsiz Deneme (${calc.daysLeftInTrial} gün kaldı)`,
      description: `🔥 İlk haftaya özel %40 erken alım indirimi aktif! (Kalan süre: ${calc.earlyBirdDaysLeft} gün)`,
      isUrgent: calc.earlyBirdDaysLeft <= 2,
    };
  }

  return {
    badge: `Ücretsiz Deneme (${calc.daysLeftInTrial} gün kaldı)`,
    description: "14 günlük ücretsiz deneme sürümünüz devam ediyor.",
    isUrgent: calc.daysLeftInTrial <= 3,
  };
}
