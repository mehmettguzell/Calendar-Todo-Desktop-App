import {
  appendHistory,
  collectSubtree,
  describeSchedule,
  serialise,
  syncSubtree,
} from "../taskMutations";
import { useUndoStore } from "../undoStore";
import {
  pruneTombstones,
  tombstone,
} from "@/data/db";
import { copySubtree } from "@/domain/copy";
import { nowInstant } from "@/domain/datetime";
import { historyEntry } from "@/domain/history";
import { createId } from "@/domain/ids";
import {
  HistoryEntry,
  Task,
} from "@/domain/types";
import {
  syncDeleteTaskToCloud,
  syncTaskToCloud,
} from "@/sync/storeBridge";
import type { Database } from "@/data/db";
import type { Instant } from "@/domain/types";
import type { SliceTools, StoreState } from "../storeState";
import type { TaskDraft, TaskPatch } from "../storeTypes";

// The task row itself: making one, changing it, and its trip through Trash.
export type TaskSlice = Pick<
  StoreState,
  | "createTask"
  | "duplicateTask"
  | "updateTask"
  | "deleteTask"
  | "restoreTask"
  | "purgeTask"
>;

/**
 * Fields whose change is worth a trail entry on its own.
 *
 * `deadline` is not folded into the schedule summary: moving a task is not the
 * same act as changing what it has to be finished by, and §5 asks for both.
 */
const TRACKED_FIELDS = [
  "title",
  "description",
  "priority",
  "categoryId",
  "recurrence",
  "estimateMinutes",
  "tags",
  "deadline",
] as const;

function scheduleMoved(task: Task, patch: TaskPatch): boolean {
  return (
    ("dueDate" in patch && patch.dueDate !== task.dueDate) ||
    ("endDate" in patch && patch.endDate !== task.endDate) ||
    ("startTime" in patch && patch.startTime !== task.startTime) ||
    ("endTime" in patch && patch.endTime !== task.endTime) ||
    ("allDay" in patch && patch.allDay !== task.allDay)
  );
}

function editHistory(
  task: Task,
  patch: TaskPatch,
  note: string | undefined,
): HistoryEntry[] {
  const taskId = task.id;
  const entries: HistoryEntry[] = [];
  if (scheduleMoved(task, patch)) {
    entries.push(
      historyEntry({
        taskId,
        kind: "RESCHEDULED",
        field: "schedule",
        from: describeSchedule(task),
        to: describeSchedule({ ...task, ...patch }),
      }),
    );
  }
  for (const field of TRACKED_FIELDS) {
    if (!(field in patch)) continue;
    const from = serialise(task[field]);
    const to = serialise(patch[field]);
    if (from === to) continue;
    entries.push(historyEntry({ taskId, kind: "UPDATED", field, from, to }));
  }
  if (note) entries.push(historyEntry({ taskId, kind: "UPDATED", note }));
  return entries;
}

/**
 * A subtask sits in its parent's category, so re-filing a plan re-files its
 * steps. Only tasks that actually disagree are touched, which keeps this a
 * no-op — and off the sync queue — for every other edit.
 */
function categoryCascade(
  db: Database,
  task: Task,
  next: Task,
  patch: TaskPatch,
): Set<string> {
  if (!("categoryId" in patch) || patch.categoryId === task.categoryId) {
    return new Set<string>();
  }
  return new Set(
    collectSubtree(db.tasks, task.id).filter(
      (id) =>
        id !== task.id &&
        db.tasks.find((t) => t.id === id)?.categoryId !== next.categoryId,
    ),
  );
}

function cascadeHistory(
  db: Database,
  cascade: Set<string>,
  categoryId: string | null,
): HistoryEntry[] {
  return [...cascade].map((taskId) =>
    historyEntry({
      taskId,
      kind: "UPDATED",
      field: "categoryId",
      from: serialise(db.tasks.find((t) => t.id === taskId)?.categoryId ?? null),
      to: serialise(categoryId),
    }),
  );
}

/**
 * A new task from a draft, with a parent's answers standing in for the fields
 * the one-line composer never asks about.
 *
 * Priority and category are inherited because a step of an urgent plan filed
 * under "Tez" is urgent and filed under "Tez" — asking for the same fact twice
 * is how steps ended up looking like the least pressing thing on the list.
 */
/* eslint-disable-next-line complexity -- a flat defaulting map, not branching logic */
function buildTask(
  draft: TaskDraft,
  context: { parent: Task | null; order: number; at: Instant },
): Task {
  const { parent, order, at } = context;
  return {
    id: createId("t"),
    title: draft.title.trim(),
    description: draft.description ?? "",
    status: "TODO",
    priority: draft.priority ?? parent?.priority ?? "NONE",
    dueDate: draft.dueDate ?? null,
    endDate: draft.endDate ?? null,
    deadline: draft.deadline ?? null,
    allDay: draft.allDay ?? true,
    startTime: draft.startTime ?? null,
    endTime: draft.endTime ?? null,
    categoryId: draft.categoryId ?? parent?.categoryId ?? null,
    tags: draft.tags ?? [],
    parentId: draft.parentId ?? null,
    recurrence: draft.recurrence ?? null,
    estimateMinutes: draft.estimateMinutes ?? null,
    snoozedUntil: null,
    order,
    manualOrder: null,
    createdAt: at,
    updatedAt: at,
    completedAt: null,
    deletedAt: null,
  };
}

