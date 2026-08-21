import { useState } from "react";
import { describeWhen } from "@/domain/datetime";
import type { ActiveAlert } from "@/services/scheduler";
import { focusApp } from "@/services/notifications";
import { useNow, useStore } from "@/state/store";
import { SnoozeMenu } from "@/ui/task/SnoozeMenu";

/**
 * The in-app half of a reminder (spec section 7).
 *
 * The OS banner grabs attention; this card carries the three actions the spec
 * asks for, because notification buttons are not portable across desktop
 * platforms in Tauri v2.
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
    <div className="alerts">
      {alerts.map((alert) => (
        <AlertCard key={alert.id} alert={alert} onDismiss={onDismiss} onOpen={onOpen} />
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
  const now = useNow();
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const { instance } = alert;

  return (
    <div className="alert-card" role="alert">
      <div className="alert-title truncate">{instance.task.title}</div>
      <div className="alert-when">
        {describeWhen(
          instance.date,
          instance.task.allDay ? null : instance.task.startTime,
          now,
        )}
      </div>

      <div className="alert-actions" style={{ position: "relative" }}>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            toggleComplete(instance);
            onDismiss(alert.id);
          }}
        >
          Complete
        </button>
        <button type="button" className="btn" onClick={() => setSnoozeOpen((v) => !v)}>
          Snooze
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            void focusApp();
            onOpen(instance.task.id, instance.date);
            onDismiss(alert.id);
          }}
        >
          Open
        </button>

        {snoozeOpen ? (
          <div style={{ position: "absolute", bottom: "100%", right: 0, marginBottom: 6 }}>
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
