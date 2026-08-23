import { describe, expect, it } from "vitest";
import { emptyDatabase, type Database } from "@/data/db";
import { exportBudgetCsv, exportIcs, exportJson, exportTasksCsv } from "../export";
import type { Task } from "../types";

const task = (overrides: Partial<Task> = {}): Task => ({
  id: "t1",
  title: "Prepare project presentation",
  description: "",
  status: "TODO",
  priority: "HIGH",
  dueDate: "2026-08-25",
  endDate: null,
  allDay: false,
  startTime: "14:00",
  endTime: "16:00",
  categoryId: null,
  tags: [],
  parentId: null,
  recurrence: null,
  snoozedUntil: null,
  order: 0,
  createdAt: "2026-08-20T09:00:00.000Z",
  updatedAt: "2026-08-20T09:00:00.000Z",
  completedAt: null,
  deletedAt: null,
  ...overrides,
});

const dbWith = (patch: Partial<Database>): Database => ({
  ...emptyDatabase(),
  ...patch,
});

const RANGE = { from: "2026-01-01", to: "2026-12-31" };

describe("JSON export", () => {
  it("round-trips the document exactly", () => {
    const db = dbWith({ tasks: [task()] });
    const file = exportJson(db, "2026-08-25");

    expect(file.filename).toBe("tempo-2026-08-25.json");
    expect(JSON.parse(file.contents)).toEqual(db);
  });
});

describe("iCalendar export", () => {
  const parse = (db: Database) => exportIcs(db, "2026-08-25", RANGE).contents;

  it("wraps the events in a valid calendar envelope, CRLF and all", () => {
    const ics = parse(dbWith({ tasks: [task()] }));
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics).toContain("VERSION:2.0");
  });

  it("writes a timed task as a local start and end", () => {
    const ics = parse(dbWith({ tasks: [task()] }));
    expect(ics).toContain("DTSTART:20260825T140000");
    expect(ics).toContain("DTEND:20260825T160000");
  });

  it("gives an all-day task an exclusive end date, or it renders as nothing", () => {
    const allDay = task({ allDay: true, startTime: null, endTime: null });
    const ics = parse(dbWith({ tasks: [allDay] }));

    expect(ics).toContain("DTSTART;VALUE=DATE:20260825");
    expect(ics).toContain("DTEND;VALUE=DATE:20260826");
  });

  it("covers the whole run of a multi-day task in one event", () => {
    const trip = task({
      allDay: true,
      startTime: null,
      endTime: null,
      endDate: "2026-08-28",
    });
    const ics = parse(dbWith({ tasks: [trip] }));

    expect(ics).toContain("DTSTART;VALUE=DATE:20260825");
    expect(ics).toContain("DTEND;VALUE=DATE:20260829");
  });

  it("expands a recurring series into separate events", () => {
    const weekly = task({
      recurrence: { freq: "WEEKLY", interval: 1, until: "2026-09-15" },
    });
    const ics = parse(dbWith({ tasks: [weekly] }));

    // Written out rather than as an RRULE: a mistranslated rule puts an event
    // on the wrong day in someone else's calendar.
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(4);
    expect(ics).not.toContain("RRULE");
  });

  it("gives every occurrence its own UID", () => {
    const weekly = task({
      recurrence: { freq: "WEEKLY", interval: 1, until: "2026-09-08" },
    });
    const uids = parse(dbWith({ tasks: [weekly] })).match(/^UID:.*$/gm) ?? [];
    expect(new Set(uids).size).toBe(uids.length);
  });

  it("escapes the characters that are structural in iCalendar", () => {
    const awkward = task({ title: "Buy milk, bread; and eggs\\cheese" });
    const ics = parse(dbWith({ tasks: [awkward] }));

    expect(ics).toContain("SUMMARY:Buy milk\\, bread\\; and eggs\\\\cheese");
  });

  it("leaves out trashed tasks, notes and undated work", () => {
    const db = dbWith({
      tasks: [
        task({ id: "a", deletedAt: "2026-08-24T00:00:00.000Z" }),
        task({ id: "b", tags: ["note"] }),
        task({ id: "c", dueDate: null }),
      ],
    });
    expect(parse(db)).not.toContain("BEGIN:VEVENT");
  });
});

describe("CSV export", () => {
  it("writes budget amounts as dot decimals, whatever the display locale", () => {
    const db = dbWith({
      budgetCategories: [
        {
          id: "c1",
          name: "Kira",
          flow: "EXPENSE",
          color: "#ef4444",
          icon: "🏠",
          builtIn: true,
          order: 0,
          updatedAt: "2026-08-01T00:00:00.000Z",
        },
      ],
      transactions: [
        {
          id: "x1",
          date: "2026-08-01",
          amountMinor: 12_000_50,
          flow: "EXPENSE",
          categoryId: "c1",
          note: "Ağustos",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
          deletedAt: null,
        },
      ],
    });

    const csv = exportBudgetCsv(db, "2026-08-25").contents;
    expect(csv.split("\n")[0]).toBe("date,flow,category,amount,note");
    expect(csv).toContain("2026-08-01,EXPENSE,Kira,12000.50,Ağustos");
  });

  it("quotes cells containing commas or quotes", () => {
    const db = dbWith({ tasks: [task({ title: 'Call "the bank", twice' })] });
    const csv = exportTasksCsv(db, "2026-08-25").contents;

    expect(csv).toContain('"Call ""the bank"", twice"');
  });

  it("defuses a cell a spreadsheet would treat as a formula", () => {
    // An exported note starting with `=` becomes executable content in someone
    // else's file. Prefixing it with a quote keeps it text.
    const db = dbWith({ tasks: [task({ title: "=1+1" })] });
    const csv = exportTasksCsv(db, "2026-08-25").contents;

    expect(csv).toContain("'=1+1");
    expect(csv).not.toMatch(/(^|,)=1\+1/m);
  });

  it("leaves trashed rows out of both exports", () => {
    const db = dbWith({
      tasks: [task({ deletedAt: "2026-08-24T00:00:00.000Z" })],
    });
    expect(exportTasksCsv(db, "2026-08-25").contents.split("\n")).toHaveLength(1);
  });
});
