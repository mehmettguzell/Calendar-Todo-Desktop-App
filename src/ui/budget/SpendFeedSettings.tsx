import { useEffect, useState } from "react";
import { AlertTriangle, Check, KeyRound, RefreshCw, Wallet } from "lucide-react";
import { DEFAULT_SPEND_NUDGE_TIME } from "@/domain/spendLog";
import { isTauri } from "@/lib/env";
import { useI18n } from "@/lib/i18n";
import {
  BANK_SENDERS,
  clearMailPassword,
  DEFAULT_MAIL_SYNC,
  hasMailPassword,
  MAIL_PRESETS,
  probeMail,
  setMailPassword,
} from "@/services/mail";
import { syncSpendFeed } from "@/services/spendFeed";
import { useSpendFeedStore } from "@/state/spendFeedStore";
import { useStore } from "@/state/store";
import { Field, Switch } from "@/ui/components/primitives";

/**
 * Setting up the two things that make spending get recorded at all.
 *
 * The evening prompt is one line, because it is one decision. The mail feed is
 * a form, because connecting to a mailbox genuinely needs five facts — and the
 * form is arranged so the two that people get wrong (an app password, and which
 * senders to read) are the two that carry an explanation.
 *
 * Everything here stays hidden behind a switch that starts off. A user who
 * never turns it on should not be able to tell this exists.
 */
