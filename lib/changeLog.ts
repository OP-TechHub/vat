/**
 * Change log (migration 0015): one entry per action, with the rows it changed before and after.
 * Admins read it on the Log tab and can undo an entry. These helpers load it and put it into words.
 */
import type { Db } from "./supabase/schema";
import { DOC_LABEL } from "./documents";
import { mLabel, monthKey } from "./format";
import { TABS } from "./permissions";
import type { DocumentKind } from "./types";

export type ChangeKind = "upload" | "edit" | "add" | "delete" | "document" | "members" | "undo";

export const KIND_LABEL: Record<ChangeKind, string> = {
  upload: "Upload",
  edit: "Edit",
  add: "Added by hand",
  delete: "Delete",
  document: "Document",
  members: "Members",
  undo: "Undo",
};

/** A log entry as listed. */
export interface ChangeSet {
  id: number;
  changed_at: string;
  changed_by: string | null;
  email: string | null;
  label: string | null;
  kind: ChangeKind;
  undo_of: number | null;
  undone_by: number | null;
  undone_at: string | null;
  tabs: string[];
  n_insert: number;
  n_update: number;
  n_delete: number;
}

/** One row an entry changed. */
export interface ChangeRow {
  id: number;
  tbl: string;
  tab: string;
  op: "INSERT" | "UPDATE" | "DELETE";
  row_key: Record<string, unknown>;
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
  subject_email: string | null;
}

export interface LogFilters {
  tab: string;
  user: string;
  kind: string;
  from: string;
  to: string;
}

export const PAGE_SIZE = 100;

/** Tab names, including Members, which has no entry in TABS. */
export function tabLabel(tab: string): string {
  return tab === "members" ? "Members" : (TABS.find((t) => t.key === tab)?.label ?? tab);
}

export const LOG_TABS: string[] = [...TABS.filter((t) => t.key !== "summary").map((t) => t.key as string), "members"];

export async function loadChangeSets(sb: Db, companyId: string, f: LogFilters, before?: number): Promise<ChangeSet[]> {
  const { data, error } = await sb.rpc("change_log_list", {
    p_company: companyId,
    p_before: before ?? null,
    p_limit: PAGE_SIZE,
    p_tab: f.tab || null,
    p_user: f.user || null,
    p_from: f.from || null,
    p_to: f.to || null,
    p_kind: f.kind || null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as ChangeSet[];
}

export async function loadChangeRows(sb: Db, setId: number): Promise<ChangeRow[]> {
  const { data, error } = await sb.rpc("change_log_rows", { p_set: setId });
  if (error) throw new Error(error.message);
  return (data ?? []) as ChangeRow[];
}

export async function loadLogPeople(sb: Db, companyId: string): Promise<{ user_id: string; email: string }[]> {
  const { data, error } = await sb.rpc("change_log_people", { p_company: companyId });
  if (error) throw new Error(error.message);
  return (data ?? []) as { user_id: string; email: string }[];
}

/** Undo an entry; returns the id of the entry the undo made. */
export async function undoChangeSet(sb: Db, setId: number): Promise<number> {
  const { data, error } = await sb.rpc("undo_change_set", { p_set: setId });
  if (error) throw new Error(error.message);
  return data as number;
}

/**
 * Delete archived documents whose 30 days are up, and log entries older than 5 years. Run for admins; the
 * database says which files are due, storage deletes them, then the database records it.
 */
export async function runHousekeeping(sb: Db, companyId: string, bucket: string): Promise<number> {
  const { data, error } = await sb.rpc("change_log_housekeeping", { p_company: companyId });
  if (error) throw new Error(error.message);
  const paths = ((data ?? []) as unknown[]).map((r) =>
    typeof r === "string" ? r : String((r as Record<string, unknown>).change_log_housekeeping ?? ""),
  ).filter(Boolean);
  if (!paths.length) return 0;
  const rm = await sb.storage.from(bucket).remove(paths);
  if (rm.error) throw new Error(rm.error.message);
  // Files already gone from storage count as deleted too.
  const { error: e2 } = await sb.rpc("mark_files_purged", { p_company: companyId, p_paths: paths });
  if (e2) throw new Error(e2.message);
  return paths.length;
}

/** What an entry did, in a line: its own label, or counts of the rows it changed. */
export function describeSet(s: ChangeSet): string {
  if (s.label) return s.label;
  const parts: string[] = [];
  const rows = (n: number) => `${n} row${n === 1 ? "" : "s"}`;
  if (s.n_insert) parts.push(`added ${rows(s.n_insert)}`);
  if (s.n_update) parts.push(`changed ${rows(s.n_update)}`);
  if (s.n_delete) parts.push(`removed ${rows(s.n_delete)}`);
  const text = parts.join(", ");
  return text ? text[0].toUpperCase() + text.slice(1) : "No row changes";
}

const month = (v: unknown) => (typeof v === "string" && v.length >= 7 ? mLabel(monthKey(v)) : String(v ?? ""));

/** Which record a changed row is, in words. */
export function rowLabel(r: ChangeRow): string {
  const x = (r.new_row ?? r.old_row ?? {}) as Record<string, unknown>;
  switch (r.tbl) {
    case "ledger_invoices":
      return `Invoice ${x.invoice_no}`;
    case "schedule_lines":
      return `Schedule line ${x.tax_invoice_no} (${month(x.return_month)})`;
    case "export_sales":
    case "import_purchases":
      return `Invoice ${x.invoice_no} (${month(x.sales_month)})`;
    case "customs_entries":
      return `CusDec ${x.cusdec_no} · invoice ${x.invoice_no} · item ${x.item_no}`;
    case "vat_returns":
      return `Return ${month(x.return_month)}`;
    case "return_documents":
      return `${DOC_LABEL[x.kind as DocumentKind] ?? x.kind} ${month(x.return_month)}`;
    case "ird_status":
      return `IRD status ${month(x.return_month)}`;
    case "company_members":
      return `Member ${r.subject_email ?? x.user_id}`;
    case "company_member_permissions":
      return `${tabLabel(String(x.tab))} access of ${r.subject_email ?? x.user_id}`;
    default:
      return r.tbl;
  }
}

/** Columns not shown as changes: keys and bookkeeping. */
const HIDDEN = new Set(["id", "company_id", "user_id", "updated_at", "updated_by", "created_at", "created_by"]);

const show = (v: unknown): string => {
  if (v == null || v === "") return "blank";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

export const fieldName = (k: string) => k.replace(/_/g, " ");

/** Fields an update changed, as "field: before → after". */
export function fieldChanges(r: ChangeRow): { field: string; before: string; after: string }[] {
  if (r.op !== "UPDATE" || !r.old_row || !r.new_row) return [];
  const out: { field: string; before: string; after: string }[] = [];
  for (const k of Object.keys(r.new_row)) {
    if (HIDDEN.has(k)) continue;
    const a = r.old_row[k];
    const b = r.new_row[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ field: fieldName(k), before: show(a), after: show(b) });
  }
  return out;
}

/** The filled-in fields of an added or removed row, for its details. */
export function rowFields(r: ChangeRow): string {
  const x = (r.op === "DELETE" ? r.old_row : r.new_row) ?? {};
  return Object.entries(x)
    .filter(([k, v]) => !HIDDEN.has(k) && v != null && v !== "" && v !== false)
    .map(([k, v]) => `${fieldName(k)}: ${show(v)}`)
    .join(" · ");
}
