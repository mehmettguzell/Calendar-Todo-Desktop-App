import {
  PRIORITIES,
  type Priority,
} from "@/domain/types";
import { useI18n } from "@/lib/i18n";
import {
  Field,
  Modal,
} from "@/ui/components/primitives";
import { useState } from "react";

// Starting a plan: a blank one, or one of the starters.
export function NewPlanModal({
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
  const { t } = useI18n();
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
      title={t("plansNewTitle")}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("cancel")}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!title.trim()}
            onClick={handleSubmit}
          >
            {t("plansStart")}
          </button>
        </>
      }
    >
      <Field label={t("plansFieldTitle")}>
        <input
          className="input"
          autoFocus
          placeholder={t("plansTitlePlaceholder")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>

      <Field label={t("plansFieldWhy")}>
        <textarea
          className="input"
          rows={2}
          placeholder={t("plansWhyPlaceholder")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>

      <div className="row" style={{ gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Field label={t("formCategory")}>
            <select
              className="select"
              value={categoryId ?? ""}
              onChange={(e) => setCategoryId(e.target.value || null)}
            >
              <option value="">{t("plansNoCategory")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div style={{ flex: 1 }}>
          <Field label={t("formPriority")}>
            <select
              className="select"
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`priority${p}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      <Field label={t("plansFieldSteps")}>
        <textarea
          className="input"
          rows={3}
          placeholder={t("plansStepsPlaceholder")}
          value={subtasksText}
          onChange={(e) => setSubtasksText(e.target.value)}
        />
      </Field>
    </Modal>
  );
}
