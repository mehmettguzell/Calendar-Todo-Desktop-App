import type { CategoryKey } from "./money";
import { BRANDS, type Brand } from "./merchantBrands";
import { CATEGORY_TERMS, KEYWORD_CATEGORIES } from "./merchantTerms";

// `Brand` used to live here; keep it reachable for callers that name the type.
export type { Brand };

/**
 * Turning a card descriptor into a merchant.
 *
 * What a bank actually writes on a statement line is not a shop name. It is a
 * shop name buried in an acquirer's formatting:
 *
 *     MIGROS TIC.A.S.-5M ATASEHIR   ISTANBUL TR
 *     CARREFOURSA CARREFOUR SABANCI TIC.MRK.A.S ISTANBUL TR
 *     GOOGLE *YOUTUBEPREMIUM        G.CO/HELPPAY# IE
 *
 * All three are one shop each, and nothing downstream can group spending until
 * something turns them into "Migros", "CarrefourSA" and "YouTube Premium". That
 * is this module's only job, and it does it in two stages that are deliberately
 * kept apart:
 *
 *   1. `normalise` strips the formatting — accents, legal suffixes, branch
 *      numbers, cities, terminal ids, payment processors — down to the words a
 *      human would read.
 *   2. `identifyMerchant` recognises the result against a table of known chains,
 *      and failing that, against the trade words the long tail is named after.
 *
 * Stage 2 can fail; stage 1 never does. An unrecognised merchant still comes
 * back with a readable name, so the ledger degrades to "the shop on the corner"
 * rather than to a reference number.
 *
 * ## Descriptors arrive damaged
 *
 * Everything awkward in this file exists because of four things a real Turkish
 * statement does to a shop's name before it reaches us — all four of them
 * visible on one Ziraat credit-card statement:
 *
 *   - **The name is cut to a fixed width.** Ziraat's merchant field is twenty
 *     characters, so "Yemeksepeti" arrives as `YEMEK SEPET`, "Rossmann" as
 *     `ROSSM`, and "Kuşadası Devlet Hastanesi" as `KUSADASI DEVLET HAST`. A rule
 *     that only matches whole words matches none of the three. See `MIN_TERM`.
 *   - **The store code is welded onto the chain name.** `ŞOK13428`,
 *     `99159481A101`. While the two are one token the branch-number rule eats
 *     the chain along with the number. See `splitCodes`.
 *   - **A payment processor sits in front.** `IYZICO/`, `ÖDEAL//`, `N KOLAY 2/`.
 *     What follows the slash is the shop; what precedes it is plumbing. See
 *     `stripProcessor`.
 *   - **The city is written without a country.** `ŞOKKUŞADASI GÜZELÇA AYDIN`
 *     ends in a bare city where an international acquirer would have written
 *     `AYDIN TR`. See `TAIL_NOISE`.
 */

/* ------------------------------------------------------------------ */
/* Turkish-aware folding                                               */
/* ------------------------------------------------------------------ */

/**
 * Turkish letters folded to ASCII, for matching only.
 *
 * `toUpperCase()` cannot be trusted here: JavaScript maps "i" to "I" and leaves
 * "ı" as its own letter, so "ŞİŞLİ" and "SISLI" — the same word, typed by two
 * different acquirers — would never match each other. Folding first makes the
 * comparison about the word rather than about whose keyboard typed it.
 */
const FOLD_MAP: Record<string, string> = {
  İ: "I",
  I: "I",
  ı: "I",
  i: "I",
  Ş: "S",
  ş: "S",
  Ğ: "G",
  ğ: "G",
  Ü: "U",
  ü: "U",
  Ö: "O",
  ö: "O",
  Ç: "C",
  ç: "C",
  Â: "A",
  â: "A",
  Î: "I",
  î: "I",
  Û: "U",
  û: "U",
};

export function fold(text: string): string {
  let out = "";
  for (const char of text) out += FOLD_MAP[char] ?? char;
  return out.toUpperCase();
}

