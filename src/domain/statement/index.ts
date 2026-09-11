import { fold } from "../merchant";
import type { LocalDate } from "../types";
import type {
  DetectedColumns,
  ParseResult,
  SkippedRow,
  StatementLine,
  StatementSource,
} from "./rows";
import {
  classifyRow,
  detectSource,
  flowFor,
  spendAmounts,
  parseAmount,
  parseDate,
  SUMMARY_ROW,
} from "./values";
import {
  detectDelimiter,
  detectHeader,
  parseHtmlTable,
  splitDelimited,
  countOutsideQuotes,
} from "./table";
import {
  splitTextLine,
  TEXT_LINE_HEAD,
} from "./freeText";


/**
 * Reading a bank statement.
 *
 * There is no single Ziraat format, and there never will be: the same account
 * exports as semicolon CSV from one screen, as an ".xls" that is really an HTML
 * table from another, and as a PDF whose text you can only paste. A parser that
 * hard-codes one column layout works until the week the bank changes a heading.
 *
 * So this module detects rather than assumes. It sniffs the container (HTML
 * table / delimited text / free text), finds the header row by *meaning* rather
 * than by position, and falls back to reading each line with a regex when there
 * is no header at all. Every row it cannot read is handed back with a reason
 * instead of being dropped, because a statement that silently loses three lines
 * is worse than one that refuses to load.
 */

/** What a statement row turns into once it is understood. */
export interface ParseOptions {
  /** Override the sign convention when the guess is wrong. */
  source?: StatementSource;
}

export function parseStatement(content: string, options: ParseOptions = {}): ParseResult {
  const text = content.replace(/^\uFEFF/, "");
  const isHtml = /<\s*(table|tr|html|body)\b/i.test(text.slice(0, 4000));

  if (isHtml) {
    const rows = parseHtmlTable(text);
    return fromRows(rows, "html", options);
  }

  const lines = text.split(/\r?\n/);
  const delimiter = detectDelimiter(text);
  const delimited = lines.filter((line) => countOutsideQuotes(line, delimiter) >= 2);

  /*
   * Two rows is enough to be a table — a header and a single movement is a
   * perfectly ordinary one-line statement, and demanding three would send it
   * down the free-text path where the semicolons make it unreadable.
   *
   * When the tabular read comes back empty the file was something else after
   * all, so both readers get a turn and the one that understood more wins.
   */
  if (delimited.length >= 2) {
    const rows = lines
      .filter((line) => line.trim())
      .map((line) => splitDelimited(line, delimiter));
    const tabular = fromRows(rows, "delimited", options);
    if (tabular.lines.length > 0) return tabular;

    const free = fromFreeText(lines, options);
    return free.lines.length > tabular.lines.length ? free : tabular;
  }

  return fromFreeText(lines, options);
}

/** Tabular input: a header if there is one, positional guessing if there is not. */
interface RowCandidate {
  date: LocalDate;
  description: string;
  signed: number;
  kind: StatementLine["kind"];
  raw: string;
}

function describedBy(row: string[], columns: DetectedColumns | null): string {
  return (
    columns ? (row[columns.description] ?? "") : findDescriptionCell(row)
  ).trim();
}

/** One row, or the reason it is not a movement. Preamble and totals are not failures. */
function readRow(
  row: string[],
  columns: DetectedColumns | null,
): RowCandidate | SkippedRow | null {
  const raw = row.join(" | ").trim();
  if (!raw || row.every((cell) => !cell.trim())) return null;

  const date = parseDate(columns ? (row[columns.date] ?? "") : findDateCell(row));
  if (!date) {
    return { raw, reason: SUMMARY_ROW.test(fold(raw)) ? "summary" : "no-date" };
  }

  const signed = columns ? readSignedAmount(row, columns) : findAmountCell(row);
  if (signed === null) return { raw, reason: "no-amount" };

  const description = describedBy(row, columns);
  if (!description) return { raw, reason: "empty" };
  if (SUMMARY_ROW.test(fold(description))) return { raw, reason: "summary" };

  return { date, description, signed, kind: classifyRow(description), raw };
}

function isSkipped(read: RowCandidate | SkippedRow): read is SkippedRow {
  return "reason" in read;
}

