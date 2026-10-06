"use client";

import { useEffect, useMemo, useState } from "react";
import { useApp } from "./AppShell";
import UploadPanel from "./UploadPanel";
import { fmt, mLabel, monthKey, monthStart, sum } from "@/lib/format";
import { reloadInvoice } from "@/lib/data";
import type { Invoice } from "@/lib/types";

const PAGE_SIZE = 250;

type StatusFilter = "" | "c" | "n";
type OrigFilter = "" | "y" | "n" | "b";

/** Value of the claimed-month select for an invoice: "" auto, "YYYY-MM" manual month, "none" manual not claimed. */
const claimValue = (r: Invoice) =>
  r.manual_not_claimed ? "none" : r.manual_claim_month ? monthKey(r.manual_claim_month) : "";

export default function InvoicesView() {
  const { supabase, company, months, yearInvoices, loading, canWrite, user, patchInvoice, flash } = useApp();
  const data = useMemo(() => ({ invoices: yearInvoices }), [yearInvoices]);

  const [fMonth, setFMonth] = useState("");
  const [fStatus, setFStatus] = useState<StatusFilter>("");
  const [fOrig, setFOrig] = useState<OrigFilter>("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [upMonth, setUpMonth] = useState(months[0]);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Reset filters when the tax year or company changes.
  useEffect(() => {
    setFMonth("");
    setPage(0);
    setUpMonth(months[0]);
  }, [months, company?.id]);

  const rows = useMemo(() => {
    let r = data.invoices;
    if (fMonth) r = r.filter((x) => monthKey(x.posting_date) === fMonth);
    if (fStatus) r = r.filter((x) => (fStatus === "c" ? x.claim_status === "Claimed" : x.claim_status !== "Claimed"));
    if (fOrig)
      r = r.filter((x) =>
        fOrig === "y" ? x.original_invoice === "Yes" : fOrig === "n" ? x.original_invoice === "No" : !x.original_invoice,
      );
    const s = q.trim().toLowerCase();
    if (s)
      r = r.filter((x) =>
        `${x.invoice_no} ${x.vendor_name ?? ""} ${x.external_doc_no ?? ""} ${x.description ?? ""}`
          .toLowerCase()
          .includes(s),
      );
    return r;
  }, [data.invoices, fMonth, fStatus, fOrig, q]);

  const total = useMemo(() => sum(rows, (r) => r.amount_lcy), [rows]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  useEffect(() => {
    if (page >= pages) setPage(0);
  }, [page, pages]);

  const countFor = (m: string) => data.invoices.filter((x) => monthKey(x.posting_date) === m).length;

  async function update(inv: Invoice, patch: Partial<Invoice>) {
    setBusyId(inv.id);
    const { error } = await supabase
      .from("ledger_invoices")
      .update({ ...patch, updated_by: user.id, updated_at: new Date().toISOString() })
      .eq("id", inv.id);
    if (error) {
      flash("Could not save: " + error.message, true);
      setBusyId(null);
      return;
    }
    try {
      patchInvoice(await reloadInvoice(supabase, inv.id));
      flash(null);
    } catch (e) {
      flash(e instanceof Error ? e.message : "Saved, but the row could not be refreshed.", true);
    }
    setBusyId(null);
  }

  const setOriginal = (inv: Invoice, v: string) =>
    update(inv, { original_invoice: v === "Yes" || v === "No" ? v : null });

  const setClaim = (inv: Invoice, v: string) =>
    update(inv, {
      manual_not_claimed: v === "none",
      manual_claim_month: v && v !== "none" ? monthStart(v) : null,
    });

  const claimOptions = (r: Invoice) => {
    const ms = [...months];
    const cur = claimValue(r);
    if (cur && cur !== "none" && !ms.includes(cur)) ms.push(cur);
    return ms;
  };

  return (
    <>
      {canWrite && (
        <UploadPanel
          kind="ledger"
          month={upMonth}
          onMonthChange={setUpMonth}
          existingCount={countFor}
          onSaved={(m) => {
            setFMonth(m);
            setPage(0);
          }}
        />
      )}

      <div className="bar">
        <label className="field">
          Posting month
          <select
            className="control"
            value={fMonth}
            onChange={(e) => {
              setFMonth(e.target.value);
              setPage(0);
            }}
          >
            <option value="">All months</option>
            {months.map((k) => (
              <option key={k} value={k}>
                {mLabel(k)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Status
          <select
            className="control"
            value={fStatus}
            onChange={(e) => {
              setFStatus(e.target.value as StatusFilter);
              setPage(0);
            }}
          >
            <option value="">All</option>
            <option value="c">Claimed</option>
            <option value="n">Not claimed</option>
          </select>
        </label>
        <label className="field">
          Original VAT invoice
          <select
            className="control"
            value={fOrig}
            onChange={(e) => {
              setFOrig(e.target.value as OrigFilter);
              setPage(0);
            }}
          >
            <option value="">All</option>
            <option value="y">Available</option>
            <option value="n">Not available</option>
            <option value="b">Not marked</option>
          </select>
        </label>
        <label className="field">
          Search
          <input
            className="control"
            type="search"
            placeholder="Invoice, vendor, document no."
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <span className="note pb-1.5">
          {rows.length} invoices · <span className="font-mono tabular-nums">{fmt(total)}</span>
        </span>
      </div>

      <div className="scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Invoice no.</th>
              <th>Posting date</th>
              <th>Vendor</th>
              <th>External doc. no.</th>
              <th>Description</th>
              <th className="num">Amount (LCY)</th>
              <th>Original VAT invoice</th>
              <th>Status</th>
              <th>Claimed month</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data.invoices.length ? (
              <tr>
                <td colSpan={9} className="note">
                  Loading records…
                </td>
              </tr>
            ) : !rows.length ? (
              <tr>
                <td colSpan={9} className="note">
                  {data.invoices.length
                    ? "No invoices match these filters."
                    : canWrite
                      ? "No invoices yet. Upload a month’s ledger list above to add them."
                      : "No invoices held for this tax year."}
                </td>
              </tr>
            ) : (
              pageRows.map((r) => {
                const claimed = r.claim_status === "Claimed";
                const busy = busyId === r.id;
                return (
                  <tr key={r.id} className={busy ? "opacity-60" : undefined}>
                    <td>{r.invoice_no}</td>
                    <td>{r.posting_date}</td>
                    <td className="wrapc">{r.vendor_name}</td>
                    <td>{r.external_doc_no}</td>
                    <td className="wrapc">{r.description}</td>
                    <td className="num">{fmt(r.amount_lcy)}</td>
                    <td>
                      {canWrite ? (
                        <select
                          className="control"
                          value={r.original_invoice ?? ""}
                          disabled={busy}
                          aria-label={`Original VAT invoice for ${r.invoice_no}`}
                          onChange={(e) => setOriginal(r, e.target.value)}
                        >
                          <option value="">Not marked</option>
                          <option value="Yes">Yes</option>
                          <option value="No">No</option>
                        </select>
                      ) : (
                        <span className={r.original_invoice ? "" : "text-muted"}>{r.original_invoice ?? "Not marked"}</span>
                      )}
                    </td>
                    <td>
                      <span className={"pill " + (claimed ? "pill-good" : "pill-warn")}>
                        {claimed ? "Claimed" : "Not claimed"}
                      </span>
                    </td>
                    <td>
                      {canWrite ? (
                        <select
                          className="control"
                          value={claimValue(r)}
                          disabled={busy}
                          aria-label={`Claimed month for ${r.invoice_no}`}
                          onChange={(e) => setClaim(r, e.target.value)}
                        >
                          <option value="">
                            {r.auto_claim_month ? "Auto: " + mLabel(monthKey(r.auto_claim_month)) : "Auto: none"}
                          </option>
                          {claimOptions(r).map((k) => (
                            <option key={k} value={k}>
                              {mLabel(k)} (manual)
                            </option>
                          ))}
                          <option value="none">Not claimed (manual)</option>
                        </select>
                      ) : (
                        <ClaimText r={r} />
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="note">
          Status is set automatically when an invoice’s external document number appears as a tax invoice number on a
          month’s IRD input schedule. Use the claimed-month list to override where the numbers are written differently.
        </div>
        {pages > 1 && (
          <div className="bar items-center">
            <button className="btn" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <span className="note">
              Rows {page * PAGE_SIZE + 1}–{Math.min(rows.length, (page + 1) * PAGE_SIZE)} of {rows.length}
            </span>
            <button className="btn" type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
              Next
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function ClaimText({ r }: { r: Invoice }) {
  if (r.manual_not_claimed) return <span>Not claimed (manual)</span>;
  if (r.manual_claim_month) return <span>{mLabel(monthKey(r.manual_claim_month))} (manual)</span>;
  return <span className="text-muted">{r.auto_claim_month ? "Auto: " + mLabel(monthKey(r.auto_claim_month)) : "Auto: none"}</span>;
}
