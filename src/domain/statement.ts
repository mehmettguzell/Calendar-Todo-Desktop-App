import { fold } from "./merchant";
import type { MoneyFlow } from "./money";
import type { LocalDate } from "./types";

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
export interface StatementLine {
  date: LocalDate;
  /** The descriptor exactly as the bank wrote it. */
  description: string;
  /** Always positive; direction lives in `flow`. */
  amountMinor: number;
  flow: MoneyFlow;
  /**
   * What kind of movement this is.
   *
   * A credit card statement is not a list of purchases: it also contains the
   * payment that cleared last month's balance, the annual fee, and the refund
   * for the shoes that did not fit. Counting a card payment as spending
   * double-counts every purchase it paid for, which is the single easiest way
   * to make a budget lie.
   */
  kind: "spend" | "refund" | "payment" | "fee" | "interest" | "cash";
  /** Position in the file, so two identical rows stay two rows. */
  index: number;
  raw: string;
}

export interface SkippedRow {
  raw: string;
  reason: "no-date" | "no-amount" | "summary" | "empty";
}

export type StatementSource = "card" | "account";

export interface ParseResult {
  lines: StatementLine[];
  skipped: SkippedRow[];
  container: "html" | "delimited" | "text";
  /** How the sign of an amount was read. See `detectSource`. */
  source: StatementSource;
  /** Which columns were understood, when the file had a header. */
  columns: DetectedColumns | null;
  /** The header row as the bank wrote it, for the preview to show. */
  header: string[] | null;
}

export interface DetectedColumns {
  date: number;
  description: number;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  balance: number | null;
}

/* ------------------------------------------------------------------ */
/* Numbers and dates                                                    */
/* ------------------------------------------------------------------ */

/**
 * Turkish money text to integer kuruş.
 *
 * `1.234,56` and `1,234.56` are the same amount written by two conventions, and
 * a statement can contain either depending on which locale the export screen
 * was set to. The last separator in the string is the decimal one — that single
 * rule settles both, and it is the only rule that cannot be fooled by a number
 * large enough to have both separators.
 *
 * Returns `null` rather than 0 for unreadable text: 0 is a valid amount, and a
 * parser that reports failure as zero produces a ledger that balances to
 * nothing.
 */
export function parseAmount(text: string): number | null {
  if (!text) return null;
  let clean = text.trim();
  if (!clean) return null;

  // (1.234,56) and 1.234,56- are both how a statement writes a negative.
  let negative = false;
  if (/^\(.*\)$/.test(clean)) {
    negative = true;
    clean = clean.slice(1, -1);
  }
  if (/-\s*$/.test(clean)) {
    negative = true;
    clean = clean.replace(/-\s*$/, "");
  }
  if (/^\s*-/.test(clean)) {
    negative = true;
    clean = clean.replace(/^\s*-/, "");
  }
  // Turkish statements mark a credit with a trailing plus rather than a sign:
  // "14.439,15+". The plus says which direction, not which sign, so it is read
  // as a marker in `creditMarked` and dropped here.
  clean = clean.replace(/^\s*\+/, "").replace(/\+\s*$/, "");

  clean = clean.replace(/[₺$€£]/g, "").replace(/\b(TL|TRY|USD|EUR|GBP)\b/gi, "");
  clean = clean.replace(/\s/g, "");
  if (!/\d/.test(clean)) return null;
  if (/[^\d.,]/.test(clean)) return null;

  const lastComma = clean.lastIndexOf(",");
  const lastDot = clean.lastIndexOf(".");
  let decimalAt = -1;

  if (lastComma >= 0 && lastDot >= 0) {
    decimalAt = Math.max(lastComma, lastDot);
  } else if (lastComma >= 0) {
    // A lone comma is decimal unless it is grouping thousands: "1,234".
    decimalAt = clean.length - lastComma - 1 === 3 && /^\d{1,3},\d{3}$/.test(clean) ? -1 : lastComma;
  } else if (lastDot >= 0) {
    decimalAt = clean.length - lastDot - 1 === 3 ? -1 : lastDot;
  }

  const whole = (decimalAt >= 0 ? clean.slice(0, decimalAt) : clean).replace(/[.,]/g, "");
  const fraction = decimalAt >= 0 ? clean.slice(decimalAt + 1).replace(/[.,]/g, "") : "";
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction)) return null;

  const minor =
    Number(whole || "0") * 100 + Number((fraction + "00").slice(0, 2) || "0");
  if (!Number.isFinite(minor)) return null;
  return negative ? -minor : minor;
}

