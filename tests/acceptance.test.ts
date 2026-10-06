/**
 * Acceptance checks from SPEC.md, run against supabase/seed.sql.
 * The seed is parsed here and the database view's claim rule (norm_doc_no match, earliest return month)
 * is reproduced in TypeScript so the report calculations can be checked without a live database.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cents, monthsOf, norm } from "@/lib/format";
import { matrix, monthWise, retCalc, returnVsLedger, tiles } from "@/lib/reports";
import type { Invoice, ScheduleLine, VatReturn } from "@/lib/types";

type Val = string | number | null;

/** Parse "insert into <table> (...) values (...),(...);" statements into rows keyed by column. */
function parseSeed(sql: string): Record<string, Record<string, Val>[]> {
  const out: Record<string, Record<string, Val>[]> = {};
  const re = /insert into (\w+) \(([^)]*)\) values\s*([\s\S]*?);\s*(?=\n|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const table = m[1];
    const cols = m[2].split(",").map((c) => c.trim());
    const body = m[3].replace(/\s+on conflict do nothing$/, "");
    for (const tuple of splitTuples(body)) {
      const vals = splitValues(tuple);
      if (vals.length !== cols.length) throw new Error(`Column count mismatch in ${table}: ${tuple}`);
      (out[table] ??= []).push(Object.fromEntries(cols.map((c, i) => [c, vals[i]])));
    }
  }
  return out;
}

function splitTuples(body: string): string[] {
  const tuples: string[] = [];
  let depth = 0;
  let inStr = false;
  let start = -1;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (ch === "'") {
        if (body[i + 1] === "'") i++;
        else inStr = false;
      }
      continue;
    }
    if (ch === "'") inStr = true;
    else if (ch === "(") {
      if (depth++ === 0) start = i + 1;
    } else if (ch === ")") {
      if (--depth === 0) tuples.push(body.slice(start, i));
    }
  }
  return tuples;
}

function splitValues(tuple: string): Val[] {
  const vals: Val[] = [];
  let i = 0;
  while (i <= tuple.length) {
    if (tuple[i] === "'") {
      let s = "";
      i++;
      while (i < tuple.length) {
        if (tuple[i] === "'") {
          if (tuple[i + 1] === "'") {
            s += "'";
            i += 2;
            continue;
          }
          break;
        }
        s += tuple[i++];
      }
      i++; // closing quote
      vals.push(s);
    } else {
      let j = tuple.indexOf(",", i);
      if (j < 0) j = tuple.length;
      const raw = tuple.slice(i, j).trim();
      vals.push(raw === "null" ? null : Number(raw));
      i = j;
    }
    // skip to after the next comma
    const k = tuple.indexOf(",", i);
    if (k < 0) break;
    i = k + 1;
  }
  return vals;
}

const seed = parseSeed(readFileSync(path.resolve(__dirname, "../supabase/seed.sql"), "utf8"));
const str = (v: Val) => (v == null ? null : String(v));
const numv = (v: Val) => (v == null ? 0 : Number(v));

const schedule: ScheduleLine[] = seed.schedule_lines.map((r, i) => ({
  id: "s" + i,
  company_id: String(r.company_id),
  return_month: String(r.return_month),
  serial_no: str(r.serial_no),
  invoice_date: str(r.invoice_date),
  tax_invoice_no: String(r.tax_invoice_no),
  supplier_tin: str(r.supplier_tin),
  supplier_name: str(r.supplier_name),
  description: str(r.description),
  purchase_value: numv(r.purchase_value),
  vat_amount: numv(r.vat_amount),
  created_at: "",
  created_by: null,
  ledger_invoice_no: null,
}));

// Reproduce invoice_claim_status: auto_claim_month = earliest return month whose schedule carries the doc no.
const earliest: Record<string, string> = {};
for (const s of [...schedule].sort((a, b) => a.return_month.localeCompare(b.return_month))) {
  const k = norm(s.tax_invoice_no);
  if (k && !earliest[k]) earliest[k] = s.return_month;
}
const invoices: Invoice[] = seed.ledger_invoices.map((r, i) => {
  const auto = earliest[norm(r.external_doc_no) ?? ""] ?? null;
  return {
    id: "i" + i,
    company_id: String(r.company_id),
    invoice_no: String(r.invoice_no),
    posting_date: String(r.posting_date),
    vendor_name: str(r.vendor_name),
    external_doc_no: str(r.external_doc_no),
    description: str(r.description),
    amount_lcy: numv(r.amount_lcy),
    source_amount: r.source_amount == null ? null : numv(r.source_amount),
    original_invoice: null,
    manual_claim_month: null,
    manual_not_claimed: false,
    updated_at: "",
    updated_by: null,
    auto_claim_month: auto,
    claim_month: auto,
    claim_status: auto ? "Claimed" : "Not Claimed",
  };
});
// Reproduce schedule_line_match: earliest-posted ledger invoice with the same normalised doc no.
const byDoc: Record<string, Invoice> = {};
for (const inv of [...invoices].sort((a, b) => a.posting_date.localeCompare(b.posting_date))) {
  const k = norm(inv.external_doc_no);
  if (k && !byDoc[k]) byDoc[k] = inv;
}
for (const s of schedule) s.ledger_invoice_no = byDoc[norm(s.tax_invoice_no)]?.invoice_no ?? null;

