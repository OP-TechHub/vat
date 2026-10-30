"use client";

import { useEffect, useMemo, useState } from "react";
import { useApp } from "./AppShell";
import UploadPanel from "./UploadPanel";
import { ClearFilters, FilterRow, useColumnFilters, type ColumnSpec } from "./ColumnFilters";
import { fmt, mLabel, sum } from "@/lib/format";
import { rm } from "@/lib/reports";
import { reloadScheduleLine } from "@/lib/data";
import { LEDGER_AVAILABILITY_LABEL, type LedgerAvailability, type ScheduleLine } from "@/lib/types";

const AVAILABILITY_OPTIONS = Object.keys(LEDGER_AVAILABILITY_LABEL) as LedgerAvailability[];

/** Filter boxes under the column headings, in column order. */
const COLUMNS: ColumnSpec[] = [
  { key: "serial_no", label: "Serial" },
  { key: "invoice_date", label: "Invoice date" },
  { key: "tax_invoice_no", label: "Tax invoice no." },
  { key: "supplier_tin", label: "Supplier TIN" },
  { key: "supplier_name", label: "Supplier" },
  { key: "description", label: "Description" },
  { key: "purchase_value", label: "Value of purchase", num: true, className: "num" },
  { key: "vat_amount", label: "VAT amount", num: true, className: "num" },
  { key: "ledger_invoice_no", label: "Ledger invoice" },
  { key: "ledger_availability", label: "Ledger availability" },
  { key: "ledger_reference", label: "Ledger reference" },
];

export default function ScheduleView() {
  const { supabase, company, months, data, loading, perm, user, patchScheduleLine, flash } = useApp();
  const p = perm("schedule");
  const [month, setMonth] = useState<string>("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const cf = useColumnFilters(COLUMNS);

  // Default to the latest month that has a schedule, else the first month of the year.
  useEffect(() => {
    if (month && months.includes(month)) return;
    const withData = months.filter((k) => data.schedule.some((s) => rm(s) === k));
    setMonth(withData[withData.length - 1] ?? months[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months, data.schedule, company?.id]);

  const k = month || months[0];
  const rows = useMemo(
    () =>
      cf.apply(
        data.schedule.filter((s) => rm(s) === k),
        (r) => ({
          serial_no: r.serial_no,
          invoice_date: r.invoice_date,
          tax_invoice_no: r.tax_invoice_no,
          supplier_tin: r.supplier_tin,
          supplier_name: r.supplier_name,
          description: r.description,
          purchase_value: r.purchase_value,
          vat_amount: r.vat_amount,
          ledger_invoice_no: r.ledger_invoice_no ?? "Not in ledger list",
          ledger_availability: LEDGER_AVAILABILITY_LABEL[r.ledger_availability ?? "none"],
          ledger_reference: r.ledger_reference,
        }),
      ),
    [data.schedule, k, cf.apply],
  );
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
      {p.upload && (
        <UploadPanel
          kind="schedule"
          month={k}
          onMonthChange={setMonth}
          existingCount={countFor}
          canReplace={p.delete}
          onSaved={setMonth}
        />
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
        <ClearFilters state={cf} />
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
            <FilterRow state={cf} />
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
                  {cf.active ? (
                    "No lines match the column filters."
                  ) : (
                    <>
                      No schedule saved for {mLabel(k)}.
                      {p.upload ? " Upload the month’s input schedule above." : ""}
                    </>
                  )}
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
                        {p.edit ? (
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
                        {p.edit ? (
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
