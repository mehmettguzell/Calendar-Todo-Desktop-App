import { beforeEach, describe, expect, it } from "vitest";
import { ANONYMOUS_NAMESPACE, anonymousClaimedBy } from "@/data/namespace";
import { flushPersist, useStore } from "@/state/store";

/**
 * Two people, one machine.
 *
 * The rule is that a signed-in account never sees another account's work — and
 * that has to hold for edits made while offline, which is why the separation
 * lives in storage rather than in a filter someone can forget to apply.
 *
 * The one deliberate exception is the first sign-in adopting whatever was
 * created before registering. The test that matters most here is the one right
 * after it: the *second* account must not inherit the first one's tasks.
 */
beforeEach(async () => {
  localStorage.clear();
  await useStore.getState().resetDatabase();
  await useStore.getState().switchAccount(null);
});

const titles = () =>
  useStore
    .getState()
    .db.tasks.filter((t) => t.deletedAt === null)
    .map((t) => t.title)
    .sort();

describe("switching accounts", () => {
  it("starts in the anonymous namespace", () => {
    expect(useStore.getState().namespace).toBe(ANONYMOUS_NAMESPACE);
  });

  it("hands the signed-out document to the first account that signs in", async () => {
    useStore.getState().createTask({ title: "Written before signing up" });
    await useStore.getState().switchAccount("user-a");

    expect(useStore.getState().namespace).toBe("user-a");
    expect(titles()).toEqual(["Written before signing up"]);
    expect(anonymousClaimedBy()).toBe("user-a");
  });

  it("does NOT hand it to a second account", async () => {
    useStore.getState().createTask({ title: "Belongs to A" });
    await useStore.getState().switchAccount("user-a");
    await useStore.getState().switchAccount(null);
    await useStore.getState().switchAccount("user-b");

    // The adoption already happened once. B gets an empty document, not A's.
    expect(useStore.getState().namespace).toBe("user-b");
    expect(titles()).toEqual([]);
  });

  it("keeps each account's tasks to itself across a switch", async () => {
    await useStore.getState().switchAccount("user-a");
    useStore.getState().createTask({ title: "A's task" });
    await flushPersist();

    await useStore.getState().switchAccount("user-b");
    useStore.getState().createTask({ title: "B's task" });
    await flushPersist();

    expect(titles()).toEqual(["B's task"]);

    await useStore.getState().switchAccount("user-a");
    expect(titles()).toEqual(["A's task"]);
  });

  it("does not reload when the account has not actually changed", async () => {
    await useStore.getState().switchAccount("user-a");
    useStore.getState().createTask({ title: "Still here" });

    await useStore.getState().switchAccount("user-a");

    // An unnecessary reload would drop the write that has not been flushed yet.
    expect(titles()).toEqual(["Still here"]);
  });

  it("signing out leaves the account's tasks behind, not on screen", async () => {
    await useStore.getState().switchAccount("user-a");
    useStore.getState().createTask({ title: "Private to A" });
    await flushPersist();

    await useStore.getState().switchAccount(null);

    expect(useStore.getState().namespace).toBe(ANONYMOUS_NAMESPACE);
    expect(titles()).not.toContain("Private to A");
  });
});
