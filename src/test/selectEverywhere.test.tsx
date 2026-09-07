import { act } from "react";
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDatabase } from "@/data/db";
import { useSelectionStore } from "@/state/selectionStore";
import { useStore } from "@/state/store";
import { App } from "@/App";

/**
 * One selection, reachable from every screen that draws tasks.
 *
 * The bulk bar was always global — it is mounted beside the undo toast, not
 * inside a view, precisely so a selection survives switching screens. What was
 * not global was the way *in*: the "Seç" button existed on Görevler and
 * Planlar and nowhere else, so on the screen people spend the most time on the
 * feature simply did not appear to exist. Notes and calendar chips could not
 * be picked at all, by any gesture.
 */
const TODAY = "2026-09-02";

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T09:00:00`));
  localStorage.clear();
  useStore.setState({ db: emptyDatabase(), ready: false, runningFocus: null });
  useSelectionStore.getState().clear();
});

afterEach(() => {
  vi.useRealTimers();
});

async function mount() {
  render(<App />);
  await act(async () => {
    await useStore.getState().hydrate();
  });
}

/**
 * Press a sidebar entry. The pattern is a prefix, not a whole match: a nav
 * item carries its own count badge as soon as the view has anything in it.
 */
const goTo = (label: RegExp) =>
  act(() => {
    within(screen.getByRole("navigation")).getByRole("button", { name: label }).click();
  });

/** The topbar's one door into picking. */
const pressSelect = () =>
  act(() => {
    screen.getByRole("button", { name: /^Seç$/ }).click();
  });

const picked = () => useSelectionStore.getState().ids;

/**
 * After `mount`, never before: hydrating loads the (empty) document over
 * whatever the store was holding.
 */
const seedTask = (title: string, over: Record<string, unknown> = {}) => {
  let task = null as ReturnType<typeof useStore.getState>["createTask"] extends
    (...args: never) => infer R
    ? R | null
    : never;
  act(() => {
    task = useStore.getState().createTask({ title, dueDate: TODAY, ...over });
  });
  return task!;
};

describe("the select button", () => {
  it("is on every screen that has something to pick", async () => {
    await mount();

    for (const view of [/^Bugün/, /^Görevler/, /^Planlar/, /^Takvim/, /^Odaklanma/, /^Notlar/]) {
      goTo(view);
      expect(screen.queryByRole("button", { name: /^Seç$/ }), String(view)).not.toBeNull();
    }
  });

  it("is not on the one screen where it would do nothing", async () => {
    await mount();
    goTo(/^Bütçe/);

    // A bulk task action has nothing to apply to in the budget, and a button
    // that does nothing is worse than one that is absent.
    expect(screen.queryByRole("button", { name: /^Seç$/ })).toBeNull();
  });

  it("turns the mode off again when it is pressed a second time", async () => {
    await mount();
    seedTask("Slaytlar");
    goTo(/^Bugün/);

    pressSelect();
    expect(useSelectionStore.getState().active).toBe(true);
    pressSelect();
    expect(useSelectionStore.getState().active).toBe(false);
  });
});

describe("picking", () => {
  it("works on Today, which is the screen it was missing from", async () => {
    await mount();
    const task = seedTask("Slaytlar");
    goTo(/^Bugün/);

    pressSelect();
    act(() => {
      screen.getByRole("checkbox", { name: /Slaytlar/ }).click();
    });

    expect(picked()).toEqual([task.id]);
  });

  it("works on the focus list, which had no checkboxes at all", async () => {
    await mount();
    seedTask("Slaytlar");
    goTo(/^Odaklanma/);

    pressSelect();
    act(() => {
      screen.getByRole("checkbox", { name: /Slaytlar/ }).click();
    });

    expect(picked()).toHaveLength(1);
  });

  it("works on a note, which is a task with a tag on it", async () => {
    await mount();
    act(() => {
      useStore
        .getState()
        .createTask({ title: "Fikir", tags: ["note"], dueDate: null });
    });
    goTo(/^Notlar/);

    pressSelect();
    act(() => {
      screen.getByRole("checkbox", { name: /Fikir/ }).click();
    });

    expect(picked()).toHaveLength(1);
  });

  /*
   * A chip has no room for a checkbox, so the mode itself is the affordance:
   * while it is on, a click picks instead of opening.
   */
  it("works on a calendar chip, by clicking it while the mode is on", async () => {
    await mount();
    const task = seedTask("Sunum", { allDay: true });
    goTo(/^Takvim/);

    pressSelect();
    act(() => {
      screen.getAllByRole("button", { name: /Sunum/ })[0]!.click();
    });

    expect(picked()).toEqual([task.id]);
  });

  it("leaves a deadline marker alone: it is a date, not a task to act on", async () => {
    await mount();
    seedTask("Vize", { dueDate: "2026-09-20", deadline: TODAY, allDay: true });
    goTo(/^Takvim/);

    pressSelect();
    // The marker chip on today's cell carries the task's title; clicking it
    // must not quietly pick the task the date belongs to.
    const chips = screen.getAllByRole("button", { name: /Vize/ });
    act(() => {
      chips[0]!.click();
    });

    expect(picked()).toEqual([]);
  });
});

describe("a selection made on one screen", () => {
  it("is still held after switching to another", async () => {
    await mount();
    seedTask("Slaytlar");
    goTo(/^Bugün/);

    pressSelect();
    act(() => {
      screen.getByRole("checkbox", { name: /Slaytlar/ }).click();
    });
    goTo(/^Görevler/);

    // The bar is mounted beside the undo toast rather than inside a view for
    // exactly this reason.
    expect(picked()).toHaveLength(1);
    const bar = screen.getByRole("toolbar", { name: "Seçili görevler" });
    expect(within(bar).getByText("1 görev seçildi")).toBeTruthy();
  });
});
