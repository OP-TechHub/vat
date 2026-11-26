"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { useApp } from "../AppShell";
import { useTiep } from "./TiepProvider";
import { Modal } from "./ui";
import { downloadWorkbook } from "@/lib/download";
import type { MudHist } from "@/lib/tiep/data";
import { skuFind } from "@/lib/tiep/invoices";
import {
  downloadCsv,
  fdate,
  normP,
  skuIsConfirmed,
  skuTarget,
  skuUnmapped,
  skuYield,
  stdFor,
  stdList,
  stdShort,
  toCsv,
  type SkuItem,
  type Standard,
} from "@/lib/tiep/model";

const num = (v: unknown) => {
  const x = Number(v);
  return isFinite(x) ? x : 0;
};
const blank = (v: unknown) => v == null || v === "";
const fx = (v: number, d: number) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
/** Yield as a percentage, one decimal only when needed. */
const mmPct = (y: number | string | null | undefined) => {
  if (blank(y)) return "–";
  const v = num(y) * 100;
  return fx(v, Math.abs(v % 1) > 0.001 ? 1 : 0) + "%";
};
/** Yield the whole-fish figure was worked at: the yield used, else the yield printed. */
const yUsed = (m: MudHist) => (!blank(m.yield_used) ? num(m.yield_used) : num(m.yield_printed));
const dotDate = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : "");
const ws = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, " ").trim();

interface Chk {
  m: MudHist;
  st: Standard | null;
  ry: number | null;
  yu: number;
  ok: boolean;
}
interface MmRow {
  k: string;
  code: string;
  sys: string[];
  inv: string[];
  cur: string[];
  fish: boolean;
  conf: boolean | null;
  ml: MudHist[];
  chk: Chk[];
  find: string;
  status: string;
  head: SkuItem;
  docs: SkuItem[];
}

const MM_HDR = [
  "System item no.",
  "System description",
  "Invoice description (no. of invoice lines)",
  "Currently mapped TIEP SKU",
  "Confirmed",
  "Previous MUD (MUD no. · invoice · export entry · date)",
  "MUD item description",
  "MUD yield",
  "Finding",
  "Item master status",
];
const MM_W = [16, 52, 58, 48, 14, 48, 42, 26, 55, 26];

const printedDiffers = (c: Chk) => !blank(c.m.yield_printed) && Math.abs(num(c.m.yield_printed) - c.yu) > 0.0051;

function mmRowCells(r: MmRow): string[] {
  return [
    r.code || "(no item no.)",
    r.sys.join("\n"),
    r.inv.join("\n") || "Not on any invoice in the register",
    r.cur.join("\n"),
    r.fish ? (r.conf ? "Confirmed" : "Not confirmed") : "",
    r.ml.length
      ? r.ml.map((m) => `${m.mud} · inv ${m.inv_no || "–"} · ${m.export_e || "–"} · ${dotDate(m.mud_date)}`).join("\n")
      : "No MUD form on file",
    r.ml.map((m) => m.mud_desc || "").join("\n"),
    r.chk.map((c) => (printedDiffers(c) ? `${fx(num(c.m.yield_printed), 3)} printed (${mmPct(c.yu)} used)` : mmPct(c.yu))).join("\n"),
    r.find,
    r.status,
  ];
}

const byDateMud = (a: MudHist, b: MudHist) => String(a.mud_date ?? "").localeCompare(String(b.mud_date ?? "")) || String(a.mud).localeCompare(String(b.mud));

