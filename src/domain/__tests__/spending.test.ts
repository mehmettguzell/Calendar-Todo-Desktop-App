import { describe, expect, it } from "vitest";
import type { BudgetCategory, Transaction } from "../money";
import { buildImportPlan, draftsFrom, externalIdFor, resolveCategory } from "../statementImport";
import { parseStatement } from "../statement";
import { analyseSpending, merchantTotal, searchMerchants } from "../spending";

const AT = "2026-08-20T10:00:00.000Z";

const category = (id: string, name: string): BudgetCategory => ({
  id,
  name,
  flow: "EXPENSE",
  color: "#f97316",
  icon: "🛒",
  builtIn: true,
  order: 0,
  updatedAt: AT,
});

const CATEGORIES = [
  category("c-groceries", "Market"),
  category("c-fuel", "Akaryakıt"),
  category("c-subs", "Abonelikler"),
];

const entry = (over: Partial<Transaction> & Pick<Transaction, "date" | "amountMinor">): Transaction => ({
  id: `t-${Math.random().toString(36).slice(2)}`,
  flow: "EXPENSE",
  categoryId: "c-groceries",
  note: "",
  merchant: "Migros",
  externalId: null,
  createdAt: AT,
  updatedAt: AT,
  deletedAt: null,
  ...over,
});

const AUGUST = { from: "2026-08-01", to: "2026-08-31" };
const JULY = { from: "2026-07-01", to: "2026-07-31" };

