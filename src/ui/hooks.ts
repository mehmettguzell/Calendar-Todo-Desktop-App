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

/** n = new task, t = today, Escape = close panel. Ignored while typing. */
export function useShortcuts({
  onNew,
  onToday,
  onEscape,
}: {
  onNew: () => void;
  onToday: () => void;
  onEscape: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable === true;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        onNew();
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
  }, [onNew, onToday, onEscape]);
}
