import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, CornerDownLeft } from "lucide-react";
import {
  describeWhen,
  weekdayNames,
} from "@/domain/datetime";
import { describeRecurrence } from "@/domain/recurrence";
import { describeParse, parseQuickAdd } from "@/domain/naturalLanguage";
import { ComposerDetails } from "./ComposerDetails";
import { useComposerFields } from "./composerFields";
import {
  draftDetails,
  filledByParse,
  resolveCategoryId,
} from "./composerDraft";
import {
  type LocalDate,
} from "@/domain/types";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { useCategories } from "@/state/selectors";
import { useNow, useStore } from "@/state/store";
import type { TaskDraft } from "@/state/storeTypes";

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

  const f = useComposerFields({ defaultDate, defaultTime, startExpanded, now });
  const {
    title,
    setTitle,
    expanded,
    setExpanded,
    description,
    dueDate,
    setDueDate,
    endDate,
    setEndDate,
    deadline,
    setDeadline,
    allDay,
    setAllDay,
    startTime,
    setStartTime,
    endTime,
    setEndTime,
    priority,
    setPriority,
    categoryId,
    tags,
    setTags,
    recurrence,
    setRecurrence,
    withReminder,
    touched,
    reset,
  } = f;

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
  useEffect(() => {
    const filled = filledByParse(parsed, touched.current);
    if (filled.dueDate !== undefined) setDueDate(filled.dueDate);
    if (filled.endDate !== undefined) setEndDate(filled.endDate);
    if (filled.deadline !== undefined) setDeadline(filled.deadline);
    if (filled.allDay !== undefined) setAllDay(filled.allDay);
    if (filled.startTime !== undefined) setStartTime(filled.startTime);
    if (filled.endTime !== undefined) setEndTime(filled.endTime);
    if (filled.priority !== undefined) setPriority(filled.priority);
    if (filled.recurrence !== undefined) setRecurrence(filled.recurrence);
    if (filled.tags !== undefined) setTags(filled.tags);
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

  const submit = () => {
    // The stripped title is what gets saved: "yarın 14:00 sunum" becomes a task
    // called "sunum" that is actually scheduled, not one whose name repeats its
    // own due date back at the reader.
    const trimmed = (parsed.title || title).trim();
    if (!trimmed) return;

    const resolvedCategoryId = resolveCategoryId(
      categoryId,
      parsed.categoryName,
      categories,
      addCategory,
    );

    const task = createTask({
      title: trimmed,
      ...draftDetails({
        description,
        dueDate,
        endDate,
        deadline,
        allDay,
        startTime,
        endTime,
        priority,
        categoryId,
        tags,
        recurrence,
      }),
      categoryId: resolvedCategoryId || null,
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

      <ComposerDetails fields={f} categories={categories} settings={settings} t={t} />
    </div>
  );
}
