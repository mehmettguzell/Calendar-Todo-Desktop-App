import { create } from "zustand";
import type { PlanStage } from "@/domain/plan";

export type PlanFilter = "ALL" | PlanStage;
export type TaskFilter = "all" | "high" | "overdue" | "completed";
export type TaskLayout = "list" | "priority" | "category";
export type WeekMetric = "tasks" | "focus";
/**
 * Which question the budget page is answering.
 *
 * The page used to answer all five at once, down one scroll: the month's
 * totals, then every statement ever imported, then the entry row, then the
 * standing bills, then the breakdown, then the ledger — three tab strips and
 * two forms visible at the same time. They are five separate questions asked
 * at five separate moments, and the split is what makes each one legible.
 */
export type BudgetTab =
  | "overview"
  | "entries"
  | "statements"
  | "fixed"
  | "wishlist";

/**
 * Where each page was left.
 *
 * These used to be `useState` inside the views, which is fine until you
 * remember that a view unmounts the moment you click another one in the
 * sidebar. Filtering the plans down to "Başladıklarım", stepping into Today to
 * check something and coming back put you in front of every plan again — the
 * app quietly undoing a choice you made eight seconds ago.
 *
 * Deliberately not part of the document, and deliberately not persisted:
 * "which tab am I on" is a fact about this sitting, not about the user's
 * tasks. It never reaches the disk and it never syncs — a filter arriving from
 * another device would be the same surprise in a new place.
 */
interface ViewPrefsState {
  planFilter: PlanFilter;
  budgetTab: BudgetTab;
  taskFilter: TaskFilter;
  taskLayout: TaskLayout;
  /** Which measurement the week strip is showing. */
  weekMetric: WeekMetric;
  setPlanFilter(filter: PlanFilter): void;
  setBudgetTab(tab: BudgetTab): void;
  setTaskFilter(filter: TaskFilter): void;
  setTaskLayout(layout: TaskLayout): void;
  setWeekMetric(metric: WeekMetric): void;
}

export const useViewPrefs = create<ViewPrefsState>((set) => ({
  // Plans open on the ones already under way — see `PLAN_TABS`. A first visit
  // to an empty account lands on an empty tab, which is the correct answer to
  // "what have I started": nothing yet.
  planFilter: "STARTED",
  budgetTab: "overview",
  taskFilter: "all",
  taskLayout: "list",
  weekMetric: "tasks",
  setPlanFilter: (planFilter) => set({ planFilter }),
  setBudgetTab: (budgetTab) => set({ budgetTab }),
  setTaskFilter: (taskFilter) => set({ taskFilter }),
  setTaskLayout: (taskLayout) => set({ taskLayout }),
  setWeekMetric: (weekMetric) => set({ weekMetric }),
}));
