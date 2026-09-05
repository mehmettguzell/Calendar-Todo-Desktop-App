import { useMemo } from "react";
import { AlertCircle, RotateCcw, Trash2 } from "lucide-react";
import { useCategories, useTrashedTasks } from "@/state/selectors";
import { useStore } from "@/state/store";
import { useI18n } from "@/lib/i18n";
import { Modal } from "./primitives";

export function TrashModal({ onClose }: { onClose: () => void }) {
  const trashedTasks = useTrashedTasks();
  const categories = useCategories();
  const restoreTask = useStore((s) => s.restoreTask);
  const purgeTask = useStore((s) => s.purgeTask);
  const emptyTrash = useStore((s) => s.emptyTrash);
  const { t, language } = useI18n();

  const sortedTasks = useMemo(() => {
    return [...trashedTasks].sort((a, b) => {
      const timeA = a.deletedAt ? new Date(a.deletedAt).getTime() : 0;
      const timeB = b.deletedAt ? new Date(b.deletedAt).getTime() : 0;
      return timeB - timeA;
    });
  }, [trashedTasks]);

  const catMap = useMemo(() => {
    return new Map(categories.map((c) => [c.id, c]));
  }, [categories]);

  const handleEmptyTrash = () => {
    if (trashedTasks.length === 0) return;
    if (window.confirm(t("emptyTrashConfirm"))) {
      emptyTrash();
    }
  };

  const handlePurgeSingle = (taskId: string) => {
    if (window.confirm(t("permanentlyDeleteConfirm"))) {
      purgeTask(taskId);
    }
  };

  const getDaysRemaining = (deletedAt: string | null) => {
    if (!deletedAt) return 3;
    const deletedMs = new Date(deletedAt).getTime();
    const expiresMs = deletedMs + 3 * 24 * 60 * 60 * 1000;
    const diffHours = (expiresMs - Date.now()) / (1000 * 60 * 60);
    const diffDays = Math.max(1, Math.ceil(diffHours / 24));
    return diffDays;
  };

  return (
    <Modal
      title={t("trash")}
      onClose={onClose}
      width={560}
      footer={
        <div className="row grow justify-between">
          <button
            type="button"
            className="btn ghost danger"
            disabled={trashedTasks.length === 0}
            onClick={handleEmptyTrash}
          >
            <Trash2 size={13} /> {t("emptyTrash")}
          </button>
          <button type="button" className="btn primary" onClick={onClose}>
            {t("done")}
          </button>
        </div>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        {/* 3-day notice banner */}
        <div className="trash-notice-banner">
          <AlertCircle size={15} style={{ flexShrink: 0 }} />
          <span>{t("trashAutoPurgeNotice")}</span>
        </div>

        {/* Task list or empty state */}
        {sortedTasks.length === 0 ? (
          <div className="trash-empty-state">
            <Trash2 size={36} strokeWidth={1.5} style={{ opacity: 0.3 }} />
            <span className="trash-empty-title">{t("trashEmpty")}</span>
            <span className="trash-empty-hint">{t("trashEmptyHint")}</span>
          </div>
        ) : (
          <div className="trash-task-list scroll">
            {sortedTasks.map((task) => {
              const cat = task.categoryId ? catMap.get(task.categoryId) : null;
              const daysLeft = getDaysRemaining(task.deletedAt);

              return (
                <div key={task.id} className="trash-task-row">
                  <div className="col grow truncate" style={{ gap: 3 }}>
                    <div className="row items-center" style={{ gap: 8 }}>
                      <span className="trash-task-title truncate">
                        {task.title || "(Untitled task)"}
                      </span>
                      {cat && (
                        <span
                          className="trash-category-pill"
                          style={{
                            borderColor: cat.color,
                            color: cat.color,
                          }}
                        >
                          <i
                            className="dot"
                            style={{ background: cat.color }}
                          />
                          {cat.name}
                        </span>
                      )}
                    </div>
                    <div
                      className="row items-center"
                      style={{ gap: 8, fontSize: "var(--text-2xs)", color: "var(--muted)" }}
                    >
                      <span>
                        {daysLeft}{" "}
                        {language === "tr"
                          ? "gün kaldı"
                          : `day${daysLeft > 1 ? "s" : ""} left`}
                      </span>
                      {task.dueDate && (
                        <>
                          <span>•</span>
                          <span>{task.dueDate}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                    <button
                      type="button"
                      className="btn sm"
                      title={t("restore")}
                      onClick={() => restoreTask(task.id)}
                    >
                      <RotateCcw size={12} />
                      {t("restore")}
                    </button>
                    <button
                      type="button"
                      className="btn sm ghost danger"
                      title={t("permanentlyDelete")}
                      onClick={() => handlePurgeSingle(task.id)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
