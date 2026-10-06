/** Shared formatting, month and matching helpers. Ported from reference/prototype.html. */

export const MN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** LKR money: two decimals, thousands separators. Empty string for null/NaN. */
export const fmt = (n: number | null | undefined): string =>
  n == null || isNaN(Number(n))
    ? ""
    : Number(n).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Whole rupees with thousands separators (reconciliation table). */
export const fmt0 = (n: number | string | null | undefined): string =>
  n == null || n === "" || isNaN(Number(n)) ? "" : Math.round(Number(n)).toLocaleString("en-LK");

/** Month key "YYYY-MM" for every month of a tax year starting April of `year`. */
export const monthsOf = (year: number): string[] => {
  const a: string[] = [];
  for (let i = 0; i < 12; i++) {
    const m = (3 + i) % 12;
    const y = year + (i >= 9 ? 1 : 0);
    a.push(y + "-" + String(m + 1).padStart(2, "0"));
  }
  return a;
};

/** "YYYY-MM" -> "Apr 2026" */
export const mLabel = (k: string | null | undefined): string =>
  k ? MN[+k.slice(5, 7) - 1] + " " + k.slice(0, 4) : "";

/** "YYYY-MM" -> "Apr" */
export const mShort = (k: string | null | undefined): string => (k ? MN[+k.slice(5, 7) - 1] : "");

/** Tax-year label: 2026 -> "2026/27" */
export const yearLabel = (y: number): string => y + "/" + String(y + 1).slice(2);

/** Tax year (April to March) that a "YYYY-MM" or "YYYY-MM-DD" key falls in. */
export const taxYearOf = (k: string): number => {
  const y = +k.slice(0, 4);
  const m = +k.slice(5, 7);
  return m >= 4 ? y : y - 1;
};

/** First and last calendar day of a tax year as ISO dates. */
export const yearRange = (year: number): { from: string; to: string } => ({
  from: year + "-04-01",
  to: year + 1 + "-03-31",
});

/** First day of a month key as an ISO date, for date columns. */
export const monthStart = (k: string): string => k.slice(0, 7) + "-01";

/** Month key of an ISO date ("YYYY-MM-DD" -> "YYYY-MM"). */
export const monthKey = (d: string | null | undefined): string => (d ? d.slice(0, 7) : "");

/** Matching key: trimmed, upper-cased, all whitespace removed. Mirrors norm_doc_no() in SQL. */
export const norm = (s: unknown): string =>
  String(s == null ? "" : s)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

export const sum = <T>(a: readonly T[], f: (x: T) => number | string | null | undefined): number =>
  a.reduce((t, x) => t + (+(f(x) ?? 0) || 0), 0);

/** Round to cents, avoiding float drift when summing. */
export const cents = (n: number): number => Math.round(n * 100) / 100;
