import { useEffect, useState } from "react";
import { databasePath } from "@/data/fileStore";
import { isTauri } from "@/lib/env";
import { useStore } from "@/state/store";
import { Field, Modal, Switch } from "./components/primitives";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.db.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const storagePath = useStoragePath();

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      width={440}
      footer={
        <button type="button" className="btn primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <Field label="Appearance">
        <select
          className="select"
          value={settings.theme}
          onChange={(e) =>
            updateSettings({ theme: e.target.value as "system" | "light" | "dark" })
          }
        >
          <option value="system">Match system</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </Field>

      <Switch
        checked={settings.weekStartsOn === 1}
        label="Weeks start on Monday"
        onChange={(monday) => updateSettings({ weekStartsOn: monday ? 1 : 0 })}
      />

      <div className="field-row">
        <Field label="Day starts" hint="Week and day grids">
          <input
            className="input"
            type="number"
            min={0}
            max={23}
            value={settings.dayStartHour}
            onChange={(e) =>
              updateSettings({ dayStartHour: clamp(Number(e.target.value), 0, 23) })
            }
          />
        </Field>
        <Field label="Day ends">
          <input
            className="input"
            type="number"
            min={1}
            max={24}
            value={settings.dayEndHour}
            onChange={(e) =>
              updateSettings({
                dayEndHour: clamp(Number(e.target.value), settings.dayStartHour + 1, 24),
              })
            }
          />
        </Field>
      </div>

      <div className="field-row">
        <Field label="Default reminder" hint="Minutes before start">
          <input
            className="input"
            type="number"
            min={0}
            max={1440}
            value={settings.defaultReminderOffset}
            onChange={(e) =>
              updateSettings({ defaultReminderOffset: clamp(Number(e.target.value), 0, 1440) })
            }
          />
        </Field>
        <Field label="All-day time" hint="Used when an all-day task needs a clock time">
          <input
            className="input"
            type="time"
            value={settings.allDayReminderTime}
            onChange={(e) => updateSettings({ allDayReminderTime: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Data file" hint="Plain JSON — back it up or sync it like any other file">
        <input className="input mono" readOnly value={storagePath} style={{ fontSize: 12 }} />
      </Field>
    </Modal>
  );
}

/** Ask the Rust side where it is actually writing, rather than guessing. */
function useStoragePath(): string {
  const [path, setPath] = useState("Loading…");

  useEffect(() => {
    if (!isTauri()) {
      setPath("Browser localStorage (desktop build writes to Documents\calendar)");
      return;
    }
    let cancelled = false;
    void databasePath()
      .then((value) => !cancelled && setPath(value))
      .catch(() => !cancelled && setPath("Unavailable"));
    return () => {
      cancelled = true;
    };
  }, []);

  return path;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}
