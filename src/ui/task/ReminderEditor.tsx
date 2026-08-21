import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { atTime, toInstant, toLocalDate, toLocalTime } from "@/domain/datetime";
import { describeReminder, REMINDER_OFFSETS, reminderInstantFor } from "@/domain/reminders";
import type { Task } from "@/domain/types";
import { useStore } from "@/state/store";

/**
 * Reminders for one task (spec section 7).
 *
 * Relative reminders are stored as an offset, so moving the task moves its
 * reminders too. Absolute reminders are for tasks with no useful start time.
 */
export function ReminderEditor({ task }: { task: Task }) {
  // Select the stable array, then narrow it. Filtering inside the selector
  // hands zustand a new array on every notification, which spins
  // useSyncExternalStore into an infinite render loop.
  const allReminders = useStore((s) => s.db.reminders);
  const reminders = useMemo(
    () => allReminders.filter((r) => r.taskId === task.id),
    [allReminders, task.id],
  );
  const settings = useStore((s) => s.db.settings);
  const removeReminder = useStore((s) => s.removeReminder);
  const [adding, setAdding] = useState(false);

  return (
    <div className="col" style={{ gap: 8 }}>
      {reminders.length === 0 ? (
        <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>
          No reminders. {task.dueDate ? "" : "Give the task a date to enable relative reminders."}
        </p>
      ) : (
        reminders.map((reminder) => {
          const fires = reminderInstantFor(reminder, task, task.dueDate, settings);
          return (
            <div key={reminder.id} className="row">
              <div className="grow">
                <div style={{ fontSize: 13 }}>{describeReminder(reminder)}</div>
                <div className="faint mono" style={{ fontSize: 11 }}>
                  {fires
                    ? `Next: ${fires.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`
                    : "Waiting for a date"}
                  {reminder.status === "FIRED" ? " · delivered" : ""}
                  {reminder.status === "DISMISSED" ? " · dismissed" : ""}
                </div>
              </div>
              <button
                type="button"
                className="btn ghost icon"
                title="Remove reminder"
                onClick={() => removeReminder(reminder.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })
      )}

      {adding ? (
        <AddReminderForm task={task} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" className="btn sm" onClick={() => setAdding(true)}>
          <Plus size={13} /> Add reminder
        </button>
      )}
    </div>
  );
}

function AddReminderForm({ task, onDone }: { task: Task; onDone: () => void }) {
  const addReminder = useStore((s) => s.addReminder);
  const defaultOffset = useStore((s) => s.db.settings.defaultReminderOffset);
  const [mode, setMode] = useState<"RELATIVE" | "ABSOLUTE">(
    task.dueDate ? "RELATIVE" : "ABSOLUTE",
  );
  const [offset, setOffset] = useState(defaultOffset);
  const [date, setDate] = useState(task.dueDate ?? toLocalDate(new Date()));
  const [time, setTime] = useState(task.startTime ?? toLocalTime(new Date()));

  const submit = () => {
    if (mode === "RELATIVE") {
      addReminder({ taskId: task.id, kind: "RELATIVE", offsetMinutes: offset, remindAt: null });
    } else {
      addReminder({
        taskId: task.id,
        kind: "ABSOLUTE",
        offsetMinutes: null,
        remindAt: toInstant(atTime(date, time)),
      });
    }
    onDone();
  };

  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="segmented" style={{ alignSelf: "flex-start" }}>
        <button
          type="button"
          aria-pressed={mode === "RELATIVE"}
          disabled={!task.dueDate}
          onClick={() => setMode("RELATIVE")}
        >
          Before start
        </button>
        <button
          type="button"
          aria-pressed={mode === "ABSOLUTE"}
          onClick={() => setMode("ABSOLUTE")}
        >
          Exact time
        </button>
      </div>

      {mode === "RELATIVE" ? (
        <select
          className="select"
          value={offset}
          onChange={(e) => setOffset(Number(e.target.value))}
        >
          {REMINDER_OFFSETS.map((o) => (
            <option key={o.minutes} value={o.minutes}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <div className="field-row">
          <input
            className="input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <input
            className="input"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
      )}

      <div className="row">
        <button type="button" className="btn primary sm" onClick={submit}>
          Add
        </button>
        <button type="button" className="btn sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
