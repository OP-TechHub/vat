import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadCompanies } from "@/lib/data";
import AppShell from "@/components/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let companies: { id: string; name: string }[] = [];
  let loadError: string | null = null;
  try {
    companies = await loadCompanies(supabase);
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Could not load companies.";
  }

  return (
    <AppShell user={{ id: user.id, email: user.email ?? "" }} companies={companies} loadError={loadError}>
      {children}
    </AppShell>
  );
}
