/**
 * Report calculations ported from reference/prototype.html (vSummary, retCalc).
 * Pure functions over rows from the invoice_claim_status and schedule_line_match views.
 */
import { monthKey, sum } from "./format";
import type { Invoice, ReturnField, ScheduleLine, VatReturn } from "./types";

/** Posting month key of an invoice. */
export const pm = (r: Invoice) => monthKey(r.posting_date);
/** Claimed month key of an invoice ("" when not claimed). */
export const cm = (r: Invoice) => (r.claim_status === "Claimed" ? monthKey(r.claim_month) : "");
export const isClaimed = (r: Invoice) => r.claim_status === "Claimed";
export const rm = (s: ScheduleLine | VatReturn) => monthKey(s.return_month);

export interface Tiles {
  total: { amount: number; count: number };
  claimed: { amount: number; count: number };
  notClaimed: { amount: number; count: number };
  originalHeld: { amount: number; count: number };
}

/** Tiles over the invoices posted in the tax year. */
export function tiles(rows: Invoice[]): Tiles {
  const cl = rows.filter(isClaimed);
  const nc = rows.filter((r) => !isClaimed(r));
  const held = nc.filter((r) => r.original_invoice === "Yes");
  const t = (a: Invoice[]) => ({ amount: sum(a, (r) => r.amount_lcy), count: a.length });
  return { total: t(rows), claimed: t(cl), notClaimed: t(nc), originalHeld: t(held) };
}

export interface MonthRow {
  month: string;
  invoices: number;
  total: number;
  claimedCount: number;
  claimedAmount: number;
  unclaimedCount: number;
  unclaimedAmount: number;
  originalHeld: number;
}

/** Month-wise summary by posting date; only months with invoices, plus a total row. */
export function monthWise(rows: Invoice[], months: string[]): { rows: MonthRow[]; total: MonthRow } {
  const out: MonthRow[] = [];
  for (const k of months) {
    const a = rows.filter((r) => pm(r) === k);
    if (!a.length) continue;
    const c = a.filter(isClaimed);
    const u = a.filter((r) => !isClaimed(r));
    out.push({
      month: k,
      invoices: a.length,
      total: sum(a, (r) => r.amount_lcy),
      claimedCount: c.length,
      claimedAmount: sum(c, (r) => r.amount_lcy),
      unclaimedCount: u.length,
      unclaimedAmount: sum(u, (r) => r.amount_lcy),
      originalHeld: a.filter((r) => r.original_invoice === "Yes").length,
    });
  }
  const total: MonthRow = {
    month: "Total",
    invoices: sum(out, (r) => r.invoices),
    total: sum(out, (r) => r.total),
    claimedCount: sum(out, (r) => r.claimedCount),
    claimedAmount: sum(out, (r) => r.claimedAmount),
    unclaimedCount: sum(out, (r) => r.unclaimedCount),
    unclaimedAmount: sum(out, (r) => r.unclaimedAmount),
    originalHeld: sum(out, (r) => r.originalHeld),
  };
  return { rows: out, total };
}

export interface ReturnRow {
  month: string;
  lines: number;
  scheduleVat: number;
  localTax: number | null; // null = return not entered
  ledgerPosted: number;
  claimedFromLedger: number;
  notInLedger: number;
}

/**
 * VAT return against ledger, per return month.
 * `yearRows` are invoices posted in the year; `allRows` may also include invoices from other
 * years that were claimed in this year (claimed-from-ledger counts those too, as the prototype does).
 */
