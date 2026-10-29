import { describe, expect, it } from "vitest";
import { isWordLevel, mergeWordRuns, type TextItem } from "@/lib/pdfText";
import { cusdecPageGroups, cusdecPageKind, splitCusdecs } from "@/lib/cusdec";

const t = (page: number, x: number, y: number, s: string, w = s.length * 5): TextItem => ({ page, x, y, w, s });

describe("scanner text layers and bundles", () => {
  it("joins word-by-word runs into labels, keeping separate boxes apart", () => {
    const words = [
      t(1, 100, 700, "Customs", 35),
      t(1, 138, 700.4, "Reference", 45),
      t(1, 186, 699.8, "Number:", 36),
      t(1, 300, 700, "7454", 20), // another box, far to the right
      t(1, 100, 690, "S", 5),
      t(1, 115, 690, "15820", 25),
      t(1, 170, 690, "24/09/2026", 50),
    ];
    expect(isWordLevel(words)).toBe(false); // too few runs to judge
    const merged = mergeWordRuns(words);
    // "S" and "15820" sit a box-gap apart (10 points for a one-letter run) and stay separate, as on a printout.
    expect(merged.map((i) => i.s)).toEqual(["Customs Reference Number:", "7454", "S", "15820", "24/09/2026"]);
    expect(merged[0].w).toBeCloseTo(186 + 36 - 100);
  });

  it("tells a word-level layer from a printout's", () => {
    const printout = Array.from({ length: 30 }, (_, i) => t(1, 10, 800 - i * 10, i % 3 ? "22 Currency & Total" : "12345"));
    const scanner = Array.from({ length: 30 }, (_, i) => t(1, 10, 800 - i * 10, "word" + i));
    expect(isWordLevel(printout)).toBe(false);
    expect(isWordLevel(scanner)).toBe(true);
  });

  it("finds the CusDec pages in a bundle, even with letters split apart, and renumbers them", () => {
    const items = [
      t(1, 10, 700, "COMMERCIAL INVOICE"),
      t(1, 10, 690, "INV NO 123"),
      t(2, 10, 700, "SRI LANKA CUSTOMS - GOODS DECLARATION"),
      t(2, 300, 690, "C u s t o m s"),
      t(2, 360, 690, "Reference Number:"),
      t(3, 10, 700, "GOODS DECLARATION - CONTINUATION SHEET"),
      t(4, 10, 700, "PACKING LIST"),
      t(5, 10, 700, "GOODS DECLARATION"),
      t(5, 300, 690, "Customs Reference Number:"),
    ];
    expect(cusdecPageKind(items, 1)).toBeNull();
    expect(cusdecPageKind(items, 2)).toBe("main");
    expect(cusdecPageKind(items, 3)).toBe("continuation");
    expect(cusdecPageGroups(items)).toEqual([[2, 3], [5]]);
    const decls = splitCusdecs(items);
    expect(decls).toHaveLength(2);
    expect([...new Set(decls[0].map((i) => i.page))]).toEqual([1, 2]);
    expect(decls[0].find((i) => /CONTINUATION/.test(i.s))?.page).toBe(2);
    expect([...new Set(decls[1].map((i) => i.page))]).toEqual([1]);
  });

  it("returns a document with no recognisable CusDec page whole", () => {
    const items = [t(1, 10, 700, "Hello"), t(2, 10, 700, "World")];
    expect(splitCusdecs(items)).toEqual([items]);
    expect(splitCusdecs([])).toEqual([]);
  });
});