/** Letters and digits only — the form the truncation rules compare in. */
function compress(text: string): string {
  return fold(text).replace(/[^A-Z0-9]/g, "");
}

/* ------------------------------------------------------------------ */
/* Noise                                                               */
/* ------------------------------------------------------------------ */

/**
 * Cities that appear as the tail of a descriptor.
 *
 * Only stripped from the *end*, never from the middle: "İstanbul Büyükşehir
 * Belediyesi" is a merchant whose name starts with a city, and cutting it there
 * would leave "Büyükşehir Belediyesi".
 */
const CITIES =
  "ISTANBUL|ANKARA|IZMIR|BURSA|ANTALYA|ADANA|KONYA|GAZIANTEP|MERSIN|KAYSERI|" +
  "ESKISEHIR|SAMSUN|DENIZLI|TRABZON|KOCAELI|SAKARYA|MALATYA|DIYARBAKIR|" +
  "SANLIURFA|KAHRAMANMARAS|ERZURUM|VAN|BALIKESIR|MANISA|AYDIN|TEKIRDAG|" +
  "HATAY|MUGLA|ORDU|ZONGULDAK|CANAKKALE|AFYON|AFYONKARAHISAR|SIVAS|TOKAT|" +
  "ELAZIG|KUTAHYA|ISPARTA|CORUM|BOLU|EDIRNE|RIZE|GEBZE|IZMIT|IST|ANK|IZM";

/**
 * Country tails.
 *
 * "TUR" is deliberately absent even though acquirers do write it for Türkiye:
 * "tur" is also the Turkish word for a coach tour, and `DİDYMA TUR AYDIN` is a
 * bus company, not a shop with the country spelled out after it.
 */
const COUNTRIES = "TR|TRTR|TURKIYE|IE|IRL|NL|US|USA|GB|UK|LU|DE|FR|IT|ES|SE|CH|AE|CY";

/** Legal forms and trade words that carry no information about the shop. */
const LEGAL_NOISE = [
  /\bANONIM\s+SIRKETI\b/g,
  /\bLIMITED\s+SIRKETI\b/g,
  /\bA\s*\.?\s*S\s*\.?(?=\s|$|-)/g,
  /\bL\s*\.?\s*T\s*\.?\s*D\s*\.?\s*(STI)?\s*\.?/g,
  /\bSTI\s*\.?/g,
  /\bT\s*\.?\s*A\s*\.?\s*S\s*\.?/g,
  /\bA\s*\.?\s*O\s*\.?(?=\s|$)/g,
  /\bTIC(ARET)?\s*\.?/g,
  /\bSAN(AYI|AYII)?\s*\.?/g,
  /\bPAZ(ARLAMA)?\s*\.?/g,
  /\bMAGAZACILIK\b/g,
  /\bMAGAZALARI?\b/g,
  /\bPERAKENDE\b/g,
  /\bHIZMETLERI?\b/g,
  /\bDAGITIM\b/g,
  // Unconditional: the lookahead this used to carry never fired, because the
  // rules above it had already eaten the words it was looking for. "Marketler"
  // is a plural trade word either way — no shop is called only that.
  /\bMARKETLERI?\b/g,
  /\bYATIRIM\s+HOLDING\b/g,
  /\bHOLDING\b/g,
  /\bMRK\s*\.?/g,
  /\bVE\s+TIC\b/g,
];

/** Branch, terminal and reference fragments. */
const REFERENCE_NOISE = [
  /\bNO\s*[:.]?\s*\d+/g,
  /\bSUBE\s*[:.]?\s*\d*/g,
  /\bMAG\s*[:.]?\s*\d+/g,
  /\bSB\s*\d+/g,
  /\bTR\d{2,}\b/g,
  /\b\d{6,}\b/g,
  /\b[A-Z]{0,3}\d{4,}[A-Z]{0,3}\b/g,
  /\bTAKSIT\b|\b\d{1,2}\s*\/\s*\d{1,2}\b(?!\d)/g,
  /\bPESIN\b/g,
  // "SOK" is both a street abbreviation and a supermarket chain. Only the
  // unmistakable spellings count as an address, or every SOK receipt loses its
  // merchant name to a regex meant for road signs.
  /\bMAH(ALLESI)?\b|\bCAD(DESI)?\b|\bSOKAGI\b|\bSOKAK\b|\bBLV\b|\bAVM\b/g,
  /\bVE\b|\bILE\b/g,
];

