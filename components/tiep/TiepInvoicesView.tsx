"use client";

import { Fragment, useMemo, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useApp } from "../AppShell";
import { useTiep } from "./TiepProvider";
import MudDialog, { subjectOfGroup, subjectOfInvoice, type MudSubject } from "./MudDialog";
import PackingListUpload from "./PackingListUpload";
import { Modal, Tiles, count, mil } from "./ui";
import { allocLiab, downloadCsv, fdate, normP, stdShort, toCsv } from "@/lib/tiep/model";
import { MUD_DEFAULTS, type DocRef, type InvStatus, type MudConfig, type TiepGroup, type TiepInvoice } from "@/lib/tiep/invoices";
import { openTiepDoc, saveInvoiceExt, updateMud, uploadTiepDoc } from "@/lib/tiep/actions";

const fx = (v: number, d: number) => (v ? v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");

type InvDocKey = "invoice" | "packing" | "cusdec";
type MudDocKey = "mudSigned" | "writeoff";
const DOCS: { k: InvDocKey | MudDocKey; label: string; on: "inv" | "mud" }[] = [
  { k: "invoice", label: "Commercial invoice", on: "inv" },
  { k: "packing", label: "Packing list", on: "inv" },
  { k: "cusdec", label: "Customs entry", on: "inv" },
  { k: "mudSigned", label: "Submitted MUD", on: "mud" },
  { k: "writeoff", label: "TIEP write-off", on: "mud" },
];

function StatusChip({ status, group }: { status: InvStatus; group?: boolean }) {
  const cls = status === "cancelled" ? "chip-done" : status === "mud" ? "chip-plan" : status === "void" ? "" : "chip-open";
  const label = status === "cancelled" ? "Cancelled" : status === "mud" ? "MUD prepared" : status === "void" ? "Invoice cancelled" : "Calculated";
  return (
    <>
      <span className={"chip " + cls}>{label}</span>
      {group && <div className="text-[11px] text-muted">via group</div>}
    </>
  );
}

/** TIEP › Exports Register / Local Sales Register: invoices, their consumption and MUDs. */
export default function TiepInvoicesView({ type }: { type: "Export" | "Local" }) {
  const { supabase, company, user, flash } = useApp();
  const t = useTiep();
  const { invoices, groups, proposals, lineOf, standards, perm, reload, loading } = t;
  const p = type === "Local" ? perm.local : perm.exports;
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [st, setSt] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [mud, setMud] = useState<MudSubject | null>(null);
  const [eno, setEno] = useState<TiepInvoice | null>(null);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [grouping, setGrouping] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const target = useRef<{ kind: string; v?: TiepInvoice; g?: TiepGroup } | null>(null);

  const mine = useMemo(() => invoices.filter((v) => v.inv.type === type), [invoices, type]);
  const myGroups = useMemo(() => groups.filter((g) => g.mud.type === type), [groups, type]);
  const propBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of proposals.props) m.set(x.subjectId, (m.get(x.subjectId) ?? 0) + x.duty);
    return m;
  }, [proposals]);

  const stOf = (v: TiepInvoice): InvStatus => v.status;
  const rows = useMemo(() => {
    const s = normP(q);
    const inRange = (d: string | null) => (!from || (d ?? "") >= from) && (!to || (d ?? "") <= to);
    const inv = mine.filter(
      (v) =>
        inRange(v.inv.invoice_date) &&
        (!st || (st === "nocus" ? !v.exportE : st === "grouped" ? !!v.group : stOf(v) === st)) &&
        (!s || normP([v.inv.invoice_no, v.inv.customer, v.exportE, v.ext?.pl?.consignee, v.ext?.pl?.bl].join(" ")).includes(s)),
    );
    return inv.sort((a, b) => (b.inv.invoice_date ?? "").localeCompare(a.inv.invoice_date ?? "") || b.inv.invoice_no.localeCompare(a.inv.invoice_no));
  }, [mine, q, from, to, st]);

  // ---- Tiles
  const pend = mine.filter((v) => v.status === "calculated" || v.status === "mud");
  const kg = pend.reduce((a, v) => a + v.calc.tot.qty, 0);
  const whole = pend.reduce((a, v) => a + v.calc.tot.raw, 0);
  const fc = pend.reduce((a, v) => a + v.inv.fob_fc, 0);
  const lkr = pend.reduce((a, v) => a + v.inv.fob_lkr, 0);
  const propLiab = proposals.props.filter((x) => mine.some((v) => v.inv.id === x.subjectId) || myGroups.some((g) => g.mud.id === x.subjectId)).reduce((a, x) => a + x.duty, 0);
  const shortN = [...proposals.short.keys()].filter((id) => mine.some((v) => v.inv.id === id) || myGroups.some((g) => g.mud.id === id)).length;
  const toMap = pend.filter((v) => v.calc.bad).length;

  // ---- Documents
  function attach(kind: string, v?: TiepInvoice, g?: TiepGroup) {
    target.current = { kind, v, g };
    fileRef.current?.click();
  }
  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    const tg = target.current;
    if (!file || !tg || !company) return;
    try {
      if (tg.kind === "mudSigned" || tg.kind === "writeoff") {
        const m = tg.g?.mud ?? tg.v?.group ?? tg.v?.mud;
        if (!m) throw new Error("Save the MUD first.");
        const doc = await uploadTiepDoc(supabase, company.id, "muds", m.id, tg.kind, file);
        await updateMud(supabase, user.id, m.id, { docs: { ...m.docs, [tg.kind]: doc } });
      } else if (tg.v) {
        const doc = await uploadTiepDoc(supabase, company.id, "invoices", tg.v.inv.id, tg.kind, file);
        await saveInvoiceExt(supabase, company.id, user.id, tg.v.inv.id, { docs: { ...(tg.v.ext?.docs ?? {}), [tg.kind]: doc } });
        if (tg.kind === "cusdec" && !tg.v.exportE && type === "Export") setEno(tg.v);
      }
      flash(`Attached ${file.name}.`);
      await reload();
    } catch (err) {
      flash("Could not attach: " + (err instanceof Error ? err.message : String(err)), true);
    }
  }
  const open1 = (path: string) => openTiepDoc(supabase, path).catch((e: Error) => flash(e.message, true));

  function DocSlot({ doc, kind, v, g }: { doc?: DocRef; kind: string; v?: TiepInvoice; g?: TiepGroup }) {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        {doc ? (
          <button type="button" className="chip chip-done cursor-pointer" title={doc.name} onClick={() => void open1(doc.path)}>
            ✓ View
          </button>
        ) : p.edit ? (
          <button type="button" className="chip chip-pend cursor-pointer" onClick={() => attach(kind, v, g)}>
            + Attach
          </button>
        ) : (
          <span className="text-muted">–</span>
        )}
        {doc && p.edit && (
          <button type="button" className="text-muted text-[12px]" title="Replace" onClick={() => attach(kind, v, g)}>
            ↻
          </button>
        )}
      </span>
    );
  }

  // ---- Groups
  const groupable = (v: TiepInvoice) => v.status === "calculated" && !v.group && !v.calc.bad && v.calc.lines.length > 0 && !(v.mud && v.mud.status !== "draft");
  async function makeGroup(name: string, existing: string | null) {
    if (!company) return;
    const ids = [...sel];
    try {
      let gid = existing;
      if (gid) {
        const g = myGroups.find((x) => x.mud.id === gid)!;
        await updateMud(supabase, user.id, gid, { member_ids: [...new Set([...g.mud.member_ids, ...ids])] });
      } else {
        const { data, error } = await supabase
          .from("tiep_muds")
          .insert({ company_id: company.id, kind: "group", type, group_name: name, member_ids: ids, created_by: user.id })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        gid = (data as { id: string }).id;
      }
      for (const id of ids) await saveInvoiceExt(supabase, company.id, user.id, id, { group_id: gid });
      flash(`${ids.length} invoice${ids.length === 1 ? "" : "s"} grouped into one MUD.`);
      setSel(new Set());
      setGrouping(false);
      await reload();
    } catch (e) {
      flash("Could not group: " + (e instanceof Error ? e.message : String(e)), true);
    }
  }
  async function ungroup(g: TiepGroup) {
    if (!window.confirm(`Ungroup ${g.mud.group_name}? Its ${g.members.length} invoices go back to the list.`)) return;
    const { error } = await supabase.from("tiep_muds").delete().eq("id", g.mud.id);
    if (error) return flash("Could not ungroup: " + error.message, true);
    flash(`Ungrouped ${g.mud.group_name}.`);
    await reload();
  }

  function csv() {
    const out: (string | number | null)[][] = [
      ["Invoice", "Date", "Status", "Export CusDec", "Customer / consignee", "Standard", "Lines", "Qty sold (kg)", "Whole fish (kg)", "FOB (FC)", "FOB (LKR)", "Liability (LKR)", "Group"],
    ];
    for (const v of rows) {
      const m = v.group ?? v.mud;
      const liab = m?.status === "draft" || !m ? (propBy.get(v.group ? v.group.id : v.inv.id) ?? 0) : (m.mud?.claims ?? []).reduce((a, c) => a + c.alloc.reduce((s, x) => s + (x.liab ?? allocLiab(lineOf.get(x.key), x.qty)), 0), 0);
      out.push([v.inv.invoice_no, v.inv.invoice_date, v.status, v.exportE, v.ext?.pl?.consignee ?? v.inv.customer, v.calc.std ? stdShort(v.calc.std) : "", v.calc.lines.length,
        Math.round(v.calc.tot.qty * 100) / 100, Math.round(v.calc.tot.raw * 100) / 100, v.inv.fob_fc, v.inv.fob_lkr, Math.round(liab), v.group?.group_name ?? ""]);
    }
    downloadCsv(`TIEP_${type}_Register_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(out));
  }

  const savedLiab = (m: TiepGroup["mud"] | undefined) =>
    (m?.mud?.claims ?? []).reduce((a, c) => a + c.alloc.reduce((s, x) => s + (x.liab ?? allocLiab(lineOf.get(x.key), x.qty)), 0), 0);

  function NextStep({ v }: { v: TiepInvoice }) {
    const btn = (label: string, primary: boolean, on: () => void) => (
      <button className={"btn py-0.5 px-2.5 text-[12px]" + (primary ? " btn-primary" : "")} type="button" onClick={on}>
        {label}
      </button>
    );
    if (v.status === "void") return <span className="text-muted">No TIEP cancellation · credit memo {v.inv.void_ref}</span>;
    if (v.group) return <>{btn("Group MUD", false, () => setMud(subjectOfGroup(groups.find((g) => g.mud.id === v.group!.id)!)))}<div className="text-[11px] text-muted">in {v.group.group_name}</div></>;
    if (v.ext?.cancelled_via) return <span className="text-muted">✓ Cancelled in the TIEP logbook</span>;
    if (v.status === "cancelled") return <>{btn("View MUD", false, () => setMud(subjectOfInvoice(v)))}<div className="text-[11px] text-muted">✓ Cancellation completed</div></>;
    if (v.status === "mud")
      return (
        <>
          {btn("View MUD", false, () => setMud(subjectOfInvoice(v)))}
          <div className="text-[11px] text-muted">
            Next: {v.mud?.docs.writeoff ? "record the write-off figures" : v.mud?.docs.mudSigned ? "attach the TIEP write-off note" : "submit the MUD, attach the signed copy"}
          </div>
        </>
      );
    if (v.calc.bad)
      return (
        <>
          <Link href="/tiep/settings/items" className="btn py-0.5 px-2.5 text-[12px] no-underline">
            Map {v.calc.bad} line{v.calc.bad === 1 ? "" : "s"}
          </Link>
          <div className="text-[11px] text-muted">{v.calc.lines.find((l) => l.status !== "OK" && l.status !== "Excluded")?.status}</div>
        </>
      );
    if (type === "Local") return <><span className="chip chip-open">Not in a MUD yet</span><div className="text-[11px] text-muted">Tick ☐ and use Group into one MUD</div></>;
    return (
      <>
        {btn("Prepare MUD", true, () => setMud(subjectOfInvoice(v)))}
        <div className="text-[11px] text-muted">{v.exportE ? "Next: review FIFO and Save MUD" : "E no. needed before saving"}</div>
        {proposals.short.has(v.inv.id) && (
          <div className="text-[11px] text-bad">⚠ Imports do not cover {proposals.short.get(v.inv.id)!.map((x) => x.label).join(", ")}</div>
        )}
      </>
    );
  }

  const COLS = 18;
  return (
    <>
      {type === "Export" && p.upload && <PackingListUpload />}
      <div className="note">
        {type === "Export" ? "Export" : "Local"} sales invoices come from{" "}
        <Link href={type === "Export" ? "/registers/exports" : "/registers/local-sales"} className="underline">
          Registers › {type === "Export" ? "Export Register" : "Local Sales Register"}
        </Link>
        . Each one is calculated here from the conversion standard for its date and the system item mapping.
      </div>
      <Tiles
        items={[
          { k: `${type} invoices not yet cancelled`, v: count(pend.length), x: `${pend.filter((v) => v.status === "mud").length} with MUD saved` },
          { k: `${type} quantity`, v: `${count(Math.round(kg))} kg`, x: `whole fish ${count(Math.round(whole))} kg`, tone: "a" },
          { k: "FOB value", v: `${count(Math.round(fc))} FC`, x: mil(lkr) },
          { k: "Proposed liability (pending)", v: mil(propLiab), x: "FIFO proposals for invoices without a saved MUD", tone: "w" },
          { k: "Not covered by imports", v: count(shortN), x: toMap ? `${toMap} with items to map` : "FIFO ran out of open import lines", tone: shortN ? "b" : "" },
        ]}
      />
      <div className="bar">
        <label className="field">
          Search
          <input className="control min-w-[220px]" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Invoice, customer, BL, E no." />
        </label>
        <label className="field">
          From
          <input className="control" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          To
          <input className="control" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="field">
          Status
          <select className="control" value={st} onChange={(e) => setSt(e.target.value)}>
            <option value="">All</option>
            <option value="calculated">Calculated (MUD not saved)</option>
            <option value="mud">MUD prepared</option>
            <option value="cancelled">Cancelled with customs</option>
            <option value="void">Invoice cancelled (credit memo)</option>
            {type === "Export" && <option value="nocus">No export CusDec yet</option>}
            <option value="grouped">In a MUD group</option>
          </select>
        </label>
        <span className="flex-1" />
        <button className="btn" type="button" onClick={csv}>
          Download CSV
        </button>
        {perm.settings.edit && (
          <button className="btn" type="button" onClick={() => setCfgOpen(true)}>
            MUD form settings
          </button>
        )}
        {p.edit && (
          <button className="btn btn-primary" type="button" disabled={!sel.size} onClick={() => setGrouping(true)} title="Tick invoices in the first column">
            {sel.size ? `Group ${sel.size} selected into one MUD` : "Group into one MUD"}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2 text-[12.5px]">
        {[
          type === "Export" ? "Upload the invoice in Registers (and its commercial invoice / packing list PDF above)" : "Upload the local sales list in Registers",
          type === "Export" ? "Attach the customs entry and enter the export E no." : "Tick the invoices to cancel together and Group into one MUD",
          "Prepare MUD: review the FIFO entries, change if needed, Save MUD",
          "Print the MUD form and submit it to customs; attach the signed copy",
          "Attach the TIEP write-off note and record the cancellation",
        ].map((x, i) => (
          <div key={i} className="flex-1 min-w-[180px] flex gap-2 items-start border border-line rounded-lg px-2.5 py-2">
            <b className="flex-none w-5 h-5 rounded-full bg-accent text-accent-ink text-[12px] grid place-items-center">{i + 1}</b>
            <span>{x}</span>
          </div>
        ))}
      </div>

      <input ref={fileRef} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/*" onChange={onFile} />
      <div className="scroll max-h-[70vh]">
        <table className="tbl">
          <thead>
            <tr>
              <th title="Tick invoices to group into one MUD">☐</th>
              <th></th>
              <th>Invoice</th>
              <th>Date</th>
              <th>Status</th>
              <th className="min-w-[160px]">MUD / next step</th>
              {DOCS.map((d) => (
                <th key={d.k} className="text-center whitespace-normal min-w-[74px]">
                  {d.label}
                </th>
              ))}
              {type === "Export" && <th>Export CusDec</th>}
              <th>Standard</th>
              <th className="num">Qty sold (kg)</th>
              <th className="num">Whole fish (kg)</th>
              <th className="num">Liability (LKR)</th>
              <th>Customer / consignee</th>
              <th className="num">FOB (FC)</th>
            </tr>
          </thead>
          <tbody>
            {myGroups.map((g) => {
              const isOpen = open.has(g.mud.id);
              const liab = g.status === "calculated" ? (propBy.get(g.mud.id) ?? 0) : savedLiab(g.mud);
              return (
                <Fragment key={g.mud.id}>
                  <tr className="bg-accent-soft">
                    <td></td>
                    <td>
                      <button className="btn px-1.5 py-0 text-[12px]" type="button" onClick={() => setOpen((s) => toggle(s, g.mud.id))}>
                        {isOpen ? "−" : "+"}
                      </button>
                    </td>
                    <td>
                      <b>▤ {g.mud.group_name}</b>
                      <div className="text-[11px] text-muted">MUD group · {g.members.length} invoices</div>
                    </td>
                    <td>{fdate(g.date)}</td>
                    <td>
                      <StatusChip status={g.status} />
                    </td>
                    <td>
                      <button className={"btn py-0.5 px-2.5 text-[12px]" + (g.status === "calculated" ? " btn-primary" : "")} type="button" onClick={() => setMud(subjectOfGroup(g))}>
                        {g.status === "calculated" ? "Prepare MUD" : "View MUD"}
                      </button>
                      {g.status === "calculated" && p.edit && (
                        <button className="btn py-0.5 px-2 text-[12px] ml-1" type="button" onClick={() => void ungroup(g)}>
                          Ungroup
                        </button>
                      )}
                    </td>
                    <td colSpan={3}></td>
                    <td className="text-center">
                      <DocSlot doc={g.mud.docs.mudSigned} kind="mudSigned" g={g} />
                    </td>
                    <td className="text-center">
                      <DocSlot doc={g.mud.docs.writeoff} kind="writeoff" g={g} />
                    </td>
                    {type === "Export" && <td></td>}
                    <td>{g.calc.std ? stdShort(g.calc.std) : ""}</td>
                    <td className="num">{fx(g.calc.tot.qty, 2)}</td>
                    <td className="num">
                      <b>{fx(g.calc.tot.raw, 2)}</b>
                    </td>
                    <td className="num">{fx(liab, 2)}</td>
                    <td colSpan={2}></td>
                  </tr>
                  {isOpen &&
                    g.members.map((v) => (
                      <tr key={v.inv.id} className="sub">
                        <td></td>
                        <td></td>
                        <td className="font-mono">{v.inv.invoice_no}</td>
                        <td>{fdate(v.inv.invoice_date)}</td>
                        <td colSpan={9}>{v.inv.customer}</td>
                        {type === "Export" && <td>{v.exportE}</td>}
                        <td></td>
                        <td className="num">{fx(v.calc.tot.qty, 2)}</td>
                        <td className="num">{fx(v.calc.tot.raw, 2)}</td>
                        <td colSpan={3}></td>
                      </tr>
                    ))}
                </Fragment>
              );
            })}
            {loading && !mine.length ? (
              <tr>
                <td colSpan={COLS} className="note">
                  Loading…
                </td>
              </tr>
            ) : !rows.length ? (
              <tr>
                <td colSpan={COLS} className="note">
                  {mine.length ? "No invoices match these filters." : `No ${type.toLowerCase()} invoices yet. Upload them in Registers.`}
                </td>
              </tr>
            ) : (
              rows.map((v) => {
                const isOpen = open.has(v.inv.id);
                const m = v.group ?? v.mud;
                const liab = v.group ? 0 : !m || m.status === "draft" ? (propBy.get(v.inv.id) ?? 0) : savedLiab(m);
                return (
                  <Fragment key={v.inv.id}>
                    <tr className={v.status === "void" ? "text-muted" : undefined}>
                      <td>
                        {p.edit && groupable(v) && (
                          <input type="checkbox" aria-label={`Select ${v.inv.invoice_no}`} checked={sel.has(v.inv.id)} onChange={() => setSel((s) => toggle(s, v.inv.id))} />
                        )}
                      </td>
                      <td>
                        {v.calc.lines.length > 0 && (
                          <button className="btn px-1.5 py-0 text-[12px]" type="button" aria-expanded={isOpen} onClick={() => setOpen((s) => toggle(s, v.inv.id))}>
                            {isOpen ? "−" : "+"}
                          </button>
                        )}
                      </td>
                      <td>
                        <b className="font-mono">{v.inv.invoice_no}</b>
                        {v.group && <div className="text-[11px] text-muted">in {v.group.group_name}</div>}
                      </td>
                      <td>{v.inv.invoice_date ? fdate(v.inv.invoice_date) : <span className="text-bad">missing</span>}</td>
                      <td>
                        <StatusChip status={v.status} group={!!v.group} />
                      </td>
                      <td>
                        <NextStep v={v} />
                      </td>
                      {DOCS.map((d) => (
                        <td key={d.k} className="text-center">
                          {d.on === "inv" ? (
                            <DocSlot doc={v.ext?.docs[d.k as InvDocKey]} kind={d.k} v={v} />
                          ) : v.group ? (
                            <span className="text-muted text-[11px]">group</span>
                          ) : v.mud && v.mud.status !== "draft" ? (
                            <DocSlot doc={v.mud.docs[d.k as MudDocKey]} kind={d.k} v={v} />
                          ) : (
                            <span className="text-muted">–</span>
                          )}
                        </td>
                      ))}
                      {type === "Export" && (
                        <td>
                          {v.exportE ||
                            (p.edit && v.status !== "void" ? (
                              <button className="btn py-0.5 px-2 text-[12px]" type="button" onClick={() => setEno(v)}>
                                Enter E no.
                              </button>
                            ) : (
                              <span className="text-bad">–</span>
                            ))}
                        </td>
                      )}
                      <td>{v.calc.std ? stdShort(v.calc.std) : <span className="text-bad">none</span>}</td>
                      <td className="num">{fx(v.calc.tot.qty, 2)}</td>
                      <td className="num">
                        <b>{fx(v.calc.tot.raw, 2)}</b>
                        {v.calc.bad > 0 && <div className="text-[11px] text-bad">{v.calc.bad} to map</div>}
                      </td>
                      <td className="num">{v.group ? <span className="text-muted">in group</span> : fx(liab, 2)}</td>
                      <td className="whitespace-normal min-w-[170px] max-w-[240px]">{(v.ext?.pl?.consignee as string) || v.inv.customer}</td>
                      <td className="num">{fx(v.inv.fob_fc, 2)}</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={2}></td>
                        <td colSpan={COLS - 2} className="p-0">
                          <LinesTable v={v} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="note m-0">
        FIFO uses only TIEP import lines whose duty was suspended or deferred at import (S-series CusDecs marked Yes, liability above 0). Pending proposals
        are recalculated, oldest invoice first, every time an invoice or an import entry changes; saved MUDs keep the entries they reserved. Invoices reversed
        by credit memo are left out.
      </p>

      {mud && <MudDialog subject={mud} onClose={() => setMud(null)} />}
      {eno && <ExportEDialog v={eno} onClose={() => setEno(null)} />}
      {cfgOpen && <MudConfigDialog onClose={() => setCfgOpen(false)} />}
      {grouping && (
        <GroupDialog
          type={type}
          count={sel.size}
          drafts={myGroups.filter((g) => g.status === "calculated")}
          defaultName={`${type.toUpperCase()} ${new Date().toISOString().slice(0, 7)}`}
          onSave={makeGroup}
          onClose={() => setGrouping(false)}
        />
      )}
      {standards.length === 0 && <div className="msg msg-err">No conversion standard yet: add one in Settings › Conversion standards before invoices can be calculated.</div>}
    </>
  );
}

function toggle(s: Set<string>, id: string) {
  const n = new Set(s);
  if (n.has(id)) n.delete(id);
  else n.add(id);
  return n;
}

function LinesTable({ v }: { v: TiepInvoice }) {
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th className="num">#</th>
          <th>Item no.</th>
          <th>Description</th>
          <th className="num">Qty as invoiced</th>
          <th className="num">Qty (kg)</th>
          <th>TIEP item</th>
          <th className="num">Yield</th>
          <th className="num">Whole fish (kg)</th>
          <th className="num">Boxes</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {v.calc.lines.map((l) => (
          <tr key={l.n}>
            <td className="num">{l.n}</td>
            <td className="font-mono">{l.code}</td>
            <td className="whitespace-normal max-w-[360px]">{l.desc}</td>
            <td className="num">
              {fx(l.qtyIn, 2)} {l.uomIn.toLowerCase()}
            </td>
            <td className="num">{fx(l.qty, 2)}</td>
            <td className="whitespace-normal">{l.tiep}</td>
            <td className="num">
              {l.yield ? `${(l.yield * 100).toFixed(0)}%` : ""}
              {l.yov && <div className="text-[11px] text-warn">changed</div>}
            </td>
            <td className="num">{l.raw ? fx(l.raw, 2) : ""}</td>
            <td className="num">{l.boxes || ""}</td>
            <td>
              {l.status === "OK" ? <span className="chip chip-done">OK</span> : l.status === "Excluded" ? <span className="chip">Not fish</span> : <span className="chip chip-bad">{l.status}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ExportEDialog({ v, onClose }: { v: TiepInvoice; onClose: () => void }) {
  const { supabase, company, user, flash } = useApp();
  const { reload } = useTiep();
  const [e, setE] = useState(v.exportE);
  async function save() {
    if (!company) return;
    try {
      await saveInvoiceExt(supabase, company.id, user.id, v.inv.id, { export_e: e.trim() || null, export_e_src: "entered" });
      flash(`Export entry saved for ${v.inv.invoice_no}.`);
      onClose();
      await reload();
    } catch (err) {
      flash("Could not save: " + (err instanceof Error ? err.message : String(err)), true);
    }
  }
  return (
    <Modal
      title={`Export entry · ${v.inv.invoice_no}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" type="button" onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <label className="field">
        Export CusDec (E no.) as on the customs entry
        <input className="control w-[220px]" value={e} onChange={(x) => setE(x.target.value)} placeholder="e.g. E 12345" autoFocus />
      </label>
    </Modal>
  );
}

