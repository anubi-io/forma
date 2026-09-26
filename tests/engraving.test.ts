import { expect, it } from "vitest";
import catalog from "../src/data/makera.json";
import { upgradeCatalogThreads } from "../src/data/upgradeTools";
import { analysisSweep } from "../src/engine/analysisSweep";
import { contactRadius } from "../src/engine/cutterProfile";
import { simulationGrid } from "../src/engine/prepare";
import { Simulator } from "../src/engine/simulate";
import { parseProgram } from "../src/engine/parse";
import { validProject } from "../src/workspaceStorage";
import fixture from "./fixtures/slot.forma.json";
import type { Tool } from "../src/types";

const balls = (catalog.tools as Tool[]).filter(
  (t) => t.taperAngle !== undefined,
);
it("uses published ball sizes and tapers, and upgrades only matching legacy tools", () => {
  expect(
    balls.map((t) => [t.diameter, t.taperAngle, t.length, t.shank]),
  ).toEqual([
    [0.5, 10.3, 30.5, 6],
    [1, 9.5, 30.5, 6],
    [2, 7.7, 30.5, 6],
  ]);
  for (const tool of balls) {
    const legacy: Tool = {
      ...tool,
      kind: "unsupported",
      taperAngle: undefined,
    };
    expect(upgradeCatalogThreads({ 1: legacy })[1]).toMatchObject({
      kind: "ball",
      taperAngle: tool.taperAngle,
    });
    expect(
      upgradeCatalogThreads({ 1: { ...legacy, diameter: 0.7 } })[1].kind,
    ).toBe("unsupported");
    expect(validProject({ ...fixture, assignments: { 1: tool } })).toBe(true);
    expect(
      validProject({
        ...fixture,
        assignments: { 1: { ...tool, taperAngle: 180 } },
      }),
    ).toBe(false);
  }
});

it("matches the physical spherical nose and conical flanks through ramps and plunges", () => {
  for (const tool of balls) {
    const R = tool.diameter / 2,
      a = (tool.taperAngle! * Math.PI) / 360;
    const shape = (d: number) =>
      d <= R * Math.cos(a)
        ? R - Math.sqrt(Math.max(0, R * R - d * d))
        : (d - R * Math.cos(a)) / Math.tan(a) + R * (1 - Math.sin(a));
    for (const dz of [0, -2, 2, -30, 30]) {
      const sweep = analysisSweep(0, 0, 0, 4, 0, dz, tool);
      for (const x of [-0.1, 0, 1, 3.99, 4.1])
        for (const y of [0, R * 0.6, R, 1.7]) {
          let expected = Infinity;
          for (let i = 0; i <= 12000; i++) {
            const t = i / 12000,
              d = Math.hypot(x - 4 * t, y);
            if (d <= contactRadius(tool, tool.length!))
              expected = Math.min(expected, dz * t + shape(d));
          }
          expect(sweep(x, y)).toBeCloseTo(expected, 2);
        }
    }
    const stock = {
      x: 10,
      y: 10,
      z: 10,
      origin: "corner" as const,
      zOrigin: "top" as const,
    };
    const result = new Simulator(
      parseProgram("T1 M6\nG0 X5 Y5 Z2\nG1 Z-4"),
      stock,
      { 1: tool },
      200,
    ).seek(1);
    const at = (x: number) => result.heights[100 * 201 + Math.round(x * 20)];
    expect(at(5)).toBeCloseTo(6, 5);
    expect(at(5.5)).toBeCloseTo(Math.min(10, 6 + shape(0.5)), 5);
  }
});

it("checks V-bit resolution against the tip and stock bounds against actual contact", () => {
  const tool = (catalog.tools as Tool[]).find(
    (t) => t.id === "single-flute-engraving-bit-1-8-shank-30-0.1mm",
  )!;
  expect(tool.length).toBe(9);
  expect(
    upgradeCatalogThreads({ 1: { ...tool, length: undefined } })[1].length,
  ).toBe(9);
  expect(upgradeCatalogThreads({ 1: { ...tool, length: 12 } })[1].length).toBe(
    12,
  );
  const stock = {
    x: 40,
    y: 40,
    z: 10,
    origin: "corner" as const,
    zOrigin: "top" as const,
  };
  expect(simulationGrid(stock, { 1: tool }, [1], 160).warnings.join()).toMatch(
    /tip diameter/,
  );
  const result = new Simulator(
    parseProgram("T1 M6\nG0 X0.5 Y5 Z2\nG1 Z-0.1\nG1 Y10"),
    stock,
    { 1: tool },
    160,
  ).seek(1);
  expect(result.warnings.join()).not.toMatch(/beyond the stock XY/);
  expect(contactRadius(tool, 1)).toBeCloseTo(0.05 + Math.tan(Math.PI / 12), 8);
});
