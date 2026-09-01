import { useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Flag,
  RotateCcw,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { addDaysLocal, toLocalDate } from "@/domain/datetime";
import { descendantIds } from "@/domain/task";
import type { Priority, Task } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { useCategories } from "@/state/selectors";
import { useSelectionStore } from "@/state/selectionStore";
import { useNow, useStore } from "@/state/store";
import { Popover } from "@/ui/components/primitives";

const PRIORITIES: { id: Priority; labelKey: TranslationKey }[] = [
  { id: "HIGH", labelKey: "priorityHIGH" },
  { id: "MEDIUM", labelKey: "priorityMEDIUM" },
  { id: "LOW", labelKey: "priorityLOW" },
  { id: "NONE", labelKey: "priorityNONE" },
];

/**
 * What to do with the tasks that are picked.
 *
 * Mounted once, next to the undo toast, rather than inside a view: the
 * selection is global, so a bar that lived in Todo would vanish the moment
 * someone switched to Today with five tasks still held.
 *
 * It renders nothing at all until something is picked. That is the whole
 * contract of this feature — a list that nobody is selecting in has to look
 * exactly as it did before selecting existed.
 */
export function BulkActionBar() {
  const { t } = useI18n();
  const now = useNow();
  const ids = useSelectionStore((s) => s.ids);
  const clear = useSelectionStore((s) => s.clear);

  const tasks = useStore((s) => s.db.tasks);
  const categories = useCategories();
  const bulkUpdateTasks = useStore((s) => s.bulkUpdateTasks);
  const bulkSetStatus = useStore((s) => s.bulkSetStatus);
  const bulkDeleteTasks = useStore((s) => s.bulkDeleteTasks);

  const [menu, setMenu] = useState<"priority" | "category" | "date" | null>(null);

  /*
   * A picked task can be deleted from another window, or completed by a sync,
   * while it is still held. Resolving against the live document each render —
   * rather than trusting the ids — keeps the count honest and keeps a bulk
   * action from being applied to something that is no longer there.
   */
  const picked = useMemo(
    () =>
      ids
        .map((id) => tasks.find((task) => task.id === id))
        .filter((task): task is Task => task !== undefined && !task.deletedAt),
    [ids, tasks],
  );
  const pickedIds = picked.map((task) => task.id);

  if (picked.length === 0) return null;

  const today = toLocalDate(now);
  const allDone = picked.every((task) => task.status === "COMPLETED");

  const run = (action: () => void) => {
    action();
    setMenu(null);
    clear();
  };

  const move = (date: string | null) =>
    run(() => bulkUpdateTasks(pickedIds, { dueDate: date, allDay: true }));

  const remove = () => {
    /*
     * The number that matters is not the number picked — it is the number that
     * disappears. Deleting a plan takes its steps with it, and a user who
     * picked three rows has no way to know they are about to lose eleven
     * unless the question says so.
     */
    const doomed = new Set<string>();
    for (const task of picked) {
      doomed.add(task.id);
      for (const id of descendantIds(tasks, task.id)) {
        if (!tasks.find((each) => each.id === id)?.deletedAt) doomed.add(id);
      }
    }
    const carried = doomed.size - picked.length;
    const question =
      carried > 0
        ? t("bulkDeleteWithSubtasksConfirm", { count: picked.length, extra: carried })
        : t("bulkDeleteConfirm", { count: picked.length });
    if (!window.confirm(question)) return;
    run(() => bulkDeleteTasks(pickedIds));
  };

  return (
    <div className="bulk-bar" role="toolbar" aria-label={t("bulkTitle")}>
      <span className="bulk-count">{t("bulkSelected", { n: picked.length })}</span>

      <span className="bulk-sep" aria-hidden />

      <button
        type="button"
        className="bulk-btn"
        onClick={() => run(() => bulkSetStatus(pickedIds, allDone ? "TODO" : "COMPLETED"))}
      >
        {allDone ? <RotateCcw size={14} /> : <CheckCircle2 size={14} />}
        {allDone ? t("bulkReopen") : t("bulkComplete")}
      </button>

      <div className="bulk-menu-anchor">
        <button
          type="button"
          className={cn("bulk-btn", menu === "date" && "open")}
          aria-expanded={menu === "date"}
          onClick={() => setMenu(menu === "date" ? null : "date")}
        >
          <CalendarDays size={14} /> {t("bulkReschedule")}
        </button>
        {menu === "date" ? (
          <Popover onClose={() => setMenu(null)}>
            <button type="button" className="menu-item" onClick={() => move(today)}>
              {t("today")}
            </button>
            <button
              type="button"
              className="menu-item"
              onClick={() => move(addDaysLocal(today, 1))}
            >
              {t("tomorrow")}
            </button>
            <button
              type="button"
              className="menu-item"
              onClick={() => move(addDaysLocal(today, 7))}
            >
              {t("bulkNextWeek")}
            </button>
            <button type="button" className="menu-item" onClick={() => move(null)}>
              {t("bulkNoDate")}
            </button>
            {/* A date of their own, for the case the three presets do not
                cover. It commits on pick rather than needing a second click. */}
            <label className="menu-item bulk-date-pick">
              {t("bulkPickDate")}
              <input
                type="date"
                onChange={(e) => e.target.value && move(e.target.value)}
              />
            </label>
          </Popover>
        ) : null}
      </div>

      <div className="bulk-menu-anchor">
        <button
          type="button"
          className={cn("bulk-btn", menu === "priority" && "open")}
          aria-expanded={menu === "priority"}
          onClick={() => setMenu(menu === "priority" ? null : "priority")}
        >
          <Flag size={14} /> {t("formPriority")}
        </button>
        {menu === "priority" ? (
          <Popover onClose={() => setMenu(null)}>
            {PRIORITIES.map((option) => (
              <button
                key={option.id}
                type="button"
                className="menu-item"
                onClick={() =>
                  run(() => bulkUpdateTasks(pickedIds, { priority: option.id }))
                }
              >
                <i className={cn("prio-dot", option.id)} aria-hidden />
                {t(option.labelKey)}
              </button>
            ))}
          </Popover>
        ) : null}
      </div>

      <div className="bulk-menu-anchor">
        <button
          type="button"
          className={cn("bulk-btn", menu === "category" && "open")}
          aria-expanded={menu === "category"}
          onClick={() => setMenu(menu === "category" ? null : "category")}
        >
          <Tag size={14} /> {t("formCategory")}
        </button>
        {menu === "category" ? (
          <Popover onClose={() => setMenu(null)}>
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                className="menu-item"
                onClick={() =>
                  run(() => bulkUpdateTasks(pickedIds, { categoryId: category.id }))
                }
              >
                <i className="dot" style={{ background: category.color }} />
                {category.name}
              </button>
            ))}
            <button
              type="button"
              className="menu-item"
              onClick={() => run(() => bulkUpdateTasks(pickedIds, { categoryId: null }))}
            >
              {t("plansNoCategory")}
            </button>
          </Popover>
        ) : null}
      </div>

      <button type="button" className="bulk-btn danger" onClick={remove}>
        <Trash2 size={14} /> {t("delete")}
      </button>

      <button
        type="button"
        className="bulk-close"
        aria-label={t("bulkClear")}
        title={`${t("bulkClear")} (Esc)`}
        onClick={clear}
      >
        <X size={14} />
      </button>
    </div>
  );
}
