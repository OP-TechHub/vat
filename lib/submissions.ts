/**
 * Schedule submissions (migration 0020): the VAT schedule submission status of each taxable period, as in the
 * "DVAT Plan" workbook. Periods are IRD codes YYQM: quarter Q of 20YY, month M of the quarter, M = 0 for a
 * quarterly period (1910 = Jan–Mar 2019, 2632 = Aug 2026). "Schedules submitted" and "Cusdecs availability"
 * are worked out here from the stored columns, never stored.
 */
import { MN } from "./format";

export interface ScheduleSubmission {
  company_id: string;
  period_code: string;
  selected: boolean;
  deferred_input_vat: number | null;
  sch1: string | null;
  sch2_input_vat: number | null;
  /** Text in the Sch 2 column when there is no amount, e.g. "No local purchases". */
  sch2_note: string | null;
  sch3: string | null;
  sch4: string | null;
  sch6: string | null;
  sch7: string | null;
  svat06: string | null;
  rmi: string | null;
  return_availability: string | null;
  sch6_cusdecs: number | null;
  cusdecs_in_register: number | null;
  remarks: string | null;
  updated_at?: string;
  updated_by?: string | null;
}

/** Columns read from the workbook and sent to upload_schedule_submissions. */
export type SubmissionRow = Omit<ScheduleSubmission, "company_id" | "updated_at" | "updated_by">;

/** Columns that hold a filing status. */
export const STATUS_FIELDS = ["sch1", "sch3", "sch4", "sch6", "sch7"] as const;

/** Choices offered when editing, by column; uploads may hold other text, which is kept and shown as is. */
export const CHOICES: Record<string, string[]> = {
  sch1: ["Submitted", "Not Submitted"],
  sch3: ["Submitted", "Not Submitted"],
  sch4: ["Submitted", "Not Submitted"],
  sch6: ["Submitted", "Not Submitted"],
  sch7: ["Submitted", "Not Submitted"],
  svat06: ["Submitted", "Not Submitted", "Not Applicable"],
  rmi: ["Received", "Not Received"],
  return_availability: ["Available", "Not Available"],
};

const PERIOD_RE = /^(\d{2})([1-4])([0-3])$/;

/** True for a valid period code (IRD YYQM). */
export const isPeriodCode = (code: string) => PERIOD_RE.test(code);

/** First month of a period, "YYYY-MM". */
export function periodStart(code: string): string {
  const m = PERIOD_RE.exec(code);
  if (!m) return "";
  const month = (+m[2] - 1) * 3 + Math.max(+m[3], 1);
  return `20${m[1]}-${String(month).padStart(2, "0")}`;
}

/** "Jan–Mar 2019" for a quarterly code, "Aug 2026" for a monthly one. */
export function periodLabel(code: string): string {
  const m = PERIOD_RE.exec(code);
  if (!m) return code;
  const q = +m[2] - 1;
  return +m[3] === 0 ? `${MN[q * 3]}–${MN[q * 3 + 2]} 20${m[1]}` : `${MN[q * 3 + +m[3] - 1]} 20${m[1]}`;
}

/** Period code from a workbook Month cell: an Excel date, "Aug 2026", or "Jan–Mar 2019". */
export function periodFromLabel(v: string): string | null {
  const t = v.replace(/\s+/g, " ").trim();
  const q = /^([A-Za-z]{3})\s*[–-]\s*([A-Za-z]{3}) (\d{4})$/.exec(t);
  const one = /^([A-Za-z]{3})[a-z]* (\d{4})$/.exec(t);
  const idx = (s: string) => MN.findIndex((x) => x.toLowerCase() === s.slice(0, 3).toLowerCase());
  if (q) {
    const a = idx(q[1]);
    if (a < 0 || a % 3) return null;
    return `${q[3].slice(2)}${a / 3 + 1}0`;
  }
  if (one) {
    const a = idx(one[1]);
    if (a < 0) return null;
    return `${one[2].slice(2)}${Math.floor(a / 3) + 1}${(a % 3) + 1}`;
  }
  return null;
}

/** Newest first, by start month; codes starting the same month (a quarter and its first month) by code. */
export function comparePeriods(a: string, b: string): number {
  return periodStart(b).localeCompare(periodStart(a)) || b.localeCompare(a);
}

const submitted = (v: string | null | undefined) => /^submitted$/i.test((v ?? "").trim());

/** Schedules filed of the six (Sch 1, 2, 3, 4, 6, 7): Sch 2 counts when it carries an amount. */
export function schedulesSubmitted(r: SubmissionRow): number {
  return STATUS_FIELDS.filter((f) => submitted(r[f])).length + ((r.sch2_input_vat ?? 0) > 0 ? 1 : 0);
}

/** Whether the Sch 6 export CusDecs are in the CusDec register. */
export function cusdecsAvailability(r: SubmissionRow): "No Sch 6 Exports" | "No CusDecs" | "Full" | "Partial" {
  const sch6 = r.sch6_cusdecs ?? 0;
  const held = r.cusdecs_in_register ?? 0;
  if (sch6 <= 0) return "No Sch 6 Exports";
  if (held <= 0) return "No CusDecs";
  return held >= sch6 ? "Full" : "Partial";
}

/** The workbook's "Periods submitted" row for the given periods. */
export function submissionTotals(rows: SubmissionRow[]) {
  const n = rows.length;
  const count = (f: (r: SubmissionRow) => boolean) => rows.filter(f).length;
  const svatApplicable = rows.filter((r) => !/not applicable/i.test(r.svat06 ?? ""));
  const avail = rows.map(cusdecsAvailability);
  return {
    n,
    deferred: count((r) => (r.deferred_input_vat ?? 0) > 0),
    sch2: count((r) => (r.sch2_input_vat ?? 0) > 0),
    ...Object.fromEntries(STATUS_FIELDS.map((f) => [f, count((r) => submitted(r[f]))])) as Record<(typeof STATUS_FIELDS)[number], number>,
    svat: svatApplicable.filter((r) => submitted(r.svat06)).length,
    svatOf: svatApplicable.length,
    returns: count((r) => /^available$/i.test((r.return_availability ?? "").trim())),
    full: avail.filter((a) => a === "Full").length,
    partial: avail.filter((a) => a === "Partial").length,
    none: avail.filter((a) => a === "No CusDecs").length,
  };
}
