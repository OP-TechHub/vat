"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useApp } from "./AppShell";
import { customsTemplateFilename, customsTemplateWorkbook, parseCustoms } from "@/lib/parse";
import { downloadWorkbook } from "@/lib/download";
import { fmt } from "@/lib/format";
import type { CustomsUploadRow, ReconDirection } from "@/lib/types";

interface Pending {
  rows: CustomsUploadRow[];
  /** Per-row notes from the PDF reader (empty for spreadsheet rows). */
  notes: string[][];
  text: string;
  source: "sheet" | "pdf";
}

/**
 * Upload customs entries (CusDec lines) from a spreadsheet or straight from CusDec PDFs. They are
 * stored and matched to the export sales / import purchase rows by invoice number, filling the
 * "As per customs" columns; rows uploaded later are filled the same way.
 */
export default function CustomsUpload({ direction }: { direction: ReconDirection }) {
  const { supabase, company, reload, flash } = useApp();
  const [pending, setPending] = useState<Pending | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // "Reading 2 of 5…" or "Saving…"
  const sheetRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const noun = direction === "import" ? "import" : "export";
  const isImport = direction === "import";

  function onSheet(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError(null);
    setPending(null);
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const p = parseCustoms(rd.result as ArrayBuffer, direction);
        setPending({ rows: p.rows, notes: p.rows.map(() => []), text: p.text, source: "sheet" });
      } catch (err) {
        setParseError(err instanceof Error ? err.message : "Could not read the file.");
      }
    };
    rd.onerror = () => setParseError("Could not read the file.");
    rd.readAsArrayBuffer(file);
  }

  async function onPdfs(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setParseError(null);
    setPending(null);
    const rows: CustomsUploadRow[] = [];
    const notes: string[][] = [];
    const failed: string[] = [];
    try {
      const [{ extractTextItems }, { parseCusdec }] = await Promise.all([import("@/lib/pdfText"), import("@/lib/cusdec")]);
      for (let i = 0; i < files.length; i++) {
        const label = `${i + 1} of ${files.length}: ${files[i].name}`;
        setBusy(`Reading ${label}…`);
        try {
          const buf = await files[i].arrayBuffer();
          let items = await extractTextItems(buf);
          let scanned = false;
          if (items.length < 20) {
            // No text layer: a scan. Read the page images with OCR (slower; a few seconds per page).
            scanned = true;
            const { ocrPdfToTextItems } = await import("@/lib/ocr");
            items = await ocrPdfToTextItems(buf, (p) =>
              setBusy(`Reading ${label} with OCR, page ${p.page} of ${p.pages}, ${Math.round(p.progress * 100)}%…`),
            );
          }
          const r = parseCusdec(items, direction, { loose: scanned });
          if (!r.row.cusdec_no && !r.row.invoice_value) {
            failed.push(`${files[i].name}: no CusDec found${scanned ? " even with OCR; check the scan is upright and legible" : ""}.`);
            continue;
          }
          rows.push(r.row);
          notes.push([`From ${files[i].name}${scanned ? " (scanned, read by OCR: check every figure)" : ""}`, ...r.warnings]);
        } catch (err) {
          failed.push(`${files[i].name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      setParseError("The PDF reader could not be loaded: " + (err instanceof Error ? err.message : String(err)));
      setBusy(null);
      return;
    }
    setBusy(null);
    if (!rows.length) {
      setParseError(failed.join(" ") || "No CusDecs could be read.");
      return;
    }
    const value = rows.reduce((t, r) => t + (r.customs_value ?? 0), 0);
    setPending({
      rows,
      notes,
      source: "pdf",
      text:
        `${rows.length} CusDec${rows.length === 1 ? "" : "s"} read, customs value ${fmt(value)}. Check the invoice numbers below, then save.` +
        (failed.length ? ` Not read: ${failed.join(" ")}` : ""),
    });
  }

  function clear() {
    setPending(null);
    setParseError(null);
    if (sheetRef.current) sheetRef.current.value = "";
    if (pdfRef.current) pdfRef.current.value = "";
  }

  const setRow = (i: number, patch: Partial<CustomsUploadRow>) =>
    setPending((p) => p && { ...p, rows: p.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  const incomplete = (pending?.rows ?? []).filter((r) => !r.cusdec_no.trim() || !r.invoice_no.trim()).length;

  async function save() {
    if (!pending || !company || incomplete) return;
    setBusy("Saving…");
    const { data, error } = await supabase.rpc("replace_customs_entries", {
      p_company: company.id,
      p_direction: direction,
      p_rows: pending.rows.map((r) => ({ ...r, cusdec_no: r.cusdec_no.trim(), invoice_no: r.invoice_no.trim() })),
    });
    setBusy(null);
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
        isImport ? "purchase" : "sales"
      } invoices were filled in.`,
    );
  }

  return (
    <div className="panel">
      <h2 className="text-[15px] font-semibold m-0">Upload {noun} customs entries</h2>
      <div className="note">
        Either choose the CusDec PDFs themselves (the ASYCUDA goods declaration printouts, several at once) and the
        app reads the customs reference, date, currency, amount, exchange rate, statistical value
        {isImport ? ", VAT" : ""}, {isImport ? "supplier" : "consignee"} and goods from each form, or choose a
        spreadsheet of CusDec lines with columns Cusdec No, Date, Invoice No, Currency, Ex. Rate, Invoice Value (FC),
        Customs Value (LKR){isImport ? ", VAT Amount" : ""}, {isImport ? "Supplier" : "Consignee"}, Description. Each
        entry is matched to the {isImport ? "purchase" : "sales"} row with the same invoice number and its “As per
        customs” columns are filled in. Entries are kept, so a month uploaded later is filled too. The same CusDec and
        invoice number uploaded again updates the earlier entry.
      </div>
      <div className="bar">
        <label className="field">
          CusDec PDFs
          <input
            ref={pdfRef}
            className="control file:mr-2 file:border-0 file:bg-transparent file:text-ink file:font-medium"
            type="file"
            accept=".pdf"
            multiple
            disabled={!!busy}
            onChange={(e) => void onPdfs(e)}
          />
        </label>
        <label className="field">
          Spreadsheet
          <input
            ref={sheetRef}
            className="control file:mr-2 file:border-0 file:bg-transparent file:text-ink file:font-medium"
            type="file"
            accept=".xlsx,.xls,.csv"
            disabled={!!busy}
            onChange={onSheet}
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
      {busy && busy !== "Saving…" && <div className="note">{busy}</div>}
      {parseError && <div className="msg msg-err">{parseError}</div>}
      {pending && (
        <>
          <div className="msg">{pending.text}</div>
          <div className="scroll max-h-[36vh]">
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
                  {isImport && <th className="num">VAT</th>}
                  <th>{isImport ? "Supplier" : "Consignee"}</th>
                  {pending.source === "pdf" && <th>Notes</th>}
                </tr>
              </thead>
              <tbody>
                {pending.rows.slice(0, 200).map((r, i) => (
                  <tr key={i}>
                    <td>
                      {pending.source === "pdf" ? (
                        <input
                          className="control w-[100px]"
                          value={r.cusdec_no}
                          aria-label={`CusDec number, row ${i + 1}`}
                          onChange={(e) => setRow(i, { cusdec_no: e.target.value })}
                        />
                      ) : (
                        r.cusdec_no
                      )}
                    </td>
                    <td>{r.cusdec_date}</td>
                    <td>
                      <input
                        className={"control w-[150px]" + (r.invoice_no.trim() ? "" : " border-bad")}
                        value={r.invoice_no}
                        aria-label={`Invoice number, row ${i + 1}`}
                        placeholder="Required"
                        onChange={(e) => setRow(i, { invoice_no: e.target.value })}
                      />
                    </td>
                    <td>{r.currency_type}</td>
                    <td className="num">{r.ex_rate ?? ""}</td>
                    <td className="num">{r.invoice_value == null ? "" : fmt(r.invoice_value)}</td>
                    <td className="num">{r.customs_value == null ? "" : fmt(r.customs_value)}</td>
                    {isImport && <td className="num">{r.vat_amount == null ? "" : fmt(r.vat_amount)}</td>}
                    <td className="wrapc">{r.party}</td>
                    {pending.source === "pdf" && (
                      <td className="wrapc">
                        {pending.notes[i]?.map((n, j) => (
                          <div key={j} className={j === 0 ? "text-muted" : "diffx font-normal"}>
                            {n}
                          </div>
                        ))}
                      </td>
                    )}
                  </tr>
                ))}
                {pending.rows.length > 200 && (
                  <tr>
                    <td colSpan={10} className="note">
                      … and {pending.rows.length - 200} more rows.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="bar">
            <button className="btn btn-primary" type="button" onClick={() => void save()} disabled={!!busy || incomplete > 0}>
              {busy === "Saving…" ? "Saving…" : `Save ${pending.rows.length} entries and fill customs columns`}
            </button>
            <button className="btn" type="button" onClick={clear} disabled={!!busy}>
              Cancel
            </button>
            {incomplete > 0 && (
              <span className="note pb-1.5">
                {incomplete} row{incomplete === 1 ? " needs" : "s need"} a CusDec number and an invoice number before saving.
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
