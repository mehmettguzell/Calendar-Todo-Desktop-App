import { describe, expect, it } from "vitest";
import { atTime } from "../datetime";
import { parseQuickAdd } from "../naturalLanguage";

// A Tuesday, so weekday maths has somewhere unambiguous to land.
const NOW = atTime("2026-08-25", "09:00");
const parse = (input: string) => parseQuickAdd(input, NOW);

describe("dates in plain language", () => {
  it("understands today and tomorrow, in both languages", () => {
    expect(parse("yarın sunum").dueDate).toBe("2026-08-26");
    expect(parse("tomorrow presentation").dueDate).toBe("2026-08-26");
    expect(parse("bugün fatura öde").dueDate).toBe("2026-08-25");
    expect(parse("today pay bill").dueDate).toBe("2026-08-25");
  });

  it("finds the next weekday, and skips a week when asked", () => {
    // Today is Tuesday the 25th.
    expect(parse("cuma toplantı").dueDate).toBe("2026-08-28");
    expect(parse("friday meeting").dueDate).toBe("2026-08-28");
    expect(parse("gelecek cuma toplantı").dueDate).toBe("2026-09-04");
  });

  it("reads written dates in either order", () => {
    expect(parse("25 Ağustos konferans").dueDate).toBe("2026-08-25");
    expect(parse("August 30 conference").dueDate).toBe("2026-08-30");
    expect(parse("konferans 01.09.2026").dueDate).toBe("2026-09-01");
    expect(parse("konferans 2026-09-01").dueDate).toBe("2026-09-01");
  });

  it("refuses a date that does not exist rather than rolling into next month", () => {
    // 31 April silently becoming 1 May is the classic date-parser bug.
    expect(parse("31 Nisan toplantı").dueDate).toBeNull();
  });

  it("counts forward in days and weeks", () => {
    expect(parse("3 gün sonra kontrol").dueDate).toBe("2026-08-28");
    expect(parse("in 2 weeks review").dueDate).toBe("2026-09-08");
  });

  it("jumps to the start of next week", () => {
    expect(parse("haftaya planlama").dueDate).toBe("2026-08-31");
    expect(parse("next week planning").dueDate).toBe("2026-08-31");
  });
});

describe("times", () => {
  it("reads a single clock time and drops all-day", () => {
    const p = parse("yarın 14:00 sunum");
    expect(p.startTime).toBe("14:00");
    expect(p.allDay).toBe(false);
    expect(p.title).toBe("sunum");
  });

  it("reads a range", () => {
    const p = parse("yarın 14:00-16:00 sunum");
    expect(p.startTime).toBe("14:00");
    expect(p.endTime).toBe("16:00");
  });

  it("reads a range written with a word", () => {
    const p = parse("09.00 ile 10.30 arası daily");
    expect(p.startTime).toBe("09:00");
    expect(p.endTime).toBe("10:30");
  });

  it("understands am/pm", () => {
    expect(parse("meeting at 2pm").startTime).toBe("14:00");
    expect(parse("standup at 9am").startTime).toBe("09:00");
  });

  it("does NOT turn a counting number into a time", () => {
    // "buy 3 apples" must not become an appointment at three in the morning.
    const p = parse("3 elma al");
    expect(p.startTime).toBeNull();
    expect(p.title).toBe("3 elma al");
  });

  it("takes a bare hour only when a word makes it a time", () => {
    expect(parse("saat 15 toplantı").startTime).toBe("15:00");
  });

  it("rejects an impossible clock", () => {
    expect(parse("toplantı 25:99").startTime).toBeNull();
  });
});

describe("recurrence", () => {
  it("reads the simple frequencies", () => {
    expect(parse("her gün spor").recurrence).toEqual({ freq: "DAILY", interval: 1 });
    expect(parse("every week review").recurrence).toEqual({ freq: "WEEKLY", interval: 1 });
    expect(parse("her ay kira").recurrence).toEqual({ freq: "MONTHLY", interval: 1 });
    expect(parse("her yıl sigorta").recurrence).toEqual({ freq: "YEARLY", interval: 1 });
  });

  it("reads a weekday rule and anchors it on the first matching date", () => {
    const p = parse("her salı ekip toplantısı");
    expect(p.recurrence).toEqual({ freq: "WEEKLY", interval: 1, byWeekday: [2] });
    expect(p.dueDate).toBe("2026-08-25");
    expect(p.title).toBe("ekip toplantısı");
  });
});

