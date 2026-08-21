import { useState } from "react";
import { atTime, toLocalDate, toLocalTime } from "@/domain/datetime";
import { resolveSnooze, SNOOZE_PRESETS, type SnoozePresetId } from "@/domain/snooze";
import type { TaskInstance } from "@/domain/types";
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
        Snooze
      </div>
      {SNOOZE_PRESETS.map((preset) => {
        const preview =
          preset.id === "custom"
            ? null
            : resolveSnooze(instance, preset.id, settings, now);
        return (
          <button
            key={preset.id}
            type="button"
            className="menu-item"
            onClick={() => apply(preset.id)}
          >
            <span className="grow">{preset.label}</span>
            {preview ? (
              <span className="faint mono" style={{ fontSize: 11 }}>
                {preview.reschedule
                  ? `${preview.reschedule.date.slice(5)} ${toLocalTime(new Date(preview.until))}`
                  : toLocalTime(new Date(preview.until))}
              </span>
            ) : null}
          </button>
        );
      })}
      <hr />
      <div style={{ padding: "2px 8px 4px", fontSize: 11, color: "var(--text-faint)" }}>
        Day-jumping options move the task and are recorded in its history.
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
  const now = useNow();
  const [date, setDate] = useState(instance.date ?? toLocalDate(now));
  const [time, setTime] = useState(
    instance.task.startTime ?? toLocalTime(new Date(now.getTime() + 3600_000)),
  );

  return (
    <Modal
      title="Snooze until"
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
            onClick={() => {
              snooze(instance, "custom", atTime(date, time));
              onClose();
            }}
          >
            Snooze
          </button>
        </>
      }
    >
      <div className="field-row">
        <Field label="Date">
          <input
            className="input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Time">
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
