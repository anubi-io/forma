import { describe, expect, it } from "vitest";
import { parseProgram } from "../src/engine/parse";
import { sequenceProgram } from "../src/engine/sequence";
import {
  STRIDE,
  WORK_SYSTEMS,
  type Program,
  type WorkOffsets,
} from "../src/types";

const ends = (p: Program) =>
  Array.from({ length: p.moves.length / STRIDE }, (_, n) =>
    Array.from(p.moves.slice(n * STRIDE + 3, n * STRIDE + 6)),
  );

describe("work coordinate systems", () => {
  it.each(WORK_SYSTEMS)(
    "accepts G%s as the program's single work zero",
    (system) => {
      const p = parseProgram(
        `G21 G90\nM220 S100\nM223 S100\nT1 M6\nG${system}\nG0 X10 Y10 Z5\nG1 Z-1 F600\nX20\nG28\nT2 M6\nG${system}\nG0 X10 Y20\nZ5\nG1 Z-2\nX20`,
      );
      expect(p.workSystems).toEqual([system]);
      expect(p.tools).toEqual([1, 2]);
      expect(ends(p).at(-1)).toEqual([20, 20, -2]);
    },
  );
  it("accepts G55 after machine-coordinate setup rapids", () => {
    const p = parseProgram(
      "G53 G0 Z-2\nG53 G0 X-2 Y-2\nG55\nT2 M6\nG0 X10 Y20\nZ5\nG1 Z-1 F600\nX20",
    );
    expect(p.workSystems).toEqual([55]);
    expect(ends(p)).toEqual([
      [10, 20, -1],
      [20, 20, -1],
    ]);
  });
  it("preserves the physical position when switching and applies offsets only to absolute words", () => {
    const p = parseProgram(
      "G54 G90\nG0 X10 Y20 Z5\nG55\nG1 X1 Y2 Z-1 F600\nG91\nX2 Z-2\nG90 G54\nG0 X0 Y0 Z10",
      { workOffsets: { 55: [30, 40, 50] } },
    );
    expect(ends(p)).toEqual([
      [10, 20, 5],
      [31, 42, 49],
      [33, 42, 47],
      [0, 0, 10],
    ]);
    expect(Array.from(p.moves.slice(STRIDE, STRIDE + 3))).toEqual([10, 20, 5]);
    expect(p.workSystems).toEqual([54, 55]);
  });
  it("keeps omitted axes fixed when a work offset changes", () => {
    const p = parseProgram("G0 X10 Y20 Z5\nG55\nG1 X2 F600", {
      workOffsets: { 55: [30, 40, 50] },
    });
    expect(ends(p).at(-1)).toEqual([32, 20, 5]);
  });
  it("keeps setup offsets in mm even when program units change", () => {
    const p = parseProgram("G20 G55 G90\nG0 X1 Y1 Z1\nG21\nG1 X2 Y3 Z4 F600", {
      workOffsets: { 55: [-30, 4, 8] },
    });
    for (const [actual, expected] of ends(p)[0].map((v, i) => [
      v,
      [-4.6, 29.4, 33.4][i],
    ]))
      expect(actual).toBeCloseTo(expected);
    expect(ends(p).at(-1)).toEqual([-28, 7, 12]);
  });
  it.each([
    [17, "X10 Y0 Z0", "X0 Y10 I0 J0", [30, 50, 50]],
    [18, "Z10 X0 Y0", "Z0 X10 K0 I0", [40, 40, 50]],
    [19, "Y10 Z0 X0", "Y0 Z10 J0 K0", [30, 40, 60]],
  ] as const)(
    "translates absolute arc centers in G%s",
    (plane, start, end, expected) => {
      const p = parseProgram(
        `G55 G${plane} G90 G90.1\nG0 ${start}\nG3 ${end} F600`,
        { workOffsets: { 55: [30, 40, 50] } },
      );
      expect(ends(p).at(-1)).toEqual(expected);
      expect(p.moves.length / STRIDE).toBeGreaterThan(10);
    },
  );
  it("leaves relative arc centers and R arcs unchanged", () => {
    for (const center of ["I-10 J0", "R10"]) {
      const p = parseProgram(`G55\nG0 X10 Y0 Z2\nG3 X0 Y10 ${center} F600`, {
        workOffsets: { 55: [30, 40, 50] },
      });
      expect(ends(p).at(-1)).toEqual([30, 50, 52]);
    }
  });
  it("recovers at the new work zero after G28 and a Carvera automatic tool change", () => {
    const p = parseProgram(
      "G54\nT1 M6\nG0 X5 Y5 Z5\nG1 Z-1\nG28\nM6 T2\nG55\nG0 X2 Y3\nZ5\nG1 Z-2 F600",
      { workOffsets: { 55: [20, 0, 0] } },
    );
    expect(Array.from(p.moves.slice(-STRIDE, -STRIDE + 6))).toEqual([
      22, 3, 5, 22, 3, -2,
    ]);
    expect(p.toolChanges.map((t) => t.tool)).toEqual([1, 2]);
  });
  it.each(["M496.2", "M496.5 X0 Y0"])(
    "translates controller work positioning %s",
    (command) => {
      const p = parseProgram(`G55\n${command}\nG0 Z5\nG1 X2 Z-1 F600`, {
        workOffsets: { 55: [20, 30, 40] },
      });
      expect(Array.from(p.moves.slice(0, 6))).toEqual([20, 30, 45, 22, 30, 39]);
    },
  );
  it("explains how to supply missing offsets instead of guessing shared zeros", () => {
    expect(() => parseProgram("G0 X10\nG55\nG1 X20")).toThrow(
      /Stock → Work offsets/,
    );
    expect(() => parseProgram("G55\nG1 X20", { workOffsets: {} })).toThrow(
      /G55 needs an XYZ offset/,
    );
    expect(() =>
      parseProgram("G56\nG1 X20", { workOffsets: { 55: [1, 2, 3] } }),
    ).toThrow(/G56 needs/);
  });
  it.each([
    null,
    [],
    { 54: [0, 0, 0] },
    { 55: [1, 2] },
    { 55: [NaN, 0, 0] },
    { 55: [0, "0", 0] },
    { 60: [0, 0, 0] },
  ])("rejects malformed work offsets %j", (workOffsets) => {
    expect(() =>
      parseProgram("G1 X1", { workOffsets: workOffsets as WorkOffsets }),
    ).toThrow(/Invalid work offsets/);
  });
  it("preserves work-system labels when sequencing both faces", () => {
    const p = sequenceProgram(
      parseProgram("G55\nG1 X1"),
      parseProgram("G59.3\nG1 X2"),
      "bottom",
    );
    expect(p.workSystems).toEqual([55, 59.3]);
  });
});
