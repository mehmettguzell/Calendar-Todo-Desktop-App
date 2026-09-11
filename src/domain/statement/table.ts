import { fold } from "../merchant";
import type { DetectedColumns } from "./rows";

// Finding the grid: which delimiter, which columns, and how to get rows out
// of the HTML a bank calls a CSV.
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

export function countOutsideQuotes(line: string, delimiter: string): number {
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

function stripTags(html: string): string {
  let text = html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "");
  for (const [entity, char] of Object.entries(ENTITIES)) {
    text = text.split(entity).join(char);
  }
  return text.replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(+code))
    .replace(/\s+/g, " ")
    .trim();
}
