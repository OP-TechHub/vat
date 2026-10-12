"use client";

import { useEffect, useMemo, useState } from "react";
import { useApp } from "./AppShell";
import UploadPanel from "./UploadPanel";
import { cents, fmt, mLabel, monthKey, sum } from "@/lib/format";
import { reloadExportSale } from "@/lib/data";
import type { CurrencyType, ExportEditable, ExportSale } from "@/lib/types";

/** Sales-report month key of a row. */
const sm = (r: ExportSale) => monthKey(r.sales_month);

/** Exchange difference (1): customs value in LKR less net sales per the sales report. */
export const exchangeDifference = (r: ExportSale): number | null =>
  r.custom_value == null ? null : cents(r.custom_value - r.net_sales);

const CURRENCIES: CurrencyType[] = ["USD", "EUR"];
const COLS = 16;

export default function ExportsView() {
  const { supabase, company, months, data, loading, canWrite, user, patchExportSale, flash } = useApp();
  const [upMonth, setUpMonth] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const countFor = (m: string) => data.exports.filter((r) => sm(r) === m).length;

  // Default the upload month and the view range to the latest month with data, else the first month.
  useEffect(() => {
    const withData = months.filter((k) => data.exports.some((r) => sm(r) === k));
    const latest = withData[withData.length - 1] ?? months[0];
    if (!upMonth || !months.includes(upMonth)) setUpMonth(latest);
    if (!from || !months.includes(from)) setFrom(latest);
    if (!to || !months.includes(to)) setTo(latest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months, data.exports, company?.id]);

  const f = from || months[0];
  const t = to || months[0];
  const lo = f <= t ? f : t;
  const hi = f <= t ? t : f;
  const rangeMonths = useMemo(() => months.filter((k) => k >= lo && k <= hi), [months, lo, hi]);
  const groups = useMemo(
    () =>
      rangeMonths
        .map((k) => ({ month: k, rows: data.exports.filter((r) => sm(r) === k) }))
        .filter((g) => g.rows.length),
    [rangeMonths, data.exports],
  );
  const all = useMemo(() => groups.flatMap((g) => g.rows), [groups]);

  async function update(row: ExportSale, patch: Partial<ExportEditable>) {
    // Customs value follows invoice value x customs rate whenever either of those changes.
    if ("custom_ex_rate" in patch || "custom_invoice_value" in patch) {
      const rate = "custom_ex_rate" in patch ? patch.custom_ex_rate : row.custom_ex_rate;
      const val = "custom_invoice_value" in patch ? patch.custom_invoice_value : row.custom_invoice_value;
      patch.custom_value = rate != null && val != null ? cents(rate * val) : null;
    }
    setBusyId(row.id);
    const { error } = await supabase
      .from("export_sales")
      .update({ ...patch, updated_by: user.id, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) {
      flash("Could not save: " + error.message, true);
      setBusyId(null);
      return;
    }
    try {
      patchExportSale(await reloadExportSale(supabase, row.id));
      flash(null);
    } catch (e) {
      flash(e instanceof Error ? e.message : "Saved, but the row could not be refreshed.", true);
    }
    setBusyId(null);
  }

  const text = (row: ExportSale, field: keyof ExportEditable) => (v: string) => {
    const next = v.trim() || null;
    if (next !== (row[field] ?? null)) void update(row, { [field]: next });
  };
  const numeric = (row: ExportSale, field: keyof ExportEditable, places = 2) => (v: string) => {
    const s = v.replace(/,/g, "").trim();
    const n = s === "" ? null : Number(s);
    if (n != null && isNaN(n)) {
      flash(`“${v}” is not a number.`, true);
      return;
    }
    const p = 10 ** places;
    const next = n == null ? null : Math.round(n * p) / p;
    if (next !== (row[field] ?? null)) void update(row, { [field]: next });
  };

  const Totals = ({ rows, label }: { rows: ExportSale[]; label: string }) => (
    <tr className="total">
      <td colSpan={2}>{label}</td>
      <td className="num">{fmt(sum(rows, (r) => r.amount_fc))}</td>
      <td></td>
      <td className="num">{fmt(sum(rows, (r) => r.net_sales))}</td>
      <td colSpan={6}></td>
      <td className="num">{fmt(sum(rows, (r) => r.custom_value ?? 0))}</td>
      <td className="num">{fmt(sum(rows, (r) => exchangeDifference(r) ?? 0))}</td>
      <td className="num">{fmt(sum(rows, (r) => r.short_shipment ?? 0))}</td>
      <td className="num">{fmt(sum(rows, (r) => r.sales_reversed ?? 0))}</td>
      <td></td>
    </tr>
  );

  return (
    <>
      {canWrite && (
        <UploadPanel
          kind="export"
          month={upMonth || months[0]}
          onMonthChange={setUpMonth}
          existingCount={countFor}
          onSaved={(m) => {
            setFrom(m);
            setTo(m);
          }}
        />
      )}

      <div className="bar">
        <label className="field">
          View from
          <select className="control" value={f} onChange={(e) => setFrom(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {mLabel(m)}
                {countFor(m) ? ` · ${countFor(m)} invoices` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          To
          <select className="control" value={t} onChange={(e) => setTo(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {mLabel(m)}
                {countFor(m) ? ` · ${countFor(m)} invoices` : ""}
              </option>
            ))}
          </select>
        </label>
        <span className="note pb-1.5">
          {all.length} invoices · net sales <span className="font-mono tabular-nums">{fmt(sum(all, (r) => r.net_sales))}</span>
          {" · "}exchange difference{" "}
          <span className="font-mono tabular-nums">{fmt(sum(all, (r) => exchangeDifference(r) ?? 0))}</span>
        </span>
      </div>

      <div className="scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th colSpan={5} className="text-center" style={{ position: "static" }}>
                Details in sales report
              </th>
              <th colSpan={7} className="text-center border-l border-line" style={{ position: "static" }}>
                As per customs
              </th>
              <th colSpan={4} className="text-center border-l border-line" style={{ position: "static" }}>
                Differences
              </th>
            </tr>
            <tr>
              <th>Invoice no</th>
              <th>Month</th>
              <th className="num">Amount FC (FOB) USD / EUR</th>
              <th className="num">Ex. rate</th>
              <th className="num">Net sales (A)</th>
              <th className="border-l border-line">Cusdec no</th>
              <th>Date</th>
              <th>Month</th>
              <th>Currency</th>
              <th className="num">Ex. rate customs LKR</th>
              <th className="num">Invoice value as per USD / EUR</th>
              <th className="num">Customs value</th>
              <th className="num border-l border-line">Exchange difference (1)</th>
              <th className="num">Short shipment (3)</th>
              <th className="num">Sales reversed in the month (4)</th>
              <th>Updated in customs report</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data.exports.length ? (
              <tr>
                <td colSpan={COLS} className="note">
                  Loading records…
                </td>
              </tr>
            ) : !groups.length ? (
              <tr>
                <td colSpan={COLS} className="note">
                  No export sales saved for {lo === hi ? mLabel(lo) : `${mLabel(lo)} to ${mLabel(hi)}`}.
                  {canWrite ? " Upload a month’s export sales report above." : ""}
                </td>
              </tr>
            ) : (
              <>
                {groups.map((g) => (
                  <GroupRows
                    key={g.month}
                    g={g}
                    canWrite={canWrite}
                    busyId={busyId}
                    text={text}
                    numeric={numeric}
                    update={update}
                    Totals={Totals}
                  />
                ))}
                {groups.length > 1 && <Totals rows={all} label="Total" />}
              </>
            )}
          </tbody>
        </table>
      </div>
      <div className="note">
        Net sales and the sales-report columns come from the uploaded export sales report. The customs columns and the
        differences are entered by hand or included in the upload. Customs value is invoice value × customs rate and
        exchange difference (1) is customs value less net sales. Re-uploading a month keeps customs details already
        entered for the same invoice number.
      </div>
    </>
  );
}

function GroupRows({
  g,
  canWrite,
  busyId,
  text,
  numeric,
  update,
  Totals,
}: {
  g: { month: string; rows: ExportSale[] };
  canWrite: boolean;
  busyId: string | null;
  text: (row: ExportSale, field: keyof ExportEditable) => (v: string) => void;
  numeric: (row: ExportSale, field: keyof ExportEditable, places?: number) => (v: string) => void;
  update: (row: ExportSale, patch: Partial<ExportEditable>) => Promise<void>;
  Totals: (p: { rows: ExportSale[]; label: string }) => React.JSX.Element;
}) {
  return (
    <>
      {g.rows.map((r) => {
        const busy = busyId === r.id;
        const diff = exchangeDifference(r);
        const cell = (field: keyof ExportEditable, kind: "text" | "num", places = 2, width = "w-[110px]") => {
          const raw = r[field];
          if (!canWrite)
            return kind === "num" ? fmt(raw as number | null) : <span className={raw ? "" : "text-muted"}>{(raw as string) || "—"}</span>;
          const value = raw == null ? "" : String(raw);
          return (
            <CellInput
              key={r.id + ":" + field + ":" + value}
              value={value}
              kind={kind}
              className={width}
              disabled={busy}
              label={`${field.replace(/_/g, " ")} for ${r.invoice_no}`}
              onCommit={kind === "num" ? numeric(r, field, places) : text(r, field)}
            />
          );
        };
        return (
          <tr key={r.id} className={busy ? "opacity-60" : undefined}>
            <td>{r.invoice_no}</td>
            <td>{mLabel(sm(r))}</td>
            <td className="num">{fmt(r.amount_fc)}</td>
            <td className="num">{r.ex_rate == null ? "" : String(r.ex_rate)}</td>
            <td className="num">{fmt(r.net_sales)}</td>
            <td className="border-l border-line">{cell("cusdec_no", "text", 0, "w-[90px]")}</td>
            <td>{cell("cusdec_date", "text", 0, "w-[100px]")}</td>
            <td>{cell("cusdec_month", "text", 0, "w-[90px]")}</td>
            <td>
              {canWrite ? (
                <select
                  className="control"
                  value={r.currency_type}
                  disabled={busy}
                  aria-label={`Currency type for ${r.invoice_no}`}
                  onChange={(e) => void update(r, { currency_type: e.target.value as CurrencyType })}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              ) : (
                r.currency_type
              )}
            </td>
            <td className="num">{cell("custom_ex_rate", "num", 6, "w-[100px]")}</td>
            <td className="num">{cell("custom_invoice_value", "num")}</td>
            <td className="num">{cell("custom_value", "num", 2, "w-[130px]")}</td>
            <td className={"num border-l border-line" + (diff != null && diff !== 0 ? "" : " text-muted")}>
              {diff == null ? "" : fmt(diff)}
            </td>
            <td className="num">{cell("short_shipment", "num")}</td>
            <td className="num">{cell("sales_reversed", "num")}</td>
            <td>{cell("updated_in_custom_report", "text", 0, "w-[120px]")}</td>
          </tr>
        );
      })}
      <Totals rows={g.rows} label={mLabel(g.month)} />
    </>
  );
}

/** Text or number box that saves on blur or Enter and restores the saved value on Escape. */
function CellInput({
  value,
  kind,
  className,
  disabled,
  label,
  onCommit,
}: {
  value: string;
  kind: "text" | "num";
  className?: string;
  disabled: boolean;
  label: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <input
      className={"control " + (kind === "num" ? "text-right font-mono tabular-nums " : "") + (className ?? "")}
      type="text"
      inputMode={kind === "num" ? "decimal" : undefined}
      value={draft}
      disabled={disabled}
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
