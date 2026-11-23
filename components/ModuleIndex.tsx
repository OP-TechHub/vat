"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "./AppShell";
import { tabsOf, type ModuleKey } from "@/lib/permissions";

/** /vat, /registers, /tiep: open the module's first tab the user may view. */
export default function ModuleIndex({ module }: { module: ModuleKey }) {
  const { perm, loading } = useApp();
  const router = useRouter();
  const first = tabsOf(module).find((t) => perm(t.key).view);
  useEffect(() => {
    if (!loading) router.replace(first?.href ?? "/");
  }, [loading, first, router]);
  return <div className="note">Loading…</div>;
}
