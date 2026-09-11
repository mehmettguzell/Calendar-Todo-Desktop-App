import type { TranslationKey } from "@/lib/i18n";

// The ready-made plans the new-plan modal offers.
export interface PlanStarter {
  id: string;
  emoji: string;
  /** Which seeded category it files under, in either language. */
  categoryKey: keyof typeof STARTER_CATEGORY_NAMES;
  titleKey: TranslationKey;
  descKey: TranslationKey;
  stepKeys: TranslationKey[];
}

/**
 * A starter files itself under a seeded category, and the seeds are named in
 * whatever language the app was first opened in. Matching on both spellings
 * means a template still lands in the right place after the language is
 * switched, or on a document created before it was.
 */
export const STARTER_CATEGORY_NAMES = {
  health: ["Health", "Sağlık"],
  work: ["Work", "İş"],
  personal: ["Personal", "Kişisel"],
} as const;

export const PLAN_STARTERS: PlanStarter[] = [
  {
    id: "fitness",
    emoji: "🎯",
    categoryKey: "health",
    titleKey: "planTplFitnessTitle",
    descKey: "planTplFitnessDesc",
    stepKeys: [
      "planTplFitnessStep1",
      "planTplFitnessStep2",
      "planTplFitnessStep3",
      "planTplFitnessStep4",
    ],
  },
  {
    id: "project",
    emoji: "🚀",
    categoryKey: "work",
    titleKey: "planTplProjectTitle",
    descKey: "planTplProjectDesc",
    stepKeys: [
      "planTplProjectStep1",
      "planTplProjectStep2",
      "planTplProjectStep3",
      "planTplProjectStep4",
    ],
  },
  {
    id: "learning",
    emoji: "📚",
    categoryKey: "personal",
    titleKey: "planTplLearningTitle",
    descKey: "planTplLearningDesc",
    stepKeys: [
      "planTplLearningStep1",
      "planTplLearningStep2",
      "planTplLearningStep3",
    ],
  },
  {
    id: "habits",
    emoji: "✨",
    categoryKey: "personal",
    titleKey: "planTplHabitsTitle",
    descKey: "planTplHabitsDesc",
    stepKeys: [
      "planTplHabitsStep1",
      "planTplHabitsStep2",
      "planTplHabitsStep3",
    ],
  },
];