export function SpendFeedSettings() {
  const { t } = useI18n();
  const settings = useStore((s) => s.db.settings);
  const updateSettings = useStore((s) => s.updateSettings);

  const config = settings.mailSync ?? DEFAULT_MAIL_SYNC;
  const patch = (next: Partial<typeof config>) =>
    updateSettings({ mailSync: { ...config, ...next } });

  const [password, setPassword] = useState("");
  const [stored, setStored] = useState(false);
  const [probe, setProbe] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const syncing = useSpendFeedStore((s) => s.syncing);
  const [outcome, setOutcome] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void hasMailPassword(config.username).then((has) => {
      if (!cancelled) setStored(has);
    });
    return () => {
      cancelled = true;
    };
  }, [config.username]);

  const preset = MAIL_PRESETS.find((entry) => entry.host === config.host);

  const test = async () => {
    setTesting(true);
    setProbe(null);
    try {
      const count = await probeMail(config);
      setProbe({ ok: true, text: t("mailTestOk", { n: count }) });
    } catch (error) {
      setProbe({ ok: false, text: String((error as Error).message ?? error) });
    } finally {
      setTesting(false);
    }
  };

  const runNow = async () => {
    setOutcome(null);
    const result = await syncSpendFeed();
    if (result.recorded === 0 && result.merged === 0 && result.queued === 0) {
      setOutcome(t("mailNothingNew"));
      return;
    }
    const parts = [t("mailResult", { n: result.recorded })];
    if (result.merged > 0) parts.push(t("mailResultMerged", { n: result.merged }));
    setOutcome(parts.join(" · "));
  };

  /** Add a bank's domains without duplicating one already in the list. */
  const addBank = (domains: string[]) => {
    const merged = [...config.senders];
    for (const domain of domains) {
      if (!merged.some((sender) => sender.toLowerCase() === domain.toLowerCase())) {
        merged.push(domain);
      }
    }
    patch({ senders: merged });
  };

  return (
    <section className="settings-section">
      <h3 className="settings-heading">
        <Wallet size={13} /> {t("mailTitle")}
      </h3>

      <Field label={t("spendNudge")} hint={t("spendNudgeHint")}>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <Switch
            checked={settings.spendNudgeEnabled ?? true}
            label={t("spendNudgeTime")}
            onChange={(next) => updateSettings({ spendNudgeEnabled: next })}
          />
          <input
            className="input"
            type="time"
            style={{ width: 120 }}
            aria-label={t("spendNudgeTime")}
            value={settings.spendNudgeTime ?? DEFAULT_SPEND_NUDGE_TIME}
            disabled={!(settings.spendNudgeEnabled ?? true)}
            onChange={(e) => updateSettings({ spendNudgeTime: e.target.value })}
          />
        </div>
      </Field>

      <hr className="settings-rule" />

      <p className="faint" style={{ fontSize: 12, lineHeight: 1.5 }}>
        {t("mailIntro")}
      </p>

      {!isTauri() ? (
        <p className="import-error">
          <AlertTriangle size={14} /> {t("mailDesktopOnly")}
        </p>
      ) : null}

      <Switch
        checked={config.enabled}
        label={t("mailEnabled")}
        onChange={(next) => patch({ enabled: next })}
      />

      {config.enabled ? (
        <div className="col" style={{ gap: 10 }}>
          <Field label={t("mailProvider")}>
            <select
              className="select"
              value={preset?.id ?? "custom"}
              onChange={(e) => {
                const chosen = MAIL_PRESETS.find((entry) => entry.id === e.target.value);
                if (chosen) {
                  patch({ host: chosen.host, port: chosen.port, secure: chosen.secure });
                }
              }}
            >
              {MAIL_PRESETS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
              <option value="custom">{t("mailProviderCustom")}</option>
            </select>
          </Field>

          <div className="mail-grid">
            <Field label={t("mailHost")}>
              <input
                className="input"
                value={config.host}
                onChange={(e) => patch({ host: e.target.value })}
              />
            </Field>
            <Field label={t("mailPort")}>
              <input
                className="input"
                inputMode="numeric"
                value={config.port}
                onChange={(e) => patch({ port: Number(e.target.value) || 993 })}
              />
            </Field>
          </div>

          <Switch
            checked={config.secure}
            label={t("mailSecure")}
            onChange={(next) => patch({ secure: next })}
          />

          <Field label={t("mailUser")}>
            <input
              className="input"
              type="email"
              autoComplete="off"
              value={config.username}
              onChange={(e) => patch({ username: e.target.value })}
            />
          </Field>

          <Field label={t("mailPassword")} hint={t("mailPasswordHint")}>
            <div className="row" style={{ gap: 6 }}>
              <input
                className="input grow"
                type="password"
                autoComplete="new-password"
                placeholder={stored ? "••••••••" : ""}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="btn"
                disabled={!password || !config.username.trim()}
                onClick={() => {
                  void setMailPassword(config.username, password).then(() => {
                    setPassword("");
                    setStored(true);
                  });
                }}
              >
                <KeyRound size={13} /> {t("mailPasswordSave")}
              </button>
            </div>
          </Field>

          {stored ? (
            <p className="faint" style={{ fontSize: 11.5, margin: 0 }}>
              <Check size={12} /> {t("mailPasswordStored")}{" "}
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => {
                  void clearMailPassword(config.username).then(() => setStored(false));
                }}
              >
                {t("mailPasswordClear")}
              </button>
            </p>
          ) : (
            <p className="faint" style={{ fontSize: 11.5, margin: 0 }}>
              {t("mailAppPasswordHint")}
            </p>
          )}

          <Field label={t("mailFolder")}>
            <input
              className="input"
              value={config.folder}
              onChange={(e) => patch({ folder: e.target.value })}
            />
          </Field>

          <Field label={t("mailSenders")} hint={t("mailSendersHint")}>
            <input
              className="input"
              placeholder="@garantibbva.com.tr, @isbank.com.tr"
              value={config.senders.join(", ")}
              onChange={(e) =>
                patch({
                  senders: e.target.value
                    .split(",")
                    .map((sender) => sender.trim())
                    .filter(Boolean),
                })
              }
            />
          </Field>

          <div className="row wrap" style={{ gap: 6 }}>
            <span className="faint" style={{ fontSize: 11.5 }}>
              {t("mailBanks")}:
            </span>
            {BANK_SENDERS.map((bank) => (
              <button
                key={bank.id}
                type="button"
                className="btn ghost sm"
                onClick={() => addBank(bank.domains)}
              >
                {bank.label}
              </button>
            ))}
          </div>

          <Field label={t("mailEvery")}>
            <input
              className="input"
              inputMode="numeric"
              value={config.everyMinutes}
              onChange={(e) =>
                patch({ everyMinutes: Math.max(5, Number(e.target.value) || 15) })
              }
            />
          </Field>

          <Switch
            checked={config.autoRecord}
            label={t("mailAutoRecord")}
            onChange={(next) => patch({ autoRecord: next })}
          />
          <p className="faint" style={{ fontSize: 11.5, margin: 0 }}>
            {t("mailAutoRecordHint")}
          </p>

          <div className="row wrap" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn"
              disabled={testing || !config.username.trim()}
              onClick={() => void test()}
            >
              {testing ? t("mailTesting") : t("mailTest")}
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={syncing || !stored}
              onClick={() => void runNow()}
            >
              <RefreshCw size={13} /> {syncing ? t("mailSyncing") : t("mailSyncNow")}
            </button>
          </div>

          {!stored ? (
            <p className="faint" style={{ fontSize: 11.5, margin: 0 }}>
              {t("mailNoPassword")}
            </p>
          ) : null}

          {probe ? (
            <p className={probe.ok ? "mail-ok" : "import-error"}>
              {probe.ok ? <Check size={13} /> : <AlertTriangle size={13} />} {probe.text}
            </p>
          ) : null}

          {outcome ? (
            <p className="mail-ok">
              <Check size={13} /> {outcome}
            </p>
          ) : null}

          <p className="faint" style={{ fontSize: 11.5, margin: 0 }}>
            {t("mailLastSync")}:{" "}
            {config.lastSyncAt
              ? new Date(config.lastSyncAt).toLocaleString()
              : t("mailNever")}
          </p>

          {config.lastError ? (
            <p className="import-error">
              <AlertTriangle size={13} /> {config.lastError}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
