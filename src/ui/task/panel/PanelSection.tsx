import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

export function PanelSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  /** What this section holds, read at a glance while it is shut. */
  summary?: string | null;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={cn("card", "panel-section", open && "is-open")}>
      <button
        type="button"
        className="panel-section-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight size={13} className="panel-section-caret" aria-hidden />
        <span className="panel-section-title">{title}</span>
        {!open && summary ? (
          <span className="panel-section-summary">{summary}</span>
        ) : null}
      </button>
      {open ? <div className="panel-section-body">{children}</div> : null}
    </div>
  );
}
