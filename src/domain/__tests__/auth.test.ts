import { describe, expect, it } from "vitest";
import {
  calculateTrialStatus,
  getSubscriptionStatusLabel,
  type UserSubscription,
} from "../auth";

describe("Subscription & Trial Calculation Domain Logic", () => {
  it("defaults to 14 days active trial and 7 days early bird when subscription is null", () => {
    const calc = calculateTrialStatus(null);
    expect(calc.isTrialActive).toBe(true);
    expect(calc.isExpired).toBe(false);
    expect(calc.isPro).toBe(false);
    expect(calc.daysLeftInTrial).toBe(14);
    expect(calc.isEarlyBirdEligible).toBe(true);
    expect(calc.earlyBirdDaysLeft).toBe(7);
  });

  it("calculates active trial with early bird discount correctly", () => {
    const now = new Date("2026-08-22T00:00:00Z");
    const sub: UserSubscription = {
      userId: "user-123",
      status: "TRIAL",
      planTier: "FREE",
      trialStartedAt: "2026-08-20T00:00:00Z",
      trialEndsAt: "2026-09-03T00:00:00Z",
      earlyBirdDiscountEndsAt: "2026-08-27T00:00:00Z",
      hasEarlyBirdDiscount: true,
    };

    const calc = calculateTrialStatus(sub, now);
    expect(calc.isTrialActive).toBe(true);
    expect(calc.isExpired).toBe(false);
    expect(calc.daysLeftInTrial).toBe(12);
    expect(calc.isEarlyBirdEligible).toBe(true);
    expect(calc.earlyBirdDaysLeft).toBe(5);

    const labels = getSubscriptionStatusLabel(calc);
    expect(labels.badge).toContain("12 gün kaldı");
    expect(labels.description).toContain("erken alım indirimi");
  });

  it("marks early bird expired after 7 days but trial still active for remaining 7 days", () => {
    const now = new Date("2026-08-29T00:00:00Z");
    const sub: UserSubscription = {
      userId: "user-123",
      status: "TRIAL",
      planTier: "FREE",
      trialStartedAt: "2026-08-20T00:00:00Z",
      trialEndsAt: "2026-09-03T00:00:00Z",
      earlyBirdDiscountEndsAt: "2026-08-27T00:00:00Z",
      hasEarlyBirdDiscount: true,
    };

    const calc = calculateTrialStatus(sub, now);
    expect(calc.isTrialActive).toBe(true);
    expect(calc.isExpired).toBe(false);
    expect(calc.daysLeftInTrial).toBe(5);
    expect(calc.isEarlyBirdEligible).toBe(false);
    expect(calc.earlyBirdDaysLeft).toBe(0);
  });

  it("marks trial expired after 14 days", () => {
    const now = new Date("2026-09-05T00:00:00Z");
    const sub: UserSubscription = {
      userId: "user-123",
      status: "TRIAL",
      planTier: "FREE",
      trialStartedAt: "2026-08-20T00:00:00Z",
      trialEndsAt: "2026-09-03T00:00:00Z",
      earlyBirdDiscountEndsAt: "2026-08-27T00:00:00Z",
      hasEarlyBirdDiscount: true,
    };

    const calc = calculateTrialStatus(sub, now);
    expect(calc.isTrialActive).toBe(false);
    expect(calc.isExpired).toBe(true);
    expect(calc.isPro).toBe(false);
    expect(calc.daysLeftInTrial).toBe(0);

    const labels = getSubscriptionStatusLabel(calc);
    expect(labels.badge).toContain("Deneme Süresi Doldu");
  });

  it("recognizes PRO_ACTIVE subscription", () => {
    const sub: UserSubscription = {
      userId: "user-123",
      status: "PRO_ACTIVE",
      planTier: "PRO_ANNUAL",
      trialStartedAt: "2026-08-01T00:00:00Z",
      trialEndsAt: "2026-08-15T00:00:00Z",
      earlyBirdDiscountEndsAt: "2026-08-08T00:00:00Z",
      hasEarlyBirdDiscount: false,
    };

    const calc = calculateTrialStatus(sub);
    expect(calc.isPro).toBe(true);
    expect(calc.isTrialActive).toBe(false);
    expect(calc.isExpired).toBe(false);

    const labels = getSubscriptionStatusLabel(calc);
    expect(labels.badge).toContain("Tempo Pro");
  });
});