describe("what the money went on", () => {
  const ledger: Transaction[] = [
    entry({ date: "2026-08-02", amountMinor: 320000, merchant: "Migros" }),
    entry({ date: "2026-08-09", amountMinor: 190000, merchant: "Migros" }),
    entry({ date: "2026-08-16", amountMinor: 230000, merchant: "CarrefourSA" }),
    entry({ date: "2026-08-21", amountMinor: 45000, merchant: "BİM" }),
    entry({ date: "2026-08-05", amountMinor: 150000, merchant: "Shell", categoryId: "c-fuel" }),
    entry({ date: "2026-08-06", amountMinor: 22999, merchant: "Netflix", categoryId: "c-subs" }),
  ];

  const report = analyseSpending(ledger, CATEGORIES, AUGUST);

  it("adds up to the total", () => {
    expect(report.totalMinor).toBe(320000 + 190000 + 230000 + 45000 + 150000 + 22999);
  });

  it("ranks the categories by size", () => {
    expect(report.categories.map((c) => c.name)).toEqual([
      "Market",
      "Akaryakıt",
      "Abonelikler",
    ]);
  });

  /** The question that started all this. */
  it("answers 'how much on groceries' and 'how much at Migros' separately", () => {
    const groceries = report.categories.find((c) => c.name === "Market");
    expect(groceries?.amountMinor).toBe(320000 + 190000 + 230000 + 45000);

    const migros = groceries?.merchants.find((m) => m.merchant === "Migros");
    expect(migros?.amountMinor).toBe(320000 + 190000);
    expect(migros?.count).toBe(2);
  });

  it("breaks a category down into the shops it is made of", () => {
    const groceries = report.categories.find((c) => c.name === "Market");
    expect(groceries?.merchants.map((m) => m.merchant)).toEqual([
      "Migros",
      "CarrefourSA",
      "BİM",
    ]);
  });

  it("makes every level sum to its parent", () => {
    for (const slice of report.categories) {
      const fromMerchants = slice.merchants.reduce((sum, m) => sum + m.amountMinor, 0);
      expect(fromMerchants).toBe(slice.amountMinor);
    }
    const fromCategories = report.categories.reduce((sum, c) => sum + c.amountMinor, 0);
    expect(fromCategories).toBe(report.totalMinor);
  });

  it("reports each merchant's share of its own category", () => {
    const groceries = report.categories.find((c) => c.name === "Market");
    const shares = groceries?.merchants.map((m) => m.share) ?? [];
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it("finds the biggest single purchase", () => {
    expect(report.biggest).toMatchObject({ merchant: "Migros", amountMinor: 320000 });
  });

  it("reports an average per purchase and a rate per day", () => {
    const migros = report.merchants.find((m) => m.merchant === "Migros");
    expect(migros?.averageMinor).toBe(255000);
    expect(report.perDayMinor).toBe(Math.round(report.totalMinor / 31));
  });

  it("answers 'just Migros' across every category it appears in", () => {
    expect(merchantTotal(report, "Migros").amountMinor).toBe(510000);
    expect(merchantTotal(report, "migros").amountMinor).toBe(510000);
  });

  it("searches merchants the way a Turkish keyboard types them", () => {
    expect(searchMerchants(report, "bim").map((m) => m.merchant)).toEqual(["BİM"]);
    expect(searchMerchants(report, "car").map((m) => m.merchant)).toEqual(["CarrefourSA"]);
  });
});

describe("refunds", () => {
  const ledger: Transaction[] = [
    entry({ date: "2026-08-02", amountMinor: 100000, merchant: "Migros" }),
    entry({ date: "2026-08-04", amountMinor: 25000, merchant: "Migros", flow: "INCOME" }),
    entry({ date: "2026-08-05", amountMinor: 4500000, merchant: "", note: "Maaş", flow: "INCOME", categoryId: null }),
  ];

  const report = analyseSpending(ledger, CATEGORIES, AUGUST);

  it("subtracts money that came back from a shop", () => {
    const migros = report.merchants.find((m) => m.merchant === "Migros");
    expect(migros?.grossMinor).toBe(100000);
    expect(migros?.refundMinor).toBe(25000);
    expect(migros?.amountMinor).toBe(75000);
  });

  it("leaves a salary out of a spending report", () => {
    expect(report.totalMinor).toBe(75000);
    expect(report.merchants.some((m) => m.merchant === "Maaş")).toBe(false);
  });
});

describe("comparing two months", () => {
  const ledger: Transaction[] = [
    entry({ date: "2026-07-10", amountMinor: 200000, merchant: "Migros" }),
    entry({ date: "2026-08-10", amountMinor: 300000, merchant: "Migros" }),
    entry({ date: "2026-08-11", amountMinor: 50000, merchant: "Shell", categoryId: "c-fuel" }),
  ];

  const report = analyseSpending(ledger, CATEGORIES, AUGUST, { compareWith: JULY });

  it("measures the whole month against the one before", () => {
    expect(report.previousTotalMinor).toBe(200000);
    expect(report.changeRatio).toBeCloseTo(0.75, 6);
  });

  it("measures each category against itself", () => {
    const groceries = report.categories.find((c) => c.name === "Market");
    expect(groceries?.previousMinor).toBe(200000);
    expect(groceries?.changeRatio).toBeCloseTo(0.5, 6);
  });

  it("says nothing rather than infinity for a category that is new", () => {
    const fuel = report.categories.find((c) => c.name === "Akaryakıt");
    expect(fuel?.previousMinor).toBeNull();
    expect(fuel?.changeRatio).toBeNull();
  });
});

describe("importing a statement end to end", () => {
  const csv = [
    "İşlem Tarihi;Açıklama;Tutar",
    "12/08/2026;MIGROS TIC.A.S.-5M ATASEHIR ISTANBUL TR;1.234,56",
    "13/08/2026;SHELL & TURCAS PETROL A.S. KOCAELI TR;890,00",
    "14/08/2026;NETFLIX.COM AMSTERDAM NL;229,99",
    "15/08/2026;KREDI KARTI ODEMESI;-2.000,00",
    "16/08/2026;MIGROS TIC.A.S. ISTANBUL TR;1.234,56",
  ].join("\n");

  const parsed = parseStatement(csv);
  const plan = buildImportPlan(parsed.lines, parsed.skipped, [], CATEGORIES, parsed.source);

  it("reads every row and recognises every merchant", () => {
    expect(plan.counts.total).toBe(5);
    expect(plan.rows.map((row) => row.merchant.name)).toEqual([
      "Migros",
      "Shell",
      "Netflix",
      // Spelled from the ASCII the terminal produced: nothing in "KARTI" says
      // whether that I is a dotted or a dotless one, and "i" is the reading
      // that is right far more often.
      "Kredi Karti Odemesi",
      "Migros",
    ]);
  });

  it("files each row under a category that already exists", () => {
    expect(plan.rows[0]?.categoryId).toBe("c-groceries");
    expect(plan.rows[1]?.categoryId).toBe("c-fuel");
    expect(plan.rows[2]?.categoryId).toBe("c-subs");
  });

  it("leaves the card payment out of the import", () => {
    const payment = plan.rows.find((row) => row.line.kind === "payment");
    expect(payment?.include).toBe(false);
    expect(plan.counts.excluded).toBe(1);
  });

  it("produces four entries, not five", () => {
    expect(draftsFrom(plan)).toHaveLength(4);
  });

  it("carries the merchant and the bank's own wording separately", () => {
    const draft = draftsFrom(plan)[0];
    expect(draft?.merchant).toBe("Migros");
    expect(draft?.note).toBe("MIGROS TIC.A.S.-5M ATASEHIR ISTANBUL TR");
  });
});

describe("importing the same statement twice", () => {
  const csv = [
    "İşlem Tarihi;Açıklama;Tutar",
    "12/08/2026;MIGROS TIC.A.S. ISTANBUL TR;1.234,56",
    "12/08/2026;MIGROS TIC.A.S. ISTANBUL TR;1.234,56",
    "13/08/2026;SHELL PETROL;890,00",
  ].join("\n");

  const parsed = parseStatement(csv);
  const first = buildImportPlan(parsed.lines, parsed.skipped, [], CATEGORIES, parsed.source);

  it("keeps two genuinely identical purchases as two rows", () => {
    expect(first.counts.fresh).toBe(3);
    const ids = first.rows.map((row) => row.externalId);
    expect(new Set(ids).size).toBe(3);
  });

  it("recognises every row the second time and imports none of them", () => {
    const imported: Transaction[] = draftsFrom(first).map((draft, index) => ({
      id: `imported-${index}`,
      date: draft.date,
      amountMinor: draft.amountMinor,
      flow: draft.flow,
      categoryId: draft.categoryId,
      note: draft.note,
      merchant: draft.merchant,
      externalId: draft.externalId,
      createdAt: AT,
      updatedAt: AT,
      deletedAt: null,
    }));

    const again = buildImportPlan(parsed.lines, parsed.skipped, imported, CATEGORIES, parsed.source);
    expect(again.counts.duplicate).toBe(3);
    expect(draftsFrom(again)).toHaveLength(0);
  });

  it("gives the same row the same id every time it is read", () => {
    const second = buildImportPlan(parsed.lines, parsed.skipped, [], CATEGORIES, parsed.source);
    expect(second.rows.map((r) => r.externalId)).toEqual(first.rows.map((r) => r.externalId));
  });

  it("warns about an entry that was typed in by hand first", () => {
    const typed: Transaction[] = [
      entry({ date: "2026-08-13", amountMinor: 89000, merchant: "", note: "benzin", externalId: null }),
    ];
    const plan = buildImportPlan(parsed.lines, parsed.skipped, typed, CATEGORIES, parsed.source);
    const shell = plan.rows.find((row) => row.merchant.name === "Shell");
    expect(shell?.status).toBe("similar");
    expect(shell?.include).toBe(false);
  });
});

describe("categories the document does not have yet", () => {
  it("reports what needs creating instead of filing it under nothing", () => {
    const csv = [
      "İşlem Tarihi;Açıklama;Tutar",
      "12/08/2026;LC WAIKIKI MAGAZACILIK A.S. BURSA TR;799,90",
    ].join("\n");
    const parsed = parseStatement(csv);
    const plan = buildImportPlan(parsed.lines, parsed.skipped, [], CATEGORIES, parsed.source);

    expect(plan.missingCategories).toEqual(["clothing"]);
    expect(plan.rows[0]?.categoryKey).toBe("clothing");
    expect(plan.rows[0]?.categoryId).toBeNull();
  });

  it("recognises a category whichever language it was created in", () => {
    const english = [category("c-en", "Groceries")];
    expect(resolveCategory("groceries", english)?.id).toBe("c-en");
    expect(resolveCategory("groceries", CATEGORIES)?.id).toBe("c-groceries");
  });

  it("lists the merchants no rule recognised", () => {
    const csv = [
      "İşlem Tarihi;Açıklama;Tutar",
      "12/08/2026;ZTR MUHENDISLIK LTD STI;1.500,00",
    ].join("\n");
    const parsed = parseStatement(csv);
    const plan = buildImportPlan(parsed.lines, parsed.skipped, [], CATEGORIES, parsed.source);
    expect(plan.unknownMerchants).toEqual(["ZTR Muhendislik"]);
  });
});

describe("the fingerprint", () => {
  it("does not change when the same row is read again", () => {
    const line = {
      date: "2026-08-12",
      description: "MIGROS",
      amountMinor: 123456,
      flow: "EXPENSE" as const,
      kind: "spend" as const,
      index: 0,
      raw: "",
    };
    expect(externalIdFor(line, "Migros", 1)).toBe(externalIdFor(line, "Migros", 1));
  });

  it("separates two identical purchases on one day", () => {
    const line = {
      date: "2026-08-12",
      description: "MIGROS",
      amountMinor: 123456,
      flow: "EXPENSE" as const,
      kind: "spend" as const,
      index: 0,
      raw: "",
    };
    expect(externalIdFor(line, "Migros", 1)).not.toBe(externalIdFor(line, "Migros", 2));
  });
});
