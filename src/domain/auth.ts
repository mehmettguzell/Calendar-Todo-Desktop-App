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
  role?: "USER" | "ADMIN";
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
/**
 * Subscription state as keys, not sentences.
 *
 * The badge and the description are two halves of one message, so they travel
 * together; the words are chosen by whichever dictionary is loaded.
 */
export function getSubscriptionStatusLabel(calc: TrialCalculation): {
  badgeKey: string;
  descriptionKey: string;
  params?: Record<string, string | number>;
  isUrgent: boolean;
} {
  if (calc.isPro) {
    return {
      badgeKey: "subProBadge",
      descriptionKey: "subProDesc",
      isUrgent: false,
    };
  }

  if (calc.isExpired) {
    return {
      badgeKey: "subExpiredBadge",
      descriptionKey: "subExpiredDesc",
      isUrgent: true,
    };
  }

  if (calc.isEarlyBirdEligible) {
    return {
      badgeKey: "subTrialBadge",
      descriptionKey: "subEarlyBirdDesc",
      params: { days: calc.daysLeftInTrial, earlyBirdDays: calc.earlyBirdDaysLeft },
      isUrgent: calc.earlyBirdDaysLeft <= 2,
    };
  }

  return {
    badgeKey: "subTrialBadge",
    descriptionKey: "subTrialDesc",
    params: { days: calc.daysLeftInTrial },
    isUrgent: calc.daysLeftInTrial <= 3,
  };
}


/* ------------------------------------------------------------------ */
/* Who is signed in                                                    */
/* ------------------------------------------------------------------ */

/**
 * Just enough of a Supabase auth user for this file to read.
 *
 * Structural rather than imported so the rules below can be exercised without
 * a client, a session or a network — which is the whole reason they are here
 * and not inline in the store.
 */
export interface AuthUserLike {
  id: string;
  email?: string | null;
  created_at?: string;
  user_metadata?: Record<string, unknown> | null;
}

/** One row of `public.profiles`, as PostgREST hands it back. */
export interface ProfileRow {
  id?: string | null;
  email?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
  role?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** A value the row actually has something to say about. */
function said(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * The picture the identity provider handed over, whichever key it used.
 *
 * Google puts it in `picture`, and Supabase usually — but not always — copies
 * it to `avatar_url` as well; GitHub sends `avatar_url` only. Reading one key
 * is how a signed-in Google user ends up looking at a grey circle with their
 * initial in it.
 */
export function avatarFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  if (!metadata) return null;
  return (
    said(metadata.avatar_url) ??
    said(metadata.picture) ??
    said(metadata.avatar) ??
    null
  );
}

/**
 * Who the session says is signed in.
 *
 * The session is the only thing about an account that is on this machine, and
 * it already carries the name, the e-mail and the provider's picture. Deriving
 * the profile from it means the sidebar is right the instant the app opens —
 * offline included — instead of empty until a request comes back.
 *
 * What is already known wins, and the session fills the gaps. That order
 * matters because this also runs on every token refresh: the other way round,
 * a refresh an hour into the session would quietly put the provider's name
 * back over the one the user had just changed in their profile, and drop the
 * role, which only the stored row knows. `previous` is trusted only when it
 * describes the same person.
 */
export function profileFromAuthUser(
  authUser: AuthUserLike,
  previous?: UserProfile | null,
): UserProfile {
  const metadata = authUser.user_metadata ?? null;
  const known = previous && previous.id === authUser.id ? previous : null;
  const email = known?.email || said(authUser.email) || "";
  return {
    id: authUser.id,
    email,
    fullName:
      known?.fullName ??
      said(metadata?.full_name) ??
      said(metadata?.name) ??
      said(email.split("@")[0]),
    avatarUrl: known?.avatarUrl ?? avatarFromMetadata(metadata) ?? null,
    role: known?.role,
    createdAt:
      known?.createdAt ?? authUser.created_at ?? new Date().toISOString(),
    updatedAt: known?.updatedAt,
  };
}

/**
 * The stored row laid over what is already known — never instead of it.
 *
 * This used to be a straight replacement, and that is why a profile picture
 * came and went: signing in put the provider's picture on screen from the
 * session, and a few hundred milliseconds later the `profiles` row — whose
 * `avatar_url` is null for every account created before the picture existed —
 * replaced the whole user and blanked it. Offline, the fetch never landed and
 * the picture stayed. Same account, same build, two different answers
 * depending on the network.
 *
 * A null column means the row has nothing to say about that field, not that
 * the field should be emptied.
 */
export function mergeProfileRow(
  base: UserProfile,
  row: ProfileRow | null | undefined,
): UserProfile {
  if (!row) return base;
  const role = said(row.role);
  return {
    ...base,
    id: said(row.id) ?? base.id,
    email: said(row.email) ?? base.email,
    fullName: said(row.full_name) ?? base.fullName,
    avatarUrl: said(row.avatar_url) ?? base.avatarUrl,
    role: role === "ADMIN" || role === "USER" ? role : base.role,
    createdAt: said(row.created_at) ?? base.createdAt,
    updatedAt: said(row.updated_at) ?? base.updatedAt,
  };
}

/**
 * The picture the row is missing and the session has, or `null`.
 *
 * Worth writing back: it is what makes the account's other devices — and the
 * next cold start, which has no provider metadata to fall back on until the
 * session is read — show the same face.
 */
export function avatarToBackfill(
  merged: UserProfile,
  row: ProfileRow | null | undefined,
): string | null {
  if (!merged.avatarUrl) return null;
  return said(row?.avatar_url) === null ? merged.avatarUrl : null;
}
