import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { databasePath } from "@/data/fileStore";
import { isTauri } from "@/lib/env";
import { notify } from "@/services/notifications";
import { useStore } from "@/state/store";
import { ConfirmButton, Field, Modal, Switch } from "./components/primitives";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.db.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const resetDatabase = useStore((s) => s.resetDatabase);
  const storagePath = useStoragePath();
  const [resetError, setResetError] = useState<string | null>(null);

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
      <Field
        label="Notifications"
        hint="Reminders only fire while Tempo is running — there is no background service."
      >
        <NotificationCheck />
      </Field>

      <Field label="Data file" hint="Plain JSON — back it up or sync it like any other file">
        <input className="input mono" readOnly value={storagePath} style={{ fontSize: 12 }} />
      </Field>

      <Field
        label="Reset"
        hint="Erases every task, reminder, category and activity entry, and empties the data file. This cannot be undone."
      >
        <div className="col" style={{ gap: 6, alignItems: "flex-start" }}>
          <ConfirmButton
            label="Reset all data"
            confirm="Yes, erase everything"
            onConfirm={() => {
              setResetError(null);
              void resetDatabase()
                .then(onClose)
                .catch((error: unknown) =>
                  setResetError(error instanceof Error ? error.message : String(error)),
                );
            }}
          />
          {/* The store has already emptied itself in memory by the time a
              failed write reports back, so saying nothing would leave an empty
              app sitting on top of a file that still holds everything. */}
          {resetError ? (
            <span style={{ fontSize: 11.5, color: "var(--danger)" }}>
              Cleared here, but the file could not be written: {resetError}
            </span>
          ) : null}
        </div>
      </Field>
    </Modal>
  );
}

/**
 * "Notifications are not arriving" has several causes that look identical from
 * the app: a reminder that has not come due, a permission Windows withdrew, a
 * toast the OS dropped. One button that takes the exact path a reminder takes
 * separates the app's half of the problem from the system's.
 */
function NotificationCheck() {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [sending, setSending] = useState(false);

  const send = () => {
    setSending(true);
    setResult(null);
    void notify({ title: "Tempo", body: "Notifications are working." })
      .then(() => setResult({ ok: true, message: "Sent — a banner should have appeared." }))
      .catch((error: unknown) =>
        setResult({ ok: false, message: error instanceof Error ? error.message : String(error) }),
      )
      .finally(() => setSending(false));
  };

  return (
    <div className="col" style={{ gap: 6, alignItems: "flex-start" }}>
      <button type="button" className="btn sm" disabled={sending} onClick={send}>
        <BellRing size={13} /> Send a test notification
      </button>
      {result ? (
        <span
          style={{ fontSize: 11.5, color: result.ok ? "var(--text-muted)" : "var(--danger)" }}
        >
          {result.message}
        </span>
      ) : null}
    </div>
  );
}

/** Ask the Rust side where it is actually writing, rather than guessing. */
function useStoragePath(): string {
  const [path, setPath] = useState("Loading…");

  useEffect(() => {
    if (!isTauri()) {
      setPath("Browser localStorage (the desktop build writes to Documents\\calendar)");
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
