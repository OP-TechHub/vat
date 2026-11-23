/**
 * One-time move of the TIEP Import Register app's data into this app (phase 5).
 *
 *   SUPABASE_SERVICE_ROLE_KEY=… npx -y tsx scripts/migrate-tiep.ts --company <company uuid>            (dry run)
 *   SUPABASE_SERVICE_ROLE_KEY=… npx -y tsx scripts/migrate-tiep.ts --company <company uuid> --apply    (write)
 *
 * Reads the export in migration/tiep-export (collections of the TIEP app's database, the embedded logbook in
 * lbdata.json and the stored files in assets/). NEXT_PUBLIC_SUPABASE_URL comes from the environment or
 * .env.local. The service-role key is only read from the environment, never from a file.
 *
 * What it does:
 *  - Import lines: matched to the Import Register (customs_entries, import) on CusDec no. + invoice no. + item
 *    no., else on CusDec no. (spaces ignored) + item no. + year when that is unique; unmatched lines are added
 *    to the Import Register. Blank customs fields of a matched entry are filled from TIEP (--no-fill to skip).
 *    TIEP fields go to tiep_import_ext. Two lines with the same key get the next free item no.
 *  - Standards, item master (per-standard alternatives re-keyed), batches, postings (local-sales plans), the
 *    logbook's cancellation history as Completed "LOGBOOK" postings (skipped where a posting of the same import
 *    line and export entry exists, as the TIEP app did), MUD lines on file, documents and their files, the
 *    logbook summary, findings and totals, settings (bank guarantee).
 *  - Invoices: matched to the Export Register by invoice no.; missing ones are added from the TIEP lines (they are
 *    not added to VAT Export reconciliation: upload the Business Central export list in Registers first so they
 *    are matched instead); credit-memo voids are marked; E no., yield overrides, packing-list details, MUD
 *    details and documents go to TIEP.
 *  - Every row keeps its TIEP id in legacy_id, so running it again skips what is already there.
 *  - Reconciliation: line count, quantities and outstanding LKR per material group, computed with the app's own
 *    TIEP logic from the export and from the database (after --apply) or the planned result (dry run).
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildLines, byGroup, lineKey, type Cancellation, type ImportExt } from "../lib/tiep/model";
import type { CustomsEntry } from "../lib/types";

// ---- Arguments and connection ---------------------------------------------------------------------------------

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const APPLY = args.includes("--apply");
const FILL = !args.includes("--no-fill");
const COMPANY = arg("--company");
const DIR = resolve(arg("--dir") ?? "migration/tiep-export");
if (!COMPANY) fail("Pass --company <company uuid> (Supabase: vat_claims.companies.id).");
if (!existsSync(DIR)) fail(`No export at ${DIR}.`);

function envFromFile(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  const f = resolve(".env.local");
  if (!existsSync(f)) return undefined;
  const m = readFileSync(f, "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  return m?.[1].trim().replace(/^["']|["']$/g, "");
}
const URL = envFromFile("NEXT_PUBLIC_SUPABASE_URL");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL) fail("NEXT_PUBLIC_SUPABASE_URL is not set (environment or .env.local).");
if (!KEY) fail("Set SUPABASE_SERVICE_ROLE_KEY in the environment for this run (Supabase → Project Settings → API).");
const sb = createClient(URL!, KEY!, { db: { schema: "vat_claims" }, auth: { persistSession: false } });

function fail(msg: string): never {
  console.error("✗ " + msg);
  process.exit(1);
}
const log = (s = "") => console.log(s);

// ---- Export --------------------------------------------------------------------------------------------------

type Doc = Record<string, any> & { _id: string };
const col = (name: string): Doc[] => {
  const d = join(DIR, name);
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ _id: f.replace(/\.json$/, ""), ...JSON.parse(readFileSync(join(d, f), "utf8")) }));
};
const X = {
  imports: col("imports"),
  cancellations: col("cancellations"),
  batches: col("batches"),
  standards: col("standards"),
  skumap: col("skumap"),
  invoices: col("invoices"),
  documents: col("documents"),
  mudhist: col("mudhist"),
  config: col("config"),
};
const LB = existsSync(join(DIR, "lbdata.json"))
  ? (JSON.parse(readFileSync(join(DIR, "lbdata.json"), "utf8")) as {
      hist: Record<string, [string, string, number, number, number][]>;
      summary: { cd: string | number; date: string; reg: string; qty: number; used: number; bal: number; liab: number; balLiab: number; ids: string[]; note: string }[];
      findings: { area: string; items: string[] }[];
      totals: Record<string, number>;
      source?: string;
      loadedAt?: string;
    })
  : null;
const asset = (id: string | undefined) => {
  if (!id) return null;
  const d = join(DIR, "assets");
  const f = existsSync(d) ? readdirSync(d).find((x) => x.startsWith(id)) : undefined;
  return f ? join(d, f) : null;
};

// ---- Helpers ---------------------------------------------------------------------------------------------------

const num = (v: unknown) => (v == null || v === "" || !isFinite(Number(v)) ? null : Number(v));
const txt = (v: unknown) => (v == null || String(v).trim() === "" ? null : String(v).trim());
const iso = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const normCd = (s: string) => s.replace(/\s+/g, "").toUpperCase();
const normNo = (s: string) => String(s ?? "").replace(/\s+/g, "").toUpperCase();
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const yearOf = (e: { cusdec_date: string | null }) => {
  const d = e.cusdec_date ?? "";
  return d.match(/^(\d{4})-/)?.[1] ?? d.match(/(\d{4})$/)?.[1] ?? d.match(/^\d{1,2}[./-]\d{1,2}[./-](\d{4})/)?.[1] ?? "";
};

async function all<T>(table: string, filter: (q: any) => any, order = "id"): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(sb.from(table).select("*")).order(order).range(from, from + 999);
    if (error) fail(`${table}: ${error.message}`);
    out.push(...(data as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function insert(table: string, rows: Record<string, unknown>[], returning = "id,legacy_id"): Promise<Record<string, any>[]> {
  if (!rows.length) return [];
  if (!APPLY) return rows.map((r, i) => ({ id: `dry-${table}-${i}`, ...r }));
  const out: Record<string, any>[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await sb.from(table).insert(rows.slice(i, i + 500)).select(returning);
    if (error) fail(`${table} insert: ${error.message}`);
    out.push(...(data as Record<string, any>[]));
  }
  return out;
}

async function upload(path: string, file: string) {
  if (!APPLY) return;
  const { error } = await sb.storage.from("vat-claims").upload(path, readFileSync(file), { contentType: "application/pdf", upsert: true });
  if (error) fail(`upload ${path}: ${error.message}`);
}

const legacy = async (table: string) =>
  new Map((await all<{ id: string; legacy_id: string | null }>(table, (q) => q.eq("company_id", COMPANY).not("legacy_id", "is", null))).map((r) => [r.legacy_id!, r.id]));

// ---- Run -------------------------------------------------------------------------------------------------------

async function main() {
  log(`TIEP data move ${APPLY ? "(APPLY: writing)" : "(dry run: nothing is written)"}`);
  log(`Export: ${DIR}`);
  const { data: co, error: coErr } = await sb.from("companies").select("id,name").eq("id", COMPANY).maybeSingle();
  if (coErr || !co) fail(`Company ${COMPANY} not found${coErr ? ": " + coErr.message : ""}.`);
  log(`Company: ${co.name}`);
  const { data: mods } = await sb.from("company_modules").select("module").eq("company_id", COMPANY);
  if (!(mods ?? []).some((m: { module: string }) => m.module === "tiep")) log("! TIEP is not switched on for this company yet (Members › Modules).");
  log(
    `Export holds: ${X.imports.length} import lines, ${X.cancellations.length} postings, ${X.batches.length} batches, ${X.standards.length} standards, ` +
      `${X.skumap.length} item master rows, ${X.invoices.length} invoices, ${X.documents.length} documents, ${X.mudhist.length} MUD lines, ` +
      `${LB ? Object.values(LB.hist).reduce((a, r) => a + r.length, 0) : 0} logbook history rows, ${LB?.summary.length ?? 0} logbook summary rows.`,
  );
  const warn: string[] = [];

  // ---- 1. Import lines -----------------------------------------------------------------------------------------
  const entries = await all<CustomsEntry>("customs_entries", (q) => q.eq("company_id", COMPANY).eq("direction", "import"));
  const exact = new Map(entries.map((e) => [lineKey(e.cusdec_no, e.invoice_no, e.item_no), e]));
  const loose = new Map<string, CustomsEntry[]>();
  for (const e of entries) {
    const k = `${normCd(e.cusdec_no)}|${e.item_no}|${yearOf(e)}`;
    loose.set(k, [...(loose.get(k) ?? []), e]);
  }
  const extDone = await legacy("tiep_import_ext");
  const keyOf = new Map<string, { cusdec_no: string; invoice_no: string; item_no: number }>(); // IMP id → line key
  const used = new Set<string>();
  const newEntries: Record<string, unknown>[] = [];
  const fills: { id: string; patch: Record<string, unknown> }[] = [];
  const exts: Record<string, unknown>[] = [];
  const diffs: string[] = [];
  let matchedExact = 0;
  let matchedLoose = 0;

  for (const i of [...X.imports].sort((a, b) => a._id.localeCompare(b._id))) {
    const cd = String(i.cusdec ?? "").trim();
    const inv = String(i.inv ?? "").trim();
    let item = Number(i.item) || 1;
    // Two TIEP lines on the same key (logbook lines without item numbers): give the next free item no.
    while (used.has(lineKey(cd, inv, item)) && !exact.has(lineKey(cd, inv, item))) item++;
    if (item !== (Number(i.item) || 1)) warn.push(`${i._id} (${cd} ${i.desc}) shares its CusDec / item with another line: moved as item ${item}.`);
    let e = exact.get(lineKey(cd, inv, item));
    if (e) matchedExact++;
    else {
      const cands = (loose.get(`${normCd(cd)}|${item}|${String(i.date ?? "").slice(0, 4)}`) ?? []).filter((x) => !used.has(lineKey(x.cusdec_no, x.invoice_no, x.item_no)));
      if (cands.length === 1) {
        e = cands[0];
        matchedLoose++;
      }
    }
    const key = e ? { cusdec_no: e.cusdec_no, invoice_no: e.invoice_no, item_no: e.item_no } : { cusdec_no: cd, invoice_no: inv, item_no: item };
    used.add(lineKey(key.cusdec_no, key.invoice_no, key.item_no));
    keyOf.set(i._id, key);
    const tiepCustoms = {
      cusdec_date: iso(i.date),
      cusdec_month: txt(i.month),
      hs_code: txt(i.hs),
      description: txt(i.desc),
      party: txt(i.sup),
      uom: txt(i.uom),
      quantity: i.pending ? null : num(i.qty),
      currency_type: txt(i.cur),
      ex_rate: num(i.rate) || null,
      invoice_value: num(i.invfc) || null,
      customs_value: num(i.cval) || null,
      cid_amount: num(i.cid),
      cid_code: txt(i.cidc),
      pal_amount: num(i.pal),
      pal_code: txt(i.palc),
      sscl_amount: num(i.sscl),
      sscl_code: txt(i.ssclc),
      vat_base: num(i.vatv) || null,
      vat_amount: num(i.vat),
      vat_code: txt(i.vatc),
      vat_type: txt(i.vatt),
      file_name: txt(i.file),
    };
    if (e) {
      if (num(e.quantity) != null && num(i.qty) != null && Math.abs(Number(e.quantity) - Number(i.qty)) > 0.001)
        diffs.push(`${i._id} ${cd} item ${item}: quantity ${i.qty} in TIEP, ${e.quantity} in the Import Register (Import Register kept).`);
      if (FILL) {
        const patch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(tiepCustoms)) {
          const cur = (e as unknown as Record<string, unknown>)[k];
          if ((cur == null || cur === "") && v != null && v !== "") patch[k] = v;
        }
        if (Object.keys(patch).length) fills.push({ id: e.id, patch });
      }
    } else newEntries.push({ company_id: COMPANY, direction: "import", ...key, ...tiepCustoms });
    if (!extDone.has(i._id))
      exts.push({
        company_id: COMPANY,
        ...key,
        grp: txt(i.grp),
        ftype: i.grp === "Fish Feed" ? txt(i.ftype) : null,
        req: ["Yes", "Confirm", "No"].includes(i.req) ? i.req : "Yes",
        pending: !!i.pending,
        duty_total: num(i.dutyTotal),
        remarks: txt(i.rem),
        legacy_id: i._id,
      });
  }
  log(`\n1. Import lines: ${matchedExact} matched exactly, ${matchedLoose} matched on CusDec + item + year, ${newEntries.length} added to the Import Register; ` +
    `${fills.length} matched entries get blank fields filled; ${exts.length} TIEP field rows (${X.imports.length - exts.length} already moved).`);
  for (const d of diffs.slice(0, 20)) log("   ! " + d);
  if (diffs.length > 20) log(`   ! … ${diffs.length - 20} more quantity differences`);
  await insert("customs_entries", newEntries, "id");
  if (APPLY) for (const f of fills) {
    const { error } = await sb.from("customs_entries").update(f.patch).eq("id", f.id);
    if (error) fail(`customs_entries update: ${error.message}`);
  }
  await insert("tiep_import_ext", exts);

  // ---- 2. Standards and item master ------------------------------------------------------------------------------
  const stdDone = await legacy("tiep_standards");
  const stdRows = X.standards.filter((s) => !stdDone.has(s._id)).map((s) => ({
    company_id: COMPANY,
    name: s.name,
    short: txt(s.short),
    valid_from: iso(s.from),
    valid_to: iso(s.to),
    edible_kg: num(s.edibleKg) ?? 2124000,
    fcr: num(s.fcr) ?? 2,
    notes: txt(s.notes),
    source: txt(s.source),
    yields: s.yields ?? [],
    materials: s.materials ?? [],
    mud: s.mud ?? [],
    legacy_id: s._id,
  }));
  for (const r of await insert("tiep_standards", stdRows)) stdDone.set(r.legacy_id, r.id);
  const skuDone = await legacy("tiep_skumap");
  const skuRows = X.skumap.filter((x) => !skuDone.has(x._id)).map((x) => ({
    company_id: COMPANY,
    code: txt(x.code),
    item: x.item,
    tiep: txt(x.tiep),
    alt: Object.fromEntries(Object.entries(x.alt ?? {}).filter(([k]) => stdDone.has(k)).map(([k, v]) => [stdDone.get(k), v])),
    status: ["confident", "review", "none"].includes(x.status) ? x.status : x.tiep ? "confident" : "none",
    notes: txt(x.notes),
    src: txt(x.src),
    confirmed: x.confirmed === true,
    confirmed_at: iso(x.confirmedAt) ? x.confirmedAt : null,
    legacy_id: x._id,
  }));
  await insert("tiep_skumap", skuRows);
  log(`2. Standards: ${stdRows.length} added. Item master: ${skuRows.length} added (${X.skumap.length - skuRows.length} already moved).`);

  // ---- 3. Batches and postings -----------------------------------------------------------------------------------
  const batchDone = await legacy("tiep_batches");
  const batchRows = X.batches.filter((b) => !batchDone.has(b._id)).map((b) => ({
    company_id: COMPANY,
    name: b.name,
    ref: b.ref || b._id,
    start_date: iso(b.start),
    end_date: iso(b.end),
    sold_qty: num(b.soldQty),
    duty_amount: num(b.dutyAmount),
    status: b.status === "Duty paid" ? "Duty paid" : "Pending duty payment",
    cancel_cusdec: txt(b.cancelCusdec),
    cancel_date: iso(b.cancelDate),
    notes: txt(b.notes),
    duty_paid_lines: b.dutyPaidLines ?? [],
    legacy_id: b._id,
  }));
  for (const r of await insert("tiep_batches", batchRows)) batchDone.set(r.legacy_id, r.id);
  const batchByName = new Map(X.batches.map((b) => [b.name, batchDone.get(b._id)]));
  const batchByRef = new Map(X.batches.map((b) => [b.ref, batchDone.get(b._id)]));

  const canDone = await legacy("tiep_cancellations");
  const canRows: Record<string, unknown>[] = [];
  for (const c of X.cancellations) {
    if (canDone.has(c._id)) continue;
    const k = keyOf.get(c.importId);
    if (!k) {
      warn.push(`Posting ${c._id} refers to ${c.importId}, which is not in the export: skipped.`);
      continue;
    }
    if (!(Number(c.qty) > 0)) {
      warn.push(`Posting ${c._id} has no quantity: skipped.`);
      continue;
    }
    canRows.push({
      company_id: COMPANY,
      ref: c.ref,
      seq: Number(String(c._id).match(/-(\d+)$/)?.[1]) || canRows.length + 1,
      type: c.type === "local" ? "local" : "export",
      status: c.status === "Planned" ? "Planned" : "Completed",
      posting_date: iso(c.date),
      exp_inv: txt(c.expInv),
      exp_cusdec: txt(c.expCusdec),
      product: txt(c.product),
      exp_qty: num(c.expQty),
      ratio: num(c.ratio),
      ratio_text: txt(c.ratioText),
      remarks: txt(c.remarks),
      mode: txt(c.mode),
      ...k,
      grp: txt(c.grp),
      uom: txt(c.uom),
      qty: Number(c.qty),
      item: txt(c.item),
      batch_id: batchByName.get(c.batch) ?? batchByRef.get(c.ref) ?? null,
      cancel_cusdec: txt(c.cancelCusdec),
      cancel_date: iso(c.cancelDate),
      hs: txt(c.hs),
      duty: num(c.duty),
      value_usd: num(c.valueUSD),
      source: c.mode === "plan" || /xlsx$/i.test(String(c.source ?? "")) ? "plan" : c.source === "invoice" ? "mud" : "manual",
      legacy_id: c._id,
      posted_at: iso(c.postedAt) ? c.postedAt : new Date().toISOString(),
    });
  }
  // The logbook's cancellation history, unless a posting of the same line and export entry exists (as in the TIEP app).
  const have = new Set(X.cancellations.filter((c) => c.expCusdec).map((c) => c.importId + "|" + digits(c.expCusdec)));
  let lbSeq = 0;
  let lbSkipped = 0;
  /** Every logbook history row the TIEP app counted, for the reconciliation (moved or not). */
  const lbAll: { cusdec_no: string; invoice_no: string; item_no: number; qty: number }[] = [];
  for (const [iid, rows] of Object.entries(LB?.hist ?? {})) {
    const k = keyOf.get(iid);
    if (!k) {
      warn.push(`Logbook history for ${iid}: not in the export, skipped.`);
      continue;
    }
    rows.forEach((x, idx) => {
      const id = `LB-${iid}-${idx}`;
      lbSeq++;
      if (have.has(iid + "|" + digits(x[1]))) return;
      if (!(Number(x[2]) > 0)) {
        lbSkipped++;
        return;
      }
      lbAll.push({ ...k, qty: Number(x[2]) });
      if (canDone.has(id)) return;
      canRows.push({
        company_id: COMPANY,
        ref: "LOGBOOK",
        seq: lbSeq,
        type: x[4] ? "local" : "export",
        status: "Completed",
        exp_inv: txt(x[0]),
        exp_cusdec: x[1] ? `E ${x[1]}` : null,
        product: "Export per logbook",
        ...k,
        qty: Number(x[2]),
        item: "Export per logbook",
        duty: num(x[3]),
        remarks: "From TIEP logbook",
        source: "logbook",
        legacy_id: id,
      });
    });
  }
  await insert("tiep_cancellations", canRows);
  log(`3. Batches: ${batchRows.length} added. Postings: ${canRows.filter((r) => r.source !== "logbook").length} added, ` +
    `${canRows.filter((r) => r.source === "logbook").length} logbook history rows added${lbSkipped ? ` (${lbSkipped} without quantity skipped)` : ""}.`);

  // ---- 4. Invoices ---------------------------------------------------------------------------------------------
  const sales = await all<{ id: string; invoice_no: string; void_ref: string | null; legacy_id?: string }>("sales_invoices", (q) => q.eq("company_id", COMPANY).eq("type", "Export"));
  const salesByNo = new Map(sales.map((s) => [normNo(s.invoice_no), s]));
  const extInvDone = new Set(
    (await all<{ sales_invoice_id: string; legacy_id: string | null }>("tiep_invoice_ext", (q) => q.eq("company_id", COMPANY).not("legacy_id", "is", null), "sales_invoice_id")).map((r) => r.legacy_id),
  );
  let invMatched = 0;
  let invAdded = 0;
  let voids = 0;
  const invExtRows: Record<string, unknown>[] = [];
  for (const v of X.invoices) {
    if (extInvDone.has(v._id)) continue;
    let s = salesByNo.get(normNo(v.invNo));
    if (s) invMatched++;
    else {
      // Not in the Export Register: add it from the TIEP lines (charge-free; not synced to VAT).
      const [h] = await insert("sales_invoices", [
        {
          company_id: COMPANY,
          type: v.type === "Local" ? "Local" : "Export",
          invoice_no: v.invNo,
          invoice_date: iso(v.date),
          customer: txt(v.pl?.consignee),
          ex_rate: num(v.pl?.rate),
          order_no: txt(v.pl?.orderNo),
          source: txt(v.source) ?? "TIEP app",
          file_name: "TIEP app",
          void_ref: txt(v.voidRef),
        },
      ], "id,invoice_no,void_ref");
      const lines = (v.lines ?? []).map((l: any, i: number) => ({
        invoice_id: h.id,
        company_id: COMPANY,
        type: v.type === "Local" ? "Local" : "Export",
        line_no: i + 1,
        line_date: iso(l.date) ?? iso(v.date),
        item_code: txt(l.code),
        description: txt(l.desc),
        qty: num(l.qty),
        uom: "KG",
        qty_in: num(l.qtyIn),
        uom_in: txt(l.uomIn),
        boxes: num(l.boxes) || null,
        gross: num(l.gross) || null,
        unit_price: num(l.price),
        amount_fc: num(l.amount) ?? 0,
        amount_lkr: num(l.amountLKR) ?? 0,
        is_charge: /^SE\d/i.test(String(l.code ?? "")) || /freight|insurance|charge/i.test(String(l.desc ?? "")),
      }));
      await insert("sales_invoice_lines", lines, "id");
      if (APPLY) {
        const fc = lines.reduce((a: number, l: any) => a + (l.amount_fc || 0), 0);
        const fob = lines.filter((l: any) => !l.is_charge).reduce((a: number, l: any) => a + (l.amount_fc || 0), 0);
        await sb.from("sales_invoices").update({ amount_fc: fc, fob_fc: fob, amount_lkr: num(v.pl?.amountLKR) ?? 0, fob_lkr: num(v.pl?.amountLKR) ?? 0, line_count: lines.length }).eq("id", h.id);
      }
      s = { id: h.id, invoice_no: v.invNo, void_ref: txt(v.voidRef) };
      invAdded++;
    }
    if (v.voidRef && !s.void_ref) {
      voids++;
      if (APPLY) await sb.from("sales_invoices").update({ void_ref: v.voidRef }).eq("id", s.id);
    }
    const docs: Record<string, unknown> = {};
    for (const [k, d] of Object.entries(v.docs ?? {}) as [string, any][]) {
      const f = asset(d?.id);
      if (!f) {
        warn.push(`${v.invNo}: ${k} file ${d?.name} is not in assets/, left out.`);
        continue;
      }
      const path = `${COMPANY}/tiep/invoices/${s.id}/${k}-tiep-${String(d.name).replace(/[^\w.\- ]+/g, "_")}`;
      await upload(path, f);
      docs[k] = { path, name: d.name, size: d.size, at: d.at };
    }
    const plRows = (v.lines ?? [])
      .filter((l: any) => num(l.boxes) || num(l.gross) || txt(l.bbd))
      .map((l: any) => ({ desc: l.desc, boxes: num(l.boxes) ?? 0, net: num(l.qty) ?? 0, gross: num(l.gross) ?? 0, bbd: l.bbd ?? "", price: num(l.price) ?? 0, amount: num(l.amount) ?? 0 }));
    invExtRows.push({
      sales_invoice_id: s.id,
      company_id: COMPANY,
      export_e: txt(v.cusdec),
      export_e_src: txt(v.cusdecSrc) ?? (v.cusdec ? "TIEP app" : null),
      yov: v.yov && Object.keys(v.yov).length ? v.yov : null,
      pl: v.pl ?? null,
      pl_rows: plRows.length ? plRows : null,
      docs,
      cancelled_via: txt(v.cancelledVia),
      legacy_id: v._id,
    });
    if (v.mudx || v.propAlloc || v.mud)
      warn.push(`${v.invNo}: has MUD details in the TIEP app (${v.mud ? "saved MUD" : v.propAlloc ? "kept allocation" : "printed details"}); only its printed details are moved.`);
  }
  await insert("tiep_invoice_ext", invExtRows, "sales_invoice_id");
  const mudx = X.invoices.filter((v) => v.mudx && !extInvDone.has(v._id));
  if (mudx.length && APPLY) {
    for (const v of mudx) {
      const s = (await all<{ id: string; invoice_no: string }>("sales_invoices", (q) => q.eq("company_id", COMPANY).eq("type", "Export").eq("invoice_no", v.invNo)))[0];
      if (s) await sb.from("tiep_muds").upsert({ company_id: COMPANY, kind: "invoice", type: "Export", sales_invoice_id: s.id, mudx: v.mudx, legacy_id: v._id }, { onConflict: "sales_invoice_id" });
    }
  }
  log(`4. Invoices: ${invMatched} matched in the Export Register, ${invAdded} added from the TIEP lines (not in VAT Export reconciliation), ${voids} marked as cancelled by credit memo, ${mudx.length} with MUD details.`);

  // ---- 5. Documents, MUD lines, logbook, settings -----------------------------------------------------------------
  const docDone = await legacy("tiep_documents");
  const docRows: Record<string, unknown>[] = [];
  for (const d of X.documents) {
    if (docDone.has(d._id)) continue;
    const f = asset(d.asset);
    let path: string | null = null;
    if (f) {
      path = `${COMPANY}/tiep/documents/${d._id}-${String(d.file ?? "document.pdf").replace(/[^\w.\- ]+/g, "_")}`;
      await upload(path, f);
    } else if (d.asset) warn.push(`Document ${d.title}: file not in assets/, moved without it.`);
    docRows.push({
      company_id: COMPANY,
      title: d.title,
      kind: ["TIEP approval", "Customs letter", "Bank guarantee", "Other"].includes(d.kind) ? d.kind : "Other",
      doc_date: iso(d.date),
      valid_from: iso(d.validFrom),
      valid_to: iso(d.validTo),
      ref: txt(d.ref),
      std_id: d.std ? (stdDone.get(d.std) ?? null) : null,
      notes: txt(d.notes),
      path,
      file_name: txt(d.file),
      size: num(d.size),
      legacy_id: d._id,
    });
  }
  await insert("tiep_documents", docRows);
  const mhDone = await legacy("tiep_mudhist");
  const mhRows = X.mudhist.filter((m) => !mhDone.has(m._id)).map((m) => ({
    company_id: COMPANY,
    mud: String(m.mud),
    inv_no: txt(m.invNo),
    export_e: txt(m.exportE),
    mud_date: iso(m.date),
    code: txt(m.code),
    qty: num(m.qty),
    mud_desc: txt(m.mudDesc),
    yield_printed: num(m.yieldPrinted),
    yield_used: num(m.yieldUsed),
    notes: txt(m.notes),
    src: txt(m.src),
    legacy_id: m._id,
  }));
  await insert("tiep_mudhist", mhRows);

  let lbRows = 0;
  if (LB) {
    const { count } = await sb.from("tiep_logbook_summary").select("id", { count: "exact", head: true }).eq("company_id", COMPANY);
    if (count) log(`   Logbook summary already loaded (${count} rows): left as it is.`);
    else {
      const rows = LB.summary.map((s) => ({
        company_id: COMPANY,
        cd: String(s.cd),
        cd_date: iso(s.date),
        reg: txt(s.reg),
        qty: num(s.qty),
        used: num(s.used),
        bal: num(s.bal),
        liab: num(s.liab),
        bal_liab: num(s.balLiab),
        import_keys: (s.ids ?? []).map((id) => keyOf.get(id)).filter(Boolean),
        note: txt(s.note),
      }));
      await insert("tiep_logbook_summary", rows, "id");
      await insert("tiep_logbook_findings", LB.findings.map((f) => ({ company_id: COMPANY, area: f.area, items: f.items })), "id");
      lbRows = rows.length;
    }
  }
  const settingsDoc = X.config.find((c) => c._id === "settings");
  const mudCfg = X.config.find((c) => c._id === "mud");
  const productMap = X.config.find((c) => c._id === "productMap");
  if (APPLY) {
    const { error } = await sb.from("tiep_settings").upsert(
      {
        company_id: COMPANY,
        ...(settingsDoc?.periodDays ? { period_days: Number(settingsDoc.periodDays) } : {}),
        ...(LB?.totals?.guarantee ? { guarantee: LB.totals.guarantee } : {}),
        ...(LB ? { logbook_totals: { ...LB.totals, source: LB.source, loadedAt: LB.loadedAt } } : {}),
        ...(mudCfg ? { mud_config: Object.fromEntries(Object.entries(mudCfg).filter(([k]) => k !== "_id")) } : {}),
        ...(productMap?.map ? { product_map: productMap.map } : {}),
      },
      { onConflict: "company_id" },
    );
    if (error) fail(`tiep_settings: ${error.message}`);
  }
  log(`5. Documents: ${docRows.length} added. MUD lines: ${mhRows.length} added. Logbook: ${lbRows} summary rows, ${lbRows ? LB!.findings.length : 0} findings. ` +
    `Settings: bank guarantee ${LB?.totals?.guarantee ?? "-"}, cancellation period ${settingsDoc?.periodDays ?? "365 (default)"}.`);

  // ---- 6. Reconciliation ---------------------------------------------------------------------------------------
  const asAt = new Date().toISOString().slice(0, 10);
  const period = Number(settingsDoc?.periodDays) || 365;
  // The TIEP app's view: its own import lines and postings (logbook history included).
  const srcEntries: CustomsEntry[] = X.imports.map((i) => {
    const k = keyOf.get(i._id)!;
    return {
      id: i._id, company_id: COMPANY!, direction: "import", ...k, cusdec_date: iso(i.date), cusdec_month: txt(i.month), currency_type: txt(i.cur),
      ex_rate: num(i.rate), invoice_value: num(i.invfc), customs_value: num(i.cval), vat_base: num(i.vatv), vat_amount: num(i.vat), party: txt(i.sup),
      description: txt(i.desc), hs_code: txt(i.hs), uom: txt(i.uom), quantity: i.pending ? null : num(i.qty), cid_amount: num(i.cid), cid_code: txt(i.cidc),
      pal_amount: num(i.pal), pal_code: txt(i.palc), sscl_amount: num(i.sscl), sscl_code: txt(i.ssclc), vat_type: txt(i.vatt), vat_code: txt(i.vatc), created_at: "",
    } as CustomsEntry;
  });
  const srcExts = X.imports.map((i) => ({ ...keyOf.get(i._id)!, grp: i.grp, ftype: i.ftype ?? null, req: i.req ?? "Yes", pending: !!i.pending, duty_total: num(i.dutyTotal), legacy_id: i._id })) as unknown as ImportExt[];
  const srcCancels = [
    ...X.cancellations.filter((c) => keyOf.has(c.importId)).map((c) => ({ ...keyOf.get(c.importId)!, qty: Number(c.qty), status: c.status === "Planned" ? "Planned" : "Completed" })),
    ...lbAll.map((r) => ({ ...r, status: "Completed" })),
  ] as unknown as Cancellation[];

  // The database's view (dry run: what it would be after the move).
  let dbEntries: CustomsEntry[];
  let dbExts: ImportExt[];
  let dbCancels: Cancellation[];
  if (APPLY) {
    dbEntries = await all<CustomsEntry>("customs_entries", (q) => q.eq("company_id", COMPANY).eq("direction", "import"));
    dbExts = await all<ImportExt>("tiep_import_ext", (q) => q.eq("company_id", COMPANY));
    dbCancels = (await all<Cancellation>("tiep_cancellations", (q) => q.eq("company_id", COMPANY))).map((c) => ({ ...c, qty: Number(c.qty) }));
  } else {
    const fillBy = new Map(fills.map((f) => [f.id, f.patch]));
    dbEntries = [...entries.map((e) => ({ ...e, ...(fillBy.get(e.id) ?? {}) })), ...(newEntries as unknown as CustomsEntry[])];
    dbExts = [...(exts as unknown as ImportExt[])];
    dbCancels = [
      ...(canRows as unknown as Cancellation[]),
      ...(await all<Cancellation>("tiep_cancellations", (q) => q.eq("company_id", COMPANY))).map((c) => ({ ...c, qty: Number(c.qty) })),
    ];
  }
  const legacyKeys = new Set(X.imports.map((i) => { const k = keyOf.get(i._id)!; return lineKey(k.cusdec_no, k.invoice_no, k.item_no); }));
  const src = buildLines(srcEntries, srcExts, srcCancels, { periodDays: period, asAt });
  const dst = buildLines(dbEntries.filter((e) => legacyKeys.has(lineKey(e.cusdec_no, e.invoice_no, e.item_no))), dbExts, dbCancels, { periodDays: period, asAt });
  const sum = (l: typeof src, f: (r: (typeof src)[number]) => number) => l.reduce((a, r) => a + f(r), 0);
  const row = (label: string, a: number, b: number, d = 2) => {
    const ok = Math.abs(a - b) < (d ? 0.01 : 0.5);
    log(`   ${ok ? "✓" : "✗"} ${label.padEnd(34)} ${a.toFixed(d).padStart(18)} ${b.toFixed(d).padStart(18)}`);
    return ok;
  };
  log(`\n6. Reconciliation as at ${asAt} (TIEP app vs ${APPLY ? "database" : "planned result"}), import lines of the TIEP app only:`);
  log(`   ${"".padEnd(36)} ${"TIEP app".padStart(18)} ${APPLY ? "Database".padStart(18) : "Planned".padStart(18)}`);
  let ok = true;
  ok = row("Import lines", src.length, dst.length, 0) && ok;
  ok = row("TIEP lines to cancel", src.filter((r) => r.req !== "No").length, dst.filter((r) => r.req !== "No").length, 0) && ok;
  ok = row("Qty imported", sum(src, (r) => r.qty), sum(dst, (r) => r.qty)) && ok;
  ok = row("Qty cancelled (completed)", sum(src, (r) => r.cqty), sum(dst, (r) => r.cqty)) && ok;
  ok = row("Qty planned", sum(src, (r) => r.pqty), sum(dst, (r) => r.pqty)) && ok;
  ok = row("Duties & VAT suspended (LKR)", sum(src.filter((r) => r.req !== "No"), (r) => r.tsus), sum(dst.filter((r) => r.req !== "No"), (r) => r.tsus)) && ok;
  ok = row("Outstanding (LKR)", sum(src.filter((r) => r.req !== "No"), (r) => r.osv), sum(dst.filter((r) => r.req !== "No"), (r) => r.osv)) && ok;
  ok = row("Overdue lines", src.filter((r) => r.overdue).length, dst.filter((r) => r.overdue).length, 0) && ok;
  const gs = byGroup(src);
  const gd = new Map(byGroup(dst).map((g) => [g.grp + "|" + g.uom, g]));
  log("   By material group (balance / outstanding LKR):");
  for (const g of gs) {
    const d = gd.get(g.grp + "|" + g.uom);
    const same = !!d && Math.abs(d.b - g.b) < 0.01 && Math.abs(d.o - g.o) < 0.5;
    ok = same && ok;
    log(`   ${same ? "✓" : "✗"} ${(g.grp + " " + g.uom).padEnd(32)} ${g.b.toFixed(2).padStart(14)} / ${g.o.toFixed(0).padStart(12)}   ${d ? d.b.toFixed(2).padStart(14) + " / " + d.o.toFixed(0).padStart(12) : "missing"}`);
  }
  if (warn.length) {
    log("\nNotes:");
    for (const w of warn) log("   - " + w);
  }
  log(`\n${ok ? "✓ Totals agree." : "✗ Totals differ: see the rows marked ✗ (matched Import Register entries whose figures differ from TIEP are the usual cause)."}`);
  log(APPLY ? "Done." : "Dry run only. Run again with --apply to write.");
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