const DATE_PATTERNS: [RegExp, (m: RegExpMatchArray) => [number, number, number]][] = [
  [/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/, (m) => [+m[1]!, +m[2]!, +m[3]!]],
  [/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/, (m) => [+m[3]!, +m[2]!, +m[1]!]],
  [
    /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$/,
    (m) => [2000 + +m[3]!, +m[2]!, +m[1]!],
  ],
];

/** Turkish month names, for the PDF layouts that spell them out. */
const MONTH_NAMES: Record<string, number> = {
  OCAK: 1, SUBAT: 2, MART: 3, NISAN: 4, MAYIS: 5, HAZIRAN: 6,
  TEMMUZ: 7, AGUSTOS: 8, EYLUL: 9, EKIM: 10, KASIM: 11, ARALIK: 12,
  OCA: 1, SUB: 2, MAR: 3, NIS: 4, MAY: 5, HAZ: 6,
  TEM: 7, AGU: 8, EYL: 9, EKI: 10, KAS: 11, ARA: 12,
};

/** `dd/MM/yyyy`, `yyyy-MM-dd`, `12 Ağustos 2026` … to `YYYY-MM-DD`, or null. */
export function parseDate(text: string): LocalDate | null {
  const clean = text.trim();
  if (!clean) return null;

  for (const [pattern, pick] of DATE_PATTERNS) {
    const match = clean.match(pattern);
    if (!match) continue;
    const [year, month, day] = pick(match);
    return assemble(year, month, day);
  }

  const spelled = fold(clean).match(/^(\d{1,2})\s+([A-Z]+)\s+(\d{4})$/);
  if (spelled) {
    const month = MONTH_NAMES[spelled[2] as string];
    if (month) return assemble(+spelled[3]!, month, +spelled[1]!);
  }
  return null;
}

