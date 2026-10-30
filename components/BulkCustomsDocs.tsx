"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import * as XLSX from "xlsx";
import { useApp } from "./AppShell";
import { fmt } from "@/lib/format";
import { CUSTOMS_DOC_KINDS, customsDoc, uploadCustomsDocument, type CustomsDocKind } from "@/lib/customsDocs";
import { heldDeclarations, matchReading, type FileReading, type HeldDeclaration, type MatchHow } from "@/lib/customsMatch";
import type { CustomsEntry, ReconDirection } from "@/lib/types";

/** One file going to one declaration (a bundle with two CusDecs gives two rows). */
interface Row {
  file: File;
  reading: FileReading | null;
  /** Declaration key, "" when not matched. */
  key: string;
  how: MatchHow | "chosen" | null;
  include: boolean;
  note: string | null;
}

const isSheet = (f: File) => /\.(xlsx|xls|csv)$/i.test(f.name);
const isDoc = (f: File) => /\.(pdf|jpe?g|png)$/i.test(f.name);

/** Readings by file name (lower case) from an index sheet: File, Cusdec No, Invoice No, Date, Value for VAT, VAT. */
async function readIndex(file: File): Promise<Map<string, FileReading[]>> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { raw: true, defval: null });
  const col = (r: Record<string, unknown>, ...names: string[]) => {
    const k = Object.keys(r).find((h) => names.includes(h.toLowerCase().replace(/[^a-z]/g, "")));
    return k ? r[k] : null;
  };
  const text = (v: unknown) => (v == null || String(v).trim() === "" ? null : String(v).trim());
  const num = (v: unknown) => {
    const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, ""));
    return v == null || v === "" || isNaN(n) ? null : n;
  };
  const out = new Map<string, FileReading[]>();
  for (const r of rows) {
    const name = text(col(r, "file", "filename"));
    if (!name) continue;
    const reading: FileReading = {
      cusdec_no: text(col(r, "cusdecno", "cusdec")),
      invoice_no: text(col(r, "invoiceno", "invoice")),
      cusdec_date: text(col(r, "date", "cusdecdate")),
      vat_base: num(col(r, "valueforvat", "vatbase")),
      vat_amount: num(col(r, "vat", "vatamount")),
    };
    const k = name.toLowerCase();
    out.set(k, [...(out.get(k) ?? []), reading]);
  }
  return out;
}

/** Read each declaration in a PDF with the CusDec reader (OCR for scans). */
async function readPdf(file: File, direction: ReconDirection, onText: (t: string) => void): Promise<FileReading[]> {
  const { readCusdecs } = await import("@/lib/cusdecRead");
  const read = await readCusdecs(await file.arrayBuffer(), direction, (p) => onText(p.text));
  return read.results.map((r) => ({
    cusdec_no: r.row.cusdec_no || null,
    invoice_no: r.row.invoice_no || null,
    cusdec_date: r.row.cusdec_date || null,
    vat_base: r.row.vat_base,
    vat_amount: r.row.vat_amount,
  }));
}

/**
 * Attach a folder of document files to the CusDecs already held: each file is matched to its
 * declaration by the CusDec number, invoice number or VAT figures read off it (or listed in an index
 * sheet chosen with the files), shown for checking, then uploaded to the chosen document slot.
 */
