import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useStore } from "@/state/store";
import { useDeadlines } from "@/state/selectors";
import { Field, Modal } from "@/ui/components/primitives";
import { useI18n } from "@/lib/i18n";

/**
 * Editing one checkpoint, wherever it was clicked.
 *
 * A deadline is reachable from two places that share nothing else — a row on a
 * plan card and a chip on the calendar — and both have to offer the same three
 * things: rename it, move it, remove it. One dialog rather than two keeps a
 * date from being editable in one view and frozen in the other, which is the
 * bug this replaces.
 *
 * It resolves the checkpoint from the store by id rather than taking it as a
 * prop, so a rename made here is already what the caller re-renders.
 */
export function DeadlineEditor({
  taskId,
  deadlineId,
  onClose,
}: {
  taskId: string;
  deadlineId: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const deadlines = useDeadlines(taskId);
  const updateDeadline = useStore((s) => s.updateDeadline);
  const removeDeadline = useStore((s) => s.removeDeadline);
  const deadline = deadlines.find((d) => d.id === deadlineId) ?? null;

  const [label, setLabel] = useState(deadline?.label ?? "");
  const [date, setDate] = useState(deadline?.date ?? "");

  // Deleted from the other view, or from another device mid-edit. Closing is
  // the honest answer: there is nothing left to save it onto.
  if (!deadline) {
    onClose();
    return null;
  }

  const dirty = label.trim() !== deadline.label || date !== deadline.date;
  const valid = label.trim().length > 0 && date.length > 0;

  const save = () => {
    if (!valid) return;
    if (dirty) updateDeadline(deadline.id, { label, date });
    onClose();
  };

  return (
    <Modal
      title={t("deadlineEditTitle")}
      onClose={onClose}
      width={420}
      footer={
        <>
          <button
            type="button"
            className="btn ghost danger"
            onClick={() => {
              removeDeadline(deadline.id);
              onClose();
            }}
          >
            <Trash2 size={14} /> {t("delete")}
          </button>
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={onClose}>
            {t("cancel")}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!valid}
            onClick={save}
          >
            {t("save")}
          </button>
        </>
      }
    >
      <Field label={t("planDeadlineLabelField")}>
        <input
          className="input"
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
        />
      </Field>
      <Field label={t("formDeadline")}>
        <input
          className="input"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
        />
      </Field>
    </Modal>
  );
}
