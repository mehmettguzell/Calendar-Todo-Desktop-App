import { useMemo } from "react";
import { Square, Timer } from "lucide-react";
import { formatDuration, formatTracked, fromInstant, toLocalDate } from "@/domain/datetime";
import type { TaskInstance } from "@/domain/types";
import { useFocusSessions, useInstancesInRange, type Filters } from "@/state/selectors";
import { useNow, useStore } from "@/state/store";
import { useElapsedSeconds } from "@/services/scheduler";
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
  const runningFocus = useStore((s) => s.runningFocus);
  const stopFocus = useStore((s) => s.stopFocus);
  const tasks = useStore((s) => s.db.tasks);
  const sessions = useFocusSessions();
  const now = useNow();
  const today = toLocalDate(now);
  const todays = useInstancesInRange(today, today, filters);
  const elapsed = useElapsedSeconds(runningFocus?.startedAt ?? null);

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
        <div className="focus-bar section">
          <Timer size={18} />
          <div className="grow">
            <div style={{ fontWeight: 600 }}>{runningTask.title}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              Started {fromInstant(runningFocus.startedAt).toLocaleTimeString([], { timeStyle: "short" })}
            </div>
          </div>
          <span className="timer mono">{formatDuration(elapsed)}</span>
          <button type="button" className="btn" onClick={stopFocus}>
            <Square size={14} /> Stop
          </button>
        </div>
      ) : null}

      <div className="stat-grid section">
        <div className="stat">
          <div className="value">{formatTracked(totals.todaySec)}</div>
          <div className="label">Focused today</div>
        </div>
        <div className="stat">
          <div className="value">{formatTracked(totals.allSec)}</div>
          <div className="label">All time</div>
        </div>
        <div className="stat">
          <div className="value">{totals.count}</div>
          <div className="label">Sessions logged</div>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Today&rsquo;s tasks</h2>
          <span className="count">{todays.length}</span>
        </div>
        <div className="task-list">
          {todays.length === 0 ? (
            <Empty icon={<Timer size={26} />} title="Nothing to focus on yet" />
          ) : (
            todays.map((instance) => (
              <TaskRow
                key={instance.key}
                instance={instance}
                showDate={false}
                selected={instance.key === selectedKey}
                onOpen={onOpen}
              />
            ))
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Recent sessions</h2>
          <span className="count">{sessions.length}</span>
        </div>
        <div className="col" style={{ gap: 4 }}>
          {sessions.slice(0, 25).map((session) => {
            const task = tasks.find((t) => t.id === session.taskId);
            return (
              <div key={session.id} className="row" style={{ fontSize: 13 }}>
                <span className="grow truncate">{task?.title ?? "Deleted task"}</span>
                <span className="faint" style={{ fontSize: 12 }}>
                  {fromInstant(session.startedAt).toLocaleString([], {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
                <span className="mono" style={{ minWidth: 64, textAlign: "right" }}>
                  {session.endedAt ? formatTracked(session.durationSec) : "running"}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
