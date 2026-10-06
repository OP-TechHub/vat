"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useApp } from "./AppShell";
import { fmt0, mLabel, monthStart } from "@/lib/format";
import { RETURN_FIELDS, RETURN_FIELD_IDS, agreed, retCalc, rm, type ReturnCalc } from "@/lib/reports";
import type { ReturnField, VatReturn } from "@/lib/types";

type FormValues = Record<ReturnField, string>;

const blank = (): FormValues => Object.fromEntries(RETURN_FIELD_IDS.map((id) => [id, ""])) as FormValues;
const fromReturn = (r: VatReturn | undefined): FormValues =>
  r
    ? (Object.fromEntries(RETURN_FIELD_IDS.map((id) => [id, r[id] == null ? "" : String(r[id])])) as FormValues)
    : blank();

export default function ReturnsView() {
  const { supabase, company, user, months, data, loading, canWrite, patchReturn, flash } = useApp();
  const [month, setMonth] = useState("");
  const [form, setForm] = useState<FormValues>(blank());
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
  }, [current, k]);

  const have = useMemo(() => months.filter((m) => data.returns.some((r) => rm(r) === m)), [months, data.returns]);
  const calc = useMemo(() => {
    const out: Record<string, { r: VatReturn; c: ReturnCalc }> = {};
    for (const m of have) {
      const r = data.returns.find((x) => rm(x) === m)!;
      out[m] = { r, c: retCalc(r, data.schedule, data.invoices) };
    }
    return out;
  }, [have, data.returns, data.schedule, data.invoices]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!company) return;
    setSaving(true);
    const row = {
      company_id: company.id,
      return_month: monthStart(k),
      ...(Object.fromEntries(RETURN_FIELD_IDS.map((id) => [id, form[id] === "" ? 0 : +form[id] || 0])) as Record<
        ReturnField,
        number
      >),
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
      flash("Could not save: " + error.message, true);
      return;
    }
    patchReturn(saved as VatReturn);
    flash(`Saved the ${mLabel(k)} return.`);
  }

  const Line = ({
    label,
    f,
    kind,
  }: {
    label: string;
    f: (m: string) => number;
    kind?: "t" | "d";
  }) => (
    <tr className={kind === "t" ? "total" : undefined}>
      <td className="whitespace-normal min-w-[220px]">{label}</td>
      {have.map((m) => {
        const v = f(m);
        return (
          <td key={m} className={"num" + (kind === "d" ? (agreed(v) ? " diff0" : " diffx") : "")}>
            {fmt0(v)}
          </td>
        );
      })}
    </tr>
  );
  const raw = (id: ReturnField) => (m: string) => +calc[m].r[id] || 0;
  const c = (g: (x: ReturnCalc) => number) => (m: string) => g(calc[m].c);

  return (
    <div className="grid gap-4 items-start grid-cols-1 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
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
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_140px] gap-x-2.5 gap-y-1.5 items-center">
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
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={form[id]}
                  disabled={!canWrite}
                  onChange={(e) => setForm({ ...form, [id]: e.target.value })}
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
                <Line label="Zero rated supplies, goods (D)" f={raw("zero_rated")} />
                <Line label="Exempt supplies (E)" f={raw("exempt")} />
                <Line label="Imports, value (H)" f={raw("imports_value")} />
                <Line label="Imports, deferred tax (4)" f={raw("imports_deferred")} />
                <Line label="Imports, upfront tax (5)" f={raw("imports_upfront")} />
                <Line label="Local purchases, value (I)" f={raw("local_value")} />
                <Line label="Local purchases, tax (6)" f={raw("local_tax")} />
                <Line label="Total input tax (4+5+6)" f={c((x) => x.t7)} kind="t" />
                <Line label="Disallowable input tax (8)" f={raw("disallowed")} />
                <Line label="Disallowable by exempt ratio, calculated" f={c((x) => x.sugg)} />
                <Line label="Allowable input tax (7−8)" f={c((x) => x.t9)} kind="t" />
                <Line label="Brought forward input tax (10)" f={raw("brought_forward")} />
                <Line label="Input tax available (9+10)" f={c((x) => x.avail)} kind="t" />
                <Line label="Exports as per ledger" f={raw("ledger_exports")} />
                <Line label="Difference to zero rated supplies" f={c((x) => x.dExp)} kind="d" />
                <Line label="Local sales as per ledger" f={raw("ledger_local_sales")} />
                <Line label="Difference to exempt supplies" f={c((x) => x.dLoc)} kind="d" />
                <Line label="Imports VAT as per ledger" f={raw("ledger_imports")} />
                <Line label="Difference to deferred tax" f={c((x) => x.dImp)} kind="d" />
                <Line label="Input schedule VAT total" f={c((x) => x.sched)} />
                <Line label="Difference to local purchases tax" f={c((x) => x.dSched)} kind="d" />
                <Line label="Claimed from ledger invoices" f={c((x) => x.ledgerClaimed)} />
              </tbody>
            </table>
          </div>
        )}
        <div className="note">
          Differences of less than one rupee are treated as agreed. Output tax and the refund or payable cages are not
          held here.
        </div>
      </div>
    </div>
  );
}
