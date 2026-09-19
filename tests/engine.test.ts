import { describe, it, expect } from "vitest";
import { parseProgram } from "../src/engine/parse";
import { Simulator } from "../src/engine/simulate";
import { SIMULATION_QUALITIES, MAX_RESOLUTION } from "../src/engine/quality";
import { stockGeometry } from "../src/scene/geometry";
import { demoCode, DEMO_STOCK, DEMO_TOOLS } from "../src/data/demo";
import catalog from "../src/data/makera.json";
import { STRIDE, type Tool, type Stock } from "../src/types";
const flat: Tool = {
  id: "flat",
  name: "Flat",
  kind: "flat",
  diameter: 4,
  length: 20,
};
const stock: Stock = { x: 40, y: 40, z: 10, origin: "corner", zOrigin: "top" };
const sim = (code: string, tool = flat, s = stock) =>
  new Simulator(parseProgram(code), s, { 1: tool }, 160);
const sample = (surface: ReturnType<Simulator["seek"]>, x: number, y: number) =>
  surface.heights[
    Math.round((y / stock.y) * surface.ny) * (surface.nx + 1) +
      Math.round((x / stock.x) * surface.nx)
  ];
describe("modal G-code interpreter", () => {
  it("converts inches and keeps modal feed/relative positions", () => {
    const p = parseProgram("G20 G90\nT1 M6\nG1 X1 F10\nG91\nX.5 Y.25");
    expect(Array.from(p.moves.slice(13, 16))).toEqual([
      38.099999999999994, 6.35, 0,
    ]);
    expect(p.tools).toEqual([1]);
    expect(p.moves[9]).toBeCloseTo(6);
  });
  it("activates preselected tools only on M6", () => {
    const p = parseProgram("T1 M6\nG1 X10\nT2\nG1 X20\nM6\nG1 X30");
    expect([p.moves[6], p.moves[16], p.moves[26]]).toEqual([1, 1, 2]);
  });
  it("handles initial tool without M6 and modal XYZ", () => {
    const p = parseProgram("T8\nG1 X10\nY5\nT9\nX20");
    expect(p.tools).toEqual([8]);
    expect(p.moves[24]).toBe(5);
  });
  it("tessellates a complete helical XY circle and reaches exact endpoint", () => {
    const p = parseProgram("T1 M6\nG0 X10\nG3 X10 Y0 Z-2 I-10 J0 F600");
    expect(p.moves.length / STRIDE).toBeGreaterThan(60);
    expect(Array.from(p.moves.slice(-7, -4))).toEqual([10, 0, -2]);
    expect(p.distance).toBeCloseTo(10 + Math.hypot(20 * Math.PI, 2), 0);
  });
  it("chooses minor and major R arcs correctly", () => {
    const a = parseProgram("G0 X10\nG3 X0 Y10 R10"),
      b = parseProgram("G0 X10\nG3 X0 Y10 R-10");
    expect(a.distance).toBeCloseTo(10 + 5 * Math.PI, 0);
    expect(b.distance).toBeCloseTo(10 + 15 * Math.PI, 0);
  });
  it("stops at M30 and accepts nested comments", () => {
    const p = parseProgram("(outer (inner)) T1 M6\nG1 X10\nM30\nG1 X999");
    expect(p.distance).toBe(10);
  });
  it.each([
    "G81 X1 Z-5",
    "G92 X0",
    "G55",
    "G41 D2",
    "G1 X1 A45",
    "M98 P100",
    "G1 X[2+3]",
    "G1 XNaN",
    "G1 X1 F0",
    "G2 X5 Y0 R1",
    "G2 X10 I1",
    "G43 H1",
    "G1 X1 E20",
    "G1 X1 Q.1",
  ])("rejects unmodeled or malformed input: %s", (code) => {
    expect(() => parseProgram(code)).toThrow(/Line/);
  });
});
describe("material removal", () => {
  it("cuts a swept flat channel within the raster integration tolerance", () => {
    const s = sim("T1 M6\nG0 X10 Y20 Z5\nG1 Z-2\nG1 X30");
    const result = s.seek(1);
    expect(sample(result, 20, 20)).toBe(8);
    expect(sample(result, 20, 23)).toBe(10);
    const expected = (20 * 4 + Math.PI * 4) * 2;
    // Inclusive tangent samples on a 0.25 mm grid add half a cell at each
    // straight edge. Bound the quadrature error by perimeter * half-cell * depth.
    const rasterBound =
      (2 * 20 + 2 * Math.PI * 2) * (stock.x / result.nx / 2) * 2;
    expect(Math.abs(result.removed - expected)).toBeLessThan(rasterBound);
  });
  it("preserves spherical profile for vertical plunge", () => {
    const result = sim("T1 M6\nG0 X20 Y20 Z5\nG1 Z-2", {
      ...flat,
      kind: "ball",
    }).seek(1);
    expect(sample(result, 20, 20)).toBe(8);
    expect(sample(result, 21, 20)).toBeCloseTo(10 - Math.sqrt(3), 4);
    expect(sample(result, 22, 20)).toBe(10);
  });
  it("sweeps ball across a sloped path without gaps", () => {
    const result = sim("T1 M6\nG0 X10 Y20 Z0\nG1 X30 Z-4", {
      ...flat,
      kind: "ball",
    }).seek(1);
    expect(sample(result, 20, 20)).toBeCloseTo(
      10 - 2 + 2 - 2 * Math.sqrt(1.04),
      4,
    );
  });
  it("uses included V-angle and tip diameter", () => {
    const result = sim("T1 M6\nG0 X20 Y20 Z5\nG1 Z-2", {
      ...flat,
      kind: "v",
      angle: 90,
      tip: 0,
    }).seek(1);
    expect(sample(result, 20, 20)).toBe(8);
    expect(sample(result, 21, 20)).toBe(9);
    expect(sample(result, 22, 20)).toBe(10);
  });
  it("retains the actual chamfer tip and exact stroke endpoints", () => {
    const tool = (catalog.tools as Tool[]).find(
      (t) => t.id === "chamfering-bit-4",
    )!;
    const result = sim("T1 M6\nG0 X10 Y20 Z-2\nG1 X30", tool).seek(1);
    expect(sample(result, 30, 20)).toBe(8);
    expect(sample(result, 31, 20)).toBeCloseTo(8.95, 5);
    expect(sample(result, 20, 21)).toBeCloseTo(8.95, 5);
    expect(sample(result, 20, 22)).toBeCloseTo(9.95, 5);
  });
  it.each([
    { kind: "flat" as const },
    { kind: "ball" as const },
    { kind: "v" as const, angle: 90, tip: 0 },
    { kind: "v" as const, angle: 30, tip: 0.4 },
    { kind: "v" as const, angle: 120, tip: 1 },
    { kind: "v" as const, angle: 90, tip: 4 },
  ])(
    "matches independent sampled sweeps for $kind / $angle / $tip",
    (profile) => {
      const tool = { ...flat, ...profile };
      // Horizontal, shallow, steep, ascending/descending and diagonal strokes.
      for (const [dx, dy, dz] of [
        [12, 0, 0],
        [12, 3, -3],
        [12, 3, 3],
        [2, 0, -6],
        [2, 0, 6],
        [0, 0, -3],
      ]) {
        const az = dz > 0 ? -8 : -1;
        const result = sim(
          `T1 M6\nG0 X10 Y20 Z${az}\nG1 X${10 + dx} Y${20 + dy} Z${az + dz}`,
          tool,
        ).seek(1);
        for (const [x, y] of [
          [10, 20],
          [11, 20],
          [11, 20.5],
          [12, 21],
          [16, 21.5],
          [22, 23],
          [23, 23],
        ]) {
          let expected = stock.z;
          for (let i = 0; i <= 20000; i++) {
            const u = i / 20000;
            const d = Math.hypot(x - 10 - dx * u, y - 20 - dy * u);
            if (d > 2) continue;
            const offset =
              profile.kind === "ball"
                ? 2 - Math.sqrt(Math.max(0, 4 - d * d))
                : profile.kind === "v"
                  ? Math.max(0, d - profile.tip! / 2) /
                    Math.tan((profile.angle! * Math.PI) / 360)
                  : 0;
            expected = Math.min(
              expected,
              Math.max(0, stock.z + az + dz * u + offset),
            );
          }
          expect(Math.abs(sample(result, x, y) - expected)).toBeLessThan(0.003);
        }
      }
    },
  );

  it("runs Ultra-detailed at its requested resolution, preserving XY proportions", () => {
    const quality = SIMULATION_QUALITIES.find(
      (q) => q.label === "Ultra-detailed",
    )!;
    const p = parseProgram("T1 M6\nG0 X20 Y20 Z5\nG1 Z-2");
    const s = new Simulator(p, { ...stock, y: 30 }, { 1: flat }, quality.value);
    expect([s.nx, s.ny]).toEqual([2400, 1800]);
    const result = s.seek(1);
    expect(result.heights.length).toBe(2401 * 1801);
    expect(result.removed).toBeCloseTo(Math.PI * 4 * 2, 0);
    s.seek(0);
    const replay = s.seek(1);
    expect(replay.heights.length).toBe(result.heights.length);
    expect(
      replay.heights.every((height, i) => height === result.heights[i]),
    ).toBe(true);
    expect(new Simulator(p, stock, { 1: flat }, 10000).nx).toBe(MAX_RESOLUTION);
    expect(() => new Simulator(p, stock, { 1: flat }, NaN)).toThrow(
      "resolution",
    );
  });
  it("does not remove material on G0 and reports below-stock motion", () => {
    const result = sim("T1 M6\nG0 X20 Y20 Z-2").seek(1);
    expect(result.removed).toBe(0);
    expect(result.warnings.join()).toContain("Rapid");
  });
  it("supports center origin and bottom Z", () => {
    const result = sim("T1 M6\nG0 Z15\nG1 Z8", flat, {
      ...stock,
      origin: "center",
      zOrigin: "bottom",
    }).seek(1);
    expect(sample(result, 20, 20)).toBe(8);
  });
  it("clamps through cuts at bottom and reports overtravel", () => {
    const result = sim("T1 M6\nG0 X20 Y20 Z5\nG1 Z-15").seek(1);
    expect(sample(result, 20, 20)).toBe(0);
    expect(result.warnings.join()).toContain("bottom");
  });
  it("resets backward seeking and matches incremental forward replay", () => {
    const s = sim("T1 M6\nG0 X10 Y20 Z5\nG1 Z-2\nG1 X30");
    const final = s.seek(1);
    expect(s.seek(0).removed).toBe(0);
    s.seek(0.5);
    expect(s.seek(1).heights).toEqual(final.heights);
  });
  it("requires assigned tools and valid geometry", () => {
    const p = parseProgram("T3 M6\nG1 X10");
    expect(() => new Simulator(p, stock, {}, 160)).toThrow("T3");
    expect(
      () => new Simulator(p, stock, { 3: { ...flat, diameter: NaN } }, 160),
    ).toThrow("diameter");
  });
  it("keeps thread removal GPU-only without blocking CPU playback", () => {
    const threads = (catalog.tools as Tool[]).filter((t) =>
      t.id.startsWith("thread-milling"),
    );
    expect(threads.length).toBeGreaterThan(0);
    for (const tool of threads) {
      const s = sim("T1 M6\nG0 X20 Y20 Z5\nG1 Z-2\nG3 X20 Y20 Z-3 I2 J0", tool);
      const result = s.seek(1);
      expect(result.processed).toBe(result.count);
      expect(result.removed).toBe(0);
      expect(result.heights.every((h) => h === stock.z)).toBe(true);
      expect(result.warnings.join()).toContain(
        "T1: thread material removal requires WebGPU",
      );
      s.seek(0);
      s.seek(0.5);
      expect(s.seek(1).heights).toEqual(result.heights);
    }
  });
  it("preserves normal cuts before and after a thread tool change", () => {
    const thread = (catalog.tools as Tool[]).find((t) =>
      t.id.startsWith("thread-milling"),
    )!;
    const p = parseProgram(
      "T1 M6\nG0 X10 Y10 Z5\nG1 Z-2\nG0 Z5\nT2 M6\nG0 X20 Y20\nG1 Z-5\nG0 Z5\nT1 M6\nG0 X30 Y30\nG1 Z-3",
    );
    const s = new Simulator(p, stock, { 1: flat, 2: thread }, 160);
    const result = s.seek(1);
    expect(sample(result, 10, 10)).toBe(8);
    expect(sample(result, 20, 20)).toBe(10);
    expect(sample(result, 30, 30)).toBe(7);
    expect(result.removed).toBeGreaterThan(0);
    expect(result.processed).toBe(result.count);
    s.seek(0);
    s.seek(0.5);
    expect(s.seek(1).heights).toEqual(result.heights);
  });
  it("clips trajectories completely outside stock without removing anything", () => {
    expect(sim("T1 M6\nG0 X100 Y100 Z5\nG1 Z-2\nG1 X150").seek(1).removed).toBe(
      0,
    );
  });
});
describe("mesh and catalog", () => {
  it("handles a 100,000-move CAM-style raster within the bounded work budget", () => {
    const lines = ["G21 G90", "T1 M6", "G0 X10 Y10 Z5", "G1 Z-1 F1000"];
    for (let i = 0; i < 100000; i++)
      lines.push(`G1 X${10 + (i % 100)} Y${10 + (Math.floor(i / 100) % 100)}`);
    const started = performance.now();
    const p = parseProgram(lines.join("\n"));
    const parsed = performance.now() - started;
    const result = new Simulator(
      p,
      { ...stock, x: 120, y: 120 },
      { 1: flat },
      320,
    ).seek(1);
    expect(result.count).toBe(100001);
    expect(result.removed).toBeGreaterThan(9000);
    console.info(
      `100k raster: parse ${parsed.toFixed(0)} ms, simulate ${result.elapsed.toFixed(0)} ms, packed buffer ${(p.moves.byteLength / 1024 / 1024).toFixed(1)} MB`,
    );
  }, 15000);
  it("produces finite bounds and upward top normals", () => {
    const surface = sim("T1 M6\nG0 X20 Y20 Z5\nG1 Z-2").seek(1);
    const g = stockGeometry(stock, surface);
    g.computeBoundingBox();
    expect(g.boundingBox?.min.toArray()).toEqual([-20, 0, -20]);
    expect(g.boundingBox?.max.toArray()).toEqual([20, 10, 20]);
    expect(g.getAttribute("normal").getY(0)).toBe(1);
    g.dispose();
  });
  it("catalog entries are unique with explicit simulation capability and sources", () => {
    expect(new Set(catalog.tools.map((t) => t.id)).size).toBe(
      catalog.tools.length,
    );
    for (const t of catalog.tools) {
      expect(t.source).toMatch(/^https:\/\/www.makera.com\/products\//);
      expect(t.diameter).toBeGreaterThan(0);
      if (t.kind === "v") expect(t.angle).toBeGreaterThan(0);
    }
  });
  it("benchmarks the complete demo at all detailed resolutions", () => {
    const p = parseProgram(demoCode());
    for (const quality of [320, 600, MAX_RESOLUTION]) {
      const s = new Simulator(p, DEMO_STOCK, DEMO_TOOLS, quality);
      const result = s.seek(1);
      expect(result.removed).toBeGreaterThan(35000);
      expect(result.removed).toBeLessThan(37000);
      expect(result.warnings).toEqual([]);
      console.info(
        `Demo ${quality}: ${result.count} segments, ${result.elapsed.toFixed(1)} ms, ${(result.removed / 1000).toFixed(2)} cm3`,
      );
    }
  }, 15000);
});
