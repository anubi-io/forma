import { describe, expect, it } from "vitest";
import { prepareThreads, threadHash } from "../src/engine/prepareThreads";
import { parseProgram } from "../src/engine/parse";
import { sequenceProgram } from "../src/engine/sequence";
import { validThread } from "../src/engine/threadProfile";
import { validProject } from "../src/workspaceStorage";
import fixture from "./fixtures/slot.forma.json";
import catalog from "../src/data/makera.json";
import { upgradeCatalogThreads } from "../src/data/upgradeTools";
import { STRIDE, type Stock, type Tool } from "../src/types";

const stock: Stock = { x: 12, y: 12, z: 6, origin: "corner", zOrigin: "top" };
const tool: Tool = {
  id: "thread",
  name: "Thread",
  kind: "thread",
  diameter: 2,
  pitch: 0.8,
  angle: 60,
  neck: 1,
};
describe("thread volume preparation", () => {
  it("directly addresses compact regions and keeps distant holes sparse", () => {
    const compact = prepareThreads(
      parseProgram("T1 M6\nG0 X5 Y6 Z-4\nG1 X7 Y6 Z-2"),
      stock,
      { 1: tool },
      1600,
    )!;
    const table = compact.lookup!;
    expect(table.byteLength).toBeLessThanOrEqual(4 * 1024 * 1024);
    for (let i = 0; i < compact.tiles.length; i += 4) {
      const [x, y, z] = compact.tiles.subarray(i, i + 3);
      const id =
        2 +
        x -
        table[0] +
        table[4] * (y - table[1] + table[5] * (z - table[2]));
      expect(table[id * 4 + 3]).toBe(i / 4);
    }
    const distant = prepareThreads(
      parseProgram("T1 M6\nG0 X5 Y6 Z-4\nG1 X6\nG0 X1900 Y1900\nG1 X1901"),
      { ...stock, x: 2000, y: 2000 },
      { 1: tool },
      1600,
    )!;
    expect(distant.lookup).toBeUndefined();
    expect(distant.tiles.length).toBeLessThan(2000);
  });
  it("compresses more than two million references without dropping fine path segments", () => {
    const count = 35000;
    const moves = new Float64Array(count * STRIDE);
    for (let i = 0; i < count; i++)
      moves.set(
        [
          6 + (i % 2) * 0.0001,
          6,
          -4,
          6 + ((i + 1) % 2) * 0.0001,
          6,
          -4,
          1,
          0,
          i + 1,
          0,
        ],
        i * STRIDE,
      );
    const program = { ...parseProgram("T1 M6\nG1 X1"), moves };
    const data = prepareThreads(program, stock, { 1: tool }, 3200)!;
    let expanded = 0;
    for (let i = 0; i < data.ranges.length; i += 2)
      expanded += data.ranges[i + 1] - data.ranges[i];
    expect(expanded).toBeGreaterThan(2_000_000);
    expect(data.cuts.length / 12).toBe(count);
    expect(data.ranges.length).toBe(data.tiles.length / 2);
    expect(data.ranges.byteLength).toBeLessThan(32_000);
    expect(data.step).toBeCloseTo(0.08);
  });
  it("does not bridge visits to different parts of the stock", () => {
    const p = parseProgram(
      "T1 M6\nG0 X3 Y3 Z-3\nG1 X3.01\nG0 X9 Y9\nG1 X9.01\nG0 X3 Y3\nG1 X3.02",
    );
    const data = prepareThreads(p, stock, { 1: tool }, 1600)!;
    const tile = Array.from(
      { length: data.tiles.length / 4 },
      (_, i) => i,
    ).find(
      (i) =>
        data.tiles[i * 4] === 3 &&
        data.tiles[i * 4 + 1] === 3 &&
        data.tiles[i * 4 + 2] === 4,
    )!;
    expect(
      Array.from(
        data.ranges.subarray(
          data.offsets[tile] * 2,
          data.offsets[tile + 1] * 2,
        ),
      ),
    ).toEqual([0, 1, 2, 3]);
  });
  it("clips distant paths before packing float32 cutting geometry", () => {
    const p = parseProgram("T1 M6\nG0 X-1000000 Y6 Z-3\nG1 X1000000");
    const data = prepareThreads(p, stock, { 1: tool }, 1600)!;
    expect(Math.abs(data.cuts[0])).toBeLessThan(2);
    expect(data.cuts[4]).toBeLessThan(16);
    expect(data.cuts[1]).toBe(6);
  });
  it("allocates only local bricks, indexes every cut and resolves hash collisions", () => {
    const p = parseProgram("T1 M6\nG0 X5 Y6 Z-4\nG1 X7 Y6 Z-2\nG0 Z2\nG1 X8");
    const data = prepareThreads(p, stock, { 1: tool }, 1600)!;
    expect(data.cuts.length / 12).toBe(1);
    expect((data.tiles.length / 4) * 512).toBeLessThan(
      (12 * 12 * 6) / data.step ** 3 / 4,
    );
    for (let i = 0; i < data.tiles.length; i += 4) {
      const xyz = data.tiles.subarray(i, i + 3);
      const capacity = data.pages.length / 4;
      let slot = threadHash(xyz[0], xyz[1], xyz[2], capacity);
      while (data.pages[slot * 4 + 3] !== i / 4)
        slot = (slot + 1) & (capacity - 1);
      expect(Array.from(data.pages.subarray(slot * 4, slot * 4 + 3))).toEqual(
        Array.from(xyz),
      );
    }
    expect(data.ranges.every((i, at) => i === at % 2)).toBe(true);
    expect(
      prepareThreads(
        parseProgram("T1 M6\nG0 X5 Y6 Z-4"),
        stock,
        { 1: tool },
        1600,
      ),
    ).toBeUndefined();
  });
  it.each(["x", "y"] as const)(
    "maps both faces into the first setup around %s",
    (axis) => {
      const a = parseProgram("T1 M6\nG0 X3 Y4 Z-2\nG1 X4");
      const p = sequenceProgram(a, a, "bottom");
      const data = prepareThreads(p, stock, { 1: tool }, 1600, axis)!;
      expect(data.cuts[12 + (axis === "y" ? 0 : 1)]).toBeCloseTo(
        12 - data.cuts[axis === "y" ? 0 : 1],
      );
      expect(data.cuts[14]).toBeCloseTo(6 - data.cuts[2]);
      expect(data.flipAt).toBe(2);
    },
  );
  it("rejects invalid profiles and excessive allocations before GPU work", () => {
    for (const change of [
      { pitch: 0 },
      { angle: 180 },
      { neck: 2 },
      { neck: NaN },
    ])
      expect(validThread({ ...tool, ...change })).toBe(false);
    expect(() =>
      prepareThreads(
        parseProgram("T1 M6\nG0 X0 Y0 Z-4\nG1 X2000 Y2000"),
        { ...stock, x: 2000, y: 2000 },
        { 1: tool },
        5600,
      ),
    ).toThrow(/budget/);
  });
  it("preserves thread geometry in project validation", () => {
    const project = { ...fixture, assignments: { 1: tool } };
    expect(validProject(project)).toBe(true);
    expect(
      validProject({ ...project, assignments: { 1: { ...tool, neck: 3 } } }),
    ).toBe(false);
  });
  it("upgrades exact legacy catalog assignments without guessing custom or MKS profiles", () => {
    const entry = (catalog.tools as Tool[]).find((t) => t.kind === "thread")!;
    const old = {
      ...entry,
      kind: "unsupported" as const,
      pitch: undefined,
      neck: undefined,
      angle: undefined,
    };
    const result = upgradeCatalogThreads({
      1: old,
      2: { ...old, id: "mks-2" },
      3: { ...old, diameter: 10 },
    });
    expect(result[1].kind).toBe("thread");
    expect(result[1].pitch).toBe(entry.pitch);
    expect(result[2].kind).toBe("unsupported");
    expect(result[3].kind).toBe("unsupported");
  });
});
