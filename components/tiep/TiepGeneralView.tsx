"use client";

import { useEffect, useState } from "react";
import { useApp } from "../AppShell";
import { useTiep } from "./TiepProvider";
import { fdate, todayISO } from "@/lib/tiep/model";

/** Settings › General: cancellation period, as-at date and bank guarantee. */
export default function TiepGeneralView() {
  const { supabase, company, user, flash } = useApp();
  const { settings, perm, reload } = useTiep();
  const [period, setPeriod] = useState("365");
  const [asAt, setAsAt] = useState("");
  const [guarantee, setGuarantee] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPeriod(String(settings?.period_days ?? 365));
    setAsAt(settings?.as_at ?? "");
    setGuarantee(settings?.guarantee != null ? String(settings.guarantee) : "");
  }, [settings]);

  async function save() {
    if (!company) return;
    const p = Math.round(Number(period));
    if (!(p > 0)) return flash("The cancellation period must be a number of days above zero.", true);
    setBusy(true);
    const { error } = await supabase.from("tiep_settings").upsert(
      {
        company_id: company.id,
        period_days: p,
        as_at: asAt || null,
        guarantee: guarantee.trim() === "" ? null : Number(guarantee),
        ...(settings ? { updated_at: new Date().toISOString(), updated_by: user.id } : { created_by: user.id }),
      },
      { onConflict: "company_id" },
    );
    setBusy(false);
    if (error) return flash("Could not save: " + error.message, true);
    flash("TIEP settings saved.");
    await reload();
  }

  const w = perm.settings.edit;
  return (
    <div className="panel">
      <h2 className="text-[15px] font-semibold m-0">General</h2>
      <div className="bar">
        <label className="field">
          Cancellation period (days after the import date)
          <input className="control w-[140px]" type="number" min="1" value={period} disabled={!w} onChange={(e) => setPeriod(e.target.value)} />
        </label>
        <label className="field">
          As at (blank = today)
          <input className="control" type="date" value={asAt} disabled={!w} onChange={(e) => setAsAt(e.target.value)} />
        </label>
        <label className="field">
          Bank guarantee (LKR)
          <input className="control w-[180px]" type="number" min="0" step="any" value={guarantee} disabled={!w} onChange={(e) => setGuarantee(e.target.value)} />
        </label>
        {w && (
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </button>
        )}
      </div>
      <p className="note m-0">
        A TIEP line is due for cancellation {settings?.period_days ?? 365} days after its CusDec date and overdue once the
        as-at date ({fdate(settings?.as_at ?? todayISO())}) passes that with a balance left. Fix the as-at date to report
        the register at a past date, for example a year end.
      </p>
    </div>
  );
}
