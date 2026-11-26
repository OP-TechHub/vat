import { GroupSubNav } from "@/components/tiep/ui";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <GroupSubNav group="tiep_status" />
      {children}
    </>
  );
}
