import { describe, expect, it } from "vitest";
import { analyzeEfficiency } from "../src/engine/analysisEfficiency";
import { analyzeProgram } from "../src/engine/analyze";
import { parseProgram } from "../src/engine/parse";
import { sequenceProgram } from "../src/engine/sequence";
import { STRIDE, type Stock, type Tool } from "../src/types";

const stock: Stock = {
  x: 100,
  y: 100,
  z: 10,
  origin: "corner",
  zOrigin: "top",
};
const tool: Tool = { id: "flat", name: "Flat", kind: "flat", diameter: 4 };
const header = "G21 G90\nT1 M6\nM3 S12000\n";
const cycles = (surface = 0, rapid = false) =>
  Array.from(
    { length: 20 },
    () => `G1 X24 Z${surface - 1} F60\n${rapid ? "G0" : "G1"} X20 Z${surface}`,
  ).join("\n");
const pass = (y = 20, surface = 0) =>
  `G0 Z${surface + 3}\nG0 X20 Y${y}\nG1 Z${surface} F100\n${cycles(surface)}\nG0 Z${surface + 3}`;

describe("machining time diagnostics", () => {
  it("retains all 16 occurrences and reports affected duration without adding it to savings", () => {
    const p = parseProgram(
      header +
        Array.from({ length: 16 }, (_, i) => pass(10 + i * 5)).join("\n"),
    );
    const report = analyzeProgram(p, stock, { 1: tool }, "aluminum");
    const result = report.findings.find((f) => f.kind === "repeated-reentry")!;
    expect(result.occurrences).toBe(16);
    expect(result.locations).toHaveLength(16);
    expect(result.durationSeconds).toBeGreaterThan(2500);
    expect(result.durationSeconds).toBeCloseTo(
      result.locations.reduce(
        (sum, location) => sum + location.durationSeconds!,
        0,
      ),
    );
    expect(result.seconds).toBe(0);
    expect(result.severity).toBe("opportunity");
    expect(report.optimizableSeconds).toBeCloseTo(result.durationSeconds!);
    expect(report.savingsSeconds).toBe(
      report.repeatedSeconds + report.emptySeconds,
    );
    for (const location of result.locations) {
      const i = location.focusMoveIndex * STRIDE;
      expect(p.moves[i + 2]).toBe(-1);
      expect(p.moves[i + 5]).toBe(0);
      expect(location.detail).toContain("20 feed returns");
    }
  });
  it("counts overlapping repeats once and adds separate opportunities outside the expensive pass", () => {
    const cycle = "G1 X24 Z-1 F60\nG1 X20 Z-1\nG1 X24 Z-1\nG1 X20 Z0";
    const code =
      header +
      "G0 X20 Y20 Z3\nG1 Z0 F100\n" +
      Array.from({ length: 20 }, () => cycle).join("\n") +
      "\nG0 Z3";
    const result = analyzeProgram(
      parseProgram(code),
      stock,
      { 1: tool },
      "aluminum",
    );
    const reentry = result.findings.find((f) => f.kind === "repeated-reentry")!;
    expect(result.repeatedSeconds).toBeGreaterThan(0);
    expect(result.optimizableSeconds).toBeCloseTo(reentry.durationSeconds!);
    expect(result.optimizableSeconds).toBeLessThan(
      result.savingsSeconds + reentry.durationSeconds!,
    );
    const separate = analyzeProgram(
      parseProgram(
        code + "\nG0 X50 Y80\nG1 Z-1 F100\nG1 X70 F600\nG1 X50\nG0 Z3",
      ),
      stock,
      { 1: tool },
      "aluminum",
    );
    expect(separate.optimizableSeconds).toBeCloseTo(
      result.optimizableSeconds + 2,
    );
    expect(separate.optimizableSeconds).toBeLessThan(separate.totalSeconds);
  });
  it("keeps geometric warnings out of the optimization total and separates faces by global segment", () => {
    const warning = analyzeProgram(
      parseProgram(header + "G0 X20 Y20 Z3\nG1 Z-11 F100\nG1 X98 F600"),
      stock,
      { 1: tool },
      "aluminum",
    );
    expect(warning.findings.length).toBeGreaterThan(0);
    expect(warning.optimizableSeconds).toBe(0);
    const p = parseProgram(header + pass());
    const single = analyzeProgram(p, stock, { 1: tool }, "aluminum");
    const both = analyzeProgram(
      sequenceProgram(p, p, "top"),
      stock,
      { 1: tool },
      "aluminum",
    );
    expect(both.optimizableSeconds).toBeCloseTo(single.optimizableSeconds * 2);
  });
  it("does not flag a smooth slow ramp, ordinary positioning or rounding noise as repeated returns", () => {
    const smooth =
      "G0 X20 Y20 Z3\nG1 Z0 F100\n" +
      Array.from(
        { length: 50 },
        (_, i) => `G1 X${i % 2 ? 20 : 24} Z${-(i + 1) / 50} F60`,
      ).join("\n");
    const rapid = `G0 X20 Y20 Z3\nG1 Z0 F100\n${cycles(0, true)}`;
    const noise =
      "G0 X20 Y20 Z3\nG1 Z0 F100\n" +
      Array.from({ length: 20 }, () => "G1 X24 Z-0.01 F60\nG1 X20 Z0").join(
        "\n",
      );
    for (const code of [smooth, rapid, noise])
      expect(
        analyzeEfficiency(parseProgram(header + code), stock, { 1: tool }),
      ).toEqual([]);
  });
  it("does not treat drill pecks, thread mills or missing tools as inefficient milling", () => {
    const p = parseProgram(header + pass());
    expect(analyzeEfficiency(p, stock, {})).toEqual([]);
    for (const kind of ["unsupported", "thread", "v"] as const)
      expect(analyzeEfficiency(p, stock, { 1: { ...tool, kind } })).toEqual([]);
    const vertical = parseProgram(
      header +
        "G0 X20 Y20 Z3\nG1 Z0 F100\n" +
        Array.from({ length: 20 }, () => "G1 Z-1 F20\nG1 Z0").join("\n"),
    );
    expect(analyzeEfficiency(vertical, stock, { 1: tool })).toEqual([]);
  });
  it("uses the selected Z origin and preserves separate TOP/BOTTOM locations", () => {
    const a = parseProgram(header + pass());
    const b = parseProgram(header + pass(20, 10));
    const top = analyzeEfficiency(a, stock, { 1: tool })[0];
    const bottomOrigin = analyzeEfficiency(
      b,
      { ...stock, zOrigin: "bottom" },
      { 1: tool },
    )[0];
    expect(bottomOrigin.detail).toBe(top.detail);
    expect(bottomOrigin.durationSeconds).toBeCloseTo(top.durationSeconds!);
    const both = analyzeEfficiency(sequenceProgram(a, a, "bottom"), stock, {
      1: tool,
    });
    expect(both.map((f) => f.side)).toEqual(["bottom", "top"]);
    expect(both[1].locations[0].focusMoveIndex).toBe(
      top.locations[0].focusMoveIndex + a.moves.length / STRIDE,
    );
  });
});
