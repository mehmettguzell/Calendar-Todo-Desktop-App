import { describe, expect, it } from "vitest";
import {
  classifyRow,
  detectDelimiter,
  detectHeader,
  detectSource,
  parseAmount,
  parseDate,
  parseHtmlTable,
  parseStatement,
  splitDelimited,
} from "../statement";

describe("reading an amount", () => {
  const cases: [string, number | null][] = [
    ["1.234,56", 123456],
    ["1,234.56", 123456],
    ["1234,56", 123456],
    ["0,90", 90],
    ["12", 1200],
    ["1.234", 123400],
    ["1,234", 123400],
    ["-450,00", -45000],
    ["450,00-", -45000],
    ["(450,00)", -45000],
    ["1.234,56 TL", 123456],
    ["₺89,90", 8990],
    ["12.345.678,90", 1234567890],
    ["", null],
    ["   ", null],
    ["abc", null],
    ["TOPLAM", null],
  ];

  for (const [text, expected] of cases) {
    it(`reads "${text}" as ${expected}`, () => {
      expect(parseAmount(text)).toBe(expected);
    });
  }

  it("never reports failure as zero", () => {
    // 0 is a real amount; null is "I could not read this". A parser that
    // confuses the two produces a ledger that balances to nothing.
    expect(parseAmount("0,00")).toBe(0);
    expect(parseAmount("—")).toBeNull();
  });
});

describe("reading a date", () => {
  const cases: [string, string | null][] = [
    ["12/08/2026", "2026-08-12"],
    ["12.08.2026", "2026-08-12"],
    ["12-08-2026", "2026-08-12"],
    ["2026-08-12", "2026-08-12"],
    ["12/08/26", "2026-08-12"],
    ["12 Ağustos 2026", "2026-08-12"],
    ["3 Oca 2026", "2026-01-03"],
    ["32/08/2026", null],
    ["12/13/2026", null],
    ["31/04/2026", null],
    ["hello", null],
  ];

  for (const [text, expected] of cases) {
    it(`reads "${text}" as ${expected}`, () => {
      expect(parseDate(text)).toBe(expected);
    });
  }
});

describe("classifying a row", () => {
  it("keeps a card payment out of the spending", () => {
    expect(classifyRow("KREDI KARTI ODEMESI")).toBe("payment");
    expect(classifyRow("HESAPTAN OTOMATIK ODEME")).toBe("payment");
  });

  it("recognises fees, interest, refunds and cash", () => {
    expect(classifyRow("KART AIDATI")).toBe("fee");
    expect(classifyRow("GECIKME FAIZI")).toBe("interest");
    expect(classifyRow("MIGROS IADE")).toBe("refund");
    expect(classifyRow("ATM NAKIT CEKIM")).toBe("cash");
  });

  it("treats an ordinary purchase as spending", () => {
    expect(classifyRow("MIGROS TIC.A.S. ISTANBUL TR")).toBe("spend");
  });
});

describe("delimiters", () => {
  it("prefers the semicolon a Turkish export uses", () => {
    const csv = [
      "Tarih;Açıklama;Tutar",
      "12/08/2026;MIGROS TIC.A.S.;1.234,56",
      "13/08/2026;SHELL PETROL;890,00",
      "14/08/2026;NETFLIX.COM;229,99",
    ].join("\n");
    expect(detectDelimiter(csv)).toBe(";");
  });

  it("does not mistake the decimal comma for a delimiter", () => {
    const csv = "Tarih;Tutar\n12/08/2026;1.234,56\n13/08/2026;2.345,67\n14/08/2026;1,00";
    expect(detectDelimiter(csv)).toBe(";");
  });

  it("keeps a quoted delimiter inside its cell", () => {
    expect(splitDelimited('12/08/2026;"MIGROS, ATASEHIR";1.234,56', ";")).toEqual([
      "12/08/2026",
      "MIGROS, ATASEHIR",
      "1.234,56",
    ]);
  });
});

describe("finding the columns", () => {
  it("skips the account preamble and finds the real header", () => {
    const rows = [
      ["Ziraat Bankası"],
      ["Hesap No", "1234-5678"],
      ["Dönem", "01/08/2026 - 31/08/2026"],
      [],
      ["İşlem Tarihi", "Valör", "Açıklama", "Tutar", "Bakiye"],
      ["12/08/2026", "12/08/2026", "MIGROS", "-1.234,56", "8.765,44"],
    ];
    const found = detectHeader(rows as string[][]);
    expect(found?.rowIndex).toBe(4);
    expect(found?.columns).toMatchObject({
      date: 0,
      description: 2,
      amount: 3,
      balance: 4,
    });
  });

  it("takes the transaction date rather than the value date", () => {
    const rows = [["İşlem Tarihi", "Valör Tarihi", "Açıklama", "Tutar"]];
    expect(detectHeader(rows)?.columns.date).toBe(0);
  });

  it("understands a debit/credit pair instead of one amount column", () => {
    const rows = [["Tarih", "Açıklama", "Borç", "Alacak", "Bakiye"]];
    const columns = detectHeader(rows)?.columns;
    expect(columns?.debit).toBe(2);
    expect(columns?.credit).toBe(3);
    expect(columns?.amount).toBeNull();
  });

  it("refuses a row that only looks like a header", () => {
    expect(detectHeader([["Hesap No", "Şube", "IBAN"]])).toBeNull();
  });
});

