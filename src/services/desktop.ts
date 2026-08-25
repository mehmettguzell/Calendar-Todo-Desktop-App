import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isTauri } from "@/lib/env";

/**
 * The parts of the app that only exist because it is a desktop app.
 *
 * Closing the window hides it instead of quitting, so reminders keep arriving
 * after the user has put the app away — which is the whole point of a reminder,
 * and the one thing a browser tab cannot do.
 */

/** Fired by the tray menu and by the global shortcut. */
export const QUICK_CAPTURE_EVENT = "tempo://quick-capture";

/**
 * The same idea for money, fired by the tray's "Harcama ekle".
 *
 * A separate event rather than a mode on the task one: a purchase is logged
 * standing at a till, and a capture box that first asks whether this is a task
 * or a spend has already cost more than the entry is worth.
 */
export const QUICK_SPEND_EVENT = "tempo://quick-spend";

/**
 * Fired by a native thread every 30 seconds.
 *
 * WebView2 throttles timers in a hidden window, which would stretch the
 * reminder check out to a minute or more at exactly the moment it matters. The
 * beat comes from the host process, which is not throttled.
 */
export const HEARTBEAT_EVENT = "tempo://heartbeat";

/** The system-wide shortcut, for display in Settings. */
export const QUICK_CAPTURE_SHORTCUT = "Ctrl + Shift + Space";

/** Subscribe to a desktop event; a no-op outside the Tauri shell. */
export async function onDesktopEvent(
  event: string,
  handler: () => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined;
  return listen(event, () => handler());
}

/** Really quit, rather than hiding to the tray. */
export async function quitApp(): Promise<void> {
  if (!isTauri()) return;
  await invoke("quit_app");
}

export async function isAutostartEnabled(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("autostart_enabled").catch(() => false);
}

/**
 * Turn "start with Windows" on or off.
 *
 * Returns what it actually became, not what was asked for: the registry write
 * can fail on a locked-down machine, and a switch that flips in the UI while
 * nothing changed on disk is worse than one that refuses to move.
 */
export async function setAutostart(enabled: boolean): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("set_autostart", { enabled });
}
