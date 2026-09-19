import { describe, expect, it } from "vitest";
import { stockOrigin, sceneOrigin } from "../src/engine/coordinates";
import { parseProgram } from "../src/engine/parse";
import { Simulator } from "../src/engine/simulate";
import { sequenceProgram, SequenceSimulator } from "../src/engine/sequence";
import { prepareSimulation } from "../src/engine/prepare";
import { prepareThreads } from "../src/engine/prepareThreads";
import { analyzeProgram } from "../src/engine/analyze";
import { analyzeEfficiency } from "../src/engine/analysisEfficiency";
import { toolpathGeometry } from "../src/scene/toolpath";
import { STRIDE, type Program, type Stock, type Tool } from "../src/types";

const stock: Stock = {
  x: 20,
  y: 16,
  z: 8,
  origin: "corner",
  zOrigin: "bottom",
};
const tool: Tool = {
  id: "flat",
  name: "Flat",
  kind: "flat",
  diameter: 2,
  length: 12,
};
const program = parseProgram(
  "T1 M6\nM3 S12000\nG0 X5 Y6 Z10\nG1 Z4 F200\nX15\nG0 Z10\nG0 X14 Y12\nG1 Z3\nX6",
);
function translated(p: Program, offset: number[]): Program {
  const moves = p.moves.slice();
  for (let n = 0; n < moves.length; n += STRIDE)
    for (let i = 0; i < 6; i++) moves[n + i] -= offset[i % 3];
  return { ...p, moves };
}
const cases: [string, Partial<Stock>, number[]][] = [
  ["front-left", { origin: "corner", zOrigin: "top" }, [0, 0, 8]],
  ["front-right", { origin: "front-right", zOrigin: "bottom" }, [20, 0, 0]],
  ["back-left", { origin: "back-left", zOrigin: "top" }, [0, 16, 8]],
  ["back-right", { origin: "back-right", zOrigin: "bottom" }, [20, 16, 0]],
  ["center", { origin: "center", zOrigin: "top" }, [10, 8, 8]],
  [
    "custom outside stock",
    {
      origin: "custom",
      originX: 7,
      originY: -4,
      zOrigin: "custom",
      originZ: 11,
    },
    [7, -4, 11],
  ],
  [
    "custom below stock",
    {
      origin: "custom",
      originX: -5,
      originY: 30,
      zOrigin: "custom",
      originZ: -2,
    },
    [-5, 30, -2],
  ],
];

describe("stock origins", () => {
  const base = new Simulator(program, stock, { 1: tool }, 80).seek(1);
  const prepared = prepareSimulation(program, stock, { 1: tool }, 80);
  const report = analyzeProgram(program, stock, { 1: tool }, "walnut");
  const geometry = toolpathGeometry(program, stock);
  it.each(cases)(
    "keeps material, GPU preparation, analysis and displayed coordinates aligned at %s",
    (_, settings, origin) => {
      const configured = { ...stock, ...settings };
      expect(stockOrigin(configured)).toEqual(origin);
      const path = translated(program, origin);
      const actual = new Simulator(path, configured, { 1: tool }, 80).seek(1);
      expect(actual.heights).toEqual(base.heights);
      expect(actual.removed).toBe(base.removed);
      expect(prepareSimulation(path, configured, { 1: tool }, 80).cuts).toEqual(
        prepared.cuts,
      );
      expect(analyzeProgram(path, configured, { 1: tool }, "walnut")).toEqual(
        report,
      );
      const rendered = toolpathGeometry(path, configured);
      expect(rendered.getAttribute("position").array).toEqual(
        geometry.getAttribute("position").array,
      );
      const offset = sceneOrigin(configured);
      const endpoint = Array.from(path.moves.slice(-STRIDE + 3, -STRIDE + 6));
      expect([
        endpoint[0] + offset[0],
        endpoint[2] + offset[1],
        -endpoint[1] + offset[2],
      ]).toEqual([-4, 3, -4]);
      rendered.dispose();
    },
  );
  it("places thread cutter teeth in the same volume with custom XYZ zero", () => {
    const thread: Tool = {
      ...tool,
      kind: "thread",
      pitch: 0.8,
      angle: 60,
      neck: 1,
    };
    const custom: Stock = {
      ...stock,
      origin: "custom",
      originX: 7,
      originY: -4,
      zOrigin: "custom",
      originZ: 11,
    };
    const expected = prepareThreads(program, stock, { 1: thread }, 800)!;
    const actual = prepareThreads(
      translated(program, [7, -4, 11]),
      custom,
      { 1: thread },
      800,
    )!;
    expect(actual.cuts).toEqual(expected.cuts);
    expect(actual.tiles).toEqual(expected.tiles);
    expect(actual.ranges).toEqual(expected.ranges);
  });
  it("re-establishes a custom zero on both faces without changing their overlap", () => {
    const both = sequenceProgram(program, program, "bottom");
    const custom: Stock = {
      ...stock,
      origin: "custom",
      originX: 7,
      originY: -4,
      zOrigin: "custom",
      originZ: 11,
    };
    const expected = new SequenceSimulator(
      both,
      stock,
      { 1: tool },
      80,
      "y",
    ).seek(1);
    const actual = new SequenceSimulator(
      translated(both, [7, -4, 11]),
      custom,
      { 1: tool },
      80,
      "y",
    ).seek(1);
    expect(actual.heights).toEqual(expected.heights);
    expect(actual.lowerHeights).toEqual(expected.lowerHeights);
    expect(actual.removed).toBe(expected.removed);
  });
  it("evaluates repeated Z returns against a custom top-surface coordinate", () => {
    const code =
      "T1 M6\nM3 S12000\nG0 X5 Y6 Z10\n" +
      Array.from({ length: 20 }, () => "G1 X8 Z7 F60\nX5 Z8").join("\n");
    const original = parseProgram(code);
    const expected = analyzeEfficiency(original, stock, { 1: tool });
    expect(expected.some((f) => f.kind === "repeated-reentry")).toBe(true);
    const custom: Stock = {
      ...stock,
      origin: "custom",
      originX: 7,
      originY: -4,
      zOrigin: "custom",
      originZ: 11,
    };
    expect(
      analyzeEfficiency(translated(original, [7, -4, 11]), custom, { 1: tool }),
    ).toEqual(expected);
  });
  it("keeps presets relative to stock dimensions and custom values fixed", () => {
    const center: Stock = {
      ...stock,
      origin: "center",
      zOrigin: "top",
      originX: -5,
      originY: -5,
      originZ: -5,
    };
    expect(stockOrigin(center)).toEqual([10, 8, 8]);
    expect(stockOrigin({ ...center, x: 40, z: 12 })).toEqual([20, 8, 12]);
    expect(
      stockOrigin({
        ...center,
        origin: "custom",
        zOrigin: "custom",
        x: 40,
        z: 12,
      }),
    ).toEqual([-5, -5, -5]);
  });
  it.each([
    { origin: "custom" },
    { zOrigin: "custom" },
    { originX: NaN },
    { originZ: Infinity },
    { origin: "custom", originX: 1, originY: "2" },
    { origin: "invalid" },
  ])(
    "rejects invalid origin settings %j before preparing geometry",
    (settings) => {
      const invalid = { ...stock, ...settings } as Stock;
      expect(() => new Simulator(program, invalid, { 1: tool }, 80)).toThrow(
        /Invalid workpiece origin/,
      );
      expect(() =>
        prepareSimulation(program, invalid, { 1: tool }, 80),
      ).toThrow(/Invalid workpiece origin/);
    },
  );
});
