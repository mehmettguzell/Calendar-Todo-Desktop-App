import { describe, expect, it } from "vitest";
import { fold, identifyMerchant, normalise, titleCase } from "../merchant";

/**
 * Every descriptor below is the shape a Turkish acquirer actually writes.
 *
 * The test that matters is not "does Migros match /MIGROS/" — it is whether the
 * branch number, the district, the legal form and the country tail all fall away
 * so that twelve different Migros lines land on one merchant.
 */
describe("folding", () => {
  it("makes the dotted and dotless i comparable", () => {
    expect(fold("İSTANBUL")).toBe("ISTANBUL");
    expect(fold("istanbul")).toBe("ISTANBUL");
    expect(fold("Işık")).toBe("ISIK");
  });

  it("folds the rest of the Turkish alphabet", () => {
    expect(fold("ŞÖĞÜÇ şöğüç")).toBe("SOGUC SOGUC");
  });
});

describe("normalising a descriptor", () => {
  const cases: [string, string][] = [
    ["MIGROS TIC.A.S.-5M ATASEHIR   ISTANBUL TR", "MIGROS 5M ATASEHIR"],
    ["CARREFOURSA CARREFOUR SABANCI TIC.MRK.A.S ISTANBUL TR", "CARREFOURSA CARREFOUR SABANCI"],
    ["A101 YENI MAGAZACILIK A.S. NO:1234 ANKARA TR", "A101 YENI"],
    ["SOK MARKETLER TIC A.S ISTANBUL TR", "SOK"],
    ["BIM BIRLESIK MAGAZALAR A.S. IZMIR TR", "BIM BIRLESIK"],
  ];

  for (const [raw, expected] of cases) {
    it(`strips the formatting from "${raw.slice(0, 28)}…"`, () => {
      expect(normalise(raw).matchable).toBe(expected);
    });
  }

  it("keeps a readable display name for an unknown shop", () => {
    expect(normalise("OZKAN KUYUMCULUK SAN VE TIC LTD STI KAYSERI TR").display).toBe(
      "Ozkan Kuyumculuk",
    );
  });

  it("does not cut a merchant whose own name starts with a city", () => {
    const { matchable } = normalise("ISTANBUL BUYUKSEHIR BELEDIYESI");
    expect(matchable).toContain("BUYUKSEHIR");
  });

  it("survives a descriptor that is nothing but noise", () => {
    expect(normalise("  ***  ").display.length).toBeGreaterThan(0);
  });
});

