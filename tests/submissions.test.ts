import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseSubmissions, submissionsWorkbook } from "@/lib/parse";
import {
  comparePeriods,
  cusdecsAvailability,
  periodFromLabel,
  periodLabel,
  periodStart,
  schedulesSubmitted,
  submissionTotals,
} from "@/lib/submissions";

const toBuf = (wb: XLSX.WorkBook) => new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);

/** A sheet laid out like the DVAT Plan workbook: title rows, a notes row, the headings, periods and a totals row. */
function dvat(rows: unknown[][]) {
  const head = ["Selected", "Period Code", "Month", "Deferred Input VAT", "Sch 1 Output", "Sch 2\r\nInput VAT", "Sch 3\r\nImport VAT",
    "Sch 4\r\nCredit/Debit Notes", "Sch 6\r\nArticle Export", "Sch 7 Service Export", "Schedules\r\nSubmitted", "SVAT 06", "RMI",
    "Return\r\nAvailability", "Cusdecs Availability", "Sch 6\r\nCusDecs", "CusDecs in\r\nRegister"];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["", "Oceanpick (Private) Limited — VAT Schedule Submission Status by Period"],
    ["", "\"Submitted\" = at least one record in RAMIS for that period."],
    ["", "", "", "", "", "", "", "investigate the ledger", "", "", "", 2541],
    head,
    ...rows,
    ["", "Periods submitted", "", "1 of 3"],
  ]), "Submission Status");
  return toBuf(wb);
}

describe("period codes", () => {
  it("labels quarterly and monthly codes and finds their first month", () => {
    expect(periodLabel("1910")).toBe("Jan–Mar 2019");
    expect(periodLabel("1940")).toBe("Oct–Dec 2019");
    expect(periodLabel("2632")).toBe("Aug 2026");
    expect(periodLabel("2011")).toBe("Jan 2020");
    expect(periodStart("1930")).toBe("2019-07");
    expect(periodStart("2633")).toBe("2026-09");
  });
  it("reads a Month cell back to its code", () => {
    expect(periodFromLabel("Jan–Mar 2019")).toBe("1910");
    expect(periodFromLabel("Oct-Dec 2019")).toBe("1940");
    expect(periodFromLabel("Aug 2026")).toBe("2632");
    expect(periodFromLabel("Feb–Apr 2019")).toBeNull();
  });
  it("sorts newest first", () => {
    expect(["1910", "2632", "2011", "1940"].sort(comparePeriods)).toEqual(["2632", "2011", "1940", "1910"]);
  });
});

describe("schedule submissions workbook", () => {
  const rows = [
    [false, 1910, "Jan–Mar 2019", 0, "Not Submitted", 214171.35, "Submitted", "Not Submitted", "Not Submitted", "Not Submitted", "2 of 6", "Not Submitted", "", "Available", "No Sch 6 Exports", 0, 0],
    [true, 2221, 44652, 4748627, "Not Submitted", "No local purchases", "Submitted", "Not Submitted", "Submitted", "Not Submitted", "2 of 6", "Not Submitted", "", "Not Available", "Partial", 12, 10],
    [false, "", 46235, 12896924, "Not Submitted", 2305019.61, "Submitted", "Submitted", "Submitted", "Not Submitted", "4 of 6", "Not Applicable", "Received", "Available", "No CusDecs", 5, 0],
  ];

  it("reads the periods, works out the code from the Month when it is missing, and passes over the title and totals rows", () => {
    const p = parseSubmissions(dvat(rows));
    expect(p.sheet).toBe("Submission Status");
    expect(p.rows.map((r) => r.period_code)).toEqual(["1910", "2221", "2632"]);
    expect(p.skipped).toBe(0);
    expect(p.text).toMatch(/3 periods from Jan–Mar 2019 to Aug 2026/);
    const [q, apr, aug] = p.rows;
    expect(q).toMatchObject({ selected: false, deferred_input_vat: 0, sch2_input_vat: 214171.35, sch2_note: null, return_availability: "Available" });
    expect(apr).toMatchObject({ selected: true, sch2_input_vat: null, sch2_note: "No local purchases", sch6_cusdecs: 12, cusdecs_in_register: 10 });
    expect(aug).toMatchObject({ svat06: "Not Applicable", rmi: "Received" });
  });

  it("works out Schedules submitted, Cusdecs availability and the totals row as the workbook does", () => {
    const p = parseSubmissions(dvat(rows));
    expect(p.rows.map(schedulesSubmitted)).toEqual([2, 2, 4]);
    expect(p.rows.map(cusdecsAvailability)).toEqual(["No Sch 6 Exports", "Partial", "No CusDecs"]);
    expect(submissionTotals(p.rows)).toMatchObject({ n: 3, deferred: 2, sch2: 2, sch3: 3, sch4: 1, sch6: 2, svat: 0, svatOf: 2, returns: 2, full: 0, partial: 1, none: 1 });
  });

  it("downloads a workbook that uploads back to the same periods", () => {
    const p = parseSubmissions(dvat(rows));
    const back = parseSubmissions(toBuf(submissionsWorkbook(p.rows.map((r) => ({ ...r, remarks: r.period_code === "2221" ? "investigate the ledger" : null })), "Oceanpick")));
    expect(back.rows.map((r) => ({ ...r, remarks: null }))).toEqual(p.rows);
    expect(back.rows[1].remarks).toBe("investigate the ledger");
    expect(() => parseSubmissions(toBuf(submissionsWorkbook([])))).toThrow(/No periods were found/);
  });

  it("rejects a sheet without a Period Code heading", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Month", "Sch 1"], ["Aug 2026", "Submitted"]]), "S");
    expect(() => parseSubmissions(toBuf(wb))).toThrow(/Period Code/);
  });
});
