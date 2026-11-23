"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApp } from "./AppShell";
import { moduleDef, tabsOf } from "@/lib/permissions";

/** The top level after login: one card per module the user can open. With only one, go straight in. */
export default function ModuleHome() {
  const { company, modules, perm, loading } = useApp();
  const router = useRouter();

  const firstTab = (m: (typeof modules)[number]) => tabsOf(m).find((t) => perm(t.key).view)?.href ?? moduleDef(m).base;

  useEffect(() => {
    if (!loading && modules.length === 1) router.replace(firstTab(modules[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, modules]);

  if (loading) return <div className="note">Loading…</div>;
  if (!company) return <div className="panel note">You are not a member of any company yet. Ask a company admin to add you.</div>;
  if (!modules.length)
    return (
      <div className="panel note">You have no access to any module of {company.name}. Ask a company admin to give you access.</div>
    );

  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
      {modules.map((m) => {
        const d = moduleDef(m);
        return (
          <Link key={m} href={firstTab(m)} className="panel no-underline hover:border-accent">
            <h2 className="text-[17px] font-semibold m-0">{d.label}</h2>
            {d.title !== d.label && <div className="text-[13px] text-muted">{d.title}</div>}
            <p className="note m-0">{d.description}</p>
          </Link>
        );
      })}
    </div>
  );
}
