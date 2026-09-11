import { Trash2, X } from "lucide-react";
import { MONEY_FLOWS } from "@/domain/money";
import type { RecurrenceFreq } from "@/domain/types";
import { CADENCES, FLOW_LABEL } from "./labels";
import { useFixedDraft, type FixedDraft, type FixedDraftInput } from "./fixedDraft";

/**
 * The one form, used to add and to edit.
 *
 * Same fields either way on purpose: a fixed entry the user created and one
 * they are correcting are the same record, and two different forms would be two
 * chances to disagree about what one is.
 */
export function FixedEditor(props: FixedDraftInput) {
  const d = useFixedDraft(props);

  return (
    <form className="fixed-editor" onSubmit={d.submit}>
      <div className="segmented-tabs is-sm">
        {MONEY_FLOWS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={d.flow === option}
            onClick={() => d.setFlow(option)}
          >
            {d.t(FLOW_LABEL[option])}
          </button>
        ))}
      </div>

      <label className="fixed-field grow">
        <span>{d.t("fixedName")}</span>
        <input
          className="input"
          placeholder={d.t("fixedNamePlaceholder")}
          value={d.name}
          autoFocus
          onChange={(e) => d.setName(e.target.value)}
        />
      </label>

      <label className="fixed-field">
        <span>{d.t("budgetAmount")}</span>
        <input
          className="input mono"
          inputMode="decimal"
          value={d.amount}
          aria-invalid={d.error !== null}
          onChange={(e) => {
            d.setAmount(e.target.value);
            d.setError(null);
          }}
        />
      </label>

      <label className="fixed-field">
        <span>{d.t("budgetCategory")}</span>
        <input
          className="input"
          list="fixed-category-options"
          value={d.categoryName}
          onChange={(e) => d.setCategoryName(e.target.value)}
        />
        <datalist id="fixed-category-options">
          {d.suggestions.map((category) => (
            <option key={category.id} value={category.name} />
          ))}
        </datalist>
      </label>

      <label className="fixed-field">
        <span>{d.t("budgetRepeat")}</span>
        <select
          className="input"
          value={d.freq}
          onChange={(e) => d.setFreq(e.target.value as RecurrenceFreq)}
        >
          {CADENCES.map((cadence) => (
            <option key={cadence.freq} value={cadence.freq}>
              {d.t(cadence.labelKey)}
            </option>
          ))}
        </select>
      </label>

      {d.freq === "MONTHLY" ? <MonthDayField draft={d} /> : null}

      <label className="fixed-field">
        <span>{d.t("fixedStart")}</span>
        <input
          className="input"
          type="date"
          value={d.start}
          onChange={(e) => d.setStart(e.target.value || d.today)}
        />
      </label>

      <label className="fixed-field">
        <span>{d.t("fixedEnd")}</span>
        <input
          className="input"
          type="date"
          title={d.t("fixedEndHint")}
          value={d.until}
          onChange={(e) => d.setUntil(e.target.value)}
        />
      </label>

      {d.currentEntry && d.currentEntry.id !== d.template?.id ? (
        <label className="fixed-also">
          <input
            type="checkbox"
            checked={d.alsoCurrent}
            onChange={(e) => d.setAlsoCurrent(e.target.checked)}
          />
          {d.t("fixedAlsoUpdateCurrent")}
        </label>
      ) : null}

      <FixedEditorActions draft={d} />
    </form>
  );
}

/**
 * Only monthly has a day to choose. Rent on "the last day" is common enough —
 * and impossible to write as a number that works in February — to deserve its
 * own option rather than a 28/30/31 guess.
 */
function MonthDayField({ draft: d }: { draft: FixedDraft }) {
  return (
    <label className="fixed-field">
      <span>{d.t("fixedDayOfMonth")}</span>
      <select
        className="input"
        value={d.monthDay}
        onChange={(e) => d.setMonthDay(e.target.value)}
      >
        {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
          <option key={day} value={day}>
            {day}
          </option>
        ))}
        <option value="-1">{d.t("fixedLastDayOption")}</option>
      </select>
    </label>
  );
}

function FixedEditorActions({ draft: d }: { draft: FixedDraft }) {
  return (
    <div className="fixed-editor-actions">
      <button type="submit" className="btn primary sm">
        {d.template ? d.t("save") : d.t("add")}
      </button>
      <button type="button" className="btn ghost sm" onClick={d.onDone}>
        <X size={13} /> {d.t("cancel")}
      </button>
      {d.template ? (
        <button type="button" className="btn ghost sm danger" onClick={d.remove}>
          <Trash2 size={13} /> {d.t("delete")}
        </button>
      ) : null}
      {d.error ? <span className="budget-entry-error">{d.error}</span> : null}
    </div>
  );
}
