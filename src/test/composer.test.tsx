import { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "@/state/store";
import { Composer } from "@/ui/task/Composer";

/**
 * Adding a task should cost one line and one key.
 *
 * The modal it replaced put twelve controls on screen before a character was
 * typed, while the app already shipped a parser that reads most of them out of
 * a sentence. These tests pin the two halves of the bargain: the sentence
 * really does fill the fields, and the fields are all still there when the
 * sentence is not enough.
 */
const TUESDAY = "2026-08-25";
const WEDNESDAY = "2026-08-26";

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TUESDAY}T09:00:00`));
  await useStore.getState().resetDatabase();
  await useStore.getState().hydrate();
});

afterEach(() => {
  vi.useRealTimers();
});

const tasks = () => useStore.getState().db.tasks.filter((t) => !t.deletedAt);
const byTitle = (title: string) => tasks().find((t) => t.title === title);

function type(text: string) {
  const input = screen.getByPlaceholderText(/Ne yapılacak/);
  act(() => {
    fireEvent.change(input, { target: { value: text } });
  });
  return input;
}

function enter() {
  const input = screen.getByPlaceholderText(/Ne yapılacak/);
  act(() => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
}

describe("writing a task on one line", () => {
  it("takes the date, the time and the name out of the sentence", () => {
    render(<Composer />);
    type("yarın 14:00 sunum hazırla");
    enter();

    // The name is what is left after the schedule is understood: a task called
    // "yarın 14:00 sunum hazırla" would repeat its own due date back at you.
    const task = byTitle("sunum hazırla");
    expect(task).toBeTruthy();
    expect(task?.dueDate).toBe(WEDNESDAY);
    expect(task?.startTime).toBe("14:00");
    expect(task?.allDay).toBe(false);
  });

  it("shows what it understood before anything is saved", () => {
    render(<Composer />);
    type("yarın 14:00 sunum hazırla");

    // The parse is only safe to trust because this is on screen first — and it
    // says it back in the reader's own words, not as an ISO date.
    expect(screen.getByText("Yarın")).toBeTruthy();
    expect(screen.queryByText(WEDNESDAY)).toBeNull();
    expect(screen.getByText("14:00")).toBeTruthy();
    expect(tasks()).toHaveLength(0);
  });

  it("says a repeat rule in words too", () => {
    render(<Composer />);
    type("her pazartesi spor");

    // Not the raw "WEEKLY", and not a hard-coded Turkish word in the English
    // build: the same describer the task panel uses.
    expect(screen.queryByText("WEEKLY")).toBeNull();
    expect(screen.getByText(/hafta/i)).toBeTruthy();
  });

  it("files it under a category named with #, creating one if it is new", () => {
    render(<Composer />);
    type("rapor #Araştırma");
    enter();

    const task = byTitle("rapor");
    const category = useStore
      .getState()
      .db.categories.find((c) => c.id === task?.categoryId);
    expect(category?.name).toBe("Araştırma");
  });

  it("clears itself and stays put, ready for the next one", () => {
    render(<Composer />);
    type("ilk iş");
    enter();
    expect((screen.getByPlaceholderText(/Ne yapılacak/) as HTMLInputElement).value).toBe("");

    type("ikinci iş");
    enter();
    expect(byTitle("ilk iş")).toBeTruthy();
    expect(byTitle("ikinci iş")).toBeTruthy();
  });

  it("refuses an empty line rather than making a nameless task", () => {
    render(<Composer />);
    type("   ");
    enter();
    expect(tasks()).toHaveLength(0);
  });
});

describe("the details behind the line", () => {
  it("are folded away until they are asked for", () => {
    render(<Composer />);
    expect(screen.queryByLabelText("Kategori")).toBeNull();

    act(() => screen.getByTitle("Detaylar").click());

    // Everything the old twelve-field modal offered is still here.
    for (const label of ["Notlar", "Başlangıç tarihi", "Öncelik", "Kategori", "Etiketler"]) {
      expect(screen.getByText(label), label).toBeTruthy();
    }
  });

  it("open already filled in by the sentence", () => {
    render(<Composer />);
    type("yarın rapor");
    act(() => screen.getByTitle("Detaylar").click());

    const dates = screen
      .getAllByDisplayValue(WEDNESDAY)
      .filter((el) => el.getAttribute("type") === "date");
    expect(dates.length).toBeGreaterThan(0);
  });
});

describe("the seed", () => {
  it("lets the plans page make plans from the same box", () => {
    render(
      <Composer seed={{ tags: ["plan"], dueDate: null, allDay: true }} />,
    );
    type("Web sitemi yayınla");
    enter();

    const plan = byTitle("Web sitemi yayınla");
    expect(plan?.tags).toContain("plan");
    // A plan has no date of its own, even though the box defaults to today.
    expect(plan?.dueDate).toBeNull();
  });
});
