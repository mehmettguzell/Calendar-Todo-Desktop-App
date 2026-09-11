import { useMemo } from "react";
import { Pause, Play, Square, Timer, Trash2 } from "lucide-react";
import {
  formatDuration,
  formatTracked,
  fromInstant,
  localeTag,
  toLocalDate,
} from "@/domain/datetime";
import type { FocusSession, Task, TaskInstance } from "@/domain/types";
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
      <RunningBar
        task={runningTask}
        startedAt={runningFocus?.startedAt ?? null}
        paused={paused}
        elapsed={elapsed}
      />

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

      <FocusHistory sessions={sessions} tasks={tasks} paused={paused} />
    </div>
  );
}

/** The timer that is running now, and the three things you can do to it. */
function RunningBar({
  task,
  startedAt,
  paused,
  elapsed,
}: {
  task: Task | null;
  startedAt: string | null;
  paused: boolean;
  elapsed: number;
}) {
  const { t } = useI18n();
  const stopFocus = useStore((s) => s.stopFocus);
  const pauseFocus = useStore((s) => s.pauseFocus);
  const resumeFocus = useStore((s) => s.resumeFocus);
  const cancelFocus = useStore((s) => s.cancelFocus);
  if (!task || !startedAt) return null;

  const since = fromInstant(startedAt).toLocaleTimeString(localeTag(), {
    timeStyle: "short",
  });

  return (
    <div className={cn("focus-bar section", paused && "is-paused")}>
      <Timer size={18} />
      <div className="grow">
        <div style={{ fontWeight: 600 }}>{task.title}</div>
        <div className="muted" style={{ fontSize: "var(--text-xs)" }}>
          {paused ? t("focusPausedAt") : t("focusStartedAt", { time: since })}
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
  );
}

/** The last few sessions, newest first, each with a way to take it back. */
function FocusHistory({
  sessions,
  tasks,
  paused,
}: {
  sessions: FocusSession[];
  tasks: Task[];
  paused: boolean;
}) {
  const { t } = useI18n();
  const runningFocus = useStore((s) => s.runningFocus);
  const clearFocusSessions = useStore((s) => s.clearFocusSessions);
  const deleteFocusSession = useStore((s) => s.deleteFocusSession);

  return (
    <section className="section">
      <div className="section-head">
        <h2>{t("focusRecent")}</h2>
        <span className="count grow">{sessions.length}</span>
        {sessions.length > 0 ? (
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => {
              if (confirm(t("focusClearHistoryConfirm"))) clearFocusSessions();
            }}
          >
            {t("focusClearHistory")}
          </button>
        ) : null}
      </div>
      <div className="col" style={{ gap: 4 }}>
        {sessions.slice(0, 25).map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            task={tasks.find((task) => task.id === session.taskId) ?? null}
            paused={paused && runningFocus?.sessionId === session.id}
            onDelete={() => deleteFocusSession(session.id)}
          />
        ))}
      </div>
    </section>
  );
}

function SessionRow({
  session,
  task,
  paused,
  onDelete,
}: {
  session: FocusSession;
  task: Task | null;
  paused: boolean;
  onDelete: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="row" style={{ fontSize: "var(--text-sm)" }}>
      <span className="grow truncate">{task?.title ?? t("deletedTask")}</span>
      <span className="faint" style={{ fontSize: "var(--text-xs)" }}>
        {fromInstant(session.startedAt).toLocaleString(localeTag(), {
          dateStyle: "short",
          timeStyle: "short",
        })}
      </span>
      <span className="mono" style={{ minWidth: 64, textAlign: "right" }}>
        {/* An unfinished session says so rather than printing the seconds it
            has banked so far — which for a timer started a minute ago is
            "0dk", and reads as a session that recorded nothing. */}
        {session.endedAt ? formatTracked(session.durationSec) : null}
        {!session.endedAt ? (
          <span className="faint">
            {paused ? t("focusPausedAt") : t("focusOngoing")}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        className="btn ghost icon sm"
        title={t("delete")}
        onClick={onDelete}
        style={{ opacity: 0.6 }}
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}
