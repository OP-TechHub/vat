/**
 * Match return and acknowledgement files to taxable periods, from an index sheet and/or the
 * file names. Pure functions, shared by the bulk upload on the Return filing tab and its tests.
 */
import type { DocumentKind } from "./types";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const MON = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)";
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Taxable period ("YYYY-MM") named in free text such as a file name or an index cell.
 * Recognises 2026-08, 2026_08, 202608, 08-2026, Aug 2026, August_2026, 2026 Aug, and the IRD
 * period code (2632) when it is the only such token. Null when nothing is found.
 */
export function periodFromText(s: string): string | null {
  const t = String(s ?? "").toLowerCase();
  let m: RegExpMatchArray | null;
  if ((m = t.match(/(?<!\d)(20\d{2})[-_./ ]?(0[1-9]|1[0-2])(?!\d)/))) return `${m[1]}-${m[2]}`;
  if ((m = t.match(/(?<!\d)(0[1-9]|1[0-2])[-_./ ](20\d{2})(?!\d)/))) return `${m[2]}-${m[1]}`;
  if ((m = t.match(new RegExp(`(?<![a-z])${MON}[a-z]*[-_. ']*(20\\d{2}|\\d{2})(?!\\d)`))))
    return `${m[2].length === 2 ? "20" + m[2] : m[2]}-${pad(MONTHS[m[1]])}`;
  if ((m = t.match(new RegExp(`(?<!\\d)(20\\d{2})[-_. ]*${MON}[a-z]*(?![a-z])`)))) return `${m[1]}-${pad(MONTHS[m[2]])}`;
  const codes = [...t.matchAll(/(?<!\d)(\d{2})([1-4])([1-3])(?!\d)/g)];
  if (codes.length === 1) {
    const [, yy, q, mm] = codes[0];
    return `20${yy}-${pad(3 * (+q - 1) + +mm)}`;
  }
  return null;
}

/**
 * Document kinds named in free text. "ack" / "acknowledgement" / "receipt" marks an acknowledgement,
 * "rtn" / "return" a return, and a name carrying both (e.g. "VAT-RTN+ACK") is both. A draft is
 * nothing, so it is never uploaded by mistake.
 */
export function kindsFromText(s: string): DocumentKind[] {
  const t = String(s ?? "").toLowerCase();
  if (/draft/.test(t)) return [];
  const out: DocumentKind[] = [];
  if (/\brtn\b|return/.test(t)) out.push("return");
  if (/ack|receipt/.test(t)) out.push("acknowledgement");
  if (!out.length && /\bvat\b/.test(t)) out.push("return");
  return out;
}

/** Single kind for simple cases: acknowledgement when the text names one, else return, else null. */
export function kindFromText(s: string): DocumentKind | null {
  const k = kindsFromText(s);
  return k.includes("acknowledgement") ? "acknowledgement" : (k[0] ?? null);
}

export interface IndexRow {
  /** File name as it is in the folder. */
  file: string;
  /** Another name the same file may carry (e.g. the original name before renaming). */
  alt?: string;
  period: string | null; // YYYY-MM
  kinds: DocumentKind[];
}

export interface DocumentMatch {
  name: string;
  period: string | null;
  kind: DocumentKind | null;
  /** Where the period came from. */
  source: "index" | "name" | "none";
}

const base = (name: string) => name.toLowerCase().replace(/\.[a-z0-9]+$/, "");

/**
 * Match each selected file to a period and kind, preferring the index, then the file name.
 * A file that is both return and acknowledgement yields two matches.
 */
export function matchDocuments(files: string[], index: IndexRow[] = []): DocumentMatch[] {
  const byName = new Map<string, IndexRow>();
  const byBase = new Map<string, IndexRow>();
  for (const r of index) {
    for (const n of [r.file, r.alt ?? ""].map((x) => x.trim().toLowerCase()).filter(Boolean)) {
      if (!byName.has(n)) byName.set(n, r);
      if (!byBase.has(base(n))) byBase.set(base(n), r);
    }
  }
  const out: DocumentMatch[] = [];
  for (const name of files) {
    const row = byName.get(name.toLowerCase()) ?? byBase.get(base(name));
    const period = row?.period ?? periodFromText(name);
    const kinds = row?.kinds.length ? row.kinds : kindsFromText(name);
    const source: DocumentMatch["source"] = row?.period ? "index" : period ? "name" : "none";
    if (!kinds.length) out.push({ name, period, kind: null, source });
    for (const kind of kinds) out.push({ name, period, kind, source });
  }
  return out;
}

/** Index rows naming a file that was not among the selected files (by new or original name). */
export function missingFiles(files: string[], index: IndexRow[]): string[] {
  const have = new Set(files.map((f) => f.toLowerCase()));
  const haveBase = new Set(files.map(base));
  const present = (f: string) => !!f && (have.has(f.toLowerCase()) || haveBase.has(base(f)));
  return index
    .filter((r) => r.file.trim() && !present(r.file.trim()) && !present((r.alt ?? "").trim()))
    .map((r) => r.file.trim());
}
