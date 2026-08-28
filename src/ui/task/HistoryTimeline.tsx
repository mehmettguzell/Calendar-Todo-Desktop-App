import { useState } from "react";
import { fromInstant, localeTag } from "@/domain/datetime";
import { describeHistory } from "@/domain/history";
import { useI18n } from "@/lib/i18n";
import type { HistoryEntry } from "@/domain/types";

/**
 * The append-only trail for one task (spec section 5.5).
 * Reschedules, snoozes and status flips are all recorded, never overwritten.
 */
export function HistoryTimeline({ entries }: { entries: HistoryEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useI18n();

  if (entries.length === 0) {
    return (
      <p className="faint" style={{ margin: 0, fontSize: 12.5 }}>
        {t("historyEmpty")}
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
              {fromInstant(entry.at).toLocaleString(localeTag(), {
                dateStyle: "medium",
                timeStyle: "short",
              })}
              {entry.occurrenceDate
                ? ` · ${entry.occurrenceDate}`
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
          {t("historyShowAll", { n: entries.length })}
        </button>
      )}

      {hasMore && expanded && (
        <button
          type="button"
          className="btn ghost sm"
          style={{ alignSelf: "flex-start", marginTop: 8 }}
          onClick={() => setExpanded(false)}
        >
          {t("showLess")}
        </button>
      )}
    </div>
  );
}
