import { useEffect } from "react";

/** Resolve the theme setting against the OS preference and stamp it on <html>. */
export function useApplyTheme(theme: "system" | "light" | "dark") {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
}

/**
 * n = new task, t = today, Escape = close panel, Ctrl/Cmd+K = command palette,
 * Ctrl/Cmd+Z = undo the last reversible action.
 *
 * Everything but the palette is ignored while typing, and undo is additionally
 * left to the text field when the cursor is inside one.
 */
export function useShortcuts({
  onNew,
  onToday,
  onEscape,
  onPalette,
  onUndo,
}: {
  onNew: () => void;
  onToday: () => void;
  onEscape: () => void;
  onPalette: () => void;
  onUndo: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable === true;

      // Ctrl/Cmd+K works even while typing: it is the way out of wherever you
      // are, which is exactly when the cursor tends to be in a field.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onPalette();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        onNew();
        return;
      }
      // Undo is checked before the typing guard is applied to plain keys, but
      // after it for text fields: inside an input, Ctrl+Z belongs to the input.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        onUndo();
        return;
      }
      if (typing) return;

      if (e.key === "n") {
        e.preventDefault();
        onNew();
      } else if (e.key === "t") {
        onToday();
      } else if (e.key === "Escape") {
        onEscape();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onNew, onToday, onEscape, onPalette, onUndo]);
}
