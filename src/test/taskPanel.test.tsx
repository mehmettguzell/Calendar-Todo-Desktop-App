import { act } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { emptyDatabase } from "@/data/db";
import { toLocalDate } from "@/domain/datetime";
import { useStore } from "@/state/store";
import { App } from "@/App";

const today = toLocalDate(new Date());

beforeEach(() => {
  localStorage.clear();
  useStore.setState({ db: emptyDatabase(), ready: false, runningFocus: null });
});

async function mountApp() {
  render(<App />);
  await act(async () => {
    await useStore.getState().hydrate();
  });
}

describe("opening a task", () => {
  it("renders the detail panel without crashing", async () => {
    await mountApp();

    act(() => {
      useStore.getState().createTask({
        title: "Prepare project presentation",
        dueDate: today,
        allDay: false,
        startTime: "14:00",
      });
    });

    const row = await screen.findByRole("button", {
      name: /Prepare project presentation/,
    });
    act(() => {
      row.click();
    });

    // The panel owns these; if it threw, the tree would be empty.
    expect(screen.getByText(/Reminders|Hatırlatıcılar/)).toBeDefined();
    expect(screen.getByText(/Subtasks|Alt görevler/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Complete" })).toBeDefined();
  });

  it("still renders the panel once the task has a reminder", async () => {
    await mountApp();

    let taskId = "";
    act(() => {
      taskId = useStore.getState().createTask({ title: "Dentist", dueDate: today }).id;
      useStore.getState().addReminder({
        taskId,
        kind: "RELATIVE",
        offsetMinutes: 10,
        remindAt: null,
      });
    });

    const row = await screen.findByRole("button", { name: /Dentist/ });
    act(() => {
      row.click();
    });

    expect(screen.getByText("10 minutes before")).toBeDefined();
  });
});
