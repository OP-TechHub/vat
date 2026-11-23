/**
 * TIEP invoices: raw-material consumption from the conversion standards, the MUD claims, FIFO candidates and
 * the FIFO proposals for invoices without a saved MUD. Ported from the TIEP app (calcInvLine, invBuild,
 * mudCompute, mudCands, fifoAlloc, computeProposals). Pure functions.
 */
import type { SalesInvoice, SalesLine } from "../sales";
import {
  allocLiab,
  normP,
  prodOf,
  stdFor,
  stdMud,
  skuTarget,
  type SkuItem,
  type Standard,
  type TiepLine,
} from "./model";

const num = (v: unknown) => {
  const x = Number(v);
  return isFinite(x) ? x : 0;
};

// ---- Rows as held -----------------------------------------------------------------------------------------

export interface DocRef {
  path: string;
  name: string;
  size?: number;
  at: string;
}

export interface InvoiceExt {
  sales_invoice_id: string;
  company_id: string;
  export_e: string | null;
  export_e_src: string | null;
  yov: Record<string, number> | null;
  pl: Record<string, string | number> | null;
  pl_rows: PlRow[] | null;
  docs: Partial<Record<"invoice" | "packing" | "cusdec" | "other", DocRef>>;
  group_id: string | null;
  rec_links: string[] | null;
  cancelled_via: string | null;
  legacy_id: string | null;
}

export interface PlRow {
  desc: string;
  boxes?: number;
  net?: number;
  gross?: number;
  bbd?: string;
  boxRange?: string;
  price?: number;
  amount?: number;
}

/** One import line drawn on by a claim: key = import line key (CusDec|invoice|item). */
export interface AllocRow {
  key: string;
  qty: number;
  liab?: number;
  liabSet?: boolean;
}

export interface SavedClaim extends Claim {
  alloc: AllocRow[];
}

export interface MudDoc {
  ref: string;
  office: string;
  product: string;
  hs: string;
  qty: number;
  whole: number;
  fcr: number;
  rows1: Row1[];
  claims: SavedClaim[];
  std: string;
  exportE: string;
  savedAt: string;
  savedBy: string;
}

export interface Mud {
  id: string;
  company_id: string;
  kind: "invoice" | "group";
  type: "Export" | "Local";
  sales_invoice_id: string | null;
  group_name: string | null;
  member_ids: string[];
  group_date: string | null;
  status: "draft" | "saved" | "cancelled";
  prop_alloc: { label: string; alloc: AllocRow[] }[] | null;
  prop_at: string | null;
  mud: MudDoc | null;
  mudx: { ref?: string; office?: string; product?: string; hs?: string } | null;
  writeoff: { date: string; total: number; lines: (AllocRow & { label: string })[]; recordedAt: string; by: string } | null;
  docs: Partial<Record<"mudSigned" | "writeoff", DocRef>>;
}

/** Header of the MUD form (Settings: tiep_settings.mud_config). */
export interface MudConfig {
  importer: string;
  tin: string;
  scheme: string;
  schemeNote: string;
  office: string;
  product: string;
  hs: string;
  refPrefix: string;
  company: string;
  address: string;
  declarant: string;
  cha: string;
}

export const MUD_DEFAULTS: MudConfig = {
  importer: "Oceanpick (Pvt) Limited",
  tin: "174829330 - 7000",
  scheme: "TIEP",
  schemeNote: "(IBG/ TIEP 1 / VAT Deferment)",
  office: "CBEX 1",
  product: "Barramundi Fish",
  hs: "03049900",
  refPrefix: "OPL/IMP/TIEP/",
  company: "OCEANPICK (PVT) LTD",
  address: "No: 532/4F, Sirikotha Lane, Colombo 03, Sri Lanka.",
  declarant: "",
  cha: "",
};

// ---- Consumption ------------------------------------------------------------------------------------------

