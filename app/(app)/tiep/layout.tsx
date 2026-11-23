import TiepProvider from "@/components/tiep/TiepProvider";

export default function TiepLayout({ children }: { children: React.ReactNode }) {
  return <TiepProvider>{children}</TiepProvider>;
}
