import { useEffect, useRef, useState } from "react";
import { ChevronRight, Flame, Shield, Sparkles, Star, Zap } from "lucide-react";
import { LEVEL_TIERS, type LevelInfo, type StreakInfo } from "@/domain/gamification";
import { fireConfetti } from "@/lib/confetti";
import { Modal } from "./primitives";

export interface LevelBadgeProps {
  levelInfo: LevelInfo;
  streaks: StreakInfo;
}

export function LevelBadge({ levelInfo, streaks }: LevelBadgeProps) {
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
              <span className="level-title truncate">{levelInfo.title}</span>
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
            <div style={{ fontSize: 12 }}>
              Artık <strong>Level {levelInfo.level}: {levelInfo.title}</strong> unvanına sahipsin!
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
          title="Seviye & Üretkenlik İlerlemesi"
          onClose={() => setModalOpen(false)}
          width={480}
        >
          <div className="col" style={{ gap: 16 }}>
            <div className="level-modal-hero">
              <div className="level-modal-shield">
                <Star size={28} className="level-modal-star" />
                <span className="level-modal-lvl">Lv.{levelInfo.level}</span>
              </div>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 700 }}>{levelInfo.title}</h3>
                <p className="faint" style={{ fontSize: 13, marginTop: 2 }}>
                  Toplam {levelInfo.totalXp.toLocaleString()} XP topladın.
                </p>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <span>Sonraki Seviyeye İlerleme</span>
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
              <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>
                {levelInfo.nextLevelXp === Infinity
                  ? "En yüksek seviyeye ulaştın!"
                  : `Sonraki seviyeye ${levelInfo.xpNeededForNextLevel - levelInfo.xpInCurrentLevel} XP kaldı.`}
              </div>
            </div>

            <div className="row" style={{ gap: 8 }}>
              <div className="stat grow">
                <div className="value">{streaks.currentStreak} gün</div>
                <div className="label">Mevcut Seri 🔥</div>
              </div>
              <div className="stat grow">
                <div className="value">{streaks.longestStreak} gün</div>
                <div className="label">En Uzun Seri 🏆</div>
              </div>
              <div className="stat grow">
                <div className="value">{streaks.totalActiveDays}</div>
                <div className="label">Aktif Gün ⚡</div>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <span>XP Nasıl Kazanılır?</span>
              </div>
              <div className="col" style={{ gap: 6, fontSize: 13 }}>
                <div className="row">
                  <Zap size={14} style={{ color: "var(--accent)" }} />
                  <span className="grow">Tamamlanan her görev:</span>
                  <strong className="mono">+10 XP</strong>
                </div>
                <div className="row">
                  <Flame size={14} style={{ color: "var(--warning)" }} />
                  <span className="grow">Her Odaklanma (Focus) seansı:</span>
                  <strong className="mono">+20 XP</strong>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <span>Seviye Yol Haritası</span>
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
                      style={{ fontSize: 12.5, padding: "4px 8px", borderRadius: 4 }}
                    >
                      <span style={{ fontWeight: 600, minWidth: 46 }}>Lv.{tier.level}</span>
                      <span className="grow truncate">{tier.title}</span>
                      <span className="faint mono" style={{ fontSize: 11 }}>
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
