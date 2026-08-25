import { useEffect, useRef } from "react";
import { isSpendingAlert, parseBankAlert, type BankAlert } from "@/domain/bankAlert";
import type { MailSyncSettings } from "@/domain/types";
import { isTauri } from "@/lib/env";
import { useSpendFeedStore } from "@/state/spendFeedStore";
import { useStore } from "@/state/store";
import { fetchMail, MailError } from "./mail";

/**
 * The automatic spending feed, end to end.
 *
 * Poll the mailbox, read what the bank said, and either write it to the ledger
 * or hold it for a decision. The whole loop is arranged around one rule: it may
 * never write a purchase twice. Three separate things enforce that, because
 * this runs unattended and a duplicate written at 3am is one nobody notices:
 *
 *   1. Each message's UID becomes the entry's `externalId`, so re-reading a
 *      message cannot produce a second entry.
 *   2. `recordBankAlerts` reconciles against what is already in the ledger, so
 *      a purchase the user typed at the till is settled rather than repeated.
 *   3. The high-water mark only advances once a batch has been dealt with, so
 *      closing the app mid-review loses the review, never the purchase.
 */

export interface SyncOutcome {
  /** Messages the server offered. */
  examined: number;
  /** Messages that read as a completed transaction. */
  recognised: number;
  /** Entries the ledger actually gained. */
  recorded: number;
  /** Alerts that settled an entry that was already there. */
  merged: number;
  /** Alerts waiting for a decision, when the feed is set to ask first. */
  queued: number;
}

const EMPTY: SyncOutcome = {
  examined: 0,
  recognised: 0,
  recorded: 0,
  merged: 0,
  queued: 0,
};

export function mailSyncReady(config: MailSyncSettings | undefined): config is MailSyncSettings {
  return Boolean(
    config?.enabled && config.host.trim() && config.username.trim() && isTauri(),
  );
}

/**
 * One poll.
 *
 * Failures are recorded rather than thrown: this runs on a timer, and an
 * unreachable server at lunchtime must not take the rest of the app with it.
 * What went wrong is written to the settings so it can be read in Settings
 * instead of being swallowed.
 */
export async function syncSpendFeed(): Promise<SyncOutcome> {
  const store = useStore.getState();
  const config = store.db.settings.mailSync;
  if (!mailSyncReady(config)) return EMPTY;

  const feed = useSpendFeedStore.getState();
  if (feed.syncing) return EMPTY;
  feed.setSyncing(true);

  try {
    const result = await fetchMail(config);

    const alerts: BankAlert[] = [];
    for (const message of result.messages) {
      const alert = parseBankAlert(message);
      if (alert && isSpendingAlert(alert)) alerts.push(alert);
    }

    const at = new Date().toISOString();

    if (!config.autoRecord && alerts.length > 0) {
      // Hold the batch, and deliberately do NOT advance the mark: the mailbox
      // stays the queue until every message in it has been decided.
      useSpendFeedStore.getState().offer(alerts, result.lastUid);
      useSpendFeedStore.getState().setResult({ lastSyncAt: at, lastError: null });
      store.updateSettings({
        mailSync: { ...config, lastSyncAt: at, lastError: null },
      });
      return {
        examined: result.examined,
        recognised: alerts.length,
        recorded: 0,
        merged: 0,
        queued: alerts.length,
      };
    }

    const recorded = alerts.length > 0 ? store.recordBankAlerts(alerts) : 0;
    const merged = alerts.length - recorded;

    store.updateSettings({
      mailSync: {
        ...config,
        // Only moves forward. A server that reports a lower id than we have
        // seen is a server that has been restored from a backup, and rewinding
        // would re-offer messages the ledger already holds.
        lastUid: Math.max(config.lastUid ?? 0, result.lastUid),
        lastSyncAt: at,
        lastError: null,
      },
    });
    useSpendFeedStore
      .getState()
      .setResult({ lastSyncAt: at, lastError: null, lastRecorded: recorded, lastMerged: merged });

    return {
      examined: result.examined,
      recognised: alerts.length,
      recorded,
      merged,
      queued: 0,
    };
  } catch (error) {
    const reason = error instanceof MailError ? error.reason : String(error);
    useSpendFeedStore.getState().setResult({ lastError: reason });
    const current = useStore.getState().db.settings.mailSync;
    if (current) {
      useStore.getState().updateSettings({ mailSync: { ...current, lastError: reason } });
    }
    return EMPTY;
  } finally {
    useSpendFeedStore.getState().setSyncing(false);
  }
}

/**
 * Accept one held alert, or throw it away.
 *
 * Once the queue is empty the batch's high-water mark is committed, which is
 * what stops the same messages being offered again on the next poll.
 */
export function decideAlert(alert: BankAlert, accept: boolean): void {
  const store = useStore.getState();
  if (accept) store.recordBankAlerts([alert]);

  const feed = useSpendFeedStore.getState();
  feed.resolve(alert.externalId);

  const after = useSpendFeedStore.getState();
  if (after.pending.length === 0 && after.batchUid !== null) {
    const config = useStore.getState().db.settings.mailSync;
    if (config) {
      store.updateSettings({
        mailSync: { ...config, lastUid: Math.max(config.lastUid ?? 0, after.batchUid) },
      });
    }
    after.clear();
  }
}

/**
 * Poll the mailbox while the app is open.
 *
 * Deliberately also runs once on mount: the app may have been shut for two
 * days, and a feed that only starts counting from launch is a feed with a
 * two-day hole in it.
 */
export function useSpendFeed(): void {
  const config = useStore((s) => s.db.settings.mailSync);
  const ready = useStore((s) => s.ready);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const enabled = mailSyncReady(config);
  const everyMinutes = config?.everyMinutes ?? 15;

  useEffect(() => {
    if (!ready || !enabled) return;

    void syncSpendFeed();
    // A floor of five minutes: a mailbox polled every thirty seconds is a
    // mailbox that gets the account rate-limited, and no bank sends mail that
    // fast anyway.
    const period = Math.max(5, everyMinutes) * 60_000;
    timer.current = setInterval(() => void syncSpendFeed(), period);

    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [ready, enabled, everyMinutes]);
}
