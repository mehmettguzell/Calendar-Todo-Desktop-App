import {
  PRIORITIES,
  type Priority,
} from "@/domain/types";
import {
  Field,
  Switch,
} from "@/ui/components/primitives";
import type { TaskPanelModel } from "./useTaskPanel";

/** Schedule, priority, estimate and category: the four fields always shown. */
export function PanelEssentials({ model: m }: { model: TaskPanelModel }) {
  return (
    <div className="panel-essentials">
      <div className="field-row">
        <Field label={m.t("formStartDate")}>
          <input
            className="input"
            type="date"
            value={m.task.dueDate ?? ""}
            // Through `reschedule`, not `updateTask`: typing a date here
            // is the same act as dragging the task onto that day, so it
            // carries the same end-date shift, history entry and undo.
            onChange={(e) => m.reschedule(m.task.id, e.target.value || null)}
          />
        </Field>
        {/* The deadline sits beside the start date rather than in a fold:
            "when do I have to be done" is the other half of "when do I
            start", and burying it is what made it unfindable before. */}
        <Field
          label={m.t("formDeadline")}
          hint={m.task.recurrence ? m.t("formDeadlineRepeat") : undefined}
        >
          <input
            className="input"
            type="date"
            value={m.task.deadline ?? ""}
            disabled={m.task.recurrence !== null}
            onChange={(e) =>
              m.updateTask(m.task.id, { deadline: e.target.value || null })
            }
          />
        </Field>
      </div>

      <Field label={m.t("formPriority")}>
        <select
          className="select"
          value={m.task.priority}
          onChange={(e) =>
            m.updateTask(m.task.id, { priority: e.target.value as Priority })
          }
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {m.t(`priority${p}`)}
            </option>
          ))}
        </select>
      </Field>

      <Switch
        checked={m.task.allDay}
        label={m.t("allDay")}
        onChange={(allDay) =>
          m.updateTask(m.task.id, {
            allDay,
            startTime: allDay ? null : (m.task.startTime ?? "09:00"),
            endTime: allDay ? null : m.task.endTime,
          })
        }
      />

      {!m.task.allDay ? (
        <div className="field-row">
          <Field label={m.t("formStart")}>
            <input
              className="input"
              type="time"
              value={m.task.startTime ?? ""}
              onChange={(e) =>
                m.updateTask(m.task.id, { startTime: e.target.value || null })
              }
            />
          </Field>
          <Field label={m.t("formEnd")}>
            <input
              className="input"
              type="time"
              value={m.task.endTime ?? ""}
              onChange={(e) =>
                m.updateTask(m.task.id, { endTime: e.target.value || null })
              }
            />
          </Field>
        </div>
      ) : null}

      <Field label={m.t("formCategory")}>
        <select
          className="select"
          value={m.task.categoryId ?? ""}
          onChange={(e) =>
            m.updateTask(m.task.id, { categoryId: e.target.value || null })
          }
        >
          <option value="">{m.t("formNone")}</option>
          {m.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}
