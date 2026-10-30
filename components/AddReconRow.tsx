"use client";

import { useState } from "react";
import { useApp } from "./AppShell";
import { parseCellNumber } from "./CellInput";
import { cents, mLabel } from "@/lib/format";
import { addReconRow } from "@/lib/data";
import type { ReconDirection } from "@/lib/types";

const BLANK = { invoice_no: "", amount_fc: "", ex_rate: "", net_sales: "", currency_type: "USD" };

/**
 * Form for entering a report invoice by hand, for a month whose sales report / purchase ledger is not
 * uploaded (or is missing an invoice). Net value defaults to amount x rate when left blank.
 */
export default function AddReconRow({
  direction,
  month: month0,
  onAdded,
}: {
  direction: ReconDirection;
  /** Month the form opens on: the month in view. */
  month: string;
  /** Called with the month key the invoice was added to. */
  onAdded: (month: string) => void;
}) {
  const { supabase, company, months, user, reload, flash } = useApp();
  const isImport = direction === "import";
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState("");
  const [f, setF] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const m = month && months.includes(month) ? month : month0;
  const set = (k: keyof typeof BLANK) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function save() {
    if (!company) return;
    const invoice = f.invoice_no.trim();
    const amount = parseCellNumber(f.amount_fc, 2);
    const rate = parseCellNumber(f.ex_rate, 6);
    let net = parseCellNumber(f.net_sales, 2);
    if (!invoice) return flash("Enter the invoice number.", true);
    if (amount === undefined || rate === undefined || net === undefined)
      return flash("Amount, rate and net value must be numbers.", true);
    if (net == null && amount != null && rate != null) net = cents(amount * rate);
    setBusy(true);
    try {
      await addReconRow(
        supabase,
        direction,
        company.id,
        m + "-01",
        {
          invoice_no: invoice,
          amount_fc: amount ?? 0,
          ex_rate: rate,
          net_sales: net ?? 0,
          currency_type: f.currency_type.trim().toUpperCase() || "USD",
        },
        user.id,
      );
      await reload();
      flash(null);
      setF((p) => ({ ...BLANK, currency_type: p.currency_type }));
      onAdded(m);
    } catch (e) {
      flash("Could not add: " + (e instanceof Error ? e.message : String(e)), true);
    }
    setBusy(false);
  }

  if (!open)
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        + Add invoice by hand
      </button>
    );
  return (
    <form
      className="bar"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="field">
        Month
        <select className="control" value={m} onChange={(e) => setMonth(e.target.value)} disabled={busy}>
          {months.map((k) => (
            <option key={k} value={k}>
              {mLabel(k)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Invoice no
        <input className="control w-[130px]" value={f.invoice_no} onChange={set("invoice_no")} disabled={busy} autoFocus />
      </label>
      <label className="field">
        Currency
        {isImport ? (
          <input className="control w-[70px]" value={f.currency_type} onChange={set("currency_type")} disabled={busy} />
        ) : (
          <select className="control" value={f.currency_type} onChange={set("currency_type")} disabled={busy}>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        )}
      </label>
      <label className="field">
        Amount FC ({isImport ? "CIF" : "FOB"})
        <input className="control w-[120px] text-right font-mono" inputMode="decimal" value={f.amount_fc} onChange={set("amount_fc")} disabled={busy} />
      </label>
      <label className="field">
        Ex. rate
        <input className="control w-[100px] text-right font-mono" inputMode="decimal" value={f.ex_rate} onChange={set("ex_rate")} disabled={busy} />
      </label>
      <label className="field">
        {isImport ? "Ledger value (A)" : "Net sales (A)"}
        <input
          className="control w-[130px] text-right font-mono"
          inputMode="decimal"
          placeholder="amount × rate"
          value={f.net_sales}
          onChange={set("net_sales")}
          disabled={busy}
        />
      </label>
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Adding…" : "Add"}
      </button>
      <button type="button" className="btn" onClick={() => setOpen(false)} disabled={busy}>
        Close
      </button>
    </form>
  );
}
