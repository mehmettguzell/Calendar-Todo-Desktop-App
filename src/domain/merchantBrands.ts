import { CategoryKey } from "./money";

// The shops the parser knows by name. Data only: matching lives in merchant.ts.
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
