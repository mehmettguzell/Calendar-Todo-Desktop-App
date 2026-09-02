import type { Database } from "@/data/db";
import { atTime, formatDuration } from "./datetime";
import { sortDeadlines } from "./deadline";
import { expandOccurrences } from "./recurrence";
import type { Task } from "./types";

/**
 * Getting your data back out.
 *
 * "Is my data mine?" is a question people ask before they commit to an app, not
 * after — and the honest answer has to be demonstrable rather than promised.
 * Three formats, each aimed at what someone would actually do with it:
 *
 *  - **JSON** — the whole document, byte-for-byte what is on disk. A backup, and
 *    the input to any migration away from here.
 *  - **ICS** — the calendar, openable by Outlook, Google Calendar or Apple
 *    Calendar. Read-only by nature; this is an export, not a sync.
 *  - **CSV** — the budget ledger, for a spreadsheet.
 *
 * All three are pure string builders so they can be tested without a filesystem.
 */

export interface ExportFile {
  filename: string;
  mimeType: string;
  contents: string;
}

/** The whole document, exactly as it is persisted. */
export function exportJson(db: Database, today: string): ExportFile {
  return {
    filename: `tempo-${today}.json`,
    mimeType: "application/json",
    contents: JSON.stringify(db, null, 2),
  };
}

/* ------------------------------------------------------------------ */
/* iCalendar                                                           */
/* ------------------------------------------------------------------ */

/**
 * The calendar as an `.ics` file.
 *
 * A recurring series is written as its expanded occurrences rather than as an
 * RRULE. Less elegant, and correct: this app's rules and iCalendar's are not
 * the same language, and a mistranslation produces an event on the wrong day in
 * someone else's calendar — the one place they will never think to look for the
 * cause.
 */
export function exportIcs(
  db: Database,
  today: string,
  range: { from: string; to: string },
): ExportFile {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tempo//Calendar & Task Manager//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (const task of db.tasks) {
    if (task.deletedAt !== null || task.dueDate === null) continue;
    if (task.tags.includes("note")) continue;

    for (const date of expandOccurrences(task, range.from, range.to)) {
      lines.push(...vevent(task, date));
    }
  }

  lines.push("END:VCALENDAR");

  return {
    filename: `tempo-calendar-${today}.ics`,
    mimeType: "text/calendar",
    // RFC 5545 requires CRLF; some readers are strict about it.
    contents: `${lines.join("\r\n")}\r\n`,
  };
}

function vevent(task: Task, date: string): string[] {
  const timed = !task.allDay && task.startTime !== null;
  const stamp = icsStamp(new Date(task.updatedAt));

  const out = [
    "BEGIN:VEVENT",
    `UID:${task.id}-${date}@tempo.app`,
    `DTSTAMP:${stamp}`,
    `SUMMARY:${escapeIcs(task.title)}`,
  ];

  if (timed) {
    out.push(`DTSTART:${icsLocal(atTime(date, task.startTime))}`);
    out.push(
      `DTEND:${icsLocal(atTime(date, task.endTime ?? task.startTime))}`,
    );
  } else {
    // All-day events use a date value, and DTEND is exclusive — the day after
    // the last one covered, or a one-day event renders as zero-length.
    const last = task.endDate && task.endDate > date ? task.endDate : date;
    out.push(`DTSTART;VALUE=DATE:${compactDate(date)}`);
    out.push(`DTEND;VALUE=DATE:${compactDate(nextDay(last))}`);
  }

  if (task.description) out.push(`DESCRIPTION:${escapeIcs(task.description)}`);
  if (task.status === "COMPLETED") out.push("STATUS:CONFIRMED");
  if (task.priority === "HIGH") out.push("PRIORITY:1");
  for (const tag of task.tags) out.push(`CATEGORIES:${escapeIcs(tag)}`);

  out.push("END:VEVENT");
  return out;
}

/**
 * Commas, semicolons and newlines are structural in iCalendar.
 *
 * Backslash first, or escaping the others would then escape their own escapes.
 */
