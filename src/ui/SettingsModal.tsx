import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { databasePath } from "@/data/fileStore";
import { isTauri } from "@/lib/env";
import { useI18n, type Language } from "@/lib/i18n";
import { notify } from "@/services/notifications";
import { useStore } from "@/state/store";
import { ConfirmButton, Field, Modal, Switch } from "./components/primitives";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.db.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const resetDatabase = useStore((s) => s.resetDatabase);
  const storagePath = useStoragePath();
  const [resetError, setResetError] = useState<string | null>(null);
  const { t } = useI18n();

  return (
    <Modal
      title={t("settingsTitle")}
      onClose={onClose}
      width={440}
      footer={
        <button type="button" className="btn primary" onClick={onClose}>
          {t("done")}
        </button>
      }
    >
      <Field label={t("language")}>
        <select
          className="select"
          value={settings.language ?? "tr"}
          onChange={(e) =>
            updateSettings({ language: e.target.value as Language })
          }
        >
          <option value="tr">{t("langTr")}</option>
          <option value="en">{t("langEn")}</option>
        </select>
      </Field>

      <Field label={t("appearance")}>
        <select
          className="select"
          value={settings.theme}
          onChange={(e) =>
            updateSettings({
              theme: e.target.value as "system" | "light" | "dark",
            })
          }
        >
          <option value="system">{t("themeSystem")}</option>
          <option value="light">{t("themeLight")}</option>
          <option value="dark">{t("themeDark")}</option>
        </select>
      </Field>

      <Switch
        checked={settings.weekStartsOn === 1}
        label={t("weekStartsOnMonday")}
        onChange={(monday) => updateSettings({ weekStartsOn: monday ? 1 : 0 })}
      />

      <div className="field-row">
        <Field label={t("dayStarts")} hint={t("dayStartsHint")}>
          <input
            className="input"
            type="number"
            min={0}
            max={23}
            value={settings.dayStartHour}
            onChange={(e) =>
              updateSettings({
                dayStartHour: clamp(Number(e.target.value), 0, 23),
              })
            }
          />
        </Field>
        <Field label={t("dayEnds")}>
          <input
            className="input"
            type="number"
            min={1}
            max={24}
            value={settings.dayEndHour}
            onChange={(e) =>
              updateSettings({
                dayEndHour: clamp(
                  Number(e.target.value),
                  settings.dayStartHour + 1,
                  24,
                ),
              })
            }
          />
        </Field>
      </div>

      <div className="field-row">
        <Field label={t("defaultReminder")} hint={t("defaultReminderHint")}>
          <input
            className="input"
            type="number"
            min={0}
            max={1440}
            value={settings.defaultReminderOffset}
            onChange={(e) =>
              updateSettings({
                defaultReminderOffset: clamp(Number(e.target.value), 0, 1440),
              })
            }
          />
        </Field>
        <Field label={t("allDayTime")} hint={t("allDayTimeHint")}>
          <input
            className="input"
            type="time"
            value={settings.allDayReminderTime}
            onChange={(e) =>
              updateSettings({ allDayReminderTime: e.target.value })
            }
          />
        </Field>
      </div>
      <Field label={t("notifications")} hint={t("notificationsHint")}>
        <NotificationCheck />
      </Field>

      <Field label={t("dataFile")} hint={t("dataFileHint")}>
        <input
          className="input mono"
          readOnly
          value={storagePath}
          style={{ fontSize: 12 }}
        />
      </Field>

      <Field label={t("reset")} hint={t("resetHint")}>
        <div className="col" style={{ gap: 6, alignItems: "flex-start" }}>
          <ConfirmButton
            label={t("resetAllData")}
            confirm={t("resetConfirm")}
            onConfirm={() => {
              setResetError(null);
              void resetDatabase()
                .then(onClose)
                .catch((error: unknown) =>
                  setResetError(
                    error instanceof Error ? error.message : String(error),
                  ),
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
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const [sending, setSending] = useState(false);
  const { t } = useI18n();

  const send = () => {
    setSending(true);
    setResult(null);
    void notify({ title: "Tempo", body: "Notifications are working." })
      .then(() => setResult({ ok: true, message: t("testNotifSuccess") }))
      .catch((error: unknown) =>
        setResult({
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        }),
      )
      .finally(() => setSending(false));
  };

  return (
    <div className="col" style={{ gap: 6, alignItems: "flex-start" }}>
      <button
        type="button"
        className="btn sm"
        disabled={sending}
        onClick={send}
      >
        <BellRing size={13} /> {t("sendTestNotification")}
      </button>
      {result ? (
        <span
          style={{
            fontSize: 11.5,
            color: result.ok ? "var(--text-muted)" : "var(--danger)",
          }}
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
      setPath(
        "Browser localStorage (the desktop build writes to Documents\\calendar)",
      );
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
