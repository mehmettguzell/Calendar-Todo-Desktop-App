import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { shiftTime, toLocalDate } from "@/domain/datetime";
import { describeParse, parseQuickAdd } from "@/domain/naturalLanguage";
import {
  PRIORITIES,
  type LocalDate,
  type Priority,
  type Recurrence,
} from "@/domain/types";
import { CATEGORY_COLORS } from "@/data/db";
import { useI18n } from "@/lib/i18n";
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
  const { t } = useI18n();
  const createTask = useStore((s) => s.createTask);
  const addReminder = useStore((s) => s.addReminder);
  const addCategory = useStore((s) => s.addCategory);
  const settings = useStore((s) => s.db.settings);
  const categories = useCategories();
  const now = useNow();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState<string>(
    defaultDate ?? toLocalDate(now),
  );
  const [endDate, setEndDate] = useState<string>("");
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

  /**
   * What the title box understood, recomputed as it is typed.
   *
   * The parse only ever *fills in* fields — it never overwrites one the user
   * has already touched by hand, which is what `touched` tracks. Typing a date
   * and then correcting it in the date picker has to stick.
   */
  const parsed = useMemo(() => parseQuickAdd(title, now, settings.weekStartsOn), [
    title,
    now,
    settings.weekStartsOn,
  ]);
  const chips = describeParse(parsed);
  // "Touched" means the user edited the field, not that it started with a
  // value. Seeding it from `defaultDate` — which the calendar always supplies —
  // meant a parsed date was computed, shown in the preview, and then silently
  // ignored by the field it was supposed to fill.
  const touched = useRef({ date: false, time: false });

  useEffect(() => {
    if (parsed.dueDate && !touched.current.date) setDueDate(parsed.dueDate);
    if (parsed.endDate && !touched.current.date) setEndDate(parsed.endDate);
    if (parsed.startTime && !touched.current.time) {
      setAllDay(false);
      setStartTime(parsed.startTime);
      if (parsed.endTime) setEndTime(parsed.endTime);
    }
    if (parsed.priority !== "NONE") setPriority(parsed.priority);
    if (parsed.recurrence) setRecurrence(parsed.recurrence);
    if (parsed.tags.length > 0) setTags(parsed.tags.join(", "));
  }, [
    parsed.dueDate,
    parsed.endDate,
    parsed.startTime,
    parsed.endTime,
    parsed.priority,
    parsed.recurrence,
    parsed.tags.join(","),
  ]);

  const submit = () => {
    // The stripped title is what gets saved: "yarın 14:00 sunum" becomes a task
    // called "sunum" that is actually scheduled, not one whose name repeats its
    // own due date back at the reader.
    const trimmed = (parsed.title || title).trim();
    if (!trimmed) return;

    // `#kategori` names a category, creating it when it is new.
    let resolvedCategoryId = categoryId;
    if (!resolvedCategoryId && parsed.categoryName) {
      const wanted = parsed.categoryName.trim().toLowerCase();
      const match = categories.find((c) => c.name.trim().toLowerCase() === wanted);
      resolvedCategoryId =
        match?.id ?? addCategory(parsed.categoryName, CATEGORY_COLORS[
          categories.length % CATEGORY_COLORS.length
        ] ?? "#64748b").id;
    }

    const task = createTask({
      title: trimmed,
      description: description.trim(),
      dueDate: dueDate || null,
      endDate: endDate || null,
      allDay,
      startTime: allDay ? null : startTime || null,
      endTime: allDay || !endTime ? null : endTime,
      priority,
      categoryId: resolvedCategoryId || null,
      tags: tags
        .split(",")
        .map((t) => t.trim().replace(/^#/, ""))
        .filter(Boolean),
      recurrence,
      estimateMinutes: parsed.estimateMinutes,
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
      title={t("formNewTask")}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("cancel")}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!title.trim()}
            onClick={submit}
          >
            {t("formCreateTask")}
          </button>
        </>
      }
    >
      <Field label={t("formTitle")}>
        <input
          className="input"
          autoFocus
          value={title}
          placeholder={t("quickAddNlPlaceholder")}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            else if (e.key === "Enter") submit();
          }}
        />
        {chips.length > 0 ? (
          // Showing what was understood is what makes the parsing safe to trust:
          // a wrong guess is visible before the task is created, not after.
          <div className="nlp-chips">
            <Sparkles size={12} aria-hidden />
            {chips.map((chip) => (
              <span key={chip} className="nlp-chip">
                {chip}
              </span>
            ))}
            <span className="nlp-chip-title truncate">→ {parsed.title}</span>
          </div>
        ) : null}
      </Field>

      <Field label={t("formNotes")}>
        <textarea
          className="textarea"
          value={description}
          placeholder={t("formNotesHint")}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>

      <div className="field-row">
        <Field label={t("formStartDate")}>
          <input
            className="input"
            type="date"
            value={dueDate}
            onChange={(e) => {
              touched.current.date = true;
              setDueDate(e.target.value);
            }}
          />
        </Field>
        <Field label={t("formEndDate")}>
          <input
            className="input"
            type="date"
            value={endDate}
            min={dueDate || undefined}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </Field>
        <Field label={t("formPriority")}>
          <select
            className="select"
            value={priority}
            onChange={(e) => setPriority(e.target.value as Priority)}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t(`priority${p}`)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Switch checked={allDay} label={t("allDay")} onChange={setAllDay} />

      {!allDay ? (
        <div className="field-row">
          <Field label={t("formStart")}>
            <input
              className="input"
              type="time"
              value={startTime}
              onChange={(e) => {
                touched.current.time = true;
                setStartTime(e.target.value);
              }}
            />
          </Field>
          <Field label={t("formEnd")}>
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
        <Field label={t("formCategory")}>
          <select
            className="select"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">{t("formNone")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("formTags")} hint={t("formTagsHint")}>
          <input
            className="input"
            value={tags}
            placeholder={t("tagsPlaceholder")}
            onChange={(e) => setTags(e.target.value)}
          />
        </Field>
      </div>

      <RecurrenceEditor value={recurrence} onChange={setRecurrence} />

      <Switch
        checked={withReminder}
        label={reminderLabel(
          allDay,
          settings.defaultReminderOffset,
          settings.allDayReminderTime,
        )}
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
function reminderLabel(
  allDay: boolean,
  offsetMinutes: number,
  allDayTime: string,
): string {
  if (allDay) return `Remind me at ${shiftTime(allDayTime, -offsetMinutes)}`;
  if (offsetMinutes === 0) return "Remind me at the start time";
  return `Remind me ${offsetMinutes} min before`;
}
