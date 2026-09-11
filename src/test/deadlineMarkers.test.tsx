import { act } from "react";
import { render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_FILTERS, useTodoGroups } from "@/state/selectors";
import { useStore } from "@/state/store";
import { TodayView } from "@/ui/views/TodayView";

/**
 * A deadline is a date, not a thing to do.
 *
 * Both kinds reached Today and Görevler as ordinary task rows: the day a task
 * must be finished by, and each named checkpoint under a plan. They arrived
 * with a checkbox, a priority stripe, a drag handle and a timer button — none
 * of which mean anything against a date — and, worse, they were counted: a day
 * with two tasks and two checkpoints said four things to do.
 *
 * They are still one click from the same editor. What these tests pin is that
 * they no longer travel through the lists that hold work.
 */
const TODAY = "2026-09-02";

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T09:00:00`));
  await useStore.getState().resetDatabase();
  await useStore.getState().hydrate();
});

afterEach(() => {
  vi.useRealTimers();
});

const store = () => useStore.getState();

const todayGroup = () => {
  const { result } = renderHook(() => useTodoGroups(EMPTY_FILTERS));
  return result.current.find((g) => g.id === "today")?.instances ?? [];
};

describe("a task whose deadline falls today", () => {
  /** Due next week, but the day it must be *finished* by is today. */
  const overhanging = () =>
    store().createTask({
      title: "Sunum",
      dueDate: "2026-09-09",
      deadline: TODAY,
    });

  it("is not one of today's todos", () => {
    overhanging();
    expect(todayGroup().map((i) => i.task.title)).not.toContain("Sunum");
  });

  it("still reaches Today, as a marker beside the lists", () => {
    overhanging();

    render(
      <TodayView filters={EMPTY_FILTERS} selectedKey={null} onOpen={() => undefined} />,
    );

    // Under its own heading, and it is not a task row: no checkbox went with it.
    expect(screen.getByText("Son tarihler")).toBeTruthy();
    const marker = screen.getByTitle(`Son tarih: ${TODAY}`);
    expect(marker.querySelector("input[type=checkbox]")).toBeNull();
    expect(marker.className).toContain("deadline-marker");
  });

  it("leaves the day's count to the work", () => {
    // One real task on today, plus a deadline that is not one.
    store().createTask({ title: "Prova", dueDate: TODAY });
    overhanging();

    render(
      <TodayView filters={EMPTY_FILTERS} selectedKey={null} onOpen={() => undefined} />,
    );

    // "1 açık", not "2": the marker is context for the day, not part of it.
    const open = screen.getByText("açık").closest(".today-hero-stat");
    expect(open?.textContent).toBe("1 açık");
  });
});

describe("a plan's named checkpoint", () => {
  it("shows under its own label, not as a step of the plan", () => {
    const plan = store().createTask({ title: "Tez", tags: ["plan"], dueDate: null });
    act(() => {
      store().addDeadline({ taskId: plan.id, label: "Backend bitecek", date: TODAY });
    });

    render(
      <TodayView filters={EMPTY_FILTERS} selectedKey={null} onOpen={() => undefined} />,
    );

    expect(screen.getByText("Backend bitecek")).toBeTruthy();
    // …and nothing in today's todos claims it.
    expect(todayGroup().map((i) => i.task.title)).not.toContain("Tez");
  });

  it("opens the deadline rather than the task when it is clicked", () => {
    const plan = store().createTask({ title: "Tez", tags: ["plan"], dueDate: null });
    let deadlineId: string | null = null;
    act(() => {
      const made = store().addDeadline({
        taskId: plan.id,
        label: "Backend bitecek",
        date: TODAY,
      });
      deadlineId = made?.id ?? null;
    });

    const opened: (string | null | undefined)[] = [];
    render(
      <TodayView
        filters={EMPTY_FILTERS}
        selectedKey={null}
        onOpen={(instance) => opened.push(instance.deadlineId)}
      />,
    );

    act(() => screen.getByText("Backend bitecek").click());
    expect(opened).toEqual([deadlineId]);
  });
});
