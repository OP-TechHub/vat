"use client";

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import * as XLSX from "xlsx";
import { useApp } from "./AppShell";
import { customsPerm } from "@/lib/permissions";
import { customsTemplateFilename, customsTemplateWorkbook, parseCustoms } from "@/lib/parse";
import { downloadWorkbook } from "@/lib/download";
import { CUSTOMS_DOC_KINDS, customsDoc, uploadCustomsDocument, type CustomsDocKind } from "@/lib/customsDocs";
import { heldDeclarations, matchReading, type FileReading, type HeldDeclaration, type MatchHow } from "@/lib/customsMatch";
import { fmt } from "@/lib/format";
import type { CustomsEntry, CustomsUploadRow, ReconDirection } from "@/lib/types";

type RowDocs = Partial<Record<CustomsDocKind, File>>;

/** Declaration a line belongs to: its CusDec and invoice numbers. */
const declKey = (r: Pick<CustomsUploadRow, "cusdec_no" | "invoice_no">) => r.cusdec_no.trim() + "|" + r.invoice_no.trim();

const isSheet = (f: File) => /\.(xlsx|xls|csv)$/i.test(f.name);
const isDoc = (f: File) => /\.(pdf|jpe?g|png)$/i.test(f.name);
const baseName = (f: File) => f.name.replace(/\.[^.\s]{1,5}$/, "");

/**
 * What happens to a file (or to one CusDec in a bundle holding several): its lines are added as a new CusDec,
 * it is attached to a CusDec already held, it replaces the lines of one held, or it is left out.
 */
type Action = "import" | "attach" | "replace" | "skip";

interface FileRow {
  file: File;
  reading: FileReading | null;
  /** True when item lines were read off the file, so it can be added or replace a held CusDec's lines. */
  hasLines: boolean;
  action: Action;
  /** Held declaration the file goes to (attach / replace), "" when none. */
  key: string;
  how: MatchHow | "chosen" | null;
  /** Document slot the file is kept in. */
  slot: CustomsDocKind;
  note: string | null;
}

interface Pending {
  files: FileRow[];
  lines: CustomsUploadRow[];
  /** Per-line notes from the PDF reader (empty for spreadsheet lines). */
  notes: string[][];
  /** Extra documents attached to a line's declaration in the lines table, by slot. */
  docs: RowDocs[];
  /** File row each line was read from, -1 for spreadsheet lines. */
  origin: number[];
  /** Files that could not be read, and other notes on the batch. */
  text: string;
}

/** Readings by file name (lower case) from an index sheet: File, Cusdec No, Invoice No, Date, Value for VAT, VAT. */
async function readIndex(file: File): Promise<Map<string, FileReading[]>> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { raw: true, defval: null });
  const col = (r: Record<string, unknown>, ...names: string[]) => {
    const k = Object.keys(r).find((h) => names.includes(h.toLowerCase().replace(/[^a-z]/g, "")));
    return k ? r[k] : null;
  };
  const text = (v: unknown) => (v == null || String(v).trim() === "" ? null : String(v).trim());
  const num = (v: unknown) => {
    const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, ""));
    return v == null || v === "" || isNaN(n) ? null : n;
  };
  const out = new Map<string, FileReading[]>();
  for (const r of rows) {
    const name = text(col(r, "file", "filename"));
    if (!name) continue;
    const reading: FileReading = {
      cusdec_no: text(col(r, "cusdecno", "cusdec")),
      invoice_no: text(col(r, "invoiceno", "invoice")),
      cusdec_date: text(col(r, "date", "cusdecdate")),
      vat_base: num(col(r, "valueforvat", "vatbase")),
      vat_amount: num(col(r, "vat", "vatamount")),
    };
    const k = name.toLowerCase();
    out.set(k, [...(out.get(k) ?? []), reading]);
  }
  return out;
}

/** Text or number box that writes back when it loses focus or Enter is pressed; Escape restores the value. */
function NumOrText({
  value,
  kind,
  className,
  label,
  onCommit,
}: {
  value: string;
  kind: "text" | "num";
  className?: string;
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
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(value);
      }}
    />
  );
}

/**
 * The one place to upload customs paperwork. Document files (CusDec printouts, scanned bundles, invoices,
 * packing lists...) are read and sorted: a new CusDec has its lines added, one already held only gets the
 * file attached (or, with delete permission, its lines replaced), and other papers are attached to the CusDec
 * chosen for them. A spreadsheet of CusDec lines can be uploaded instead. Everything is shown for checking
 * before it is saved. Import lines go into the Import Register; export lines fill the sales rows' customs columns.
 */
