/**
 * Getting the text out of a PDF statement.
 *
 * Banks hand out statements as PDFs far more often than as CSV, and asking
 * someone to open the file, select ninety rows and paste them is asking them to
 * do the import by hand before the importer starts. The file goes in whole.
 *
 * Everything here happens on this machine: the bytes are read in the page, the
 * text never leaves it, and only the movements the user ticks are ever written
 * — let alone synced. A statement carries a card number and an address, and
 * neither of those belongs anywhere near a network call.
 *
 * A PDF has no lines. It has glyphs at coordinates, and "line" is something you
 * reconstruct from where they sit — which is why that reconstruction is a pure
 * function here, tested on its own, rather than something buried in the reader.
 */

/** One run of text, positioned in PDF user space. */
export interface PdfTextItem {
  str: string;
  x: number;
  /** PDF counts upwards from the bottom of the page, so bigger y is higher. */
  y: number;
  /** Advance width of the run, when the reader reports one. */
  width?: number;
}

/**
 * Baselines this close belong to the same row.
 *
 * A statement's columns are typeset together but rarely to the exact same
 * fraction of a point, and a tolerance of zero turns one movement into three
 * lines holding a date, a shop and an amount that no longer know about each
 * other.
 */
const LINE_TOLERANCE = 2;

/**
 * The gap, in PDF points, that counts as a space between two runs.
 *
 * Columns are separated by a wide gap and the letters inside a word by none, so
 * the distinction is not subtle at the sizes a statement is set in. It matters
 * in both directions: a missing space glues an amount onto a shop name, and an
 * invented one splits `A101` in two.
 */
const SPACE_GAP = 0.5;

/** The rows of a page, top to bottom, as text. */
export function linesFromItems(items: PdfTextItem[]): string[] {
  const rows: { y: number; items: PdfTextItem[] }[] = [];

  for (const item of items) {
    if (!item.str) continue;
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= LINE_TOLERANCE);
    if (row) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }

  rows.sort((a, b) => b.y - a.y);

  const lines: string[] = [];
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);

    let text = "";
    let cursor: number | null = null;
    for (const item of row.items) {
      if (cursor !== null && item.x - cursor > SPACE_GAP) text += " ";
      text += item.str;
      cursor = item.x + (item.width ?? 0);
    }

    const line = text.replace(/\s+/g, " ").trim();
    if (line) lines.push(line);
  }

  return lines;
}

/** Why a PDF could not be read, in terms the user can act on. */
export type PdfFailure =
  /** Encrypted. The bank mails these locked with a national id or birth date. */
  | "password"
  /** Not a PDF, or damaged beyond reading. */
  | "unreadable"
  /** A scan: pages of pictures, with no text layer to take. */
  | "no-text";

export class PdfTextError extends Error {
  constructor(readonly reason: PdfFailure) {
    super(`pdf: ${reason}`);
    this.name = "PdfTextError";
  }
}

/** `%PDF` — the four bytes every PDF starts with. */
export function looksLikePdf(head: Uint8Array): boolean {
  return head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
}

/**
 * Every page of a PDF as text, one movement per line where the layout allows.
 *
 * pdf.js is loaded on demand: it is by far the largest thing this app can
 * depend on, and someone who never imports a statement should never pay for it.
 */
export async function extractPdfText(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  // Vite hands back a URL for the bundled worker file; pdf.js parses off the
  // main thread, so a hundred-page statement does not freeze the window.
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  let doc;
  try {
    doc = await task.promise;
  } catch (error) {
    const name = (error as { name?: string })?.name ?? "";
    throw new PdfTextError(name === "PasswordException" ? "password" : "unreadable");
  }

  try {
    const lines: string[] = [];
    for (let page = 1; page <= doc.numPages; page += 1) {
      const content = await (await doc.getPage(page)).getTextContent();
      const items: PdfTextItem[] = [];
      for (const entry of content.items) {
        if (!("str" in entry)) continue;
        items.push({
          str: entry.str,
          x: entry.transform[4] as number,
          y: entry.transform[5] as number,
          width: entry.width,
        });
      }
      const rows = linesFromItems(items);
      /*
       * A row that runs across a page break is printed on both pages, and a
       * ledger that believes it bought the same thing twice is a ledger whose
       * month does not add up to the one the bank printed. Only the seam is
       * checked, and only for an exact repeat: two identical purchases on the
       * same day are ordinary, and anywhere but here they are kept.
       */
      if (rows[0] && rows[0] === lines[lines.length - 1]) rows.shift();
      lines.push(...rows);
    }

    const text = lines.join("\n");
    if (!text.trim()) throw new PdfTextError("no-text");
    return text;
  } finally {
    await task.destroy();
  }
}
