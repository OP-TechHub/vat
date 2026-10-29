"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useApp } from "./AppShell";
import UploadPanel from "./UploadPanel";
import CustomsUpload from "./CustomsUpload";
import { DocActions, DocHeading } from "./DocActions";
import { cents, fmt, mLabel, monthKey, norm, sum } from "@/lib/format";
import { RECON_TABLE, loadCustomsEntries, reloadRecon } from "@/lib/data";
import { cusdecDocumentUrl, removeCusdecDocument, uploadCusdecDocument } from "@/lib/customsDocs";
import { customsEntryMonth } from "@/lib/matchDocuments";
import type { CurrencyType, CustomsEntry, ExportEditable, ExportSale, ReconDirection } from "@/lib/types";

/** What the CusDec column's action buttons work on. */
interface CusdecDoc {
  filename: string;
  entry: CustomsEntry;
}

/** A customs declaration with no report row yet: its first item line, with the items' amounts summed. */
interface OrphanRow {
  entry: CustomsEntry;
  customs_value: number | null;
  vat_base: number | null;
  vat_amount: number | null;
}

/** Report month key of a row. */
const sm = (r: ExportSale) => monthKey(r.sales_month);

/** Exchange difference (1): customs value in LKR less the ledger value. */
export const exchangeDifference = (r: ExportSale): number | null =>
  r.custom_value == null ? null : cents(r.custom_value - r.net_sales);

const CURRENCIES: CurrencyType[] = ["USD", "EUR"];

const TEXT: Record<
  ReconDirection,
  { group: string; amount: string; net: string; noun: string; report: string; invoiceNoun: string }
> = {
  export: {
    group: "Details in sales report",
    amount: "Amount FC (FOB) USD / EUR",
    net: "Net sales (A)",
    noun: "export sales",
    report: "export sales report",
    invoiceNoun: "invoices",
  },
  import: {
    group: "Details in purchase ledger",
    amount: "Amount FC (CIF) USD / EUR",
    net: "Ledger value (A)",
    noun: "import purchases",
    report: "import purchase report",
    invoiceNoun: "invoices",
  },
};

/**
 * Reconciliation of a report against customs entries. Used by the Export reconciliation tab; the import
 * branch (purchase ledger against customs) is kept for `import_purchases` but the Import Register tab
 * lists the customs entries directly instead.
 */