/** Settings › Item mapping vs MUD: the item master compared with the MUD lines on file, and those MUD lines. */
export default function TiepMapMudView() {
  const { supabase, user, flash } = useApp();
  const { skus, standards, invoices, mudhist, asAt, perm, reload } = useTiep();
  const w = perm.mapmud.edit;
  const [q, setQ] = useState("");
  const [sh, setSh] = useState<"code" | "mud" | "all">("code");
  const [cf, setCf] = useState<"" | "yes" | "no">("");
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<MudHist | "new" | null>(null);

  const data = useMemo<MmRow[]>(() => {
    const sts = stdList(standards).reverse();
    const groups = new Map<string, { code: string; docs: SkuItem[] }>();
    for (const x of skus) {
      const k = x.code ? "C|" + normP(x.code) : "D|" + x.id;
      const g = groups.get(k) ?? { code: x.code ?? "", docs: [] };
      g.docs.push(x);
      groups.set(k, g);
    }
    const invD = new Map<string, Map<string, number>>();
    for (const v of invoices) {
      if (v.status === "void") continue;
      for (const l of v.calc.lines) {
        if (!l.code) continue;
        const k = "C|" + normP(l.code);
        const m = invD.get(k) ?? new Map<string, number>();
        const d = ws(l.desc);
        m.set(d, (m.get(d) ?? 0) + 1);
        invD.set(k, m);
      }
    }
    const rows: MmRow[] = [];
    for (const [k, g] of groups) {
      const head = g.docs.find((x) => x.tiep) ?? g.docs[0];
      const fish = g.docs.some((x) => x.tiep);
      const cur = fish
        ? sts.map((st) => {
            const t = skuTarget(head, st);
            const y = skuYield(head, st);
            return `${stdShort(st)}: ${y == null ? (t ? t + " (not in this standard)" : "not set") : `${t} (${mmPct(y)})`}`;
          })
        : ["Not fish: left out of consumption"];
      const ml = mudhist.filter((m) => g.code && normP(m.code ?? "") === normP(g.code)).sort(byDateMud);
      const chk = ml.map((m) => {
        const st = stdFor(standards, m.mud_date);
        const ry = st ? skuYield(head, st) : null;
        const yu = yUsed(m);
        return { m, st, ry, yu, ok: ry != null && Math.abs(ry - yu) < 0.0051 };
      });
      let find: string;
      if (!fish) find = "Not fish: left out";
      else if (!ml.length) find = "No MUD to compare";
      else {
        const bad = chk.filter((c) => !c.ok);
        find = bad.length
          ? "Differs on MUD " +
            bad.map((c) => `${c.m.mud} (${mmPct(c.yu)} vs register ${mmPct(c.ry)}${c.st ? " under " + stdShort(c.st) : ""})`).join(", ") +
            "." +
            (chk.length > bad.length ? " Agrees on " + chk.filter((c) => c.ok).map((c) => c.m.mud).join(", ") + "." : "")
          : `Yield agrees on all ${chk.length} MUD line${chk.length === 1 ? "" : "s"}.`;
        const pr = chk.filter(printedDiffers).map((c) => c.m.mud);
        if (pr.length) find += " Printed yield differs from the yield used on " + pr.join(", ") + ".";
      }
      const sc: Record<string, number> = {};
      for (const x of g.docs) {
        const s = skuUnmapped(x) ? "not mapped" : x.status === "confident" ? "matched" : x.status === "none" ? "no TIEP item" : "to review";
        sc[s] = (sc[s] ?? 0) + 1;
      }
      const id = invD.get(k);
      rows.push({
        k,
        code: g.code,
        sys: g.docs.map((x) => x.item),
        inv: id ? [...id.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d}  (${n} line${n === 1 ? "" : "s"})`) : [],
        cur,
        fish,
        conf: fish ? skuIsConfirmed(head, skus) : null,
        ml,
        chk,
        find,
        status: Object.entries(sc)
          .map(([a, n]) => (g.docs.length > 1 ? `${a} ×${n}` : a))
          .join(", "),
        head,
        docs: g.docs,
      });
    }
    rows.sort(
      (a, b) =>
        (b.ml.length ? 1 : 0) - (a.ml.length ? 1 : 0) ||
        (a.code ? 0 : 1) - (b.code ? 0 : 1) ||
        String(a.code || a.sys[0]).localeCompare(String(b.code || b.sys[0]), undefined, { numeric: true }),
    );
    return rows;
  }, [skus, standards, invoices, mudhist]);

  const rows = useMemo(() => {
    const s = normP(q);
    return data.filter(
      (r) =>
        (sh === "all" || r.code) &&
        (sh !== "mud" || r.ml.length) &&
        (!cf || (cf === "yes" ? r.conf === true : r.conf === false)) &&
        (!s ||
          normP(
            [r.code, r.sys.join(" "), r.inv.join(" "), r.cur.join(" "), r.ml.map((m) => `${m.mud} ${m.mud_desc ?? ""} ${m.inv_no ?? ""} ${m.export_e ?? ""}`).join(" ")].join(" "),
          ).includes(s)),
    );
  }, [data, q, sh, cf]);

  const withCode = data.filter((r) => r.code);
  const nWithM = withCode.filter((r) => r.ml.length).length;
  const nConf = withCode.filter((r) => r.conf === true).length;
  const nDif = withCode.filter((r) => /^Differs/.test(r.find)).length;

  /** Confirmation is per item no.: every description under it changes together. */
  async function confirm(r: MmRow, on: boolean) {
    const docs = r.code ? skus.filter((y) => y.code && normP(y.code) === normP(r.code)) : [r.head];
    setBusy(true);
    const stamp = { updated_at: new Date().toISOString(), updated_by: user.id };
    const res = await Promise.all(
      docs.map((y) =>
        supabase
          .from("tiep_skumap")
          .update(on ? { confirmed: true, confirmed_at: new Date().toISOString(), confirmed_by: user.id, ...stamp } : { confirmed: false, ...stamp })
          .eq("id", y.id),
      ),
    );
    setBusy(false);
    const err = res.find((x) => x.error)?.error;
    if (err) flash("Could not save: " + err.message, true);
    else flash(`${r.code || r.head.item} ${on ? "confirmed" : "marked not confirmed"}${docs.length > 1 ? ` (${docs.length} descriptions)` : ""}.`);
    await reload();
  }

  const fname = (ext: string) => `TIEP_Item_Mapping_vs_MUD_${asAt}.${ext}`;
  function csv() {
    downloadCsv(fname("csv"), toCsv([MM_HDR, ...rows.map(mmRowCells)]));
  }
  function xlsx() {
    const aoa: string[][] = [
      [`TIEP item mapping vs previous MUD forms (as at ${fdate(asAt)})`],
      [
        "System description = TIEP Item Master. Invoice description = as printed on the invoices in the registers, with the number of invoice lines. Previous MUD = MUD lines on file in the register. Lines in the three MUD columns line up. Rows with previous MUD forms have an entry in the Previous MUD column.",
      ],
      [],
      MM_HDR,
      ...rows.map(mmRowCells),
    ];
    const sh = XLSX.utils.aoa_to_sheet(aoa);
    sh["!cols"] = MM_W.map((wch) => ({ wch }));
    sh["!merges"] = [{ s: { r: 1, c: 0 }, e: { r: 1, c: 9 } }];
    sh["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 3, c: 0 }, e: { r: 3 + rows.length, c: 9 } }) };
    sh["!rows"] = [
      {},
      { hpt: 30 },
      {},
      { hpt: 32 },
      ...rows.map((r) => {
        const v = mmRowCells(r);
        const n = Math.max(1, ...v.map((t, i) => t.split("\n").reduce((a, x) => a + Math.max(1, Math.ceil(x.length / (MM_W[i] * 1.1))), 0)));
        return { hpt: 13.5 * n + 4 };
      }),
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sh, "Item mapping");
    downloadWorkbook(wb, fname("xlsx"));
  }

  const lines = useMemo(
    () => [...mudhist].sort((a, b) => byDateMud(a, b) || String(a.code ?? "").localeCompare(String(b.code ?? ""))),
    [mudhist],
  );

  const multi = (t: string) => t.split("\n").map((s, i) => <div key={i}>{s || " "}</div>);

  return (
    <>
      <div className="panel">
        <div className="bar">
          <h2 className="text-[15px] font-semibold m-0 pb-1.5">Item mapping vs previous MUD forms</h2>
          <span className="flex-1" />
          <button className="btn" type="button" onClick={xlsx}>
            Download Excel
          </button>
          <button className="btn" type="button" onClick={csv}>
            Download CSV
          </button>
        </div>
        <p className="note m-0">
          One row per system item no. Built live from the TIEP Item Master, the conversion standards, the invoices in the
          Exports and Local Sale Registers and the MUD lines on file below, so it stays up to date as mappings,
          confirmations and MUD lines change. Lines in the three MUD columns line up across the row.
        </p>
        <div className="bar">
          <label className="field">
            Search
            <input
              className="control min-w-[280px]"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Item no., description, TIEP item, MUD no."
            />
          </label>
          <label className="field">
            Show
            <select className="control" value={sh} onChange={(e) => setSh(e.target.value as typeof sh)}>
              <option value="code">All item nos.</option>
              <option value="mud">Item nos. with MUD forms</option>
              <option value="all">Also items without an item no.</option>
            </select>
          </label>
          <label className="field">
            Confirmed
            <select className="control" value={cf} onChange={(e) => setCf(e.target.value as typeof cf)}>
              <option value="">All</option>
              <option value="yes">Confirmed</option>
              <option value="no">Not confirmed</option>
            </select>
          </label>
        </div>
        <div className="scroll max-h-[72vh]">
          <table className="tbl">
            <thead>
              <tr>
                {MM_HDR.map((h, i) => (
                  <th key={h} className={i === 7 ? "num" : undefined}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!rows.length ? (
                <tr>
                  <td colSpan={10} className="note">
                    No items match these filters.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const c = mmRowCells(r);
                  const diff = /^Differs/.test(r.find);
                  const chip = r.conf ? <span className="chip chip-done">Confirmed</span> : <span className="chip chip-bad">Not confirmed</span>;
                  return (
                    <tr key={r.k} className={r.ml.length ? "bg-warn-soft/40" : undefined}>
                      <td className="font-mono whitespace-nowrap">{r.code || <span className="text-muted">(no item no.)</span>}</td>
                      <td className="whitespace-normal min-w-[260px]">{multi(c[1])}</td>
                      <td className="whitespace-normal min-w-[260px] text-muted">{multi(c[2])}</td>
                      <td className="whitespace-normal min-w-[250px]">{multi(c[3])}</td>
                      <td className="whitespace-nowrap">
                        {r.fish &&
                          (w ? (
                            <label className="inline-flex gap-1.5 items-center cursor-pointer">
                              <input type="checkbox" checked={!!r.conf} disabled={busy} onChange={(e) => void confirm(r, e.target.checked)} />
                              {chip}
                            </label>
                          ) : (
                            chip
                          ))}
                      </td>
                      <td className="whitespace-nowrap">{multi(c[5])}</td>
                      <td className="whitespace-nowrap">{multi(c[6])}</td>
                      <td className="num whitespace-nowrap">{multi(c[7])}</td>
                      <td className={"whitespace-normal min-w-[260px]" + (diff ? " text-bad" : "")}>{multi(c[8])}</td>
                      <td className="whitespace-normal text-muted">{c[9]}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <p className="note m-0">
          Showing {rows.length} rows. {withCode.length} item nos.: {nConf} confirmed, {nWithM} with MUD forms on file, {nDif}{" "}
          differing from a MUD form. Tick Confirmed to confirm an item no.’s mapping; it applies to every description under
          that item no.
        </p>
      </div>

      <div className="panel">
        <div className="bar">
          <h2 className="text-[15px] font-semibold m-0 pb-1.5">MUD lines on file</h2>
          <span className="flex-1" />
          {w && (
            <button className="btn btn-primary" type="button" onClick={() => setEdit("new")}>
              Add MUD line
            </button>
          )}
        </div>
        <p className="note m-0">
          Each line is one sales line of a manual MUD form: the item no. it covers, the description and yield printed on the
          form, and the yield its whole-fish figure was actually worked at. The table above compares these with the
          register’s mapping for the standard in force on the MUD date.
        </p>
        <div className="scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>MUD no.</th>
                <th>Invoice</th>
                <th>Export entry</th>
                <th>Date</th>
                <th>Item no.</th>
                <th className="num">Qty (kg)</th>
                <th>MUD item description</th>
                <th className="num">Yield printed</th>
                <th className="num">Yield used</th>
                <th className="num">Register yield</th>
                <th>Notes</th>
                {w && <th></th>}
              </tr>
            </thead>
            <tbody>
              {!lines.length ? (
                <tr>
                  <td colSpan={12} className="note">
                    No MUD lines on file yet.
                  </td>
                </tr>
              ) : (
                lines.map((m) => {
                  const sk = m.code ? skuFind(skus, m.code, null) : undefined;
                  const st = stdFor(standards, m.mud_date);
                  const ry = sk && st ? skuYield(sk, st) : null;
                  return (
                    <tr key={m.id}>
                      <td>{m.mud}</td>
                      <td>{m.inv_no ?? ""}</td>
                      <td>{m.export_e ?? ""}</td>
                      <td className="whitespace-nowrap">{fdate(m.mud_date)}</td>
                      <td className="font-mono">{m.code ?? ""}</td>
                      <td className="num">{fx(num(m.qty), 2)}</td>
                      <td>{m.mud_desc ?? ""}</td>
                      <td className="num">{blank(m.yield_printed) ? "–" : fx(num(m.yield_printed), 3)}</td>
                      <td className="num">{mmPct(!blank(m.yield_used) ? m.yield_used : m.yield_printed)}</td>
                      <td className="num">
                        {ry == null ? (
                          <span className="text-muted">–</span>
                        ) : (
                          <>
                            {mmPct(ry)}
                            {st && <div className="text-[11px] text-muted">{stdShort(st)}</div>}
                          </>
                        )}
                      </td>
                      <td className="whitespace-normal max-w-[260px] text-muted">{m.notes ?? ""}</td>
                      {w && (
                        <td>
                          <button className="btn py-0" type="button" onClick={() => setEdit(m)}>
                            Edit
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {edit && <MudLineEditor line={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

type MhKey = "mud" | "inv_no" | "export_e" | "mud_date" | "code" | "qty" | "mud_desc" | "yield_printed" | "yield_used" | "notes";
const FIELDS: [MhKey, string, "text" | "date" | "number"][] = [
  ["mud", "MUD no.", "text"],
  ["inv_no", "Invoice no.", "text"],
  ["export_e", "Export entry (E no.)", "text"],
  ["mud_date", "MUD / export date", "date"],
  ["code", "System item no.", "text"],
  ["qty", "Quantity (kg)", "number"],
  ["mud_desc", "Item description on the MUD", "text"],
  ["yield_printed", "Yield printed (e.g. 0.40)", "number"],
  ["yield_used", "Yield used for whole fish (if different)", "number"],
  ["notes", "Notes", "text"],
];

function MudLineEditor({ line: m, onClose }: { line: MudHist | null; onClose: () => void }) {
  const { supabase, company, user, flash } = useApp();
  const { perm, reload } = useTiep();
  const [v, setV] = useState<Record<MhKey, string>>(
    () => Object.fromEntries(FIELDS.map(([k]) => [k, m && m[k] != null ? String(m[k]) : ""])) as Record<MhKey, string>,
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!company) return;
    const d: Record<string, string | number | null> = {};
    for (const [k, , t] of FIELDS) {
      const s = v[k].trim();
      if (t === "number") {
        if (s === "") d[k] = null;
        else if (!isFinite(Number(s))) return setMsg(`Enter a number for ${k.replace(/_/g, " ")}.`);
        else d[k] = Number(s);
      } else d[k] = s || null;
    }
    if (!d.mud || !d.code) return setMsg("Enter the MUD no. and the item no.");
    if (d.yield_used == null && d.yield_printed != null) d.yield_used = d.yield_printed;
    setBusy(true);
    const res = m
      ? await supabase
          .from("tiep_mudhist")
          .update({ ...d, src: m.src || "Added in register", updated_at: new Date().toISOString(), updated_by: user.id })
          .eq("id", m.id)
      : await supabase.from("tiep_mudhist").insert({ ...d, company_id: company.id, src: "Added in register", created_by: user.id });
    setBusy(false);
    if (res.error) return setMsg("Could not save the MUD line: " + res.error.message);
    flash("MUD line saved.");
    onClose();
    await reload();
  }

  async function remove() {
    if (!m || !window.confirm(`Delete MUD line ${m.mud}${m.code ? " / " + m.code : ""}?`)) return;
    const { error } = await supabase.from("tiep_mudhist").delete().eq("id", m.id);
    if (error) return setMsg("Could not delete: " + error.message);
    flash("MUD line deleted.");
    onClose();
    await reload();
  }

  return (
    <Modal
      title={m ? "Edit MUD line" : "Add MUD line"}
      onClose={onClose}
      footer={
        <>
          {m && perm.mapmud.delete && (
            <button className="btn btn-danger mr-auto" type="button" onClick={() => void remove()}>
              Delete
            </button>
          )}
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {FIELDS.map(([k, l, t]) => (
          <label key={k} className="field">
            {l}
            <input
              className="control w-full"
              type={t}
              step={t === "number" ? "any" : undefined}
              value={v[k]}
              onChange={(e) => setV((o) => ({ ...o, [k]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <p className="note m-0">
        Enter the item no. as in the TIEP Item Master. Leave “Yield used” blank when the whole-fish figure on the form
        matches the printed yield.
      </p>
      {msg && <div className="msg msg-err">{msg}</div>}
    </Modal>
  );
}