describe("priority, category, tags and estimate", () => {
  it("reads !1..!4 and the words behind them", () => {
    expect(parse("rapor !1").priority).toBe("HIGH");
    expect(parse("rapor !yüksek").priority).toBe("HIGH");
    expect(parse("rapor p3").priority).toBe("LOW");
    expect(parse("rapor").priority).toBe("NONE");
  });

  it("reads #category and @tags", () => {
    const p = parse("sunum hazırla #iş @ofis @acil");
    expect(p.categoryName).toBe("iş");
    expect(p.tags).toEqual(["ofis", "acil"]);
    expect(p.title).toBe("sunum hazırla");
  });

  it("reads an estimate and uses it to close an open-ended time", () => {
    const p = parse("yarın 14:00 sunum ~90dk");
    expect(p.estimateMinutes).toBe(90);
    expect(p.endTime).toBe("15:30");
  });

  it("accepts hours as an estimate unit", () => {
    expect(parse("derin çalışma ~2 saat").estimateMinutes).toBe(120);
    expect(parse("deep work ~1.5h").estimateMinutes).toBe(90);
  });
});

describe("the title is what is left", () => {
  it("strips everything it understood", () => {
    const p = parse("yarın 14:00-16:00 proje sunumu hazırla #iş !1 @ofis ~2 saat");
    expect(p.title).toBe("proje sunumu hazırla");
    expect(p.dueDate).toBe("2026-08-26");
    expect(p.startTime).toBe("14:00");
    expect(p.endTime).toBe("16:00");
    expect(p.priority).toBe("HIGH");
    expect(p.categoryName).toBe("iş");
    expect(p.tags).toEqual(["ofis"]);
  });

  it("leaves an unrecognised input completely alone", () => {
    const p = parse("annemi ara");
    expect(p.title).toBe("annemi ara");
    expect(p.dueDate).toBeNull();
    expect(p.startTime).toBeNull();
    expect(p.hints).toEqual([]);
  });

  it("keeps the whole input when parsing would leave nothing behind", () => {
    // Someone whose task is literally called "yarın" gets a task called
    // "yarın", not an untitled one scheduled for tomorrow.
    const p = parse("yarın");
    expect(p.title).toBe("yarın");
    expect(p.dueDate).toBeNull();
  });

  it("never produces a title made only of leftover punctuation", () => {
    expect(parse("   toplantı   ").title).toBe("toplantı");
  });
});

describe("deadlines in plain language", () => {
  it("reads a Turkish \u201c...e kadar\u201d as a deadline, not a start date", () => {
    const parsed = parse("20 Eyl\u00fcl'e kadar sunum");
    expect(parsed.deadline).toBe("2026-09-20");
    expect(parsed.dueDate).toBeNull();
    expect(parsed.title).toBe("sunum");
  });

  it("reads the English forms", () => {
    expect(parse("report by 20 September").deadline).toBe("2026-09-20");
    expect(parse("report until 2026-09-20").deadline).toBe("2026-09-20");
    expect(parse("report by 20 September").title).toBe("report");
  });

  it("takes a relative deadline too", () => {
    expect(parse("yar\u0131na kadar rapor").deadline).toBe("2026-08-26");
    expect(parse("report by tomorrow").deadline).toBe("2026-08-26");
  });

  it("keeps a start date and a deadline apart in one sentence", () => {
    const parsed = parse("yar\u0131n ba\u015fla 20 Eyl\u00fcl'e kadar bitir");
    expect(parsed.dueDate).toBe("2026-08-26");
    expect(parsed.deadline).toBe("2026-09-20");
  });

  /*
   * A dash still means a span: "25 - 28 August" is four days of conference,
   * which is a different fact from "finish by the 28th".
   */
  it("leaves the dash form as a multi-day span", () => {
    const parsed = parse("2026-08-25 - 2026-08-28 konferans");
    expect(parsed.dueDate).toBe("2026-08-25");
    expect(parsed.endDate).toBe("2026-08-28");
    expect(parsed.deadline).toBeNull();
  });

  it("leaves \u201ckadar\u201d alone when no date precedes it", () => {
    const parsed = parse("bu kadar yeter");
    expect(parsed.deadline).toBeNull();
    expect(parsed.title).toBe("bu kadar yeter");
  });
});
