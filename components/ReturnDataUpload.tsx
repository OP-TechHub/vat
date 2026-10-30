"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useApp } from "./AppShell";
import { parseReturnWorkbook, type ParsedReturns } from "@/lib/parse";

/**
 * Load the "VAT Return_Upload" workbook: every period's entered cages and submission date,
 * upserted into vat_returns. Ledger figures already entered for a period are kept.
 */
export default function ReturnDataUpload({ onSaved }: { onSaved?: (months: string[]) => void }) {
  const { supabase, company, reload, flash } = useApp();
  const [pending, setPending] = useState<ParsedReturns | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function onFile(e: ChangeEvent<HTMLInputElement>) {
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

  function clear() {
    setPending(null);
    setParseError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function save() {
    if (!pending || !company) return;
    setSaving(true);
    const { error } = await supabase.rpc("upload_vat_returns", { p_company: company.id, p_rows: pending.periods });
    setSaving(false);
    if (error) {
      flash(
        "Could not save: " +
          error.message +
          (/schema cache|function/i.test(error.message)
            ? ". Run supabase/migrations/0014_tab_permissions.sql in the Supabase SQL Editor first."
            : ""),
        true,
      );
      return;
    }
    flash(`Saved return data for ${pending.periods.length} periods.`);
    const months = pending.periods.map((p) => p.return_month.slice(0, 7));
    clear();
    await reload();
    onSaved?.(months);
  }

  return (
    <div className="panel">
      <h2 className="text-[15px] font-semibold m-0">Upload VAT return data</h2>
      <div className="note">
        The “VAT Return_Upload” workbook: one column per taxable period, the period’s first day in the “Taxable
        period” row, the acknowledgement date in the “Date of submission” row and the cage codes in column B. Every
        period in the file is saved, whatever the tax year selected above. Figures already entered for a period are
        replaced (which needs delete permission on this tab as well as upload); ledger figures are kept.
      </div>
      <div className="bar">
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
      </div>
      {parseError && <div className="msg msg-err">{parseError}</div>}
      {pending && (
        <>
          <div className="msg">{pending.text}</div>
          <div className="bar">
            <button className="btn btn-primary" type="button" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : `Save ${pending.periods.length} periods`}
            </button>
            <button className="btn" type="button" onClick={clear} disabled={saving}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
