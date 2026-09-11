import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { HEARTBEAT_EVENT, onDesktopEvent } from "./desktop";
import { reminderNotification } from "@/domain/notification";
import {
  collectDueReminders,
  nextReminderInstant,
  type DueReminder,
} from "@/domain/reminders";
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
 * The minute hand, aligned to the boundary rather than free-running.
 *
 * An interval started at 10:00:40 fires at 10:01:40, so `now` would change forty
 * seconds after the wall clock's minute did, and every derived OVERDUE with it.
 */
function startClock(alive: () => boolean): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = () => {
    if (!alive()) return;
    const state = useStore.getState();
    if (state.ready) state.tick();
    timer = setTimeout(tick, MINUTE_MS - (Date.now() % MINUTE_MS));
  };
  tick();
  return () => {
    if (timer !== undefined) clearTimeout(timer);
  };
}

/** One key per "this reminder, on this day, since this snooze". */
function deliveryKeyOf(due: DueReminder): string {
  const { reminder, instance } = due;
  return `${reminder.id}@${instance.date ?? "none"}@${reminder.snoozedUntil ?? ""}`;
}

/**
 * The OS banner is best effort; the card is the delivery that always happens.
 *
 * A machine that refuses notifications must not take the reminder down with it.
 */
function announce(due: DueReminder, now: Date): void {
  const { db } = useStore.getState();
  const categoryId = due.instance.task.categoryId;
  const category = categoryId
    ? (db.categories.find((c) => c.id === categoryId) ?? null)
    : null;
  void notify(reminderNotification(due.instance, now, category)).catch((error) =>
    console.error("[tempo] the OS notification did not get through", error),
  );
}

function reminderIndexes() {
  const { db } = useStore.getState();
  return {
    db,
    tasks: new Map(db.tasks.map((t) => [t.id, t])),
    occurrences: new Map(db.occurrences.map((o) => [o.id, o])),
  };
}

/** How long until the next reminder wants attention, within sane bounds. */
function sleepMs(): number {
  const { db, tasks, occurrences } = reminderIndexes();
  const now = new Date();
  const next = nextReminderInstant(db.reminders, tasks, occurrences, db.settings, now);
  const until = next ? next.getTime() - now.getTime() : MAX_SLEEP_MS;
  return Math.min(Math.max(until, MIN_SLEEP_MS), MAX_SLEEP_MS);
}

function dueNow(): DueReminder[] {
  const { db, tasks, occurrences } = reminderIndexes();
  return collectDueReminders(db.reminders, tasks, occurrences, db.settings, new Date());
}

/** Fire each due reminder exactly once, as a card and as an OS banner. */
function deliver(
  due: DueReminder[],
  delivered: Set<string>,
  show: Dispatch<SetStateAction<ActiveAlert[]>>,
): void {
  const now = new Date();
  for (const item of due) {
    const key = deliveryKeyOf(item);
    if (delivered.has(key)) continue;
    delivered.add(key);

    const { reminder, instance } = item;
    useStore.getState().markReminderFired(reminder.id, instance.date as LocalDate | null);
    announce(item, now);
    show((current) => [
      ...current.filter((a) => a.id !== key),
      { id: key, reminder, instance, firedAt: Date.now() },
    ]);
  }
}

/**
 * Anything the user does can move the next instant — adding a reminder for two
 * minutes from now, dragging a task to another day, snoozing. Re-arming on every
 * write that touches those four collections costs one walk of the reminder list,
 * and is the difference between "set a reminder and it arrives" and "set a
 * reminder and wait for the next rebuild".
 */
function watchForRearm(rearm: () => void): () => void {
  let watched = useStore.getState().db;
  return useStore.subscribe(({ db }) => {
    const unchanged =
      db.reminders === watched.reminders &&
      db.tasks === watched.tasks &&
      db.occurrences === watched.occurrences &&
      db.settings === watched.settings;
    if (unchanged) return;
    watched = db;
    rearm();
  });
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

    const deliverDue = () => deliver(dueNow(), deliveredRef.current, setAlerts);

    let reminderTimer: ReturnType<typeof setTimeout> | undefined;
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

    const stopClock = startClock(() => !cancelled);
    runReminders();
    const unsubscribe = watchForRearm(runReminders);

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
      stopClock();
      if (reminderTimer !== undefined) clearTimeout(reminderTimer);
      unsubscribe();
      unlisten?.();
    };
  }, []);

  const dismissAlert = (id: string) =>
    setAlerts((current) => current.filter((a) => a.id !== id));

  return { alerts, dismissAlert };
}
/**
 * Keeps the running focus timer's elapsed seconds ticking once per second.
 *
 * `startedAt` is when the *current run* began, so a paused timer passes null
 * and the display holds at whatever was banked — still counting up would be
 * the screen disagreeing with the button that was just pressed, and no timer
 * at all would look like the seconds had been thrown away. No interval is
 * armed while paused, either: there is nothing left to recompute.
 */
export function useElapsedSeconds(
  startedAt: string | null,
  bankedSec = 0,
): number {
  const [elapsed, setElapsed] = useState(bankedSec);

  useEffect(() => {
    if (!startedAt) {
      setElapsed(bankedSec);
      return;
    }
    const compute = () =>
      setElapsed(
        bankedSec +
          Math.max(
            0,
            Math.round((Date.now() - new Date(startedAt).getTime()) / 1000),
          ),
      );
    compute();
    const handle = setInterval(compute, 1000);
    return () => clearInterval(handle);
  }, [startedAt, bankedSec]);

  return elapsed;
}
