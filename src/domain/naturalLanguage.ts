import {
  clockOf,
  dateRules,
  deadlineBeforeKadar,
  fold,
  nextWeekday,
  resolveDateIn,
  shiftClock,
  WEEKDAYS,
  type DateRule,
  type When,
} from "./quickAddDates";
import type { LocalDate, LocalTime, Priority, Recurrence } from "./types";

/**
 * Type a task the way you would say it.
 *
 * "yarın 14:00 sunum hazırla #iş !1" becomes a scheduled, categorised,
 * high-priority task without touching a single field. This is consistently the
 * single most-requested feature in task managers that lack it, and the reason
 * is mechanical rather than aesthetic: capture that costs six clicks is capture
 * that does not happen, and a task never captured is the one that gets missed.
 *
 * Two rules keep it honest:
 *
 *   1. Everything it recognises is REMOVED from the title, so the title reads
 *      like a title and not like a command line.
 *   2. It never guesses. An input it does not understand becomes a plain task
 *      with that exact text — the worst case is the behaviour of a box with no
 *      parsing at all, never a task silently scheduled on the wrong day.
 *
 * Turkish and English are both understood, because the person typing switches
 * between them mid-sentence and the parser should not care.
 */

export interface ParsedQuickAdd {
  title: string;
  dueDate: LocalDate | null;
  endDate: LocalDate | null;
  /** From "...e kadar" / "by ...": the day it has to be finished by. */
  deadline: LocalDate | null;
  startTime: LocalTime | null;
  endTime: LocalTime | null;
  allDay: boolean;
  priority: Priority;
  /** Text after `#`. Resolved against real categories by the caller. */
  categoryName: string | null;
  tags: string[];
  recurrence: Recurrence | null;
  /** Rough duration in minutes from `~30dk` / `~2h`. */
  estimateMinutes: number | null;
  /** Human-readable list of what was understood, for the live preview. */
  hints: string[];
}

export function emptyParse(title = ""): ParsedQuickAdd {
  return {
    title,
    dueDate: null,
    endDate: null,
    deadline: null,
    startTime: null,
    endTime: null,
    allDay: true,
    priority: "NONE",
    categoryName: null,
    tags: [],
    recurrence: null,
    estimateMinutes: null,
    hints: [],
  };
}

const PRIORITY_WORDS: Record<string, Priority> = {
  "1": "HIGH", "2": "MEDIUM", "3": "LOW", "4": "NONE",
  yuksek: "HIGH", yüksek: "HIGH", high: "HIGH", acil: "HIGH", urgent: "HIGH",
  orta: "MEDIUM", medium: "MEDIUM",
  dusuk: "LOW", düşük: "LOW", low: "LOW",
};

/**
 * What a pass has understood so far, and what is left of the input.
 *
 * Every rule below eats the text it recognised, so the title is whatever
 * survives to the end — rule 1 of the two above, enforced by construction.
 */
interface Scan {
  text: string;
  result: ParsedQuickAdd;
}

/**
 * Try a rule against every place it matches, not just the first.
 *
 * "proje sunumu !1" is why: a pattern that can also match `p` finds `proje`
 * first, rejects it, and — if it stopped there — would never reach the real
 * `!1` two words later.
 */
function eat(
  scan: Scan,
  pattern: RegExp,
  hint: string,
  apply: (m: RegExpMatchArray) => boolean,
): void {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  for (const match of [...scan.text.matchAll(new RegExp(pattern.source, flags))]) {
    if (!apply(match)) continue;
    scan.text = scan.text.replace(match[0], " ");
    scan.result.hints.push(hint);
    return;
  }
}

function eatCategoryAndTags(scan: Scan): void {
  eat(scan, /(?:^|\s)#([\p{L}\p{N}_-]+)/u, "category", (m) => {
    scan.result.categoryName = m[1] ?? null;
    return scan.result.categoryName !== null;
  });

  const tagPattern = /(?:^|\s)@([\p{L}\p{N}_-]+)/u;
  let match: RegExpMatchArray | null;
  while ((match = scan.text.match(tagPattern)) !== null) {
    const tag = match[1];
    if (!tag) break;
    scan.result.tags.push(tag);
    scan.text = scan.text.replace(match[0], " ");
  }
  if (scan.result.tags.length > 0) scan.result.hints.push("tags");
}

function eatPriority(scan: Scan): void {
  eat(scan, /(?:^|\s)(?:!([\p{L}\p{N}]+)|p([1-4]))(?=\s|$)/iu, "priority", (m) => {
    const priority = PRIORITY_WORDS[fold(m[1] ?? m[2] ?? "")];
    if (!priority) return false;
    scan.result.priority = priority;
    return true;
  });
}

const HOUR_UNITS = ["sa", "saat", "h", "hr", "hour", "hours"];

