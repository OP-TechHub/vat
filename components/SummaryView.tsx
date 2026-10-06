"use client";

import { useMemo } from "react";
import { useApp } from "./AppShell";
import { fmt, mLabel, mShort } from "@/lib/format";
import { matrix, monthWise, returnVsLedger, tiles, type MonthRow, type ReturnRow } from "@/lib/reports";

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <b className="value">{value}</b>
      <div className="note">{sub}</div>
    </div>
  );
}

export default function SummaryView() {
  const { months, data, yearInvoices, loading, canWrite } = useApp();

  const t = useMemo(() => tiles(yearInvoices), [yearInvoices]);
  const mw = useMemo(() => monthWise(yearInvoices, months), [yearInvoices, months]);
  const rv = useMemo(
    () => returnVsLedger(yearInvoices, data.invoices, data.schedule, data.returns, months),
    [yearInvoices, data.invoices, data.schedule, data.returns, months],
  );
  const mx = useMemo(() => matrix(yearInvoices, months), [yearInvoices, months]);

  if (loading && !data.invoices.length) return <div className="panel note">Loading records…</div>;
  if (!yearInvoices.length && !data.schedule.length && !data.returns.length)
    return (
      <div className="panel note">
        No records for this tax year yet.
        {canWrite ? " Start by uploading a month’s ledger invoice list on the Invoice listing tab." : ""}
      </div>
    );

  const MonthTr = ({ r, total }: { r: MonthRow; total?: boolean }) => (
    <tr className={total ? "total" : undefined}>
      <td>{total ? "Total" : mLabel(r.month)}</td>
      <td className="num">{r.invoices}</td>
      <td className="num">{fmt(r.total)}</td>
      <td className="num">{r.claimedCount}</td>
      <td className="num">{fmt(r.claimedAmount)}</td>
      <td className="num">{r.unclaimedCount}</td>
      <td className="num">{fmt(r.unclaimedAmount)}</td>
      <td className="num">{r.originalHeld}</td>
    </tr>
  );
  const ReturnTr = ({ r, total }: { r: ReturnRow; total?: boolean }) => (
    <tr className={total ? "total" : undefined}>
      <td>{total ? "Total" : mLabel(r.month)}</td>
      <td className="num">{r.lines}</td>
      <td className="num">{fmt(r.scheduleVat)}</td>
      <td className="num">{r.localTax == null ? <span className="diff0">not entered</span> : fmt(r.localTax)}</td>
      <td className="num">{fmt(r.ledgerPosted)}</td>
      <td className="num">{fmt(r.claimedFromLedger)}</td>
      <td className="num">{fmt(r.notInLedger)}</td>
    </tr>
  );

  return (
    <>
      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(190px,1fr))]">
        <Stat label="Ledger input VAT" value={fmt(t.total.amount)} sub={`${t.total.count} invoices`} />
        <Stat label="Claimed" value={fmt(t.claimed.amount)} sub={`${t.claimed.count} invoices`} />
        <Stat label="Not claimed" value={fmt(t.notClaimed.amount)} sub={`${t.notClaimed.count} invoices`} />
        <Stat
          label="Unclaimed, original held"
          value={fmt(t.originalHeld.amount)}
          sub={`${t.originalHeld.count} ready to claim`}
        />
      </div>

      <div className="panel">
        <h2 className="text-[15px] font-semibold m-0">Month-wise summary by posting date</h2>
        <div className="scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Month</th>
                <th className="num">Invoices</th>
                <th className="num">Total input VAT</th>
                <th className="num">Claimed inv.</th>
                <th className="num">Claimed amount</th>
                <th className="num">Unclaimed inv.</th>
                <th className="num">Unclaimed amount</th>
                <th className="num">Original held</th>
              </tr>
            </thead>
            <tbody>
              {mw.rows.map((r) => (
                <MonthTr key={r.month} r={r} />
              ))}
              <MonthTr r={mw.total} total />
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h2 className="text-[15px] font-semibold m-0">VAT return against ledger</h2>
        <div className="note">
          VAT return is the input schedule total for the return month. Claimed from ledger is the ledger value of
          invoices matched to that month’s schedule.
        </div>
        <div className="scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Return month</th>
                <th className="num">Schedule lines</th>
                <th className="num">VAT return (schedule)</th>
                <th className="num">Local purchases tax per return</th>
                <th className="num">Ledger balance posted</th>
                <th className="num">Claimed from ledger</th>
                <th className="num">Schedule not in ledger</th>
              </tr>
            </thead>
            <tbody>
              {rv.rows.map((r) => (
                <ReturnTr key={r.month} r={r} />
              ))}
              <ReturnTr r={rv.total} total />
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h2 className="text-[15px] font-semibold m-0">Posting month by claimed month</h2>
        <div className="scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Posting month</th>
                {mx.columns.map((c) => (
                  <th key={c} className="num">
                    Claimed {mShort(c)}
                  </th>
                ))}
                <th className="num">Not claimed</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {[...mx.rows, mx.total].map((r, i) => {
                const total = i === mx.rows.length;
                return (
                  <tr key={r.month} className={total ? "total" : undefined}>
                    <td>{total ? "Total" : mLabel(r.month)}</td>
                    {mx.columns.map((c) => (
                      <td key={c} className="num">
                        {r.byClaimMonth[c] || total ? fmt(r.byClaimMonth[c]) : ""}
                      </td>
                    ))}
                    <td className="num">{fmt(r.notClaimed)}</td>
                    <td className="num">{fmt(r.total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
