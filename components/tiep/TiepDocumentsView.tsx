"use client";

import { useMemo, useState } from "react";
import { useApp } from "../AppShell";
import { useTiep } from "./TiepProvider";
import { Modal } from "./ui";
import { BUCKET } from "@/lib/documents";
import type { TiepDocument } from "@/lib/tiep/data";
import { fdate, stdList, stdShort } from "@/lib/tiep/model";

const KINDS: TiepDocument["kind"][] = ["TIEP approval", "Customs letter", "Bank guarantee", "Other"];
const ACCEPT = ".pdf,.png,.jpg,.jpeg,application/pdf,image/*";

/** Settings › Documents: TIEP approvals and other reference documents, plus the tax code legend. */
export default function TiepDocumentsView() {
  const { supabase, flash } = useApp();
  const { documents, standards, asAt, perm } = useTiep();
  const w = perm.documents.edit;
  const [edit, setEdit] = useState<TiepDocument | "new" | null>(null);
  const stdOf = useMemo(() => new Map(standards.map((s) => [s.id, s])), [standards]);
  const list = useMemo(() => [...documents].sort((a, b) => String(b.doc_date ?? "").localeCompare(String(a.doc_date ?? ""))), [documents]);

  async function open(d: TiepDocument) {
    if (!d.path) return;
    // Open the tab first so the browser does not block it as a pop-up after the await.
    const tab = window.open("", "_blank");
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(d.path, 300);
    if (error || !data?.signedUrl) {
      tab?.close();
      return flash("Could not open the file: " + (error?.message ?? "no link returned."), true);
    }
    if (tab) {
      tab.opener = null;
      tab.location.href = data.signedUrl;
    } else window.open(data.signedUrl, "_blank", "noopener");
  }

  return (
    <>
      <div className="panel">
        <div className="bar">
          <h2 className="text-[15px] font-semibold m-0 pb-1.5">Documents</h2>
          <span className="flex-1" />
          {w && (
            <button className="btn btn-primary" type="button" onClick={() => setEdit("new")}>
              Add document
            </button>
          )}
        </div>
        <p className="note m-0">
          TIEP approvals and other reference documents, kept with the register. A document linked to a conversion standard
          shows on the Conversion Standards page.
        </p>
        <div className="scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Document</th>
                <th>Type</th>
                <th>Dated</th>
                <th>Valid</th>
                <th>Reference</th>
                <th>Linked standard</th>
                <th>File</th>
                {w && <th></th>}
              </tr>
            </thead>
            <tbody>
              {!list.length ? (
                <tr>
                  <td colSpan={8} className="note">
                    No documents yet.
                  </td>
                </tr>
              ) : (
                list.map((d) => {
                  const st = d.std_id ? stdOf.get(d.std_id) : undefined;
                  return (
                    <tr key={d.id}>
                      <td>
                        <b>{d.title}</b>
                        {d.notes && <div className="text-[11px] text-muted max-w-[380px] whitespace-normal">{d.notes}</div>}
                      </td>
                      <td>{d.kind}</td>
                      <td className="whitespace-nowrap">{fdate(d.doc_date)}</td>
                      <td className="whitespace-nowrap">
                        {(d.valid_from || d.valid_to) && (
                          <>
                            {d.valid_from ? fdate(d.valid_from) : "…"} – {d.valid_to ? fdate(d.valid_to) : "…"}
                            {d.valid_to && d.valid_to < asAt && <span className="chip chip-bad ml-1">Expired</span>}
                          </>
                        )}
                      </td>
                      <td className="whitespace-normal max-w-[220px]">{d.ref ?? ""}</td>
                      <td>{st ? stdShort(st) : ""}</td>
                      <td>
                        {d.path && (
                          <>
                            <button className="btn py-0" type="button" onClick={() => void open(d)}>
                              Open file
                            </button>
                            <div className="text-[11px] text-muted">{d.file_name ?? ""}</div>
                          </>
                        )}
                      </td>
                      {w && (
                        <td>
                          <button className="btn py-0" type="button" onClick={() => setEdit(d)}>
                            Edit
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
        <div className="panel">
          <h2 className="text-[15px] font-semibold m-0">Tax code legend (inferred, please confirm)</h2>
          <ul className="list-disc pl-5 m-0 flex flex-col gap-1.5 text-[13px]">
            <li>
              CID / PAL / SSCL code <b>0</b> = assessed but not paid (suspended under TIEP). <b>1</b> = paid. Blank = not
              applicable.
            </li>
            <li>
              VAT code <b>2</b> = deferred (VAT type VTD). <b>1</b> = paid. <b>0</b> = no VAT.
            </li>
            <li>
              CusDec <b>S</b>-series = TIEP duty-suspended entry. <b>I</b>-series = home use, duty paid.
            </li>
            <li>
              Suspended = CID + PAL + SSCL where code is 0, plus VAT where VAT code is 2. PAL on S-series equipment carries
              code 1 (paid), so it is left out.
            </li>
            <li>Outstanding = suspended × balance qty ÷ qty imported.</li>
          </ul>
        </div>
        <div className="panel">
          <h2 className="text-[15px] font-semibold m-0">How to use</h2>
          <ul className="list-disc pl-5 m-0 flex flex-col gap-1.5 text-[13px]">
            <li>
              <b>Post cancellation</b> (TIEP Status): enter the export invoice, export qty and conversion ratio, pick the
              material, preview, then post. FIFO splits the quantity across the oldest open lines of that material.
            </li>
            <li>
              <b>Cancellation ledger</b>: every posting, one row per import line used. Reverse a wrong posting there.
            </li>
            <li>
              <b>Import register</b>: click a line to see its detail and cancellations, change whether it needs cancelling,
              or edit its TIEP details.
            </li>
            <li>
              <b>Local sales batches</b>: duty-payment cancellations for fish sold locally. They stay <i>Planned</i> until
              duty is paid. Use Edit to enter the customs entry once it is raised.
            </li>
            <li>
              <b>Planned</b> quantities are held against an import line so FIFO will not use them again. Outstanding duty only
              falls once a cancellation is <i>Completed</i>.
            </li>
          </ul>
        </div>
      </div>

      {edit && <DocEditor doc={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function DocEditor({ doc: d, onClose }: { doc: TiepDocument | null; onClose: () => void }) {
  const { supabase, company, user, flash } = useApp();
  const { standards, perm, reload } = useTiep();
  const sts = stdList(standards);
  const canUpload = perm.documents.upload;
  const [title, setTitle] = useState(d?.title ?? "");
  const [kind, setKind] = useState<TiepDocument["kind"]>(d?.kind ?? "TIEP approval");
  const [date, setDate] = useState(d?.doc_date ?? "");
  const [from, setFrom] = useState(d?.valid_from ?? "");
  const [to, setTo] = useState(d?.valid_to ?? "");
  const [ref, setRef] = useState(d?.ref ?? "");
  const [std, setStd] = useState(d?.std_id ?? "");
  const [notes, setNotes] = useState(d?.notes ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!company) return;
    const t = title.trim();
    if (!t) return setMsg("Enter a title.");
    if (!d && !file && canUpload) return setMsg("Choose the file.");
    if (from && to && from > to) return setMsg("Valid from must be on or before valid to.");
    setBusy(true);
    const row: Record<string, unknown> = {
      title: t,
      kind,
      doc_date: date || null,
      valid_from: from || null,
      valid_to: to || null,
      ref: ref.trim() || null,
      std_id: std || null,
      notes: notes.trim() || null,
    };
    if (file) {
      const safe = file.name.replace(/[^\w.\-()\s]+/g, "_").trim().slice(-120) || "file";
      const rnd = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Date.now().toString(36);
      const path = `${company.id}/tiep/documents/${rnd}-${safe}`;
      const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined });
      if (up.error) {
        setBusy(false);
        return setMsg("Could not upload the file: " + up.error.message);
      }
      Object.assign(row, { path, file_name: file.name, size: file.size });
    }
    const res = d
      ? await supabase
          .from("tiep_documents")
          .update({ ...row, updated_at: new Date().toISOString(), updated_by: user.id })
          .eq("id", d.id)
      : await supabase.from("tiep_documents").insert({ ...row, company_id: company.id, created_by: user.id });
    setBusy(false);
    if (res.error) return setMsg("Could not save the document: " + res.error.message);
    flash(`Saved ${t}.`);
    onClose();
    await reload();
  }

  async function remove() {
    if (!d || !window.confirm(`Delete ${d.title}?`)) return;
    const { error } = await supabase.from("tiep_documents").delete().eq("id", d.id);
    if (error) return setMsg("Could not delete: " + error.message);
    flash("Deleted.");
    onClose();
    await reload();
  }

  return (
    <Modal
      title={d ? "Edit document" : "Add document"}
      onClose={onClose}
      footer={
        <>
          {d && perm.documents.delete && (
            <button className="btn btn-danger mr-auto" type="button" onClick={() => void remove()}>
              Delete
            </button>
          )}
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <label className="field">
        Title
        <input className="control w-full" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="bar">
        <label className="field">
          Type
          <select className="control" value={kind} onChange={(e) => setKind(e.target.value as TiepDocument["kind"])}>
            {KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Dated
          <input className="control" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          Valid from
          <input className="control" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          Valid to
          <input className="control" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <div className="bar">
        <label className="field flex-1">
          Reference
          <input className="control w-full" value={ref} onChange={(e) => setRef(e.target.value)} />
        </label>
        <label className="field">
          Linked standard
          <select className="control" value={std} onChange={(e) => setStd(e.target.value)}>
            <option value="">—</option>
            {sts.map((s) => (
              <option key={s.id} value={s.id}>
                {stdShort(s)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        Notes
        <input className="control w-full" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {canUpload ? (
        <label className="field">
          {d?.path ? "Replace file (optional)" : "File (PDF or image)"}
          <input className="control" type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {d?.file_name && !file && <span className="text-[11px] text-muted">Current file: {d.file_name}</span>}
        </label>
      ) : (
        <p className="note m-0">You do not have upload permission on TIEP Settings, so the document is saved without a file.</p>
      )}
      {msg && <div className="msg msg-err">{msg}</div>}
    </Modal>
  );
}
