import { CheckSquare, Pin, Square } from "lucide-react";
import { localeTag } from "@/domain/datetime";
import {
  isPinned,
  noteColor,
  noteFallbackTitle,
  noteLabels,
  parseNoteBody,
} from "@/domain/note";
import type { Task } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { usePickGesture } from "@/ui/task/usePickGesture";

export function NoteCard({
  note,
  selected,
  wallIds,
  onOpen,
  onTogglePin,
}: {
  note: Task;
  selected: boolean;
  /** The cards drawn beside this one, in order. See `Wall`. */
  wallIds: string[];
  onOpen: () => void;
  onTogglePin: () => void;
}) {
  const { t } = useI18n();
  /*
   * A note is a task with a tag on it, so it is picked like one.
   *
   * The bulk bar was already global and already knew what to do with these —
   * "delete these four" is the thing anybody wants from a wall of notes — and
   * the only reason it could not reach them is that a card had no way to be
   * picked. It behaves exactly as a row does: invisible until the mode is on
   * or a modifier is held, and then a checkbox in the corner.
   */
  const pick = usePickGesture({ taskId: note.id, listIds: wallIds });
  const { title, untitled, preview } = noteFacts(note, t("notesEmptyNote"));

  return (
    <div
      className={cn(
        "note-paper note-card",
        selected && "selected",
        pick.picking && "picking",
        pick.picked && "picked",
      )}
      data-color={noteColor(note)}
      role="button"
      tabIndex={0}
      onClick={(e) => {
        if (pick.onClickCapture(e)) return;
        onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onOpen();
      }}
    >
      {pick.picking ? <NotePickBox note={note} pick={pick} /> : null}

      <NotePin note={note} onToggle={onTogglePin} />

      <div className={cn("note-title", untitled && "untitled")}>{title}</div>

      {preview.trim() ? <NotePreview body={preview} /> : null}

      <NoteFoot note={note} />
    </div>
  );
}

/** What the card shows for a note the user never gave a heading. */
function noteFacts(note: Task, emptyLabel: string) {
  const named = note.title.trim().length > 0;
  if (named) {
    return { title: note.title.trim(), untitled: false, preview: note.description };
  }
  const untitled = !note.description.trim();
  return {
    title: untitled ? emptyLabel : noteFallbackTitle(note),
    untitled,
    // An untitled note borrows its first line as a heading; showing that line
    // again in the preview would just print it twice.
    preview: dropFirstLine(note.description),
  };
}

function NotePickBox({
  note,
  pick,
}: {
  note: Task;
  pick: ReturnType<typeof usePickGesture>;
}) {
  const { t } = useI18n();

  return (
    <label className="note-pick" onClick={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        checked={pick.picked}
        aria-label={t("bulkSelectAria", { title: note.title })}
        onChange={() => pick.toggle()}
        onClick={(e) => {
          if (!e.shiftKey) return;
          e.preventDefault();
          pick.toggle(true);
        }}
      />
    </label>
  );
}

function NotePin({ note, onToggle }: { note: Task; onToggle: () => void }) {
  const { t } = useI18n();
  const pinned = isPinned(note);

  return (
    <button
      type="button"
      className={cn("note-pin", pinned && "on")}
      title={pinned ? t("notesUnpin") : t("notesPin")}
      aria-pressed={pinned}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <Pin size={13} fill={pinned ? "currentColor" : "none"} />
    </button>
  );
}

/** The labels it carries and when it last moved. */
function NoteFoot({ note }: { note: Task }) {
  const labels = noteLabels(note);

  return (
    <div className="note-foot">
      {labels.length > 0 ? (
        <div className="note-tags">
          {labels.slice(0, 3).map((label) => (
            <span key={label} className="note-tag">
              {label}
            </span>
          ))}
          {labels.length > 3 ? (
            <span className="note-tag">+{labels.length - 3}</span>
          ) : null}
        </div>
      ) : null}
      <span className="grow" />
      <span>{relativeDay(note.updatedAt)}</span>
    </div>
  );
}

/** Renders the first slice of a note body with its structure intact. */
function NotePreview({ body }: { body: string }) {
  return (
    <div className="note-preview">
      {parseNoteBody(body)
        .slice(0, 14)
        .map((line, i) => (
          <PreviewLine key={i} line={line} />
        ))}
    </div>
  );
}

function PreviewLine({ line }: { line: ReturnType<typeof parseNoteBody>[number] }) {
  if (line.kind === "divider") return <div className="l-divider" />;
  if (line.kind === "heading")
    return <div className="l-text l-heading">{line.text}</div>;
  if (line.kind === "todo")
    return (
      <div className={cn("l-item", line.done && "done")}>
        <span className="marker" style={{ paddingTop: 2 }}>
          {line.done ? <CheckSquare size={11} /> : <Square size={11} />}
        </span>
        <span>{line.text}</span>
      </div>
    );
  if (line.kind === "bullet")
    return (
      <div className="l-item">
        <span className="marker">•</span>
        <span>{line.text}</span>
      </div>
    );
  if (!line.text.trim()) return <div className="l-blank" />;
  return <div className="l-text">{line.text}</div>;
}

function dropFirstLine(body: string): string {
  const lines = body.split("\n");
  const first = lines.findIndex((l) => l.trim().length > 0);
  return first === -1 ? body : lines.slice(first + 1).join("\n");
}

function relativeDay(instant: string): string {
  const then = new Date(instant);
  const minutes = Math.round((Date.now() - then.getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString(localeTag(), { month: "short", day: "numeric" });
}
