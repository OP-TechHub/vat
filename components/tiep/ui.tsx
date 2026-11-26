"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { LineStatus, Req, TiepLine } from "@/lib/tiep/model";
import { useApp } from "@/components/AppShell";
import { TABS, type TabGroup } from "@/lib/permissions";

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Whole number, "–" for zero / blank. */
export const n0 = (v: number | null | undefined) => (v ? nf0.format(Math.round(v)) : "–");
/** Two decimals, "–" for zero / blank. */
export const n2 = (v: number | null | undefined) => (v ? nf2.format(v) : "–");
export const mil = (v: number) => "LKR " + (v / 1e6).toFixed(1) + "M";
export const count = (v: number) => nf0.format(v);

const STATUS_CLASS: Partial<Record<LineStatus, string>> = {
  Open: "chip-open",
  "Partially cancelled": "chip-part",
  "Fully cancelled": "chip-full",
  "Over-cancelled": "chip-bad",
  "Over-planned": "chip-bad",
  "Partly planned": "chip-plan",
  "Fully planned": "chip-plan",
  "Details pending": "chip-pend",
};

export function StatusChip({ line }: { line: Pick<TiepLine, "status" | "overdue"> }) {
  return (
    <>
      <span className={"chip " + (STATUS_CLASS[line.status] ?? "")}>{line.status}</span>
      {line.overdue && <span className="chip chip-bad ml-1">Overdue</span>}
    </>
  );
}

export function PostingChip({ status }: { status: string }) {
  return status === "Planned" ? <span className="chip chip-plan">Planned</span> : <span className="chip chip-done">Completed</span>;
}

export function ReqChip({ req }: { req: Req }) {
  return <span className={"chip " + (req === "Confirm" ? "chip-plan" : "")}>{req}</span>;
}

export function Progress({ pct }: { pct: number | null }) {
  if (pct == null) return null;
  const p = Math.max(0, Math.min(1, pct)) * 100;
  return (
    <div className="pbar" title={p.toFixed(1) + "%"}>
      <i style={{ width: p.toFixed(1) + "%" }} />
    </div>
  );
}

export function Tiles({ items }: { items: { k: string; v: string; x?: string; tone?: "a" | "w" | "b" | "" }[] }) {
  return (
    <div className="tiles">
      {items.map((t) => (
        <div key={t.k} className={"tile " + (t.tone ?? "")}>
          <div className="k">{t.k}</div>
          <div className="v">{t.v}</div>
          {t.x && <div className="x">{t.x}</div>}
        </div>
      ))}
    </div>
  );
}

/** Sub-tabs inside a TIEP tab (TIEP Status, Settings). */
export function SubNav({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1.5" aria-label="Sub-views">
      {items.map((i) => {
        const on = pathname === i.href || pathname.startsWith(i.href + "/");
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={on ? "page" : undefined}
            className={
              "px-3 py-1 rounded-full text-[13px] font-medium border " +
              (on ? "bg-accent text-accent-ink border-accent" : "border-line text-ink hover:border-accent")
            }
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Sub-tab strip of TIEP Status or Settings: the sub-tabs the user may view. */
export function GroupSubNav({ group }: { group: TabGroup["key"] }) {
  const { perm } = useApp();
  const items = TABS.filter((t) => t.group === group && perm(t.key).view).map((t) => ({ href: t.href, label: t.label }));
  return <SubNav items={items} />;
}

/** Index page of TIEP Status or Settings: opens the first sub-tab the user may view. */
export function GroupIndex({ group }: { group: TabGroup["key"] }) {
  const { perm, loading } = useApp();
  const router = useRouter();
  const first = TABS.find((t) => t.group === group && perm(t.key).view);
  useEffect(() => {
    if (first) router.replace(first.href);
  }, [first, router]);
  if (loading || first) return null;
  return <div className="panel note">You have no access to any part of this tab. Ask a company admin to give you access.</div>;
}

/** A modal dialog, open while mounted. */
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={"modal" + (wide ? " wide" : "")}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="flex justify-between items-center gap-3 px-4 py-3 border-b border-line">
        <h2 className="text-[15px] font-semibold m-0">{title}</h2>
        <button className="btn py-0" type="button" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="px-4 py-4 flex flex-col gap-4 overflow-auto max-h-[calc(100vh-180px)]">{children}</div>
      <div className="flex justify-end gap-2 px-4 py-3 border-t border-line">
        {footer ?? (
          <button className="btn" type="button" onClick={onClose}>
            Close
          </button>
        )}
      </div>
    </dialog>
  );
}

/** Label / value pairs. */
export function KeyValues({ items }: { items: [string, ReactNode][] }) {
  return (
    <div className="grid gap-x-5 gap-y-2.5 text-[13px] [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
      {items.map(([k, v]) => (
        <div key={k}>
          <span className="block text-[11.5px] text-muted">{k}</span>
          <b className="font-medium tabular-nums break-words">{v}</b>
        </div>
      ))}
    </div>
  );
}
