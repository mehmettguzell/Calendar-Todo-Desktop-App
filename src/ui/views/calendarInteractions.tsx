import { useCallback, useRef, useState, type DragEvent, type MouseEvent } from "react";
import {
  Check,
  Copy,
  CopyPlus,
  ClipboardPaste,
  ExternalLink,
  Plus,
  Scissors,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { addDaysLocal, daysBetween } from "@/domain/datetime";
import type { LocalDate, TaskInstance } from "@/domain/types";
import { useI18n } from "@/lib/i18n";
import { pasteTaskOn } from "@/state/clipboardActions";
import { useClipboardStore } from "@/state/clipboardStore";
import { useStore } from "@/state/store";
import type { ContextMenuItem, ContextMenuState } from "@/ui/components/ContextMenu";

const ICON = 14;

/**
 * Right-click and drag behaviour for the calendar, in one place.
 *
 * Month, week and day are three layouts over one query (see `CalendarView`), so
 * they must also be three layouts over one set of gestures: a task copied in the
 * month grid and pasted in the week grid has to mean the same thing both times.
 * Keeping the handlers here rather than in each grid is what guarantees that,
 * and it is why the grids only have to say *where* a gesture landed.
 */
export function useCalendarInteractions({
  onOpen,
  onQuickAdd,
}: {
  onOpen: (instance: TaskInstance) => void;
  onQuickAdd: (date: LocalDate, time: string | null) => void;
}) {
  const { t } = useI18n();
  const clip = useClipboardStore((s) => s.clip);
  const copyToClipboard = useClipboardStore((s) => s.copy);
  const cutToClipboard = useClipboardStore((s) => s.cut);
  const duplicateTask = useStore((s) => s.duplicateTask);
  const reschedule = useStore((s) => s.reschedule);
  const toggleComplete = useStore((s) => s.toggleComplete);
  const deleteTask = useStore((s) => s.deleteTask);

  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  /*
   * The task under the pointer, kept out of `dataTransfer`: a drag needs to
   * know what it is carrying during `dragover`, and `getData` refuses to say
   * until the drop.
   */
  const draggingRef = useRef<TaskInstance | null>(null);
  const [dragging, setDragging] = useState<TaskInstance | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const pasteItem = useCallback(
    (date: LocalDate, time: string | null | undefined): ContextMenuItem => ({
      id: "paste",
      label: clip ? t("menuPaste") + " — " + clip.title : t("menuClipboardEmpty"),
      icon: <ClipboardPaste size={ICON} />,
      hint: "Ctrl+V",
      disabled: !clip,
      onSelect: () => pasteTaskOn(date, time),
    }),
    [clip, t],
  );

  /** Right-click on a task. */
  const openTaskMenu = useCallback(
    (event: MouseEvent, instance: TaskInstance) => {
      event.preventDefault();
      event.stopPropagation();
      const { task } = instance;
      const day = instance.date ?? task.dueDate;
      const done = instance.storedStatus === "COMPLETED";

      const items: ContextMenuItem[] = [
        {
          id: "open",
          label: t("menuOpen"),
          icon: <ExternalLink size={ICON} />,
          onSelect: () => onOpen(instance),
        },
        {
          id: "copy",
          label: t("menuCopy"),
          icon: <Copy size={ICON} />,
          hint: "Ctrl+C",
          onSelect: () => copyToClipboard(task.id, task.title, day),
        },
        {
          id: "cut",
          label: t("menuCut"),
          icon: <Scissors size={ICON} />,
          hint: "Ctrl+X",
          // A series gets its dates from its rule; moving the anchor would drag
          // every other occurrence along with the one that was cut.
          disabled: instance.isRecurring,
          onSelect: () => cutToClipboard(task.id, task.title, day),
        },
        {
          id: "duplicate",
          label: t("menuDuplicate"),
          icon: <CopyPlus size={ICON} />,
          onSelect: () => duplicateTask(task.id, { dueDate: day ?? null }),
        },
        {
          id: "tomorrow",
          label: t("menuCopyToTomorrow"),
          icon: <CopyPlus size={ICON} />,
          disabled: !day,
          onSelect: () => {
            if (day) duplicateTask(task.id, { dueDate: addDaysLocal(day, 1) });
          },
        },
        {
          id: "complete",
          label: done ? t("menuReopen") : t("menuComplete"),
          icon: done ? <RotateCcw size={ICON} /> : <Check size={ICON} />,
          onSelect: () => toggleComplete(instance),
        },
        {
          id: "delete",
          label: t("menuDelete"),
          icon: <Trash2 size={ICON} />,
          danger: true,
          onSelect: () => deleteTask(task.id),
        },
      ];
      setMenu({ x: event.clientX, y: event.clientY, items });
    },
    [
      t,
      onOpen,
      copyToClipboard,
      cutToClipboard,
      duplicateTask,
      toggleComplete,
      deleteTask,
    ],
  );

  /** Right-click on empty calendar space. */
  const openDayMenu = useCallback(
    (event: MouseEvent, date: LocalDate, time: string | null = null) => {
      event.preventDefault();
      event.stopPropagation();
      setMenu({
        x: event.clientX,
        y: event.clientY,
        items: [
          pasteItem(date, time),
          {
            id: "new",
            label: t("menuNewTask"),
            icon: <Plus size={ICON} />,
            hint: "N",
            onSelect: () => onQuickAdd(date, time),
          },
        ],
      });
    },
    [pasteItem, t, onQuickAdd],
  );

  const startDrag = useCallback((event: DragEvent, instance: TaskInstance) => {
    draggingRef.current = instance;
    setDragging(instance);
    event.dataTransfer.effectAllowed = "copyMove";
    // Something has to be written or some browsers refuse to start the drag;
    // the payload is never read back — `draggingRef` holds the real one.
    event.dataTransfer.setData("text/plain", instance.task.title);
  }, []);

  const endDrag = useCallback(() => {
    draggingRef.current = null;
    setDragging(null);
    setDropTarget(null);
  }, []);

  /** `true` while a drag is in flight, so a grid knows to accept the drop. */
  const isDragging = useCallback(() => draggingRef.current !== null, []);

  /**
   * Land the dragged task on a day.
   *
   * Holding Ctrl (or Alt / Cmd) copies instead of moving — the gesture every
   * file manager already uses, so it needs no label of its own.
   */
  const dropOn = useCallback(
    (event: DragEvent, date: LocalDate, time?: string | null) => {
      const instance = draggingRef.current;
      if (!instance) return;
      event.preventDefault();
      const asCopy = event.ctrlKey || event.altKey || event.metaKey;
      const { task } = instance;

      if (asCopy) {
        duplicateTask(task.id, {
          dueDate: date,
          ...(time === undefined ? {} : { startTime: time }),
        });
      } else if (!instance.isRecurring) {
        reschedule(
          task.id,
          anchorAfterDrop(task.dueDate, instance.date, date),
          time,
        );
      }
      endDrag();
    },
    [duplicateTask, reschedule, endDrag],
  );

  return {
    menu,
    closeMenu,
    openTaskMenu,
    openDayMenu,
    pasteItem,
    dragging,
    dropTarget,
    setDropTarget,
    startDrag,
    endDrag,
    isDragging,
    dropOn,
  };
}

/**
 * Where a dragged task's first day ends up.
 *
 * Grabbing the third day of a four-day run and dropping it on Friday means
 * "this day goes to Friday", not "the whole run now starts on Friday" — so the
 * anchor moves by the same number of days the grabbed day did.
 */
export function anchorAfterDrop(
  dueDate: LocalDate | null,
  grabbed: LocalDate | null,
  dropped: LocalDate,
): LocalDate {
  if (!dueDate || !grabbed || grabbed === dueDate) return dropped;
  return addDaysLocal(dropped, -daysBetween(dueDate, grabbed));
}
