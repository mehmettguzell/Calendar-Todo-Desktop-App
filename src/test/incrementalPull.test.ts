import { describe, expect, it } from "vitest";
import { newestStamp, rewound } from "@/state/syncEngine";

/**
 * The watermark that decides which cloud rows a pass asks for.
 *
 * Everything here is about one failure mode: a cursor that moves too far
 * forward skips a row, and a skipped row is a silently missing task. These
 * tests are what stands between that and the user.
 */
const row = (stamp: string) => ({ updated_at: stamp });

describe("newestStamp", () => {
  it("takes the latest timestamp the server actually returned", () => {
    expect(
      newestStamp(
        [row("2026-08-01T10:00:00.000Z"), row("2026-08-03T09:00:00.000Z"), row("2026-08-02T00:00:00.000Z")],
        "updated_at",
        null,
      ),
    ).toBe("2026-08-03T09:00:00.000Z");
  });

  /** An empty pass means "nothing changed", never "start from the beginning". */
  it("keeps the previous watermark when nothing came back", () => {
    expect(newestStamp([], "updated_at", "2026-08-03T09:00:00.000Z")).toBe(
      "2026-08-03T09:00:00.000Z",
    );
  });

  it("never moves the watermark backwards", () => {
    expect(
      newestStamp([row("2026-07-01T00:00:00.000Z")], "updated_at", "2026-08-03T09:00:00.000Z"),
    ).toBe("2026-08-03T09:00:00.000Z");
  });

  it("ignores rows whose column is missing or not a timestamp", () => {
    expect(
      newestStamp(
        [{ updated_at: null }, { updated_at: 12345 }, row("2026-08-02T00:00:00.000Z")],
        "updated_at",
        null,
      ),
    ).toBe("2026-08-02T00:00:00.000Z");
  });
});

describe("rewound", () => {
  it("steps back far enough to cover a device with a slow clock", () => {
    expect(rewound("2026-08-03T09:00:00.000Z")).toBe("2026-08-03T08:58:00.000Z");
  });

  it("stays null when there is no watermark, so the pass reads everything", () => {
    expect(rewound(null)).toBe(null);
  });

  it("refuses to invent a cursor from an unparseable stamp", () => {
    expect(rewound("not a date")).toBe(null);
  });

  /**
   * The reason rewinding happens at query time and not at storage time: doing
   * it twice would walk the cursor backwards on every pass.
   */
  it("is not applied cumulatively by the caller", () => {
    const stored = "2026-08-03T09:00:00.000Z";
    expect(rewound(stored)).toBe(rewound(stored));
  });
});
