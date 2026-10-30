/**
 * Match a document file (a scanned bundle or a CusDec PDF) to a customs declaration already held, from
 * what was read off it: the customs reference, the invoice number, or (when the scan is too faint for
 * those) the VAT figures of its tax table.
 */
import { norm } from "./format";
import type { CustomsEntry } from "./types";

/** What was read off one declaration in a file (from the PDF or an index sheet). */
export interface FileReading {
  cusdec_no: string | null;
  invoice_no: string | null;
  cusdec_date: string | null;
  vat_base: number | null;
  vat_amount: number | null;
}

/** A declaration held: its item lines with the amounts summed. */
export interface HeldDeclaration {
  key: string;
  cusdec_no: string;
  invoice_no: string;
  cusdec_date: string | null;
  /** First item line, which carries the declaration fields and the document slots. */
  entry: CustomsEntry;
  vat_base: number | null;
  vat_amount: number | null;
}

export type MatchHow = "CusDec no" | "invoice no" | "VAT amount" | "value for VAT";

export const declarationKey = (e: Pick<CustomsEntry, "cusdec_no" | "invoice_no">) => e.cusdec_no + "|" + e.invoice_no;

/** The declarations held, one per CusDec and invoice, in CusDec order. */
export function heldDeclarations(entries: CustomsEntry[]): HeldDeclaration[] {
  const by = new Map<string, HeldDeclaration>();
  const add = (a: number | null, b: number | null) => (a == null && b == null ? null : (a ?? 0) + (b ?? 0));
  for (const e of entries) {
    const k = declarationKey(e);
    const d = by.get(k);
    if (!d) {
      by.set(k, { key: k, cusdec_no: e.cusdec_no, invoice_no: e.invoice_no, cusdec_date: e.cusdec_date, entry: e, vat_base: e.vat_base, vat_amount: e.vat_amount });
      continue;
    }
    d.vat_base = add(d.vat_base, e.vat_base);
    d.vat_amount = add(d.vat_amount, e.vat_amount);
    if (e.item_no < d.entry.item_no) d.entry = e;
  }
  return [...by.values()].sort((a, b) => a.cusdec_no.localeCompare(b.cusdec_no) || a.invoice_no.localeCompare(b.invoice_no));
}

/** Digits of a reference, for "S 11719" against "11719" or "CBBD1 S 11719". */
const refDigits = (s: string) => (s.match(/\d{4,}/g) ?? []).pop() ?? "";

const near = (a: number | null, b: number | null) => a != null && b != null && a !== 0 && Math.abs(a - b) <= 1;

/**
 * The held declaration a reading belongs to, and how it was found. A rule only counts when it points
 * at exactly one declaration.
 */
export function matchReading(r: FileReading, held: HeldDeclaration[]): { decl: HeldDeclaration; how: MatchHow } | null {
  const one = (list: HeldDeclaration[]) => (list.length === 1 ? list[0] : null);
  if (r.cusdec_no) {
    const exact = one(held.filter((d) => norm(d.cusdec_no) === norm(r.cusdec_no)));
    if (exact) return { decl: exact, how: "CusDec no" };
    const digits = refDigits(r.cusdec_no);
    const byDigits = digits ? one(held.filter((d) => refDigits(d.cusdec_no) === digits)) : null;
    if (byDigits) return { decl: byDigits, how: "CusDec no" };
  }
  if (r.invoice_no) {
    const inv = one(held.filter((d) => norm(d.invoice_no) === norm(r.invoice_no)));
    if (inv) return { decl: inv, how: "invoice no" };
  }
  const vat = one(held.filter((d) => near(d.vat_amount, r.vat_amount)));
  if (vat) return { decl: vat, how: "VAT amount" };
  const base = one(held.filter((d) => near(d.vat_base, r.vat_base)));
  if (base) return { decl: base, how: "value for VAT" };
  return null;
}
