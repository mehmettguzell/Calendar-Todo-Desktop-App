import { useState } from "react";
import { fromInstant } from "@/domain/datetime";
import { describeHistory } from "@/domain/history";
import type { HistoryEntry } from "@/domain/types";

/**
 * The append-only trail for one task (spec section 5.5).
 * Reschedules, snoozes and status flips are all recorded, never overwritten.
 */
export function HistoryTimeline({ entries }: { entries: HistoryEntry[] }) {
  const [expanded, setExpanded] = useState(false);

  if (entries.length === 0) {
    return (
      <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>
        No activity yet.
      </p>
    );
  }

  const limit = 3;
  const hasMore = entries.length > limit;
  const visible = expanded ? entries : entries.slice(0, limit);

  return (
    <div className="timeline">
      {visible.map((entry) => (
        <div key={entry.id} className="timeline-item">
          <span className="rail" aria-hidden />
          <div className="grow">
            <div>{describeHistory(entry)}</div>
            <time dateTime={entry.at}>
              {fromInstant(entry.at).toLocaleString([], {
                dateStyle: "medium",
                timeStyle: "short",
              })}
              {entry.occurrenceDate
                ? ` · occurrence ${entry.occurrenceDate}`
                : ""}
            </time>
          </div>
        </div>
      ))}

      {hasMore && !expanded && (
        <button
          type="button"
          className="btn ghost sm"
          style={{ alignSelf: "flex-start", marginTop: 8 }}
          onClick={() => setExpanded(true)}
        >
          Show all {entries.length} entries...
        </button>
      )}

      {hasMore && expanded && (
        <button
          type="button"
          className="btn ghost sm"
          style={{ alignSelf: "flex-start", marginTop: 8 }}
          onClick={() => setExpanded(false)}
        >
          Show less
        </button>
      )}
    </div>
  );
}
