"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useApp } from "./AppShell";
import { mLabel, monthKey, monthsBetween, periodCode } from "@/lib/format";
import { loadFiling, type FilingData } from "@/lib/data";
import { DOC_ACCEPT, DOC_LABEL, documentUrl, isMissingTable, removeDocument, uploadDocument } from "@/lib/documents";
import type { DocumentKind, ReturnDocument } from "@/lib/types";

/** First taxable period shown on the register. */
const FIRST_PERIOD = "2020-01";

type Filter = "" | "missing";

interface PeriodRow {
  month: string; // YYYY-MM
  hasData: boolean;
  submittedOn: string | null;
  docs: Partial<Record<DocumentKind, ReturnDocument>>;
}

export default function FilingView() {
  const { supabase, company, user, canWrite, flash } = useApp();
  const [filing, setFiling] = useState<FilingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("");
  const [from, setFrom] = useState(""); // taxable period range, "" = open-ended
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // "<month>:<kind>" while a document is changing
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
        isMissingTable(e)
          ? `${msg}. Run supabase/migrations/0005_return_filing.sql in the Supabase SQL Editor (see README step 2).`
          : msg,
      );
      setFiling({ returns: [], documents: [] });
    }
  }, [supabase, company]);

  useEffect(() => {
    setFiling(null);
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

  // Oldest first for the period selectors.
  const periodKeys = useMemo(() => rows.map((r) => r.month).reverse(), [rows]);
  const shown = useMemo(() => {
    const lo = from && to && from > to ? to : from;
    const hi = from && to && from > to ? from : to;
    let r = rows;
    if (lo) r = r.filter((x) => x.month >= lo);
    if (hi) r = r.filter((x) => x.month <= hi);
    if (filter === "missing") r = r.filter((x) => !x.hasData || !x.docs.return || !x.docs.acknowledgement);
    return r;
  }, [rows, filter, from, to]);
  const count = (f: (r: PeriodRow) => boolean) => rows.filter(f).length;

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
    setBusy(month + ":" + kind);
    try {
      await uploadDocument(supabase, company.id, user.id, month, kind, file, rows.find((r) => r.month === month)?.docs[kind]);
      flash(`${DOC_LABEL[kind]} for ${mLabel(month)} uploaded.`);
      await load();
    } catch (err) {
      flash("Could not upload: " + (err instanceof Error ? err.message : String(err)), true);
    }
    setBusy(null);
  }

  async function openDocument(doc: ReturnDocument) {
    try {
      window.open(await documentUrl(supabase, doc), "_blank", "noopener");
    } catch (err) {
      flash("Could not open the file: " + (err instanceof Error ? err.message : String(err)), true);
    }
  }

  async function remove(month: string, doc: ReturnDocument) {
    if (!window.confirm(`Remove the ${DOC_LABEL[doc.kind].toLowerCase()} for ${mLabel(month)} (${doc.filename})?`)) return;
    setBusy(month + ":" + doc.kind);
    try {
      await removeDocument(supabase, doc);
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
                <button className="btn btn-danger" type="button" disabled={isBusy} onClick={() => void remove(r.month, doc)}>
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
      <input ref={docFileRef} type="file" accept={DOC_ACCEPT} className="hidden" onChange={(e) => void onDocFile(e)} />

      <div className="bar">
        <label className="field">
          Taxable period from
          <select className="control" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">{mLabel(FIRST_PERIOD)} (first)</option>
            {periodKeys.map((m) => (
              <option key={m} value={m}>
                {mLabel(m)} · {periodCode(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          To
          <select className="control" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Latest</option>
            {periodKeys.map((m) => (
              <option key={m} value={m}>
                {mLabel(m)} · {periodCode(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Show
          <select className="control" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="">All periods</option>
            <option value="missing">Periods with something missing</option>
          </select>
        </label>
        {(from || to) && (
          <button
            className="btn"
            type="button"
            onClick={() => {
              setFrom("");
              setTo("");
            }}
          >
            Clear range
          </button>
        )}
        {filing && (
          <span className="note pb-1.5">
            {shown.length === rows.length ? `${rows.length} periods` : `${shown.length} of ${rows.length} periods`} from{" "}
            {mLabel(FIRST_PERIOD)} · data {count((r) => r.hasData)} · returns {count((r) => !!r.docs.return)} ·
            acknowledgements {count((r) => !!r.docs.acknowledgement)}
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
                  {filter === "missing"
                    ? "Every period in this range has its data, return and acknowledgement."
                    : "No periods in this range."}
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
        Period code is the IRD code for the taxable period, as on the return. Data uploaded is Yes when the
        period’s return figures are held; load the “VAT Return_Upload” workbook or enter figures on the{" "}
        <Link href="/returns" className="underline">
          VAT reconciliation
        </Link>{" "}
        tab. Return and acknowledgement are Yes when a document (PDF or image, up to 25 MB) is held for the period;
        Open gives a link that works for five minutes.
      </div>
    </>
  );
}
