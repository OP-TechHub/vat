import { describe, expect, it } from "vitest";
import { FULL_ACCESS, NO_ACCESS, permMap, presetRows, tabOfPath, TABS } from "../lib/permissions";

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
    expect(rows.find((r) => r.tab === "filing")).toEqual({ tab: "filing", can_upload: true, can_edit: false, can_delete: true });
    expect(rows.find((r) => r.tab === "imports")).toEqual({ tab: "imports", can_upload: true, can_edit: true, can_delete: true });
  });
});

describe("tabOfPath", () => {
  it("maps paths to tabs", () => {
    expect(tabOfPath("/ird-status")).toBe("ird_status");
    expect(tabOfPath("/exports")).toBe("exports");
    expect(tabOfPath("/members")).toBeNull();
    expect(tabOfPath("/summaryx")).toBeNull();
  });
});
