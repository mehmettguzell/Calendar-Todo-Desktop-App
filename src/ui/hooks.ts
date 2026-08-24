import { useEffect, useState } from "react";

/**
 * Keep a value in the tree long enough for it to animate away.
 *
 * React drops a null the instant it appears, which is why the detail panel
 * used to blink out of existence rather than leave: there was nothing left to
 * animate. This holds the last non-null value for `exitMs` after it goes and
 * reports it as `closing` so the markup can carry a state class.
 *
 * A value that comes back before the timer runs out simply replaces the held
 * one — no remount, no restart. The exit was mid-flight, so what the eye sees
 * is the panel turning round and coming back, which is what happened.
 */
export function usePresence<T>(
  value: T | null,
  exitMs: number,
): { held: T | null; closing: boolean } {
  const [held, setHeld] = useState<T | null>(value);

  useEffect(() => {
    if (value !== null) {
      setHeld(value);
      return;
    }
    if (held === null) return;
    const timer = window.setTimeout(() => setHeld(null), exitMs);
    return () => window.clearTimeout(timer);
  }, [value, held, exitMs]);

  return { held, closing: value === null && held !== null };
}

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
 * Stamp the app language on <html>.
 *
 * Not cosmetic: CSS `text-transform: uppercase` follows the document language,
 * and Turkish capitalises "i" as "İ" rather than "I". Without this the panel
 * headings read GEÇMIŞ instead of GEÇMİŞ — a misspelling produced by the
 * stylesheet. Screen readers and spellcheckers key off the same attribute.
 */
export function useApplyLanguage(language: "tr" | "en") {
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
}

/**
 * n = new task, t = today, Escape = close panel, Ctrl/Cmd+K = command palette,
 * Ctrl/Cmd+Z = undo, Ctrl/Cmd+C / X / V = copy, cut and paste a task.
 *
 * Everything but the palette is ignored while typing, and undo is additionally
 * left to the text field when the cursor is inside one.
 *
 * Copy, cut and paste report whether they did anything, and the keystroke is
 * only swallowed when they did: with nothing selected, Ctrl+C has to go on
 * meaning what it means everywhere else on the page.
 */
export function useShortcuts({
  onNew,
  onToday,
  onEscape,
  onPalette,
  onUndo,
  onCopy,
  onCut,
  onPaste,
}: {
  onNew: () => void;
  onToday: () => void;
  onEscape: () => void;
  onPalette: () => void;
  onUndo: () => void;
  onCopy: () => boolean;
  onCut: () => boolean;
  onPaste: () => boolean;
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

      if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
        const key = e.key.toLowerCase();
        if (key === "c" || key === "x" || key === "v") {
          // Text the user highlighted on the page is theirs to copy; only an
          // empty selection means "copy" can be about the selected task.
          if (key !== "v" && (window.getSelection()?.toString() ?? "") !== "") {
            return;
          }
          const handled =
            key === "c" ? onCopy() : key === "x" ? onCut() : onPaste();
          if (handled) e.preventDefault();
          return;
        }
      }

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
  }, [onNew, onToday, onEscape, onPalette, onUndo, onCopy, onCut, onPaste]);
}
