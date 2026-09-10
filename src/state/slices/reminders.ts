import {
  appendHistory,
} from "../taskMutations";
import {
  pruneTombstones,
  tombstone,
} from "@/data/db";
import {
  nowInstant,
} from "@/domain/datetime";
import {
  historyEntry,
} from "@/domain/history";
import {
  createId,
} from "@/domain/ids";
import {
  Reminder,
} from "@/domain/types";
import type { SliceTools, StoreState } from "../storeState";

// Alarms attached to a task or one occurrence of a series.
export type ReminderSlice = Pick<
  StoreState,
  | "addReminder"
  | "removeReminder"
  | "markReminderFired"
  | "snoozeReminder"
  | "dismissReminder"
>;

export function createReminderSlice({ commit }: SliceTools): ReminderSlice {
  return {
  addReminder(input) {
    const at = nowInstant();
    const reminder: Reminder = {
      ...input,
      id: createId("r"),
      status: "PENDING",
      snoozedUntil: null,
      lastFiredFor: null,
      createdAt: at,
      updatedAt: at,
    };
    commit((db) =>
      appendHistory(
        { ...db, reminders: [...db.reminders, reminder] },
        historyEntry({ taskId: reminder.taskId, kind: "REMINDER_ADDED" }),
      ),
    );
  },
  removeReminder(reminderId) {
    commit((db) => {
      const reminder = db.reminders.find((r) => r.id === reminderId);
      if (!reminder) return db;
      return appendHistory(
        {
          ...db,
          reminders: db.reminders.filter((r) => r.id !== reminderId),
          tombstones: pruneTombstones([
            ...db.tombstones,
            tombstone("reminder", reminderId, nowInstant()),
          ]),
        },
        historyEntry({ taskId: reminder.taskId, kind: "REMINDER_REMOVED" }),
      );
    });
  },
  markReminderFired(reminderId, occurrenceDate) {
    commit((db) => {
      const reminder = db.reminders.find((r) => r.id === reminderId);
      if (!reminder) return db;
      const task = db.tasks.find((t) => t.id === reminder.taskId);
      const recurring = task?.recurrence != null;
      const next: Reminder = {
        ...reminder,
        // A series keeps its reminder alive for the next occurrence.
        status: recurring ? "PENDING" : "FIRED",
        lastFiredFor: occurrenceDate ?? reminder.lastFiredFor,
        snoozedUntil: null,
        updatedAt: nowInstant(),
      };
      return appendHistory(
        {
          ...db,
          reminders: db.reminders.map((r) =>
            r.id === reminderId ? next : r,
          ),
        },
        historyEntry({
          taskId: reminder.taskId,
          kind: "REMINDER_FIRED",
          occurrenceDate: occurrenceDate ?? null,
        }),
      );
    });
  },
  snoozeReminder(reminderId, until) {
    commit((db) => ({
      ...db,
      reminders: db.reminders.map((r) =>
        r.id === reminderId
          ? {
              ...r,
              snoozedUntil: until,
              status: "PENDING" as const,
              updatedAt: nowInstant(),
            }
          : r,
      ),
    }));
  },
  dismissReminder(reminderId) {
    commit((db) => ({
      ...db,
      reminders: db.reminders.map((r) =>
        r.id === reminderId
          ? { ...r, status: "DISMISSED" as const, updatedAt: nowInstant() }
          : r,
      ),
    }));
  },
  };
}