const returns: VatReturn[] = seed.vat_returns.map((r) => ({
  company_id: String(r.company_id),
  return_month: String(r.return_month),
  zero_rated: numv(r.zero_rated),
  exempt: numv(r.exempt),
  imports_value: numv(r.imports_value),
  imports_deferred: numv(r.imports_deferred),
  imports_upfront: numv(r.imports_upfront),
  local_value: numv(r.local_value),
  local_tax: numv(r.local_tax),
  disallowed: numv(r.disallowed),
  brought_forward: numv(r.brought_forward),
  ledger_exports: numv(r.ledger_exports),
  ledger_local_sales: numv(r.ledger_local_sales),
  ledger_imports: numv(r.ledger_imports),
}));

const months = monthsOf(2026);
const r2 = (n: number) => cents(n);

describe("seed data shape", () => {
  it("has 608 invoices, 244 schedule lines and the April return", () => {
    expect(invoices).toHaveLength(608);
    expect(schedule).toHaveLength(244);
    expect(returns).toHaveLength(1);
    expect(new Set(invoices.map((i) => i.invoice_no)).size).toBe(608); // unique (company, invoice_no)
  });
});

describe("acceptance checks (SPEC.md, tax year 2026/27)", () => {
  const t = tiles(invoices);

  it("608 invoices, ledger input VAT 20,652,662.26", () => {
    expect(t.total.count).toBe(608);
    expect(r2(t.total.amount)).toBe(20652662.26);
  });

  it("12 claimed: May 560,883.98 and Aug 32,717.81; not claimed 20,059,060.47", () => {
    expect(t.claimed.count).toBe(12);
    expect(r2(t.notClaimed.amount)).toBe(20059060.47);
    const mx = matrix(invoices, months);
    expect(mx.columns).toEqual(["2026-05", "2026-08"]);
    expect(r2(mx.total.byClaimMonth["2026-05"])).toBe(560883.98);
    expect(r2(mx.total.byClaimMonth["2026-08"])).toBe(32717.81);
    expect(r2(mx.total.notClaimed)).toBe(20059060.47);
    expect(r2(mx.total.total)).toBe(20652662.26);
    expect(r2(t.claimed.amount)).toBe(r2(560883.98 + 32717.81));
  });

  it("posted by month: Apr 3,594,516.46 · May 3,965,119.01 · Jun 3,324,637.59 · Jul 4,118,258.73 · Aug 5,650,130.47", () => {
    const mw = monthWise(invoices, months);
    const by = Object.fromEntries(mw.rows.map((r) => [r.month, r2(r.total)]));
    expect(by).toEqual({
      "2026-04": 3594516.46,
      "2026-05": 3965119.01,
      "2026-06": 3324637.59,
      "2026-07": 4118258.73,
      "2026-08": 5650130.47,
    });
    expect(r2(mw.total.total)).toBe(20652662.26);
    expect(mw.total.invoices).toBe(608);
    expect(mw.total.claimedCount + mw.total.unclaimedCount).toBe(608);
  });

  it("schedule VAT: Apr 1,386,008.84 · May 4,762,259.49 · Jun 245,070.14 · Jul 2,231,489.30 · Aug 1,845,599.70", () => {
    const rv = returnVsLedger(invoices, invoices, schedule, returns, months);
    const by = Object.fromEntries(rv.rows.map((r) => [r.month, r2(r.scheduleVat)]));
    expect(by).toEqual({
      "2026-04": 1386008.84,
      "2026-05": 4762259.49,
      "2026-06": 245070.14,
      "2026-07": 2231489.3,
      "2026-08": 1845599.7,
    });
    expect(rv.total.lines).toBe(244);
    const may = rv.rows.find((r) => r.month === "2026-05")!;
    expect(r2(may.claimedFromLedger)).toBe(560883.98);
    const aug = rv.rows.find((r) => r.month === "2026-08")!;
    expect(r2(aug.claimedFromLedger)).toBe(32717.81);
    // schedule VAT not in ledger + matched VAT = schedule VAT
    for (const row of rv.rows) expect(row.notInLedger).toBeLessThanOrEqual(row.scheduleVat + 0.005);
  });

  it("April return: total input tax 7,906,168; allowable 6,664,675; all ledger differences nil", () => {
    const c = retCalc(returns[0], schedule, invoices);
    expect(Math.round(c.t7)).toBe(7906168);
    expect(Math.round(c.t9)).toBe(6664675);
    expect(c.dExp).toBe(0);
    expect(c.dLoc).toBe(0);
    expect(c.dImp).toBe(0);
    expect(Math.round(c.avail)).toBe(6664675);
    // local purchases tax on the return (1,386,009) agrees with the schedule (1,386,008.84) within a rupee
    expect(Math.abs(c.dSched)).toBeLessThan(1);
  });
});
