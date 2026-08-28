import { useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { formatErrorMessage, type SyncFailureKind } from "@/lib/errors";
import { localeTag } from "@/domain/datetime";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { useAuthStore } from "@/state/authStore";
import type { Filters } from "@/state/selectors";
import { syncDifferences } from "@/state/syncEngine";
import { useSyncStore, type SkippedRow, type SyncPhase } from "@/state/syncStore";
import type { CalendarMode } from "./views/CalendarView";
import type { ViewId } from "./Sidebar";
import { Switch } from "./components/primitives";

const MODES: { id: CalendarMode; labelKey: TranslationKey }[] = [
  { id: "month", labelKey: "calMonth" },
  { id: "week", labelKey: "calWeek" },
  { id: "day", labelKey: "calDay" },
];

/**
 * "Sync with server", with the outcome always visible.
 *
 * Three things this has to get right, because they are the ways a sync button
 * loses the user's trust: it must never spin forever (every request carries a
 * timeout), it must say what went wrong rather than fail silently, and it must
 * make clear that being offline is not data loss — local edits are already
 * saved and will go up on their own.
 */
function SyncButton() {
  const [feedback, setFeedback] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);
  const user = useAuthStore((s) => s.user);
  const session = useAuthStore((s) => s.session);
  const openAuthModal = useAuthStore((s) => s.openAuthModal);
  const phase = useSyncStore((s) => s.phase);
  const pending = useSyncStore((s) => s.pendingWrites);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);
  const lastFailure = useSyncStore((s) => s.lastFailure);
  const autoRetryPaused = useSyncStore((s) => s.autoRetryPaused);
  const realtime = useSyncStore((s) => s.realtime);
  const skipped = useSyncStore((s) => s.skipped);
  const { t } = useI18n();

  const syncing = phase === "syncing";

  const handleSync = async () => {
    const isAuthed = Boolean(user || session?.user);
    if (!isAuthed) {
      openAuthModal("login");
      return;
    }

    setFeedback(null);
    // `syncDifferences` resolves with a report instead of throwing, and every
    // request inside it is bounded, so there is no path where this never
    // returns. The try/catch is for the impossible one.
    try {
      // Manual: the press is the condition that revives a paused retry budget.
      const report = await syncDifferences({ manual: true });
      if (!report.success) {
        setFeedback(
          report.error === "offline"
            ? { type: "info", text: t("syncOfflineNotice") }
            : { type: "error", text: t(syncFailureKey(report.error ?? "unknown")) },
        );
      } else if (report.totalDifferences === 0) {
        setFeedback({ type: "success", text: t("syncUpToDate") });
      } else {
        const parts: string[] = [];
        if (report.uploadedTasks > 0) parts.push(`${report.uploadedTasks} ${t("syncTasksUp")}`);
        if (report.downloadedTasks > 0) parts.push(`${report.downloadedTasks} ${t("syncTasksDown")}`);
        if (report.uploadedCategories > 0) parts.push(`${report.uploadedCategories} ${t("syncCatsUp")}`);
        if (report.downloadedCategories > 0) parts.push(`${report.downloadedCategories} ${t("syncCatsDown")}`);
        setFeedback({ type: "success", text: `${t("syncSuccess")} ${parts.join(", ")}` });
      }
    } catch (err: unknown) {
      // The reason belongs in the console; the user gets a sentence, not a
      // Postgres message naming our tables and columns.
      console.error("[tempo sync] manual sync failed:", formatErrorMessage(err));
      setFeedback({ type: "error", text: t("syncFailed") });
    } finally {
      setTimeout(() => setFeedback(null), 5000);
    }
  };

  const status = describeSyncStatus(
    { phase, pending, lastSyncedAt, lastFailure, autoRetryPaused, realtime, skipped },
    t,
  );

  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <button
        type="button"
        className="btn ghost sm sync-btn"
        onClick={handleSync}
        disabled={syncing}
        title={status.tooltip}
        style={{
          gap: 6,
          fontWeight: 500,
          border: "1px solid var(--border)",
          padding: "5px 11px",
          borderRadius: "var(--radius-md)",
        }}
      >
        <span
          className="sync-dot"
          aria-hidden
          style={{ background: status.color }}
        />
        <RefreshCw
          size={14}
          style={{ animation: syncing ? "spin 1s linear infinite" : undefined }}
        />
        <span>{syncing ? t("syncing") : t("syncWithServer")}</span>
        {pending > 0 && !syncing ? (
          <span className="sync-pending" title={t("syncPendingHint")}>
            {pending}
          </span>
        ) : null}
      </button>

      {feedback && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            zIndex: 1000,
            background: feedback.type === "error" ? "var(--danger, #ef4444)" : "var(--surface, #1e2024)",
            color: feedback.type === "error" ? "#fff" : "var(--text, #fff)",
            border: "1px solid var(--border, #333)",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 12,
            maxWidth: 340,
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            animation: "fadeIn 0.2s ease",
          }}
        >
          {feedback.type === "success" && <Check size={14} color="#10b981" />}
          {feedback.type === "error" && <AlertCircle size={14} style={{ flex: "none" }} />}
          {feedback.type === "info" && <CloudOff size={14} style={{ flex: "none" }} />}
          <span>{feedback.text}</span>
        </div>
      )}
    </div>
  );
}

