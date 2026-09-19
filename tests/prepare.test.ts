import { describe, expect, it } from "vitest";
import {
  prepareSimulation,
  BATCH_SIZE,
  CUT_STRIDE,
  TILE_SIZE,
  tileStatistics,
} from "../src/engine/prepare";
import { parseProgram } from "../src/engine/parse";
import { Simulator } from "../src/engine/simulate";
import { STRIDE, type Stock, type Tool } from "../src/types";

const stock: Stock = { x: 40, y: 30, z: 10, origin: "corner", zOrigin: "top" };
const tool: Tool = { id: "flat", name: "flat", diameter: 3.175, kind: "flat" };

describe("spatial compiler", () => {
  it("automatically fits a dense path into memory without losing cuts or playback batches", () => {
    const square = { ...stock, y: 40 };
    const tools = { 1: { ...tool, diameter: 100 } };
    const program = parseProgram(
      "T1 M6\nG0 X20 Y20 Z5\n" +
        Array.from({ length: 600 }, (_, i) => `G1 Z${-1 - i / 1000}`).join(
          "\n",
        ),
    );
    const prepared = prepareSimulation(program, square, tools, 5600);
    expect(prepared.nx).toBeLessThan(5600);
    expect(prepared.nx).toBeGreaterThanOrEqual(32);
    expect(prepared.indices.length).toBeLessThanOrEqual(16_000_000);
    expect(prepared.count).toBe(program.moves.length / STRIDE);
    expect(prepared.cuts).toEqual(
      prepareSimulation(program, square, tools, 32).cuts,
    );
    const tileCount = prepared.tilesX * prepared.tilesY;
    const expectedCuts = Array.from({ length: 600 }, (_, i) => i + 1);
    for (const tile of [0, Math.floor(tileCount / 2), tileCount - 1]) {
      expect(
        Array.from(
          prepared.indices.subarray(
            prepared.offsets[tile],
            prepared.offsets[tile + 1],
          ),
        ),
      ).toEqual(expectedCuts);
    }
    for (let segment = 1; segment < prepared.count; segment++)
      expect(prepared.cuts[segment * CUT_STRIDE + 11]).toBe(1);
    expect(Array.from(prepared.batchOffsets)).toEqual([
      0,
      tileCount,
      tileCount * 2,
    ]);
    for (let batch = 0; batch < 2; batch++)
      expect(
        Array.from(
          prepared.batchTiles.subarray(
            batch * tileCount,
            (batch + 1) * tileCount,
          ),
        ),
      ).toEqual(Array.from({ length: tileCount }, (_, i) => i));
  });

  it("keeps the requested detail when the spatial index fits", () => {
    const prepared = prepareSimulation(
      parseProgram("T1 M6\nG0 X10 Y10 Z5\nG1 Z-2"),
      stock,
      { 1: tool },
      3200,
    );
    expect(prepared.nx).toBe(3200);
    expect(prepared.ny).toBe(2400);
  });

  it("indexes every affected sample, including tile boundaries, diagonals and off-stock moves", () => {
    const paths = [
      "G0 X-5 Y-5 Z-2\nG1 X45 Y35",
      "G0 X20 Y35 Z-2\nG1 Y-5",
      "G0 X40 Y30 Z-2\nG1 X0 Y0",
      "G0 X16 Y16 Z5\nG1 Z-2",
      "G0 X-5 Y10 Z-1\nG1 X45 Z-5",
      "G0 X60 Y40 Z-1\nG1 X70",
    ];
    for (const path of paths) {
      const program = parseProgram(`T1 M6\n${path}`);
      const compiled = prepareSimulation(program, stock, { 1: tool }, 160);
      const result = new Simulator(program, stock, { 1: tool }, 160).seek(1);
      for (let i = 0; i < result.heights.length; i++) {
        if (result.heights[i] === stock.z) continue;
        const x = i % (result.nx + 1),
          y = Math.floor(i / (result.nx + 1));
        const tile =
          Math.floor(y / TILE_SIZE) * compiled.tilesX +
          Math.floor(x / TILE_SIZE);
        expect(
          Array.from(
            compiled.indices.subarray(
              compiled.offsets[tile],
              compiled.offsets[tile + 1],
            ),
          ),
        ).toContain(1);
      }
    }
  });
  it("emits unique, sorted active tile lists across dispatch boundaries", () => {
    const lines = ["T1 M6", "G0 X5 Y5 Z-1"];
    for (let i = 0; i < BATCH_SIZE * 3; i++)
      lines.push(`G1 X${5 + (i % 20)} Y${5 + (i % 17)}`);
    const p = prepareSimulation(
      parseProgram(lines.join("\n")),
      stock,
      { 1: tool },
      160,
    );
    for (let batch = 0; batch < p.batchOffsets.length - 1; batch++) {
      const actual = Array.from(
        p.batchTiles.subarray(p.batchOffsets[batch], p.batchOffsets[batch + 1]),
      );
      expect(new Set(actual).size).toBe(actual.length);
      const expected = [];
      for (let tile = 0; tile < p.offsets.length - 1; tile++) {
        const list = Array.from(
          p.indices.subarray(p.offsets[tile], p.offsets[tile + 1]),
        );
        expect(list).toEqual([...list].sort((a, b) => a - b));
        if (list.some((id) => Math.floor(id / BATCH_SIZE) === batch))
          expected.push(tile);
      }
      expect(actual).toEqual(expected);
    }
  });
  it("bounds tile geometry with the shared edge samples", () => {
    const nx = 32,
      ny = 32,
      heights = new Float32Array(33 * 33).fill(1);
    heights[16 * 33 + 16] = 10;
    const stats = tileStatistics(heights, { nx, ny });
    for (const tile of [0, 1, 3, 4]) expect(stats[tile * 4 + 1]).toBe(10);
    expect(stats[8 * 4 + 1]).toBe(1);
  });
  it("stores warnings at their first applicable timeline position", () => {
    const p = prepareSimulation(
      parseProgram("T1 M6\nG0 X5 Y5 Z5\nG1 Z-2\nG0 X20 Z-3\nG1 Z-12"),
      stock,
      { 1: tool },
      160,
    );
    expect(p.warnings.find((w) => w.message.startsWith("Rapid"))?.at).toBe(3);
    expect(p.warnings.find((w) => w.message.includes("bottom"))?.at).toBe(4);
  });
});

