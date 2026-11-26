"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useApp } from "../AppShell";
import { EMPTY_TIEP, loadTiep, type TiepData } from "@/lib/tiep/data";
import { buildLines, orphans, todayISO, type TiepLine } from "@/lib/tiep/model";
import {
  MUD_DEFAULTS,
  buildInvoiceViews,
  computeProposals,
  queueSubjects,
  type MudConfig,
  type TiepGroup,
  type TiepInvoice,
} from "@/lib/tiep/invoices";
import type { Perm } from "@/lib/permissions";

export interface TiepState extends TiepData {
  /** Import lines, with Pending confirmation (FIFO proposals) included. */
  lines: TiepLine[];
  lineOf: Map<string, TiepLine>;
  invoices: TiepInvoice[];
  groups: TiepGroup[];
  proposals: ReturnType<typeof computeProposals>;
  mudConfig: MudConfig;
  productMap: Record<string, string>;
  /** TIEP rows whose import line is no longer in the Import Register. */
  orphans: ReturnType<typeof orphans>;
  periodDays: number;
  asAt: string;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  perm: {
    register: Perm;
    ledger: Perm;
    /** TIEP Status › Post cancellation. */
    post: Perm;
    /** TIEP Status › Local sales batches. */
    batches: Perm;
    /** Settings sub-tabs. */
    standards: Perm;
    items: Perm;
    tiepItems: Perm;
    confirm: Perm;
    mapmud: Perm;
    general: Perm;
    documents: Perm;
    exports: Perm;
    local: Perm;
  };
}

const Ctx = createContext<TiepState | null>(null);

export function useTiep(): TiepState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTiep must be used inside TiepProvider");
  return v;
}

/** Loads the TIEP data of the selected company once for every TIEP page. */
export default function TiepProvider({ children }: { children: ReactNode }) {
  const { supabase, company, perm } = useApp();
  const [data, setData] = useState<TiepData>(EMPTY_TIEP);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const req = useRef(0);

  const reload = useCallback(async () => {
    if (!company) {
      setData(EMPTY_TIEP);
      setLoading(false);
      return;
    }
    const id = ++req.current;
    setLoading(true);
    setError(null);
    try {
      const d = await loadTiep(supabase, company.id);
      if (id === req.current) setData(d);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (id === req.current)
        setError(
          /schema cache|does not exist/i.test(msg)
            ? "The TIEP tables are missing. Run supabase/migrations/0025_tiep_core.sql in the Supabase SQL Editor."
            : "Could not load the TIEP register: " + msg,
        );
    } finally {
      if (id === req.current) setLoading(false);
    }
  }, [supabase, company]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const periodDays = data.settings?.period_days ?? 365;
  const asAt = data.settings?.as_at ?? todayISO();
  const productMap = useMemo(() => data.settings?.product_map ?? {}, [data.settings]);
  const mudConfig = useMemo(() => ({ ...MUD_DEFAULTS, ...(data.settings?.mud_config ?? {}) }), [data.settings]);
  // Balances first, then the FIFO proposals of the invoices waiting for a MUD, then the lines with those
  // proposals shown as Pending confirmation (not deducted from the balance).
  const lines0 = useMemo(
    () => buildLines(data.entries, data.exts, data.cancels, { periodDays, asAt }),
    [data.entries, data.exts, data.cancels, periodDays, asAt],
  );
  const { invoices, groups } = useMemo(
    () => buildInvoiceViews(data, { standards: data.standards, skus: data.skus, productMap }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.salesInvoices, data.salesLines, data.invExts, data.muds, data.standards, data.skus, productMap],
  );
  const proposals = useMemo(
    () => computeProposals(queueSubjects(invoices, groups), data.standards, lines0),
    [invoices, groups, data.standards, lines0],
  );
  const lines = useMemo(
    () =>
      proposals.xqty.size
        ? buildLines(data.entries, data.exts, data.cancels, { periodDays, asAt, xqty: proposals.xqty })
        : lines0,
    [lines0, proposals, data.entries, data.exts, data.cancels, periodDays, asAt],
  );
  const lineOf = useMemo(() => new Map(lines.map((r) => [r.key, r])), [lines]);
  const orph = useMemo(() => orphans(data.entries, data.exts, data.cancels), [data.entries, data.exts, data.cancels]);

  const state: TiepState = {
    ...data,
    lines,
    lineOf,
    invoices,
    groups,
    proposals,
    mudConfig,
    productMap,
    orphans: orph,
    periodDays,
    asAt,
    loading,
    error,
    reload,
    perm: {
      register: perm("tiep_register"),
      ledger: perm("tiep_ledger"),
      // TIEP Status sub-tabs
      post: perm("tiep_status_post"),
      batches: perm("tiep_status_local"),
      // Settings sub-tabs
      standards: perm("tiep_settings_standards"),
      items: perm("tiep_settings_items"),
      tiepItems: perm("tiep_settings_tiep_items"),
      confirm: perm("tiep_settings_confirm"),
      mapmud: perm("tiep_settings_mapmud"),
      general: perm("tiep_settings_general"),
      documents: perm("tiep_settings_documents"),
      exports: perm("tiep_exports"),
      local: perm("tiep_local"),
    },
  };

  return (
    <Ctx.Provider value={state}>
      {error && <div className="msg msg-err">{error}</div>}
      {!error && (orph.cancels.length > 0 || orph.exts.length > 0) && (
        <div className="msg msg-err">
          {orph.cancels.length > 0 &&
            `${orph.cancels.length} cancellation posting${orph.cancels.length === 1 ? "" : "s"} `}
          {orph.cancels.length > 0 && orph.exts.length > 0 && "and "}
          {orph.exts.length > 0 && `${orph.exts.length} line setting${orph.exts.length === 1 ? "" : "s"} `}
          refer to CusDec lines no longer in the Import Register (CusDec{" "}
          {[...new Set([...orph.cancels, ...orph.exts].map((x) => `${x.cusdec_no} item ${x.item_no}`))].slice(0, 5).join(", ")}
          …). A CusDec re-uploaded with different invoice or item numbers causes this: upload it again with the
          original numbers, or ask an admin.
        </div>
      )}
      {children}
    </Ctx.Provider>
  );
}
