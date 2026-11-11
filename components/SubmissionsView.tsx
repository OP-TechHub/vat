"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useApp } from "./AppShell";
import CellInput, { EditSwitch, parseCellNumber } from "./CellInput";
import { ClearFilters, FilterRow, useColumnFilters, type ColumnSpec } from "./ColumnFilters";
import { fmt, periodCode } from "@/lib/format";
import { loadSubmissions } from "@/lib/data";
import { isMissingTable } from "@/lib/documents";
import { downloadWorkbook } from "@/lib/download";
import { parseSubmissions, submissionsWorkbook } from "@/lib/parse";
import {
  CHOICES,
  comparePeriods,
  cusdecsAvailability,
  periodLabel,
  periodStart,
  schedulesSubmitted,
  submissionTotals,
  type ScheduleSubmission,
  type SubmissionRow,
} from "@/lib/submissions";

type Show = "" | "selected" | "no_return" | "cusdecs" | "svat";
type Editable = Omit<SubmissionRow, "period_code">;

/** Filter boxes under the column headings, in column order. */
const COLUMNS: ColumnSpec[] = [
  { key: "selected", label: "Selected (yes / no)" },
  { key: "period_code", label: "Period code" },
  { key: "period", label: "Period" },
  { key: "deferred", label: "Deferred input VAT", num: true, className: "num" },
  { key: "sch1", label: "Sch 1" },
  { key: "sch2", label: "Sch 2" },
  { key: "sch3", label: "Sch 3" },
  { key: "sch4", label: "Sch 4" },
  { key: "sch6", label: "Sch 6" },
  { key: "sch7", label: "Sch 7" },
  { key: "submitted", label: "Schedules submitted", num: true, className: "num" },
  { key: "svat06", label: "SVAT 06" },
  { key: "rmi", label: "RMI" },
  { key: "return_availability", label: "Return availability" },
  { key: "availability", label: "Cusdecs availability" },
  { key: "sch6_cusdecs", label: "Sch 6 CusDecs", num: true, className: "num" },
  { key: "cusdecs_in_register", label: "CusDecs in register", num: true, className: "num" },
  { key: "remarks", label: "Remarks" },
];

const GOOD = /^(submitted|available|received|full)$/i;
const BAD = /^(not submitted|not available|not received|no cusdecs)$/i;
const WARN = /^partial$/i;

/** A status as a coloured pill: green done, red missing, amber partial, plain otherwise. */
function Status({ v }: { v: string | null }) {
  if (!v) return <span className="text-muted">—</span>;
  const cls = GOOD.test(v) ? "pill-good" : BAD.test(v) ? "pill-bad" : WARN.test(v) ? "pill-warn" : "";
  return cls ? <span className={"pill " + cls}>{v}</span> : <span className="text-muted">{v}</span>;
}

const blankRow = (code: string): SubmissionRow => ({
  period_code: code,
  selected: false,
  deferred_input_vat: null,
  sch1: null,
  sch2_input_vat: null,
  sch2_note: null,
  sch3: null,
  sch4: null,
  sch6: null,
  sch7: null,
  svat06: null,
  rmi: null,
  return_availability: null,
  sch6_cusdecs: null,
  cusdecs_in_register: null,
  remarks: null,
});

/**
 * Schedule submissions: the VAT schedule submission status of every period (the "DVAT Plan" workbook), newest
 * first. Kept up to date in place (with edit permission) or by uploading the workbook again; Download Excel
 * gives the same workbook back, so it can be edited in Excel and uploaded.
 */
