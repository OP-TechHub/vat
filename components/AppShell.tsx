"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Db } from "@/lib/supabase/schema";
import { createClient } from "@/lib/supabase/client";
import { loadExportSales, loadImportPurchases, loadInvoices, loadReturns, loadRole, loadScheduleLines } from "@/lib/data";
import { monthsOf, taxYearOf, yearLabel } from "@/lib/format";
import { pm } from "@/lib/reports";
import { exportWorkbook } from "@/lib/export";
import { downloadWorkbook } from "@/lib/download";
import type { Company, ExportSale, Invoice, Role, ScheduleLine, VatReturn } from "@/lib/types";

export interface YearData {
  /** Invoices posted in the year, plus ones from other years claimed in this year. */
  invoices: Invoice[];
  schedule: ScheduleLine[];
  returns: VatReturn[];
  /** Export reconciliation rows for sales-report months in the year. */
  exports: ExportSale[];
  /** Import reconciliation rows for purchase-ledger months in the year. */
  imports: ExportSale[];
}

export interface AppState {
  supabase: Db;
  user: { id: string; email: string };
  companies: Company[];
  company: Company | null;
  setCompany: (id: string) => void;
  year: number;
  setYear: (y: number) => void;
  /** Month keys of the selected tax year, April to March. */
  months: string[];
  role: Role | null;
  canWrite: boolean;
  isAdmin: boolean;
  data: YearData;
  /** Only the invoices posted within the selected tax year. */
  yearInvoices: Invoice[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  patchInvoice: (inv: Invoice) => void;
  patchScheduleLine: (line: ScheduleLine) => void;
  patchExportSale: (row: ExportSale) => void;
  patchImportPurchase: (row: ExportSale) => void;
  patchReturn: (r: VatReturn) => void;
  flash: (text: string | null, err?: boolean) => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside AppShell");
  return v;
}

const EMPTY: YearData = { invoices: [], schedule: [], returns: [], exports: [], imports: [] };
const LS_COMPANY = "vat.company";
const LS_YEAR = "vat.year";

const currentTaxYear = () => taxYearOf(new Date().toISOString().slice(0, 10));
/** Earliest tax year offered: April 2019 to March 2020, which holds the first filing period (Jan 2020). */
const FIRST_TAX_YEAR = 2019;

/** PostgREST's error when a table, view or column from an unapplied migration is queried. */
const isMissingTable = (e: unknown) =>
  e instanceof Error && /schema cache|does not exist|relation .* not found/i.test(e.message);

const TABS: { href: string; label: string; admin?: boolean }[] = [
  { href: "/summary", label: "Summary" },
  { href: "/invoices", label: "Invoice listing" },
  { href: "/schedule", label: "IRD input schedule" },
  { href: "/exports", label: "Export reconciliation" },
  { href: "/imports", label: "Import reconciliation" },
  { href: "/returns", label: "VAT reconciliation" },
  { href: "/filing", label: "Return filing" },
  { href: "/ird-status", label: "IRD status" },
  { href: "/members", label: "Members", admin: true },
];

export default function AppShell({
  user,
  companies,
  loadError,
  children,
}: {
  user: { id: string; email: string };
  companies: Company[];
  loadError: string | null;
  children: ReactNode;
}) {
  const supabase = useMemo(() => createClient(), []);
  const pathname = usePathname();

  const [ready, setReady] = useState(false);
  const [companyId, setCompanyId] = useState<string>(companies[0]?.id ?? "");
  const [year, setYearState] = useState<number>(currentTaxYear());
  const [role, setRole] = useState<Role | null>(null);
  const [data, setData] = useState<YearData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(loadError);
  const [flashMsg, setFlashMsg] = useState<{ text: string; err: boolean } | null>(null);
  const reqId = useRef(0);

  // Restore the last company and tax year from this browser.
  useEffect(() => {
    try {
      const c = localStorage.getItem(LS_COMPANY);
      if (c && companies.some((x) => x.id === c)) setCompanyId(c);
      const y = Number(localStorage.getItem(LS_YEAR));
      if (y >= 2000 && y <= 2100) setYearState(y);
    } catch {
      /* storage unavailable */
    }
    setReady(true);
  }, [companies]);

  const setCompany = useCallback((id: string) => {
    setCompanyId(id);
    try {
      localStorage.setItem(LS_COMPANY, id);
    } catch {
      /* ignore */
    }
  }, []);
  const setYear = useCallback((y: number) => {
    setYearState(y);
    try {
      localStorage.setItem(LS_YEAR, String(y));
    } catch {
      /* ignore */
    }
  }, []);

  const reload = useCallback(async () => {
    if (!companyId) {
      setData(EMPTY);
      setRole(null);
      setLoading(false);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      // Tables added by later migrations must not take the whole app down when a project has not
      // run them yet: load them separately and fall back to an empty list with a notice.
      const missing: string[] = [];
      const optional = <T,>(p: Promise<T[]>, name: string) =>
        p.catch((e: unknown) => {
          if (isMissingTable(e)) {
            missing.push(name);
            return [] as T[];
          }
          throw e;
        });
      const [invoices, schedule, returns, exports, imports, r] = await Promise.all([
        loadInvoices(supabase, companyId, year),
        loadScheduleLines(supabase, companyId, year),
        loadReturns(supabase, companyId, year),
        optional(loadExportSales(supabase, companyId, year), "0004_export_sales.sql"),
        optional(loadImportPurchases(supabase, companyId, year), "0008_customs_entries.sql"),
        loadRole(supabase, companyId, user.id),
      ]);
      if (id !== reqId.current) return;
      setData({ invoices, schedule, returns, exports, imports });
      setRole(r);
      if (missing.length)
        setError(
          `This Supabase project is missing newer database objects. Run ${missing.join(", ")} from supabase/migrations in the SQL Editor (see README step 2). Until then the affected tab shows no data.`,
        );
    } catch (e) {
      if (id !== reqId.current) return;
      setError(e instanceof Error ? e.message : "Could not load records.");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [supabase, companyId, year, user.id]);

  useEffect(() => {
    if (ready) void reload();
  }, [ready, reload]);

  // Clear any flash message when switching tabs.
  useEffect(() => {
    setFlashMsg(null);
  }, [pathname]);

  const patchInvoice = useCallback((inv: Invoice) => {
    setData((d) => ({ ...d, invoices: d.invoices.map((x) => (x.id === inv.id ? inv : x)) }));
  }, []);
  const patchScheduleLine = useCallback((line: ScheduleLine) => {
    setData((d) => ({ ...d, schedule: d.schedule.map((x) => (x.id === line.id ? line : x)) }));
  }, []);
  const patchExportSale = useCallback((row: ExportSale) => {
    setData((d) => ({ ...d, exports: d.exports.map((x) => (x.id === row.id ? row : x)) }));
  }, []);
  const patchImportPurchase = useCallback((row: ExportSale) => {
    setData((d) => ({ ...d, imports: d.imports.map((x) => (x.id === row.id ? row : x)) }));
  }, []);
  const patchReturn = useCallback((r: VatReturn) => {
    setData((d) => {
      const others = d.returns.filter((x) => x.return_month !== r.return_month);
      return { ...d, returns: [...others, r].sort((a, b) => a.return_month.localeCompare(b.return_month)) };
    });
  }, []);
  const flash = useCallback((text: string | null, err = false) => {
    setFlashMsg(text ? { text, err } : null);
  }, []);

  const company = companies.find((c) => c.id === companyId) ?? null;
  const canWrite = role === "editor" || role === "admin";
  const isAdmin = role === "admin";
  const months = useMemo(() => monthsOf(year), [year]);
  const yearInvoices = useMemo(() => data.invoices.filter((r) => months.includes(pm(r))), [data.invoices, months]);

  // Tax years from 2019/20 (the filing register starts Jan 2020) to next year.
  const years = useMemo(() => {
    const cur = currentTaxYear();
    const ys: number[] = [];
    for (let y = Math.min(FIRST_TAX_YEAR, year); y <= Math.max(cur + 1, year); y++) ys.push(y);
    return ys;
  }, [year]);

  function exportExcel() {
    const { wb, filename } = exportWorkbook(year, data.invoices, data.schedule, data.returns, data.exports, data.imports);
    downloadWorkbook(wb, filename);
  }

  const state: AppState = {
    supabase,
    user,
    companies,
    company,
    setCompany,
    year,
    setYear,
    months,
    role,
    canWrite,
    isAdmin,
    data,
    yearInvoices,
    loading,
    error,
    reload,
    patchInvoice,
    patchScheduleLine,
    patchExportSale,
    patchImportPurchase,
    patchReturn,
    flash,
  };

  return (
    <Ctx.Provider value={state}>
      <div className="max-w-[1280px] mx-auto px-4 pt-5 pb-12 flex flex-col gap-4">
        <header className="flex flex-wrap gap-3 items-end justify-between">
          <div>
            <h1 className="text-[22px] font-semibold m-0">VAT Input Claims Register</h1>
            <div className="note">
              {loading
                ? "Loading records…"
                : company
                  ? `${yearInvoices.length} ledger invoices held for ${yearLabel(year)}` +
                    (role ? ` · ${role}` : "")
                  : "You are not a member of any company yet."}
            </div>
          </div>
          <div className="bar">
            <label className="field">
              Company
              <select
                className="control"
                value={companyId}
                onChange={(e) => setCompany(e.target.value)}
                disabled={!companies.length}
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                {!companies.length && <option value="">No companies</option>}
              </select>
            </label>
            <label className="field">
              Tax year
              <select className="control" value={year} onChange={(e) => setYear(+e.target.value)}>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {yearLabel(y)}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn" type="button" onClick={exportExcel} disabled={loading || !company}>
              Export to Excel
            </button>
            <form action="/auth/signout" method="post" className="flex flex-col gap-1 items-end">
              <span className="text-xs text-muted truncate max-w-[200px]" title={user.email}>
                {user.email}
              </span>
              <button className="btn" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </header>

        <nav className="flex flex-wrap gap-1 border-b border-line" aria-label="Sections">
          {TABS.filter((t) => !t.admin || isAdmin).map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="tab"
              aria-current={pathname === t.href || pathname.startsWith(t.href + "/") ? "page" : undefined}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        {error && <div className="msg msg-err">{error}</div>}
        {flashMsg && (
          <div className={"msg" + (flashMsg.err ? " msg-err" : "")} role="status">
            {flashMsg.text}
          </div>
        )}

        <main className="flex flex-col gap-4">{children}</main>
      </div>
    </Ctx.Provider>
  );
}
