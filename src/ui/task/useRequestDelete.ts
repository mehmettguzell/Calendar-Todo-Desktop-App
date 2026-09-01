import { useCallback } from "react";
import { descendantIds } from "@/domain/task";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/state/store";

/**
 * Delete a task, asking first only where the question earns its interruption.
 *
 * The rule follows the level, not the child count. A top-level task is
 * something the user made and filed, and losing one to a mis-clicked bin is
 * worth a sentence. A subtask is a line in a checklist: they are added and
 * dropped by the handful while the work is being done, and a modal in front of
 * each one turns tidying a plan into a conversation. So a leaf subtask goes
 * quietly — the undo toast and three days in the trash are the safety net
 * there, and they are the same net a confirmed delete falls into anyway.
 *
 * The exception is a delete that takes other live tasks with it. `deleteTask`
 * trashes the whole subtree — it has to, or the children would be left
 * parented to something that is gone — and that is invisible from a row or a
 * context menu, where the only thing on screen is the one task being pointed
 * at. That question names the number, which is the fact the user is missing,
 * and it is asked at every level: a step with steps of its own is still work
 * disappearing that nobody on that screen could see.
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
          : task.parentId === null
            ? t("deleteTaskConfirm", { title: task.title })
            : null;

      if (question !== null && !window.confirm(question)) return false;

      deleteTask(taskId);
      return true;
    },
    [tasks, deleteTask, t],
  );
}
