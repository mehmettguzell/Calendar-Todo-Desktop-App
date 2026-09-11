import { useEffect, useState } from "react";
import { AlertTriangle, ArrowUpCircle, Download, X } from "lucide-react";
import type { UpdateVerdict } from "@/domain/updatePolicy";
import { checkForUpdate, installUpdate } from "@/services/updater";
import { useI18n } from "@/lib/i18n";

/**
 * How long after launch the check runs.
 *
 * Not immediately: the first seconds after launch are spent loading the user's
 * data and painting a window, and a release endpoint is never worth competing
 * with that.
 */
const CHECK_DELAY_MS = 8_000;

type Phase =
  | { kind: "idle" }
  | { kind: "installing"; progress: number | null }
  | { kind: "failed" };

/**
 * Tells the user a new version exists, and — when a release says the running
 * one is finished — stands in front of the app until it is installed.
 *
 * Two shapes for a reason. The app keeps a full local copy of its data and
 * works with no network at all, so blocking it is a real cost to the user;
 * that cost is only worth paying when a release has actually declared the
 * running version unsupported. Everything else is an offer that can be waved
 * away, and nothing at all is shown when there is no update.
 */
export function UpdateGate() {
  const { t } = useI18n();
  const [verdict, setVerdict] = useState<UpdateVerdict>({ status: "none" });
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(async () => {
      const result = await checkForUpdate();
      if (!cancelled && result) setVerdict(result.verdict);
    }, CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, []);

  const install = async () => {
    setPhase({ kind: "installing", progress: null });
    try {
      await installUpdate((progress) => setPhase({ kind: "installing", progress }));
    } catch {
      // The app is still perfectly usable on the old version, so a failed
      // download is reported where it happened rather than thrown at the user
      // as an error screen.
      setPhase({ kind: "failed" });
    }
  };

  if (verdict.status === "none") return null;

  const busy = phase.kind === "installing";
  const actionLabel = busy
    ? phase.progress === null
      ? t("updateWorking")
      : t("updateDownloading", { percent: Math.round(phase.progress * 100) })
    : phase.kind === "failed"
      ? t("updateRetry")
      : t("updateInstall");

  const action = (
    <button type="button" className="btn primary" disabled={busy} onClick={install}>
      <Download size={14} /> {actionLabel}
    </button>
  );

  if (verdict.status === "required") {
    return (
      // No close button, no Escape, no backdrop click: this is the one dialog
      // in the app that is not a question.
      <div className="backdrop update-gate" role="presentation">
        <div className="modal" style={{ maxWidth: 420 }} role="alertdialog" aria-modal="true">
          <div className="modal-head">
            <h2>
              <AlertTriangle size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />
              {t("updateRequiredTitle")}
            </h2>
          </div>
          <div className="modal-body">
            <p style={{ margin: 0 }}>
              {t("updateRequiredBody", { version: verdict.version, minimum: verdict.minimum })}
            </p>
            {phase.kind === "failed" ? (
              <p className="faint" style={{ margin: 0 }}>
                {t("updateFailed")}
              </p>
            ) : null}
          </div>
          <div className="modal-foot">{action}</div>
        </div>
      </div>
    );
  }

  if (dismissed) return null;

  return (
    <div className="update-toast" role="status">
      <ArrowUpCircle size={16} className="update-toast-icon" aria-hidden />
      <div className="col" style={{ gap: 2, minWidth: 0 }}>
        <strong style={{ fontSize: "var(--text-sm)" }}>{t("updateAvailableTitle")}</strong>
        <span className="faint" style={{ fontSize: "var(--text-xs)" }}>
          {phase.kind === "failed"
            ? t("updateFailed")
            : t("updateAvailableBody", { version: verdict.version })}
        </span>
      </div>
      {action}
      <button
        type="button"
        className="btn ghost icon"
        aria-label={t("updateLater")}
        title={t("updateLater")}
        disabled={busy}
        onClick={() => setDismissed(true)}
      >
        <X size={14} />
      </button>
    </div>
  );
}
