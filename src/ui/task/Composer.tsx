import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, CornerDownLeft } from "lucide-react";
import {
  describeWhen,
  shiftTime,
  toLocalDate,
  weekdayNames,
} from "@/domain/datetime";
import { describeRecurrence } from "@/domain/recurrence";
import { describeParse, parseQuickAdd } from "@/domain/naturalLanguage";
import {
  PRIORITIES,
  type LocalDate,
  type Priority,
  type Recurrence,
} from "@/domain/types";
import { CATEGORY_COLORS } from "@/data/db";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { useCategories } from "@/state/selectors";
import { useNow, useStore, type TaskDraft } from "@/state/store";
import { Field, Switch } from "@/ui/components/primitives";
import { RecurrenceEditor } from "./RecurrenceEditor";

/**
 * The one place a task is written.
 *
 * Creating a task used to mean a modal with twelve controls in it — title,
 * notes, start date, deadline, priority, an all-day switch, two times,
 * category, tags, an end date, a repeat editor and a reminder switch — every
 * one of them on screen before a single character was typed. Meanwhile the app
 * already shipped a parser that reads "yarın 14:00 sunum #İş" and fills most
 * of that in, and the form ignored it: the fields were there whether or not
 * the sentence had already answered them.
 *
 * So the line comes first and the form comes second. Type, press Enter, done.
 * What the line was understood to mean appears underneath as chips, because a
 * guess you can see before you commit is a guess worth trusting — and every
 * one of those twelve controls is still here, one press away under "Detaylar",
 * pre-filled with whatever the sentence already said.
 *
 * It is the same component inline on a page and inside the new-task modal, so
 * the five doors into "add a task" stopped being five different things.
 */
/**
 * The id every page gives its own composer, so an empty list can point at it.
 *
 * "There is nothing here" and "here is how to put something here" belong in
 * the same place: the empty state's button puts the cursor in the box at the
 * top of the page rather than sending the reader off to find it.
 */
export const COMPOSER_ID = "composer-input";

/** Returns whether there was a composer on screen to focus. */
export function focusComposer(id: string = COMPOSER_ID): boolean {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLInputElement)) return false;
  el.scrollIntoView({ block: "nearest" });
  el.focus();
  return true;
}

