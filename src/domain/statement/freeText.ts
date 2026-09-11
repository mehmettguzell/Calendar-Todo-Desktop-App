
import { parseAmount } from "./values";

// A statement with no grid at all: one line per entry, the amount at the end.
/**
 * Free text: a PDF, read or pasted into the box.
 *
 * One line, one movement: a date at the front, the amounts at the back, and the
 * merchant in between. Some layouts print the transaction date and the value
 * date side by side, so a second leading date is allowed and ignored.
 */
export const TEXT_LINE_HEAD =
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

export function splitTextLine(
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
