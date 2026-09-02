import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlarmClock,
  ChevronRight,
  CornerDownRight,
  Copy,
  Plus,
  StickyNote,
  Target,
  Trash2,
  Unlink,
  X,
  ArrowLeft,
} from "lucide-react";
import { formatTracked, localeTag, weekdayNames } from "@/domain/datetime";
import { describeRecurrence } from "@/domain/recurrence";
import { plansAcceptingTask } from "@/domain/task";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { PRIORITIES, type Priority, type TaskInstance } from "@/domain/types";
import {
  useCategories,
  useSubtasks,
  useTaskHistory,
  useTrackedSeconds,
  useTaskById,
} from "@/state/selectors";
import { useStore } from "@/state/store";
import { Field, Popover, StatusBadge, Switch } from "@/ui/components/primitives";
import { useClipboardStore } from "@/state/clipboardStore";
import { ExtraDaysPicker } from "./ExtraDaysPicker";
import { taskResistance } from "@/domain/resistance";
import { RecurrenceEditor } from "./RecurrenceEditor";
import { ReminderEditor } from "./ReminderEditor";
import { SnoozeMenu } from "./SnoozeMenu";
import { SubtaskList } from "./SubtaskList";
import { useRequestDelete } from "./useRequestDelete";

/**
 * The task's single editing surface.
 *
 * Everything the spec attaches to a task lives here, on one record: schedule,
 * category, tags, subtasks, recurrence, reminders and focus time.
 * Edits write straight to the store, so the calendar behind the panel updates
 * as you type.
 */
