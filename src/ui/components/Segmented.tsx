import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface Segment<T extends string> {
  id: T;
  label: string;
  /** Drawn as a pill inside the tab. `undefined` draws nothing, `0` draws 0. */
  count?: number;
  icon?: ReactNode;
  /** `danger` colours the count when it is the kind of number you act on. */
  tone?: "default" | "danger";
  /** Kept out of the strip entirely. Use for a tab with nothing behind it. */
  hidden?: boolean;
}

/**
 * One row of mutually exclusive choices — the app's only tab strip.
 *
 * There were four of these, all hand-rolled: the calendar's `.segmented`, the
 * plans page's `.plan-tab-btn`, the tasks page's `.filter-pill`, and its
 * `.tasks-view-btn` beside them. Four shapes for one idea, and the tasks page
 * wore two of them at once, which is what made "which of these rows is the
 * filter?" a question at all.
 *
 * **The count lives in the tab.** A page that puts its numbers in a separate
 * band above the filters says everything twice, and the two can disagree. Here
 * the number and the thing it counts are the same control: pressing the number
 * shows you what it counted.
 */
export function Segmented<T extends string>({
  value,
  segments,
  onChange,
  ariaLabel,
  size = "md",
}: {
  value: T;
  segments: Segment<T>[];
  onChange: (id: T) => void;
  ariaLabel: string;
  size?: "sm" | "md";
}) {
  const visible = segments.filter((s) => !s.hidden);
  return (
    <div
      className={cn("segmented-tabs", size === "sm" && "is-sm")}
      role="tablist"
      aria-label={ariaLabel}
    >
      {visible.map((segment) => (
        <button
          key={segment.id}
          type="button"
          role="tab"
          aria-selected={value === segment.id}
          className={cn("segmented-tab", value === segment.id && "active")}
          onClick={() => onChange(segment.id)}
        >
          {segment.icon}
          {segment.label}
          {segment.count === undefined ? null : (
            <span
              className={cn(
                "segmented-count",
                segment.tone === "danger" && segment.count > 0 && "is-danger",
              )}
            >
              {segment.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
