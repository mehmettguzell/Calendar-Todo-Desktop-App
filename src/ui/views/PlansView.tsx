import { useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  Plus,
  Sun,
  Target,
  Timer,
  Trash2,
} from "lucide-react";
import { toLocalDate } from "@/domain/datetime";
import type { Priority, Task, TaskInstance } from "@/domain/types";
import { toInstance } from "@/domain/task";
import {
  useCategories,
  useCategoryIndex,
  useLiveTasks,
} from "@/state/selectors";
import { useNow, useStore } from "@/state/store";
import { Checkbox, Field, Modal } from "@/ui/components/primitives";
import { cn } from "@/lib/cn";

type PlanFilter = "ALL" | "ACTIVE" | "COMPLETED";

interface PlanStarter {
  id: string;
  title: string;
  categoryName: string;
  description: string;
  subtasks: string[];
}

const PLAN_STARTERS: PlanStarter[] = [
  {
    id: "fitness",
    title: "🎯 30 Günlük Fitness & Sağlık",
    categoryName: "Health",
    description:
      "Düzenli hareket, sağlıklı beslenme ve su takibi ile zinde kal.",
    subtasks: [
      "Haftada 3 gün kardiyo / egzersiz yap",
      "Günde en az 2.5L su iç",
      "İşlenmiş şekeri ve abur cuburu azalt",
      "Her gün 8,000 adım hedefini tamamla",
    ],
  },
  {
    id: "project",
    title: "🚀 Yeni Proje Lansmanı",
    categoryName: "Work",
    description: "Fikirden ürüne adım adım ilerle ve başarıyla yayına al.",
    subtasks: [
      "Gereksinimleri ve MVP kapsamını belirle",
      "Kullanıcı arayüzü ve akışları tasarla",
      "Temel modülleri kodla ve test et",
      "İlk kullanıcıları davet et ve geri bildirim topla",
    ],
  },
  {
    id: "learning",
    title: "📚 Kitap & Yetenek Geliştirme",
    categoryName: "Personal",
    description: "Yeni bir konuda uzmanlaş ve okuma alışkanlığını güçlendir.",
    subtasks: [
      "Günde 25 sayfa odaklı okuma yap",
      "Önemli fikirleri Notlar bölümüne kaydet",
      "Haftada bir mini uygulama projesi yap",
    ],
  },
  {
    id: "habits",
    title: "✨ Üretkenlik & Odak Rutini",
    categoryName: "Personal",
    description:
      "Zamanını en verimli şekilde yönetebileceğin günlük alışkanlıklar kazan.",
    subtasks: [
      "Günün en önemli 1 'Ana Odağını' belirle",
      "Günde en az 2 Focus (Odaklanma) seansı yap",
      "Akşam 5 dakikalık gün değerlendirmesi yap",
    ],
  },
];

