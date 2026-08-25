import { describe, expect, it } from "vitest";
import {
  detectBank,
  findAmount,
  findCardLast4,
  findMerchant,
  isSpendingAlert,
  parseBankAlert,
  type MailMessage,
} from "../bankAlert";

/**
 * The four banks, in their own words.
 *
 * These are the shapes the parser exists for, so they are written out in full
 * rather than reduced to the fragment each assertion needs: the boilerplate
 * around the sentence — the salutation, the limit line, the footer — is exactly
 * what a naive parser trips over, and a test without it proves nothing.
 */
function mail(partial: Partial<MailMessage> & { body: string }): MailMessage {
  return {
    uid: "1",
    from: "bilgilendirme@garantibbva.com.tr",
    subject: "Kart işlem bilgilendirme",
    receivedAt: "2026-08-25T11:35:00.000Z",
    ...partial,
  };
}

const GARANTI = mail({
  from: "bilgilendirme@garantibbva.com.tr",
  body:
    "Sayın MEHMET GÜZEL, 4090 **** **** 1234 numaralı Bonus kartınızla " +
    "25.08.2026 14:32'de MIGROS TIC.A.S. işyerinde 250,00 TL tutarında işlem " +
    "gerçekleştirilmiştir. Kullanılabilir limitiniz 12.500,00 TL'dir. " +
    "Bizi tercih ettiğiniz için teşekkür ederiz.",
});

const ISBANK = mail({
  uid: "2",
  from: "bilgi@isbank.com.tr",
  subject: "Kartınızla işlem gerçekleşti",
  body:
    "Kartınız ile 25/08/2026 tarihinde MIGROS/KADIKOY adresinde 250,00 TL " +
    "tutarında harcama yapılmıştır. Kart No: 5188 **** **** 4321",
});

const YAPIKREDI = mail({
  uid: "3",
  from: "bilgilendirme@yapikredi.com.tr",
  subject: "World kart işlem bilgisi",
  body:
    "World kartınızla 25.08.2026 tarihinde STARBUCKS'ta 87,50 TL harcama " +
    "yapılmıştır. Kartınızın son 4 hanesi: 9012",
});

const ZIRAAT = mail({
  uid: "4",
  from: "bilgilendirme@ziraatbank.com.tr",
  subject: "Bankkart işlem bilgilendirmesi",
  body:
    "25.08.2026 tarihinde 5678 nolu Bankkart'ınız ile A101 YENI MAGAZACILIK " +
    "işyerinde 149,90 TL tutarında alışveriş gerçekleşmiştir.",
});

describe("recognising the bank", () => {
  it("reads it from the sender before looking at the words", () => {
    expect(detectBank(GARANTI)).toBe("garanti");
    expect(detectBank(ISBANK)).toBe("isbank");
    expect(detectBank(YAPIKREDI)).toBe("yapikredi");
    expect(detectBank(ZIRAAT)).toBe("ziraat");
  });

  it("falls back to the card programme named in the body", () => {
    expect(detectBank(mail({ from: "no-reply@mail.example", body: "Maximum kartınızla harcama yapılmıştır." }))).toBe(
      "isbank",
    );
  });
});

describe("the amount", () => {
  it("is the purchase, not the remaining limit", () => {
    expect(findAmount(GARANTI.body)?.amountMinor).toBe(25_000);
  });

  it("keeps kuruş exactly", () => {
    expect(findAmount(ZIRAAT.body)?.amountMinor).toBe(14_990);
    expect(findAmount(YAPIKREDI.body)?.amountMinor).toBe(8_750);
  });

  it("reports the currency when it is not lira", () => {
    const hit = findAmount("Kartınızla 41,20 USD tutarında harcama yapılmıştır.");
    expect(hit).toMatchObject({ amountMinor: 4_120, currency: "USD" });
  });

  it("refuses a message with no money in it at all", () => {
    expect(findAmount("Kartınızla bir işlem gerçekleştirilmiştir.")).toBeNull();
  });

  /** A card number is a long run of digits, and must never read as an amount. */
  it("ignores numbers with no currency beside them", () => {
    expect(findAmount("4090 1234 5678 1234 numaralı kart")).toBeNull();
  });
});

describe("the card", () => {
  it("reads the last four digits however they are masked", () => {
    expect(findCardLast4(GARANTI.body)).toBe("1234");
    expect(findCardLast4(ISBANK.body)).toBe("4321");
    expect(findCardLast4(YAPIKREDI.body)).toBe("9012");
    expect(findCardLast4(ZIRAAT.body)).toBe("5678");
  });
});

