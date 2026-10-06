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
import { loadInvoices, loadReturns, loadRole, loadScheduleLines } from "@/lib/data";
import { monthsOf, taxYearOf, yearLabel } from "@/lib/format";
import { pm } from "@/lib/reports";
import { exportWorkbook } from "@/lib/export";
import { downloadWorkbook } from "@/lib/download";
import type { Company, Invoice, Role, ScheduleLine, VatReturn } from "@/lib/types";

export interface YearData {
  /** Invoices posted in the year, plus ones from other years claimed in this year. */
  invoices: Invoice[];
  schedule: ScheduleLine[];
  returns: VatReturn[];
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
  patchReturn: (r: VatReturn) => void;
  flash: (text: string | null, err?: boolean) => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside AppShell");
  return v;
}

const EMPTY: YearData = { invoices: [], schedule: [], returns: [] };
const LS_COMPANY = "vat.company";
const LS_YEAR = "vat.year";

const currentTaxYear = () => taxYearOf(new Date().toISOString().slice(0, 10));

const TABS: { href: string; label: string; admin?: boolean }[] = [
  { href: "/summary", label: "Summary" },
  { href: "/invoices", label: "Invoice listing" },
  { href: "/schedule", label: "IRD input schedule" },
  { href: "/returns", label: "VAT reconciliation" },
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
      const [invoices, schedule, returns, r] = await Promise.all([
        loadInvoices(supabase, companyId, year),
        loadScheduleLines(supabase, companyId, year),
        loadReturns(supabase, companyId, year),
        loadRole(supabase, companyId, user.id),
      ]);
      if (id !== reqId.current) return;
      setData({ invoices, schedule, returns });
      setRole(r);
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

  const years = useMemo(() => {
    const cur = currentTaxYear();
    const ys: number[] = [];
    for (let y = Math.min(2024, year); y <= Math.max(cur + 1, year); y++) ys.push(y);
    return ys;
  }, [year]);

  function exportExcel() {
    const { wb, filename } = exportWorkbook(year, data.invoices, data.schedule, data.returns);
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
