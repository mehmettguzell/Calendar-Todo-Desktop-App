import { useState } from "react";
import {
  formatMoney,
  parseAmount,
  type BudgetCategory,
  type DateRange,
  type FixedCostRow,
  type MoneyFlow,
  type Transaction,
} from "@/domain/money";
import type { LocalDate, Recurrence, RecurrenceFreq } from "@/domain/types";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/state/store";

export interface FixedDraftInput {
  row: FixedCostRow | null;
  categories: BudgetCategory[];
  currency: string;
  today: LocalDate;
  range: DateRange;
  onDone: () => void;
}

/** The fields of the fixed-cost form, and what saving or deleting one does. */
/* eslint-disable-next-line max-lines-per-function -- eight fields relayed, plus save and delete */
export function useFixedDraft(input: FixedDraftInput) {
  const { categories, currency, today, range, onDone } = input;
  const { t } = useI18n();
  const addTransaction = useStore((s) => s.addTransaction);
  const updateTransaction = useStore((s) => s.updateTransaction);
  const deleteTransaction = useStore((s) => s.deleteTransaction);
  const ensureBudgetCategory = useStore((s) => s.ensureBudgetCategory);

  const template = input.row?.template ?? null;
  const seed = seedFields(template, categories, today);

  const [name, setName] = useState(seed.name);
  const [amount, setAmount] = useState(seed.amount);
  const [flow, setFlow] = useState<MoneyFlow>(seed.flow);
  const [categoryName, setCategoryName] = useState(seed.categoryName);
  const [freq, setFreq] = useState<RecurrenceFreq>(seed.freq);
  const [monthDay, setMonthDay] = useState(seed.monthDay);
  const [start, setStart] = useState<LocalDate>(seed.start);
  const [until, setUntil] = useState(seed.until);
  const [error, setError] = useState<string | null>(null);

  const currentEntry = entryForThisPeriod(input.row, range);
  const [alsoCurrent, setAlsoCurrent] = useState(
    currentEntry !== null && currentEntry !== template && range.to >= today,
  );

  const buildRule = (): Recurrence => {
    const rule: Recurrence = { freq, interval: 1 };
    if (freq === "MONTHLY") {
      const day = Number(monthDay);
      rule.byMonthDay = day === -1 ? -1 : Math.min(31, Math.max(1, day || 1));
    }
    if (until) rule.until = until;
    return rule;
  };

  const save = () => {
    const amountMinor = parseAmount(amount);
    if (amountMinor === null || amountMinor === 0) {
      setError(t("budgetAmountInvalid"));
      return;
    }
    const category = categoryName.trim()
      ? ensureBudgetCategory(categoryName, flow)
      : null;
    const patch = {
      amountMinor: Math.abs(amountMinor),
      flow,
      categoryId: category?.id ?? null,
      note: name.trim(),
    };
    if (!template) {
      addTransaction({ ...patch, date: start, recurrence: buildRule() });
    } else {
      updateTransaction(template.id, {
        ...patch,
        date: start,
        recurrence: buildRule(),
      });
      if (alsoCurrent && currentEntry && currentEntry.id !== template.id) {
        updateTransaction(currentEntry.id, patch);
      }
    }
    onDone();
  };

  const remove = () => {
    if (!template) return;
    const label =
      template.note.trim() || formatMoney(template.amountMinor, currency);
    if (!window.confirm(t("fixedDeleteConfirm", { name: label }))) return;
    deleteTransaction(template.id);
    onDone();
  };

  return {
    t,
    today,
    template,
    currentEntry,
    name,
    setName,
    amount,
    setAmount,
    flow,
    setFlow,
    categoryName,
    setCategoryName,
    freq,
    setFreq,
    monthDay,
    setMonthDay,
    start,
    setStart,
    until,
    setUntil,
    error,
    setError,
    alsoCurrent,
    setAlsoCurrent,
    suggestions: categories.filter((category) => category.flow === flow),
    submit: (event: React.FormEvent) => {
      event.preventDefault();
      save();
    },
    remove,
    onDone,
  };
}

export type FixedDraft = ReturnType<typeof useFixedDraft>;

interface FixedFields {
  name: string;
  amount: string;
  flow: MoneyFlow;
  categoryName: string;
  freq: RecurrenceFreq;
  monthDay: string;
  start: LocalDate;
  until: string;
}

/** What the form opens at: blank for a new cost, the row's own values for an edit. */
function seedFields(
  template: Transaction | null,
  categories: BudgetCategory[],
  today: LocalDate,
): FixedFields {
  const blank: FixedFields = {
    name: "",
    amount: "",
    flow: "EXPENSE",
    categoryName: "",
    freq: "MONTHLY",
    monthDay: dayOfMonth(today),
    start: today,
    until: "",
  };
  if (!template) return blank;

  const rule = template.recurrence;
  return {
    name: template.note,
    amount: String(template.amountMinor / 100),
    flow: template.flow,
    categoryName:
      categories.find((c) => c.id === template.categoryId)?.name ?? "",
    freq: rule?.freq ?? "MONTHLY",
    monthDay:
      rule?.byMonthDay != null ? String(rule.byMonthDay) : dayOfMonth(template.date),
    start: template.date,
    until: rule?.until ?? "",
  };
}

function dayOfMonth(date: LocalDate): string {
  return String(Number(date.slice(8, 10)));
}

/**
 * The entry this period already holds from the template, if there is one.
 *
 * A rent rise announced mid-month usually applies to the rent already charged,
 * and hunting that row down in the ledger afterwards is the chore this panel
 * exists to remove.
 */
function entryForThisPeriod(row: FixedCostRow | null, range: DateRange) {
  const template = row?.template ?? null;
  const recorded = row?.recorded.find((entry) => entry.id !== template?.id);
  if (recorded) return recorded;
  const inRange =
    template && template.date >= range.from && template.date <= range.to;
  return inRange ? template : null;
}