/**
 * The one sentence a failure kind is allowed to become.
 *
 * Deliberately vague about the backend: what the user can act on is "your data
 * is safe here and we will try again", plus a nudge when only they can fix it.
 */
function syncFailureKey(kind: SyncFailureKind): TranslationKey {
  switch (kind) {
    case "offline":
    case "timeout":
      return "syncFailNetwork";
    case "server":
      return "syncFailServer";
    case "auth":
      return "syncFailAccount";
    default:
      return "syncFailed";
  }
}

/** One colour and one sentence for whatever the sync layer is doing. */
function describeSyncStatus(
  s: {
    phase: SyncPhase;
    pending: number;
    lastSyncedAt: number | null;
    lastFailure: SyncFailureKind | null;
    autoRetryPaused: boolean;
    realtime: "connected" | "connecting" | "down";
    skipped: SkippedRow[];
  },
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): { color: string; tooltip: string } {
  const last =
    s.lastSyncedAt !== null
      ? `${t("syncLastAt")} ${new Date(s.lastSyncedAt).toLocaleTimeString(localeTag(), {
          hour: "2-digit",
          minute: "2-digit",
        })}`
      : t("syncNeverYet");

  switch (s.phase) {
    case "syncing":
      return { color: "#3b82f6", tooltip: t("syncing") };
    case "offline":
      return { color: "#f59e0b", tooltip: `${t("syncOfflineNotice")} · ${last}` };
    case "error":
      return {
        color: "#ef4444",
        tooltip:
          `${t(syncFailureKey(s.lastFailure ?? "unknown"))} · ${last}` +
          (s.autoRetryPaused ? ` · ${t("syncRetryPaused")}` : ""),
      };
    case "disabled":
      return { color: "var(--text-faint)", tooltip: t("syncLoginRequired") };
    default: {
      // A pass that finished but left rows behind is not a green light. The
      // rows are safe locally — that is the whole point of dropping them from
      // the batch rather than letting Postgres reject everything — but the
      // badge should not claim this device is fully in the cloud when it isn't.
      const held = s.skipped.length;
      return {
        color: held > 0 ? "#f59e0b" : s.realtime === "connected" ? "#10b981" : "#94a3b8",
        tooltip:
          (s.realtime === "connected" ? `${t("syncLive")} · ` : "") +
          last +
          (s.pending > 0 ? ` · ${s.pending} ${t("syncPendingHint")}` : "") +
          (held > 0 ? ` · ${t("syncSkipped", { count: held })}` : ""),
      };
    }
  }
}

export function Topbar({
  view,
  title,
  mode,
  onMode,
  onStep,
  onToday,
  filters,
  onFilters,
  onNewTask,
}: {
  view: ViewId;
  title: string;
  mode: CalendarMode;
  onMode: (mode: CalendarMode) => void;
  onStep: (direction: 1 | -1) => void;
  onToday: () => void;
  filters: Filters;
  onFilters: (next: Filters) => void;
  onNewTask: () => void;
}) {
  const { t } = useI18n();

  return (
    <header className="topbar">
      <h1>{title}</h1>

      {view === "calendar" ? (
        <>
          <div className="row" style={{ gap: 2 }}>
            <button
              type="button"
              className="btn ghost icon"
              aria-label={t("previous")}
              onClick={() => onStep(-1)}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              className="btn ghost icon"
              aria-label={t("next")}
              onClick={() => onStep(1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <button type="button" className="btn" onClick={onToday}>
            {t("today")}
          </button>
          <div className="segmented">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={mode === m.id}
                onClick={() => onMode(m.id)}
              >
                {t(m.labelKey)}
              </button>
            ))}
          </div>
        </>
      ) : null}

      <span className="grow" />

      <label className="search">
        <Search size={14} />
        <input
          type="search"
          placeholder={t("searchTasksPlaceholder")}
          value={filters.query}
          onChange={(e) => onFilters({ ...filters, query: e.target.value })}
        />
      </label>

      <Switch
        checked={filters.showCompleted}
        label={t("done")}
        onChange={(showCompleted) => onFilters({ ...filters, showCompleted })}
      />

      <SyncButton />

      <button type="button" className="btn primary" onClick={onNewTask}>
        <Plus size={15} /> {t("newTaskBtn")}
      </button>
    </header>
  );
}
