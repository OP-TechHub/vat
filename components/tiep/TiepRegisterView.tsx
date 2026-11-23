"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useApp } from "../AppShell";
import { useTiep } from "./TiepProvider";
import { KeyValues, Modal, PostingChip, Progress, ReqChip, StatusChip, n0, n2 } from "./ui";
import {
  FEED_TYPES,
  GROUPS,
  NO_GROUP,
  STATUSES,
  defaultReq,
  downloadCsv,
  fdate,
  lineKey,
  r4,
  toCsv,
  type Req,
  type TiepLine,
} from "@/lib/tiep/model";

type SortKey = "id" | "fifo" | "cusdec" | "dn" | "grp" | "qty" | "cqty" | "pqty" | "xqty" | "bal" | "tsus" | "osv" | "due" | "status";

const COLS: { k: SortKey | null; label: string; num?: boolean; title?: string }[] = [
  { k: "id", label: "Line ID" },
  { k: "fifo", label: "FIFO", num: true },
  { k: "cusdec", label: "CusDec" },
  { k: "dn", label: "Date" },
  { k: null, label: "Description" },
  { k: "grp", label: "Group" },
  { k: null, label: "Cancel?" },
  { k: null, label: "UOM" },
  { k: "qty", label: "Qty imported", num: true },
  { k: "cqty", label: "Cancelled", num: true },
  { k: "pqty", label: "Planned", num: true, title: "Reserved by a saved MUD or a local-sales plan: firm, waiting for the customs write-off" },
  { k: "xqty", label: "Pending confirm.", num: true, title: "FIFO proposals for invoices whose MUD is not saved yet: not deducted from Balance" },
  { k: "bal", label: "Balance", num: true },
  { k: null, label: "Progress" },
  { k: "tsus", label: "Suspended (LKR)", num: true },
  { k: "osv", label: "Outstanding (LKR)", num: true },
  { k: "due", label: "Due" },
  { k: "status", label: "Status" },
];

