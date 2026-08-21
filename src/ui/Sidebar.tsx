import { useMemo, useState } from "react";
import {
  CalendarDays,
  CircleDot,
  History,
  ListChecks,
  Plus,
  Settings,
  Sun,
  Timer,
  Target,
} from "lucide-react";
import { addDaysLocal, toLocalDate } from "@/domain/datetime";
import { CATEGORY_COLORS } from "@/data/db";
import type { LocalDate } from "@/domain/types";
import {
  useCategories,
  useInstancesInRange,
  useTodoGroups,
  type Filters,
} from "@/state/selectors";
import { useNow, useStore } from "@/state/store";
import { MiniMonth } from "./components/MiniMonth";
import { Field, Modal } from "./components/primitives";

export type ViewId =
  | "today"
  | "calendar"
  | "tasks"
  | "plans"
  | "focus"
  | "activity";

const NAV: { id: ViewId; label: string; icon: typeof Sun }[] = [
  { id: "today", label: "Today", icon: Sun },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "tasks", label: "Tasks", icon: ListChecks },
  { id: "plans", label: "Plans", icon: Target },
  { id: "focus", label: "Focus", icon: Timer },
  { id: "activity", label: "Activity", icon: History },
];

export function Sidebar({
  view,
  onView,
  anchor,
  onAnchor,
  filters,
  onFilters,
  onSettings,
}: {
  view: ViewId;
  onView: (view: ViewId) => void;
  anchor: LocalDate;
  onAnchor: (date: LocalDate) => void;
  filters: Filters;
  onFilters: (next: Filters) => void;
  onSettings: () => void;
}) {
  const now = useNow();
  const today = toLocalDate(now);
  const settings = useStore((s) => s.db.settings);
  const addCategory = useStore((s) => s.addCategory);
  const categories = useCategories();
  const groups = useTodoGroups(filters);
  const [addingCategory, setAddingCategory] = useState(false);

  // A dot in the mini month for any day holding at least one task.
  const monthInstances = useInstancesInRange(
    addDaysLocal(anchor, -42),
    addDaysLocal(anchor, 42),
    filters,
  );
  const busy = useMemo(
    () =>
      new Set(monthInstances.map((i) => i.date).filter(Boolean) as LocalDate[]),
    [monthInstances],
  );

  const counts = useMemo(() => {
    const get = (id: string) =>
      groups.find((g) => g.id === id)?.instances.length ?? 0;
    return {
      today: get("today"),
      overdue: get("overdue"),
      open: groups.reduce(
        (n, g) => n + (g.id === "completed" ? 0 : g.instances.length),
        0,
      ),
    };
  }, [groups]);

  const toggleCategory = (id: string) => {
    const active = filters.categoryIds.includes(id);
    onFilters({
      ...filters,
      categoryIds: active
        ? filters.categoryIds.filter((c) => c !== id)
        : [...filters.categoryIds, id],
    });
  };

  return (
    <nav className="sidebar scroll">
      <div className="brand">
        <span className="brand-mark">
          <CircleDot size={15} />
        </span>
        Tempo
      </div>

      <div className="nav">
        {NAV.map((item) => {
          const Icon = item.icon;
          const badge =
            item.id === "today"
              ? counts.today
              : item.id === "tasks"
                ? counts.open
                : 0;
          return (
            <button
              key={item.id}
              type="button"
              className="nav-item"
              aria-current={view === item.id}
              onClick={() => onView(item.id)}
            >
              <Icon size={16} />
              {item.label}
              {badge > 0 ? <span className="nav-count">{badge}</span> : null}
              {item.id === "today" && counts.overdue > 0 ? (
                <span className="nav-count is-alert">{counts.overdue}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <MiniMonth
        anchor={anchor}
        selected={anchor}
        today={today}
        busyDates={busy}
        weekStartsOn={settings.weekStartsOn}
        onSelect={(date) => {
          onAnchor(date);
          onView("calendar");
        }}
        onAnchorChange={onAnchor}
      />

      <div className="col" style={{ gap: 4 }}>
        <div className="side-heading">
          Categories
          <button
            type="button"
            className="btn ghost icon"
            title="New category"
            onClick={() => setAddingCategory(true)}
          >
            <Plus size={13} />
          </button>
        </div>
        <div className="chip-list">
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              className="category-chip"
              aria-pressed={filters.categoryIds.includes(category.id)}
              onClick={() => toggleCategory(category.id)}
            >
              <i className="dot" style={{ background: category.color }} />
              <span className="grow truncate">{category.name}</span>
            </button>
          ))}
          {filters.categoryIds.length > 0 ? (
            <button
              type="button"
              className="btn ghost sm"
              style={{ alignSelf: "flex-start" }}
              onClick={() => onFilters({ ...filters, categoryIds: [] })}
            >
              Clear filter
            </button>
          ) : null}
        </div>
      </div>

      <div className="grow" />

      <button type="button" className="nav-item" onClick={onSettings}>
        <Settings size={16} />
        Settings
      </button>

      {addingCategory ? (
        <NewCategoryDialog
          onClose={() => setAddingCategory(false)}
          onCreate={(name, color) => {
            addCategory(name, color);
            setAddingCategory(false);
          }}
        />
      ) : null}
    </nav>
  );
}

function NewCategoryDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, color: string) => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(CATEGORY_COLORS[0] as string);

  return (
    <Modal
      title="New category"
      onClose={onClose}
      width={380}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!name.trim()}
            onClick={() => onCreate(name, color)}
          >
            Create
          </button>
        </>
      }
    >
      <Field label="Name">
        <input
          className="input"
          autoFocus
          value={name}
          placeholder="Work"
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Colour">
        <div className="color-picker">
          {CATEGORY_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={c === color}
              aria-label={c}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </Field>
    </Modal>
  );
}
