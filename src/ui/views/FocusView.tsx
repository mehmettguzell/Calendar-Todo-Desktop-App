import { useMemo } from "react";
import { Pause, Play, Square, Timer, Trash2 } from "lucide-react";
import {
  formatDuration,
  formatTracked,
  fromInstant,
  localeTag,
  toLocalDate,
} from "@/domain/datetime";
import type { TaskInstance } from "@/domain/types";
import {
  splitDay,
  useFocusSessions,
  useInstancesInRange,
  type Filters,
} from "@/state/selectors";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { useNow, useStore } from "@/state/store";
import { useElapsedSeconds } from "@/services/scheduler";
import { EmptyArt } from "@/ui/components/EmptyArt";
import { Empty } from "@/ui/components/primitives";
import { TaskRow } from "@/ui/task/TaskRow";

/**
 * Focus / time tracking. Sessions attach to the same task record, so tracked
 * time shows up on the task wherever it appears.
 */
export function FocusView({
  filters,
  selectedKey,
  onOpen,
}: {
  filters: Filters;
  selectedKey: string | null;
  onOpen: (instance: TaskInstance) => void;
}) {
  const { t } = useI18n();
  const runningFocus = useStore((s) => s.runningFocus);
  const stopFocus = useStore((s) => s.stopFocus);
  const pauseFocus = useStore((s) => s.pauseFocus);
  const resumeFocus = useStore((s) => s.resumeFocus);
  const cancelFocus = useStore((s) => s.cancelFocus);
  const clearFocusSessions = useStore((s) => s.clearFocusSessions);
  const deleteFocusSession = useStore((s) => s.deleteFocusSession);
  const tasks = useStore((s) => s.db.tasks);
  const sessions = useFocusSessions();
  const now = useNow();
  const today = toLocalDate(now);
  const todays = useInstancesInRange(today, today, filters);
  /*
   * The same day, in the same order Today prints it — one function decides,
   * so the two screens cannot disagree about which task comes first. Flat
   * rather than in three sections: this list is a rack to start a timer from,
   * and the headings would be three rows of chrome around at most a handful of
   * tasks.
   */
  const day = useMemo(() => splitDay(todays), [todays]);
  const paused = runningFocus !== null && runningFocus.runStartedAt === null;
  const elapsed = useElapsedSeconds(
    runningFocus?.runStartedAt ?? null,
    runningFocus?.bankedSec ?? 0,
  );

  const runningTask = tasks.find((t) => t.id === runningFocus?.taskId) ?? null;

  const totals = useMemo(() => {
    const todaySec = sessions
      .filter((s) => s.startedAt.slice(0, 10) === today)
      .reduce((sum, s) => sum + s.durationSec, 0);
    const allSec = sessions.reduce((sum, s) => sum + s.durationSec, 0);
    return { todaySec, allSec, count: sessions.length };
  }, [sessions, today]);

  return (
    <div className="page">
      {runningFocus && runningTask ? (
        <div className={cn("focus-bar section", paused && "is-paused")}>
          <Timer size={18} />
          <div className="grow">
            <div style={{ fontWeight: 600 }}>{runningTask.title}</div>
            <div className="muted" style={{ fontSize: "var(--text-xs)" }}>
              {paused
                ? t("focusPausedAt")
                : t("focusStartedAt", {
                    time: fromInstant(
                      runningFocus.startedAt,
                    ).toLocaleTimeString(localeTag(), { timeStyle: "short" }),
                  })}
            </div>
          </div>
          <span className="timer mono">{formatDuration(elapsed)}</span>
          <button type="button" className="btn ghost" onClick={cancelFocus}>
            {t("focusCancel")}
          </button>
          {/* Between "throw it away" and "that is done": the button for
              stepping away from something you are coming back to. */}
          <button
            type="button"
            className="btn"
            onClick={paused ? resumeFocus : pauseFocus}
          >
            {paused ? (
              <>
                <Play size={14} /> {t("resume")}
              </>
            ) : (
              <>
                <Pause size={14} /> {t("pause")}
              </>
            )}
          </button>
          <button type="button" className="btn" onClick={stopFocus}>
            <Square size={14} /> {t("focusStop")}
          </button>
        </div>
      ) : null}

      <div className="stat-grid section">
        <div className="stat">
          <div className="value">{formatTracked(totals.todaySec)}</div>
          <div className="label">{t("focusToday")}</div>
        </div>
        <div className="stat">
          <div className="value">{formatTracked(totals.allSec)}</div>
          <div className="label">{t("focusAllTime")}</div>
        </div>
        <div className="stat">
          <div className="value">{totals.count}</div>
          <div className="label">{t("focusSessions")}</div>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>{t("focusTodaysTasks")}</h2>
          <span className="count">{day.ordered.length}</span>
        </div>
        <div className="task-list">
          {day.ordered.length === 0 ? (
            <Empty icon={<EmptyArt kind="cleared" />} title={t("focusEmpty")} />
          ) : (
            day.ordered.map((instance) => (
              <TaskRow
                key={instance.key}
                instance={instance}
                showDate={false}
                selected={instance.key === selectedKey}
                onOpen={onOpen}
                // The same rows as Today's, so they can be picked the same
                // way — the bulk bar is global and did not care which screen
                // the rows came from; only this list could not offer any.
                listIds={day.ids}
              />
            ))
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>{t("focusRecent")}</h2>
          <span className="count grow">{sessions.length}</span>
          {sessions.length > 0 ? (
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => {
                if (confirm(t("focusClearHistoryConfirm"))) {
                  clearFocusSessions();
                }
              }}
            >
              {t("focusClearHistory")}
            </button>
          ) : null}
        </div>
        <div className="col" style={{ gap: 4 }}>
          {sessions.slice(0, 25).map((session) => {
            const task = tasks.find((t) => t.id === session.taskId);
            return (
              <div key={session.id} className="row" style={{ fontSize: "var(--text-sm)" }}>
                <span className="grow truncate">
                  {task?.title ?? t("deletedTask")}
                </span>
                <span className="faint" style={{ fontSize: "var(--text-xs)" }}>
                  {fromInstant(session.startedAt).toLocaleString(localeTag(), {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
                <span
                  className="mono"
                  style={{ minWidth: 64, textAlign: "right" }}
                >
                  {/* An unfinished session says so rather than printing the
                      seconds it has banked so far — which for a timer started
                      a minute ago is "0dk", and reads as a session that
                      recorded nothing. It was the English word "running" in a
                      Turkish interface until now. */}
                  {session.endedAt ? (
                    formatTracked(session.durationSec)
                  ) : paused && runningFocus?.sessionId === session.id ? (
                    <span className="faint">{t("focusPausedAt")}</span>
                  ) : (
                    <span className="faint">{t("focusOngoing")}</span>
                  )}
                </span>
                <button
                  type="button"
                  className="btn ghost icon sm"
                  title={t("delete")}
                  onClick={() => deleteFocusSession(session.id)}
                  style={{ opacity: 0.6 }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