function GroupDialog({
  type,
  count: n,
  drafts,
  defaultName,
  onSave,
  onClose,
}: {
  type: string;
  count: number;
  drafts: TiepGroup[];
  defaultName: string;
  onSave: (name: string, existing: string | null) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<string>("new");
  const [name, setName] = useState(defaultName);
  return (
    <Modal
      title={`Group ${n} ${type.toLowerCase()} invoice${n === 1 ? "" : "s"} into one MUD`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" type="button" disabled={mode === "new" && !name.trim()} onClick={() => onSave(name.trim(), mode === "new" ? null : mode)}>
            Group
          </button>
        </>
      }
    >
      <label className="field">
        Group
        <select className="control" value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="new">New group</option>
          {drafts.map((g) => (
            <option key={g.mud.id} value={g.mud.id}>
              Add to {g.mud.group_name} ({g.members.length} invoices)
            </option>
          ))}
        </select>
      </label>
      {mode === "new" && (
        <label className="field">
          Group name (also the MUD posting reference)
          <input className="control" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      )}
      <p className="note m-0">The group gets one MUD covering all its invoices, dated on the latest invoice.</p>
    </Modal>
  );
}

function MudConfigDialog({ onClose }: { onClose: () => void }) {
  const { supabase, company, user, flash } = useApp();
  const { mudConfig, settings, reload } = useTiep();
  const [c, setC] = useState<MudConfig>(mudConfig);
  const F: [keyof MudConfig, string][] = [
    ["importer", "Name of the importer"],
    ["tin", "TIN/VAT no."],
    ["scheme", "Warehouse type / scheme"],
    ["schemeNote", "Scheme note line"],
    ["office", "Office code (default)"],
    ["product", "Export product"],
    ["hs", "Export HS code"],
    ["refPrefix", "Ref no. prefix"],
    ["company", "Company (signature block)"],
    ["address", "Address (signature block)"],
    ["declarant", "Declarant name"],
    ["cha", "CHA no."],
  ];
  async function save() {
    if (!company) return;
    const { error } = await supabase
      .from("tiep_settings")
      .upsert({ company_id: company.id, mud_config: c, ...(settings ? { updated_at: new Date().toISOString(), updated_by: user.id } : { created_by: user.id }) }, { onConflict: "company_id" });
    if (error) return flash("Could not save: " + error.message, true);
    flash("MUD form settings saved.");
    onClose();
    await reload();
  }
  return (
    <Modal
      title="MUD form settings"
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={() => setC(MUD_DEFAULTS)}>
            Defaults
          </button>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" type="button" onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
        {F.map(([k, l]) => (
          <label key={k} className="field">
            {l}
            <input className="control" value={c[k]} onChange={(e) => setC((x) => ({ ...x, [k]: e.target.value }))} />
          </label>
        ))}
      </div>
      <p className="note m-0">These print on every Material Utilization Declaration. The Ref no. is the prefix plus the invoice number.</p>
    </Modal>
  );
}