describe("the merchant", () => {
  it("stops at the shop, not at the sentence around it", () => {
    expect(findMerchant(GARANTI.body)).toBe("MIGROS TIC.A.S.");
    expect(findMerchant(ISBANK.body)).toBe("MIGROS/KADIKOY");
    expect(findMerchant(YAPIKREDI.body)).toBe("STARBUCKS");
    expect(findMerchant(ZIRAAT.body)).toBe("A101 YENI MAGAZACILIK");
  });

  it("reads a labelled field when the mail uses one", () => {
    expect(findMerchant("İşyeri: TRENDYOL\nTutar: 300,00 TL")).toBe("TRENDYOL");
  });

  it("keeps a shop whose name legitimately starts with digits", () => {
    expect(
      findMerchant("Kartınızla 25.08.2026 tarihinde 7/24 MARKET işyerinde 40,00 TL"),
    ).toBe("7/24 MARKET");
  });
});

describe("parsing a whole notification", () => {
  it("turns the Garanti wording into one provisional entry", () => {
    expect(parseBankAlert(GARANTI)).toMatchObject({
      externalId: "alert:1",
      bank: "garanti",
      date: "2026-08-25",
      amountMinor: 25_000,
      currency: "TRY",
      flow: "EXPENSE",
      kind: "spend",
      description: "MIGROS TIC.A.S.",
      cardLast4: "1234",
      account: "Bonus ••1234",
    });
  });

  it("reads all four banks", () => {
    for (const message of [GARANTI, ISBANK, YAPIKREDI, ZIRAAT]) {
      expect(parseBankAlert(message)).toMatchObject({
        date: "2026-08-25",
        flow: "EXPENSE",
        kind: "spend",
      });
    }
  });

  /**
   * The date in the text beats the date the mail arrived: a purchase at 23:55
   * notified at 00:02 belongs to the day it happened, and filing it on the next
   * one is what makes the statement fail to recognise it weeks later.
   */
  it("prefers the date written in the message", () => {
    const late = mail({
      body: "Kartınızla 24.08.2026 23:55'te MIGROS işyerinde 30,00 TL tutarında işlem gerçekleştirilmiştir.",
      receivedAt: "2026-08-24T21:02:00.000Z",
    });
    expect(parseBankAlert(late)?.date).toBe("2026-08-24");
  });

  it("falls back to when the message arrived", () => {
    const undated = mail({
      body: "Kartınızla MIGROS işyerinde 30,00 TL tutarında işlem gerçekleştirilmiştir.",
      receivedAt: "2026-08-25T09:00:00.000Z",
    });
    expect(parseBankAlert(undated)?.date).toBe("2026-08-25");
  });

  it("reads a refund as money coming back", () => {
    const refund = mail({
      body:
        "Kartınıza 25.08.2026 tarihinde TRENDYOL işyerinden 120,00 TL tutarında " +
        "iade edilmiştir.",
    });
    expect(parseBankAlert(refund)).toMatchObject({ flow: "INCOME", kind: "refund" });
  });

  /**
   * The movement that clears the card is not a purchase. Letting it in counts
   * every purchase it settled a second time.
   */
  it("marks a card payment as one, so it can be kept out of spending", () => {
    const payment = mail({
      body: "Kredi kartı borç ödemesi olarak 4.500,00 TL tutarında işlem gerçekleştirilmiştir.",
    });
    const alert = parseBankAlert(payment);
    expect(alert?.kind).toBe("payment");
    expect(isSpendingAlert(alert!)).toBe(false);
  });

  it("reads a cash withdrawal as cash", () => {
    const cash = mail({
      body: "25.08.2026 tarihinde ATM'den 1.000,00 TL tutarında nakit çekim gerçekleştirilmiştir.",
    });
    expect(parseBankAlert(cash)?.kind).toBe("cash");
  });
});

describe("what it refuses", () => {
  it("ignores campaign mail from the same address", () => {
    const campaign = mail({
      subject: "Ağustos kampanyası",
      body: "Bonus kartınızla market harcamalarınıza 500 TL'ye varan bonus!",
    });
    expect(parseBankAlert(campaign)).toBeNull();
  });

  it("ignores the statement announcement", () => {
    const statement = mail({
      subject: "Hesap özetiniz hazır",
      body: "Dönem borcunuz 4.500,00 TL, son ödeme tarihi 10.09.2026.",
    });
    expect(parseBankAlert(statement)).toBeNull();
  });

  it("ignores a verification code", () => {
    const otp = mail({
      subject: "Doğrulama kodunuz",
      body: "İşlem doğrulama kodunuz: 483920",
    });
    expect(parseBankAlert(otp)).toBeNull();
  });

  /**
   * A message that says money moved but never says how much is not half an
   * entry — it is no entry. Writing one with a guessed amount would put a
   * number in the ledger that no bank ever said.
   */
  it("refuses a movement it cannot put a number on", () => {
    const vague = mail({ body: "Kartınızla bir harcama gerçekleştirilmiştir." });
    expect(parseBankAlert(vague)).toBeNull();
  });

  it("is not fooled by a footer that mentions campaigns", () => {
    const real = mail({
      body:
        GARANTI.body +
        " Kampanyalarımızdan haberdar olmak için tercihlerinizi güncelleyin.",
    });
    expect(parseBankAlert(real)).toMatchObject({ amountMinor: 25_000 });
  });
});
