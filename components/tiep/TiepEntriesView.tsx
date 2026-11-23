"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTiep } from "./TiepProvider";
import { PostingChip, n0, n2 } from "./ui";
import s from "./matrix.module.css";
import {
  CATEGORY,
  NO_GROUP,
  PRODUCTS,
  allocLiab,
  downloadCsv,
  fdate,
  grpOfProd,
  lineKey,
  r4,
  toCsv,
  type Batch,
  type Cancellation,
  type Group,
  type TiepLine,
} from "@/lib/tiep/model";
import type { Proposal, TiepGroup, TiepInvoice } from "@/lib/tiep/invoices";

// ---- Shared by the two matrices (By customs entry, By cancellation entry) --------------------------------

/** Class names, skipping blanks. */
export const cx = (...a: (string | number | false | null | undefined)[]) => a.filter(Boolean).join(" ");
const num = (v: unknown) => {
  const x = Number(v);
  return isFinite(x) ? x : 0;
};
const nz = (v: number | null | undefined) => Math.abs(r4(v || 0)) > 0;

/** Product order of the columns; lines without a material group come last. */
export const PRODUCT_ORDER = [...PRODUCTS, NO_GROUP];
/** Capital goods / spares are left out of the matrices until picked. */
export const isCapital = (p: string) => p !== NO_GROUP && CATEGORY[grpOfProd(p) as Group] === "Capital Goods / Spares";

/** A posting against an import line: a ledger row, or a FIFO proposal (Pending confirmation, not saved). */
export interface Post {
  id: string;
  /** Import line key. */
  key: string;
  source: Cancellation["source"] | "proposal";
  type: "export" | "local";
  status: "Completed" | "Planned" | "Pending";
  ref: string;
  /** Posting date (export date). */
  date: string;
  /** Date of the customs entry raised for a local-sale batch. */
  cancelDate: string;
  expInv: string;
  expCusdec: string;
  cancelCusdec: string;
  batch: string;
  invId: string;
  item: string;
  qty: number;
  duty: number | null;
}

export function postOf(c: Cancellation, batchOf: Map<string, Batch>): Post {
  return {
    id: c.id,
    key: lineKey(c.cusdec_no, c.invoice_no, c.item_no),
    source: c.source,
    type: c.type,
    status: c.status,
    ref: c.ref,
    date: c.posting_date ?? "",
    cancelDate: c.cancel_date ?? "",
    expInv: c.exp_inv ?? "",
    expCusdec: c.exp_cusdec ?? "",
    cancelCusdec: c.cancel_cusdec ?? "",
    batch: (c.batch_id && batchOf.get(c.batch_id)?.name) || "",
    invId: c.sales_invoice_id ?? "",
    item: c.item ?? "",
    qty: num(c.qty),
    duty: c.duty,
  };
}

/** FIFO proposals as postings: the subject (export invoice or MUD group) stands in for the export invoice. */
export function proposalPosts(props: Proposal[], invoices: TiepInvoice[], groups: TiepGroup[]): Post[] {
  const invOf = new Map(invoices.map((v) => [v.inv.id, v]));
  const grpOf = new Map(groups.map((g) => [g.mud.id, g]));
  return props.map((p, i) => {
    const v = invOf.get(p.subjectId);
    const g = v ? undefined : grpOf.get(p.subjectId);
    return {
      id: `PROP-${p.subjectId}-${i}`,
      key: p.key,
      source: "proposal",
      type: "export",
      status: "Pending",
      ref: "PROP-" + p.subjectId,
      date: (v ? v.inv.invoice_date : g?.date) ?? "",
      cancelDate: "",
      expInv: v ? v.inv.invoice_no : (g?.mud.group_name ?? p.label),
      expCusdec: v?.exportE ?? "",
      cancelCusdec: "",
      batch: "",
      invId: p.subjectId,
      item: p.label,
      qty: num(p.qty),
      duty: p.duty,
    };
  });
}

/** Ledger postings and the FIFO proposals as Posts. */
export function usePosts() {
  const { cancels, batches, proposals, invoices, groups } = useTiep();
  const batchOf = useMemo(() => new Map(batches.map((b) => [b.id, b])), [batches]);
  const posts = useMemo(() => cancels.map((c) => postOf(c, batchOf)), [cancels, batchOf]);
  const props = useMemo(() => proposalPosts(proposals.props, invoices, groups), [proposals.props, invoices, groups]);
  const labels = useMemo(() => entryLabels(posts), [posts]);
  return { posts, props, labels };
}

/** The cancellation customs entry of a posting: the export CusDec, or the entry raised for a local sale. */
export const canKey = (c: Pick<Post, "type" | "cancelCusdec" | "expCusdec">) => (c.type === "local" ? c.cancelCusdec : c.expCusdec) || "";

/** "Entry 1", "Entry 2", … for postings whose cancellation entry is not raised yet, oldest first. */
export function entryLabels(posts: Post[]): Record<string, string> {
  const refs = new Map<string, { d: string; ref: string }>();
  for (const c of posts) {
    if (c.source === "logbook" || canKey(c)) continue;
    const r = refs.get(c.ref);
    const d = c.date;
    if (!r || d < r.d) refs.set(c.ref, { d, ref: c.ref });
  }
  const lab: Record<string, string> = {};
  [...refs.values()]
    .sort((a, b) => a.d.localeCompare(b.d) || a.ref.localeCompare(b.ref))
    .forEach((x, i) => {
      lab[x.ref] = "Entry " + (i + 1);
    });
  return lab;
}

