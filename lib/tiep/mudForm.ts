/**
 * The Material Utilization Declaration (Sri Lanka Customs, Bonds Division) as a standalone HTML document,
 * for viewing and for printing / saving as PDF from the browser. Layout as in the TIEP app's form.
 */
import type { TiepLine } from "./model";
import { liabOf, type AllocRow, type Claim, type MudConfig, type Row1 } from "./invoices";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fx = (v: number, d: number) => (isFinite(v) ? v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");
const f2 = (x: number) => fx(x, 2);
const f0 = (x: number) => fx(Math.round(x), 0);
const fq = (x: number) => fx(x, Math.abs(x % 1) > 1e-9 ? 2 : 0);
const dotDate = (iso: string | null | undefined) => (iso ? iso.split("-").reverse().join(".") : "");

const CSS = `
body{margin:0;background:#eef1f2;padding:16px}
.mudpaper{background:#fff;color:#111;font-family:Calibri,"Carlito","Segoe UI",Arial,sans-serif;font-size:13px;width:794px;max-width:100%;margin:0 auto;padding:44px 40px 50px;border:1px solid #ccc;box-shadow:0 2px 10px rgba(0,0,0,.08);box-sizing:border-box}
.mudpaper h1{font-size:17px;text-align:center;margin:0;font-weight:700}
.mudpaper h2{font-size:15.5px;text-align:center;margin:4px 0 0;font-weight:600}
.mudpaper .bd{text-align:center;font-weight:700;font-size:13px;margin-top:4px}
.mudpaper .ref{text-align:right;margin:10px 0 18px 0}
.mudpaper .row{display:grid;grid-template-columns:22px 1fr;column-gap:12px;margin:0 0 5px 0;line-height:1.35}
.mudpaper .g2{display:grid;grid-template-columns:22px 110px 1fr 120px 110px;column-gap:12px;row-gap:5px;align-items:center;margin:5px 0 16px;line-height:1.35}
.mudpaper .g2 .gap{grid-column:1/-1;height:6px}
.mudpaper table{width:calc(100% - 34px);margin:0 0 12px 34px;border-collapse:collapse;font-size:12.5px}
.mudpaper th,.mudpaper td{border:1px solid #222;padding:4px 6px;background:#fff;color:#111}
.mudpaper th{text-align:center;font-weight:700}
.mudpaper td.r{text-align:right}.mudpaper td.c{text-align:center}
.mudpaper tfoot td{font-weight:700}
.mudpaper .sig{margin:20px 0 0 34px;line-height:1.6}
.mudpaper .miss{color:#b42318}
@media print{body{background:#fff;padding:0}.mudpaper{border:none;box-shadow:none;padding:24px 20px;width:auto}@page{size:A4;margin:12mm}}
`;

export interface MudFormInput {
  cfg: MudConfig;
  ref: string;
  office: string;
  product: string;
  hs: string;
  exportE: string;
  date: string | null;
  rows1: Row1[];
  /** TIEP items whose system item no. is not confirmed in the item master: printed NOT CONFIRMED. */
  unconfirmed: Set<string>;
  claims: (Claim & { alloc: AllocRow[] })[];
  lineOf: Map<string, TiepLine>;
}

export function mudFormHtml(o: MudFormInput): string {
  const { cfg: C, rows1, claims, lineOf } = o;
  const qs = rows1.reduce((a, r) => a + r.qty, 0);
  const ws = rows1.reduce((a, r) => a + r.whole, 0);
  const rs = rows1.reduce((a, r) => a + r.rm, 0);
  let t2 = "";
  let tq = 0;
  let tl = 0;
  for (const c of claims) {
    const al = c.alloc.filter((a) => a.key && a.qty > 0);
    if (!al.length) {
      t2 += `<tr><td class="miss">not chosen</td><td>${esc(c.label)}</td><td>${esc(c.hs)}</td><td class="r">${fq(c.req)}</td><td class="c">${esc(c.uom)}</td><td class="r miss">–</td></tr>`;
      continue;
    }
    for (const a of al) {
      const r = lineOf.get(a.key);
      const li = liabOf(a, lineOf);
      tq += a.qty;
      tl += li;
      t2 += `<tr><td>${esc(r?.cusdec ?? a.key.split("|")[0])} - ${dotDate(r?.date)}</td><td>${esc(c.label)}</td><td>${esc(c.hs)}</td><td class="r">${fq(a.qty)}</td><td class="c">${esc(c.uom)}</td><td class="r">${f2(li)}</td></tr>`;
    }
  }
  const t1 = rows1.length
    ? rows1
        .map(
          (r) =>
            `<tr><td>${esc(r.desc)}${o.unconfirmed.has(r.desc) ? '<div class="miss" style="font-size:10.5px;font-weight:700">NOT CONFIRMED</div>' : ""}</td><td class="r">${f2(r.qty)}</td><td class="r">${fx(r.yield, 2)}</td><td class="r">${f2(Math.round(r.whole))}</td><td class="r">${fx(r.ratio, 2)}</td><td class="r">${f0(r.rm)}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="6" class="miss" style="text-align:center;padding:10px">No sales lines with a TIEP item: map the invoice\'s items first.</td></tr>';
  return `<!doctype html><html><head><meta charset="utf-8"><title>MUD ${esc(o.ref)}</title><style>${CSS}</style></head><body>
<div class="mudpaper"><h1>SRI LANKA CUSTOMS</h1><h2>Material Utilization Declaration</h2><div class="bd">Bonds Division</div>
<div class="ref">Ref No. <b>${esc(o.ref)}</b></div>
<div class="row"><span>01</span><span>Name of the importer: <b>${esc(C.importer)}</b></span></div>
<div class="row"><span></span><span>TIN/VAT no. : <b>${esc(C.tin)}</b></span></div>
<div class="row"><span></span><span>Warehouse Type/ Scheme : <b>${esc(C.scheme)}</b></span></div>
<div class="row"><span></span><span>${esc(C.schemeNote)}</span></div>
<div class="g2"><span></span><span>Export Entry No</span><span${o.exportE ? "" : ' class="miss"'}>${esc(o.exportE || "(enter E no.)")}</span><span>Export Product</span><span style="text-align:right">${esc(o.product)}</span>
<span class="gap"></span><span>02</span><span>Date</span><span>${dotDate(o.date)}</span><span>HS Code</span><span style="text-align:right">${esc(o.hs)}</span>
<span></span><span>Office Code</span><span>${esc(o.office)}</span><span>Quantity</span><span style="text-align:right">${rows1.length ? f2(qs) : ""}</span></div>
<table><thead><tr><th>Description</th><th>Quantity (Kg)</th><th>Yield</th><th>Quantity in whole (Kg)</th><th>Conversion Ratio</th><th>Raw Materials Utilized (Kg)</th></tr></thead><tbody>${t1}</tbody>
<tfoot><tr><td>Total</td><td class="r">${rows1.length ? f2(qs) : ""}</td><td></td><td class="r">${rows1.length ? f0(ws) : ""}</td><td></td><td class="r">${rows1.length ? f0(rs) : ""}</td></tr></tfoot></table>
<table><thead><tr><th>Import CUSDEC No / GRN date</th><th>Item</th><th>H S Code</th><th>Quantity Usage (Kg)</th><th>UOM</th><th>Liability for Guarantee (LKR)</th></tr></thead><tbody>${t2}</tbody>
<tfoot><tr><td></td><td></td><td class="c">Total</td><td class="r">${fq(tq)}</td><td></td><td class="r">${f2(tl)}</td></tr></tfoot></table>
<div class="sig"><b>Consignee/Declarant</b><br>Name${C.declarant ? " &nbsp; " + esc(C.declarant) : ""}<br>CHA No${C.cha ? " &nbsp; " + esc(C.cha) : ""}<br>Signature</div>
</div></body></html>`;
}
