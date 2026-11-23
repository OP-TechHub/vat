/**
 * TIEP logic, ported from the TIEP Import Register app (same rules, same names where it helps to compare).
 * Pure functions: no DOM, no storage, so they run in the browser and in unit tests.
 *
 * An import line is an import customs entry (CusDec item) of the Import Register plus its TIEP fields
 * (tiep_import_ext). Its balance comes from the cancellation postings (tiep_cancellations) on the same key.
 */
import type { CustomsEntry } from "../types";

export const GROUPS = [
  "Fish Feed",
  "Broodstock Feed",
  "Microalgae",
  "Artemia",
  "Enrichment",
  "Chemicals",
  "Packaging",
  "Fingerlings",
  "Returned Fish",
  "Equipment & Spares",
] as const;
export type Group = (typeof GROUPS)[number];

export const FEED_TYPES = ["Marine Fish Feed", "Hatchery Feed"] as const;
export const PRODUCTS = [
  "Marine Fish Feed",
  "Hatchery Feed",
  "Broodstock Feed",
  "Microalgae",
  "Artemia",
  "Enrichment",
  "Chemicals",
  "Packaging",
  "Fingerlings",
  "Returned Fish",
  "Equipment & Spares",
];

export const CATEGORY: Record<Group, string> = {
  "Fish Feed": "Raw Material",
  "Broodstock Feed": "Raw Material",
  Microalgae: "Raw Material",
  Artemia: "Raw Material",
  Enrichment: "Raw Material",
  Chemicals: "Consumable",
  Packaging: "Consumable",
  Fingerlings: "Raw Material",
  "Returned Fish": "Re-export goods",
  "Equipment & Spares": "Capital Goods / Spares",
};

/** Shown for a line whose material group is not set yet. */
export const NO_GROUP = "Not classified";

export const STATUSES = [
  "Open",
  "Partly planned",
  "Fully planned",
  "Partially cancelled",
  "Fully cancelled",
  "Over-planned",
  "Over-cancelled",
  "Details pending",
  "Not applicable",
] as const;
export type LineStatus = (typeof STATUSES)[number];

export type Req = "Yes" | "Confirm" | "No";

// ---- Rows as held -----------------------------------------------------------------------------------------

export interface ImportExt {
  id: string;
  company_id: string;
  cusdec_no: string;
  invoice_no: string;
  item_no: number;
  grp: Group | null;
  ftype: string | null;
  req: Req;
  pending: boolean;
  duty_total: number | null;
  remarks: string | null;
  legacy_id: string | null;
}

export interface Cancellation {
  id: string;
  company_id: string;
  ref: string;
  seq: number;
  type: "export" | "local";
  status: "Completed" | "Planned";
  posting_date: string | null;
  exp_inv: string | null;
  exp_cusdec: string | null;
  product: string | null;
  exp_qty: number | null;
  ratio: number | null;
  ratio_text: string | null;
  remarks: string | null;
  mode: string | null;
  cusdec_no: string;
  invoice_no: string;
  item_no: number;
  grp: string | null;
  uom: string | null;
  qty: number;
  item: string | null;
  batch_id: string | null;
  cancel_cusdec: string | null;
  cancel_date: string | null;
  hs: string | null;
  duty: number | null;
  value_usd: number | null;
  source: "manual" | "mud" | "logbook" | "plan";
  sales_invoice_id: string | null;
  legacy_id: string | null;
  posted_by: string | null;
  posted_at: string;
}

export interface Batch {
  id: string;
  company_id: string;
  name: string;
  ref: string;
  start_date: string | null;
  end_date: string | null;
  sold_qty: number | null;
  duty_amount: number | null;
  status: "Pending duty payment" | "Duty paid";
  cancel_cusdec: string | null;
  cancel_date: string | null;
  notes: string | null;
}

export interface StdYield {
  product: string;
  hs: string;
  yield: number;
}
export interface StdMaterial {
  mat: string;
  stage: string;
  hs: string;
  uom: string;
  grp: string;
  sub: string;
  annual: number;
  perKg: number;
}
export interface StdMud {
  label: string;
  hs: string;
  uom: string;
  basis: "fish" | "boxes";
  per1000: number;
  grp: string;
  kind: string;
  kw: string;
}
export interface Standard {
  id: string;
  company_id: string;
  name: string;
  short: string | null;
  valid_from: string | null;
  valid_to: string | null;
  edible_kg: number;
  fcr: number;
  notes: string | null;
  source: string | null;
  yields: StdYield[];
  materials: StdMaterial[];
  mud: StdMud[];
}

