import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { OPTIONAL_COLUMNS, serializeTaskForCloud } from "@/state/syncEngine";
import type { Task } from "@/domain/types";

/**
 * A column added to the cloud payload before the user has run the matching
 * migration makes PostgREST reject the whole write, and sync stops with
 * "Eşitleme şu an tamamlanamadı" until they do.
 *
 * `OPTIONAL_COLUMNS` is what lets the engine drop such a column and retry
 * instead. Registering a column there is easy to forget — `deadline` was
 * consulted through `columnDropped` but never listed, so every push failed —
 * and nothing else in the codebase notices, which is what this file is for.
 */
const SOURCE = readFileSync(resolve("src/state/syncEngine.ts"), "utf8");

describe("optional cloud columns", () => {
  it("registers every column the engine is willing to drop", () => {
    const consulted = [...SOURCE.matchAll(/columnDropped\("(\w+)",\s*"(\w+)"\)/g)].map(
      ([, table, column]) => `${table}.${column}`,
    );
    expect(consulted.length).toBeGreaterThan(0);

    const registered = new Set(
      Object.entries(OPTIONAL_COLUMNS).flatMap(([table, columns]) =>
        columns.map((column) => `${table}.${column}`),
      ),
    );

    expect([...new Set(consulted)].filter((entry) => !registered.has(entry))).toEqual([]);
  });

  it("registers every field the task payload only sometimes sends", () => {
    /*
     * A field written conditionally is a field the base table may not have —
     * that is the only reason to guard it — so it has to be droppable too.
     */
    const conditional = [...SOURCE.matchAll(/payload\.(\w+) = /g)].map(
      ([, column]) => column ?? "",
    );
    const registered = new Set(OPTIONAL_COLUMNS.tasks ?? []);
    expect(conditional.filter((column) => !registered.has(column))).toEqual([]);
  });

  it("keeps deadline out of a payload once the column is known to be missing", () => {
    // Guards the specific regression: deadline reached the wire unconditionally.
    const base: Task = {
      id: "t1",
      title: "Sunum",
      description: "",
      status: "TODO",
      priority: "NONE",
      dueDate: "2026-09-02",
      deadline: "2026-09-20",
      allDay: true,
      startTime: null,
      endTime: null,
      categoryId: null,
      tags: [],
      parentId: null,
      recurrence: null,
      snoozedUntil: null,
      order: 0,
      createdAt: "2026-08-01T09:00:00.000Z",
      updatedAt: "2026-08-01T09:00:00.000Z",
      completedAt: null,
      deletedAt: null,
    };

    const row = serializeTaskForCloud(base, "user-1") as Record<string, unknown>;
    expect(row.deadline).toBe("2026-09-20");
    expect(OPTIONAL_COLUMNS.tasks).toContain("deadline");
  });
});
