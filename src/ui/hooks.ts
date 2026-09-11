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

export interface Shortcuts {
  onNew: () => void;
  onToday: () => void;
  onEscape: () => void;
  onPalette: () => void;
  onUndo: () => void;
  /** Return false to let the browser keep the keystroke. */
  onCopy: () => boolean;
  onCut: () => boolean;
  onPaste: () => boolean;
}

function isTyping(target: HTMLElement | null): boolean {
  return (
    target?.tagName === "INPUT" ||
    target?.tagName === "TEXTAREA" ||
    target?.isContentEditable === true
  );
}

/**
 * The two that work even while typing.
 *
 * Ctrl/Cmd+K is the way out of wherever you are, which is exactly when the
 * cursor tends to be in a field; Ctrl+N is the same argument for capture.
 */
function handleAlways(e: KeyboardEvent, on: Shortcuts): boolean {
  if (!e.metaKey && !e.ctrlKey) return false;
  const key = e.key.toLowerCase();
  if (key === "k") {
    e.preventDefault();
    on.onPalette();
    return true;
  }
  if (key === "n") {
    e.preventDefault();
    on.onNew();
    return true;
  }
  return false;
}

/**
 * Copy, cut and paste, when they are about the selected task.
 *
 * Text the user highlighted on the page is theirs to copy, so an active text
 * selection hands the keystroke back — only an empty one can mean "the task".
 */
const CLIPBOARD_KEYS: Record<string, keyof Pick<Shortcuts, "onCopy" | "onCut" | "onPaste">> = {
  c: "onCopy",
  x: "onCut",
  v: "onPaste",
};

function handleClipboard(e: KeyboardEvent, on: Shortcuts): boolean {
  if ((!e.metaKey && !e.ctrlKey) || e.shiftKey) return false;
  const key = e.key.toLowerCase();
  const action = CLIPBOARD_KEYS[key];
  if (!action) return false;
  // An active text selection means the keystroke is about that text, not a task.
  if (action !== "onPaste" && window.getSelection()?.toString()) return true;
  if (on[action]()) e.preventDefault();
  return true;
}

function handleBareKey(e: KeyboardEvent, on: Shortcuts): void {
  if (e.key === "n") {
    e.preventDefault();
    on.onNew();
  } else if (e.key === "t") {
    on.onToday();
  } else if (e.key === "Escape") {
    on.onEscape();
  }
}

export function useShortcuts(on: Shortcuts) {
  const { onNew, onToday, onEscape, onPalette, onUndo, onCopy, onCut, onPaste } = on;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const typing = isTyping(e.target as HTMLElement | null);
      if (handleAlways(e, on)) return;
      // Inside an input, Ctrl+Z belongs to the input.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        onUndo();
        return;
      }
      if (typing) return;
      if (handleClipboard(e, on)) return;
      handleBareKey(e, on);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // The handlers are read through `on` on every event; listing them keeps the
    // listener in step with a caller that swaps one out.
  }, [on, onNew, onToday, onEscape, onPalette, onUndo, onCopy, onCut, onPaste]);
}
