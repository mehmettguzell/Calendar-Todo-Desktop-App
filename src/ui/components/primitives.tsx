import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import type { TaskStatus } from "@/domain/types";

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint ? <span className="faint" style={{ fontSize: 11 }}>{hint}</span> : null}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" />
      <span>{label}</span>
    </label>
  );
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  const { t } = useI18n();
  return (
    <span className={cn("badge", status.toLowerCase())}>
      {t(`status${status}` as TranslationKey)}
    </span>
  );
}

export function Checkbox({
  done,
  onToggle,
  square,
  title,
}: {
  done: boolean;
  onToggle: () => void;
  square?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={cn("check", done && "done", square && "square")}
      aria-pressed={done}
      title={title ?? (done ? "Mark as not done" : "Mark as done")}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <Check size={12} strokeWidth={3} />
    </button>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const { t } = useI18n();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="backdrop" onMouseDown={onClose} role="presentation">
      <div
        className="modal"
        style={width ? { maxWidth: width } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn ghost icon" onClick={onClose} aria-label={t("close")}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

/** Anchored menu that closes on outside click or Escape. */
export function Popover({
  onClose,
  children,
  align = "left",
}: {
  onClose: () => void;
  children: ReactNode;
  align?: "left" | "right";
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Defer so the click that opened the popover does not immediately close it.
    const handle = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(handle);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="popover"
      role="menu"
      style={align === "right" ? { right: 0 } : { left: 0 }}
    >
      {children}
    </div>
  );
}

/**
 * A destructive button that asks once before it acts.
 *
 * The confirmation replaces the button in place rather than opening a dialog,
 * so it works the same inside a modal as it does in a section header. It
 * disarms itself after a few seconds: an armed Delete left sitting on screen is
 * a trap for the next click.
 */
export function ConfirmButton({
  label,
  confirm,
  onConfirm,
  icon,
  disabled,
  title,
}: {
  label: string;
  confirm: string;
  onConfirm: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const handle = setTimeout(() => setArmed(false), 6000);
    return () => clearTimeout(handle);
  }, [armed]);

  if (!armed) {
    return (
      <button
        type="button"
        className="btn sm danger"
        disabled={disabled}
        title={title}
        onClick={() => setArmed(true)}
      >
        {icon}
        {label}
      </button>
    );
  }

  return (
    <span className="row" style={{ gap: 6 }}>
      <button
        type="button"
        className="btn sm danger"
        autoFocus
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {confirm}
      </button>
      <button type="button" className="btn sm" onClick={() => setArmed(false)}>
        Cancel
      </button>
    </span>
  );
}

export function Empty({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="empty">
      {icon}
      <div style={{ fontWeight: 600, color: "var(--text-muted)" }}>{title}</div>
      {hint ? <div style={{ fontSize: 12.5 }}>{hint}</div> : null}
    </div>
  );
}
