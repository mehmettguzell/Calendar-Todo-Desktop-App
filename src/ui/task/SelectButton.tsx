import { MousePointerClick } from "lucide-react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { useSelectionStore } from "@/state/selectionStore";

/**
 * The one visible door into selecting.
 *
 * The selection itself is global — one set of picked tasks, one bar acting on
 * them, wherever they were picked from — so the way in is global too. It lived
 * on two page headers and nowhere else, which meant the feature existed on
 * Görevler and Planlar and, as far as anyone could tell, did not exist on the
 * screen they spend the most time on.
 *
 * Everything else about selecting still stays out of the way until this is
 * pressed: no checkbox column, no changed rows, nothing. A Ctrl-click on any
 * row does the same for anyone who already knows.
 */
export function SelectButton({ className }: { className?: string }) {
  const { t } = useI18n();
  const selecting = useSelectionStore((s) => s.active);
  const begin = useSelectionStore((s) => s.begin);
  const clear = useSelectionStore((s) => s.clear);

  return (
    <button
      type="button"
      className={cn("btn ghost sm", selecting && "active", className)}
      aria-pressed={selecting}
      title={t("bulkSelectHint")}
      onClick={() => (selecting ? clear() : begin())}
    >
      <MousePointerClick size={13} />
      {t("bulkSelect")}
    </button>
  );
}
