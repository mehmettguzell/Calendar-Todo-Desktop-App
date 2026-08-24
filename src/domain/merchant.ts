import type { CategoryKey } from "./money";

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

export interface Brand {
  id: string;
  /** How the merchant is written in the ledger. */
  name: string;
  category: CategoryKey;
  /** Tested against the *folded* descriptor. */
  match: RegExp;
  /**
   * Spellings to look for when the descriptor was cut short, where the ledger
   * name is not what the terminal prints. "Paribu Cineverse" arrives as
   * `PARIBUCINEVER` through one processor and as `CINEVER` through another.
   */
  truncates?: string[];
}

/**
 * Known chains, most specific first.
 *
 * Order is load-bearing: "GETIR YEMEK" has to be tried before "GETIR", or every
 * meal ordered on the app is filed under groceries. Every rule below that looks
 * redundant is guarding against a real collision of that kind.
 */
export const BRANDS: Brand[] = [
  /* Groceries ------------------------------------------------------- */
  { id: "getir-yemek", name: "Getir Yemek", category: "eatingOut", match: /\bGETIR\s*YEMEK\b/ },
  { id: "getir-buyuk", name: "GetirBüyük", category: "groceries", match: /\bGETIR\s*BUYUK\b/ },
  { id: "getir", name: "Getir", category: "groceries", match: /\bGETIR\b/ },
  { id: "migros", name: "Migros", category: "groceries", match: /\bMIGROS\b|\bMACROCENTER\b|\bMACRO\s?CENTER\b/ },
  {
    id: "carrefour",
    name: "CarrefourSA",
    category: "groceries",
    // "CSA" is the code CarrefourSA's own terminals print. Anchored to the
    // start, because three letters that common are only unambiguous when they
    // open the line.
    match: /\bCARREFOUR|^CSA\b/,
    truncates: ["CARREFOURSA"],
  },
  {
    id: "a101",
    name: "A101",
    category: "groceries",
    // No word boundary on the left: the terminal id is welded to the front —
    // "99159481A101" — and `splitCodes` only separates the long ones. A letter
    // in front would mean some other word that happens to end in "a", and that
    // is the only case excluded.
    match: /(?<![A-Z])A\s?101\b/,
  },
  { id: "bim", name: "BİM", category: "groceries", match: /\bBIM\b/ },
  {
    id: "sok",
    name: "ŞOK",
    category: "groceries",
    /*
     * The branch name is written straight onto the chain — "ŞOKKUŞADASI",
     * "ŞOKTEYFİK", "ŞOKBAĞDATTEPE" — so this cannot ask for a word boundary on
     * the right. What it asks instead is that the letters which follow are not
     * the ones that spell "sokak", "sokağı", "Sokullu" or "Söke": the four
     * things in a Turkish descriptor that begin with these three letters and
     * are not the supermarket.
     */
    match: /\bSOK(?!AK|AGI|ULLU|E\b)/,
  },
  { id: "file", name: "File Market", category: "groceries", match: /\bFILE\s*MARKET\b/ },
  { id: "tarim-kredi", name: "Tarım Kredi Market", category: "groceries", match: /\bTARIM\s*KREDI\b/ },
  { id: "metro-market", name: "Metro Market", category: "groceries", match: /\bMETRO\s*(GROSMARKET|MARKET|TOPTANCI)\b/ },
  { id: "hakmar", name: "Hakmar", category: "groceries", match: /\bHAKMAR\b/ },
  { id: "istegelsin", name: "İstegelsin", category: "groceries", match: /\bISTEGELSIN\b/ },
  { id: "onur-market", name: "Onur Market", category: "groceries", match: /\bONUR\s*MARKET\b/ },
  { id: "happy-center", name: "Happy Center", category: "groceries", match: /\bHAPPY\s*CENTER\b/ },
  { id: "ekomini", name: "Ekomini", category: "groceries", match: /\bEKOMINI\b/ },
  { id: "bizim-toptan", name: "Bizim Toptan", category: "groceries", match: /\bBIZIM\s*TOPTAN\b/ },
  { id: "mopas", name: "Mopaş", category: "groceries", match: /\bMOPAS\b/ },

  /* Eating out ------------------------------------------------------ */
  { id: "yemeksepeti", name: "Yemeksepeti", category: "eatingOut", match: /\bYEMEKSEPETI\b|\bYEMEK\s*SEPETI\b/ },
  { id: "trendyol-yemek", name: "Trendyol Yemek", category: "eatingOut", match: /\bTRENDYOL\s*(YEMEK|GO)\b/ },
  { id: "starbucks", name: "Starbucks", category: "eatingOut", match: /\bSTARBUCKS\b/ },
  { id: "mcdonalds", name: "McDonald's", category: "eatingOut", match: /\bMC\s?DONALD/, truncates: ["MCDONALDS"] },
  { id: "burger-king", name: "Burger King", category: "eatingOut", match: /\bBURGER\s*KING\b|\bBKING\b/ },
  { id: "dominos", name: "Domino's Pizza", category: "eatingOut", match: /\bDOMINO/, truncates: ["DOMINOS PIZZA"] },
  { id: "popeyes", name: "Popeyes", category: "eatingOut", match: /\bPOPEYES\b/ },
  { id: "kfc", name: "KFC", category: "eatingOut", match: /\bKFC\b/ },
  { id: "subway", name: "Subway", category: "eatingOut", match: /\bSUBWAY\b/ },
  { id: "pizza-hut", name: "Pizza Hut", category: "eatingOut", match: /\bPIZZA\s*HUT\b/ },
  { id: "littlecaesars", name: "Little Caesars", category: "eatingOut", match: /\bLITTLE\s*CAESAR/, truncates: ["LITTLE CAESARS"] },
  { id: "espressolab", name: "Espressolab", category: "eatingOut", match: /\bESPRESSOLAB\b/ },
  { id: "kahve-dunyasi", name: "Kahve Dünyası", category: "eatingOut", match: /\bKAHVE\s*DUNYASI\b/ },
  { id: "gloria", name: "Gloria Jean's", category: "eatingOut", match: /\bGLORIA\s*JEAN/, truncates: ["GLORIA JEANS"] },
  { id: "simit-sarayi", name: "Simit Sarayı", category: "eatingOut", match: /\bSIMIT\s*SARAYI\b/ },
  { id: "tavuk-dunyasi", name: "Tavuk Dünyası", category: "eatingOut", match: /\bTAVUK\s*DUNYASI\b/ },
  { id: "komagene", name: "Komagene", category: "eatingOut", match: /\bKOMAGENE\b/ },
  { id: "baydoner", name: "Baydöner", category: "eatingOut", match: /\bBAYDONER\b/ },
  { id: "bigchefs", name: "Big Chefs", category: "eatingOut", match: /\bBIG\s*CHEFS\b/ },
  { id: "caribou", name: "Caribou Coffee", category: "eatingOut", match: /\bCARIBOU\b/ },
  { id: "tchibo", name: "Tchibo", category: "eatingOut", match: /\bTCHIBO\b/ },
  { id: "coffy", name: "Coffy", category: "eatingOut", match: /\bCOFFY\b/ },
  { id: "mado", name: "Mado", category: "eatingOut", match: /\bMADO\b/ },
  { id: "kofteci-yusuf", name: "Köfteci Yusuf", category: "eatingOut", match: /\bKOFTECI\s*YUSUF\b/ },
  { id: "pasco", name: "Pasco", category: "eatingOut", match: /\bPASCO\b/ },
  // İBB's cafés and ferry kiosks. Named for Belediye Turizm, hence the "tur"
  // that the transport keywords would otherwise claim.
  { id: "beltur", name: "Beltur", category: "eatingOut", match: /\bBELTUR\b/ },

  /* Fuel ------------------------------------------------------------ */
  { id: "shell", name: "Shell", category: "fuel", match: /\bSHELL\b|\bTURCAS\b/ },
  { id: "opet", name: "Opet", category: "fuel", match: /\bOPET\b/ },
  { id: "po", name: "Petrol Ofisi", category: "fuel", match: /\bPETROL\s*OFISI\b|\bPETROLOFISI\b/, truncates: ["PETROL OFISI"] },
  { id: "bp", name: "BP", category: "fuel", match: /\bBP\s*(PETROL|AKARYAKIT|GAS)?\b(?!\w)/ },
  { id: "total", name: "TotalEnergies", category: "fuel", match: /\bTOTAL\s*(ENERGIES|OIL)?\b(?=\s|$)/ },
  { id: "aytemiz", name: "Aytemiz", category: "fuel", match: /\bAYTEMIZ\b/ },
  { id: "alpet", name: "Alpet", category: "fuel", match: /\bALPET\b/ },
  { id: "lukoil", name: "Lukoil", category: "fuel", match: /\bLUKOIL\b/ },
  { id: "moil", name: "Moil", category: "fuel", match: /\bMOIL\b/ },
  { id: "tp", name: "Türkiye Petrolleri", category: "fuel", match: /\bTP\s*(PETROL|AKARYAKIT)\b|\bTURKIYE\s*PETROLLERI\b/ },
  { id: "sunpet", name: "Sunpet", category: "fuel", match: /\bSUNPET\b/ },

  /* Transport ------------------------------------------------------- */
  { id: "istanbulkart", name: "İstanbulkart", category: "transport", match: /\bISTANBULKART\b|\bBELBIM\b|\bIETT\b/ },
  { id: "metro-istanbul", name: "Metro İstanbul", category: "transport", match: /\bMETRO\s*ISTANBUL\b/ },
  // Ankara's transit operator. Three letters alone are not enough to go on, so
  // it is only read as the chain when the next word says what was bought.
  { id: "ego", name: "EGO", category: "transport", match: /\bEGO\s*(KART|BILET|ULASIM)\b|\bEGOKART\b/ },
  { id: "eshot", name: "ESHOT", category: "transport", match: /\bESHOT\b|\bIZMIRIM\s*KART\b/ },
  { id: "kentkart", name: "Kentkart", category: "transport", match: /\bKENTKART\b|\bANKARAKART\b|\bBURULAS\b/ },
  { id: "bitaksi", name: "BiTaksi", category: "transport", match: /\bBITAKSI\b/ },
  { id: "uber", name: "Uber", category: "transport", match: /\bUBER\b/ },
  { id: "bolt", name: "Bolt", category: "transport", match: /\bBOLT\.EU\b|\bBOLT\s*(RIDE|TR)\b/ },
  { id: "marti", name: "Martı", category: "transport", match: /\bMARTI\b/ },
  { id: "hgs", name: "HGS", category: "transport", match: /\bHGS\b|\bOGS\b|\bKGM\b/ },
  { id: "thy", name: "Türk Hava Yolları", category: "transport", match: /\bTURK\s*HAVA\s*YOLLARI\b|\bTURKISH\s*AIRLINES\b|\bTHY\b/, truncates: ["TURK HAVA YOLLARI"] },
  { id: "pegasus", name: "Pegasus", category: "transport", match: /\bPEGASUS\b|\bFLYPGS\b/ },
  { id: "ajet", name: "AJet", category: "transport", match: /\bAJET\b|\bANADOLUJET\b/, truncates: ["ANADOLUJET"] },
  { id: "obilet", name: "Obilet", category: "transport", match: /\bOBILET\b/ },
  { id: "metro-turizm", name: "Metro Turizm", category: "transport", match: /\bMETRO\s*TURIZM\b/ },

  /* Bills ----------------------------------------------------------- */
  { id: "turk-telekom", name: "Türk Telekom", category: "bills", match: /\bTURK\s*TELEKOM\b|\bTTNET\b/, truncates: ["TURK TELEKOM"] },
  { id: "turkcell", name: "Turkcell", category: "bills", match: /\bTURKCELL\b|\bSUPERONLINE\b/ },
  { id: "vodafone", name: "Vodafone", category: "bills", match: /\bVODAFONE\b/ },
  { id: "turknet", name: "TurkNet", category: "bills", match: /\bTURKNET\b/ },
  { id: "iski", name: "İSKİ", category: "bills", match: /\bISKI\b|\bASKI\b|\bIZSU\b|\bBUSKI\b|\bSUKAY\b/ },
  { id: "igdas", name: "İGDAŞ", category: "bills", match: /\bIGDAS\b|\bBASKENTGAZ\b|\bIZMIRGAZ\b|\bAKMERCAN\b/ },
  { id: "elektrik", name: "Elektrik", category: "bills", match: /\bBEDAS\b|\bAYEDAS\b|\bENERJISA\b|\bCK\s*ENERJI\b|\bAYDEM\b|\bUEDAS\b|\bTOROSLAR\b/ },
  { id: "digiturk", name: "Digiturk", category: "bills", match: /\bDIGITURK\b|\bBEIN\b/ },
  { id: "dsmart", name: "D-Smart", category: "bills", match: /\bD\s*-?\s*SMART\b/ },
  { id: "ptt", name: "PTT", category: "bills", match: /\bPTT\b/ },

  /* Subscriptions --------------------------------------------------- */
  { id: "netflix", name: "Netflix", category: "subscriptions", match: /\bNETFLIX\b/ },
  { id: "spotify", name: "Spotify", category: "subscriptions", match: /\bSPOTIFY\b/ },
  { id: "youtube", name: "YouTube Premium", category: "subscriptions", match: /\bYOUTUBE/, truncates: ["YOUTUBE PREMIUM"] },
  { id: "disney", name: "Disney+", category: "subscriptions", match: /\bDISNEY\b/ },
  { id: "blutv", name: "BluTV", category: "subscriptions", match: /\bBLUTV\b|\bBLU\s*TV\b/ },
  { id: "exxen", name: "Exxen", category: "subscriptions", match: /\bEXXEN\b/ },
  { id: "mubi", name: "MUBI", category: "subscriptions", match: /\bMUBI\b/ },
  { id: "storytel", name: "Storytel", category: "subscriptions", match: /\bSTORYTEL\b|\bAUDIBLE\b/ },
  { id: "apple", name: "Apple", category: "subscriptions", match: /\bAPPLE\b|\bITUNES\b|\bICLOUD\b/ },
  { id: "google", name: "Google", category: "subscriptions", match: /\bGOOGLE\b/ },
  { id: "microsoft", name: "Microsoft", category: "subscriptions", match: /\bMICROSOFT\b|\bMSFT\b/ },
  { id: "adobe", name: "Adobe", category: "subscriptions", match: /\bADOBE\b/ },
  { id: "openai", name: "OpenAI", category: "subscriptions", match: /\bOPENAI\b|\bCHATGPT\b/ },
  { id: "anthropic", name: "Anthropic", category: "subscriptions", match: /\bANTHROPIC\b|\bCLAUDE\s*AI\b/ },
  { id: "github", name: "GitHub", category: "subscriptions", match: /\bGITHUB\b/ },
  { id: "notion", name: "Notion", category: "subscriptions", match: /\bNOTION\b/ },
  { id: "canva", name: "Canva", category: "subscriptions", match: /\bCANVA\b/ },

  /* Shopping & clothing --------------------------------------------- */
  { id: "trendyol", name: "Trendyol", category: "clothing", match: /\bTRENDYOL\b|\bDSM\s*GRUP\b/ },
  { id: "hepsiburada", name: "Hepsiburada", category: "electronics", match: /\bHEPSIBURADA\b|\bHEPSI\s*BURADA\b/, truncates: ["HEPSIBURADA"] },
  { id: "amazon", name: "Amazon", category: "clothing", match: /\bAMAZON\b/ },
  { id: "n11", name: "n11", category: "clothing", match: /\bN11\b/ },
  { id: "ciceksepeti", name: "Çiçeksepeti", category: "fun", match: /\bCICEKSEPETI\b/, truncates: ["CICEKSEPETI"] },
  { id: "zara", name: "Zara", category: "clothing", match: /\bZARA\b/ },
  { id: "lcw", name: "LC Waikiki", category: "clothing", match: /\bLC\s*WAIKIKI\b|\bLCW\b/, truncates: ["LC WAIKIKI"] },
  { id: "defacto", name: "DeFacto", category: "clothing", match: /\bDEFACTO\b/ },
  { id: "koton", name: "Koton", category: "clothing", match: /\bKOTON\b/ },
  { id: "mavi", name: "Mavi", category: "clothing", match: /\bMAVI\s*(JEANS|GIYIM)?\b(?=\s|$)/ },
  { id: "hm", name: "H&M", category: "clothing", match: /\bH\s*&\s*M\b|\bHENNES\b/ },
  { id: "bershka", name: "Bershka", category: "clothing", match: /\bBERSHKA\b/ },
  { id: "pullbear", name: "Pull&Bear", category: "clothing", match: /\bPULL\s*&?\s*BEAR\b/ },
  { id: "stradivarius", name: "Stradivarius", category: "clothing", match: /\bSTRADIVARIUS\b/ },
  { id: "boyner", name: "Boyner", category: "clothing", match: /\bBOYNER\b/ },
  { id: "decathlon", name: "Decathlon", category: "clothing", match: /\bDECATHLON\b/ },
  { id: "nike", name: "Nike", category: "clothing", match: /\bNIKE\b/ },
  { id: "adidas", name: "Adidas", category: "clothing", match: /\bADIDAS\b/ },
  { id: "flo", name: "FLO", category: "clothing", match: /\bFLO\s*(MAGAZA|AYAKKABI)?\b(?=\s|$)/ },
  { id: "penti", name: "Penti", category: "clothing", match: /\bPENTI\b/ },
  { id: "colins", name: "Colin's", category: "clothing", match: /\bCOLIN\b/ },

  /* Electronics & home ---------------------------------------------- */
  { id: "mediamarkt", name: "MediaMarkt", category: "electronics", match: /\bMEDIA\s*MARKT\b/, truncates: ["MEDIA MARKT"] },
  { id: "teknosa", name: "Teknosa", category: "electronics", match: /\bTEKNOSA\b/ },
  { id: "vatan", name: "Vatan Bilgisayar", category: "electronics", match: /\bVATAN\s*(BILGISAYAR|COMPUTER)\b/ },
  { id: "ikea", name: "IKEA", category: "home", match: /\bIKEA\b/ },
  { id: "koctas", name: "Koçtaş", category: "home", match: /\bKOCTAS\b/ },
  { id: "bauhaus", name: "Bauhaus", category: "home", match: /\bBAUHAUS\b/ },
  { id: "english-home", name: "English Home", category: "home", match: /\bENGLISH\s*HOME\b/, truncates: ["ENGLISH HOME"] },
  { id: "madame-coco", name: "Madame Coco", category: "home", match: /\bMADAME\s*COCO\b/, truncates: ["MADAME COCO"] },
  { id: "karaca", name: "Karaca", category: "home", match: /\bKARACA\b/ },

  /* Health & care ---------------------------------------------------- */
  { id: "watsons", name: "Watsons", category: "personalCare", match: /\bWATSONS\b/ },
  { id: "gratis", name: "Gratis", category: "personalCare", match: /\bGRATIS\b/ },
  // Billed as "DIRK ROSSMANN", which the twenty-character field then cuts to
  // "DIRK ROSSM".
  { id: "rossmann", name: "Rossmann", category: "personalCare", match: /\bROSSMANN\b/ },
  { id: "acibadem", name: "Acıbadem", category: "health", match: /\bACIBADEM\b/ },
  { id: "medicalpark", name: "Medical Park", category: "health", match: /\bMEDICAL\s*PARK\b/, truncates: ["MEDICAL PARK"] },
  { id: "memorial", name: "Memorial", category: "health", match: /\bMEMORIAL\b/ },
  { id: "medicana", name: "Medicana", category: "health", match: /\bMEDICANA\b/ },

  /* Fun -------------------------------------------------------------- */
  { id: "cinemaximum", name: "Cinemaximum", category: "fun", match: /\bCINEMAXIMUM\b|\bMARS\s*ENTERTAINMENT\b/, truncates: ["CINEMAXIMUM"] },
  { id: "cineverse", name: "Paribu Cineverse", category: "fun", match: /\bCINEVERSE\b/, truncates: ["PARIBU CINEVERSE", "CINEVERSE"] },
  { id: "steam", name: "Steam", category: "fun", match: /\bSTEAM\b|\bVALVE\b/ },
  { id: "playstation", name: "PlayStation", category: "fun", match: /\bPLAYSTATION\b|\bPSN\b/ },
  { id: "xbox", name: "Xbox", category: "fun", match: /\bXBOX\b/ },
  { id: "biletix", name: "Biletix", category: "fun", match: /\bBILETIX\b|\bPASSO\b|\bBUBILET\b/ },
  { id: "macfit", name: "MACFit", category: "fun", match: /\bMAC\s*FIT\b|\bMACFIT\b/ },

  /* Education --------------------------------------------------------- */
  { id: "udemy", name: "Udemy", category: "education", match: /\bUDEMY\b|\bCOURSERA\b/ },
  { id: "dr", name: "D&R", category: "education", match: /\bD\s*&\s*R\b|\bDR\s*MAGAZA\b/ },
  // The exam board, which bills under a legal name no card field is wide enough
  // to hold: "ÖLÇME SEÇME VE YERLEŞTİRME MERKEZİ".
  { id: "osym", name: "ÖSYM", category: "education", match: /\bOSYM\b|\bOLCME\s*SECME\b/ },
];

