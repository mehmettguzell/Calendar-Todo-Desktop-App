import {
  Flag,
  Target,
  Timer,
} from "lucide-react";
import { describeWhen, formatTracked } from "@/domain/datetime";
import { cn } from "@/lib/cn";
import type { TaskRowModel } from "./useTaskRow";

/**
 * Meta is text, not chrome.
 *
 * This line carried up to eight bordered pills — a rounded outline around every
 * fact a task happens to have. Five outlined chips under a title are no quieter
 * than the eight shapes they replaced, and none of them is the thing being read.
 * So it reads as a sentence, separated by middots, in the faint colour. The only
 * fact that keeps a shape of its own is the one that changes what you would do
 * next: a deadline already missed.
 */
/* eslint-disable-next-line complexity -- a flat list of optional items, not branching logic */
export function TaskRowMeta({ model: m }: { model: TaskRowModel }) {
  return (
    <div className="task-meta">
      {m.showDate || m.time ? (
        <span className={cn("meta-item", m.isLate && "is-overdue")}>
          {m.showDate
            ? describeWhen(m.instance.date, m.time ? m.task.startTime : null, m.now)
            : null}
          {m.time && !m.showDate ? m.time : null}
        </span>
      ) : null}

      {/* Always in front of the rest: the day a task must be done by is
          what a list is scanned for. */}
      {m.task.deadline && !m.task.recurrence ? (
        m.isLate ? (
          <span
            className="meta-pill is-overdue"
            title={m.t("deadlineOn", { date: m.task.deadline })}
          >
            <Flag size={11} aria-hidden />
            {m.task.deadline}
          </span>
        ) : (
          <span
            className="meta-item"
            title={m.t("deadlineOn", { date: m.task.deadline })}
          >
            <Flag size={11} aria-hidden />
            {m.task.deadline}
          </span>
        )
      ) : null}

      {m.category ? (
        <span className="meta-item">
          <i className="dot" style={{ background: m.category.color }} />
          {m.category.name}
        </span>
      ) : null}

      {m.parentTask ? (
        <span className="meta-item" title={m.parentTask.title}>
          <Target size={11} aria-hidden />
          <span className="truncate" style={{ maxWidth: 150 }}>
            {m.parentTask.title}
          </span>
        </span>
      ) : null}

      {m.subtasks.length > 0 ? (
        <span className="meta-item mono">
          {m.doneSubtasks}/{m.subtasks.length}
        </span>
      ) : null}

      {m.tracked > 0 ? (
        <span className="meta-item">
          <Timer size={11} aria-hidden />
          {formatTracked(m.tracked)}
        </span>
      ) : null}

      {m.task.tags.map((tag) => (
        <span key={tag} className="meta-item">
          #{tag}
        </span>
      ))}
    </div>
  );
}
