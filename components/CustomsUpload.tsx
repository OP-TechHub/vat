"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useApp } from "./AppShell";
import { customsTemplateFilename, customsTemplateWorkbook, parseCustoms } from "@/lib/parse";
import { downloadWorkbook } from "@/lib/download";
import { CUSTOMS_DOC_KINDS, uploadCustomsDocument, type CustomsDocKind } from "@/lib/customsDocs";
import { fmt } from "@/lib/format";
import type { CustomsUploadRow, ReconDirection } from "@/lib/types";

type RowDocs = Partial<Record<CustomsDocKind, File>>;

/** Declaration a review row belongs to: its CusDec and invoice numbers. */
const declKey = (r: CustomsUploadRow) => r.cusdec_no.trim() + "|" + r.invoice_no.trim();

interface Pending {
  rows: CustomsUploadRow[];
  /** Per-row notes from the PDF reader (empty for spreadsheet rows). */
  notes: string[][];
  /**
   * Files to keep with each row's declaration on save, by slot: a CusDec PDF goes in as the CusDec (or as all
   * documents when it is a bundle); more can be attached in the review table, for spreadsheet rows too.
   */
  docs: RowDocs[];
  text: string;
  source: "sheet" | "pdf";
}

/**
 * Upload customs entries (CusDec lines) from a spreadsheet or straight from CusDec PDFs. They are
 * stored and matched to the export sales / import purchase rows by invoice number, filling the
 * "As per customs" columns; rows uploaded later are filled the same way.
 */
