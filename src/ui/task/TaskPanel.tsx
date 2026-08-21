import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlarmClock, Play, Square, Trash2, X } from "lucide-react";
import { formatTracked } from "@/domain/datetime";
import { PRIORITY_LABEL } from "@/domain/task";
import { PRIORITIES, type Priority, type TaskInstance } from "@/domain/types";
import {
  useCategories,
  useTaskHistory,
  useTrackedSeconds,
} from "@/state/selectors";
import { useStore } from "@/state/store";
import { Field, StatusBadge, Switch } from "@/ui/components/primitives";
import { HistoryTimeline } from "./HistoryTimeline";
import { RecurrenceEditor } from "./RecurrenceEditor";
import { ReminderEditor } from "./ReminderEditor";
import { SnoozeMenu } from "./SnoozeMenu";
import { SubtaskList } from "./SubtaskList";

/**
 * The task's single editing surface.
 *
 * Everything the spec attaches to a task lives here, on one record: schedule,
 * category, tags, subtasks, recurrence, reminders, focus time and history.
 * Edits write straight to the store, so the calendar behind the panel updates
 * as you type.
 */
export function TaskPanel({
  instance,
  onClose,
  onOpenTask,
}: {
  instance: TaskInstance;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const { task } = instance;
  const updateTask = useStore((s) => s.updateTask);
  const deleteTask = useStore((s) => s.deleteTask);
  const toggleComplete = useStore((s) => s.toggleComplete);
  const setStatus = useStore((s) => s.setStatus);
  const clearSnooze = useStore((s) => s.clearSnooze);
  const startFocus = useStore((s) => s.startFocus);
  const stopFocus = useStore((s) => s.stopFocus);
  const runningFocus = useStore((s) => s.runningFocus);
  const categories = useCategories();
  const history = useTaskHistory(task.id);
  const tracked = useTrackedSeconds(task.id);

  const [title, setTitle] = useState(task.title);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [description, setDescription] = useState(task.description);
  const [tagInput, setTagInput] = useState(task.tags.join(", "));
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  // Re-seed local text state when a different task is opened.
  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description);
    setTagInput(task.tags.join(", "));
  }, [task.id, task.title, task.description, task.tags]);

  /**
   * The title is a textarea so a long name wraps into view instead of scrolling
   * sideways inside a one-line input. Nothing else about it is multi-line: it
   * grows to exactly its content, and Enter commits rather than adding a break.
   */
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  const commitTitle = () => {
    const trimmed = title.trim();
    if (trimmed && trimmed !== task.title)
      updateTask(task.id, { title: trimmed });
    else if (!trimmed) setTitle(task.title);
  };

  const isFocused = runningFocus?.taskId === task.id;
  const ref = useMemo(
    () => ({
      taskId: task.id,
      occurrenceDate: instance.isRecurring ? instance.date : null,
    }),
    [task.id, instance.isRecurring, instance.date],
  );

  return (
    <aside className="panel">
      <div className="panel-head">
        <StatusBadge status={instance.status} />
        {instance.isRecurring && instance.date ? (
          <span className="faint mono" style={{ fontSize: 11 }}>
            occurrence {instance.date}
          </span>
        ) : null}
        <span className="grow" />
        <button
          type="button"
          className="btn ghost icon"
          onClick={onClose}
          aria-label="Close panel"
        >
          <X size={16} />
        </button>
      </div>

      <div className="panel-body scroll">
        <textarea
          ref={titleRef}
          className="panel-title-input"
          rows={1}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            e.currentTarget.blur();
          }}
          placeholder="Untitled task"
        />

        <div className="row" style={{ position: "relative", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn primary"
            onClick={() => toggleComplete(instance)}
          >
            {instance.storedStatus === "COMPLETED" ? "Reopen" : "Complete"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (isFocused) {
                stopFocus();
                setStatus(ref, "TODO");
              } else {
                startFocus(instance);
              }
            }}
          >
            {isFocused ? "Pause" : "Start"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setSnoozeOpen((v) => !v)}
          >
            <AlarmClock size={14} /> Snooze
          </button>
          {instance.status === "SNOOZED" ? (
            <button
              type="button"
              className="btn ghost"
              onClick={() => clearSnooze(ref)}
            >
              Wake now
            </button>
          ) : null}
          {snoozeOpen ? (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                marginTop: 4,
              }}
            >
              <SnoozeMenu
                instance={instance}
                onClose={() => setSnoozeOpen(false)}
              />
            </div>
          ) : null}
        </div>

        <Field label="Notes">
          <textarea
            className="textarea"
            value={description}
            placeholder="Add details…"
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() =>
              description !== task.description &&
              updateTask(task.id, { description })
            }
          />
        </Field>

        <div className="card">
          <div className="card-head">Schedule</div>
          <div className="col" style={{ gap: 10 }}>
            <Field label="Date">
              <input
                className="input"
                type="date"
                value={task.dueDate ?? ""}
                onChange={(e) =>
                  updateTask(task.id, { dueDate: e.target.value || null })
                }
              />
            </Field>

            <Switch
              checked={task.allDay}
              label="All-day"
              onChange={(allDay) =>
                updateTask(task.id, {
                  allDay,
                  startTime: allDay ? null : (task.startTime ?? "09:00"),
                  endTime: allDay ? null : task.endTime,
                })
              }
            />

            {!task.allDay ? (
              <div className="field-row">
                <Field label="Start">
                  <input
                    className="input"
                    type="time"
                    value={task.startTime ?? ""}
                    onChange={(e) =>
                      updateTask(task.id, { startTime: e.target.value || null })
                    }
                  />
                </Field>
                <Field label="End">
                  <input
                    className="input"
                    type="time"
                    value={task.endTime ?? ""}
                    onChange={(e) =>
                      updateTask(task.id, { endTime: e.target.value || null })
                    }
                  />
                </Field>
              </div>
            ) : null}

            <RecurrenceEditor
              value={task.recurrence}
              onChange={(recurrence) => updateTask(task.id, { recurrence })}
            />
          </div>
        </div>

        <div className="card">
          <div className="card-head">Organise</div>
          <div className="col" style={{ gap: 10 }}>
            <div className="field-row">
              <Field label="Priority">
                <select
                  className="select"
                  value={task.priority}
                  onChange={(e) =>
                    updateTask(task.id, {
                      priority: e.target.value as Priority,
                    })
                  }
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Category">
                <select
                  className="select"
                  value={task.categoryId ?? ""}
                  onChange={(e) =>
                    updateTask(task.id, { categoryId: e.target.value || null })
                  }
                >
                  <option value="">None</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Tags" hint="Comma separated">
              <input
                className="input"
                value={tagInput}
                placeholder="design, review"
                onChange={(e) => setTagInput(e.target.value)}
                onBlur={() => {
                  const tags = tagInput
                    .split(",")
                    .map((t) => t.trim().replace(/^#/, ""))
                    .filter(Boolean);
                  if (tags.join(",") !== task.tags.join(","))
                    updateTask(task.id, { tags });
                }}
              />
            </Field>
          </div>
        </div>

        <div className="card">
          <div className="card-head">Subtasks</div>
          <SubtaskList parent={task} onOpen={onOpenTask} />
        </div>

        <div className="card">
          <div className="card-head">Reminders</div>
          <ReminderEditor task={task} />
        </div>

        <div className="card">
          <div className="card-head">
            Focus
            <span className="mono">{formatTracked(tracked)}</span>
          </div>
          <button
            type="button"
            className={isFocused ? "btn danger" : "btn"}
            onClick={() => (isFocused ? stopFocus() : startFocus(instance))}
          >
            {isFocused ? <Square size={14} /> : <Play size={14} />}
            {isFocused ? "Stop timer" : "Start focus timer"}
          </button>
        </div>

        <div className="card">
          <div className="card-head">History</div>
          <HistoryTimeline entries={history} />
        </div>
      </div>

      <div className="panel-foot">
        <span className="grow faint" style={{ fontSize: 11.5 }}>
          Created {new Date(task.createdAt).toLocaleDateString()}
        </span>
        <button
          type="button"
          className="btn danger"
          onClick={() => {
            deleteTask(task.id);
            onClose();
          }}
        >
          <Trash2 size={14} /> Trash
        </button>
      </div>
    </aside>
  );
}