/** System item by code, else by description. */
export function skuFind(skus: SkuItem[], code: string | null | undefined, desc: string | null | undefined): SkuItem | undefined {
  if (code) {
    const c = normP(code);
    const x = skus.find((s) => s.code && normP(s.code) === c);
    if (x) return x;
  }
  if (desc) {
    const d = normP(desc);
    return skus.find((s) => normP(s.item) === d) ?? (code ? undefined : skus.find((s) => s.code && normP(s.code) === d));
  }
  return undefined;
}

type Match = { product: string; hs: string; yield: number } | { excluded: true } | { missing: string } | null;

/** The standard's yield row for a sales line, through the item master, else the product map, else by name. */
export function matchProduct(desc: string, code: string, st: Standard, skus: SkuItem[], productMap: Record<string, string>): Match {
  const sk = skuFind(skus, code, desc);
  if (sk) {
    if (!sk.tiep) return { excluded: true };
    const t = skuTarget(sk, st);
    return st.yields.find((y) => normP(y.product) === normP(t)) ?? { missing: t };
  }
  const target = productMap[normP(desc)] ?? desc;
  return st.yields.find((y) => normP(y.product) === normP(target)) ?? null;
}

export type LineStatus = "OK" | "Excluded" | "No invoice date" | "No standard for this date" | "No quantity" | "Item not mapped" | string;

export interface CalcLine {
  n: number;
  inv: string;
  code: string;
  desc: string;
  qty: number;
  qtyIn: number;
  uomIn: string;
  boxes: number;
  gross: number;
  bbd: string;
  price: number;
  amount: number;
  date: string | null;
  sysItem: string;
  tiep: string;
  std: string;
  stdName: string;
  yield: number | null;
  yieldStd: number | null;
  yov: boolean;
  raw: number;
  mat: Record<string, number>;
  status: LineStatus;
}

export interface CalcInput {
  n: number;
  inv?: string;
  code: string;
  desc: string;
  qty: number;
  qtyIn?: number | null;
  uomIn?: string | null;
  boxes?: number | null;
  gross?: number | null;
  bbd?: string;
  price?: number | null;
  amount?: number | null;
  date: string | null;
}

/** Consumption of one sales line: whole fish = qty ÷ yield, each material = whole fish × its quantity per kg. */
export function calcLine(
  r: CalcInput,
  ctx: { standards: Standard[]; skus: SkuItem[]; productMap: Record<string, string>; yov?: Record<string, number> | null },
): CalcLine {
  const st = stdFor(ctx.standards, r.date);
  const mm = st ? matchProduct(r.desc || r.code, r.code, st, ctx.skus, ctx.productMap) : null;
  const y = mm && "product" in mm ? mm : null;
  const sk = skuFind(ctx.skus, r.code, r.desc);
  const o: CalcLine = {
    n: r.n,
    inv: r.inv ?? "",
    code: r.code,
    desc: r.desc,
    qty: num(r.qty),
    qtyIn: r.qtyIn != null ? num(r.qtyIn) : num(r.qty),
    uomIn: r.uomIn || "KG",
    boxes: num(r.boxes),
    gross: num(r.gross),
    bbd: r.bbd ?? "",
    price: num(r.price),
    amount: num(r.amount),
    date: r.date,
    sysItem: sk?.item ?? "",
    tiep: y ? y.product : mm && "missing" in mm ? mm.missing : "",
    std: st?.id ?? "",
    stdName: st ? st.short || st.name : "",
    yield: y ? num(y.yield) : null,
    yieldStd: null,
    yov: false,
    raw: 0,
    mat: {},
    status: "",
  };
  const ov = y && ctx.yov ? ctx.yov[y.product] : undefined;
  if (y && ov != null && num(ov) > 0 && Math.abs(num(ov) - num(o.yield)) > 1e-9) {
    o.yieldStd = o.yield;
    o.yield = num(ov);
    o.yov = true;
  }
  if (!r.date) o.status = "No invoice date";
  else if (!st) o.status = "No standard for this date";
  else if (!(o.qty > 0)) o.status = "No quantity";
  else if (mm && "excluded" in mm) o.status = "Excluded";
  else if (mm && "missing" in mm) o.status = `Not in ${st.short || st.name} standard`;
  else if (!y) o.status = "Item not mapped";
  else {
    o.raw = o.qty / num(o.yield);
    for (const m of st.materials) o.mat[m.mat] = o.raw * num(m.perKg);
    o.status = "OK";
  }
  return o;
}

