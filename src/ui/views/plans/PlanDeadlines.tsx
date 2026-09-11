import {
  isMissed,
  type Deadline,
} from "@/domain/deadline";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { useDeadlines } from "@/state/selectors";
import { useStore } from "@/state/store";
import { DeadlineEditor } from "@/ui/task/DeadlineEditor";
import {
  ChevronDown,
  ChevronRight,
  Flag,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";

// A plan's checkpoints: the list, and one editable row of it.
/**
 * The dated checkpoints a plan is broken into.
 *
 * Separate from the plan's own deadline, which says when the whole thing is
 * due, and separate from its steps, which are the work: "backend bitecek, 25
 * Eylül" is a date the project has to reach, whether or not a step is named
 * after it. See `domain/deadline` for why each one is a record of its own.
 *
 * The section keeps the shape of the steps list beside it — a header that
 * folds, rows, an add row at the bottom — so a card reads as one thing rather
 * than two lists that happen to share a border.
 */
export function PlanDeadlines({ taskId, today }: { taskId: string; today: string }) {
  const { t } = useI18n();
  const deadlines = useDeadlines(taskId);
  const addDeadline = useStore((s) => s.addDeadline);
  const setDeadlineMet = useStore((s) => s.setDeadlineMet);
  const removeDeadline = useStore((s) => s.removeDeadline);

  // Open once there is something to read, folded away while there is not.
  const [expanded, setExpanded] = useState(true);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [date, setDate] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const met = deadlines.filter((d) => d.completedAt !== null).length;

  const reset = () => {
    setAdding(false);
    setLabel("");
    setDate("");
  };

  const submit = () => {
    if (!label.trim() || !date) return;
    addDeadline({ taskId, label, date });
    // Straight back to an empty pair of fields: checkpoints arrive in batches
    // — a project is planned in one sitting, not one date a week.
    setLabel("");
    setDate("");
  };

  const empty = deadlines.length === 0 && !adding;

  return (
    <div className={cn("plan-deadlines", empty && "is-empty")}>
      <div className="plan-deadlines-head">
        {/* A heading over nothing is a heading nobody needs. Most plans keep no
            checkpoints at all, and on those the section is one quiet line
            offering to start one — not a title, a caret and a count of zero. */}
        {empty ? null : (
          <span
            className="plan-deadlines-title"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {t("planDeadlinesHeading")}
            <span className="plan-deadlines-count mono">
              {met}/{deadlines.length}
            </span>
          </span>
        )}
        <button
          type="button"
          className="btn ghost plan-deadlines-add"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
            setAdding(true);
          }}
        >
          <Plus size={12} /> {t("planDeadlinesAdd")}
        </button>
      </div>

      {/* No empty state: on a plan that keeps no deadlines the header and its
          button are the whole section, which is one line rather than three. */}
      {expanded && (deadlines.length > 0 || adding) && (
        <div className="plan-deadlines-body">
          {deadlines.map((deadline) => (
            <PlanDeadlineRow
              key={deadline.id}
              deadline={deadline}
              today={today}
              onToggle={() =>
                setDeadlineMet(deadline.id, deadline.completedAt === null)
              }
              onEdit={() => setEditingId(deadline.id)}
              onRemove={() => removeDeadline(deadline.id)}
            />
          ))}

          {adding && (
            <div className="plan-deadline-add-row">
              <input
                className="input sm grow"
                autoFocus
                placeholder={t("planDeadlineLabelPlaceholder")}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                  if (e.key === "Escape") reset();
                }}
              />
              <input
                className="input sm plan-deadline-date-input"
                type="date"
                value={date}
                aria-label={t("formDeadline")}
                onChange={(e) => setDate(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                  if (e.key === "Escape") reset();
                }}
              />
              <button
                type="button"
                className="btn sm"
                disabled={!label.trim() || !date}
                onClick={submit}
              >
                {t("add")}
              </button>
              <button
                type="button"
                className="btn ghost icon sm"
                title={t("cancel")}
                aria-label={t("cancel")}
                onClick={reset}
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      {editingId && (
        <DeadlineEditor
          taskId={taskId}
          deadlineId={editingId}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}

function PlanDeadlineRow({
  deadline,
  today,
  onToggle,
  onEdit,
  onRemove,
}: {
  deadline: Deadline;
  today: string;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const done = deadline.completedAt !== null;
  const missed = isMissed(deadline, today);

  return (
    <div className={cn("plan-deadline-item", done && "done", missed && "missed")}>
      {/* A flag, not a task's tick box.
          A deadline is a date the project has to reach, and the control that
          says it was reached should not be the same square that says a job is
          finished — it is the difference the whole record type exists to make.
          The flag fills in when the date is met, which is what a flag does. */}
      <button
        type="button"
        className={cn("plan-deadline-flag", done && "is-met")}
        aria-pressed={done}
        title={done ? t("planDeadlineUnmet") : t("planDeadlineMet")}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        <Flag size={13} fill={done ? "currentColor" : "none"} aria-hidden />
      </button>
      {/* The checkbox beside it is the way to tick a checkpoint off, so the
          text is free to be what it reads as: the thing you click to change
          what it says and when it is due. */}
      <span
        className="plan-deadline-label grow truncate"
        title={t("planDeadlineEdit")}
        onClick={onEdit}
      >
        {deadline.label}
      </span>
      {missed && (
        <span className="plan-deadline-missed">{t("planDeadlineMissed")}</span>
      )}
      <button
        type="button"
        className="plan-deadline-date mono"
        title={t("planDeadlineEdit")}
        onClick={onEdit}
      >
        <Flag size={10} aria-hidden /> {deadline.date}
      </button>
      <button
        type="button"
        className="btn ghost icon xs plan-deadline-remove"
        title={t("planDeadlineRemove")}
        aria-label={t("planDeadlineRemove")}
        onClick={onRemove}
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}