function fromRows(
  rows: string[][],
  container: "html" | "delimited",
  options: ParseOptions,
): ParseResult {
  const detected = detectHeader(rows);
  const body = detected ? rows.slice(detected.rowIndex + 1) : rows;
  const columns = detected?.columns ?? null;

  /*
   * Read every row first, decide the direction second.
   *
   * The vote on "does positive mean money out" has to be taken over *purchases*
   * only. A card statement carries a payment and the odd refund as negatives,
   * and on a short statement those few rows are enough to drag a plain ratio
   * below the threshold — turning a month of spending into a month of income.
   */
  const candidates: RowCandidate[] = [];
  const skipped: SkippedRow[] = [];
  for (const row of body) {
    const read = readRow(row, columns);
    if (!read) continue;
    if (isSkipped(read)) skipped.push(read);
    else candidates.push(read);
  }

  const source = options.source ?? detectSource(columns, spendAmounts(candidates));
  const lines: StatementLine[] = candidates.map((candidate, index) => ({
    date: candidate.date,
    description: candidate.description,
    amountMinor: Math.abs(candidate.signed),
    flow: flowFor(candidate.signed, source),
    kind: candidate.kind,
    index,
    raw: candidate.raw,
  }));

  return {
    lines,
    skipped,
    container,
    source,
    columns,
    header: detected ? (rows[detected.rowIndex] as string[]) : null,
  };
}

/** Debit/credit columns win over a single signed amount when both exist. */
function readSignedAmount(row: string[], columns: DetectedColumns): number | null {
  if (columns.debit !== null) {
    const debit = parseAmount(row[columns.debit] ?? "");
    if (debit !== null && debit !== 0) return -Math.abs(debit);
  }
  if (columns.credit !== null) {
    const credit = parseAmount(row[columns.credit] ?? "");
    if (credit !== null && credit !== 0) return Math.abs(credit);
  }
  if (columns.amount !== null) return parseAmount(row[columns.amount] ?? "");
  return null;
}

function findDateCell(row: string[]): string {
  for (const cell of row) if (parseDate(cell)) return cell;
  return "";
}

/** Right-most readable number: statements put the balance last, amount before it. */
function findAmountCell(row: string[]): number | null {
  const numbers = row
    .map((cell) => parseAmount(cell))
    .map((value, index) => ({ value, index }))
    .filter((entry) => entry.value !== null);
  if (numbers.length === 0) return null;
  const pick = numbers.length > 1 ? numbers[numbers.length - 2] : numbers[0];
  return pick?.value ?? null;
}

function findDescriptionCell(row: string[]): string {
  let best = "";
  for (const cell of row) {
    if (parseDate(cell) || parseAmount(cell) !== null) continue;
    if (cell.trim().length > best.length) best = cell.trim();
  }
  return best;
}

interface TextCandidate {
  date: LocalDate;
  description: string;
  signed: number;
  credit: boolean;
  raw: string;
}

/** One free-text line, or the reason it carries no movement. */
function readTextLine(line: string): TextCandidate | SkippedRow {
  const summary = SUMMARY_ROW.test(fold(line));
  const match = line.match(TEXT_LINE_HEAD);
  if (!match) return { raw: line, reason: summary ? "summary" : "no-date" };

  const date = parseDate(match[1] as string);
  if (!date) return { raw: line, reason: "no-date" };

  const split = splitTextLine(match[2] as string);
  if (!split) return { raw: line, reason: summary ? "summary" : "no-amount" };

  const { description, amount: signed, credit } = split;
  if (!description || SUMMARY_ROW.test(fold(description))) {
    return { raw: line, reason: "summary" };
  }
  return { date, description, signed, credit, raw: line };
}

function fromFreeText(rawLines: string[], options: ParseOptions): ParseResult {
  const candidates: TextCandidate[] = [];
  const skipped: SkippedRow[] = [];

  for (const raw of rawLines) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const read = readTextLine(line);
    if ("reason" in read) skipped.push(read);
    else candidates.push(read);
  }

  const source =
    options.source ??
    detectSource(
      null,
      spendAmounts(
        candidates.map((c) => ({ signed: c.signed, kind: classifyRow(c.description) })),
      ),
    );
  const lines = candidates.map((candidate, index) => {
    /*
     * A marked credit is money coming in, and which sign that is depends on the
     * statement: a card lists what it charges you as positive, an account lists
     * what leaves as negative. Resolving it here, after the direction is known,
     * is what keeps the payment that cleared the card from being read as the
     * largest purchase of the month.
     */
    const signed = candidate.credit
      ? source === "card"
        ? -Math.abs(candidate.signed)
        : Math.abs(candidate.signed)
      : candidate.signed;
    return {
      date: candidate.date,
      description: candidate.description,
      amountMinor: Math.abs(signed),
      flow: flowFor(signed, source),
      kind: classifyRow(candidate.description),
      index,
      raw: candidate.raw,
    };
  });

  return { lines, skipped, container: "text", source, columns: null, header: null };
}

// The pieces a caller may need directly, from wherever they now live.
export { classifyRow, detectSource, parseAmount, parseDate } from "./values";
export { detectDelimiter, detectHeader, parseHtmlTable, splitDelimited } from "./table";
export { creditMarked } from "./freeText";
export * from "./rows";
