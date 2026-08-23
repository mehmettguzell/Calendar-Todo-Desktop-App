import { useState } from "react";
import { atTime, toLocalDate, toLocalTime } from "@/domain/datetime";
import {
  resolveSnooze,
  snoozePreviewDate,
  SNOOZE_PRESETS,
  type SnoozePresetId,
} from "@/domain/snooze";
import type { TaskInstance } from "@/domain/types";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { useNow, useStore } from "@/state/store";
import { Field, Modal, Popover } from "@/ui/components/primitives";

/**
 * The snooze picker from spec section 8.
 *
 * Each preset previews its own consequence, because two of the outcomes differ:
 * short snoozes only quiet the reminder, while day-jumping ones also move the
 * task. Showing that up front keeps "snooze" from silently rescheduling work.
 */
export function SnoozeMenu({
  instance,
  onClose,
  align = "left",
}: {
  instance: TaskInstance;
  onClose: () => void;
  align?: "left" | "right";
}) {
  const snooze = useStore((s) => s.snooze);
  const settings = useStore((s) => s.db.settings);
  const { t } = useI18n();
  const now = useNow();
  const [customOpen, setCustomOpen] = useState(false);

  const apply = (preset: SnoozePresetId) => {
    if (preset === "custom") {
      setCustomOpen(true);
      return;
    }
    snooze(instance, preset);
    onClose();
  };

  if (customOpen) {
    return (
      <CustomSnoozeDialog
        instance={instance}
        onClose={() => {
          setCustomOpen(false);
          onClose();
        }}
      />
    );
  }

  return (
    <Popover onClose={onClose} align={align}>
      <div style={{ padding: "4px 8px 6px", fontSize: 11, fontWeight: 650, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-faint)" }}>
        {t("snooze")}
      </div>
      {SNOOZE_PRESETS.map((preset) => {
        const preview =
          preset.id === "custom"
            ? null
            : resolveSnooze(instance, preset.id, settings, now);
        // Day-jumping presets count from the task's own day, so the resulting
        // date is not something the label can be read off. Show it.
        const targetDate =
          preset.id === "custom"
            ? null
            : snoozePreviewDate(instance, preset.id, settings, now);
        const clock = preview?.until ? toLocalTime(new Date(preview.until)) : null;
        return (
          <button
            key={preset.id}
            type="button"
            className="menu-item"
            onClick={() => apply(preset.id)}
          >
            <span className="grow">{t(preset.labelKey as TranslationKey)}</span>
            {targetDate ? (
              <span className="faint mono" style={{ fontSize: 11 }}>
                {preview?.reschedule
                  ? `${targetDate.slice(5)}${clock ? ` ${clock}` : ""}`
                  : (clock ?? targetDate.slice(5))}
              </span>
            ) : null}
          </button>
        );
      })}
      <hr />
      <div style={{ padding: "2px 8px 4px", fontSize: 11, color: "var(--text-faint)" }}>
        {t("snoozeFootnote")}
      </div>
    </Popover>
  );
}

function CustomSnoozeDialog({
  instance,
  onClose,
}: {
  instance: TaskInstance;
  onClose: () => void;
}) {
  const snooze = useStore((s) => s.snooze);
  const { t } = useI18n();
  const now = useNow();
  const [date, setDate] = useState(instance.date ?? toLocalDate(now));
  const [time, setTime] = useState(
    instance.task.startTime ?? toLocalTime(new Date(now.getTime() + 3600_000)),
  );

  return (
    <Modal
      title={t("snoozeUntilLabel")}
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
            onClick={() => {
              snooze(instance, "custom", atTime(date, time));
              onClose();
            }}
          >
            {t("snooze")}
          </button>
        </>
      }
    >
      <div className="field-row">
        <Field label={t("fieldDate")}>
          <input
            className="input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label={t("fieldTime")}>
          <input
            className="input"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}
