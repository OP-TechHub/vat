"use client";

import { Fragment, useMemo, useState } from "react";
import { useTiep } from "./TiepProvider";
import { n0, n2 } from "./ui";
import s from "./matrix.module.css";
import { PRODUCT_ORDER, ProdPick, TbrChip, canLabel, cx, dutyOf, isCapital, usePosts, type Post } from "./TiepEntriesView";
import { downloadCsv, fdate, r4, toCsv, type TiepLine } from "@/lib/tiep/model";

interface Col {
  k: string;
  prod: string;
  uom: string;
  hs: string[];
}
interface XLine {
  c: Post;
  r: TiepLine;
  k: string;
}
interface Ln {
  r: TiepLine;
  k: string;
  status: Post["status"];
  qty: number;
  duty: number;
  item: string;
}
interface CEnt {
  key: string;
  label: string;
  local: boolean;
  lb: boolean;
  ref: string;
  tbr: boolean;
  inv: Set<string>;
  batch: string;
  date: string;
  planned: number;
  done: number;
  cells: Record<string, { done: number; plan: number }>;
  duty: number;
  imps: Map<string, string>;
  lines: Map<string, Ln>;
  status: "Completed" | "Planned" | "Part planned";
  invTxt: string;
}

const norm = (v: string) => v.toUpperCase().replace(/\s+/g, " ");

/** The cancellation entry a posting belongs to. */
function cxKey(c: Post): string {
  const lb = c.source === "logbook";
  if (c.type === "local" && !lb) return c.cancelCusdec ? "L|" + norm(c.cancelCusdec) : "R|" + c.ref;
  if (c.expCusdec) return "E|" + norm(c.expCusdec) + "|" + c.expInv;
  if (c.expInv) return "I|" + c.expInv;
  return "X|" + (c.id || c.ref);
}
const dateOf = (c: Post) => (c.type === "local" && c.cancelDate ? c.cancelDate : c.date);
const dnOrd = (v: number) => (isNaN(v) ? Infinity : v);
const cq = (v: number) => (v ? "(" + n2(v) + ")" : "");

function cxData(
  all: XLine[],
  sel: Set<string>,
  labels: Record<string, string>,
  f: { ty: string; st: string; q: string; from: string; to: string; hideBlank: boolean },
) {
  const q = f.q.trim().toLowerCase();
  const qd = q.replace(/\D/g, "");
  const cols: Col[] = [];
  for (const p of PRODUCT_ORDER) {
    if (!sel.has(p)) continue;
    [...new Set(all.filter((x) => x.r.prod === p).map((x) => x.r.uom))].sort().forEach((u) => {
      const hs = [...new Set(all.filter((x) => x.r.prod === p && x.r.uom === u).map((x) => String(x.r.hs || "")).filter(Boolean))].sort();
      cols.push({ k: p + "|" + u, prod: p, uom: u, hs });
    });
  }
  const ck = new Set(cols.map((c) => c.k));
  const ents = new Map<string, CEnt>();
  for (const x of all) {
    const { c, r } = x;
    if (!ck.has(x.k)) continue;
    const local = c.type === "local";
    const lb = c.source === "logbook";
    const status = c.status || "Completed";
    if (f.ty && (local ? "local" : "export") !== f.ty) continue;
    if (f.st && status !== f.st) continue;
    const d = dateOf(c) || "";
    if ((f.from || f.to) && (!d || (f.from && d < f.from) || (f.to && d > f.to))) continue;
    const key = cxKey(c);
    let e = ents.get(key);
    if (!e) {
      e = {
        key,
        label: local && !lb ? canLabel(c, labels) : c.expCusdec || (c.expInv ? "Export (CusDec not recorded)" : "Not recorded"),
        local,
        lb,
        ref: c.ref,
        tbr: local && !lb && !c.cancelCusdec,
        inv: new Set(),
        batch: "",
        date: "",
        planned: 0,
        done: 0,
        cells: {},
        duty: 0,
        imps: new Map(),
        lines: new Map(),
        status: "Completed",
        invTxt: "",
      };
      ents.set(key, e);
    }
    if (c.expInv && !local) e.inv.add(c.expInv);
    if (local && c.batch) e.batch = c.batch;
    if (d && (!e.date || d < e.date)) e.date = d;
    const qty = c.qty;
    const duty = dutyOf(c, r);
    if (status === "Planned") e.planned++;
    else e.done++;
    const cell = e.cells[x.k] || (e.cells[x.k] = { done: 0, plan: 0 });
    if (status === "Planned") cell.plan += qty;
    else cell.done += qty;
    e.duty += duty;
    e.imps.set(r.ek, r.cusdec);
    const lk = r.key + "|" + status;
    const ln = e.lines.get(lk) || { r, k: x.k, status, qty: 0, duty: 0, item: c.item && c.item !== "Export per logbook" ? c.item : r.desc };
    ln.qty += qty;
    ln.duty += duty;
    e.lines.set(lk, ln);
  }
  let list = [...ents.values()];
  for (const e of list) {
    e.status = e.done && e.planned ? "Part planned" : e.planned ? "Planned" : "Completed";
    e.invTxt = [...e.inv].join(", ");
  }
  if (q)
    list = list.filter(
      (e) =>
        [e.label, e.invTxt, e.batch, e.ref, [...e.imps.values()].join(" ")].join(" ").toLowerCase().includes(q) ||
        (!!qd &&
          (e.label.replace(/\D/g, "").includes(qd) || [...e.imps.values()].some((v) => String(v).replace(/\D/g, "").includes(qd)))),
    );
  if (f.hideBlank) {
    const nz = (v: number) => Math.abs(r4(v || 0)) > 0;
    list = list.filter((e) =>
      cols.some((c) => {
        const v = e.cells[c.k];
        return v && (nz(v.done) || nz(v.plan));
      }),
    );
  }
  const numOf = (e: CEnt) => +(e.label.replace(/\D/g, "") || 0);
  list.sort(
    (a, b) =>
      (a.lb ? 1 : 0) - (b.lb ? 1 : 0) ||
      (a.date ? 0 : 1) - (b.date ? 0 : 1) ||
      a.date.localeCompare(b.date) ||
      numOf(a) - numOf(b) ||
      a.label.localeCompare(b.label),
  );
  return { cols, ents: list };
}

