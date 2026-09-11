import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { isTauri } from "@/lib/env";
import { evaluateUpdate, type UpdateVerdict } from "@/domain/updatePolicy";

/**
 * The bridge between the update endpoint and the rest of the app.
 *
 * Everything that decides anything lives in `domain/updatePolicy`; what is
 * here is the part that can only run inside the desktop shell — asking the
 * endpoint, writing the bundle, restarting.
 */

/** The pending update, held so installing does not have to ask a second time. */
let pending: Update | null = null;

export interface UpdateCheck {
  verdict: UpdateVerdict;
  /** The version that is running, for the "you are up to date" case. */
  currentVersion: string;
}

/**
 * Ask whether a newer release exists.
 *
 * Never throws: an update check runs on its own at launch, and a machine that
 * is offline, behind a proxy, or looking at a release that has not finished
 * publishing must not turn that into an error the user has to deal with.
 */
export async function checkForUpdate(): Promise<UpdateCheck | null> {
  if (!isTauri()) return null;
  try {
    const currentVersion = await getVersion();
    const update = await check();
    pending = update;
    return {
      currentVersion,
      verdict: evaluateUpdate(
        currentVersion,
        update ? { version: update.version, notes: update.body ?? "" } : null,
      ),
    };
  } catch {
    return null;
  }
}

/**
 * Download and install the update found by the last check, then restart.
 *
 * `onProgress` receives 0-1, or `null` while the total size is still unknown —
 * some servers answer without a content length, and a progress bar that
 * invents a number is worse than one that admits it cannot say.
 */
export async function installUpdate(
  onProgress?: (fraction: number | null) => void,
): Promise<void> {
  if (!pending) throw new Error("No update has been found to install");

  let total = 0;
  let downloaded = 0;

  await pending.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? 0;
        onProgress?.(total > 0 ? 0 : null);
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.(total > 0 ? Math.min(downloaded / total, 1) : null);
        break;
      case "Finished":
        onProgress?.(1);
        break;
    }
  });

  // On Windows the installer replaces the running executable and restarts the
  // app itself, so this line is never reached there. It is what restarts macOS
  // and Linux, where the bundle is swapped in place under a still-live process.
  await relaunch();
}
