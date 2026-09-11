import {
  AlarmClock,
  Repeat,
} from "lucide-react";
import {
  StatusBadge,
} from "@/ui/components/primitives";
import type { TaskRowModel } from "./useTaskRow";
import { TaskRowMeta } from "./TaskRowMeta";

/**
 * The task itself: title, the badges that cannot be seen any other way, and the
 * meta line under it.
 *
 * Snoozed keeps its badge; overdue lost one, because the date below is already
 * red and a red badge beside a red date is the same alarm rung twice.
 */
export function TaskRowMain({ model: m }: { model: TaskRowModel }) {
  return (
    <button
      type="button"
      className="task-main"
      onClick={(e) => {
        if (m.onClickCapture(e)) return;
        m.onOpen(m.instance);
      }}
    >
      <div className="task-title">
        <span className="label wrap">{m.task.title}</span>
        {/* Snoozed is a state you cannot see any other way, so it keeps its
            badge. Overdue lost one: the date below is already red, and a red
            badge beside a red date is the same alarm rung twice. */}
        {m.instance.status === "SNOOZED" ? (
          <StatusBadge status={m.instance.status} />
        ) : null}
        {m.task.recurrence ? (
          <Repeat size={13} className="faint" aria-label={m.t("repeatsAria")} />
        ) : null}
        {m.hasReminder ? (
          <AlarmClock
            size={13}
            className="faint"
            aria-label={m.t("hasReminderAria")}
          />
        ) : null}
      </div>

      <TaskRowMeta model={m} />
    </button>
  );
}
