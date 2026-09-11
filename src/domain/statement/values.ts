import { fold } from "../merchant";
import { LocalDate } from "../types";
import type { MoneyFlow } from "../money";
import type {
  DetectedColumns,
  StatementLine,
  StatementSource,
} from "./rows";

// Reading one cell: an amount, a date, or what kind of row this is.
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
export const SUMMARY_ROW =
  /\b(TOPLAM|ARA\s*TOPLAM|GENEL\s*TOPLAM|DEVREDEN|DEVIR|SON\s*ODEME\s*TARIHI|ASGARI\s*ODEME|HESAP\s*OZETI|EKSTRE\s*TARIHI|DONEM\s*BORCU|LIMIT|KULLANILABILIR|BAKIYE\s*$|ONCEKI\s*(DONEM|AY)|ISLEM\s*TARIHI)\b|^KART\s*NO\b/;

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
export function spendAmounts(
  rows: { signed: number; kind: StatementLine["kind"] }[],
): number[] {
  const spend = rows.filter((row) => row.kind === "spend").map((row) => row.signed);
  return spend.length > 0 ? spend : rows.map((row) => row.signed);
}

export function flowFor(signedMinor: number, source: StatementSource): MoneyFlow {
  const outgoing = source === "card" ? signedMinor > 0 : signedMinor < 0;
  return outgoing ? "EXPENSE" : "INCOME";
}

/* ------------------------------------------------------------------ */
/* The parser                                                           */
/* ------------------------------------------------------------------ */