export default function CustomsUpload({
  direction,
  entries,
  onDone,
}: {
  direction: ReconDirection;
  /** Customs entries already held, to match files to. */
  entries: CustomsEntry[];
  onDone?: () => void | Promise<void>;
}) {
  const { supabase, company, reload, flash, perm } = useApp();
  const canReplace = customsPerm(perm, direction).delete;
  const held = useMemo(() => heldDeclarations(entries), [entries]);
  const byKey = useMemo(() => new Map(held.map((d) => [d.key, d])), [held]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // "Reading 2 of 5…" or "Saving…"
  const noun = direction === "import" ? "import" : "export";
  const isImport = direction === "import";
  const register = isImport ? "the Import Register" : "the export customs entries";

  function startOver() {
    setParseError(null);
    setPending(null);
  }

  function onSheet(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    startOver();
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const p = parseCustoms(rd.result as ArrayBuffer, direction);
        setPending({
          files: [],
          lines: p.rows,
          notes: p.rows.map(() => []),
          docs: p.rows.map(() => ({})),
          origin: p.rows.map(() => -1),
          text: p.text,
        });
      } catch (err) {
        setParseError(err instanceof Error ? err.message : "Could not read the file.");
      }
    };
    rd.onerror = () => setParseError("Could not read the file.");
    rd.readAsArrayBuffer(file);
  }

  async function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const all = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!all.length) return;
    startOver();
    const index = new Map<string, FileReading[]>();
    try {
      for (const s of all.filter(isSheet)) for (const [k, v] of await readIndex(s)) index.set(k, v);
    } catch (err) {
      setParseError("Could not read the index sheet: " + (err instanceof Error ? err.message : String(err)));
      return;
    }
    const docs = all.filter(isDoc).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!docs.length) {
      setParseError("No PDF or image files among those chosen. To upload CusDec lines from a spreadsheet, use the Spreadsheet box.");
      return;
    }
    let readCusdecs: typeof import("@/lib/cusdecRead").readCusdecs;
    try {
      ({ readCusdecs } = await import("@/lib/cusdecRead"));
    } catch (err) {
      setParseError("The PDF reader could not be loaded: " + (err instanceof Error ? err.message : String(err)));
      return;
    }

    const files: FileRow[] = [];
    const lines: CustomsUploadRow[] = [];
    const notes: string[][] = [];
    const origin: number[] = [];
    const failed: string[] = [];

    for (let i = 0; i < docs.length; i++) {
      const file = docs[i];
      const label = `${i + 1} of ${docs.length}: ${file.name}`;
      setBusy(`Reading ${label}…`);
      const listed = index.get(file.name.toLowerCase());

      // Listed in an index sheet: matched from the sheet, no OCR; it can only be attached.
      if (listed) {
        const seen = new Set<string>();
        for (const reading of listed) {
          const m = matchReading(reading, held);
          if (m && seen.has(m.decl.key)) continue;
          if (m) seen.add(m.decl.key);
          files.push({
            file,
            reading,
            hasLines: false,
            action: m ? "attach" : "skip",
            key: m?.decl.key ?? "",
            how: m?.how ?? null,
            slot: "all",
            note: m ? null : "Not matched to a CusDec held: choose it, or leave the file out.",
          });
        }
        continue;
      }

      if (!/\.pdf$/i.test(file.name)) {
        files.push({ file, reading: null, hasLines: false, action: "skip", key: "", how: null, slot: "other", note: "An image is not read: choose the CusDec it belongs to." });
        continue;
      }

      try {
        // A printout, a scanned bundle (invoice, packing list, CusDec...) or a plain scan: the CusDec
        // pages are found and read, by OCR when there is no usable text layer.
        const read = await readCusdecs(await file.arrayBuffer(), direction, (p) => setBusy(`${label}: ${p.text}`));
        const found = read.results.filter((r) => r.row.cusdec_no || r.row.invoice_value != null);
        if (!found.length) {
          // An invoice, packing list or other paper: attached to the CusDec chosen for it.
          files.push({
            file,
            reading: null,
            hasLines: false,
            action: "skip",
            key: "",
            how: null,
            slot: "other",
            note: `No CusDec found in its ${read.pageCount} page${read.pageCount === 1 ? "" : "s"}${read.scanned ? " (read by OCR)" : ""}: if it is another paper of a CusDec, choose the CusDec and what to keep it as.`,
          });
          continue;
        }
        const seen = new Set<string>();
        found.forEach((r, d) => {
          const pages = read.pages[read.results.indexOf(r)] ?? [];
          const reading: FileReading = {
            cusdec_no: r.row.cusdec_no || null,
            invoice_no: r.row.invoice_no || null,
            cusdec_date: r.row.cusdec_date || null,
            vat_base: r.row.vat_base,
            vat_amount: r.row.vat_amount,
          };
          const m = matchReading(reading, held);
          if (m && seen.has(m.decl.key)) return;
          if (m) seen.add(m.decl.key);
          // A file holding more than the CusDec pages is the bundle of all documents.
          const slot: CustomsDocKind = pages.length && read.pageCount > pages.length ? "all" : "cusdec";
          const hasLines = !!r.row.cusdec_no && r.items.length > 0;
          // Held when the CusDec number matches; a CusDec number read that matches none is a new CusDec,
          // even when its figures look like one held (noted, in case the number was misread).
          let action: Action;
          let note: string | null = null;
          if (m?.how === "CusDec no") action = "attach";
          else if (hasLines) {
            action = "import";
            if (m) note = `Its ${m.how} matches CusDec ${m.decl.cusdec_no} held: choose “Attach” if the CusDec number was misread.`;
          } else if (m) action = "attach";
          else {
            action = "skip";
            note = "The CusDec number could not be read and nothing held matches: choose the CusDec, or leave the file out.";
          }
          const fi = files.length;
          files.push({ file, reading, hasLines, action, key: m?.decl.key ?? "", how: m?.how ?? null, slot, note });
          if (!hasLines) return;
          const where =
            read.pageCount > pages.length && pages.length ? ` (page${pages.length === 1 ? "" : "s"} ${pages.join(", ")} of ${read.pageCount})` : "";
          const which = found.length > 1 ? `, CusDec ${d + 1} of ${found.length}` : "";
          // One line per item (HS code line); the header fields repeat on each.
          r.items.forEach((row, n) => {
            lines.push({ ...row, file_name: row.file_name || baseName(file) });
            origin.push(fi);
            notes.push(
              n === 0
                ? [
                    `From ${file.name}${where}${which}${read.scanned ? " (scanned, read by OCR: check every figure)" : ""}${r.items.length > 1 ? `, item 1 of ${r.items.length}` : ""}`,
                    ...r.warnings,
                  ]
                : [`From ${file.name}${which}, item ${n + 1} of ${r.items.length}`],
            );
          });
        });
      } catch (err) {
        failed.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
        files.push({ file, reading: null, hasLines: false, action: "skip", key: "", how: null, slot: "other", note: "Could not be read: choose the CusDec it belongs to, or leave it out." });
      }
    }
    setBusy(null);
    setPending({
      files: flagConflicts(files),
      lines,
      notes,
      docs: lines.map(() => ({})),
      origin,
      text: failed.length ? `Not read: ${failed.join("; ")}` : "",
    });
  }

  /** Only the first file going to a declaration's slot is attached; later ones are flagged and left out. */
  function flagConflicts(list: FileRow[]): FileRow[] {
    const taken = new Map<string, string>();
    return list.map((r) => {
      const clean = r.note && /also goes to/.test(r.note) ? null : r.note;
      if (r.action !== "attach" || !r.key) return { ...r, note: clean };
      const k = r.key + "|" + r.slot;
      const first = taken.get(k);
      if (first && first !== r.file.name) return { ...r, action: "skip", note: `${first} also goes to this CusDec's slot; a slot holds one file.` };
      taken.set(k, r.file.name);
      return { ...r, note: clean };
    });
  }

  const setFile = (i: number, patch: Partial<FileRow>) =>
    setPending((p) => p && { ...p, files: flagConflicts(p.files.map((r, j) => (j === i ? { ...r, ...patch } : r))) });

  const setLine = (i: number, patch: Partial<CustomsUploadRow>) =>
    setPending((p) => p && { ...p, lines: p.lines.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  // Lines to be saved: spreadsheet lines, and those of files whose lines are added or replace a held CusDec's.
  const shown = (p: Pending, i: number) => p.origin[i] < 0 || ["import", "replace"].includes(p.files[p.origin[i]]?.action);
  const visible = pending ? pending.lines.map((_, i) => i).filter((i) => shown(pending, i)) : [];
  /** First line of a line's declaration (from the same file), which carries its documents. */
  const firstOf = (i: number) =>
    pending ? pending.lines.findIndex((x, j) => pending.origin[j] === pending.origin[i] && declKey(x) === declKey(pending.lines[i])) : -1;

  // Attaching documents in the lines table: one hidden picker, pointed at a line and slot when clicked.
  const docRef = useRef<HTMLInputElement>(null);
  const docTarget = useRef<{ i: number; kind: CustomsDocKind } | null>(null);
  const setDoc = (i: number, kind: CustomsDocKind, file: File | null) =>
    setPending(
      (p) =>
        p && {
          ...p,
          docs: p.docs.map((d, j) => {
            if (j !== i) return d;
            const next = { ...d };
            if (file) next[kind] = file;
            else delete next[kind];
            return next;
          }),
        },
    );
  function onDocPicked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const t = docTarget.current;
    e.target.value = "";
    if (file && t) setDoc(t.i, t.kind, file);
  }
  /** Documents kept with a line's declaration: the file it was read from, in its slot, and any attached. */
  const lineDocs = (i: number): { kind: CustomsDocKind; file: File; own: boolean }[] => {
    if (!pending) return [];
    const out: { kind: CustomsDocKind; file: File; own: boolean }[] = [];
    const src = pending.origin[i] >= 0 ? pending.files[pending.origin[i]] : null;
    for (const { kind } of CUSTOMS_DOC_KINDS) {
      const extra = pending.docs[i]?.[kind];
      if (extra) out.push({ kind, file: extra, own: false });
      else if (src && src.slot === kind) out.push({ kind, file: src.file, own: true });
    }
    return out;
  };
  /** Name of the CusDec file (or the bundle holding it) a line is saved with, without its extension. */
  const fileName = (i: number) => {
    const r = pending!.lines[i];
    if (r.file_name) return r.file_name;
    const d = lineDocs(firstOf(i));
    const f = d.find((x) => x.kind === "cusdec") ?? d.find((x) => x.kind === "all");
    return f ? baseName(f.file) : "";
  };
  /** Documents cell of a line: the slots on the first line of each declaration. */
  const docsCell = (i: number) => {
    if (!pending || firstOf(i) !== i) return <span className="text-muted">as above</span>;
    const held = lineDocs(i);
    return (
      <div className="flex flex-col gap-1">
        {CUSTOMS_DOC_KINDS.map(({ kind, label }) => {
          const d = held.find((x) => x.kind === kind);
          return (
            <div key={kind} className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="text-muted w-[110px]">{label}</span>
              {d ? (
                <>
                  <span className="pill pill-good max-w-[180px] truncate" title={d.own ? `${d.file.name} (the file read; change its slot in the files table)` : d.file.name}>
                    {d.file.name}
                  </span>
                  {!d.own && (
                    <button className="btn btn-icon" type="button" title="Remove" aria-label={`Remove ${label} file, line ${i + 1}`} onClick={() => setDoc(i, kind, null)}>
                      ×
                    </button>
                  )}
                </>
              ) : (
                <button
                  className="btn"
                  type="button"
                  aria-label={`Attach ${label} file, line ${i + 1}`}
                  onClick={() => {
                    docTarget.current = { i, kind };
                    docRef.current?.click();
                  }}
                >
                  Attach
                </button>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  /** A cell of the lines table: plain text for spreadsheet lines, a box that writes back for lines read off a file (OCR can misread). */
  const cell = (i: number, r: CustomsUploadRow, field: keyof CustomsUploadRow, kind: "text" | "num", width = "w-[90px]") => {
    const v = r[field];
    if (pending!.origin[i] < 0) return kind === "num" ? (v == null ? "" : fmt(v as number)) : ((v as string) ?? "");
    return (
      <NumOrText
        key={`${i}:${field}`}
        kind={kind}
        value={v == null ? "" : String(v)}
        className={width}
        label={`${String(field).replace(/_/g, " ")}, line ${i + 1}`}
        onCommit={(s) => {
          if (kind === "text") setLine(i, { [field]: s.trim() || null } as Partial<CustomsUploadRow>);
          else {
            const t = s.replace(/,/g, "").trim();
            const n = t === "" ? null : Number(t);
            if (n != null && isNaN(n)) {
              flash(`“${s}” is not a number.`, true);
              return;
            }
            setLine(i, { [field]: n } as Partial<CustomsUploadRow>);
          }
        }}
      />
    );
  };

  const files = pending?.files ?? [];
  const toAttach = files.filter((f) => f.action === "attach" && f.key);
  const adding = files.filter((f) => f.action === "import").length;
  const replacingFiles = files.filter((f) => f.action === "replace" && f.key).length;
  const unsorted = files.filter((f) => f.action === "skip").length;
  const lineRows = pending ? visible.map((i) => pending.lines[i]) : [];

  // Import entries may have no invoice number (logbook entries); exports are matched to the sales report by it.
  const incomplete = lineRows.filter((r) => !r.cusdec_no.trim() || (!isImport && !r.invoice_no.trim())).length;
  // New lines of a CusDec already in the Import Register (from a spreadsheet, or a file sorted as new): saving
  // replaces its lines. Also those held under the same CusDec number and month with a different invoice number
  // (a logbook entry without one, or the invoice written differently), which saving would add a second time.
  const norm = (s: string) => s.toUpperCase().replace(/\s+/g, "");
  const heldExact = isImport ? new Set(entries.map((e) => e.cusdec_no + "|" + e.invoice_no)) : null;
  const heldMonth = isImport ? new Set(entries.map((e) => norm(e.cusdec_no) + "|" + (e.cusdec_month ?? ""))) : null;
  const isNew = (i: number) => pending!.origin[i] < 0 || pending!.files[pending!.origin[i]].action === "import";
  const isHeld = (i: number) => isNew(i) && !!heldExact?.has(declKey(pending!.lines[i]));
  const isNear = (i: number) =>
    isNew(i) && !isHeld(i) && !!heldMonth?.has(norm(pending!.lines[i].cusdec_no) + "|" + (pending!.lines[i].cusdec_month ?? ""));
  const heldNos = pending ? [...new Set(visible.filter(isHeld).map((i) => pending.lines[i].cusdec_no.trim()))] : [];
  const nearNos = pending ? [...new Set(visible.filter(isNear).map((i) => pending.lines[i].cusdec_no.trim()))] : [];
  const replacing = pending ? new Set(visible.filter(isHeld).map((i) => declKey(pending.lines[i]))).size : 0;
  const near = pending ? new Set(visible.filter(isNear).map((i) => declKey(pending.lines[i]))).size : 0;
  // Show only the lines flagged as already held or a possible duplicate.
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const listed = onlyFlagged && replacing + near > 0 ? visible.filter((i) => isHeld(i) || isNear(i)) : visible;

  /** Leave out the new lines of CusDecs already in the register (exact or same CusDec and month). */
  function leaveOutHeld() {
    if (!pending) return;
    const drop = pending.lines.map((_, i) => shown(pending, i) && (isHeld(i) || isNear(i)));
    const skipFiles = new Set(pending.lines.map((_, i) => (drop[i] && pending.origin[i] >= 0 ? pending.origin[i] : -1)));
    const keep = pending.lines.map((_, i) => !drop[i] || pending.origin[i] >= 0);
    setPending({
      ...pending,
      files: pending.files.map((f, j) => (skipFiles.has(j) ? { ...f, action: "skip" } : f)),
      lines: pending.lines.filter((_, i) => keep[i]),
      notes: pending.notes.filter((_, i) => keep[i]),
      docs: pending.docs.filter((_, i) => keep[i]),
      origin: pending.origin.filter((_, i) => keep[i]),
      text: `Left out ${replacing + near} CusDec${replacing + near === 1 ? "" : "s"} already in ${register}.`,
    });
  }

  /** Declaration the lines of a line are saved under: the held one it replaces, or its own numbers. */
  const saveKey = (i: number): { cusdec_no: string; invoice_no: string } => {
    const r = pending!.lines[i];
    const f = pending!.origin[i] >= 0 ? pending!.files[pending!.origin[i]] : null;
    const d = f?.action === "replace" ? byKey.get(f.key) : undefined;
    return d ? { cusdec_no: d.cusdec_no, invoice_no: d.invoice_no } : { cusdec_no: r.cusdec_no.trim(), invoice_no: r.invoice_no.trim() };
  };

  async function save() {
    if (!pending || !company || incomplete) return;
    let saved: { entries?: number; applied?: number } | null = null;
    if (visible.length) {
      setBusy("Saving…");
      const { data, error } = await supabase.rpc("upload_customs_entries", {
        p_company: company.id,
        p_direction: direction,
        p_rows: visible.map((i) => ({ ...pending.lines[i], ...saveKey(i) })),
      });
      if (error) {
        setBusy(null);
        flash(
          "Could not save: " +
            error.message +
            (/schema cache|function|file_name/i.test(error.message) ? ". Run the latest supabase/migrations (0014_tab_permissions.sql) in the Supabase SQL Editor first." : ""),
          true,
        );
        return;
      }
      saved = (data ?? {}) as { entries?: number; applied?: number };
    }

    // Documents: those of the saved lines (one file per declaration and slot), then the files attached to held CusDecs.
    const toStore: { key: { cusdec_no: string; invoice_no: string }; kind: CustomsDocKind; file: File }[] = [];
    const seen = new Set<string>();
    for (const i of visible) {
      if (firstOf(i) !== i) continue;
      const key = saveKey(i);
      for (const { kind, file } of lineDocs(i)) {
        const k = declKey(key) + "|" + kind;
        if (seen.has(k)) continue;
        seen.add(k);
        toStore.push({ key, kind, file });
      }
    }
    const errors: string[] = [];
    for (const f of toAttach) {
      const d = byKey.get(f.key)!;
      if (customsDoc(d.entry, f.slot) && !canReplace) {
        errors.push(`${f.file.name}: the slot already holds a file and replacing it needs delete permission`);
        continue;
      }
      toStore.push({ key: { cusdec_no: d.cusdec_no, invoice_no: d.invoice_no }, kind: f.slot, file: f.file });
    }
    let stored = 0;
    for (let i = 0; i < toStore.length; i++) {
      const { key, kind, file } = toStore[i];
      setBusy(`Storing document ${i + 1} of ${toStore.length}…`);
      try {
        await uploadCustomsDocument(supabase, company.id, direction, key, kind, file);
        stored++;
      } catch (err) {
        errors.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    setBusy(null);
    startOver();
    await reload();
    await onDone?.();
    flash(
      (saved
        ? `Saved ${saved.entries ?? visible.length} ${noun} customs entries` +
          (isImport ? " to the Import Register." : `; the customs columns of ${saved.applied ?? 0} matching sales invoices were filled in.`)
        : "") +
        ` ${stored} document${stored === 1 ? "" : "s"} kept.` +
        (errors.length ? ` Not kept: ${errors.join("; ")}` : ""),
      errors.length > 0,
    );
  }

  const declLabel = (d: HeldDeclaration) => `${d.cusdec_no} · ${d.invoice_no}${d.cusdec_date ? " · " + d.cusdec_date : ""}`;
  const nothing = !visible.length && !toAttach.length;
  const fileControl = "control file:mr-2 file:border-0 file:bg-transparent file:text-ink file:font-medium";

  return (
    <div className="panel">
      <h2 className="text-[15px] font-semibold m-0">Upload {noun} customs documents</h2>
      <div className="note">
        Choose the paperwork, several files or a whole folder: CusDec printouts, scanned bundles (the CusDec among the
        invoice, packing list and other papers), or the other papers on their own. Each file is read, by OCR for scans
        (about a minute a file), and sorted: a <b>new CusDec</b> has its lines added to {register}, with every item, HS code,
        value{isImport ? ", CID, PAL, SSCL and VAT" : ""}; a <b>CusDec already held</b> only gets the file attached; any
        other paper is attached to the CusDec you choose for it. Check the table, then save. An index sheet chosen with the
        files (columns File, Cusdec No, Invoice No, Date, Value for VAT, VAT) is used instead of OCR for the files it lists.
        CusDec lines can also be uploaded from a spreadsheet laid out like the template.
      </div>
      <div className="bar">
        <label className="field">
          Files
          <input className={fileControl} type="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv" multiple disabled={!!busy} onChange={(e) => void onFiles(e)} />
        </label>
        <label className="field">
          or a folder
          <input className={fileControl} type="file" disabled={!!busy} onChange={(e) => void onFiles(e)} {...{ webkitdirectory: "", directory: "" }} />
        </label>
        <label className="field">
          Spreadsheet of CusDec lines
          <input className={fileControl} type="file" accept=".xlsx,.xls,.csv" disabled={!!busy} onChange={onSheet} />
        </label>
        <button className="btn" type="button" onClick={() => downloadWorkbook(customsTemplateWorkbook(direction), customsTemplateFilename(direction))}>
          Download template
        </button>
      </div>
      {busy && busy !== "Saving…" && <div className="note">{busy}</div>}
      {parseError && <div className="msg msg-err">{parseError}</div>}
      {pending && (
        <>
          {files.length > 0 && (
            <>
              <div className="msg">
                {files.length} file{files.length === 1 ? "" : "s"} read: {adding} new CusDec{adding === 1 ? "" : "s"} to add
                {replacingFiles ? `, ${replacingFiles} replacing the lines of a CusDec held` : ""}, {toAttach.length} to attach to a CusDec
                held{unsorted ? `, ${unsorted} left out (choose a CusDec for any that belong to one)` : ""}.
              </div>
              <div className="scroll max-h-[45vh]">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>File</th>
                      <th>Read off the file</th>
                      <th>What to do</th>
                      <th>CusDec in the register</th>
                      <th>Keep as</th>
                      <th>Now held</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.map((r, i) => {
                      const d = r.key && r.action !== "import" ? byKey.get(r.key) : undefined;
                      const now = d && r.action !== "skip" ? customsDoc(d.entry, r.slot) : null;
                      const rd = r.reading;
                      return (
                        <tr key={i} className={r.action === "skip" ? "text-muted" : undefined}>
                          <td className="whitespace-nowrap">{r.file.name}</td>
                          <td className="wrapc">
                            {rd
                              ? [
                                  rd.cusdec_no && `CusDec ${rd.cusdec_no}`,
                                  rd.invoice_no && `invoice ${rd.invoice_no}`,
                                  rd.cusdec_date,
                                  rd.vat_amount != null && `VAT ${fmt(rd.vat_amount)}`,
                                ]
                                  .filter(Boolean)
                                  .join(" · ") || "—"
                              : "—"}
                          </td>
                          <td>
                            <select
                              className="control"
                              value={r.action}
                              disabled={!!busy}
                              aria-label={`What to do with ${r.file.name}`}
                              onChange={(e) => {
                                const action = e.target.value as Action;
                                setFile(i, { action });
                              }}
                            >
                              {r.hasLines && <option value="import">Add as a new CusDec</option>}
                              {held.length > 0 && <option value="attach">Attach to a CusDec held</option>}
                              {r.hasLines && held.length > 0 && (
                                <option value="replace" disabled={!canReplace}>
                                  Replace a held CusDec’s lines{canReplace ? "" : " (needs delete permission)"}
                                </option>
                              )}
                              <option value="skip">Leave out</option>
                            </select>
                          </td>
                          <td>
                            {r.action === "import" ? (
                              <span className="text-muted">new</span>
                            ) : (
                              <select
                                className={"control max-w-[300px]" + (r.action !== "skip" && !r.key ? " border-bad" : "")}
                                value={r.key}
                                disabled={!!busy || held.length === 0}
                                aria-label={`CusDec for ${r.file.name}`}
                                onChange={(e) => {
                                  const key = e.target.value;
                                  setFile(i, { key, how: key ? "chosen" : null, action: !key ? "skip" : r.action === "skip" ? "attach" : r.action });
                                }}
                              >
                                <option value="">— choose —</option>
                                {held.map((h) => (
                                  <option key={h.key} value={h.key}>
                                    {declLabel(h)}
                                  </option>
                                ))}
                              </select>
                            )}
                            {r.how && r.action !== "import" && r.key && <div className="text-muted text-xs">by {r.how}</div>}
                          </td>
                          <td>
                            <select
                              className="control"
                              value={r.slot}
                              disabled={!!busy || r.action === "skip"}
                              aria-label={`Keep ${r.file.name} as`}
                              onChange={(e) => setFile(i, { slot: e.target.value as CustomsDocKind })}
                            >
                              {CUSTOMS_DOC_KINDS.map((k) => (
                                <option key={k.kind} value={k.kind}>
                                  {k.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="wrapc">
                            {now ? (
                              canReplace ? (
                                <span title="Replaced on saving">{now.filename}</span>
                              ) : (
                                <span className="text-warn" title="Replacing needs delete permission">
                                  {now.filename} (kept: replacing needs delete permission)
                                </span>
                              )
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                          <td className="wrapc">{r.note && <span className="text-warn">{r.note}</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {pending.text && <div className="msg">{pending.text}</div>}
          {(replacing > 0 || near > 0) && (
            <div className="msg msg-warn">
              {replacing > 0 && (
                <div>
                  <span className="pill pill-warn">Already held</span> {replacing} of these CusDecs {replacing === 1 ? "is" : "are"} already in{" "}
                  {register}: saving replaces {replacing === 1 ? "its" : "their"} lines with the ones below (documents already attached are kept):{" "}
                  <b>{heldNos.join(", ")}</b>
                </div>
              )}
              {near > 0 && (
                <div className="mt-1">
                  <span className="pill pill-bad">Possible duplicate</span> {near} more {near === 1 ? "has" : "have"} the CusDec number and month
                  of an entry already held but a different invoice number: saving would add {near === 1 ? "it" : "them"} a second time:{" "}
                  <b>{nearNos.join(", ")}</b>
                </div>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <button className="btn" type="button" onClick={leaveOutHeld} disabled={!!busy}>
                  Leave out the {replacing + near} already held
                </button>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />
                  Show only these lines in the table
                </label>
              </div>
            </div>
          )}
          <input ref={docRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={onDocPicked} />
          {visible.length > 0 && (
            <>
              <h3 className="text-[14px] font-semibold mt-3 mb-1">
                Lines to save ({visible.length}): check the figures{files.length ? " read off the files (every box can be corrected)" : ""}
              </h3>
              <div className="scroll max-h-[36vh]">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>File name</th>
                      <th>Cusdec no</th>
                      <th>Date</th>
                      <th>Invoice no</th>
                      <th className="num">Item</th>
                      <th>HS code</th>
                      <th>Qty</th>
                      <th>Currency</th>
                      <th className="num">Ex. rate</th>
                      <th className="num">Invoice value (FC)</th>
                      <th className="num">Customs value (LKR)</th>
                      {isImport && <th className="num">CID</th>}
                      {isImport && <th className="num">PAL</th>}
                      {isImport && <th className="num">SSCL</th>}
                      {isImport && <th className="num">Value for VAT</th>}
                      {isImport && <th className="num">VAT</th>}
                      <th>{isImport ? "Supplier" : "Consignee"}</th>
                      <th>Documents</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listed.slice(0, 200).map((i) => {
                      const r = pending.lines[i];
                      const read = pending.origin[i] >= 0;
                      const replaces = read && pending.files[pending.origin[i]].action === "replace";
                      const flag = isHeld(i) ? "held" : isNear(i) ? "near" : null;
                      return (
                        <tr
                          key={i}
                          className={flag === "held" ? "bg-warn-soft" : flag === "near" ? "bg-bad-soft" : undefined}
                          style={flag ? { boxShadow: `inset 4px 0 0 var(--${flag === "held" ? "warn" : "bad"})` } : undefined}
                        >
                          <td className="wrapc">
                            {flag === "held" && <div className="pill pill-warn mb-1 whitespace-nowrap">Already held: replaces</div>}
                            {flag === "near" && <div className="pill pill-bad mb-1 whitespace-nowrap">Possible duplicate</div>}
                            {fileName(i) || <span className="text-muted">—</span>}
                          </td>
                          <td>
                            {read && !replaces ? (
                              <input className="control w-[100px]" value={r.cusdec_no} aria-label={`CusDec number, line ${i + 1}`} onChange={(e) => setLine(i, { cusdec_no: e.target.value })} />
                            ) : (
                              saveKey(i).cusdec_no
                            )}
                          </td>
                          <td>{cell(i, r, "cusdec_date", "text", "w-[95px]")}</td>
                          <td>
                            {replaces ? (
                              saveKey(i).invoice_no
                            ) : (
                              <input
                                className={"control w-[150px]" + (r.invoice_no.trim() || isImport ? "" : " border-bad")}
                                value={r.invoice_no}
                                aria-label={`Invoice number, line ${i + 1}`}
                                placeholder={isImport ? "" : "Required"}
                                onChange={(e) => setLine(i, { invoice_no: e.target.value })}
                              />
                            )}
                          </td>
                          <td className="num">{r.item_no}</td>
                          <td>{cell(i, r, "hs_code", "text", "w-[100px]")}</td>
                          <td className="whitespace-nowrap">
                            {read ? (
                              <>
                                {cell(i, r, "quantity", "num", "w-[80px]")} {cell(i, r, "uom", "text", "w-[55px]")}
                              </>
                            ) : r.quantity == null ? (
                              ""
                            ) : (
                              `${r.quantity} ${r.uom ?? ""}`.trim()
                            )}
                          </td>
                          <td>{cell(i, r, "currency_type", "text", "w-[55px]")}</td>
                          <td className="num">{cell(i, r, "ex_rate", "num", "w-[90px]")}</td>
                          <td className="num">{cell(i, r, "invoice_value", "num", "w-[100px]")}</td>
                          <td className="num">{cell(i, r, "customs_value", "num", "w-[110px]")}</td>
                          {isImport && <td className="num">{cell(i, r, "cid_amount", "num")}</td>}
                          {isImport && <td className="num">{cell(i, r, "pal_amount", "num")}</td>}
                          {isImport && <td className="num">{cell(i, r, "sscl_amount", "num")}</td>}
                          {isImport && <td className="num">{cell(i, r, "vat_base", "num", "w-[110px]")}</td>}
                          {isImport && <td className="num">{cell(i, r, "vat_amount", "num", "w-[100px]")}</td>}
                          <td className="wrapc">{r.party}</td>
                          <td>{docsCell(i)}</td>
                          <td className="wrapc">
                            {replaces && i === firstOf(i) && <div className="text-warn">Replaces the lines held for this CusDec</div>}
                            {pending.notes[i]?.map((n, j) => (
                              <div key={j} className={j === 0 ? "text-muted" : "diffx font-normal"}>
                                {n}
                              </div>
                            ))}
                          </td>
                        </tr>
                      );
                    })}
                    {listed.length > 200 && (
                      <tr>
                        <td colSpan={19} className="note">
                          … and {listed.length - 200} more lines.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div className="bar">
            <button className="btn btn-primary" type="button" onClick={() => void save()} disabled={!!busy || incomplete > 0 || nothing}>
              {busy === "Saving…"
                ? "Saving…"
                : [
                    visible.length ? (isImport ? `Save ${visible.length} line${visible.length === 1 ? "" : "s"}` : `Save ${visible.length} entr${visible.length === 1 ? "y" : "ies"}`) : "",
                    toAttach.length ? `attach ${toAttach.length} file${toAttach.length === 1 ? "" : "s"}` : "",
                  ]
                    .filter(Boolean)
                    .join(" and ")
                    .replace(/^a/, "A") || "Nothing to save"}
            </button>
            <button className="btn" type="button" onClick={startOver} disabled={!!busy}>
              Cancel
            </button>
            {incomplete > 0 && (
              <span className="note pb-1.5">
                {incomplete} line{incomplete === 1 ? " needs" : "s need"} a CusDec number{isImport ? "" : " and an invoice number"} before saving.
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