export default function TiepCancelsView() {
  const { lineOf, asAt, loading, cancels } = useTiep();
  const { posts, labels } = usePosts();

  const [prodsUser, setProdsUser] = useState<Set<string> | null>(null);
  const [ty, setTy] = useState("");
  const [st, setSt] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [periodSet, setPeriodSet] = useState(false);
  const [q, setQ] = useState("");
  const [hideBlank, setHideBlank] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const all = useMemo(
    () =>
      posts
        .map((c) => {
          const r = lineOf.get(c.key);
          return r ? { c, r, k: r.prod + "|" + r.uom } : null;
        })
        .filter((x): x is XLine => !!x),
    [posts, lineOf],
  );
  const options = useMemo(() => {
    const gs = new Set(all.map((x) => x.r.prod));
    return PRODUCT_ORDER.filter((p) => gs.has(p));
  }, [all]);
  const sel = useMemo(() => prodsUser ?? new Set(options.filter((p) => !isCapital(p))), [prodsUser, options]);
  const bounds = useMemo(() => {
    const ds = all.map((x) => dateOf(x.c)).filter(Boolean).sort();
    return { min: ds[0] || "", max: ds[ds.length - 1] || "" };
  }, [all]);
  const pFrom = periodSet ? from : bounds.min;
  const pTo = periodSet ? to : bounds.max;

  const { cols, ents } = useMemo(
    () => cxData(all, sel, labels, { ty, st, q, from: periodSet ? from : "", to: periodSet ? to : "", hideBlank }),
    [all, sel, labels, ty, st, q, periodSet, from, to, hideBlank],
  );

  const toggle = (k: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  function csv() {
    const head = [
      "Cancellation entry", "Type", "Status", "Export invoice", "Date", "Batch / source", "Import CusDec", "Import date", "Import line", "Item",
      ...cols.map((c) => `${c.prod} (${c.uom}) qty`),
      "Duty (LKR)",
    ];
    const out: (string | number | null)[][] = [["Cancellations by cancellation entry"], head];
    for (const e of ents) {
      const src = e.local ? e.batch || "Local sale" : e.lb ? "Export per TIEP logbook" : "Export";
      const type = e.local ? "Local sale" : "Export";
      out.push([
        e.label, type, e.status, e.invTxt, e.date, src, [...e.imps.values()].join(" / "), "", "Total", "",
        ...cols.map((c) => {
          const v = e.cells[c.k];
          return v ? r4(v.done + v.plan) : "";
        }),
        Math.round(e.duty),
      ]);
      for (const l of e.lines.values())
        out.push([
          e.label, type, l.status, e.invTxt, e.date, src, l.r.cusdec, l.r.date, l.r.id, l.item,
          ...cols.map((c) => (c.k === l.k ? r4(l.qty) : "")),
          Math.round(l.duty),
        ]);
    }
    downloadCsv(`TIEP_By_Cancellation_Entry_${asAt}.csv`, toCsv(out));
  }

  if (loading && !cancels.length) return <div className="note">Loading the TIEP register…</div>;

  const T = { done: {} as Record<string, number>, plan: {} as Record<string, number> };
  let TD = 0;
  for (const e of ents) {
    for (const c of cols) {
      const v = e.cells[c.k];
      if (!v) continue;
      T.done[c.k] = (T.done[c.k] || 0) + v.done;
      T.plan[c.k] = (T.plan[c.k] || 0) + v.plan;
    }
    TD += e.duty;
  }
  const anyPlan = cols.some((c) => T.plan[c.k]);
  const cellTxt = (k: string, v: { done: number; plan: number } | undefined) => {
    if (!v)
      return (
        <td key={k} className={cx("num", s.z)}>
          ·
        </td>
      );
    const a = v.done ? cq(v.done) : "";
    const b = v.plan ? n2(v.plan) : "";
    return (
      <td key={k} className="num">
        {a && b ? (
          <>
            {a}
            <div className="note text-[11px]">{b} planned</div>
          </>
        ) : (
          a || b || "–"
        )}
      </td>
    );
  };
  const stc = (e: CEnt) =>
    e.tbr && e.status !== "Completed" ? (
      <TbrChip refName={e.ref} labels={labels} />
    ) : e.status === "Completed" ? (
      <span className="chip chip-done">Completed</span>
    ) : e.status === "Planned" ? (
      <span className="chip chip-plan">Planned</span>
    ) : (
      <span className="chip chip-plan">Part planned</span>
    );

  return (
    <div className="panel">
      <h2 className="text-[15px] font-semibold m-0">Cancellations by cancellation entry and product</h2>
      <div className="bar">
        <ProdPick options={options} selected={sel} onChange={setProdsUser} />
        <label className="field">
          Type
          <select className="control" value={ty} onChange={(e) => setTy(e.target.value)}>
            <option value="">All</option>
            <option value="export">Export</option>
            <option value="local">Local sale (duty paid)</option>
          </select>
        </label>
        <label className="field">
          Status
          <select className="control" value={st} onChange={(e) => setSt(e.target.value)}>
            <option value="">All</option>
            <option>Completed</option>
            <option>Planned</option>
          </select>
        </label>
        <label className="field">
          Period from
          <input
            className="control"
            type="date"
            min={bounds.min}
            max={bounds.max}
            value={pFrom}
            onChange={(e) => {
              setFrom(e.target.value);
              if (!periodSet) setTo(pTo);
              setPeriodSet(true);
            }}
          />
        </label>
        <label className="field">
          to
          <input
            className="control"
            type="date"
            min={bounds.min}
            max={bounds.max}
            value={pTo}
            onChange={(e) => {
              setTo(e.target.value);
              if (!periodSet) setFrom(pFrom);
              setPeriodSet(true);
            }}
          />
        </label>
        <button className="btn" type="button" onClick={() => setPeriodSet(false)}>
          Full period
        </button>
        <label className="field">
          Search
          <input className="control" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Entry, invoice or import CusDec" />
        </label>
        <div className="field">
          Rows
          <label className="inline-flex items-center gap-1.5 text-[13px] text-ink py-1.5" title="Hide entries with nothing in any of the selected products">
            <input type="checkbox" checked={hideBlank} onChange={(e) => setHideBlank(e.target.checked)} /> Remove blank entries
          </label>
        </div>
        <span className="flex-1" />
        <button className="btn" type="button" onClick={() => setOpen(new Set(ents.map((e) => e.key)))}>
          Expand all
        </button>
        <button className="btn" type="button" onClick={() => setOpen(new Set())}>
          Collapse all
        </button>
        <button className="btn" type="button" onClick={csv}>
          Download CSV
        </button>
      </div>

      <div className="scroll">
        <table className={cx("tbl", s.mx)}>
          <thead>
            <tr>
              <th className={s.k1}>Cancellation entry</th>
              <th>Type</th>
              <th>Export invoice</th>
              <th>Date</th>
              <th>Batch / source</th>
              <th>Import entries cancelled</th>
              {cols.map((c) => (
                <th key={c.k} className={s.prod}>
                  {c.prod}
                  <small>{c.uom}</small>
                  <small className={s.hsc}>HS {c.hs.join(", ") || "–"}</small>
                </th>
              ))}
              <th className="num">Duty (LKR)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {!ents.length ? (
              <tr>
                <td className={cx(s.k1, s.empty)} colSpan={cols.length + 8}>
                  {cols.length ? "No cancellation entries match these filters." : "Select at least one product."}
                </td>
              </tr>
            ) : (
              ents.map((e) => {
                const isOpen = open.has(e.key);
                const imps = [...e.imps.entries()];
                const ls = isOpen
                  ? [...e.lines.values()].sort(
                      (a, b) => dnOrd(a.r.dn) - dnOrd(b.r.dn) || a.r.cusdec.localeCompare(b.r.cusdec) || a.r.id.localeCompare(b.r.id),
                    )
                  : [];
                return (
                  <Fragment key={e.key}>
                    <tr className={s.ent} onClick={() => toggle(e.key)}>
                      <td className={s.k1}>
                        <button
                          className={s.xbtn}
                          type="button"
                          aria-expanded={isOpen}
                          aria-label={(isOpen ? "Hide" : "Show") + " import lines for " + e.label}
                        >
                          {isOpen ? "−" : "+"}
                        </button>
                        <b>{e.label}</b>
                      </td>
                      <td>
                        <span className="chip">{e.local ? "Local sale" : "Export"}</span>
                      </td>
                      <td className="font-mono">{e.invTxt}</td>
                      <td>{fdate(e.date)}</td>
                      <td className={s.wrap} style={{ minWidth: 120, maxWidth: 200 }}>
                        {e.local ? e.batch || "Local sale" : e.lb ? "Export · per TIEP logbook" : "Export"}
                      </td>
                      <td className={s.wrap} style={{ minWidth: 140, maxWidth: 240 }}>
                        {imps
                          .slice(0, 3)
                          .map(([, cd]) => cd)
                          .join(", ")}
                        {imps.length > 3 ? ` +${imps.length - 3} more` : ""}
                        <div className="note text-[11px]">
                          {imps.length} import entr{imps.length === 1 ? "y" : "ies"}
                        </div>
                      </td>
                      {cols.map((c) => cellTxt(c.k, e.cells[c.k]))}
                      <td className="num">{n0(e.duty)}</td>
                      <td>{stc(e)}</td>
                    </tr>
                    {ls.map((l, i) => (
                      <tr key={l.r.key + "|" + l.status} className={cx(s.msub, s.det, i === ls.length - 1 && s.last)}>
                        <td className={s.k1}>{l.r.cusdec}</td>
                        <td>
                          <span className="chip">Import</span>
                        </td>
                        <td></td>
                        <td>{fdate(l.r.date)}</td>
                        <td className={s.wrap} colSpan={2} style={{ minWidth: 200 }}>
                          {l.r.id} · {l.item || l.r.desc}
                        </td>
                        {cols.map((c) =>
                          c.k === l.k ? (
                            <td key={c.k} className="num">
                              {l.status === "Planned" ? (
                                <>
                                  {n2(l.qty)}
                                  <div className="note text-[11px]">planned</div>
                                </>
                              ) : (
                                cq(l.qty)
                              )}
                            </td>
                          ) : (
                            <td key={c.k}></td>
                          ),
                        )}
                        <td className="num">{n0(l.duty)}</td>
                        <td></td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr className={s.bal}>
              <td className={s.k1}>Cancelled (completed)</td>
              <td colSpan={5}>{ents.length} cancellation entries</td>
              {cols.map((c) => (
                <td key={c.k} className="num">
                  {T.done[c.k] ? cq(T.done[c.k]) : "–"}
                </td>
              ))}
              <td className="num">{n0(TD)}</td>
              <td></td>
            </tr>
            {anyPlan && (
              <tr>
                <td className={s.k1}>Planned</td>
                <td colSpan={5}></td>
                {cols.map((c) => (
                  <td key={c.k} className="num">
                    {n2(T.plan[c.k] || 0)}
                  </td>
                ))}
                <td></td>
                <td></td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>
      <p className="note m-0">
        Each row is one cancellation entry: an export CusDec, or the customs entry raised to pay duty on a local-sale batch
        (&ldquo;to be raised&rdquo; until the number is known). Cancelled quantities are in brackets; planned quantities are
        plain. Click + to see which import entries and lines each one cancelled. Logbook exports carry no export date, so
        they drop out when you narrow the period.
      </p>
    </div>
  );
}
