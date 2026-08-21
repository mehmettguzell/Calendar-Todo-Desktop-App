import {
  addDays,
  addMinutes,
  differenceInCalendarDays,
  format,
  isValid,
  parse,
  startOfDay,
} from "date-fns";
import type { Instant, LocalDate, LocalTime } from "./types";

export const DATE_FMT = "yyyy-MM-dd";
export const TIME_FMT = "HH:mm";

/** Local calendar date of a `Date`, never UTC-shifted. */
export function toLocalDate(date: Date): LocalDate {
  return format(date, DATE_FMT);
}

export function toLocalTime(date: Date): LocalTime {
  return format(date, TIME_FMT);
}

/** Midnight (local) of a `YYYY-MM-DD` string. */
export function fromLocalDate(date: LocalDate): Date {
  return parse(date, DATE_FMT, new Date());
}

/** Combine a local date and an optional `HH:mm` into a local `Date`. */
export function atTime(date: LocalDate, time: LocalTime | null): Date {
  const base = fromLocalDate(date);
  if (!time) return startOfDay(base);
  const parsed = parse(time, TIME_FMT, base);
  return isValid(parsed) ? parsed : startOfDay(base);
}

export function nowInstant(): Instant {
  return new Date().toISOString();
}

export function toInstant(date: Date): Instant {
  return date.toISOString();
}

export function fromInstant(instant: Instant): Date {
  return new Date(instant);
}

export function today(): LocalDate {
  return toLocalDate(new Date());
}

export function addDaysLocal(date: LocalDate, days: number): LocalDate {
  return toLocalDate(addDays(fromLocalDate(date), days));
}

export function daysBetween(a: LocalDate, b: LocalDate): number {
  return differenceInCalendarDays(fromLocalDate(b), fromLocalDate(a));
}

export function isSameLocalDate(a: LocalDate | null, b: LocalDate | null): boolean {
  return a !== null && a === b;
}

/** Minutes since local midnight, for positioning items in the day grid. */
export function minutesFromMidnight(time: LocalTime): number {
  const [h, m] = time.split(":");
  return Number(h ?? 0) * 60 + Number(m ?? 0);
}

export function minutesToTime(minutes: number): LocalTime {
  const clamped = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function shiftTime(time: LocalTime, minutes: number): LocalTime {
  return minutesToTime(minutesFromMidnight(time) + minutes);
}

/** Duration in minutes between two `HH:mm` values on the same day. */
export function durationMinutes(start: LocalTime, end: LocalTime): number {
  return Math.max(0, minutesFromMidnight(end) - minutesFromMidnight(start));
}

export function addMinutesToInstant(instant: Instant, minutes: number): Instant {
  return toInstant(addMinutes(fromInstant(instant), minutes));
}

/** `Today at 14:00` / `Tomorrow` / `Mon, 25 Aug 14:00` for notifications and rows. */
export function describeWhen(
  date: LocalDate | null,
  time: LocalTime | null,
  reference: Date = new Date(),
): string {
  if (!date) return "No date";
  const diff = daysBetween(toLocalDate(reference), date);
  const dayLabel =
    diff === 0
      ? "Today"
      : diff === 1
        ? "Tomorrow"
        : diff === -1
          ? "Yesterday"
          : format(fromLocalDate(date), Math.abs(diff) < 300 ? "EEE, d MMM" : "d MMM yyyy");
  return time ? `${dayLabel} at ${time}` : dayLabel;
}

export function formatDate(date: LocalDate, pattern: string): string {
  return format(fromLocalDate(date), pattern);
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

/** Compact form used on task rows: `2h 15m`, `45m`, `—`. */
export function formatTracked(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0m";
  const m = Math.round(totalSeconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
