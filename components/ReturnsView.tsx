"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useApp } from "./AppShell";
import ReturnDataUpload from "./ReturnDataUpload";
import ReturnDocuments from "./ReturnDocuments";
import { fmt0, mLabel, monthStart, taxYearOf } from "@/lib/format";
import { RETURN_FIELDS, RETURN_FIELD_IDS, agreed, retCalc, rm, type ReturnCalc } from "@/lib/reports";
import type { ReturnField, VatReturn } from "@/lib/types";

type FormValues = Record<ReturnField, string>;

/** Number -> text with thousands separators for the form ("1,386,009" or "1,234.5"). */
const fmtIn = (n: number | null | undefined): string =>
  n == null || isNaN(Number(n)) ? "" : Number(n).toLocaleString("en-LK", { maximumFractionDigits: 2 });
/** Text with separators -> number; null when it is not a number. */
const parseIn = (s: string): number | null => {
  const t = s.replace(/,/g, "").trim();
  if (t === "") return 0;
  const n = Number(t);
  return isNaN(n) ? null : n;
};

const blank = (): FormValues => Object.fromEntries(RETURN_FIELD_IDS.map((id) => [id, ""])) as FormValues;
const fromReturn = (r: VatReturn | undefined): FormValues =>
  r ? (Object.fromEntries(RETURN_FIELD_IDS.map((id) => [id, fmtIn(r[id])])) as FormValues) : blank();