function assemble(year: number, month: number, day: number): LocalDate | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 1990 || year > 2100) return null;
  const probe = new Date(year, month - 1, day);
  if (probe.getMonth() !== month - 1 || probe.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Row classification                                                   */
/* ------------------------------------------------------------------ */

/*
 * What kind of movement a row is, read from its wording.
 *
 * These patterns open with a word boundary and deliberately close without one:
 * Turkish glues its suffixes onto the noun, so a statement says ODEMESI and
 * AIDATI, never ODEME and AIDAT. Short initialisms keep both boundaries — an
 * unanchored EFT would match SEFTALI, and FAST would match BREAKFAST.
 */
const KIND_RULES: [RegExp, StatementLine["kind"]][] = [
  [/\bIADE|\bIPTAL|\bREFUND\b|\bCHARGEBACK\b/, "refund"],
  [
    /*
     * HESAPTAN and TESEKKUR carry no word boundary of their own: a PDF loses
     * the soft hyphens a bank sets its own wording with, so "sube-hesaptan
     * odeme-tesekkur ederiz" arrives as one run of letters. Anchoring those two
     * would let the row that cleared the card be imported as a purchase.
     */
    /\bKREDI\s*KARTI\s*ODEME|\bKART\s*BORCU|HESAPTAN[^|]*ODEME|TESEKKUR\s*EDERIZ|\bOTOMATIK\s*ODEME|\bODEME\s*ISLEMI|\bVIRMAN|\bEFT\b|\bHAVALE|\bFAST\b|\bTALIMATLI\s*ODEME/,
    "payment",
  ],
  [/\bAIDAT|\bUCRET|\bKOMISYON|\bMASRAF|\bBSMV\b|\bDAMGA|\bKKDF\b/, "fee"],
  [/\bFAIZ|\bGECIKME|\bTEMERRUT/, "interest"],
  [/\bNAKIT\s*(AVANS|CEKIM)|\bATM\b|\bPARA\s*CEKME/, "cash"],
];

export function classifyRow(description: string): StatementLine["kind"] {
  const folded = fold(description);
  for (const [pattern, kind] of KIND_RULES) {
    if (pattern.test(folded)) return kind;
  }
  return "spend";
}

/** Rows that are totals rather than movements. */
const SUMMARY_ROW =
  /\b(TOPLAM|ARA\s*TOPLAM|GENEL\s*TOPLAM|DEVREDEN|DEVIR|SON\s*ODEME\s*TARIHI|ASGARI\s*ODEME|HESAP\s*OZETI|EKSTRE\s*TARIHI|DONEM\s*BORCU|LIMIT|KULLANILABILIR|BAKIYE\s*$|ONCEKI\s*(DONEM|AY)|ISLEM\s*TARIHI)\b|^KART\s*NO\b/;

/* ------------------------------------------------------------------ */
/* Header detection                                                     */
/* ------------------------------------------------------------------ */

const HEADER_SYNONYMS = {
  date: [/^ISLEM\s*TARIHI$/, /^TARIH$/, /^VALOR(\s*TARIHI)?$/, /^DATE$/, /^TRANSACTION\s*DATE$/],
  description: [
    /^ACIKLAMA$/,
    /^ISLEM\s*ACIKLAMASI$/,
    /^ISYERI(\s*ADI)?$/,
    /^ISLEM$/,
    /^DETAY$/,
    /^DESCRIPTION$/,
    /^MERCHANT$/,
    /^ISLEM\s*TURU$/,
  ],
  amount: [/^TUTAR$/, /^ISLEM\s*TUTARI$/, /^AMOUNT$/, /^MIKTAR$/, /^TUTAR\s*\(TL\)$/],
  debit: [/^BORC$/, /^CIKAN$/, /^HARCAMA$/, /^DEBIT$/, /^ODENEN$/],
  credit: [/^ALACAK$/, /^GIREN$/, /^CREDIT$/, /^YATAN$/],
  balance: [/^BAKIYE$/, /^BALANCE$/, /^KALAN$/],
} as const;

function headerRole(cell: string): keyof typeof HEADER_SYNONYMS | null {
  const clean = fold(cell).replace(/[.:()]/g, "").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  for (const [role, patterns] of Object.entries(HEADER_SYNONYMS)) {
    for (const pattern of patterns as readonly RegExp[]) {
      if (pattern.test(clean)) return role as keyof typeof HEADER_SYNONYMS;
    }
  }
  return null;
}

/**
 * Find the row that names the columns.
 *
 * Statements start with a page of account details, so the header is rarely the
 * first row. A row counts as the header when it names a date column and either
 * an amount or a debit/credit pair — nothing else in the preamble does that.
 */
export function detectHeader(
  rows: string[][],
): { rowIndex: number; columns: DetectedColumns } | null {
  const limit = Math.min(rows.length, 40);
  for (let index = 0; index < limit; index += 1) {
    const row = rows[index] as string[];
    const found: Partial<Record<keyof typeof HEADER_SYNONYMS, number>> = {};
    row.forEach((cell, column) => {
      const role = headerRole(cell);
      // First match wins: "İşlem Tarihi" then "Valör" both mean date, and the
      // first one is the one people think of as the transaction's date.
      if (role && found[role] === undefined) found[role] = column;
    });

    const hasAmount = found.amount !== undefined;
    const hasPair = found.debit !== undefined || found.credit !== undefined;
    if (found.date === undefined || (!hasAmount && !hasPair)) continue;

    return {
      rowIndex: index,
      columns: {
        date: found.date,
        description: found.description ?? guessDescriptionColumn(row, found),
        amount: found.amount ?? null,
        debit: found.debit ?? null,
        credit: found.credit ?? null,
        balance: found.balance ?? null,
      },
    };
  }
  return null;
}

/** The widest column that is not already spoken for is the description. */
function guessDescriptionColumn(
  row: string[],
  found: Partial<Record<string, number>>,
): number {
  const taken = new Set(Object.values(found));
  let best = 0;
  let bestLength = -1;
  row.forEach((cell, column) => {
    if (taken.has(column)) return;
    if (cell.length > bestLength) {
      bestLength = cell.length;
      best = column;
    }
  });
  return best;
}

/* ------------------------------------------------------------------ */
/* Containers                                                           */
/* ------------------------------------------------------------------ */

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'",
  "&nbsp;": " ", "&ouml;": "ö", "&uuml;": "ü", "&ccedil;": "ç",
  "&Ouml;": "Ö", "&Uuml;": "Ü", "&Ccedil;": "Ç",
};

/**
 * Pull a table out of HTML with regular expressions.
 *
 * Deliberately not `DOMParser`: Turkish banks hand out ".xls" files that are
 * plain HTML tables, and those files are machine-generated, flat, and free of
 * the nesting that makes regex parsing of real HTML a bad idea. In exchange the
 * domain layer stays free of the DOM and runs the same way in a test.
 */
export function parseHtmlTable(content: string): string[][] {
  const rows: string[][] = [];
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellPattern = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;

  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowPattern.exec(content)) !== null) {
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    cellPattern.lastIndex = 0;
    while ((cellMatch = cellPattern.exec(rowMatch[1] as string)) !== null) {
      cells.push(stripTags(cellMatch[1] as string));
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

function stripTags(html: string): string {
  let text = html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "");
  for (const [entity, char] of Object.entries(ENTITIES)) {
    text = text.split(entity).join(char);
  }
  return text.replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(+code))
    .replace(/\s+/g, " ")
    .trim();
}

