import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import type { Filters } from "@/state/selectors";
import type { CalendarMode } from "./views/CalendarView";
import type { ViewId } from "./Sidebar";
import { Switch } from "./components/primitives";

const MODES: { id: CalendarMode; label: string }[] = [
  { id: "month", label: "Month" },
  { id: "week", label: "Week" },
  { id: "day", label: "Day" },
];

export function Topbar({
  view,
  title,
  mode,
  onMode,
  onStep,
  onToday,
  filters,
  onFilters,
  onNewTask,
}: {
  view: ViewId;
  title: string;
  mode: CalendarMode;
  onMode: (mode: CalendarMode) => void;
  onStep: (direction: 1 | -1) => void;
  onToday: () => void;
  filters: Filters;
  onFilters: (next: Filters) => void;
  onNewTask: () => void;
}) {
  return (
    <header className="topbar">
      <h1>{title}</h1>

      {view === "calendar" ? (
        <>
          <div className="row" style={{ gap: 2 }}>
            <button
              type="button"
              className="btn ghost icon"
              aria-label="Previous"
              onClick={() => onStep(-1)}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              className="btn ghost icon"
              aria-label="Next"
              onClick={() => onStep(1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <button type="button" className="btn" onClick={onToday}>
            Today
          </button>
          <div className="segmented">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={mode === m.id}
                onClick={() => onMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </>
      ) : null}

      <span className="grow" />

      <label className="search">
        <Search size={14} />
        <input
          type="search"
          placeholder="Search tasks"
          value={filters.query}
          onChange={(e) => onFilters({ ...filters, query: e.target.value })}
        />
      </label>

      <Switch
        checked={filters.showCompleted}
        label="Done"
        onChange={(showCompleted) => onFilters({ ...filters, showCompleted })}
      />

      <button type="button" className="btn primary" onClick={onNewTask}>
        <Plus size={15} /> New task
      </button>
    </header>
  );
}
