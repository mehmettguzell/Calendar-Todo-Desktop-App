import { useEffect, useRef, useState } from "react";
import { HEARTBEAT_EVENT, onDesktopEvent } from "./desktop";
import { reminderNotification } from "@/domain/notification";
import { collectDueReminders, nextReminderInstant } from "@/domain/reminders";
import type { LocalDate, Reminder, TaskInstance } from "@/domain/types";
import { useStore } from "@/state/store";
import { notify } from "./notifications";

/**
 * The longest the reminder timer will sleep in one go.
 *
 * Not a polling interval: with nothing due, nothing runs for this whole stretch.
 * It is a ceiling because a timer armed for next Tuesday cannot survive a
 * suspend, a clock change or a `setTimeout` overflow, so the schedule is
 * rebuilt from the data at least this often.
 */
const MAX_SLEEP_MS = 10 * 60_000;

/** Never arm a zero-delay timer; that is a spin loop with extra steps. */
const MIN_SLEEP_MS = 250;

const MINUTE_MS = 60_000;

export interface ActiveAlert {
  id: string;
  reminder: Reminder;
  instance: TaskInstance;
  firedAt: number;
}

/**
 * Delivers reminders, and keeps `now` honest.
 *
 * These are two jobs with two different clocks, on purpose.
 *
 * `now` advances on the minute, because that is the resolution at which a
 * displayed time can go stale — a task turning OVERDUE, "in 5 minutes" becoming
 * "in 4". It is one `setState` and nothing else.
 *
 * Reminders do not poll at all. The scheduler asks the domain when the next one
 * is due and sleeps until precisely that instant, so a reminder set for 14:00
 * costs nothing between now and 14:00 instead of a scan every twenty seconds.
 * That is cheaper on a laptop battery, and it is the shape a phone needs: the
 * same `nextReminderInstant` answer is what you hand an operating system when
 * registering a local notification ahead of time, on a platform that will not
 * let the process stay awake to check for itself.
 */
export function useReminderScheduler(): {
  alerts: ActiveAlert[];
  dismissAlert: (id: string) => void;
} {
  const [alerts, setAlerts] = useState<ActiveAlert[]>([]);
  const deliveredRef = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;

    /* -- the clock ---------------------------------------------------- */
    let clockTimer: ReturnType<typeof setTimeout> | undefined;

    // Aligned to the boundary rather than a free-running interval, so `now`
    // changes when the wall clock's minute does, not 40 seconds afterwards.
    const tickClock = () => {
      if (cancelled) return;
      const state = useStore.getState();
      if (state.ready) state.tick();
      clockTimer = setTimeout(tickClock, MINUTE_MS - (Date.now() % MINUTE_MS));
    };

    /* -- reminders ---------------------------------------------------- */
    let reminderTimer: ReturnType<typeof setTimeout> | undefined;

    const deliverDue = () => {
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
        const category = instance.task.categoryId
          ? (db.categories.find((c) => c.id === instance.task.categoryId) ?? null)
          : null;
        void notify(reminderNotification(instance, now, category)).catch((error) =>
          console.error("[tempo] the OS notification did not get through", error),
        );

        setAlerts((current) => [
          ...current.filter((a) => a.id !== deliveryKey),
          { id: deliveryKey, reminder, instance, firedAt: Date.now() },
        ]);
      }
    };

    /** How long until the next reminder wants attention. */
    const sleepMs = (): number => {
      const { db } = useStore.getState();
      const now = new Date();
      const next = nextReminderInstant(
        db.reminders,
        new Map(db.tasks.map((t) => [t.id, t])),
        new Map(db.occurrences.map((o) => [o.id, o])),
        db.settings,
        now,
      );
      const until = next ? next.getTime() - now.getTime() : MAX_SLEEP_MS;
      return Math.min(Math.max(until, MIN_SLEEP_MS), MAX_SLEEP_MS);
    };

    const runReminders = () => {
      if (cancelled) return;
      if (reminderTimer !== undefined) clearTimeout(reminderTimer);
      if (!useStore.getState().ready) {
        reminderTimer = setTimeout(runReminders, MIN_SLEEP_MS * 4);
        return;
      }
      deliverDue();
      if (cancelled) return;
      reminderTimer = setTimeout(runReminders, sleepMs());
    };

    tickClock();
    runReminders();

    /*
     * Anything the user does can move the next instant — adding a reminder for
     * two minutes from now, dragging a task to another day, snoozing. Re-arming
     * on every write costs one walk of the reminder list and is the difference
     * between "set a reminder and it arrives" and "set a reminder and wait for
     * the next rebuild".
     */
    let watched = useStore.getState().db;
    const unsubscribe = useStore.subscribe((state) => {
      const { db } = state;
      if (
        db.reminders === watched.reminders &&
        db.tasks === watched.tasks &&
        db.occurrences === watched.occurrences &&
        db.settings === watched.settings
      ) {
        return;
      }
      watched = db;
      runReminders();
    });

    // A hidden window has its timers throttled by the webview, so the host
    // process supplies a beat that is not — which is what keeps a reminder set
    // this morning arriving this evening with the app down in the tray.
    let unlisten: (() => void) | undefined;
    void onDesktopEvent(HEARTBEAT_EVENT, runReminders).then((off) => {
      if (cancelled) off();
      else unlisten = off;
    });

    return () => {
      cancelled = true;
      if (clockTimer !== undefined) clearTimeout(clockTimer);
      if (reminderTimer !== undefined) clearTimeout(reminderTimer);
      unsubscribe();
      unlisten?.();
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