export default function ReconView({
  direction,
  rows: rows0,
  onPatched: patch,
}: {
  direction: ReconDirection;
  /** Report rows of the tax year. */
  rows: ExportSale[];
  /** Called with the re-read row after an inline edit. */
  onPatched: (row: ExportSale) => void;
}) {
  const { supabase, company, months, loading, canWrite, user, flash } = useApp();
  const isImport = direction === "import";
  const t = TEXT[direction];
  const customsCols = isImport ? 9 : 7;
  const COLS = 10 + customsCols;

  const [upMonth, setUpMonth] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const countFor = (m: string) => rows0.filter((r) => sm(r) === m).length;

  // Customs entries held for this direction: for the CusDec column and for entries without a report invoice yet.
  const [entries, setEntries] = useState<CustomsEntry[]>([]);
  const [docTick, setDocTick] = useState(0);
  useEffect(() => {
    if (!company) {
      setEntries([]);
      return;
    }
    let live = true;
    loadCustomsEntries(supabase, direction, company.id)
      .then((e) => live && setEntries(e))
      .catch(() => live && setEntries([]));
    return () => {
      live = false;
    };
  }, [supabase, company, direction, rows0, docTick]);

  /** Latest customs entry per invoice number, for the CusDec column. */
  const entryByInvoice = useMemo(() => {
    const m = new Map<string, CustomsEntry>();
    for (const e of entries) {
      const k = norm(e.invoice_no);
      const prev = m.get(k);
      if (!prev || e.created_at > prev.created_at) m.set(k, e);
    }
    return m;
  }, [entries]);

  // CusDec document actions (Open / Upload / Replace / Remove) on the stored customs entry.
  const [docBusy, setDocBusy] = useState<string | null>(null);
  const docFileRef = useRef<HTMLInputElement>(null);
  const docTarget = useRef<CustomsEntry | null>(null);
  async function onDocFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const entry = docTarget.current;
    e.target.value = "";
    if (!file || !entry || !company) return;
    setDocBusy(entry.id);
    try {
      await uploadCusdecDocument(supabase, company.id, direction, entry, file, entry.doc_path);
      flash(`CusDec ${entry.cusdec_no} file kept.`);
      setDocTick((n) => n + 1);
    } catch (err) {
      flash("Could not upload: " + (err instanceof Error ? err.message : String(err)), true);
    }
    setDocBusy(null);
  }
  async function openDoc(d: CusdecDoc) {
    try {
      window.open(await cusdecDocumentUrl(supabase, d.entry.doc_path!), "_blank", "noopener");
    } catch (err) {
      flash("Could not open the file: " + (err instanceof Error ? err.message : String(err)), true);
    }
  }
  async function removeDoc(d: CusdecDoc) {
    if (!window.confirm(`Remove the CusDec file for ${d.entry.cusdec_no} (${d.filename})?`)) return;
    setDocBusy(d.entry.id);
    try {
      await removeCusdecDocument(supabase, d.entry);
      flash(`CusDec ${d.entry.cusdec_no} file removed.`);
      setDocTick((n) => n + 1);
    } catch (err) {
      flash("Could not remove: " + (err instanceof Error ? err.message : String(err)), true);
    }
    setDocBusy(null);
  }
  /** The CusDec cell for a row: nothing without a customs entry, else the document actions. */
  const docCell = (entry: CustomsEntry | null | undefined): ReactNode =>
    entry ? (
      <DocActions<CusdecDoc>
        doc={entry.doc_path ? { filename: entry.doc_name ?? entry.cusdec_no, entry } : null}
        canWrite={canWrite}
        busy={docBusy === entry.id}
        yes="Held"
        no="None"
        pillClass="pill-info"
        onOpen={(d) => void openDoc(d)}
        onPick={() => {
          docTarget.current = entry;
          docFileRef.current?.click();
        }}
        onRemove={(d) => void removeDoc(d)}
      />
    ) : (
      <span className="text-muted">—</span>
    );

  /** Entries whose invoice number matches no loaded row, by CusDec month, one row per declaration with its items summed. */
  const orphans = useMemo(() => {
    const have = new Set(rows0.map((r) => norm(r.invoice_no)));
    const by = new Map<string, OrphanRow[]>();
    for (const e of entries) {
      if (have.has(norm(e.invoice_no))) continue;
      const k = customsEntryMonth(e);
      if (!k) continue;
      const list = by.get(k) ?? [];
      const same = list.find((o) => o.entry.cusdec_no === e.cusdec_no && o.entry.invoice_no === e.invoice_no);
      const add = (a: number | null, b: number | null) => (a == null && b == null ? null : (a ?? 0) + (b ?? 0));
      if (same) {
        same.customs_value = add(same.customs_value, e.customs_value);
        same.vat_base = add(same.vat_base, e.vat_base);
        same.vat_amount = add(same.vat_amount, e.vat_amount);
        if (e.item_no < same.entry.item_no) same.entry = e;
      } else list.push({ entry: e, customs_value: e.customs_value, vat_base: e.vat_base, vat_amount: e.vat_amount });
      by.set(k, list);
    }
    return by;
  }, [entries, rows0]);

  // Default the upload month and the view range to the latest month with data, else the first month.
  useEffect(() => {
    const withData = months.filter((k) => rows0.some((r) => sm(r) === k));
    const latest = withData[withData.length - 1] ?? months[0];
    if (!upMonth || !months.includes(upMonth)) setUpMonth(latest);
    if (!from || !months.includes(from)) setFrom(latest);
    if (!to || !months.includes(to)) setTo(latest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months, rows0, company?.id]);

  const f = from || months[0];
  const tt = to || months[0];
  const lo = f <= tt ? f : tt;
  const hi = f <= tt ? tt : f;
  const rangeMonths = useMemo(() => months.filter((k) => k >= lo && k <= hi), [months, lo, hi]);
  const groups = useMemo(
    () =>
      rangeMonths
        .map((k) => ({ month: k, rows: rows0.filter((r) => sm(r) === k), extra: orphans.get(k) ?? [] }))
        .filter((g) => g.rows.length || g.extra.length),
    [rangeMonths, rows0, orphans],
  );
  const all = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const orphanCount = groups.reduce((n, g) => n + g.extra.length, 0);

  async function update(row: ExportSale, patchData: Partial<ExportEditable>) {
    // Customs value follows invoice value x customs rate whenever either of those changes.
    if ("custom_ex_rate" in patchData || "custom_invoice_value" in patchData) {
      const rate = "custom_ex_rate" in patchData ? patchData.custom_ex_rate : row.custom_ex_rate;
      const val = "custom_invoice_value" in patchData ? patchData.custom_invoice_value : row.custom_invoice_value;
      patchData.custom_value = rate != null && val != null ? cents(rate * val) : null;
    }
    setBusyId(row.id);
    const { error } = await supabase
      .from(RECON_TABLE[direction])
      .update({ ...patchData, updated_by: user.id, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) {
      flash("Could not save: " + error.message, true);
      setBusyId(null);
      return;
    }
    try {
      patch(await reloadRecon(supabase, direction, row.id));
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
      {isImport && <td className="num">{fmt(sum(rows, (r) => r.custom_vat_base ?? 0))}</td>}
      {isImport && <td className="num">{fmt(sum(rows, (r) => r.custom_vat_amount ?? 0))}</td>}
      <td className="num">{fmt(sum(rows, (r) => exchangeDifference(r) ?? 0))}</td>
      <td className="num">{fmt(sum(rows, (r) => r.short_shipment ?? 0))}</td>
      <td className="num">{fmt(sum(rows, (r) => r.sales_reversed ?? 0))}</td>
      <td></td>
      <td></td>
    </tr>
  );

  return (
    <>
      {canWrite && (
        <>
          <UploadPanel
            kind={direction}
            month={upMonth || months[0]}
            onMonthChange={setUpMonth}
            existingCount={countFor}
            onSaved={(m) => {
              setFrom(m);
              setTo(m);
            }}
          />
          <CustomsUpload direction={direction} />
        </>
      )}

      <div className="bar">
        <label className="field">
          View from
          <select className="control" value={f} onChange={(e) => setFrom(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {mLabel(m)}
                {countFor(m) ? ` · ${countFor(m)} ${t.invoiceNoun}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          To
          <select className="control" value={tt} onChange={(e) => setTo(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {mLabel(m)}
                {countFor(m) ? ` · ${countFor(m)} ${t.invoiceNoun}` : ""}
              </option>
            ))}
          </select>
        </label>
        <span className="note pb-1.5">
          {all.length} {t.invoiceNoun} · {isImport ? "ledger value" : "net sales"}{" "}
          <span className="font-mono tabular-nums">{fmt(sum(all, (r) => r.net_sales))}</span>
          {" · "}exchange difference{" "}
          <span className="font-mono tabular-nums">{fmt(sum(all, (r) => exchangeDifference(r) ?? 0))}</span>
          {" · "}
          {all.filter((r) => r.cusdec_no).length} with customs entry
          {orphanCount > 0 && (
            <>
              {" · "}
              <span className="text-warn">
                {orphanCount} customs entr{orphanCount === 1 ? "y" : "ies"} without a {isImport ? "purchase" : "sales"} invoice yet
              </span>
            </>
          )}
        </span>
      </div>

      <input ref={docFileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={(e) => void onDocFile(e)} />

      <div className="scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th colSpan={5} className="text-center" style={{ position: "static" }}>
                {t.group}
              </th>
              <th colSpan={customsCols} className="text-center border-l border-line" style={{ position: "static" }}>
                As per customs
              </th>
              <th colSpan={4} className="text-center border-l border-line" style={{ position: "static" }}>
                Differences
              </th>
              <th className="text-center border-l border-line" style={{ position: "static" }}>
                Document
              </th>
            </tr>
            <tr>
              <th>Invoice no</th>
              <th>Month</th>
              <th className="num">{t.amount}</th>
              <th className="num">Ex. rate</th>
              <th className="num">{t.net}</th>
              <th className="border-l border-line">Cusdec no</th>
              <th>Date</th>
              <th>Month</th>
              <th>Currency</th>
              <th className="num">Ex. rate customs LKR</th>
              <th className="num">Invoice value as per USD / EUR</th>
              <th className="num">Customs value</th>
              {isImport && <th className="num">Value for VAT (customs)</th>}
              {isImport && <th className="num">VAT as per customs</th>}
              <th className="num border-l border-line">Exchange difference (1)</th>
              <th className="num">Short shipment (3)</th>
              <th className="num">{isImport ? "Reversed in the month (4)" : "Sales reversed in the month (4)"}</th>
              <th>Updated in customs report</th>
              <DocHeading title="CusDec" canWrite={canWrite} className="border-l border-line" />
            </tr>
          </thead>
          <tbody>
            {loading && !rows0.length ? (
              <tr>
                <td colSpan={COLS} className="note">
                  Loading records…
                </td>
              </tr>
            ) : !groups.length ? (
              <tr>
                <td colSpan={COLS} className="note">
                  No {t.noun} saved for {lo === hi ? mLabel(lo) : `${mLabel(lo)} to ${mLabel(hi)}`}.
                  {canWrite ? ` Upload a month’s ${t.report} above.` : ""}
                </td>
              </tr>
            ) : (
              <>
                {groups.map((g) => (
                  <GroupRows
                    key={g.month}
                    g={g}
                    extra={g.extra}
                    docCell={docCell}
                    entryFor={(inv) => entryByInvoice.get(norm(inv))}
                    isImport={isImport}
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
        The first five columns come from the uploaded {t.report}. The customs columns are filled automatically from
        uploaded customs entries with the same invoice number, or entered by hand. A customs entry whose invoice is
        not in any uploaded {t.report} is listed under its CusDec month with the first columns blank until that
        month’s report is uploaded. Customs value is invoice value ×
        customs rate and exchange difference (1) is customs value less {isImport ? "ledger value" : "net sales"}.
        Re-uploading a month keeps customs details already held for the same invoice number.
      </div>
    </>
  );
}

function GroupRows({
  g,
  extra,
  docCell,
  entryFor,
  isImport,
  canWrite,
  busyId,
  text,
  numeric,
  update,
  Totals,
}: {
  g: { month: string; rows: ExportSale[] };
  /** Customs declarations of this month with no report invoice yet. */
  extra: OrphanRow[];
  docCell: (entry: CustomsEntry | null | undefined) => ReactNode;
  entryFor: (invoiceNo: string) => CustomsEntry | undefined;
  isImport: boolean;
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
                isImport ? (
                  cell("currency_type", "text", 0, "w-[70px]")
                ) : (
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
                )
              ) : (
                r.currency_type
              )}
            </td>
            <td className="num">{cell("custom_ex_rate", "num", 6, "w-[100px]")}</td>
            <td className="num">{cell("custom_invoice_value", "num")}</td>
            <td className="num">{cell("custom_value", "num", 2, "w-[130px]")}</td>
            {isImport && <td className="num">{cell("custom_vat_base", "num", 2, "w-[130px]")}</td>}
            {isImport && <td className="num">{cell("custom_vat_amount", "num", 2, "w-[120px]")}</td>}
            <td className={"num border-l border-line" + (diff != null && diff !== 0 ? "" : " text-muted")}>
              {diff == null ? "" : fmt(diff)}
            </td>
            <td className="num">{cell("short_shipment", "num")}</td>
            <td className="num">{cell("sales_reversed", "num")}</td>
            <td>{cell("updated_in_custom_report", "text", 0, "w-[120px]")}</td>
            <td className="border-l border-line">{docCell(entryFor(r.invoice_no))}</td>
          </tr>
        );
      })}
      {extra.map(({ entry: e, customs_value, vat_base, vat_amount }) => (
        <tr key={"e" + e.id} className="text-muted">
          <td>
            {e.invoice_no}{" "}
            <span className="pill pill-warn">No {isImport ? "purchase" : "sales"} invoice yet</span>
          </td>
          <td>{mLabel(g.month)}</td>
          <td className="num">—</td>
          <td></td>
          <td className="num">—</td>
          <td className="border-l border-line text-ink">{e.cusdec_no}</td>
          <td className="text-ink">{e.cusdec_date}</td>
          <td className="text-ink">{e.cusdec_month}</td>
          <td className="text-ink">{e.currency_type}</td>
          <td className="num text-ink">{e.ex_rate ?? ""}</td>
          <td className="num text-ink">{fmt(e.invoice_value)}</td>
          <td className="num text-ink">{fmt(customs_value)}</td>
          {isImport && <td className="num text-ink">{fmt(vat_base)}</td>}
          {isImport && <td className="num text-ink">{fmt(vat_amount)}</td>}
          <td className="border-l border-line"></td>
          <td></td>
          <td></td>
          <td className="wrapc">{e.party}</td>
          <td className="border-l border-line">{docCell(e)}</td>
        </tr>
      ))}
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
