"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useApp } from "./AppShell";
import { mLabel, monthKey, monthsBetween, periodCode } from "@/lib/format";
import { loadFiling, type FilingData } from "@/lib/data";
import { parseReturnWorkbook, type ParsedReturns } from "@/lib/parse";
import type { DocumentKind, ReturnDocument } from "@/lib/types";

/** First taxable period shown on the register. */
const FIRST_PERIOD = "2020-01";
const BUCKET = "vat-claims";
const DOC_LABEL: Record<DocumentKind, string> = { return: "Return", acknowledgement: "Acknowledgement" };
const ACCEPT = ".pdf,.jpg,.jpeg,.png";

type Filter = "" | "missing";

interface PeriodRow {
  month: string; // YYYY-MM
  hasData: boolean;
  submittedOn: string | null;
  docs: Partial<Record<DocumentKind, ReturnDocument>>;
}

export default function FilingView() {
  const { supabase, company, user, canWrite, reload, flash } = useApp();
  const [filing, setFiling] = useState<FilingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("");
  const [pending, setPending] = useState<ParsedReturns | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // "<month>:<kind>" while a document is changing
  const dataFileRef = useRef<HTMLInputElement>(null);
  const docFileRef = useRef<HTMLInputElement>(null);
  const docTarget = useRef<{ month: string; kind: DocumentKind } | null>(null);

  const load = useCallback(async () => {
    if (!company) {
      setFiling({ returns: [], documents: [] });
      return;
    }
    try {
      setFiling(await loadFiling(supabase, company.id));
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not load the filing register.";
      setError(
        /schema cache|does not exist/i.test(msg)
          ? `${msg}. Run supabase/migrations/0005_return_filing.sql in the Supabase SQL Editor (see README step 2).`
          : msg,
      );
      setFiling({ returns: [], documents: [] });
    }
  }, [supabase, company]);

  useEffect(() => {
    setFiling(null);
    setPending(null);
    setParseError(null);
    void load();
  }, [load]);

  // Every month from Jan 2020 to the current month, or later if data exists beyond it. Newest first.
  const rows = useMemo<PeriodRow[]>(() => {
    if (!filing) return [];
    const today = new Date().toISOString().slice(0, 7);
    const latest = [today, ...filing.returns.map((r) => monthKey(r.return_month)), ...filing.documents.map((d) => monthKey(d.return_month))]
      .sort()
      .pop()!;
    const byMonth: Record<string, PeriodRow> = {};
    for (const k of monthsBetween(FIRST_PERIOD, latest)) byMonth[k] = { month: k, hasData: false, submittedOn: null, docs: {} };
    for (const r of filing.returns) {
      const row = byMonth[monthKey(r.return_month)];
      if (row) {
        row.hasData = true;
        row.submittedOn = r.submitted_on ?? null;
      }
    }
    for (const d of filing.documents) {
      const row = byMonth[monthKey(d.return_month)];
      if (row) row.docs[d.kind] = d;
    }
    return Object.values(byMonth).reverse();
  }, [filing]);

  const shown = useMemo(
    () => (filter === "missing" ? rows.filter((r) => !r.hasData || !r.docs.return || !r.docs.acknowledgement) : rows),
    [rows, filter],
  );
  const count = (f: (r: PeriodRow) => boolean) => rows.filter(f).length;

  // ----- Return data upload (VAT Return_Upload workbook) -----
  function onDataFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError(null);
    setPending(null);
    const rd = new FileReader();
    rd.onload = () => {
      try {
        setPending(parseReturnWorkbook(rd.result as ArrayBuffer));
      } catch (err) {
        setParseError(err instanceof Error ? err.message : "Could not read the file.");
      }
    };
    rd.onerror = () => setParseError("Could not read the file.");
    rd.readAsArrayBuffer(file);
  }

  async function saveData() {
    if (!pending || !company) return;
    setSaving(true);
    const now = new Date().toISOString();
    const payload = pending.periods.map((p) => ({ ...p, company_id: company.id, updated_by: user.id, updated_at: now }));
    const { error: err } = await supabase.from("vat_returns").upsert(payload, { onConflict: "company_id,return_month" });
    setSaving(false);
    if (err) {
      flash("Could not save: " + err.message, true);
      return;
    }
    flash(`Saved return data for ${pending.periods.length} periods.`);
    setPending(null);
    if (dataFileRef.current) dataFileRef.current.value = "";
    await Promise.all([load(), reload()]);
  }

  function cancelData() {
    setPending(null);
    setParseError(null);
    if (dataFileRef.current) dataFileRef.current.value = "";
  }

  // ----- Return / acknowledgement documents -----
  function pickDocument(month: string, kind: DocumentKind) {
    docTarget.current = { month, kind };
    docFileRef.current?.click();
  }

  async function onDocFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const target = docTarget.current;
    e.target.value = "";
    if (!file || !target || !company) return;
    const { month, kind } = target;
    const key = month + ":" + kind;
    setBusy(key);
    const safe = file.name.replace(/[^\w.\-()\s]+/g, "_").slice(-120);
    const path = `${company.id}/${month}/${kind}/${safe}`;
    const existing = rows.find((r) => r.month === month)?.docs[kind];
    try {
      if (existing && existing.path !== path) await supabase.storage.from(BUCKET).remove([existing.path]);
      const up = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type || undefined });
      if (up.error) throw new Error(up.error.message);
      const row: ReturnDocument = {
        company_id: company.id,
        return_month: month + "-01",
        kind,
        path,
        filename: file.name,
        uploaded_at: new Date().toISOString(),
        uploaded_by: user.id,
      };
      const { error: err } = await supabase.from("return_documents").upsert(row, { onConflict: "company_id,return_month,kind" });
      if (err) throw new Error(err.message);
      flash(`${DOC_LABEL[kind]} for ${mLabel(month)} uploaded.`);
      await load();
    } catch (err) {
      flash("Could not upload: " + (err instanceof Error ? err.message : String(err)), true);
    }
    setBusy(null);
  }

  async function openDocument(doc: ReturnDocument) {
    const { data, error: err } = await supabase.storage.from(BUCKET).createSignedUrl(doc.path, 300);
    if (err || !data?.signedUrl) {
      flash("Could not open the file: " + (err?.message ?? "no link returned"), true);
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  async function removeDocument(month: string, doc: ReturnDocument) {
    if (!company) return;
    if (!window.confirm(`Remove the ${DOC_LABEL[doc.kind].toLowerCase()} for ${mLabel(month)} (${doc.filename})?`)) return;
    const key = month + ":" + doc.kind;
    setBusy(key);
    try {
      const rm = await supabase.storage.from(BUCKET).remove([doc.path]);
      if (rm.error) throw new Error(rm.error.message);
      const { error: err } = await supabase
        .from("return_documents")
        .delete()
        .eq("company_id", company.id)
        .eq("return_month", doc.return_month)
        .eq("kind", doc.kind);
      if (err) throw new Error(err.message);
      flash(`${DOC_LABEL[doc.kind]} for ${mLabel(month)} removed.`);
      await load();
    } catch (err) {
      flash("Could not remove: " + (err instanceof Error ? err.message : String(err)), true);
    }
    setBusy(null);
  }

  const YesNo = ({ yes }: { yes: boolean }) => (
    <span className={"pill " + (yes ? "pill-good" : "pill-warn")}>{yes ? "Yes" : "No"}</span>
  );

  const DocCell = ({ r, kind }: { r: PeriodRow; kind: DocumentKind }) => {
    const doc = r.docs[kind];
    const isBusy = busy === r.month + ":" + kind;
    return (
      <td className={isBusy ? "opacity-60" : undefined}>
        <div className="flex flex-wrap items-center gap-2">
          <YesNo yes={!!doc} />
          {doc && (
            <button className="btn" type="button" onClick={() => void openDocument(doc)} title={doc.filename}>
              Open
            </button>
          )}
          {canWrite && (
            <>
              <button className="btn" type="button" disabled={isBusy} onClick={() => pickDocument(r.month, kind)}>
                {doc ? "Replace" : "Upload"}
              </button>
              {doc && (
                <button className="btn btn-danger" type="button" disabled={isBusy} onClick={() => void removeDocument(r.month, doc)}>
                  Remove
                </button>
              )}
            </>
          )}
        </div>
      </td>
    );
  };

  return (
    <>
      {canWrite && (
        <div className="panel">
          <h2 className="text-[15px] font-semibold m-0">Upload return data</h2>
          <div className="note">
            The “VAT Return_Upload” workbook: one column per taxable period with the period’s first day in the
            “Taxable period” row, the acknowledgement date in the “Date of submission” row and the cage codes in
            column B. Cages D, E, H, 4, 5, I, 6, 8 and 10 are taken for every period in the file and shown on the
            VAT reconciliation tab. Ledger figures already entered for a period are kept.
          </div>
          <div className="bar">
            <label className="field">
              File
              <input
                ref={dataFileRef}
                className="control file:mr-2 file:border-0 file:bg-transparent file:text-ink file:font-medium"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={onDataFile}
              />
            </label>
          </div>
          {parseError && <div className="msg msg-err">{parseError}</div>}
          {pending && (
            <>
              <div className="msg">{pending.text}</div>
              <div className="bar">
                <button className="btn btn-primary" type="button" onClick={() => void saveData()} disabled={saving}>
                  {saving ? "Saving…" : `Save ${pending.periods.length} periods`}
                </button>
                <button className="btn" type="button" onClick={cancelData} disabled={saving}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <input ref={docFileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => void onDocFile(e)} />

      <div className="bar">
        <label className="field">
          Show
          <select className="control" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="">All periods</option>
            <option value="missing">Periods with something missing</option>
          </select>
        </label>
        {filing && (
          <span className="note pb-1.5">
            {rows.length} periods from {mLabel(FIRST_PERIOD)} · data {count((r) => r.hasData)} · returns{" "}
            {count((r) => !!r.docs.return)} · acknowledgements {count((r) => !!r.docs.acknowledgement)}
          </span>
        )}
      </div>

      {error && <div className="msg msg-err">{error}</div>}

      <div className="scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Period code</th>
              <th>Taxable period</th>
              <th>Submitted on</th>
              <th>Data uploaded</th>
              <th>Return uploaded</th>
              <th>Acknowledgement uploaded</th>
            </tr>
          </thead>
          <tbody>
            {!filing ? (
              <tr>
                <td colSpan={6} className="note">
                  Loading records…
                </td>
              </tr>
            ) : !shown.length ? (
              <tr>
                <td colSpan={6} className="note">
                  Every period has its data, return and acknowledgement.
                </td>
              </tr>
            ) : (
              shown.map((r) => (
                <tr key={r.month}>
                  <td className="font-mono">{periodCode(r.month)}</td>
                  <td>{mLabel(r.month)}</td>
                  <td className={r.submittedOn ? "" : "text-muted"}>{r.submittedOn ?? "—"}</td>
                  <td>
                    <YesNo yes={r.hasData} />
                  </td>
                  <DocCell r={r} kind="return" />
                  <DocCell r={r} kind="acknowledgement" />
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="note">
        Period code is the IRD format YYQM (year, quarter, month within the quarter). Data uploaded is Yes when the
        period’s return figures are held, from the workbook above or entered on the VAT reconciliation tab. Return and
        acknowledgement are Yes when a document (PDF or image, up to 25 MB) is held for the period; Open gives a link
        that works for five minutes.
      </div>
    </>
  );
}
