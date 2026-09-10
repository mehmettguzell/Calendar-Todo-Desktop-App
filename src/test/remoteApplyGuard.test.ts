import { afterEach, describe, expect, it } from "vitest";
import {
  beginRemoteApply,
  endRemoteApply,
  isApplyingRemoteUpdate,
} from "@/state/syncEngine";

/**
 * The regression this guards.
 *
 * `runSyncDifferences` marks "a remote write is being applied" for the whole
 * length of a pass, so the store subscriber does not mistake its final merge
 * commit for a local edit and queue every freshly *downloaded* row straight
 * back to the server. That marker used to be a boolean.
 *
 * A realtime event that lands mid-pass runs its own `applyRemote`, and when
 * that was a boolean its `finally` cleared the marker while the reconciliation
 * was still going. The merge commit that came next was seen as brand-new local
 * work: a user signing in on a second machine watched the pending-changes
 * badge jump to the exact number of rows the account holds — 149 of them —
 * every one already on the server it was about to be re-sent to.
 *
 * A depth counter is what lets the pass and the realtime event overlap without
 * one ending the other's guard.
 */
describe("remote-apply guard nests", () => {
  afterEach(() => {
    // Unbalance from a failed expectation must not leak into the next test.
    while (isApplyingRemoteUpdate()) endRemoteApply();
  });

  it("stays on until the outermost apply finishes", () => {
    expect(isApplyingRemoteUpdate()).toBe(false);

    beginRemoteApply(); // the sync pass
    expect(isApplyingRemoteUpdate()).toBe(true);

    beginRemoteApply(); // a realtime event lands mid-pass
    expect(isApplyingRemoteUpdate()).toBe(true);

    endRemoteApply(); // the realtime event finishes — a boolean cleared here
    expect(isApplyingRemoteUpdate()).toBe(true);

    endRemoteApply(); // the pass finishes
    expect(isApplyingRemoteUpdate()).toBe(false);
  });

  it("does not underflow when an end has no matching begin", () => {
    endRemoteApply();
    endRemoteApply();
    expect(isApplyingRemoteUpdate()).toBe(false);

    beginRemoteApply();
    expect(isApplyingRemoteUpdate()).toBe(true);
    endRemoteApply();
    expect(isApplyingRemoteUpdate()).toBe(false);
  });
});
