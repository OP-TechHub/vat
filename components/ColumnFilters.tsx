"use client";

import { useCallback, useMemo, useState } from "react";
import { cellMatches, type CellValue } from "@/lib/filters";

export { cellMatches, type CellValue };

/** One filterable column of a table, in column order; `none` marks a column with no filter box. */
export interface ColumnSpec {
  key: string;
  /** Shown as the box's placeholder and accessible label; defaults to the key. */
  label?: string;
  /** Numeric column: the box accepts >, >=, <, <=, = and a..b ranges. */
  num?: boolean;
  /** No filter box (action columns). */
  none?: boolean;
  /** Extra class on the heading cell (e.g. a left border to match the column heading). */
  className?: string;
}

/** Per-column filter state for one table, and the function that applies it to the rows. */
export function useColumnFilters(columns: ColumnSpec[]) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const setFilter = useCallback((key: string, v: string) => setFilters((f) => ({ ...f, [key]: v })), []);
  const clear = useCallback(() => setFilters({}), []);
  const active = useMemo(() => Object.entries(filters).filter(([k, v]) => v.trim() && columns.some((c) => c.key === k)).length, [filters, columns]);
  const apply = useCallback(
    <T,>(rows: T[], cells: (row: T) => Record<string, CellValue>): T[] => {
      const live = Object.entries(filters).filter(([, v]) => v.trim());
      if (!live.length) return rows;
      return rows.filter((r) => {
        const c = cells(r);
        return live.every(([k, v]) => cellMatches(c[k], v));
      });
    },
    [filters],
  );
  return { filters, setFilter, clear, active, apply, columns };
}

export type ColumnFilterState = ReturnType<typeof useColumnFilters>;

/** The row of filter boxes under a table's column headings. */
export function FilterRow({ state }: { state: ColumnFilterState }) {
  const { columns, filters, setFilter } = state;
  return (
    <tr className="filters">
      {columns.map((c) =>
        c.none ? (
          <th key={c.key} className={c.className} />
        ) : (
          <th key={c.key} className={c.className}>
            <input
              type="search"
              className="control"
              value={filters[c.key] ?? ""}
              placeholder={c.num ? "e.g. >1000" : "Filter"}
              aria-label={`Filter ${c.label ?? c.key}`}
              title={c.num ? "Text to find, or >, >=, <, <=, =, a..b, blank" : "Text to find, or blank"}
              onChange={(e) => setFilter(c.key, e.target.value)}
            />
          </th>
        ),
      )}
    </tr>
  );
}

/** "Clear filters" button for the bar above the table, shown only while a filter is set. */
export function ClearFilters({ state }: { state: ColumnFilterState }) {
  if (!state.active) return null;
  return (
    <button className="btn" type="button" onClick={state.clear}>
      Clear {state.active} column filter{state.active === 1 ? "" : "s"}
    </button>
  );
}