export const canLabel = (c: Post, labels: Record<string, string>) =>
  canKey(c) || (labels[c.ref] ? labels[c.ref] + " (to be raised)" : "To be raised");

export function TbrChip({ refName, labels }: { refName: string; labels: Record<string, string> }) {
  const l = labels[refName];
  return <span className="chip chip-open">{l ? l + " · to be raised" : "To be raised"}</span>;
}

export const PropChip = () => <span className="chip border-dashed border-warn text-warn">Pending confirmation</span>;
export const LateChip = () => (
  <span className="chip chip-bad ml-1" title="Export dated before this import">
    ⚠ Before import date
  </span>
);

/** Product multi-select (a drop-down of checkboxes). */
export function ProdPick({ options, selected, onChange }: { options: string[]; selected: Set<string>; onChange: (s: Set<string>) => void }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      const d = ref.current;
      if (d?.open && !d.contains(e.target as Node)) d.open = false;
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  const all = options.length > 0 && options.every((g) => selected.has(g));
  const some = !all && selected.size > 0;
  const sum = all
    ? `All products (${options.length})`
    : selected.size === 0
      ? "No products selected"
      : selected.size === 1
        ? [...selected][0]
        : `${selected.size} products selected`;
  return (
    <div className="field">
      Products
      <details className={s.pick} ref={ref}>
        <summary>{sum}</summary>
        <div className={s.pickPanel}>
          <label className={s.pickAll}>
            <input
              type="checkbox"
              checked={all}
              ref={(el) => {
                if (el) el.indeterminate = some;
              }}
              onChange={(e) => onChange(new Set(e.target.checked ? options : []))}
            />
            Select all
          </label>
          {options.map((g) => (
            <label key={g}>
              <input
                type="checkbox"
                checked={selected.has(g)}
                onChange={(e) => {
                  const n = new Set(selected);
                  if (e.target.checked) n.add(g);
                  else n.delete(g);
                  onChange(n);
                }}
              />
              {g}
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}

// ---- Imports by customs entry ---------------------------------------------------------------------------

type Metric = "bal" | "osv";
type Layout = "cols" | "rows";
type SubKey = "qty" | "cqty" | "pqty" | "xqty" | "bal" | "osv";

interface Col {
  k: string;
  prod: string;
  uom: string;
  hs: string[];
}
interface Cell {
  qty: number;
  cqty: number;
  pqty: number;
  xqty: number;
  bal: number;
  osv: number;
  pend: boolean;
  hs: string[];
}
interface Ent {
  ek: string;
  cusdec: string;
  date: string | null;
  dn: number;
  sup: string;
  cells: Record<string, Cell>;
  left: number;
  plan: number;
  prop: number;
  pend: boolean;
  overdue: boolean;
}
interface Det {
  lbk: boolean;
  status: Post["status"];
  ref: string;
  invId: string;
  late: boolean;
  label: string;
  inv: string;
  date: string;
  src: string;
  item: string;
  k: string;
  qty: number;
}

const colKey = (r: Pick<TiepLine, "prod" | "uom">) => r.prod + "|" + r.uom;
const dnOrd = (v: number) => (isNaN(v) ? Infinity : v);

function mxData(
  lines: TiepLine[],
  sel: Set<string>,
  f: { from: string; to: string; q: string; hideBlank: boolean; hideDone: boolean },
) {
  const q = f.q.trim().replace(/\D/g, "");
  let ls = lines.filter((r) => r.req !== "No");
  if (f.from) ls = ls.filter((r) => !!r.date && r.date >= f.from);
  if (f.to) ls = ls.filter((r) => !!r.date && r.date <= f.to);
  const cols: Col[] = [];
  for (const p of PRODUCT_ORDER) {
    if (!sel.has(p)) continue;
    const uoms = [...new Set(ls.filter((r) => r.prod === p).map((r) => r.uom))].sort();
    for (const u of uoms) cols.push({ k: p + "|" + u, prod: p, uom: u, hs: [] });
  }
  const ck = new Set(cols.map((c) => c.k));
  ls = ls.filter((r) => ck.has(colKey(r)));
  const ent = new Map<string, Ent>();
  const colHs: Record<string, Set<string>> = {};
  for (const r of ls) {
    let e = ent.get(r.ek);
    if (!e) {
      e = { ek: r.ek, cusdec: r.cusdec, date: r.date, dn: r.dn, sup: r.sup, cells: {}, left: 0, plan: 0, prop: 0, pend: false, overdue: false };
      ent.set(r.ek, e);
    }
    e.left += Math.max(r.left || 0, 0);
    e.plan += r.pqty;
    e.prop += num(r.xqty);
    if (r.pending) e.pend = true;
    if (r.overdue) e.overdue = true;
    const k = colKey(r);
    const c = e.cells[k] || (e.cells[k] = { qty: 0, cqty: 0, pqty: 0, xqty: 0, bal: 0, osv: 0, pend: false, hs: [] });
    if (r.hs && !c.hs.includes(String(r.hs))) c.hs.push(String(r.hs));
    (colHs[k] = colHs[k] || new Set()).add(String(r.hs || ""));
    c.qty += r.qty;
    c.cqty += r.cqty;
    c.pqty += r.pqty;
    c.xqty += num(r.xqty);
    c.bal += r.pending ? r4(-(r.cqty + r.pqty)) : r.bal || 0;
    c.osv += r.osv;
    if (r.pending) c.pend = true;
  }
  let ents = [...ent.values()].sort((a, b) => dnOrd(a.dn) - dnOrd(b.dn) || String(a.cusdec).localeCompare(b.cusdec));
  if (f.hideBlank)
    ents = ents.filter((e) =>
      cols.some((c) => {
        const x = e.cells[c.k];
        return x && (nz(x.qty) || nz(x.cqty) || nz(x.pqty) || nz(x.xqty) || nz(x.bal));
      }),
    );
  if (f.hideDone) ents = ents.filter((e) => Object.values(e.cells).some((c) => nz(c.bal) || nz(c.pqty) || nz(c.xqty)));
  if (q) ents = ents.filter((e) => String(e.cusdec).replace(/\D/g, "").includes(q));
  const lineByKey = new Map(ls.map((r) => [r.key, r]));
  for (const c of cols) c.hs = [...(colHs[c.k] || [])].filter(Boolean).sort();
  return { cols, ents, lineByKey };
}

function mxDetail(e: Ent, lineByKey: Map<string, TiepLine>, posts: Post[], labels: Record<string, string>): Det[] {
  const g = new Map<string, Det>();
  for (const c of posts) {
    const r = lineByKey.get(c.key);
    if (!r || r.ek !== e.ek) continue;
    const lbk = c.source === "logbook";
    const local = c.type === "local";
    const st = c.status || "Completed";
    const item = lbk ? "" : c.item || r.desc;
    const key = lbk ? c.id : st + "|" + c.ref + "|" + item + "|" + r.prod + "|" + r.uom;
    let d = g.get(key);
    if (!d) {
      d = {
        lbk,
        status: st,
        ref: c.ref,
        invId: c.invId,
        late: !!(c.date && r.date && c.date < r.date && !local),
        label:
          c.source === "proposal"
            ? "FIFO proposal (not saved)"
            : lbk
              ? c.expCusdec || "Export (CusDec not recorded)"
              : canLabel(c, labels),
        inv: local ? "" : c.expInv,
        date: local && c.cancelDate ? c.cancelDate : c.date,
        src: lbk ? "Export · per TIEP logbook" : local ? c.batch || "Local sale" : "Export",
        item,
        k: colKey(r),
        qty: 0,
      };
      g.set(key, d);
    }
    d.qty += c.qty;
  }
  const ord = (d: Det) => (d.status === "Pending" ? 2 : d.lbk ? 1 : 0);
  return [...g.values()].sort(
    (a, b) =>
      ord(a) - ord(b) ||
      a.date.localeCompare(b.date) ||
      a.ref.localeCompare(b.ref) ||
      a.item.localeCompare(b.item) ||
      a.label.localeCompare(b.label, undefined, { numeric: true }),
  );
}

/** Completed first, then planned, then pending confirmation. */
const byStatusOrder = (det: Det[]) =>
  det
    .filter((d) => d.status !== "Planned" && d.status !== "Pending")
    .concat(
      det.filter((d) => d.status === "Planned"),
      det.filter((d) => d.status === "Pending"),
    );
const wantOf = (st: Post["status"]): SubKey => (st === "Planned" ? "pqty" : st === "Pending" ? "xqty" : "cqty");
const fmtq = (x: number, key: SubKey) => (key === "osv" ? n0(x) : key === "cqty" ? "(" + n2(x) + ")" : n2(x));

function EntStatus({ e }: { e: Ent }) {
  let rest: ReactNode;
  if (e.pend) rest = <span className="chip chip-pend">Details pending</span>;
  else if (e.left <= 0) rest = <span className="chip chip-full">Fully cancelled</span>;
  else
    rest = (
      <>
        {e.overdue && <span className="chip chip-bad">Overdue</span>}{" "}
        {e.plan > 0 ? <span className="chip chip-plan">Planned</span> : !e.overdue && <span className="chip chip-open">Open</span>}
      </>
    );
  return (
    <>
      {e.prop > 0 && (
        <>
          <PropChip />{" "}
        </>
      )}
      {rest}
    </>
  );
}

function TypeChip({ st }: { st: Post["status"] }) {
  return st === "Pending" ? <PropChip /> : st === "Planned" ? <span className="chip chip-plan">Planned</span> : <span className="chip chip-done">Cancelled</span>;
}

const QSUB: [SubKey, string][] = [
  ["qty", "Imported"],
  ["cqty", "Cancelled"],
  ["pqty", "Planned"],
  ["xqty", "Pending confirm."],
  ["bal", "Balance"],
];
const OSUB: [SubKey, string][] = [["osv", "Outstanding LKR"]];

function readLayout(): Layout {
  try {
    return localStorage.getItem("tiepMxLayout") === "rows" ? "rows" : "cols";
  } catch {
    return "cols";
  }
}

export default function TiepEntriesView() {
  const { lines, asAt, loading } = useTiep();
  const { posts, props, labels } = usePosts();

  const [metric, setMetric] = useState<Metric>("bal");
  const [layout, setLayoutState] = useState<Layout>("cols");
  useEffect(() => setLayoutState(readLayout()), []);
  const setLayout = (l: Layout) => {
    setLayoutState(l);
    try {
      localStorage.setItem("tiepMxLayout", l);
    } catch {
      /* storage blocked: the choice lasts for this visit only */
    }
  };
  const [prodsUser, setProdsUser] = useState<Set<string> | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [periodSet, setPeriodSet] = useState(false);
  const [q, setQ] = useState("");
  const [hideBlank, setHideBlank] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const tl = useMemo(() => lines.filter((r) => r.req !== "No"), [lines]);
  const options = useMemo(() => PRODUCT_ORDER.filter((p) => tl.some((r) => r.prod === p)), [tl]);
  const sel = useMemo(() => prodsUser ?? new Set(options.filter((p) => !isCapital(p))), [prodsUser, options]);
  const bounds = useMemo(() => {
    const ds = tl.map((r) => r.date).filter((d): d is string => !!d).sort();
    return { min: ds[0] || "", max: ds[ds.length - 1] || "" };
  }, [tl]);
  const pFrom = periodSet ? from : bounds.min;
  const pTo = periodSet ? to : bounds.max;

  const qmode = metric !== "osv";
  const SUB = qmode ? QSUB : OSUB;
  const nsub = SUB.length;

  const { cols, ents, lineByKey } = useMemo(
    () => mxData(lines, sel, { from: periodSet ? from : "", to: periodSet ? to : "", q, hideBlank, hideDone }),
    [lines, sel, periodSet, from, to, q, hideBlank, hideDone],
  );
  const allPosts = useMemo(() => posts.concat(props), [posts, props]);
  const detail = (e: Ent) => mxDetail(e, lineByKey, allPosts, labels);

  const toggle = (k: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  function expandAll() {
    const n = new Set<string>();
    for (const e of ents) {
      if (layout === "rows") {
        for (const c of cols) if (e.cells[c.k]) n.add("R|" + e.ek + "|" + c.k);
      } else n.add(e.ek);
    }
    setOpen(n);
  }

  function csv() {
    const period = (pFrom ? " from " + pFrom : "") + (pTo ? " to " + pTo : "");
    const SB: [SubKey, string][] = qmode ? QSUB.map(([k, l]) => [k, k === "xqty" ? "Pending confirmation" : l]) : OSUB;
    const val = (v: Cell, k: SubKey) => (k === "osv" ? Math.round(v[k]) : r4(v[k]));
    if (layout === "rows") {
      const out: (string | number | null)[][] = [
        ["Imports by customs entry and product" + period],
        ["Customs entry", "Date", "Supplier", "Product", "UOM", "HS code", "Line", "Export invoice", ...SB.map((x) => x[1])],
      ];
      for (const e of ents)
        for (const c of cols) {
          const v = e.cells[c.k];
          if (!v) continue;
          out.push([e.cusdec, e.date, e.sup, c.prod, c.uom, c.hs.join(", "), "Total", "", ...SB.map(([k]) => val(v, k))]);
          if (qmode)
            detail(e)
              .filter((d) => d.k === c.k)
              .forEach((d) =>
                out.push([
                  e.cusdec, e.date, e.sup, c.prod, c.uom, c.hs.join(", "),
                  d.label + " · " + d.src + (d.item ? " · " + d.item : ""), d.inv,
                  ...SB.map(([k]) => (k === wantOf(d.status) ? r4(d.qty) : "")),
                ]),
              );
        }
      downloadCsv(`TIEP_By_Customs_Entry_rows_${asAt}.csv`, toCsv(out));
      return;
    }
    const head = ["Customs entry", "Date", "Supplier", "Line", "Export invoice", ...cols.flatMap((c) => SB.map((x) => `${c.prod} (${c.uom}) ${x[1]}`))];
    const out: (string | number | null)[][] = [["Imports by customs entry" + period], head];
    for (const e of ents) {
      out.push([e.cusdec, e.date, e.sup, "Total", "", ...cols.flatMap((c) => SB.map(([k]) => (e.cells[c.k] ? val(e.cells[c.k], k) : "")))]);
      if (qmode)
        detail(e).forEach((d) =>
          out.push([
            e.cusdec, e.date, e.sup, d.label + " · " + d.src + (d.item ? " · " + d.item : ""), d.inv,
            ...cols.flatMap((c) => SB.map(([k]) => (c.k === d.k && k === wantOf(d.status) ? r4(d.qty) : ""))),
          ]),
        );
    }
    downloadCsv(`TIEP_By_Customs_Entry_${asAt}.csv`, toCsv(out));
  }

  if (loading && !lines.length) return <div className="note">Loading the TIEP register…</div>;

  return (
    <>
      <div className="panel">
        <h2 className="text-[15px] font-semibold m-0">Imports by customs entry and product</h2>
        <div className="bar">
          <div className="field">
            Show
            <div className={s.seg} role="group" aria-label="Figures to show">
              <button type="button" aria-pressed={metric === "bal"} onClick={() => setMetric("bal")}>
                Quantities
              </button>
              <button type="button" aria-pressed={metric === "osv"} onClick={() => setMetric("osv")}>
                Outstanding LKR
              </button>
            </div>
          </div>
          <div className="field">
            Layout
            <div className={s.seg} role="group" aria-label="Layout">
              <button type="button" aria-pressed={layout === "cols"} onClick={() => setLayout("cols")}>
                Products as columns
              </button>
              <button type="button" aria-pressed={layout === "rows"} onClick={() => setLayout("rows")}>
                Products as rows
              </button>
            </div>
          </div>
          <ProdPick options={options} selected={sel} onChange={setProdsUser} />
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
            Search CusDec
            <input className="control" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. 28346" />
          </label>
          <div className="field">
            Rows
            <div className="flex gap-3 text-[13px] text-ink py-1.5">
              <label className="inline-flex items-center gap-1.5" title="Hide entries with nothing in any of the selected products">
                <input type="checkbox" checked={hideBlank} onChange={(e) => setHideBlank(e.target.checked)} /> Remove blank entries
              </label>
              <label className="inline-flex items-center gap-1.5" title="Hide entries with no balance and nothing planned">
                <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Hide fully cancelled
              </label>
            </div>
          </div>
          <span className="flex-1" />
          <button className="btn" type="button" onClick={expandAll}>
            Expand all
          </button>
          <button className="btn" type="button" onClick={() => setOpen(new Set())}>
            Collapse all
          </button>
          <button className="btn" type="button" onClick={csv}>
            Download CSV
          </button>
        </div>
        {layout === "rows" ? (
          <RowsTable cols={cols} ents={ents} SUB={SUB} qmode={qmode} open={open} toggle={toggle} detail={detail} />
        ) : (
          <ColsTable cols={cols} ents={ents} SUB={SUB} nsub={nsub} qmode={qmode} open={open} toggle={toggle} detail={detail} />
        )}
      </div>

      <div className="panel">
        <h2 className="text-[15px] font-semibold m-0">Cancellations by customs entry</h2>
        <p className="note m-0">
          Each row is one posting against a customs entry, in the same product columns as above. An entry with several
          postings lists them one under another. The orange row is the balance left to cancel.
        </p>
        <CancelsByEntry cols={cols} ents={ents} lineByKey={lineByKey} posts={qmode ? allPosts : posts} labels={labels} />
      </div>
    </>
  );
}

type Detail = (e: Ent) => Det[];

/** Products as columns: one row per customs entry, a column group per product. */
function ColsTable({
  cols,
  ents,
  SUB,
  nsub,
  qmode,
  open,
  toggle,
  detail,
}: {
  cols: Col[];
  ents: Ent[];
  SUB: [SubKey, string][];
  nsub: number;
  qmode: boolean;
  open: Set<string>;
  toggle: (k: string) => void;
  detail: Detail;
}) {
  const T: Record<string, Record<SubKey, number>> = {};
  let TP = false;
  for (const e of ents)
    for (const c of cols) {
      const v = e.cells[c.k];
      if (!v) continue;
      if (v.pend) TP = true;
      const t = T[c.k] || (T[c.k] = { qty: 0, cqty: 0, pqty: 0, xqty: 0, bal: 0, osv: 0 });
      for (const k of Object.keys(t) as SubKey[]) t[k] += v[k];
    }
  const blank = (key: string) => SUB.map((x, i) => <td key={key + i} className={cx(i === 0 && s.f)} />);
  const cellSet = (key: string, v: Cell | undefined, only?: SubKey) =>
    SUB.map(([k], i) => {
      const f = i === 0 && s.f;
      if (!v)
        return (
          <td key={key + k} className={cx("num", s.z, f)}>
            {only ? "" : "·"}
          </td>
        );
      if (only && k !== only) return <td key={key + k} className={cx(f)} />;
      const x = v[k];
      const pd = v.pend && (k === "qty" || k === "bal");
      return (
        <td
          key={key + k}
          className={cx("num", f, x < 0 && s.neg, pd && s.q, k === "bal" && s.bcol, k === "pqty" && x && s.pl, k === "xqty" && x && s.px)}
          title={pd ? "Import details pending: import qty taken as 0 for now" : undefined}
        >
          {x ? fmtq(x, k) : pd && k === "qty" ? "0.00" : "–"}
        </td>
      );
    });
  const oneCell = (key: string, want: SubKey, qv: number) =>
    SUB.map(([sk], i) => (
      <td key={key + sk} className={cx(i === 0 && s.f, sk === want && "num", sk === want && want === "pqty" && s.pl, sk === want && want === "xqty" && s.px)}>
        {sk === want ? fmtq(qv, want) : ""}
      </td>
    ));

  return (
    <>
      <div className="scroll">
        <table className={cx("tbl", s.mx)}>
          <thead>
            <tr>
              <th className={s.k1} rowSpan={2}>
                Customs entry
              </th>
              <th rowSpan={2}>Type</th>
              <th rowSpan={2}>Export invoice</th>
              <th rowSpan={2}>Date</th>
              <th rowSpan={2}>Supplier / batch · item</th>
              {cols.map((c) => (
                <th key={c.k} className={s.pg} colSpan={nsub}>
                  {c.prod}
                  <small>
                    {c.uom} · HS {c.hs.join(", ") || "–"}
                  </small>
                </th>
              ))}
              <th rowSpan={2}>Status</th>
            </tr>
            <tr>
              {cols.map((c) =>
                SUB.map((x, i) => (
                  <th key={c.k + x[0]} className={cx(s.sc, i === 0 && s.f)}>
                    {x[1]}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {!ents.length ? (
              <tr>
                <td className={cx(s.k1, s.empty)} colSpan={cols.length * nsub + 6}>
                  {cols.length ? "No customs entries match these filters." : "Select at least one product."}
                </td>
              </tr>
            ) : (
              ents.map((e) => {
                const isOpen = qmode && open.has(e.ek);
                const det = isOpen ? byStatusOrder(detail(e)) : [];
                return (
                  <Fragment key={e.ek}>
                    <tr className={cx(s.ent, e.prop > 0 && s.hasprop)} onClick={() => qmode && toggle(e.ek)}>
                      <td className={s.k1}>
                        {qmode && (
                          <button
                            className={s.xbtn}
                            type="button"
                            aria-expanded={isOpen}
                            aria-label={(isOpen ? "Hide" : "Show") + " lines for " + e.cusdec}
                          >
                            {isOpen ? "−" : "+"}
                          </button>
                        )}
                        <b>{e.cusdec}</b>
                      </td>
                      <td></td>
                      <td></td>
                      <td>{fdate(e.date)}</td>
                      <td className={s.wrap} style={{ minWidth: 150, maxWidth: 220 }}>
                        {e.sup || (e.pend ? "Details pending" : "Supplier not recorded")}
                        <div className="note text-[11px]">{[...new Set(cols.filter((c) => e.cells[c.k]).map((c) => c.prod))].join(" · ")}</div>
                      </td>
                      {cols.map((c) => cellSet(c.k, e.cells[c.k]))}
                      <td>
                        <EntStatus e={e} />
                      </td>
                    </tr>
                    {isOpen && (
                      <>
                        <tr className={s.msub}>
                          <td className={s.k1}></td>
                          <td>
                            <span className="chip">Imported</span>
                          </td>
                          <td></td>
                          <td>{fdate(e.date)}</td>
                          <td className={s.wrap}>{e.sup || (e.pend ? "Import details pending" : "Per TIEP logbook")}</td>
                          {cols.map((c) => (e.cells[c.k] ? cellSet(c.k, e.cells[c.k], "qty") : blank(c.k)))}
                          <td></td>
                        </tr>
                        {det.map((d, i) => (
                          <tr
                            key={i}
                            className={cx(s.msub, s.det, i === det.length - 1 && s.last, d.status === "Pending" && s.propr, d.late && s.lateimp)}
                          >
                            <td className={s.k1}>{d.label}</td>
                            <td>
                              <TypeChip st={d.status} />
                              {d.late && <LateChip />}
                            </td>
                            <td className="font-mono">{d.inv}</td>
                            <td>{fdate(d.date)}</td>
                            <td className={s.wrap} style={{ minWidth: 150, maxWidth: 240 }}>
                              {d.src}
                              {d.item ? " · " + d.item : ""}
                            </td>
                            {cols.map((c) => (c.k === d.k ? oneCell(c.k, wantOf(d.status), d.qty) : blank(c.k)))}
                            <td></td>
                          </tr>
                        ))}
                        {!det.length && (
                          <tr className={cx(s.msub, s.last)}>
                            <td className={s.k1}></td>
                            <td colSpan={cols.length * nsub + 5}>No cancellations against this entry yet.</td>
                          </tr>
                        )}
                      </>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr className={s.bal}>
              <td className={s.k1}>Total</td>
              <td></td>
              <td></td>
              <td></td>
              <td>{ents.length} entries</td>
              {cols.map((c) =>
                SUB.map(([k], i) => {
                  const x = T[c.k]?.[k] || 0;
                  return (
                    <td key={c.k + k} className={cx("num", i === 0 && s.f, x < 0 && s.neg)}>
                      {x ? fmtq(x, k) : "–"}
                    </td>
                  );
                }),
              )}
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="note m-0">
        {qmode
          ? "For each product: Imported, Cancelled (completed), Planned (MUD saved, waiting for the customs write-off, blue), Pending confirmation (FIFO proposal for invoices whose MUD is not saved yet, amber), and Balance = imported − cancelled − planned (pending proposals are not deducted until the MUD is saved). Entries with pending proposals are marked amber on the left. Click + on an entry to see each line."
          : "Suspended duty and VAT still outstanding (LKR) for each customs entry, by product."}
        {TP ? " Where import details are still pending, the import qty is taken as 0, so the balance shows in red." : ""} A dot
        means the entry has no line for that product.
      </p>
    </>
  );
}

/** Products as rows: one row per customs entry and product. */
function RowsTable({
  cols,
  ents,
  SUB,
  qmode,
  open,
  toggle,
  detail,
}: {
  cols: Col[];
  ents: Ent[];
  SUB: [SubKey, string][];
  qmode: boolean;
  open: Set<string>;
  toggle: (k: string) => void;
  detail: Detail;
}) {
  const ncol = 6 + SUB.length + 1;
  const T: Record<string, { c: Col; n: number } & Record<SubKey, number>> = {};
  const rows: ReactNode[] = [];
  for (const e of ents) {
    let first = true;
    for (const c of cols) {
      const v = e.cells[c.k];
      if (!v) continue;
      const key = "R|" + e.ek + "|" + c.k;
      const isOpen = qmode && open.has(key);
      const t = T[c.k] || (T[c.k] = { c, qty: 0, cqty: 0, pqty: 0, xqty: 0, bal: 0, osv: 0, n: 0 });
      for (const k of ["qty", "cqty", "pqty", "xqty", "bal", "osv"] as SubKey[]) t[k] += num(v[k]);
      t.n++;
      rows.push(
        <tr key={key} className={cx(s.ent, num(v.xqty) > 0 && s.hasprop, first && s.first)} onClick={() => qmode && toggle(key)}>
          <td className={s.k1}>
            {qmode && (
              <button className={s.xbtn} type="button" aria-expanded={isOpen} aria-label={(isOpen ? "Hide" : "Show") + " lines"}>
                {isOpen ? "−" : "+"}
              </button>
            )}
            <b>{e.cusdec}</b>
          </td>
          <td>{fdate(e.date)}</td>
          <td className={s.wrap} style={{ minWidth: 140, maxWidth: 220 }}>
            {e.sup || (e.pend ? "Details pending" : "Supplier not recorded")}
          </td>
          <td>
            <b>{c.prod}</b>
          </td>
          <td>{c.uom}</td>
          <td className="font-mono">{c.hs.join(", ") || "–"}</td>
          {SUB.map(([k]) => {
            const x = num(v[k]);
            const pd = v.pend && (k === "qty" || k === "bal");
            return (
              <td key={k} className={cx("num", x < 0 && s.neg, k === "bal" && s.bcol, k === "pqty" && x && s.pl, k === "xqty" && x && s.px)}>
                {x ? fmtq(x, k) : pd && k === "qty" ? "0.00" : "–"}
              </td>
            );
          })}
          <td>
            <EntStatus e={e} />
          </td>
        </tr>,
      );
      first = false;
      if (isOpen) {
        const det = byStatusOrder(detail(e).filter((d) => d.k === c.k));
        if (!det.length)
          rows.push(
            <tr key={key + "|none"} className={s.msub}>
              <td className={s.k1}></td>
              <td colSpan={ncol - 1}>No cancellations against this product on this entry yet.</td>
            </tr>,
          );
        det.forEach((d, i) =>
          rows.push(
            <tr key={key + "|" + i} className={cx(s.msub, s.det, d.status === "Pending" && s.propr, d.late && s.lateimp)}>
              <td className={s.k1}>{d.label}</td>
              <td>{fdate(d.date)}</td>
              <td className={s.wrap}>
                {d.inv} {d.src}
                {d.item ? " · " + d.item : ""}
              </td>
              <td colSpan={3}>
                <TypeChip st={d.status} />
                {d.late && <LateChip />}
              </td>
              {SUB.map(([k]) => {
                const want = wantOf(d.status);
                return (
                  <td key={k} className={cx("num", k === want && want === "pqty" && s.pl, k === want && want === "xqty" && s.px)}>
                    {k === want ? fmtq(d.qty, want) : ""}
                  </td>
                );
              })}
              <td></td>
            </tr>,
          ),
        );
      }
    }
  }
  return (
    <>
      <div className="scroll">
        <table className={cx("tbl", s.mx)}>
          <thead>
            <tr>
              <th className={s.k1}>Customs entry</th>
              <th>Date</th>
              <th>Supplier</th>
              <th>Product</th>
              <th>UOM</th>
              <th>HS code</th>
              {SUB.map((x) => (
                <th key={x[0]} className="num">
                  {x[1]}
                </th>
              ))}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows
            ) : (
              <tr>
                <td className={cx(s.k1, s.empty)} colSpan={ncol}>
                  {cols.length ? "No customs entries match these filters." : "Select at least one product."}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            {Object.values(T).map((t, i) => (
              <tr key={t.c.k} className={s.bal}>
                <td className={s.k1}>{i === 0 ? "Total by product" : ""}</td>
                <td colSpan={2}>
                  {t.n} entr{t.n === 1 ? "y" : "ies"}
                </td>
                <td>
                  <b>{t.c.prod}</b>
                </td>
                <td>{t.c.uom}</td>
                <td></td>
                {SUB.map(([k]) => {
                  const x = t[k];
                  return (
                    <td key={k} className={cx("num", x < 0 && s.neg)}>
                      {x ? fmtq(x, k) : "–"}
                    </td>
                  );
                })}
                <td></td>
              </tr>
            ))}
          </tfoot>
        </table>
      </div>
      <p className="note m-0">
        {qmode
          ? "One row per customs entry and product: Imported, Cancelled (completed), Planned (MUD saved, blue), Pending confirmation (FIFO proposal, amber) and Balance = imported − cancelled − planned. Click + for the cancellation lines of that product. Totals are shown per product because units differ."
          : "Suspended duty and VAT still outstanding (LKR), one row per customs entry and product."}
      </p>
    </>
  );
}

/** One row per posting against each customs entry shown above, with the balance left to cancel. */
function CancelsByEntry({
  cols,
  ents,
  lineByKey,
  posts,
  labels,
}: {
  cols: Col[];
  ents: Ent[];
  lineByKey: Map<string, TiepLine>;
  posts: Post[];
  labels: Record<string, string>;
}) {
  const shown = new Set(ents.map((e) => e.ek));
  interface G {
    ek: string;
    cusdec: string;
    cdn: number;
    ref: string;
    lb: boolean;
    status: Post["status"];
    date: string;
    src: string;
    inv: string;
    late: boolean;
    can: string;
    n: number;
    cells: Record<string, number>;
  }
  const grp = new Map<string, G>();
  for (const c of posts) {
    const r = lineByKey.get(c.key);
    if (!r || !shown.has(r.ek)) continue;
    const lb = c.source === "logbook";
    const key = lb ? c.id : r.ek + "||" + c.ref + "||" + (c.status || "Completed");
    const k = colKey(r);
    let g = grp.get(key);
    if (!g) {
      g = {
        ek: r.ek,
        cusdec: r.cusdec,
        cdn: r.dn,
        ref: lb ? "Logbook" : c.ref,
        lb,
        status: c.status || "Completed",
        date: c.date,
        src: lb ? c.expInv || "–" : c.type === "local" ? c.batch || "Local sale" : c.expInv,
        inv: c.type === "local" ? "" : c.expInv,
        late: c.type !== "local" && !!(c.date && r.date && c.date < r.date),
        can: lb ? c.expCusdec || "–" : canKey(c),
        n: 0,
        cells: {},
      };
      grp.set(key, g);
    }
    g.n++;
    g.cells[k] = (g.cells[k] || 0) + c.qty;
  }
  const gl = [...grp.values()].sort(
    (a, b) =>
      dnOrd(a.cdn) - dnOrd(b.cdn) ||
      a.cusdec.localeCompare(b.cusdec) ||
      (a.lb ? 1 : 0) - (b.lb ? 1 : 0) ||
      a.date.localeCompare(b.date) ||
      a.ref.localeCompare(b.ref) ||
      a.can.localeCompare(b.can, undefined, { numeric: true }),
  );
  const ctot: Record<string, number> = {};
  const ptot: Record<string, number> = {};
  const xtot: Record<string, number> = {};
  for (const g of gl)
    for (const c of cols) {
      const v = g.cells[c.k];
      if (!v) continue;
      const t = g.status === "Pending" ? xtot : g.status === "Planned" ? ptot : ctot;
      t[c.k] = (t[c.k] || 0) + v;
    }
  const imp: Record<string, number> = {};
  const bal: Record<string, number> = {};
  const ip: Record<string, boolean> = {};
  for (const e of ents)
    for (const c of cols) {
      const v = e.cells[c.k];
      if (v) {
        imp[c.k] = (imp[c.k] || 0) + v.qty;
        bal[c.k] = (bal[c.k] || 0) + v.bal;
        if (v.pend) ip[c.k] = true;
      }
    }
  const fr = (lab: string, obj: Record<string, number>, cls?: string, pend?: boolean) => (
    <tr key={lab} className={cls}>
      <td className={s.k1}>{lab}</td>
      <td colSpan={5}></td>
      {cols.map((c) => (
        <td key={c.k} className={cx("num", (obj[c.k] || 0) < 0 && s.neg)}>
          {n2(obj[c.k] || 0)}
          {pend && ip[c.k] ? "*" : ""}
        </td>
      ))}
    </tr>
  );
  let last: string | null = null;
  return (
    <div className="scroll">
      <table className={cx("tbl", s.mx)}>
        <thead>
          <tr>
            <th className={s.k1}>Customs entry</th>
            <th>Ref</th>
            <th>Status</th>
            <th>Date</th>
            <th>Export invoice / batch</th>
            <th>Cancellation customs entry</th>
            {cols.map((c) => (
              <th key={c.k} className={s.prod}>
                {c.prod}
                <small>{c.uom}</small>
                <small className={s.hsc}>HS {c.hs.join(", ") || "–"}</small>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!gl.length ? (
            <tr>
              <td className={cx(s.k1, s.empty)} colSpan={cols.length + 6}>
                No cancellations posted against these customs entries yet.
              </td>
            </tr>
          ) : (
            gl.map((g, i) => {
              const first = g.ek !== last;
              last = g.ek;
              const PX = g.status === "Pending";
              return (
                <tr key={i} className={cx(first && s.first, PX && s.propr, g.late && s.lateimp)}>
                  <td className={s.k1}>{first ? <b>{g.cusdec}</b> : null}</td>
                  <td className="font-mono">{PX ? "FIFO proposal" : g.ref}</td>
                  <td>
                    {PX ? <PropChip /> : <PostingChip status={g.status} />}
                    {g.late && <LateChip />}
                  </td>
                  <td>{fdate(g.date)}</td>
                  <td>{g.inv || g.src}</td>
                  <td>
                    {PX ? (
                      g.can || <span className="note">MUD not saved</span>
                    ) : g.can ? (
                      g.can
                    ) : (
                      <TbrChip refName={g.ref} labels={labels} />
                    )}
                  </td>
                  {cols.map((c) => {
                    const v = g.cells[c.k];
                    if (!v)
                      return (
                        <td key={c.k} className={cx("num", s.z)}>
                          ·
                        </td>
                      );
                    return (
                      <td key={c.k} className={cx("num", PX ? s.px : g.status === "Planned" && s.pl)}>
                        {n2(v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
        <tfoot>
          {fr("Imported", imp, "", true)}
          {fr("Cancelled (completed)", ctot)}
          {fr("Planned", ptot)}
          {fr("Balance free to cancel", bal, s.bal, true)}
          {Object.keys(xtot).length > 0 && (
            <>
              {fr("Pending confirmation (FIFO proposals)", xtot)}
              {fr(
                "Balance after pending",
                Object.fromEntries(cols.map((c) => [c.k, r4((bal[c.k] || 0) - (xtot[c.k] || 0))])),
                "",
                true,
              )}
            </>
          )}
        </tfoot>
      </table>
    </div>
  );
}

/** Liability of a posting: as posted, else the line's duty per unit. */
export const dutyOf = (c: Post, r: TiepLine | undefined) => num(c.duty) || allocLiab(r, c.qty);
