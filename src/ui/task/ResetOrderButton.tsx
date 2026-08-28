import { ListRestart } from "lucide-react";
import type { Task } from "@/domain/types";
import { hasPins } from "@/domain/manualOrder";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/state/store";

/**
 * The way back out of a manual arrangement.
 *
 * It renders nothing until a list actually holds a pin, so a user who never
 * drags anything never sees that dragging was on offer — and a user who does
 * is never stuck with an arrangement they cannot undo.
 */
export function ResetOrderButton({ tasks }: { tasks: Task[] }) {
  const clearManualOrder = useStore((s) => s.clearManualOrder);
  const { t } = useI18n();

  if (!hasPins(tasks)) return null;

  return (
    <button
      type="button"
      className="btn ghost icon"
      title={t("resetOrderHint")}
      aria-label={t("resetOrderHint")}
      onClick={() => clearManualOrder(tasks.map((task) => task.id))}
    >
      <ListRestart size={13} />
    </button>
  );
}