function eatEstimate(scan: Scan): void {
  eat(
    scan,
    /(?:^|\s)~\s*(\d+(?:[.,]\d+)?)\s*(dk|dak|dakika|m|min|mins|sa|saat|h|hr|hour|hours)(?=\s|$)/iu,
    "estimate",
    (m) => {
      const value = Number((m[1] ?? "0").replace(",", "."));
      if (!Number.isFinite(value) || value <= 0) return false;
      const isHours = HOUR_UNITS.includes(fold(m[2] ?? ""));
      scan.result.estimateMinutes = Math.round(isHours ? value * 60 : value);
      return true;
    },
  );
}

/** Each row is the tokens that mean this frequency, in both languages. */
const FREQ_WORDS: [Recurrence["freq"], string[]][] = [
  ["DAILY", ["gun", "day", "daily", "gunluk"]],
  ["WEEKLY", ["hafta", "week", "weekly", "haftalik"]],
  ["MONTHLY", ["ay", "month", "monthly", "aylik"]],
  ["YEARLY", ["yil", "year", "yearly", "yillik"]],
];

function eatRecurrence(scan: Scan, when: When): void {
  eat(
    scan,
    // `\b` is ASCII-only in JavaScript, so `salı\b` never matches at all. Every
    // boundary here is written out as "followed by whitespace or the end".
    /(?:^|\s)(?:her\s+(gun|gün|hafta|ay|yil|yıl|pazartesi|sali|salı|carsamba|çarşamba|persembe|perşembe|cuma|cumartesi|pazar)|every\s+(day|week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(daily|weekly|monthly|yearly|gunluk|günlük|haftalik|haftalık|aylik|aylık|yillik|yıllık))(?=\s|$)/iu,
    "recurrence",
    (m) => {
      const token = fold(m[1] ?? m[2] ?? m[3] ?? "");
      if (!token) return false;

      const freq = FREQ_WORDS.find(([, words]) => words.includes(token));
      if (freq) {
        scan.result.recurrence = { freq: freq[0], interval: 1 };
        return true;
      }

      const weekday = WEEKDAYS[token];
      if (weekday === undefined) return false;
      // "her salı" means both the rule AND the first date it lands on.
      scan.result.recurrence = { freq: "WEEKLY", interval: 1, byWeekday: [weekday] };
      scan.result.dueDate = nextWeekday(when.now, weekday, false);
      return true;
    },
  );
}

function eatTimes(scan: Scan): void {
  eat(
    scan,
    /(?:^|\s)(\d{1,2})[:.](\d{2})\s*(?:-|–|—|ile|to|until|arasi|arası)\s*(\d{1,2})[:.](\d{2})/iu,
    "time range",
    (m) => {
      const start = clockOf(m[1], m[2]);
      const end = clockOf(m[3], m[4]);
      if (!start || !end) return false;
      scan.result.startTime = start;
      scan.result.endTime = end;
      scan.result.allDay = false;
      return true;
    },
  );
  if (scan.result.startTime) return;

  eat(
    scan,
    /(?:^|\s)(?:saat\s+|at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|öö|ös)?(?=\s|$)/iu,
    "time",
    (m) => {
      const clock = clockFromLooseTime(m);
      if (!clock) return false;
      scan.result.startTime = clock;
      scan.result.allDay = false;
      return true;
    },
  );
}

/** "ös"/"pm" pushes an afternoon hour up; noon and midnight are the exceptions. */
function withMeridiem(hour: number, meridiem: string | null): number {
  if (meridiem === "pm" || meridiem === "os") return hour === 12 ? 12 : hour + 12;
  if (meridiem === "am" || meridiem === "oo") return hour === 12 ? 0 : hour;
  return hour;
}

/**
 * A bare number is only a time when it is spelled like one, or when a word made
 * it unambiguous. Otherwise "buy 3 apples" becomes an appointment at three in
 * the morning.
 */
function clockFromLooseTime(m: RegExpMatchArray): LocalTime | null {
  const hasMinutes = m[2] !== undefined;
  const meridiem = m[3] ? fold(m[3]) : null;
  const said = /saat\s+|at\s+/i.test(m[0]);
  if (!hasMinutes && !meridiem && !said) return null;

  const hour = Number(m[1]);
  if (!Number.isFinite(hour)) return null;
  return clockOf(String(withMeridiem(hour, meridiem)), m[2] ?? "00");
}

/**
 * "20 Eylul'e kadar" / "by 20 September".
 *
 * Runs before the plain date rules, or "20 Eylul" is taken as a start date and
 * the deadline never happens. Turkish puts the date first and inflects it,
 * English puts it after the keyword: two shapes, one fact.
 */
function eatDeadline(scan: Scan, rules: DateRule[]): void {
  const kadar = /(?:^|\s)kadar(?=\s|$)/iu.exec(scan.text);
  if (kadar) {
    const head = scan.text.slice(0, kadar.index).replace(/\s+$/, "");
    const found = deadlineBeforeKadar(head, rules);
    if (!found) return;
    const start = scan.text.indexOf(found.matched);
    scan.result.deadline = found.date;
    scan.text =
      scan.text.slice(0, start) +
      " " +
      scan.text.slice(kadar.index + kadar[0].length);
    scan.result.hints.push("deadline");
    return;
  }

  const by = /(?:^|\s)(?:by|until)\s+/iu.exec(scan.text);
  if (!by) return;
  const tail = scan.text.slice(by.index + by[0].length);
  const found = resolveDateIn(rules, tail);
  if (!found) return;
  scan.result.deadline = found.date;
  scan.text = scan.text.slice(0, by.index) + " " + tail.replace(found.matched, " ");
  scan.result.hints.push("deadline");
}

function eatDueDate(scan: Scan, rules: DateRule[]): void {
  if (scan.result.dueDate) return;
  for (const [pattern, hint, resolve] of rules) {
    const global = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
    for (const match of [...scan.text.matchAll(global)]) {
      const date = resolve(match);
      if (!date) continue;
      scan.result.dueDate = date;
      scan.text = scan.text.replace(match[0], " ");
      scan.result.hints.push(hint);
      return;
    }
  }
}

/** "25 Ağustos - 28 Ağustos": the first half is already the due date. */
function eatEndDate(scan: Scan): void {
  if (!scan.result.dueDate) return;
  eat(scan, /(?:^|\s)(?:-|–|—|to)\s*(\d{4}-\d{2}-\d{2})(?=\s|$)/iu, "end date", (m) => {
    const end = m[1] ?? "";
    if (end <= (scan.result.dueDate ?? "")) return false;
    scan.result.endDate = end;
    return true;
  });
}

export function parseQuickAdd(
  input: string,
  now: Date = new Date(),
  weekStartsOn: 0 | 1 = 1,
): ParsedQuickAdd {
  const scan: Scan = { text: ` ${input} `, result: emptyParse() };
  const when: When = { now, weekStartsOn };

  eatCategoryAndTags(scan);
  eatPriority(scan);
  eatEstimate(scan);
  eatRecurrence(scan, when);
  eatTimes(scan);

  const rules = dateRules(when);
  eatDeadline(scan, rules);
  eatDueDate(scan, rules);
  eatEndDate(scan);

  const result = scan.result;
  result.title = scan.text.replace(/\s+/g, " ").trim();

  // A parse that consumed the entire input understood nothing useful: the user
  // typed "tomorrow" and meant it as the task name.
  if (!result.title) return { ...emptyParse(input.trim()), hints: [] };

  if (result.startTime && result.endTime === null && result.estimateMinutes) {
    result.endTime = shiftClock(result.startTime, result.estimateMinutes);
  }
  return result;
}

/**
 * What the parser understood, said back the way a person would say it.
 *
 * This is the whole reason typing a sentence is safe: a guess you can read
 * before you commit is a guess worth trusting. Which means it has to be
 * readable — the preview used to answer "yarın" with `2026-08-26` and a repeat
 * rule with the hard-coded Turkish word "günlük", so the one surface whose job
 * is to prove the app understood you was speaking in ISO dates and, in the
 * English build, in Turkish.
 *
 * The formatting pieces are passed in rather than imported, because this file
 * is domain code and knows nothing about the dictionary. Called without them
 * it still works, in raw form — which is what a test asserting on shapes
 * rather than on words wants.
 */
/* eslint-disable-next-line complexity -- a flat list of chips, one per field */
export function describeParse(
  parsed: ParsedQuickAdd,
  format?: {
    /** Turns a date into "Yarın" / "Sal, 26 Ağu". */
    day: (date: LocalDate) => string;
    /** Turns a recurrence into "her hafta". */
    repeat: (rule: Recurrence) => string;
    /** The word for a deadline, e.g. "son: 20 Eyl". */
    deadline: (date: string) => string;
  },
): string[] {
  const day = format?.day ?? ((date: LocalDate) => date);
  const chips: string[] = [];

  if (parsed.dueDate) {
    chips.push(
      parsed.endDate
        ? `${day(parsed.dueDate)} → ${day(parsed.endDate)}`
        : day(parsed.dueDate),
    );
  }
  if (parsed.deadline) {
    const shown = day(parsed.deadline);
    chips.push(format ? format.deadline(shown) : "→ " + shown);
  }
  if (parsed.startTime) {
    chips.push(
      parsed.endTime
        ? `${parsed.startTime}–${parsed.endTime}`
        : parsed.startTime,
    );
  }
  if (parsed.recurrence) {
    chips.push(
      format ? format.repeat(parsed.recurrence) : parsed.recurrence.freq,
    );
  }
  if (parsed.priority !== "NONE") {
    chips.push(`!${parsed.priority.toLowerCase()}`);
  }
  if (parsed.categoryName) chips.push(`#${parsed.categoryName}`);
  for (const tag of parsed.tags) chips.push(`@${tag}`);
  if (parsed.estimateMinutes) chips.push(`~${parsed.estimateMinutes}'`);
  return chips;
}
