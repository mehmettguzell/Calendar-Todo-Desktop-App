import { useEffect } from "react";
import { RotateCcw, X } from "lucide-react";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { UNDO_WINDOW_MS, useUndoStore } from "@/state/undoStore";

/**
 * "Deleted — Undo", bottom centre, for eight seconds.
 *
 * Placed away from the reminder cards in the bottom-right on purpose: a
 * reminder is something to act on, this is something to dismiss, and stacking
 * the two in one corner turns both into noise.
 */
export function UndoToast() {
  const pending = useUndoStore((s) => s.pending);
  const undo = useUndoStore((s) => s.undo);
  const dismiss = useUndoStore((s) => s.dismiss);
  const { t } = useI18n();

  useEffect(() => {
    if (!pending) return;
    // Dismiss by id: a newer action may have replaced this one before the
    // timer fires, and it must not take the newer offer down with it.
    const id = pending.id;
    const handle = setTimeout(() => dismiss(id), UNDO_WINDOW_MS);
    return () => clearTimeout(handle);
  }, [pending, dismiss]);

  if (!pending) return null;

  return (
    <div className="undo-toast" role="status">
      <span className="undo-label truncate">
        {t(pending.label as TranslationKey)}
      </span>
      <button type="button" className="undo-action" onClick={() => undo()}>
        <RotateCcw size={13} /> {t("undo")}
        <kbd>Ctrl+Z</kbd>
      </button>
      <button
        type="button"
        className="undo-close"
        aria-label={t("cancel")}
        onClick={() => dismiss(pending.id)}
      >
        <X size={13} />
      </button>
    </div>
  );
}