export function PlansView({
  selectedKey,
  onOpen,
}: {
  selectedKey: string | null;
  onOpen: (instance: TaskInstance) => void;
}) {
  const tasks = useLiveTasks();
  const createTask = useStore((s) => s.createTask);
  const now = useNow();
  const categories = useCategories();

  const [filter, setFilter] = useState<PlanFilter>("ALL");
  const [newPlanModal, setNewPlanModal] = useState(false);
  const [inlineTitle, setInlineTitle] = useState("");

  const plans = useMemo(
    () => tasks.filter((t) => t.tags.includes("plan") && !t.parentId),
    [tasks],
  );

  const subtasksMap = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (t.parentId) {
        const list = map.get(t.parentId);
        if (list) list.push(t);
        else map.set(t.parentId, [t]);
      }
    }
    return map;
  }, [tasks]);

  const visiblePlans = useMemo(() => {
    return plans.filter((plan) => {
      const subtasks = subtasksMap.get(plan.id) ?? [];
      const isCompleted =
        plan.status === "COMPLETED" ||
        (subtasks.length > 0 &&
          subtasks.every((s) => s.status === "COMPLETED"));

      if (filter === "ACTIVE") return !isCompleted;
      if (filter === "COMPLETED") return isCompleted;
      return true;
    });
  }, [plans, subtasksMap, filter]);

  const handleQuickAdd = () => {
    const trimmed = inlineTitle.trim();
    if (!trimmed) return;
    const newPlan = createTask({
      title: trimmed,
      tags: ["plan"],
      dueDate: null,
      allDay: true,
      priority: "MEDIUM",
    });
    setInlineTitle("");
    onOpen(toInstance(newPlan, null, null, now));
  };

  const handleApplyStarter = (starter: PlanStarter) => {
    const cat = categories.find(
      (c) => c.name.toLowerCase() === starter.categoryName.toLowerCase(),
    );
    const plan = createTask({
      title: starter.title,
      description: starter.description,
      categoryId: cat ? cat.id : null,
      tags: ["plan"],
      priority: "HIGH",
      dueDate: null,
      allDay: true,
    });

    for (const sub of starter.subtasks) {
      createTask({
        title: sub,
        parentId: plan.id,
        dueDate: null,
        allDay: true,
      });
    }

    onOpen(toInstance(plan, null, null, now));
  };

  return (
    <div className="page wide">
      {/* Plans Header & Filter Bar */}
      <div className="plans-header section">
        <div className="plans-title-box">
          <div className="plans-title-icon">
            <Target size={20} />
          </div>
          <div>
            <h2 className="plans-main-title">Planlar & Hedefler</h2>
            <p className="plans-subtitle">
              Büyük hedefleri yönetilebilir adımlara bölün, ilerlemenizi takip
              edin.
            </p>
          </div>
        </div>

        <div className="plans-actions-row">
          <div className="plans-filter-tabs">
            <button
              type="button"
              className={cn("plan-tab-btn", filter === "ALL" && "active")}
              onClick={() => setFilter("ALL")}
            >
              Tümü ({plans.length})
            </button>
            <button
              type="button"
              className={cn("plan-tab-btn", filter === "ACTIVE" && "active")}
              onClick={() => setFilter("ACTIVE")}
            >
              Aktif
            </button>
            <button
              type="button"
              className={cn("plan-tab-btn", filter === "COMPLETED" && "active")}
              onClick={() => setFilter("COMPLETED")}
            >
              Tamamlananlar
            </button>
          </div>

          <button
            type="button"
            className="btn primary"
            onClick={() => setNewPlanModal(true)}
          >
            <Plus size={14} /> Yeni Plan Oluştur
          </button>
        </div>
      </div>

      {/* Inline Fast Add */}
      <div className="row section" style={{ gap: 8 }}>
        <input
          className="input grow"
          placeholder="Yeni bir plan veya hedef adı yazın… (Örn: Web Sitemi Yayınla)"
          value={inlineTitle}
          onChange={(e) => setInlineTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleQuickAdd();
          }}
        />
        <button
          type="button"
          className="btn"
          disabled={!inlineTitle.trim()}
          onClick={handleQuickAdd}
        >
          <Plus size={14} /> Hızlı Ekle
        </button>
      </div>

      {/* Starter Templates if no plans */}
      {plans.length === 0 && (
        <div className="section">
          <div className="section-head" style={{ marginBottom: 12 }}>
            <Lightbulb size={14} />
            <h2>Örnek Hedef Şablonları</h2>
            <span className="faint" style={{ fontSize: 12 }}>
              (Tek tıkla hazır bir plan başlatın)
            </span>
          </div>
          <div className="plan-starters-grid">
            {PLAN_STARTERS.map((starter) => (
              <div
                key={starter.id}
                className="plan-starter-card"
                onClick={() => handleApplyStarter(starter)}
              >
                <div className="plan-starter-title">{starter.title}</div>
                <div className="plan-starter-desc">{starter.description}</div>
                <div className="plan-starter-sub-count">
                  {starter.subtasks.length} alt hedef içerir
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Plans Grid */}
      {visiblePlans.length === 0 && plans.length > 0 ? (
        <div
          className="card"
          style={{ padding: "32px 16px", textAlign: "center" }}
        >
          <p className="faint">Bu filtreye uygun plan bulunamadı.</p>
        </div>
      ) : (
        <div className="plans-grid">
          {visiblePlans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              subtasks={subtasksMap.get(plan.id) ?? []}
              selected={plan.id === selectedKey}
              onOpen={onOpen}
              now={now}
            />
          ))}
        </div>
      )}

      {/* New Plan Dialog */}
      {newPlanModal && (
        <NewPlanModal
          categories={categories}
          onClose={() => setNewPlanModal(false)}
          onCreate={(
            title,
            description,
            categoryId,
            priority,
            initialSubtasks,
          ) => {
            const plan = createTask({
              title,
              description,
              categoryId,
              priority,
              tags: ["plan"],
              dueDate: null,
              allDay: true,
            });

            for (const sub of initialSubtasks) {
              if (sub.trim()) {
                createTask({
                  title: sub.trim(),
                  parentId: plan.id,
                  dueDate: null,
                  allDay: true,
                });
              }
            }

            setNewPlanModal(false);
            onOpen(toInstance(plan, null, null, now));
          }}
        />
      )}
    </div>
  );
}

