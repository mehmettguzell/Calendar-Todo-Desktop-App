import { useCallback, useRef, useState, type DragEvent } from "react";
import { moveItem } from "@/domain/manualOrder";

/**
 * Drag-to-reorder for a list of task rows.
 *
 * One hook per list. Lists that sit side by side — the kanban columns — each
 * hold their own instance and recognise each other through the module-level
 * drag below, because `dataTransfer` refuses to say what it is carrying until
 * the drop and a column has to decide whether to accept the row long before
 * that.
 *
 * This needs `"dragDropEnabled": false` on the window in `tauri.conf.json`.
 * Tauri turns it on by default, and on Windows that hands every drag to the
 * OS-level file-drop handler before the webview ever sees it — the page's own
 * drag events simply never fire. Turning it back on silently kills reordering
 * here, chip dragging on the calendar, and the statement drop zone.
 */

interface ActiveDrag {
  listId: string;
  taskId: string;
  index: number;
}

let activeDrag: ActiveDrag | null = null;

export interface RowReorder {
  /** Drop-marker and lifted-row classes for this row. */
  className: string;
  draggable: true;
  onDragStart(event: DragEvent): void;
  onDragEnter(event: DragEvent): void;
  onDragOver(event: DragEvent): void;
  onDrop(event: DragEvent): void;
  onDragEnd(event: DragEvent): void;
  /** Keyboard equivalent, bound to the grip: ↑ / ↓ move the row one place. */
  onGripKeyDown(event: { key: string; preventDefault(): void }): void;
}

export interface ListReorder {
  /** Spread on the element wrapping the rows, so a drop into a gap still lands. */
  containerProps: {
    onDragEnter(event: DragEvent): void;
    onDragOver(event: DragEvent): void;
    onDrop(event: DragEvent): void;
  };
  /** `undefined` for a row that cannot move, so callers can stay declarative. */
  row(index: number): RowReorder;
  /** True while this list is the one being dragged from or over. */
  active: boolean;
}

export function useListReorder({
  listId,
  ids,
  onReorder,
  onAccept,
}: {
  listId: string;
  /** Task ids, in the order they are rendered. */
  ids: string[];
  onReorder: (orderedIds: string[], movedId: string) => void;
  /**
   * A row dropped in from another list — the kanban case, where crossing a
   * column boundary also changes the task's priority or category. Leave it out
   * and foreign rows are refused, which is what the todo groups want: dropping
   * "today" onto "tomorrow" would be a reschedule, not a reorder.
   */
  onAccept?: (taskId: string, slot: number, fromListId: string) => void;
}): ListReorder {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  /** Where the row would land: the gap *before* this index. */
  const [dropSlot, setDropSlot] = useState<number | null>(null);
  const idsRef = useRef(ids);
  idsRef.current = ids;

  /*
   * The drop slot is mirrored in a ref because the drop is decided by whatever
   * the last `dragover` said, and a browser is free to deliver both in one task
   * — before React has re-rendered and handed the handlers a fresh `dropSlot`.
   * The state copy exists only to draw the marker.
   */
  const dropSlotRef = useRef<number | null>(null);
  const setDrop = useCallback((slot: number | null) => {
    dropSlotRef.current = slot;
    setDropSlot(slot);
  }, []);

  /*
   * Whether this list takes the row currently in the air — read when the event
   * arrives, never at render time, for the same reason.
   */
  const accepts = useCallback(() => {
    if (!activeDrag) return false;
    return activeDrag.listId === listId || onAccept !== undefined;
  }, [listId, onAccept]);

  const end = useCallback(() => {
    activeDrag = null;
    setDragIndex(null);
    setDrop(null);
  }, [setDrop]);

  const commit = useCallback(
    (slot: number) => {
      const drag = activeDrag;
      if (!drag) return end();

      if (drag.listId === listId) {
        // The slot below the lifted row loses a place once that row is out.
        const target = slot > drag.index ? slot - 1 : slot;
        const next = moveItem(idsRef.current, drag.index, target);
        if (next !== idsRef.current) onReorder(next, drag.taskId);
      } else if (onAccept) {
        onAccept(drag.taskId, slot, drag.listId);
      }
      end();
    },
    [end, listId, onAccept, onReorder],
  );

  const allow = useCallback(
    (event: DragEvent) => {
      if (!accepts()) return false;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      return true;
    },
    [accepts],
  );

  const move = useCallback(
    (index: number, delta: number) => {
      const next = moveItem(idsRef.current, index, index + delta);
      if (next === idsRef.current) return;
      onReorder(next, idsRef.current[index] as string);
    },
    [onReorder],
  );

  return {
    active: dragIndex !== null || dropSlot !== null,
    containerProps: {
      onDragEnter: (event) => allow(event),
      onDragOver: (event) => {
        // Rows stop this event themselves, so reaching the container means the
        // pointer is in the loose space below them: land at the end.
        if (!allow(event)) return;
        setDrop(idsRef.current.length);
      },
      onDrop: (event) => {
        if (!allow(event)) return;
        commit(dropSlotRef.current ?? idsRef.current.length);
      },
    },
    row: (index) => ({
      className: [
        dragIndex === index ? "dragging" : "",
        dropSlot === index ? "drop-before" : "",
        dropSlot === idsRef.current.length &&
        index === idsRef.current.length - 1
          ? "drop-after"
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      draggable: true,
      onDragStart: (event) => {
        event.stopPropagation();
        activeDrag = {
          listId,
          taskId: idsRef.current[index] as string,
          index,
        };
        setDragIndex(index);
        event.dataTransfer.effectAllowed = "move";
        // Some platforms cancel a drag that carries nothing at all.
        event.dataTransfer.setData("text/plain", idsRef.current[index] ?? "");
      },
      onDragEnter: (event) => allow(event),
      onDragOver: (event) => {
        if (!allow(event)) return;
        const box = event.currentTarget.getBoundingClientRect();
        setDrop(event.clientY < box.top + box.height / 2 ? index : index + 1);
      },
      onDrop: (event) => {
        if (!allow(event)) return;
        commit(dropSlotRef.current ?? index);
      },
      onDragEnd: (event) => {
        event.stopPropagation();
        end();
      },
      onGripKeyDown: (event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        move(index, event.key === "ArrowUp" ? -1 : 1);
      },
    }),
  };
}
