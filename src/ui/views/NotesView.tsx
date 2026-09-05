import { useMemo, useState } from "react";
import { localeTag } from "@/domain/datetime";
import {
  CheckSquare,
  Lightbulb,
  Pin,
  Search,
  Square,
  StickyNote,
  Plus,
} from "lucide-react";
import type { Task, TaskInstance } from "@/domain/types";
import { useStore, useNow } from "@/state/store";
import { useLiveTasks } from "@/state/selectors";
import { EmptyArt } from "@/ui/components/EmptyArt";
import { Empty } from "@/ui/components/primitives";
import { PageHeader } from "@/ui/components/PageHeader";
import { toInstance } from "@/domain/task";
import {
  NOTE_TAG,
  isPinned,
  noteColor,
  noteFallbackTitle,
  noteLabels,
  parseNoteBody,
  withPinned,
} from "@/domain/note";
import { cn } from "@/lib/cn";
import { useI18n, type TranslationKey } from "@/lib/i18n";

type SortId = "updated" | "created" | "title";

const SORTS: { id: SortId; labelKey: TranslationKey }[] = [
  { id: "updated", labelKey: "notesSortUpdated" },
  { id: "created", labelKey: "notesSortCreated" },
  { id: "title", labelKey: "notesSortTitle" },
];

/** Blank plus two shapes people actually reach for. */
const STARTERS = [
  { id: "blank", labelKey: "notesStarterBlank", icon: StickyNote, body: "" },
  {
    id: "checklist",
    labelKey: "notesStarterChecklist",
    icon: CheckSquare,
    body: "- [ ] \n- [ ] \n- [ ] ",
  },
  {
    id: "idea",
    labelKey: "notesStarterIdea",
    icon: Lightbulb,
    body: "# The idea\n\n\n# Why it matters\n\n\n# Next step\n- [ ] ",
  },
];

export function NotesView({
  selectedKey,
  onOpen,
}: {
  selectedKey: string | null;
  onOpen: (instance: TaskInstance) => void;
}) {
  const tasks = useLiveTasks();
  const { t } = useI18n();
  const createTask = useStore((s) => s.createTask);
  const updateTask = useStore((s) => s.updateTask);
  const now = useNow();

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortId>("updated");
  const [label, setLabel] = useState<string | null>(null);

  const notes = useMemo(
    () => tasks.filter((t) => t.tags.includes(NOTE_TAG)),
    [tasks],
  );

  const labels = useMemo(() => {
    const set = new Set<string>();
    for (const note of notes) for (const l of noteLabels(note)) set.add(l);
    return [...set].sort();
  }, [notes]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = notes.filter((note) => {
      if (label && !noteLabels(note).includes(label)) return false;
      if (!needle) return true;
      return (
        note.title.toLowerCase().includes(needle) ||
        note.description.toLowerCase().includes(needle) ||
        noteLabels(note).some((l) => l.toLowerCase().includes(needle))
      );
    });

    const compare = (a: Task, b: Task) => {
      if (sort === "title") {
        return noteFallbackTitle(a).localeCompare(noteFallbackTitle(b));
      }
      const key = sort === "created" ? "createdAt" : "updatedAt";
      return b[key].localeCompare(a[key]);
    };

    // Pinned notes lead, each group sorted the same way inside itself.
    return [...matches].sort((a, b) => {
      const pin = Number(isPinned(b)) - Number(isPinned(a));
      return pin !== 0 ? pin : compare(a, b);
    });
  }, [notes, query, label, sort]);

  const pinnedCount = visible.filter(isPinned).length;

  const add = (body: string) => {
    const task = createTask({
      title: "",
      description: body,
      tags: [NOTE_TAG],
      dueDate: null,
      allDay: true,
    });
    // Let the store flush before the panel reads the new task back.
    setTimeout(() => onOpen(toInstance(task, null, null, now)), 0);
  };

  const togglePin = (note: Task) =>
    updateTask(note.id, { tags: withPinned(note.tags, !isPinned(note)) });

  return (
    <div className="page wide">
      {/* The same toolbar shape as every other page: what is shown on the
          left, what you can do on the right. The heading that used to sit
          above it repeated the topbar word for word. */}
      <PageHeader
        className="section"
        tabs={
          notes.length > 0 ? (
            <>
              <div className="notes-search">
                <Search size={14} />
                <input
                  className="input"
                  value={query}
                  placeholder={t("notesSearch")}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <select
                className="select notes-sort"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortId)}
                aria-label={t("notesSort")}
              >
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {t(s.labelKey)}
                  </option>
                ))}
              </select>
            </>
          ) : null
        }
        actions={
          <button type="button" className="btn primary" onClick={() => add("")}>
            <Plus size={14} /> {t("notesNew")}
          </button>
        }
      />

      {labels.length > 0 ? (
        <div className="notes-label-row section">
          <button
            type="button"
            className={cn("label-pill", label === null && "on")}
            onClick={() => setLabel(null)}
          >
            {t("notesAllLabels")}
          </button>
          {labels.map((l) => (
            <button
              key={l}
              type="button"
              className={cn("label-pill", label === l && "on")}
              onClick={() => setLabel(label === l ? null : l)}
            >
              {l}
            </button>
          ))}
        </div>
      ) : null}

      {notes.length === 0 ? (
        <>
          <Empty
            icon={<EmptyArt kind="notes" />}
            title={t("notesEmptyTitle")}
            hint={t("notesEmptyHint")}
          />
          <div className="note-starters">
            {STARTERS.map((starter) => (
              <button
                key={starter.id}
                type="button"
                className="note-starter"
                onClick={() => add(starter.body)}
              >
                <starter.icon size={14} />
                {t(starter.labelKey as TranslationKey)}
              </button>
            ))}
          </div>
        </>
      ) : visible.length === 0 ? (
        <Empty
          icon={<EmptyArt kind="search" />}
          title={t("notesNoMatch")}
          hint={t("notesNoMatchHint")}
        />
      ) : (
        <>
          {pinnedCount > 0 ? (
            <>
              <div className="section-head" style={{ marginBottom: 12 }}>
                <Pin size={13} />
                <h2>{t("notesPinned")}</h2>
                <span className="count grow">{pinnedCount}</span>
              </div>
              <Wall
                notes={visible.slice(0, pinnedCount)}
                selectedKey={selectedKey}
                onOpen={onOpen}
                onTogglePin={togglePin}
                now={now}
              />
              {visible.length > pinnedCount ? (
                <div
                  className="section-head"
                  style={{ marginTop: 20, marginBottom: 12 }}
                >
                  <h2>{t("notesOthers")}</h2>
                  <span className="count grow">
                    {visible.length - pinnedCount}
                  </span>
                </div>
              ) : null}
            </>
          ) : null}

          <Wall
            notes={visible.slice(pinnedCount)}
            selectedKey={selectedKey}
            onOpen={onOpen}
            onTogglePin={togglePin}
            now={now}
          />
        </>
      )}
    </div>
  );
}

