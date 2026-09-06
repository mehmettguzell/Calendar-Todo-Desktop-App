import { Flag } from "lucide-react";
import { describeWhen, toLocalDate } from "@/domain/datetime";
import type { TaskInstance } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { useNow } from "@/state/store";

/**
 * The deadlines falling in a window, drawn as dates rather than as work.
 *
 * A deadline used to arrive in Today and Görevler as an ordinary `TaskRow`:
 * checkbox, priority stripe, drag handle, a timer button offering to track
 * time against a date. Ticking it did nothing anybody meant, and a day with
 * three tasks and two checkpoints on it read as five things to do — the count
 * in the heading said so.
 *
 * So a marker gets a shape of its own, and the shape is the message: one line,
 * no checkbox, no handle, no hover actions, a dashed edge, and the date at the
 * end rather than a status. It is still the same click through to the same
 * editor — nothing here is a second record of anything (spec section 3) — it
 * simply stops pretending to be a row of work.
 *
 * Nothing is drawn when the window holds no deadlines, which for most people
 * is most days.
 */
export function DeadlineMarkers({
  markers,
  onOpen,
  className,
}: {
  markers: TaskInstance[];
  onOpen: (instance: TaskInstance) => void;
  className?: string;
}) {
  const { t } = useI18n();
  const now = useNow();

  if (markers.length === 0) return null;

  return (
    <section className={cn("deadline-markers", className)}>
      <h2 className="deadline-markers-head">
        <Flag size={13} aria-hidden />
        {t("deadlinesHeading")}
        <span className="count">{markers.length}</span>
      </h2>

      <ul className="deadline-marker-list">
        {markers.map((marker) => (
          <DeadlineMarker
            key={marker.key}
            marker={marker}
            now={now}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </section>
  );
}

function DeadlineMarker({
  marker,
  now,
  onOpen,
}: {
  marker: TaskInstance;
  now: Date;
  onOpen: (instance: TaskInstance) => void;
}) {
  const { t } = useI18n();
  /*
   * A named checkpoint says what finishes; a task's own deadline has no name
   * of its own, so it borrows the task's title and drops the second line —
   * printing "Sunum · Sunum" is how a marker starts looking like a row again.
   */
  const named = marker.deadlineLabel ?? null;
  const met = marker.deadlineMet === true;
  const missed = !met && marker.date !== null && marker.date < toLocalDate(now);

  return (
    <li>
      <button
        type="button"
        className={cn(
          "deadline-marker",
          missed && "is-missed",
          met && "is-met",
        )}
        onClick={() => onOpen(marker)}
        title={t("deadlineOn", { date: marker.date ?? "" })}
      >
        <Flag size={12} className="deadline-marker-flag" aria-hidden />
        <span className="deadline-marker-name truncate">
          {named ?? marker.task.title}
        </span>
        {named ? (
          <span className="deadline-marker-of truncate">
            {marker.task.title}
          </span>
        ) : null}
        <span className="deadline-marker-when">
          {describeWhen(marker.date, null, now)}
        </span>
      </button>
    </li>
  );
}
