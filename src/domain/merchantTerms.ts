import { CategoryKey } from "./money";

// Words that place an unknown shop in a budget category.
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
export const CATEGORY_TERMS: [string[], CategoryKey][] = [
  /*
   * The bank's own bookkeeping, first of all.
   *
   * These lines are not spending at a shop, and reading them as one is worse
   * than leaving them uncategorised: a month's card fees filed under groceries
   * quietly inflates the one number the budget screen exists to report. They
   * lead the list because nothing else may shadow them.
   */
  [
    // Both the bare word and the possessive: a bank writes "komisyon" on one
    // line and "nakit avans komisyonu" on the next, and Turkish glues the
    // suffix on, so a rule for one of them catches only half the statement.
    ["KOMISYON", "KOMISYONU", "MASRAF", "MASRAFI", "FAIZI", "BSMV", "KKDF",
     "DAMGA VERGISI", "KART UCRETI", "KART AIDATI",
     "EKSTRE UCRETI", "ISLEM UCRETI", "HAVALE UCRETI", "EFT UCRETI", "GECIKME FAIZI",
     "AKDI FAIZ", "HESAP ISLETIM", "UYELIK UCRETI"],
    "fees",
  ],
  // A withdrawal is the one line that is definitely not a purchase — the money
  // left the account and the spending happened somewhere this app cannot see.
  [["ATM", "NAKIT", "NAKIT AVANS", "NAKIT CEKIM", "PARA CEKME", "NAKIT ISLEM"], "cash"],
  [["MAAS", "MAAS ODEMESI", "HAKEDIS"], "salary"],

  [["ECZ", "ECZANE", "ECZANESI", "PHARMACY"], "health"],
  [
    // "HAST" is not a truncation to be guessed at — it is how a terminal
    // abbreviates "hastanesi", and it arrives that way deliberately.
    ["HAST", "HASTANE", "HASTANESI", "POLIKLINIK", "TIP MERKEZI", "LABORATUVAR",
     "DIS HEKIMI", "DIS KLINIGI", "OPTIK", "SAGLIK OCAGI", "GORUNTULEME", "VETERINER",
     "GOZLUKCU", "MEDIKAL", "DIYETISYEN", "PSIKOLOG", "PSIKIYATRI", "FIZYOTERAPI",
     "AMBULANS", "TAHLIL", "RONTGEN", "AGIZ VE DIS", "SAGLIK MERKEZI"],
    "health",
  ],
  [
    ["RESTORAN", "RESTAURANT", "LOKANTA", "KAFE", "CAFE", "COFFEE", "PASTANE", "PASTANESI",
     "FIRIN", "FIRINI", "BUFE", "BUFESI", "PIZZA", "BURGER", "DONER", "DONERCI", "KEBAP",
     "KEBABI", "OCAKBASI", "MEYHANE", "BISTRO", "WAFFLE", "TATLI", "TATLICI", "BAKERY",
     "KOFTECI", "CIG KOFTE", "CIGKOFTE", "PIDE", "LAHMACUN", "MANTI", "IZGARA", "STEAKHOUSE",
     "BOREK", "BOREKCI", "KOKOREC", "CORBA", "MANGAL", "SOFRASI", "SIMITCI", "KAHVALTI",
     "CAY BAHCESI", "CAY OCAGI", "SUSHI", "NARGILE", "DONDURMA", "BAKLAVA", "TANTUNI",
     "CIGERCI", "MEZE", "RESTORANI"],
  // "YEMEK", "KAHVE" and "SIMIT" are deliberately absent. Each is the first word
  // of a chain this file already knows by name, and a whole-word trade match
  // outranks a truncated brand match — so adding them would trade "Yemeksepeti"
  // for "Yemek Sepet" on every statement that arrives cut short. The category
  // was already right; the merchant is what would have been lost.
    "eatingOut",
  ],
  [["AKARYAKIT", "PETROL", "PETROLLERI", "BENZIN", "OTOGAZ", "LPG", "ISTASYON", "DIZEL",
    "MOTORIN", "YAKIT"], "fuel"],
  [
    ["TAKSI", "OTOPARK", "PARKOMAT", "OTOBUS", "OTOBUSCULUK", "HAVAS", "HAVAIST", "OTOGAR",
     "RENT A CAR", "TURIZM", "SEYAHAT", "TUR", "ULASIM", "TRAMVAY", "VAPUR", "FERIBOT",
     "KART DOLUM", "METRO", "OTOPARKI", "HGS", "OGS", "KGS", "IETT", "METROBUS", "KOPRU GECIS",
     "OTOYOL", "GECIS UCRETI", "SCOOTER", "BISIKLET", "HAVALIMANI", "PARKMATIK"],
    "transport",
  ],
  [["KUAFOR", "BERBER", "GUZELLIK", "SPA", "KOZMETIK", "PARFUM", "PARFUMERI", "EPILASYON",
    "MASAJ", "SOLARYUM", "TIRNAK", "CILT BAKIM"], "personalCare"],
  [
    ["SPOR", "FITNESS", "GYM", "PILATES", "YUZME", "SINEMA", "TIYATRO", "KONSER", "OYUN",
     "GAME", "BOWLING", "BILARDO", "LUNAPARK", "MUZE", "AQUAPARK", "OTEL", "HOTEL",
     "PANSIYON", "MOTEL", "TATIL KOYU", "KAYAK", "HAVUZ", "FESTIVAL", "STADYUM",
     "HALI SAHA", "PLAJ", "TEKNE TURU"],
    "fun",
  ],
  [
    ["KIRTASIYE", "KITAP", "KITABEVI", "KITAPEVI", "YAYIN", "YAYINCILIK", "KURS", "DERSHANE",
     "UNIVERSITE", "OKUL", "AKADEMI", "EGITIM", "ANAOKULU", "KRES", "SURUCU KURSU",
     "DIL OKULU", "ETUT", "SEMINER", "SERTIFIKA", "KOLEJ"],
    "education",
  ],
  [["GIYIM", "TEKSTIL", "AYAKKABI", "MODA", "BUTIK", "KONFEKSIYON", "KUNDURA", "CANTA",
    "TERZI", "TRIKO", "CORAP", "IC GIYIM", "SPOR GIYIM"], "clothing"],
  [
    ["MOBILYA", "YAPI MARKET", "YAPIMARKET", "HIRDAVAT", "NALBUR", "DEKORASYON", "MEFRUSAT",
     "PERDE", "AVIZE", "BEYAZ ESYA", "SITE YONETIMI", "APARTMAN YONETIMI", "AIDAT",
     "ZUCCACIYE", "HALICI", "TEMIZLIK", "SERAMIK", "BOYA", "BAHCE", "MUTFAK ESYA"],
    "home",
  ],
  [["BILGISAYAR", "ELEKTRONIK", "TEKNOLOJI", "TELEFON", "TEKNOMARKET", "BILISIM",
    "TEKNIK SERVIS", "AKSESUAR"], "electronics"],
  [
    ["FATURA", "SIGORTA", "KARGO", "VERGI", "MTV", "TRAFIK CEZASI", "BELEDIYE", "BELEDIYESI",
     "DOGALGAZ", "ELEKTRIK", "ABONELIK", "TELEKOM", "SU IDARESI", "ISKI", "IZSU", "BUSKI",
     "ASKI GENEL", "TEDAS", "BEDAS", "AYEDAS", "IGDAS", "INTERNET", "FATURASI", "NOTER"],
    "bills",
  ],
  [["KIRA", "EMLAK", "GAYRIMENKUL", "KIRASI", "EMLAKCI"], "rent"],
  // After the trades above and before the broad "market": a jeweller is a shop,
  // but in Turkey buying gold is how people save, so it belongs with saving.
  [["KUYUMCU", "DOVIZ", "YATIRIM", "BORSA", "HISSE", "ALTIN BORSA"], "investments"],
  [
    ["MARKET", "MARKETI", "MARKETCILIK", "BAKKAL", "MANAV", "KASAP", "SARKUTERI", "GIDA",
     "SUPERMARKET", "TEKEL", "UNLU MAMULLERI", "UNLU MAMUL", "KURUYEMIS", "SUT URUNLERI",
     "SEBZE", "MEYVE", "ORGANIK", "KURU GIDA", "PAZARI", "ET URUNLERI"],
    "groceries",
  ],
];

/**
 * The same words as regexes, for the pass that matches them whole.
 *
 * Spaces become `\s*` so that a term survives the acquirer closing the gap:
 * "RENTACAR" and "RENT A CAR" are one shop.
 */
export const KEYWORD_CATEGORIES: [RegExp, CategoryKey][] = CATEGORY_TERMS.map(([terms, category]) => [
  new RegExp(`\\b(?:${terms.map((term) => term.replace(/\s+/g, "\\s*")).join("|")})\\b`),
  category,
]);
