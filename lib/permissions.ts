/**
 * Modules and per-tab permissions (migrations 0014 and 0023).
 *
 * The app has three modules, chosen at the top level: Registers, VAT and TIEP. A company uses a module
 * only when an admin has switched it on (company_modules). Within a module, admins may do everything;
 * a member's access is set tab by tab: no access (tab hidden, data unreadable) or view, plus any of
 * upload, edit and delete. The database enforces all of it through RLS and the upload_* functions; the
 * UI only mirrors it.
 */

export type ModuleKey = "registers" | "vat" | "tiep";

export type TabKey =
  // VAT
  | "summary"
  | "invoices"
  | "schedule"
  | "exports"
  | "imports"
  | "returns"
  | "filing"
  | "ird_status"
  | "submissions"
  // Registers
  | "reg_imports"
  | "reg_exports"
  | "reg_local"
  // TIEP
  | "tiep_summary"
  | "tiep_status"
  | "tiep_register"
  | "tiep_exports"
  | "tiep_local"
  | "tiep_ledger"
  | "tiep_settings";

export type Action = "upload" | "edit" | "delete";

export interface Perm {
  view: boolean;
  upload: boolean;
  edit: boolean;
  delete: boolean;
}

/** Row of company_member_permissions as the app reads and writes it. A row grants view. */
export interface TabPermRow {
  tab: TabKey;
  can_upload: boolean;
  can_edit: boolean;
  can_delete: boolean;
}

export interface ModuleDef {
  key: ModuleKey;
  label: string;
  /** Longer name, for the header and the home page. */
  title: string;
  /** Path prefix of the module's pages. */
  base: string;
  description: string;
}

/** Modules in the order the top level shows them. */
export const MODULES: ModuleDef[] = [
  {
    key: "registers",
    label: "Registers",
    title: "Registers",
    base: "/registers",
    description: "Upload the Import, Export and Local Sales registers once. VAT and TIEP both read them from here.",
  },
  {
    key: "vat",
    label: "VAT",
    title: "VAT Input Claims Register",
    base: "/vat",
    description: "Invoice listing, IRD schedules, export and VAT reconciliation, return filing and IRD status.",
  },
  {
    key: "tiep",
    label: "TIEP",
    title: "TIEP Import Register",
    base: "/tiep",
    description: "Duty-suspended imports under TIEP and their cancellation against exports and local sales.",
  },
];

export interface TabDef {
  key: TabKey;
  module: ModuleKey;
  href: string;
  label: string;
  actions: Action[];
}

/**
 * Tabs, grouped by module, in the order the app shows them. The actions each tab offers must agree with
 * tab_allows() in migration 0023.
 */
