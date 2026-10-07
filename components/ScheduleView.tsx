"use client";

import { useEffect, useMemo, useState } from "react";
import { useApp } from "./AppShell";
import UploadPanel from "./UploadPanel";
import { fmt, mLabel, sum } from "@/lib/format";
import { rm } from "@/lib/reports";
import { reloadScheduleLine } from "@/lib/data";
import { LEDGER_AVAILABILITY_LABEL, type LedgerAvailability, type ScheduleLine } from "@/lib/types";

const AVAILABILITY_OPTIONS = Object.keys(LEDGER_AVAILABILITY_LABEL) as LedgerAvailability[];

export default function ScheduleView() {
  const { supabase, company, months, data, loading, canWrite, user, patchScheduleLine, flash } = useApp();
  const [month, setMonth] = useState<string>("");
  const [busyId, setBusyId] = useState<string | null>(null);

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

  async function update(line: ScheduleLine, patch: Partial<Pick<ScheduleLine, "ledger_availability" | "ledger_reference">>) {
    setBusyId(line.id);
    const { error } = await supabase
      .from("schedule_lines")
      .update({ ...patch, updated_by: user.id, updated_at: new Date().toISOString() })
      .eq("id", line.id);
    if (error) {
      flash("Could not save: " + error.message, true);
      setBusyId(null);
      return;
    }
    try {
      patchScheduleLine(await reloadScheduleLine(supabase, line.id));
      flash(null);
    } catch (e) {
      flash(e instanceof Error ? e.message : "Saved, but the row could not be refreshed.", true);
    }
    setBusyId(null);
  }

  const setAvailability = (line: ScheduleLine, v: string) =>
    update(line, { ledger_availability: AVAILABILITY_OPTIONS.includes(v as LedgerAvailability) ? (v as LedgerAvailability) : "none" });

  const setReference = (line: ScheduleLine, v: string) => {
    const next = v.trim() || null;
    if (next === (line.ledger_reference ?? null)) return;
    return update(line, { ledger_reference: next });
  };

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
              <th>Ledger availability</th>
              <th>Ledger reference</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data.schedule.length ? (
              <tr>
                <td colSpan={11} className="note">
                  Loading records…
                </td>
              </tr>
            ) : !rows.length ? (
              <tr>
                <td colSpan={11} className="note">
                  No schedule saved for {mLabel(k)}.
                  {canWrite ? " Upload the month’s input schedule above." : ""}
                </td>
              </tr>
            ) : (
              <>
                {rows.map((r) => {
                  const busy = busyId === r.id;
                  return (
                    <tr key={r.id} className={busy ? "opacity-60" : undefined}>
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
                      <td>
                        {canWrite ? (
                          <select
                            className="control"
                            value={r.ledger_availability ?? "none"}
                            disabled={busy}
                            aria-label={`Ledger availability for ${r.tax_invoice_no}`}
                            onChange={(e) => setAvailability(r, e.target.value)}
                          >
                            {AVAILABILITY_OPTIONS.map((o) => (
                              <option key={o} value={o}>
                                {LEDGER_AVAILABILITY_LABEL[o]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <AvailabilityText v={r.ledger_availability} />
                        )}
                      </td>
                      <td>
                        {canWrite ? (
                          <ReferenceInput
                            key={r.id + ":" + (r.ledger_reference ?? "")}
                            value={r.ledger_reference ?? ""}
                            disabled={busy}
                            label={`Ledger reference for ${r.tax_invoice_no}`}
                            onCommit={(v) => void setReference(r, v)}
                          />
                        ) : (
                          <span className={r.ledger_reference ? "" : "text-muted"}>{r.ledger_reference ?? "—"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr className="total">
                  <td colSpan={6}>Total</td>
                  <td className="num">{fmt(value)}</td>
                  <td className="num">{fmt(vat)}</td>
                  <td colSpan={3}></td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
      <div className="note">
        A line is matched when its tax invoice number equals a ledger invoice’s external document number, ignoring
        case and spaces. The ledger invoice is then shown as claimed in this return month. Ledger availability and
        ledger reference are entered by hand; availability stays “None” until someone sets it. Both are kept when the
        month’s schedule is uploaded again, matched by tax invoice number.
      </div>
    </>
  );
}

function AvailabilityText({ v }: { v: LedgerAvailability | null }) {
  const key: LedgerAvailability = v ?? "none";
  if (key === "none") return <span className="text-muted">{LEDGER_AVAILABILITY_LABEL.none}</span>;
  return (
    <span className={"pill " + (key === "available" ? "pill-good" : "pill-warn")}>{LEDGER_AVAILABILITY_LABEL[key]}</span>
  );
}

/** Text box that saves on blur or Enter, and restores the saved value on Escape. */
function ReferenceInput({
  value,
  disabled,
  label,
  onCommit,
}: {
  value: string;
  disabled: boolean;
  label: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <input
      className="control min-w-[140px]"
      type="text"
      value={draft}
      disabled={disabled}
      placeholder="Ledger ref."
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(value);
      }}
    />
  );
}
