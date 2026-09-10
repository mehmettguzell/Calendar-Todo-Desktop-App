import type { SupabaseClient } from "@supabase/supabase-js";
import type { Tombstone } from "@/domain/types";
import { supabase } from "@/lib/supabase";
import { withTimeout } from "./cloudRequest";
import {
  FULL_PASS_INTERVAL_MS,
  getLastFullPassAt,
  getPullCursor,
  type PullCursor,
} from "./pullCursor";
import { isMissingRelation, noteRelationMissing, tableAvailable } from "./schemaCapability";
import { rewound } from "./watermark";

export interface OptionalRows {
  data: Record<string, unknown>[] | null;
  error: unknown;
}

export interface CloudSnapshot {
  tasks: Record<string, unknown>[];
  categories: Record<string, unknown>[];
  focus: Record<string, unknown>[];
  occurrences: OptionalRows;
  reminders: OptionalRows;
  transactions: OptionalRows;
  budgetCategories: OptionalRows;
  wishlist: OptionalRows;
  deadlines: OptionalRows;
  batches: OptionalRows;
  history: OptionalRows;
}

/**
 * A full pass reads the whole account; an incremental one reads only what
 * changed. Only a full set can answer "the cloud is missing this row".
 */
export interface PassScope {
  incremental: boolean;
  since: PullCursor | null;
}

export function passScope(userId: string): PassScope {
  const cursor = getPullCursor();
  const fullPassDue = Date.now() - getLastFullPassAt() >= FULL_PASS_INTERVAL_MS;
  const incremental =
    cursor !== null && cursor.userId === userId && !fullPassDue;
  return { incremental, since: incremental ? cursor : null };
}

/**
 * `gte`, not `gt`: the watermark is a row's own timestamp, so boundary rows
 * come back once more — cheaper than skipping one written in the same tick.
 */
function sinceFilter<T extends { gte(column: string, value: string): T }>(
  query: T,
  column: string,
  since: string | null,
): T {
  return since ? query.gte(column, since) : query;
}

/** A select that tolerates the table not existing in this project yet. */
export async function fetchOptional(
  table: string,
  userId: string,
  options?: { limit?: number; orderColumn?: string; ascending?: boolean },
): Promise<OptionalRows> {
  if (!supabase || !tableAvailable(table)) return { data: null, error: null };
  let query = supabase.from(table).select("*").eq("user_id", userId);
  if (options?.orderColumn) {
    query = query.order(options.orderColumn, {
      ascending: options.ascending ?? true,
    });
  }
  if (options?.limit) query = query.limit(options.limit);

  const res = await withTimeout(query, `${table} fetch`);
  if (isMissingRelation(res.error)) {
    noteRelationMissing(table);
    return { data: null, error: null };
  }
  return {
    data: res.data as Record<string, unknown>[] | null,
    error: res.error,
  };
}

/** The three tables a pass cannot do without, read since their watermark. */
function fetchCore(
  client: SupabaseClient,
  userId: string,
  since: PullCursor | null,
) {
  const read = (table: string, column: string, watermark: string | null) =>
    withTimeout(
      sinceFilter(
        client.from(table).select("*").eq("user_id", userId),
        column,
        rewound(watermark),
      ),
      `${table} fetch`,
    );
  return [
    read("tasks", "updated_at", since?.tasks ?? null),
    read("categories", "updated_at", since?.categories ?? null),
    read("focus_sessions", "created_at", since?.focus ?? null),
  ] as const;
}

/** Everything one pass reads, in parallel. Tasks and categories must land. */
export async function fetchCloudSnapshot(
  client: SupabaseClient,
  userId: string,
  since: PullCursor | null,
): Promise<CloudSnapshot> {
  const [
    tasksRes,
    catsRes,
    focusRes,
    occurrences,
    reminders,
    transactions,
    budgetCategories,
    wishlist,
    deadlines,
    batches,
    history,
  ] = await Promise.all([
    ...fetchCore(client, userId, since),
    fetchOptional("occurrences", userId),
    fetchOptional("reminders", userId),
    fetchOptional("transactions", userId),
    fetchOptional("budget_categories", userId),
    fetchOptional("wishlist", userId),
    fetchOptional("deadlines", userId),
    fetchOptional("statement_batches", userId),
    fetchOptional("task_history", userId, {
      limit: 100,
      orderColumn: "at",
      ascending: false,
    }),
  ]);

  if (tasksRes.error) throw tasksRes.error;
  if (catsRes.error) throw catsRes.error;

  return {
    tasks: tasksRes.data ?? [],
    categories: catsRes.data ?? [],
    focus: focusRes.data ?? [],
    occurrences,
    reminders,
    transactions,
    budgetCategories,
    wishlist,
    deadlines,
    batches,
    history,
  };
}

export type TombstoneIndex = ReturnType<typeof tombstoneIndex>;

export function tombstoneIndex(tombstones: Tombstone[]) {
  const index = {
    task: new Set<string>(),
    category: new Set<string>(),
    reminder: new Set<string>(),
    occurrence: new Set<string>(),
    transaction: new Set<string>(),
    focus: new Set<string>(),
  };
  for (const stone of tombstones) index[stone.kind]?.add(stone.id);
  return index;
}
