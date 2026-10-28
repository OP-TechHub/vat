"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useApp } from "./AppShell";
import { customsTemplateFilename, customsTemplateWorkbook, parseCustoms } from "@/lib/parse";
import { downloadWorkbook } from "@/lib/download";
import type { CustomsUploadRow, ReconDirection } from "@/lib/types";

/**
 * Upload customs entries (CusDec lines). They are stored and matched to the export sales / import
 * purchase rows by invoice number, filling the "As per customs" columns; rows uploaded later are
 * filled the same way.
 */
export default function CustomsUpload({ direction }: { direction: ReconDirection }) {
  const { supabase, company, reload, flash } = useApp();
  const [pending, setPending] = useState<{ rows: CustomsUploadRow[]; text: string } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const noun = direction === "import" ? "import" : "export";

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError(null);
    setPending(null);
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const p = parseCustoms(rd.result as ArrayBuffer, direction);
        setPending({ rows: p.rows, text: p.text });
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
    const { data, error } = await supabase.rpc("replace_customs_entries", {
      p_company: company.id,
      p_direction: direction,
      p_rows: pending.rows,
    });
    setSaving(false);
    if (error) {
      flash(
        "Could not save: " +
          error.message +
          (/schema cache|function/i.test(error.message) ? ". Run supabase/migrations/0008_customs_entries.sql in the Supabase SQL Editor first." : ""),
        true,
      );
      return;
    }
    const r = (data ?? {}) as { entries?: number; applied?: number };
    const n = pending.rows.length;
    clear();
    await reload();
    flash(
      `Saved ${r.entries ?? n} ${noun} customs entries; the customs columns of ${r.applied ?? 0} matching ${
        direction === "import" ? "purchase" : "sales"
      } invoices were filled in.`,
    );
  }

  return (
    <div className="panel">
      <h2 className="text-[15px] font-semibold m-0">Upload {noun} customs entries</h2>
      <div className="note">
        Excel or CSV of CusDec lines with columns Cusdec No, Date, Invoice No, Currency, Ex. Rate, Invoice Value (FC),
        Customs Value (LKR){direction === "import" ? ", VAT Amount" : ""}, {direction === "import" ? "Supplier" : "Consignee"} and
        Description. Headings are matched by name, so extra columns are fine. Each entry is matched to the{" "}
        {direction === "import" ? "purchase" : "sales"} row with the same invoice number and its “As per customs” columns
        are filled in. Entries are kept, so a month uploaded later is filled too. Re-uploading an entry with the same
        CusDec and invoice number updates it.
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
        <button
          className="btn"
          type="button"
          onClick={() => downloadWorkbook(customsTemplateWorkbook(direction), customsTemplateFilename(direction))}
        >
          Download template
        </button>
      </div>
      {parseError && <div className="msg msg-err">{parseError}</div>}
      {pending && (
        <>
          <div className="msg">{pending.text}</div>
          <div className="scroll max-h-[32vh]">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Cusdec no</th>
                  <th>Date</th>
                  <th>Invoice no</th>
                  <th>Currency</th>
                  <th className="num">Ex. rate</th>
                  <th className="num">Invoice value (FC)</th>
                  <th className="num">Customs value (LKR)</th>
                  {direction === "import" && <th className="num">VAT</th>}
                  <th>{direction === "import" ? "Supplier" : "Consignee"}</th>
                </tr>
              </thead>
              <tbody>
                {pending.rows.slice(0, 200).map((r, i) => (
                  <tr key={i}>
                    <td>{r.cusdec_no}</td>
                    <td>{r.cusdec_date}</td>
                    <td>{r.invoice_no}</td>
                    <td>{r.currency_type}</td>
                    <td className="num">{r.ex_rate ?? ""}</td>
                    <td className="num">{r.invoice_value ?? ""}</td>
                    <td className="num">{r.customs_value ?? ""}</td>
                    {direction === "import" && <td className="num">{r.vat_amount ?? ""}</td>}
                    <td className="wrapc">{r.party}</td>
                  </tr>
                ))}
                {pending.rows.length > 200 && (
                  <tr>
                    <td colSpan={9} className="note">
                      … and {pending.rows.length - 200} more rows.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="bar">
            <button className="btn btn-primary" type="button" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : `Save ${pending.rows.length} entries and fill customs columns`}
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