/** Pick the delimiter by counting candidates outside quotes. */
export function detectDelimiter(sample: string): string {
  const candidates = [";", "\t", ",", "|"];
  const lines = sample.split(/\r?\n/).filter((line) => line.trim()).slice(0, 20);
  let best = ";";
  let bestScore = -1;

  for (const candidate of candidates) {
    const counts = lines.map((line) => countOutsideQuotes(line, candidate));
    const used = counts.filter((n) => n > 0).length;
    if (used === 0) continue;
    // Consistency matters more than volume: the right delimiter appears the
    // same number of times on almost every line.
    const average = counts.reduce((a, b) => a + b, 0) / counts.length;
    const spread = counts.reduce((sum, n) => sum + Math.abs(n - average), 0) / counts.length;
    const score = used * 10 + average - spread * 5;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === delimiter) count += 1;
  }
  return count;
}

/** One delimited line to cells, honouring `""` escaping. */
export function splitDelimited(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i] as string;
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

/* ------------------------------------------------------------------ */
/* Direction                                                            */
/* ------------------------------------------------------------------ */

/**
 * Whether a positive number means money out or money in.
 *
 * The two kinds of statement disagree, and getting it backwards turns a month
 * of spending into a month of income:
 *
 *   - a **card** statement lists purchases as positive and the payment that
 *     cleared them as negative;
 *   - an **account** statement lists money leaving as negative.
 *
 * A balance column only ever appears on an account statement, and a card
 * statement is overwhelmingly positive. Both signals are cheap and neither is
 * ever wrong on its own, so the caller can still override.
 */
export function detectSource(
  columns: DetectedColumns | null,
  amounts: number[],
): StatementSource {
  if (columns?.balance !== null && columns?.balance !== undefined) return "account";
  if (columns?.debit !== null && columns?.debit !== undefined) return "account";
  if (amounts.length === 0) return "card";
  const positive = amounts.filter((value) => value > 0).length;
  return positive / amounts.length >= 0.7 ? "card" : "account";
}

/**
 * The amounts the direction vote is allowed to see.
 *
 * Purchases only: payments, refunds and fees are exactly the rows whose sign
 * runs against the grain of the statement they sit in.
 */
function spendAmounts(
  rows: { signed: number; kind: StatementLine["kind"] }[],
): number[] {
  const spend = rows.filter((row) => row.kind === "spend").map((row) => row.signed);
  return spend.length > 0 ? spend : rows.map((row) => row.signed);
}

function flowFor(signedMinor: number, source: StatementSource): MoneyFlow {
  const outgoing = source === "card" ? signedMinor > 0 : signedMinor < 0;
  return outgoing ? "EXPENSE" : "INCOME";
}

/* ------------------------------------------------------------------ */
/* The parser                                                           */
/* ------------------------------------------------------------------ */

export interface ParseOptions {
  /** Override the sign convention when the guess is wrong. */
  source?: StatementSource;
}

export function parseStatement(content: string, options: ParseOptions = {}): ParseResult {
  const text = content.replace(/^﻿/, "");
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
  const candidates: {
    date: LocalDate;
    description: string;
    signed: number;
    kind: StatementLine["kind"];
    raw: string;
  }[] = [];
  const skipped: SkippedRow[] = [];

  for (const row of body) {
    const raw = row.join(" | ").trim();
    if (!raw || row.every((cell) => !cell.trim())) {
      continue;
    }

    const dateCell = columns ? (row[columns.date] ?? "") : findDateCell(row);
    const date = parseDate(dateCell);
    if (!date) {
      // Preamble and totals are not failures; unreadable movements are.
      if (SUMMARY_ROW.test(fold(raw))) skipped.push({ raw, reason: "summary" });
      else skipped.push({ raw, reason: "no-date" });
      continue;
    }

    const signed = columns ? readSignedAmount(row, columns) : findAmountCell(row);
    if (signed === null) {
      skipped.push({ raw, reason: "no-amount" });
      continue;
    }

    const description = (
      columns ? (row[columns.description] ?? "") : findDescriptionCell(row)
    ).trim();
    if (!description) {
      skipped.push({ raw, reason: "empty" });
      continue;
    }
    if (SUMMARY_ROW.test(fold(description))) {
      skipped.push({ raw, reason: "summary" });
      continue;
    }

    candidates.push({ date, description, signed, kind: classifyRow(description), raw });
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

/**
 * Free text: a PDF, read or pasted into the box.
 *
 * One line, one movement: a date at the front, the amounts at the back, and the
 * merchant in between. Some layouts print the transaction date and the value
 * date side by side, so a second leading date is allowed and ignored.
 */
const TEXT_LINE_HEAD =
  /^\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})(?:\s+(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2}))?\s+(.+)$/;

