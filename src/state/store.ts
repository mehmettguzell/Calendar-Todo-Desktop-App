import { useMemo } from "react";
import { create } from "zustand";
import { createRepository } from "@/data/createRepository";
import {
  deduplicateBudgetCategories,
  deduplicateCategories,
  emptyDatabase,
  pruneTombstones,
  tombstone,
  type Database,
} from "@/data/db";
import {
  ANONYMOUS_NAMESPACE,
  activeNamespace,
  anonymousClaimedBy,
  markAnonymousClaimed,
  namespaceFor,
  setActiveNamespace,
} from "@/data/namespace";
import type { Repository } from "@/data/repository";
import {
  addDaysLocal,
  daysBetween,
  minutesFromMidnight,
  minutesToTime,
  nowInstant,
  toInstant,
  toLocalDate,
} from "@/domain/datetime";
import { historyEntry } from "@/domain/history";
import { pinOf } from "@/domain/manualOrder";
import { createId, occurrenceId } from "@/domain/ids";
import { copySubtree, type CopyTarget } from "@/domain/copy";
import {
  enclosingPlan,
  representativeInstance,
  toInstance,
} from "@/domain/task";
import { resolveSnooze, type SnoozePresetId } from "@/domain/snooze";
import type {
  BudgetCategory,
  MoneyFlow,
  Transaction,
  TransactionOrigin,
} from "@/domain/money";
import {
  BUDGET_CATEGORY_COLORS,
  CATEGORY_CATALOGUE,
  dueRecurringTransactions,
  type CategoryKey,
} from "@/domain/money";
import { normaliseLink, type WishlistItem } from "@/domain/wishlist";
import { normaliseLabel, type Deadline } from "@/domain/deadline";
import { NOTE_TAG } from "@/domain/note";
import type { ImportDraft, ImportMerge } from "@/domain/statementImport";
import {
  isLive as batchIsLive,
  restorePatch,
  snapshotOf,
  type ImportMode,
  type StatementBatch,
} from "@/domain/statementBatch";
import {
  syncDeleteCategoryToCloud,
  syncDeleteTaskToCloud,
  syncTaskToCloud,
} from "./syncEngine";
import { fireConfetti } from "@/lib/confetti";
import { useUndoStore } from "./undoStore";
import type {
  Category,
  FocusSession,
  HistoryEntry,
  InstanceRef,
  Instant,
  LocalDate,
  Occurrence,
  Priority,
  Recurrence,
  Reminder,
  Settings,
  StoredStatus,
  Task,
  TaskInstance,
} from "@/domain/types";

export interface TaskDraft {
  title: string;
  description?: string;
  priority?: Priority;
  dueDate?: LocalDate | null;
  endDate?: LocalDate | null;
  deadline?: LocalDate | null;
  allDay?: boolean;
  startTime?: string | null;
  endTime?: string | null;
  categoryId?: string | null;
  tags?: string[];
  parentId?: string | null;
  recurrence?: Recurrence | null;
  estimateMinutes?: number | null;
}

/** Fields a user may edit; everything else is bookkeeping owned by the store. */
export type TaskPatch = Partial<
  Pick<
    Task,
    | "title"
    | "description"
    | "priority"
    | "dueDate"
    | "endDate"
    | "deadline"
    | "allDay"
    | "startTime"
    | "endTime"
    | "categoryId"
    | "tags"
    | "recurrence"
    | "estimateMinutes"
    | "order"
    | "parentId"
  >
>;

export interface TransactionDraft {
  date: LocalDate;
  amountMinor: number;
  flow: MoneyFlow;
  categoryId: string | null;
  note?: string;
  recurrence?: Recurrence | null;
  /** The card this went through. See `Transaction.account`. */
  account?: string | null;
  /** Canonical shop, when something recognised one. */
  merchant?: string | null;
  /** How it reached the ledger. Defaults to hand-typed. */
  origin?: TransactionOrigin;
  /** Identity of the source record, for alerts and imports. */
  externalId?: string | null;
  /** Split over this many monthly charges. See `Transaction.instalments`. */
  instalments?: number | null;
}

/** What an import wants its record labelled with. See `statementBatch`. */
export interface BatchInfo {
  label: string;
  account?: string | null;
  from?: LocalDate;
  to?: LocalDate;
  mode?: ImportMode;
}

export interface DeadlineDraft {
  taskId: string;
  /** What has to be true by `date`. Blank input is rejected, not stored. */
  label: string;
  date: LocalDate;
}

export type DeadlinePatch = Partial<Pick<Deadline, "label" | "date" | "order">>;

export interface WishlistDraft {
  title: string;
  /** Minor units, or null while the price is still unknown. */
  priceMinor?: number | null;
  /** Raw text as typed; the store is what checks it is a link. */
  url?: string;
  note?: string;
  categoryId?: string | null;
}

export type WishlistPatch = Partial<
  Pick<WishlistItem, "title" | "priceMinor" | "note" | "categoryId" | "order">
> & {
  /** Raw text again, so a corrected link goes through the same check. */
  url?: string | null;
};

export type TransactionPatch = Partial<
  Pick<
    Transaction,
    | "date"
    | "amountMinor"
    | "flow"
    | "categoryId"
    | "note"
    | "recurrence"
    | "account"
    | "merchant"
    | "externalId"
    | "origin"
    | "confirmedAt"
    | "instalments"
  >
>;

export interface RunningFocus {
  sessionId: string;
  taskId: string;
  occurrenceDate: LocalDate | null;
  startedAt: string;
}

interface StoreState {
  ready: boolean;
  db: Database;
  /** Which account's local document is loaded. See `data/namespace.ts`. */
  namespace: string;
  /** Ticks once a minute so derived statuses (OVERDUE) stay honest. */
  now: number;
  runningFocus: RunningFocus | null;

  hydrate(): Promise<void>;
  /** Swap the whole local document for the one belonging to `userId`. */
  switchAccount(userId: string | null): Promise<void>;
  tick(): void;

  createTask(draft: TaskDraft): Task;
  /**
   * Copy a task — with its subtasks — onto another day.
   *
   * Returns the new root task, or `null` when the source is gone.
   */
  duplicateTask(taskId: string, target?: CopyTarget): Task | null;
  updateTask(taskId: string, patch: TaskPatch, note?: string): void;
  deleteTask(taskId: string): void;
  restoreTask(taskId: string): void;
  purgeTask(taskId: string): void;

  setStatus(ref: InstanceRef, status: StoredStatus): void;
  toggleComplete(instance: TaskInstance): void;
  reschedule(
    taskId: string,
    dueDate: LocalDate | null,
    startTime?: string | null,
  ): void;
  snooze(
    instance: TaskInstance,
    preset: SnoozePresetId,
    customTarget?: Date,
  ): void;
  clearSnooze(ref: InstanceRef): void;

  addReminder(
    reminder: Omit<
      Reminder,
      | "id"
      | "createdAt"
      | "updatedAt"
      | "status"
      | "snoozedUntil"
      | "lastFiredFor"
    >,
  ): void;
  removeReminder(reminderId: string): void;
  markReminderFired(reminderId: string, occurrenceDate: LocalDate | null): void;
  snoozeReminder(reminderId: string, until: string): void;
  dismissReminder(reminderId: string): void;

  startFocus(instance: TaskInstance): void;
  stopFocus(): void;
  cancelFocus(): void;
  /** Drop one recorded session. */
  deleteFocusSession(sessionId: string): void;
  clearFocusSessions(): void;

  addCategory(name: string, color: string): Category;
  updateCategory(
    id: string,
    patch: Partial<Pick<Category, "name" | "color">>,
  ): void;
  removeCategory(id: string): void;

  /**
   * File an existing task under a parent, or set it loose again.
   *
   * Deliberately outside `TaskPatch`: a parent link carries invariants a blind
   * patch cannot see. A task may not be filed under its own descendant — that
   * would cut the whole subtree loose from every view at once — and the moved
   * row takes the last place among its new siblings rather than landing on an
   * `order` one of them already holds.
   */
  setParent(taskId: string, parentId: string | null): void;

  /**
   * Promote a task to a plan of its own.
   *
   * A plan is a top-level task tagged `plan` with no schedule of its own — its
   * steps carry the dates. So this detaches the task from any parent and drops
   * its times: leaving either behind would make a plan that the Plans view
   * cannot list and the calendar still draws.
   */
  makePlan(taskId: string): void;

  reorderSubtasks(parentId: string, orderedIds: string[]): void;

  /**
   * Record a drag inside one list.
   *
   * `orderedIds` is the whole list as it now reads on screen and `movedId` the
   * row the user actually dragged. Only that row — and rows already pinned by
   * an earlier drag — take a pin, so priority keeps sorting everything the user
   * has never touched.
   */
  reorderTasks(orderedIds: string[], movedId: string): void;

  /** Let the named tasks sort themselves again. */
  clearManualOrder(taskIds: string[]): void;

  /** Pull unfinished, past-due tasks onto a new date. Returns how many moved. */
  rollOverTo(taskIds: string[], date: LocalDate): number;

  /* Bulk ------------------------------------------------------------ */
  /**
   * The same edit across several tasks.
   *
   * Routed through `updateTask` one by one rather than written as one sweep:
   * an edit to fifty tasks has to leave the same history, the same category
   * cascade onto subtasks and the same sync as fifty single edits, or a bulk
   * action becomes a second way to change a task that behaves differently
   * from the first.
   */
  bulkUpdateTasks(taskIds: string[], patch: TaskPatch): void;
  /** Complete or reopen several tasks at once. */
  bulkSetStatus(taskIds: string[], status: StoredStatus): void;
  /**
   * Trash several tasks — each with everything beneath it — as one act.
   *
   * One commit and one undo offer, because that is what the user did. Fifty
   * separate deletes would leave fifty history-identical rows and an undo that
   * only reached the last of them.
   */
  bulkDeleteTasks(taskIds: string[]): void;

