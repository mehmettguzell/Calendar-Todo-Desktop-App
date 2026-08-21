import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { isTauri } from "@/lib/env";

let granted = false;

/**
 * Only a granted permission is remembered.
 *
 * Caching a refusal would freeze the app in a "notifications are off" state for
 * the rest of the session, including after the user goes and turns them back on
 * — which is exactly the moment they expect it to start working.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (granted) return true;

  if (isTauri()) {
    granted = (await isPermissionGranted()) || (await requestPermission()) === "granted";
    return granted;
  }
  if (typeof Notification === "undefined") return false;
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
 * Fire an OS notification, rejecting when it did not get through.
 *
 * Desktop notification *buttons* are not portable across Windows/macOS/Linux in
 * Tauri v2, so the spec's [Complete] [Snooze] [Open] controls live in the
 * in-app reminder card instead. The OS banner is the attention-getter; clicking
 * it raises the window where the three actions are one click away.
 *
 * The desktop path goes through our own `show_notification` command rather than
 * the plugin's `sendNotification`, which returns nothing and swallows whatever
 * the OS said. A silent failure here reads to the user as "the reminder never
 * fired", and there is no way to tell the two apart from inside the app.
 */
export async function notify(payload: DesktopNotification): Promise<void> {
  if (!(await ensureNotificationPermission())) {
    throw new Error("Notifications are turned off for Tempo in your system settings.");
  }

  if (isTauri()) {
    await invoke("show_notification", { title: payload.title, body: payload.body });
    return;
  }

  if (typeof Notification === "undefined") {
    throw new Error("This browser cannot show notifications.");
  }
  const n = new Notification(payload.title, { body: payload.body });
  n.onclick = () => window.focus();
}

/** Raise and focus the app window (the notification's "Open" path). */
export async function focusApp(): Promise<void> {
  if (!isTauri()) {
    window.focus();
    return;
  }
  await invoke("focus_main_window").catch(() => undefined);
}