export interface CalcInvoice {
  lines: CalcLine[];
  tot: { qty: number; raw: number; mat: Record<string, number>; boxes: number; gross: number };
  bad: number;
  exc: number;
  std: Standard | null;
}

export function calcInvoice(rows: CalcInput[], date: string | null, ctx: Parameters<typeof calcLine>[1]): CalcInvoice {
  const lines = rows.map((r) => calcLine(r, ctx));
  const tot = { qty: 0, raw: 0, mat: {} as Record<string, number>, boxes: 0, gross: 0 };
  for (const l of lines) {
    if (l.status !== "Excluded") tot.qty += l.qty;
    if (l.status === "OK") {
      tot.raw += l.raw;
      for (const m in l.mat) tot.mat[m] = (tot.mat[m] ?? 0) + l.mat[m];
    }
    tot.boxes += l.boxes;
    tot.gross += l.gross;
  }
  return {
    lines,
    tot,
    bad: lines.filter((l) => l.status !== "OK" && l.status !== "Excluded").length,
    exc: lines.filter((l) => l.status === "Excluded").length,
    std: stdFor(ctx.standards, date),
  };
}

/** Rows to calculate for a sales invoice: its lines (charge lines left out), with packing-list boxes / gross / best-before. */
export function invoiceRows(inv: SalesInvoice, lines: SalesLine[], ext: InvoiceExt | undefined): CalcInput[] {
  const pl = ext?.pl_rows ?? [];
  return lines
    .filter((l) => !(l as SalesLine & { is_charge?: boolean }).is_charge)
    .map((l, i) => {
      const p = pl.find((x) => normP(x.desc) === normP(l.description));
      return {
        n: i + 1,
        inv: inv.invoice_no,
        code: l.item_code ?? "",
        desc: l.description ?? "",
        qty: num(l.qty),
        qtyIn: l.qty_in,
        uomIn: l.uom_in,
        boxes: l.boxes ?? p?.boxes ?? null,
        gross: l.gross ?? p?.gross ?? null,
        bbd: p?.bbd ?? "",
        price: l.unit_price,
        amount: l.amount_fc,
        date: l.line_date ?? inv.invoice_date,
      };
    });
}

// ---- MUD claims ---------------------------------------------------------------------------------------------

export interface Row1 {
  desc: string;
  qty: number;
  yield: number;
  whole: number;
  ratio: number;
  rm: number;
}

export interface Claim {
  label: string;
  hs: string;
  uom: string;
  grp: string;
  kind: string;
  kw: string;
  basis: "fish" | "boxes";
  per1000: number;
  exact: number;
  req: number;
}

const roundQ = (x: number) => (x > 0 ? Math.max(1, Math.round(x)) : 0);

/** Table 1 (sales → whole fish → raw material) and the claims of the MUD form. */
export function mudCompute(calc: CalcInvoice, st: Standard | null, plBoxes = 0) {
  const fcr = num(st?.fcr) || 2;
  const ok = calc.lines.filter((l) => l.status === "OK");
  const g = new Map<string, Row1>();
  for (const l of ok) {
    const r = g.get(l.tiep) ?? { desc: l.tiep, qty: 0, yield: num(l.yield), whole: 0, ratio: fcr, rm: 0 };
    r.qty += l.qty;
    r.whole += l.raw;
    g.set(l.tiep, r);
  }
  const rows1 = [...g.values()].map((r) => ({ ...r, rm: r.whole * fcr }));
  const whole = rows1.reduce((a, r) => a + r.whole, 0);
  const boxes = calc.lines.reduce((a, l) => a + l.boxes, 0) || num(plBoxes);
  const claims: Claim[] = stdMud(st).map((c) => {
    const exact = c.basis === "boxes" ? boxes : (whole * num(c.per1000)) / 1000;
    return {
      label: c.label,
      hs: c.hs,
      uom: c.uom,
      grp: c.grp,
      kind: c.kind || "",
      kw: c.kw || "",
      basis: c.basis === "boxes" ? "boxes" : "fish",
      per1000: num(c.per1000),
      exact,
      req: c.basis === "boxes" ? Math.round(exact) : roundQ(exact),
    };
  });
  return { st, fcr, rows1, whole, qty: ok.reduce((a, l) => a + l.qty, 0), boxes, claims };
}
export type MudCalc = ReturnType<typeof mudCompute>;

