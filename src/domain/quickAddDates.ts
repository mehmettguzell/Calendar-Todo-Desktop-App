import { addDaysLocal, minutesToTime, toLocalDate } from "./datetime";
import type { LocalDate, LocalTime } from "./types";

// Turning a written date or time into a real one, in Turkish and English. The
// order the rules are tried in is what decides how a phrase reads, so it is the
// whole design of this module.

export const WEEKDAYS: Record<string, number> = {
  pazar: 0, pazartesi: 1, sali: 2, salı: 2, carsamba: 3, çarşamba: 3,
  persembe: 4, perşembe: 4, cuma: 5, cumartesi: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

export const MONTHS: Record<string, number> = {
  ocak: 0, subat: 1, şubat: 1, mart: 2, nisan: 3, mayis: 4, mayıs: 4, haziran: 5,
  temmuz: 6, agustos: 7, ağustos: 7, eylul: 8, eylül: 8, ekim: 9, kasim: 10,
  kasım: 10, aralik: 11, aralık: 11,
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6,
  august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9,
  nov: 10, dec: 11,
};

/**
 * Every weekday spelling, longest first.
 *
 * Longest-first matters: `sun` would otherwise match inside `sunday` and leave
 * `day` stranded in the title.
 */
export const WEEKDAY_PATTERN = Object.keys(WEEKDAYS)
  .sort((a, b) => b.length - a.length)
  .join("|");

/** Strip Turkish diacritics so `Salı` and `sali` are the same word. */
export function fold(text: string): string {
  return text
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");
}

export interface When {
  now: Date;
  weekStartsOn: 0 | 1;
}

export type DateRule = [RegExp, string, (m: RegExpMatchArray) => LocalDate | null];

/**
 * Date shapes, most specific first.
 *
 * Order is the whole design: `25 Ağustos` has to be a date before `25` can be
 * read as a day number, and the skip-a-week weekday form has to run before the
 * bare one or the qualifier is left behind in the title.
 */
/** Shapes that name a specific day: numeric, or a month by name. */
function absoluteDateRules(now: Date): DateRule[] {
  return [
    // 2026-08-25
    [/(?:^|\s)(\d{4})-(\d{2})-(\d{2})(?=\s|$)/, "date", (m) =>
      isoDate(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
    ],
    // 25.08.2026 / 25/08/2026
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
  ];
}

/** Shapes that count from today: "3 gün sonra", "next friday", "yarın". */
function relativeDateRules({ now, weekStartsOn }: When): DateRule[] {
  return [
    [/(?:^|\s)(\d{1,3})\s*(gun|gün|day|days)\s*(sonra|later)?(?=\s|$)/iu, "relative", (m) => {
      if (!m[3] && !/gun|gün/i.test(m[2] ?? "")) return null;
      return addDaysLocal(toLocalDate(now), Number(m[1]));
    }],
    [/(?:^|\s)in\s+(\d{1,3})\s*(day|days|week|weeks)(?=\s|$)/iu, "relative", (m) => {
      const n = Number(m[1]);
      return addDaysLocal(toLocalDate(now), /week/i.test(m[2] ?? "") ? n * 7 : n);
    }],
    // next week / haftaya / gelecek hafta
    [/(?:^|\s)(gelecek\s+hafta|haftaya|next\s+week)(?=\s|$)/iu, "relative", () =>
      startOfNextWeek(now, weekStartsOn),
    ],
    [/(?:^|\s)(gelecek\s+ay|next\s+month)(?=\s|$)/iu, "relative", () =>
      toLocalDate(new Date(now.getFullYear(), now.getMonth() + 1, 1)),
    ],
    // today / tomorrow / the day after
    [/(?:^|\s)(bugun|bugün|today)(?=\s|$)/iu, "today", () => toLocalDate(now)],
    [/(?:^|\s)(yarin|yarın|tomorrow)(?=\s|$)/iu, "tomorrow", () =>
      addDaysLocal(toLocalDate(now), 1),
    ],
    [/(?:^|\s)(obur\s*gun|öbür\s*gün|ertesi\s*gun|ertesi\s*gün)(?=\s|$)/iu, "date", () =>
      addDaysLocal(toLocalDate(now), 2),
    ],
    [
      new RegExp(`(?:^|\\s)(?:gelecek|next|onumuzdeki|önümüzdeki)\\s+(${WEEKDAY_PATTERN})(?=\\s|$)`, "iu"),
      "weekday",
      (m) => weekdayDate(m[1], now, true),
    ],
    [
      new RegExp(`(?:^|\\s)(${WEEKDAY_PATTERN})(?=\\s|$)`, "iu"),
      "weekday",
      (m) => weekdayDate(m[1], now, false),
    ],
  ];
}

export function dateRules(when: When): DateRule[] {
  return [...absoluteDateRules(when.now), ...relativeDateRules(when)];
}

export function weekdayDate(
  word: string | undefined,
  now: Date,
  skipThisWeek: boolean,
): LocalDate | null {
  const weekday = WEEKDAYS[fold(word ?? "")];
  return weekday === undefined ? null : nextWeekday(now, weekday, skipThisWeek);
}

export interface DateHit {
  date: LocalDate;
  matched: string;
  ends: number;
}

/**
 * A date expression inside `fragment`, resolved with `rules`.
 *
 * `prefer` decides which one when the fragment holds several. Turkish puts the
 * date immediately before "kadar", so everything earlier in the sentence
 * ("yarin basla 20 Eylul'e kadar bitir") belongs to the start date and the last
 * match is the deadline; English puts it straight after "by", where the first
 * match is the right one.
 */
export function resolveDateIn(
  rules: DateRule[],
  fragment: string,
  prefer: "first" | "last" = "first",
): DateHit | null {
  let best: DateHit | null = null;
  for (const [pattern, , resolve] of rules) {
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
}

export function clockOf(hour: string | undefined, minute: string | undefined): LocalTime | null {
  const h = Number(hour);
  const m = Number(minute ?? "0");
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function shiftClock(time: LocalTime, minutes: number): LocalTime {
  const [h = "0", m = "0"] = time.split(":");
  return minutesToTime(Number(h) * 60 + Number(m) + minutes);
}

export function isoDate(year: number, month: number, day: number): LocalDate | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const d = new Date(year, month, day);
  // Rejects the 31st of a 30-day month rather than silently rolling into the
  // next one, which is how "31 Nisan" quietly becomes the 1st of May.
  if (d.getMonth() !== month || d.getDate() !== day) return null;
  return toLocalDate(d);
}

export function expandYear(year: number): number {
  return year < 100 ? 2000 + year : year;
}

/** The next occurrence of a weekday. Today counts unless `skipThisWeek`. */
export function nextWeekday(now: Date, weekday: number, skipThisWeek: boolean): LocalDate {
  const current = now.getDay();
  let delta = (weekday - current + 7) % 7;
  if (delta === 0 && skipThisWeek) delta = 7;
  if (skipThisWeek && delta < 7) delta += 7;
  return addDaysLocal(toLocalDate(now), delta);
}

export function startOfNextWeek(now: Date, weekStartsOn: 0 | 1): LocalDate {
  const current = now.getDay();
  const toStart = (weekStartsOn - current + 7) % 7 || 7;
  return addDaysLocal(toLocalDate(now), toStart);
}

/**
 * How the date is inflected depends on the word: a proper noun takes an
 * apostrophe ("Eylul'e"), an ordinary one does not ("yarina", "cumaya").
 * Rather than model Turkish suffixes, the candidates are tried in order and
 * every one is resolved — the untouched head of "yarin basla 20 Eylul'e"
 * resolves "yarin", which is the *start* date, while the suffix-stripped one
 * reaches "20 Eylul". The match closest to "kadar" is what the word is about.
 */
export function deadlineBeforeKadar(head: string, rules: DateRule[]): DateHit | null {
  const candidates = [
    head,
    head.replace(/['’][\p{L}]{1,3}$/u, ""),
    head.slice(0, -1),
    head.slice(0, -2),
    head.slice(0, -3),
  ];
  let found: DateHit | null = null;
  for (const candidate of candidates) {
    const hit = resolveDateIn(rules, candidate, "last");
    if (hit && (found === null || hit.ends > found.ends)) found = hit;
  }
  return found;
}

