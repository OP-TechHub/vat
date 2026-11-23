import { describe, expect, it } from "vitest";
import * as M from "../lib/tiep/model";
import type { CustomsEntry } from "../lib/types";

const E = (o: Partial<CustomsEntry> & { cusdec_no: string }): CustomsEntry =>
  ({
    id: o.cusdec_no, company_id: "c", direction: "import", invoice_no: "INV", item_no: 1, cusdec_date: null, cusdec_month: null,
    currency_type: "USD", ex_rate: 300, invoice_value: 0, customs_value: 1000, vat_base: 0, vat_amount: 0, party: "Sup",
    description: "MARINE FEED", hs_code: "23099010", uom: "KGM", quantity: 100, cid_amount: 0, cid_code: null, pal_amount: 0,
    pal_code: null, sscl_amount: 0, sscl_code: null, vat_type: null, vat_code: null, created_at: "", ...o,
  }) as CustomsEntry;
const ext = (cd: string, o: Partial<M.ImportExt> = {}): M.ImportExt => ({
  id: cd, company_id: "c", cusdec_no: cd, invoice_no: "INV", item_no: 1, grp: "Fish Feed", ftype: null, req: "Yes",
  pending: false, duty_total: null, remarks: null, legacy_id: null, ...o,
});
const can = (cd: string, qty: number, status: "Completed" | "Planned" = "Completed") =>
  ({ cusdec_no: cd, invoice_no: "INV", item_no: 1, qty, status }) as M.Cancellation;

const entries = [
  E({ cusdec_no: "S 100", cusdec_date: "10.01.2025", cid_amount: 150, cid_code: "0", pal_amount: 50, pal_code: "0", vat_amount: 180, vat_code: "2" }),
  E({ cusdec_no: "S 101", cusdec_date: "2025-03-01", cid_amount: 300, cid_code: "0" }),
  E({ cusdec_no: "I 900", cusdec_date: "2025-02-01" }),
  E({ cusdec_no: "S 50", cusdec_month: "Dec 2024", hs_code: "2309.90.10" }),
  E({ cusdec_no: "S 60", cusdec_date: "2024-11-01", description: "LOGBOOK FEED" }),
];
const exts = [ext("S 100", { legacy_id: "IMP-0001" }), ext("S 101"), ext("S 60", { duty_total: 500 })];
const lines = M.buildLines(entries, exts, [can("S 100", 40), can("S 100", 60, "Planned"), can("S 101", 100)], { periodDays: 365, asAt: "2026-02-01" });
const by = (cd: string) => lines.find((l) => l.cusdec === cd)!;

describe("buildLines", () => {
  it("orders oldest first and numbers FIFO within the group, skipping duty-paid lines", () => {
    expect(lines.map((l) => l.cusdec)).toEqual(["S 60", "S 50", "S 100", "I 900", "S 101"]);
    expect(lines.filter((l) => l.fifo).map((l) => [l.cusdec, l.fifo])).toEqual([["S 60", 1], ["S 50", 2], ["S 100", 3], ["S 101", 4]]);
  });
  it("works out suspended duty, balances, status, due date and financial year", () => {
    const a = by("S 100");
    expect(a).toMatchObject({ id: "IMP-0001", date: "2025-01-10", dsus: 200, vdef: 180, tsus: 380, left: 60, bal: 0, osv: 228 });
    expect(a).toMatchObject({ status: "Fully planned", overdue: true, due: "2026-01-10", fy: "FY 2024/25" });
    expect(by("S 101").status).toBe("Fully cancelled");
    expect(by("I 900")).toMatchObject({ status: "Not applicable", req: "No", fifo: null });
    expect(by("S 60")).toMatchObject({ dsus: 500, status: "Open" });
  });
  it("takes an unset group from lines with the same HS code and a month-only date as the 1st", () => {
    expect(by("S 50")).toMatchObject({ grp: "Fish Feed", grpGuessed: true, dateGuessed: true, date: "2024-12-01" });
  });
});

describe("allocate", () => {
  const open = M.openLines(lines, "Marine Fish Feed|KGM");
  it("allocates FIFO, oldest open line first, and reports what is left", () => {
    expect(open.map((l) => l.cusdec)).toEqual(["S 60", "S 50"]);
    expect(M.allocate(open, 150, "fifo").alloc.map((x) => [x.line.cusdec, x.take])).toEqual([["S 60", 100], ["S 50", 50]]);
    expect(M.allocate(open, 250, "fifo").left).toBe(50);
    expect(M.allocate(open, 30, "line", by("S 50").key).alloc[0].take).toBe(30);
  });
});

describe("totals and duty estimate", () => {
  it("totals imported, cancelled, planned and balance", () => {
    const t = M.totals(lines, "", true);
    expect([t.rows[0].q, t.rows[1].q, t.rows[3].q, t.rows[5].q]).toEqual([400, 140, 60, 200]);
  });
  it("estimates a logbook line's split from coded lines of its group", () => {
    const s = M.lbSplit(by("S 60"), M.lbTemplates(lines))!;
    expect(s.est).toBe(true);
    expect(Math.round(s.cid + s.pal + s.sscl + s.dut)).toBe(500);
  });
  it("uses the VAT rate in force and April-March years", () => {
    expect(M.vatRateOn("2023-05-01")).toBe(0.15);
    expect(M.fyOf("2026-03-31")).toBe("FY 2025/26");
    expect(M.fyOf("2026-04-01")).toBe("FY 2026/27");
  });
});

describe("standards", () => {
  const st = (id: string, f: string | null, to: string | null) => ({ id, name: id, short: id, valid_from: f, valid_to: to, yields: [], materials: [], mud: [] }) as unknown as M.Standard;
  it("finds gaps between valid periods and the standard for a date", () => {
    expect(M.stdCheckGaps([st("A", "2020-01-01", "2022-12-31"), st("B", "2023-02-01", null)])).toEqual(["no standard covers 01 Jan 2023 – 31 Jan 2023"]);
    expect(M.stdFor([st("A", "2020-01-01", "2022-12-31"), st("B", "2023-01-01", null)], "2024-05-05")!.id).toBe("B");
  });
});
