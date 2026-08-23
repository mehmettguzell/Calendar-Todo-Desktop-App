import { describeRecurrence, WEEKDAY_SHORT } from "@/domain/recurrence";
import type { Recurrence, RecurrenceFreq } from "@/domain/types";
import { useI18n } from "@/lib/i18n";
import { Field } from "@/ui/components/primitives";

const FREQS: { id: RecurrenceFreq; label: string }[] = [
  { id: "DAILY", label: "Daily" },
  { id: "WEEKLY", label: "Weekly" },
  { id: "MONTHLY", label: "Monthly" },
  { id: "YEARLY", label: "Yearly" },
];

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
}: {
  value: Recurrence | null;
  onChange: (next: Recurrence | null) => void;
}) {
  const { t } = useI18n();
  const rule = value;

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
              {f.label}
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
                {WEEKDAY_SHORT.map((label, index) => {
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

          <p className="faint" style={{ margin: 0, fontSize: 12 }}>
            {describeRecurrence(rule)}
          </p>
        </>
      ) : null}
    </div>
  );
}