const UOMN = (u: string | null | undefined) => {
  const x = String(u ?? "").trim().toLowerCase();
  return x === "kg" || x === "kgm" ? "KGM" : x === "l" || x === "ltr" || x === "litre" ? "LTR" : String(u ?? "").toUpperCase();
};

export interface Candidate {
  line: TiepLine;
  /** Free balance for this MUD: the line's balance plus what this MUD itself reserves. */
  avail: number;
  late: boolean;
}

/**
 * Import lines a claim can draw on: TIEP lines of the claim's group still requiring cancellation with duty
 * suspended (fish feed also of the same unit), matching its feed type and description keyword. `fifo` leaves
 * out lines imported after the invoice date and lines with nothing free.
 */
export function mudCands(c: Claim, lines: TiepLine[], own: Map<string, number>, invDate: string | null) {
  const cu = UOMN(c.uom);
  const uomOk = (r: TiepLine) => !(c.grp === "Fish Feed" && (cu === "KGM" || cu === "LTR")) || UOMN(r.uom) === cu;
  const all: Candidate[] = lines
    .filter((r) => r.req === "Yes" && !r.pending && r.dsus > 0 && r.grp === c.grp && uomOk(r))
    .map((r) => ({ line: r, avail: Math.max(0, num(r.bal)) + (own.get(r.key) ?? 0), late: !!(invDate && r.date && r.date > invDate) }));
  const match = (x: Candidate) => (!c.kind || prodOf(x.line.grp, x.line.ftype, x.line.desc) === c.kind) && (!c.kw || normP(x.line.desc).includes(normP(c.kw)));
  let fifo = all.filter((x) => !x.late && match(x) && x.avail > 0);
  if (!fifo.length && c.kind === "Hatchery Feed")
    fifo = all.filter((x) => !x.late && x.avail > 0 && !/MARINE/i.test(x.line.desc) && (!c.kw || normP(x.line.desc).includes(normP(c.kw))));
  const byDate = (a: Candidate, b: Candidate) => (a.line.dn || 0) - (b.line.dn || 0);
  return { all: all.sort(byDate), fifo: fifo.sort(byDate) };
}

/** FIFO allocation of a claim, on top of what earlier invoices already use (`used`, updated in place). */
export function fifoAlloc(c: Claim, lines: TiepLine[], own: Map<string, number>, invDate: string | null, used: Map<string, number>): AllocRow[] {
  let left = c.req;
  const out: AllocRow[] = [];
  for (const x of mudCands(c, lines, own, invDate).fifo) {
    if (left <= 0) break;
    const t = Math.min(left, x.avail - (used.get(x.line.key) ?? 0));
    if (t > 0) {
      used.set(x.line.key, (used.get(x.line.key) ?? 0) + t);
      out.push({ key: x.line.key, qty: +t.toFixed(4) });
      left -= t;
    }
  }
  return out;
}

/** Liability of an allocation row: typed, else quantity × duty suspended per unit of its import line. */
export function liabOf(a: AllocRow, lineOf: Map<string, TiepLine>): number {
  return a.liabSet ? num(a.liab) : allocLiab(lineOf.get(a.key), num(a.qty));
}

