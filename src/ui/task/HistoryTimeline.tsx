import { fromInstant } from "@/domain/datetime";
import { describeHistory } from "@/domain/history";
import type { HistoryEntry } from "@/domain/types";

/**
 * The append-only trail for one task (spec section 5.5).
 * Reschedules, snoozes and status flips are all recorded, never overwritten.
 */
export function HistoryTimeline({ entries }: { entries: HistoryEntry[] }) {
  if (entries.length === 0) {
    return <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>No activity yet.</p>;
  }

  return (
    <div className="timeline">
      {entries.map((entry) => (
        <div key={entry.id} className="timeline-item">
          <span className="rail" aria-hidden />
          <div className="grow">
            <div>{describeHistory(entry)}</div>
            <time dateTime={entry.at}>
              {fromInstant(entry.at).toLocaleString([], {
                dateStyle: "medium",
                timeStyle: "short",
              })}
              {entry.occurrenceDate ? ` · occurrence ${entry.occurrenceDate}` : ""}
            </time>
          </div>
        </div>
      ))}
    </div>
  );
}
