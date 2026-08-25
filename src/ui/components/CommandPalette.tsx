import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  CornerDownLeft,
  ListChecks,
  Plus,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  StickyNote,
  Sun,
  Target,
  Timer,
  Wallet,
} from "lucide-react";
import { describeWhen } from "@/domain/datetime";
import { representativeInstance } from "@/domain/task";
import type { TaskInstance } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { useLiveTasks, useOccurrenceIndex } from "@/state/selectors";
import { useNow, useStore } from "@/state/store";
import { syncDifferences } from "@/state/syncEngine";
import type { ViewId } from "@/ui/Sidebar";

/**
 * One box that reaches everything.
 *
 * Search across all content and a keyboard-first way to capture or jump are
 * the two things people ask for most once an app has more than a couple of
 * screens — and the reason is the same in both cases: the moment you have to
 * reach for the mouse to find something, you have already lost the thought you
 * were holding.
 *
 * Deliberately narrow: it finds tasks and notes, and it runs the handful of
 * actions that would otherwise need navigation. It is not a second UI for the
 * app, because a command palette that can do everything is just a menu with
 * worse discoverability.
 */
export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  onView,
  onNewTask,
  onNewSpend,
  onOpenTask,
  onSettings,
}: {
  open: boolean;
  onClose: () => void;
  onView: (view: ViewId) => void;
  onNewTask: () => void;
  onNewSpend: () => void;
  onOpenTask: (taskId: string) => void;
  onSettings: () => void;
}) {
  const { t } = useI18n();
  const tasks = useLiveTasks();
  const occurrences = useOccurrenceIndex();
  const now = useNow();
  const toggleComplete = useStore((s) => s.toggleComplete);

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    // A frame later: the input does not exist until this render commits.
    const handle = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(handle);
  }, [open]);

  const actions: PaletteAction[] = useMemo(
    () => [
      { id: "new", label: t("paletteNewTask"), hint: "N", icon: <Plus size={15} />, run: onNewTask },
      { id: "spend", label: t("paletteQuickSpend"), icon: <Wallet size={15} />, run: onNewSpend },
      { id: "today", label: t("navToday"), icon: <Sun size={15} />, run: () => onView("today") },
      { id: "calendar", label: t("navCalendar"), icon: <CalendarDays size={15} />, run: () => onView("calendar") },
      { id: "tasks", label: t("navTasks"), icon: <ListChecks size={15} />, run: () => onView("tasks") },
      { id: "plans", label: t("navPlans"), icon: <Target size={15} />, run: () => onView("plans") },
      { id: "notes", label: t("navNotes"), icon: <StickyNote size={15} />, run: () => onView("notes") },
      { id: "focus", label: t("navFocus"), icon: <Timer size={15} />, run: () => onView("focus") },
      { id: "budget", label: t("navBudget"), icon: <Wallet size={15} />, run: () => onView("budget") },
      { id: "sync", label: t("syncWithServer"), icon: <RefreshCw size={15} />, run: () => void syncDifferences() },
      { id: "settings", label: t("navSettings"), icon: <SettingsIcon size={15} />, run: onSettings },
    ],
    [t, onView, onNewTask, onNewSpend, onSettings],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();

    const matchedActions = q
      ? actions.filter((a) => a.label.toLowerCase().includes(q))
      : actions;

    if (!q) return { actions: matchedActions, tasks: [] as TaskInstance[] };

    const matchedTasks = tasks
      .filter((task) => {
        const haystack =
          `${task.title} ${task.description} ${task.tags.join(" ")}`.toLowerCase();
        return haystack.includes(q);
      })
      // Open work first, then most recently touched: the thing being looked for
      // is far more often live than finished.
      .sort((a, b) => {
        const done = Number(a.status === "COMPLETED") - Number(b.status === "COMPLETED");
        return done !== 0 ? done : b.updatedAt.localeCompare(a.updatedAt);
      })
      .slice(0, 8)
      .map((task) => representativeInstance(task, occurrences, now));

    return { actions: matchedActions.slice(0, 4), tasks: matchedTasks };
  }, [query, actions, tasks, occurrences, now]);

  const flat = useMemo(
    () => [
      ...results.actions.map((a) => ({ kind: "action" as const, action: a })),
      ...results.tasks.map((i) => ({ kind: "task" as const, instance: i })),
    ],
    [results],
  );

  useEffect(() => {
    setActive((current) => (current >= flat.length ? 0 : current));
  }, [flat.length]);

  if (!open) return null;

  const choose = (index: number) => {
    const item = flat[index];
    if (!item) return;
    onClose();
    if (item.kind === "action") item.action.run();
    else onOpenTask(item.instance.task.id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (flat.length === 0 ? 0 : (i + 1) % flat.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (flat.length === 0 ? 0 : (i - 1 + flat.length) % flat.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose} role="presentation">
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label={t("paletteTitle")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="palette-input">
          <Search size={16} aria-hidden />
          <input
            ref={inputRef}
            value={query}
            placeholder={t("palettePlaceholder")}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <kbd>Esc</kbd>
        </div>

        <div className="palette-list scroll" ref={listRef}>
          {flat.length === 0 ? (
            <p className="palette-empty">{t("paletteNoResults")}</p>
          ) : null}

          {flat.map((item, index) =>
            item.kind === "action" ? (
              <button
                key={`a:${item.action.id}`}
                type="button"
                className={cn("palette-row", index === active && "active")}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(index)}
              >
                <span className="palette-icon">{item.action.icon}</span>
                <span className="palette-label truncate">{item.action.label}</span>
                {item.action.hint ? <kbd>{item.action.hint}</kbd> : null}
              </button>
            ) : (
              <button
                key={`t:${item.instance.task.id}`}
                type="button"
                className={cn("palette-row", index === active && "active")}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(index)}
              >
                <span
                  className={cn(
                    "palette-check",
                    item.instance.status === "COMPLETED" && "done",
                  )}
                  role="button"
                  tabIndex={-1}
                  aria-label={t("done")}
                  onClick={(e) => {
                    // Ticking something off from search is the whole point of
                    // being able to find it without leaving the keyboard.
                    e.stopPropagation();
                    toggleComplete(item.instance);
                  }}
                >
                  <Check size={12} />
                </span>
                <span className="palette-label truncate">
                  {item.instance.task.title}
                </span>
                <span className="palette-meta">
                  {describeWhen(
                    item.instance.date,
                    item.instance.task.allDay ? null : item.instance.task.startTime,
                    now,
                  )}
                </span>
              </button>
            ),
          )}
        </div>

        <footer className="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> {t("paletteNavigate")}
          </span>
          <span>
            <kbd>
              <CornerDownLeft size={10} />
            </kbd>{" "}
            {t("paletteOpen")}
          </span>
        </footer>
      </div>
    </div>
  );
}
