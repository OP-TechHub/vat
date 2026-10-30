import { describe, expect, it } from "vitest";
import { describeSet, fieldChanges, rowFields, rowLabel, tabLabel, type ChangeRow, type ChangeSet } from "../lib/changeLog";

const set = (patch: Partial<ChangeSet>): ChangeSet => ({
  id: 1,
  changed_at: "2026-10-30T10:00:00Z",
  changed_by: null,
  email: null,
  label: null,
  kind: "edit",
  undo_of: null,
  undone_by: null,
  undone_at: null,
  tabs: [],
  n_insert: 0,
  n_update: 0,
  n_delete: 0,
  ...patch,
});

const row = (patch: Partial<ChangeRow>): ChangeRow => ({
  id: 1,
  tbl: "ledger_invoices",
  tab: "invoices",
  op: "UPDATE",
  row_key: { id: "x" },
  old_row: null,
  new_row: null,
  subject_email: null,
  ...patch,
});

describe("describeSet", () => {
  it("uses the server label when there is one", () => {
    expect(describeSet(set({ label: "Uploaded the ledger invoice list for May 2026", n_insert: 3 }))).toBe(
      "Uploaded the ledger invoice list for May 2026",
    );
  });

  it("counts rows otherwise", () => {
    expect(describeSet(set({ n_update: 1 }))).toBe("Changed 1 row");
    expect(describeSet(set({ n_insert: 2, n_delete: 1 }))).toBe("Added 2 rows, removed 1 row");
  });
});

describe("fieldChanges", () => {
  it("lists changed fields and skips bookkeeping", () => {
    const r = row({
      old_row: { id: "x", original_invoice: null, amount_lcy: 100, updated_at: "a" },
      new_row: { id: "x", original_invoice: "Yes", amount_lcy: 100, updated_at: "b" },
    });
    expect(fieldChanges(r)).toEqual([{ field: "original invoice", before: "blank", after: "Yes" }]);
  });
});

describe("rowLabel and rowFields", () => {
  it("names records by table", () => {
    expect(rowLabel(row({ new_row: { invoice_no: "INV-1" } }))).toBe("Invoice INV-1");
    expect(rowLabel(row({ tbl: "vat_returns", new_row: { return_month: "2026-05-01" } }))).toMatch(/^Return /);
    expect(
      rowLabel(row({ tbl: "company_member_permissions", new_row: { tab: "imports", user_id: "u" }, subject_email: "m@x" })),
    ).toBe("Import Register access of m@x");
  });

  it("shows the filled fields of a removed row", () => {
    const r = row({ op: "DELETE", old_row: { id: "x", invoice_no: "INV-1", vendor_name: null, amount_lcy: 5 } });
    expect(rowFields(r)).toBe("invoice no: INV-1 · amount lcy: 5");
  });

  it("names the Members tab", () => {
    expect(tabLabel("members")).toBe("Members");
    expect(tabLabel("ird_status")).toBe("IRD status");
  });
});
