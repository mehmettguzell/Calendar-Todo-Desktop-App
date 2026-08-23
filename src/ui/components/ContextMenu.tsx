import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Right-aligned hint, e.g. "Ctrl+C". Never the only clue to what the item does. */
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect(): void;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

/**
 * A right-click menu, positioned at the pointer.
 *
 * It exists so the calendar can offer copy, cut and paste without growing a
 * permanent toolbar for them: the commands are there when you ask for them and
 * invisible the rest of the time, which is the only way a calendar cell can
 * hold six actions and still look like a calendar cell.
 */
export function ContextMenu({
  state,
  onClose,
}: {
  state: ContextMenuState | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  // Measure first, then place: a menu opened near the right or bottom edge
  // flips back over the pointer instead of hanging off the window.
  useLayoutEffect(() => {
    if (!state) return;
    const el = ref.current;
    const width = el?.offsetWidth ?? 208;
    const height = el?.offsetHeight ?? 200;
    setPosition({
      x: Math.max(8, Math.min(state.x, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(state.y, window.innerHeight - height - 8)),
    });
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    // `capture` on the pointer: a click anywhere else — including on another
    // chip — should dismiss this menu before it does its own thing.
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [state, onClose]);

  if (!state) return null;

  return (
    <div
      ref={ref}
      className="popover context-menu"
      role="menu"
      style={{ position: "fixed", top: position.y, left: position.x }}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {state.items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className={item.danger ? "menu-item danger" : "menu-item"}
          disabled={item.disabled}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.icon ? <span className="menu-icon">{item.icon}</span> : null}
          <span className="truncate">{item.label}</span>
          {item.hint ? <kbd className="menu-hint">{item.hint}</kbd> : null}
        </button>
      ))}
    </div>
  );
}
