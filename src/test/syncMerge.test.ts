import { beforeEach, describe, expect, it } from "vitest";
import {
  planReconciliation,
  type CollectionSpec,
  type SyncContext,
} from "@/state/syncEngine";

/**
 * The rule two devices agree on (DECISIONS.md §11).
 *
 * Row-level last-write-wins on `updated_at`, **ties to the cloud**, tombstones
 * always win. The tie-break is the part worth pinning down: it looks arbitrary,
 * and it is the reason two clients converge instead of pushing their own copy
 * at each other forever.
 *
 * `planReconciliation` is the decision half of the reconciler, split out from
 * the write precisely so the rule can be tested as a rule.
 */

interface Row {
  id: string;
  title: string;
  updatedAt: string;
}

const SPEC: CollectionSpec<Row> = {
  table: "rows",
  synced: new Map(),
  idOf: (r) => r.id,
  updatedAtOf: (r) => r.updatedAt,
  localFingerprint: (r) => JSON.stringify([r.title]),
  cloudFingerprint: (row) => JSON.stringify([row.title]),
  toCloud: (r) => ({ ...r }),
  fromCloud: (row) => ({
    id: row.id as string,
    title: row.title as string,
    updatedAt: row.updated_at as string,
  }),
};

const CONTEXT: SyncContext = { liveTaskIds: new Set() };

const local = (title: string, updatedAt: string): Row => ({
  id: "r1",
  title,
  updatedAt,
});

const cloud = (title: string, updatedAt: string, extra: object = {}) => ({
  id: "r1",
  title,
  updated_at: updatedAt,
  ...extra,
});

const merge = (
  locals: Row[],
  clouds: Record<string, unknown>[],
  tombstoned = new Set<string>(),
) => planReconciliation(SPEC, locals, { data: clouds }, tombstoned, CONTEXT).merged;

beforeEach(() => {
  SPEC.synced.clear();
});

describe("when only one side changed", () => {
  it("keeps the local row when the cloud has never seen it", () => {
    const merged = merge([local("only here", "2026-08-25T10:00:00Z")], []);
    expect(merged.map((r) => r.title)).toEqual(["only here"]);
  });

  it("takes a row the cloud has and this device does not", () => {
    const merged = merge([], [cloud("from the phone", "2026-08-25T10:00:00Z")]);
    expect(merged.map((r) => r.title)).toEqual(["from the phone"]);
  });

  it("does nothing at all when both sides already agree", () => {
    const merged = merge(
      [local("same", "2026-08-25T10:00:00Z")],
      // Different timestamp, identical content: content is what decides.
      [cloud("same", "2026-08-26T10:00:00Z")],
    );
    expect(merged.map((r) => r.title)).toEqual(["same"]);
  });
});

describe("when both sides changed the same row", () => {
  it("takes the newer side — cloud", () => {
    const merged = merge(
      [local("desktop", "2026-08-25T10:00:00Z")],
      [cloud("phone", "2026-08-25T11:00:00Z")],
    );
    expect(merged[0]?.title).toBe("phone");
  });

  it("takes the newer side — local", () => {
    const merged = merge(
      [local("desktop", "2026-08-25T12:00:00Z")],
      [cloud("phone", "2026-08-25T11:00:00Z")],
    );
    expect(merged[0]?.title).toBe("desktop");
  });

  it("breaks an exact tie the same way on every device: the cloud wins", () => {
    // Any fixed rule converges; a device-dependent one does not. This is the
    // whole reason the tie-break is written down rather than left to chance.
    const merged = merge(
      [local("desktop", "2026-08-25T10:00:00Z")],
      [cloud("phone", "2026-08-25T10:00:00Z")],
    );
    expect(merged[0]?.title).toBe("phone");
  });

  it("treats differently-spelled equal instants as a tie, not as newer", () => {
    const merged = merge(
      [local("desktop", "2026-08-25T10:00:00.000Z")],
      [cloud("phone", "2026-08-25T10:00:00+00:00")],
    );
    expect(merged[0]?.title).toBe("phone");
  });
});

describe("rows the cloud should not bring back", () => {
  it("ignores a cloud row that is soft-deleted", () => {
    const merged = merge([], [cloud("binned", "2026-08-25T10:00:00Z", { is_deleted: true })]);
    expect(merged).toEqual([]);
  });

  it("ignores a cloud row this device purged", () => {
    // Absence is a decision here, not a gap: without the tombstone, sync sees a
    // row the cloud has and helpfully restores it.
    const merged = merge(
      [],
      [cloud("purged here", "2026-08-25T10:00:00Z")],
      new Set(["r1"]),
    );
    expect(merged).toEqual([]);
  });

  it("ignores a cloud row whose parent task is gone", () => {
    const orphanSpec: CollectionSpec<Row> = {
      ...SPEC,
      synced: new Map(),
      isOrphan: (row, ctx) => !ctx.liveTaskIds.has(row.task_id as string),
    };
    const { merged } = planReconciliation(
      orphanSpec,
      [],
      { data: [{ ...cloud("orphan", "2026-08-25T10:00:00Z"), task_id: "gone" }] },
      new Set(),
      { liveTaskIds: new Set(["still-here"]) },
    );
    expect(merged).toEqual([]);
  });
});

describe("when the cloud table is not there at all", () => {
  it("leaves the local rows completely untouched", () => {
    // A project that has not run the latest schema must keep working rather
    // than lose the rows it cannot yet store.
    const rows = [local("still mine", "2026-08-25T10:00:00Z")];
    const { merged, unchanged } = planReconciliation(
      SPEC,
      rows,
      { data: null },
      new Set(),
      CONTEXT,
    );
    expect(unchanged).toBe(true);
    expect(merged).toBe(rows);
  });
});
