import { useState } from "react";
import { CATEGORY_COLORS } from "@/data/db";
import type { Category } from "@/domain/types";
import { useI18n } from "@/lib/i18n";
import { Field, Modal } from "./primitives";

/**
 * Naming a category, whether it is new or being corrected.
 *
 * One dialog for both: the fields are the same either way, and two copies were
 * two chances to let the create form and the edit form drift apart.
 */
export function CategoryDialog({
  category,
  onClose,
  onSave,
  onDelete,
}: {
  /** The category being corrected, or null when one is being created. */
  category: Category | null;
  onClose: () => void;
  onSave: (name: string, color: string) => void;
  onDelete?: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(category?.name ?? "");
  const [color, setColor] = useState(category?.color ?? (CATEGORY_COLORS[0] as string));

  const save = (
    <button
      type="button"
      className="btn primary"
      disabled={!name.trim()}
      onClick={() => onSave(name.trim(), color)}
    >
      {category ? t("save") : t("create")}
    </button>
  );
  const cancel = (
    <button type="button" className="btn" onClick={onClose}>
      {t("cancel")}
    </button>
  );

  return (
    <Modal
      title={category ? t("editCategory") : t("newCategory")}
      onClose={onClose}
      width={380}
      footer={
        onDelete ? (
          <div className="row grow justify-between">
            <button type="button" className="btn ghost danger" onClick={onDelete}>
              {t("delete")}
            </button>
            <div className="row" style={{ gap: 6 }}>
              {cancel}
              {save}
            </div>
          </div>
        ) : (
          <>
            {cancel}
            {save}
          </>
        )
      }
    >
      <Field label={t("categoryName")}>
        <input
          className="input"
          autoFocus
          value={name}
          placeholder={t(category ? "categoryNamePlaceholder" : "categoryExample")}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label={t("categoryColor")}>
        <div className="color-picker">
          {CATEGORY_COLORS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === color}
              aria-label={option}
              style={{ background: option }}
              onClick={() => setColor(option)}
            />
          ))}
        </div>
      </Field>
    </Modal>
  );
}