export default function BulkCustomsDocs({
  direction,
  entries,
  onDone,
}: {
  direction: ReconDirection;
  entries: CustomsEntry[];
  onDone: () => void | Promise<void>;
}) {
  const { supabase, company, flash } = useApp();
  const held = useMemo(() => heldDeclarations(entries), [entries]);
  const byKey = useMemo(() => new Map(held.map((d) => [d.key, d])), [held]);
  const [kind, setKind] = useState<CustomsDocKind>("all");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const all = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!all.length) return;
    setRows(null);
    const index = new Map<string, FileReading[]>();
    try {
      for (const s of all.filter(isSheet)) for (const [k, v] of await readIndex(s)) index.set(k, v);
    } catch (err) {
      flash("Could not read the index sheet: " + (err instanceof Error ? err.message : String(err)), true);
      return;
    }
    const docs = all.filter(isDoc).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const out: Row[] = [];
    for (let i = 0; i < docs.length; i++) {
      const file = docs[i];
      let readings = index.get(file.name.toLowerCase());
      let note: string | null = null;
      if (!readings && /\.pdf$/i.test(file.name)) {
        try {
          readings = await readPdf(file, direction, (t) => setBusy(`Reading ${i + 1} of ${docs.length}: ${file.name}: ${t}`));
        } catch (err) {
          note = "Could not be read: " + (err instanceof Error ? err.message : String(err));
        }
      }
      setBusy(`Reading ${i + 1} of ${docs.length}: ${file.name}`);
      const matched = new Set<string>();
      for (const reading of readings ?? []) {
        const m = matchReading(reading, held);
        if (m && matched.has(m.decl.key)) continue;
        if (m) matched.add(m.decl.key);
        out.push({ file, reading, key: m?.decl.key ?? "", how: m?.how ?? null, include: !!m, note });
      }
      if (!readings?.length) out.push({ file, reading: null, key: "", how: null, include: false, note: note ?? "No CusDec found in the file." });
    }
    setBusy(null);
    setRows(flagConflicts(out));
  }

  /** Only the first file going to a declaration is included; later ones are flagged. */
  function flagConflicts(list: Row[]): Row[] {
    const taken = new Map<string, string>();
    return list.map((r) => {
      if (!r.key || !r.include) return r;
      const first = taken.get(r.key);
      if (first && first !== r.file.name)
        return { ...r, include: false, note: `${first} also matches this CusDec; tick the one to keep.` };
      taken.set(r.key, r.file.name);
      return { ...r, note: r.note && /also matches/.test(r.note) ? null : r.note };
    });
  }

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs && rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const chosen = (rows ?? []).filter((r) => r.include && r.key);
  const duplicateTargets = chosen.length - new Set(chosen.map((r) => r.key)).size;

  async function upload() {
    if (!rows || !company || !chosen.length) return;
    let done = 0;
    const errors: string[] = [];
    for (let i = 0; i < chosen.length; i++) {
      const r = chosen[i];
      const d = byKey.get(r.key)!;
      setBusy(`Uploading ${i + 1} of ${chosen.length}: ${r.file.name}`);
      try {
        await uploadCustomsDocument(supabase, company.id, direction, d, kind, r.file, customsDoc(d.entry, kind)?.path);
        done++;
      } catch (err) {
        errors.push(`${r.file.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    setBusy(null);
    setRows(null);
    await onDone();
    const label = CUSTOMS_DOC_KINDS.find((k) => k.kind === kind)!.label.toLowerCase();
    flash(`${done} file${done === 1 ? "" : "s"} kept as ${label}.` + (errors.length ? ` Not kept: ${errors.join("; ")}` : ""), errors.length > 0);
  }

  const declLabel = (d: HeldDeclaration) => `${d.cusdec_no} · ${d.invoice_no}${d.cusdec_date ? " · " + d.cusdec_date : ""}`;
  const unmatched = (rows ?? []).filter((r) => !r.key).length;

  return (
    <details className="panel">
      <summary className="cursor-pointer text-[15px] font-semibold">Attach documents to CusDecs in bulk</summary>
      <div className="note mt-2">
        Choose a folder of document files (or several files), each a CusDec or a bundle of its papers. Each file is matched
        to a CusDec already in the register by the CusDec number, invoice number or VAT figures read off it; scans are read by
        OCR, about a minute a file, unless an index sheet chosen with the files (columns File, Cusdec No, Invoice No, Date,
        Value for VAT, VAT) lists them. Check the matches, then upload: a file already held in the slot is replaced.
      </div>
      <div className="bar">
        <label className="field">
          Keep as
          <select className="control" value={kind} disabled={!!busy} onChange={(e) => setKind(e.target.value as CustomsDocKind)}>
            {CUSTOMS_DOC_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Folder
          <input
            className="control file:mr-2 file:border-0 file:bg-transparent file:text-ink file:font-medium"
            type="file"
            disabled={!!busy}
            onChange={(e) => void onFiles(e)}
            {...{ webkitdirectory: "", directory: "" }}
          />
        </label>
        <label className="field">
          Files
          <input
            className="control file:mr-2 file:border-0 file:bg-transparent file:text-ink file:font-medium"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv"
            multiple
            disabled={!!busy}
            onChange={(e) => void onFiles(e)}
          />
        </label>
      </div>
      {busy && <div className="note">{busy}</div>}
      {rows && (
        <>
          <div className="msg">
            {rows.length} file{rows.length === 1 ? "" : "s"} read: {rows.length - unmatched} matched to a CusDec
            {unmatched ? `, ${unmatched} not matched (choose the CusDec or leave them out)` : ""}. {chosen.length} will be
            uploaded.
          </div>
          <div className="scroll max-h-[50vh]">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Upload</th>
                  <th>File</th>
                  <th>Read off the file</th>
                  <th>CusDec in the register</th>
                  <th>Matched by</th>
                  <th>Now held</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const d = r.key ? byKey.get(r.key) : undefined;
                  const now = d ? customsDoc(d.entry, kind) : null;
                  const rd = r.reading;
                  return (
                    <tr key={i} className={r.include ? undefined : "text-muted"}>
                      <td>
                        <input
                          type="checkbox"
                          checked={r.include}
                          disabled={!r.key || !!busy}
                          aria-label={`Upload ${r.file.name}`}
                          onChange={(e) => setRow(i, { include: e.target.checked })}
                        />
                      </td>
                      <td className="whitespace-nowrap">{r.file.name}</td>
                      <td className="wrapc">
                        {rd
                          ? [
                              rd.cusdec_no && `CusDec ${rd.cusdec_no}`,
                              rd.invoice_no && `invoice ${rd.invoice_no}`,
                              rd.cusdec_date,
                              rd.vat_amount != null && `VAT ${fmt(rd.vat_amount)}`,
                            ]
                              .filter(Boolean)
                              .join(" · ") || "—"
                          : "—"}
                      </td>
                      <td>
                        <select
                          className={"control max-w-[300px]" + (r.key ? "" : " border-bad")}
                          value={r.key}
                          disabled={!!busy}
                          aria-label={`CusDec for ${r.file.name}`}
                          onChange={(e) =>
                            setRows((rs) => rs && flagConflicts(rs.map((x, j) => (j === i ? { ...x, key: e.target.value, how: "chosen", include: !!e.target.value } : x))))
                          }
                        >
                          <option value="">— not matched —</option>
                          {held.map((h) => (
                            <option key={h.key} value={h.key}>
                              {declLabel(h)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="whitespace-nowrap">{r.how ?? ""}</td>
                      <td className="wrapc">{now ? <span title="Replaced on upload">{now.filename}</span> : <span className="text-muted">—</span>}</td>
                      <td className="wrapc">{r.note && <span className="text-warn">{r.note}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="bar">
            <button className="btn btn-primary" type="button" disabled={!!busy || !chosen.length || duplicateTargets > 0} onClick={() => void upload()}>
              Upload {chosen.length} file{chosen.length === 1 ? "" : "s"}
            </button>
            <button className="btn" type="button" disabled={!!busy} onClick={() => setRows(null)}>
              Cancel
            </button>
            {duplicateTargets > 0 && (
              <span className="note pb-1.5 text-warn">Two ticked files go to the same CusDec; untick one (a slot holds one file).</span>
            )}
          </div>
        </>
      )}
    </details>
  );
}