  /* Budget ---------------------------------------------------------- */
  addTransaction(draft: TransactionDraft): Transaction;
  updateTransaction(id: string, patch: TransactionPatch): void;
  deleteTransaction(id: string): void;
  restoreTransaction(id: string): void;
  /** Find a budget category by name, or create it. Names are the identity. */
  ensureBudgetCategory(name: string, flow: MoneyFlow): BudgetCategory;
  /**
   * Create the categories a statement needs, in the app's language.
   *
   * Returns the key -> id map the import then files its rows under.
   */
  ensureCategoriesForKeys(keys: CategoryKey[]): Record<string, string>;
  /**
   * Write a confirmed statement import.
   *
   * Returns how many entries were created. Entries whose `externalId` is
   * already in the ledger are skipped here as well as in the plan, so a stale
   * preview can never double a month.
   */
  /**
   * Turn a task into a note, or report why it cannot become one.
   *
   * The inverse of what the note panel does by dropping one tag, but not its
   * mirror image: a note has none of the things a task can carry, so the ones
   * that would be left dangling are cleared here rather than hidden. Returns
   * `false` without changing anything when the task has subtasks — those would
   * keep a parent that no list shows, which is data quietly disappearing.
   */
  convertToNote(taskId: string): boolean;

  importTransactions(
    drafts: ImportDraft[],
    merges?: ImportMerge[],
    batch?: BatchInfo,
  ): number;
  /**
   * Put the ledger back the way it was before one import.
   *
   * Returns how many entries moved. Safe to call on a batch that has already
   * been reverted, or whose rows the user has since edited or deleted by hand:
   * every step below checks what is actually there rather than what the import
   * left behind.
   */
  revertImport(batchId: string): number;

  /* Wishlist -------------------------------------------------------- */
  /* Deadlines: the dated checkpoints a task is broken into. */
  addDeadline(draft: DeadlineDraft): Deadline | null;
  updateDeadline(id: string, patch: DeadlinePatch): void;
  /** Ticks a checkpoint off, or puts it back. */
  setDeadlineMet(id: string, met: boolean): void;
  removeDeadline(id: string): void;

  addWishlistItem(draft: WishlistDraft): WishlistItem;
  updateWishlistItem(id: string, patch: WishlistPatch): void;
  /** Take it off the list. Soft, like everything else, and undoable. */
  removeWishlistItem(id: string): void;
  /**
   * The moment a wish becomes money.
   *
   * Writes an ordinary ledger entry — the wishlist has no totals of its own
   * and never touches the budget until this is called — and marks the item
   * bought rather than deleting it, because "did I already buy this?" is a
   * question a shopping list has to be able to answer.
   *
   * Returns the entry it created, or `null` when there was nothing to buy:
   * the item is gone, already bought, or has no price to charge.
   */
  buyWishlistItem(id: string, date?: LocalDate): Transaction | null;

  /** Remember that today's spending prompt has been shown. */
  markSpendNudged(date: LocalDate): void;
  updateBudgetCategory(
    id: string,
    patch: Partial<
      Pick<
        BudgetCategory,
        "name" | "color" | "icon" | "flow" | "monthlyLimitMinor"
      >
    >,
  ): void;
  removeBudgetCategory(id: string): void;
  /**
   * Turn every repeating entry that has come due into a real one.
   * Returns how many were created.
   */
  materialiseRecurringTransactions(through: LocalDate): number;

  updateSettings(patch: Partial<Settings>): void;

  clearHistory(): void;
  emptyTrash(): void;
  resetDatabase(): Promise<void>;
}

let repository: Repository | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSave: { repo: Repository; db: Database } | null = null;

/**
 * How long writes are coalesced before touching the disk.
 *
 * The whole document is rewritten on every save, so a burst of edits — a drag
 * across ten rows, a plan template creating five subtasks — must cost one write
 * rather than ten. Anything longer than a keystroke gap is wasted latency;
 * anything much longer risks losing more work to a crash.
 */
const SAVE_DEBOUNCE_MS = 400;

/** How long a trashed task stays recoverable before it is purged for good. */
const TRASH_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

/** Debounced write-behind: the UI never waits on the disk. */
export function persist(db: Database) {
  if (!repository) return;
  pendingSave = { repo: repository, db };
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void flushPersist();
  }, SAVE_DEBOUNCE_MS);
}

/**
 * Write anything still queued, right now.
 *
 * Called when the window is hidden or closing: a debounced write that never
 * fires is indistinguishable, to the user, from an edit that never happened.
 */
export async function flushPersist(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const queued = pendingSave;
  pendingSave = null;
  if (!queued) return;
  await queued.repo
    .save(queued.db)
    .catch((error) => console.error("[tempo] save failed", error));
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushPersist();
  });
}
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => void flushPersist());
}

/** The namespace every cloud write and local save is currently bound to. */
export function currentNamespace(): string {
  return repository?.namespace ?? ANONYMOUS_NAMESPACE;
}

/**
 * Write immediately, cancelling any pending debounced write.
 *
 * Used by destructive actions: after "reset everything" the file on disk must
 * already be empty, because the next thing the user does may well be to close
 * the app — and a queued write holding the *old* document would then land on
 * top of the reset, or never land at all.
 */
async function persistNow(db: Database): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  pendingSave = null;
  if (!repository) return;
  await repository.save(db);
}