export function returnVsLedger(
  yearRows: Invoice[],
  allRows: Invoice[],
  schedule: ScheduleLine[],
  returns: VatReturn[],
  months: string[],
): { rows: ReturnRow[]; total: ReturnRow } {
  const out: ReturnRow[] = [];
  for (const k of months) {
    const s = schedule.filter((x) => rm(x) === k);
    const a = yearRows.filter((r) => pm(r) === k);
    const ret = returns.find((x) => rm(x) === k);
    if (!s.length && !a.length && !ret) continue;
    out.push({
      month: k,
      lines: s.length,
      scheduleVat: sum(s, (x) => x.vat_amount),
      localTax: ret ? +ret.local_tax || 0 : null,
      ledgerPosted: sum(a, (r) => r.amount_lcy),
      claimedFromLedger: sum(
        allRows.filter((r) => cm(r) === k),
        (r) => r.amount_lcy,
      ),
      notInLedger: sum(
        s.filter((x) => !x.ledger_invoice_no),
        (x) => x.vat_amount,
      ),
    });
  }
  const total: ReturnRow = {
    month: "Total",
    lines: sum(out, (r) => r.lines),
    scheduleVat: sum(out, (r) => r.scheduleVat),
    localTax: sum(out, (r) => r.localTax ?? 0),
    ledgerPosted: sum(out, (r) => r.ledgerPosted),
    claimedFromLedger: sum(out, (r) => r.claimedFromLedger),
    notInLedger: sum(out, (r) => r.notInLedger),
  };
  return { rows: out, total };
}

export interface MatrixRow {
  month: string;
  byClaimMonth: Record<string, number>;
  notClaimed: number;
  total: number;
}

/** Posting month by claimed month. Claimed-month columns are the months any invoice was claimed in. */
export function matrix(rows: Invoice[], months: string[]): { columns: string[]; rows: MatrixRow[]; total: MatrixRow } {
  const columns = months.filter((k) => rows.some((r) => cm(r) === k));
  const build = (a: Invoice[], label: string): MatrixRow => ({
    month: label,
    byClaimMonth: Object.fromEntries(
      columns.map((c) => [c, sum(a.filter((r) => cm(r) === c), (r) => r.amount_lcy)]),
    ),
    notClaimed: sum(a.filter((r) => !isClaimed(r)), (r) => r.amount_lcy),
    total: sum(a, (r) => r.amount_lcy),
  });
  const out: MatrixRow[] = [];
  for (const k of months) {
    const a = rows.filter((r) => pm(r) === k);
    if (a.length) out.push(build(a, k));
  }
  return { columns, rows: out, total: build(rows, "Total") };
}

/**
 * Return form fields in display order, with cage references, following the "VAT Return_Upload"
 * workbook. "sec" rows are section headings. Derived cages (7, 9, 13, 14) are not here.
 */
export const RETURN_FIELDS: ReadonlyArray<readonly [ReturnField | "sec", string]> = [
  ["sec", "Output tax and supplies"],
  ["taxable_value", "Taxable supplies, value (A)"],
  ["taxable_tax", "Taxable supplies, tax (0)"],
  ["wholesale_retail", "Wholesale and retail taxable supplies (B / 2)"],
  ["suspended_supplies", "VAT suspended taxable supplies (C / 2A)"],
  ["output_tax", "Total output tax (3)"],
  ["zero_rated", "Zero rated supplies, goods (D)"],
  ["zero_rated_services", "Zero rated supplies, services (D1)"],
  ["exempt", "Exempt supplies (E)"],
  ["excluded_supplies", "Excluded supplies (E1)"],
  ["sec", "Input tax"],
  ["imports_value", "Imports, value (H)"],
  ["imports_deferred", "Imports, deferred tax (4)"],
  ["imports_upfront", "Imports, upfront tax (5)"],
  ["local_value", "Local purchases, value (I)"],
  ["local_tax", "Local purchases, tax (6)"],
  ["suspended_purchases_value", "VAT suspended purchases, value (J)"],
  ["suspended_purchases_tax", "VAT suspended purchases, suspended tax (K)"],
  ["imports_no_vat", "Imports on which VAT is not charged (J2)"],
  ["disallowed", "Disallowable input tax on imports, other purchases and adjustment (8)"],
  ["disallowed_suspended", "Disallowable input tax on suspended purchases (8A)"],
  ["brought_forward", "Brought forward input tax (10)"],
  ["sec", "Allowable input tax and tax payable / refundable"],
  ["allowable_zero_rated", "Zero rated, suspended, wholesale & retail, s.22(7) (11)"],
  ["not_group_a", "Not belonging to group A (12)"],
  ["gross_refund", "Gross refund due (15)"],
  ["tax_payable", "Tax payable (16)"],
  ["monthly_payments", "Monthly payments (Q)"],
  ["svat_credit", "Tax credit based on SVAT credit voucher (R2)"],
  ["total_credits", "Total credits (17)"],
  ["net_refund_payable", "(Refund due) / tax payable (18)"],
  ["sec", "As per ledger"],
  ["ledger_exports", "Exports as per ledger"],
  ["ledger_local_sales", "Local sales as per ledger"],
  ["ledger_imports", "Imports VAT as per ledger"],
];

