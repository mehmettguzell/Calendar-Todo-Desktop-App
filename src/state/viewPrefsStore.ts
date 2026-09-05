import { create } from "zustand";
import type { PlanStage } from "@/domain/plan";

export type PlanFilter = "ALL" | PlanStage;
export type TaskFilter = "all" | "high" | "overdue" | "completed";
export type TaskLayout = "list" | "priority" | "category";
export type WeekMetric = "tasks" | "focus";

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
  taskFilter: TaskFilter;
  taskLayout: TaskLayout;
  /** Which measurement the week strip is showing. */
  weekMetric: WeekMetric;
  setPlanFilter(filter: PlanFilter): void;
  setTaskFilter(filter: TaskFilter): void;
  setTaskLayout(layout: TaskLayout): void;
  setWeekMetric(metric: WeekMetric): void;
}

export const useViewPrefs = create<ViewPrefsState>((set) => ({
  planFilter: "ALL",
  taskFilter: "all",
  taskLayout: "list",
  weekMetric: "tasks",
  setPlanFilter: (planFilter) => set({ planFilter }),
  setTaskFilter: (taskFilter) => set({ taskFilter }),
  setTaskLayout: (taskLayout) => set({ taskLayout }),
  setWeekMetric: (weekMetric) => set({ weekMetric }),
}));