describe("recognising a chain", () => {
  const brandCases: [string, string, string][] = [
    ["MIGROS TIC.A.S.-5M ATASEHIR ISTANBUL TR", "Migros", "groceries"],
    ["MIGROS SANAL MARKET ISTANBUL TR", "Migros", "groceries"],
    ["MACROCENTER ETILER IST TR", "Migros", "groceries"],
    ["CARREFOURSA SABANCI TIC.MRK.A.S ISTANBUL TR", "CarrefourSA", "groceries"],
    ["A 101 YENI MAGAZACILIK ANKARA TR", "A101", "groceries"],
    ["BIM BIRLESIK MAGAZALAR A.S. TR", "BİM", "groceries"],
    ["SOK MARKETLER TIC A.S ISTANBUL TR", "ŞOK", "groceries"],
    ["GETIR PERAKENDE LOJISTIK A.S ISTANBUL TR", "Getir", "groceries"],
    ["GETIR YEMEK ISTANBUL TR", "Getir Yemek", "eatingOut"],
    ["YEMEKSEPETI ODEME KURULUSU ISTANBUL TR", "Yemeksepeti", "eatingOut"],
    ["TRENDYOL GO ISTANBUL TR", "Trendyol Yemek", "eatingOut"],
    ["TRENDYOL/DSM GRUP DANISMANLIK ISTANBUL TR", "Trendyol", "clothing"],
    ["STARBUCKS COFFEE KANYON ISTANBUL TR", "Starbucks", "eatingOut"],
    ["SHELL & TURCAS PETROL A.S. KOCAELI TR", "Shell", "fuel"],
    ["OPET PETROLCULUK A.S. ANKARA TR", "Opet", "fuel"],
    ["PETROL OFISI A.S. IZMIR TR", "Petrol Ofisi", "fuel"],
    ["IST.BUYUKSEHIR BLD-ISTANBULKART DOLUM", "İstanbulkart", "transport"],
    ["NETFLIX.COM AMSTERDAM NL", "Netflix", "subscriptions"],
    ["SPOTIFY P2B4C5D6 STOCKHOLM", "Spotify", "subscriptions"],
    ["GOOGLE *YOUTUBEPREMIUM G.CO/HELPPAY# IE", "YouTube Premium", "subscriptions"],
    ["APPLE.COM/BILL ITUNES.COM IE", "Apple", "subscriptions"],
    ["LC WAIKIKI MAGAZACILIK A.S. BURSA TR", "LC Waikiki", "clothing"],
    ["MEDIA MARKT TURKIYE TIC.A.S ISTANBUL TR", "MediaMarkt", "electronics"],
    ["IKEA MARMARA ISTANBUL TR", "IKEA", "home"],
    ["TURK HAVA YOLLARI A.O. ISTANBUL TR", "Türk Hava Yolları", "transport"],
  ];

  for (const [raw, name, category] of brandCases) {
    it(`reads "${raw.slice(0, 30)}…" as ${name}`, () => {
      const match = identifyMerchant(raw);
      expect(match.name).toBe(name);
      expect(match.categoryKey).toBe(category);
      expect(match.confidence).toBe("brand");
    });
  }

  it("groups every branch of one chain under a single merchant", () => {
    const branches = [
      "MIGROS TIC.A.S.-5M ATASEHIR ISTANBUL TR",
      "MIGROS TIC. A.S. NO:4471 ANKARA TR",
      "MIGROS 3M MECIDIYEKOY IST TR",
      "MIGROS SANAL MARKET",
    ].map((raw) => identifyMerchant(raw));

    expect(new Set(branches.map((b) => b.brandId)).size).toBe(1);
    expect(new Set(branches.map((b) => b.name))).toEqual(new Set(["Migros"]));
  });
});

describe("collisions the ordering has to survive", () => {
  it("does not read Getir Yemek as a grocery run", () => {
    expect(identifyMerchant("GETIR YEMEK ISTANBUL TR").categoryKey).toBe("eatingOut");
    expect(identifyMerchant("GETIR PERAKENDE ISTANBUL TR").categoryKey).toBe("groceries");
  });

  it("separates the three companies called Metro", () => {
    expect(identifyMerchant("METRO GROSMARKET BAYRAMPASA").brandId).toBe("metro-market");
    expect(identifyMerchant("METRO ISTANBUL A.S. ISTANBUL TR").brandId).toBe("metro-istanbul");
    expect(identifyMerchant("METRO TURIZM SEYAHAT ANKARA TR").brandId).toBe("metro-turizm");
  });

  it("does not mistake a street for the ŞOK chain", () => {
    expect(identifyMerchant("BAGDAT SOKAK BUFE ISTANBUL TR").brandId).not.toBe("sok");
  });

  it("does not mistake Bimeks for BİM", () => {
    expect(identifyMerchant("BIMEKS BILGISAYAR ISTANBUL TR").brandId).not.toBe("bim");
  });

  it("keeps Trendyol shopping apart from Trendyol food", () => {
    expect(identifyMerchant("TRENDYOL DSM GRUP").categoryKey).toBe("clothing");
    expect(identifyMerchant("TRENDYOL YEMEK").categoryKey).toBe("eatingOut");
  });
});

