import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CheckSquare,
  Eye,
  ListChecks,
  Minus,
  Pencil,
  Pin,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import type { TaskInstance } from "@/domain/types";
import { useStore } from "@/state/store";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import {
  NOTE_COLORS,
  NOTE_TAG,
  isPinned,
  noteColor,
  noteLabels,
  toggleBodyTodo,
  wordCount,
  withNoteColor,
  withNoteLabels,
  withPinned,
  type NoteColor,
} from "@/domain/note";
import { LabelEditor } from "./LabelEditor";
import { NoteReader } from "./NoteReader";

/**
 * Idle time before a body edit is written to the store. Each write appends a
 * history entry, so this is long enough that a normal typing burst saves once
 * rather than a dozen times, and short enough that nothing is lost on a crash.
 */
const AUTOSAVE_MS = 2000;

export function NotePanel({
  instance,
  closing,
  onClose,
}: {
  instance: TaskInstance;
  /** Rendering only so it can animate out; see `usePresence`. */
  closing?: boolean;
  onClose: () => void;
}) {
  const { task } = instance;
  const { t } = useI18n();
  const updateTask = useStore((s) => s.updateTask);
  const deleteTask = useStore((s) => s.deleteTask);

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [reading, setReading] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const color = noteColor(task);
  const pinned = isPinned(task);
  const labels = noteLabels(task);

  // Switching notes re-seeds the drafts; edits made elsewhere land here too.
  useLayoutEffect(() => {
    setTitle(task.title);
    setDescription(task.description);
  }, [task.id, task.title, task.description]);

  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  useLayoutEffect(() => {
    if (!task.title && !task.description) {
      // A note with nothing in it has nothing to read back.
      setReading(false);
      setTimeout(() => titleRef.current?.focus(), 50);
    }
  }, [task.id]);

  /**
   * A note is written as it is typed, not on blur: closing the panel with a
   * click elsewhere used to be the only way to save, which loses work if the
   * app is quit mid-thought.
   */
  useEffect(() => {
    if (description === task.description) return;
    const handle = setTimeout(
      () => updateTask(task.id, { description }),
      AUTOSAVE_MS,
    );
    return () => clearTimeout(handle);
  }, [description, task.id, task.description, updateTask]);

  /*
   * Whatever the timer above had not written yet, written on the way out.
   *
   * Its cleanup cancels the pending save, which is right between keystrokes and
   * wrong on the last one: closing the panel within the autosave window — Escape,
   * or opening another note — would drop the words typed since the last tick.
   * The ref is what lets an unmount effect see the latest text without
   * re-running, and so without saving on every character.
   */
  const latest = useRef({ description, id: task.id, stored: task.description });
  latest.current = { description, id: task.id, stored: task.description };
  useEffect(
    () => () => {
      const { description: text, id, stored } = latest.current;
      if (text !== stored) updateTask(id, { description: text });
    },
    [updateTask],
  );

  const commitTitle = () => {
    const trimmed = title.trim();
    if (trimmed !== task.title) updateTask(task.id, { title: trimmed });
  };

  const setColor = (next: NoteColor) =>
    updateTask(task.id, { tags: withNoteColor(task.tags, next) });

  const setLabels = (next: string[]) =>
    updateTask(task.id, { tags: withNoteLabels(task.tags, next) });

  /** Inserts a prefix at the start of the line the caret sits on. */
  const prefixLine = (prefix: string) => {
    const el = bodyRef.current;
    if (!el) return;
    const caret = el.selectionStart;
    const start = description.lastIndexOf("\n", caret - 1) + 1;
    const next =
      description.slice(0, start) + prefix + description.slice(start);
    setDescription(next);
    requestAnimationFrame(() => {
      el.focus();
      const at = caret + prefix.length;
      el.setSelectionRange(at, at);
    });
  };

  /** Enter inside a checklist or bullet continues the list. */
  const continueList = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    const el = e.currentTarget;
    const caret = el.selectionStart;
    const lineStart = description.lastIndexOf("\n", caret - 1) + 1;
    const line = description.slice(lineStart, caret);
    const match = /^(\s*(?:[-*]\s\[[ xX]\]|[-*])\s)(.*)$/.exec(line);
    if (!match) return;

    e.preventDefault();
    const marker = match[1] ?? "";
    const content = (match[2] ?? "").trim();
    // An empty list item ends the list rather than making another one.
    const insert = content ? `\n${marker.replace(/\[[xX]\]/, "[ ]")}` : "\n";
    const head = content
      ? description.slice(0, caret)
      : description.slice(0, lineStart);
    const next = head + insert + description.slice(caret);
    setDescription(next);
    const at = head.length + insert.length;
    requestAnimationFrame(() => el.setSelectionRange(at, at));
  };

  const words = wordCount(`${title} ${description}`);

  return (
    <aside
      className={cn("panel note-paper", closing && "is-closing")}
      data-color={color}
      inert={closing}
    >
      <div className="note-panel-head">
        <div className="swatches">
          {NOTE_COLORS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={cn(
                "note-paper swatch",
                option.id === color && "on",
              )}
              data-color={option.id}
              style={{ background: "var(--note-bg)", borderColor: "var(--note-edge)" }}
              title={option.label}
              aria-label={`${option.label} paper`}
              aria-pressed={option.id === color}
              onClick={() => setColor(option.id)}
            />
          ))}
        </div>

        <span className="grow" />

        <button
          type="button"
          className={cn("btn ghost icon", pinned && "primary")}
          title={pinned ? t("notesUnpin") : t("notesPin")}
          aria-pressed={pinned}
          onClick={() => updateTask(task.id, { tags: withPinned(task.tags, !pinned) })}
        >
          <Pin size={15} fill={pinned ? "currentColor" : "none"} />
        </button>
        <button
          type="button"
          className="btn ghost icon"
          title={t("notesToTask")}
          onClick={() => {
            updateTask(task.id, {
              tags: task.tags.filter(
                (t) => t !== NOTE_TAG && !t.startsWith("note:"),
              ),
              title: title.trim() || t("notesUntitled"),
            });
            onClose();
          }}
        >
          <ListChecks size={15} />
        </button>
        <button
          type="button"
          className="btn ghost icon danger"
          title={t("notesDelete")}
          onClick={() => {
            if (confirm(t("notesDeleteConfirm"))) {
              deleteTask(task.id);
              onClose();
            }
          }}
        >
          <Trash2 size={15} />
        </button>
        <button
          type="button"
          className="btn ghost icon"
          onClick={onClose}
          aria-label={t("closePanel")}
        >
          <X size={15} />
        </button>
      </div>

      <div
        className="panel-body scroll"
        style={{ display: "flex", flexDirection: "column", gap: 10 }}
      >
        <textarea
          ref={titleRef}
          className="panel-title-input"
          style={{ fontSize: "var(--text-2xl)", fontWeight: 700, padding: "12px 16px 0" }}
          rows={1}
          value={title}
          placeholder={t("notesTitlePlaceholder")}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitTitle();
              bodyRef.current?.focus();
            }
          }}
        />

        <div className="note-tools">
          <button
            type="button"
            className="btn ghost icon"
            title={t("notesChecklistItem")}
            disabled={reading}
            onClick={() => prefixLine("- [ ] ")}
          >
            <CheckSquare size={14} />
          </button>
          <button
            type="button"
            className="btn ghost icon"
            title={t("notesBullet")}
            disabled={reading}
            onClick={() => prefixLine("- ")}
          >
            <Minus size={14} />
          </button>
          <button
            type="button"
            className="btn ghost icon"
            title={t("notesHeading")}
            disabled={reading}
            onClick={() => prefixLine("# ")}
          >
            <span style={{ fontSize: "var(--text-sm)", fontWeight: 700 }}>H</span>
          </button>
          <span className="grow" />
          <button
            type="button"
            className="btn ghost icon"
            title={reading ? t("notesEdit") : t("notesRead")}
            aria-pressed={reading}
            onClick={() => setReading(!reading)}
          >
            {reading ? <Pencil size={14} /> : <Eye size={14} />}
          </button>
        </div>

        {reading ? (
          <NoteReader
            body={description}
            onToggle={(index) => {
              const next = toggleBodyTodo(description, index);
              setDescription(next);
              updateTask(task.id, { description: next });
            }}
            onEdit={() => setReading(false)}
          />
        ) : (
          <textarea
            ref={bodyRef}
            className="note-editor"
            value={description}
            placeholder={t("notesBodyPlaceholder")}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={continueList}
            onBlur={() => {
              if (description !== task.description) {
                updateTask(task.id, { description });
              }
            }}
          />
        )}
      </div>

      <div className="note-foot-bar">
        <Tag size={12} />
        <LabelEditor labels={labels} onChange={setLabels} />
        <span className="mono" style={{ flex: "none" }}>
          {words} {words === 1 ? "word" : "words"}
        </span>
      </div>
    </aside>
  );
}
