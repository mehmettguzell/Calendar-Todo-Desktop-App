import { useCallback } from "react";
import { descendantIds } from "@/domain/task";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/state/store";

/**
 * Delete a task, asking first when the delete takes other tasks with it.
 *
 * `deleteTask` trashes the whole subtree — it has to, or the children would be
 * left parented to something that is gone. That is invisible from a row or a
 * context menu, where the only thing on screen is the one task being pointed
 * at, so a plan with twelve subtasks under it used to go in a single click
 * with nothing said. The confirmation names the number, which is the fact the
 * user is missing; it is skipped for a childless task, where the undo toast
 * and three days in the trash are already more safety net than a question.
 *
 * One hook rather than a check at each button: there are six places that
 * delete a task, and a rule copied six times is a rule that is right in five.
 *
 * @returns `true` when the delete went ahead, so a caller can close the panel
 * it was invoked from — and leave it open when the user said no.
 */
export function useRequestDelete(): (taskId: string) => boolean {
  const tasks = useStore((s) => s.db.tasks);
  const deleteTask = useStore((s) => s.deleteTask);
  const { t } = useI18n();

  return useCallback(
    (taskId: string) => {
      const task = tasks.find((candidate) => candidate.id === taskId);
      if (!task) return false;

      const subtree = descendantIds(tasks, taskId);
      // Already-trashed descendants are not news: they are not on screen, and
      // counting them would promise a loss the user has already taken.
      const carried = tasks.filter(
        (candidate) =>
          candidate.id !== taskId && subtree.has(candidate.id) && !candidate.deletedAt,
      ).length;

      const question =
        carried > 0
          ? t("deleteWithSubtasksConfirm", { title: task.title, count: carried })
          : task.parentId !== null
            ? t("deleteSubtaskConfirm")
            : null;

      if (question !== null && !window.confirm(question)) return false;

      deleteTask(taskId);
      return true;
    },
    [tasks, deleteTask, t],
  );
}