function Wall({
  notes,
  selectedKey,
  onOpen,
  onTogglePin,
  now,
}: {
  notes: Task[];
  selectedKey: string | null;
  onOpen: (instance: TaskInstance) => void;
  onTogglePin: (note: Task) => void;
  now: Date;
}) {
  if (notes.length === 0) return null;

  return (
    <div className="note-wall">
      {notes.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          selected={note.id === selectedKey}
          onOpen={() => onOpen(toInstance(note, null, null, now))}
          onTogglePin={() => onTogglePin(note)}
        />
      ))}
    </div>
  );
}

function NoteCard({
  note,
  selected,
  onOpen,
  onTogglePin,
}: {
  note: Task;
  selected: boolean;
  onOpen: () => void;
  onTogglePin: () => void;
}) {
  const { t } = useI18n();
  const pinned = isPinned(note);
  const labels = noteLabels(note);
  const named = note.title.trim().length > 0;
  const title = named ? note.title.trim() : noteFallbackTitle(note);
  const untitled = !named && !note.description.trim();
  // An untitled note borrows its first line as a heading; showing that line
  // again in the preview would just print it twice.
  const preview = named ? note.description : dropFirstLine(note.description);

  return (
    <div
      className={cn("note-paper note-card", selected && "selected")}
      data-color={noteColor(note)}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <button
        type="button"
        className={cn("note-pin", pinned && "on")}
        title={pinned ? t("notesUnpin") : t("notesPin")}
        aria-pressed={pinned}
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin();
        }}
      >
        <Pin size={13} fill={pinned ? "currentColor" : "none"} />
      </button>

      <div className={cn("note-title", untitled && "untitled")}>
        {untitled ? t("notesEmptyNote") : title}
      </div>

      {preview.trim() ? <NotePreview body={preview} /> : null}

      <div className="note-foot">
        {labels.length > 0 ? (
          <div className="note-tags">
            {labels.slice(0, 3).map((l) => (
              <span key={l} className="note-tag">
                {l}
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
    </div>
  );
}

/** Renders the first slice of a note body with its structure intact. */
function NotePreview({ body }: { body: string }) {
  const lines = parseNoteBody(body).slice(0, 14);

  return (
    <div className="note-preview">
      {lines.map((line, i) => {
        if (line.kind === "divider") return <div key={i} className="l-divider" />;
        if (line.kind === "heading")
          return (
            <div key={i} className="l-text l-heading">
              {line.text}
            </div>
          );
        if (line.kind === "todo")
          return (
            <div key={i} className={cn("l-item", line.done && "done")}>
              <span className="marker" style={{ paddingTop: 2 }}>
                {line.done ? <CheckSquare size={11} /> : <Square size={11} />}
              </span>
              <span>{line.text}</span>
            </div>
          );
        if (line.kind === "bullet")
          return (
            <div key={i} className="l-item">
              <span className="marker">•</span>
              <span>{line.text}</span>
            </div>
          );
        if (!line.text.trim()) return <div key={i} className="l-blank" />;
        return (
          <div key={i} className="l-text">
            {line.text}
          </div>
        );
      })}
    </div>
  );
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
