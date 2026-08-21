import { useEffect, useRef, useState } from "react";
import { describeWhen } from "@/domain/datetime";
import { collectDueReminders } from "@/domain/reminders";
import type { LocalDate, Reminder, TaskInstance } from "@/domain/types";
import { useStore } from "@/state/store";
import { notify } from "./notifications";

/** How often the clock is re-read. Cheap: it only walks pending reminders. */
const TICK_MS = 20_000;

export interface ActiveAlert {
  id: string;
  reminder: Reminder;
  instance: TaskInstance;
  firedAt: number;
}

/**
 * Drives two time-dependent behaviours from one interval:
 *   1. advancing `now`, which is what turns a task OVERDUE, and
 *   2. delivering reminders that have come due.
 *
 * Returns the alerts still awaiting a decision, which the UI renders as cards
 * carrying the spec's [Complete] [Snooze] [Open] actions.
 */
export function useReminderScheduler(): {
  alerts: ActiveAlert[];
  dismissAlert: (id: string) => void;
} {
  const [alerts, setAlerts] = useState<ActiveAlert[]>([]);
  const deliveredRef = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;

    const run = () => {
      if (cancelled) return;
      const state = useStore.getState();
      if (!state.ready) return;

      state.tick();

      const { db } = useStore.getState();
      const now = new Date();
      const tasks = new Map(db.tasks.map((t) => [t.id, t]));
      const occurrences = new Map(db.occurrences.map((o) => [o.id, o]));
      const due = collectDueReminders(db.reminders, tasks, occurrences, db.settings, now);

      for (const { reminder, instance } of due) {
        const deliveryKey = `${reminder.id}@${instance.date ?? "none"}@${
          reminder.snoozedUntil ?? ""
        }`;
        if (deliveredRef.current.has(deliveryKey)) continue;
        deliveredRef.current.add(deliveryKey);

        useStore.getState().markReminderFired(reminder.id, instance.date as LocalDate | null);

        // The card below is the delivery that always happens; the OS banner is
        // best effort, and a machine that refuses it must not take the reminder
        // down with it.
        void notify({
          title: instance.task.title,
          body: describeWhen(instance.date, instance.task.allDay ? null : instance.task.startTime, now),
        }).catch((error) => console.error("[tempo] the OS notification did not get through", error));

        setAlerts((current) => [
          ...current.filter((a) => a.id !== deliveryKey),
          { id: deliveryKey, reminder, instance, firedAt: Date.now() },
        ]);
      }
    };

    run();
    const handle = setInterval(run, TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, []);

  const dismissAlert = (id: string) => setAlerts((current) => current.filter((a) => a.id !== id));

  return { alerts, dismissAlert };
}

/** Keeps the running focus timer's elapsed seconds ticking once per second. */
export function useElapsedSeconds(startedAt: string | null): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startedAt) {
      setElapsed(0);
      return;
    }
    const compute = () =>
      setElapsed(Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 1000)));
    compute();
    const handle = setInterval(compute, 1000);
    return () => clearInterval(handle);
  }, [startedAt]);

  return elapsed;
}