export const TABS: TabDef[] = [
  { key: "reg_imports", module: "registers", href: "/registers/imports", label: "Import Register", actions: ["upload", "edit", "delete"] },
  { key: "reg_exports", module: "registers", href: "/registers/exports", label: "Export Register", actions: ["upload", "edit", "delete"] },
  { key: "reg_local", module: "registers", href: "/registers/local-sales", label: "Local Sales Register", actions: ["upload", "edit", "delete"] },

  { key: "summary", module: "vat", href: "/vat/summary", label: "Summary", actions: [] },
  { key: "invoices", module: "vat", href: "/vat/invoices", label: "Invoice listing", actions: ["upload", "edit", "delete"] },
  { key: "schedule", module: "vat", href: "/vat/schedule", label: "IRD input schedule", actions: ["upload", "edit", "delete"] },
  { key: "exports", module: "vat", href: "/vat/exports", label: "Export reconciliation", actions: ["upload", "edit", "delete"] },
  { key: "imports", module: "vat", href: "/vat/imports", label: "Import Register", actions: ["upload", "edit", "delete"] },
  { key: "returns", module: "vat", href: "/vat/returns", label: "VAT reconciliation", actions: ["upload", "edit", "delete"] },
  { key: "filing", module: "vat", href: "/vat/filing", label: "Return filing", actions: ["upload", "delete"] },
  { key: "ird_status", module: "vat", href: "/vat/ird-status", label: "IRD status", actions: ["upload", "edit", "delete"] },
  { key: "submissions", module: "vat", href: "/vat/submissions", label: "Schedule submissions", actions: ["upload", "edit", "delete"] },

  { key: "tiep_summary", module: "tiep", href: "/tiep/summary", label: "Summary", actions: [] },
  { key: "tiep_status", module: "tiep", href: "/tiep/status", label: "TIEP Status", actions: ["upload", "edit", "delete"] },
  { key: "tiep_register", module: "tiep", href: "/tiep/register", label: "Import Register", actions: ["upload", "edit", "delete"] },
  { key: "tiep_exports", module: "tiep", href: "/tiep/exports", label: "Exports Register", actions: ["upload", "edit", "delete"] },
  { key: "tiep_local", module: "tiep", href: "/tiep/local", label: "Local Sales Register", actions: ["upload", "edit", "delete"] },
  { key: "tiep_ledger", module: "tiep", href: "/tiep/ledger", label: "Cancellation Ledger", actions: ["edit", "delete"] },
  { key: "tiep_settings", module: "tiep", href: "/tiep/settings", label: "Settings", actions: ["upload", "edit", "delete"] },
];

export const ACTION_LABEL: Record<Action, string> = { upload: "Upload", edit: "Edit", delete: "Delete" };

export const NO_ACCESS: Perm = { view: false, upload: false, edit: false, delete: false };
export const FULL_ACCESS: Perm = { view: true, upload: true, edit: true, delete: true };

export type PermMap = Record<TabKey, Perm>;

export const moduleDef = (m: ModuleKey): ModuleDef => MODULES.find((x) => x.key === m)!;
export const tabsOf = (m: ModuleKey): TabDef[] => TABS.filter((t) => t.module === m);

/** Access per tab from the member's role and permission rows. */
export function permMap(isAdmin: boolean, rows: TabPermRow[]): PermMap {
  const out = {} as PermMap;
  for (const t of TABS) {
    if (isAdmin) {
      out[t.key] = FULL_ACCESS;
      continue;
    }
    const r = rows.find((x) => x.tab === t.key);
    out[t.key] = r
      ? {
          view: true,
          upload: r.can_upload && t.actions.includes("upload"),
          edit: r.can_edit && t.actions.includes("edit"),
          delete: r.can_delete && t.actions.includes("delete"),
        }
      : NO_ACCESS;
  }
  return out;
}

/** The tab a path belongs to, if any (home, Members and unknown paths have none). */
export function tabOfPath(pathname: string): TabKey | null {
  const t = TABS.find((x) => pathname === x.href || pathname.startsWith(x.href + "/"));
  return t?.key ?? null;
}

/** The module a path belongs to, if any. */
export function moduleOfPath(pathname: string): ModuleKey | null {
  const m = MODULES.find((x) => pathname === x.base || pathname.startsWith(x.base + "/"));
  return m?.key ?? null;
}

/** Modules the user can open: switched on for the company, with at least one tab they may view. */
export function visibleModules(enabled: ModuleKey[], perms: PermMap): ModuleKey[] {
  return MODULES.filter((m) => enabled.includes(m.key) && tabsOf(m.key).some((t) => perms[t.key].view)).map(
    (m) => m.key,
  );
}

/** Permission rows for a preset: view on every tab, or everything on every tab. */
export function presetRows(preset: "viewer" | "editor"): TabPermRow[] {
  return TABS.map((t) => ({
    tab: t.key,
    can_upload: preset === "editor" && t.actions.includes("upload"),
    can_edit: preset === "editor" && t.actions.includes("edit"),
    can_delete: preset === "editor" && t.actions.includes("delete"),
  }));
}
