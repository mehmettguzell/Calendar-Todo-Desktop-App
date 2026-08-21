import { useState } from "react";
import { shiftTime, toLocalDate } from "@/domain/datetime";
import { PRIORITY_LABEL } from "@/domain/task";
import { PRIORITIES, type LocalDate, type Priority, type Recurrence } from "@/domain/types";
import { useCategories } from "@/state/selectors";
import { useNow, useStore } from "@/state/store";
import { Field, Modal, Switch } from "@/ui/components/primitives";
import { RecurrenceEditor } from "./RecurrenceEditor";

/**
 * Creates the one record that then appears everywhere: calendar, todo list,
 * today view, search and the reminder queue.
 */
export function QuickAdd({
  defaultDate,
  defaultTime,
  onClose,
  onCreated,
}: {
  defaultDate?: LocalDate | null;
  defaultTime?: string | null;
  onClose: () => void;
  onCreated?: (taskId: string) => void;
}) {
  const createTask = useStore((s) => s.createTask);
  const addReminder = useStore((s) => s.addReminder);
  const settings = useStore((s) => s.db.settings);
  const categories = useCategories();
  const now = useNow();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState<string>(defaultDate ?? toLocalDate(now));
  const [allDay, setAllDay] = useState(!defaultTime);
  const [startTime, setStartTime] = useState(defaultTime ?? "09:00");
  const [endTime, setEndTime] = useState("");
  const [priority, setPriority] = useState<Priority>("NONE");
  const [categoryId, setCategoryId] = useState("");
  const [tags, setTags] = useState("");
  const [recurrence, setRecurrence] = useState<Recurrence | null>(null);
  // On by default. A task nobody is reminded about is the common complaint
  // this app exists to answer, and the switch is right there for the times it
  // is not wanted. Tasks with no date silently skip it (see submit).
  const [withReminder, setWithReminder] = useState(true);

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;

    const task = createTask({
      title: trimmed,
      description: description.trim(),
      dueDate: dueDate || null,
      allDay,
      startTime: allDay ? null : startTime || null,
      endTime: allDay || !endTime ? null : endTime,
      priority,
      categoryId: categoryId || null,
      tags: tags
        .split(",")
        .map((t) => t.trim().replace(/^#/, ""))
        .filter(Boolean),
      recurrence,
    });

    if (withReminder && dueDate) {
      addReminder({
        taskId: task.id,
        kind: "RELATIVE",
        offsetMinutes: settings.defaultReminderOffset,
        remindAt: null,
      });
    }
    onCreated?.(task.id);
    onClose();
  };

  return (
    <Modal
      title="New task"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!title.trim()} onClick={submit}>
            Create task
          </button>
        </>
      }
    >
      <Field label="Title">
        <input
          className="input"
          autoFocus
          value={title}
          placeholder="Prepare project presentation"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
        />
      </Field>

      <Field label="Notes">
        <textarea
          className="textarea"
          value={description}
          placeholder="Optional details"
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>

      <div className="field-row">
        <Field label="Date">
          <input
            className="input"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </Field>
        <Field label="Priority">
          <select
            className="select"
            value={priority}
            onChange={(e) => setPriority(e.target.value as Priority)}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Switch checked={allDay} label="All-day" onChange={setAllDay} />

      {!allDay ? (
        <div className="field-row">
          <Field label="Start">
            <input
              className="input"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </Field>
          <Field label="End">
            <input
              className="input"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </Field>
        </div>
      ) : null}

      <div className="field-row">
        <Field label="Category">
          <select
            className="select"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">None</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tags" hint="Comma separated">
          <input
            className="input"
            value={tags}
            placeholder="design, review"
            onChange={(e) => setTags(e.target.value)}
          />
        </Field>
      </div>

      <RecurrenceEditor value={recurrence} onChange={setRecurrence} />

      <Switch
        checked={withReminder}
        label={reminderLabel(allDay, settings.defaultReminderOffset, settings.allDayReminderTime)}
        onChange={setWithReminder}
      />
    </Modal>
  );
}

/**
 * An all-day task has no start time to count back from, so its reminder lands
 * at the clock time from Settings. Saying "10 min before" there would name a
 * moment that does not exist.
 */
function reminderLabel(allDay: boolean, offsetMinutes: number, allDayTime: string): string {
  if (allDay) return `Remind me at ${shiftTime(allDayTime, -offsetMinutes)}`;
  if (offsetMinutes === 0) return "Remind me at the start time";
  return `Remind me ${offsetMinutes} min before`;
}
