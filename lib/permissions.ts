/**
 * Per-tab permissions (migration 0014). Admins may do everything; a member's access is set tab by tab:
 * no access (tab hidden, data unreadable) or view, plus any of upload, edit and delete. The database
 * enforces all of it through RLS and the upload_* functions; the UI only mirrors it.
 */

export type TabKey = "summary" | "invoices" | "schedule" | "exports" | "imports" | "returns" | "filing" | "ird_status";
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

export const TABS: { key: TabKey; href: string; label: string; actions: Action[] }[] = [
  { key: "summary", href: "/summary", label: "Summary", actions: [] },
  { key: "invoices", href: "/invoices", label: "Invoice listing", actions: ["upload", "edit", "delete"] },
  { key: "schedule", href: "/schedule", label: "IRD input schedule", actions: ["upload", "edit", "delete"] },
  { key: "exports", href: "/exports", label: "Export reconciliation", actions: ["upload", "edit", "delete"] },
  { key: "imports", href: "/imports", label: "Import Register", actions: ["upload", "edit", "delete"] },
  { key: "returns", href: "/returns", label: "VAT reconciliation", actions: ["upload", "edit", "delete"] },
  { key: "filing", href: "/filing", label: "Return filing", actions: ["upload", "delete"] },
  { key: "ird_status", href: "/ird-status", label: "IRD status", actions: ["upload", "edit", "delete"] },
];

export const ACTION_LABEL: Record<Action, string> = { upload: "Upload", edit: "Edit", delete: "Delete" };

export const NO_ACCESS: Perm = { view: false, upload: false, edit: false, delete: false };
export const FULL_ACCESS: Perm = { view: true, upload: true, edit: true, delete: true };

export type PermMap = Record<TabKey, Perm>;

/** Access per tab from the member's role and permission rows. */
export function permMap(isAdmin: boolean, rows: TabPermRow[]): PermMap {
  const out = {} as PermMap;
  for (const t of TABS) {
    if (isAdmin) {
      out[t.key] = FULL_ACCESS;
      continue;
    }
    const r = rows.find((x) => x.tab === t.key);
    out[t.key] = r ? { view: true, upload: r.can_upload, edit: r.can_edit, delete: r.can_delete } : NO_ACCESS;
  }
  return out;
}

/** The tab a path belongs to, if any (Members and unknown paths have none). */
export function tabOfPath(pathname: string): TabKey | null {
  const t = TABS.find((x) => pathname === x.href || pathname.startsWith(x.href + "/"));
  return t?.key ?? null;
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