describe("the long tail, where the chains run out", () => {
  const keywordCases: [string, string][] = [
    ["YESILKOY ECZANESI ISTANBUL TR", "health"],
    ["OZEL ANADOLU TIP MERKEZI ANKARA TR", "health"],
    ["HASAN USTA KEBAP SALONU GAZIANTEP TR", "eatingOut"],
    ["CINAR PASTANESI IZMIR TR", "eatingOut"],
    ["GUNES MARKET GIDA SAN TIC LTD STI", "groceries"],
    ["MERT AKARYAKIT ISTASYONU KONYA TR", "fuel"],
    ["ATASEHIR OTOPARK ISLETMESI", "transport"],
    ["ELIF KUAFOR GUZELLIK SALONU", "personalCare"],
    ["ANKARA KIRTASIYE VE KITAP", "education"],
    ["MODA GIYIM TEKSTIL SAN", "clothing"],
  ];

  for (const [raw, category] of keywordCases) {
    it(`files "${raw.slice(0, 26)}…" under ${category}`, () => {
      const match = identifyMerchant(raw);
      expect(match.categoryKey).toBe(category);
      expect(match.confidence).toBe("keyword");
    });
  }

  it("admits when it does not know, rather than guessing", () => {
    const match = identifyMerchant("ZTR MUHENDISLIK LTD STI");
    expect(match.categoryKey).toBeNull();
    expect(match.confidence).toBe("none");
    // Still readable: the ledger shows a name, not a reference number.
    expect(match.name).toBe("ZTR Muhendislik");
  });
});

/**
 * Every descriptor in this block was taken verbatim from one Ziraat credit-card
 * statement. They are here because that statement left 45 of its 71 lines
 * uncategorised: not because the rules were wrong about the shops, but because
 * the bank had damaged the names before the rules ever saw them.
 */
