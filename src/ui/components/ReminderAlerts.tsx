import { useState } from "react";
import { AlarmClock, Check, Clock, ExternalLink, X } from "lucide-react";
import { reminderNotification } from "@/domain/notification";
import type { ActiveAlert } from "@/services/scheduler";
import { focusApp } from "@/services/notifications";
import { useCategoryIndex } from "@/state/selectors";
import { useNow, useStore } from "@/state/store";
import { SnoozeMenu } from "@/ui/task/SnoozeMenu";
import { cn } from "@/lib/cn";

/**
 * The in-app half of a reminder (spec section 7).
 *
 * The OS banner grabs attention; this card carries the three actions the spec
 * asks for, because notification buttons are not portable across desktop
 * platforms in Tauri v2. The two say the same thing, from the same builder, so
 * the toast and the card can never disagree about what is due.
 */
export function ReminderAlerts({
  alerts,
  onDismiss,
  onOpen,
}: {
  alerts: ActiveAlert[];
  onDismiss: (id: string) => void;
  onOpen: (taskId: string, occurrenceDate: string | null) => void;
}) {
  if (alerts.length === 0) return null;
  return (
    <div className="alerts" aria-live="polite">
      {alerts.map((alert) => (
        <AlertCard
          key={alert.id}
          alert={alert}
          onDismiss={onDismiss}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

function AlertCard({
  alert,
  onDismiss,
  onOpen,
}: {
  alert: ActiveAlert;
  onDismiss: (id: string) => void;
  onOpen: (taskId: string, occurrenceDate: string | null) => void;
}) {
  const toggleComplete = useStore((s) => s.toggleComplete);
  const categories = useCategoryIndex();
  const now = useNow();
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const { instance } = alert;
  const category = instance.task.categoryId
    ? (categories.get(instance.task.categoryId) ?? null)
    : null;
  const payload = reminderNotification(instance, now, category);
  const overdue = instance.status === "OVERDUE";

  return (
    <div
      className={cn("alert-card", overdue && "overdue")}
      role="alert"
      style={
        category ? ({ "--alert-accent": category.color } as React.CSSProperties) : undefined
      }
    >
      <span className="alert-stripe" aria-hidden />

      <div className="alert-head">
        <span className={cn("alert-icon", overdue && "overdue")} aria-hidden>
          <AlarmClock size={15} />
        </span>
        <div className="alert-text">
          <div className="alert-title truncate">{payload.title}</div>
          <div className="alert-when truncate">{payload.body}</div>
        </div>
        <button
          type="button"
          className="btn ghost icon sm alert-close"
          aria-label="Dismiss"
          onClick={() => onDismiss(alert.id)}
        >
          <X size={14} />
        </button>
      </div>

      <div className="alert-actions" style={{ position: "relative" }}>
        <button
          type="button"
          className="btn primary sm"
          onClick={() => {
            toggleComplete(instance);
            onDismiss(alert.id);
          }}
        >
          <Check size={13} /> Complete
        </button>
        <button
          type="button"
          className="btn sm"
          onClick={() => setSnoozeOpen((v) => !v)}
        >
          <Clock size={13} /> Snooze
        </button>
        <button
          type="button"
          className="btn sm"
          onClick={() => {
            void focusApp();
            onOpen(instance.task.id, instance.date);
            onDismiss(alert.id);
          }}
        >
          <ExternalLink size={13} /> Open
        </button>

        {snoozeOpen ? (
          <div
            style={{
              position: "absolute",
              bottom: "100%",
              right: 0,
              marginBottom: 6,
            }}
          >
            <SnoozeMenu
              instance={instance}
              align="right"
              onClose={() => {
                setSnoozeOpen(false);
                onDismiss(alert.id);
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