function escapeIcs(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function compactDate(date: string): string {
  return date.replace(/-/g, "");
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Floating local time: no `Z`, no timezone — the wall clock the user set. */
function icsLocal(date: Date): string {
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `T${pad(date.getHours())}${pad(date.getMinutes())}00`
  );
}

function icsStamp(date: Date): string {
  const valid = Number.isNaN(date.getTime()) ? new Date() : date;
  return `${valid.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/**
 * The budget ledger, for a spreadsheet.
 *
 * Amounts are written as decimals with a dot, because that is what every
 * spreadsheet on earth parses regardless of its locale — the display format
 * belongs to the app, not to the export.
 */
export function exportBudgetCsv(db: Database, today: string): ExportFile {
  const categories = new Map(db.budgetCategories.map((c) => [c.id, c.name]));
  const rows = [
    ["date", "flow", "category", "amount", "note"],
    ...db.transactions
      .filter((t) => t.deletedAt === null)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((t) => [
        t.date,
        t.flow,
        t.categoryId ? (categories.get(t.categoryId) ?? "") : "",
        (t.amountMinor / 100).toFixed(2),
        t.note,
      ]),
  ];

  return {
    filename: `tempo-budget-${today}.csv`,
    mimeType: "text/csv",
    contents: rows.map((row) => row.map(csvCell).join(",")).join("\n"),
  };
}

/** Tasks, for a spreadsheet. */
/**
 * A task's checkpoints in one cell: `label@date`, oldest first.
 *
 * A spreadsheet row is one task, and a task has any number of these, so they
 * are joined rather than given columns nobody could count in advance. Written
 * out at all because the alternative is an export that silently drops dates
 * the user typed.
 */
function deadlinesFor(db: Database, taskId: string): string {
  return sortDeadlines(
    db.deadlines.filter((d) => d.taskId === taskId && d.deletedAt === null),
  )
    .map((d) => `${d.label}@${d.date}`)
    .join("; ");
}

export function exportTasksCsv(db: Database, today: string): ExportFile {
  const categories = new Map(db.categories.map((c) => [c.id, c.name]));
  const trackedByTask = new Map<string, number>();
  for (const session of db.focusSessions) {
    trackedByTask.set(
      session.taskId,
      (trackedByTask.get(session.taskId) ?? 0) + session.durationSec,
    );
  }

  const rows = [
    [
      "title",
      "status",
      "priority",
      "category",
      "due_date",
      "end_date",
      "deadline",
      "deadlines",
      "start_time",
      "end_time",
      "tags",
      "estimate_minutes",
      "tracked",
      "created_at",
      "completed_at",
    ],
    ...db.tasks
      .filter((t) => t.deletedAt === null)
      .map((t) => [
        t.title,
        t.status,
        t.priority,
        t.categoryId ? (categories.get(t.categoryId) ?? "") : "",
        t.dueDate ?? "",
        t.endDate ?? "",
        t.deadline ?? "",
        deadlinesFor(db, t.id),
        t.startTime ?? "",
        t.endTime ?? "",
        t.tags.join(" "),
        t.estimateMinutes ? String(t.estimateMinutes) : "",
        formatDuration(trackedByTask.get(t.id) ?? 0),
        t.createdAt,
        t.completedAt ?? "",
      ]),
  ];

  return {
    filename: `tempo-tasks-${today}.csv`,
    mimeType: "text/csv",
    contents: rows.map((row) => row.map(csvCell).join(",")).join("\n"),
  };
}

/**
 * Quote a cell only when it needs it, and double any quotes inside.
 *
 * A leading `=`, `+`, `-` or `@` is prefixed with a quote as well: spreadsheets
 * treat those as the start of a formula, which turns an exported note into
 * executable content in someone else's file.
 */
function csvCell(value: string): string {
  const dangerous = /^[=+\-@\t\r]/.test(value);
  const text = dangerous ? `'${value}` : value;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
