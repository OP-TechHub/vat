"use client";

import { Fragment, useMemo, useState } from "react";
import { useApp } from "../AppShell";
import { useTiep } from "./TiepProvider";
import { Modal } from "./ui";
import { openTiepDoc } from "@/lib/tiep/actions";
import {
  FEED_TYPES,
  GROUPS,
  fRatio,
  fdate,
  normP,
  r4,
  stdCheckGaps,
  stdList,
  stdMud,
  stdShort,
  type Standard,
  type StdMaterial,
  type StdMud,
  type StdYield,
} from "@/lib/tiep/model";

const fx = (v: number | null | undefined, d: number) =>
  v == null || isNaN(v) ? "–" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const period = (x: Standard) =>
  x.valid_from && x.valid_to
    ? `${fdate(x.valid_from)} – ${fdate(x.valid_to)}`
    : x.valid_from
      ? `From ${fdate(x.valid_from)}`
      : x.valid_to
        ? `Up to ${fdate(x.valid_to)}`
        : "No period set";

/** Settings › Conversion Standards. */
export default function TiepStandardsView() {
  const { supabase, flash } = useApp();
  const { standards, documents, perm, reload } = useTiep();
  const list = useMemo(() => stdList(standards), [standards]);
  const [sel, setSel] = useState<string | null>(null);
  const [editing, setEditing] = useState<Standard | "new" | null>(null);
  const x = list.find((s) => s.id === sel) ?? list[list.length - 1] ?? null;
  const gaps = useMemo(() => stdCheckGaps(standards), [standards]);

  async function remove(s: Standard) {
    if (!window.confirm(`Delete the standard ${s.name}? Invoices dated in its period will have no standard.`)) return;
    const { error } = await supabase.from("tiep_standards").delete().eq("id", s.id);
    if (error) flash("Could not delete: " + error.message, true);
    else {
      flash(`Deleted ${s.name}.`);
      setSel(null);
      await reload();
    }
  }

  return (
    <>
      <div className="panel">
        <h2 className="text-[15px] font-semibold m-0">Approved conversion standards</h2>
        <p className="note m-0">
          Sales quantity → raw fish (÷ yield %) → raw materials (raw fish kg × quantity per kg fish). Each sale uses the
          standard whose valid period covers its date.
        </p>
        <div className="bar">
          <div className="inline-flex border border-line rounded-md overflow-hidden" role="group" aria-label="Standard to show">
            {list.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={s.id === x?.id}
                onClick={() => setSel(s.id)}
                className={"px-3 py-1.5 text-[13px] border-l border-line first:border-l-0 " + (s.id === x?.id ? "bg-accent text-accent-ink" : "bg-surface text-muted")}
              >
                {stdShort(s)}
              </button>
            ))}
          </div>
          <span className="flex-1" />
          {perm.standards.edit && (
            <>
              {x && (
                <button className="btn" type="button" onClick={() => setEditing(x)}>
                  Edit {stdShort(x)}
                </button>
              )}
              <button className="btn" type="button" onClick={() => setEditing("new")}>
                Add standard
              </button>
            </>
          )}
          {perm.standards.delete && x && (
            <button className="btn btn-danger" type="button" onClick={() => void remove(x)}>
              Delete
            </button>
          )}
        </div>
        {!x ? (
          <p className="note m-0">No standards yet.{perm.standards.edit ? " Use Add standard to enter the approved standard." : ""}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-6 items-baseline text-[13px]">
              {documents.filter((d) => d.std_id === x.id && d.path).length > 0 && (
                <div>
                  <div className="text-muted text-xs">Approval document</div>
                  {documents
                    .filter((d) => d.std_id === x.id && d.path)
                    .map((d) => (
                      <button key={d.id} type="button" className="underline block text-left" onClick={() => void openTiepDoc(supabase, d.path!).catch((e: Error) => flash(e.message, true))}>
                        {d.title}
                        {d.valid_from || d.valid_to ? ` (valid ${d.valid_from ? fdate(d.valid_from) : "…"} – ${d.valid_to ? fdate(d.valid_to) : "…"})` : ""}
                      </button>
                    ))}
                </div>
              )}
              <div>
                <div className="text-muted text-xs">Standard</div>
                <b>{x.name}</b>
              </div>
              <div>
                <div className="text-muted text-xs">Applies to sales dated</div>
                <b>{period(x)}</b>
              </div>
              <div>
                <div className="text-muted text-xs">Basis</div>
                {fx(x.edible_kg, 0)} kg edible fish · FCR {fx(x.fcr, 1)}
              </div>
              {x.source && (
                <div className="flex-1 min-w-[240px]">
                  <div className="text-muted text-xs">Source</div>
                  {x.source}
                </div>
              )}
            </div>
            {x.notes && <p className="note m-0">{x.notes}</p>}
            {gaps.length > 0 && <div className="msg msg-err">Check the valid periods: {gaps.join("; ")}.</div>}
            <h3 className="text-[14px] font-semibold m-0">1 · Sales product → raw fish (yield)</h3>
            <div className="scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th className="num">#</th>
                    <th>Sales product</th>
                    <th>HS</th>
                    <th className="num">Yield %</th>
                    <th className="num">Raw fish kg per kg sold</th>
                    <th className="num">Marine feed kg per kg sold</th>
                  </tr>
                </thead>
                <tbody>
                  {x.yields.map((y, i) => (
                    <tr key={y.product + i}>
                      <td className="num">{i + 1}</td>
                      <td className="whitespace-normal">{y.product}</td>
                      <td className="font-mono">{y.hs}</td>
                      <td className="num">{fx(y.yield * 100, 0)}%</td>
                      <td className="num">{fx(1 / y.yield, 4)}</td>
                      <td className="num">{fx((x.fcr || 2) / y.yield, 4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3 className="text-[14px] font-semibold m-0">2 · Raw fish → raw materials</h3>
            <MaterialsTable s={x} />
          </>
        )}
      </div>

      {list.length >= 2 && <Compare a={list[0]} b={list[list.length - 1]} />}

      {editing && <StandardEditor std={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={(id) => setSel(id)} />}
    </>
  );
}

function MaterialsTable({ s }: { s: Standard }) {
  const ms = s.materials;
  const hat = ms.filter((m) => m.sub === "hatchery");
  const lastHat = ms.map((m) => m.sub).lastIndexOf("hatchery");
  const row = (m: StdMaterial, cls = "") => (
    <tr className={cls}>
      <td className="whitespace-normal">
        {m.mat}
        <div className="text-[11px] text-muted">{m.stage}</div>
      </td>
      <td className="font-mono">{m.hs}</td>
      <td>{m.uom}</td>
      <td>{m.grp || "—"}</td>
      <td className="num">{fx(m.annual, 0)}</td>
      <td className="num">{fx(m.perKg, 6)}</td>
      <td className="num">{fx(m.perKg * 1000, 3)}</td>
      <td className="num">{fRatio(m.perKg)}</td>
    </tr>
  );
  return (
    <div className="scroll">
      <table className="tbl">
        <thead>
          <tr>
            <th>Material</th>
            <th>HS</th>
            <th>UoM</th>
            <th>Register group</th>
            <th className="num">Approval qty / yr</th>
            <th className="num">Per kg fish</th>
            <th className="num">Per 1,000 kg fish</th>
            <th className="num">Ratio (1 : kg fish)</th>
          </tr>
        </thead>
        <tbody>
          {ms.map((m, i) => (
            <Fragment key={m.mat + i}>
              {row(m)}
              {i === lastHat &&
                row(
                  {
                    mat: "Hatchery feed 0.50–3.00 mm (subtotal)",
                    stage: "Used as 'Hatchery Feed' in batch plans",
                    hs: "2309 9010",
                    uom: "Kg",
                    grp: "Fish Feed",
                    sub: "",
                    annual: hat.reduce((a, b) => a + Number(b.annual || 0), 0),
                    perKg: hat.reduce((a, b) => a + Number(b.perKg || 0), 0),
                  },
                  "font-semibold bg-bg",
                )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Compare({ a, b }: { a: Standard; b: Standard }) {
  const change = (va: number | null, vb: number | null) => {
    const v = va && vb ? (vb / va - 1) * 100 : null;
    return (
      <td className={"num" + (v && v < -0.05 ? " text-bad font-semibold" : "")}>
        {v == null ? "–" : Math.abs(v) < 0.05 ? "–" : (v > 0 ? "+" : "") + fx(v, 1) + "%"}
      </td>
    );
  };
  const mats = [...new Set([...a.materials, ...b.materials].map((m) => m.mat))];
  const prods = [...new Set([...a.yields, ...b.yields].map((y) => y.product))];
  const fm = (s: Standard, n: string) => s.materials.find((m) => m.mat === n);
  const fy = (s: Standard, n: string) => s.yields.find((y) => y.product === n);
  return (
    <div className="panel">
      <h2 className="text-[15px] font-semibold m-0">
        Standards compared: {stdShort(a)} and {stdShort(b)}
      </h2>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(420px,1fr))]">
        <div className="scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Material (per 1,000 kg fish)</th>
                <th>UoM</th>
                <th className="num">{stdShort(a)}</th>
                <th className="num">{stdShort(b)}</th>
                <th className="num">Change</th>
              </tr>
            </thead>
            <tbody>
              {mats.map((n) => {
                const x = fm(a, n);
                const y = fm(b, n);
                const va = x ? x.perKg * 1000 : null;
                const vb = y ? y.perKg * 1000 : null;
                return (
                  <tr key={n}>
                    <td className="whitespace-normal">{n}</td>
                    <td>{(x ?? y)!.uom}</td>
                    <td className="num">{fx(va, 3)}</td>
                    <td className="num">{fx(vb, 3)}</td>
                    {change(va, vb)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Sales product (yield %)</th>
                <th className="num">{stdShort(a)}</th>
                <th className="num">{stdShort(b)}</th>
                <th className="num">Change (pts)</th>
              </tr>
            </thead>
            <tbody>
              {prods.map((n) => {
                const x = fy(a, n);
                const y = fy(b, n);
                const va = x ? x.yield * 100 : null;
                const vb = y ? y.yield * 100 : null;
                const d = va != null && vb != null ? vb - va : null;
                return (
                  <tr key={n}>
                    <td className="whitespace-normal">{n}</td>
                    <td className="num">{va == null ? <span className="text-muted">not listed</span> : fx(va, 0) + "%"}</td>
                    <td className="num">{vb == null ? <span className="text-muted">not listed</span> : fx(vb, 0) + "%"}</td>
                    <td className={"num" + (d != null && d < 0 ? " text-bad font-semibold" : "")}>
                      {d == null || Math.abs(d) < 0.01 ? "–" : (d > 0 ? "+" : "") + fx(d, 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---- Editor -------------------------------------------------------------------------------------------------

type YRow = { product: string; hs: string; yieldPct: string };
type MRow = { mat: string; stage: string; hs: string; uom: string; grp: string; sub: string; annual: string; per1000: string };
type QRow = { label: string; hs: string; uom: string; basis: string; per1000: string; grp: string; kind: string; kw: string };

const s6 = (n: number) => (n ? String(+n.toFixed(6)) : "");

function StandardEditor({ std, onClose, onSaved }: { std: Standard | null; onClose: () => void; onSaved: (id: string) => void }) {
  const { supabase, company, user, flash } = useApp();
  const { reload } = useTiep();
  const [name, setName] = useState(std?.name ?? "");
  const [short, setShort] = useState(std?.short ?? "");
  const [from, setFrom] = useState(std?.valid_from ?? "");
  const [to, setTo] = useState(std?.valid_to ?? "");
  const [basis, setBasis] = useState(String(std?.edible_kg ?? 2124000));
  const [fcr, setFcr] = useState(String(std?.fcr ?? 2));
  const [notes, setNotes] = useState(std?.notes ?? "");
  const [source, setSource] = useState(std?.source ?? "");
  const [ys, setYs] = useState<YRow[]>(() => (std?.yields ?? []).map((y) => ({ product: y.product, hs: y.hs, yieldPct: String(r4(y.yield * 100)) })));
  const [ms, setMs] = useState<MRow[]>(() =>
    (std?.materials ?? []).map((m) => ({
      mat: m.mat,
      stage: m.stage || "Hatchery",
      hs: m.hs,
      uom: m.uom,
      grp: m.grp,
      sub: m.sub,
      annual: m.annual ? String(r4(m.annual)) : "",
      per1000: s6(m.perKg * 1000),
    })),
  );
  const [qs, setQs] = useState<QRow[]>(() =>
    (std ? stdMud(std) : []).map((q) => ({ ...q, per1000: s6(q.per1000), basis: q.basis })),
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const B = () => Number(basis) || 2124000;

  const upd = <T,>(set: React.Dispatch<React.SetStateAction<T[]>>, i: number, patch: Partial<T>) =>
    set((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  // Annual quantity and per 1,000 kg are linked through the edible fish basis.
  const setAnnual = (i: number, v: string) => upd(setMs, i, { annual: v, per1000: Number(v) ? s6((Number(v) / B()) * 1000) : "" });
  const setPer = (i: number, v: string) => upd(setMs, i, { per1000: v, annual: Number(v) ? String(+((Number(v) * B()) / 1000).toFixed(4)) : "" });
  const setBasisAll = (v: string) => {
    setBasis(v);
    const b = Number(v) || 2124000;
    setMs((rows) => rows.map((r) => (Number(r.annual) ? { ...r, per1000: s6((Number(r.annual) / b) * 1000) } : r)));
  };

  async function save() {
    if (!company) return;
    if (from && to && from > to) return setMsg("Valid from is after valid to.");
    const yields: StdYield[] = ys
      .filter((y) => y.product.trim())
      .map((y) => ({ product: y.product.trim(), hs: y.hs.trim(), yield: r4(Number(y.yieldPct) / 100) }));
    if (!yields.length) return setMsg("Add at least one sales product.");
    const bad = yields.find((y) => !(y.yield > 0 && y.yield <= 1));
    if (bad) return setMsg(`Yield for ${bad.product} must be between 0 and 100%.`);
    if (yields.map((y) => normP(y.product)).some((n, i, a) => a.indexOf(n) !== i)) return setMsg("A sales product is listed twice.");
    const materials: StdMaterial[] = ms
      .filter((m) => m.mat.trim())
      .map((m) => ({
        mat: m.mat.trim(),
        stage: m.stage,
        hs: m.hs.trim(),
        uom: m.uom.trim(),
        grp: m.grp,
        sub: m.sub,
        annual: Number(m.annual) || 0,
        perKg: (Number(m.per1000) || 0) / 1000,
      }));
    if (materials.some((m) => !(m.perKg > 0))) return setMsg("Each material needs a quantity per 1,000 kg fish.");
    const mud: StdMud[] = qs
      .filter((q) => q.label.trim())
      .map((q) => ({
        label: q.label.trim(),
        hs: q.hs.trim(),
        uom: q.uom.trim(),
        basis: q.basis === "boxes" ? "boxes" : "fish",
        per1000: Number(q.per1000) || 0,
        grp: q.grp,
        kind: q.kind,
        kw: q.kw.trim(),
      }));
    const nm = name.trim() || std?.name || "";
    if (!nm) return setMsg("Enter the standard's name.");
    const row = {
      company_id: company.id,
      name: nm,
      short: short.trim() || nm,
      valid_from: from || null,
      valid_to: to || null,
      edible_kg: B(),
      fcr: Number(fcr) || 2,
      notes: notes.trim() || null,
      source: source.trim() || null,
      yields,
      materials,
      mud,
    };
    setBusy(true);
    const res = std
      ? await supabase.from("tiep_standards").update({ ...row, updated_at: new Date().toISOString(), updated_by: user.id }).eq("id", std.id).select("id").single()
      : await supabase.from("tiep_standards").insert({ ...row, created_by: user.id }).select("id").single();
    setBusy(false);
    if (res.error) return setMsg("Could not save: " + res.error.message);
    flash(`${row.short} saved.`);
    onSaved((res.data as { id: string }).id);
    onClose();
    await reload();
  }

  const inp = (value: string, onChange: (v: string) => void, extra: Record<string, string> = {}, cls = "") => (
    <input className={"control " + cls} value={value} onChange={(e) => onChange(e.target.value)} {...extra} />
  );
  const del = (onClick: () => void) => (
    <button className="btn btn-danger py-0" type="button" onClick={onClick}>
      Remove
    </button>
  );

  return (
    <Modal
      title={std ? `Edit · ${std.name}` : "Add standard"}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save standard"}
          </button>
        </>
      }
    >
      <div className="bar">
        <label className="field">
          Name
          {inp(name, setName, {}, "w-[220px]")}
        </label>
        <label className="field">
          Short name
          {inp(short, setShort, {}, "w-[120px]")}
        </label>
        <label className="field">
          Valid from
          {inp(from, setFrom, { type: "date" })}
        </label>
        <label className="field">
          Valid to
          {inp(to, setTo, { type: "date" })}
        </label>
        <label className="field">
          Edible fish basis (kg)
          {inp(basis, setBasisAll, { type: "number", step: "any", min: "1" }, "w-[130px]")}
        </label>
        <label className="field">
          FCR (kg feed / kg fish)
          {inp(fcr, setFcr, { type: "number", step: "any", min: "0" }, "w-[100px]")}
        </label>
      </div>
      <div className="bar">
        <label className="field flex-1">
          Notes
          {inp(notes, setNotes)}
        </label>
        <label className="field flex-1">
          Source (approval reference)
          {inp(source, setSource)}
        </label>
      </div>
      <p className="note m-0">
        Leave a date blank for an open-ended period. Annual qty and per 1,000 kg are linked through the edible fish basis:
        change either one and the other updates.
      </p>

      <h3 className="text-[14px] font-semibold m-0">Sales product → raw fish (yield)</h3>
      <div className="scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Sales product</th>
              <th>HS</th>
              <th>Yield %</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ys.map((y, i) => (
              <tr key={i}>
                <td>{inp(y.product, (v) => upd(setYs, i, { product: v }), {}, "w-full min-w-[220px]")}</td>
                <td>{inp(y.hs, (v) => upd(setYs, i, { hs: v }), {}, "w-[150px]")}</td>
                <td>{inp(y.yieldPct, (v) => upd(setYs, i, { yieldPct: v }), { type: "number", step: "0.01", min: "0", max: "100" }, "w-[90px]")}</td>
                <td>{del(() => setYs((r) => r.filter((_, j) => j !== i)))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <button className="btn" type="button" onClick={() => setYs((r) => [...r, { product: "", hs: "", yieldPct: "" }])}>
          + Add product
        </button>
      </div>

      <h3 className="text-[14px] font-semibold m-0">Raw fish → raw materials</h3>
      <div className="scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Material</th>
              <th>Stage</th>
              <th>HS</th>
              <th>UoM</th>
              <th>Register group</th>
              <th>Subtotal</th>
              <th className="num">Annual qty</th>
              <th className="num">Per 1,000 kg fish</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ms.map((m, i) => (
              <tr key={i}>
                <td>{inp(m.mat, (v) => upd(setMs, i, { mat: v }), {}, "w-full min-w-[160px]")}</td>
                <td>
                  <select className="control" value={m.stage} onChange={(e) => upd(setMs, i, { stage: e.target.value })}>
                    <option>Hatchery</option>
                    <option>Grow-out</option>
                  </select>
                </td>
                <td>{inp(m.hs, (v) => upd(setMs, i, { hs: v }), {}, "w-[110px]")}</td>
                <td>{inp(m.uom, (v) => upd(setMs, i, { uom: v }), {}, "w-[60px]")}</td>
                <td>
                  <select className="control" value={m.grp} onChange={(e) => upd(setMs, i, { grp: e.target.value })}>
                    <option value="">—</option>
                    {GROUPS.map((g) => (
                      <option key={g}>{g}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select className="control" value={m.sub} onChange={(e) => upd(setMs, i, { sub: e.target.value })}>
                    <option value="">—</option>
                    <option value="hatchery">Hatchery feed subtotal</option>
                    <option value="liquid">Liquid hatchery feed</option>
                    <option value="marine">Marine (grow-out) feed</option>
                  </select>
                </td>
                <td>{inp(m.annual, (v) => setAnnual(i, v), { type: "number", step: "any", min: "0" }, "w-[110px]")}</td>
                <td>{inp(m.per1000, (v) => setPer(i, v), { type: "number", step: "any", min: "0" }, "w-[110px]")}</td>
                <td>{del(() => setMs((r) => r.filter((_, j) => j !== i)))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <button
          className="btn"
          type="button"
          onClick={() => setMs((r) => [...r, { mat: "", stage: "Hatchery", hs: "", uom: "", grp: "", sub: "", annual: "", per1000: "" }])}
        >
          + Add material
        </button>
      </div>

      <h3 className="text-[14px] font-semibold m-0">Lines claimed on the MUD form</h3>
      <p className="note m-0">What the Material Utilization Declaration claims per kg of whole fish (or per box), and which import lines it draws on.</p>
      <div className="scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Item on MUD</th>
              <th>HS</th>
              <th>UoM</th>
              <th>Basis</th>
              <th className="num">Per 1,000 kg fish</th>
              <th>Register group</th>
              <th>Feed type</th>
              <th>Description contains</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {qs.map((q, i) => (
              <tr key={i}>
                <td>{inp(q.label, (v) => upd(setQs, i, { label: v }), {}, "w-[150px]")}</td>
                <td>{inp(q.hs, (v) => upd(setQs, i, { hs: v }), {}, "w-[90px]")}</td>
                <td>{inp(q.uom, (v) => upd(setQs, i, { uom: v }), {}, "w-[50px]")}</td>
                <td>
                  <select className="control" value={q.basis} onChange={(e) => upd(setQs, i, { basis: e.target.value })}>
                    <option value="fish">Whole fish</option>
                    <option value="boxes">Boxes (1 each)</option>
                  </select>
                </td>
                <td>{inp(q.per1000, (v) => upd(setQs, i, { per1000: v }), { type: "number", step: "any", min: "0" }, "w-[110px]")}</td>
                <td>
                  <select className="control" value={q.grp} onChange={(e) => upd(setQs, i, { grp: e.target.value })}>
                    <option value="">—</option>
                    {GROUPS.map((g) => (
                      <option key={g}>{g}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select className="control" value={q.kind} onChange={(e) => upd(setQs, i, { kind: e.target.value })}>
                    <option value="">Any</option>
                    {FEED_TYPES.map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                  </select>
                </td>
                <td>{inp(q.kw, (v) => upd(setQs, i, { kw: v }), {}, "w-[90px]")}</td>
                <td>{del(() => setQs((r) => r.filter((_, j) => j !== i)))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <button
          className="btn"
          type="button"
          onClick={() => setQs((r) => [...r, { label: "", hs: "", uom: "", basis: "fish", per1000: "", grp: "", kind: "", kw: "" }])}
        >
          + Add MUD line
        </button>
      </div>
      {msg && <div className="msg msg-err">{msg}</div>}
    </Modal>
  );
}
