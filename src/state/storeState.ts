import type { Database } from "@/data/db";
import type {
  BudgetCategory,
  CategoryKey,
  MoneyFlow,
  Transaction,
} from "@/domain/money";
import type { Deadline } from "@/domain/deadline";
import type { WishlistItem } from "@/domain/wishlist";
import type { CopyTarget } from "@/domain/copy";
import type { SnoozePresetId } from "@/domain/snooze";
import type { ImportDraft, ImportMerge } from "@/domain/statementImport";
import type {
  Category,
  InstanceRef,
  LocalDate,
  Reminder,
  Settings,
  StoredStatus,
  Task,
  TaskInstance,
} from "@/domain/types";
import type {
  BatchInfo,
  DeadlineDraft,
  DeadlinePatch,
  RunningFocus,
  TaskDraft,
  TaskPatch,
  TransactionDraft,
  TransactionPatch,
  WishlistDraft,
  WishlistPatch,
} from "./storeTypes";

// The whole store contract in one place. Slices implement a `Pick<>` of it, so
// there is exactly one declaration of every action the UI can call.

export interface StoreState {
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
  /** Stop the clock without ending the session. */
  pauseFocus(): void;
  /** Start it again where it left off. */
  resumeFocus(): void;
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


/** What a slice is handed: the store's own `set`/`get`, plus the write path. */
export interface SliceTools {
  set: (
    partial:
      | Partial<StoreState>
      | ((state: StoreState) => Partial<StoreState>),
  ) => void;
  get: () => StoreState;
  /** Every mutation goes through here, so nothing can skip persistence. */
  commit: (mutate: (db: Database) => Database) => void;
}
