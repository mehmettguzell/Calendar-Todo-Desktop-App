import { ArrowLeft, Unlink } from "lucide-react";
import type { Task } from "@/domain/types";
import type { TranslationKey } from "@/lib/i18n";

/**
 * The way back to the plan this task belongs to.
 *
 * The detach button sits beside it because filing a task under a parent has to
 * be as undoable as it was easy — otherwise the breadcrumb is a one-way door.
 */
export function ParentCrumb({
  parent,
  onOpen,
  onDetach,
  t,
}: {
  parent: Task | null | undefined;
  onOpen: (taskId: string) => void;
  onDetach: () => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}) {
  if (!parent) return null;

  return (
    <div
      className="row"
      style={{ alignSelf: "flex-start", marginBottom: 12, gap: 2 }}
    >
      <button
        type="button"
        className="btn ghost sm"
        style={{ paddingLeft: 4, paddingRight: 8 }}
        onClick={() => onOpen(parent.id)}
        title={t("backTo", { title: parent.title })}
      >
        <ArrowLeft size={14} />{" "}
        <span className="truncate" style={{ maxWidth: 220 }}>
          {parent.title}
        </span>
      </button>
      <button
        type="button"
        className="btn ghost icon"
        title={t("detachFromParent", { title: parent.title })}
        aria-label={t("detachFromParent", { title: parent.title })}
        onClick={onDetach}
      >
        <Unlink size={13} />
      </button>
    </div>
  );
}