function PlanCard({
  plan,
  subtasks,
  selected,
  onOpen,
  now,
}: {
  plan: Task;
  subtasks: Task[];
  selected: boolean;
  onOpen: (instance: TaskInstance) => void;
  now: Date;
}) {
  const toggleComplete = useStore((s) => s.toggleComplete);
  const createTask = useStore((s) => s.createTask);
  const updateTask = useStore((s) => s.updateTask);
  const deleteTask = useStore((s) => s.deleteTask);
  const categories = useCategoryIndex();

  const [expanded, setExpanded] = useState(true);
  const [newSubtask, setNewSubtask] = useState("");

  const today = toLocalDate(now);
  const isPlanToday = plan.dueDate === today;
  const openPlan = () => onOpen(toInstance(plan, null, null, now));

  const togglePlanToday = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateTask(plan.id, {
      dueDate: isPlanToday ? null : today,
      allDay: true,
    });
  };

  const category = plan.categoryId ? categories.get(plan.categoryId) : null;
  const doneSubtasks = subtasks.filter((s) => s.status === "COMPLETED").length;
  const totalSubtasks = subtasks.length;
  const isPlanCompleted =
    plan.status === "COMPLETED" ||
    (totalSubtasks > 0 && doneSubtasks === totalSubtasks);
  const progressPct =
    totalSubtasks > 0
      ? Math.round((doneSubtasks / totalSubtasks) * 100)
      : isPlanCompleted
        ? 100
        : 0;

  const handleAddSubtask = () => {
    const trimmed = newSubtask.trim();
    if (!trimmed) return;
    createTask({
      title: trimmed,
      parentId: plan.id,
      dueDate: null,
      allDay: true,
    });
    setNewSubtask("");
  };

  return (
    <div
      className={cn(
        "plan-card",
        selected && "selected",
        isPlanCompleted && "completed",
      )}
    >
      {/* Plan Card Head */}
      <div className="plan-card-head">
        <div className="plan-card-title-row" onClick={openPlan}>
          <Target
            size={18}
            className={cn(
              "plan-icon",
              isPlanCompleted ? "completed" : "active",
            )}
          />
          <h3 className="plan-card-title truncate">{plan.title}</h3>
        </div>

        <div className="plan-card-actions">
          <button
            type="button"
            className={cn("btn ghost icon sm", isPlanToday && "active")}
            title={isPlanToday ? "Bugünden kaldır" : "Planı Bugüne Ata"}
            onClick={togglePlanToday}
            style={isPlanToday ? { color: "#f59e0b" } : undefined}
          >
            <Sun size={14} />
          </button>
          <button
            type="button"
            className="btn ghost icon sm"
            title="Bu plana odaklan (Focus)"
            onClick={openPlan}
          >
            <Timer size={14} />
          </button>
          <button
            type="button"
            className="btn ghost icon sm"
            title="Planı sil"
            onClick={(e) => {
              e.stopPropagation();
              deleteTask(plan.id);
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Plan Description & Meta */}
      {plan.description && (
        <p className="plan-card-desc" onClick={openPlan}>
          {plan.description}
        </p>
      )}

      <div className="plan-card-meta-row" onClick={openPlan}>
        {isPlanToday && (
          <span className="plan-today-pill" title="Bugünün görevlerine eklendi">
            <Sun size={11} /> Bugün
          </span>
        )}
        {category && (
          <span className="plan-category-pill">
            <i className="dot" style={{ background: category.color }} />
            {category.name}
          </span>
        )}
        {plan.priority !== "NONE" && (
          <span className={cn("plan-priority-tag", plan.priority)}>
            {plan.priority}
          </span>
        )}
        {isPlanCompleted && (
          <span className="plan-status-pill success">
            <CheckCircle2 size={11} /> Tamamlandı
          </span>
        )}
      </div>

      {/* Plan Progress */}
      <div className="plan-card-progress-section">
        <div className="plan-progress-label-row">
          <span>İlerleme</span>
          <span className="mono">
            {doneSubtasks}/{totalSubtasks} (%{progressPct})
          </span>
        </div>
        <div className="plan-progress-track">
          <div
            className={cn(
              "plan-progress-bar",
              isPlanCompleted ? "completed" : "in-progress",
            )}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Subtasks Accordion */}
      <div className="plan-subtasks-section">
        <div
          className="plan-subtasks-head"
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="plan-subtasks-toggle-title">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Alt Hedefler ({subtasks.length})
          </span>
        </div>

        {expanded && (
          <div className="plan-subtasks-body">
            {subtasks.length === 0 ? (
              <div className="faint" style={{ fontSize: 12, padding: "4px 0" }}>
                Henüz alt hedef eklenmemiş.
              </div>
            ) : (
              subtasks.map((sub) => {
                const subDone = sub.status === "COMPLETED";
                const subInstance = toInstance(sub, sub.dueDate, null, now);
                const isSubToday = sub.dueDate === today;
                return (
                  <div
                    key={sub.id}
                    className={cn("plan-subtask-item", subDone && "done")}
                  >
                    <Checkbox
                      done={subDone}
                      onToggle={() => toggleComplete(subInstance)}
                    />
                    <span
                      className="plan-subtask-label grow truncate"
                      onClick={() => onOpen(subInstance)}
                      title="Alt görevin özelliklerini aç"
                    >
                      {sub.title}
                    </span>
                    {isSubToday && (
                      <span
                        className="plan-subtask-today-tag"
                        title="Bugüne atanmış"
                      >
                        <Sun size={10} /> Bugün
                      </span>
                    )}
                    <button
                      type="button"
                      className={cn(
                        "btn ghost icon xs plan-subtask-today-btn",
                        isSubToday && "active",
                      )}
                      title={isSubToday ? "Bugünden Kaldır" : "Bugüne Ata"}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateTask(sub.id, {
                          dueDate: isSubToday ? null : today,
                          allDay: true,
                        });
                      }}
                      style={isSubToday ? { color: "#f59e0b" } : undefined}
                    >
                      <Sun size={12} />
                    </button>
                  </div>
                );
              })
            )}

            {/* Quick Add Subtask inline */}
            <div className="plan-subtask-add-row">
              <input
                className="input sm grow"
                placeholder="+ Alt hedef ekle…"
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddSubtask();
                }}
              />
              {newSubtask.trim() && (
                <button
                  type="button"
                  className="btn sm"
                  onClick={handleAddSubtask}
                >
                  Ekle
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function NewPlanModal({
  categories,
  onClose,
  onCreate,
}: {
  categories: { id: string; name: string; color: string }[];
  onClose: () => void;
  onCreate: (
    title: string,
    description: string,
    categoryId: string | null,
    priority: Priority,
    initialSubtasks: string[],
  ) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [subtasksText, setSubtasksText] = useState("");

  const handleSubmit = () => {
    if (!title.trim()) return;
    const subs = subtasksText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    onCreate(title.trim(), description.trim(), categoryId, priority, subs);
  };

  return (
    <Modal
      title="Yeni Plan & Hedef Oluştur"
      onClose={onClose}
      width={480}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            İptal
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!title.trim()}
            onClick={handleSubmit}
          >
            Planı Başlat
          </button>
        </>
      }
    >
      <Field label="Plan / Hedef Başlığı">
        <input
          className="input"
          autoFocus
          placeholder="Örn: 2026 Mobil Uygulama Lansmanı"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>

      <Field label="Açıklama & Neden Önemli?">
        <textarea
          className="input"
          rows={2}
          placeholder="Bu hedefi neden gerçekleştirmek istiyorsunuz?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>

      <div className="row" style={{ gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Field label="Kategori">
            <select
              className="select"
              value={categoryId ?? ""}
              onChange={(e) => setCategoryId(e.target.value || null)}
            >
              <option value="">Kategorisiz</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div style={{ flex: 1 }}>
          <Field label="Öncelik">
            <select
              className="select"
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
            >
              <option value="NONE">Önceliksiz</option>
              <option value="LOW">Düşük</option>
              <option value="MEDIUM">Orta</option>
              <option value="HIGH">Yüksek 🔥</option>
            </select>
          </Field>
        </div>
      </div>

      <Field label="Başlangıç Alt Hedefleri (Her satıra bir hedef)">
        <textarea
          className="input"
          rows={3}
          placeholder={"1. İlk adımı tamamla\n2. İkinci adımı planla"}
          value={subtasksText}
          onChange={(e) => setSubtasksText(e.target.value)}
        />
      </Field>
    </Modal>
  );
}