export const RETURN_FIELD_IDS = RETURN_FIELDS.filter(([id]) => id !== "sec").map(([id]) => id as ReturnField);

export interface ReturnCalc {
  t7: number; // total input tax (4+5+6)
  t9: number; // allowable excluding b/f (7-8)
  avail: number; // available (9+10)
  t13: number; // allowable input tax (11+12)
  t14: number; // unabsorbed excess input tax c/f (9+10-13)
  chk15: number; // cage 15 less (13-3-8A)
  chk18: number; // cage 18 less (16-17-15)
  sugg: number; // disallowable by exempt ratio = t7 * E / (D+E)
  d8: number; // cage 8 less computed
  suggK: number; // suspended purchases disallowable = K * E / (D+E)
  d8A: number; // cage 8A less computed
  impliedRate: number | null; // K / J, null when J is nil
  sched: number; // schedule VAT total for the month
  dSched: number; // local tax (6) - schedule VAT
  dExp: number; // zero rated - ledger exports
  dLoc: number; // exempt - ledger local sales
  dImp: number; // deferred (4) - ledger imports VAT
  ledgerClaimed: number; // ledger value of invoices claimed in this month
}

export function retCalc(r: VatReturn, schedule: ScheduleLine[], allRows: Invoice[]): ReturnCalc {
  const k = rm(r);
  const n = (f: ReturnField) => +(r[f] ?? 0) || 0;
  const t7 = n("imports_deferred") + n("imports_upfront") + n("local_tax");
  const t9 = t7 - n("disallowed");
  const t13 = n("allowable_zero_rated") + n("not_group_a");
  const sup = n("zero_rated") + n("exempt");
  const ratio = sup ? n("exempt") / sup : 0;
  const sched = sum(
    schedule.filter((x) => rm(x) === k),
    (x) => x.vat_amount,
  );
  return {
    t7,
    t9,
    avail: t9 + n("brought_forward"),
    t13,
    t14: t9 + n("brought_forward") - t13,
    chk15: n("gross_refund") - (t13 - n("output_tax") - n("disallowed_suspended")),
    chk18: n("net_refund_payable") - (n("tax_payable") - n("total_credits") - n("gross_refund")),
    sugg: t7 * ratio,
    d8: n("disallowed") - t7 * ratio,
    suggK: n("suspended_purchases_tax") * ratio,
    d8A: n("disallowed_suspended") - n("suspended_purchases_tax") * ratio,
    impliedRate: n("suspended_purchases_value") ? n("suspended_purchases_tax") / n("suspended_purchases_value") : null,
    sched,
    dSched: n("local_tax") - sched,
    dExp: n("zero_rated") - n("ledger_exports"),
    dLoc: n("exempt") - n("ledger_local_sales"),
    dImp: n("imports_deferred") - n("ledger_imports"),
    ledgerClaimed: sum(
      allRows.filter((x) => cm(x) === k),
      (x) => x.amount_lcy,
    ),
  };
}

/** Differences under one rupee are treated as agreed. */
export const agreed = (v: number) => Math.abs(v) < 1;
