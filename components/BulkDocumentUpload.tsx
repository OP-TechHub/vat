"use client";

import { useState, type ChangeEvent } from "react";
import { useApp } from "./AppShell";
import { mLabel, periodCode } from "@/lib/format";
import { DOC_KINDS, DOC_LABEL, uploadDocument } from "@/lib/documents";
import { matchDocuments, missingFiles, type IndexRow } from "@/lib/matchDocuments";
import { parseDocumentIndex } from "@/lib/parse";
import type { DocumentKind, ReturnDocument } from "@/lib/types";

interface Row {
  file: File;
  period: string; // "" = not matched
  kind: DocumentKind | "";
  source: "index" | "name" | "none";
}

const isIndex = (f: File) => /\.(xlsx|xls|csv)$/i.test(f.name);
const isDoc = (f: File) => /\.(pdf|jpe?g|png)$/i.test(f.name);

/**
 * Select a whole folder of returns and acknowledgements (plus its index sheet, if any) in one go.
 * Each file is matched to a period and a document type, shown for correction, then uploaded.
 */
export default function BulkDocumentUpload({
  periods,
  existing,
  canReplace,
  onDone,
}: {
  /** Period keys the register offers, oldest first. */
  periods: string[];
  existing: ReturnDocument[];
  /** Delete permission: documents already held may be replaced; otherwise those files are skipped. */
  canReplace: boolean;
  onDone: () => void;
}) {
  const { supabase, company, user, flash } = useApp();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setProblem(null);
    setRows(null);
    const docs = files.filter(isDoc);
    const indexes = files.filter(isIndex);
    const ignored = files.length - docs.length - indexes.length;
    let index: IndexRow[] = [];
    const notes: string[] = [];
    for (const f of indexes) {
      try {
        const got = parseDocumentIndex(await f.arrayBuffer());
        index = index.concat(got);
        notes.push(`Index “${f.name}”: ${got.length} entries.`);
      } catch (err) {
        notes.push(`“${f.name}” was not read as an index: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (!docs.length) {
      setProblem("No PDF or image files were selected." + (notes.length ? " " + notes.join(" ") : ""));
      return;
    }
    const byName = new Map(docs.map((f) => [f.name, f]));
    // One row per match; a file that is both return and acknowledgement appears twice.
    const out: Row[] = matchDocuments(
      docs.map((f) => f.name),
      index,
    ).map((m) => ({
      file: byName.get(m.name)!,
      period: m.period && periods.includes(m.period) ? m.period : "",
      kind: m.kind ?? "",
      source: m.source,
    }));
    const missing = missingFiles(
      docs.map((f) => f.name),
      index,
    );
    const unmatched = out.filter((r) => !r.period || !r.kind).length;
    notes.push(
      `${docs.length} documents selected, ${out.length - unmatched} matched to a period and type` +
        (unmatched ? `, ${unmatched} need a period or type below (drafts are left unmatched on purpose)` : "") +
        ".",
    );
    if (missing.length) notes.push(`${missing.length} index entries have no matching file: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}.`);
    if (ignored) notes.push(`${ignored} other files were ignored.`);
    setInfo(notes.join(" "));
    setRows(out);
  }

  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs && rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  /** Rows that will be uploaded: period and kind set, first one wins when two name the same slot. */
  const ready = (rows ?? []).reduce<{ i: number; dup: boolean }[]>((acc, r, i) => {
    if (!r.period || !r.kind) return acc;
    const dup = acc.some((a) => rows![a.i].period === r.period && rows![a.i].kind === r.kind && !a.dup);
    acc.push({ i, dup });
    return acc;
  }, []);
  const has = (period: string, kind: DocumentKind | "") =>
    !!kind && existing.some((d) => d.return_month.slice(0, 7) === period && d.kind === kind);
  const toUpload = ready.filter((x) => !x.dup && (canReplace || !has(rows![x.i].period, rows![x.i].kind)));

  async function upload() {
    if (!rows || !company) return;
    setProgress({ done: 0, total: toUpload.length });
    let ok = 0;
    const errors: string[] = [];
    for (const { i } of toUpload) {
      const r = rows[i];
      try {
        await uploadDocument(supabase, company.id, user.id, r.period, r.kind as DocumentKind, r.file);
        ok++;
      } catch (err) {
        errors.push(`${r.file.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
      setProgress({ done: ok + errors.length, total: toUpload.length });
    }
    setProgress(null);
    setRows(null);
    setInfo(null);
    flash(
      `Uploaded ${ok} of ${toUpload.length} documents.` + (errors.length ? ` Failed: ${errors.slice(0, 3).join("; ")}${errors.length > 3 ? "…" : ""}` : ""),
      errors.length > 0,
    );
    onDone();
  }

  return (
    <div className="panel">
      <h2 className="text-[15px] font-semibold m-0">Upload a folder of returns and acknowledgements</h2>
      <div className="note">
        Select every file in the folder at once, including its index sheet if there is one (Excel or CSV with a file
        name column and, if available, period and type columns). Each PDF or image is matched to a taxable period and
        a document type from the index, or else from its name (a month such as “Aug 2026” or “2026-08”, or the IRD
        period code, and “ack” for acknowledgements). Check the list, fix anything unmatched, then upload. A file for
        a period that already has that document replaces it.
      </div>
      <div className="bar">
        <label className="field">
          Files
          <input
            className="control file:mr-2 file:border-0 file:bg-transparent file:text-ink file:font-medium"
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv"
            disabled={!!progress}
            onChange={(e) => void onFiles(e)}
          />
        </label>
      </div>
      {problem && <div className="msg msg-err">{problem}</div>}
      {info && <div className="msg">{info}</div>}
      {rows && (
        <>
          <div className="scroll max-h-[40vh]">
            <table className="tbl">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Taxable period</th>
                  <th>Document</th>
                  <th>Matched by</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const slot = ready.find((x) => x.i === i);
                  return (
                    <tr key={r.file.name + i}>
                      <td className="wrapc">{r.file.name}</td>
                      <td>
                        <select className="control" value={r.period} disabled={!!progress} onChange={(e) => set(i, { period: e.target.value })}>
                          <option value="">Not matched</option>
                          {periods.map((m) => (
                            <option key={m} value={m}>
                              {mLabel(m)} · {periodCode(m)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select className="control" value={r.kind} disabled={!!progress} onChange={(e) => set(i, { kind: e.target.value as DocumentKind | "" })}>
                          <option value="">Not matched</option>
                          {DOC_KINDS.map((k) => (
                            <option key={k} value={k}>
                              {DOC_LABEL[k]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="text-muted">{r.source === "index" ? "Index" : r.source === "name" ? "File name" : "—"}</td>
                      <td>
                        {!r.period || !r.kind ? (
                          <span className="pill pill-warn">Will be skipped</span>
                        ) : slot?.dup ? (
                          <span className="pill pill-bad">Duplicate, skipped</span>
                        ) : has(r.period, r.kind) ? (
                          canReplace ? (
                            <span className="pill pill-info">Replaces existing</span>
                          ) : (
                            <span className="pill pill-warn">Already held, skipped (replacing needs delete permission)</span>
                          )
                        ) : (
                          <span className="pill pill-good">New</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="bar">
            <button className="btn btn-primary" type="button" disabled={!!progress || !toUpload.length} onClick={() => void upload()}>
              {progress ? `Uploading ${progress.done} of ${progress.total}…` : `Upload ${toUpload.length} documents`}
            </button>
            <button
              className="btn"
              type="button"
              disabled={!!progress}
              onClick={() => {
                setRows(null);
                setInfo(null);
              }}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
