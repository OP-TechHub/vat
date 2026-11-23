import { describe, expect, it } from "vitest";
import { mergePl, parseAnyDate, parsePL, toKgRows, type PlTextItem } from "../lib/tiep/packingList";

// Synthetic page items: [text, x, y] with y top-down, as pdf.js gives them after flipping.
const page = (rows: [string, number, number][]): PlTextItem[] => rows.map(([str, x, y]) => ({ str, x, y }));

// Export packing list: side-by-side CONSIGNEE / DELIVER TO, header labels on the right, a two-line
// table header and a wrapped product description.
const packing = (netHead = "Net Wt (KG)") =>
  page([
    ["PACKING LIST", 200, 40],
    ["CONSIGNEE", 40, 60], ["DELIVER TO", 200, 60], ["INVOICE NO : EX-1234", 380, 60],
    ["ACME FOODS LLC", 40, 72], ["ACME COLD STORE", 200, 72], ["DATE : 05.03.2025", 380, 72],
    ["12 Harbour Rd", 40, 84], ["Pier 9", 200, 84], ["ORDER NO", 380, 84], ["PO-77", 450, 84],
    ["Dubai", 40, 96], ["Jebel Ali", 200, 96], ["DESTINATION : DUBAI", 380, 96],
    ["VESSEL / FLIGHT : EK 649", 380, 108],
    ["AWB NO : 176-12345675", 380, 120],
    ["CONTAINER NO : MSCU1234567", 380, 132],
    ["INCOTERM : CIF", 380, 144],
    ["No", 20, 160], ["Product", 60, 160], ["Best Before", 250, 160], ["Box No.", 320, 160], ["No. of Boxes", 380, 160], [netHead, 440, 160], ["Gross Wt", 500, 160],
    ["Date", 250, 166],
    ["1", 20, 180], ["Barramundi fillet skin-on", 60, 180], ["05.03.2027", 250, 180], ["1 - 20", 320, 180], ["20", 380, 180], ["200.00", 440, 180], ["230.00", 500, 180],
    ["300-400g IQF", 60, 190],
    ["2", 20, 205], ["Barramundi whole gutted", 60, 205], ["06.03.2027", 250, 205], ["21 - 30", 320, 205], ["10", 380, 205], ["1,050.50", 440, 205], ["1,100.00", 500, 205],
    ["TOTAL", 60, 225], ["30", 380, 225], ["1,250.50", 440, 225], ["1,330.00", 500, 225],
  ]);

// Commercial invoice: stacked CONSIGNEE / DELIVER TO, label and value in separate runs, net in LBS.
const invoice = page([
  ["COMMERCIAL INVOICE", 200, 40],
  ["CONSIGNEE", 40, 60], ["INVOICE NO.", 380, 60], ["INV-9", 460, 60],
  ["BETA TRADING", 40, 72], ["DATE", 380, 72], ["12/04/2025", 460, 72],
  ["Singapore", 40, 84], ["INCOTERM: FOB", 380, 84],
  ["DELIVER TO", 40, 96], ["HC REF NO: HC-55", 380, 96],
  ["BETA WAREHOUSE", 40, 108],
  ["NO OF BOXES", 40, 140], ["DESCRIPTION OF GOODS", 120, 140], ["NET WEIGHT (LBS)", 330, 140], ["UNIT PRICE", 420, 140], ["AMOUNT", 500, 140],
  ["40", 40, 160], ["Frozen barramundi", 120, 160], ["fillets", 200, 160], ["880.00", 330, 160], ["4.50", 420, 160], ["3,960.00", 500, 160],
  ["10", 40, 172], ["Whole fish", 120, 172], ["441", 330, 172], ["1,323.00", 500, 172],
  ["50", 40, 190], ["TOTAL", 120, 190], ["1,321.00", 330, 190], ["5,283.00", 500, 190],
]);

