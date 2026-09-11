import {
  PRIORITIES,
  type Priority,
} from "@/domain/types";
import { useI18n } from "@/lib/i18n";
import { Field, Switch } from "@/ui/components/primitives";
import { RecurrenceEditor } from "./RecurrenceEditor";
import { shiftTime } from "@/domain/datetime";
import type { Category, Settings } from "@/domain/types";
import type { ComposerFields } from "./composerFields";

/**
 * The fields behind "Detaylar".
 *
 * Shut by default: a one-line box plus a parse is what capture should cost, and
 * a form nobody opened is a form nobody had to read.
 */
export function ComposerDetails({
  fields: f,
  categories,
  settings,
  t,
}: {
  fields: ComposerFields;
  categories: Category[];
  settings: Settings;
  t: ReturnType<typeof useI18n>["t"];
}) {
  if (!f.expanded) return null;

  return (
    <div className="composer-details">
      <Field label={t("formNotes")}>
        <textarea
          className="textarea"
          value={f.description}
          placeholder={t("formNotesHint")}
          onChange={(e) => f.setDescription(e.target.value)}
        />
      </Field>

      <div className="field-row">
        <Field label={t("formStartDate")}>
          <input
            className="input"
            type="date"
            value={f.dueDate}
            onChange={(e) => {
              f.touched.current.date = true;
              f.setDueDate(e.target.value);
            }}
          />
        </Field>
        <Field label={t("formDeadline")}>
          <input
            className="input"
            type="date"
            value={f.deadline}
            onChange={(e) => f.setDeadline(e.target.value)}
          />
        </Field>
        <Field label={t("formPriority")}>
          <select
            className="select"
            value={f.priority}
            onChange={(e) => f.setPriority(e.target.value as Priority)}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t(`priority${p}`)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Switch checked={f.allDay} label={t("allDay")} onChange={f.setAllDay} />

      {!f.allDay ? (
        <div className="field-row">
          <Field label={t("formStart")}>
            <input
              className="input"
              type="time"
              value={f.startTime}
              onChange={(e) => {
                f.touched.current.time = true;
                f.setStartTime(e.target.value);
              }}
            />
          </Field>
          <Field label={t("formEnd")}>
            <input
              className="input"
              type="time"
              value={f.endTime}
              onChange={(e) => f.setEndTime(e.target.value)}
            />
          </Field>
        </div>
      ) : null}

      <div className="field-row">
        <Field label={t("formCategory")}>
          <select
            className="select"
            value={f.categoryId}
            onChange={(e) => f.setCategoryId(e.target.value)}
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
            value={f.tags}
            placeholder={t("tagsPlaceholder")}
            onChange={(e) => f.setTags(e.target.value)}
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
          value={f.endDate}
          min={f.dueDate || undefined}
          onChange={(e) => f.setEndDate(e.target.value)}
        />
      </Field>

      <RecurrenceEditor
        value={f.recurrence}
        onChange={f.setRecurrence}
        anchor={f.dueDate || null}
      />

      <Switch
        checked={f.withReminder}
        label={reminderLabel(
          f.allDay,
          settings.defaultReminderOffset,
          settings.allDayReminderTime,
          t,
        )}
        onChange={f.setWithReminder}
      />
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
