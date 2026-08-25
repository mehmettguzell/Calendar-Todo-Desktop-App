import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AlarmClock,
  Copy,
  Play,
  Square,
  Trash2,
  X,
  ArrowLeft,
} from "lucide-react";
import { formatTracked, localeTag } from "@/domain/datetime";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { PRIORITIES, type Priority, type TaskInstance } from "@/domain/types";
import {
  useCategories,
  useTaskHistory,
  useTrackedSeconds,
  useTaskById,
} from "@/state/selectors";
import { useStore } from "@/state/store";
import { Field, StatusBadge, Switch } from "@/ui/components/primitives";
import { useClipboardStore } from "@/state/clipboardStore";
import { ExtraDaysPicker } from "./ExtraDaysPicker";
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
  const deleteTask = useStore((s) => s.deleteTask);
  const toggleComplete = useStore((s) => s.toggleComplete);
  const setStatus = useStore((s) => s.setStatus);
  const clearSnooze = useStore((s) => s.clearSnooze);
  const startFocus = useStore((s) => s.startFocus);
  const stopFocus = useStore((s) => s.stopFocus);
  const runningFocus = useStore((s) => s.runningFocus);
  const copyToClipboard = useClipboardStore((s) => s.copy);
  const clip = useClipboardStore((s) => s.clip);
  const categories = useCategories();
  const { t } = useI18n();
  const history = useTaskHistory(task.id);
  const tracked = useTrackedSeconds(task.id);

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
          <button
            type="button"
            className="btn ghost sm"
            style={{
              alignSelf: "flex-start",
              marginBottom: 12,
              paddingLeft: 4,
              paddingRight: 8,
            }}
            onClick={() => onOpenTask(parentTask.id)}
            title={t("backTo", { title: parentTask.title })}
          >
            <ArrowLeft size={14} />{" "}
            <span className="truncate" style={{ maxWidth: 220 }}>
              {parentTask.title}
            </span>
          </button>
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
          <button
            type="button"
            className={cn("btn icon", clip?.taskId === task.id && "primary")}
            aria-label={t("menuCopy")}
            title={`${t("menuCopy")} — ${t("calendarDayHint")}`}
            onClick={() =>
              copyToClipboard(
                task.id,
                task.title,
                instance.date ?? task.dueDate,
              )
            }
          >
            <Copy size={14} />
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

        <div className="card">
          <div className="card-head">{t("cardSchedule")}</div>
          <div className="col" style={{ gap: 10 }}>
            <div className="field-row">
              <Field label={t("formStartDate")}>
                <input
                  className="input"
                  type="date"
                  value={task.dueDate ?? ""}
                />
              </Field>
              <Field label={t("formEndDate")}>
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
            </div>

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
            />
          </div>
        </div>

        <div className="card">
          <div className="card-head">{t("cardOrganise")}</div>
          <div className="col" style={{ gap: 10 }}>
            <div className="field-row">
              <Field label={t("formPriority")}>
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
                      {t(`priority${p}`)}
                    </option>
                  ))}
                </select>
              </Field>
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
          </div>
        </div>

        <div className="card">
          <div className="card-head">{t("formSubtasks")}</div>
          <SubtaskList parent={task} onOpen={onOpenTask} />
        </div>

        <div className="card">
          <div className="card-head">{t("formReminders")}</div>
          <ReminderEditor task={task} />
        </div>

        <div className="card">
          <div className="card-head">
            {t("formFocus")}
            <span className="mono">{formatTracked(tracked)}</span>
          </div>

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

          <button
            type="button"
            className={isFocused ? "btn danger" : "btn"}
            onClick={() => (isFocused ? stopFocus() : startFocus(instance))}
          >
            {isFocused ? <Square size={14} /> : <Play size={14} />}
            {isFocused ? t("formStopTimer") : t("formStartTimer")}
          </button>
        </div>

        <div className="card">
          <div className="card-head">{t("formHistory")}</div>
          <HistoryTimeline entries={history} />
        </div>
      </div>

      <div className="panel-foot">
        <span className="grow faint" style={{ fontSize: 11.5 }}>
          {t("createdOn", {
            date: new Date(task.createdAt).toLocaleDateString(localeTag()),
          })}
        </span>
        {task.tags.includes("plan") ? (
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => {
              updateTask(task.id, {
                tags: task.tags.filter((t) => t !== "plan"),
              });
            }}
          >
            {t("removeFromPlans")}
          </button>
        ) : (
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => {
              updateTask(task.id, {
                tags: [...task.tags.filter((t) => t !== "plan"), "plan"],
                dueDate: null,
                startTime: null,
                endTime: null,
                allDay: true,
              });
            }}
          >
            {t("moveToPlans")}
          </button>
        )}
        <button
          type="button"
          className="btn danger"
          onClick={() => {
            deleteTask(task.id);
            onClose();
          }}
        >
          <Trash2 size={14} /> {t("trash")}
        </button>
      </div>
    </aside>
  );
}
