import { cn } from "@/lib/cn";
import { PanelBody } from "./panel/PanelBody";
import { PanelFoot } from "./panel/PanelFoot";
import { PanelHead } from "./panel/PanelHead";
import { useTaskPanel, type TaskPanelInput } from "./panel/useTaskPanel";

/**
 * One task, in full.
 *
 * Four bands over one model: the head acts on the frame, the body is the task
 * itself, the footer is what you can do to it. Each reads from `useTaskPanel`
 * rather than holding its own copy, so they cannot disagree about the task.
 */
export function TaskPanel({
  closing,
  ...input
}: TaskPanelInput & {
  /** Rendering only so it can animate out; see `usePresence`. */
  closing?: boolean;
}) {
  const model = useTaskPanel(input);

  return (
    <aside
      className={cn(
        "panel",
        input.maximized && "is-maximized",
        closing && "is-closing",
      )}
      inert={closing}
    >
      <PanelHead model={model} />
      <PanelBody model={model} />
      <PanelFoot model={model} />
    </aside>
  );
}