/** Text or number box that writes back when it loses focus or Enter is pressed; Escape restores the value. */
function NumOrText({
  value,
  kind,
  className,
  label,
  onCommit,
}: {
  value: string;
  kind: "text" | "num";
  className?: string;
  label: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <input
      className={"control " + (kind === "num" ? "text-right font-mono tabular-nums " : "") + (className ?? "")}
      type="text"
      inputMode={kind === "num" ? "decimal" : undefined}
      value={draft}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(value);
      }}
    />
  );
}

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
        setPending({ rows: p.rows, notes: p.rows.map(() => []), docs: p.rows.map(() => ({})), text: p.text, source: "sheet" });
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
    const rowDocs: RowDocs[] = [];
    const pdfFiles: File[] = [];
    const failed: string[] = [];
    try {
      const { readCusdecs } = await import("@/lib/cusdecRead");
      for (let i = 0; i < files.length; i++) {
        const label = `${i + 1} of ${files.length}: ${files[i].name}`;
        setBusy(`Reading ${label}…`);
        try {
          // A printout, a scanned bundle (invoice, packing list, CusDec...) or a plain scan: the CusDec
          // pages are found and read, by OCR when there is no usable text layer.
          const read = await readCusdecs(await files[i].arrayBuffer(), direction, (p) => setBusy(`${label}: ${p.text}`));
          const found = read.results.filter((r) => r.row.cusdec_no || r.row.invoice_value != null);
          if (!found.length) {
            failed.push(
              `${files[i].name}: no CusDec found in its ${read.pageCount} page${read.pageCount === 1 ? "" : "s"}${read.scanned ? " even with OCR; check the scan is upright and legible" : ""}.`,
            );
            continue;
          }
          found.forEach((r, d) => {
            const pages = read.pages[read.results.indexOf(r)] ?? [];
            const where =
              read.pageCount > pages.length && pages.length ? ` (page${pages.length === 1 ? "" : "s"} ${pages.join(", ")} of ${read.pageCount})` : "";
            const which = found.length > 1 ? `, CusDec ${d + 1} of ${found.length}` : "";
            // A file holding more than the CusDec pages is the bundle of all documents.
            const kind: CustomsDocKind = pages.length && read.pageCount > pages.length ? "all" : "cusdec";
            // One row per item (HS code line); the header fields repeat on each.
            r.items.forEach((row, n) => {
              rows.push({ ...row, file_name: row.file_name || files[i].name.replace(/\.[^.\s]{1,5}$/, "") });
              pdfFiles.push(files[i]);
              rowDocs.push(n === 0 ? { [kind]: files[i] } : {});
              notes.push(
                n === 0
                  ? [
                      `From ${files[i].name}${where}${which}${read.scanned ? " (scanned, read by OCR: check every figure)" : ""}${r.items.length > 1 ? `, item 1 of ${r.items.length}` : ""}`,
                      ...r.warnings,
                    ]
                  : [`From ${files[i].name}${which}, item ${n + 1} of ${r.items.length}`],
              );
            });
          });
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
    const decls = new Set(rows.map((r, i) => `${pdfFiles.indexOf(pdfFiles[i])}|${r.cusdec_no}|${r.invoice_no}`)).size;
    setPending({
      rows,
      notes,
      docs: rowDocs,
      source: "pdf",
      text:
        `${decls} CusDec${decls === 1 ? "" : "s"} read (${rows.length} item line${rows.length === 1 ? "" : "s"}), customs value ${fmt(value)}. Check the figures below (every box can be corrected), then save.` +
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

  // Attaching documents in the review table: one hidden picker, pointed at a row and slot when clicked.
  const docRef = useRef<HTMLInputElement>(null);
  const docTarget = useRef<{ i: number; kind: CustomsDocKind } | null>(null);
  const setDoc = (i: number, kind: CustomsDocKind, file: File | null) =>
    setPending(
      (p) =>
        p && {
          ...p,
          docs: p.docs.map((d, j) => {
            if (j !== i) return d;
            const next = { ...d };
            if (file) next[kind] = file;
            else delete next[kind];
            return next;
          }),
        },
    );
  function onDocPicked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const t = docTarget.current;
    e.target.value = "";
    if (file && t) setDoc(t.i, t.kind, file);
  }
  /** Name of the CusDec file (or the bundle holding it) a review row is saved with, without its extension. */
  const fileName = (r: CustomsUploadRow) => {
    if (r.file_name) return r.file_name;
    if (!pending) return "";
    const i = pending.rows.findIndex((x) => declKey(x) === declKey(r));
    const f = pending.docs[i]?.cusdec ?? pending.docs[i]?.all;
    return f ? f.name.replace(/\.[^.\s]{1,5}$/, "") : "";
  };
  /** Documents cell of a review row: the three slots on the first line of each declaration. */
  const docsCell = (i: number, r: CustomsUploadRow) => {
    if (!pending || pending.rows.findIndex((x) => declKey(x) === declKey(r)) !== i)
      return <span className="text-muted">as above</span>;
    return (
      <div className="flex flex-col gap-1">
        {CUSTOMS_DOC_KINDS.map(({ kind, label }) => {
          const file = pending.docs[i]?.[kind];
          return (
            <div key={kind} className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="text-muted w-[110px]">{label}</span>
              {file ? (
                <>
                  <span className="pill pill-good max-w-[180px] truncate" title={file.name}>
                    {file.name}
                  </span>
                  <button className="btn btn-icon" type="button" title="Remove" aria-label={`Remove ${label} file, row ${i + 1}`} onClick={() => setDoc(i, kind, null)}>
                    ×
                  </button>
                </>
              ) : (
                <button
                  className="btn"
                  type="button"
                  aria-label={`Attach ${label} file, row ${i + 1}`}
                  onClick={() => {
                    docTarget.current = { i, kind };
                    docRef.current?.click();
                  }}
                >
                  Attach
                </button>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  /** A cell of the review table: plain text for spreadsheet rows, a box that writes back for PDF rows (OCR can misread). */
  const cell = (i: number, r: CustomsUploadRow, field: keyof CustomsUploadRow, kind: "text" | "num", width = "w-[90px]") => {
    const v = r[field];
    if (pending?.source !== "pdf") return kind === "num" ? (v == null ? "" : fmt(v as number)) : ((v as string) ?? "");
    return (
      <NumOrText
        key={`${i}:${field}`}
        kind={kind}
        value={v == null ? "" : String(v)}
        className={width}
        label={`${String(field).replace(/_/g, " ")}, row ${i + 1}`}
        onCommit={(s) => {
          if (kind === "text") setRow(i, { [field]: s.trim() || null } as Partial<CustomsUploadRow>);
          else {
            const t = s.replace(/,/g, "").trim();
            const n = t === "" ? null : Number(t);
            if (n != null && isNaN(n)) {
              flash(`“${s}” is not a number.`, true);
              return;
            }
            setRow(i, { [field]: n } as Partial<CustomsUploadRow>);
          }
        }}
      />
    );
  };

  const incomplete = (pending?.rows ?? []).filter((r) => !r.cusdec_no.trim() || !r.invoice_no.trim()).length;

  async function save() {
    if (!pending || !company || incomplete) return;
    setBusy("Saving…");
    const { data, error } = await supabase.rpc("upload_customs_entries", {
      p_company: company.id,
      p_direction: direction,
      p_rows: pending.rows.map((r) => ({ ...r, cusdec_no: r.cusdec_no.trim(), invoice_no: r.invoice_no.trim() })),
    });
    setBusy(null);
    if (error) {
      flash(
        "Could not save: " +
          error.message +
          (/schema cache|function|file_name/i.test(error.message) ? ". Run the latest supabase/migrations (0014_tab_permissions.sql) in the Supabase SQL Editor first." : ""),
        true,
      );
      return;
    }
    const r = (data ?? {}) as { entries?: number; applied?: number };
    const n = pending.rows.length;
    // Keep the documents with their entries so they can be opened from the table: one file per
    // declaration and slot (the first row of the declaration holding one), recorded on every line of it.
    const seen = new Set<string>();
    const toStore: { row: CustomsUploadRow; kind: CustomsDocKind; file: File }[] = [];
    pending.rows.forEach((row, i) => {
      for (const { kind } of CUSTOMS_DOC_KINDS) {
        const file = pending.docs[i]?.[kind];
        const k = declKey(row) + "|" + kind;
        if (!file || seen.has(k)) continue;
        seen.add(k);
        toStore.push({ row, kind, file });
      }
    });
    let stored = 0;
    const storeErrors: string[] = [];
    for (let i = 0; i < toStore.length; i++) {
      const { row, kind, file } = toStore[i];
      setBusy(`Storing document ${i + 1} of ${toStore.length}…`);
      try {
        await uploadCustomsDocument(
          supabase,
          company.id,
          direction,
          { cusdec_no: row.cusdec_no.trim(), invoice_no: row.invoice_no.trim() },
          kind,
          file,
        );
        stored++;
      } catch (err) {
        storeErrors.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    setBusy(null);
    clear();
    await reload();
    flash(
      `Saved ${r.entries ?? n} ${noun} customs entries` +
        (isImport ? " to the Import Register." : `; the customs columns of ${r.applied ?? 0} matching sales invoices were filled in.`) +
        (toStore.length ? ` ${stored} document${stored === 1 ? "" : "s"} kept.` : "") +
        (storeErrors.length ? ` Not kept: ${storeErrors.join("; ")}` : ""),
      storeErrors.length > 0,
    );
  }

  return (
    <div className="panel">
      <h2 className="text-[15px] font-semibold m-0">Upload {noun} customs entries</h2>
      <div className="note">
        Either choose the CusDec PDFs themselves (ASYCUDA printouts, or scanned bundles where the CusDec sits among the
        invoice, packing list and other papers: the CusDec pages are found and read, by OCR when needed), several at once, and the
        app reads the customs reference, date, currency, amount, exchange rate, {isImport ? "supplier" : "consignee"}{" "}
        and, for every item on the form and its continuation sheets, the HS code, description, unit and quantity,
        statistical value{isImport ? " and the CID, PAL, SSCL and VAT lines with their MP codes" : ""}; or choose a
        spreadsheet of CusDec lines with columns Cusdec No, Date, Invoice No, Item No, HS Code, Description, UOM,
        Quantity, Currency, Ex. Rate, Invoice Value (FC), Customs Value (LKR), File Name
        {isImport ? ", CID / PAL / SSCL / VAT Amount and Code, VAT Base" : ""}, {isImport ? "Supplier" : "Consignee"}.
        {isImport
          ? " Each line goes into the Import Register under its CusDec month."
          : " Each entry is matched to the sales row with the same invoice number and its “As per customs” columns are filled in; entries are kept, so a month uploaded later is filled too."}{" "}
        The same CusDec and invoice number uploaded again replaces its earlier lines, which needs delete permission on this
        tab as well as upload. Before saving, attach the CusDec,
        the other documents and all documents (the full bundle) to each CusDec in the Documents column, for spreadsheet
        lines too; a CusDec PDF is kept as the CusDec, or as all documents when it is a bundle. Files can also be added
        later from the table below.
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
          <input ref={docRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={onDocPicked} />
          <div className="scroll max-h-[36vh]">
            <table className="tbl">
              <thead>
                <tr>
                  <th>File name</th>
                  <th>Cusdec no</th>
                  <th>Date</th>
                  <th>Invoice no</th>
                  <th className="num">Item</th>
                  <th>HS code</th>
                  <th>Qty</th>
                  <th>Currency</th>
                  <th className="num">Ex. rate</th>
                  <th className="num">Invoice value (FC)</th>
                  <th className="num">Customs value (LKR)</th>
                  {isImport && <th className="num">CID</th>}
                  {isImport && <th className="num">PAL</th>}
                  {isImport && <th className="num">SSCL</th>}
                  {isImport && <th className="num">Value for VAT</th>}
                  {isImport && <th className="num">VAT</th>}
                  <th>{isImport ? "Supplier" : "Consignee"}</th>
                  <th>Documents</th>
                  {pending.source === "pdf" && <th>Notes</th>}
                </tr>
              </thead>
              <tbody>
                {pending.rows.slice(0, 200).map((r, i) => (
                  <tr key={i}>
                    <td className="wrapc">{fileName(r) || <span className="text-muted">—</span>}</td>
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
                    <td>{cell(i, r, "cusdec_date", "text", "w-[95px]")}</td>
                    <td>
                      <input
                        className={"control w-[150px]" + (r.invoice_no.trim() ? "" : " border-bad")}
                        value={r.invoice_no}
                        aria-label={`Invoice number, row ${i + 1}`}
                        placeholder="Required"
                        onChange={(e) => setRow(i, { invoice_no: e.target.value })}
                      />
                    </td>
                    <td className="num">{r.item_no}</td>
                    <td>{cell(i, r, "hs_code", "text", "w-[100px]")}</td>
                    <td className="whitespace-nowrap">
                      {pending.source === "pdf" ? (
                        <>
                          {cell(i, r, "quantity", "num", "w-[80px]")} {cell(i, r, "uom", "text", "w-[55px]")}
                        </>
                      ) : (
                        r.quantity == null ? "" : `${r.quantity} ${r.uom ?? ""}`.trim()
                      )}
                    </td>
                    <td>{cell(i, r, "currency_type", "text", "w-[55px]")}</td>
                    <td className="num">{cell(i, r, "ex_rate", "num", "w-[90px]")}</td>
                    <td className="num">{cell(i, r, "invoice_value", "num", "w-[100px]")}</td>
                    <td className="num">{cell(i, r, "customs_value", "num", "w-[110px]")}</td>
                    {isImport && <td className="num">{cell(i, r, "cid_amount", "num")}</td>}
                    {isImport && <td className="num">{cell(i, r, "pal_amount", "num")}</td>}
                    {isImport && <td className="num">{cell(i, r, "sscl_amount", "num")}</td>}
                    {isImport && <td className="num">{cell(i, r, "vat_base", "num", "w-[110px]")}</td>}
                    {isImport && <td className="num">{cell(i, r, "vat_amount", "num", "w-[100px]")}</td>}
                    <td className="wrapc">{r.party}</td>
                    <td>{docsCell(i, r)}</td>
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
                    <td colSpan={19} className="note">
                      … and {pending.rows.length - 200} more rows.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="bar">
            <button className="btn btn-primary" type="button" onClick={() => void save()} disabled={!!busy || incomplete > 0}>
              {busy === "Saving…" ? "Saving…" : isImport ? `Save ${pending.rows.length} lines to the Import Register` : `Save ${pending.rows.length} entries and fill customs columns`}
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
