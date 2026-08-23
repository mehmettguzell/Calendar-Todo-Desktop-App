import { act } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { emptyDatabase } from "@/data/db";
import { addDaysLocal, toLocalDate } from "@/domain/datetime";
import { representativeInstance } from "@/domain/task";
import { useStore } from "@/state/store";
import { App } from "@/App";

const today = toLocalDate(new Date());

/** Read a task's current instance straight from the store, as any view would. */
function instanceOf(taskId: string) {
  const { db, now } = useStore.getState();
  const task = db.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`No task ${taskId}`);
  const occurrences = new Map(db.occurrences.map((o) => [o.id, o]));
  return representativeInstance(task, occurrences, new Date(now));
}

async function mountApp() {
  const view = render(<App />);
  // Let hydrate() resolve before assertions.
  await act(async () => {
    await useStore.getState().hydrate();
  });
  return view;
}

beforeEach(() => {
  localStorage.clear();
  useStore.setState({ db: emptyDatabase(), ready: false, runningFocus: null });
});

describe("spec section 3 - one task, many views", () => {
  it("renders the same task in Today and in the calendar", async () => {
    await mountApp();

    act(() => {
      useStore.getState().createTask({
        title: "Prepare project presentation",
        dueDate: today,
        allDay: false,
        startTime: "14:00",
        endTime: "16:00",
        priority: "HIGH",
      });
    });

    // Today view.
    expect(await screen.findAllByText("Prepare project presentation")).not.toHaveLength(0);

    // Switch to the calendar: the same row, drawn as a chip.
    act(() => {
      // Language-agnostic on purpose: this test is about one task showing up
      // in two views, not about which locale the app happens to default to.
      screen.getByRole("button", { name: /Calendar|Takvim/ }).click();
    });
    expect(screen.getAllByText("Prepare project presentation").length).toBeGreaterThan(0);
  });

  it("completing from one view completes everywhere", async () => {
    await mountApp();

    let taskId = "";
    act(() => {
      taskId = useStore.getState().createTask({ title: "Send invoice", dueDate: today }).id;
    });

    act(() => {
      useStore.getState().toggleComplete(instanceOf(taskId));
    });

    // One record changed, so every projection agrees.
    expect(instanceOf(taskId).status).toBe("COMPLETED");
    expect(useStore.getState().db.tasks.find((t) => t.id === taskId)?.completedAt).not.toBeNull();
  });

  it("rescheduling from the todo side moves the calendar entry", async () => {
    await mountApp();

    let taskId = "";
    act(() => {
      taskId = useStore.getState().createTask({ title: "Dentist", dueDate: today }).id;
    });

    const moved = addDaysLocal(today, 3);
    act(() => {
      useStore.getState().reschedule(taskId, moved);
    });

    expect(instanceOf(taskId).date).toBe(moved);
    // Spec section 5: history survives the move.
    const history = useStore.getState().db.history.filter((h) => h.taskId === taskId);
    expect(history.some((h) => h.kind === "RESCHEDULED" && h.from?.startsWith(today))).toBe(true);
  });
});
