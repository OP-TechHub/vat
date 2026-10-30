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
import type { CustomsEntry, ReconDirection } from "@/lib/types";

/** Filter boxes of the three document columns. */
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

/** Name of the CusDec file held for an entry, without its extension ("IMP 173"); "" when none is held. */
export function cusdecFileName(entry: CustomsEntry | null | undefined): string {
  const d = entry && customsDoc(entry, "cusdec");
  return d ? d.filename.replace(/\.[^.\s]{1,5}$/, "") : "";
}

/** Headings of the three document columns. */
export function CustomsDocHeadings({ canWrite }: { canWrite: boolean }) {
  return (
    <>
      {CUSTOMS_DOC_KINDS.map(({ kind, label }, i) => (
        <DocHeading key={kind} title={label} canWrite={canWrite} className={i === 0 ? "border-l border-line" : undefined} />
      ))}
    </>
  );
}

interface HeldDoc {
  filename: string;
  path: string;
}

/**
 * Open / Upload / Replace / Remove for the CusDec, other documents and all documents of a customs
 * declaration. `cells(entry)` gives the three table cells of a row; `input` is the hidden file picker
 * to render once. `onChanged` runs after a file is kept or removed.
 */
export function useCustomsDocs(direction: ReconDirection, onChanged: () => void | Promise<void>) {
  const { supabase, company, canWrite, flash } = useApp();
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
      await uploadCustomsDocument(supabase, company.id, direction, t.entry, t.kind, file, customsDoc(t.entry, t.kind)?.path);
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
            canWrite={canWrite}
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
