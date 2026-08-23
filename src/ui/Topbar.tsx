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
import { formatErrorMessage } from "@/lib/errors";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { useAuthStore } from "@/state/authStore";
import type { Filters } from "@/state/selectors";
import { syncDifferences } from "@/state/syncEngine";
import { useSyncStore, type SyncPhase } from "@/state/syncStore";
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
  const lastError = useSyncStore((s) => s.lastError);
  const realtime = useSyncStore((s) => s.realtime);
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
      const report = await syncDifferences();
      if (!report.success) {
        setFeedback(
          report.error === "OFFLINE"
            ? { type: "info", text: t("syncOfflineNotice") }
            : { type: "error", text: report.error || t("syncFailed") },
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
      setFeedback({ type: "error", text: formatErrorMessage(err) });
    } finally {
      setTimeout(() => setFeedback(null), 5000);
    }
  };

  const status = describeSyncStatus(
    { phase, pending, lastSyncedAt, lastError, realtime },
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

/** One colour and one sentence for whatever the sync layer is doing. */
function describeSyncStatus(
  s: {
    phase: SyncPhase;
    pending: number;
    lastSyncedAt: number | null;
    lastError: string | null;
    realtime: "connected" | "connecting" | "down";
  },
  t: (key: TranslationKey) => string,
): { color: string; tooltip: string } {
  const last =
    s.lastSyncedAt !== null
      ? `${t("syncLastAt")} ${new Date(s.lastSyncedAt).toLocaleTimeString([], {
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
        tooltip: `${s.lastError ?? t("syncFailed")} · ${last}`,
      };
    case "disabled":
      return { color: "var(--text-faint)", tooltip: t("syncLoginRequired") };
    default:
      return {
        color: s.realtime === "connected" ? "#10b981" : "#94a3b8",
        tooltip:
          (s.realtime === "connected" ? `${t("syncLive")} · ` : "") +
          last +
          (s.pending > 0 ? ` · ${s.pending} ${t("syncPendingHint")}` : ""),
      };
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
              aria-label="Previous"
              onClick={() => onStep(-1)}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              className="btn ghost icon"
              aria-label="Next"
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