describe("which way is out", () => {
  it("reads a card statement as positive-is-spending", () => {
    expect(detectSource(null, [1000, 2000, 3000, -5000])).toBe("card");
  });

  it("reads an account statement as negative-is-spending", () => {
    expect(detectSource(null, [-1000, -2000, -3000, 5000])).toBe("account");
  });

  it("takes a balance column as proof it is an account", () => {
    const columns = { date: 0, description: 1, amount: 2, debit: null, credit: null, balance: 3 };
    expect(detectSource(columns, [1000, 2000, 3000])).toBe("account");
  });
});

describe("a semicolon card statement", () => {
  const csv = [
    "Ziraat Bankası Kredi Kartı Ekstresi",
    "Kart No;**** **** **** 1234",
    "",
    "İşlem Tarihi;Açıklama;Tutar",
    "12/08/2026;MIGROS TIC.A.S.-5M ATASEHIR ISTANBUL TR;1.234,56",
    "13/08/2026;SHELL & TURCAS PETROL A.S. KOCAELI TR;890,00",
    "14/08/2026;NETFLIX.COM AMSTERDAM NL;229,99",
    "15/08/2026;KREDI KARTI ODEMESI;-2.000,00",
    "16/08/2026;MIGROS IADE ISTANBUL TR;-45,90",
    "TOPLAM;;304,65",
  ].join("\n");

  const result = parseStatement(csv);

  it("reads every movement and no summary rows", () => {
    expect(result.lines).toHaveLength(5);
    expect(result.skipped.some((s) => s.reason === "summary")).toBe(true);
  });

  it("knows it is a card statement", () => {
    expect(result.source).toBe("card");
    expect(result.container).toBe("delimited");
  });

  it("reads dates, descriptions and amounts", () => {
    expect(result.lines[0]).toMatchObject({
      date: "2026-08-12",
      amountMinor: 123456,
      flow: "EXPENSE",
      kind: "spend",
    });
    expect(result.lines[0]?.description).toContain("MIGROS");
  });

  it("marks the payment as a payment, not as spending", () => {
    const payment = result.lines.find((line) => line.kind === "payment");
    expect(payment?.amountMinor).toBe(200000);
    expect(payment?.flow).toBe("INCOME");
  });

  it("marks the refund as a refund", () => {
    const refund = result.lines.find((line) => line.kind === "refund");
    expect(refund?.amountMinor).toBe(4590);
    expect(refund?.flow).toBe("INCOME");
  });
});

describe("an account statement with borç/alacak", () => {
  const csv = [
    "Tarih;Açıklama;Borç;Alacak;Bakiye",
    "01/08/2026;MAAS ODEMESI;;45.000,00;45.000,00",
    "02/08/2026;A101 YENI MAGAZACILIK ANKARA TR;350,25;;44.649,75",
    "03/08/2026;IGDAS DOGALGAZ FATURA;1.200,00;;43.449,75",
  ].join("\n");

  const result = parseStatement(csv);

  it("reads the pair of columns rather than one signed amount", () => {
    expect(result.source).toBe("account");
    expect(result.columns?.debit).toBe(2);
    expect(result.columns?.credit).toBe(3);
  });

  it("puts money in and money out on the right sides", () => {
    expect(result.lines[0]).toMatchObject({ flow: "INCOME", amountMinor: 4500000 });
    expect(result.lines[1]).toMatchObject({ flow: "EXPENSE", amountMinor: 35025 });
    expect(result.lines[2]).toMatchObject({ flow: "EXPENSE", amountMinor: 120000 });
  });
});

describe("an .xls that is really an HTML table", () => {
  const html = `
    <html><body><table>
      <tr><th>İşlem Tarihi</th><th>Açıklama</th><th>Tutar</th></tr>
      <tr><td>12/08/2026</td><td>CARREFOURSA SABANCI TIC.MRK.A.S ISTANBUL TR</td><td>2.145,90</td></tr>
      <tr><td>13/08/2026</td><td>GETIR PERAKENDE LOJISTIK A.S</td><td>318,40</td></tr>
      <tr><td colspan="2">TOPLAM</td><td>2.464,30</td></tr>
    </table></body></html>`;

  it("finds the rows inside the markup", () => {
    expect(parseHtmlTable(html)).toHaveLength(4);
  });

  it("parses it like any other table", () => {
    const result = parseStatement(html);
    expect(result.container).toBe("html");
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]?.amountMinor).toBe(214590);
    expect(result.lines[1]?.description).toContain("GETIR");
  });

  it("decodes the entities a bank export writes", () => {
    const rows = parseHtmlTable("<tr><td>MIGROS &amp; CO&nbsp;A.&#350;.</td></tr>");
    expect(rows[0]?.[0]).toBe("MIGROS & CO A.Ş.");
  });
});

