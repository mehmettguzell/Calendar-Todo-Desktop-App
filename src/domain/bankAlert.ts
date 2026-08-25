import { toLocalDate } from "./datetime";
import { fold } from "./merchant";
import type { MoneyFlow } from "./money";
import { parseAmount, parseDate, type StatementLine } from "./statement";
import type { Instant, LocalDate } from "./types";

/**
 * Reading the mail a bank sends the moment a card is used.
 *
 * This is the only route by which spending can reach the ledger without anyone
 * typing it. Turkish banks will not hand account data to a personal
 * application — that needs a licence — but every one of them will send a
 * notification message per transaction, and that message contains the three
 * facts an entry needs: when, how much, and to whom.
 *
 * What it is NOT is the truth. A notification announces an *authorisation*: the
 * amount a merchant asked the bank to hold. Tips, currency conversion,
 * instalment plans and partial refunds all settle at a different figure days
 * later. So everything this module produces is provisional, and stays that way
 * until a statement confirms it. That is why `reconcile` exists.
 *
 * Two rules, both inherited from the quick-add parser and for the same reason:
 *
 *  1. **It never guesses.** A message it cannot read completely produces
 *     `null`, not an entry with a plausible number in it. A ledger with a gap
 *     is a ledger you can fix; a ledger with an invented row is not.
 *  2. **It reports what it understood**, so a message that parsed oddly can be
 *     explained rather than argued with.
 */

export type BankId = "ziraat" | "isbank" | "garanti" | "yapikredi";

export interface MailMessage {
  /** The server's identity for the message, used to avoid re-reading it. */
  uid: string;
  from: string;
  subject: string;
  /** Plain-text body. HTML mail is flattened before it gets here. */
  body: string;
  /** When the server says it arrived. */
  receivedAt: Instant;
}

export interface BankAlert {
  /** Stable identity, so re-reading the mailbox cannot double the ledger. */
  externalId: string;
  bank: BankId | null;
  date: LocalDate;
  amountMinor: number;
  /** ISO 4217. Foreign-currency alerts are read but flagged by this field. */
  currency: string;
  flow: MoneyFlow;
  kind: StatementLine["kind"];
  /** The merchant descriptor as the bank wrote it, for `identifyMerchant`. */
  description: string;
  cardLast4: string | null;
  /** A card label built from what the message revealed, e.g. "Bonus ••1234". */
  account: string | null;
  /** What the parser understood, in order, for the settings preview. */
  hints: string[];
}

/* ------------------------------------------------------------------ */
/* Which bank                                                          */
/* ------------------------------------------------------------------ */

const BANK_DOMAINS: [RegExp, BankId][] = [
  [/ziraat(bank)?\.com\.tr|ziraatbank\.com/i, "ziraat"],
  [/isbank\.com\.tr|isbank\.com|maximum\.com\.tr/i, "isbank"],
  [/garantibbva\.com\.tr|garanti\.com\.tr|bonus\.com\.tr/i, "garanti"],
  [/yapikredi\.com\.tr|worldcard\.com\.tr/i, "yapikredi"],
];

const BANK_WORDS: [RegExp, BankId][] = [
  [/\bZIRAAT\b|\bBANKKART\b/, "ziraat"],
  [/\bIS\s*BANKASI\b|\bISBANK\b|\bMAXIMUM\b|\bMAXIMILES\b/, "isbank"],
  [/\bGARANTI\b|\bBBVA\b|\bBONUS\b|\bMONEY\s*KART\b/, "garanti"],
  [/\bYAPI\s*(VE\s*)?KREDI\b|\bWORLD\s*(KART|CARD)\b|\bPLAY\s*KART\b/, "yapikredi"],
];

