import { useMemo } from "react";
import { getDate, getDay } from "date-fns";
import { fromLocalDate, weekdayNames } from "@/domain/datetime";
import {
  describeRecurrence,
  monthlyModeOf,
  monthlyRuleFor,
  weekdayPositionInMonth,
  type MonthlyMode,
} from "@/domain/recurrence";
import type { Recurrence, RecurrenceFreq } from "@/domain/types";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { Field } from "@/ui/components/primitives";

const FREQS: { id: RecurrenceFreq; labelKey: TranslationKey }[] = [
  { id: "DAILY", labelKey: "repeatDaily" },
  { id: "WEEKLY", labelKey: "repeatWeekly" },
  { id: "MONTHLY", labelKey: "repeatMonthly" },
  { id: "YEARLY", labelKey: "repeatYearly" },
];

const POSITION_KEYS: Record<number, TranslationKey> = {
  1: "monthPos1",
  2: "monthPos2",
  3: "monthPos3",
  4: "monthPos4",
  [-1]: "monthPosLast",
};

const MONTHLY_MODES: MonthlyMode[] = ["DAY_OF_MONTH", "LAST_DAY", "NTH_WEEKDAY"];

/**
 * Edits the rule, not the occurrences.
 *
 * A series stays a single task record: changing the rule re-derives every
 * future occurrence, while completions already recorded against past dates
 * stay exactly where they were.
 */
export function RecurrenceEditor({
  value,
  onChange,
  anchor,
}: {
  value: Recurrence | null;
  onChange: (next: Recurrence | null) => void;
  /** The task's due date — a monthly rule repeats on its day of the month. */
  anchor?: string | null;
}) {
  const { t, language } = useI18n();
  const rule = value;
  // Recomputed when the language changes, so the day buttons and the sentence
  // under them never disagree about what day 1 is called.
  const weekdays = useMemo(() => weekdayNames("short"), [language]);

  /*
   * What the three monthly options are called for *this* task.
   *
   * Every label is read off the task's own date — "Day 25", "The fourth
   * Tuesday" — because a monthly rule has no day of its own until the task has
   * one. With no date there is nothing to name, so the choice is not offered
   * and the rule keeps following the anchor, exactly as it always has.
   */
  const monthlyOptions = useMemo(() => {
    if (!anchor) return null;
    const date = fromLocalDate(anchor);
    const posKey = POSITION_KEYS[weekdayPositionInMonth(anchor)];
    const longNames = weekdayNames("long");
    // The position words are written for the middle of a sentence ("her ay ·
    // son Pazar"); at the head of an option they need a capital. Done with the
    // active locale so Turkish dotted and dotless i survive the change.
    const capitalise = (text: string) =>
      text.charAt(0).toLocaleUpperCase(language) + text.slice(1);

    return MONTHLY_MODES.map((mode) => ({
      mode,
      label: capitalise(
        mode === "DAY_OF_MONTH"
          ? t("monthlyModeDayOfMonth", { day: getDate(date) })
          : mode === "LAST_DAY"
            ? t("monthlyModeLastDay")
            : t("monthlyModeNthWeekday", {
                pos: posKey ? t(posKey) : "",
                day: longNames[getDay(date)] ?? "",
              }),
      ),
    }));
  }, [anchor, t, language]);

  const patch = (changes: Partial<Recurrence>) => {
    onChange({ ...(rule ?? { freq: "WEEKLY", interval: 1 }), ...changes });
  };

  return (
    <div className="col" style={{ gap: 10 }}>
      <Field label={t("formRepeat")}>
        <select
          className="select"
          value={rule?.freq ?? "NONE"}
          onChange={(e) =>
            e.target.value === "NONE"
              ? onChange(null)
              : patch({ freq: e.target.value as RecurrenceFreq })
          }
        >
          <option value="NONE">{t("formNoRepeat")}</option>
          {FREQS.map((f) => (
            <option key={f.id} value={f.id}>
              {t(f.labelKey)}
            </option>
          ))}
        </select>
      </Field>

      {rule ? (
        <>
          <div className="field-row">
            <Field label={t("formEvery")}>
              <input
                className="input"
                type="number"
                min={1}
                max={99}
                value={rule.interval}
                onChange={(e) => patch({ interval: Math.max(1, Number(e.target.value) || 1) })}
              />
            </Field>
            <Field label={t("formEndsOn")}>
              <input
                className="input"
                type="date"
                value={rule.until ?? ""}
                onChange={(e) => patch({ until: e.target.value || null })}
              />
            </Field>
          </div>

          {rule.freq === "WEEKLY" ? (
            <Field label={t("formOnDays")}>
              <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                {weekdays.map((label, index) => {
                  const active = rule.byWeekday?.includes(index) ?? false;
                  return (
                    <button
                      key={label}
                      type="button"
                      className="btn sm"
                      aria-pressed={active}
                      style={
                        active
                          ? { background: "var(--accent)", color: "#fff", borderColor: "transparent" }
                          : undefined
                      }
                      onClick={() => {
                        const current = rule.byWeekday ?? [];
                        const next = active
                          ? current.filter((d) => d !== index)
                          : [...current, index];
                        patch({ byWeekday: next.length > 0 ? next.sort((a, b) => a - b) : [] });
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </Field>
          ) : null}

          {rule.freq === "MONTHLY" && monthlyOptions && anchor ? (
            <Field label={t("monthlyModeLabel")}>
              <select
                className="select"
                value={monthlyModeOf(rule)}
                onChange={(e) =>
                  patch(monthlyRuleFor(e.target.value as MonthlyMode, anchor))
                }
              >
                {monthlyOptions.map((option) => (
                  <option key={option.mode} value={option.mode}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          <p className="faint" style={{ margin: 0, fontSize: 12 }}>
            {describeRecurrence(rule, t, weekdays, anchor ?? null)}
          </p>
        </>
      ) : null}
    </div>
  );
}
