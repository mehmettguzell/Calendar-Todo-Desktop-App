import { describe, expect, it } from "vitest";
import {
  compareVersions,
  evaluateUpdate,
  readMinimumSupported,
} from "../updatePolicy";

describe("compareVersions", () => {
  it("orders by segment, not by string", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
    expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
  });

  it("treats missing segments as zero", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2", "1.2.1")).toBe(-1);
  });

  it("ignores a leading v and a pre-release suffix", () => {
    expect(compareVersions("v1.3.0", "1.3.0")).toBe(0);
    expect(compareVersions("1.3.0-beta.2", "1.3.0")).toBe(0);
  });
});

describe("readMinimumSupported", () => {
  it("finds the marker on its own line", () => {
    expect(readMinimumSupported("Bug fixes.\nmin-supported-version: 0.3.0\n")).toBe("0.3.0");
  });

  it("accepts a v prefix and odd spacing", () => {
    expect(readMinimumSupported("  Min-Supported-Version:   v2.1  ")).toBe("2.1");
  });

  it("returns null for ordinary notes", () => {
    expect(readMinimumSupported("See the assets below to download.")).toBeNull();
    expect(readMinimumSupported("")).toBeNull();
  });
});

describe("evaluateUpdate", () => {
  const notes = "Bug fixes.";

  it("says nothing when there is no offer", () => {
    expect(evaluateUpdate("0.1.0", null)).toEqual({ status: "none" });
  });

  it("says nothing when the offer is not newer", () => {
    expect(evaluateUpdate("0.2.0", { version: "0.2.0", notes })).toEqual({ status: "none" });
    expect(evaluateUpdate("0.3.0", { version: "0.2.0", notes })).toEqual({ status: "none" });
  });

  it("offers a newer version without demanding it", () => {
    expect(evaluateUpdate("0.1.0", { version: "0.2.0", notes })).toEqual({
      status: "optional",
      version: "0.2.0",
    });
  });

  it("demands the update when the running version is below the declared floor", () => {
    expect(
      evaluateUpdate("0.1.0", {
        version: "0.4.0",
        notes: "Data format changed.\nmin-supported-version: 0.3.0",
      }),
    ).toEqual({ status: "required", version: "0.4.0", minimum: "0.3.0" });
  });

  it("stays optional for a version already at the floor", () => {
    expect(
      evaluateUpdate("0.3.0", {
        version: "0.4.0",
        notes: "min-supported-version: 0.3.0",
      }),
    ).toEqual({ status: "optional", version: "0.4.0" });
  });

  /*
   * A floor above the release that declares it can never be satisfied —
   * installing the update would leave the app still below the floor. Treating
   * it as optional means a typo in release notes costs nobody their app.
   */
  it("ignores a floor no release can satisfy", () => {
    expect(
      evaluateUpdate("0.1.0", {
        version: "0.4.0",
        notes: "min-supported-version: 9.0.0",
      }),
    ).toEqual({ status: "optional", version: "0.4.0" });
  });
});
