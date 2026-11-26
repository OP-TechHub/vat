"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import * as XLSX from "xlsx";
import { useApp } from "../AppShell";
import { useTiep } from "./TiepProvider";
import { Modal, Tiles } from "./ui";
import {
  allProducts,
  downloadCsv,
  normP,
  r4,
  skuIsConfirmed,
  skuTarget,
  skuUnmapped,
  skuYield,
  stdList,
  stdShort,
  toCsv,
  type SkuItem,
} from "@/lib/tiep/model";

const STATUS_LABEL: Record<SkuItem["status"], string> = { confident: "Matched", review: "To review", none: "No TIEP item" };
const fx0 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });

/** Settings › System items & mapping (tab "sys") and Settings › TIEP items (tab "tiep"). */
export default function TiepItemsView({ tab }: { tab: "sys" | "tiep" }) {
  const { supabase, company, user, flash } = useApp();
  const { skus, standards, perm, reload } = useTiep();
  const w = (tab === "tiep" ? perm.tiepItems.edit : perm.items.edit);
  const sts = useMemo(() => stdList(standards), [standards]);
  const prods = useMemo(() => allProducts(standards), [standards]);
  const [q, setQ] = useState("");
  const [st, setSt] = useState("");
  const [tp, setTp] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkTo, setBulkTo] = useState("");
  const [edit, setEdit] = useState<SkuItem | "new" | null>(null);
  const [editTiep, setEditTiep] = useState<string | "new" | null>(null);
  const [busy, setBusy] = useState(false);

  const isConf = (x: SkuItem) => skuIsConfirmed(x, skus);
  const cnt = { confident: 0, review: 0, none: 0, unmapped: 0 };
  for (const x of skus) {
    if (skuUnmapped(x)) cnt.unmapped++;
    else cnt[x.status]++;
  }
  const missing = skus.filter((x) => x.tiep && sts.some((s) => skuYield(x, s) == null)).length;
  const tieps = [...new Set(skus.map((x) => x.tiep).filter(Boolean) as string[])].sort();

  const rows = useMemo(() => {
    const s = normP(q);
    return skus
      .filter(
        (x) =>
          (!st ||
            (st === "conf"
              ? isConf(x)
              : st === "notconf"
                ? !!x.tiep && !isConf(x)
                : st === "unmapped"
                  ? skuUnmapped(x)
                  : !skuUnmapped(x) && x.status === st)) &&
          (!tp || (tp === "__none" ? !x.tiep : x.tiep === tp)) &&
          (!s || normP(`${x.code ?? ""} ${x.item} ${x.tiep ?? ""}`).includes(s)),
      )
      .sort((a, b) => a.item.localeCompare(b.item));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skus, q, st, tp]);

  const stamp = () => ({ updated_at: new Date().toISOString(), updated_by: user.id });

  async function run(label: string, fn: () => PromiseLike<{ error: { message: string } | null }>[]) {
    setBusy(true);
    const results = await Promise.all(fn());
    setBusy(false);
    const err = results.find((r) => r.error)?.error;
    if (err) flash("Could not save: " + err.message, true);
    else flash(label);
    await reload();
  }

  /** Map one item. Changing the TIEP item clears the confirmation of its item no. */
  function mapOne(x: SkuItem, val: string) {
    const tiep = val === "__none" ? null : val || null;
    const changed = tiep !== x.tiep;
    const same = x.code ? skus.filter((y) => y.id !== x.id && y.code && normP(y.code) === normP(x.code) && y.confirmed) : [];
    void run(`${x.item} → ${tiep ?? "no TIEP item"}.`, () => [
      supabase
        .from("tiep_skumap")
        .update({ tiep, status: tiep ? "confident" : "none", ...(changed ? { confirmed: false } : {}), ...stamp() })
        .eq("id", x.id),
      ...(changed ? same.map((y) => supabase.from("tiep_skumap").update({ confirmed: false, ...stamp() }).eq("id", y.id)) : []),
    ]);
  }

  /** Confirmation is per item no.: every description under it changes together. */
  function confirm(x: SkuItem, on: boolean) {
    const docs = x.code ? skus.filter((y) => y.code && normP(y.code) === normP(x.code)) : [x];
    void run(`${x.code || x.item} ${on ? "confirmed" : "marked not confirmed"}${docs.length > 1 ? ` (${docs.length} descriptions)` : ""}.`, () =>
      docs.map((y) =>
        supabase
          .from("tiep_skumap")
          .update(on ? { confirmed: true, confirmed_at: new Date().toISOString(), confirmed_by: user.id, ...stamp() } : { confirmed: false, ...stamp() })
          .eq("id", y.id),
      ),
    );
  }

  function bulk(kind: "map" | "ok") {
    const ids = [...sel];
    if (!ids.length) return;
    if (kind === "map" && !bulkTo) return flash("Choose the TIEP item to map to.", true);
    const tiep = bulkTo === "__none" ? null : bulkTo;
    void run(`Updated ${ids.length} item${ids.length === 1 ? "" : "s"}.`, () =>
      ids
        .map((id) => skus.find((x) => x.id === id)!)
        .filter((x) => x && (kind === "map" || x.tiep))
        .map((x) =>
          supabase
            .from("tiep_skumap")
            .update(kind === "map" ? { tiep, status: tiep ? "confident" : "none", ...stamp() } : { status: "confident", ...stamp() })
            .eq("id", x.id),
        ),
    ).then(() => setSel(new Set()));
  }

  async function importFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !company) return;
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", raw: true });
    const A = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" });
    if (A.length < 2) return flash("The file needs a header row and at least one item.", true);
    const hdr = A[0].map((h) => normP(h));
    const f = (re: RegExp) => hdr.findIndex((h) => re.test(h));
    const ci = { code: f(/^(item )?(no|code|number)$|item no|sku code/), item: f(/desc|item name|system item|^item$|product/), tiep: f(/tiep/) };
    if (ci.item < 0) return flash("Could not find a Description column.", true);
    const byCode = new Map(skus.filter((x) => x.code).map((x) => [normP(x.code), x]));
    const byItem = new Map(skus.map((x) => [normP(x.item), x]));
    const inserts: Record<string, unknown>[] = [];
    const updates: { id: string; d: Record<string, unknown> }[] = [];
    let skip = 0;
    for (const r of A.slice(1)) {
      const item = String(r[ci.item] ?? "").trim();
      const code = ci.code >= 0 ? String(r[ci.code] ?? "").trim() : "";
      const tRaw = ci.tiep >= 0 ? String(r[ci.tiep] ?? "").trim() : "";
      if (!item) {
        skip++;
        continue;
      }
      const tiep = tRaw ? (prods.find((p) => normP(p) === normP(tRaw)) ?? "") : null;
      const ex = (code && byCode.get(normP(code))) || byItem.get(normP(item));
      if (ex) {
        const d: Record<string, unknown> = {};
        if (code && !ex.code) d.code = code;
        if (tiep != null && tiep !== (ex.tiep ?? "")) {
          d.tiep = tiep || null;
          d.status = tiep ? "confident" : normP(tRaw).includes("no") ? "none" : "review";
        }
        if (Object.keys(d).length) updates.push({ id: ex.id, d: { ...d, ...stamp() } });
        else skip++;
      } else
        inserts.push({
          company_id: company.id,
          code: code || null,
          item,
          tiep: tiep || null,
          status: tiep ? "confident" : "review",
          notes: tRaw && !tiep ? `TIEP item in file not recognised: ${tRaw}` : null,
          src: `Item import ${new Date().toISOString().slice(0, 10)}`,
          created_by: user.id,
        });
    }
    void run(`Items imported: ${inserts.length} added, ${updates.length} updated, ${skip} unchanged.`, () => [
      ...(inserts.length ? [supabase.from("tiep_skumap").insert(inserts)] : []),
      ...updates.map((u) => supabase.from("tiep_skumap").update(u.d).eq("id", u.id)),
    ]);
  }

  function csv() {
    const out: (string | number)[][] = [
      ["Item No", "System item (invoice description)", "TIEP item", "Status", ...sts.map((s) => "Item used under " + stdShort(s)), ...sts.map((s) => "Yield % " + stdShort(s)), "Confirmed", "Notes"],
    ];
    for (const x of [...skus].sort((a, b) => a.item.localeCompare(b.item)))
      out.push([
        x.code ?? "",
        x.item,
        x.tiep ?? "",
        skuUnmapped(x) ? "not mapped" : x.status,
        ...sts.map((s) => skuTarget(x, s)),
        ...sts.map((s) => {
          const y = skuYield(x, s);
          return y == null ? "" : r4(y * 100);
        }),
        isConf(x) ? "Yes" : "",
        x.notes ?? "",
      ]);
    downloadCsv(`TIEP_Item_Master_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(out));
  }

  const allSel = rows.length > 0 && rows.every((x) => sel.has(x.id));
  const tiepSelect = (value: string, first: string, onChange: (v: string) => void, disabled = false) => (
    <select className="control max-w-[240px]" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">{first}</option>
      {prods.map((p) => (
        <option key={p}>{p}</option>
      ))}
    </select>
  );

  return (
    <div className="panel">
      <h2 className="text-[15px] font-semibold m-0">{tab === "tiep" ? "TIEP items" : "System items & mapping"}</h2>
      {tab === "tiep" ? (
        <p className="note m-0">
          TIEP items are the products as listed in the TIEP approval, with their yield under each conversion standard. The
          yield converts the quantity sold back to whole (round) fish. Edits apply across all standards.
        </p>
      ) : (
        <p className="note m-0">
          System items are the items on invoices and sales lists (Business Central item no. and description). Each one is
          mapped to a TIEP item, the product as listed in the TIEP approval; the TIEP item’s yield converts the quantity sold
          back to whole (round) fish. System items with no TIEP item (by-products, charges, non-fish) are left out of the
          consumption.
        </p>
      )}
      <Tiles
        items={
          tab === "tiep"
            ? [
                { k: "TIEP items", v: fx0(prods.length) },
                { k: "Not in every standard", v: fx0(missing), tone: missing ? "b" : "" },
              ]
            : [
                { k: "System items", v: fx0(skus.length) },
                { k: "Matched", v: fx0(cnt.confident) },
                { k: "To review", v: fx0(cnt.review), tone: cnt.review ? "w" : "" },
                { k: "No TIEP item", v: fx0(cnt.none) },
                { k: "Not mapped yet", v: fx0(cnt.unmapped), tone: cnt.unmapped ? "w" : "" },
                { k: "Item nos. confirmed", v: fx0(new Set(skus.filter(isConf).map((x) => x.code || x.id)).size) },
              ]
        }
      />

      {tab === "tiep" ? (
        <TiepItems onEdit={setEditTiep} canEdit={w} />
      ) : (
        <>
          <div className="bar">
            <label className="field">
              Search
              <input className="control min-w-[220px]" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Item no., description or TIEP item" />
            </label>
            <label className="field">
              Status
              <select className="control" value={st} onChange={(e) => setSt(e.target.value)}>
                <option value="">All</option>
                <option value="confident">Matched</option>
                <option value="review">To review</option>
                <option value="none">No TIEP item</option>
                <option value="unmapped">Not mapped yet</option>
                <option value="conf">Confirmed</option>
                <option value="notconf">Mapped, not confirmed</option>
              </select>
            </label>
            <label className="field">
              TIEP item
              <select className="control" value={tp} onChange={(e) => setTp(e.target.value)}>
                <option value="">All</option>
                {tieps.map((t) => (
                  <option key={t}>{t}</option>
                ))}
                <option value="__none">No TIEP item</option>
              </select>
            </label>
            <span className="flex-1" />
            {w && (
              <label className="btn cursor-pointer">
                Import items (CSV / Excel)
                <input type="file" accept=".csv,.txt,.xlsx,.xls" hidden onChange={importFile} />
              </label>
            )}
            <button className="btn" type="button" onClick={csv}>
              Download CSV
            </button>
            {w && (
              <button className="btn btn-primary" type="button" onClick={() => setEdit("new")}>
                Add system item
              </button>
            )}
          </div>
          {w && sel.size > 0 && (
            <div className="bar">
              <b className="pb-1.5">{sel.size} selected</b>
              <label className="field">
                Map selected to
                <select className="control" value={bulkTo} onChange={(e) => setBulkTo(e.target.value)}>
                  <option value="">Choose…</option>
                  <option value="__none">No TIEP item (exclude)</option>
                  {prods.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              <button className="btn btn-primary" type="button" disabled={busy} onClick={() => bulk("map")}>
                Apply
              </button>
              <button className="btn" type="button" disabled={busy} onClick={() => bulk("ok")}>
                Mark as matched
              </button>
              <button className="btn" type="button" onClick={() => setSel(new Set())}>
                Clear selection
              </button>
            </div>
          )}
          <div className="scroll max-h-[68vh]">
            <table className="tbl">
              <thead>
                <tr>
                  {w && (
                    <th>
                      <input
                        type="checkbox"
                        aria-label="Select all shown"
                        checked={allSel}
                        onChange={(e) => setSel(e.target.checked ? new Set(rows.map((x) => x.id)) : new Set())}
                      />
                    </th>
                  )}
                  <th>Item no.</th>
                  <th>System item (invoice description)</th>
                  <th>TIEP item</th>
                  {sts.map((s) => (
                    <th key={s.id} className="num">
                      Yield · {stdShort(s)}
                    </th>
                  ))}
                  <th>Status</th>
                  <th>Confirmed</th>
                  <th>Notes</th>
                  {w && <th></th>}
                </tr>
              </thead>
              <tbody>
                {!rows.length ? (
                  <tr>
                    <td colSpan={sts.length + 8} className="note">
                      {skus.length ? "No items match these filters." : "No items yet. Add them one by one or import a list."}
                    </td>
                  </tr>
                ) : (
                  rows.map((x) => (
                    <tr key={x.id}>
                      {w && (
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Select ${x.item}`}
                            checked={sel.has(x.id)}
                            onChange={(e) =>
                              setSel((s) => {
                                const n = new Set(s);
                                if (e.target.checked) n.add(x.id);
                                else n.delete(x.id);
                                return n;
                              })
                            }
                          />
                        </td>
                      )}
                      <td className="font-mono">{x.code ?? ""}</td>
                      <td className="whitespace-normal min-w-[240px]">{x.item}</td>
                      <td>
                        {w
                          ? tiepSelect(x.tiep ?? "", x.status === "none" ? "No TIEP item" : "— not mapped —", (v) => mapOne(x, v || "__none"), busy)
                          : (x.tiep ?? <span className="text-muted">—</span>)}
                      </td>
                      {sts.map((s) => {
                        if (!x.tiep) return <td key={s.id}></td>;
                        const y = skuYield(x, s);
                        const alt = x.alt?.[s.id];
                        return (
                          <td key={s.id} className="num">
                            {y == null ? (
                              <span className="chip chip-bad">Not in {stdShort(s)}</span>
                            ) : (
                              <>
                                {(y * 100).toFixed(0)}%{alt && <div className="text-[11px] text-muted">as {alt}</div>}
                              </>
                            )}
                          </td>
                        );
                      })}
                      <td>{skuUnmapped(x) ? <span className="chip chip-bad">Not mapped</span> : <span className={"chip " + (x.status === "confident" ? "chip-done" : x.status === "review" ? "chip-open" : "")}>{STATUS_LABEL[x.status]}</span>}</td>
                      <td>
                        {x.tiep &&
                          (w ? (
                            <label className="inline-flex gap-1.5 items-center cursor-pointer">
                              <input type="checkbox" checked={isConf(x)} disabled={busy} onChange={(e) => confirm(x, e.target.checked)} />
                              {isConf(x) ? <span className="chip chip-done">Confirmed</span> : <span className="text-muted">Not confirmed</span>}
                            </label>
                          ) : isConf(x) ? (
                            <span className="chip chip-done">Confirmed</span>
                          ) : (
                            <span className="text-muted">Not confirmed</span>
                          ))}
                      </td>
                      <td className="whitespace-normal max-w-[200px] text-muted">{x.notes}</td>
                      {w && (
                        <td>
                          <button className="btn py-0" type="button" onClick={() => setEdit(x)}>
                            Edit
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="note m-0">
            Showing {rows.length} of {skus.length} system items. Change the TIEP item in the list to map an item straight
            away, or tick several and use Map selected to. Edit sets the item no., notes and the product to use under a
            standard that does not list the TIEP item. Confirming covers every description of the same item no.
          </p>
        </>
      )}

      {edit && <SkuEditor item={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
      {editTiep && <TiepItemEditor name={editTiep === "new" ? null : editTiep} onClose={() => setEditTiep(null)} />}
    </div>
  );
}

