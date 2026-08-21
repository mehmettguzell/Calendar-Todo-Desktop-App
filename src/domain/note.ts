/**
 * Notes are Tasks, not a second record type.
 *
 * A note is any task carrying the `note` tag. Everything else a note needs
 * (paper colour, pinning) is encoded as a namespaced tag rather than a new
 * column, so the single-source-of-truth `Task` shape stays untouched and a
 * note remains convertible to a task by dropping one tag.
 */
import type { Task } from "@/domain/types";

export const NOTE_TAG = "note";
const COLOR_PREFIX = "note:color:";
const PINNED_TAG = "note:pinned";

export const NOTE_COLORS = [
  { id: "plain", label: "Plain" },
  { id: "amber", label: "Amber" },
  { id: "rose", label: "Rose" },
  { id: "violet", label: "Violet" },
  { id: "sky", label: "Sky" },
  { id: "emerald", label: "Emerald" },
] as const;

export type NoteColor = (typeof NOTE_COLORS)[number]["id"];

const COLOR_IDS = new Set<string>(NOTE_COLORS.map((c) => c.id));

export function isNote(task: Task): boolean {
  return task.tags.includes(NOTE_TAG);
}

export function noteColor(task: Task): NoteColor {
  const tag = task.tags.find((t) => t.startsWith(COLOR_PREFIX));
  const id = tag?.slice(COLOR_PREFIX.length);
  return id && COLOR_IDS.has(id) ? (id as NoteColor) : "plain";
}

export function withNoteColor(tags: string[], color: NoteColor): string[] {
  const rest = tags.filter((t) => !t.startsWith(COLOR_PREFIX));
  return color === "plain" ? rest : [...rest, `${COLOR_PREFIX}${color}`];
}

export function isPinned(task: Task): boolean {
  return task.tags.includes(PINNED_TAG);
}

export function withPinned(tags: string[], pinned: boolean): string[] {
  const rest = tags.filter((t) => t !== PINNED_TAG);
  return pinned ? [...rest, PINNED_TAG] : rest;
}

/** Tags the user typed, with the bookkeeping ones hidden. */
export function noteLabels(task: Task): string[] {
  return task.tags.filter((t) => t !== NOTE_TAG && !t.startsWith("note:"));
}

export function withNoteLabels(tags: string[], labels: string[]): string[] {
  const reserved = tags.filter((t) => t === NOTE_TAG || t.startsWith("note:"));
  return [...reserved, ...labels];
}

/** First non-empty body line, used as a title when the note has none. */
export function noteFallbackTitle(task: Task): string {
  const line = task.description.split("\n").find((l) => l.trim().length > 0);
  if (!line) return "Untitled note";
  const stripped = line
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/^\s*[-*]\s+/, "")
    .replace(/^\[[ xX]\]\s*/, "")
    .trim();
  return stripped.slice(0, 80) || "Untitled note";
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** One parsed body line — enough structure for a readable preview. */
export type NoteLine =
  | { kind: "heading"; text: string }
  | { kind: "todo"; text: string; done: boolean }
  | { kind: "bullet"; text: string }
  | { kind: "divider" }
  | { kind: "text"; text: string };

/**
 * A deliberately tiny subset of Markdown: headings, checkboxes, bullets and
 * rules. Enough to make a note look like a note without pulling in a parser
 * or committing the app to full Markdown semantics.
 */
export function parseNoteBody(body: string): NoteLine[] {
  return body.split("\n").map((raw): NoteLine => {
    const line = raw.trimEnd();
    const todo = /^\s*[-*]\s*\[([ xX])\]\s*(.*)$/.exec(line);
    if (todo) {
      return {
        kind: "todo",
        done: (todo[1] ?? " ").toLowerCase() === "x",
        text: todo[2] ?? "",
      };
    }
    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) return { kind: "divider" };
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (heading) return { kind: "heading", text: heading[1] ?? "" };
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) return { kind: "bullet", text: bullet[1] ?? "" };
    return { kind: "text", text: line };
  });
}

/** Toggles the checkbox on `index` in place, leaving every other line alone. */
export function toggleBodyTodo(body: string, index: number): string {
  const lines = body.split("\n");
  const line = lines[index];
  if (line === undefined) return body;
  const match = /^(\s*[-*]\s*\[)([ xX])(\].*)$/.exec(line);
  if (!match) return body;
  lines[index] = `${match[1]}${match[2] === " " ? "x" : " "}${match[3]}`;
  return lines.join("\n");
}
