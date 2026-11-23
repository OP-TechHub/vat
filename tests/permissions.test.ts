import { describe, expect, it } from "vitest";
import {
  FULL_ACCESS,
  MODULES,
  NO_ACCESS,
  moduleOfPath,
  permMap,
  presetRows,
  tabOfPath,
  TABS,
  visibleModules,
} from "../lib/permissions";

describe("permMap", () => {
  it("gives admins everything on every tab", () => {
    const m = permMap(true, []);
    for (const t of TABS) expect(m[t.key]).toEqual(FULL_ACCESS);
  });

  it("gives members only the tabs they have a row for", () => {
    const m = permMap(false, [
      { tab: "invoices", can_upload: false, can_edit: true, can_delete: true },
      { tab: "summary", can_upload: false, can_edit: false, can_delete: false },
    ]);
    expect(m.invoices).toEqual({ view: true, upload: false, edit: true, delete: true });
    expect(m.summary).toEqual({ view: true, upload: false, edit: false, delete: false });
    expect(m.imports).toEqual(NO_ACCESS);
    expect(m.tiep_register).toEqual(NO_ACCESS);
  });

  it("never grants an action the tab does not offer", () => {
    const m = permMap(false, [{ tab: "tiep_ledger", can_upload: true, can_edit: true, can_delete: true }]);
    expect(m.tiep_ledger).toEqual({ view: true, upload: false, edit: true, delete: true });
  });
});

describe("presetRows", () => {
  it("viewer gives view only on every tab", () => {
    const rows = presetRows("viewer");
    expect(rows.map((r) => r.tab)).toEqual(TABS.map((t) => t.key));
    expect(rows.every((r) => !r.can_upload && !r.can_edit && !r.can_delete)).toBe(true);
  });

  it("editor gives only the actions a tab offers", () => {
    const rows = presetRows("editor");
    expect(rows.find((r) => r.tab === "summary")).toEqual({ tab: "summary", can_upload: false, can_edit: false, can_delete: false });
    expect(rows.find((r) => r.tab === "tiep_summary")).toEqual({ tab: "tiep_summary", can_upload: false, can_edit: false, can_delete: false });
    expect(rows.find((r) => r.tab === "filing")).toEqual({ tab: "filing", can_upload: true, can_edit: false, can_delete: true });
    expect(rows.find((r) => r.tab === "imports")).toEqual({ tab: "imports", can_upload: true, can_edit: true, can_delete: true });
  });
});

describe("paths", () => {
  it("maps paths to tabs", () => {
    expect(tabOfPath("/vat/ird-status")).toBe("ird_status");
    expect(tabOfPath("/vat/exports")).toBe("exports");
    expect(tabOfPath("/registers/imports")).toBe("reg_imports");
    expect(tabOfPath("/tiep/status/entries")).toBe("tiep_status");
    expect(tabOfPath("/members")).toBeNull();
    expect(tabOfPath("/vat/summaryx")).toBeNull();
    expect(tabOfPath("/")).toBeNull();
  });

  it("maps paths to modules", () => {
    expect(moduleOfPath("/vat/summary")).toBe("vat");
    expect(moduleOfPath("/tiep")).toBe("tiep");
    expect(moduleOfPath("/registers/local-sales")).toBe("registers");
    expect(moduleOfPath("/members")).toBeNull();
    expect(moduleOfPath("/vatx")).toBeNull();
  });

  it("puts every tab under its module's path", () => {
    for (const t of TABS) expect(moduleOfPath(t.href)).toBe(t.module);
  });
});

describe("visibleModules", () => {
  it("needs the module switched on and at least one viewable tab", () => {
    const perms = permMap(false, [
      { tab: "summary", can_upload: false, can_edit: false, can_delete: false },
      { tab: "tiep_register", can_upload: false, can_edit: false, can_delete: false },
    ]);
    expect(visibleModules(["registers", "vat"], perms)).toEqual(["vat"]);
    expect(visibleModules(["registers", "vat", "tiep"], perms)).toEqual(["vat", "tiep"]);
  });

  it("shows admins every switched-on module, in top-level order", () => {
    expect(visibleModules(["tiep", "vat", "registers"], permMap(true, []))).toEqual(MODULES.map((m) => m.key));
  });
});