function TiepItems({ onEdit, canEdit }: { onEdit: (n: string | "new") => void; canEdit: boolean }) {
  const { skus, standards } = useTiep();
  const sts = stdList(standards);
  const prods = allProducts(standards);
  return (
    <>
      <div className="bar">
        <span className="note">
          TIEP items are the sales products in the conversion standards. A yield left blank means the item is not listed in
          that standard.
        </span>
        <span className="flex-1" />
        {canEdit && sts.length > 0 && (
          <button className="btn btn-primary" type="button" onClick={() => onEdit("new")}>
            Add TIEP item
          </button>
        )}
      </div>
      <div className="scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>TIEP item</th>
              <th>HS</th>
              {sts.map((s) => (
                <th key={s.id} className="num">
                  Yield · {stdShort(s)}
                </th>
              ))}
              <th className="num">System items mapped</th>
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {!prods.length && (
              <tr>
                <td colSpan={sts.length + 4} className="note">
                  No TIEP items yet. Add a conversion standard first.
                </td>
              </tr>
            )}
            {prods.map((n) => {
              const ys = sts.map((s) => s.yields.find((y) => y.product === n));
              const used = skus.filter((x) => x.tiep === n || Object.values(x.alt ?? {}).includes(n)).length;
              return (
                <tr key={n}>
                  <td className="whitespace-normal">
                    <b>{n}</b>
                  </td>
                  <td className="font-mono">{ys.find(Boolean)?.hs ?? ""}</td>
                  {ys.map((y, i) => (
                    <td key={sts[i].id} className="num">
                      {y ? `${(y.yield * 100).toFixed(0)}%` : <span className="text-muted">not listed</span>}
                    </td>
                  ))}
                  <td className="num">{used}</td>
                  {canEdit && (
                    <td>
                      <button className="btn py-0" type="button" onClick={() => onEdit(n)}>
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SkuEditor({ item: x, onClose }: { item: SkuItem | null; onClose: () => void }) {
  const { supabase, company, user, flash } = useApp();
  const { skus, standards, perm, reload } = useTiep();
  const sts = stdList(standards);
  const prods = allProducts(standards);
  const [code, setCode] = useState(x?.code ?? "");
  const [item, setItem] = useState(x?.item ?? "");
  const [tiep, setTiep] = useState(x?.tiep ?? "");
  const [status, setStatus] = useState<SkuItem["status"]>(x?.status ?? "confident");
  const [alt, setAlt] = useState<Record<string, string>>(x?.alt ?? {});
  const [notes, setNotes] = useState(x?.notes ?? "");
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    if (!company) return;
    if (!item.trim()) return setMsg("Enter the item description.");
    const dup = skus.find((o) => o.id !== x?.id && (normP(o.item) === normP(item) || (code && o.code && normP(o.code) === normP(code))));
    if (dup) return setMsg(`That item is already in the master (${dup.item}).`);
    const altClean = Object.fromEntries(Object.entries(alt).filter(([, v]) => v));
    const row = {
      code: code.trim() || null,
      item: item.trim(),
      tiep: tiep || null,
      alt: altClean,
      status: tiep ? status : "none",
      notes: notes.trim() || null,
    };
    const res = x
      ? await supabase.from("tiep_skumap").update({ ...row, updated_at: new Date().toISOString(), updated_by: user.id }).eq("id", x.id)
      : await supabase.from("tiep_skumap").insert({ ...row, company_id: company.id, src: "Added in register", created_by: user.id });
    if (res.error) return setMsg("Could not save: " + res.error.message);
    flash(`${x ? "Updated" : "Added"} ${row.item}.`);
    onClose();
    await reload();
  }

  async function remove() {
    if (!x || !window.confirm(`Delete ${x.item}?`)) return;
    const { error } = await supabase.from("tiep_skumap").delete().eq("id", x.id);
    if (error) return setMsg("Could not delete: " + error.message);
    flash(`Deleted ${x.item}.`);
    onClose();
    await reload();
  }

  return (
    <Modal
      title={x ? "Edit system item" : "Add system item"}
      onClose={onClose}
      footer={
        <>
          {x && perm.items.delete && (
            <button className="btn btn-danger mr-auto" type="button" onClick={() => void remove()}>
              Delete
            </button>
          )}
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" type="button" onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <div className="bar">
        <label className="field">
          Item no. (system code)
          <input className="control w-[160px]" value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        <label className="field flex-1">
          System item (invoice description)
          <input className="control" value={item} onChange={(e) => setItem(e.target.value)} />
        </label>
      </div>
      <div className="bar">
        <label className="field">
          TIEP item
          <select
            className="control"
            value={tiep}
            onChange={(e) => {
              setTiep(e.target.value);
              if (!e.target.value) setStatus("none");
              else if (status === "none") setStatus("confident");
            }}
          >
            <option value="">No TIEP item (excluded)</option>
            {prods.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Status
          <select className="control" value={status} onChange={(e) => setStatus(e.target.value as SkuItem["status"])}>
            <option value="confident">Matched</option>
            <option value="review">To review</option>
            <option value="none">No TIEP item</option>
          </select>
        </label>
      </div>
      {sts.length > 0 && (
        <>
          <p className="note m-0">If the TIEP item is not listed in a standard, choose the item to use under that standard:</p>
          <div className="bar">
            {sts.map((s) => (
              <label key={s.id} className="field">
                Under {stdShort(s)}
                <select className="control" value={alt[s.id] ?? ""} onChange={(e) => setAlt((a) => ({ ...a, [s.id]: e.target.value }))}>
                  <option value="">Same as TIEP item</option>
                  {prods.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </>
      )}
      <label className="field">
        Notes
        <input className="control" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {msg && <div className="msg msg-err">{msg}</div>}
    </Modal>
  );
}

/** A TIEP item is a product in the standards' yield lists: editing it writes its yield into each standard. */
function TiepItemEditor({ name, onClose }: { name: string | null; onClose: () => void }) {
  const { supabase, user, flash } = useApp();
  const { skus, standards, perm, reload } = useTiep();
  const sts = stdList(standards);
  const ys0 = sts.map((s) => (name ? s.yields.find((y) => y.product === name) : undefined));
  const used = name ? skus.filter((x) => x.tiep === name || Object.values(x.alt ?? {}).includes(name)) : [];
  const [nn, setNn] = useState(name ?? "");
  const [hs, setHs] = useState(ys0.find(Boolean)?.hs ?? "");
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(sts.map((s, i) => [s.id, ys0[i] ? String(r4(ys0[i]!.yield * 100)) : ""])),
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stamp = () => ({ updated_at: new Date().toISOString(), updated_by: user.id });

  async function save() {
    const n = nn.trim();
    if (!n) return setMsg("Enter the TIEP item name.");
    if ((!name || normP(n) !== normP(name)) && allProducts(standards).some((p) => normP(p) === normP(n))) return setMsg("That TIEP item already exists.");
    const y: Record<string, number> = {};
    for (const [id, v] of Object.entries(vals)) {
      if (v.trim() === "") continue;
      const f = Number(v) / 100;
      if (!(f > 0 && f <= 1)) return setMsg("Each yield must be between 0 and 100%.");
      y[id] = r4(f);
    }
    if (!Object.keys(y).length) return setMsg("Give a yield for at least one standard.");
    setBusy(true);
    const ops: PromiseLike<{ error: { message: string } | null }>[] = [];
    for (const s of sts) {
      const yl = s.yields.map((v) => ({ ...v }));
      const i = name ? yl.findIndex((v) => v.product === name) : -1;
      if (y[s.id] != null) {
        const row = { product: n, hs: hs.trim(), yield: y[s.id] };
        if (i >= 0) yl[i] = row;
        else yl.push(row);
      } else if (i >= 0) yl.splice(i, 1);
      ops.push(supabase.from("tiep_standards").update({ yields: yl, ...stamp() }).eq("id", s.id));
    }
    // Renaming updates the system items mapped to it.
    if (name && n !== name)
      for (const x of used) {
        const alt = Object.fromEntries(Object.entries(x.alt ?? {}).map(([k, v]) => [k, v === name ? n : v]));
        ops.push(supabase.from("tiep_skumap").update({ tiep: x.tiep === name ? n : x.tiep, alt, ...stamp() }).eq("id", x.id));
      }
    const res = await Promise.all(ops);
    setBusy(false);
    const err = res.find((r) => r.error)?.error;
    if (err) return setMsg("Could not save: " + err.message);
    flash(`${name ? "Updated" : "Added"} ${n}.`);
    onClose();
    await reload();
  }

  async function remove() {
    if (!name) return;
    if (used.length) return setMsg(`Map the ${used.length} system item${used.length === 1 ? "" : "s"} to another TIEP item first.`);
    const res = await Promise.all(
      sts
        .filter((s) => s.yields.some((v) => v.product === name))
        .map((s) => supabase.from("tiep_standards").update({ yields: s.yields.filter((v) => v.product !== name), ...stamp() }).eq("id", s.id)),
    );
    const err = res.find((r) => r.error)?.error;
    if (err) return setMsg("Could not delete: " + err.message);
    flash(`Deleted ${name}.`);
    onClose();
    await reload();
  }

  return (
    <Modal
      title={name ? "Edit TIEP item" : "Add TIEP item"}
      onClose={onClose}
      footer={
        <>
          {name && perm.tiepItems.edit && perm.tiepItems.delete && (
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
      <label className="field">
        TIEP item (as listed in the approval)
        <input className="control" value={nn} onChange={(e) => setNn(e.target.value)} />
      </label>
      <label className="field">
        HS code
        <input className="control w-[240px]" value={hs} onChange={(e) => setHs(e.target.value)} />
      </label>
      <p className="note m-0">Yield % under each standard. Leave blank if the standard does not list this item.</p>
      <div className="bar">
        {sts.map((s) => (
          <label key={s.id} className="field">
            {stdShort(s)}
            <input
              className="control w-[100px]"
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={vals[s.id] ?? ""}
              onChange={(e) => setVals((v) => ({ ...v, [s.id]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      {name && (
        <p className="note m-0">
          {used.length} system item{used.length === 1 ? "" : "s"} mapped to this. Renaming updates them too.
        </p>
      )}
      {msg && <div className="msg msg-err">{msg}</div>}
    </Modal>
  );
}