export default function TiepRegisterView() {
  const { lines, perm, loading } = useTiep();
  const [q, setQ] = useState("");
  const [regime, setRegime] = useState("");
  const [grp, setGrp] = useState("");
  const [fy, setFy] = useState("");
  const [st, setSt] = useState("");
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "dn", dir: 1 });
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [form, setForm] = useState<{ edit: TiepLine | null } | null>(null);

  const fys = useMemo(() => [...new Set(lines.map((r) => r.fy).filter(Boolean))].sort(), [lines]);
  const groupsUsed = useMemo(() => {
    const used = new Set(lines.map((r) => r.grp));
    return [...GROUPS.filter((g) => used.has(g)), ...(used.has("") ? [NO_GROUP] : [])];
  }, [lines]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const out = lines.filter((r) => {
      if (regime === "tiep" && !r.tiep) return false;
      if (regime === "paid" && r.tiep) return false;
      if (grp && (r.grp || NO_GROUP) !== grp) return false;
      if (fy && r.fy !== fy) return false;
      if (st === "overdue") {
        if (!r.overdue) return false;
      } else if (st && r.status !== st) return false;
      if (s && ![r.id, r.cusdec, r.inv, r.desc, r.sup, r.hs, r.file].join(" ").toLowerCase().includes(s)) return false;
      return true;
    });
    const k = sort.k;
    return out.sort((a, b) => {
      let x: string | number | null = a[k] as unknown as string | number | null;
      let y: string | number | null = b[k] as unknown as string | number | null;
      const textual = k === "id" || k === "cusdec" || k === "grp" || k === "status" || k === "due";
      if (textual) return String(x ?? "").localeCompare(String(y ?? "")) * sort.dir || (a.dn || 0) - (b.dn || 0);
      if (x == null || (typeof x === "number" && isNaN(x))) x = -Infinity;
      if (y == null || (typeof y === "number" && isNaN(y))) y = -Infinity;
      const c = typeof x === "string" && typeof y === "string" ? String(x).localeCompare(String(y)) : Number(x) - Number(y);
      return c * sort.dir || (a.dn || 0) - (b.dn || 0);
    });
  }, [lines, q, regime, grp, fy, st, sort]);

  const setSortKey = (k: SortKey) => setSort((s) => (s.k === k ? { k, dir: s.dir === 1 ? -1 : 1 } : { k, dir: 1 }));

  function csv() {
    const out: (string | number | null)[][] = [
      ["Line ID", "FIFO", "CusDec", "Date", "Financial year", "Invoice no", "Item no", "HS code", "Description", "Supplier", "Material group", "Product",
        "Category", "Cancellation required", "UOM", "Qty imported", "Qty cancelled", "Qty planned", "Balance", "Duties suspended", "VAT deferred",
        "Suspended total", "Outstanding", "Due", "Status", "Overdue", "Remarks"],
    ];
    for (const r of rows)
      out.push([r.id, r.fifo, r.cusdec, r.date, r.fy, r.inv, r.item, r.hs, r.desc, r.sup, r.grp || NO_GROUP, r.prod, r.cat, r.req, r.uom,
        r.pending ? "" : r4(r.qty), r4(r.cqty), r4(r.pqty), r.bal == null ? "" : r4(r.bal), Math.round(r.dsus), Math.round(r.vdef),
        Math.round(r.tsus), Math.round(r.osv), r.due, r.status, r.overdue ? "Yes" : "", r.rem]);
    downloadCsv(`TIEP_Import_Register_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(out));
  }

  const open = openKey ? lines.find((r) => r.key === openKey) ?? null : null;

  return (
    <>
      <div className="bar">
        <label className="field">
          Search
          <input className="control min-w-[220px]" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="CusDec, invoice, item, supplier" />
        </label>
        <label className="field">
          Regime
          <select className="control" value={regime} onChange={(e) => setRegime(e.target.value)}>
            <option value="">All</option>
            <option value="tiep">TIEP (duty suspended)</option>
            <option value="paid">Duty paid</option>
          </select>
        </label>
        <label className="field">
          Material group
          <select className="control" value={grp} onChange={(e) => setGrp(e.target.value)}>
            <option value="">All</option>
            {groupsUsed.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Financial year
          <select className="control" value={fy} onChange={(e) => setFy(e.target.value)}>
            <option value="">All</option>
            {fys.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Status
          <select className="control" value={st} onChange={(e) => setSt(e.target.value)}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
            <option value="overdue">Overdue only</option>
          </select>
        </label>
        <span className="flex-1" />
        {perm.register.edit && (
          <button className="btn" type="button" onClick={() => setForm({ edit: null })}>
            Add import line
          </button>
        )}
        <button className="btn" type="button" onClick={csv}>
          Download CSV
        </button>
      </div>

      <div className="scroll max-h-[68vh]">
        <table className="tbl">
          <thead>
            <tr>
              {COLS.map((c) => (
                <th
                  key={c.label}
                  className={(c.num ? "num " : "") + (c.k ? "cursor-pointer select-none" : "")}
                  title={c.title}
                  onClick={c.k ? () => setSortKey(c.k!) : undefined}
                  aria-sort={c.k && sort.k === c.k ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                >
                  {c.label}
                  {c.k && sort.k === c.k ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && !lines.length ? (
              <tr>
                <td colSpan={COLS.length} className="note">
                  Loading…
                </td>
              </tr>
            ) : !rows.length ? (
              <tr>
                <td colSpan={COLS.length} className="note">
                  {lines.length ? "No lines match these filters." : "No import lines yet. CusDecs uploaded in Registers › Import Register show here."}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.key}
                  className="clickable"
                  tabIndex={0}
                  onClick={() => setOpenKey(r.key)}
                  onKeyDown={(e) => e.key === "Enter" && setOpenKey(r.key)}
                >
                  <td className="font-mono">{r.id}</td>
                  <td className="num">{r.fifo ?? ""}</td>
                  <td>{r.cusdec}</td>
                  <td title={r.dateGuessed ? "Only the month is known" : undefined}>
                    {fdate(r.date)}
                    {r.dateGuessed ? " ?" : ""}
                  </td>
                  <td className="whitespace-normal min-w-[240px] max-w-[420px]">{r.desc}</td>
                  <td title={r.grpGuessed ? "From other lines with the same HS code" : undefined}>
                    {r.grp ? (
                      <>
                        {r.grp}
                        {r.grpGuessed && <span className="text-muted"> *</span>}
                      </>
                    ) : (
                      <span className="chip chip-open">{NO_GROUP}</span>
                    )}
                  </td>
                  <td>
                    <ReqChip req={r.req} />
                  </td>
                  <td>{r.uom}</td>
                  <td className="num">{r.pending ? "?" : n2(r.qty)}</td>
                  <td className="num">{n2(r.cqty)}</td>
                  <td className={"num" + (r.pqty ? " text-accent font-semibold" : "")}>{n2(r.pqty)}</td>
                  <td className={"num" + (r.xqty ? " text-warn font-semibold" : "")}>{n2(r.xqty)}</td>
                  <td className="num">{r.req === "No" ? "" : r.pending ? "?" : n2(r.bal)}</td>
                  <td>
                    <Progress pct={r.pct} />
                  </td>
                  <td className="num">{n0(r.tsus)}</td>
                  <td className="num">{n0(r.osv)}</td>
                  <td>{fdate(r.due)}</td>
                  <td>
                    <StatusChip line={r} />
                  </td>
                </tr>
              ))
            )}
            {rows.length > 0 && (
              <tr className="total">
                <td colSpan={14}>Total of {rows.length} shown lines</td>
                <td className="num">{n0(rows.reduce((a, r) => a + r.tsus, 0))}</td>
                <td className="num">{n0(rows.reduce((a, r) => a + r.osv, 0))}</td>
                <td colSpan={2}></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="note">
        Showing {rows.length} of {lines.length} import lines (every import CusDec line in the Import Register). FIFO ranks
        TIEP lines oldest first within each material group. A group marked * was taken from other lines with the same
        HS code: open the line to confirm it. Planned = reserved by a saved MUD or a local-sales plan; Pending confirm. =
        FIFO proposals for invoices whose MUD is not saved yet. Click a line for detail.
      </div>

      {open && (
        <LineDialog
          line={open}
          onClose={() => setOpenKey(null)}
          onEdit={() => {
            setOpenKey(null);
            setForm({ edit: open });
          }}
        />
      )}
      {form && <ImportLineDialog edit={form.edit} onClose={() => setForm(null)} />}
    </>
  );
}

function LineDialog({ line: r, onClose, onEdit }: { line: TiepLine; onClose: () => void; onEdit: () => void }) {
  const { supabase, company, user, flash } = useApp();
  const { cancels, perm, reload } = useTiep();
  const canEdit = perm.register.edit;
  const [req, setReq] = useState<Req>(r.req);
  const [grp, setGrp] = useState<string>(r.grp);
  const [ftype, setFtype] = useState<string>(r.ftype ?? "");
  const [rem, setRem] = useState(r.rem);
  const [busy, setBusy] = useState(false);
  const cs = cancels
    .filter((c) => lineKey(c.cusdec_no, c.invoice_no, c.item_no) === r.key)
    .sort((a, b) => (a.posting_date ?? "").localeCompare(b.posting_date ?? ""));

  async function save() {
    if (!company) return;
    setBusy(true);
    const { error } = await supabase.from("tiep_import_ext").upsert(
      {
        company_id: company.id,
        cusdec_no: r.cusdec,
        invoice_no: r.inv,
        item_no: r.item,
        grp: grp || null,
        ftype: grp === "Fish Feed" ? ftype || null : null,
        req,
        remarks: rem.trim() || null,
        pending: r.pending,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      },
      { onConflict: "company_id,cusdec_no,invoice_no,item_no" },
    );
    setBusy(false);
    if (error) {
      flash("Could not save: " + error.message, true);
      return;
    }
    flash(`${r.id} updated.`);
    onClose();
    await reload();
  }

  const changed = req !== r.req || grp !== r.grp || (ftype || null) !== (r.ftype || null) || rem !== r.rem || (!r.hasExt && !!grp);
  const title = `${r.id} · ${r.desc}`;
  return (
    <Modal
      title={title.length > 90 ? title.slice(0, 88) + "…" : title}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Close
          </button>
          {canEdit && (
            <>
              <button className="btn" type="button" onClick={onEdit}>
                Edit import details
              </button>
              <button className="btn btn-primary" type="button" disabled={busy || !changed} onClick={() => void save()}>
                {busy ? "Saving…" : "Save changes"}
              </button>
            </>
          )}
        </>
      }
    >
      {r.pending && (
        <div className="msg">
          Import details for this line are pending. Use <b>Edit import details</b> to enter the quantity, values and tax
          amounts from the CusDec.
        </div>
      )}
      <div>
        <StatusChip line={r} />
      </div>
      <KeyValues
        items={[
          ["CusDec no", r.cusdec],
          ["CusDec date", fdate(r.date) + (r.dateGuessed ? " (month only)" : "")],
          ["Regime", r.tiep ? "TIEP, duty suspended" : "Duty paid (home use)"],
          ["Financial year", r.fy],
          ["Invoice no", r.inv],
          ["Item no", r.item],
          ["HS code", r.hs],
          ["Supplier", r.sup],
          ["Product", r.prod],
          ["Category", r.cat],
          ["UOM", r.uom],
          ["Qty imported", r.pending ? "Pending" : n2(r.qty)],
          ["Currency / rate", `${r.cur} @ ${r.rate || ""}`],
          ["Invoice value (FC)", n2(r.invfc)],
          ["Customs value (LKR)", n0(r.cval)],
          ["CID (code)", `${n0(r.cid)} (${r.cidc || "–"})`],
          ["PAL (code)", `${n0(r.pal)} (${r.palc || "–"})`],
          ["SSCL (code)", `${n0(r.sscl)} (${r.ssclc || "–"})`],
          ["VAT (code / type)", `${n0(r.vat)} (${r.vatc || "–"}${r.vatt ? " / " + r.vatt : ""})`],
          ...(r.dutyTotal != null ? ([["Duty total (logbook)", n0(r.dutyTotal)]] as [string, string][]) : []),
          ["Duties suspended", n0(r.dsus)],
          ["VAT deferred", n0(r.vdef)],
          ["Qty cancelled (completed)", n2(r.cqty)],
          ["Qty planned", n2(r.pqty)],
          ["Balance free to cancel", r.req === "No" ? "–" : r.pending ? "?" : n2(r.bal)],
          ["Outstanding (LKR)", n0(r.osv)],
          ["Due date", fdate(r.due) || "–"],
          ["Days outstanding", r.days ?? "–"],
          ["Document file", r.file],
        ]}
      />
      <div className="bar">
        <label className="field">
          Material group
          <select className="control" value={grp} disabled={!canEdit} onChange={(e) => setGrp(e.target.value)}>
            <option value="">{NO_GROUP}</option>
            {GROUPS.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </label>
        {grp === "Fish Feed" && (
          <label className="field">
            Feed type
            <select className="control" value={ftype} disabled={!canEdit} onChange={(e) => setFtype(e.target.value)}>
              <option value="">Auto from description</option>
              {FEED_TYPES.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          Cancellation required?
          <select className="control" value={req} disabled={!canEdit} onChange={(e) => setReq(e.target.value as Req)}>
            <option>Yes</option>
            <option>Confirm</option>
            <option>No</option>
          </select>
        </label>
        <label className="field flex-1 min-w-[260px]">
          Remarks / data checks
          <input className="control" value={rem} disabled={!canEdit} onChange={(e) => setRem(e.target.value)} />
        </label>
      </div>
      {r.grpGuessed && <div className="note">The group was taken from other lines with the same HS code. Save to confirm it for this line.</div>}
      <div>
        <h3 className="text-[14px] font-semibold mb-1.5">Cancellations against this line</h3>
        {cs.length ? (
          <div className="scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Export invoice / batch</th>
                  <th>Cancellation customs entry</th>
                  <th className="num">Qty</th>
                </tr>
              </thead>
              <tbody>
                {cs.map((c) => (
                  <tr key={c.id}>
                    <td className="font-mono">{c.ref}</td>
                    <td>{c.source === "logbook" ? "Logbook" : c.type === "local" ? "Local sale" : "Export"}</td>
                    <td>
                      <PostingChip status={c.status} />
                    </td>
                    <td>{fdate(c.posting_date)}</td>
                    <td>{c.type === "local" ? c.product : c.exp_inv}</td>
                    <td>{(c.type === "local" ? c.cancel_cusdec : c.exp_cusdec) || <span className="chip chip-open">To be raised</span>}</td>
                    <td className="num">{n2(c.qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="note m-0">None yet.</p>
        )}
      </div>
    </Modal>
  );
}

/** Fields of the Add / Edit import line form, as typed. */
type FormState = Record<string, string>;


function ImportLineDialog({ edit, onClose }: { edit: TiepLine | null; onClose: () => void }) {
  const { supabase, company, flash } = useApp();
  const { reload } = useTiep();
  const [f, setF] = useState<FormState>((): FormState =>
    edit
      ? {
          cusdec_no: edit.cusdec,
          cusdec_date: edit.date ?? "",
          invoice_no: edit.inv,
          item_no: String(edit.item),
          hs_code: edit.hs,
          description: edit.desc,
          party: edit.sup,
          grp: edit.grp,
          ftype: edit.ftype ?? "",
          uom: edit.uom || "KGM",
          quantity: edit.pending ? "" : String(edit.qty || ""),
          currency_type: edit.cur || "USD",
          ex_rate: edit.rate ? String(edit.rate) : "",
          invoice_value: edit.invfc ? String(edit.invfc) : "",
          customs_value: edit.cval ? String(edit.cval) : "",
          cid_amount: String(edit.cid || 0),
          cid_code: edit.cidc,
          pal_amount: String(edit.pal || 0),
          pal_code: edit.palc,
          sscl_amount: String(edit.sscl || 0),
          sscl_code: edit.ssclc,
          vat_base: edit.vatv ? String(edit.vatv) : "",
          vat_amount: String(edit.vat || 0),
          vat_code: edit.vatc,
          vat_type: edit.vatt,
          duty_total: edit.dutyTotal != null ? String(edit.dutyTotal) : "",
          file_name: edit.file,
          remarks: edit.rem,
          req: edit.req,
        }
      : { item_no: "1", uom: "KGM", currency_type: "USD", cid_amount: "0", pal_amount: "0", sscl_amount: "0", vat_amount: "0", grp: "Fish Feed", req: "" },
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!company) return;
    const miss: string[] = [];
    if (!f.cusdec_no?.trim()) miss.push("CusDec no");
    if (!f.cusdec_date) miss.push("date");
    if (!f.description?.trim()) miss.push("description");
    if (!edit && !(Number(f.quantity) > 0)) miss.push("quantity");
    if (miss.length) {
      setMsg("Fill in: " + miss.join(", ") + ".");
      return;
    }
    setBusy(true);
    const line = { ...f, req: f.req || (edit ? edit.req : defaultReq(f.cusdec_no, f.grp)) };
    const { error } = await supabase.rpc("tiep_save_import_line", {
      p_company: company.id,
      p_line: line,
      p_key: edit ? { cusdec_no: edit.cusdec, invoice_no: edit.inv, item_no: edit.item } : null,
    });
    setBusy(false);
    if (error) {
      setMsg("Could not save: " + error.message);
      return;
    }
    flash(edit ? `${edit.id} updated.` : `CusDec ${f.cusdec_no} item ${f.item_no} added to the Import Register.`);
    onClose();
    await reload();
  }

  const field = (k: string, label: string, type = "text", extra: Record<string, string | boolean> = {}) => (
    <label className="field">
      {label}
      <input className="control" type={type} value={f[k] ?? ""} onChange={set(k)} {...extra} />
    </label>
  );
  const codeSel = (k: string, label: string) => (
    <label className="field">
      {label}
      <select className="control" value={f[k] ?? ""} onChange={set(k)}>
        <option value="">–</option>
        <option>0</option>
        <option>1</option>
        <option>2</option>
      </select>
    </label>
  );
  const locked = !!edit;

  return (
    <Modal
      title={edit ? `Edit import details · ${edit.id}` : "Add import line"}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" type="submit" form="tiep-line-form" disabled={busy}>
            {busy ? "Saving…" : "Save line"}
          </button>
        </>
      }
    >
      <form id="tiep-line-form" onSubmit={save} className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
        {field("cusdec_no", "CusDec no (S… = TIEP)", "text", { placeholder: "S 18500", disabled: locked })}
        {field("cusdec_date", "CusDec date", "date")}
        {field("invoice_no", "Invoice no", "text", { disabled: locked })}
        {field("item_no", "Item no", "number", { min: "1", disabled: locked })}
        {field("hs_code", "HS code")}
        <label className="field col-span-full">
          Description
          <input className="control" value={f.description ?? ""} onChange={set("description")} />
        </label>
        <label className="field col-span-full">
          Supplier
          <input className="control" value={f.party ?? ""} onChange={set("party")} />
        </label>
        <label className="field">
          Material group
          <select className="control" value={f.grp ?? ""} onChange={set("grp")}>
            <option value="">{NO_GROUP}</option>
            {GROUPS.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </label>
        {f.grp === "Fish Feed" && (
          <label className="field">
            Feed type
            <select className="control" value={f.ftype ?? ""} onChange={set("ftype")}>
              <option value="">Auto from description</option>
              {FEED_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          UOM
          <select className="control" value={f.uom ?? "KGM"} onChange={set("uom")}>
            {[...new Set(["KGM", "NIU", "LTR", f.uom].filter(Boolean))].map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </label>
        {field("quantity", "Quantity", "number", { step: "any", min: "0" })}
        <label className="field">
          Currency
          <select className="control" value={f.currency_type ?? "USD"} onChange={set("currency_type")}>
            {[...new Set(["USD", "EUR", "GBP", "JPY", "LKR", f.currency_type].filter(Boolean))].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        {field("ex_rate", "Ex. rate", "number", { step: "any" })}
        {field("invoice_value", "Invoice value (FC)", "number", { step: "any" })}
        {field("customs_value", "Customs value (LKR)", "number", { step: "any" })}
        {field("cid_amount", "CID amount", "number", { step: "any" })}
        {codeSel("cid_code", "CID code")}
        {field("pal_amount", "PAL amount", "number", { step: "any" })}
        {codeSel("pal_code", "PAL code")}
        {field("sscl_amount", "SSCL amount", "number", { step: "any" })}
        {codeSel("sscl_code", "SSCL code")}
        {field("vat_base", "Value for VAT", "number", { step: "any" })}
        {field("vat_amount", "VAT amount", "number", { step: "any" })}
        {codeSel("vat_code", "VAT code")}
        {field("vat_type", "VAT type", "text", { placeholder: "VTD" })}
        {field("duty_total", "Duty total (logbook, no breakup)", "number", { step: "any" })}
        {field("file_name", "Document file")}
        <label className="field">
          Cancellation required?
          <select className="control" value={f.req ?? ""} onChange={set("req")}>
            {!edit && <option value="">Default ({defaultReq(f.cusdec_no ?? "", f.grp)})</option>}
            <option>Yes</option>
            <option>Confirm</option>
            <option>No</option>
          </select>
        </label>
        <label className="field col-span-full">
          Remarks
          <input className="control" value={f.remarks ?? ""} onChange={set("remarks")} />
        </label>
      </form>
      <div className="note">
        CID / PAL / SSCL coded 0 are suspended; VAT coded 2 is deferred. The line is saved to the Import Register, so
        it also shows in Registers and VAT.
        {edit?.pending && " Enter the quantity to make this line available for cancellation."}
      </div>
      {msg && <div className="msg msg-err">{msg}</div>}
    </Modal>
  );
}