export function Composer({
  id = COMPOSER_ID,
  defaultDate,
  defaultTime,
  seed,
  placeholder,
  autoFocus,
  startExpanded = false,
  /** Inline on a page, or filling a modal (which supplies its own frame). */
  variant = "inline",
  submitLabel,
  onCreated,
  onCancel,
}: {
  /** Only needed when two composers share a screen. */
  id?: string;
  defaultDate?: LocalDate | null;
  defaultTime?: string | null;
  /** Fields every task from this composer carries — a plan's `tags`, say. */
  seed?: Partial<TaskDraft>;
  placeholder?: string;
  autoFocus?: boolean;
  startExpanded?: boolean;
  variant?: "inline" | "modal";
  submitLabel?: string;
  onCreated?: (taskId: string) => void;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const createTask = useStore((s) => s.createTask);
  const addReminder = useStore((s) => s.addReminder);
  const addCategory = useStore((s) => s.addCategory);
  const settings = useStore((s) => s.db.settings);
  const categories = useCategories();
  const now = useNow();

  const [title, setTitle] = useState("");
  const [expanded, setExpanded] = useState(startExpanded);
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState<string>(
    defaultDate ?? toLocalDate(now),
  );
  const [endDate, setEndDate] = useState<string>("");
  const [deadline, setDeadline] = useState<string>("");
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
  const [focused, setFocused] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * What the title box understood, recomputed as it is typed.
   *
   * The parse only ever *fills in* fields — it never overwrites one the user
   * has already touched by hand, which is what `touched` tracks. Typing a date
   * and then correcting it in the date picker has to stick.
   */
  const parsed = useMemo(
    () => parseQuickAdd(title, now, settings.weekStartsOn),
    [title, now, settings.weekStartsOn],
  );
  // Said back in the reader's own words: "Yarın", not "2026-08-26".
  const chips = useMemo(
    () =>
      describeParse(parsed, {
        day: (date) => describeWhen(date, null, now),
        repeat: (rule) =>
          describeRecurrence(rule, t, weekdayNames("short"), parsed.dueDate),
        deadline: (shown) => t("composerChipDeadline", { date: shown }),
      }),
    [parsed, now, t],
  );
  // "Touched" means the user edited the field, not that it started with a
  // value. Seeding it from `defaultDate` — which the calendar always supplies —
  // meant a parsed date was computed, shown in the preview, and then silently
  // ignored by the field it was supposed to fill.
  const touched = useRef({ date: false, time: false });

  useEffect(() => {
    if (parsed.dueDate && !touched.current.date) setDueDate(parsed.dueDate);
    if (parsed.endDate && !touched.current.date) setEndDate(parsed.endDate);
    if (parsed.deadline && !touched.current.date) setDeadline(parsed.deadline);
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
    parsed.deadline,
    parsed.startTime,
    parsed.endTime,
    parsed.priority,
    parsed.recurrence,
    parsed.tags.join(","),
  ]);

  const reset = () => {
    setTitle("");
    setDescription("");
    setEndDate("");
    setDeadline("");
    setPriority("NONE");
    setCategoryId("");
    setTags("");
    setRecurrence(null);
    setDueDate(defaultDate ?? toLocalDate(now));
    setAllDay(!defaultTime);
    setStartTime(defaultTime ?? "09:00");
    setEndTime("");
    touched.current = { date: false, time: false };
  };

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
      const match = categories.find(
        (c) => c.name.trim().toLowerCase() === wanted,
      );
      resolvedCategoryId =
        match?.id ??
        addCategory(
          parsed.categoryName,
          CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length] ??
            "#64748b",
        ).id;
    }

    const task = createTask({
      title: trimmed,
      description: description.trim(),
      dueDate: dueDate || null,
      endDate: endDate || null,
      deadline: deadline || null,
      allDay,
      startTime: allDay ? null : startTime || null,
      endTime: allDay || !endTime ? null : endTime,
      priority,
      categoryId: resolvedCategoryId || null,
      tags: tags
        .split(",")
        .map((tag) => tag.trim().replace(/^#/, ""))
        .filter(Boolean),
      recurrence,
      estimateMinutes: parsed.estimateMinutes,
      ...seed,
    });

    if (withReminder && dueDate) {
      addReminder({
        taskId: task.id,
        kind: "RELATIVE",
        offsetMinutes: settings.defaultReminderOffset,
        remindAt: null,
      });
    }

    reset();
    onCreated?.(task.id);
    // Inline, the box stays where it is and takes the next task; someone
    // adding four things in a row should not have to click back into it.
    if (variant === "inline") inputRef.current?.focus();
  };

  const ready = (parsed.title || title).trim().length > 0;

  return (
    <div className={cn("composer", variant === "modal" && "is-modal")}>
      <div className="composer-line">
        <input
          id={id}
          ref={inputRef}
          className="composer-input"
          autoFocus={autoFocus}
          value={title}
          placeholder={placeholder ?? t("composerPlaceholder")}
          aria-label={t("formTitle")}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape" && onCancel) {
              onCancel();
            }
          }}
        />
        {/* Named, not just a chevron. A bare caret at the end of an input is a
            control nobody presses because nobody knows what is behind it, and
            what is behind it is every field this box replaced. */}
        <button
          type="button"
          className={cn("btn ghost sm composer-details-btn", expanded && "active")}
          aria-expanded={expanded}
          title={t("composerDetails")}
          onClick={() => setExpanded((v) => !v)}
        >
          {t("composerDetails")}
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {/* The button appears with the first character.
            A disabled grey button sitting on an empty box is dead weight on
            the one control the whole app is trying to make inviting; an empty
            composer is now just a line waiting to be typed in. */}
        {ready ? (
          <button type="button" className="btn primary sm" onClick={submit}>
            <CornerDownLeft size={13} /> {submitLabel ?? t("add")}
          </button>
        ) : null}
      </div>

      {chips.length > 0 ? (
        <div className="composer-chips">
          {chips.map((chip) => (
            <span key={chip} className="composer-chip">
              {chip}
            </span>
          ))}
          <span className="composer-chip is-quiet truncate">
            {parsed.title}
          </span>
        </div>
      ) : null}

      {/* Taught, not advertised.
          The examples used to live in the placeholder, which meant the longest
          sentence on the page sat inside the emptiest box. They appear once the
          cursor is in the box and there is nothing to preview yet — exactly the
          moment someone is deciding what to type — and go away for good as soon
          as the line says anything. */}
      {focused && chips.length === 0 && !ready ? (
        <div className="composer-teach">{t("composerExamples")}</div>
      ) : null}

      {expanded ? (
        <div className="composer-details">
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
            <Field label={t("formDeadline")}>
              <input
                className="input"
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
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

          {/* A multi-day run sits with the repeat rule, as it does in the
              panel: both answer "over how many days", which the deadline
              above does not. */}
          <Field label={t("formEndDate")} hint={t("formEndDateHint")}>
            <input
              className="input"
              type="date"
              value={endDate}
              min={dueDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </Field>

          <RecurrenceEditor
            value={recurrence}
            onChange={setRecurrence}
            anchor={dueDate || null}
          />

          <Switch
            checked={withReminder}
            label={reminderLabel(
              allDay,
              settings.defaultReminderOffset,
              settings.allDayReminderTime,
              t,
            )}
            onChange={setWithReminder}
          />
        </div>
      ) : null}
    </div>
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
  t: (
    key:
      | "composerRemindAtTime"
      | "composerRemindAtStart"
      | "composerRemindBefore",
    params?: Record<string, string | number>,
  ) => string,
): string {
  if (allDay) {
    return t("composerRemindAtTime", {
      time: shiftTime(allDayTime, -offsetMinutes),
    });
  }
  if (offsetMinutes === 0) return t("composerRemindAtStart");
  return t("composerRemindBefore", { n: offsetMinutes });
}