/**
 * Words that decide a category when no chain is recognised.
 *
 * Most spending in a real statement is at shops nobody has heard of, and "the
 * corner pharmacy" is still unmistakably a pharmacy. Matching on the trade word
 * rather than the name is what keeps the long tail out of "uncategorised".
 *
 * The words live in a list rather than in a regex because they are needed
 * twice: once matched whole, and once matched as the surviving front half of a
 * word the acquirer cut in two. A regex does the first well and cannot do the
 * second at all.
 *
 * Order decides collisions, so the broadest words come last: a "yapı market"
 * sells taps rather than food, which is why `home` is tried before the entry
 * that owns the word "market".
 */
const CATEGORY_TERMS: [string[], CategoryKey][] = [
  [["ECZ", "ECZANE", "ECZANESI", "PHARMACY"], "health"],
  [
    // "HAST" is not a truncation to be guessed at — it is how a terminal
    // abbreviates "hastanesi", and it arrives that way deliberately.
    ["HAST", "HASTANE", "HASTANESI", "POLIKLINIK", "TIP MERKEZI", "LABORATUVAR",
     "DIS HEKIMI", "DIS KLINIGI", "OPTIK", "SAGLIK OCAGI", "GORUNTULEME", "VETERINER"],
    "health",
  ],
  [
    ["RESTORAN", "RESTAURANT", "LOKANTA", "KAFE", "CAFE", "COFFEE", "PASTANE", "PASTANESI",
     "FIRIN", "FIRINI", "BUFE", "BUFESI", "PIZZA", "BURGER", "DONER", "DONERCI", "KEBAP",
     "KEBABI", "OCAKBASI", "MEYHANE", "BISTRO", "WAFFLE", "TATLI", "TATLICI", "BAKERY",
     "KOFTECI", "CIG KOFTE", "CIGKOFTE", "PIDE", "LAHMACUN", "MANTI", "IZGARA", "STEAKHOUSE",
     "BOREK", "BOREKCI", "KOKOREC", "CORBA", "MANGAL", "SOFRASI"],
    "eatingOut",
  ],
  [["AKARYAKIT", "PETROL", "PETROLLERI", "BENZIN", "OTOGAZ", "LPG", "ISTASYON", "DIZEL"], "fuel"],
  [
    ["TAKSI", "OTOPARK", "PARKOMAT", "OTOBUS", "OTOBUSCULUK", "HAVAS", "HAVAIST", "OTOGAR",
     "RENT A CAR", "TURIZM", "SEYAHAT", "TUR", "ULASIM", "TRAMVAY", "VAPUR", "FERIBOT",
     "KART DOLUM", "METRO"],
    "transport",
  ],
  [["KUAFOR", "BERBER", "GUZELLIK", "SPA", "KOZMETIK", "PARFUM", "PARFUMERI", "EPILASYON"], "personalCare"],
  [
    ["SPOR", "FITNESS", "GYM", "PILATES", "YUZME", "SINEMA", "TIYATRO", "KONSER", "OYUN",
     "GAME", "BOWLING", "BILARDO", "LUNAPARK", "MUZE", "AQUAPARK", "OTEL", "HOTEL",
     "PANSIYON", "MOTEL", "TATIL KOYU"],
    "fun",
  ],
  [
    ["KIRTASIYE", "KITAP", "KITABEVI", "KITAPEVI", "YAYIN", "YAYINCILIK", "KURS", "DERSHANE",
     "UNIVERSITE", "OKUL", "AKADEMI", "EGITIM", "ANAOKULU", "KRES"],
    "education",
  ],
  [["GIYIM", "TEKSTIL", "AYAKKABI", "MODA", "BUTIK", "KONFEKSIYON"], "clothing"],
  [
    ["MOBILYA", "YAPI MARKET", "YAPIMARKET", "HIRDAVAT", "NALBUR", "DEKORASYON", "MEFRUSAT",
     "PERDE", "AVIZE", "BEYAZ ESYA", "SITE YONETIMI", "APARTMAN YONETIMI", "AIDAT"],
    "home",
  ],
  [["BILGISAYAR", "ELEKTRONIK", "TEKNOLOJI", "TELEFON", "TEKNOMARKET"], "electronics"],
  [
    ["FATURA", "SIGORTA", "KARGO", "VERGI", "MTV", "TRAFIK CEZASI", "BELEDIYE", "BELEDIYESI",
     "DOGALGAZ", "ELEKTRIK", "ABONELIK", "TELEKOM"],
    "bills",
  ],
  [["KIRA", "EMLAK", "GAYRIMENKUL"], "rent"],
  [
    ["MARKET", "MARKETI", "MARKETCILIK", "BAKKAL", "MANAV", "KASAP", "SARKUTERI", "GIDA",
     "SUPERMARKET", "TEKEL", "UNLU MAMULLERI", "UNLU MAMUL", "KURUYEMIS", "SUT URUNLERI"],
    "groceries",
  ],
];

