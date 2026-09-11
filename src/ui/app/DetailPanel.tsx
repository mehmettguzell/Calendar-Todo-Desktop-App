import type { TaskInstance } from "@/domain/types";
import { NOTE_TAG } from "@/domain/note";
import { NotePanel } from "@/ui/task/NotePanel";
import { TaskPanel } from "@/ui/task/TaskPanel";

/**
 * The right-hand column: a task, or a note, or nothing.
 *
 * A note has no schedule, no status and no subtasks, so it gets its own panel
 * rather than a task panel with most of itself switched off.
 */
export function DetailPanel({
  held,
  closing,
  maximized,
  onClose,
  onToggleMaximize,
  onOpenTask,
}: {
  held: TaskInstance | null;
  closing: boolean;
  maximized: boolean;
  onClose: () => void;
  onToggleMaximize: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  if (!held) return null;
  if (held.task.tags.includes(NOTE_TAG)) {
    return <NotePanel instance={held} closing={closing} onClose={onClose} />;
  }
  return (
    <TaskPanel
      instance={held}
      closing={closing}
      maximized={maximized}
      onToggleMaximize={onToggleMaximize}
      onClose={onClose}
      onOpenTask={onOpenTask}
    />
  );
}