/**
 * The tail a terminal prints: a city, a country, or a city and then a country.
 *
 * Both halves are optional because both are optional in the wild. An
 * international acquirer writes "ISTANBUL TR"; a domestic one writes "AYDIN"
 * and stops; Netflix writes "AMSTERDAM NL", where the city is not one we know
 * and only the country comes off.
 *
 * Applied exactly once, never repeatedly. "Metro İstanbul" is a railway whose
 * name ends in a city, and a rule that kept chewing would leave it as "Metro"
 * and file every train ride under the cash-and-carry of the same name.
 */
const TAIL_NOISE = new RegExp(
  `\\s+(?:(?:${CITIES})(?:\\s+(?:${COUNTRIES}))?|(?:${COUNTRIES}))\\s*$`,
);

/**
 * Payment processors that print their own name in front of the merchant's.
 *
 * These are the companies that moved the money, not the ones that sold
 * anything, and a ledger that groups by them reports that the user spent forty
 * thousand lira at "iyzico". Tested against the text before the first slash, so
 * a merchant that merely contains one — `APPLE.COM/BILL` — keeps its name.
 */
const PROCESSORS =
  /^(?:IYZICO|IYZIPAY|ODEAL|PAYTR|PARAM|SIPAY|MOKA|VALLET|PAYTEN|NKOLAY|HEPSIPAY|PAYCELL|IPARA|PAYU|PAPARA|TOSLA|DGPAYS|ELEKSE|SANALPOS|POS|EPOS|YEMEKPAY|BIRLESIKODEME)$/;

/**
 * Drop the processor, and the bank's own one-letter channel marker.
 *
 * Ziraat prefixes a card-not-present purchase with `S/` and an e-government
 * payment with `E/`. A single letter in front of a slash is never a shop.
 */
function stripProcessor(text: string): string {
  let out = text;
  // Bounded rather than `while`: "ÖDEAL//MEYDAN BÜFE" needs one pass and
  // nothing real has needed more than two. The bound is what keeps a
  // pathological descriptor from looping.
  for (let pass = 0; pass < 3; pass += 1) {
    const split = /^([^/]*?)\s*\/+\s*(.+)$/.exec(out);
    if (!split) break;
    // The terminal number a processor appends to itself is not part of its
    // name: "N KOLAY 2" is N Kolay.
    const head = compress(split[1] as string).replace(/\d+$/, "");
    if (head.length > 1 && !PROCESSORS.test(head)) break;
    out = split[2] as string;
  }
  return out;
}

/**
 * Prise a store code off the chain name it was welded to.
 *
 * `ŞOK13428` is a single token as far as a regex is concerned, which means the
 * branch-number rule takes the chain away along with the number, and the brand
 * rule never sees "ŞOK" at all.
 *
 * The thresholds are what stop the split from destroying names that genuinely
 * are a letter and a number: three or more letters before the digits
 * ("ŞOK13428", "BIM1234"), four or more digits before the letters
 * ("99159481A101"). "A101", "N11", "3M" and "H559" all fall below them and come
 * through untouched.
 */
function splitCodes(text: string): string {
  return text.replace(/(\p{L}{3,})(\d{3,})/gu, "$1 $2").replace(/(\d{4,})(\p{L})/gu, "$1 $2");
}

/**
 * Strip a descriptor down to the words a person would read out loud.
 *
 * Returns two strings on purpose: `display` keeps the original letters so an
 * unknown merchant can still be shown as itself, while `matchable` is folded to
 * ASCII so the brand table can be written once instead of once per spelling.
 */
