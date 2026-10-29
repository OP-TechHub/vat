/** Column filter matching for the tables' filter boxes. Pure, shared with the tests. */

/** A cell value as the filter sees it: text, a number, Yes/No, or blank. */
export type CellValue = string | number | boolean | null | undefined;

const text = (v: CellValue): string =>
  v == null ? "" : typeof v === "boolean" ? (v ? "yes" : "no") : String(v).toLowerCase().replace(/,/g, "");
const num = (s: string): number | null => {
  const n = parseFloat(s.replace(/,/g, "").trim());
  return isNaN(n) ? null : n;
};

/**
 * Does a cell match a filter box? Blank filter matches everything. Numbers: ">1000", "<=5", "=0",
 * "100..200" compare numerically; anything else is a case-insensitive "contains" on the cell's text
 * (commas ignored, so "1313863" finds 1,313,863). "blank" matches an empty cell.
 */
export function cellMatches(v: CellValue, filter: string): boolean {
  const f = filter.trim().toLowerCase();
  if (!f) return true;
  const t = text(v);
  if (f === "blank" || f === "empty") return t === "";
  const n = typeof v === "number" ? v : num(t) != null && /^-?[\d.,]+$/.test(String(v ?? "").trim()) ? num(t) : null;
  if (n != null) {
    let m = f.match(/^(>=|<=|>|<|=)\s*(-?[\d.,]+)$/);
    if (m) {
      const x = num(m[2])!;
      return m[1] === ">" ? n > x : m[1] === ">=" ? n >= x : m[1] === "<" ? n < x : m[1] === "<=" ? n <= x : Math.abs(n - x) < 0.005;
    }
    m = f.match(/^(-?[\d.,]+)\s*\.\.\s*(-?[\d.,]+)$/);
    if (m) return n >= num(m[1])! && n <= num(m[2])!;
  }
  return t.includes(f.replace(/,/g, ""));
}
