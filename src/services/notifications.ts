import { invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { isTauri } from "@/lib/env";

let granted: boolean | null = null;

export async function ensureNotificationPermission(): Promise<boolean> {
  if (granted !== null) return granted;

  if (isTauri()) {
    granted = (await isPermissionGranted()) || (await requestPermission()) === "granted";
    return granted;
  }
  if (typeof Notification === "undefined") {
    granted = false;
    return granted;
  }
  granted =
    Notification.permission === "granted" ||
    (await Notification.requestPermission()) === "granted";
  return granted;
}

export interface DesktopNotification {
  title: string;
  body: string;
}

/**
 * Fire an OS notification.
 *
 * Desktop notification *buttons* are not portable across Windows/macOS/Linux in
 * Tauri v2, so the spec's [Complete] [Snooze] [Open] controls live in the
 * in-app reminder card instead. The OS banner is the attention-getter; clicking
 * it raises the window where the three actions are one click away.
 */
export async function notify(payload: DesktopNotification): Promise<void> {
  const allowed = await ensureNotificationPermission();
  if (!allowed) return;

  if (isTauri()) {
    sendNotification({ title: payload.title, body: payload.body });
    return;
  }
  if (typeof Notification !== "undefined") {
    const n = new Notification(payload.title, { body: payload.body });
    n.onclick = () => window.focus();
  }
}

/** Raise and focus the app window (the notification's "Open" path). */
export async function focusApp(): Promise<void> {
  if (!isTauri()) {
    window.focus();
    return;
  }
  await invoke("focus_main_window").catch(() => undefined);
}
