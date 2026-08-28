import { describe, expect, it } from "vitest";
import {
  arrangePinned,
  insertAt,
  moveItem,
} from "@/domain/manualOrder";

/** A row is just a name and the slot it was pinned to, if any. */
type Row = { id: string; slot: number | null };

const row = (id: string, slot: number | null = null): Row => ({ id, slot });
const arrange = (rows: Row[]) =>
  arrangePinned(rows, (r) => r.slot).map((r) => r.id);

describe("arrangePinned", () => {
  it("leaves a list with no pins in its automatic order", () => {
    const rows = [row("a"), row("b"), row("c")];
    expect(arrangePinned(rows, (r) => r.slot)).toBe(rows);
  });

  it("nails a pinned row to its slot and flows the rest around it", () => {
    expect(arrange([row("a"), row("b"), row("c", 0)])).toEqual(["c", "a", "b"]);
    expect(arrange([row("a", 2), row("b"), row("c")])).toEqual(["b", "c", "a"]);
  });

  it("keeps several pins in their own slots at once", () => {
    expect(arrange([row("a", 2), row("b"), row("c", 0)])).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  it("gives a contested slot to the lower pin and rehomes the other", () => {
    const out = arrange([row("a", 1), row("b", 1), row("c")]);
    expect(out).toHaveLength(3);
    expect(new Set(out)).toEqual(new Set(["a", "b", "c"]));
    // Both wanted slot 1; one keeps it, the other takes the next slot down.
    expect(out.indexOf("a")).toBeLessThan(out.indexOf("b"));
  });

  it("clamps a pin that outlived the list it was made in", () => {
    expect(arrange([row("a"), row("b", 99)])).toEqual(["a", "b"]);
    expect(arrange([row("a", -5), row("b")])).toEqual(["a", "b"]);
  });

  it("never drops or duplicates a row, however the pins fall", () => {
    const rows = [row("a", 3), row("b", 3), row("c", 0), row("d"), row("e", 0)];
    const out = arrange(rows);
    expect(out).toHaveLength(5);
    expect([...out].sort()).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("moveItem", () => {
  it("moves a row forwards and backwards", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  it("returns the same list when the move goes nowhere", () => {
    const ids = ["a", "b", "c"];
    expect(moveItem(ids, 1, 1)).toBe(ids);
    expect(moveItem(ids, 5, 0)).toBe(ids);
    // Off the end clamps onto the last slot, which the row already holds.
    expect(moveItem(ids, 2, 9)).toBe(ids);
  });
});

describe("insertAt", () => {
  it("inserts a card arriving from another column", () => {
    expect(insertAt(["a", "b"], "c", 1)).toEqual(["a", "c", "b"]);
    expect(insertAt(["a", "b"], "c", 2)).toEqual(["a", "b", "c"]);
  });

  it("moves rather than duplicates a card already in the list", () => {
    expect(insertAt(["a", "b", "c"], "a", 2)).toEqual(["b", "c", "a"]);
  });
});
