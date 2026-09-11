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

/**
 * Where the row in the air would land, mirrored in a ref.
 *
 * The drop is decided by whatever the last `dragover` said, and a browser is
 * free to deliver both events in one task — before React has re-rendered and
 * handed the handlers a fresh `dropSlot`. The state copy exists only to draw the
 * marker; the ref is what the drop reads.
 */
function useDropSlot() {
  const [slot, setSlot] = useState<number | null>(null);
  const ref = useRef<number | null>(null);
  const set = useCallback((next: number | null) => {
    ref.current = next;
    setSlot(next);
  }, []);
  return { slot, ref, set };
}

/** Which of the three drop markers this row wears, if any. */
function rowClassName(
  index: number,
  count: number,
  dragIndex: number | null,
  dropSlot: number | null,
): string {
  return [
    dragIndex === index ? "dragging" : "",
    dropSlot === index ? "drop-before" : "",
    dropSlot === count && index === count - 1 ? "drop-after" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export interface ReorderOptions {
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
}

/** Everything one row needs to be lifted, hovered over and dropped. */
function rowHandlers(input: {
  index: number;
  listId: string;
  ids: string[];
  dragIndex: number | null;
  drop: ReturnType<typeof useDropSlot>;
  setDragIndex: (index: number | null) => void;
  allow: (event: DragEvent) => boolean;
  commit: (slot: number) => void;
  end: () => void;
  move: (index: number, delta: number) => void;
}): RowReorder {
  const { index, listId, ids, dragIndex, drop, setDragIndex, allow, commit, end, move } =
    input;
  return {
    className: rowClassName(index, ids.length, dragIndex, drop.slot),
    draggable: true as const,
    onDragStart: (event: DragEvent) => {
      event.stopPropagation();
      activeDrag = { listId, taskId: ids[index] as string, index };
      setDragIndex(index);
      event.dataTransfer.effectAllowed = "move";
      // Some platforms cancel a drag that carries nothing at all.
      event.dataTransfer.setData("text/plain", ids[index] ?? "");
    },
    onDragEnter: (event: DragEvent) => allow(event),
    onDragOver: (event: DragEvent) => {
      if (!allow(event)) return;
      const box = event.currentTarget.getBoundingClientRect();
      drop.set(event.clientY < box.top + box.height / 2 ? index : index + 1);
    },
    onDrop: (event: DragEvent) => {
      if (!allow(event)) return;
      commit(drop.ref.current ?? index);
    },
    onDragEnd: (event: DragEvent) => {
      event.stopPropagation();
      end();
    },
    onGripKeyDown: (event: { key: string; preventDefault: () => void }) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      move(index, event.key === "ArrowUp" ? -1 : 1);
    },
    };
}

/** Where the lifted row lands: reordered here, or handed to the list it fell into. */
function place(
  drag: ActiveDrag,
  slot: number,
  ids: string[],
  list: Pick<ReorderOptions, "listId" | "onReorder" | "onAccept">,
): void {
  if (drag.listId !== list.listId) {
    list.onAccept?.(drag.taskId, slot, drag.listId);
    return;
  }
  // The slot below the lifted row loses a place once that row is out.
  const target = slot > drag.index ? slot - 1 : slot;
  const next = moveItem(ids, drag.index, target);
  if (next !== ids) list.onReorder(next, drag.taskId);
}

/** What a drag may do: take the row, place it, give up, or step it by keyboard. */
function useDragActions(input: {
  listId: string;
  idsRef: { current: string[] };
  onReorder: (orderedIds: string[], movedId: string) => void;
  onAccept: ReorderOptions["onAccept"];
  drop: ReturnType<typeof useDropSlot>;
  setDragIndex: (index: number | null) => void;
}) {
  const { listId, idsRef, onReorder, onAccept, drop, setDragIndex } = input;

  /*
   * Whether this list takes the row currently in the air — read when the event
   * arrives, never at render time, for the same reason as the slot ref.
   */
  const accepts = useCallback(() => {
    if (!activeDrag) return false;
    return activeDrag.listId === listId || onAccept !== undefined;
  }, [listId, onAccept]);

  const end = useCallback(() => {
    activeDrag = null;
    setDragIndex(null);
    drop.set(null);
  }, [drop]);

  const commit = useCallback(
    (slot: number) => {
      const drag = activeDrag;
      if (drag) place(drag, slot, idsRef.current, { listId, onReorder, onAccept });
      end();
    },
    [end, idsRef, listId, onAccept, onReorder],
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

  return { allow, commit, end, move };
}

export function useListReorder({
  listId,
  ids,
  onReorder,
  onAccept,
}: ReorderOptions): ListReorder {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const drop = useDropSlot();
  const idsRef = useRef(ids);
  idsRef.current = ids;

  const { allow, commit, end, move } = useDragActions({
    listId,
    idsRef,
    onReorder,
    onAccept,
    drop,
    setDragIndex,
  });

  const containerProps: ListReorder["containerProps"] = {
    onDragEnter: (event: DragEvent) => allow(event),
    onDragOver: (event: DragEvent) => {
      // Rows stop this event themselves, so reaching the container means the
      // pointer is in the loose space below them: land at the end.
      if (!allow(event)) return;
      drop.set(idsRef.current.length);
    },
    onDrop: (event: DragEvent) => {
      if (!allow(event)) return;
      commit(drop.ref.current ?? idsRef.current.length);
    },
  };

  return {
    active: dragIndex !== null || drop.slot !== null,
    containerProps,
    row: (index) =>
      rowHandlers({
        index,
        listId,
        ids: idsRef.current,
        dragIndex,
        drop,
        setDragIndex,
        allow,
        commit,
        end,
        move,
      }),
  };
}
