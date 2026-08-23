import { useMemo, useState } from "react";
import {
  CalendarDays,
  CircleDot,
  ListChecks,
  Pencil,
  Plus,
  Settings,
  Sun,
  Timer,
  Target,
  StickyNote,
  Trash2,
  Wallet,
} from "lucide-react";
import { addDaysLocal, toLocalDate } from "@/domain/datetime";
import { CATEGORY_COLORS } from "@/data/db";
import type { Category, LocalDate } from "@/domain/types";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import {
  useCategories,
  useGamificationStats,
  useInstancesInRange,
  useLiveTasks,
  useTodoGroups,
  useTrashedTasks,
  type Filters,
} from "@/state/selectors";
import { useNow, useStore } from "@/state/store";
import { LevelBadge } from "./components/LevelBadge";
import { MiniMonth } from "./components/MiniMonth";
import { TrashModal } from "./components/TrashModal";
import { UserProfileWidget } from "./components/UserProfileWidget";
import { Field, Modal } from "./components/primitives";

export type ViewId =
  | "today"
  | "calendar"
  | "tasks"
  | "plans"
  | "notes"
  | "focus"
  | "budget";

const NAV: { id: ViewId; labelKey: TranslationKey; icon: typeof Sun }[] = [
  { id: "today", labelKey: "navToday", icon: Sun },
  { id: "calendar", labelKey: "navCalendar", icon: CalendarDays },
  { id: "tasks", labelKey: "navTasks", icon: ListChecks },
  { id: "plans", labelKey: "navPlans", icon: Target },
  { id: "notes", labelKey: "navNotes", icon: StickyNote },
  { id: "focus", labelKey: "navFocus", icon: Timer },
  { id: "budget", labelKey: "navBudget", icon: Wallet },
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
  const updateCategory = useStore((s) => s.updateCategory);
  const removeCategory = useStore((s) => s.removeCategory);
  const categories = useCategories();
  const liveTasks = useLiveTasks();
  const trashedTasks = useTrashedTasks();
  const groups = useTodoGroups(filters);
  const [addingCategory, setAddingCategory] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const { t } = useI18n();

  // Task count per category (for non-completed tasks)
  const categoryCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of liveTasks) {
      if (t.categoryId && t.status !== "COMPLETED") {
        map[t.categoryId] = (map[t.categoryId] ?? 0) + 1;
      }
    }
    return map;
  }, [liveTasks]);

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

  const { levelInfo, streaks } = useGamificationStats();

  const toggleCategory = (id: string) => {
    const active = filters.categoryIds.includes(id);
    onFilters({
      ...filters,
      categoryIds: active
        ? filters.categoryIds.filter((c) => c !== id)
        : [...filters.categoryIds, id],
    });
  };

  const handleDeleteCategory = (id: string) => {
    removeCategory(id);
    if (filters.categoryIds.includes(id)) {
      onFilters({
        ...filters,
        categoryIds: filters.categoryIds.filter((c) => c !== id),
      });
    }
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
              {t(item.labelKey)}
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
          {t("categories")}
          <button
            type="button"
            className="btn ghost icon"
            title={t("newCategory")}
            onClick={() => setAddingCategory(true)}
          >
            <Plus size={13} />
          </button>
        </div>
        <div className="chip-list">
          {categories.map((category) => (
            <div key={category.id} className="category-chip-row">
              <button
                type="button"
                className="category-chip grow truncate"
                aria-pressed={filters.categoryIds.includes(category.id)}
                onClick={() => toggleCategory(category.id)}
                title={category.name}
              >
                <i className="dot" style={{ background: category.color }} />
                <span className="grow truncate">{category.name}</span>
                {(categoryCounts[category.id] ?? 0) > 0 && (
                  <span className="category-chip-count">
                    {categoryCounts[category.id]}
                  </span>
                )}
              </button>
              <button
                type="button"
                className="category-chip-action-btn"
                title={t("editCategory")}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingCategory(category);
                }}
              >
                <Pencil size={11} />
              </button>
            </div>
          ))}
          {filters.categoryIds.length > 0 ? (
            <button
              type="button"
              className="btn ghost sm"
              style={{ alignSelf: "flex-start", marginTop: 4 }}
              onClick={() => onFilters({ ...filters, categoryIds: [] })}
            >
              {t("clearFilter")} ({filters.categoryIds.length})
            </button>
          ) : null}
        </div>
      </div>

      <div className="grow" />

      {/* User Profile & Trial Sync Widget */}
      <UserProfileWidget />

      {/* Gamification Level & Streak Widget */}
      <LevelBadge levelInfo={levelInfo} streaks={streaks} />

      <button
        type="button"
        className="nav-item"
        onClick={() => setTrashOpen(true)}
      >
        <Trash2 size={16} />
        {t("trash")}
        {trashedTasks.length > 0 ? (
          <span className="nav-count">{trashedTasks.length}</span>
        ) : null}
      </button>

      <button type="button" className="nav-item" onClick={onSettings}>
        <Settings size={16} />
        {t("navSettings")}
      </button>

      {trashOpen && <TrashModal onClose={() => setTrashOpen(false)} />}

      {addingCategory ? (
        <NewCategoryDialog
          onClose={() => setAddingCategory(false)}
          onCreate={(name, color) => {
            addCategory(name, color);
            setAddingCategory(false);
          }}
        />
      ) : null}

      {editingCategory ? (
        <EditCategoryDialog
          category={editingCategory}
          onClose={() => setEditingCategory(null)}
          onUpdate={(name, color) => {
            updateCategory(editingCategory.id, { name, color });
            setEditingCategory(null);
          }}
          onDelete={() => {
            handleDeleteCategory(editingCategory.id);
            setEditingCategory(null);
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
  const { t } = useI18n();

  return (
    <Modal
      title={t("newCategory")}
      onClose={onClose}
      width={380}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("cancel")}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!name.trim()}
            onClick={() => onCreate(name, color)}
          >
            {t("create")}
          </button>
        </>
      }
    >
      <Field label={t("categoryName")}>
        <input
          className="input"
          autoFocus
          value={name}
          placeholder={t("categoryExample")}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label={t("categoryColor")}>
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

function EditCategoryDialog({
  category,
  onClose,
  onUpdate,
  onDelete,
}: {
  category: Category;
  onClose: () => void;
  onUpdate: (name: string, color: string) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(category.name);
  const [color, setColor] = useState(category.color);
  const { t } = useI18n();

  return (
    <Modal
      title={t("editCategory")}
      onClose={onClose}
      width={380}
      footer={
        <div className="row grow justify-between">
          <button type="button" className="btn ghost danger" onClick={onDelete}>
            {t("delete")}
          </button>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn" onClick={onClose}>
              {t("cancel")}
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={!name.trim()}
              onClick={() => onUpdate(name.trim(), color)}
            >
              {t("save")}
            </button>
          </div>
        </div>
      }
    >
      <Field label={t("categoryName")}>
        <input
          className="input"
          autoFocus
          value={name}
          placeholder={t("categoryNamePlaceholder")}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label={t("categoryColor")}>
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