export function detectBank(message: MailMessage): BankId | null {
  for (const [pattern, id] of BANK_DOMAINS) {
    if (pattern.test(message.from)) return id;
  }
  const folded = fold(`${message.subject} ${message.body}`);
  for (const [pattern, id] of BANK_WORDS) {
    if (pattern.test(folded)) return id;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Is this even a transaction notification?                            */
/* ------------------------------------------------------------------ */

/**
 * Words that mean "money moved", in the phrasing the four banks actually use.
 *
 * A mailbox that receives notifications also receives campaign mail, statement
 * announcements and password resets, all from the same address. Requiring one
 * of these — on top of a readable amount — is what keeps a "1.000 TL'ye varan
 * bonus" campaign out of the ledger.
 */
const MOVEMENT_WORDS =
  /\bHARCAMA\b|\bISLEM\s*GERCEKLE|\bALISVERIS\b|\bTUTARINDA\b|\bCEKILMISTIR\b|\bYAPILMISTIR\b|\bGERCEKLESTIRILMISTIR\b|\bGERCEKLESMISTIR\b|\bIADE\s*EDILMISTIR\b|\bPROVIZYON\b|\bYATIRILMISTIR\b|\bODEME\s*ALINMISTIR\b/;

/**
 * Subjects that announce something other than a transaction.
 *
 * Checked against the SUBJECT ONLY, on purpose. Every bank appends a footer to
 * every message — "kampanyalarımızdan haberdar olun", "teşekkür ederiz" — and a
 * reject list run over the body would throw away real notifications because of
 * the boilerplate underneath them.
 */
const NOT_A_TRANSACTION_SUBJECT =
  /KAMPANYA|FIRSAT|SIFRE|PAROLA|DOGRULAMA|EKSTRE|HESAP\s*OZETI|ANKET|BULTEN|DUYURU|TEKLIF/;

/** Campaign phrasing, which no notification of a completed transaction uses. */
const MARKETING_BODY = /VARAN|KAZANIN|HARCAMA\s*YAPIN|SON\s*GUN|HEMEN\s*BASVUR/;

/* ------------------------------------------------------------------ */
/* The money                                                           */
/* ------------------------------------------------------------------ */

const CURRENCY_WORDS: [RegExp, string][] = [
  [/\bTL\b|\bTRY\b|₺/, "TRY"],
  [/\bUSD\b|\bDOLAR\b|\$/, "USD"],
  [/\bEUR\b|\bEURO\b|€/, "EUR"],
  [/\bGBP\b|\bSTERLIN\b|£/, "GBP"],
];

/**
 * A number written the way a bank writes money, with its currency attached.
 *
 * The currency marker is required rather than optional, which is what stops the
 * card number, the date and the reference number from being read as amounts.
 */
const MONEY_TOKEN =
  /(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d{1,3}(?:,\d{3})*\.\d{2}|\d+(?:\.\d{2})?)\s*(TL|TRY|₺|USD|EUR|GBP|\$|€|£)\b/gi;

interface MoneyHit {
  amountMinor: number;
  currency: string;
  /** Where in the (folded) body it was found. */
  at: number;
}

function currencyOf(token: string): string {
  const folded = fold(token);
  for (const [pattern, code] of CURRENCY_WORDS) {
    if (pattern.test(folded)) return code;
  }
  return "TRY";
}

/**
 * The amount the message is about.
 *
 * A notification often names two: the purchase, and the limit or the point
 * balance that came with it. The purchase is the one introduced by "tutarında"
 * or followed by "harcama", so a hit next to those words wins; failing that,
 * the first one in the message does, because banks lead with the number the
 * message is for.
 */
export function findAmount(body: string): MoneyHit | null {
  const hits: MoneyHit[] = [];

  MONEY_TOKEN.lastIndex = 0;
  for (const match of body.matchAll(MONEY_TOKEN)) {
    const minor = parseAmount(`${match[1]}`);
    if (minor === null || minor === 0) continue;
    hits.push({
      amountMinor: Math.abs(minor),
      currency: currencyOf(match[2] ?? ""),
      at: match.index ?? 0,
    });
  }
  if (hits.length === 0) return null;

  // Slices are taken from the raw body and folded afterwards: folding first
  // and indexing into the result assumes the two strings stay the same length,
  // which uppercasing does not guarantee.
  const around = (hit: MoneyHit, before: number, after: number) =>
    fold(body.slice(Math.max(0, hit.at - before), hit.at + after));

  const preferred = hits.find(
    (hit) =>
      /\bTUTARINDA\b|\bTUTARI\b|\bHARCAMA\b|\bALISVERIS\b/.test(around(hit, 0, 60)) ||
      /\bTUTARINDA\b|\bTUTAR\b/.test(around(hit, 40, 0)),
  );

  // Anything named as a limit or a reward is never the purchase.
  const clean = hits.find(
    (hit) => !/LIMIT|BAKIYE|PUAN|KALAN|TOPLAM\s*BORC/.test(around(hit, 40, 40)),
  );

  return preferred ?? clean ?? hits[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* The card                                                            */
/* ------------------------------------------------------------------ */

const LAST4_PATTERNS: RegExp[] = [
  /son\s*(?:4\s*)?hanes[iı]\s*[:\-]?\s*(\d{4})/i,
  /\*{2,}\s*(\d{4})/,
  /x{2,}\s*(\d{4})/i,
  /\b\d{4}\s*[*x]{2,}\s*[*x]{2,}\s*(\d{4})\b/i,
  // "5678 nolu Bankkart'ınız": the word for card often carries a brand prefix.
  /(\d{4})\s*(?:no(?:'?lu)?|numaral[ıi])\s+\S*kart/i,
  /kart(?:ınız|iniz)?\s*(?:no|numaras[ıi])\s*[:\-]?\s*(?:[\d*x]{4}[\s*x-]*){0,3}(\d{4})/i,
];

export function findCardLast4(body: string): string | null {
  for (const pattern of LAST4_PATTERNS) {
    const match = body.match(pattern);
    const digits = match?.[1];
    if (digits && /^\d{4}$/.test(digits)) return digits;
  }
  return null;
}

/** Card programme names, which is what a person actually calls their card. */
const CARD_BRANDS = /\b(BONUS|MAXIMUM|WORLD|BANKKART|AXESS|PARAF|CARDFINANS|MILES\s*&?\s*SMILES|PLAY|MONEY)\b/;

const BANK_LABEL: Record<BankId, string> = {
  ziraat: "Ziraat",
  isbank: "İş Bankası",
  garanti: "Garanti BBVA",
  yapikredi: "Yapı Kredi",
};

/**
 * A name for the card, in the words the message used.
 *
 * "Bonus ••1234" is what the user calls it; "Garanti BBVA ••1234" is the
 * fallback when only the bank is known. The label matters because it is what
 * the reconciler compares against the card a statement was filed under.
 */
export function cardLabel(bank: BankId | null, body: string, last4: string | null): string | null {
  const brand = fold(body).match(CARD_BRANDS)?.[1];
  const name = brand
    ? brand.charAt(0) + brand.slice(1).toLowerCase()
    : bank
      ? BANK_LABEL[bank]
      : null;
  if (!name) return last4 ? `••${last4}` : null;
  return last4 ? `${name} ••${last4}` : name;
}

/* ------------------------------------------------------------------ */
/* The merchant                                                        */
/* ------------------------------------------------------------------ */

/**
 * The words each bank puts immediately AFTER the shop's name.
 *
 * Anchoring on the bank's own wording rather than on a position in the
 * sentence is what lets one parser read four banks: they disagree about
 * everything else in the sentence, but all of them say "işyerinde" or
 * "adresinde" right after the name.
 */
const MERCHANT_ANCHORS: RegExp[] = [
  /\s*(?:adl[ıi]\s*)?(?:üye\s*)?[iİ][şs]yerinde/i,
  /\s*adresinde/i,
  /\s*[iİ][şs]yerinden/i,
  /['’](?:t[ae]|d[ae])\s+\d/,
];

/** "işyeri: MIGROS" — the layouts that label the field instead. */
const MERCHANT_LABELS: RegExp[] = [
  /(?:üye\s*)?[iİ][şs]yer[iı](?:\s*ad[ıi])?\s*[:\-]\s*([^\n,;]{3,60})/i,
  /merchant\s*[:\-]\s*([^\n,;]{3,60})/i,
];

/**
 * Leading words the capture picks up because the sentence runs into it.
 *
 * Stripped token by token from the left rather than by one big regex, so a
 * shop whose name legitimately starts with a digit ("A101", "7/24 Market")
 * survives while "1234 nolu" does not.
 */
const LEAD_NOISE =
  /^(TARIHINDE|TARIHLI|SAAT|ILE|VE|DE|DA|ADLI|UYE|NOLU|NUMARALI|NO|SAYIN|ISLEM|OLARAK)$/;

/**
 * Everything before the anchor, cleaned back to the shop's name.
 *
 * The passes run outside-in — the parts of the sentence that are furthest from
 * the name go first — because each one makes the next one's job unambiguous.
 */
function nameBefore(text: string, at: number): string | null {
  let chunk = text.slice(Math.max(0, at - 90), at);

  // 1. The salutation and any clause before the last comma are never the shop.
  const comma = chunk.lastIndexOf(",");
  if (comma >= 0) chunk = chunk.slice(comma + 1);

  // 2. Everything up to and including the last word containing "kart" —
  //    "Bonus kartınızla", "1234 nolu Bankkart'ınız ile". The card is named
  //    before the shop by every one of the four banks.
  const card = /\S*kart\S*/gi;
  let lastCard = -1;
  for (const hit of chunk.matchAll(card)) lastCard = (hit.index ?? 0) + hit[0].length;
  if (lastCard >= 0) chunk = chunk.slice(lastCard);

  // 3. Everything up to and including the last date or clock time, with the
  //    clitic banks attach to it ("14:32'de").
  const stamp = /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}[:.]\d{2}(?:\s*['’]?\s*(?:de|da|te|ta))?/gi;
  let lastStamp = -1;
  for (const hit of chunk.matchAll(stamp)) lastStamp = (hit.index ?? 0) + hit[0].length;
  if (lastStamp >= 0) chunk = chunk.slice(lastStamp);

  // 4. Whatever connective words are left at the front.
  let tokens = chunk.split(/\s+/).filter(Boolean);
  while (tokens.length > 0) {
    const head = tokens[0] as string;
    const folded = fold(head).replace(/[^A-Z0-9&/]/g, "");
    // A bare number or a run of masking characters is a card number, never a
    // shop. Anything else letterless is kept, because "7/24 Market" and "A101"
    // are shops whose names really do start that way.
    const isNoise = LEAD_NOISE.test(folded) || /^[\d*x•.,\-]+$/i.test(head);
    if (!isNoise) break;
    tokens = tokens.slice(1);
  }

  const name = tokens.join(" ").replace(/^[\s'’,:\-]+|[\s,:;\-]+$/g, "").trim();
  return name.length >= 3 && /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(name) ? name : null;
}

export function findMerchant(body: string): string | null {
  for (const pattern of MERCHANT_LABELS) {
    const labelled = body.match(pattern)?.[1]?.trim();
    if (labelled && labelled.length >= 3) return labelled;
  }
  for (const anchor of MERCHANT_ANCHORS) {
    const hit = body.match(anchor);
    if (hit?.index === undefined) continue;
    const name = nameBefore(body, hit.index);
    if (name) return name;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Direction                                                           */
/* ------------------------------------------------------------------ */

/**
 * What kind of movement the message announces.
 *
 * Written for alert wording specifically rather than reusing the statement's
 * row classifier: a statement row is a terse descriptor, while a mail is a
 * whole sentence wrapped in boilerplate, and the statement's rules include
 * "teşekkür ederiz" — which is the footer on every message a bank sends.
 */
const ALERT_KIND_RULES: [RegExp, StatementLine["kind"]][] = [
  [/\bIADE\b|\bIPTAL\b|\bREFUND\b/, "refund"],
  [
    /\bKART\s*BORCU|\bKREDI\s*KARTI\s*ODEME|\bBORC\s*ODEME|\bEKSTRE\s*ODEME|\bASGARI\s*ODEME/,
    "payment",
  ],
  [/\bNAKIT\s*(AVANS|CEKIM)|\bATM\b|\bPARA\s*CEKME/, "cash"],
  [/\bAIDAT\b|\bKOMISYON\b|\bMASRAF\b|\bISLEM\s*UCRETI/, "fee"],
  [/\bFAIZ\b|\bGECIKME\s*BEDELI/, "interest"],
];

/** Wording that means the money came in rather than went out. */
const INCOMING =
  /\bIADE\s*EDILMISTIR\b|\bIADE\s*ISLEMI\b|\bHESABINIZA\b|\bYATIRILMISTIR\b|\bGELEN\s*(EFT|HAVALE|FAST)\b/;

/**
 * Which way the money went.
 *
 * A card notification is overwhelmingly an expense, so the incoming words have
 * to be explicit. Getting this wrong does not merely misplace a number — it
 * moves it to the other side of the month.
 */
export function directionOf(body: string): { flow: MoneyFlow; kind: StatementLine["kind"] } {
  const folded = fold(body);
  let kind: StatementLine["kind"] = "spend";
  for (const [pattern, candidate] of ALERT_KIND_RULES) {
    if (pattern.test(folded)) {
      kind = candidate;
      break;
    }
  }
  if (kind === "refund" || INCOMING.test(folded)) {
    return { flow: "INCOME", kind: kind === "spend" ? "refund" : kind };
  }
  return { flow: "EXPENSE", kind };
}

/* ------------------------------------------------------------------ */
/* The date                                                            */
/* ------------------------------------------------------------------ */

const DATE_IN_TEXT = /\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/;

/**
 * The day the money moved.
 *
 * The message's own date wins when it has one — a mail delivered after midnight
 * still describes yesterday's purchase, and filing it on the wrong day is what
 * makes the statement fail to recognise it later.
 */
export function alertDate(body: string, receivedAt: Instant): LocalDate {
  const written = body.match(DATE_IN_TEXT)?.[1];
  const parsed = written ? parseDate(written) : null;
  if (parsed) return parsed;
  const received = new Date(receivedAt);
  return Number.isNaN(received.getTime())
    ? toLocalDate(new Date())
    : toLocalDate(received);
}

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

/**
 * The identity of an alert.
 *
 * Built from the mail server's UID rather than from the contents, because that
 * is the one thing guaranteed to be stable across two reads of the same
 * mailbox — and two genuinely identical purchases minutes apart arrive as two
 * messages with two UIDs, which is exactly right.
 */
export function alertExternalId(uid: string): string {
  return `alert:${uid}`;
}

/* ------------------------------------------------------------------ */
/* The parser                                                          */
/* ------------------------------------------------------------------ */

export function parseBankAlert(message: MailMessage): BankAlert | null {
  const text = `${message.subject}\n${message.body}`;

  if (NOT_A_TRANSACTION_SUBJECT.test(fold(message.subject))) return null;
  if (MARKETING_BODY.test(fold(message.body))) return null;
  if (!MOVEMENT_WORDS.test(fold(text))) return null;

  const money = findAmount(text);
  if (!money) return null;

  const bank = detectBank(message);
  const last4 = findCardLast4(text);
  const merchant = findMerchant(text);
  const { flow, kind } = directionOf(text);
  const date = alertDate(text, message.receivedAt);

  const hints: string[] = [];
  if (bank) hints.push(BANK_LABEL[bank]);
  if (merchant) hints.push(merchant);
  if (last4) hints.push(`••${last4}`);
  if (money.currency !== "TRY") hints.push(money.currency);
  if (kind !== "spend") hints.push(kind);

  return {
    externalId: alertExternalId(message.uid),
    bank,
    date,
    amountMinor: money.amountMinor,
    currency: money.currency,
    flow,
    kind,
    // With no merchant the subject line is still better than an empty note:
    // it says which bank and which card, which is enough to recognise the row.
    description: merchant ?? message.subject.trim() ?? "",
    cardLast4: last4,
    account: cardLabel(bank, text, last4),
    hints,
  };
}

/**
 * Alerts worth writing to the ledger.
 *
 * A card payment is the movement that clears the card, not a purchase; letting
 * it in would count every purchase it settled twice — the same trap the
 * statement importer sidesteps, arriving by a different door.
 */
export function isSpendingAlert(alert: BankAlert): boolean {
  return alert.kind !== "payment";
}