/** Import lines a MUD itself has reserved (Planned), so they count as free for that MUD. */
export function ownPlanned(cancels: { mud_id?: string | null; status: string; cusdec_no: string; invoice_no: string; item_no: number; qty: number }[], mudId: string | null) {
  const m = new Map<string, number>();
  if (!mudId) return m;
  for (const c of cancels)
    if (c.mud_id === mudId && c.status === "Planned") {
      const k = `${c.cusdec_no}|${c.invoice_no ?? ""}|${c.item_no ?? 1}`;
      m.set(k, (m.get(k) ?? 0) + num(c.qty));
    }
  return m;
}

// ---- Proposals ----------------------------------------------------------------------------------------------

/** An invoice or group waiting for its MUD, in the FIFO queue. */
export interface Subject {
  id: string;
  /** The MUD row, when one exists (it holds a kept allocation). */
  mudId: string | null;
  label: string;
  date: string | null;
  calc: CalcInvoice;
  plBoxes: number;
  propAlloc: { label: string; alloc: AllocRow[] }[] | null;
}

export interface Proposal {
  subjectId: string;
  label: string;
  key: string;
  qty: number;
  duty: number;
}

/**
 * FIFO proposals for every invoice without a saved MUD, oldest first: each takes the oldest free import lines
 * after the invoices before it; a kept allocation is used as it is. Returns the proposals, the quantity
 * proposed per import line (Pending confirmation), what each subject found used before it, and shortfalls.
 */
export function computeProposals(subjects: Subject[], standards: Standard[], lines: TiepLine[]) {
  const sorted = [...subjects].sort((a, b) => (a.date ?? "9").localeCompare(b.date ?? "9") || a.label.localeCompare(b.label));
  const used = new Map<string, number>();
  const lineOf = new Map(lines.map((r) => [r.key, r]));
  const props: Proposal[] = [];
  const usedBefore = new Map<string, Map<string, number>>();
  const short = new Map<string, { label: string; uom: string; short: number }[]>();
  for (const s of sorted) {
    if (!s.calc.lines.some((l) => l.status === "OK")) continue;
    const M = mudCompute(s.calc, stdFor(standards, s.date), s.plBoxes);
    usedBefore.set(s.id, new Map(used));
    for (const c of M.claims) {
      const kept = s.propAlloc?.find((x) => x.label === c.label);
      let al: AllocRow[];
      if (kept) {
        al = kept.alloc.filter((a) => a.key && num(a.qty) > 0 && lineOf.has(a.key));
        for (const a of al) used.set(a.key, (used.get(a.key) ?? 0) + num(a.qty));
      } else al = fifoAlloc(c, lines, new Map(), s.date, used);
      const got = al.reduce((x, a) => x + num(a.qty), 0);
      if (c.req - got > 1e-6) short.set(s.id, [...(short.get(s.id) ?? []), { label: c.label, uom: c.uom, short: +(c.req - got).toFixed(3) }]);
      for (const a of al) props.push({ subjectId: s.id, label: c.label, key: a.key, qty: num(a.qty), duty: +liabOf(a, lineOf).toFixed(2) });
    }
  }
  const xqty = new Map<string, number>();
  for (const p of props) xqty.set(p.key, (xqty.get(p.key) ?? 0) + p.qty);
  return { props, xqty, usedBefore, short };
}

/** Ref no. of a MUD: the printed override, else the saved one, else the prefix plus the invoice number. */
export function mudRef(cfg: MudConfig, invNo: string, m?: Pick<Mud, "mudx" | "mud"> | null) {
  return m?.mudx?.ref || m?.mud?.ref || cfg.refPrefix + String(invNo).replace(/\/?EXP.*$/i, "").trim();
}

// ---- Invoice views ------------------------------------------------------------------------------------------

export type InvStatus = "calculated" | "mud" | "cancelled" | "void";

export interface TiepInvoice {
  inv: SalesInvoice;
  lines: SalesLine[];
  ext: InvoiceExt | undefined;
  /** The invoice's own MUD row, if any. */
  mud: Mud | undefined;
  /** The group MUD it belongs to, if any. */
  group: Mud | undefined;
  calc: CalcInvoice;
  status: InvStatus;
  exportE: string;
}

