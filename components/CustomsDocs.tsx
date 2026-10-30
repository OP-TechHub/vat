"use client";

import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useApp } from "./AppShell";
import { DocActions, DocHeading } from "./DocActions";
import type { ColumnSpec } from "./ColumnFilters";
import {
  CUSTOMS_DOC_KINDS,
  cusdecDocumentUrl,
  customsDoc,
  removeCustomsDocument,
  uploadCustomsDocument,
  type CustomsDocKind,
} from "@/lib/customsDocs";
import type { Perm } from "@/lib/permissions";
import type { CustomsEntry, ReconDirection } from "@/lib/types";

/** Filter boxes of the document columns. */
export const DOC_FILTER_COLUMNS: ColumnSpec[] = CUSTOMS_DOC_KINDS.map(({ kind, label }, i) => ({
  key: "doc_" + kind,
  label: `${label} (held / none / file name)`,
  className: i === 0 ? "border-l border-line" : undefined,
}));

/** Values of the document filter boxes for a row ("" when it has no customs entry). */
export function docFilterValues(entry: CustomsEntry | null | undefined): Record<string, string> {
  return Object.fromEntries(
    CUSTOMS_DOC_KINDS.map(({ kind }) => ["doc_" + kind, entry ? (customsDoc(entry, kind) ? "Held " + customsDoc(entry, kind)!.filename : "None") : ""]),
  );
}

/** Name of a file without its extension ("IMP 173.pdf" -> "IMP 173"). */
export const baseName = (name: string) => name.replace(/\.[^.\s]{1,5}$/, "");

/**
 * File name of an entry's CusDec ("IMP 173"): as given in the upload, else the name of the CusDec file
 * held; "" when neither.
 */
export function cusdecFileName(entry: CustomsEntry | null | undefined): string {
  if (!entry) return "";
  if (entry.file_name) return entry.file_name;
  const d = customsDoc(entry, "cusdec");
  return d ? baseName(d.filename) : "";
}

/** Search key: upper case with all spaces removed, so "imp173" finds "IMP 173". */
const searchKey = (v: string | null | undefined) => (v ?? "").toUpperCase().replace(/\s+/g, "");

/** True when the search text is blank or found in any of the values (file name, CusDec no, invoice no). */
export function searchMatches(q: string, ...values: (string | null | undefined)[]): boolean {
  const k = searchKey(q);
  return !k || values.some((v) => searchKey(v).includes(k));
}

/** Search box over the file name, CusDec number and invoice number of a customs table. */
export function CustomsSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      Search
      <input
        className="control w-[230px]"
        type="search"
        value={value}
        placeholder="File name, Cusdec no or invoice no"
        aria-label="Search by file name, CusDec number or invoice number"
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/** Headings of the document columns. */
export function CustomsDocHeadings({ perm }: { perm: Perm }) {
  return (
    <>
      {CUSTOMS_DOC_KINDS.map(({ kind, label }, i) => (
        <DocHeading key={kind} title={label} perm={perm} className={i === 0 ? "border-l border-line" : undefined} />
      ))}
    </>
  );
}

interface HeldDoc {
  filename: string;
  path: string;
}

/**
 * Open / Upload / Replace / Remove for the CusDec, commercial invoice, other documents and all documents of a
 * customs declaration. `cells(entry)` gives the document table cells of a row; `input` is the hidden file picker
 * to render once. `onChanged` runs after a file is kept or removed.
 */
export function useCustomsDocs(direction: ReconDirection, onChanged: () => void | Promise<void>) {
  const { supabase, company, perm, flash } = useApp();
  const p = perm(direction === "export" ? "exports" : "imports");
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const target = useRef<{ entry: CustomsEntry; kind: CustomsDocKind } | null>(null);
  const labelOf = (kind: CustomsDocKind) => CUSTOMS_DOC_KINDS.find((k) => k.kind === kind)!.label;

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const t = target.current;
    e.target.value = "";
    if (!file || !t || !company) return;
    setBusyId(t.entry.id);
    try {
      await uploadCustomsDocument(supabase, company.id, direction, t.entry, t.kind, file);
      flash(`${labelOf(t.kind)} for CusDec ${t.entry.cusdec_no} kept.`);
      await onChanged();
    } catch (err) {
      flash("Could not upload: " + (err instanceof Error ? err.message : String(err)), true);
    }
    setBusyId(null);
  }
  async function open(d: HeldDoc) {
    try {
      window.open(await cusdecDocumentUrl(supabase, d.path), "_blank", "noopener");
    } catch (err) {
      flash("Could not open the file: " + (err instanceof Error ? err.message : String(err)), true);
    }
  }
  async function remove(entry: CustomsEntry, kind: CustomsDocKind, d: HeldDoc) {
    if (!window.confirm(`Remove the ${labelOf(kind).toLowerCase()} file for ${entry.cusdec_no} (${d.filename})?`)) return;
    setBusyId(entry.id);
    try {
      await removeCustomsDocument(supabase, entry, kind);
      flash(`${labelOf(kind)} for CusDec ${entry.cusdec_no} removed.`);
      await onChanged();
    } catch (err) {
      flash("Could not remove: " + (err instanceof Error ? err.message : String(err)), true);
    }
    setBusyId(null);
  }

  const cells = (entry: CustomsEntry | null | undefined): ReactNode =>
    CUSTOMS_DOC_KINDS.map(({ kind }, i) => (
      <td key={kind} className={i === 0 ? "border-l border-line" : undefined}>
        {entry ? (
          <DocActions<HeldDoc>
            doc={customsDoc(entry, kind)}
            perm={p}
            busy={busyId === entry.id}
            yes="Held"
            no="None"
            pillClass="pill-info"
            showName
            onOpen={(d) => void open(d)}
            onPick={() => {
              target.current = { entry, kind };
              fileRef.current?.click();
            }}
            onRemove={(d) => void remove(entry, kind, d)}
          />
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
    ));

  const input = (
    <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={(e) => void onFile(e)} />
  );

  return { busyId, cells, input };
}
