import type { ParsedQuickAdd } from "@/domain/naturalLanguage";
import type { Category, Priority, Recurrence } from "@/domain/types";
import { CATEGORY_COLORS } from "@/data/db";

/**
 * Everything the composer's fields hold, as one value.
 *
 * Grouped so the parse can fill several at once and `reset` can clear them all
 * without thirteen setters lined up in a row.
 */
export interface ComposerDraft {
  description: string;
  dueDate: string;
  endDate: string;
  deadline: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
  priority: Priority;
  categoryId: string;
  tags: string;
  recurrence: Recurrence | null;
}

export function emptyDraft(dueDate: string, startTime: string, allDay: boolean): ComposerDraft {
  return {
    description: "",
    dueDate,
    endDate: "",
    deadline: "",
    allDay,
    startTime,
    endTime: "",
    priority: "NONE",
    categoryId: "",
    tags: "",
    recurrence: null,
  };
}

/** Which fields the user has edited by hand, and so the parse must not touch. */
export interface Touched {
  date: boolean;
  time: boolean;
}

/**
 * What the parse contributes, over the fields the user has not claimed.
 *
 * Only ever *fills in*: typing a date and then correcting it in the picker has
 * to stick, which is what `touched` protects.
 */
export function filledByParse(
  parsed: ParsedQuickAdd,
  touched: Touched,
): Partial<ComposerDraft> {
  const next: Partial<ComposerDraft> = {};
  if (!touched.date) {
    if (parsed.dueDate) next.dueDate = parsed.dueDate;
    if (parsed.endDate) next.endDate = parsed.endDate;
    if (parsed.deadline) next.deadline = parsed.deadline;
  }
  if (parsed.startTime && !touched.time) {
    next.allDay = false;
    next.startTime = parsed.startTime;
    if (parsed.endTime) next.endTime = parsed.endTime;
  }
  if (parsed.priority !== "NONE") next.priority = parsed.priority;
  if (parsed.recurrence) next.recurrence = parsed.recurrence;
  if (parsed.tags.length > 0) next.tags = parsed.tags.join(", ");
  return next;
}

/** `#kategori` names a category, creating it when it is new. */
export function resolveCategoryId(
  chosen: string,
  name: string | null,
  categories: Category[],
  addCategory: (name: string, color: string) => Category,
): string {
  if (chosen || !name) return chosen;
  const wanted = name.trim().toLowerCase();
  const match = categories.find((c) => c.name.trim().toLowerCase() === wanted);
  if (match) return match.id;
  const colour =
    CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length] ?? "#64748b";
  return addCategory(name, colour).id;
}

/** Tags are typed as one line; the store wants them one per entry. */
export function splitTags(tags: string): string[] {
  return tags
    .split(",")
    .map((tag) => tag.trim().replace(/^#/, ""))
    .filter(Boolean);
}

/** The composer's fields as a draft the store will accept. */
export function draftDetails(draft: ComposerDraft) {
  return {
    description: draft.description.trim(),
    dueDate: draft.dueDate || null,
    endDate: draft.endDate || null,
    deadline: draft.deadline || null,
    allDay: draft.allDay,
    startTime: draft.allDay ? null : draft.startTime || null,
    endTime: draft.allDay || !draft.endTime ? null : draft.endTime,
    priority: draft.priority,
    tags: splitTags(draft.tags),
    recurrence: draft.recurrence,
  };
}
