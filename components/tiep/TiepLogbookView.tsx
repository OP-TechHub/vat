"use client";

import { useMemo, useState } from "react";
import { useTiep } from "./TiepProvider";
import { Tiles, mil, n0, n2 } from "./ui";
import { downloadCsv, fdate, lineKey, r4, toCsv, type TiepLine } from "@/lib/tiep/model";
import type { LogbookSummary } from "@/lib/tiep/data";

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v: unknown) => {
  const x = Number(v);
  return isFinite(x) ? x : 0;
};
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monYear = (iso: string) => `${MON[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
/** Logbook CusDec numbers are held as digits; import TIEP entries are "S" entries. */
const cdLabel = (cd: string) => (/^[A-Za-z]/.test(cd) ? cd : "S " + cd);

interface Row {
  e: LogbookSummary;
  ls: TiepLine[];
  rq: number;
  rc: number;
  rp: number;
  rl: number;
  rd: number;
  issues: string[];
}

/** Register vs TIEP logbook, entry by entry, with the logbook's totals and findings. */
export default function TiepLogbookView() {
  const { lines, lineOf, logbook, findings, settings, loading } = useTiep();
  const [only, setOnly] = useState(true);
  const [q, setQ] = useState("");

  const T = settings?.logbook_totals ?? {};
  const balLiab = num(T.balLiab);
  // The bank guarantee set in TIEP Settings wins over the one the logbook was loaded with.
  const guarantee = settings?.guarantee != null ? num(settings.guarantee) : num(T.guarantee);
  const headroom = settings?.guarantee != null || T.excess == null ? guarantee - balLiab : num(T.excess);

  const regOutD = useMemo(() => lines.filter((r) => r.req !== "No").reduce((a, r) => a + r.osd, 0), [lines]);

  const rows = useMemo<Row[]>(
    () =>
      logbook.map((e) => {
        const ls = e.import_keys
          .map((k) => lineOf.get(lineKey(k.cusdec_no, k.invoice_no, k.item_no)))
          .filter((r): r is TiepLine => !!r);
        const rq = ls.reduce((a, r) => a + r.qty, 0);
        const rc = ls.reduce((a, r) => a + r.cqty, 0);
        const rp = ls.reduce((a, r) => a + r.pqty, 0);
        const rl = ls.reduce((a, r) => a + (r.left || 0), 0);
        const rd = ls.reduce((a, r) => a + r.dsus, 0);
        const issues: string[] = [];
        if (!ls.length) issues.push("not in register");
        else {
          if (Math.abs(rq - num(e.qty)) > 0.01) issues.push("qty");
          if (Math.abs(rc - num(e.used)) > 0.01) issues.push("cancelled");
          if (Math.abs(rd - num(e.liab)) > 2) issues.push("duty");
          if (ls.some((r) => r.pending)) issues.push("details pending");
          if (ls.some((r) => r.status === "Over-planned" || r.status === "Over-cancelled")) issues.push("over-allocated");
        }
        return { e, ls, rq, rc, rp, rl, rd, issues };
      }),
    [logbook, lineOf],
  );

  const diffN = rows.filter((x) => x.issues.length).length;
  const dates = logbook.map((e) => e.cd_date).filter((d): d is string => !!d).sort();
  const range = dates.length ? `${monYear(dates[0])} – ${monYear(dates[dates.length - 1])}` : "";
  const qd = q.trim().replace(/\D/g, "");
  const shown = rows.filter((x) => (!only || x.issues.length) && (!q.trim() || String(x.e.cd).includes(qd)));

  function csv() {
    const out: (string | number | null)[][] = [
      ["CusDec", "Date", "Imp Reg", "Import lines", "Qty (logbook)", "Qty (register)", "Used (logbook)", "Cancelled (register)",
        "Planned (register)", "Balance (logbook)", "Balance (register)", "Liability (logbook)", "Duty excl. VAT (register)", "Check", "Note"],
    ];
    for (const x of shown) {
      const e = x.e;
      out.push([cdLabel(String(e.cd)), e.cd_date, e.reg, x.ls.map((r) => r.id).join(" "), num(e.qty), x.ls.length ? r4(x.rq) : null,
        num(e.used), x.ls.length ? r4(x.rc) : null, x.ls.length ? r4(x.rp) : null, num(e.bal), x.ls.length ? r4(x.rl) : null,
        Math.round(num(e.liab)), x.ls.length ? Math.round(x.rd) : null, x.issues.length ? x.issues.join("; ") : "Agrees", e.note]);
    }
    downloadCsv(`TIEP_Logbook_Check_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(out));
  }

  if (!loading && !logbook.length && !findings.length) {
    return (
      <div className="panel">
        <h2 className="text-[15px] font-semibold m-0">Register vs TIEP logbook</h2>
        <p className="note m-0">
          No logbook data yet. The TIEP logbook (its entry summary, totals and findings) is loaded with the data move from
          the TIEP app; this check then compares it with the register entry by entry.
        </p>
      </div>
    );
  }

  /** A register figure, flagged when it differs from the logbook's. */
  const cmp = (lb: unknown, reg: number, has: boolean) => (
    <td className={"num" + (has && Math.abs(num(lb) - reg) > 0.01 ? " text-bad font-semibold" : "")}>{has ? n2(reg) : "–"}</td>
  );

  return (
    <>
      <Tiles
        items={[
          { k: "Logbook entries", v: nf0.format(rows.length), x: range },
          { k: "Agree with register", v: nf0.format(rows.length - diffN), x: "qty, cancelled and duty match", tone: "a" },
          { k: "Differences", v: nf0.format(diffN), x: "see table below", tone: diffN ? "w" : "" },
          { k: "Logbook balance liability", v: mil(balLiab), x: "LKR " + nf2.format(balLiab), tone: "a" },
          {
            k: "Bank guarantee",
            v: mil(guarantee),
            x: headroom < 0 ? "exceeded by LKR " + nf2.format(-headroom) : "headroom LKR " + nf2.format(headroom),
            tone: headroom < 0 ? "b" : "",
          },
          { k: "Register outstanding duty excl. VAT", v: mil(regOutD), x: "all TIEP lines in the register", tone: "w" },
        ]}
      />

      <div className="panel">
        <h2 className="text-[15px] font-semibold m-0">Register vs TIEP logbook, entry by entry</h2>
        <div className="bar">
          <label className="field">
            Show
            <select className="control" value={only ? "diff" : ""} onChange={(e) => setOnly(e.target.value === "diff")}>
              <option value="diff">Differences only</option>
              <option value="">All logbook entries</option>
            </select>
          </label>
          <label className="field">
            Search CusDec
            <input className="control" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. 28346" />
          </label>
          <span className="flex-1" />
          <span className="note self-center">
            {shown.length} of {rows.length} logbook entries shown
          </span>
          <button className="btn" type="button" onClick={csv}>
            Download CSV
          </button>
        </div>
        <div className="scroll max-h-[70vh]">
          <table className="tbl">
            <thead>
              <tr>
                <th>CusDec</th>
                <th>Date</th>
                <th>Imp Reg</th>
                <th className="num">Qty (logbook)</th>
                <th className="num">Qty (register)</th>
                <th className="num">Used (logbook)</th>
                <th className="num">Cancelled (register)</th>
                <th className="num">Planned (register)</th>
                <th className="num">Balance (logbook)</th>
                <th className="num">Balance (register)</th>
                <th className="num">Liability (logbook)</th>
                <th className="num">Duty excl. VAT (register)</th>
                <th>Check</th>
              </tr>
            </thead>
            <tbody>
              {loading && !logbook.length ? (
                <tr>
                  <td colSpan={13} className="note">
                    Loading…
                  </td>
                </tr>
              ) : !shown.length ? (
                <tr>
                  <td colSpan={13} className="note">
                    {only ? "No differences." : "No entries."}
                  </td>
                </tr>
              ) : (
                shown.map((x) => {
                  const e = x.e;
                  const has = x.ls.length > 0;
                  return (
                    <tr key={e.id}>
                      <td title={has ? "Import line " + x.ls.map((r) => r.id).join(", ") : undefined}>{cdLabel(String(e.cd))}</td>
                      <td>{fdate(e.cd_date)}</td>
                      <td>{e.reg}</td>
                      <td className="num">{n2(num(e.qty))}</td>
                      {cmp(e.qty, x.rq, has)}
                      <td className="num">{n2(num(e.used))}</td>
                      {cmp(e.used, x.rc, has)}
                      <td className="num">{n2(x.rp)}</td>
                      <td className="num">{n2(num(e.bal))}</td>
                      {cmp(e.bal, x.rl, has)}
                      <td className="num">{n0(num(e.liab))}</td>
                      <td className={"num" + (has && Math.abs(x.rd - num(e.liab)) > 2 ? " text-bad font-semibold" : "")}>{has ? n0(x.rd) : "–"}</td>
                      <td className="whitespace-normal min-w-[160px]">
                        {x.issues.length ? (
                          <span className="flex flex-wrap gap-1">
                            {x.issues.map((i) => (
                              <span key={i} className="chip chip-bad">
                                {i}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="chip chip-done">Agrees</span>
                        )}
                        {e.note && <div className="note mt-0.5">{e.note}</div>}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <p className="note m-0">
          Register cancelled = completed cancellations, including the logbook&apos;s export history (shown as Logbook rows in
          the Cancellation Ledger). Register balance = imported − cancelled, before planned quantities. Logbook liability =
          CID + PAL + SSCL (no VAT). A duty difference is flagged above LKR 2.
        </p>
      </div>

      <div className="panel">
        <h2 className="text-[15px] font-semibold m-0">Findings from the logbook upload</h2>
        {findings.length ? (
          findings.map((f) => (
            <div key={f.id}>
              <h3 className="text-[14px] font-semibold mt-1 mb-1.5">{f.area}</h3>
              <ul className="list-disc pl-5 m-0 text-[13px] flex flex-col gap-0.5">
                {f.items.map((i, k) => (
                  <li key={k}>{i}</li>
                ))}
              </ul>
            </div>
          ))
        ) : (
          <p className="note m-0">No findings recorded.</p>
        )}
        <p className="note m-0">
          Source: {T.source || "TIEP logbook"}
          {T.loadedAt ? ", loaded " + fdate(String(T.loadedAt).slice(0, 10)) : ""}. The logbook&apos;s export history is
          read-only (Logbook rows in the Cancellation Ledger); post new cancellations on TIEP Status › Post cancellation as
          usual.
        </p>
      </div>
    </>
  );
}
