import {
  Copy,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  StatusBadge,
} from "@/ui/components/primitives";
import type { TaskPanelModel } from "./useTaskPanel";

/**
 * Status, the occurrence label, and the controls that act on the frame.
 *
 * Copying a task is a real command but not one of the three things a user came
 * here to do, so it sits with the window controls rather than in the body.
 */
export function PanelHead({ model: m }: { model: TaskPanelModel }) {
  return (
    <div className="panel-head">
      <StatusBadge status={m.instance.status} />
      {m.instance.isRecurring && m.instance.date ? (
        <span className="faint mono" style={{ fontSize: "var(--text-2xs)" }}>
          {m.t("occurrenceLabel")} {m.instance.date}
        </span>
      ) : null}
      <span className="grow" />
      {/* Copying a task is a real command but not one of the three things a
          user came here to do, so it sits with the window controls. */}
      <button
        type="button"
        className={cn("btn ghost icon", m.clip?.taskId === m.task.id && "primary")}
        aria-label={m.t("menuCopy")}
        title={m.t("menuCopy")}
        onClick={() =>
          m.copyToClipboard(m.task.id, m.task.title, m.instance.date ?? m.task.dueDate)
        }
      >
        <Copy size={14} />
      </button>
      {/* Next to close, in the order a window's own controls use: the two
          things you do to the frame rather than to the task. */}
      {m.onToggleMaximize ? (
        <button
          type="button"
          className={cn("btn ghost icon", m.maximized && "active")}
          onClick={m.onToggleMaximize}
          aria-pressed={m.maximized}
          aria-label={m.maximized ? m.t("panelRestore") : m.t("panelMaximize")}
          title={m.maximized ? m.t("panelRestore") : m.t("panelMaximize")}
        >
          {m.maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      ) : null}
      <button
        type="button"
        className="btn ghost icon"
        onClick={m.onClose}
        aria-label={m.t("closePanel")}
      >
        <X size={16} />
      </button>
    </div>
  );
}
