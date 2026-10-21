"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useApp } from "./AppShell";
import { DocActions, DocHeading } from "./DocActions";
import { fmt, mLabel, monthKey, monthsBetween, periodCode, sum } from "@/lib/format";
import { loadIrdStatus, type IrdStatusData } from "@/lib/data";
import { DOC_ACCEPT, documentUrl, isMissingTable, removeDocument, uploadDocument } from "@/lib/documents";
import { IRD_STATUS_LABEL, type IrdStatus, type IrdStatusValue, type ReturnDocument } from "@/lib/types";

/** First taxable period shown. */
const FIRST_PERIOD = "2020-01";
const STATUSES = Object.keys(IRD_STATUS_LABEL) as IrdStatusValue[];
type Filter = "" | "data" | IrdStatusValue | "unset";

interface PeriodRow {
  month: string; // YYYY-MM
  hasData: boolean;
  deferred: number | null; // cage 4
  refund: number | null; // cage 15
  netRefund: number | null; // refund due less credits and tax payable, i.e. -(cage 18)
  inputLessPaid: number | null; // 5 + 6 - 8 - 8A - Q
  status: IrdStatusValue | null;
  voucherDate: string | null;
  voucherValue: number | null;
  voucher: ReturnDocument | null;
}

/** Number -> "1,234,567.89" for the value box; "" for null. */
const fmtIn = (n: number | null | undefined) => (n == null ? "" : Number(n).toLocaleString("en-LK", { maximumFractionDigits: 2 }));

