import { describe, expect, it } from "vitest";
import { parseProgram } from "../src/engine/parse";
import {
  flippedIndex,
  sequenceProgram,
  SequenceSimulator,
} from "../src/engine/sequence";
import { playbackState } from "../src/engine/playback";
import type { Stock, Tool, Surface } from "../src/types";
const stock: Stock = { x: 40, y: 30, z: 10, origin: "corner", zOrigin: "top" };
const tool: Tool = { id: "flat", name: "Flat", kind: "flat", diameter: 6 };
const top = parseProgram("T1 M6\nG0 X10 Y8 Z2\nG1 Z-3");
const bottom = parseProgram("T1 M6\nG0 X10 Y22 Z2\nG1 Z-4");
const sample = (s: Surface, x: number, y: number) =>
  Math.round((y / stock.y) * s.ny) * (s.nx + 1) +
  Math.round((x / stock.x) * s.nx);

describe("two-sided machining", () => {
  it("retains the first cut after flipping, subtracts the second and restores arbitrary seeks", () => {
    const program = sequenceProgram(top, bottom, "top");
    const engine = new SequenceSimulator(program, stock, { 1: tool }, 160, "x");
    const beforeFlip = engine.seek(
      (program.operations![0].end - 1) / (program.moves.length / 10),
    );
    const flipped = engine.seek(0.5);
    // At the boundary the top pocket becomes the lower boundary of the flipped stock.
    expect(flipped.heights[sample(flipped, 10, 22)]).toBe(10);
    expect(flipped.lowerHeights![sample(flipped, 10, 22)]).toBe(3);
    const end = engine.seek(1);
    expect(end.heights[sample(end, 10, 22)]).toBe(6);
    expect(end.lowerHeights![sample(end, 10, 22)]).toBe(3);
    expect(end.removed).toBeGreaterThan(flipped.removed);
    expect(engine.seek(0.5).lowerHeights).toEqual(flipped.lowerHeights);
    expect(engine.seek(1).heights).toEqual(end.heights);
    expect(engine.seek(0).removed).toBe(0);
    expect(beforeFlip.removed).toBe(0);
  });
  it("supports Y flips and asymmetric stock coordinates", () => {
    const p = sequenceProgram(top, bottom, "top");
    const e = new SequenceSimulator(p, stock, { 1: tool }, 160, "y");
    const s = e.seek(0.5);
    expect(s.lowerHeights![sample(s, 30, 8)]).toBe(3);
    expect(s.lowerHeights![sample(s, 10, 22)]).toBe(0);
  });
  it("reverses the order without changing the finished solid or its volume", () => {
    const forward = new SequenceSimulator(
      sequenceProgram(top, bottom, "top"),
      stock,
      { 1: tool },
      160,
      "x",
    ).seek(1);
    const backward = new SequenceSimulator(
      sequenceProgram(top, bottom, "bottom"),
      stock,
      { 1: tool },
      160,
      "x",
    ).seek(1);
    expect(backward.removed).toBeCloseTo(forward.removed, 5);
    for (let y = 0; y <= forward.ny; y++)
      for (let x = 0; x <= forward.nx; x++) {
        const i = y * (forward.nx + 1) + x;
        const j = flippedIndex(x, y, forward.nx, forward.ny, "x");
        expect(backward.heights[i]).toBeCloseTo(
          stock.z - forward.lowerHeights![j],
        );
        expect(backward.lowerHeights![i]).toBeCloseTo(
          stock.z - forward.heights[j],
        );
      }
  });
  it("counts overlapping cuts once and leaves no negative thickness", () => {
    const deep = parseProgram("T1 M6\nG0 X10 Y22 Z2\nG1 Z-9");
    const e = new SequenceSimulator(
      sequenceProgram(top, deep, "top"),
      stock,
      { 1: tool },
      160,
      "x",
    );
    const s = e.seek(1),
      i = sample(s, 10, 22);
    expect(s.heights[i]).toBe(s.lowerHeights![i]);
    const topOnly = e.seek(0.5).removed;
    expect(s.removed).toBeCloseTo((topOnly / 3) * 10, 5);
  });
  it.each(["corner", "center"] as const)(
    "respects %s origins and Z from stock bottom",
    (origin) => {
      const ox = origin === "center" ? 20 : 0,
        oy = origin === "center" ? 15 : 0;
      const a = parseProgram(`T1 M6\nG0 X${10 - ox} Y${8 - oy} Z12\nG1 Z7`);
      const b = parseProgram(`T1 M6\nG0 X${10 - ox} Y${22 - oy} Z12\nG1 Z6`);
      const s = new SequenceSimulator(
        sequenceProgram(a, b, "top"),
        { ...stock, origin, zOrigin: "bottom" },
        { 1: tool },
        160,
        "x",
      ).seek(1);
      expect(s.heights[sample(s, 10, 22)]).toBe(6);
      expect(s.lowerHeights![sample(s, 10, 22)]).toBe(3);
    },
  );
  it("keeps independent modal state, line numbers and cutter positions at the transition", () => {
    const second = parseProgram("G20\nT2 M6\nG0 X1 Y.5 Z.1\nG1 Z-.1");
    const p = sequenceProgram(top, second, "top");
    const cursor = playbackState(p, p.operations![1].start);
    expect(cursor.tool).toBe(2);
    expect(cursor.line).toBe(2);
    expect(cursor.position).toEqual([0, 0, 0]);
    expect(playbackState(p, p.operations![1].end).line).toBe(4);
    expect(p.moves[p.operations![1].start * 10 + 3]).toBeCloseTo(25.4);
  });
});
