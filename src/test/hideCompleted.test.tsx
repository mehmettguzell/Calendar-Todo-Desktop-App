import { act } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/App";
import { DICTIONARY } from "@/lib/i18n";
import { useStore } from "@/state/store";

/**
 * The eye in the topbar hides finished work on every screen it is drawn on.
 *
 * Bugün was the screen it was ignored on, and it is the screen the app opens
 * to — so the button read as broken to anyone who pressed it first. The day
 * forced `showCompleted` on its own fetch so the progress ring would still
 * have a numerator, and then drew "Bugün tamamlananlar" off that same fetch.
 * The fetch still forces it; only the list is now behind the toggle.
 */
const TODAY = "2026-08-25";
const tr = DICTIONARY.tr as Record<string, string>;
/** The dictionary is indexed by a plain string here, so the lookup is widened. */
const say = (key: string) => tr[key] as string;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T09:00:00`));
  await useStore.getState().resetDatabase();
});

afterEach(() => {
  vi.useRealTimers();
});

async function mountWithOneFinishedTask() {
  render(<App />);
  await act(async () => {
    await useStore.getState().hydrate();
  });
  act(() => {
    const task = useStore
      .getState()
      .createTask({ title: "Biten iş", dueDate: TODAY, allDay: true });
    useStore
      .getState()
      .setStatus({ taskId: task.id, occurrenceDate: null }, "COMPLETED");
  });
}

/** The topbar's eye, whichever way round it currently is. */
const pressEye = () =>
  act(() => {
    screen
      .getByRole("button", {
        name: new RegExp(`${say("hideCompleted")}|${say("showCompleted")}`),
      })
      .click();
  });

describe("hiding completed work from the topbar", () => {
  it("takes the finished list off Bugün, and puts it back", async () => {
    await mountWithOneFinishedTask();

    // It starts hidden: `EMPTY_FILTERS` has `showCompleted` off.
    expect(screen.queryByText(say("todayCompletedHeading"))).toBeNull();
    expect(screen.queryByText("Biten iş")).toBeNull();

    pressEye();
    expect(screen.getByText(say("todayCompletedHeading"))).toBeTruthy();
    expect(screen.getByText("Biten iş")).toBeTruthy();

    pressEye();
    expect(screen.queryByText(say("todayCompletedHeading"))).toBeNull();
    expect(screen.queryByText("Biten iş")).toBeNull();
  });

  it("still counts the finished task in the day's total", async () => {
    await mountWithOneFinishedTask();

    // 1 done, with the list itself hidden — the hero counts the whole day,
    // which is the reason Bugün fetches past the filter at all.
    const doneStat = screen.getByText(say("todayDone")).closest("span");
    expect(doneStat?.textContent).toContain("1");
  });
});
