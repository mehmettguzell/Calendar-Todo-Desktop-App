import type { Deadline } from "@/domain/deadline";
import type { MoneyFlow, Transaction, TransactionOrigin } from "@/domain/money";
import type { ImportMode } from "@/domain/statementBatch";
import type { WishlistItem } from "@/domain/wishlist";
import type {
  LocalDate,
  Priority,
  Recurrence,
  Task,
} from "@/domain/types";

// What the UI hands the store and what it may change: one shape per mutation
// so a caller cannot set a field the store does not own.

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

/**
 * The timer that is on right now.
 *
 * Deliberately not part of the document: a timer is a fact about *this*
 * sitting at *this* machine, and a running session arriving from another
 * device is not something anybody asked for. What it produces — the session
 * row and its seconds — is stored and synced like everything else.
 *
 * It is split into three fields rather than one start time so the clock can be
 * stopped without the session being ended. `startedAt` is when the sitting
 * began and is what the bar prints; `runStartedAt` is when the *current* run
 * began and is `null` while paused; `bankedSec` is everything earlier runs
 * added up to, and is written through to the session on each pause so nothing
 * is lost if the window closes on a paused timer.
 */
export interface RunningFocus {
  sessionId: string;
  taskId: string;
  occurrenceDate: LocalDate | null;
  startedAt: string;
  /** When the current run began, or `null` while paused. */
  runStartedAt: string | null;
  /** Seconds banked by earlier runs of this same session. */
  bankedSec: number;
}

/** Whole seconds this session has actually been running, pauses excluded. */
export function focusElapsedSec(
  running: RunningFocus | null,
  now: number = Date.now(),
): number {
  if (!running) return 0;
  if (!running.runStartedAt) return running.bankedSec;
  const thisRun = (now - new Date(running.runStartedAt).getTime()) / 1000;
  return running.bankedSec + Math.max(0, Math.round(thisRun));
}

