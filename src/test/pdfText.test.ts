import { describe, expect, it } from "vitest";
import { linesFromItems, looksLikePdf, type PdfTextItem } from "@/services/pdfText";

/**
 * A PDF has no lines, only glyphs at coordinates. Everything the statement
 * reader does downstream depends on this turning them back into rows, so the
 * cases here are the ones a real statement puts in front of it: columns far
 * apart, letters touching, and baselines that agree to within a rounding error.
 */
function item(str: string, x: number, y: number, width = str.length * 3): PdfTextItem {
  return { str, x, y, width };
}

describe("rebuilding the lines of a page", () => {
  it("reads a row left to right and the page top to bottom", () => {
    const lines = linesFromItems([
      item("244,99", 400, 700),
      item("05.07.2026", 40, 700),
      item("BAKKAL", 120, 680),
      item("06.07.2026", 40, 680),
    ]);

    expect(lines).toEqual(["05.07.2026 244,99", "06.07.2026 BAKKAL"]);
  });

  it("keeps a row together when its columns miss the baseline by a hair", () => {
    const lines = linesFromItems([
      item("12.08.2026", 40, 700),
      item("MIGROS", 120, 701.4),
      item("1.234,56", 400, 699),
    ]);

    expect(lines).toEqual(["12.08.2026 MIGROS 1.234,56"]);
  });

  it("spaces the columns apart without breaking a word in two", () => {
    // "A" and "101" are printed touching; the amount sits a column away.
    const lines = linesFromItems([
      { str: "A", x: 120, y: 700, width: 5 },
      { str: "101", x: 125, y: 700, width: 14 },
      { str: "142,24", x: 400, y: 700, width: 24 },
    ]);

    expect(lines).toEqual(["A101 142,24"]);
  });

  it("drops the runs that carry no text", () => {
    expect(linesFromItems([item("", 40, 700), item("   ", 60, 700)])).toEqual([]);
  });
});

describe("recognising a PDF", () => {
  it("goes by the leading bytes rather than the file name", () => {
    expect(looksLikePdf(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBe(true);
    expect(looksLikePdf(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(false);
    expect(looksLikePdf(new Uint8Array([]))).toBe(false);
  });
});
