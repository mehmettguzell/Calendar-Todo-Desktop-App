import { useMemo, useState } from "react";
import { History, RotateCcw, Trash2 } from "lucide-react";
import { fromInstant } from "@/domain/datetime";
import { describeHistory, historyKindLabel } from "@/domain/history";
import type { HistoryKind } from "@/domain/types";
import { useTrashedTasks } from "@/state/selectors";
import { useStore } from "@/state/store";
import { Empty } from "@/ui/components/primitives";

const KINDS: HistoryKind[] = [
  "CREATED",
  "STATUS_CHANGED",
  "RESCHEDULED",
  "SNOOZED",
  "REMINDER_FIRED",
  "FOCUS_LOGGED",
  "UPDATED",
  "DELETED",
  "RESTORED",
];

/**
 * The global, append-only trail (spec section 5.5) plus the trash.
 * Nothing here is ever rewritten: a rescheduled task keeps every prior date.
 */
export function ActivityView() {
  const history = useStore((s) => s.db.history);
  const tasks = useStore((s) => s.db.tasks);
  const restoreTask = useStore((s) => s.restoreTask);
  const purgeTask = useStore((s) => s.purgeTask);
  const trashed = useTrashedTasks();
  const [kind, setKind] = useState<HistoryKind | "ALL">("ALL");

  const titles = useMemo(() => new Map(tasks.map((t) => [t.id, t.title])), [tasks]);
  const entries = useMemo(
    () =>
      history
        .filter((h) => kind === "ALL" || h.kind === kind)
        .slice()
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 300),
    [history, kind],
  );

  return (
    <div className="page">
      {trashed.length > 0 ? (
        <section className="section">
          <div className="section-head">
            <Trash2 size={14} />
            <h2>Trash</h2>
            <span className="count">{trashed.length}</span>
          </div>
          <div className="col" style={{ gap: 4 }}>
            {trashed.map((task) => (
              <div key={task.id} className="row" style={{ fontSize: 13 }}>
                <span className="grow truncate faint">{task.title}</span>
                <button type="button" className="btn sm" onClick={() => restoreTask(task.id)}>
                  <RotateCcw size={12} /> Restore
                </button>
                <button
                  type="button"
                  className="btn sm danger"
                  title="Delete permanently (history is kept)"
                  onClick={() => purgeTask(task.id)}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="section">
        <div className="section-head">
          <History size={14} />
          <h2>Activity</h2>
          <span className="count">{entries.length}</span>
          <span className="grow" />
          <select
            className="select"
            style={{ width: "auto" }}
            value={kind}
            onChange={(e) => setKind(e.target.value as HistoryKind | "ALL")}
          >
            <option value="ALL">All events</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {historyKindLabel(k)}
              </option>
            ))}
          </select>
        </div>

        {entries.length === 0 ? (
          <Empty icon={<History size={26} />} title="No activity recorded yet" />
        ) : (
          <div className="timeline">
            {entries.map((entry) => (
              <div key={entry.id} className="timeline-item">
                <span className="rail" aria-hidden />
                <div className="grow">
                  <div>
                    <strong style={{ fontWeight: 600 }}>
                      {titles.get(entry.taskId) ?? "Deleted task"}
                    </strong>
                    {" — "}
                    {describeHistory(entry)}
                  </div>
                  <time dateTime={entry.at}>
                    {fromInstant(entry.at).toLocaleString([], {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