export interface SkuItem {
  id: string;
  company_id: string;
  code: string | null;
  item: string;
  tiep: string | null;
  alt: Record<string, string>;
  status: "confident" | "review" | "none";
  notes: string | null;
  src: string | null;
  confirmed: boolean;
}

export interface TiepSettings {
  company_id: string;
  period_days: number;
  as_at: string | null;
  guarantee: number | null;
}

// ---- Helpers ------------------------------------------------------------------------------------------------

const num = (v: unknown): number => {
  const x = Number(v);
  return isFinite(x) ? x : 0;
};
export const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** Key of an import line: CusDec no., invoice no., item no. (unique in the Import Register). */
export const lineKey = (cusdec: string, invoice: string | null | undefined, item: number | null | undefined) =>
  `${cusdec}|${invoice ?? ""}|${item ?? 1}`;

export const todayISO = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
/** Day number of an ISO date (days since 1970-01-01, UTC). */
export const dnum = (iso: string | null | undefined): number => {
  if (!iso) return NaN;
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 864e5;
};
export const isoFromNum = (n: number): string => new Date(n * 864e5).toISOString().slice(0, 10);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fdate = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d} ${MON[+m - 1]} ${y}`;
};

/** Financial year (April to March) of a date: "FY 2025/26". */
export function fyOf(iso: string | null | undefined): string {
  if (!iso) return "";
  const y0 = +iso.slice(0, 4);
  const m = +iso.slice(5, 7);
  const y = m >= 4 ? y0 : y0 - 1;
  return `FY ${y}/${String(y + 1).slice(-2)}`;
}

/** The CusDec date of a customs entry as ISO. guessed: only the month was known, so the 1st is used. */
export function entryDate(e: Pick<CustomsEntry, "cusdec_date" | "cusdec_month">): { date: string | null; guessed: boolean } {
  const d = (e.cusdec_date ?? "").trim();
  let m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, guessed: false };
  m = d.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (m) return { date: `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`, guessed: false };
  const mm = (e.cusdec_month ?? "").trim().match(/^([A-Za-z]{3})[a-z]*[\s-]+(\d{4})$/);
  if (mm) {
    const i = MON.findIndex((x) => x.toLowerCase() === mm[1].toLowerCase());
    if (i >= 0) return { date: `${mm[2]}-${String(i + 1).padStart(2, "0")}-01`, guessed: true };
  }
  return { date: null, guessed: false };
}

/** Product of a line: its group, with fish feed split into marine and hatchery feed. */
export function prodOf(grp: string, ftype: string | null | undefined, desc: string | null | undefined): string {
  if (grp !== "Fish Feed") return grp;
  if (ftype && (FEED_TYPES as readonly string[]).includes(ftype)) return ftype;
  return /HATCHERY/i.test(desc ?? "") ? "Hatchery Feed" : "Marine Fish Feed";
}
export const grpOfProd = (p: string) => ((FEED_TYPES as readonly string[]).includes(p) ? "Fish Feed" : p);

/** Default "cancellation required" of a line without TIEP fields: duty-paid (not S) no, spares confirm, else yes. */
export function defaultReq(cusdec: string, grp: string | null | undefined): Req {
  if (!cusdec.trim().toUpperCase().startsWith("S")) return "No";
  return grp === "Equipment & Spares" ? "Confirm" : "Yes";
}

/**
 * Material group for lines without TIEP fields: the group most used by classified lines with the same HS code
 * (a new CusDec of a regular material then lands in its usual group without anyone setting it).
 */
export function groupByHs(entries: CustomsEntry[], exts: Map<string, ImportExt>): Map<string, Group> {
  const count = new Map<string, Map<Group, number>>();
  for (const e of entries) {
    const x = exts.get(lineKey(e.cusdec_no, e.invoice_no, e.item_no));
    if (!x?.grp || !e.hs_code) continue;
    const hs = e.hs_code.replace(/\D/g, "");
    const m = count.get(hs) ?? new Map<Group, number>();
    m.set(x.grp, (m.get(x.grp) ?? 0) + 1);
    count.set(hs, m);
  }
  const out = new Map<string, Group>();
  for (const [hs, m] of count) out.set(hs, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  return out;
}

// ---- Import lines -------------------------------------------------------------------------------------------

export interface TiepLine {
  key: string;
  /** IMP-0001 for lines from the TIEP app, else CusDec · item. */
  id: string;
  cusdec: string;
  inv: string;
  item: number;
  date: string | null;
  dateGuessed: boolean;
  hs: string;
  desc: string;
  sup: string;
  /** Material group; "" when not classified. */
  grp: Group | "";
  /** The group was taken from other lines with the same HS code, not set on this line. */
  grpGuessed: boolean;
  ftype: string | null;
  prod: string;
  cat: string;
  uom: string;
  qty: number;
  cur: string;
  rate: number;
  invfc: number;
  cval: number;
  cid: number;
  cidc: string;
  pal: number;
  palc: string;
  sscl: number;
  ssclc: string;
  vatv: number;
  vat: number;
  vatc: string;
  vatt: string;
  file: string;
  rem: string;
  req: Req;
  pending: boolean;
  dutyTotal: number | null;
  hasExt: boolean;
  // Derived
  cqty: number;
  pqty: number;
  xqty: number;
  dsus: number;
  vdef: number;
  tsus: number;
  bal: number | null;
  left: number | null;
  pct: number | null;
  osv: number;
  osd: number;
  dn: number;
  due: string | null;
  days: number | null;
  status: LineStatus;
  overdue: boolean;
  tiep: boolean;
  ek: string;
  fy: string;
  month: string;
  fifo: number | null;
}

/** Duties suspended per the CusDec codes: components coded 0; else the logbook's one duty total. */
function dutiesSuspended(cidc: string, palc: string, ssclc: string, cid: number, pal: number, sscl: number, dutyTotal: number | null) {
  const coded = cidc === "0" || palc === "0" || ssclc === "0";
  if (!coded && dutyTotal != null) return dutyTotal;
  return (cidc === "0" ? cid : 0) + (palc === "0" ? pal : 0) + (ssclc === "0" ? sscl : 0);
}

/**
 * The import lines with their balances and status, oldest first, with FIFO numbers within each material
 * group. `xqty` (FIFO proposals for invoices without a saved MUD) is added by the caller when known.
 */
export function buildLines(
  entries: CustomsEntry[],
  exts: ImportExt[],
  cancels: Cancellation[],
  opts: { periodDays: number; asAt: string; xqty?: Map<string, number> },
): TiepLine[] {
  const extBy = new Map(exts.map((x) => [lineKey(x.cusdec_no, x.invoice_no, x.item_no), x]));
  const byHs = groupByHs(entries, extBy);
  const done = new Map<string, number>();
  const plan = new Map<string, number>();
  for (const c of cancels) {
    const k = lineKey(c.cusdec_no, c.invoice_no, c.item_no);
    const m = c.status === "Planned" ? plan : done;
    m.set(k, (m.get(k) ?? 0) + num(c.qty));
  }
  const asat = dnum(opts.asAt);
  const period = num(opts.periodDays) || 365;

  const rows: TiepLine[] = entries.map((e) => {
    const key = lineKey(e.cusdec_no, e.invoice_no, e.item_no);
    const x = extBy.get(key);
    const guess = !x?.grp && e.hs_code ? byHs.get(e.hs_code.replace(/\D/g, "")) : undefined;
    const grp: Group | "" = x?.grp ?? guess ?? "";
    const { date, guessed } = entryDate(e);
    const qty = num(e.quantity);
    const req: Req = x?.req ?? defaultReq(e.cusdec_no, grp);
    const na = req === "No";
    const pending = !!x?.pending;
    const cqty = r4(done.get(key) ?? 0);
    const pqty = r4(plan.get(key) ?? 0);
    const xqty = r4(opts.xqty?.get(key) ?? 0);
    const cidc = e.cid_code ?? "";
    const palc = e.pal_code ?? "";
    const ssclc = e.sscl_code ?? "";
    const vatc = e.vat_code ?? "";
    const dutyTotal = x?.duty_total ?? null;
    const dsus = dutiesSuspended(cidc, palc, ssclc, num(e.cid_amount), num(e.pal_amount), num(e.sscl_amount), dutyTotal);
    const vdef = vatc === "2" ? num(e.vat_amount) : 0;
    const tsus = dsus + vdef;
    const dn = dnum(date);
    const dueN = na || isNaN(dn) ? null : dn + period;

    let bal: number | null, left: number | null, pct: number | null, osv: number, osd: number, days: number | null;
    let status: LineStatus, overdue: boolean;
    if (pending && !na) {
      bal = null;
      left = null;
      pct = null;
      osv = 0;
      osd = 0;
      days = null;
      status = "Details pending";
      overdue = false;
    } else {
      left = na ? 0 : r4(qty - cqty);
      bal = na ? 0 : r4(qty - cqty - pqty);
      pct = na || !qty ? null : cqty / qty;
      osv = na || !qty ? 0 : (tsus * Math.max(left, 0)) / qty;
      osd = na || !qty ? 0 : (dsus * Math.max(left, 0)) / qty;
      days = !na && left > 0 && !isNaN(dn) ? asat - dn : null;
      status = na
        ? "Not applicable"
        : left < 0
          ? "Over-cancelled"
          : left === 0
            ? "Fully cancelled"
            : bal < 0
              ? "Over-planned"
              : bal === 0
                ? "Fully planned"
                : cqty > 0
                  ? "Partially cancelled"
                  : pqty > 0
                    ? "Partly planned"
                    : "Open";
      overdue = !na && left > 0 && dueN != null && asat > dueN;
    }
    const year = date ? date.slice(0, 4) : "";
    return {
      key,
      id: x?.legacy_id || `${e.cusdec_no} · ${e.item_no}`,
      cusdec: e.cusdec_no,
      inv: e.invoice_no,
      item: e.item_no,
      date,
      dateGuessed: guessed,
      hs: e.hs_code ?? "",
      desc: e.description ?? "",
      sup: e.party ?? "",
      grp,
      grpGuessed: !x?.grp && !!guess,
      ftype: x?.ftype ?? null,
      prod: grp ? prodOf(grp, x?.ftype, e.description) : NO_GROUP,
      cat: grp ? CATEGORY[grp] : "",
      uom: e.uom ?? "",
      qty,
      cur: e.currency_type ?? "",
      rate: num(e.ex_rate),
      invfc: num(e.invoice_value),
      cval: num(e.customs_value),
      cid: num(e.cid_amount),
      cidc,
      pal: num(e.pal_amount),
      palc,
      sscl: num(e.sscl_amount),
      ssclc,
      vatv: num(e.vat_base),
      vat: num(e.vat_amount),
      vatc,
      vatt: e.vat_type ?? "",
      file: e.file_name ?? "",
      rem: x?.remarks ?? "",
      req,
      pending,
      dutyTotal,
      hasExt: !!x,
      cqty,
      pqty,
      xqty,
      dsus,
      vdef,
      tsus,
      bal,
      left,
      pct,
      osv,
      osd,
      dn,
      due: dueN == null ? null : isoFromNum(dueN),
      days,
      status,
      overdue,
      tiep: e.cusdec_no.trim().toUpperCase().startsWith("S"),
      ek: `${e.cusdec_no}|${year}`,
      fy: fyOf(date),
      month: date ? `${MON[+date.slice(5, 7) - 1]} ${year}` : "",
      fifo: null,
    };
  });
  rows.sort(
    (a, b) =>
      (isNaN(a.dn) ? Infinity : a.dn) - (isNaN(b.dn) ? Infinity : b.dn) ||
      a.cusdec.localeCompare(b.cusdec) ||
      a.item - b.item ||
      a.key.localeCompare(b.key),
  );
  const seq = new Map<string, number>();
  for (const r of rows) {
    if (r.req === "No") continue;
    const n = (seq.get(r.grp) ?? 0) + 1;
    seq.set(r.grp, n);
    r.fifo = n;
  }
  return rows;
}

/** TIEP rows (fields or postings) whose import line is no longer in the Import Register. */
export function orphans(entries: CustomsEntry[], exts: ImportExt[], cancels: Cancellation[]) {
  const have = new Set(entries.map((e) => lineKey(e.cusdec_no, e.invoice_no, e.item_no)));
  return {
    exts: exts.filter((x) => !have.has(lineKey(x.cusdec_no, x.invoice_no, x.item_no))),
    cancels: cancels.filter((c) => !have.has(lineKey(c.cusdec_no, c.invoice_no, c.item_no))),
  };
}

// ---- Duty split ---------------------------------------------------------------------------------------------

export interface Split {
  cid: number;
  pal: number;
  sscl: number;
  dut: number;
  vat: number;
  est?: boolean;
}

/** VAT rate in force on an import date. */
export function vatRateOn(d: string | null | undefined): number {
  const s = d ?? "";
  return s < "2022-06-01" ? 0.08 : s < "2022-09-01" ? 0.12 : s < "2024-01-01" ? 0.15 : 0.18;
}

type Tpl = Record<string, { cid: number; pal: number; sscl: number; vat: boolean }>;

/** Rates (share of customs value) seen on CusDec-coded lines, by group and HS code, then by group. */
export function lbTemplates(lines: TiepLine[]): Tpl {
  const T: Record<string, { cv: number; cid: number; pal: number; sscl: number; vat: number }> = {};
  for (const r of lines) {
    const cv = r.cval;
    if (r.req === "No" || !cv) continue;
    const coded = r.cidc === "0" || r.palc === "0" || r.ssclc === "0";
    if (!coded) continue;
    for (const k of [r.grp + "|" + r.hs, r.grp]) {
      const t = (T[k] ??= { cv: 0, cid: 0, pal: 0, sscl: 0, vat: 0 });
      t.cv += cv;
      t.cid += r.cidc === "0" ? r.cid : 0;
      t.pal += r.palc === "0" ? r.pal : 0;
      t.sscl += r.ssclc === "0" ? r.sscl : 0;
      if (r.vatc === "2") t.vat += r.vat;
    }
  }
  const out: Tpl = {};
  for (const k in T) out[k] = { cid: T[k].cid / T[k].cv, pal: T[k].pal / T[k].cv, sscl: T[k].sscl / T[k].cv, vat: T[k].vat > 0 };
  return out;
}

/**
 * Estimated CID / PAL / SSCL / VAT of a logbook line that carries only one duty total; null when the line has
 * a real breakup. SSCL from 1 Oct 2022 at the template rate; the rest split CID : PAL by the template; VAT at
 * the rate in force on 110% of customs value + CID + PAL, only for groups whose CusDecs show VAT deferred.
 */
export function lbSplit(r: TiepLine, T: Tpl): Split | null {
  const coded = r.cidc === "0" || r.palc === "0" || r.ssclc === "0";
  if (coded || r.dutyTotal == null) return null;
  const dt = r.dutyTotal;
  const cv = r.cval;
  const t = T[r.grp + "|" + r.hs] ?? T[r.grp];
  const o: Split = { cid: 0, pal: 0, sscl: 0, dut: 0, vat: 0, est: true };
  if (!t || !cv) {
    o.dut = dt;
    return o;
  }
  o.sscl = (r.date ?? "") >= "2022-10-01" ? Math.min(dt, cv * t.sscl) : 0;
  const rem = dt - o.sscl;
  const cp = t.cid + t.pal;
  if (cp > 0) {
    o.cid = (rem * t.cid) / cp;
    o.pal = (rem * t.pal) / cp;
  } else if (t.sscl > 0 && !o.sscl) o.sscl = rem;
  else o.dut = rem;
  if (t.vat) o.vat = vatRateOn(r.date) * (1.1 * cv + o.cid + o.pal);
  return o;
}

/** Recorded duty and VAT of `qty` of a line (pro rata), optionally scaled to a liability actually used. */
export function liabSplit(r: TiepLine | undefined, qty: number, liabUsed?: number | null): Split {
  const o: Split = { cid: 0, pal: 0, sscl: 0, dut: 0, vat: 0 };
  if (!r || !(r.qty > 0) || !qty) return o;
  const per = qty / r.qty;
  const coded = r.cidc === "0" || r.palc === "0" || r.ssclc === "0";
  if (coded) {
    o.cid = (r.cidc === "0" ? r.cid : 0) * per;
    o.pal = (r.palc === "0" ? r.pal : 0) * per;
    o.sscl = (r.ssclc === "0" ? r.sscl : 0) * per;
  } else o.dut = num(r.dutyTotal) * per;
  o.vat = (r.vatc === "2" ? r.vat : 0) * per;
  const d = o.cid + o.pal + o.sscl + o.dut;
  if (liabUsed != null && d > 0 && Math.abs(liabUsed - d) > 0.005) {
    const f = liabUsed / d;
    o.cid *= f;
    o.pal *= f;
    o.sscl *= f;
    o.dut *= f;
  } else if (liabUsed != null && d === 0 && liabUsed) o.dut = liabUsed;
  return o;
}

/** Liability for guarantee of `qty` of a line: its duties suspended pro rata. */
export const allocLiab = (r: TiepLine | undefined, qty: number) => (r && r.qty > 0 ? (qty * r.dsus) / r.qty : 0);

// ---- Summary ------------------------------------------------------------------------------------------------

export interface TotRow {
  label: string;
  kind: "row" | "done" | "sub" | "pl" | "px" | "tot";
  q: number;
  u: Record<string, number>;
  cid: number;
  pal: number;
  sscl: number;
  dut: number;
  vat: number;
  duty: number;
  total: number;
  /** Estimated part (logbook lines) of the duty and of the VAT. */
  e: number;
  ev: number;
}

/**
 * Totals of quantity and value: imported, cancelled, outstanding, planned, pending confirmation, balance.
 * `group` is "grp|uom" or "" for all. With `estimate`, logbook lines get the estimated duty split.
 */
export function totals(lines: TiepLine[], group: string, estimate: boolean) {
  const L = lines.filter((r) => r.req !== "No" && (r.pending || r.qty > 0) && (!group || group === r.grp + "|" + r.uom));
  type Acc = Omit<TotRow, "label" | "kind" | "duty" | "total">;
  const Z = (): Acc => ({ q: 0, u: {}, cid: 0, pal: 0, sscl: 0, dut: 0, vat: 0, e: 0, ev: 0 });
  const B = ["qty", "cqty", "pqty", "xqty"] as const;
  const T = { qty: Z(), cqty: Z(), pqty: Z(), xqty: Z() };
  const TPL = lbTemplates(lines);
  let pend = 0;
  for (const r of L) {
    const ls = estimate && !r.pending ? lbSplit(r, TPL) : null;
    const full = r.pending ? null : (ls ?? liabSplit(r, r.qty));
    if (r.pending) pend++;
    for (const b of B) {
      const q = b === "qty" && r.pending ? 0 : r[b];
      if (!q) continue;
      const t = T[b];
      t.q += q;
      t.u[r.uom] = (t.u[r.uom] ?? 0) + q;
      if (!full) continue;
      const f = q / r.qty;
      if (ls) {
        t.e += (ls.cid + ls.pal + ls.sscl) * f;
        t.ev += ls.vat * f;
      }
      t.cid += full.cid * f;
      t.pal += full.pal * f;
      t.sscl += full.sscl * f;
      t.dut += full.dut * f;
      t.vat += full.vat * f;
    }
  }
  const comb = (sign: number[]): Acc => {
    const o = Z();
    B.forEach((b, i) => {
      const m = sign[i];
      if (!m) return;
      const t = T[b];
      o.q += m * t.q;
      for (const u in t.u) o.u[u] = (o.u[u] ?? 0) + m * t.u[u];
      o.cid += m * t.cid;
      o.pal += m * t.pal;
      o.sscl += m * t.sscl;
      o.dut += m * t.dut;
      o.vat += m * t.vat;
      o.e += m * t.e;
      o.ev += m * t.ev;
    });
    return o;
  };
  const mk = (label: string, kind: TotRow["kind"], a: Acc): TotRow => {
    const duty = a.cid + a.pal + a.sscl + a.dut;
    return { label, kind, ...a, duty, total: duty + a.vat };
  };
  const rows: TotRow[] = [
    mk("1. Total imported", "row", T.qty),
    mk("2. Cancelled (completed)", "done", T.cqty),
    mk("Outstanding, not yet cancelled (1 − 2)", "sub", comb([1, -1, 0, 0])),
    mk("3. Planned (MUD saved)", "pl", T.pqty),
    mk("4. Pending confirmation (FIFO proposals)", "px", T.xqty),
    mk("5. Balance not yet covered (1 − 2 − 3 − 4)", "tot", comb([1, -1, -1, -1])),
  ];
  return { rows, n: L.length, pend };
}

export interface GroupSummary {
  grp: string;
  uom: string;
  cat: string;
  n: number;
  pn: number;
  q: number;
  c: number;
  p: number;
  b: number;
  s: number;
  o: number;
  od: number;
}

/** TIEP lines (cancellation required) by material group and unit. */
export function byGroup(lines: TiepLine[]): GroupSummary[] {
  const g = new Map<string, GroupSummary>();
  for (const r of lines) {
    if (r.req === "No") continue;
    const grp = r.grp || NO_GROUP;
    const k = grp + "|" + r.uom;
    const x = g.get(k) ?? { grp, uom: r.uom, cat: r.cat, n: 0, pn: 0, q: 0, c: 0, p: 0, b: 0, s: 0, o: 0, od: 0 };
    x.n++;
    if (r.pending) x.pn++;
    x.q += r.qty;
    x.c += r.cqty;
    x.p += r.pqty;
    x.b += r.bal ?? 0;
    x.s += r.tsus;
    x.o += r.osv;
    if (r.overdue) x.od++;
    g.set(k, x);
  }
  const order = (grp: string) => {
    const i = (GROUPS as readonly string[]).indexOf(grp);
    return i < 0 ? 99 : i;
  };
  return [...g.values()].sort((a, b) => order(a.grp) - order(b.grp) || a.uom.localeCompare(b.uom));
}

export interface FySummary {
  fy: string;
  n: number;
  op: number;
  s: number;
  o: number;
  od: number;
}

/** TIEP lines by financial year. */
export function byFy(lines: TiepLine[]): FySummary[] {
  const f = new Map<string, FySummary>();
  for (const r of lines) {
    if (r.req === "No") continue;
    const k = r.fy || "No date";
    const x = f.get(k) ?? { fy: k, n: 0, op: 0, s: 0, o: 0, od: 0 };
    x.n++;
    if (r.pending || (r.left ?? 0) > 0) x.op++;
    x.s += r.tsus;
    x.o += r.osv;
    if (r.overdue) x.od++;
    f.set(k, x);
  }
  return [...f.values()].sort((a, b) => a.fy.localeCompare(b.fy));
}

// ---- Posting ------------------------------------------------------------------------------------------------

export interface Material {
  key: string;
  prod: string;
  uom: string;
  bal: number;
  n: number;
}

/** Products (with unit) that can be cancelled, and their free balance. */
export function materials(lines: TiepLine[]): Material[] {
  const m = new Map<string, Material>();
  for (const r of lines) {
    if (r.req === "No" || !r.grp) continue;
    const k = r.prod + "|" + r.uom;
    const x = m.get(k) ?? { key: k, prod: r.prod, uom: r.uom, bal: 0, n: 0 };
    if ((r.bal ?? 0) > 0) {
      x.bal += r.bal!;
      x.n++;
    }
    m.set(k, x);
  }
  return [...m.values()].sort((a, b) => PRODUCTS.indexOf(a.prod) - PRODUCTS.indexOf(b.prod) || a.uom.localeCompare(b.uom));
}

/** Lines of a product (key "prod|uom") still open for cancellation, oldest first. */
export function openLines(lines: TiepLine[], materialKey: string): TiepLine[] {
  if (!materialKey) return [];
  const [p, u] = materialKey.split("|");
  return lines.filter((r) => r.req === "Yes" && !r.pending && r.prod === p && r.uom === u && (r.bal ?? 0) > 0);
}

export interface Allocation {
  line: TiepLine;
  take: number;
}

/** Allocate `qty` FIFO (oldest open lines first) or to one line. `left` is what could not be allocated. */
export function allocate(open: TiepLine[], qty: number, mode: "fifo" | "line", lineK?: string) {
  const q = r4(qty);
  const alloc: Allocation[] = [];
  let left = q;
  if (mode === "line") {
    const r = open.find((x) => x.key === lineK);
    if (r) {
      const take = r4(Math.min(r.bal ?? 0, q));
      alloc.push({ line: r, take });
      left = r4(q - take);
    }
  } else {
    for (const r of open) {
      if (left <= 0) break;
      const take = r4(Math.min(r.bal ?? 0, left));
      if (take <= 0) continue;
      alloc.push({ line: r, take });
      left = r4(left - take);
    }
  }
  return { q, alloc, left };
}

// ---- Standards and item master ------------------------------------------------------------------------------

export const normP = (v: unknown) =>
  String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Standards in order of their start date. */
export const stdList = (all: Standard[]) =>
  [...all].sort((a, b) => (a.valid_from ?? "0000").localeCompare(b.valid_from ?? "0000"));

/** The standard whose valid period covers a date. */
export const stdFor = (all: Standard[], d: string | null | undefined) =>
  d ? (stdList(all).find((x) => (!x.valid_from || d >= x.valid_from) && (!x.valid_to || d <= x.valid_to)) ?? null) : null;

export const stdShort = (s: Standard) => s.short || s.name;

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Overlaps and gaps between the standards' valid periods. */
export function stdCheckGaps(all: Standard[]): string[] {
  const l = stdList(all);
  const msg: string[] = [];
  for (let i = 1; i < l.length; i++) {
    const a = l[i - 1];
    const b = l[i];
    if (a.valid_to && b.valid_from && a.valid_to >= b.valid_from) msg.push(`${stdShort(a)} and ${stdShort(b)} overlap`);
    else if (a.valid_to && b.valid_from) {
      const nx = addDays(a.valid_to, 1);
      if (nx < b.valid_from) {
        const pv = addDays(b.valid_from, -1);
        msg.push(`no standard covers ${fdate(nx)}${pv > nx ? " – " + fdate(pv) : ""}`);
      }
    } else if (!a.valid_to && b.valid_from) msg.push(`${stdShort(a)} has no end date but ${stdShort(b)} starts ${fdate(b.valid_from)}`);
  }
  return msg;
}

/** TIEP items: every sales product listed in any standard. */
export const allProducts = (all: Standard[]) => [...new Set(stdList(all).flatMap((x) => x.yields.map((y) => y.product)))];

/** The TIEP item a system item stands for under a standard (its per-standard alternative, else its TIEP item). */
export const skuTarget = (x: SkuItem | undefined, st: Standard | null) =>
  !x || !x.tiep ? "" : (st && x.alt?.[st.id]) || x.tiep;

/** Yield of a system item under a standard, or null when the standard does not list its TIEP item. */
export function skuYield(x: SkuItem | undefined, st: Standard | null): number | null {
  const t = skuTarget(x, st);
  if (!t || !st) return null;
  const y = st.yields.find((v) => normP(v.product) === normP(t));
  return y ? num(y.yield) : null;
}

/** Confirmation is per item no.: any description of an item no. confirmed confirms them all. */
export function skuIsConfirmed(x: SkuItem, all: SkuItem[]): boolean {
  if (!x.code) return x.confirmed;
  const c = normP(x.code);
  return all.some((y) => y.code && normP(y.code) === c && y.confirmed);
}

/** A system item that has no TIEP item but was never marked as having none. */
export const skuUnmapped = (x: SkuItem) => !x.tiep && x.status !== "none";

/** Ratio "1 : n kg fish" of a material used `perKg` per kg of fish. */
export function fRatio(perKg: number): string {
  if (!perKg) return "–";
  const x = 1 / perKg;
  return "1 : " + (x >= 100 ? x.toLocaleString("en-US", { maximumFractionDigits: 0 }) : x.toFixed(2));
}

/** Lines claimed on the MUD form: the standard's own, else defaults from its materials. */
export function stdMud(st: Standard | null): StdMud[] {
  if (st && Array.isArray(st.mud) && st.mud.length) return st.mud;
  const ms = st?.materials ?? [];
  const pk = (re: RegExp) => {
    const m = ms.find((x) => re.test(x.mat));
    return m ? num(m.perKg) * 1000 : 0;
  };
  const hat = ms.filter((m) => m.sub === "hatchery").reduce((a, m) => a + num(m.perKg), 0);
  return [
    { label: "Marine Fish Feeds", hs: "2309 9010", uom: "kg", basis: "fish", per1000: (num(st?.fcr) || 2) * 1000, grp: "Fish Feed", kind: "Marine Fish Feed", kw: "" },
    { label: "Hatchery Feed", hs: "2309 9010", uom: "kg", basis: "fish", per1000: Math.round(hat * 1000), grp: "Fish Feed", kind: "Hatchery Feed", kw: "" },
    { label: "Rotigrow", hs: "13021990", uom: "Ltr", basis: "fish", per1000: pk(/rotigrow/i), grp: "Microalgae", kind: "", kw: "" },
    { label: "Chloramx", hs: "29055900", uom: "kg", basis: "fish", per1000: pk(/chlor/i), grp: "Chemicals", kind: "", kw: "" },
    { label: "Artemia Enrichment", hs: "29379000", uom: "kg", basis: "fish", per1000: pk(/enrichment/i), grp: "Enrichment", kind: "", kw: "" },
    { label: "Cartons", hs: "48191000", uom: "Nos", basis: "boxes", per1000: 0, grp: "Packaging", kind: "", kw: "carton" },
  ];
}

/** Rows to CSV text (with a byte-order mark so Excel reads it as UTF-8). */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return (
    "﻿" +
    rows
      .map((r) =>
        r
          .map((v) => {
            const s = v == null ? "" : String(v);
            return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
          })
          .join(","),
      )
      .join("\n")
  );
}

export function downloadCsv(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
