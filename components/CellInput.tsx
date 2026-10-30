"use client";

import { useState } from "react";

/**
 * Reads a typed number with the given decimal places: null when blank, undefined when it is not a
 * number. Thousands separators are ignored.
 */
export function parseCellNumber(v: string, places = 2): number | null | undefined {
  const s = v.replace(/,/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  if (isNaN(n)) return undefined;
  const p = 10 ** places;
  return Math.round(n * p) / p;
}

/** Admin switch that turns the uploaded columns of a table into inputs. */
export function EditSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 pb-1.5 text-[13px] cursor-pointer">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      Edit uploaded data
    </label>
  );
}

/** Text or number box that saves on blur or Enter and restores the saved value on Escape. */
export default function CellInput({
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
