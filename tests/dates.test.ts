import { describe, expect, it } from "vitest";
import { xlDate, xlText, num } from "@/lib/parse";
import { monthsOf, mLabel, mShort, taxYearOf, yearRange, monthStart, monthKey, norm, fmt, fmt0, yearLabel } from "@/lib/format";

describe("xlDate", () => {
  it("converts Excel serial numbers", () => {
    expect(xlDate(45658)).toBe("2025-01-01");
    expect(xlDate(46023)).toBe("2026-01-01");
    expect(xlDate(46113)).toBe("2026-04-01");
    expect(xlDate(46113.75)).toBe("2026-04-02"); // fractional serials round to the nearest day
  });
  it("parses dd.mm.yyyy, dd/mm/yyyy and dd-mm-yyyy", () => {
    expect(xlDate("05.04.2026")).toBe("2026-04-05");
    expect(xlDate("5/4/2026")).toBe("2026-04-05");
    expect(xlDate("31-03-2027")).toBe("2027-03-31");
    expect(xlDate(" 01/04/2026 00:00 ")).toBe("2026-04-01");
  });
  it("parses yyyy-mm-dd and yyyy/m/d", () => {
    expect(xlDate("2026-04-05")).toBe("2026-04-05");
    expect(xlDate("2026/4/5")).toBe("2026-04-05");
    expect(xlDate("2026-04-05T00:00:00")).toBe("2026-04-05");
  });
  it("treats a bare five-digit string as an Excel serial (CSV exports)", () => {
    expect(xlDate("46113")).toBe("2026-04-01");
    expect(xlDate("2026")).toBe("2026");
  });
  it("accepts Date objects", () => {
    expect(xlDate(new Date(Date.UTC(2026, 3, 1)))).toBe("2026-04-01");
  });
  it("returns unrecognised text trimmed and unchanged", () => {
    expect(xlDate(" 09-Jan-2026 ")).toBe("09-Jan-2026");
    expect(xlDate("")).toBe("");
    expect(xlDate(null)).toBe("");
    expect(xlDate(undefined)).toBe("");
  });
});

describe("xlText", () => {
  it("renders date serials as dd.mm.yyyy", () => {
    expect(xlText(46113)).toBe("01.04.2026");
  });
  it("leaves other numbers and text alone", () => {
    expect(xlText(123)).toBe("123");
    expect(xlText(" CCS/Y25/TI/007 ")).toBe("CCS/Y25/TI/007");
    expect(xlText(null)).toBe("");
  });
});

describe("num", () => {
  it("parses numbers and strings with thousands separators, rounding to cents", () => {
    expect(num(1234.567)).toBe(1234.57);
    expect(num("1,234.565")).toBe(1234.57);
    expect(num("8,923.50")).toBe(8923.5);
    expect(num("")).toBe(0);
    expect(num("abc")).toBe(0);
    expect(num(null)).toBe(0);
  });
});

describe("tax year helpers", () => {
  it("lists April to March", () => {
    const ms = monthsOf(2026);
    expect(ms).toHaveLength(12);
    expect(ms[0]).toBe("2026-04");
    expect(ms[8]).toBe("2026-12");
    expect(ms[9]).toBe("2027-01");
    expect(ms[11]).toBe("2027-03");
  });
  it("labels months", () => {
    expect(mLabel("2026-04")).toBe("Apr 2026");
    expect(mLabel("2027-03-01")).toBe("Mar 2027");
    expect(mShort("2026-12")).toBe("Dec");
    expect(mLabel("")).toBe("");
    expect(mLabel(null)).toBe("");
  });
  it("finds the tax year of a date", () => {
    expect(taxYearOf("2026-04-01")).toBe(2026);
    expect(taxYearOf("2027-03-31")).toBe(2026);
    expect(taxYearOf("2026-03-31")).toBe(2025);
    expect(yearRange(2026)).toEqual({ from: "2026-04-01", to: "2027-03-31" });
    expect(yearLabel(2026)).toBe("2026/27");
  });
  it("converts between month keys and dates", () => {
    expect(monthStart("2026-04")).toBe("2026-04-01");
    expect(monthStart("2026-04-17")).toBe("2026-04-01");
    expect(monthKey("2026-04-17")).toBe("2026-04");
    expect(monthKey(null)).toBe("");
  });
});

describe("matching key", () => {
  it("trims, upper-cases and removes all whitespace", () => {
    expect(norm(" ccs/y25/ti/007 ")).toBe("CCS/Y25/TI/007");
    expect(norm("IG-INGS 57873")).toBe("IG-INGS57873");
    expect(norm("a\tb\nc")).toBe("ABC");
    expect(norm(null)).toBe("");
    expect(norm(276783)).toBe("276783");
  });
});

describe("money formatting", () => {
  it("uses two decimals and thousands separators", () => {
    expect(fmt(20652662.26)).toBe("20,652,662.26");
    expect(fmt(0)).toBe("0.00");
    expect(fmt(-1234.5)).toBe("-1,234.50");
    expect(fmt(null)).toBe("");
    expect(fmt(NaN)).toBe("");
  });
  it("rounds whole rupees", () => {
    expect(fmt0(7906168.4)).toBe("7,906,168");
    expect(fmt0("")).toBe("");
    expect(fmt0(null)).toBe("");
  });
});
