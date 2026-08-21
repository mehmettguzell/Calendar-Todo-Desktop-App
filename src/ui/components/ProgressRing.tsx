import { Sparkles, Trophy } from "lucide-react";

export interface ProgressRingProps {
  completed: number;
  total: number;
  size?: number;
  strokeWidth?: number;
  onCelebrate?: () => void;
}

export function ProgressRing({
  completed,
  total,
  size = 110,
  strokeWidth = 9,
  onCelebrate,
}: ProgressRingProps) {
  const percentage =
    total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 100;
  const isAllDone = total > 0 && completed >= total;

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset =
    total === 0 ? 0 : circumference - (percentage / 100) * circumference;

  return (
    <div
      className="progress-ring-container"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="progress-ring-svg"
      >
        <defs>
          <linearGradient
            id="ringProgressGrad"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <stop offset="0%" stopColor="var(--accent)" />
            <stop
              offset="100%"
              stopColor={isAllDone ? "var(--success)" : "var(--info)"}
            />
          </linearGradient>
          <linearGradient
            id="ringSuccessGrad"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>
        </defs>

        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="var(--border)"
          strokeWidth={strokeWidth}
          fill="none"
          className="progress-ring-track"
        />

        {/* Progress bar */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={
            isAllDone ? "url(#ringSuccessGrad)" : "url(#ringProgressGrad)"
          }
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          style={{
            strokeDasharray: circumference,
            strokeDashoffset,
            transition:
              "stroke-dashoffset 600ms cubic-bezier(0.4, 0, 0.2, 1), stroke 400ms ease",
          }}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>

      <div className="progress-ring-content">
        {total === 0 ? (
          <div className="progress-ring-empty">
            <Sparkles size={22} className="progress-ring-icon faint" />
            <span className="progress-ring-sub">Temiz</span>
          </div>
        ) : isAllDone ? (
          <button
            type="button"
            className="progress-ring-done-btn"
            title="Kutlamayı tekrar oynat!"
            onClick={onCelebrate}
          >
            <Trophy size={26} className="progress-ring-icon-trophy" />
            <span className="progress-ring-pct success">100%</span>
          </button>
        ) : (
          <div className="progress-ring-text">
            <span className="progress-ring-pct">%{percentage}</span>
            <span className="progress-ring-sub">
              {completed}/{total}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
