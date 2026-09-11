import { useEffect } from "react";
import { toLocalDate } from "@/domain/datetime";
import { spendNudgeDue } from "@/domain/spendLog";
import type { LocalDate, Settings } from "@/domain/types";
import { useAuthStore } from "@/state/authStore";
import { useStore } from "@/state/store";
import { wireSyncPorts } from "@/state/syncWiring";
import { initSyncEngine } from "@/sync";
import {
  ensureNotificationPermission,
  notify,
} from "@/services/notifications";
import {
  onDesktopEvent,
  QUICK_CAPTURE_EVENT,
  QUICK_SPEND_EVENT,
} from "@/services/desktop";
import type { TranslationKey } from "@/lib/i18n";

/**
 * Everything the shell has to arrange with the world outside React.
 *
 * Kept out of `App` because none of it renders: it is start-up order, host
 * events and one nudge, and reading the component's tree should not mean
 * reading past them.
 */

export function useBootstrap(): void {
  const hydrate = useStore((s) => s.hydrate);
  const ready = useStore((s) => s.ready);

  useEffect(() => {
    // Order matters: the local document is opened first, so the sync engine
    // never has to decide what to do with a store that is still empty — and an
    // account switch it triggers has something concrete to switch away from.
    void (async () => {
      try {
        await hydrate();
        wireSyncPorts();
        initSyncEngine();
        await useAuthStore.getState().initAuth();
      } catch (err) {
        console.error("[tempo] init failed:", err);
      }
    })();
  }, [hydrate]);

  useEffect(() => {
    if (ready) void ensureNotificationPermission();
  }, [ready]);
}

/** Subscribe to one host event for the life of the component. */
function useDesktopEvent(event: string, handle: () => void): void {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void onDesktopEvent(event, handle).then((off) => {
      if (cancelled) off();
      else unlisten = off;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
    // The handler is read through a fresh closure on every event, so it is not
    // a dependency; re-subscribing on each render would drop events.
  }, [event]);
}

/**
 * The two tray doors: "Hızlı ekle" and "Harcama ekle".
 *
 * Separate on purpose — the two are reached at different moments, and neither
 * should cost a detour through the other. `Ctrl+Shift+Space` lands on the first;
 * the window has already been raised by the host by the time it fires.
 */
export function useDesktopTriggers(handlers: {
  onQuickAdd: (date: LocalDate) => void;
  onQuickSpend: () => void;
}): void {
  useDesktopEvent(QUICK_CAPTURE_EVENT, () =>
    handlers.onQuickAdd(toLocalDate(new Date())),
  );
  useDesktopEvent(QUICK_SPEND_EVENT, handlers.onQuickSpend);
}

/**
 * The evening prompt.
 *
 * Driven by `now`, which the scheduler already advances once a minute, so this
 * needs no clock of its own. The day is marked as soon as the prompt is raised
 * rather than when it is answered: a question asked and ignored has still been
 * asked, and asking it twice is how a nudge gets switched off.
 */
export function useEveningPrompt(input: {
  ready: boolean;
  now: Date;
  settings: Settings;
  alreadyOpen: boolean;
  onOpen: () => void;
  t: (key: TranslationKey) => string;
}): void {
  const { ready, now, settings, alreadyOpen, onOpen, t } = input;

  useEffect(() => {
    if (!ready || alreadyOpen) return;
    if (!spendNudgeDue(settings, new Date(now))) return;

    onOpen();
    useStore.getState().markSpendNudged(toLocalDate(new Date(now)));
    void notify({
      title: t("spendNudgeNotifyTitle"),
      body: t("spendNudgeNotifyBody"),
    }).catch(() => undefined);
    // `onOpen` is a fresh closure each render and would re-run this every time.
  }, [ready, now, settings, alreadyOpen, t]);
}
