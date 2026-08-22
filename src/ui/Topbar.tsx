import { useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { formatErrorMessage } from "@/lib/errors";
import { useI18n } from "@/lib/i18n";
import { useAuthStore } from "@/state/authStore";
import type { Filters } from "@/state/selectors";
import { syncDifferences } from "@/state/syncEngine";
import type { CalendarMode } from "./views/CalendarView";
import type { ViewId } from "./Sidebar";
import { Switch } from "./components/primitives";

const MODES: { id: CalendarMode; label: string }[] = [
  { id: "month", label: "Month" },
  { id: "week", label: "Week" },
  { id: "day", label: "Day" },
];

function SyncButton() {
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);
  const user = useAuthStore((s) => s.user);
  const session = useAuthStore((s) => s.session);
  const openAuthModal = useAuthStore((s) => s.openAuthModal);
  const { t } = useI18n();

  const handleSync = async () => {
    const isAuthed = Boolean(user || session?.user);
    if (!isAuthed) {
      openAuthModal("login");
      return;
    }

    setSyncing(true);
    setFeedback(null);
    try {
      const report = await syncDifferences();
      if (!report.success) {
        if (report.error === "OFFLINE") {
          setFeedback({
            type: "info",
            text: t("syncOfflineNotice"),
          });
        } else {
          setFeedback({
            type: "error",
            text: report.error || "Eşitleme başarısız oldu.",
          });
        }
      } else if (report.totalDifferences === 0) {
        setFeedback({
          type: "success",
          text: t("syncUpToDate"),
        });
      } else {
        const parts: string[] = [];
        if (report.uploadedTasks > 0) parts.push(`${report.uploadedTasks} görev yüklendi`);
        if (report.downloadedTasks > 0) parts.push(`${report.downloadedTasks} görev indirildi`);
        if (report.uploadedCategories > 0) parts.push(`${report.uploadedCategories} kategori yüklendi`);
        if (report.downloadedCategories > 0) parts.push(`${report.downloadedCategories} kategori indirildi`);

        setFeedback({
          type: "success",
          text: `${t("syncSuccess")} ${parts.join(", ")}`,
        });
      }
    } catch (err: unknown) {
      const errorMsg = formatErrorMessage(err);
      setFeedback({
        type: "error",
        text: `Hata: ${errorMsg}`,
      });
    } finally {
      setSyncing(false);
      setTimeout(() => {
        setFeedback(null);
      }, 4000);
    }
  };

  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <button
        type="button"
        className="btn ghost sm"
        onClick={handleSync}
        disabled={syncing}
        title={t("syncWithServer")}
        style={{
          gap: 6,
          fontWeight: 500,
          border: "1px solid var(--border)",
          padding: "5px 11px",
          borderRadius: "var(--radius-md)",
        }}
      >
        <RefreshCw
          size={14}
          style={{
            animation: syncing ? "spin 1s linear infinite" : undefined,
          }}
        />
        <span>{syncing ? t("syncing") : t("syncWithServer")}</span>
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
            whiteSpace: "nowrap",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            animation: "fadeIn 0.2s ease",
          }}
        >
          {feedback.type === "success" && <Check size={14} color="#10b981" />}
          {feedback.type === "error" && <AlertCircle size={14} />}
          <span>{feedback.text}</span>
        </div>
      )}
    </div>
  );
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
                {m.label}
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
