import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "@/data/localDocument";
import {
  emptyDatabase,
  type Database,
} from "@/data/db";
import { ANONYMOUS_NAMESPACE } from "@/data/namespace";
import { toLocalDate } from "@/domain/datetime";
import { occurrenceId } from "@/domain/ids";
import { toInstance } from "@/domain/task";
import type { StoreState } from "./storeState";
import { createDocumentSlice } from "./slices/document";
import { createMoneySlice } from "./slices/money";
import { createBulkSlice } from "./slices/bulk";
import { createHierarchySlice } from "./slices/hierarchy";
import { createScheduleSlice } from "./slices/schedule";
import { createTaskSlice } from "./slices/tasks";
import { createCategorySlice } from "./slices/categories";
import { createReminderSlice } from "./slices/reminders";
import { createFocusSlice } from "./slices/focus";
import { createDeadlineSlice } from "./slices/deadlines";
import { createWishlistSlice } from "./slices/wishlist";
import type {
  LocalDate,
  Occurrence,
  Settings,
  Task,
  TaskInstance,
} from "@/domain/types";

export const useStore = create<StoreState>((set, get) => {
  /** Every mutation goes through here, so nothing can skip history or persistence. */
  const commit = (mutate: (db: Database) => Database) => {
    set((state) => {
      const db = mutate(state.db);
      persist(db);
      return { db };
    });
  };

  const tools = { set, get, commit };

  return {
    ...createDocumentSlice(tools),
    ...createMoneySlice(tools),
    ...createBulkSlice(tools),
    ...createHierarchySlice(tools),
    ...createScheduleSlice(tools),
    ...createTaskSlice(tools),
    ...createCategorySlice(tools),
    ...createReminderSlice(tools),
    ...createFocusSlice(tools),
    ...createDeadlineSlice(tools),
    ...createWishlistSlice(tools),

    ready: false,
    db: emptyDatabase(),
    namespace: ANONYMOUS_NAMESPACE,
    now: Date.now(),
    runningFocus: null,
  };
});

/* ------------------------------------------------------------------ */
/* Hooks shared across the UI                                          */
/* ------------------------------------------------------------------ */

/**
 * The shared clock, as a stable object.
 *
 * Identity matters: this `Date` is a dependency of nearly every memo in the
 * app, so it must only change when the minute does.
 */
export function useNow(): Date {
  const now = useStore((s) => s.now);
  return useMemo(() => new Date(now), [now]);
}

export function useSettings(): Settings {
  return useStore((s) => s.db.settings);
}

/** Resolve a task on a date, pulling in its occurrence override when relevant. */
export function instanceFor(
  task: Task,
  occurrences: Map<string, Occurrence>,
  date: LocalDate | null,
  now: Date,
): TaskInstance {
  const key = date ? occurrenceId(task.id, date) : "";
  return toInstance(task, date, occurrences.get(key) ?? null, now);
}

export function todayLocal(now: Date): LocalDate {
  return toLocalDate(now);
}
