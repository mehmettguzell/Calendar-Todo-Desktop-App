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

    // Anchored: the row's drag handle is also a button, and it names the task
    // it would move ("“Prepare…” taşı"), so an unanchored pattern matches both.
    const row = await screen.findByRole("button", {
      name: /^Prepare project presentation/,
    });
    act(() => {
      row.click();
    });

    // The panel owns these; if it threw, the tree would be empty.
    expect(screen.getByText(/Reminders|Hatırlatıcılar/)).toBeDefined();
    expect(screen.getByText(/Subtasks|Alt görevler/)).toBeDefined();
    // The app ships in Turkish by default, so the panel is asserted in either
    // language: what matters is that the button is there, not which dictionary
    // is loaded.
    expect(
      screen.getByRole("button", { name: /^(Complete|Tamamla)$/ }),
    ).toBeDefined();
  });

  it("still renders the panel once the task has a reminder", async () => {
    await mountApp();

    let taskId = "";
    act(() => {
      taskId = useStore
        .getState()
        .createTask({ title: "Dentist", dueDate: today }).id;
      useStore.getState().addReminder({
        taskId,
        kind: "RELATIVE",
        offsetMinutes: 10,
        remindAt: null,
      });
    });

    const row = await screen.findByRole("button", { name: /^Dentist/ });
    act(() => {
      row.click();
    });

    expect(screen.getByText(/10 (minutes before|dakika önce)/)).toBeDefined();
  });
});

/**
 * The panel filling the window.
 *
 * It is a frame state, not a task one: what matters is that it goes back — by
 * the button or by Escape — and that it does not follow the user to the next
 * task they open.
 */
describe("the panel at full size", () => {
  const openFirstTask = async (title: string) => {
    act(() => {
      useStore.getState().createTask({ title, dueDate: today });
    });
    const row = await screen.findByRole("button", {
      name: new RegExp(`^${title}`),
    });
    act(() => {
      row.click();
    });
  };

  const maximize = () =>
    act(() => {
      screen
        .getByRole("button", { name: /^(Full screen|Tam ekran)$/ })
        .click();
    });

  it("grows and shrinks again from the same control", async () => {
    await mountApp();
    await openFirstTask("Prepare project presentation");

    expect(document.querySelector(".panel.is-maximized")).toBeNull();

    maximize();
    expect(document.querySelector(".panel.is-maximized")).not.toBeNull();

    // The control is the same button wearing the other half of its label.
    act(() => {
      screen.getByRole("button", { name: /^(Restore|Küçült)$/ }).click();
    });
    expect(document.querySelector(".panel.is-maximized")).toBeNull();
  });

  it("gives Escape back the panel before it gives back the task", async () => {
    await mountApp();
    await openFirstTask("Dentist");
    maximize();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    // Shrunk, not closed: losing the task would be a surprise.
    expect(document.querySelector(".panel.is-maximized")).toBeNull();
    expect(document.querySelector(".panel")).not.toBeNull();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    // The panel outlives the selection by one animation, so "closed" here is
    // the exit having started rather than the node already being gone.
    expect(document.querySelector(".panel.is-closing")).not.toBeNull();
  });

  it("does not follow the user to the next task", async () => {
    await mountApp();
    await openFirstTask("Prepare project presentation");
    maximize();

    act(() => {
      screen.getByRole("button", { name: /^(Close panel|Paneli kapat)$/ }).click();
    });
    await openFirstTask("Dentist");

    // A maximised frame left over from a task you are done with is a surprise,
    // not a preference.
    expect(document.querySelector(".panel.is-maximized")).toBeNull();
  });
});
