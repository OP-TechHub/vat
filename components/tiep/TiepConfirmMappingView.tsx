"use client";

import { useMemo, useState } from "react";
import { useApp } from "../AppShell";
import { useTiep } from "./TiepProvider";
import {
  allProducts,
  fdate,
  normP,
  skuIsConfirmed,
  skuTarget,
  skuYield,
  stdList,
  stdShort,
  type SkuItem,
  type Standard,
} from "@/lib/tiep/model";

const fx0 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const ws = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, " ").trim();

interface XcRow {
  code: string;
  qty: number;
  inv: Map<string, { no: string; date: string; status: string }>;
  open: Set<string>;
  last: string;
  lastInv: string;
  first: string;
  descs: Map<string, number>;
  docs: SkuItem[];
  head: SkuItem | null;
  tiep: string;
  fish: boolean;
  conf: boolean;
}

/** Standards that do not list a TIEP item. */
const stdsMissing = (standards: Standard[], tiep: string) =>
  tiep ? stdList(standards).filter((st) => !st.yields.some((v) => normP(v.product) === normP(tiep))) : [];

/** Settings › Confirm export mapping: every item no. on the export invoices, latest invoice first. */
export default function TiepConfirmMappingView() {
  const { supabase, user, flash } = useApp();
  const { skus, standards, invoices, perm, reload } = useTiep();
  const w = perm.settings.edit;
  const [show, setShow] = useState<"nc" | "conf" | "nofish" | "all">("nc");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const sts = useMemo(() => stdList(standards).reverse(), [standards]);
  const prods = useMemo(() => allProducts(standards), [standards]);

  const all = useMemo<XcRow[]>(() => {
    const agg = new Map<string, Omit<XcRow, "docs" | "head" | "tiep" | "fish" | "conf">>();
    for (const v of invoices) {
      if (v.inv.type !== "Export" || v.status === "void") continue;
      const date = v.inv.invoice_date ?? "";
      for (const l of v.calc.lines) {
        if (!l.code) continue;
        const k = normP(l.code);
        const a = agg.get(k) ?? { code: l.code, qty: 0, inv: new Map(), open: new Set(), last: "", lastInv: "", first: "", descs: new Map() };
        a.qty += Number(l.qty) || 0;
        a.inv.set(v.inv.id, { no: v.inv.invoice_no, date, status: v.status });
        if (v.status === "calculated") a.open.add(v.inv.id);
        if (date > a.last) {
          a.last = date;
          a.lastInv = v.inv.invoice_no;
        }
        if (!a.first || (date && date < a.first)) a.first = date;
        const d = ws(l.desc);
        a.descs.set(d, (a.descs.get(d) ?? 0) + 1);
        agg.set(k, a);
      }
    }
    return [...agg.values()]
      .map((a) => {
        const docs = skus.filter((y) => normP(y.code ?? "") === normP(a.code));
        const head = docs.find((y) => y.tiep) ?? docs[0] ?? null;
        return { ...a, docs, head, tiep: head?.tiep ?? "", fish: !!head?.tiep, conf: head ? skuIsConfirmed(head, skus) : false };
      })
      .sort((x, y) => y.last.localeCompare(x.last) || y.qty - x.qty);
  }, [invoices, skus]);

  const rows = useMemo(() => {
    const s = normP(q);
    return all.filter(
      (r) =>
        (show === "all" || (show === "conf" ? r.conf : show === "nofish" ? !r.fish : r.fish && !r.conf)) &&
        (!s || normP([r.code, [...r.descs.keys()].join(" "), r.docs.map((d) => d.item).join(" "), r.tiep, r.lastInv].join(" ")).includes(s)),
    );
  }, [all, show, q]);

  const stamp = () => ({ updated_at: new Date().toISOString(), updated_by: user.id });
  const setBusyCode = (k: string, on: boolean) =>
    setBusy((b) => {
      const n = new Set(b);
      if (on) n.add(k);
      else n.delete(k);
      return n;
    });

  /** Amend the TIEP item or a per-standard alternative of every description under an item no.; clears its confirmation. */
  async function amend(code: string, patch: { tiep?: string } | { std: string; val: string }) {
    const k = normP(code);
    const docs = skus.filter((y) => normP(y.code ?? "") === k);
    if (!docs.length) return;
    setBusyCode(k, true);
    const results = await Promise.all(
      docs.map((y) => {
        const alt = { ...(y.alt ?? {}) };
        const up: Record<string, unknown> = { confirmed: false, ...stamp() };
        if ("tiep" in patch && patch.tiep !== undefined) {
          const t = patch.tiep === "__none" ? "" : patch.tiep;
          up.tiep = t || null;
          up.status = t ? "confident" : "none";
          const miss = stdsMissing(standards, t).map((st) => st.id);
          for (const sid of Object.keys(alt)) if (!miss.includes(sid)) delete alt[sid];
          up.alt = alt;
        }
        if ("std" in patch) {
          if (patch.val) alt[patch.std] = patch.val;
          else delete alt[patch.std];
          up.alt = alt;
        }
        return supabase.from("tiep_skumap").update(up).eq("id", y.id);
      }),
    );
    const err = results.find((r) => r.error)?.error;
    if (err) flash(`Could not save the change for ${code}: ${err.message}`, true);
    else flash(`${code} updated; its open invoices are recalculated. Tick Confirm when the mapping is right.`);
    await reload();
    setBusyCode(k, false);
  }

  /** Confirmation is per item no.: every description under it changes together. */
  async function confirm(r: XcRow, on: boolean) {
    const k = normP(r.code);
    setBusyCode(k, true);
    const results = await Promise.all(
      r.docs.map((y) =>
        supabase
          .from("tiep_skumap")
          .update(on ? { confirmed: true, confirmed_at: new Date().toISOString(), confirmed_by: user.id, ...stamp() } : { confirmed: false, ...stamp() })
          .eq("id", y.id),
      ),
    );
    const err = results.find((x) => x.error)?.error;
    if (err) flash("Could not save: " + err.message, true);
    else flash(`${r.code} ${on ? "confirmed" : "marked not confirmed"}${r.docs.length > 1 ? ` (${r.docs.length} descriptions)` : ""}.`);
    await reload();
    setBusyCode(k, false);
  }

  const fish = all.filter((r) => r.fish);
  const nc = fish.filter((r) => !r.conf);
  const confChip = (on: boolean) => (on ? <span className="chip chip-done">Confirmed</span> : <span className="chip chip-bad">Not confirmed</span>);

  return (
    <div className="panel">
      <h2 className="text-[15px] font-semibold m-0">Confirm export item mapping</h2>
      <p className="note m-0">
        Every item no. on the export invoices in the Exports Register, latest invoice first. Check the TIEP item, amend it
        in the drop-down if needed, then tick Confirm. A confirmed item no. prints normally on MUD forms; an unconfirmed one
        is marked NOT CONFIRMED.
      </p>
      <div className="bar">
        <label className="field">
          Show
          <select className="control" value={show} onChange={(e) => setShow(e.target.value as typeof show)}>
            <option value="nc">Not confirmed</option>
            <option value="conf">Confirmed</option>
            <option value="nofish">No TIEP item (left out)</option>
            <option value="all">All</option>
          </select>
        </label>
        <label className="field">
          Search
          <input
            className="control min-w-[300px]"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Item no., description, TIEP item, invoice"
          />
        </label>
      </div>
      <div className="scroll max-h-[74vh]">
        <table className="tbl">
          <thead>
            <tr>
              <th>Latest invoice</th>
              <th>Item no.</th>
              <th>Description</th>
              <th>TIEP item (amend)</th>
              {sts.map((st) => (
                <th key={st.id} className="num">
                  Yield · {stdShort(st)}
                </th>
              ))}
              <th className="num">Kg exported</th>
              <th className="num">Invoices</th>
              <th>Confirm</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length ? (
              <tr>
                <td colSpan={7 + sts.length} className="note">
                  {show === "nc" ? "Every export item no. is confirmed." : "No items match."}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const k = normP(r.code);
                const isBusy = busy.has(k);
                const miss = stdsMissing(standards, r.tiep);
                const x = r.head;
                const descs = [...r.descs.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d);
                const more = r.docs.filter((dd) => !r.descs.has(ws(dd.item))).length;
                const canConf = r.fish && miss.every((st) => !!x?.alt?.[st.id]);
                return (
                  <tr key={k} className={r.conf ? "bg-good-soft/40" : undefined}>
                    <td className="whitespace-nowrap">
                      {fdate(r.last)}
                      <div className="text-[11px] text-muted">
                        {r.lastInv}
                        {r.first && r.first !== r.last ? ` · first ${fdate(r.first)}` : ""}
                      </div>
                    </td>
                    <td className="font-mono whitespace-nowrap">{r.code}</td>
                    <td className="whitespace-normal min-w-[240px] max-w-[380px]">
                      {descs.map((d, i) =>
                        i ? (
                          <div key={i} className="text-[12px] text-muted">
                            {d}
                          </div>
                        ) : (
                          <div key={i}>{d}</div>
                        ),
                      )}
                      {more > 0 && <div className="text-[11px] text-muted">+{more} more in the item master</div>}
                    </td>
                    <td>
                      {w && x ? (
                        <select
                          className="control max-w-[260px]"
                          value={r.tiep ? (prods.find((o) => normP(o) === normP(r.tiep)) ?? r.tiep) : "__none"}
                          disabled={isBusy}
                          onChange={(e) => void amend(r.code, { tiep: e.target.value })}
                        >
                          <option value="__none">— No TIEP item (left out) —</option>
                          {r.tiep && !prods.some((o) => normP(o) === normP(r.tiep)) && <option value={r.tiep}>{r.tiep}</option>}
                          {prods.map((o) => (
                            <option key={o}>{o}</option>
                          ))}
                        </select>
                      ) : x ? (
                        r.tiep || "—"
                      ) : (
                        <span className="text-muted">Not in the item master</span>
                      )}
                      {miss.map((st) => {
                        const cur = x?.alt?.[st.id] ?? "";
                        return (
                          <div key={st.id} className="mt-1.5 text-[12px] text-muted">
                            Under {stdShort(st)} (not listed there):
                            <br />
                            {w ? (
                              <select
                                className="control max-w-[260px]"
                                value={st.yields.find((y) => normP(y.product) === normP(cur))?.product ?? ""}
                                disabled={isBusy}
                                onChange={(e) => void amend(r.code, { std: st.id, val: e.target.value })}
                              >
                                <option value="">— choose —</option>
                                {st.yields.map((y) => (
                                  <option key={y.product}>{y.product}</option>
                                ))}
                              </select>
                            ) : (
                              cur || "not set"
                            )}
                            {!cur && <span className="text-bad font-semibold"> needed</span>}
                          </div>
                        );
                      })}
                      {isBusy && <div className="mt-1 text-[12px] text-muted">Saving and recalculating…</div>}
                    </td>
                    {sts.map((st) => {
                      if (!r.fish || !x)
                        return (
                          <td key={st.id} className="num text-muted">
                            –
                          </td>
                        );
                      const y = skuYield(x, st);
                      const t = skuTarget(x, st);
                      return (
                        <td key={st.id} className="num">
                          {y == null ? (
                            <span className="text-bad font-semibold">–</span>
                          ) : (
                            <>
                              {(y * 100).toFixed(0)}%
                              {normP(t) !== normP(r.tiep) && <div className="text-[11px] text-muted">as {t}</div>}
                            </>
                          )}
                        </td>
                      );
                    })}
                    <td className="num">{fx0(r.qty)}</td>
                    <td className="num">
                      {r.inv.size}
                      {r.open.size > 0 && r.open.size < r.inv.size && <div className="text-[11px] text-muted">{r.open.size} open</div>}
                    </td>
                    <td className="whitespace-nowrap">
                      {r.fish ? (
                        w ? (
                          <label className="inline-flex gap-1.5 items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={r.conf}
                              disabled={(!canConf && !r.conf) || isBusy}
                              title={!canConf && !r.conf ? "Choose the item to use under each standard that does not list the TIEP item first." : undefined}
                              onChange={(e) => void confirm(r, e.target.checked)}
                            />
                            {confChip(r.conf)}
                          </label>
                        ) : (
                          confChip(r.conf)
                        )
                      ) : (
                        <span className="text-muted">{x ? "Not fish: left out" : "Add it to the item master"}</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="note m-0">
        Showing {rows.length} of {all.length} export item nos., latest invoice first. {nc.length} of {fish.length} fish items
        are not confirmed ({fx0(nc.reduce((a, r) => a + r.qty, 0))} of {fx0(fish.reduce((a, r) => a + r.qty, 0))} kg
        exported). Changing the TIEP item applies to every description under that item no., clears its confirmation and
        recalculates its invoices that have no MUD saved yet; invoices with a saved MUD keep the mapping they were saved
        with.
      </p>
    </div>
  );
}
