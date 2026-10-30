"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { useApp } from "./AppShell";
import { mLabel } from "@/lib/format";
import {
  DOC_ACCEPT,
  DOC_KINDS,
  DOC_LABEL,
  documentUrl,
  isMissingTable,
  loadMonthDocuments,
  removeDocument,
  uploadDocument,
} from "@/lib/documents";
import type { DocumentKind, ReturnDocument } from "@/lib/types";

/**
 * The VAT return and acknowledgement documents of one period: Yes/No, Open, and per the tab's permissions
 * Upload (upload), Replace (upload and delete) and Remove (delete). Used in the left panel of the VAT
 * reconciliation tab.
 */
export default function ReturnDocuments({ month, onChange }: { month: string; onChange?: () => void }) {
  const { supabase, company, user, perm, flash } = useApp();
  const p = perm("returns");
  const [docs, setDocs] = useState<ReturnDocument[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<DocumentKind | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const target = useRef<DocumentKind | null>(null);

  const load = useCallback(async () => {
    if (!company || !month) return;
    try {
      setDocs(await loadMonthDocuments(supabase, company.id, month));
      setNote(null);
    } catch (e) {
      setDocs([]);
      setNote(
        isMissingTable(e)
          ? "Documents need supabase/migrations/0005_return_filing.sql to be run in the Supabase SQL Editor."
          : e instanceof Error
            ? e.message
            : "Could not load documents.",
      );
    }
  }, [supabase, company, month]);

  useEffect(() => {
    setDocs(null);
    void load();
  }, [load]);

  function pick(kind: DocumentKind) {
    target.current = kind;
    fileRef.current?.click();
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const kind = target.current;
    e.target.value = "";
    if (!file || !kind || !company) return;
    setBusy(kind);
    try {
      await uploadDocument(supabase, company.id, user.id, month, kind, file);
      flash(`${DOC_LABEL[kind]} for ${mLabel(month)} uploaded.`);
      await load();
      onChange?.();
    } catch (err) {
      flash("Could not upload: " + (err instanceof Error ? err.message : String(err)), true);
    }
    setBusy(null);
  }

  async function open(doc: ReturnDocument) {
    try {
      window.open(await documentUrl(supabase, doc), "_blank", "noopener");
    } catch (err) {
      flash("Could not open the file: " + (err instanceof Error ? err.message : String(err)), true);
    }
  }

  async function remove(doc: ReturnDocument) {
    if (!window.confirm(`Remove the ${DOC_LABEL[doc.kind].toLowerCase()} for ${mLabel(month)} (${doc.filename})?`)) return;
    setBusy(doc.kind);
    try {
      await removeDocument(supabase, doc);
      flash(`${DOC_LABEL[doc.kind]} for ${mLabel(month)} removed.`);
      await load();
      onChange?.();
    } catch (err) {
      flash("Could not remove: " + (err instanceof Error ? err.message : String(err)), true);
    }
    setBusy(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] uppercase tracking-[0.05em] text-muted font-semibold">Documents for {mLabel(month)}</div>
      <input ref={fileRef} type="file" accept={DOC_ACCEPT} className="hidden" onChange={(e) => void onFile(e)} />
      {note && <div className="note">{note}</div>}
      {DOC_KINDS.map((kind) => {
        const doc = docs?.find((d) => d.kind === kind);
        const isBusy = busy === kind;
        return (
          <div key={kind} className={"flex flex-wrap items-center gap-2 text-[13px]" + (isBusy ? " opacity-60" : "")}>
            <span className="min-w-[150px]">{DOC_LABEL[kind]}</span>
            {docs == null ? (
              <span className="note">Loading…</span>
            ) : (
              <span className={"pill " + (doc ? "pill-good" : "pill-warn")}>{doc ? "Uploaded" : "Not uploaded"}</span>
            )}
            {doc && (
              <button className="btn" type="button" title={doc.filename} onClick={() => void open(doc)}>
                Open
              </button>
            )}
            {docs != null && (doc ? p.upload && p.delete : p.upload) && (
              <button className="btn" type="button" disabled={isBusy} onClick={() => pick(kind)}>
                {doc ? "Replace" : "Upload"}
              </button>
            )}
            {docs != null && doc && p.delete && (
              <button className="btn btn-danger" type="button" disabled={isBusy} onClick={() => void remove(doc)}>
                Remove
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
