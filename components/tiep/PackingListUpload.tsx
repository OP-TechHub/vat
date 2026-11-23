"use client";

import { useState, type ChangeEvent } from "react";
import { useApp } from "../AppShell";
import { useTiep } from "./TiepProvider";
import { normP } from "@/lib/tiep/model";
import { mergePl, readPackingPdf, toKgRows } from "@/lib/tiep/packingList";
import { saveInvoiceExt, uploadTiepDoc } from "@/lib/tiep/actions";

interface Read {
  file: File;
  invNo: string;
  date: string;
  docKey: "invoice" | "packing";
  header: Record<string, string | number>;
  rows: { desc: string; boxes: number; net: number; gross: number; bbd: string; boxRange: string; price: number; amount: number; netIn: number }[];
  unit: string;
  match: string | null;
  error?: string;
}

/**
 * Commercial invoice / packing list PDFs of export invoices: the document is attached to the invoice with the
 * same number and its details (consignee, vessel, BL, container, boxes, weights …) are kept with it. An invoice
 * not in the Export Register yet can be added from the PDF by someone who may upload there.
 */
export default function PackingListUpload() {
  const { supabase, company, user, flash, perm } = useApp();
  const { invoices, reload } = useTiep();
  const [unit, setUnit] = useState<"auto" | "KG" | "LB">("auto");
  const [reads, setReads] = useState<Read[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const canCreate = perm("reg_exports").upload;
  const exportsByNo = new Map(invoices.filter((v) => v.inv.type === "Export").map((v) => [normP(v.inv.invoice_no), v]));

  async function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    if (!files.length) return;
    const out: Read[] = [];
    for (let i = 0; i < files.length; i++) {
      setBusy(`Reading ${i + 1} of ${files.length}…`);
      const file = files[i];
      try {
        const p = await readPackingPdf(file);
        const k = toKgRows(p, unit);
        const h = k.header as unknown as Record<string, string | number>;
        const invNo = String(p.header.invNo || "").trim();
        out.push({
          file,
          invNo,
          date: p.header.date,
          docKey: p.header.source === "invoice" ? "invoice" : "packing",
          header: {
            ...h,
            wUnit: k.unitUsed,
            docType: p.header.source === "invoice" ? "Commercial invoice" : "Packing list",
          },
          rows: k.rows.map((r) => ({ desc: r.desc, boxes: r.boxes, net: r.net, gross: r.gross, bbd: r.bbd, boxRange: r.boxRange, price: r.price, amount: r.amount, netIn: r.netIn })),
          unit: k.unitUsed,
          match: exportsByNo.get(normP(invNo))?.inv.id ?? null,
          error: invNo ? undefined : "No invoice number found in the PDF.",
        });
      } catch (err) {
        out.push({ file, invNo: "", date: "", docKey: "packing", header: {}, rows: [], unit: "", match: null, error: err instanceof Error ? err.message : String(err) });
      }
    }
    setBusy(null);
    setReads(out);
  }

  async function save() {
    if (!company) return;
    const done: string[] = [];
    for (const r of reads) {
      if (r.error || (!r.match && !canCreate)) continue;
      setBusy(`Saving ${r.invNo}…`);
      try {
        let id = r.match;
        if (!id) {
          // Not in the Export Register yet: add it from the PDF lines (Registers upload permission).
          const { error } = await supabase.rpc("upload_sales_invoices", {
            p_company: company.id,
            p_type: "Export",
            p_file_name: r.file.name,
            p_rows: [
              {
                invoice_no: r.invNo,
                invoice_date: r.date || null,
                customer: String(r.header.consignee ?? ""),
                order_no: String(r.header.orderNo ?? ""),
                source: r.docKey === "invoice" ? "Commercial invoice PDF" : "Packing list PDF",
                lines: r.rows.map((x, i) => ({
                  line_no: i + 1,
                  line_date: r.date || null,
                  item_code: "",
                  description: x.desc,
                  qty: x.net,
                  uom: "KG",
                  qty_in: x.netIn,
                  uom_in: r.unit,
                  boxes: x.boxes || null,
                  gross: x.gross || null,
                  unit_price: x.price || null,
                  amount_fc: x.amount || 0,
                  amount_lkr: 0,
                  is_charge: false,
                })),
              },
            ],
          });
          if (error) throw new Error(error.message);
          const { data, error: e2 } = await supabase.from("sales_invoices").select("id").eq("company_id", company.id).eq("type", "Export").eq("invoice_no", r.invNo).single();
          if (e2) throw new Error(e2.message);
          id = (data as { id: string }).id;
        }
        const ex = invoices.find((v) => v.inv.id === id)?.ext;
        const doc = await uploadTiepDoc(supabase, company.id, "invoices", id, r.docKey, r.file);
        // Fill in what was missing; rows merged by description, keeping what an earlier document gave.
        const rows = [...(ex?.pl_rows ?? [])];
        for (const x of r.rows) {
          const i = rows.findIndex((y) => normP(y.desc) === normP(x.desc));
          if (i >= 0) rows[i] = mergePl(rows[i] as unknown as Record<string, unknown>, x as unknown as Record<string, unknown>) as unknown as (typeof rows)[number];
          else rows.push(x);
        }
        await saveInvoiceExt(supabase, company.id, user.id, id, {
          pl: mergePl((ex?.pl ?? {}) as Record<string, unknown>, r.header) as Record<string, string | number>,
          pl_rows: rows,
          docs: { ...(ex?.docs ?? {}), [r.docKey]: doc },
        });
        done.push(r.invNo + (r.match ? "" : " (added to the Export Register)"));
      } catch (err) {
        flash(`Could not save ${r.invNo}: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    }
    setBusy(null);
    if (done.length) flash(`Saved ${done.length} document${done.length === 1 ? "" : "s"}: ${done.join("; ")}.`);
    setReads([]);
    await reload();
  }

  const ok = reads.filter((r) => !r.error && (r.match || canCreate)).length;
  return (
    <div className="panel">
      <h2 className="text-[15px] font-semibold m-0">Commercial invoices and packing lists</h2>
      <p className="note m-0">
        Upload the commercial invoice or packing list PDF (several at once). The invoice no., consignee, vessel / flight, BL / AWB, container, boxes and
        weights are read from it and kept with the export invoice of the same number, with the PDF attached. The other document of the same invoice
        later fills in what was missing. Weights in lb are converted to kg at 0.454. Scanned PDFs without a text layer cannot be read.
      </p>
      <div className="bar">
        <label className="field">
          PDF files
          <input className="control" type="file" multiple accept=".pdf,application/pdf" disabled={!!busy} onChange={onFiles} />
        </label>
        <label className="field">
          Weights on document
          <select className="control" value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)}>
            <option value="auto">Auto-detect</option>
            <option value="KG">Kg</option>
            <option value="LB">Lb (× 0.454)</option>
          </select>
        </label>
        {busy && <span className="note pb-1.5">{busy}</span>}
      </div>
      {reads.length > 0 && (
        <>
          <div className="scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Document</th>
                  <th>Invoice no.</th>
                  <th>Date</th>
                  <th>Consignee</th>
                  <th className="num">Rows</th>
                  <th className="num">Boxes</th>
                  <th className="num">Net kg</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {reads.map((r, i) => (
                  <tr key={i}>
                    <td className="whitespace-normal max-w-[220px]">{r.file.name}</td>
                    <td>{r.docKey === "invoice" ? "Commercial invoice" : "Packing list"}</td>
                    <td className="font-mono">{r.invNo}</td>
                    <td>{r.date}</td>
                    <td className="whitespace-normal max-w-[220px]">{String(r.header.consignee ?? "")}</td>
                    <td className="num">{r.rows.length}</td>
                    <td className="num">{Number(r.header.totBoxes ?? 0) || ""}</td>
                    <td className="num">{Number(r.header.totNet ?? 0) ? Number(r.header.totNet).toFixed(2) : ""}</td>
                    <td>
                      {r.error ? (
                        <span className="text-bad">{r.error}</span>
                      ) : r.match ? (
                        <span className="chip chip-done">Attach to the invoice</span>
                      ) : canCreate ? (
                        <span className="chip chip-open">Not in the Export Register: add from the PDF</span>
                      ) : (
                        <span className="text-bad">Not in the Export Register: upload it in Registers first</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bar">
            <button className="btn btn-primary" type="button" disabled={!ok || !!busy} onClick={() => void save()}>
              Save {ok} document{ok === 1 ? "" : "s"}
            </button>
            <button className="btn" type="button" disabled={!!busy} onClick={() => setReads([])}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
