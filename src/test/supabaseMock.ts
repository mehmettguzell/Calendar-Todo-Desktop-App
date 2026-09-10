/**
 * A stand-in for the Supabase client, so the write paths can be tested.
 *
 * In a test run the real `supabase` is `null` (no credentials), which means
 * every flush, pull and realtime path short-circuits and nothing about them is
 * covered. This fake records what a pass would have sent and lets a test decide
 * what the server says back — including saying no, which is the branch that
 * decides whether a user's edit survives a failed request.
 */

export interface SupabaseCall {
  table: string;
  op: "upsert" | "update" | "select" | "delete";
  rows: Record<string, unknown>[];
  filters: Record<string, unknown>;
}

export interface CallOutcome {
  data: Record<string, unknown>[] | null;
  error: { message: string; code?: string } | null;
}

/** What the fake server answers; `undefined` falls through to the default. */
type Responder = (call: SupabaseCall) => CallOutcome | undefined;

const OK: CallOutcome = { data: [], error: null };

class QueryBuilder implements PromiseLike<CallOutcome> {
  private single = false;

  constructor(
    private readonly call: SupabaseCall,
    private readonly answer: (call: SupabaseCall) => CallOutcome,
  ) {}

  eq(column: string, value: unknown): this {
    this.call.filters[column] = value;
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.call.filters[column] = values;
    return this;
  }

  gte(column: string, value: unknown): this {
    this.call.filters[`${column}>=`] = value;
    return this;
  }

  order(): this {
    return this;
  }

  limit(): this {
    return this;
  }

  select(): this {
    return this;
  }

  maybeSingle(): this {
    this.single = true;
    return this;
  }

  then<A = CallOutcome, B = never>(
    onFulfilled?: ((value: CallOutcome) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    const result = this.answer(this.call);
    const value = this.single
      ? { data: (result.data?.[0] ?? null) as never, error: result.error }
      : result;
    return Promise.resolve(value).then(onFulfilled, onRejected);
  }
}

export interface SupabaseMock {
  client: unknown;
  calls: SupabaseCall[];
  /** Rows sent to one table by one operation, flattened across batches. */
  rowsSent(table: string, op?: SupabaseCall["op"]): Record<string, unknown>[];
  /** Answer every matching call with this error until told otherwise. */
  failOn(table: string, error: { message: string; code?: string }): void;
  /** Answer every call normally again. */
  healAll(): void;
  /** Full control, for a case the two helpers above do not cover. */
  respond(responder: Responder): void;
  reset(): void;
  channels: string[];
  /** Deliver a `postgres_changes` payload to whatever bound to that table. */
  emit(table: string, payload: RealtimeRowPayload): void;
}

export interface RealtimeRowPayload {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  table?: string;
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}

export function createSupabaseMock(): SupabaseMock {
  const calls: SupabaseCall[] = [];
  const failing = new Map<string, { message: string; code?: string }>();
  const channels: string[] = [];
  const bindings: { table: string; handle: (p: RealtimeRowPayload) => void }[] = [];
  let responder: Responder = () => undefined;

  const answer = (call: SupabaseCall): CallOutcome => {
    const custom = responder(call);
    if (custom) return custom;
    const failure = failing.get(call.table);
    if (failure) return { data: null, error: failure };
    return { ...OK };
  };

  const start = (
    table: string,
    op: SupabaseCall["op"],
    rows: Record<string, unknown>[],
  ) => {
    const call: SupabaseCall = { table, op, rows, filters: {} };
    calls.push(call);
    return new QueryBuilder(call, answer);
  };

  const client = {
    from(table: string) {
      return {
        upsert: (rows: Record<string, unknown> | Record<string, unknown>[]) =>
          start(table, "upsert", Array.isArray(rows) ? rows : [rows]),
        insert: (rows: Record<string, unknown> | Record<string, unknown>[]) =>
          start(table, "upsert", Array.isArray(rows) ? rows : [rows]),
        update: (patch: Record<string, unknown>) =>
          start(table, "update", [patch]),
        delete: () => start(table, "delete", []),
        select: () => start(table, "select", []),
      };
    },
    channel(name: string) {
      channels.push(name);
      const channel = {
        on: (
          _event: string,
          filter: { table: string },
          handle: (p: RealtimeRowPayload) => void,
        ) => {
          bindings.push({ table: filter.table, handle });
          return channel;
        },
        subscribe: (onStatus?: (status: string) => void) => {
          onStatus?.("SUBSCRIBED");
          return channel;
        },
        unsubscribe: () => Promise.resolve("ok"),
      };
      return channel;
    },
    removeChannel: () => Promise.resolve("ok"),
  };

  return {
    client,
    calls,
    channels,
    rowsSent: (table, op) =>
      calls
        .filter((c) => c.table === table && (!op || c.op === op))
        .flatMap((c) => c.rows),
    failOn: (table, error) => failing.set(table, error),
    healAll: () => failing.clear(),
    respond: (next) => {
      responder = next;
    },
    emit: (table, payload) => {
      for (const binding of bindings) {
        if (binding.table === table) binding.handle({ table, ...payload });
      }
    },
    reset: () => {
      calls.length = 0;
      channels.length = 0;
      bindings.length = 0;
      failing.clear();
      responder = () => undefined;
    },
  };
}

/**
 * One shared instance, because `vi.mock` factories are hoisted above anything
 * a test file declares: the factory imports this module and hands back
 * `supabaseMock.client`, and the test reaches the same object by name.
 */
export const supabaseMock = createSupabaseMock();