describe("incremental CPU accounting", () => {
  it("matches independent full-grid integration across overlaps and checkpoint restores", () => {
    const program = parseProgram(
      "T1 M6\nG0 X5 Y5 Z5\nG1 Z-1\nG1 X35\nG1 Y25\nG1 X5 Z-3\nG1 Y5\nG1 X35 Z-5\nG0 X20 Y15\nG1 Z-12",
    );
    const sim = new Simulator(program, stock, { 1: tool }, 160);
    for (const fraction of [1, 0.6, 0.2, 0.8, 0, 1, 0.4, 1]) {
      const r = sim.seek(fraction);
      let expected = 0;
      for (let y = 0; y <= r.ny; y++)
        for (let x = 0; x <= r.nx; x++)
          expected +=
            ((((stock.z - r.heights[y * (r.nx + 1) + x]) *
              (x === 0 || x === r.nx ? 0.5 : 1) *
              (y === 0 || y === r.ny ? 0.5 : 1) *
              stock.x) /
              r.nx) *
              stock.y) /
            r.ny;
      expect(r.removed).toBeCloseTo(expected, 7);
      expect(r.heights).toEqual(
        new Simulator(program, stock, { 1: tool }, 160).seek(fraction).heights,
      );
    }
    expect(sim.seek(0.2).warnings.join()).not.toContain("bottom");
  });
  it("rejects nonfinite seek positions", () => {
    const sim = new Simulator(
      parseProgram("T1 M6\nG1 X5"),
      stock,
      { 1: tool },
      160,
    );
    expect(() => sim.seek(NaN)).toThrow("position");
  });
});
