"use client";

import { useEffect, useMemo, useState } from "react";
import { useApp } from "./AppShell";
import UploadPanel from "./UploadPanel";
import { fmt, mLabel, sum } from "@/lib/format";
import { rm } from "@/lib/reports";

export default function ScheduleView() {
  const { company, months, data, loading, canWrite } = useApp();
  const [month, setMonth] = useState<string>("");

  // Default to the latest month that has a schedule, else the first month of the year.
  useEffect(() => {
    if (month && months.includes(month)) return;
    const withData = months.filter((k) => data.schedule.some((s) => rm(s) === k));
    setMonth(withData[withData.length - 1] ?? months[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months, data.schedule, company?.id]);

  const k = month || months[0];
  const rows = useMemo(() => data.schedule.filter((s) => rm(s) === k), [data.schedule, k]);
  const matched = rows.filter((r) => r.ledger_invoice_no).length;
  const value = sum(rows, (r) => r.purchase_value);
  const vat = sum(rows, (r) => r.vat_amount);
  const countFor = (m: string) => data.schedule.filter((s) => rm(s) === m).length;

  return (
    <>
      {canWrite && (
        <UploadPanel kind="schedule" month={k} onMonthChange={setMonth} existingCount={countFor} onSaved={setMonth} />
      )}

      <div className="bar">
        <label className="field">
          Return month
          <select className="control" value={k} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {mLabel(m)}
                {countFor(m) ? ` · ${countFor(m)} lines` : ""}
              </option>
            ))}
          </select>
        </label>
        <span className="note pb-1.5">
          {rows.length} lines · purchases <span className="font-mono tabular-nums">{fmt(value)}</span> · VAT{" "}
          <span className="font-mono tabular-nums">{fmt(vat)}</span> · {matched} matched to ledger invoices
        </span>
      </div>

      <div className="scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Serial</th>
              <th>Invoice date</th>
              <th>Tax invoice no.</th>
              <th>Supplier TIN</th>
              <th>Supplier</th>
              <th>Description</th>
              <th className="num">Value of purchase</th>
              <th className="num">VAT amount</th>
              <th>Ledger invoice</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data.schedule.length ? (
              <tr>
                <td colSpan={9} className="note">
                  Loading records…
                </td>
              </tr>
            ) : !rows.length ? (
              <tr>
                <td colSpan={9} className="note">
                  No schedule saved for {mLabel(k)}.
                  {canWrite ? " Upload the month’s input schedule above." : ""}
                </td>
              </tr>
            ) : (
              <>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.serial_no}</td>
                    <td>{r.invoice_date}</td>
                    <td>{r.tax_invoice_no}</td>
                    <td>{r.supplier_tin}</td>
                    <td className="wrapc">{r.supplier_name}</td>
                    <td className="wrapc">{r.description}</td>
                    <td className="num">{fmt(r.purchase_value)}</td>
                    <td className="num">{fmt(r.vat_amount)}</td>
                    <td>
                      {r.ledger_invoice_no ? (
                        <span className="pill pill-good">{r.ledger_invoice_no}</span>
                      ) : (
                        <span className="pill pill-info">Not in ledger list</span>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="total">
                  <td colSpan={6}>Total</td>
                  <td className="num">{fmt(value)}</td>
                  <td className="num">{fmt(vat)}</td>
                  <td></td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
      <div className="note">
        A line is matched when its tax invoice number equals a ledger invoice’s external document number, ignoring
        case and spaces. The ledger invoice is then shown as claimed in this return month.
      </div>
    </>
  );
}
