import { act } from "react";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { toLocalDate } from "@/domain/datetime";
import { planProgress, planStage } from "@/domain/plan";
import type { Task } from "@/domain/types";
import { useStore } from "@/state/store";
import { PlansView } from "@/ui/views/PlansView";

/**
 * "Which of these have I actually started?"
 *
 * The page used to answer "not finished", which put a plan someone is halfway
 * through beside one they wrote down and never opened. Three stages replace
 * that, and the only way the split stays trustworthy is if the app keeps it
 * true on its own: ticking a step of a plan nobody pressed Start on has to
 * move that plan, or "Başlayacaklarım" fills up with work in progress.
 */
beforeEach(async () => {
  await useStore.getState().resetDatabase();
  await useStore.getState().hydrate();
});

const taskOf = (id: string): Task => {
  const task = useStore.getState().db.tasks.find((t) => t.id === id);
  if (!task) throw new Error(`No task ${id}`);
  return task;
};

const stepsOf = (planId: string) =>
  useStore.getState().db.tasks.filter((t) => t.parentId === planId);

const stageOf = (planId: string) =>
  planStage(taskOf(planId), stepsOf(planId));

function makePlan(title: string, steps: string[] = []) {
  const plan = useStore.getState().createTask({ title, tags: ["plan"] });
  for (const step of steps) {
    useStore.getState().createTask({ title: step, parentId: plan.id });
  }
  return plan;
}

const tick = (taskId: string) =>
  act(() => {
    useStore
      .getState()
      .setStatus({ taskId, occurrenceDate: null }, "COMPLETED");
  });

describe("where a plan stands", () => {
  it("starts out not started", () => {
    const plan = makePlan("Sunum", ["Slaytlar"]);
    expect(stageOf(plan.id)).toBe("NOT_STARTED");
  });

  it("counts as started once it is marked IN_PROGRESS", () => {
    const plan = makePlan("Sunum", ["Slaytlar"]);
    act(() => {
      useStore
        .getState()
        .setStatus({ taskId: plan.id, occurrenceDate: null }, "IN_PROGRESS");
    });
    expect(stageOf(plan.id)).toBe("STARTED");
  });

  it("is finished when every step is, without a second click", () => {
    const plan = makePlan("Sunum", ["Slaytlar", "Prova"]);
    const [a, b] = stepsOf(plan.id);
    tick(a!.id);
    expect(stageOf(plan.id)).toBe("STARTED");
    tick(b!.id);
    expect(stageOf(plan.id)).toBe("COMPLETED");
  });

  it("does not call an empty plan finished", () => {
    const plan = makePlan("Henüz boş");
    expect(stageOf(plan.id)).toBe("NOT_STARTED");
    expect(planProgress(taskOf(plan.id), [])).toEqual({
      done: 0,
      total: 0,
      pct: 0,
    });
  });
});

describe("ticking a step", () => {
  it("starts the plan it belongs to", () => {
    const plan = makePlan("Sunum", ["Slaytlar", "Prova"]);
    tick(stepsOf(plan.id)[0]!.id);

    expect(taskOf(plan.id).status).toBe("IN_PROGRESS");
    expect(stageOf(plan.id)).toBe("STARTED");
  });

  it("reaches a plan two levels up", () => {
    const plan = makePlan("Sunum", ["Slaytlar"]);
    const step = stepsOf(plan.id)[0]!;
    const leaf = useStore
      .getState()
      .createTask({ title: "Kapak", parentId: step.id });

    tick(leaf.id);
    expect(taskOf(plan.id).status).toBe("IN_PROGRESS");
  });

  it("says so in the plan's history", () => {
    const plan = makePlan("Sunum", ["Slaytlar"]);
    tick(stepsOf(plan.id)[0]!.id);

    const entry = useStore
      .getState()
      .db.history.find(
        (h) => h.taskId === plan.id && h.kind === "STATUS_CHANGED",
      );
    expect(entry?.to).toBe("IN_PROGRESS");
  });

  it("does not reopen a plan that was already finished", () => {
    const plan = makePlan("Sunum", ["Slaytlar"]);
    act(() => {
      useStore
        .getState()
        .setStatus({ taskId: plan.id, occurrenceDate: null }, "COMPLETED");
    });
    // Completing the plan cascaded onto the step; reopening only the step must
    // not drag the plan back to IN_PROGRESS behind the user's back.
    const step = stepsOf(plan.id)[0]!;
    act(() => {
      useStore
        .getState()
        .setStatus({ taskId: step.id, occurrenceDate: null }, "TODO");
    });
    tick(step.id);

    expect(taskOf(plan.id).status).toBe("COMPLETED");
  });

  it("leaves an ordinary task's parent alone", () => {
    const parent = useStore.getState().createTask({ title: "Tek görev" });
    const sub = useStore
      .getState()
      .createTask({ title: "Adım", parentId: parent.id });

    tick(sub.id);
    expect(taskOf(parent.id).status).toBe("TODO");
  });
});

describe("the plans page", () => {
  const tab = (name: RegExp) => screen.getByRole("tab", { name });

  it("counts each stage on its own tab, and filters to it", () => {
    makePlan("Başlamadım", ["a"]);
    const started = makePlan("Başladım", ["b"]);
    act(() => {
      useStore
        .getState()
        .setStatus({ taskId: started.id, occurrenceDate: null }, "IN_PROGRESS");
    });

    render(<PlansView selectedKey={null} onOpen={() => undefined} />);

    expect(within(tab(/Başladıklarım/)).getByText("1")).toBeTruthy();
    expect(within(tab(/Başlayacaklarım/)).getByText("1")).toBeTruthy();

    act(() => tab(/Başladıklarım/).click());
    expect(screen.getByText("Başladım")).toBeTruthy();
    expect(screen.queryByText("Başlamadım")).toBeNull();
  });

  it("still reaches the actions that moved behind the menu", () => {
    const plan = makePlan("Sunum", ["Slaytlar"]);
    render(<PlansView selectedKey={null} onOpen={() => undefined} />);

    // Four controls used to sit on every card at once. They are one press
    // deeper now, so this is the test that they are still reachable at all.
    act(() => screen.getByTitle("Diğer işlemler").click());
    expect(screen.getByText("Bu plana odaklan")).toBeTruthy();
    expect(screen.getByText("Planı sil")).toBeTruthy();

    act(() => screen.getByText("Bugüne Ata").click());
    expect(taskOf(plan.id).dueDate).toBe(toLocalDate(new Date()));
    expect(taskOf(plan.id).allDay).toBe(true);
  });

  it("turns a plan into a started one from the card itself", () => {
    const plan = makePlan("Sunum", ["Slaytlar"]);
    render(<PlansView selectedKey={null} onOpen={() => undefined} />);

    act(() => {
      screen.getByTitle("Bu plana başladım").click();
    });

    expect(taskOf(plan.id).status).toBe("IN_PROGRESS");
    // …and the same control takes it back, so the tab is not a one-way door.
    act(() => {
      screen.getByTitle("Henüz başlamadım olarak işaretle").click();
    });
    expect(taskOf(plan.id).status).toBe("TODO");
  });
});