export default function SubmissionsView() {
  const { supabase, company, user, perm, flash } = useApp();
  const p = perm("submissions");
  const [rows, setRows] = useState<ScheduleSubmission[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState<Show>("");
  const [editOn, setEditOn] = useState(false);
  const editing = p.edit && editOn;
  const [busy, setBusy] = useState<string | null>(null);
  const cf = useColumnFilters(COLUMNS);

  // Upload: parsed rows waiting for Save.
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ rows: SubmissionRow[]; text: string } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!company) {
      setRows([]);
      return;
    }
    try {
      setRows(await loadSubmissions(supabase, company.id));
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not load the schedule submissions.";
      setError(isMissingTable(e) ? `${msg}. Run supabase/migrations/0020_schedule_submissions.sql in the Supabase SQL Editor.` : msg);
      setRows([]);
    }
  }, [supabase, company]);

  useEffect(() => {
    setRows(null);
    setPending(null);
    void load();
  }, [load]);

  const sorted = useMemo(() => [...(rows ?? [])].sort((a, b) => comparePeriods(a.period_code, b.period_code)), [rows]);
  const shown = useMemo(() => {
    let r = sorted;
    if (show === "selected") r = r.filter((x) => x.selected);
    else if (show === "no_return") r = r.filter((x) => !/^available$/i.test((x.return_availability ?? "").trim()));
    else if (show === "cusdecs") r = r.filter((x) => ["Partial", "No CusDecs"].includes(cusdecsAvailability(x)));
    else if (show === "svat") r = r.filter((x) => /^not submitted$/i.test((x.svat06 ?? "").trim()));
    return cf.apply(r, (x) => ({
      selected: x.selected,
      period_code: x.period_code,
      period: periodLabel(x.period_code),
      deferred: x.deferred_input_vat,
      sch1: x.sch1,
      sch2: x.sch2_input_vat ?? x.sch2_note,
      sch3: x.sch3,
      sch4: x.sch4,
      sch6: x.sch6,
      sch7: x.sch7,
      submitted: schedulesSubmitted(x),
      svat06: x.svat06,
      rmi: x.rmi,
      return_availability: x.return_availability,
      availability: cusdecsAvailability(x),
      sch6_cusdecs: x.sch6_cusdecs,
      cusdecs_in_register: x.cusdecs_in_register,
      remarks: x.remarks,
    }));
  }, [sorted, show, cf.apply]);
  const t = useMemo(() => submissionTotals(shown), [shown]);

  async function save(row: ScheduleSubmission, patch: Partial<Editable>) {
    if (!company) return;
    setBusy(row.period_code);
    const { error: err } = await supabase
      .from("schedule_submissions")
      .update({ ...patch, updated_by: user.id, updated_at: new Date().toISOString() })
      .eq("company_id", company.id)
      .eq("period_code", row.period_code);
    if (err) flash("Could not save: " + err.message, true);
    else {
      flash(null);
      await load();
    }
    setBusy(null);
  }

  /** Adds the month after the latest period held (or the current month when none is held). */
  async function addNext() {
    if (!company) return;
    const latest = sorted[0] ? periodStart(sorted[0].period_code) : "";
    const [y, m] = (latest || new Date().toISOString().slice(0, 7)).split("-").map(Number);
    const next = latest ? `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}` : `${y}-${String(m).padStart(2, "0")}`;
    const code = periodCode(next);
    setBusy(code);
    const { error: err } = await supabase
      .from("schedule_submissions")
      .insert({ ...blankRow(code), company_id: company.id, updated_by: user.id });
    if (err) flash("Could not add the period: " + err.message, true);
    else {
      flash(`Added ${periodLabel(code)} (${code}).`);
      await load();
    }
    setBusy(null);
  }

  async function remove(row: ScheduleSubmission) {
    if (!company || !window.confirm(`Delete ${periodLabel(row.period_code)} (${row.period_code}) from the schedule submissions?`)) return;
    setBusy(row.period_code);
    const { error: err } = await supabase
      .from("schedule_submissions")
      .delete()
      .eq("company_id", company.id)
      .eq("period_code", row.period_code);
    if (err) flash("Could not delete: " + err.message, true);
    else {
      flash(`Deleted ${periodLabel(row.period_code)}.`);
      await load();
    }
    setBusy(null);
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError(null);
    setPending(null);
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const parsed = parseSubmissions(rd.result as ArrayBuffer);
        setPending({ rows: parsed.rows, text: parsed.text });
      } catch (err) {
        setParseError(err instanceof Error ? err.message : "Could not read the file.");
      }
    };
    rd.onerror = () => setParseError("Could not read the file.");
    rd.readAsArrayBuffer(file);
  }

  const held = useMemo(() => new Set((rows ?? []).map((r) => r.period_code)), [rows]);
  const replacing = pending ? pending.rows.filter((r) => held.has(r.period_code)).length : 0;
  const blocked = replacing > 0 && !p.delete;

  async function saveUpload() {
    if (!pending || !company || blocked) return;
    setSaving(true);
    const { error: err } = await supabase.rpc("upload_schedule_submissions", { p_company: company.id, p_rows: pending.rows });
    setSaving(false);
    if (err) {
      flash(
        "Could not save: " + err.message + (/function|schema cache/i.test(err.message) ? ". Run supabase/migrations/0020_schedule_submissions.sql first." : ""),
        true,
      );
      return;
    }
    flash(`Saved ${pending.rows.length} periods.`);
    setPending(null);
    if (fileRef.current) fileRef.current.value = "";
    await load();
  }

  function cancelUpload() {
    setPending(null);
    setParseError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const stamp = () => new Date().toISOString().slice(0, 10);
  const download = () =>
    downloadWorkbook(
      submissionsWorkbook([...shown].reverse(), company?.name ?? ""),
      `Schedule submissions ${company?.name ?? ""} ${stamp()}.xlsx`.replace(/\s+/g, " "),
    );
  const template = () => downloadWorkbook(submissionsWorkbook([]), "Schedule submissions template.xlsx");

  const Row = ({ r }: { r: ScheduleSubmission }) => {
    const rowBusy = busy === r.period_code;
    /** A status column: a drop-down of its choices while editing (keeping any other text already held). */
    const choice = (field: keyof typeof CHOICES & keyof Editable) => {
      const v = (r[field] as string | null) ?? "";
      if (!editing) return <Status v={v || null} />;
      const opts = CHOICES[field].includes(v) || !v ? CHOICES[field] : [v, ...CHOICES[field]];
      return (
        <select
          className="control w-[130px]"
          value={v}
          disabled={rowBusy}
          aria-label={`${field} for ${r.period_code}`}
          onChange={(e) => void save(r, { [field]: e.target.value || null })}
        >
          <option value="">—</option>
          {opts.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    };
    /** A number column: an input while editing. */
    const number = (field: "deferred_input_vat" | "sch6_cusdecs" | "cusdecs_in_register", places: number, shownValue: ReactNode) => {
      if (!editing) return shownValue;
      const v = r[field];
      return (
        <CellInput
          key={r.period_code + field + String(v)}
          value={v == null ? "" : String(v)}
          kind="num"
          className={places ? "w-[120px]" : "w-[60px]"}
          disabled={rowBusy}
          label={`${field.replace(/_/g, " ")} for ${r.period_code}`}
          onCommit={(text) => {
            const n = parseCellNumber(text, places);
            if (n === undefined) return flash(`“${text}” is not a number.`, true);
            if (n !== v) void save(r, { [field]: n });
          }}
        />
      );
    };
    const sch2 = r.sch2_input_vat != null ? fmt(r.sch2_input_vat) : r.sch2_note;
    const avail = cusdecsAvailability(r);
    return (
      <tr className={rowBusy ? "opacity-60" : undefined}>
        <td className="text-center">
          {editing ? (
            <input
              type="checkbox"
              checked={r.selected}
              disabled={rowBusy}
              aria-label={`Selected ${r.period_code}`}
              onChange={(e) => void save(r, { selected: e.target.checked })}
            />
          ) : r.selected ? (
            "✓"
          ) : (
            ""
          )}
        </td>
        <td className="font-mono">{r.period_code}</td>
        <td className="whitespace-nowrap">{periodLabel(r.period_code)}</td>
        <td className="num">{number("deferred_input_vat", 2, fmt(r.deferred_input_vat))}</td>
        <td>{choice("sch1")}</td>
        <td className="num">
          {editing ? (
            <CellInput
              key={r.period_code + "sch2" + (sch2 ?? "")}
              value={r.sch2_input_vat != null ? String(r.sch2_input_vat) : (r.sch2_note ?? "")}
              kind="text"
              className="w-[130px]"
              disabled={rowBusy}
              label={`Sch 2 input VAT for ${r.period_code}`}
              onCommit={(text) => {
                const n = parseCellNumber(text, 2);
                if (n === undefined) void save(r, { sch2_input_vat: null, sch2_note: text.trim() || null });
                else void save(r, { sch2_input_vat: n, sch2_note: null });
              }}
            />
          ) : r.sch2_input_vat != null ? (
            sch2
          ) : (
            <span className="text-muted font-sans">{sch2 ?? "—"}</span>
          )}
        </td>
        <td>{choice("sch3")}</td>
        <td>{choice("sch4")}</td>
        <td>{choice("sch6")}</td>
        <td>{choice("sch7")}</td>
        <td className="num">{schedulesSubmitted(r)} of 6</td>
        <td>{choice("svat06")}</td>
        <td>{choice("rmi")}</td>
        <td>{choice("return_availability")}</td>
        <td>
          <Status v={avail} />
        </td>
        <td className="num">{number("sch6_cusdecs", 0, r.sch6_cusdecs ?? "")}</td>
        <td className="num">{number("cusdecs_in_register", 0, r.cusdecs_in_register ?? "")}</td>
        <td className="wrapc text-xs min-w-[180px]">
          {editing ? (
            <CellInput
              key={r.period_code + "remarks" + (r.remarks ?? "")}
              value={r.remarks ?? ""}
              kind="text"
              className="w-[200px]"
              disabled={rowBusy}
              label={`Remarks for ${r.period_code}`}
              onCommit={(text) => {
                const v = text.trim() || null;
                if (v !== r.remarks) void save(r, { remarks: v });
              }}
            />
          ) : (
            r.remarks
          )}
        </td>
        {editing && p.delete && (
          <td>
            <button className="btn text-xs" type="button" disabled={rowBusy} onClick={() => void remove(r)}>
              Delete
            </button>
          </td>
        )}
      </tr>
    );
  };

  const cols = COLUMNS.length + (editing && p.delete ? 1 : 0);
  const of = (k: number, n = t.n) => `${k} of ${n}`;

  return (
    <>
      {p.upload && (
        <div className="panel">
          <h2 className="text-[15px] font-semibold m-0">Upload the schedule submission workbook</h2>
          <div className="note">
            The “DVAT Plan” workbook, or one downloaded from this tab with Download Excel: a row per period with its Period
            Code (e.g. 2632 for Aug 2026, 1910 for Jan–Mar 2019) and the columns Selected, Deferred Input VAT, Sch 1 to Sch 7,
            SVAT 06, RMI, Return Availability, Sch 6 CusDecs, CusDecs in Register and Remarks, found by their headings.
            Schedules Submitted and Cusdecs Availability are worked out by the app. Every period in the file is added or has
            its columns replaced; periods not in the file are kept. Replacing periods already held needs delete permission.
          </div>
          <div className="bar">
            <label className="field">
              Workbook
              <input
                ref={fileRef}
                className="control file:mr-2 file:border-0 file:bg-transparent file:text-ink file:font-medium"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={onFile}
              />
            </label>
            <button className="btn" type="button" onClick={template}>
              Download template
            </button>
          </div>
          {parseError && <div className="msg msg-err">{parseError}</div>}
          {pending && (
            <>
              <div className="msg">
                {pending.text}{" "}
                {replacing > 0
                  ? `${replacing} of them are already held and will have their columns replaced; ${pending.rows.length - replacing} are new.`
                  : "All of them are new."}
              </div>
              {blocked && (
                <div className="msg msg-err">
                  Replacing periods already held needs delete permission on this tab; ask a company admin.
                </div>
              )}
              <div className="bar">
                <button className="btn btn-primary" type="button" onClick={() => void saveUpload()} disabled={saving || blocked}>
                  {saving ? "Saving…" : `Save ${pending.rows.length} periods`}
                </button>
                <button className="btn" type="button" onClick={cancelUpload} disabled={saving}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="bar">
        <label className="field">
          Show
          <select className="control" value={show} onChange={(e) => setShow(e.target.value as Show)}>
            <option value="">All periods</option>
            <option value="selected">Selected periods</option>
            <option value="no_return">Return not available</option>
            <option value="cusdecs">CusDecs partial or missing</option>
            <option value="svat">SVAT 06 not submitted</option>
          </select>
        </label>
        <ClearFilters state={cf} />
        <button className="btn" type="button" onClick={download} disabled={!shown.length}>
          Download Excel
        </button>
        {p.edit && <EditSwitch on={editOn} onChange={setEditOn} />}
        {editing && (
          <button className="btn" type="button" onClick={() => void addNext()} disabled={!!busy}>
            Add next period
          </button>
        )}
        {rows && (
          <span className="note pb-1.5">
            {shown.length === sorted.length ? `${sorted.length} periods` : `${shown.length} of ${sorted.length} periods`} ·{" "}
            {sorted.filter((r) => r.selected).length} selected
          </span>
        )}
      </div>

      {error && <div className="msg msg-err">{error}</div>}

      <div className="scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Selected</th>
              <th>Period code</th>
              <th>Period</th>
              <th className="num">Deferred input VAT</th>
              <th>Sch 1 Output</th>
              <th className="num">Sch 2 Input VAT</th>
              <th>Sch 3 Import VAT</th>
              <th>Sch 4 Credit/Debit Notes</th>
              <th>Sch 6 Article Export</th>
              <th>Sch 7 Service Export</th>
              <th className="num">Schedules submitted</th>
              <th>SVAT 06</th>
              <th>RMI</th>
              <th>Return availability</th>
              <th>Cusdecs availability</th>
              <th className="num">Sch 6 CusDecs</th>
              <th className="num">CusDecs in register</th>
              <th>Remarks</th>
              {editing && p.delete && <th></th>}
            </tr>
            <FilterRow state={cf} />
          </thead>
          <tbody>
            {rows == null ? (
              <tr>
                <td colSpan={cols} className="note">
                  Loading…
                </td>
              </tr>
            ) : !shown.length ? (
              <tr>
                <td colSpan={cols} className="note">
                  {sorted.length
                    ? "No periods match."
                    : `No schedule submission status held for ${company?.name ?? "this company"} yet.` +
                      (p.upload ? " Upload the workbook above." : "")}
                </td>
              </tr>
            ) : (
              <>
                {shown.map((r) => (
                  <Row key={r.period_code} r={r} />
                ))}
                <tr className="total">
                  <td colSpan={3}>Periods submitted</td>
                  <td className="num">{of(t.deferred)}</td>
                  <td>{of(t.sch1)}</td>
                  <td className="num">{of(t.sch2)}</td>
                  <td>{of(t.sch3)}</td>
                  <td>{of(t.sch4)}</td>
                  <td>{of(t.sch6)}</td>
                  <td>{of(t.sch7)}</td>
                  <td></td>
                  <td>{of(t.svat, t.svatOf)}</td>
                  <td></td>
                  <td>{of(t.returns)}</td>
                  <td className="whitespace-nowrap">
                    {t.full} Full / {t.partial} Partial / {t.none} None
                  </td>
                  <td colSpan={cols - 15}></td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
      <div className="note">
        “Submitted” means at least one record in RAMIS for that period. Schedules submitted counts Sch 1, 2, 3, 4, 6 and 7
        (Sch 2 when it carries an amount). Cusdecs availability compares the Sch 6 export CusDecs with those found in the
        CusDec register: Full, Partial, No CusDecs, or No Sch 6 Exports when the period has none. SVAT 06 is counted out of
        the periods where it applies. The totals row follows the filters. Use Remarks for follow-ups such as “investigate
        the ledger”.
        {p.edit && " With edit permission, “Edit uploaded data” lets every column be changed in place, and new months be added."}
      </div>
    </>
  );
}