export const useStore = create<StoreState>((set, get) => {
  /** Every mutation goes through here, so nothing can skip history or persistence. */
  const commit = (mutate: (db: Database) => Database) => {
    set((state) => {
      const db = mutate(state.db);
      persist(db);
      return { db };
    });
  };

  const appendHistory = (
    db: Database,
    ...entries: HistoryEntry[]
  ): Database => ({
    ...db,
    history: [...db.history, ...entries],
  });

  /**
   * Load one namespace's document into the store.
   *
   * Trashed tasks past the retention window are purged here, and each purge
   * leaves a tombstone: without one, the next sync sees a row the cloud still
   * has and this device does not, and helpfully restores it.
   */
  const openNamespace = async (namespace: string): Promise<Database> => {
    repository = createRepository(namespace);
    const loaded = await repository.load().catch((error) => {
      console.error("[tempo] load failed", error);
      return null;
    });
    const rawDb = loaded ?? emptyDatabase();
    const lang = rawDb.settings?.language ?? "tr";
    const { categories: cleanCategories, tasks: cleanTasks } =
      deduplicateCategories(rawDb.categories, rawDb.tasks, lang);
    const { budgetCategories: cleanBudgetCategories, transactions: cleanTransactions } =
      deduplicateBudgetCategories(rawDb.budgetCategories ?? [], rawDb.transactions ?? [], lang);
    const nowMs = Date.now();
    const at = new Date(nowMs).toISOString();
    const cutoff = new Date(nowMs - TRASH_RETENTION_MS).toISOString();

    const expired = cleanTasks.filter(
      (t) => t.deletedAt !== null && t.deletedAt < cutoff,
    );
    const validTasks = cleanTasks.filter(
      (t) => t.deletedAt === null || t.deletedAt >= cutoff,
    );

    const db: Database = {
      ...rawDb,
      categories: cleanCategories,
      tasks: validTasks,
      budgetCategories: cleanBudgetCategories,
      transactions: cleanTransactions,
      tombstones: pruneTombstones(
        [
          ...(rawDb.tombstones ?? []),
          ...expired.map((t) => tombstone("task", t.id, at)),
        ],
        new Date(nowMs),
      ),
    };

    set({ db, namespace, ready: true, now: nowMs });
    setActiveNamespace(namespace);
    if (
      !loaded ||
      expired.length > 0 ||
      cleanCategories.length !== rawDb.categories.length ||
      cleanBudgetCategories.length !== (rawDb.budgetCategories?.length ?? 0)
    ) {
      persist(db);
    }
    return db;
  };

  return {
    ready: false,
    db: emptyDatabase(),
    namespace: ANONYMOUS_NAMESPACE,
    now: Date.now(),
    runningFocus: null,

    async hydrate() {
      await openNamespace(activeNamespace());
    },

    /**
     * Point the store at another account's document.
     *
     * The first account to sign in on a device *adopts* whatever was created
     * while signed out — otherwise trying the app before registering silently
     * throws that work away. Every account after that gets a clean namespace,
     * because handing the same local document to a second person is the exact
     * leak this separation exists to prevent.
     */
    async switchAccount(userId) {
      const target = namespaceFor(userId);
      if (repository && repository.namespace === target) return;

      // The document on screen belongs to the namespace we are leaving.
      await flushPersist();

      const previous = repository;
      if (
        userId &&
        previous?.namespace === ANONYMOUS_NAMESPACE &&
        anonymousClaimedBy() === null
      ) {
        const carried = get().db;
        const hasWork = carried.tasks.length > 0 || carried.history.length > 0;
        if (hasWork) {
          const incoming = createRepository(target);
          const existing = await incoming.load().catch(() => null);
          if (!existing || existing.tasks.length === 0) {
            repository = incoming;
            await incoming.save(carried);
            markAnonymousClaimed(userId);
            await previous.clear().catch(() => undefined);
            set({ db: carried, namespace: target });
            setActiveNamespace(target);
            return;
          }
        }
        markAnonymousClaimed(userId);
      }

      set({ ready: false });
      await openNamespace(target);
    },

    tick() {
      const state = get();
      const nowMs = Date.now();
      const cutoff = new Date(nowMs - TRASH_RETENTION_MS).toISOString();

      const toPurge = new Set(
        state.db.tasks
          .filter((t) => t.deletedAt !== null && t.deletedAt < cutoff)
          .map((t) => t.id),
      );

      if (toPurge.size > 0) {
        const at = new Date(nowMs).toISOString();
        commit((db) => ({
          ...db,
          tasks: db.tasks.filter((t) => !toPurge.has(t.id)),
          occurrences: db.occurrences.filter((o) => !toPurge.has(o.taskId)),
          reminders: db.reminders.filter((r) => !toPurge.has(r.taskId)),
          tombstones: pruneTombstones(
            [
              ...db.tombstones,
              ...[...toPurge].map((id) => tombstone("task", id, at)),
            ],
            new Date(nowMs),
          ),
        }));
        for (const id of toPurge) void syncDeleteTaskToCloud(id);
      }

      set({ now: nowMs });
    },

    createTask(draft) {
      const at = nowInstant();
      const siblings = get().db.tasks.filter(
        (t) => t.parentId === (draft.parentId ?? null),
      );
      const task: Task = {
        id: createId("t"),
        title: draft.title.trim(),
        description: draft.description ?? "",
        status: "TODO",
        priority: draft.priority ?? "NONE",
        dueDate: draft.dueDate ?? null,
        endDate: draft.endDate ?? null,
        deadline: draft.deadline ?? null,
        allDay: draft.allDay ?? true,
        startTime: draft.startTime ?? null,
        endTime: draft.endTime ?? null,
        // A subtask belongs to whatever its parent belongs to, unless the
        // caller says otherwise. Filing a step under "Tez" and then having to
        // pick the category again is asking for the same fact twice.
        categoryId:
          draft.categoryId ??
          (draft.parentId
            ? (get().db.tasks.find((t) => t.id === draft.parentId)?.categoryId ?? null)
            : null),
        tags: draft.tags ?? [],
        parentId: draft.parentId ?? null,
        recurrence: draft.recurrence ?? null,
        estimateMinutes: draft.estimateMinutes ?? null,
        snoozedUntil: null,
        order: siblings.length,
        manualOrder: null,
        createdAt: at,
        updatedAt: at,
        completedAt: null,
        deletedAt: null,
      };

      commit((db) =>
        appendHistory(
          { ...db, tasks: [...db.tasks, task] },
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

        const entries: HistoryEntry[] = [];
        const scheduleChanged =
          ("dueDate" in patch && patch.dueDate !== task.dueDate) ||
          ("endDate" in patch && patch.endDate !== task.endDate) ||
          ("startTime" in patch && patch.startTime !== task.startTime) ||
          ("endTime" in patch && patch.endTime !== task.endTime) ||
          ("allDay" in patch && patch.allDay !== task.allDay);

        if (scheduleChanged) {
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

        const tracked = [
          "title",
          "description",
          "priority",
          "categoryId",
          "recurrence",
          "estimateMinutes",
          "tags",
          // Not folded into `scheduleChanged` above: moving a task is not the
          // same act as changing what it has to be finished by, and §5 asks
          // for the history to keep both rather than one summary of the two.
          "deadline",
        ] as const;
        for (const field of tracked) {
          if (!(field in patch)) continue;
          const before = serialise(task[field]);
          const after = serialise(patch[field]);
          if (before === after) continue;
          entries.push(
            historyEntry({
              taskId,
              kind: "UPDATED",
              field,
              from: before,
              to: after,
            }),
          );
        }
        if (note) entries.push(historyEntry({ taskId, kind: "UPDATED", note }));

        const at = nowInstant();
        const next = { ...task, ...patch, updatedAt: at };

        /*
         * A subtask sits in its parent's category, so re-filing a plan re-files
         * its steps. Only tasks that actually disagree are touched, which keeps
         * this a no-op for every other edit and stops it from churning
         * `updatedAt` — and therefore the sync — on a whole subtree.
         */
        const cascade =
          "categoryId" in patch && patch.categoryId !== task.categoryId
            ? new Set(
                collectSubtree(db.tasks, taskId).filter(
                  (id) =>
                    id !== taskId &&
                    db.tasks.find((t) => t.id === id)?.categoryId !== next.categoryId,
                ),
              )
            : new Set<string>();

        for (const id of cascade) {
          entries.push(
            historyEntry({
              taskId: id,
              kind: "UPDATED",
              field: "categoryId",
              from: serialise(db.tasks.find((t) => t.id === id)?.categoryId ?? null),
              to: serialise(next.categoryId ?? null),
            }),
          );
        }

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

    setStatus(ref, status) {
      if (status === "COMPLETED") {
        fireConfetti({ particleCount: 65 });
      }
      commit((db) => applyStatus(db, ref, status));
      syncSubtree(get().db, ref.taskId);
    },

    toggleComplete(instance) {
      const ref = refOf(instance);
      const previous = instance.storedStatus;
      const next: StoredStatus =
        previous === "COMPLETED" ? "TODO" : "COMPLETED";
      // Read before the write: these are the subtasks the completion is about
      // to carry with it, and the undo has to know how to put them back.
      const cascaded =
        next === "COMPLETED" ? openDescendants(get().db, ref.taskId) : [];

      if (next === "COMPLETED") {
        fireConfetti({ particleCount: 65 });
      }

      commit((db) => applyStatus(db, ref, next));
      syncSubtree(get().db, ref.taskId);

      // Ticking the wrong row off a dense list is the single easiest mistake to
      // make in this app, and the one most likely to go unnoticed.
      useUndoStore
        .getState()
        .push(
          next === "COMPLETED" ? "undoneTaskCompleted" : "undoneTaskReopened",
          () => {
            get().setStatus(ref, previous);
            for (const id of cascaded) {
              get().setStatus({ taskId: id, occurrenceDate: null }, "TODO");
            }
          },
        );
    },

    /**
     * Move a task to another day (and optionally another time).
     *
     * This is what a drag across the calendar means, so it has to behave like
     * one: a four-day run dropped on a new day stays four days long, and a
     * timed task keeps its duration rather than collapsing to a point.
     */
    reschedule(taskId, dueDate, startTime) {
      const before = get().db.tasks.find((t) => t.id === taskId);
      if (!before) return;
      if (
        before.dueDate === dueDate &&
        (startTime === undefined || before.startTime === startTime)
      ) {
        return;
      }

      commit((db) => {
        const task = db.tasks.find((t) => t.id === taskId);
        if (!task) return db;
        const patch: TaskPatch = {
          dueDate,
          endDate: shiftedEnd(task, dueDate),
        };
        if (startTime !== undefined) {
          patch.startTime = startTime;
          patch.endTime = shiftedEndTime(task, startTime);
          // Dropped on a clock slot it is a timed task; dropped in the all-day
          // strip it is not. Either way the drop said so explicitly.
          patch.allDay = startTime === null;
        }
        const next = { ...task, ...patch, updatedAt: nowInstant() };
        return appendHistory(
          { ...db, tasks: db.tasks.map((t) => (t.id === taskId ? next : t)) },
          historyEntry({
            taskId,
            kind: "RESCHEDULED",
            field: "schedule",
            from: describeSchedule(task),
            to: describeSchedule(next),
          }),
        );
      });

      const updated = get().db.tasks.find((t) => t.id === taskId);
      if (updated) void syncTaskToCloud(updated);

      // Dropping a task on the wrong cell is a one-pixel mistake; taking it
      // back should not mean remembering which day it came from.
      useUndoStore.getState().push("undoneTaskMoved", () => {
        get().updateTask(taskId, {
          dueDate: before.dueDate,
          endDate: before.endDate ?? null,
          startTime: before.startTime,
          endTime: before.endTime,
        });
      });
    },

    /**
     * Spec section 8. A snooze always postpones. When the postponement lands on
     * a different day it *also* moves the task, and both facts are written to
     * history so the trail shows what happened and why.
     */
    snooze(instance, preset, customTarget) {
      const { settings } = get().db;
      const now = new Date(get().now);
      const outcome = resolveSnooze(
        instance,
        preset,
        settings,
        now,
        customTarget,
      );
      const ref = refOf(instance);

      commit((db) => {
        const task = db.tasks.find((t) => t.id === instance.task.id);
        if (!task) return db;

        let next = db;
        const entries: HistoryEntry[] = [
          historyEntry({
            taskId: task.id,
            kind: "SNOOZED",
            occurrenceDate: ref.occurrenceDate,
            field: "snoozedUntil",
            from: instance.snoozedUntil,
            to: outcome.until,
          }),
        ];

        if (outcome.reschedule) {
          const moved: Task = {
            ...task,
            dueDate: outcome.reschedule.date,
            startTime: outcome.reschedule.startTime,
            updatedAt: nowInstant(),
          };
          entries.push(
            historyEntry({
              taskId: task.id,
              kind: "RESCHEDULED",
              field: "schedule",
              from: describeSchedule(task),
              to: describeSchedule(moved),
              note: `Snoozed, moved to ${outcome.reschedule.date}`,
            }),
          );
          next = {
            ...next,
            tasks: next.tasks.map((t) => (t.id === task.id ? moved : t)),
          };
        }

        next = writeSnoozeUntil(next, ref, outcome.until);

        // A snoozed task must stop nagging: its reminders wait with it.
        next = {
          ...next,
          reminders: next.reminders.map((r) =>
            r.taskId === task.id
              ? {
                  ...r,
                  snoozedUntil: outcome.until,
                  status: "PENDING" as const,
                }
              : r,
          ),
        };
        return appendHistory(next, ...entries);
      });
    },

    clearSnooze(ref) {
      commit((db) => writeSnoozeUntil(db, ref, null));
    },

    addReminder(input) {
      const at = nowInstant();
      const reminder: Reminder = {
        ...input,
        id: createId("r"),
        status: "PENDING",
        snoozedUntil: null,
        lastFiredFor: null,
        createdAt: at,
        updatedAt: at,
      };
      commit((db) =>
        appendHistory(
          { ...db, reminders: [...db.reminders, reminder] },
          historyEntry({ taskId: reminder.taskId, kind: "REMINDER_ADDED" }),
        ),
      );
    },

    removeReminder(reminderId) {
      commit((db) => {
        const reminder = db.reminders.find((r) => r.id === reminderId);
        if (!reminder) return db;
        return appendHistory(
          {
            ...db,
            reminders: db.reminders.filter((r) => r.id !== reminderId),
            tombstones: pruneTombstones([
              ...db.tombstones,
              tombstone("reminder", reminderId, nowInstant()),
            ]),
          },
          historyEntry({ taskId: reminder.taskId, kind: "REMINDER_REMOVED" }),
        );
      });
    },

    markReminderFired(reminderId, occurrenceDate) {
      commit((db) => {
        const reminder = db.reminders.find((r) => r.id === reminderId);
        if (!reminder) return db;
        const task = db.tasks.find((t) => t.id === reminder.taskId);
        const recurring = task?.recurrence != null;
        const next: Reminder = {
          ...reminder,
          // A series keeps its reminder alive for the next occurrence.
          status: recurring ? "PENDING" : "FIRED",
          lastFiredFor: occurrenceDate ?? reminder.lastFiredFor,
          snoozedUntil: null,
          updatedAt: nowInstant(),
        };
        return appendHistory(
          {
            ...db,
            reminders: db.reminders.map((r) =>
              r.id === reminderId ? next : r,
            ),
          },
          historyEntry({
            taskId: reminder.taskId,
            kind: "REMINDER_FIRED",
            occurrenceDate: occurrenceDate ?? null,
          }),
        );
      });
    },

    snoozeReminder(reminderId, until) {
      commit((db) => ({
        ...db,
        reminders: db.reminders.map((r) =>
          r.id === reminderId
            ? {
                ...r,
                snoozedUntil: until,
                status: "PENDING" as const,
                updatedAt: nowInstant(),
              }
            : r,
        ),
      }));
    },

    dismissReminder(reminderId) {
      commit((db) => ({
        ...db,
        reminders: db.reminders.map((r) =>
          r.id === reminderId
            ? { ...r, status: "DISMISSED" as const, updatedAt: nowInstant() }
            : r,
        ),
      }));
    },

    startFocus(instance) {
      const state = get();
      if (state.runningFocus) state.stopFocus();

      const session: FocusSession = {
        id: createId("f"),
        taskId: instance.task.id,
        occurrenceDate: instance.isRecurring ? instance.date : null,
        startedAt: nowInstant(),
        endedAt: null,
        durationSec: 0,
      };
      set({
        runningFocus: {
          sessionId: session.id,
          taskId: session.taskId,
          occurrenceDate: session.occurrenceDate,
          startedAt: session.startedAt,
        },
      });
      commit((db) => {
        const withSession = {
          ...db,
          focusSessions: [...db.focusSessions, session],
        };
        // Working on something is the definition of IN_PROGRESS.
        return instance.storedStatus === "TODO"
          ? applyStatus(withSession, refOf(instance), "IN_PROGRESS")
          : withSession;
      });
    },

    stopFocus() {
      const running = get().runningFocus;
      if (!running) return;
      const endedAt = new Date();
      const durationSec = Math.max(
        0,
        Math.round(
          (endedAt.getTime() - new Date(running.startedAt).getTime()) / 1000,
        ),
      );
      set({ runningFocus: null });
      commit((db) =>
        appendHistory(
          {
            ...db,
            focusSessions: db.focusSessions.map((s) =>
              s.id === running.sessionId
                ? { ...s, endedAt: toInstant(endedAt), durationSec }
                : s,
            ),
          },
          historyEntry({
            taskId: running.taskId,
            kind: "FOCUS_LOGGED",
            occurrenceDate: running.occurrenceDate,
            note: `Focused for ${Math.max(1, Math.round(durationSec / 60))} min`,
          }),
        ),
      );
    },

    /*
     * Every one of these leaves a tombstone behind.
     *
     * A session that is merely absent locally is indistinguishable from one
     * this device has not downloaded yet, so the next sync helpfully hands it
     * back — which is exactly what deleting a session used to look like. The
     * tombstone is what makes the deletion a fact the cloud has to honour.
     */
    cancelFocus() {
      const running = get().runningFocus;
      if (!running) return;
      set({ runningFocus: null });
      const at = nowInstant();
      commit((db) => ({
        ...db,
        focusSessions: db.focusSessions.filter(
          (s) => s.id !== running.sessionId,
        ),
        tombstones: pruneTombstones([
          ...db.tombstones,
          tombstone("focus", running.sessionId, at),
        ]),
      }));
    },

    deleteFocusSession(sessionId) {
      const at = nowInstant();
      if (get().runningFocus?.sessionId === sessionId) set({ runningFocus: null });
      commit((db) =>
        db.focusSessions.some((s) => s.id === sessionId)
          ? {
              ...db,
              focusSessions: db.focusSessions.filter((s) => s.id !== sessionId),
              tombstones: pruneTombstones([
                ...db.tombstones,
                tombstone("focus", sessionId, at),
              ]),
            }
          : db,
      );
    },

    clearFocusSessions() {
      set({ runningFocus: null });
      const at = nowInstant();
      commit((db) => ({
        ...db,
        focusSessions: [],
        tombstones: pruneTombstones([
          ...db.tombstones,
          ...db.focusSessions.map((s) => tombstone("focus", s.id, at)),
        ]),
      }));
    },

    addCategory(name, color) {
      const trimmed = name.trim();
      const existing = trimmed
        ? get().db.categories.find(
            (c) => c.name.toLowerCase() === trimmed.toLowerCase(),
          )
        : null;
      if (existing) {
        get().updateCategory(existing.id, { color });
        return existing;
      }
      const category: Category = {
        id: createId("c"),
        name: trimmed || "New Category",
        color,
        order: get().db.categories.length,
      };
      commit((db) => ({ ...db, categories: [...db.categories, category] }));
      return category;
    },

    updateCategory(id, patch) {
      commit((db) => ({
        ...db,
        categories: db.categories.map((c) =>
          c.id === id ? { ...c, ...patch } : c,
        ),
      }));
    },

    removeCategory(id) {
      const at = nowInstant();
      commit((db) => ({
        ...db,
        categories: db.categories.filter((c) => c.id !== id),
        tasks: db.tasks.map((t) =>
          t.categoryId === id ? { ...t, categoryId: null, updatedAt: at } : t,
        ),
        tombstones: pruneTombstones([
          ...db.tombstones,
          tombstone("category", id, at),
        ]),
      }));
      void syncDeleteCategoryToCloud(id);
    },

    /**
     * Rewrite one parent's sibling order from a list of ids.
     *
     * The caller sends the whole order rather than a from/to pair, so a drag
     * that crossed several rows is one write and the stored `order` values stay
     * a dense 0..n-1 run instead of drifting apart.
     *
     * No history entry: the trail records what happened to a task's schedule and
     * status, and a row that only changed places would bury those in noise.
     */
    makePlan(taskId) {
      const task = get().db.tasks.find((t) => t.id === taskId);
      if (!task || (task.tags.includes("plan") && task.parentId === null))
        return;
      if (task.parentId !== null) get().setParent(taskId, null);
      get().updateTask(taskId, {
        tags: [...task.tags.filter((tag) => tag !== "plan"), "plan"],
        dueDate: null,
        startTime: null,
        endTime: null,
        allDay: true,
      });
    },

    setParent(taskId, parentId) {
      const before = get().db;
      const task = before.tasks.find((t) => t.id === taskId);
      if (!task || (task.parentId ?? null) === parentId) return;
      if (parentId !== null) {
        const parent = before.tasks.find((t) => t.id === parentId);
        // Refusing a descendant is what keeps the tree a tree.
        if (
          !parent ||
          collectSubtree(before.tasks, taskId).includes(parentId)
        ) {
          return;
        }
      }

      commit((db) => {
        const siblings = db.tasks.filter(
          (t) => (t.parentId ?? null) === parentId && t.id !== taskId,
        );
        const at = nowInstant();
        /*
         * Moving a task into a plan moves it into the plan's category — that is
         * what "this belongs to the thesis now" means, and it is the whole
         * reason the task was dragged there.
         *
         * A plan with no category of its own claims nothing: clearing the
         * task's category would destroy information to express nothing.
         */
        const adopted =
          parentId === null
            ? null
            : (db.tasks.find((t) => t.id === parentId)?.categoryId ?? null);
        const categoryId = adopted ?? task.categoryId;

        const next: Task = {
          ...task,
          parentId,
          categoryId,
          order: siblings.length,
          // The pin it carried belonged to the list it just left.
          manualOrder: null,
          updatedAt: at,
        };

        // Whatever hung below the task comes with it.
        const followers = new Set(
          collectSubtree(db.tasks, taskId).filter(
            (id) =>
              id !== taskId &&
              db.tasks.find((t) => t.id === id)?.categoryId !== categoryId,
          ),
        );
        const parentTitle =
          parentId === null
            ? null
            : (db.tasks.find((t) => t.id === parentId)?.title ?? "");
        return appendHistory(
          {
            ...db,
            tasks: db.tasks.map((t) =>
              t.id === taskId
                ? next
                : followers.has(t.id)
                  ? { ...t, categoryId, updatedAt: at }
                  : t,
            ),
          },
          historyEntry({
            taskId,
            kind: "UPDATED",
            field: "parent",
            note:
              parentTitle === null
                ? `Detached from "${
                    before.tasks.find((t) => t.id === task.parentId)?.title ??
                    ""
                  }"`
                : `Filed under "${parentTitle}"`,
          }),
        );
      });

      // The subtree may have changed category along with the move.
      syncSubtree(get().db, taskId);
    },

    reorderSubtasks(parentId, orderedIds) {
      commit((db) => {
        const position = new Map(orderedIds.map((id, index) => [id, index]));
        const at = nowInstant();
        return {
          ...db,
          tasks: db.tasks.map((task) => {
            const next =
              task.parentId === parentId ? position.get(task.id) : undefined;
            return next === undefined || next === task.order
              ? task
              : { ...task, order: next, updatedAt: at };
          }),
        };
      });
    },

    /**
     * Pin the dragged row, and re-pin whatever was already pinned.
     *
     * Re-pinning matters: a pin is a slot, so leaving the old ones on their
     * stale numbers would let two rows claim one slot and the list would settle
     * somewhere other than where the user let go.
     *
     * `updatedAt` is deliberately left alone. A pin never leaves this device,
     * and bumping the clock for it would hand this device a win in every
     * last-write-wins merge over an edit another device really made.
     */
    reorderTasks(orderedIds, movedId) {
      commit((db) => {
        const position = new Map(orderedIds.map((id, index) => [id, index]));
        return {
          ...db,
          tasks: db.tasks.map((task) => {
            const slot = position.get(task.id);
            if (slot === undefined) return task;
            const pinned = task.id === movedId || pinOf(task) !== null;
            const next = pinned ? slot : null;
            return next === pinOf(task) ? task : { ...task, manualOrder: next };
          }),
        };
      });
    },

    clearManualOrder(taskIds) {
      const ids = new Set(taskIds);
      commit((db) => ({
        ...db,
        tasks: db.tasks.map((task) =>
          ids.has(task.id) && pinOf(task) !== null
            ? { ...task, manualOrder: null }
            : task,
        ),
      }));
    },

    /* Bulk ------------------------------------------------------------ */

    bulkUpdateTasks(taskIds, patch) {
      for (const taskId of [...new Set(taskIds)]) get().updateTask(taskId, patch);
    },

    bulkSetStatus(taskIds, status) {
      const unique = [...new Set(taskIds)];
      if (unique.length === 0) return;
      if (status === "COMPLETED") fireConfetti({ particleCount: 65 });

      const now = new Date(get().now);

      // Folded into one commit so the list re-sorts once rather than once per
      // task, which is the difference between a tick and a cascade of jumps.
      commit((db) => {
        // Rebuilt per reduction step: an earlier task in the batch may have
        // just written the occurrence row a later one reads.
        const refFor = (current: Database, taskId: string): InstanceRef | null => {
          const task = current.tasks.find((t) => t.id === taskId);
          if (!task) return null;
          // A repeating task keeps its status per occurrence — writing the
          // task row instead would be invisible in every view, since
          // `toInstance` reads the occurrence and ignores `task.status`. The
          // occurrence chosen is the one the row was showing: the first that
          // is not already done.
          if (!task.recurrence) return { taskId, occurrenceDate: null };
          const occurrences = new Map(
            current.occurrences.map((occurrence) => [occurrence.id, occurrence]),
          );
          return refOf(representativeInstance(task, occurrences, now));
        };

        return unique.reduce((acc, taskId) => {
          const ref = refFor(acc, taskId);
          return ref ? applyStatus(acc, ref, status) : acc;
        }, db);
      });
      for (const taskId of unique) syncSubtree(get().db, taskId);
    },

    bulkDeleteTasks(taskIds) {
      const unique = [...new Set(taskIds)];
      if (unique.length === 0) return;

      commit((db) => {
        const at = nowInstant();
        // A subtree per selected task, unioned: picking a plan *and* one of its
        // steps must not trash — or history — that step twice.
        const ids = new Set(
          unique.flatMap((taskId) => collectSubtree(db.tasks, taskId)),
        );
        const entries = [...ids].map((id) =>
          historyEntry({ taskId: id, kind: "DELETED", note: "Moved to trash" }),
        );
        return appendHistory(
          {
            ...db,
            tasks: db.tasks.map((t) =>
              ids.has(t.id) ? { ...t, deletedAt: at, updatedAt: at } : t,
            ),
          },
          ...entries,
        );
      });

      for (const taskId of unique) syncSubtree(get().db, taskId);

      useUndoStore.getState().push("undoneTasksDeleted", () => {
        for (const taskId of unique) get().restoreTask(taskId);
      });
    },

    /* Budget ---------------------------------------------------------- */

    addTransaction(draft) {
      const at = nowInstant();
      const transaction: Transaction = {
        id: createId("x"),
        date: draft.date,
        // The sign lives in `flow`, never in the number: a negative "expense"
        // would quietly become income in every total.
        amountMinor: Math.abs(Math.round(draft.amountMinor)),
        flow: draft.flow,
        categoryId: draft.categoryId,
        note: draft.note?.trim() ?? "",
        recurrence: draft.recurrence ?? null,
        recurrenceSourceId: null,
        lastGeneratedFor: null,
        account: draft.account?.trim() || null,
        merchant: draft.merchant?.trim() || null,
        origin: draft.origin ?? "manual",
        externalId: draft.externalId ?? null,
        // One charge is not a plan: anything under two months is stored as the
        // ordinary purchase it is, so no view has to special-case "1/1".
        instalments:
          draft.instalments && draft.instalments > 1
            ? Math.trunc(draft.instalments)
            : null,
        // Nothing typed or pushed is confirmed. Only a statement can say what
        // a purchase finally cost.
        confirmedAt: null,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      };
      commit((db) => ({
        ...db,
        transactions: [...db.transactions, transaction],
      }));
      return transaction;
    },

    updateTransaction(id, patch) {
      commit((db) => ({
        ...db,
        transactions: db.transactions.map((t) =>
          t.id === id
            ? {
                ...t,
                ...patch,
                amountMinor:
                  patch.amountMinor === undefined
                    ? t.amountMinor
                    : Math.abs(Math.round(patch.amountMinor)),
                updatedAt: nowInstant(),
              }
            : t,
        ),
      }));
    },

    /**
     * Soft delete, like a task.
     *
     * A month's totals are a record of what happened. Erasing a row outright
     * would silently rewrite last month's number with no way to notice.
     */
    deleteTransaction(id) {
      const at = nowInstant();
      commit((db) => ({
        ...db,
        transactions: db.transactions.map((t) =>
          t.id === id ? { ...t, deletedAt: at, updatedAt: at } : t,
        ),
      }));
      useUndoStore
        .getState()
        .push("undoneTransactionDeleted", () => get().restoreTransaction(id));
    },

    restoreTransaction(id) {
      const at = nowInstant();
      commit((db) => ({
        ...db,
        transactions: db.transactions.map((t) =>
          t.id === id ? { ...t, deletedAt: null, updatedAt: at } : t,
        ),
      }));
    },

    /**
     * The "enum that grows".
     *
     * A category the user types is looked up by name first, so typing "Kahve"
     * twice files both entries under one label instead of creating a second
     * identical row. What they type once becomes a permanent choice for them.
     */
    ensureBudgetCategory(name, flow) {
      const trimmed = name.trim();
      const existing = trimmed
        ? get().db.budgetCategories.find(
            (c) => c.name.toLowerCase() === trimmed.toLowerCase(),
          )
        : null;
      if (existing) return existing;

      const all = get().db.budgetCategories;
      const category: BudgetCategory = {
        id: createId("b"),
        name: trimmed || "Diğer",
        flow,
        color:
          BUDGET_CATEGORY_COLORS[all.length % BUDGET_CATEGORY_COLORS.length] ??
          "#64748b",
        icon: flow === "INCOME" ? "💰" : flow === "INVESTMENT" ? "📈" : "🏷️",
        builtIn: false,
        order: all.length,
        updatedAt: nowInstant(),
      };
      commit((db) => ({
        ...db,
        budgetCategories: [...db.budgetCategories, category],
      }));
      return category;
    },

    updateBudgetCategory(id, patch) {
      commit((db) => ({
        ...db,
        budgetCategories: db.budgetCategories.map((c) =>
          c.id === id
            ? {
                ...c,
                ...patch,
                name: (patch.name ?? c.name).trim(),
                updatedAt: nowInstant(),
              }
            : c,
        ),
      }));
    },

    /** Transactions filed under it keep their history, minus the label. */
    removeBudgetCategory(id) {
      const at = nowInstant();
      const removed = get().db.budgetCategories.find((c) => c.id === id);
      const filedUnderIt = get()
        .db.transactions.filter((t) => t.categoryId === id)
        .map((t) => t.id);
      commit((db) => ({
        ...db,
        budgetCategories: db.budgetCategories.filter((c) => c.id !== id),
        transactions: db.transactions.map((t) =>
          t.categoryId === id ? { ...t, categoryId: null, updatedAt: at } : t,
        ),
        tombstones: pruneTombstones([
          ...db.tombstones,
          tombstone("category", id, at),
        ]),
      }));

      if (removed) {
        // Putting the label back is not enough — the entries that were filed
        // under it have to find their way home too.
        const orphaned = new Set(filedUnderIt);
        useUndoStore.getState().push("undoneCategoryRemoved", () => {
          const at2 = nowInstant();
          commit((db) => ({
            ...db,
            budgetCategories: [
              ...db.budgetCategories,
              { ...removed, updatedAt: at2 },
            ],
            transactions: db.transactions.map((t) =>
              orphaned.has(t.id) ? { ...t, categoryId: id, updatedAt: at2 } : t,
            ),
            tombstones: db.tombstones.filter(
              (stone) => !(stone.kind === "category" && stone.id === id),
            ),
          }));
        });
      }
    },

    /**
     * Move unfinished work forward instead of letting it rot in the past.
     *
     * The most common way a task list dies is that yesterday's undone items sit
     * there accusing the user until they stop opening the app. Rolling them
     * forward is a deliberate, one-click act — never automatic, because a task
     * that silently moves itself is a task whose real due date you can no
     * longer trust — and every move is written to history like any reschedule.
     *
     * A recurring series is skipped: its dates come from its rule, and dragging
     * the anchor would move every future occurrence too.
     */
    rollOverTo(taskIds, date) {
      const wanted = new Set(taskIds);
      const eligible = get().db.tasks.filter(
        (t) =>
          wanted.has(t.id) &&
          t.deletedAt === null &&
          t.recurrence === null &&
          t.status !== "COMPLETED" &&
          t.dueDate !== null &&
          t.dueDate < date,
      );
      if (eligible.length === 0) return 0;

      const movedIds = new Set(eligible.map((t) => t.id));
      const at = nowInstant();

      commit((db) => {
        const entries: HistoryEntry[] = [];
        const tasks = db.tasks.map((task) => {
          if (!movedIds.has(task.id)) return task;
          const moved: Task = {
            ...task,
            dueDate: date,
            // A run that never finished restarts today rather than keeping an
            // end date that is now behind its own start.
            endDate:
              task.endDate && task.endDate < date
                ? null
                : (task.endDate ?? null),
            snoozedUntil: null,
            updatedAt: at,
          };
          entries.push(
            historyEntry({
              taskId: task.id,
              kind: "RESCHEDULED",
              field: "schedule",
              from: describeSchedule(task),
              to: describeSchedule(moved),
              note: "Rolled over",
            }),
          );
          return moved;
        });
        return appendHistory({ ...db, tasks }, ...entries);
      });

      for (const task of get().db.tasks) {
        if (movedIds.has(task.id)) void syncTaskToCloud(task);
      }

      // Remember where each one came from: a bulk move is exactly the kind of
      // action people want back the second they see what it did.
      const before = new Map(eligible.map((t) => [t.id, t.dueDate]));
      useUndoStore.getState().push("undoneRolledOver", () => {
        const at2 = nowInstant();
        commit((db) => ({
          ...db,
          tasks: db.tasks.map((task) => {
            const original = before.get(task.id);
            return original === undefined
              ? task
              : { ...task, dueDate: original, updatedAt: at2 };
          }),
        }));
        for (const task of get().db.tasks) {
          if (before.has(task.id)) void syncTaskToCloud(task);
        }
      });

      return movedIds.size;
    },

    ensureCategoriesForKeys(keys) {
      const language = get().db.settings.language ?? "tr";
      const mapping: Record<string, string> = {};

      for (const key of keys) {
        const entry = CATEGORY_CATALOGUE[key];
        if (!entry) continue;
        // Both spellings count as "already there": a document started in
        // English holds "Groceries", and adding "Market" beside it would split
        // the very total the import exists to build.
        const wanted = [entry.tr, entry.en].map((name) =>
          name.toLocaleLowerCase("tr"),
        );
        const existing = get().db.budgetCategories.find((category) =>
          wanted.includes(category.name.trim().toLocaleLowerCase("tr")),
        );
        if (existing) {
          mapping[key] = existing.id;
          continue;
        }

        const at = nowInstant();
        const created: BudgetCategory = {
          id: createId("b"),
          name: language === "tr" ? entry.tr : entry.en,
          flow: entry.flow,
          color: entry.color,
          icon: entry.icon,
          // Created by the import, so the user may delete it like their own.
          builtIn: false,
          order: get().db.budgetCategories.length,
          updatedAt: at,
        };
        commit((db) => ({
          ...db,
          budgetCategories: [...db.budgetCategories, created],
        }));
        mapping[key] = created.id;
      }
      return mapping;
    },

    /**
     * Write a confirmed statement import.
     *
     * One commit for the whole file: a statement is a hundred rows, and a
     * hundred separate writes would be a hundred renders and a hundred disk
     * flushes for what the user experienced as a single action.
     */
    importTransactions(drafts, merges = [], batchInfo) {
      if (drafts.length === 0 && merges.length === 0) return 0;

      const taken = new Set(
        get()
          .db.transactions.filter((t) => t.deletedAt === null && t.externalId)
          .map((t) => t.externalId as string),
      );
      // The preview may have been built minutes ago; the ledger is the
      // authority on what is already in it.
      const fresh = drafts.filter((draft) => !taken.has(draft.externalId));
      // A merge whose fingerprint has since been written by another import is
      // no longer a merge; the row it would settle is already settled.
      const settling = merges.filter(
        (merge) => !taken.has(merge.patch.externalId),
      );
      if (fresh.length === 0 && settling.length === 0) return 0;

      const at = nowInstant();
      const batchId = createId("imp");
      const created: Transaction[] = fresh.map((draft) => ({
        id: createId("x"),
        date: draft.date,
        amountMinor: draft.amountMinor,
        flow: draft.flow,
        categoryId: draft.categoryId,
        note: draft.note,
        merchant: draft.merchant,
        externalId: draft.externalId,
        importId: batchId,
        recurrence: null,
        recurrenceSourceId: null,
        lastGeneratedFor: null,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      }));

      /*
       * The entries this statement settles rather than repeats.
       *
       * Their previous shape is kept so undo can put them back exactly as they
       * were: a merge edits a row the user wrote, and an undo that left the
       * bank's merchant and fingerprint behind would not be an undo.
       */
      const patchById = new Map(
        settling.map((merge) => [merge.entryId, merge.patch]),
      );
      const before = new Map(
        get()
          .db.transactions.filter((entry) => patchById.has(entry.id))
          .map((entry) => [entry.id, entry] as const),
      );

      /*
       * The import itself, written down.
       *
       * The undo toast below is seconds long, and importing the same file twice
       * is a mistake nobody notices in seconds — it shows up when the month's
       * total is read the next day. The batch is what makes "geri al" still
       * available then, and it carries the settled rows' previous shape for the
       * same reason the toast does: undoing a merge has to put a row back, not
       * take it away.
       */
      const dates = [
        ...created.map((entry) => entry.date),
        ...[...before.values()].map((entry) => entry.date),
      ].sort();
      const batch: StatementBatch = {
        id: batchId,
        label: batchInfo?.label?.trim() || "Ekstre",
        account: batchInfo?.account ?? null,
        importedAt: at,
        from: batchInfo?.from ?? dates[0] ?? at.slice(0, 10),
        to: batchInfo?.to ?? dates[dates.length - 1] ?? at.slice(0, 10),
        mode: batchInfo?.mode ?? "rows",
        createdCount: created.length,
        createdMinor: created.reduce((sum, entry) => sum + entry.amountMinor, 0),
        settled: [...before.values()].map(snapshotOf),
        revertedAt: null,
        deletedAt: null,
      };

      commit((db) => ({
        ...db,
        statementBatches: [...db.statementBatches, batch],
        transactions: [
          ...db.transactions.map((entry) => {
            const patch = patchById.get(entry.id);
            return patch ? { ...entry, ...patch, updatedAt: at } : entry;
          }),
          ...created,
        ],
      }));

      // A hundred rows landing in the wrong month is exactly the mistake
      // someone wants back immediately, and undoing it row by row is no undo.
      // One reversal, two doors: the toast now runs exactly what the list in
      // the budget view runs, so the two can never drift into disagreeing.
      useUndoStore
        .getState()
        .push("undoneImport", () => void get().revertImport(batchId));

      return created.length + settling.length;
    },

    revertImport(batchId) {
      const db = get().db;
      const batch = db.statementBatches.find((b) => b.id === batchId);
      if (!batch || !batchIsLive(batch)) return 0;

      const at = nowInstant();
      const snapshots = new Map(batch.settled.map((snap) => [snap.id, snap]));
      let touched = 0;

      commit((next) => ({
        ...next,
        statementBatches: next.statementBatches.map((b) =>
          b.id === batchId ? { ...b, revertedAt: at } : b,
        ),
        transactions: next.transactions.map((entry) => {
          /*
           * Rows this import created go back to deleted — soft, so they are in
           * the trash rather than gone, and skipped when the user has already
           * removed them by hand.
           */
          if (entry.importId === batchId) {
            if (entry.deletedAt !== null) return entry;
            touched += 1;
            return { ...entry, deletedAt: at, updatedAt: at };
          }

          /*
           * Rows it stamped go back to what they were. `deletedAt` is
           * deliberately not restored: if the user has thrown one away since,
           * un-deleting it here would resurrect a row they meant to be rid of.
           */
          const snap = snapshots.get(entry.id);
          if (!snap || entry.deletedAt !== null) return entry;
          touched += 1;
          return { ...entry, ...restorePatch(snap), updatedAt: at };
        }),
      }));

      return touched;
    },

    convertToNote(taskId) {
      const db = get().db;
      const task = db.tasks.find((t) => t.id === taskId);
      if (!task || task.deletedAt !== null || task.tags.includes(NOTE_TAG)) {
        return false;
      }
      // Refused rather than fudged: nothing renders the children of a note.
      const hasSubtasks = db.tasks.some(
        (t) => t.parentId === taskId && t.deletedAt === null,
      );
      if (hasSubtasks) return false;

      const at = nowInstant();
      const before = {
        tags: task.tags,
        dueDate: task.dueDate,
        endDate: task.endDate ?? null,
        deadline: task.deadline ?? null,
        recurrence: task.recurrence,
        startTime: task.startTime,
        endTime: task.endTime,
        allDay: task.allDay,
      };
      /*
       * The reminders go with the schedule they were set against.
       *
       * A RELATIVE one has nothing left to count back from once the date is
       * gone, and an ABSOLUTE one would go on firing for something that now
       * lives in Notes and shows nowhere else. They are handed to the undo
       * whole, so taking this back really does take all of it back.
       */
      const dropped = db.reminders.filter((r) => r.taskId === taskId);

      commit((next) =>
        appendHistory(
          {
            ...next,
            tasks: next.tasks.map((t) =>
              t.id === taskId
                ? {
                    ...t,
                    tags: [...t.tags.filter((tag) => tag !== NOTE_TAG), NOTE_TAG],
                    dueDate: null,
                    endDate: null,
                    deadline: null,
                    recurrence: null,
                    startTime: null,
                    endTime: null,
                    allDay: true,
                    updatedAt: at,
                  }
                : t,
            ),
            reminders: next.reminders.filter((r) => r.taskId !== taskId),
          },
          historyEntry({
            taskId,
            kind: "UPDATED",
            field: "type",
            from: "task",
            to: "note",
          }),
        ),
      );

      useUndoStore.getState().push("undoneConvertedToNote", () => {
        const at2 = nowInstant();
        commit((next) => ({
          ...next,
          tasks: next.tasks.map((t) =>
            t.id === taskId ? { ...t, ...before, updatedAt: at2 } : t,
          ),
          reminders: [
            ...next.reminders.filter((r) => r.taskId !== taskId),
            ...dropped,
          ],
        }));
      });

      return true;
    },

    addDeadline(draft) {
      // A checkpoint with no name is a bare date nobody can act on, so an
      // empty label is refused here rather than stored and hidden later.
      const label = normaliseLabel(draft.label);
      if (!label || !draft.date) return null;

      const at = nowInstant();
      const deadline: Deadline = {
        id: createId("dl"),
        taskId: draft.taskId,
        label,
        date: draft.date,
        completedAt: null,
        // Only ever a tie-breaker between two checkpoints on one day; the list
        // itself is ordered by date, which is the order dates come in.
        order: get().db.deadlines.filter((d) => d.taskId === draft.taskId).length,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      };
      commit((db) =>
        appendHistory(
          { ...db, deadlines: [...db.deadlines, deadline] },
          historyEntry({
            taskId: deadline.taskId,
            kind: "DEADLINE_ADDED",
            field: deadline.label,
            to: deadline.date,
          }),
        ),
      );
      return deadline;
    },

    updateDeadline(id, patch) {
      const at = nowInstant();
      const previous = get().db.deadlines.find((d) => d.id === id);
      if (!previous) return;
      const label =
        patch.label === undefined
          ? previous.label
          : (normaliseLabel(patch.label) ?? previous.label);
      const date = patch.date || previous.date;

      commit((db) => {
        const next = {
          ...db,
          deadlines: db.deadlines.map((d) =>
            d.id === id ? { ...d, ...patch, label, date, updatedAt: at } : d,
          ),
        };
        // Moving a checkpoint is the kind of edit people forget making, so the
        // trail records the move itself rather than just that something changed.
        return date === previous.date
          ? next
          : appendHistory(
              next,
              historyEntry({
                taskId: previous.taskId,
                kind: "RESCHEDULED",
                field: label,
                from: previous.date,
                to: date,
              }),
            );
      });
    },

    setDeadlineMet(id, met) {
      const at = nowInstant();
      const previous = get().db.deadlines.find((d) => d.id === id);
      if (!previous || (previous.completedAt !== null) === met) return;
      commit((db) => {
        const next = {
          ...db,
          deadlines: db.deadlines.map((d) =>
            d.id === id ? { ...d, completedAt: met ? at : null, updatedAt: at } : d,
          ),
        };
        return met
          ? appendHistory(
              next,
              historyEntry({
                taskId: previous.taskId,
                kind: "DEADLINE_MET",
                field: previous.label,
                to: previous.date,
              }),
            )
          : next;
      });
    },

    removeDeadline(id) {
      const at = nowInstant();
      const previous = get().db.deadlines.find((d) => d.id === id);
      if (!previous) return;
      commit((db) =>
        appendHistory(
          {
            ...db,
            deadlines: db.deadlines.map((d) =>
              d.id === id ? { ...d, deletedAt: at, updatedAt: at } : d,
            ),
          },
          historyEntry({
            taskId: previous.taskId,
            kind: "DEADLINE_REMOVED",
            field: previous.label,
            from: previous.date,
          }),
        ),
      );
      useUndoStore.getState().push("undoneDeadlineRemoved", () => {
        const at2 = nowInstant();
        commit((db) => ({
          ...db,
          deadlines: db.deadlines.map((d) =>
            d.id === id ? { ...d, deletedAt: null, updatedAt: at2 } : d,
          ),
        }));
      });
    },

    addWishlistItem(draft) {
      const at = nowInstant();
      const item: WishlistItem = {
        id: createId("w"),
        title: draft.title.trim(),
        priceMinor:
          typeof draft.priceMinor === "number" && Number.isFinite(draft.priceMinor)
            ? Math.abs(Math.round(draft.priceMinor))
            : null,
        url: normaliseLink(draft.url ?? ""),
        note: draft.note?.trim() ?? "",
        categoryId: draft.categoryId ?? null,
        // Newest first is wrong for a shopping list — the thing you added last
        // is the thing you are still thinking about — so it goes on the end.
        order: get().db.wishlist.length,
        boughtAt: null,
        transactionId: null,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      };
      commit((db) => ({ ...db, wishlist: [...db.wishlist, item] }));
      return item;
    },

    updateWishlistItem(id, patch) {
      const at = nowInstant();
      commit((db) => ({
        ...db,
        wishlist: db.wishlist.map((item) =>
          item.id === id
            ? {
                ...item,
                ...patch,
                title: patch.title === undefined ? item.title : patch.title.trim(),
                priceMinor:
                  patch.priceMinor === undefined
                    ? item.priceMinor
                    : patch.priceMinor === null
                      ? null
                      : Math.abs(Math.round(patch.priceMinor)),
                url: patch.url === undefined ? item.url : normaliseLink(patch.url ?? ""),
                updatedAt: at,
              }
            : item,
        ),
      }));
    },

    removeWishlistItem(id) {
      const at = nowInstant();
      const previous = get().db.wishlist.find((item) => item.id === id);
      if (!previous) return;
      commit((db) => ({
        ...db,
        wishlist: db.wishlist.map((item) =>
          item.id === id ? { ...item, deletedAt: at, updatedAt: at } : item,
        ),
      }));
      useUndoStore.getState().push("undoneWishlistRemoved", () => {
        const at2 = nowInstant();
        commit((db) => ({
          ...db,
          wishlist: db.wishlist.map((item) =>
            item.id === id ? { ...item, deletedAt: null, updatedAt: at2 } : item,
          ),
        }));
      });
    },

    buyWishlistItem(id, date) {
      const item = get().db.wishlist.find((each) => each.id === id);
      if (!item || item.deletedAt !== null || item.boughtAt !== null) return null;
      if (item.priceMinor === null || item.priceMinor === 0) return null;

      const transaction = get().addTransaction({
        date: date ?? toLocalDate(new Date(get().now)),
        amountMinor: item.priceMinor,
        flow: "EXPENSE",
        categoryId: item.categoryId,
        // The name it was wanted under is the name it is remembered by.
        note: item.title,
      });

      const at = nowInstant();
      commit((db) => ({
        ...db,
        wishlist: db.wishlist.map((each) =>
          each.id === id
            ? { ...each, boughtAt: at, transactionId: transaction.id, updatedAt: at }
            : each,
        ),
      }));

      // One act, one reversal: the entry goes back out of the ledger and the
      // item back onto the list. Undoing half of it would leave the budget
      // charged for something the list still says has not been bought.
      useUndoStore.getState().push("undoneWishlistBought", () => {
        const at2 = nowInstant();
        commit((db) => ({
          ...db,
          transactions: db.transactions.map((entry) =>
            entry.id === transaction.id
              ? { ...entry, deletedAt: at2, updatedAt: at2 }
              : entry,
          ),
          wishlist: db.wishlist.map((each) =>
            each.id === id
              ? { ...each, boughtAt: null, transactionId: null, updatedAt: at2 }
              : each,
          ),
        }));
      });

      return transaction;
    },

    markSpendNudged(date) {
      commit((db) => ({
        ...db,
        settings: { ...db.settings, lastSpendNudgeOn: date },
      }));
    },

    /**
     * Catch the budget up on everything its templates owe.
     *
     * Run on open rather than on a timer: the app may have been closed for a
     * month, and the answer has to be the same either way. Producing them one
     * at a time through the same code path an ordinary entry takes means a
     * generated entry is in no way special — it can be edited, deleted or
     * recategorised like any other.
     */
    materialiseRecurringTransactions(through) {
      const due = dueRecurringTransactions(get().db.transactions, through);
      if (due.length === 0) return 0;

      const at = nowInstant();
      const created: Transaction[] = due.map(({ source, date }) => ({
        id: createId("x"),
        date,
        amountMinor: source.amountMinor,
        flow: source.flow,
        categoryId: source.categoryId,
        note: source.note,
        // The copy is a plain entry: only the template carries the rule, so a
        // generated entry can never start generating entries of its own.
        recurrence: null,
        recurrenceSourceId: source.id,
        lastGeneratedFor: null,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      }));

      // Remember how far each template has got, or the next run repeats itself.
      const advancedTo = new Map<string, LocalDate>();
      for (const { source, date } of due) {
        const current = advancedTo.get(source.id);
        if (!current || date > current) advancedTo.set(source.id, date);
      }

      commit((db) => ({
        ...db,
        transactions: [
          ...db.transactions.map((t) => {
            const mark = advancedTo.get(t.id);
            return mark === undefined
              ? t
              : { ...t, lastGeneratedFor: mark, updatedAt: at };
          }),
          ...created,
        ],
      }));

      return created.length;
    },

    updateSettings(patch) {
      commit((db) => ({ ...db, settings: { ...db.settings, ...patch } }));
    },

    /**
     * Discard the activity trail.
     *
     * This does not weaken the append-only rule (spec section 5.5): that rule
     * binds the *app*, which may never rewrite or drop an entry as a side
     * effect of rescheduling or completing something. Erasing the trail on an
     * explicit request from the person it belongs to is a different act.
     */
    clearHistory() {
      commit((db) => ({ ...db, history: [] }));
    },

    /** Purge every trashed task at once; the same hard delete as purgeTask. */
    emptyTrash() {
      const trashed = get().db.tasks.filter((t) => t.deletedAt !== null);
      const ids = trashed.map((t) => t.id);
      if (ids.length === 0) return;

      const at = nowInstant();
      commit((db) => {
        const idSet = new Set(ids);
        return {
          ...db,
          tasks: db.tasks.filter((t) => !idSet.has(t.id)),
          occurrences: db.occurrences.filter((o) => !idSet.has(o.taskId)),
          reminders: db.reminders.filter((r) => !idSet.has(r.taskId)),
          tombstones: pruneTombstones([
            ...db.tombstones,
            ...ids.map((id) => tombstone("task", id, at)),
          ]),
        };
      });

      for (const id of ids) {
        void syncDeleteTaskToCloud(id);
      }
    },

    /**
     * Back to a fresh install: tasks, reminders, history and settings all go.
     *
     * Awaited rather than debounced so the caller can report a failed write
     * instead of showing an empty app over a file that still holds everything.
     */
    async resetDatabase() {
      const db = emptyDatabase();
      set({ db, runningFocus: null, now: Date.now() });
      await persistNow(db);
    },
  };
});

/* ------------------------------------------------------------------ */
/* Shared mutation helpers                                             */
/* ------------------------------------------------------------------ */

/** Where a mutation lands: the task row, or one occurrence of a series. */
function refOf(instance: TaskInstance): InstanceRef {
  return {
    taskId: instance.task.id,
    occurrenceDate: instance.isRecurring ? instance.date : null,
  };
}

/**
 * Write a status to the right place: the task itself, or the occurrence row of
 * a recurring series. Callers never need to know which, which is the whole
 * point of `InstanceRef`.
 */
function applyStatus(
  db: Database,
  ref: InstanceRef,
  status: StoredStatus,
): Database {
  const task = db.tasks.find((t) => t.id === ref.taskId);
  if (!task) return db;

  const at = nowInstant();
  const completedAt = status === "COMPLETED" ? at : null;
  const entry = historyEntry({
    taskId: ref.taskId,
    kind: "STATUS_CHANGED",
    occurrenceDate: ref.occurrenceDate,
    field: "status",
    from: currentStoredStatus(db, ref),
    to: status,
  });

  if (task.recurrence && ref.occurrenceDate) {
    const id = occurrenceId(task.id, ref.occurrenceDate);
    const existing = db.occurrences.find((o) => o.id === id);
    const occurrence: Occurrence = {
      id,
      taskId: task.id,
      date: ref.occurrenceDate,
      status,
      completedAt,
      snoozedUntil:
        status === "COMPLETED" ? null : (existing?.snoozedUntil ?? null),
      updatedAt: at,
    };
    // A habit's first tick starts the plan it hangs off, exactly as a one-off
    // step's does — the completion lives on the occurrence, but the plan it
    // belongs to is no less under way.
    const startedByHabit =
      status === "COMPLETED"
        ? planStartedBy(db, task.id, at)
        : { tasks: db.tasks, entries: [] };
    return {
      ...db,
      tasks: startedByHabit.tasks,
      occurrences: existing
        ? db.occurrences.map((o) => (o.id === id ? occurrence : o))
        : [...db.occurrences, occurrence],
      history: [...db.history, entry, ...startedByHabit.entries],
    };
  }

  const next: Task = {
    ...task,
    status,
    completedAt,
    snoozedUntil: status === "COMPLETED" ? null : task.snoozedUntil,
    updatedAt: at,
  };

  // Finishing a task finishes what it was made of. A parent marked COMPLETED
  // over subtasks that still read TODO is not a record of anything — the two
  // halves of one task disagreeing about whether it happened — and the leftover
  // children would go on surfacing in Today and in the reminder queue.
  //
  // Reopening is deliberately *not* symmetric: a subtask that was genuinely
  // done stays done when its parent turns out to need more work.
  const cascade = status === "COMPLETED" ? openDescendants(db, task.id) : [];

  const started =
    status === "COMPLETED"
      ? planStartedBy(db, task.id, at)
      : { tasks: db.tasks, entries: [] };

  return {
    ...db,
    tasks: started.tasks.map((t) => {
      if (t.id === task.id) return next;
      return cascade.includes(t.id)
        ? { ...t, status, completedAt, snoozedUntil: null, updatedAt: at }
        : t;
    }),
    history: [
      ...db.history,
      entry,
      ...started.entries,
      ...cascade.map((id) =>
        historyEntry({
          taskId: id,
          kind: "STATUS_CHANGED",
          field: "status",
          from: db.tasks.find((t) => t.id === id)?.status ?? "TODO",
          to: status,
          note: `Completed with "${task.title}"`,
        }),
      ),
    ],
  };
}

/**
 * Ticking anything inside a plan starts that plan.
 *
 * "Başlayacaklarım" is only worth a tab if it is true, and a plan with three
 * ticked steps sitting in it is not. The alternative — deriving "started" from
 * the steps when the list is drawn — reads the same on screen and behaves
 * worse: someone who sets a plan back to not-started would watch it snap
 * straight back, because the derivation would still be looking at the same
 * ticked step. So the promotion happens once, here, as a real status change
 * with its own history entry, and the button that sets it stays authoritative
 * afterwards.
 *
 * Only `TODO` is promoted. A plan already `IN_PROGRESS` has nothing to learn
 * from this, and a `COMPLETED` one must not be quietly reopened by a step
 * being ticked underneath it.
 */
function planStartedBy(
  db: Database,
  taskId: string,
  at: Instant,
): { tasks: Task[]; entries: HistoryEntry[] } {
  const task = db.tasks.find((t) => t.id === taskId);
  const byId = new Map(db.tasks.map((t) => [t.id, t]));
  const plan = task ? enclosingPlan(task, byId) : null;
  if (!plan || plan.status !== "TODO") {
    return { tasks: db.tasks, entries: [] };
  }
  return {
    tasks: db.tasks.map((t) =>
      t.id === plan.id ? { ...t, status: "IN_PROGRESS", updatedAt: at } : t,
    ),
    entries: [
      historyEntry({
        taskId: plan.id,
        kind: "STATUS_CHANGED",
        field: "status",
        from: "TODO",
        to: "IN_PROGRESS",
        note: `Started with "${task?.title ?? ""}"`,
      }),
    ],
  };
}

/** Live, unfinished descendants of a task — what a completion cascades onto. */
export function openDescendants(db: Database, taskId: string): string[] {
  const ids = new Set(collectSubtree(db.tasks, taskId));
  ids.delete(taskId);
  return db.tasks
    .filter(
      (t) => ids.has(t.id) && t.deletedAt === null && t.status !== "COMPLETED",
    )
    .map((t) => t.id);
}

function currentStoredStatus(db: Database, ref: InstanceRef): StoredStatus {
  const task = db.tasks.find((t) => t.id === ref.taskId);
  if (!task) return "TODO";
  if (task.recurrence && ref.occurrenceDate) {
    const id = occurrenceId(task.id, ref.occurrenceDate);
    return db.occurrences.find((o) => o.id === id)?.status ?? "TODO";
  }
  return task.status;
}

function writeSnoozeUntil(
  db: Database,
  ref: InstanceRef,
  until: string | null,
): Database {
  const task = db.tasks.find((t) => t.id === ref.taskId);
  if (!task) return db;

  if (task.recurrence && ref.occurrenceDate) {
    const id = occurrenceId(task.id, ref.occurrenceDate);
    const existing = db.occurrences.find((o) => o.id === id);
    const at = nowInstant();
    const occurrence: Occurrence = existing
      ? { ...existing, snoozedUntil: until, updatedAt: at }
      : {
          id,
          taskId: task.id,
          date: ref.occurrenceDate,
          status: "TODO",
          completedAt: null,
          snoozedUntil: until,
          updatedAt: at,
        };
    return {
      ...db,
      occurrences: existing
        ? db.occurrences.map((o) => (o.id === id ? occurrence : o))
        : [...db.occurrences, occurrence],
    };
  }
  return {
    ...db,
    tasks: db.tasks.map((t) =>
      t.id === task.id
        ? { ...t, snoozedUntil: until, updatedAt: nowInstant() }
        : t,
    ),
  };
}

/** Keep a `dueDate`..`endDate` run the same length when its start moves. */
function shiftedEnd(task: Task, dueDate: LocalDate | null): LocalDate | null {
  const end = task.endDate ?? null;
  if (!end || !task.dueDate || !dueDate) return dueDate ? end : null;
  if (end <= task.dueDate) return null;
  return addDaysLocal(dueDate, daysBetween(task.dueDate, end));
}

/** Keep a timed task the same length when its start moves. */
function shiftedEndTime(task: Task, startTime: string | null): string | null {
  if (!task.endTime || !task.startTime || !startTime)
    return task.endTime ?? null;
  if (startTime === task.startTime) return task.endTime;
  const delta =
    minutesFromMidnight(startTime) - minutesFromMidnight(task.startTime);
  const end = minutesFromMidnight(task.endTime) + delta;
  if (end >= 24 * 60 - 1) return "23:59";
  if (end < 0) return "00:00";
  return minutesToTime(end);
}

/** Push a task and its descendants: one completion can touch the whole run. */
function syncSubtree(db: Database, rootId: string): void {
  const ids = new Set(collectSubtree(db.tasks, rootId));
  for (const task of db.tasks) {
    if (ids.has(task.id)) void syncTaskToCloud(task);
  }
}

/** A task plus every descendant, so trash and restore act on a whole subtree. */
function collectSubtree(tasks: Task[], rootId: string): string[] {
  const out = [rootId];
  let frontier = [rootId];
  while (frontier.length > 0) {
    const children = tasks
      .filter((t) => t.parentId !== null && frontier.includes(t.parentId))
      .map((t) => t.id);
    const fresh = children.filter((id) => !out.includes(id));
    out.push(...fresh);
    frontier = fresh;
  }
  return out;
}

function describeSchedule(
  task: Pick<Task, "dueDate" | "endDate" | "allDay" | "startTime" | "endTime">,
): string {
  if (!task.dueDate) return "no date";
  const days =
    task.endDate && task.endDate > task.dueDate
      ? `${task.dueDate} → ${task.endDate}`
      : task.dueDate;
  if (task.allDay || !task.startTime) return `${days} (all-day)`;
  return task.endTime
    ? `${days} ${task.startTime}-${task.endTime}`
    : `${days} ${task.startTime}`;
}

function serialise(value: unknown): string {
  if (value === null || value === undefined) return "none";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "none";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/* ------------------------------------------------------------------ */
/* Hooks shared across the UI                                          */
/* ------------------------------------------------------------------ */

/**
 * The shared clock, as a stable object.
 *
 * Identity matters: this `Date` is a dependency of nearly every memo in the
 * app, so it must only change when the minute does.
 */
export function useNow(): Date {
  const now = useStore((s) => s.now);
  return useMemo(() => new Date(now), [now]);
}

export function useSettings(): Settings {
  return useStore((s) => s.db.settings);
}

/** Resolve a task on a date, pulling in its occurrence override when relevant. */
export function instanceFor(
  task: Task,
  occurrences: Map<string, Occurrence>,
  date: LocalDate | null,
  now: Date,
): TaskInstance {
  const key = date ? occurrenceId(task.id, date) : "";
  return toInstance(task, date, occurrences.get(key) ?? null, now);
}

export function todayLocal(now: Date): LocalDate {
  return toLocalDate(now);
}
