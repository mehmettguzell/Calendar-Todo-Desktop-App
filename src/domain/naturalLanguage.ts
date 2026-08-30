import { addDaysLocal, minutesToTime, toLocalDate } from "./datetime";
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

const WEEKDAYS: Record<string, number> = {
  pazar: 0, pazartesi: 1, sali: 2, salı: 2, carsamba: 3, çarşamba: 3,
  persembe: 4, perşembe: 4, cuma: 5, cumartesi: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

const MONTHS: Record<string, number> = {
  ocak: 0, subat: 1, şubat: 1, mart: 2, nisan: 3, mayis: 4, mayıs: 4, haziran: 5,
  temmuz: 6, agustos: 7, ağustos: 7, eylul: 8, eylül: 8, ekim: 9, kasim: 10,
  kasım: 10, aralik: 11, aralık: 11,
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6,
  august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9,
  nov: 10, dec: 11,
};

const PRIORITY_WORDS: Record<string, Priority> = {
  "1": "HIGH", "2": "MEDIUM", "3": "LOW", "4": "NONE",
  yuksek: "HIGH", yüksek: "HIGH", high: "HIGH", acil: "HIGH", urgent: "HIGH",
  orta: "MEDIUM", medium: "MEDIUM",
  dusuk: "LOW", düşük: "LOW", low: "LOW",
};

/**
 * Every weekday spelling, longest first.
 *
 * Longest-first matters: `sun` would otherwise match inside `sunday` and leave
 * `day` stranded in the title.
 */
const WEEKDAY_PATTERN = Object.keys(WEEKDAYS)
  .sort((a, b) => b.length - a.length)
  .join("|");

/** Strip Turkish diacritics so `Salı` and `sali` are the same word. */
function fold(text: string): string {
  return text
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");
}

/**
 * One pass of rules over the input.
 *
 * Order matters and is deliberate: the most specific patterns run first, so
 * `14:00-16:00` is a range before `14:00` can claim the start of it, and
 * `25 Ağustos` is a date before `25` can be read as a day number.
 */
export function parseQuickAdd(
  input: string,
  now: Date = new Date(),
  weekStartsOn: 0 | 1 = 1,
): ParsedQuickAdd {
  const result = emptyParse();
  let text = ` ${input} `;

  /**
   * Try a rule against every place it matches, not just the first.
   *
   * "proje sunumu !1" is why: a pattern that can also match `p` finds `proje`
   * first, rejects it, and — if it stopped there — would never reach the real
   * `!1` two words later.
   */
  const eat = (pattern: RegExp, hint: string, apply: (m: RegExpMatchArray) => boolean) => {
    const global = new RegExp(pattern.source, pattern.flags.includes("g")
      ? pattern.flags
      : `${pattern.flags}g`);
    for (const match of [...text.matchAll(global)]) {
      if (!apply(match)) continue;
      text = text.replace(match[0], " ");
      result.hints.push(hint);
      return;
    }
  };

  /* --- category and tags ------------------------------------------------ */
  eat(/(?:^|\s)#([\p{L}\p{N}_-]+)/u, "category", (m) => {
    result.categoryName = m[1] ?? null;
    return result.categoryName !== null;
  });

  let tagMatch: RegExpMatchArray | null;
  const tagPattern = /(?:^|\s)@([\p{L}\p{N}_-]+)/u;
  while ((tagMatch = text.match(tagPattern)) !== null) {
    const tag = tagMatch[1];
    if (!tag) break;
    result.tags.push(tag);
    text = text.replace(tagMatch[0], " ");
  }
  if (result.tags.length > 0) result.hints.push("tags");

  /* --- priority --------------------------------------------------------- */
  eat(/(?:^|\s)(?:!([\p{L}\p{N}]+)|p([1-4]))(?=\s|$)/iu, "priority", (m) => {
    const key = fold(m[1] ?? m[2] ?? "");
    const priority = PRIORITY_WORDS[key];
    if (!priority) return false;
    result.priority = priority;
    return true;
  });

  /* --- estimate --------------------------------------------------------- */
  eat(/(?:^|\s)~\s*(\d+(?:[.,]\d+)?)\s*(dk|dak|dakika|m|min|mins|sa|saat|h|hr|hour|hours)(?=\s|$)/iu,
    "estimate",
    (m) => {
      const value = Number((m[1] ?? "0").replace(",", "."));
      if (!Number.isFinite(value) || value <= 0) return false;
      const unit = fold(m[2] ?? "");
      const isHours = ["sa", "saat", "h", "hr", "hour", "hours"].includes(unit);
      result.estimateMinutes = Math.round(isHours ? value * 60 : value);
      return true;
    });

  /* --- recurrence ------------------------------------------------------- */
  eat(
    // `\b` is ASCII-only in JavaScript, so `salı\b` never matches at all. Every
    // boundary here is written out as "followed by whitespace or the end".
    /(?:^|\s)(?:her\s+(gun|gün|hafta|ay|yil|yıl|pazartesi|sali|salı|carsamba|çarşamba|persembe|perşembe|cuma|cumartesi|pazar)|every\s+(day|week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(daily|weekly|monthly|yearly|gunluk|günlük|haftalik|haftalık|aylik|aylık|yillik|yıllık))(?=\s|$)/iu,
    "recurrence",
    (m) => {
      const token = fold(m[1] ?? m[2] ?? m[3] ?? "");
      if (!token) return false;

      if (["gun", "day", "daily", "gunluk"].includes(token)) {
        result.recurrence = { freq: "DAILY", interval: 1 };
        return true;
      }
      if (["hafta", "week", "weekly", "haftalik"].includes(token)) {
        result.recurrence = { freq: "WEEKLY", interval: 1 };
        return true;
      }
      if (["ay", "month", "monthly", "aylik"].includes(token)) {
        result.recurrence = { freq: "MONTHLY", interval: 1 };
        return true;
      }
      if (["yil", "year", "yearly", "yillik"].includes(token)) {
        result.recurrence = { freq: "YEARLY", interval: 1 };
        return true;
      }

      const weekday = WEEKDAYS[token];
      if (weekday === undefined) return false;
      // "her salı" means both the rule AND the first date it lands on.
      result.recurrence = { freq: "WEEKLY", interval: 1, byWeekday: [weekday] };
      result.dueDate = nextWeekday(now, weekday, false);
      return true;
    },
  );

  /* --- time range, then single time ------------------------------------- */
  eat(
    /(?:^|\s)(\d{1,2})[:.](\d{2})\s*(?:-|–|—|ile|to|until|arasi|arası)\s*(\d{1,2})[:.](\d{2})/iu,
    "time range",
    (m) => {
      const start = clockOf(m[1], m[2]);
      const end = clockOf(m[3], m[4]);
      if (!start || !end) return false;
      result.startTime = start;
      result.endTime = end;
      result.allDay = false;
      return true;
    },
  );

  if (!result.startTime) {
    eat(
      /(?:^|\s)(?:saat\s+|at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|öö|ös)?(?=\s|$)/iu,
      "time",
      (m) => {
        // A bare number is only a time when it is spelled like one, or when a
        // word made it unambiguous. Otherwise "buy 3 apples" becomes an
        // appointment at three in the morning.
        const hasMinutes = m[2] !== undefined;
        const meridiem = m[3] ? fold(m[3]) : null;
        const said = /saat\s+|at\s+/i.test(m[0]);
        if (!hasMinutes && !meridiem && !said) return false;

        let hour = Number(m[1]);
        if (!Number.isFinite(hour)) return false;
        if (meridiem === "pm" || meridiem === "os") hour = hour === 12 ? 12 : hour + 12;
        if (meridiem === "am" || meridiem === "oo") hour = hour === 12 ? 0 : hour;

        const clock = clockOf(String(hour), m[2] ?? "00");
        if (!clock) return false;
        result.startTime = clock;
        result.allDay = false;
        return true;
      },
    );
  }

  /* --- dates: most specific first --------------------------------------- */
  const dateRules: [RegExp, string, (m: RegExpMatchArray) => LocalDate | null][] = [
    // 25.08.2026 / 25/08/2026 / 2026-08-25
    [/(?:^|\s)(\d{4})-(\d{2})-(\d{2})(?=\s|$)/, "date", (m) =>
      isoDate(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
    ],
    [/(?:^|\s)(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?=\s|$)/, "date", (m) =>
      isoDate(
        m[3] ? expandYear(Number(m[3])) : now.getFullYear(),
        Number(m[2]) - 1,
        Number(m[1]),
      ),
    ],
    // 25 Ağustos  /  August 25
    [/(?:^|\s)(\d{1,2})\s+([\p{L}]+)(?:\s+(\d{4}))?(?=\s|$)/u, "date", (m) => {
      const month = MONTHS[fold(m[2] ?? "")];
      if (month === undefined) return null;
      return isoDate(m[3] ? Number(m[3]) : now.getFullYear(), month, Number(m[1]));
    }],
    [/(?:^|\s)([\p{L}]+)\s+(\d{1,2})(?:\s+(\d{4}))?(?=\s|$)/u, "date", (m) => {
      const month = MONTHS[fold(m[1] ?? "")];
      if (month === undefined) return null;
      return isoDate(m[3] ? Number(m[3]) : now.getFullYear(), month, Number(m[2]));
    }],
    // in 3 days / 3 gün sonra
    [/(?:^|\s)(\d{1,3})\s*(gun|gün|day|days)\s*(sonra|later)?(?=\s|$)/iu, "relative", (m) => {
      if (!m[3] && !/gun|gün/i.test(m[2] ?? "")) return null;
      return addDaysLocal(toLocalDate(now), Number(m[1]));
    }],
    [/(?:^|\s)in\s+(\d{1,3})\s*(day|days|week|weeks)(?=\s|$)/iu, "relative", (m) => {
      const n = Number(m[1]);
      const weeks = /week/i.test(m[2] ?? "");
      return addDaysLocal(toLocalDate(now), weeks ? n * 7 : n);
    }],
    // next week / haftaya / gelecek hafta
    [/(?:^|\s)(gelecek\s+hafta|haftaya|next\s+week)(?=\s|$)/iu, "relative", () =>
      startOfNextWeek(now, weekStartsOn),
    ],
    [/(?:^|\s)(gelecek\s+ay|next\s+month)(?=\s|$)/iu, "relative", () => {
      const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return toLocalDate(d);
    }],
    // today / tomorrow / the day after
    [/(?:^|\s)(bugun|bugün|today)(?=\s|$)/iu, "today", () => toLocalDate(now)],
    [/(?:^|\s)(yarin|yarın|tomorrow)(?=\s|$)/iu, "tomorrow", () =>
      addDaysLocal(toLocalDate(now), 1),
    ],
    [/(?:^|\s)(obur\s*gun|öbür\s*gün|ertesi\s*gun|ertesi\s*gün)(?=\s|$)/iu, "date", () =>
      addDaysLocal(toLocalDate(now), 2),
    ],
    // "gelecek cuma" / "next friday" — the skip-a-week form comes first, so the
    // qualifier is never left behind for the bare rule to trip over.
    [
      new RegExp(`(?:^|\\s)(?:gelecek|next|onumuzdeki|önümüzdeki)\\s+(${WEEKDAY_PATTERN})(?=\\s|$)`, "iu"),
      "weekday",
      (m) => {
        const weekday = WEEKDAYS[fold(m[1] ?? "")];
        return weekday === undefined ? null : nextWeekday(now, weekday, true);
      },
    ],
    [
      new RegExp(`(?:^|\\s)(${WEEKDAY_PATTERN})(?=\\s|$)`, "iu"),
      "weekday",
      (m) => {
        const weekday = WEEKDAYS[fold(m[1] ?? "")];
        return weekday === undefined ? null : nextWeekday(now, weekday, false);
      },
    ],
  ];

/**
   * A date expression inside `fragment`, resolved with the rules above.
   *
   * `prefer` decides which one when the fragment holds several. Turkish puts
   * the date immediately before "kadar", so everything earlier in the sentence
   * ("yarin basla 20 Eylul'e kadar bitir") belongs to the start date and the
   * last match is the deadline; English puts it straight after "by", where the
   * first match is the right one.
   */
  const resolveDateIn = (
    fragment: string,
    prefer: "first" | "last" = "first",
  ): { date: LocalDate; matched: string; ends: number } | null => {
    let best: { date: LocalDate; matched: string; ends: number } | null = null;
    for (const [pattern, , resolve] of dateRules) {
      const global = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
      for (const m of fragment.matchAll(global)) {
        const date = resolve(m);
        if (!date) continue;
        const ends = (m.index ?? 0) + m[0].length;
        const better = best === null || (prefer === "last" ? ends > best.ends : ends < best.ends);
        if (better) best = { date, matched: m[0].trim(), ends };
      }
    }
    return best;
  };

  /* --- deadline: "20 Eylul'e kadar" / "by 20 September" ------------------
   *
   * Run before the plain date rules, or "20 Eylul" is taken as a start date
   * and the deadline never happens. Turkish puts the date first and inflects
   * it, English puts it after the keyword: two shapes, one fact.
   */
  {
    const kadar = /(?:^|\s)kadar(?=\s|$)/iu.exec(text);
    const by = /(?:^|\s)(?:by|until)\s+/iu.exec(text);
    if (kadar) {
      /*
       * How the date is inflected depends on the word: a proper noun takes an
       * apostrophe ("Eylul'e"), an ordinary one does not ("yarina", "cumaya").
       * Rather than model Turkish suffixes, the candidates are tried in order
       * and the first that resolves to a real date wins.
       */
      const head = text.slice(0, kadar.index).replace(/\s+$/, "");
      const candidates = [
        head,
        head.replace(/['’][\p{L}]{1,3}$/u, ""),
        head.slice(0, -1),
        head.slice(0, -2),
        head.slice(0, -3),
      ];
      /*
       * Every candidate is tried, not just the first that hits: the untouched
       * head of "yarin basla 20 Eylul'e" resolves "yarin", which is the start
       * date, while the suffix-stripped one reaches "20 Eylul". The match
       * closest to "kadar" is the one the word is about.
       */
      let found: { date: LocalDate; matched: string; ends: number } | null = null;
      for (const candidate of candidates) {
        const hit = resolveDateIn(candidate, "last");
        if (hit && (found === null || hit.ends > found.ends)) found = hit;
      }
      if (found) {
        const start = text.indexOf(found.matched);
        result.deadline = found.date;
        text = text.slice(0, start) + " " + text.slice(kadar.index + kadar[0].length);
        result.hints.push("deadline");
      }
    } else if (by) {
      const tail = text.slice(by.index + by[0].length);
      const found = resolveDateIn(tail);
      if (found) {
        result.deadline = found.date;
        text = text.slice(0, by.index) + " " + tail.replace(found.matched, " ");
        result.hints.push("deadline");
      }
    }
  }

    if (!result.dueDate) {
    outer: for (const [pattern, hint, resolve] of dateRules) {
      const global = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
      for (const match of [...text.matchAll(global)]) {
        const date = resolve(match);
        if (!date) continue;
        result.dueDate = date;
        text = text.replace(match[0], " ");
        result.hints.push(hint);
        break outer;
      }
    }
  }

  /* --- multi-day range: "25 Ağustos - 28 Ağustos" already ate the first -- */
  if (result.dueDate) {
    eat(/(?:^|\s)(?:-|–|—|to)\s*(\d{4}-\d{2}-\d{2})(?=\s|$)/iu, "end date", (m) => {
      const end = m[1] ?? "";
      if (end <= (result.dueDate ?? "")) return false;
      result.endDate = end;
      return true;
    });
  }

  /* --- what is left is the title ---------------------------------------- */
  result.title = text.replace(/\s+/g, " ").trim();

  // A parse that consumed the entire input understood nothing useful: the user
  // typed "tomorrow" and meant it as the task name.
  if (!result.title) {
    return { ...emptyParse(input.trim()), hints: [] };
  }

  if (result.startTime && result.endTime === null && result.estimateMinutes) {
    result.endTime = shiftClock(result.startTime, result.estimateMinutes);
  }

  return result;
}

function clockOf(hour: string | undefined, minute: string | undefined): LocalTime | null {
  const h = Number(hour);
  const m = Number(minute ?? "0");
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function shiftClock(time: LocalTime, minutes: number): LocalTime {
  const [h = "0", m = "0"] = time.split(":");
  return minutesToTime(Number(h) * 60 + Number(m) + minutes);
}

function isoDate(year: number, month: number, day: number): LocalDate | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const d = new Date(year, month, day);
  // Rejects the 31st of a 30-day month rather than silently rolling into the
  // next one, which is how "31 Nisan" quietly becomes the 1st of May.
  if (d.getMonth() !== month || d.getDate() !== day) return null;
  return toLocalDate(d);
}

function expandYear(year: number): number {
  return year < 100 ? 2000 + year : year;
}

/** The next occurrence of a weekday. Today counts unless `skipThisWeek`. */
function nextWeekday(now: Date, weekday: number, skipThisWeek: boolean): LocalDate {
  const current = now.getDay();
  let delta = (weekday - current + 7) % 7;
  if (delta === 0 && skipThisWeek) delta = 7;
  if (skipThisWeek && delta < 7) delta += 7;
  return addDaysLocal(toLocalDate(now), delta);
}

function startOfNextWeek(now: Date, weekStartsOn: 0 | 1): LocalDate {
  const current = now.getDay();
  const toStart = (weekStartsOn - current + 7) % 7 || 7;
  return addDaysLocal(toLocalDate(now), toStart);
}

/** A one-line summary of what the parser understood, for the live preview. */
export function describeParse(parsed: ParsedQuickAdd): string[] {
  const chips: string[] = [];
  if (parsed.dueDate) {
    chips.push(
      parsed.endDate ? `${parsed.dueDate} → ${parsed.endDate}` : parsed.dueDate,
    );
  }
  if (parsed.deadline) chips.push("→ " + parsed.deadline);
  if (parsed.startTime) {
    chips.push(parsed.endTime ? `${parsed.startTime}–${parsed.endTime}` : parsed.startTime);
  }
  if (parsed.recurrence) chips.push(recurrenceChip(parsed.recurrence));
  if (parsed.priority !== "NONE") chips.push(`!${parsed.priority.toLowerCase()}`);
  if (parsed.categoryName) chips.push(`#${parsed.categoryName}`);
  for (const tag of parsed.tags) chips.push(`@${tag}`);
  if (parsed.estimateMinutes) chips.push(`~${parsed.estimateMinutes}dk`);
  return chips;
}

function recurrenceChip(rule: Recurrence): string {
  const base = { DAILY: "günlük", WEEKLY: "haftalık", MONTHLY: "aylık", YEARLY: "yıllık" };
  return base[rule.freq];
}
