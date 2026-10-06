"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useApp } from "./AppShell";
import { mLabel, monthStart, monthsOf } from "@/lib/format";
import {
  parseLedger,
  parseSchedule,
  templateFilename,
  templateWorkbook,
  type ParsedUpload,
  type UploadKind,
} from "@/lib/parse";
import { downloadWorkbook } from "@/lib/download";
import type { LedgerUploadRow, ScheduleUploadRow } from "@/lib/types";

type Pending = ParsedUpload<LedgerUploadRow> | ParsedUpload<ScheduleUploadRow>;

const COPY: Record<UploadKind, { title: string; note: string; rpc: string }> = {
  ledger: {
    title: "Upload a month’s ledger invoice list",
    note:
      "Excel or CSV with columns Invoice No. (or Document No.), Posting Date, Vendor Name, External Document No., Description, Amount (LCY). Only rows posted in the chosen month are taken. Original-invoice marks and claimed-month overrides already entered are kept.",
    rpc: "replace_ledger_month",
  },
  schedule: {
    title: "Upload a month’s IRD input schedule",
    note:
      "Excel or CSV with columns Serial No, Invoice Date, Tax Invoice No, Supplier’s TIN, Name of the Supplier, Description, Value of purchase, VAT Amount. If the file has a Month column, only the chosen month’s rows are taken. A blank VAT Amount is taken as 18% of the value.",
    rpc: "replace_schedule_month",
  },
};

/**
 * Pick a month and a file, preview what was parsed, then confirm to replace that month's rows.
 * Rendered only for editors and admins.
 */
export default function UploadPanel({
  kind,
  month,
  onMonthChange,
  existingCount,
  onSaved,
}: {
  kind: UploadKind;
  month: string;
  onMonthChange: (m: string) => void;
  /** Rows already held for a month, shown in the preview. */
  existingCount: (month: string) => number;
  onSaved?: (month: string) => void;
}) {
  const { supabase, company, year, reload, flash } = useApp();
  const [pending, setPending] = useState<Pending | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const months = monthsOf(year);

  // Discard any preview when the month or company changes.
  useEffect(() => {
    setPending(null);
    setParseError(null);
    if (fileRef.current) fileRef.current.value = "";
  }, [month, company?.id, year]);

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError(null);
    setPending(null);
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const buf = rd.result as ArrayBuffer;
        const existing = existingCount(month);
        setPending(
          kind === "ledger" ? parseLedger(buf, month, existing) : parseSchedule(buf, month, existing),
        );
      } catch (err) {
        setParseError(err instanceof Error ? err.message : "Could not read the file.");
      }
    };
    rd.onerror = () => setParseError("Could not read the file.");
    rd.readAsArrayBuffer(file);
  }

  async function save() {
    if (!pending || !company) return;
    setSaving(true);
    const { error } = await supabase.rpc(COPY[kind].rpc, {
      p_company: company.id,
      p_month: monthStart(pending.month),
      p_rows: pending.rows,
    });
    if (error) {
      flash("Could not save: " + error.message, true);
      setSaving(false);
      return;
    }
    await reload();
    flash(`Saved ${pending.rows.length} rows to ${mLabel(pending.month)}.`);
    const saved = pending.month;
    setPending(null);
    setSaving(false);
    if (fileRef.current) fileRef.current.value = "";
    onSaved?.(saved);
  }

  function cancel() {
    setPending(null);
    setParseError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function template() {
    downloadWorkbook(templateWorkbook(kind), templateFilename(kind));
  }

  return (
    <div className="panel">
      <h2 className="text-[15px] font-semibold m-0">{COPY[kind].title}</h2>
      <div className="note">{COPY[kind].note}</div>
      <div className="bar">
        <label className="field">
          Month
          <select className="control" value={month} onChange={(e) => onMonthChange(e.target.value)}>
            {months.map((k) => (
              <option key={k} value={k}>
                {mLabel(k)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          File
          <input
            ref={fileRef}
            className="control file:mr-2 file:border-0 file:bg-transparent file:text-ink file:font-medium"
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={onFile}
          />
        </label>
        <button className="btn" type="button" onClick={template}>
          Download template
        </button>
      </div>
      {parseError && <div className="msg msg-err">{parseError}</div>}
      {pending && (
        <>
          <div className="msg">{pending.text}</div>
          <div className="bar">
            <button className="btn btn-primary" type="button" onClick={save} disabled={saving}>
              {saving ? "Saving…" : `Save ${pending.rows.length} rows to ${mLabel(pending.month)}`}
            </button>
            <button className="btn" type="button" onClick={cancel} disabled={saving}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