/**
 * A token written the way money is written: a decimal part of exactly two
 * digits, optionally signed, optionally in a currency the line spells out.
 *
 * The strictness is the point. A card statement prints its columns side by side
 * — `244,99  0,00` is a lira amount and an empty dollar one — so the reader has
 * to know where the amounts start, and a merchant name is full of digits that
 * are not amounts. `Udemy +905326253880 399,99 0,00` has to end up as a payment
 * of 399,99 to Udemy, and nothing looser than this gets that right.
 */
const MONEY_TOKEN = /^[+-]?\(?\d[\d.,\s]*[.,]\d{2}\)?[+-]?(?:TL|TRY|USD|₺|\$)?$/i;

/** What the old single-column layouts print: any number, at the end. */
const LOOSE_AMOUNT = /^-?\(?[\d.,]+\)?-?(?:TL|TRY|₺)?$/i;

/** A currency standing on its own, the way "1.500,00 TL" is printed. */
const CURRENCY_TOKEN = /^(TL|TRY|USD|EUR|GBP|₺|\$|€|£)$/i;

/**
 * The movement in a line of free text: what it says, and what it cost.
 *
 * The trailing run of money is read as columns rather than as one number. Which
 * of them is the movement is decided by the same rule the tabular reader uses —
 * the amount comes before the balance, and before the currency column that
 * stayed at zero — so a statement means the same thing whichever way it was
 * exported. A row whose every column is zero is not a movement at all.
 */
/** "14.439,15+" — the way a Turkish statement writes money coming in. */
export function creditMarked(token: string): boolean {
  return /\+\s*$/.test(token.trim());
}

function splitTextLine(
  rest: string,
): { description: string; amount: number; credit: boolean } | null {
  const tokens = rest.split(/\s+/).filter(Boolean);

  // The currency is printed beside the number it belongs to, so it is part of
  // the trailing run rather than the end of the shop's name.
  let first = tokens.length;
  let money = false;
  while (first > 0) {
    const token = tokens[first - 1] as string;
    if (MONEY_TOKEN.test(token)) money = true;
    else if (!CURRENCY_TOKEN.test(token)) break;
    first -= 1;
  }

  // Nothing written like money at the end: fall back to whatever number is
  // there, which is how the simpler one-column layouts print.
  if (!money) {
    const last = tokens[tokens.length - 1] ?? "";
    if (!LOOSE_AMOUNT.test(last)) return null;
    const amount = parseAmount(last);
    if (amount === null) return null;
    return {
      description: tokens.slice(0, -1).join(" ").trim(),
      amount,
      credit: creditMarked(last),
    };
  }

  const description = tokens.slice(0, first).join(" ").trim();
  for (const token of tokens.slice(first)) {
    const amount = parseAmount(token);
    if (amount !== null && amount !== 0) {
      return { description, amount, credit: creditMarked(token) };
    }
  }
  return null;
}

function fromFreeText(rawLines: string[], options: ParseOptions): ParseResult {
  const candidates: {
    date: LocalDate;
    description: string;
    signed: number;
    credit: boolean;
    raw: string;
  }[] = [];
  const skipped: SkippedRow[] = [];

  for (const raw of rawLines) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;

    const match = line.match(TEXT_LINE_HEAD);
    if (!match) {
      if (SUMMARY_ROW.test(fold(line))) skipped.push({ raw: line, reason: "summary" });
      else skipped.push({ raw: line, reason: "no-date" });
      continue;
    }

    const date = parseDate(match[1] as string);
    if (!date) {
      skipped.push({ raw: line, reason: "no-date" });
      continue;
    }

    const split = splitTextLine(match[2] as string);
    if (!split) {
      if (SUMMARY_ROW.test(fold(line))) skipped.push({ raw: line, reason: "summary" });
      else skipped.push({ raw: line, reason: "no-amount" });
      continue;
    }
    const { description, amount: signed, credit } = split;
    if (!description || SUMMARY_ROW.test(fold(description))) {
      skipped.push({ raw: line, reason: "summary" });
      continue;
    }
    candidates.push({ date, description, signed, credit, raw: line });
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