export default function IrdStatusView() {
  const { supabase, company, user, canWrite, flash } = useApp();
  const [data, setData] = useState<IrdStatusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // month while a row is saving
  const fileRef = useRef<HTMLInputElement>(null);
  const target = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!company) {
      setData({ returns: [], statuses: [], vouchers: [] });
      return;
    }
    try {
      setData(await loadIrdStatus(supabase, company.id));
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not load the IRD status register.";
      setError(isMissingTable(e) ? `${msg}. Run supabase/migrations/0007_ird_status.sql in the Supabase SQL Editor.` : msg);
      setData({ returns: [], statuses: [], vouchers: [] });
    }
  }, [supabase, company]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  // Every period from Jan 2020 to the current month or the latest with data, newest first.
  const rows = useMemo<PeriodRow[]>(() => {
    if (!data) return [];
    const today = new Date().toISOString().slice(0, 7);
    const latest = [today, ...data.returns.map((r) => monthKey(r.return_month))].sort().pop()!;
    const by: Record<string, PeriodRow> = {};
    for (const k of monthsBetween(FIRST_PERIOD, latest))
      by[k] = { month: k, hasData: false, deferred: null, refund: null, netRefund: null, inputLessPaid: null, status: null, voucherDate: null, voucherValue: null, voucher: null };
    for (const r of data.returns) {
      const row = by[monthKey(r.return_month)];
      if (!row) continue;
      row.hasData = true;
      row.deferred = +(r.imports_deferred ?? 0) || 0;
      row.refund = +(r.gross_refund ?? 0) || 0;
      row.netRefund = -(+(r.net_refund_payable ?? 0) || 0);
      const n = (v: number | null | undefined) => +(v ?? 0) || 0;
      row.inputLessPaid = n(r.imports_upfront) + n(r.local_tax) - n(r.disallowed) - n(r.disallowed_suspended) - n(r.monthly_payments);
    }
    for (const s of data.statuses) {
      const row = by[monthKey(s.return_month)];
      if (!row) continue;
      row.status = s.status;
      row.voucherDate = s.voucher_date;
      row.voucherValue = s.voucher_value;
    }
    for (const d of data.vouchers) {
      const row = by[monthKey(d.return_month)];
      if (row) row.voucher = d;
    }
    return Object.values(by).reverse();
  }, [data]);

  const periodKeys = useMemo(() => rows.map((r) => r.month).reverse(), [rows]);
  const shown = useMemo(() => {
    const lo = from && to && from > to ? to : from;
    const hi = from && to && from > to ? from : to;
    let r = rows;
    if (lo) r = r.filter((x) => x.month >= lo);
    if (hi) r = r.filter((x) => x.month <= hi);
    if (filter === "data") r = r.filter((x) => x.hasData);
    else if (filter === "unset") r = r.filter((x) => x.hasData && !x.status);
    else if (filter) r = r.filter((x) => x.status === filter);
    return r;
  }, [rows, filter, from, to]);

  async function save(row: PeriodRow, patch: Partial<Pick<IrdStatus, "status" | "voucher_date" | "voucher_value">>) {
    if (!company) return;
    setBusy(row.month);
    const upsert: IrdStatus = {
      company_id: company.id,
      return_month: row.month + "-01",
      status: row.status,
      voucher_date: row.voucherDate,
      voucher_value: row.voucherValue,
      ...patch,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };
    const { error: err } = await supabase.from("ird_status").upsert(upsert, { onConflict: "company_id,return_month" });
    if (err) flash("Could not save: " + err.message, true);
    else {
      flash(null);
      await load();
    }
    setBusy(null);
  }

  const setValue = (row: PeriodRow, text: string) => {
    const t = text.replace(/,/g, "").trim();
    const n = t === "" ? null : Number(t);
    if (n != null && isNaN(n)) {
      flash(`“${text}” is not a number.`, true);
      return;
    }
    const next = n == null ? null : Math.round(n * 100) / 100;
    if (next !== row.voucherValue) void save(row, { voucher_value: next });
  };

  function pick(month: string) {
    target.current = month;
    fileRef.current?.click();
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const month = target.current;
    e.target.value = "";
    if (!file || !month || !company) return;
    setBusy(month);
    try {
      await uploadDocument(supabase, company.id, user.id, month, "credit_voucher", file, rows.find((r) => r.month === month)?.voucher);
      flash(`Credit voucher for ${mLabel(month)} uploaded.`);
      await load();
    } catch (err) {
      flash("Could not upload: " + (err instanceof Error ? err.message : String(err)), true);
    }
    setBusy(null);
  }

  async function open(doc: ReturnDocument) {
    try {
      window.open(await documentUrl(supabase, doc), "_blank", "noopener");
    } catch (err) {
      flash("Could not open the file: " + (err instanceof Error ? err.message : String(err)), true);
    }
  }

  async function remove(row: PeriodRow) {
    if (!row.voucher) return;
    if (!window.confirm(`Remove the credit voucher for ${mLabel(row.month)} (${row.voucher.filename})?`)) return;
    setBusy(row.month);
    try {
      await removeDocument(supabase, row.voucher);
      flash(`Credit voucher for ${mLabel(row.month)} removed.`);
      await load();
    } catch (err) {
      flash("Could not remove: " + (err instanceof Error ? err.message : String(err)), true);
    }
    setBusy(null);
  }

  const withData = shown.filter((r) => r.hasData);
  const StatusPill = ({ s }: { s: IrdStatusValue | null }) =>
    s ? (
      <span className={"pill " + (s === "received" ? "pill-good" : s === "pending" ? "pill-warn" : "pill-info")}>{IRD_STATUS_LABEL[s]}</span>
    ) : (
      <span className="text-muted">—</span>
    );

  return (
    <>
      <input ref={fileRef} type="file" accept={DOC_ACCEPT} className="hidden" onChange={(e) => void onFile(e)} />

      <div className="bar">
        <label className="field">
          Taxable period from
          <select className="control" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">{mLabel(FIRST_PERIOD)} (first)</option>
            {periodKeys.map((m) => (
              <option key={m} value={m}>
                {mLabel(m)} · {periodCode(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          To
          <select className="control" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Latest</option>
            {periodKeys.map((m) => (
              <option key={m} value={m}>
                {mLabel(m)} · {periodCode(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Show
          <select className="control" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="">All periods</option>
            <option value="data">Periods with return data</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {IRD_STATUS_LABEL[s]}
              </option>
            ))}
            <option value="unset">Status not set</option>
          </select>
        </label>
        {(from || to) && (
          <button
            className="btn"
            type="button"
            onClick={() => {
              setFrom("");
              setTo("");
            }}
          >
            Clear range
          </button>
        )}
        {data && (
          <span className="note pb-1.5">
            {shown.length === rows.length ? `${rows.length} periods` : `${shown.length} of ${rows.length} periods`} · received{" "}
            {rows.filter((r) => r.status === "received").length} · pending {rows.filter((r) => r.status === "pending").length} · under
            submission {rows.filter((r) => r.status === "submission").length}
          </span>
        )}
      </div>

      {error && <div className="msg msg-err">{error}</div>}

      <div className="scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Period code</th>
              <th>Taxable period</th>
              <th className="num">Deferred import VAT (4)</th>
              <th className="num">Refund due (15)</th>
              <th className="num">Net refund (18)</th>
              <th className="num">Input tax less tax paid (5+6−8−8A−Q)</th>
              <th>Status</th>
              <th>Date of credit voucher</th>
              <th className="num">Value of credit voucher</th>
              <DocHeading title="Credit voucher" canWrite={canWrite} />
            </tr>
          </thead>
          <tbody>
            {!data ? (
              <tr>
                <td colSpan={10} className="note">
                  Loading records…
                </td>
              </tr>
            ) : !shown.length ? (
              <tr>
                <td colSpan={10} className="note">
                  No periods match.
                </td>
              </tr>
            ) : (
              <>
                {shown.map((r) => {
                  const isBusy = busy === r.month;
                  const received = r.status === "received";
                  return (
                    <tr key={r.month} className={isBusy ? "opacity-60" : undefined}>
                      <td className="font-mono">{periodCode(r.month)}</td>
                      <td>{mLabel(r.month)}</td>
                      <td className={"num" + (r.hasData ? "" : " text-muted")}>{r.hasData ? fmt(r.deferred) : "no return data"}</td>
                      <td className="num">{r.hasData ? fmt(r.refund) : ""}</td>
                      <td className={"num" + (r.netRefund != null && r.netRefund < 0 ? " diffx" : "")}>{r.hasData ? fmt(r.netRefund) : ""}</td>
                      <td className={"num" + (r.inputLessPaid != null && r.inputLessPaid < 0 ? " diffx" : "")}>
                        {r.hasData ? fmt(r.inputLessPaid) : ""}
                      </td>
                      <td>
                        {canWrite ? (
                          <select
                            className="control"
                            value={r.status ?? ""}
                            disabled={isBusy}
                            aria-label={`Status for ${mLabel(r.month)}`}
                            onChange={(e) => void save(r, { status: (e.target.value || null) as IrdStatusValue | null })}
                          >
                            <option value="">Not set</option>
                            {STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {IRD_STATUS_LABEL[s]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <StatusPill s={r.status} />
                        )}
                      </td>
                      <td>
                        {canWrite && received ? (
                          <input
                            className="control"
                            type="date"
                            value={r.voucherDate ?? ""}
                            disabled={isBusy}
                            aria-label={`Credit voucher date for ${mLabel(r.month)}`}
                            onChange={(e) => void save(r, { voucher_date: e.target.value || null })}
                          />
                        ) : (
                          <span className={r.voucherDate ? "" : "text-muted"}>{r.voucherDate ?? "—"}</span>
                        )}
                      </td>
                      <td className="num">
                        {canWrite && received ? (
                          <ValueInput
                            key={r.month + ":" + (r.voucherValue ?? "")}
                            value={fmtIn(r.voucherValue)}
                            disabled={isBusy}
                            label={`Credit voucher value for ${mLabel(r.month)}`}
                            onCommit={(v) => setValue(r, v)}
                          />
                        ) : (
                          fmt(r.voucherValue)
                        )}
                      </td>
                      <td>
                        <DocActions
                          doc={r.voucher}
                          canWrite={canWrite && (received || !!r.voucher)}
                          busy={isBusy}
                          yes="Attached"
                          no={received ? "Not attached" : "—"}
                          pillClass={received ? "pill-warn" : "pill-info"}
                          onOpen={(d) => void open(d)}
                          onPick={() => pick(r.month)}
                          onRemove={() => void remove(r)}
                        />
                      </td>
                    </tr>
                  );
                })}
                <tr className="total">
                  <td colSpan={2}>Total ({withData.length} periods with return data)</td>
                  <td className="num">{fmt(sum(withData, (r) => r.deferred ?? 0))}</td>
                  <td className="num">{fmt(sum(withData, (r) => r.refund ?? 0))}</td>
                  <td className="num">{fmt(sum(withData, (r) => r.netRefund ?? 0))}</td>
                  <td className="num">{fmt(sum(withData, (r) => r.inputLessPaid ?? 0))}</td>
                  <td colSpan={2}></td>
                  <td className="num">{fmt(sum(shown, (r) => r.voucherValue ?? 0))}</td>
                  <td></td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
      <div className="note">
        Deferred import VAT is cage 4, refund due is cage 15 and net refund is cage 18 (refund due less credits and tax
        payable, shown positive when a refund is due and highlighted when tax is payable) of the period’s return, as held on the VAT
        reconciliation tab. Input tax less tax paid is upfront import tax (5) plus tax on local purchases (6), less disallowed
        input tax on imports and other purchases (8) and on suspended purchases (8A), less monthly payments (Q), highlighted when
        negative. Status, voucher date and value are entered here; the date, value and attachment open
        once the status is “Credit voucher received”. Vouchers are kept with the returns in the vat-claims bucket.
      </div>
    </>
  );
}

/** Value box that saves on blur or Enter and restores the saved value on Escape. */
function ValueInput({
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
      className="control text-right font-mono tabular-nums w-[140px]"
      type="text"
      inputMode="decimal"
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