describe("text pasted out of a PDF", () => {
  const text = [
    "ZİRAAT BANKASI KREDİ KARTI EKSTRESİ",
    "Son Ödeme Tarihi 05/09/2026",
    "12/08/2026 12/08/2026 MIGROS TIC.A.S. ISTANBUL TR 1.234,56",
    "13/08/2026 STARBUCKS COFFEE KANYON ISTANBUL TR 189,00",
    "14/08/2026 OPET PETROLCULUK A.S. ANKARA TR 1.500,00 TL",
    "Dönem Borcu 2.923,56",
  ].join("\n");

  const result = parseStatement(text);

  it("reads the movement lines and leaves the header text alone", () => {
    expect(result.container).toBe("text");
    expect(result.lines).toHaveLength(3);
  });

  it("ignores the second date when a line carries two", () => {
    expect(result.lines[0]).toMatchObject({ date: "2026-08-12", amountMinor: 123456 });
    expect(result.lines[0]?.description).toBe("MIGROS TIC.A.S. ISTANBUL TR");
  });

  it("reads an amount that carries its currency", () => {
    expect(result.lines[2]?.amountMinor).toBe(150000);
  });
});

describe("what it refuses to lose", () => {
  it("reports unreadable rows instead of dropping them", () => {
    const csv = [
      "Tarih;Açıklama;Tutar",
      "12/08/2026;MIGROS;1.234,56",
      "not-a-date;BROKEN ROW;99,00",
      "13/08/2026;NO AMOUNT HERE;",
    ].join("\n");

    const result = parseStatement(csv);
    expect(result.lines).toHaveLength(1);
    expect(result.skipped.map((s) => s.reason).sort()).toEqual(["no-amount", "no-date"]);
  });

  it("returns an empty result rather than throwing on nonsense", () => {
    const result = parseStatement("lorem ipsum\ndolor sit amet");
    expect(result.lines).toEqual([]);
  });

  it("survives an empty file", () => {
    expect(parseStatement("").lines).toEqual([]);
  });
});

describe("a card statement read out of a PDF", () => {
  /*
   * The layout Turkish banks print: a lira column and a dollar column side by
   * side, the card number as a section heading, and the payment that cleared
   * last month's balance marked with a trailing plus rather than a minus sign.
   * The wording is theirs; the shops and the amounts are invented.
   */
  const text = [
    "İşlem Tarihi İşlem Açıklaması TL Tutar USD Tutar Bankkart Lira",
    "KART NO : 1234-####-####-5678 / A***** B****",
    "05.07.2026 YEMEKPAY/YEMEK SEPET İSTANBUL TR 244,99 0,00",
    "06.07.2026 EGO KART ARAC ICI GE ANKARA 41,00 0,00",
    "07.07.2026 Kurs +905320000000 399,99 0,00",
    "09.07.2026 4028 şubehesaptan ödemeteşekkür ederiz 1.500,00+",
    "10.07.2026 MIGROS 3 İSTANBUL 1.320,50 0,00",
    "ÖNCEKİ AYDAN DEVİR 1.500,00 0,00",
  ].join("\n");

  const result = parseStatement(text);

  it("reads the lira column, not the dollar column beside it", () => {
    expect(result.source).toBe("card");
    expect(result.lines.map((line) => line.amountMinor)).toEqual([
      24499, 4100, 39999, 150000, 132050,
    ]);
  });

  it("keeps a phone number in the description instead of spending it", () => {
    const kurs = result.lines.find((line) => line.description.startsWith("Kurs"));
    expect(kurs).toMatchObject({ amountMinor: 39999, flow: "EXPENSE" });
    expect(kurs?.description).toBe("Kurs +905320000000");
  });

  it("treats the trailing plus as the payment that cleared the card", () => {
    const payment = result.lines.find((line) => line.kind === "payment");
    expect(payment).toMatchObject({ amountMinor: 150000, flow: "INCOME" });
  });

  it("leaves the card heading and the carried-over balance out of the ledger", () => {
    expect(result.lines.map((line) => line.description)).not.toContain(
      expect.stringContaining("DEVİR"),
    );
    expect(result.skipped.filter((row) => row.reason === "summary").length).toBeGreaterThan(1);
  });
});