export interface TiepGroup {
  mud: Mud;
  members: TiepInvoice[];
  date: string | null;
  calc: CalcInvoice;
  status: InvStatus;
}

const statusOf = (m: Mud | undefined, inv?: SalesInvoice, ext?: InvoiceExt): InvStatus =>
  inv?.void_ref ? "void" : m?.status === "cancelled" || ext?.cancelled_via ? "cancelled" : m?.status === "saved" ? "mud" : "calculated";

/** Every sales invoice with its TIEP fields, MUD and consumption, and the MUD groups. */
export function buildInvoiceViews(
  d: { salesInvoices: SalesInvoice[]; salesLines: SalesLine[]; invExts: InvoiceExt[]; muds: Mud[] },
  ctx: { standards: Standard[]; skus: SkuItem[]; productMap: Record<string, string> },
) {
  const linesOf = new Map<string, SalesLine[]>();
  for (const l of d.salesLines) linesOf.set(l.invoice_id, [...(linesOf.get(l.invoice_id) ?? []), l]);
  for (const ls of linesOf.values()) ls.sort((a, b) => a.line_no - b.line_no);
  const extOf = new Map(d.invExts.map((x) => [x.sales_invoice_id, x]));
  const mudOf = new Map(d.muds.filter((m) => m.kind === "invoice").map((m) => [m.sales_invoice_id!, m]));
  const groupOf = new Map(d.muds.filter((m) => m.kind === "group").map((m) => [m.id, m]));

  const invoices: TiepInvoice[] = d.salesInvoices.map((inv) => {
    const ext = extOf.get(inv.id);
    const lines = linesOf.get(inv.id) ?? [];
    const mud = mudOf.get(inv.id);
    const group = ext?.group_id ? groupOf.get(ext.group_id) : undefined;
    const calc = calcInvoice(invoiceRows(inv, lines, ext), inv.invoice_date, { ...ctx, yov: ext?.yov });
    return { inv, lines, ext, mud, group, calc, status: statusOf(group ?? mud, inv, ext), exportE: ext?.export_e || inv.export_cusdec || "" };
  });
  const byId = new Map(invoices.map((v) => [v.inv.id, v]));

  const groups: TiepGroup[] = d.muds
    .filter((m) => m.kind === "group")
    .map((m) => {
      const members = m.member_ids.map((id) => byId.get(id)).filter((v): v is TiepInvoice => !!v);
      const date = m.group_date ?? (members.map((v) => v.inv.invoice_date).filter(Boolean).sort().pop() as string | undefined) ?? null;
      let n = 0;
      const rows = members.flatMap((v) => invoiceRows(v.inv, v.lines, v.ext).map((r) => ({ ...r, n: ++n })));
      return { mud: m, members, date, calc: calcInvoice(rows, date, ctx), status: statusOf(m) };
    });
  return { invoices, groups };
}

/** Invoices and groups in the FIFO queue: export invoices (not grouped) and groups without a saved MUD. */
export function queueSubjects(invoices: TiepInvoice[], groups: TiepGroup[]): Subject[] {
  const out: Subject[] = [];
  for (const v of invoices) {
    if (v.inv.type !== "Export" || v.group || v.status !== "calculated" || v.ext?.rec_links?.length) continue;
    out.push({
      id: v.inv.id,
      mudId: v.mud?.id ?? null,
      label: v.inv.invoice_no,
      date: v.inv.invoice_date,
      calc: v.calc,
      plBoxes: Number(v.ext?.pl?.totBoxes ?? 0),
      propAlloc: v.mud?.prop_alloc ?? null,
    });
  }
  for (const g of groups) {
    if (g.status !== "calculated") continue;
    out.push({ id: g.mud.id, mudId: g.mud.id, label: g.mud.group_name ?? "", date: g.date, calc: g.calc, plBoxes: 0, propAlloc: g.mud.prop_alloc });
  }
  return out;
}
