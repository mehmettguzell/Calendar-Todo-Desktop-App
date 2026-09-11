import {
  CheckSquare,
  Square,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  parseNoteBody,
} from "@/domain/note";

/**
 * The note as it reads rather than as it is typed. Checkboxes stay live here —
 * ticking one off is the most common thing to do to a note you are not editing
 * — and a click anywhere else drops back into the text.
 */
export function NoteReader({
  body,
  onToggle,
  onEdit,
}: {
  body: string;
  onToggle: (index: number) => void;
  onEdit: () => void;
}) {
  const lines = parseNoteBody(body);

  if (!body.trim()) {
    return (
      <div className="note-read r-empty" onClick={onEdit} role="presentation">
        Nothing here yet.
      </div>
    );
  }

  return (
    <div className="note-read" onClick={onEdit} role="presentation">
      {lines.map((line, i) => {
        if (line.kind === "divider") return <div key={i} className="r-divider" />;
        if (line.kind === "heading")
          return (
            <div key={i} className="r-heading">
              {line.text}
            </div>
          );
        if (line.kind === "todo")
          return (
            <button
              key={i}
              type="button"
              className={cn("r-line r-todo", line.done && "done")}
              aria-pressed={line.done}
              onClick={(e) => {
                e.stopPropagation();
                onToggle(i);
              }}
            >
              <span className="marker">
                {line.done ? <CheckSquare size={14} /> : <Square size={14} />}
              </span>
              <span>{line.text}</span>
            </button>
          );
        if (line.kind === "bullet")
          return (
            <div key={i} className="r-line">
              <span className="marker">•</span>
              <span>{line.text}</span>
            </div>
          );
        if (!line.text.trim()) return <div key={i} className="r-blank" />;
        return (
          <div key={i} className="r-line">
            <span>{line.text}</span>
          </div>
        );
      })}
    </div>
  );
}
