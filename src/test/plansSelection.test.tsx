import { act } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { emptyDatabase } from "@/data/db";
import { useSelectionStore } from "@/state/selectionStore";
import { useStore } from "@/state/store";
import { App } from "@/App";

/**
 * Picking plans and their steps in bulk.
 *
 * The point of the quick-select buttons is that "get rid of everything I have
 * already done" takes one press rather than one Ctrl-click per row, so what is
 * asserted here is the split: a press must reach the finished rows and nothing
 * else, whether the finished thing is a whole plan or one step inside a plan
 * that is still running.
 */
beforeEach(() => {
  localStorage.clear();
  useStore.setState({ db: emptyDatabase(), ready: false, runningFocus: null });
  useSelectionStore.getState().clear();
});

async function mountPlans() {
  render(<App />);
  await act(async () => {
    await useStore.getState().hydrate();
  });
}

/** A plan still running with one step done, beside a plan that is finished. */
function seedPlans() {
  const store = useStore.getState();
  const running = store.createTask({
    title: "Sunumu hazırla",
    tags: ["plan"],
    dueDate: null,
  });
  const doneStep = store.createTask({
    title: "Slaytlar",
    parentId: running.id,
    dueDate: null,
  });
  const openStep = store.createTask({
    title: "Prova",
    parentId: running.id,
    dueDate: null,
  });
  const finished = store.createTask({
    title: "Tatil planı",
    tags: ["plan"],
    dueDate: null,
  });
  const finishedStep = store.createTask({
    title: "Bilet al",
    parentId: finished.id,
    dueDate: null,
  });

  for (const id of [doneStep.id, finishedStep.id]) {
    useStore
      .getState()
      .setStatus({ taskId: id, occurrenceDate: null }, "COMPLETED");
  }

  return { running, doneStep, openStep, finished, finishedStep };
}

async function openPlansAndSelect() {
  const nav = await screen.findByRole("button", { name: /^(Plans|Planlar)$/ });
  act(() => nav.click());
  const select = await screen.findByRole("button", { name: /^(Select|Seç)$/ });
  act(() => select.click());
}

const press = (pattern: RegExp) =>
  act(() => screen.getByRole("button", { name: pattern }).click());

describe("picking plans in bulk", () => {
  it("stays out of sight until selecting is asked for", async () => {
    await mountPlans();
    act(() => {
      seedPlans();
    });

    const nav = await screen.findByRole("button", { name: /^(Plans|Planlar)$/ });
    act(() => nav.click());

    // No quick-select row, no checkboxes: a page nobody is selecting in looks
    // exactly as it did before selecting existed.
    expect(
      screen.queryByRole("button", {
        name: /Tamamlananları seç|Select completed/,
      }),
    ).toBeNull();
    expect(document.querySelectorAll(".task-pick").length).toBe(0);
  });

  it("reaches every finished plan and step, and nothing else", async () => {
    await mountPlans();
    let seeded!: ReturnType<typeof seedPlans>;
    act(() => {
      seeded = seedPlans();
    });

    await openPlansAndSelect();
    press(/Tamamlananları seç|Select completed/);

    // The finished plan counts as finished through its steps, not its own
    // status — nobody ever ticked the plan itself.
    expect([...useSelectionStore.getState().ids].sort()).toEqual(
      [seeded.doneStep.id, seeded.finished.id, seeded.finishedStep.id].sort(),
    );
  });

  it("reaches the unfinished ones on the other press", async () => {
    await mountPlans();
    let seeded!: ReturnType<typeof seedPlans>;
    act(() => {
      seeded = seedPlans();
    });

    await openPlansAndSelect();
    press(/Tamamlanmayanları seç|Select unfinished/);

    expect([...useSelectionStore.getState().ids].sort()).toEqual(
      [seeded.running.id, seeded.openStep.id].sort(),
    );
  });

  it("answers the second press rather than the union of both", async () => {
    await mountPlans();
    let seeded!: ReturnType<typeof seedPlans>;
    act(() => {
      seeded = seedPlans();
    });

    await openPlansAndSelect();
    press(/Tamamlananları seç|Select completed/);
    press(/Tamamlanmayanları seç|Select unfinished/);

    expect([...useSelectionStore.getState().ids].sort()).toEqual(
      [seeded.running.id, seeded.openStep.id].sort(),
    );
  });

  it("hands what is picked to the bulk bar, delete and all", async () => {
    await mountPlans();
    act(() => {
      seedPlans();
    });

    await openPlansAndSelect();
    press(/Tamamlananları seç|Select completed/);

    // The bar is mounted once for the whole app; the point of this assertion is
    // that a plans selection is the same selection it acts on.
    expect(
      screen.getByRole("toolbar", { name: /Seçili görevler|Selected tasks/ }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /^(Sil|Delete)$/ }),
    ).toBeDefined();
  });
});