describe("parsePL: packing list layout", () => {
  const p = parsePL([packing()]);
  it("reads the header labels", () => {
    expect(p.header).toMatchObject({
      invNo: "EX-1234", dateRaw: "05.03.2025", date: "2025-03-05", orderNo: "PO-77", destination: "DUBAI",
      vessel: "EK 649", bl: "176-12345675", container: "MSCU1234567", incoterm: "CIF", wUnit: "KG", source: "packing",
    });
  });
  it("splits side-by-side CONSIGNEE / DELIVER TO blocks", () => {
    expect(p.header.consignee).toBe("ACME FOODS LLC, 12 Harbour Rd, Dubai");
    expect(p.header.deliverTo).toBe("ACME COLD STORE, Pier 9, Jebel Ali");
  });
  it("reads rows with best-before, box range, boxes, net, gross and wrapped descriptions", () => {
    expect(p.rows).toEqual([
      { desc: "Barramundi fillet skin-on 300-400g IQF", bbd: "05.03.2027", boxRange: "1 - 20", boxes: 20, net: 200, gross: 230, price: 0, amount: 0 },
      { desc: "Barramundi whole gutted", bbd: "06.03.2027", boxRange: "21 - 30", boxes: 10, net: 1050.5, gross: 1100, price: 0, amount: 0 },
    ]);
  });
  it("takes totals from the TOTAL line", () => {
    expect(p.header).toMatchObject({ totBoxes: 30, totNet: 1250.5, totGross: 1330 });
  });
  it("detects pounds from the column heading and converts only via toKgRows", () => {
    const lb = parsePL([packing("Net Wt (LBS)")]);
    expect(lb.header.wUnit).toBe("LB");
    expect(lb.rows[0].net).toBe(200);
    const kg = toKgRows(lb, "auto");
    expect(kg.unitUsed).toBe("LB");
    expect(kg.rows[0]).toMatchObject({ net: 90.8, gross: 104.42, netIn: 200 });
    expect(kg.header).toMatchObject({ totNet: 567.727, totNetIn: 1250.5 });
    expect(toKgRows(lb, "KG").rows[0].net).toBe(200);
  });
});

describe("parsePL: commercial invoice layout", () => {
  const p = parsePL([invoice]);
  it("reads header labels with values in separate runs", () => {
    expect(p.header).toMatchObject({ invNo: "INV-9", dateRaw: "12/04/2025", date: "2025-04-12", incoterm: "FOB", hcRef: "HC-55", wUnit: "LB", source: "invoice" });
  });
  it("reads stacked CONSIGNEE / DELIVER TO blocks", () => {
    expect(p.header.consignee).toBe("BETA TRADING, Singapore");
    expect(p.header.deliverTo).toBe("BETA WAREHOUSE");
  });
  it("reads boxes | description | net | unit price | amount", () => {
    expect(p.rows).toEqual([
      { desc: "Frozen barramundi fillets", bbd: "", boxRange: "", boxes: 40, net: 880, gross: 0, price: 4.5, amount: 3960 },
      { desc: "Whole fish", bbd: "", boxRange: "", boxes: 10, net: 441, gross: 0, price: 0, amount: 1323 },
    ]);
    expect(p.header).toMatchObject({ totBoxes: 50, totNet: 1321, totGross: 0, totAmount: 5283 });
  });
  it("reports a page with no product table", () => {
    const r = parsePL([page([["HELLO", 10, 10]])]);
    expect(r.rows).toEqual([]);
    expect(r.err).toMatch(/product table/);
  });
});

describe("helpers", () => {
  it("parseAnyDate", () => {
    expect(parseAnyDate("5.3.25")).toBe("2025-03-05");
    expect(parseAnyDate("2025-3-5")).toBe("2025-03-05");
    expect(parseAnyDate("05-Mar-2025")).toBe("2025-03-05");
    expect(parseAnyDate("45721")).toBe("2025-03-05");
    expect(parseAnyDate("junk")).toBe("");
  });
  it("mergePl: non-empty values of b win; docTypes combine", () => {
    const a = { invNo: "X", vessel: "V1", totNet: 10, docType: "Packing list" };
    const b = { invNo: "", vessel: "V2", totNet: 0, docType: "Commercial invoice" };
    expect(mergePl(a, b)).toEqual({ invNo: "X", vessel: "V2", totNet: 10, docType: "Commercial invoice + packing list" });
    expect(mergePl(null, { a: 1 })).toEqual({ a: 1 });
  });
});
