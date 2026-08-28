import { describe, expect, it } from "vitest";
import { identifyMerchant } from "../merchant";

/**
 * The long tail: shops nobody has heard of, and lines that are not shops.
 *
 * A chain is matched by name. Everything else has to be read off the trade word
 * in it, and that is where an import either files three hundred rows or hands
 * the user three hundred rows to file by hand.
 */
const guess = (descriptor: string) => identifyMerchant(descriptor).categoryKey;

describe("lines that are the bank, not a shop", () => {
  const cases: [string, string][] = [
    ["KREDI KARTI UYELIK UCRETI", "fees"],
    ["HESAP ISLETIM UCRETI", "fees"],
    ["NAKIT AVANS KOMISYONU", "fees"],
    ["BSMV", "fees"],
    ["GECIKME FAIZI", "fees"],
    ["ATM PARA CEKME ISTANBUL TR", "cash"],
    ["NAKIT CEKIM 0012 ANKARA", "cash"],
    ["MAAS ODEMESI", "salary"],
  ];
  for (const [raw, key] of cases) {
    it(`files "${raw}" as ${key}`, () => expect(guess(raw)).toBe(key));
  }
});

describe("the trades a shop is named after", () => {
  const cases: [string, string][] = [
    // Health
    ["OZEL GOZLUKCU MERKEZI IZMIR TR", "health"],
    ["ARZU DIYETISYEN DANISMANLIK", "health"],
    ["MEDIKAL SAGLIK URUNLERI LTD", "health"],
    // Transport
    ["HGS OTOYOL GECIS UCRETI", "transport"],
    ["IETT ISTANBUL KART DOLUM", "transport"],
    ["KOPRU GECIS UCRETI", "transport"],
    // Fuel
    ["MOTORIN SATIS ISTASYONU", "fuel"],
    // Bills
    ["ISKI SU IDARESI ISTANBUL", "bills"],
    ["IGDAS DOGALGAZ ODEME", "bills"],
    ["TURK TELEKOM INTERNET FATURASI", "bills"],
    // Saving, the way it is actually done here
    ["OZTURK KUYUMCULUK ALTIN", "investments"],
    ["DOVIZ ALIM SATIM", "investments"],
    // Everyday trades
    ["MEHMET USTA TANTUNI SALONU", "eatingOut"],
    ["CIGERCI HALIL USTA ADANA", "eatingOut"],
    ["SEVGI KRES VE ANAOKULU", "education"],
    ["OZEL SURUCU KURSU MERKEZI", "education"],
    ["AYSE TERZI DIKIM ATOLYESI", "clothing"],
    ["ZUCCACIYE VE MUTFAK ESYA", "home"],
    ["ANKARA BILISIM TEKNIK SERVIS", "electronics"],
    ["GUZELLIK MERKEZI MASAJ SALONU", "personalCare"],
    ["HALI SAHA KIRALAMA", "fun"],
    ["ORGANIK SEBZE MEYVE PAZARI", "groceries"],
  ];
  for (const [raw, key] of cases) {
    it(`reads "${raw}" as ${key}`, () => expect(guess(raw)).toBe(key));
  }
});

/**
 * A trade word must never outrank a chain the file knows by name.
 *
 * This is the rule the first attempt at widening these lists broke: adding
 * "YEMEK" made every truncated "YEMEK SEPET" line stop being Yemeksepeti.
 */
describe("chains still win over the trade words inside them", () => {
  const cases: [string, string][] = [
    ["YEMEKPAY/YEMEK SEPET İSTANBUL TR", "yemeksepeti"],
    ["KAHVE DUNYASI ATASEHIR ISTANBUL TR", "kahve-dunyasi"],
    ["SIMIT SARAYI KADIKOY ISTANBUL TR", "simit-sarayi"],
    ["GETIR YEMEK ISTANBUL TR", "getir-yemek"],
  ];
  for (const [raw, brandId] of cases) {
    it(`keeps "${raw}" as ${brandId}`, () =>
      expect(identifyMerchant(raw).brandId).toBe(brandId));
  }
});

describe("what it still refuses to guess", () => {
  it("leaves a descriptor with no trade word uncategorised", () => {
    const match = identifyMerchant("ABC LTD STI ISTANBUL TR");
    expect(match.categoryKey).toBe(null);
    expect(match.confidence).toBe("none");
    // …but never blank: an unreadable line is still readable in the ledger.
    expect(match.name.length).toBeGreaterThan(0);
  });
});
