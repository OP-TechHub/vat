import { SubNav } from "@/components/tiep/ui";

const ITEMS = [
  { href: "/tiep/settings/standards", label: "Conversion standards" },
  { href: "/tiep/settings/items", label: "System items & mapping" },
  { href: "/tiep/settings/tiep-items", label: "TIEP items" },
  { href: "/tiep/settings/confirm-mapping", label: "Confirm export mapping" },
  { href: "/tiep/settings/mapping-vs-mud", label: "Item mapping vs MUD" },
  { href: "/tiep/settings/general", label: "General" },
  { href: "/tiep/settings/documents", label: "Documents" },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SubNav items={ITEMS} />
      {children}
    </>
  );
}
