import { useEffect, useRef, useState } from "react";
import { ChevronRight, Flame, Shield, Sparkles, Star, Zap } from "lucide-react";
import { LEVEL_TIERS, type LevelInfo, type StreakInfo } from "@/domain/gamification";
import { localeTag } from "@/domain/datetime";
import { fireConfetti } from "@/lib/confetti";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { Modal } from "./primitives";

export interface LevelBadgeProps {
  levelInfo: LevelInfo;
  streaks: StreakInfo;
}

export function LevelBadge({ levelInfo, streaks }: LevelBadgeProps) {
  const { t } = useI18n();
  const [modalOpen, setModalOpen] = useState(false);
  const [levelUpNotif, setLevelUpNotif] = useState<number | null>(null);
  const prevLevelRef = useRef<number>(levelInfo.level);

  // Detect Level-Up
  useEffect(() => {
    if (levelInfo.level > prevLevelRef.current) {
      setLevelUpNotif(levelInfo.level);
      fireConfetti({ particleCount: 120 });
    }
    prevLevelRef.current = levelInfo.level;
  }, [levelInfo.level]);

  return (
    <>
      <div className="level-badge-card" onClick={() => setModalOpen(true)}>
        <div className="level-badge-top">
          <div className="level-avatar">
            <Shield size={14} className="level-shield-icon" />
            <span className="level-number">{levelInfo.level}</span>
          </div>

          <div className="level-meta grow truncate">
            <div className="level-title-row">
              <span className="level-title truncate">
                {t(levelInfo.titleKey as TranslationKey)}
              </span>
              {streaks.currentStreak > 0 && (
                <span className="level-streak-chip" title={`${streaks.currentStreak} günlük seri!`}>
                  <Flame size={11} /> {streaks.currentStreak}
                </span>
              )}
            </div>
            <div className="level-xp-text">
              {levelInfo.totalXp.toLocaleString()} XP
              <span className="level-pct">({levelInfo.progressPercent}%)</span>
            </div>
          </div>

          <ChevronRight size={13} className="level-arrow faint" />
        </div>

        <div className="level-progress-bar">
          <div
            className="level-progress-fill"
            style={{ width: `${levelInfo.progressPercent}%` }}
          />
        </div>
      </div>

      {/* Level Up Celebration Toast */}
      {levelUpNotif && (
        <div className="level-up-toast">
          <Sparkles size={20} className="level-up-sparkle" />
          <div className="grow">
            <strong>Tebrikler! Seviye Atladın! 🎉</strong>
            <div style={{ fontSize: "var(--text-xs)" }}>
              {t("levelUpBody", {
                level: levelInfo.level,
                title: t(levelInfo.titleKey as TranslationKey),
              })}
            </div>
          </div>
          <button
            type="button"
            className="btn sm primary"
            onClick={() => setLevelUpNotif(null)}
          >
            Harika!
          </button>
        </div>
      )}

      {/* Level Details Modal */}
      {modalOpen && (
        <Modal
          title={t("levelTitle")}
          onClose={() => setModalOpen(false)}
          width={480}
        >
          <div className="col" style={{ gap: 16 }}>
            <div className="level-modal-hero">
              <div className="level-modal-shield">
                <Star size={28} className="level-modal-star" />
                <span className="level-modal-lvl">
                  {t("levelShort")}
                  {levelInfo.level}
                </span>
              </div>
              <div>
                <h3 style={{ fontSize: "var(--text-xl)", fontWeight: 700 }}>
                  {t(levelInfo.titleKey as TranslationKey)}
                </h3>
                <p className="faint" style={{ fontSize: "var(--text-sm)", marginTop: 2 }}>
                  {t("levelTotalXp", {
                    xp: levelInfo.totalXp.toLocaleString(localeTag()),
                  })}
                </p>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <span>{t("levelNextProgress")}</span>
                <span className="mono">
                  {levelInfo.xpInCurrentLevel} / {levelInfo.xpNeededForNextLevel} XP
                </span>
              </div>
              <div className="level-progress-bar lg">
                <div
                  className="level-progress-fill"
                  style={{ width: `${levelInfo.progressPercent}%` }}
                />
              </div>
              <div className="faint" style={{ fontSize: "var(--text-xs)", marginTop: 6 }}>
                {levelInfo.nextLevelXp === Infinity
                  ? t("levelMaxed")
                  : t("levelXpToNext", {
                      xp:
                        levelInfo.xpNeededForNextLevel -
                        levelInfo.xpInCurrentLevel,
                    })}
              </div>
            </div>

            <div className="row" style={{ gap: 8 }}>
              <div className="stat grow">
                <div className="value">
                  {streaks.currentStreak} {t("dayUnit")}
                </div>
                <div className="label">{t("levelStreakCurrent")}</div>
              </div>
              <div className="stat grow">
                <div className="value">
                  {streaks.longestStreak} {t("dayUnit")}
                </div>
                <div className="label">{t("levelStreakLongest")}</div>
              </div>
              <div className="stat grow">
                <div className="value">{streaks.totalActiveDays}</div>
                <div className="label">{t("levelActiveDays")}</div>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <span>{t("levelHowToEarn")}</span>
              </div>
              <div className="col" style={{ gap: 6, fontSize: "var(--text-sm)" }}>
                <div className="row">
                  <Zap size={14} style={{ color: "var(--accent)" }} />
                  <span className="grow">{t("levelXpPerTask")}</span>
                  <strong className="mono">+10 XP</strong>
                </div>
                <div className="row">
                  <Flame size={14} style={{ color: "var(--warning)" }} />
                  <span className="grow">{t("levelXpPerFocus")}</span>
                  <strong className="mono">+20 XP</strong>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <span>{t("levelRoadmap")}</span>
              </div>
              <div className="col" style={{ gap: 4, maxHeight: 180, overflowY: "auto" }}>
                {LEVEL_TIERS.map((tier) => {
                  const isCurrent = tier.level === levelInfo.level;
                  const isUnlocked = levelInfo.totalXp >= tier.minXp;

                  return (
                    <div
                      key={tier.level}
                      className={`row level-tier-row ${isCurrent ? "is-current" : ""} ${
                        isUnlocked ? "is-unlocked" : "is-locked"
                      }`}
                      style={{ fontSize: "var(--text-xs)", padding: "4px 8px", borderRadius: 4 }}
                    >
                      <span style={{ fontWeight: 600, minWidth: 46 }}>
                        {t("levelShort")}
                        {tier.level}
                      </span>
                      <span className="grow truncate">
                        {t(tier.titleKey as TranslationKey)}
                      </span>
                      <span className="faint mono" style={{ fontSize: "var(--text-2xs)" }}>
                        {tier.minXp} XP
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
