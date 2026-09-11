import {
  formatTracked,
} from "@/domain/datetime";
import { cn } from "@/lib/cn";
import {
  Field,
} from "@/ui/components/primitives";
import { ExtraDaysPicker } from "../ExtraDaysPicker";
import { RecurrenceEditor } from "../RecurrenceEditor";
import { ReminderEditor } from "../ReminderEditor";
import { SubtaskList } from "../SubtaskList";
import type { TaskPanelModel } from "./useTaskPanel";
import { PanelSection } from "./PanelSection";

/**
 * Everything that folds away: repeat, reminders, checkpoints, extra days, steps.
 *
 * Folding is honest rather than hiding — each shut section still carries a
 * summary, so nothing is lost by leaving it closed.
 */
export function PanelSections({ model: m }: { model: TaskPanelModel }) {
  return (
    <>
    <PanelSection
      key={`repeat:${m.task.id}`}
      title={m.t("formRepeat")}
      summary={m.repeatSummary}
      defaultOpen={m.task.recurrence !== null}
    >
      <Field label={m.t("formEndDate")} hint={m.t("formEndDateHint")}>
        <input
          className="input"
          type="date"
          value={m.task.endDate ?? ""}
          min={m.task.dueDate ?? undefined}
          onChange={(e) =>
            m.updateTask(m.task.id, { endDate: e.target.value || null })
          }
        />
      </Field>

      {/* Above the repeat rule on purpose: "also on Thursday" is the
          small, frequent wish, and it is expressed as a rule bounded to
          this week — so the repeat editor below shows the same fact from
          the other side, and stretching its end date is how an extra day
          grows into a real weekly repeat. */}
      <Field label={m.t("extraDaysTitle")}>
        <ExtraDaysPicker task={m.task} />
      </Field>

      <RecurrenceEditor
        value={m.task.recurrence}
        onChange={(recurrence) => m.updateTask(m.task.id, { recurrence })}
        anchor={m.task.dueDate}
      />
    </PanelSection>

    <PanelSection
      key={`subtasks:${m.task.id}`}
      title={m.t("formSubtasks")}
      summary={
        m.subtasks.length > 0
          ? m.t("subtaskProgress", { done: m.doneSubtasks, total: m.subtasks.length })
          : null
      }
      defaultOpen={m.subtasks.length > 0}
    >
      <SubtaskList parent={m.task} onOpen={m.onOpenTask} />
    </PanelSection>

    <PanelSection
      key={`reminders:${m.task.id}`}
      title={m.t("formReminders")}
      summary={
        m.taskReminders.length > 0
          ? m.t("remindersCount", { n: m.taskReminders.length })
          : null
      }
      defaultOpen={m.taskReminders.length > 0}
    >
      <ReminderEditor task={m.task} />
    </PanelSection>

    <PanelSection
      key={`tags:${m.task.id}`}
      title={m.t("formTags")}
      summary={m.task.tags.length > 0 ? m.task.tags.map((tag) => `#${tag}`).join(" ") : null}
      defaultOpen={m.task.tags.length > 0}
    >
      <Field label={m.t("formTags")} hint={m.t("formTagsHint")}>
        <input
          className="input"
          value={m.tagInput}
          placeholder={m.t("tagsPlaceholder")}
          onChange={(e) => m.setTagInput(e.target.value)}
          onBlur={() => {
            const tags = m.tagInput
              .split(",")
              .map((tag) => tag.trim().replace(/^#/, ""))
              .filter(Boolean);
            if (tags.join(",") !== m.task.tags.join(","))
              m.updateTask(m.task.id, { tags });
          }}
        />
      </Field>
    </PanelSection>

    {/* No second start button: the one at the top of the panel already
        starts and stops this task's timer, and two of them left users
        wondering whether they were the same clock. */}
    <PanelSection
      key={`focus:${m.task.id}`}
      title={m.t("formFocus")}
      summary={m.tracked > 0 ? formatTracked(m.tracked) : null}
    >
      <Field label={m.t("formEstimate")}>
        <div className="row" style={{ gap: 6 }}>
          <input
            className="input"
            type="number"
            min={0}
            step={5}
            style={{ width: 96 }}
            placeholder="—"
            value={m.task.estimateMinutes ?? ""}
            onChange={(e) =>
              m.updateTask(m.task.id, {
                estimateMinutes: e.target.value
                  ? Math.max(0, Number(e.target.value))
                  : null,
              })
            }
          />
          <span className="faint" style={{ fontSize: "var(--text-xs)" }}>
            {m.t("minutesShort")}
          </span>
          {m.estimateDelta ? (
            // Planned against actual, in one line. A record of how wrong
            // the last twenty guesses were is the only thing that makes the
            // next one better.
            <span
              className={cn("estimate-delta", m.estimateDelta.over && "over")}
              title={m.t("estimateVsActual")}
            >
              {m.estimateDelta.label}
            </span>
          ) : null}
        </div>
      </Field>
    </PanelSection>
    </>
  );
}
