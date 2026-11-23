"use client";

import { Fragment, useMemo, useState } from "react";
import { useTiep } from "./TiepProvider";
import { StatusChip, Tiles, count, mil, n0, n2, Progress } from "./ui";
import { GROUPS, byFy, byGroup, downloadCsv, fdate, r4, toCsv, totals, type TotRow } from "@/lib/tiep/model";

const fx0 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const neg = (v: number) => (Math.abs(v) < 0.005 ? "–" : v < 0 ? `(${fx0(-v)})` : fx0(v));
const ROW_CLASS: Record<TotRow["kind"], string> = {
  row: "",
  done: "",
  sub: "italic bg-bg",
  pl: "text-accent",
  px: "text-warn",
  tot: "total",
};

export default function TiepSummaryView() {
  const { lines, periodDays, asAt, settings, loading } = useTiep();
  const t = useMemo(() => lines.filter((r) => r.req !== "No"), [lines]);

  // ---- Tiles
  const open = t.filter((r) => r.pending || (r.left ?? 0) > 0).length;
  const over = t.filter((r) => r.overdue).length;
  const pend = t.filter((r) => r.pending).length;
  const planL = t.filter((r) => r.pqty > 0).length;
  const sus = t.reduce((a, r) => a + r.tsus, 0);
  const out = t.reduce((a, r) => a + r.osv, 0);
  const rawOut = t.filter((r) => r.cat === "Raw Material").reduce((a, r) => a + r.osv, 0);
  const osd = t.reduce((a, r) => a + r.osd, 0);
  const unclassified = t.filter((r) => !r.grp).length;

  // ---- Totals
  const [grp, setGrp] = useState("");
  const [est, setEst] = useState(true);
  const grpOptions = useMemo(
    () =>
      [...new Set(t.filter((r) => r.grp).map((r) => r.grp + "|" + r.uom))].sort(
        (a, b) =>
          (GROUPS as readonly string[]).indexOf(a.split("|")[0]) - (GROUPS as readonly string[]).indexOf(b.split("|")[0]) ||
          a.localeCompare(b),
      ),
    [t],
  );
  const tot = useMemo(() => totals(lines, grp, est), [lines, grp, est]);
  const mixed = !grp && new Set(t.map((r) => r.uom)).size > 1;
  const showDut = tot.rows.some((o) => Math.abs(o.dut) > 0.5);

  function totCsv() {
    const rows: (string | number)[][] = [
      [`TIEP totals${grp ? " - " + grp.replace("|", " ") : ""} as at ${asAt}`],
      ["", "Quantity", "CID", "PAL", "SSCL", "Duty (not split)", "Total duty", "VAT (deferred)", "Total incl. VAT"],
    ];
    for (const o of tot.rows)
      rows.push([o.label, r4(o.q), ...(["cid", "pal", "sscl", "dut", "duty", "vat", "total"] as const).map((k) => Math.round(o[k] * 100) / 100)]);
    downloadCsv(`TIEP_Totals_${asAt}.csv`, toCsv(rows));
  }

  // ---- By group / by year
  const groups = useMemo(() => byGroup(lines), [lines]);
  const years = useMemo(() => byFy(lines), [lines]);
  const [openG, setOpenG] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setOpenG((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  if (loading && !lines.length) return <div className="note">Loading the TIEP register…</div>;

  return (
    <>
      <div className="note">
        As at {fdate(asAt)} · cancellation period {periodDays} days
        {!lines.length && " · No import lines yet: upload CusDecs in Registers › Import Register."}
      </div>
      <Tiles
        items={[
          { k: "Import lines", v: count(lines.length), x: `${count(lines.length - t.length)} duty paid, not tracked` },
          { k: "TIEP lines to cancel", v: count(t.length), x: `${count(open)} open or partial`, tone: "a" },
          { k: "Overdue lines", v: count(over), x: `past the ${periodDays}-day period`, tone: over ? "b" : "" },
          { k: "Duties & VAT suspended", v: mil(sus), x: `LKR ${fx0(sus)}${pend ? ` · excl. ${pend} pending` : ""}`, tone: "a" },
          { k: "Still outstanding", v: mil(out), x: sus ? `${((1 - out / sus) * 100).toFixed(1)}% cancelled so far` : "", tone: "w" },
          { k: "Outstanding, raw materials", v: mil(rawOut), x: "feed, algae, artemia, enrichment", tone: "w" },
          {
            k: "Outstanding duty excl. VAT",
            v: mil(osd),
            x: settings?.guarantee ? `bank guarantee ${mil(settings.guarantee)}` : "set the bank guarantee in Settings",
            tone: "b",
          },
          { k: "Planned cancellations", v: count(planL), x: "import lines with planned quantities", tone: planL ? "a" : "" },
          { k: "Import details pending", v: count(pend), x: "lines added from a local-sales plan", tone: pend ? "w" : "" },
          ...(unclassified
            ? [{ k: "Not classified", v: count(unclassified), x: "TIEP lines without a material group", tone: "w" as const }]
            : []),
        ]}
      />

      <div className="panel">
        <h2 className="text-[15px] font-semibold m-0">Totals: quantity and value (TIEP lines)</h2>
        <div className="bar">
          <label className="field">
            Material group
            <select className="control" value={grp} onChange={(e) => setGrp(e.target.value)}>
              <option value="">All material groups</option>
              {grpOptions.map((k) => (
                <option key={k} value={k}>
                  {k.replace("|", " · ")}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-flex items-center gap-1.5 text-[13px] pb-1.5">
            <input type="checkbox" checked={est} onChange={(e) => setEst(e.target.checked)} />
            Estimate CID / PAL / SSCL / VAT for logbook lines
          </label>
          <span className="flex-1" />
          <button className="btn" type="button" onClick={totCsv}>
            Download CSV
          </button>
        </div>
        <div className="scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th></th>
                <th className="num">Quantity</th>
                <th className="num">CID</th>
                <th className="num">PAL</th>
                <th className="num">SSCL</th>
                {showDut && <th className="num">Duty (not split)</th>}
                <th className="num">Total duty</th>
                <th className="num">VAT (deferred)</th>
                <th className="num">Total incl. VAT</th>
              </tr>
            </thead>
            <tbody>
              {tot.rows.map((o) => {
                const units = Object.entries(o.u).filter(([, v]) => Math.abs(v) > 0.005);
                const cell = (k: "cid" | "pal" | "sscl" | "dut" | "duty" | "vat" | "total", bold = false) => {
                  const e = (k === "vat" ? o.ev : k === "dut" ? 0 : k === "total" ? o.e + o.ev : o.e) || 0;
                  const ish = est && Math.abs(e) > 0.5 && Math.abs(o[k]) > 0.5;
                  return (
                    <td
                      className={"num" + (bold ? " font-semibold" : "")}
                      title={ish ? `Includes ${fx0(e)} estimated for logbook lines` : undefined}
                    >
                      {ish && <span className="text-muted">≈ </span>}
                      {neg(o[k])}
                    </td>
                  );
                };
                return (
                  <tr key={o.label} className={ROW_CLASS[o.kind]}>
                    <td className="whitespace-normal">{o.label}</td>
                    <td className="num">
                      {Math.abs(o.q) < 0.005 ? "–" : n2(o.q)}
                      {mixed && units.length > 0 && (
                        <div className="text-[11px] text-muted">{units.map(([u, v]) => `${u} ${n2(v)}`).join(" · ")}</div>
                      )}
                      {grp && <span className="text-muted"> {grp.split("|")[1]}</span>}
                    </td>
                    {cell("cid")}
                    {cell("pal")}
                    {cell("sscl")}
                    {showDut && cell("dut")}
                    {cell("duty", true)}
                    {cell("vat")}
                    {cell("total", true)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="note m-0">
          {est &&
            "≈ = includes an estimated breakup for logbook lines, which carry only one duty total: SSCL and the CID / PAL split use the rates on CusDec-coded lines of the same material group (same HS code first); VAT is estimated at the rate in force on the import date (8% / 12% / 15% / 18%) on 110% of customs value + CID + PAL, only for groups whose CusDecs show VAT deferred. "}
          {tot.n} TIEP import lines{grp ? ` in ${grp.replace("|", " · ")}` : ""}. Value = quantity × the line’s duty per unit
          from its CusDec (CID, PAL, SSCL where coded 0 = suspended; VAT where coded 2 = deferred).{" "}
          {mixed && "The quantity total adds different units (shown underneath by unit); pick a material group for a like-for-like quantity. "}
          Planned = saved MUDs and local-sales plans, firm; Pending confirmation = FIFO proposals for invoices with no MUD yet.
          {tot.pend > 0 &&
            ` ${tot.pend} line${tot.pend === 1 ? "" : "s"} still waiting for import details: their planned / cancelled quantities are included, but quantity imported and value are not known yet.`}
        </p>
      </div>

      <div className="panel">
        <h2 className="text-[15px] font-semibold m-0">By material group (TIEP lines only)</h2>
        <div className="bar">
          <span className="note">Open a group to see its customs entries.</span>
          <span className="flex-1" />
          <button className="btn" type="button" onClick={() => setOpenG(new Set(groups.map((g) => g.grp + "|" + g.uom)))}>
            Expand all
          </button>
          <button className="btn" type="button" onClick={() => setOpenG(new Set())}>
            Collapse all
          </button>
        </div>
        <div className="scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Material group</th>
                <th>UOM</th>
                <th>Category</th>
                <th className="num">Lines</th>
                <th className="num">Qty imported</th>
                <th className="num">Qty cancelled</th>
                <th className="num">Planned</th>
                <th className="num">Balance</th>
                <th>% cancelled</th>
                <th className="num">Suspended (LKR)</th>
                <th className="num">Outstanding (LKR)</th>
                <th className="num">Overdue</th>
              </tr>
            </thead>
            <tbody>
              {!groups.length && (
                <tr>
                  <td colSpan={12} className="note">
                    No TIEP lines yet.
                  </td>
                </tr>
              )}
              {groups.map((x) => {
                const k = x.grp + "|" + x.uom;
                const isOpen = openG.has(k);
                const ls = t.filter((r) => (r.grp || "Not classified") === x.grp && r.uom === x.uom);
                return (
                  <Fragment key={k}>
                    <tr className="clickable" onClick={() => toggle(k)} aria-expanded={isOpen}>
                      <td>
                        <span className="inline-block w-4 text-accent font-bold">{isOpen ? "−" : "+"}</span>
                        {x.grp}
                      </td>
                      <td>{x.uom}</td>
                      <td>{x.cat}</td>
                      <td className="num">
                        {x.n}
                        {x.pn > 0 && <span className="chip chip-pend ml-1">{x.pn} pending</span>}
                      </td>
                      <td className="num">
                        {n2(x.q)}
                        {x.pn ? " +?" : ""}
                      </td>
                      <td className="num">{n2(x.c)}</td>
                      <td className="num">{n2(x.p)}</td>
                      <td className="num">{n2(x.b)}</td>
                      <td>
                        <Progress pct={x.q ? x.c / x.q : 0} />
                      </td>
                      <td className="num">{n0(x.s)}</td>
                      <td className="num">{n0(x.o)}</td>
                      <td className="num">{x.od || "–"}</td>
                    </tr>
                    {isOpen &&
                      ls.map((r) => (
                        <tr key={r.key} className="sub">
                          <td>
                            {r.cusdec} · {fdate(r.date)}
                          </td>
                          <td className="font-mono">{r.id}</td>
                          <td className="whitespace-normal min-w-[220px]">{r.desc}</td>
                          <td className="num">
                            <StatusChip line={r} />
                          </td>
                          <td className="num">{r.pending ? "?" : n2(r.qty)}</td>
                          <td className="num">{n2(r.cqty)}</td>
                          <td className="num">{n2(r.pqty)}</td>
                          <td className="num">{r.pending ? "?" : n2(r.bal)}</td>
                          <td></td>
                          <td className="num">{n0(r.tsus)}</td>
                          <td className="num">{n0(r.osv)}</td>
                          <td className="num">{fdate(r.due)}</td>
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
              {groups.length > 0 && (
                <tr className="total">
                  <td colSpan={3}>Total</td>
                  <td className="num">{groups.reduce((a, x) => a + x.n, 0)}</td>
                  <td colSpan={5}></td>
                  <td className="num">{n0(groups.reduce((a, x) => a + x.s, 0))}</td>
                  <td className="num">{n0(groups.reduce((a, x) => a + x.o, 0))}</td>
                  <td className="num">{groups.reduce((a, x) => a + x.od, 0)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="note m-0">
          Quantities are not added across groups because units differ (KGM vs NIU). Equipment &amp; Spares lines stay
          marked “Confirm” until the cancellation route is agreed with Customs.
        </p>
      </div>

      <div className="panel">
        <h2 className="text-[15px] font-semibold m-0">By financial year (April to March)</h2>
        <div className="scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Financial year</th>
                <th className="num">TIEP lines</th>
                <th className="num">Open / partial</th>
                <th className="num">Suspended (LKR)</th>
                <th className="num">Outstanding (LKR)</th>
                <th className="num">Overdue</th>
              </tr>
            </thead>
            <tbody>
              {years.map((x) => (
                <tr key={x.fy}>
                  <td>{x.fy}</td>
                  <td className="num">{x.n}</td>
                  <td className="num">{x.op}</td>
                  <td className="num">{n0(x.s)}</td>
                  <td className="num">{n0(x.o)}</td>
                  <td className="num">{x.od || "–"}</td>
                </tr>
              ))}
              {years.length > 0 && (
                <tr className="total">
                  <td>Total</td>
                  <td className="num">{years.reduce((a, x) => a + x.n, 0)}</td>
                  <td className="num">{years.reduce((a, x) => a + x.op, 0)}</td>
                  <td className="num">{n0(years.reduce((a, x) => a + x.s, 0))}</td>
                  <td className="num">{n0(years.reduce((a, x) => a + x.o, 0))}</td>
                  <td className="num">{years.reduce((a, x) => a + x.od, 0)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