/**
 * The same words as regexes, for the pass that matches them whole.
 *
 * Spaces become `\s*` so that a term survives the acquirer closing the gap:
 * "RENTACAR" and "RENT A CAR" are one shop.
 */
const KEYWORD_CATEGORIES: [RegExp, CategoryKey][] = CATEGORY_TERMS.map(([terms, category]) => [
  new RegExp(`\\b(?:${terms.map((term) => term.replace(/\s+/g, "\\s*")).join("|")})\\b`),
  category,
]);

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
export function identifyMerchant(descriptor: string): MerchantMatch {
  const { display, matchable } = normalise(descriptor);
  const fallback = display || descriptor.trim();

  for (const brand of BRANDS) {
    if (brand.match.test(matchable)) {
      return {
        name: brand.name,
        brandId: brand.id,
        categoryKey: brand.category,
        confidence: "brand",
        matchable,
      };
    }
  }

  for (const [pattern, category] of KEYWORD_CATEGORIES) {
    if (pattern.test(matchable)) {
      return { name: fallback, brandId: null, categoryKey: category, confidence: "keyword", matchable };
    }
  }

  const compressed = compress(matchable);

  for (const brand of BRANDS) {
    for (const term of brand.truncates ?? [brand.name]) {
      if (endsTruncated(compressed, term)) {
        return {
          name: brand.name,
          brandId: brand.id,
          categoryKey: brand.category,
          confidence: "brand",
          matchable,
        };
      }
    }
  }

  for (const [terms, category] of CATEGORY_TERMS) {
    for (const term of terms) {
      if (endsTruncated(compressed, term)) {
        return { name: fallback, brandId: null, categoryKey: category, confidence: "keyword", matchable };
      }
    }
  }

  return { name: fallback, brandId: null, categoryKey: null, confidence: "none", matchable };
}
