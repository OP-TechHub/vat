import type { Db } from "../supabase/schema";
import { fetchAll, loadCustomsEntries } from "../data";
import type { CustomsEntry } from "../types";
import type { SalesInvoice, SalesLine } from "../sales";
import type { Batch, Cancellation, ImportExt, SkuItem, Standard, TiepSettings } from "./model";
import type { InvoiceExt, Mud, MudConfig } from "./invoices";

export interface TiepDocument {
  id: string;
  company_id: string;
  title: string;
  kind: "TIEP approval" | "Customs letter" | "Bank guarantee" | "Other";
  doc_date: string | null;
  valid_from: string | null;
  valid_to: string | null;
  ref: string | null;
  std_id: string | null;
  notes: string | null;
  path: string | null;
  file_name: string | null;
  size: number | null;
}

export interface MudHist {
  id: string;
  company_id: string;
  mud: string;
  inv_no: string | null;
  export_e: string | null;
  mud_date: string | null;
  code: string | null;
  qty: number | null;
  mud_desc: string | null;
  yield_printed: number | null;
  yield_used: number | null;
  notes: string | null;
  src: string | null;
}

export interface LogbookSummary {
  id: string;
  cd: string;
  cd_date: string | null;
  reg: string | null;
  qty: number | null;
  used: number | null;
  bal: number | null;
  liab: number | null;
  bal_liab: number | null;
  import_keys: { cusdec_no: string; invoice_no: string; item_no: number }[];
  note: string | null;
}

export interface LogbookFinding {
  id: string;
  area: string;
  items: string[];
}

export interface TiepSettingsFull extends TiepSettings {
  mud_config: Partial<MudConfig> | null;
  product_map: Record<string, string> | null;
  logbook_totals: { balLiab?: number; guarantee?: number; excess?: number; totalLiab?: number; source?: string; loadedAt?: string } | null;
}

export interface TiepData {
  entries: CustomsEntry[];
  exts: ImportExt[];
  cancels: (Cancellation & { mud_id?: string | null })[];
  batches: Batch[];
  standards: Standard[];
  skus: SkuItem[];
  settings: TiepSettingsFull | null;
  salesInvoices: SalesInvoice[];
  salesLines: SalesLine[];
  invExts: InvoiceExt[];
  muds: Mud[];
  documents: TiepDocument[];
  mudhist: MudHist[];
  logbook: LogbookSummary[];
  findings: LogbookFinding[];
}

export const EMPTY_TIEP: TiepData = {
  entries: [],
  exts: [],
  cancels: [],
  batches: [],
  standards: [],
  skus: [],
  settings: null,
  salesInvoices: [],
  salesLines: [],
  invExts: [],
  muds: [],
  documents: [],
  mudhist: [],
  logbook: [],
  findings: [],
};

const all = <T>(sb: Db, table: string, companyId: string, order: string, select = "*") =>
  fetchAll<T>(
    (from, to) =>
      sb.from(table).select(select).eq("company_id", companyId).order(order).range(from, to) as unknown as PromiseLike<{
        data: T[] | null;
        error: { message: string } | null;
      }>,
  );

/** Tables of a later migration: empty until it is run, so the earlier screens keep working. */
const later = <T>(p: Promise<T[]>): Promise<T[]> =>
  p.catch((e: unknown) => {
    if (e instanceof Error && /schema cache|does not exist/i.test(e.message)) return [] as T[];
    throw e;
  });

/** Everything the TIEP module works from, for one company. */
export async function loadTiep(sb: Db, companyId: string): Promise<TiepData> {
  const [entries, exts, cancels, batches, standards, skus, settings, salesInvoices, salesLines, invExts, muds, documents, mudhist, logbook, findings] =
    await Promise.all([
      loadCustomsEntries(sb, "import", companyId),
      all<ImportExt>(sb, "tiep_import_ext", companyId, "id"),
      all<Cancellation>(sb, "tiep_cancellations", companyId, "id"),
      all<Batch>(sb, "tiep_batches", companyId, "id"),
      all<Standard>(sb, "tiep_standards", companyId, "id"),
      all<SkuItem>(sb, "tiep_skumap", companyId, "id"),
      sb.from("tiep_settings").select("*").eq("company_id", companyId).maybeSingle(),
      later(all<SalesInvoice>(sb, "sales_invoices", companyId, "id")),
      later(
        all<SalesLine>(
          sb,
          "sales_invoice_lines",
          companyId,
          "id",
          "id,invoice_id,line_no,line_date,item_code,description,qty,uom,qty_in,uom_in,boxes,gross,unit_price,amount_fc,amount_lkr,is_charge",
        ),
      ),
      later(all<InvoiceExt>(sb, "tiep_invoice_ext", companyId, "sales_invoice_id")),
      later(all<Mud>(sb, "tiep_muds", companyId, "id")),
      later(all<TiepDocument>(sb, "tiep_documents", companyId, "id")),
      later(all<MudHist>(sb, "tiep_mudhist", companyId, "id")),
      later(all<LogbookSummary>(sb, "tiep_logbook_summary", companyId, "id")),
      later(all<LogbookFinding>(sb, "tiep_logbook_findings", companyId, "id")),
    ]);
  if (settings.error) throw new Error(settings.error.message);
  return {
    entries,
    exts,
    // numeric columns can arrive as strings; quantities are summed, so make them numbers.
    cancels: cancels.map((c) => ({ ...c, qty: Number(c.qty) })),
    batches,
    standards: standards.map((s) => ({
      ...s,
      edible_kg: Number(s.edible_kg),
      fcr: Number(s.fcr),
      yields: s.yields ?? [],
      materials: s.materials ?? [],
      mud: s.mud ?? [],
    })),
    skus: skus.map((x) => ({ ...x, alt: x.alt ?? {} })),
    settings: (settings.data as TiepSettingsFull | null) ?? null,
    salesInvoices,
    salesLines: salesLines.map((l) => ({ ...l, qty: l.qty == null ? null : Number(l.qty) })),
    invExts: invExts.map((x) => ({ ...x, docs: x.docs ?? {} })),
    muds: muds.map((m) => ({ ...m, docs: m.docs ?? {}, member_ids: m.member_ids ?? [] })),
    documents,
    mudhist,
    logbook: logbook.map((l) => ({ ...l, import_keys: l.import_keys ?? [] })),
    findings: findings.map((f) => ({ ...f, items: f.items ?? [] })),
  };
}