export default function ReturnsView() {
  const { supabase, company, user, months, data, loading, canWrite, patchReturn, setYear, flash } = useApp();
  const [month, setMonth] = useState("");
  const [form, setForm] = useState<FormValues>(blank());
  const [submittedOn, setSubmittedOn] = useState("");
  const [saving, setSaving] = useState(false);

  // Default to the latest month with a saved return, else the first month of the year.
  useEffect(() => {
    if (month && months.includes(month)) return;
    const withData = months.filter((k) => data.returns.some((r) => rm(r) === k));
    setMonth(withData[withData.length - 1] ?? months[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months, data.returns, company?.id]);

  const k = month || months[0];
  const current = useMemo(() => data.returns.find((r) => rm(r) === k), [data.returns, k]);

  // Reset the form whenever the selected month's saved return changes.
  useEffect(() => {
    setForm(fromReturn(current));
    setSubmittedOn(current?.submitted_on ?? "");
  }, [current, k]);

  const have = useMemo(() => months.filter((m) => data.returns.some((r) => rm(r) === m)), [months, data.returns]);
  const calc = useMemo(() => {
    const out: Record<string, { r: VatReturn; c: ReturnCalc }> = {};
    for (const m of have) {
      const r = data.returns.find((x) => rm(x) === m)!;
      out[m] = { r, c: retCalc(r, data.schedule, data.invoices, data.exports, data.importEntries) };
    }
    return out;
  }, [have, data.returns, data.schedule, data.invoices, data.exports, data.importEntries]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!company) return;
    const values: Partial<Record<ReturnField, number>> = {};
    for (const id of RETURN_FIELD_IDS) {
      const n = parseIn(form[id]);
      if (n == null) {
        flash(`“${form[id]}” is not a number.`, true);
        return;
      }
      values[id] = n;
    }
    setSaving(true);
    const row = {
      company_id: company.id,
      return_month: monthStart(k),
      ...values,
      submitted_on: submittedOn || null,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };
    const { data: saved, error } = await supabase
      .from("vat_returns")
      .upsert(row, { onConflict: "company_id,return_month" })
      .select()
      .single();
    setSaving(false);
    if (error) {
      flash(
        "Could not save: " +
          error.message +
          (/schema cache|column/i.test(error.message)
            ? ". Run supabase/migrations/0006_return_cages.sql in the Supabase SQL Editor first."
            : ""),
        true,
      );
      return;
    }
    patchReturn(saved as VatReturn);
    flash(`Saved the ${mLabel(k)} return.`);
  }

  const Sec = ({ label }: { label: string }) => (
    <tr>
      <td colSpan={have.length + 1} className="text-[11px] uppercase tracking-[0.05em] text-muted font-semibold pt-3">
        {label}
      </td>
    </tr>
  );
  const Line = ({
    label,
    f,
    kind,
    show = fmt0,
  }: {
    label: string;
    f: (m: string) => number | null;
    kind?: "t" | "d";
    show?: (v: number) => string;
  }) => (
    <tr className={kind === "t" ? "total" : undefined}>
      <td className="whitespace-normal min-w-[260px]">{label}</td>
      {have.map((m) => {
        const v = f(m);
        return (
          <td key={m} className={"num" + (kind === "d" && v != null ? (agreed(v) ? " diff0" : " diffx") : "")}>
            {v == null ? "" : show(v)}
          </td>
        );
      })}
    </tr>
  );
  const raw = (id: ReturnField) => (m: string) => +(calc[m].r[id] ?? 0) || 0;
  const c = (g: (x: ReturnCalc) => number | null) => (m: string) => g(calc[m].c);
  const pct = (v: number) => (v * 100).toFixed(1) + "%";

  return (
    <>
      {canWrite && (
        <ReturnDataUpload
          onSaved={(ms) => {
            // Show the latest period that was loaded; switch tax year if it lies outside the current one.
            const last = ms[ms.length - 1];
            if (last) {
              if (!months.includes(last)) setYear(taxYearOf(last));
              setMonth(last);
            }
          }}
        />
      )}

      <div className="grid gap-4 items-start grid-cols-1 md:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <form className="panel" onSubmit={save}>
          <h2 className="text-[15px] font-semibold m-0">Return details</h2>
          <div className="bar">
            <label className="field">
              Return month
              <select className="control" value={k} onChange={(e) => setMonth(e.target.value)}>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {mLabel(m)}
                    {data.returns.some((r) => rm(r) === m) ? " · entered" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Submitted on (per IRD acknowledgement)
              <input
                className="control"
                type="date"
                value={submittedOn}
                disabled={!canWrite}
                onChange={(e) => setSubmittedOn(e.target.value)}
              />
            </label>
          </div>

          <ReturnDocuments month={k} />

          <div className="note">Figures in rupees, shown with thousands separators.</div>
          <div className="grid grid-cols-[minmax(0,1fr)_150px] gap-x-2.5 gap-y-1.5 items-center">
            {RETURN_FIELDS.map(([id, label], i) =>
              id === "sec" ? (
                <div
                  key={"sec" + i}
                  className="col-span-2 text-[11px] uppercase tracking-[0.05em] text-muted font-semibold mt-2"
                >
                  {label}
                </div>
              ) : (
                <label key={id} htmlFor={"r_" + id} className="contents">
                  <span className="text-[13px]">{label}</span>
                  <input
                    id={"r_" + id}
                    className="control text-right font-mono tabular-nums"
                    type="text"
                    inputMode="decimal"
                    value={form[id]}
                    disabled={!canWrite}
                    onChange={(e) => setForm({ ...form, [id]: e.target.value })}
                    onBlur={(e) => {
                      const n = parseIn(e.target.value);
                      if (n != null) setForm((f) => ({ ...f, [id]: e.target.value.trim() === "" ? "" : fmtIn(n) }));
                    }}
                  />
                </label>
              ),
            )}
          </div>
          {canWrite ? (
            <div className="bar">
              <button className="btn btn-primary" type="submit" disabled={saving || !company}>
                {saving ? "Saving…" : `Save ${mLabel(k)} return`}
              </button>
            </div>
          ) : (
            <div className="note">You have view-only access to this company.</div>
          )}
        </form>

        <div className="panel">
          <h2 className="text-[15px] font-semibold m-0">Reconciliation by return month</h2>
          {loading && !data.returns.length ? (
            <div className="note">Loading records…</div>
          ) : !have.length ? (
            <div className="note">
              No return saved yet for this tax year.{canWrite ? " Enter the figures on the left and save." : ""}
            </div>
          ) : (
            <div className="scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Line</th>
                    {have.map((m) => (
                      <th key={m} className="num">
                        {mLabel(m)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <Sec label="Output tax and supplies" />
                  <Line label="Taxable supplies, value (A)" f={raw("taxable_value")} />
                  <Line label="Taxable supplies, tax (0)" f={raw("taxable_tax")} />
                  <Line label="Wholesale and retail taxable supplies (B / 2)" f={raw("wholesale_retail")} />
                  <Line label="VAT suspended taxable supplies (C / 2A)" f={raw("suspended_supplies")} />
                  <Line label="Total output tax (3)" f={raw("output_tax")} kind="t" />
                  <Line label="Zero rated supplies, goods (D)" f={raw("zero_rated")} />
                  <Line label="Zero rated supplies, services (D1)" f={raw("zero_rated_services")} />
                  <Line label="Exempt supplies (E)" f={raw("exempt")} />
                  <Line label="Excluded supplies (E1)" f={raw("excluded_supplies")} />

                  <Sec label="Input tax" />
                  <Line label="Imports, value (H)" f={raw("imports_value")} />
                  <Line label="Imports, deferred tax (4)" f={raw("imports_deferred")} />
                  <Line label="Imports, upfront tax (5)" f={raw("imports_upfront")} />
                  <Line label="Local purchases, value (I)" f={raw("local_value")} />
                  <Line label="Local purchases, tax (6)" f={raw("local_tax")} />
                  <Line label="Total input tax (4+5+6) (7)" f={c((x) => x.t7)} kind="t" />
                  <Line label="VAT suspended purchases, value (J)" f={raw("suspended_purchases_value")} />
                  <Line label="VAT suspended purchases, suspended tax (K)" f={raw("suspended_purchases_tax")} />
                  <Line label="Imports on which VAT is not charged (J2)" f={raw("imports_no_vat")} />
                  <Line label="Disallowable input tax on imports, other purchases and adjustment (8)" f={raw("disallowed")} />
                  <Line label="Disallowable input tax on suspended purchases (8A)" f={raw("disallowed_suspended")} />
                  <Line label="Allowable input tax excluding b/f amounts (7−8) (9)" f={c((x) => x.t9)} kind="t" />
                  <Line label="Brought forward input tax (10)" f={raw("brought_forward")} />
                  <Line label="Input tax available (9+10)" f={c((x) => x.avail)} kind="t" />

                  <Sec label="Allowable input tax and tax payable / refundable" />
                  <Line label="Zero rated, suspended, wholesale & retail, s.22(7) (11)" f={raw("allowable_zero_rated")} />
                  <Line label="Not belonging to group A (12)" f={raw("not_group_a")} />
                  <Line label="Allowable input tax (11+12) (13)" f={c((x) => x.t13)} kind="t" />
                  <Line label="Unabsorbed excess input tax c/f (9+10−13) (14)" f={c((x) => x.t14)} kind="t" />
                  <Line label="Gross refund due (15)" f={raw("gross_refund")} />
                  <Line label="Tax payable (16)" f={raw("tax_payable")} />
                  <Line label="Monthly payments (Q)" f={raw("monthly_payments")} />
                  <Line label="Tax credit based on SVAT credit voucher (R2)" f={raw("svat_credit")} />
                  <Line label="Total credits (17)" f={raw("total_credits")} />
                  <Line label="(Refund due) / tax payable (16−17−15) (18)" f={raw("net_refund_payable")} kind="t" />

                  <Sec label="Arithmetic checks on the return (should be nil)" />
                  <Line label="Cage 15 less (13−3−8A)" f={c((x) => x.chk15)} kind="d" />
                  <Line label="Cage 18 less (16−17−15)" f={c((x) => x.chk18)} kind="d" />

                  <Sec label="Disallowed input tax, exempt ratio test" />
                  <Line label="Computed: cage 7 × E ÷ (D+E)" f={c((x) => x.sugg)} />
                  <Line label="Cage 8 less computed" f={c((x) => x.d8)} kind="d" />
                  <Line label="Computed: K × E ÷ (D+E)" f={c((x) => x.suggK)} />
                  <Line label="Cage 8A less computed" f={c((x) => x.d8A)} kind="d" />
                  <Line label="Implied VAT rate on suspended purchases (K ÷ J)" f={c((x) => x.impliedRate)} show={pct} />

                  <Sec label="Return against ledger and schedule" />
                  <Line label="Exports as per ledger" f={raw("ledger_exports")} />
                  <Line label="Difference to zero rated supplies" f={c((x) => x.dExp)} kind="d" />
                  <Line label="Local sales as per ledger" f={raw("ledger_local_sales")} />
                  <Line label="Difference to exempt supplies" f={c((x) => x.dLoc)} kind="d" />
                  <Line label="Imports VAT as per ledger" f={raw("ledger_imports")} />
                  <Line label="Difference to deferred tax" f={c((x) => x.dImp)} kind="d" />
                  <Line label="Input schedule VAT total" f={c((x) => x.sched)} />
                  <Line label="Difference to local purchases tax" f={c((x) => x.dSched)} kind="d" />
                  <Line label="Claimed from ledger invoices" f={c((x) => x.ledgerClaimed)} />

                  <Sec label="Return against the uploaded reconciliations and schedule" />
                  <Line label="Exports per Export reconciliation (net sales)" f={c((x) => x.expRecon)} />
                  <Line label="Zero rated supplies, goods (D) less exports per reconciliation" f={c((x) => x.dExpRecon)} kind="d" />
                  <Line label="Imports per Import Register (value for VAT per customs)" f={c((x) => x.impRecon)} />
                  <Line label="Imports, value (H) less imports per register" f={c((x) => x.dImpRecon)} kind="d" />
                  <Line label="Local purchases per IRD input schedule (value of purchase)" f={c((x) => x.locRecon)} />
                  <Line label="Local purchases, value (I) less input schedule value" f={c((x) => x.dLocRecon)} kind="d" />
                </tbody>
              </table>
            </div>
          )}
          <div className="note">
            Whole rupees, right aligned. Cages 7, 9, 13, 14 and the checks are calculated; the rest are as entered.
            Differences of less than one rupee are treated as agreed. The last section compares the return with the
            Export reconciliation and Import Register tabs and the IRD input schedule for the same month; a difference equal to
            the cage means nothing has been uploaded for that month yet.
          </div>
        </div>
      </div>
    </>
  );
}