describe("descriptors the acquirer damaged", () => {
  describe("cut to the width of the field", () => {
    const cases: [string, string, string][] = [
      ["YEMEKPAY/YEMEK SEPET İSTANBUL TR", "Yemeksepeti", "eatingOut"],
      ["IYZICO/PARIBUCINEVER İSTANBUL TR", "Paribu Cineverse", "fun"],
      ["N KOLAY 2/DIRK ROSSM İSTANBUL", "Rossmann", "personalCare"],
    ];

    for (const [raw, name, category] of cases) {
      it(`completes "${raw}"`, () => {
        const match = identifyMerchant(raw);
        expect(match.name).toBe(name);
        expect(match.categoryKey).toBe(category);
      });
    }

    it("reads a hospital abbreviated to four letters", () => {
      expect(identifyMerchant("KUŞADASI DEVLET HAST AYDIN").categoryKey).toBe("health");
    });

    it("refuses to complete a name that lost too much", () => {
      // "GÜZELÇAMLI MERKEZ Mİ" may well be a Migros. Two letters is a guess,
      // and a guess in the ledger is worse than a row the user files by hand.
      expect(identifyMerchant("GÜZELÇAMLI MERKEZ Mİ AYDIN").categoryKey).toBeNull();
    });

    it("does not read every shop beginning with STAR as Starbucks", () => {
      expect(identifyMerchant("ALTIN STAR KUYUMCU").brandId).toBeNull();
    });
  });

  describe("the store code welded to the chain name", () => {
    it("finds ŞOK under the branch it was glued to", () => {
      for (const raw of [
        "ŞOKKUŞADASI GÜZELÇA AYDIN",
        "ŞOK13428 KÜÇÜKYALI İSTANBUL",
        "ŞOKTEYFİK SAĞLAM MA İSTANBUL",
        "ŞOKBAĞDATTEPE ALTIN İSTANBUL",
        "ŞOK1002 AYDIN SÖKE AYDIN",
      ]) {
        expect(identifyMerchant(raw).brandId).toBe("sok");
      }
    });

    it("still refuses the words that only look like ŞOK", () => {
      expect(identifyMerchant("BAGDAT SOKAK BUFE ISTANBUL TR").brandId).not.toBe("sok");
      expect(identifyMerchant("SOKULLU ECZANESI ISTANBUL").brandId).not.toBe("sok");
      expect(identifyMerchant("SOKE TARIM AYDIN").brandId).not.toBe("sok");
    });

    it("finds A101 behind a terminal id", () => {
      expect(identifyMerchant("99159481A101 PANİO AYDIN").brandId).toBe("a101");
    });

    it("keeps the names that are genuinely a letter and a number", () => {
      expect(identifyMerchant("N11.COM ISTANBUL TR").brandId).toBe("n11");
      expect(identifyMerchant("MIGROS 3M MECIDIYEKOY IST TR").brandId).toBe("migros");
    });

    it("reads CarrefourSA under its own terminal code", () => {
      expect(identifyMerchant("CSA 3628 KUŞADASI GÜ AYDIN").brandId).toBe("carrefour");
    });
  });

  describe("the payment processor in front", () => {
    const cases: [string, string][] = [
      ["IYZICO/amazon.com.tr İSTANBUL TR", "Amazon"],
      ["ÖDEAL//MEYDAN BÜFE AYDIN", "Meydan BÜFE"],
      ["S/TRENDYOL İSTANBUL TRTR", "Trendyol"],
      ["E/ÖLÇME SEÇME VE YER ANKARA", "ÖSYM"],
    ];

    for (const [raw, name] of cases) {
      it(`bills "${raw}" to the shop, not the processor`, () => {
        expect(identifyMerchant(raw).name).toBe(name);
      });
    }

    it("leaves a merchant that merely contains a slash alone", () => {
      expect(identifyMerchant("APPLE.COM/BILL APPLE.COM/BIL").brandId).toBe("apple");
      expect(identifyMerchant("GOOGLE *YOUTUBEPREMIUM G.CO/HELPPAY# IE").brandId).toBe("youtube");
    });
  });

  describe("the city written without a country", () => {
    it("drops a bare city from the end", () => {
      expect(normalise("BEREKET BAKKAL AYDIN").matchable).toBe("BEREKET BAKKAL");
      expect(normalise("DENIZ MARKET AYDIN").matchable).toBe("DENIZ MARKET");
    });

    it("drops the city once, not until the name is gone", () => {
      // Otherwise the railway becomes the cash-and-carry of the same name.
      expect(identifyMerchant("METRO ISTANBUL A.S. ISTANBUL TR").brandId).toBe("metro-istanbul");
      expect(normalise("KIM MARKET- ISTANBUL ISTANBUL").matchable).toBe("KIM MARKET ISTANBUL");
    });

    it("does not read a coach company as a country tail", () => {
      expect(identifyMerchant("DİDYMA TUR AYDIN TRTR").categoryKey).toBe("transport");
    });
  });

  describe("the long tail this statement was actually made of", () => {
    const cases: [string, string][] = [
      ["AKŞAM SEFASI TEKEL İSTANBUL", "groceries"],
      ["PAK UN UN VE UNLU MA İSTANBUL", "groceries"],
      ["SUBWAY İSTANBUL", "eatingOut"],
      ["PASCO PLAZA İSTANBUL İSTANBUL", "eatingOut"],
      ["BELTUR SUADİYE İSTANBUL", "eatingOut"],
      ["EGO KART ARAC ICI GE ANKARA", "transport"],
    ];

    for (const [raw, category] of cases) {
      it(`files "${raw}" under ${category}`, () => {
        expect(identifyMerchant(raw).categoryKey).toBe(category);
      });
    }
  });

  it("spells a display name with one dot on the İ, not two", () => {
    expect(normalise("BOZDEMİREL GIDA İSTANBUL").display).toBe("Bozdemirel GIDA");
    expect(titleCase("İSTANBUL")).toBe("İstanbul");
  });
});