export function createTaskSlice({ get, commit }: SliceTools): TaskSlice {
  return {
    createTask(draft) {
      const db = get().db;
      const parentId = draft.parentId ?? null;
      const task = buildTask(draft, {
        parent: parentId ? (db.tasks.find((t) => t.id === parentId) ?? null) : null,
        order: db.tasks.filter((t) => t.parentId === parentId).length,
        at: nowInstant(),
      });

      commit((next) =>
        appendHistory(
          { ...next, tasks: [...next.tasks, task] },
          historyEntry({
            taskId: task.id,
            kind: "CREATED",
            note: `Created "${task.title}"`,
          }),
        ),
      );
      void syncTaskToCloud(task);
      return task;
    },
    /**
     * Copy a task onto another day.
     *
     * The copy is a new, independent task (see `domain/copy.ts`): it starts at
     * TODO, carries the subtasks that make it meaningful, and leaves the
     * original's reminders, focus sessions and history behind — those are the
     * record of what happened to *that* task, and a copy has no past yet.
     */
    duplicateTask(taskId, target = {}) {
      const at = nowInstant();
      const source = get().db.tasks.find(
        (t) => t.id === taskId && t.deletedAt === null,
      );
      if (!source) return null;

      const copies = copySubtree(get().db.tasks, taskId, target, at);
      const root = copies[0];
      if (!root) return null;

      // The copy sorts after everything already on its day rather than
      // inheriting the source's position and landing on top of a stranger.
      const siblings = get().db.tasks.filter(
        (t) => t.parentId === root.parentId,
      );
      root.order = siblings.length;

      commit((db) =>
        appendHistory(
          { ...db, tasks: [...db.tasks, ...copies] },
          ...copies.map((copy) =>
            historyEntry({
              taskId: copy.id,
              kind: "CREATED",
              note:
                copy.id === root.id
                  ? `Copied from "${source.title}"`
                  : `Copied with "${source.title}"`,
            }),
          ),
        ),
      );
      for (const copy of copies) void syncTaskToCloud(copy);

      // A stray copy on the wrong day is the whole risk of a one-key paste.
      useUndoStore
        .getState()
        .push("undoneTaskCopied", () => get().purgeTask(root.id));

      return root;
    },
    updateTask(taskId, patch, note) {
      commit((db) => {
        const task = db.tasks.find((t) => t.id === taskId);
        if (!task) return db;

        const at = nowInstant();
        const next = { ...task, ...patch, updatedAt: at };
        const cascade = categoryCascade(db, task, next, patch);
        const entries = [
          ...editHistory(task, patch, note),
          ...cascadeHistory(db, cascade, next.categoryId ?? null),
        ];

        return appendHistory(
          {
            ...db,
            tasks: db.tasks.map((t) =>
              t.id === taskId
                ? next
                : cascade.has(t.id)
                  ? { ...t, categoryId: next.categoryId ?? null, updatedAt: at }
                  : t,
            ),
          },
          ...entries,
        );
      });
      if ("categoryId" in patch) {
        syncSubtree(get().db, taskId);
      } else {
        const updated = get().db.tasks.find((t) => t.id === taskId);
        if (updated) void syncTaskToCloud(updated);
      }
    },
    deleteTask(taskId) {
      commit((db) => {
        const at = nowInstant();
        const ids = collectSubtree(db.tasks, taskId);
        const entries = ids.map((id) =>
          historyEntry({ taskId: id, kind: "DELETED", note: "Moved to trash" }),
        );
        return appendHistory(
          {
            ...db,
            tasks: db.tasks.map((t) =>
              ids.includes(t.id) ? { ...t, deletedAt: at, updatedAt: at } : t,
            ),
          },
          ...entries,
        );
      });
      // The whole subtree was trashed, so the whole subtree has to travel:
      // queueing only the root left the children alive in the cloud, and the
      // next device to look saw half a deleted task.
      syncSubtree(get().db, taskId);

      // The reversal is the ordinary restore, so the trail records both the
      // delete and the undo rather than quietly rewinding to before either.
      useUndoStore
        .getState()
        .push("undoneTaskDeleted", () => get().restoreTask(taskId));
    },
    restoreTask(taskId) {
      commit((db) => {
        const ids = collectSubtree(db.tasks, taskId);
        const at = nowInstant();
        return appendHistory(
          {
            ...db,
            tasks: db.tasks.map((t) =>
              ids.includes(t.id) ? { ...t, deletedAt: null, updatedAt: at } : t,
            ),
          },
          ...ids.map((id) => historyEntry({ taskId: id, kind: "RESTORED" })),
        );
      });
      syncSubtree(get().db, taskId);
    },
    /** Hard delete. History rows survive: they are the record that it existed. */
    purgeTask(taskId) {
      const purged = collectSubtree(get().db.tasks, taskId);
      const at = nowInstant();
      commit((db) => {
        const ids = new Set(purged);
        return {
          ...db,
          tasks: db.tasks.filter((t) => !ids.has(t.id)),
          occurrences: db.occurrences.filter((o) => !ids.has(o.taskId)),
          reminders: db.reminders.filter((r) => !ids.has(r.taskId)),
          tombstones: pruneTombstones([
            ...db.tombstones,
            ...purged.map((id) => tombstone("task", id, at)),
          ]),
        };
      });
      // The whole subtree went, not just the row that was clicked.
      for (const id of purged) void syncDeleteTaskToCloud(id);
    },
  };
}
