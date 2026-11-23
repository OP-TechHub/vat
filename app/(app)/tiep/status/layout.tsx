import { SubNav } from "@/components/tiep/ui";

const ITEMS = [
  { href: "/tiep/status/entries", label: "By customs entry" },
  { href: "/tiep/status/cancels", label: "By cancellation entry" },
  { href: "/tiep/status/post", label: "Post cancellation" },
  { href: "/tiep/status/local", label: "Local sales batches" },
  { href: "/tiep/status/logbook", label: "Logbook check" },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SubNav items={ITEMS} />
      {children}
    </>
  );
}
