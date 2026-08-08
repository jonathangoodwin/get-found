import { describe, expect, it } from "vitest";
import { computeInterestDelta } from "../src/gap-engine/keyword-trends.js";
import type { InterestPoint } from "../src/types.js";

function points(values: number[]): InterestPoint[] {
  return values.map((value, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, value }));
}

describe("computeInterestDelta", () => {
  it("returns null when there aren't enough points for the window", () => {
    expect(computeInterestDelta(points([10, 20, 30]), { recentWindow: 4 })).toBeNull();
  });

  it("computes baseline/recent averages and a positive delta for a rising series", () => {
    const series = points([10, 10, 10, 10, 10, 10, 40, 40, 40, 40]);
    const delta = computeInterestDelta(series, { recentWindow: 4 });
    expect(delta).not.toBeNull();
    expect(delta!.baseline).toBeCloseTo(10);
    expect(delta!.recent).toBeCloseTo(40);
    expect(delta!.deltaPercent).toBeCloseTo(300);
  });

  it("computes a negative delta for a falling series", () => {
    const series = points([40, 40, 40, 40, 40, 40, 10, 10, 10, 10]);
    const delta = computeInterestDelta(series, { recentWindow: 4 });
    expect(delta!.deltaPercent).toBeCloseTo(-75);
  });

  it("treats a zero baseline with nonzero recent interest as a large positive delta without crashing", () => {
    const series = points([0, 0, 0, 0, 0, 0, 5, 5, 5, 5]);
    const delta = computeInterestDelta(series, { recentWindow: 4 });
    expect(delta!.baseline).toBe(0);
    expect(Number.isFinite(delta!.deltaPercent)).toBe(true);
    expect(delta!.deltaPercent).toBeGreaterThan(0);
  });

  it("returns a zero delta for a flat all-zero series", () => {
    const series = points(new Array(10).fill(0));
    const delta = computeInterestDelta(series, { recentWindow: 4 });
    expect(delta!.deltaPercent).toBe(0);
  });

  it("uses a default recentWindow of 7 when none is given", () => {
    expect(computeInterestDelta(points(new Array(14).fill(10)))).not.toBeNull();
    expect(computeInterestDelta(points(new Array(13).fill(10)))).toBeNull();
  });
});
