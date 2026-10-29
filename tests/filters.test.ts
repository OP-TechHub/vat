import { describe, expect, it } from "vitest";
import { cellMatches } from "@/lib/filters";

describe("column filter boxes", () => {
  it("blank filter matches everything; text is a case-insensitive contains", () => {
    expect(cellMatches("Oceanpick", "")).toBe(true);
    expect(cellMatches("FISH FEED - NUTRILA BRAND", "nutrila")).toBe(true);
    expect(cellMatches("FISH FEED", "feed x")).toBe(false);
    expect(cellMatches(null, "x")).toBe(false);
  });

  it("numbers match with or without thousands separators and with comparisons", () => {
    expect(cellMatches(1313863, "1,313")).toBe(true);
    expect(cellMatches(1313863, "1313863")).toBe(true);
    expect(cellMatches(1313863, ">1,000,000")).toBe(true);
    expect(cellMatches(1313863, "<=1000000")).toBe(false);
    expect(cellMatches(1313863, "=1313863")).toBe(true);
    expect(cellMatches(1313863, "1000000..2000000")).toBe(true);
    expect(cellMatches(0, ">0")).toBe(false);
    expect(cellMatches("27,000.00", ">=27000")).toBe(true);
  });

  it("yes / no cells and blank cells", () => {
    expect(cellMatches(true, "yes")).toBe(true);
    expect(cellMatches(false, "yes")).toBe(false);
    expect(cellMatches("Yes report.pdf", "no")).toBe(false);
    expect(cellMatches(null, "blank")).toBe(true);
    expect(cellMatches("", "blank")).toBe(true);
    expect(cellMatches("x", "blank")).toBe(false);
  });
});
