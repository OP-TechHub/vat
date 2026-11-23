/** Placeholder for a tab whose screen is still being built (Registers: phase 2, TIEP: phases 3 and 4). */
export default function ComingSoon({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="panel">
      <h2 className="text-[15px] font-semibold m-0">{title}</h2>
      <p className="note m-0">This screen is being built.{children ? " " : ""}{children}</p>
    </div>
  );
}
