"use client";

import ReconView from "./ReconView";
import { useApp } from "./AppShell";

export default function ExportsView() {
  const { data, patchExportSale } = useApp();
  return <ReconView direction="export" rows={data.exports} onPatched={patchExportSale} />;
}