export function normalise(descriptor: string): {
  display: string;
  matchable: string;
} {
  let text = descriptor.replace(/\s+/g, " ").trim();

  text = stripProcessor(text);

  // Acquirer prefixes: "GOOGLE *YOUTUBEPREMIUM", "SQ *THE COFFEE SHOP".
  // The half after the star is the actual merchant, but the half before it is
  // often the brand people think of, so both are kept for matching.
  text = text.replace(/\s*[*/]\s*/g, " ");
  text = splitCodes(text);

  let matchable = fold(text);
  for (const pattern of REFERENCE_NOISE) matchable = matchable.replace(pattern, " ");
  for (const pattern of LEGAL_NOISE) matchable = matchable.replace(pattern, " ");
  matchable = matchable
    .replace(/[.,;:/\\()[\]{}"'`_]+/g, " ")
    .replace(/\s*-\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  matchable = matchable.replace(TAIL_NOISE, "").trim();

  /*
   * The display name keeps the original letters and follows the folded pass
   * word by word rather than by counting.
   *
   * Counting would take the right *number* of words from the wrong places: the
   * noise rules delete from the middle as well as the end, so a jeweller called
   * "Özkan Kuyumculuk San ve Tic Ltd Şti" would come back as "Özkan Kuyumculuk
   * San". The first word the rules removed is where the merchant name ends.
   *
   * The walk is positional rather than set-based so a repeated word is only
   * spent once: "KIM MARKET- ISTANBUL ISTANBUL" keeps the district and drops
   * the city, which is the one of the two the tail rule actually removed.
   */
  const survivors = matchable.split(" ").filter(Boolean);
  const displayWords: string[] = [];
  let cursor = 0;
  for (const word of text.split(/\s+/)) {
    const token = fold(word).replace(/[^A-Z0-9&]/g, "");
    if (!token) continue;
    if (survivors[cursor] !== token) break;
    cursor += 1;
    displayWords.push(word.replace(/[-.,;:]+$/, ""));
  }
  const display = displayWords.join(" ").trim();

  return { display: titleCase(display || text), matchable };
}

/** "MIGROS TICARET" -> "Migros Ticaret", with Turkish casing rules. */
export function titleCase(text: string): string {
  return text
    .split(/(\s+)/)
    .map((word) => {
      if (!/\p{L}/u.test(word)) return word;
      // Initialisms stay as they are: BIM, A101, PTT, THY.
      if (word.length <= 4 && word === word.toLocaleUpperCase("tr")) return word;
      /*
       * Lower-cased with the default locale, capitalised with the Turkish one.
       *
       * Acquirers type ASCII: the "I" in "ISTANBUL" is a dotted İ that lost its
       * dot on the way through the terminal. Turkish lower-casing would read it
       * as the dotless ı and produce "Istanbul" spelled "ıstanbul"; the default
       * mapping gives "istanbul", and Turkish capitalisation then restores the
       * dot — "İstanbul", which is what the shop is actually called.
       *
       * The combining dot is dropped on the way through. Unicode lower-cases
       * "İ" to "i" *plus* U+0307, and Turkish upper-casing then puts a dot on
       * top of a letter that already has one, so a bank that spelled the city
       * "İSTANBUL" correctly would get back "İ̇stanbul", wearing two.
       */
      const lower = word.toLowerCase().replace(/̇/g, "");
      const head = lower.slice(0, 1).toLocaleUpperCase("tr");
      return head + lower.slice(1);
    })
    .join("");
}

/* ------------------------------------------------------------------ */
/* Truncation                                                          */
/* ------------------------------------------------------------------ */

/**
 * How a name the acquirer cut off is still recognised.
 *
 * A twenty-character field turns "Yemeksepeti" into "YEMEK SEPET" and
 * "Rossmann" into "ROSSM". Both are a prefix of the real name sitting at the
 * very end of the descriptor, and that is the only shape a truncation can take
 * — so that is exactly what is tested, and nothing else. This is not fuzzy
 * matching: no letter is allowed to differ, only to be missing, and only from
 * the end.
 *
 * The two bounds are what keep it honest. A term has to be at least `MIN_TERM`
 * characters to be worth truncating at all, and at least `MIN_TRUNCATED` of it
 * has to have survived. Five is the line between "STARB", which is Starbucks,
 * and "STAR", which is half the jewellers in the country.
 */
const MIN_TERM = 6;
const MIN_TRUNCATED = 5;

/** Does the descriptor end in this name, cut short? */
function endsTruncated(compressed: string, term: string): boolean {
  const target = compress(term);
  if (target.length < MIN_TERM) return false;
  for (let cut = target.length - 1; cut >= MIN_TRUNCATED; cut -= 1) {
    if (compressed.endsWith(target.slice(0, cut))) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Brands                                                              */
/* ------------------------------------------------------------------ */

export interface MerchantMatch {
  /** What goes in the ledger: a chain name, or the shop's own cleaned-up name. */
  name: string;
  /** Set when a known chain was recognised — the key that groups its branches. */
  brandId: string | null;
  /** Suggested category, or `null` when nothing could be inferred. */
  categoryKey: CategoryKey | null;
  /** How confident the guess is, for the preview to sort review work by. */
  confidence: "brand" | "keyword" | "none";
  /** The folded text the rules ran against, so a bad guess can be explained. */
  matchable: string;
}

/**
 * Identify the merchant behind one descriptor.
 *
 * The four passes run in order of how much of the name each one needed to see.
 * A chain matched whole beats a trade word matched whole, and both beat the
 * same rule matched against a name the acquirer cut short — a truncated match
 * is a claim about letters that are not on the statement, so it only speaks
 * when everything that read the real text has come up empty.
 *
 * Never throws and never returns an empty name: an unreadable descriptor comes
 * back as itself, which is still more useful in a ledger than a blank.
 */
function brandHit(brand: Brand, matchable: string): MerchantMatch {
  return {
    name: brand.name,
    brandId: brand.id,
    categoryKey: brand.category,
    confidence: "brand",
    matchable,
  };
}

function keywordHit(
  fallback: string,
  category: CategoryKey,
  matchable: string,
): MerchantMatch {
  return {
    name: fallback,
    brandId: null,
    categoryKey: category,
    confidence: "keyword",
    matchable,
  };
}

/**
 * A brand named outright, or a brand whose name the bank cut off.
 *
 * Truncation is checked second because it is the weaker signal: a full match on
 * a short descriptor must not lose to a prefix of a longer brand's name.
 */
function findBrand(matchable: string, compressed: string): Brand | null {
  const named = BRANDS.find((brand) => brand.match.test(matchable));
  if (named) return named;
  return (
    BRANDS.find((brand) =>
      (brand.truncates ?? [brand.name]).some((term) =>
        endsTruncated(compressed, term),
      ),
    ) ?? null
  );
}

/** No brand, but a word that still says which category this belongs in. */
function findCategory(matchable: string, compressed: string): CategoryKey | null {
  for (const [pattern, category] of KEYWORD_CATEGORIES) {
    if (pattern.test(matchable)) return category;
  }
  for (const [terms, category] of CATEGORY_TERMS) {
    if (terms.some((term) => endsTruncated(compressed, term))) return category;
  }
  return null;
}

export function identifyMerchant(descriptor: string): MerchantMatch {
  const { display, matchable } = normalise(descriptor);
  const fallback = display || descriptor.trim();
  const compressed = compress(matchable);

  const brand = findBrand(matchable, compressed);
  if (brand) return brandHit(brand, matchable);

  const category = findCategory(matchable, compressed);
  if (category) return keywordHit(fallback, category, matchable);

  return { name: fallback, brandId: null, categoryKey: null, confidence: "none", matchable };
}
