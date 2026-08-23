import { useState } from "react";
import {
  AlarmClock,
  Clock,
  Play,
  Repeat,
  Square,
  Timer,
  Trash2,
} from "lucide-react";
import { describeWhen, formatTracked } from "@/domain/datetime";
import type { TaskInstance } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import {
  useCategoryIndex,
  useSubtasks,
  useTrackedSeconds,
} from "@/state/selectors";
import { useNow, useStore } from "@/state/store";
import { Checkbox, StatusBadge } from "@/ui/components/primitives";
import { SnoozeMenu } from "./SnoozeMenu";

/**
 * One task, as it appears in every list-shaped view.
 *
 * The row is intentionally the same component in Today, Todo, Search and Trash:
 * one task has one representation, so completing it anywhere behaves the same.
 */
export function TaskRow({
  instance,
  selected,
  onOpen,
  showDate = true,
}: {
  instance: TaskInstance;
  selected?: boolean;
  onOpen: (instance: TaskInstance) => void;
  showDate?: boolean;
}) {
  const { task } = instance;
  const { t } = useI18n();
  const toggleComplete = useStore((s) => s.toggleComplete);
  const deleteTask = useStore((s) => s.deleteTask);
  const startFocus = useStore((s) => s.startFocus);
  const stopFocus = useStore((s) => s.stopFocus);
  const runningFocus = useStore((s) => s.runningFocus);
  const reminders = useStore((s) => s.db.reminders);
  const categories = useCategoryIndex();
  const subtasks = useSubtasks(task.id);
  const tracked = useTrackedSeconds(task.id);
  const now = useNow();
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  const category = task.categoryId ? categories.get(task.categoryId) : null;
  const done = instance.storedStatus === "COMPLETED";
  const doneSubtasks = subtasks.filter((s) => s.status === "COMPLETED").length;
  const hasReminder = reminders.some(
    (r) => r.taskId === task.id && r.status !== "DISMISSED",
  );
  const isFocused = runningFocus?.taskId === task.id;

  const time =
    !task.allDay && task.startTime
      ? task.endTime
        ? `${task.startTime} – ${task.endTime}`
        : task.startTime
      : null;

  return (
    <div className={cn("task-row", done && "done", selected && "selected")}>
      <div className={cn("prio", task.priority)} aria-hidden />
      <div style={{ paddingTop: 1 }}>
        <Checkbox done={done} onToggle={() => toggleComplete(instance)} />
      </div>

      <button
        type="button"
        className="task-main"
        onClick={() => onOpen(instance)}
      >
        <div className="task-title">
          <span className="label wrap">{task.title}</span>
          {instance.status === "OVERDUE" || instance.status === "SNOOZED" ? (
            <StatusBadge status={instance.status} />
          ) : null}
          {task.recurrence ? (
            <Repeat size={13} className="faint" aria-label={t("repeatsAria")} />
          ) : null}
          {hasReminder ? (
            <AlarmClock size={13} className="faint" aria-label={t("hasReminderAria")} />
          ) : null}
        </div>

        <div className="task-meta">
          {showDate ? (
            <span className="row" style={{ gap: 4 }}>
              <Clock size={12} />
              {describeWhen(instance.date, time ? task.startTime : null, now)}
            </span>
          ) : null}
          {time ? <span className="mono">{time}</span> : null}
          {task.allDay && instance.date ? (
            <span className="tag">{t("allDay")}</span>
          ) : null}
          {category ? (
            <span className="row" style={{ gap: 5 }}>
              <i className="dot" style={{ background: category.color }} />
              {category.name}
            </span>
          ) : null}
          {subtasks.length > 0 ? (
            <span className="subtask-strip">
              <span className="progress">
                <i
                  style={{
                    width: `${(doneSubtasks / subtasks.length) * 100}%`,
                  }}
                />
              </span>
              {doneSubtasks}/{subtasks.length}
            </span>
          ) : null}
          {tracked > 0 ? (
            <span className="row" style={{ gap: 4 }}>
              <Timer size={12} />
              {formatTracked(tracked)}
            </span>
          ) : null}
          {task.tags.map((tag) => (
            <span key={tag} className="tag">
              #{tag}
            </span>
          ))}
        </div>
      </button>

      <div className="task-actions" style={{ position: "relative" }}>
        <button
          type="button"
          className="btn ghost icon"
          title={isFocused ? t("formStopTimer") : t("formStartTimer")}
          onClick={(e) => {
            e.stopPropagation();
            isFocused ? stopFocus() : startFocus(instance);
          }}
        >
          {isFocused ? <Square size={14} /> : <Play size={14} />}
        </button>
        <button
          type="button"
          className="btn ghost icon"
          title={t("snooze")}
          onClick={(e) => {
            e.stopPropagation();
            setSnoozeOpen((v) => !v);
          }}
        >
          <AlarmClock size={14} />
        </button>
        <button
          type="button"
          className="btn ghost icon"
          title={t("menuDelete")}
          onClick={(e) => {
            e.stopPropagation();
            deleteTask(task.id);
          }}
        >
          <Trash2 size={14} />
        </button>
        {snoozeOpen ? (
          <div style={{ position: "absolute", top: "100%", right: 0 }}>
            <SnoozeMenu
              instance={instance}
              align="right"
              onClose={() => setSnoozeOpen(false)}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