export function TaskPanel({
  instance,
  closing,
  onClose,
  onOpenTask,
}: {
  instance: TaskInstance;
  /** Rendering only so it can animate out; see `usePresence`. */
  closing?: boolean;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const { task } = instance;
  const updateTask = useStore((s) => s.updateTask);
  const requestDelete = useRequestDelete();
  const toggleComplete = useStore((s) => s.toggleComplete);
  const setStatus = useStore((s) => s.setStatus);
  const clearSnooze = useStore((s) => s.clearSnooze);
  const reschedule = useStore((s) => s.reschedule);
  const setParent = useStore((s) => s.setParent);
  const makePlan = useStore((s) => s.makePlan);
  const createTask = useStore((s) => s.createTask);
  const startFocus = useStore((s) => s.startFocus);
  const stopFocus = useStore((s) => s.stopFocus);
  const runningFocus = useStore((s) => s.runningFocus);
  const copyToClipboard = useClipboardStore((s) => s.copy);
  const clip = useClipboardStore((s) => s.clip);
  const categories = useCategories();
  const { t } = useI18n();
  const history = useTaskHistory(task.id);
  const tracked = useTrackedSeconds(task.id);
  const subtasks = useSubtasks(task.id);
  const convertToNote = useStore((s) => s.convertToNote);
  const reminders = useStore((s) => s.db.reminders);

  /*
   * What each folded section holds, said in one phrase.
   *
   * This is what makes folding honest rather than hiding: a shut section still
   * tells you there are two reminders on this task, so nothing is lost by
   * leaving it shut.
   */
  const taskReminders = useMemo(
    () => reminders.filter((r) => r.taskId === task.id && r.status !== "DISMISSED"),
    [reminders, task.id],
  );
  const repeatSummary = useMemo(() => {
    if (task.recurrence) {
      return describeRecurrence(task.recurrence, t, weekdayNames("short"), task.dueDate);
    }
    return task.endDate ? t("formEndDate") : null;
  }, [task.recurrence, task.endDate, task.dueDate, t]);
  const doneSubtasks = subtasks.filter((s) => s.status === "COMPLETED").length;
  const allTasks = useStore((s) => s.db.tasks);
  const isPlan = task.tags.includes("plan") && task.parentId === null;
  const openPlans = useMemo(
    () => plansAcceptingTask(allTasks, task),
    [allTasks, task],
  );

  /**
   * What the task's own history says about how it is going.
   *
   * Reading only — nothing is stored and nothing changes. Below three
   * postponements this is `none` and the panel renders exactly as before.
   */
  const resistance = useMemo(() => taskResistance(history), [history]);

  /**
   * How the estimate held up.
   *
   * Only shown once there is something to compare — an untouched timer would
   * otherwise report every task as 100% under budget.
   */
  const estimateDelta = useMemo(() => {
    const estimate = task.estimateMinutes ?? 0;
    if (estimate <= 0 || tracked <= 0) return null;
    const actual = Math.round(tracked / 60);
    const ratio = Math.round((actual / estimate) * 100);
    return {
      over: actual > estimate,
      label: `${actual}/${estimate} ${t("minutesShort")} · %${ratio}`,
    };
  }, [task.estimateMinutes, tracked, t]);
  const parentTask = useTaskById(task.parentId);

  const [title, setTitle] = useState(task.title);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [description, setDescription] = useState(task.description);
  const [tagInput, setTagInput] = useState(task.tags.join(", "));
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [planMenuOpen, setPlanMenuOpen] = useState(false);

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
    <aside className={cn("panel", closing && "is-closing")} inert={closing}>
      <div className="panel-head">
        <StatusBadge status={instance.status} />
        {instance.isRecurring && instance.date ? (
          <span className="faint mono" style={{ fontSize: 11 }}>
            {t("occurrenceLabel")} {instance.date}
          </span>
        ) : null}
        <span className="grow" />
        {/* Copying a task is a real command but not one of the three things a
            user came here to do, so it sits with the window controls. */}
        <button
          type="button"
          className={cn("btn ghost icon", clip?.taskId === task.id && "primary")}
          aria-label={t("menuCopy")}
          title={t("menuCopy")}
          onClick={() =>
            copyToClipboard(task.id, task.title, instance.date ?? task.dueDate)
          }
        >
          <Copy size={14} />
        </button>
        <button
          type="button"
          className="btn ghost icon"
          onClick={onClose}
          aria-label={t("closePanel")}
        >
          <X size={16} />
        </button>
      </div>

      <div className="panel-body scroll">
        {parentTask ? (
          <div
            className="row"
            style={{ alignSelf: "flex-start", marginBottom: 12, gap: 2 }}
          >
            <button
              type="button"
              className="btn ghost sm"
              style={{ paddingLeft: 4, paddingRight: 8 }}
              onClick={() => onOpenTask(parentTask.id)}
              title={t("backTo", { title: parentTask.title })}
            >
              <ArrowLeft size={14} />{" "}
              <span className="truncate" style={{ maxWidth: 220 }}>
                {parentTask.title}
              </span>
            </button>
            {/* Filing a task under a parent has to be as undoable as it was
                easy, or the breadcrumb is a one-way door. */}
            <button
              type="button"
              className="btn ghost icon"
              title={t("detachFromParent", { title: parentTask.title })}
              aria-label={t("detachFromParent", { title: parentTask.title })}
              onClick={() => setParent(task.id, null)}
            >
              <Unlink size={13} />
            </button>
          </div>
        ) : null}
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
          placeholder={t("untitledTask")}
        />

        <div className="row" style={{ position: "relative", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn primary"
            onClick={() => toggleComplete(instance)}
          >
            {instance.storedStatus === "COMPLETED"
              ? t("menuReopen")
              : t("menuComplete")}
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
            {isFocused ? t("pause") : t("startShort")}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setSnoozeOpen((v) => !v)}
          >
            <AlarmClock size={14} /> {t("snooze")}
          </button>
          {instance.status === "SNOOZED" ? (
            <button
              type="button"
              className="btn ghost"
              onClick={() => clearSnooze(ref)}
            >
              {t("wakeNow")}
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

        <Field label={t("formNotes")}>
          <textarea
            className="textarea"
            value={description}
            placeholder={t("notesPlaceholder")}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() =>
              description !== task.description &&
              updateTask(task.id, { description })
            }
          />
        </Field>

        {/* Scheduling and priority are the two edits almost every visit makes,
            so they are the two that are never behind a fold. */}
        <div className="panel-essentials">
          <div className="field-row">
            <Field label={t("formStartDate")}>
              <input
                className="input"
                type="date"
                value={task.dueDate ?? ""}
                // Through `reschedule`, not `updateTask`: typing a date here
                // is the same act as dragging the task onto that day, so it
                // carries the same end-date shift, history entry and undo.
                onChange={(e) => reschedule(task.id, e.target.value || null)}
              />
            </Field>
            {/* The deadline sits beside the start date rather than in a fold:
                "when do I have to be done" is the other half of "when do I
                start", and burying it is what made it unfindable before. */}
            <Field
              label={t("formDeadline")}
              hint={task.recurrence ? t("formDeadlineRepeat") : undefined}
            >
              <input
                className="input"
                type="date"
                value={task.deadline ?? ""}
                disabled={task.recurrence !== null}
                onChange={(e) =>
                  updateTask(task.id, { deadline: e.target.value || null })
                }
              />
            </Field>
          </div>

          <Field label={t("formPriority")}>
            <select
              className="select"
              value={task.priority}
              onChange={(e) =>
                updateTask(task.id, { priority: e.target.value as Priority })
              }
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`priority${p}`)}
                </option>
              ))}
            </select>
          </Field>

          <Switch
            checked={task.allDay}
            label={t("allDay")}
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
              <Field label={t("formStart")}>
                <input
                  className="input"
                  type="time"
                  value={task.startTime ?? ""}
                  onChange={(e) =>
                    updateTask(task.id, { startTime: e.target.value || null })
                  }
                />
              </Field>
              <Field label={t("formEnd")}>
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

          <Field label={t("formCategory")}>
            <select
              className="select"
              value={task.categoryId ?? ""}
              onChange={(e) =>
                updateTask(task.id, { categoryId: e.target.value || null })
              }
            >
              <option value="">{t("formNone")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <PanelSection
          key={`repeat:${task.id}`}
          title={t("formRepeat")}
          summary={repeatSummary}
          defaultOpen={task.recurrence !== null}
        >
          <Field label={t("formEndDate")} hint={t("formEndDateHint")}>
            <input
              className="input"
              type="date"
              value={task.endDate ?? ""}
              min={task.dueDate ?? undefined}
              onChange={(e) =>
                updateTask(task.id, { endDate: e.target.value || null })
              }
            />
          </Field>

          {/* Above the repeat rule on purpose: "also on Thursday" is the
              small, frequent wish, and it is expressed as a rule bounded to
              this week — so the repeat editor below shows the same fact from
              the other side, and stretching its end date is how an extra day
              grows into a real weekly repeat. */}
          <Field label={t("extraDaysTitle")}>
            <ExtraDaysPicker task={task} />
          </Field>

          <RecurrenceEditor
            value={task.recurrence}
            onChange={(recurrence) => updateTask(task.id, { recurrence })}
            anchor={task.dueDate}
          />
        </PanelSection>

        <PanelSection
          key={`subtasks:${task.id}`}
          title={t("formSubtasks")}
          summary={
            subtasks.length > 0
              ? t("subtaskProgress", { done: doneSubtasks, total: subtasks.length })
              : null
          }
          defaultOpen={subtasks.length > 0}
        >
          <SubtaskList parent={task} onOpen={onOpenTask} />
        </PanelSection>

        <PanelSection
          key={`reminders:${task.id}`}
          title={t("formReminders")}
          summary={
            taskReminders.length > 0
              ? t("remindersCount", { n: taskReminders.length })
              : null
          }
          defaultOpen={taskReminders.length > 0}
        >
          <ReminderEditor task={task} />
        </PanelSection>

        <PanelSection
          key={`tags:${task.id}`}
          title={t("formTags")}
          summary={task.tags.length > 0 ? task.tags.map((tag) => `#${tag}`).join(" ") : null}
          defaultOpen={task.tags.length > 0}
        >
          <Field label={t("formTags")} hint={t("formTagsHint")}>
            <input
              className="input"
              value={tagInput}
              placeholder={t("tagsPlaceholder")}
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
        </PanelSection>

        {/* No second start button: the one at the top of the panel already
            starts and stops this task's timer, and two of them left users
            wondering whether they were the same clock. */}
        <PanelSection
          key={`focus:${task.id}`}
          title={t("formFocus")}
          summary={tracked > 0 ? formatTracked(tracked) : null}
        >
          <Field label={t("formEstimate")}>
            <div className="row" style={{ gap: 6 }}>
              <input
                className="input"
                type="number"
                min={0}
                step={5}
                style={{ width: 96 }}
                placeholder="—"
                value={task.estimateMinutes ?? ""}
                onChange={(e) =>
                  updateTask(task.id, {
                    estimateMinutes: e.target.value
                      ? Math.max(0, Number(e.target.value))
                      : null,
                  })
                }
              />
              <span className="faint" style={{ fontSize: 12 }}>
                {t("minutesShort")}
              </span>
              {estimateDelta ? (
                // Planned against actual, in one line. A record of how wrong
                // the last twenty guesses were is the only thing that makes the
                // next one better.
                <span
                  className={cn("estimate-delta", estimateDelta.over && "over")}
                  title={t("estimateVsActual")}
                >
                  {estimateDelta.label}
                </span>
              ) : null}
            </div>
          </Field>
        </PanelSection>

        {resistance.level !== "none" ? (
          <div className={cn("card", "resistance", resistance.level)}>
            <div className="resistance-head">
              <AlarmClock size={14} aria-hidden />
              <span>
                {t(
                  resistance.level === "stuck"
                    ? "resistanceStuck"
                    : "resistanceNoticed",
                  { count: resistance.postponements },
                )}
              </span>
            </div>
            {resistance.since ? (
              <p className="faint">
                {t("resistanceSince", {
                  date: new Date(resistance.since).toLocaleDateString(localeTag()),
                })}
              </p>
            ) : null}
            <p className="faint">{t("resistanceHint")}</p>
            <button
              type="button"
              className="btn sm"
              onClick={() =>
                createTask({
                  title: t("resistanceFirstStep"),
                  parentId: task.id,
                  categoryId: task.categoryId,
                  estimateMinutes: 10,
                })
              }
            >
              <Plus size={14} />
              {t("resistanceAction")}
            </button>
          </div>
        ) : null}
      </div>

      <div className="panel-foot">
        <div className="panel-foot-actions">
          {/* Everything a task's relationship to the plans can be, behind one
              button. It used to be a right-click menu on the row, which is a
              gesture nobody finds, and a separate button that could only ever
              make a plan — never file the task into one. */}
          <div style={{ position: "relative" }}>
            <button
              type="button"
              className="btn ghost sm"
              aria-expanded={planMenuOpen}
              onClick={() => setPlanMenuOpen((v) => !v)}
            >
              <Target size={14} />
              <span className="truncate" style={{ maxWidth: 140 }}>
                {parentTask ? parentTask.title : t("moveToPlans")}
              </span>
            </button>
            {planMenuOpen ? (
              <div className="popover-up">
                <Popover onClose={() => setPlanMenuOpen(false)} align="left">
                  {isPlan ? (
                    <button
                      type="button"
                      className="popover-item"
                      onClick={() => {
                        updateTask(task.id, {
                          tags: task.tags.filter((tag) => tag !== "plan"),
                        });
                        setPlanMenuOpen(false);
                      }}
                    >
                      <Unlink size={14} /> {t("removeFromPlans")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="popover-item"
                      onClick={() => {
                        makePlan(task.id);
                        setPlanMenuOpen(false);
                      }}
                    >
                      <Target size={14} /> {t("menuMakePlan")}
                    </button>
                  )}

                  {openPlans.map((plan) => (
                    <button
                      key={plan.id}
                      type="button"
                      className="popover-item"
                      onClick={() => {
                        setParent(task.id, plan.id);
                        setPlanMenuOpen(false);
                      }}
                    >
                      <CornerDownRight size={14} />
                      <span className="truncate">{plan.title}</span>
                    </button>
                  ))}

                  {parentTask ? (
                    <button
                      type="button"
                      className="popover-item"
                      onClick={() => {
                        setParent(task.id, null);
                        setPlanMenuOpen(false);
                      }}
                    >
                      <Unlink size={14} /> {t("detachFromParent", { title: parentTask.title })}
                    </button>
                  ) : null}
                </Popover>
              </div>
            ) : null}
          </div>

          {parentTask && (task.dueDate || instance.date) ? (
            <button
              type="button"
              className="btn ghost sm"
              title={t("removeFromToday")}
              onClick={() => {
                updateTask(task.id, { dueDate: null });
                onClose();
              }}
            >
              {t("removeFromTodayShort")}
            </button>
          ) : null}

          {/* The mirror of the note panel's "turn into a task". Disabled rather
              than hidden when the task has subtasks, so the answer to "why can
              I not do this here" is on the button itself. */}
          <button
            type="button"
            className="btn ghost sm"
            disabled={subtasks.length > 0}
            title={
              subtasks.length > 0 ? t("taskToNoteBlocked") : t("taskToNoteHint")
            }
            onClick={() => {
              if (convertToNote(task.id)) onClose();
            }}
          >
            <StickyNote size={13} /> {t("taskToNote")}
          </button>
        </div>

        <div className="panel-foot-meta">
          <span className="faint" style={{ fontSize: 11 }}>
            {t("createdOn", {
              date: new Date(task.createdAt).toLocaleDateString(localeTag()),
            })}
          </span>
          {/* Named for what it does — moving to the trash — rather than for
              where the task ends up, so it does not read as a link to the
              trash view. */}
          <button
            type="button"
            className="btn danger-quiet sm"
            onClick={() => {
              if (requestDelete(task.id)) onClose();
            }}
          >
            <Trash2 size={13} /> {t("menuDelete")}
          </button>
        </div>
      </div>
    </aside>
  );
}

/**
 * One foldable block of the panel.
 *
 * The panel used to show every control it owns at once — end dates, repeat
 * rules, tags, estimates — whether or not the task used any of them, and most
 * tasks use almost none. So a section that holds nothing collapses to a single
 * line, and one that holds something says what, in the same line, without being
 * opened. The controls did not go anywhere; they stopped shouting.
 */
function PanelSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  /** What this section holds, read at a glance while it is shut. */
  summary?: string | null;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={cn("card", "panel-section", open && "is-open")}>
      <button
        type="button"
        className="panel-section-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight size={13} className="panel-section-caret" aria-hidden />
        <span className="panel-section-title">{title}</span>
        {!open && summary ? (
          <span className="panel-section-summary">{summary}</span>
        ) : null}
      </button>
      {open ? <div className="panel-section-body">{children}</div> : null}
    </div>
  );
}
