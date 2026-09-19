import { describe, expect, it } from "vitest";
import { analyzeProgram, type FindingKind } from "../src/engine/analyze";
import { analysisSweep } from "../src/engine/analysisSweep";
import { entryMotion } from "../src/engine/analysisEntry";
import { parseProgram } from "../src/engine/parse";
import { sequenceProgram, operationProgram } from "../src/engine/sequence";
import { Simulator } from "../src/engine/simulate";
import {
  demoCode,
  DEMO_STOCK,
  DEMO_TOOLS,
  DEMO_MATERIAL,
} from "../src/data/demo";
import { STRIDE, type Stock, type Tool } from "../src/types";

const stock: Stock = { x: 40, y: 40, z: 10, origin: "corner", zOrigin: "top" };
const flat: Tool = {
  id: "flat",
  name: "Flat",
  kind: "flat",
  diameter: 4,
  length: 12,
};
const header = "G21 G90\nT1 M6\nS12000 M3\n";
const analyze = (code: string, tool = flat, material = "walnut", s = stock) =>
  analyzeProgram(parseProgram(header + code), s, { 1: tool }, material);
const kinds = (result: ReturnType<typeof analyze>) =>
  result.findings.map((f) => f.kind);
const finding = (result: ReturnType<typeof analyze>, kind: FindingKind) =>
  result.findings.find((f) => f.kind === kind);

describe("G-code optimization analysis", () => {
  it("counts reversed identical cutting paths once, using each repeat's own feed", () => {
    const result = analyze(
      "G0 X5 Y10 Z3\nG1 Z-1 F100\nG1 X25 F600\nG1 X5 F300\nG0 Z5",
    );
    expect(result.repeatedSeconds).toBeCloseTo(4);
    expect(result.emptySeconds).toBe(0);
    expect(result.savingsSeconds).toBeCloseTo(4);
    expect(finding(result, "repeated-path")?.locations[0].line).toBe(7);
  });
  it("recognizes a wholly empty pass with different segmentation after material was removed", () => {
    const result = analyze(
      "G0 X5 Y10 Z3\nG1 Z-1 F100\nG1 X25 F600\nG0 Z5\nG1 Z-1 F100\nG1 X15 F600\nG1 X5\nG1 Z5 F100",
    );
    expect(result.repeatedSeconds).toBe(0);
    expect(result.emptySeconds).toBeCloseTo(2);
    expect(finding(result, "empty-pass")?.locations[0]).toMatchObject({
      line: 9,
      endLine: 10,
    });
  });
  it("counts all 16 operations, combines fragmented repeats and retains every seek target", () => {
    const paths = Array.from(
      { length: 16 },
      (_, i) =>
        `G0 Z3\nG0 X5 Y${5 + i * 5}\nG1 Z-1 F100\nG1 X15 F600\nG1 X5\nG1 X15\nG1 X10\nG1 X15\nG0 Z3`,
    ).join("\n");
    const result = analyze(paths, flat, "aluminum", { ...stock, y: 100 });
    const repeats = finding(result, "repeated-path")!;
    expect(repeats.occurrences).toBe(16);
    expect(repeats.locations).toHaveLength(16);
    expect(repeats.locations.every((location) => location.spans === 2)).toBe(
      true,
    );
    expect(
      repeats.locations.every((location) => location.seconds === 2.5),
    ).toBe(true);
    expect(
      new Set(repeats.locations.map((location) => location.focusLine)).size,
    ).toBe(16);
    expect(result.repeatedSeconds).toBeCloseTo(40);
    expect(result.repeatedSeconds).toBeCloseTo(
      repeats.locations.reduce((sum, location) => sum + location.seconds, 0),
    );
    expect(kinds(result)).not.toContain("steep-entry");
  });
  it("keeps evidence and navigation attached to the same occurrence", () => {
    const result = analyze(
      "G0 X5 Y10 Z3\nG1 Z-11 F100\nG1 X15 Z-12\nG0 Z3\nG0 X25\nG1 Z-14 F100\nG1 X30",
    );
    const below = finding(result, "below-stock")!;
    expect(below.occurrences).toBe(2);
    expect(below.locations[0]).toMatchObject({
      line: 5,
      focusLine: 6,
      detail: "Tip reaches 2 mm below the stock bottom.",
    });
    expect(below.locations[1]).toMatchObject({
      line: 9,
      focusLine: 9,
      detail: "Tip reaches 4 mm below the stock bottom.",
    });
  });
  it("does not double count exact repeats inside an otherwise empty pass", () => {
    const result = analyze(
      "G0 X5 Y10 Z3\nG1 Z-1 F100\nG1 X25 F600\nG0 Z5\nG0 X5\nG1 Z-1 F100\nG1 X25 F600",
    );
    expect(result.repeatedSeconds).toBeCloseTo(2);
    expect(result.emptySeconds).toBe(0);
    expect(result.savingsSeconds).toBeCloseTo(2);
  });
  it("preserves deeper cuts, nearby paths and a different cutter profile", () => {
    const result = analyze(
      "G0 X5 Y10 Z3\nG1 Z-1 F100\nG1 X25 F600\nG0 Z5\nG0 X5\nG1 Z-2 F100\nG1 X25 F600",
    );
    expect(result.savingsSeconds).toBe(0);
    const p = parseProgram(
      header +
        "G0 X5 Y10 Z3\nG1 Z-1 F100\nG1 X25 F600\nG0 Z5\nT2 M6\nG0 X5\nG1 Z-1 F100\nG1 X25 F600",
    );
    const profile = analyzeProgram(
      p,
      stock,
      { 1: { ...flat, kind: "ball" }, 2: flat },
      "walnut",
    );
    expect(profile.savingsSeconds).toBe(0);
  });
  it("excludes rapids, above-stock feed transfers, plunges and retracts from savings", () => {
    const result = analyze(
      "G0 X5 Y10 Z3\nG1 X25 F600\nG1 X5\nG0 Z-1\nG0 X25\nG0 X5\nG1 Z-2 F100\nG1 Z5\nG1 Z-2\nG1 Z5",
    );
    expect(result.savingsSeconds).toBe(0);
    expect(kinds(result)).toContain("rapid-contact");
  });
  it("does not recommend deleting links in a productive feed run", () => {
    const result = analyze(
      "G0 X5 Y10 Z3\nG1 Z-1 F100\nG1 X25 F600\nG0 Z5\nG0 X10\nG1 Z-1 F100\nG1 X20 F600\nG1 Y25",
    );
    expect(result.savingsSeconds).toBe(0);
  });
  it("checks G0 against remaining stock and does not flag a cleared channel", () => {
    const clear = analyze(
      "G0 X5 Y10 Z3\nG1 Z-1 F100\nG1 X25 F600\nG0 X5\nG0 Z5",
    );
    expect(kinds(clear)).not.toContain("rapid-contact");
    const fresh = analyze("G0 X5 Y10 Z3\nG1 Z-1 F100\nG0 X25");
    expect(kinds(fresh)).toContain("rapid-contact");
  });
  it("detects below-stock cuts and cutter-radius edge overrun using either origin", () => {
    const a = analyze("G0 X5 Y10 Z3\nG1 Z-11 F100\nG1 X39 F600");
    expect(kinds(a)).toEqual(
      expect.arrayContaining(["below-stock", "outside-stock"]),
    );
    const b = analyze(
      "G0 X-15 Y-10 Z13\nG1 Z-1 F100\nG1 X19 F600",
      flat,
      "walnut",
      { ...stock, origin: "center", zOrigin: "bottom" },
    );
    expect(finding(b, "below-stock")?.detail).toBe(
      finding(a, "below-stock")?.detail,
    );
    expect(finding(b, "outside-stock")?.detail).toBe(
      finding(a, "outside-stock")?.detail,
    );
  });
  it("does not flag an outside approach that enters the stock only after coming inside XY", () => {
    const result = analyze("G0 X-15 Y20 Z20\nG1 X15 Z-1 F100");
    expect(kinds(result)).not.toContain("outside-stock");
  });
  it("uses material review profiles and fresh engagement instead of absolute depth", () => {
    const code = "G0 X5 Y10 Z3\nG1 Z-3 F100\nG1 X25 F600";
    expect(kinds(analyze(code, flat, "aluminum"))).toContain("deep-engagement");
    expect(kinds(analyze(code, flat, "walnut"))).not.toContain(
      "deep-engagement",
    );
    const stepped = analyze(
      "G0 X5 Y10 Z3\nG1 Z-1 F100\nG1 X25 F600\nG1 Z-2 F100\nG1 X5 F600\nG1 Z-3 F100\nG1 X25 F600",
      flat,
      "aluminum",
    );
    expect(kinds(stepped)).not.toContain("deep-engagement");
  });
  it("reports flute length, steep entry and unusually high feed/RPM only on contact", () => {
    const result = analyze(
      "G0 X5 Y10 Z3\nG1 Z-4 F1000\nS100\nG1 X25 F600",
      { ...flat, length: 2 },
      "aluminum",
    );
    expect(kinds(result)).toEqual(
      expect.arrayContaining(["cutting-length", "steep-entry", "high-feed"]),
    );
    const clear = analyze("G0 X5 Y10 Z3\nG1 X25 F100000");
    expect(kinds(clear)).not.toContain("high-feed");
  });
  it("smooths rounded 0.01 mm Z steps across a gentle ramp", () => {
    const steps = Array.from({ length: 200 }, (_, i) => {
      const z = -(Math.floor(i / 4) + 1) / 100;
      return `G1 X${(10 + i * 0.05).toFixed(2)}\nG1 Z${z.toFixed(2)}`;
    }).join("\n");
    const p = parseProgram(header + "G0 X10 Y20 Z3\nG1 Z0 F200\n" + steps);
    const vertical = Array.from(
      { length: p.moves.length / STRIDE },
      (_, i) => i,
    ).find(
      (i) =>
        p.moves[i * STRIDE + 2] === -0.2 && p.moves[i * STRIDE + 5] === -0.21,
    )!;
    const motion = entryMotion(
      p,
      vertical,
      flat.diameter,
      0,
      p.moves.length / STRIDE,
    );
    expect(motion.angle).toBeGreaterThan(1);
    expect(motion.angle).toBeLessThan(4);
    expect(
      kinds(analyzeProgram(p, stock, { 1: flat }, "aluminum")),
    ).not.toContain("steep-entry");
  });
  it("does not mistake a fast re-entry through a cleared pocket or thin residual wall for a solid plunge", () => {
    const result = analyze(
      "G0 X5 Y10 Z3\nG1 Z-4 F100\nG1 X25 F600\nG0 Z3\nG0 X10 Y10.05\nG1 Z-4 F1000\nG1 X15 Z-3\nG1 X10 Z-4",
      flat,
      "aluminum",
    );
    expect(kinds(result)).not.toContain("steep-entry");
  });
  it("tracks spindle changes and stops treating unexecuted stopped-spindle paths as removed", () => {
    const result = analyze(
      "G0 X5 Y10 Z3\nM5\nG1 Z-1 F100\nG1 X25 F600\nM3\nG1 X5 F600",
    );
    expect(kinds(result)).toContain("spindle-off");
    expect(result.savingsSeconds).toBe(0);
    expect(kinds(analyze("G0 X5 Y10 Z3\nS0\nG1 Z-1 F100"))).toContain(
      "spindle-off",
    );
  });
  it("reports unknown modal inputs without claiming they are definitely stopped", () => {
    const p = parseProgram("T1 M6\nG0 X5 Y10 Z3\nG1 Z-1\nG1 X25");
    const result = analyzeProgram(p, stock, { 1: flat }, "walnut");
    expect(kinds(result)).toEqual(
      expect.arrayContaining([
        "spindle-unknown",
        "missing-rpm",
        "missing-feed",
      ]),
    );
    expect(kinds(result)).not.toContain("spindle-off");
  });
  it.each(["x", "y"] as const)(
    "preserves through cuts across %s flips and source locations in both orders",
    (axis) => {
      const top = parseProgram(
        header + "G0 X5 Y10 Z3\nG1 Z-10 F100\nG1 X15 F600\nG0 Z5",
      );
      const bottom = parseProgram(
        header +
          (axis === "y"
            ? "G0 X35 Y10 Z3\nG1 Z-1 F100\nG1 X30 F600\nG1 X25"
            : "G0 X5 Y30 Z3\nG1 Z-1 F100\nG1 X10 F600\nG1 X15"),
      );
      const result = analyzeProgram(
        sequenceProgram(top, bottom, "top"),
        stock,
        { 1: flat },
        "walnut",
        axis,
      );
      expect(result.emptySeconds).toBeCloseTo(1);
      expect(finding(result, "empty-pass")?.side).toBe("bottom");
      expect(finding(result, "empty-pass")?.locations[0].line).toBe(6);
      const reversed = analyzeProgram(
        sequenceProgram(top, bottom, "bottom"),
        stock,
        { 1: flat },
        "walnut",
        axis,
      );
      expect(reversed.savingsSeconds).toBe(0);
    },
  );
  it("never conflates same local XYZ paths on opposite stock faces", () => {
    const p = parseProgram(
      header + "G0 X5 Y10 Z3\nG1 Z-1 F100\nG1 X25 F600\nG0 Z5",
    );
    const result = analyzeProgram(
      sequenceProgram(p, p, "top"),
      stock,
      { 1: flat },
      "walnut",
    );
    expect(result.savingsSeconds).toBe(0);
  });
  it("marks incomplete geometry and does not claim empty passes for unsupported/tiny tools", () => {
    const code =
      "G0 X5 Y10 Z3\nG1 Z-1 F100\nG1 X25 F600\nG0 Z5\nG1 Z-1 F100\nG1 X15 F600\nG1 X5";
    for (const tool of [
      { ...flat, kind: "unsupported" as const },
      { ...flat, diameter: 0.01 },
    ]) {
      const result = analyze(code, tool);
      expect(result.complete).toBe(false);
      expect(result.emptySeconds).toBe(0);
    }
    const missing = analyzeProgram(
      parseProgram(header + code),
      stock,
      {},
      "walnut",
    );
    expect(missing.complete).toBe(false);
    expect(missing.savingsSeconds).toBe(0);
    expect(kinds(missing)).not.toContain("outside-stock");
  });
  it("limits uncertainty to the special cutter footprint and keeps checking later tools and faces", () => {
    const top = parseProgram(
      "G21 G90\nT2 M6\nS12000 M3\nG0 X5 Y5 Z3\nG1 Z-1 F100\nG1 X15 F600\nG0 Z3",
    );
    const bottom = parseProgram(
      header +
        "G0 X25 Y25 Z3\nG1 Z-1 F100\nG1 X35 F600\nG0 Z3\nG1 Z-1 F100\nG1 X30 F600\nG1 X25\nG0 Z3\nG0 X25 Y32\nG1 Z-4 F2000",
    );
    const result = analyzeProgram(
      sequenceProgram(top, bottom, "top"),
      stock,
      { 1: flat, 2: { ...flat, kind: "thread" } },
      "aluminum",
    );
    expect(result.complete).toBe(false);
    expect(result.analyzedMoves).toBe(result.totalMoves);
    expect(result.emptySeconds).toBeCloseTo(1);
    expect(finding(result, "empty-pass")?.side).toBe("bottom");
    expect(finding(result, "steep-entry")?.side).toBe("bottom");
    const overlap = parseProgram(
      "G21 G90\nT2 M6\nS12000 M3\nG0 X5 Y5 Z3\nG1 Z-4 F100\nG1 X15 F600\nG0 Z3\nT1 M6\nG1 Z-4 F2000\nG1 X5 F600",
    );
    const partial = analyzeProgram(
      overlap,
      stock,
      { 1: flat, 2: { ...flat, kind: "thread" } },
      "aluminum",
    );
    expect(partial.savingsSeconds).toBe(0);
    expect(kinds(partial)).not.toContain("steep-entry");
  });
  it("continues static checks after the geometry budget runs out without stale stock conclusions", () => {
    const p = parseProgram(
      header +
        "G0 X5 Y10 Z3\nG1 Z-1 F100\nG1 X25 F600\nG0 Z5\nG1 Z-11 F100\nG1 X39 F600",
    );
    const result = analyzeProgram(p, stock, { 1: flat }, "aluminum", "y", {
      maxEvaluations: 1,
    });
    expect(result.complete).toBe(false);
    expect(result.savingsSeconds).toBe(0);
    expect(kinds(result)).toEqual(
      expect.arrayContaining(["below-stock", "outside-stock"]),
    );
    expect(result.limitations.join(" ")).toContain("budget");
  });
  it("produces a clean state for an explicit shallow, non-repeating program", () => {
    const result = analyze("G0 X5 Y10 Z3\nG1 Z-1 F100\nG1 X25 F600\nG0 Z5");
    expect(result.complete).toBe(true);
    expect(result.findings).toEqual([]);
  });
  it("uses the cutting footprint instead of the full shank width for shallow V cuts", () => {
    const result = analyze("G0 X1 Y10 Z3\nG1 Z-0.2 F100\nG1 Y25 F600", {
      ...flat,
      kind: "v",
      diameter: 6,
      angle: 60,
      tip: 0.2,
    });
    expect(kinds(result)).not.toContain("outside-stock");
  });
  it("scans all 100,000 segments without truncating default contact coverage", () => {
    const path = Array.from(
      { length: 100_000 },
      (_, i) => `G1 X${i % 2 ? 5 : 25}`,
    ).join("\n");
    const p = parseProgram(header + "G0 X5 Y10 Z3\nG1 Z-1 F100\nF600\n" + path);
    const progress: number[] = [];
    const result = analyzeProgram(p, stock, { 1: flat }, "walnut", "y", {
      onProgress: (processed) => progress.push(processed),
    });
    expect(result.complete).toBe(true);
    expect(result.analyzedMoves).toBe(p.moves.length / STRIDE);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(result.totalMoves);
    expect(result.repeatedSeconds).toBeCloseTo(99_999 * 2);
    expect(result.emptySeconds).toBe(0);
    expect(finding(result, "repeated-path")?.locations).toHaveLength(1);
  });
  it("finishes the demo without warnings or dangers and with bounded savings", () => {
    const p = parseProgram(demoCode());
    const result = analyzeProgram(p, DEMO_STOCK, DEMO_TOOLS, DEMO_MATERIAL);
    expect(result.analyzedMoves).toBe(result.totalMoves);
    expect(result.findings.filter((f) => f.severity !== "opportunity")).toEqual(
      [],
    );
    expect(result.findings.some((f) => f.kind === "repeated-path")).toBe(false);
    expect(result.savingsSeconds).toBeGreaterThanOrEqual(0);
    expect(result.savingsSeconds).toBeLessThan(p.seconds);
    expect(result.savingsSeconds).toBeCloseTo(
      result.repeatedSeconds + result.emptySeconds,
    );
    expect(result.findings.length).toBeLessThan(40);
  });
});

describe("modal metadata and analytic cutter envelopes", () => {
  it("records state changes on segments and keeps dwell S separate from RPM", () => {
    const p = parseProgram(
      "T1 M6\nG0 X10 Y10 Z3\nM3 S9000\nG1 Z-1 F120\nG2 X20 Y10 I5 J0\nM5\nG4 P1 S12000\nG1 X25\nM30\nM3 S1000",
    );
    expect(p.motionStates).toHaveLength(3);
    expect(p.motionStates?.[1]).toMatchObject({
      moveIndex: 1,
      spindle: "cw",
      rpm: 9000,
      feedExplicit: true,
    });
    expect(p.motionStates?.at(-1)).toMatchObject({
      moveIndex: p.moves.length / STRIDE - 1,
      spindle: "off",
      rpm: 9000,
    });
    expect(() => parseProgram("G1 X1 S-100")).toThrow(/spindle speed/);
  });
  it("resets modal state for the second file and correctly slices operation state", () => {
    const first = parseProgram(header + "G1 X1 F100");
    const second = parseProgram("T1 M6\nG1 X1");
    const p = sequenceProgram(first, second, "top");
    expect(p.motionStates?.at(-1)).toMatchObject({
      spindle: "unknown",
      rpm: null,
      feedExplicit: false,
    });
    expect(
      operationProgram(p, p.operations![1]).motionStates?.[0].moveIndex,
    ).toBe(0);
    expect(operationProgram(p, p.operations![1])).toBe(
      operationProgram(p, p.operations![1]),
    );
  });
  it("combines large modal-state arrays without exceeding the JS argument limit", () => {
    const p = parseProgram(header + "G1 X1 F100");
    p.motionStates = Array.from({ length: 150_000 }, (_, moveIndex) => ({
      moveIndex,
      spindle: "cw" as const,
      rpm: 10000 + (moveIndex % 10),
      feedExplicit: true,
    }));
    expect(sequenceProgram(p, p, "top").motionStates).toHaveLength(300_000);
  });
  it.each(["flat", "ball", "v"] as const)(
    "matches simulator samples for %s on ascending and descending ramps",
    (kind) => {
      const tool: Tool = { ...flat, kind, angle: 60, tip: 0.2 };
      for (const [a, b] of [
        [-1, -4],
        [-4, -1],
      ]) {
        const p = parseProgram(`T1 M6\nG0 X5 Y10 Z${a}\nG1 X25 Y20 Z${b} F600`);
        const s = new Simulator(p, stock, { 1: tool }, 160).seek(1);
        const sample = analysisSweep(5, 10, a + 10, 25, 20, b + 10, tool);
        for (let y = 5; y < 25; y += 0.5)
          for (let x = 1; x < 30; x += 0.5) {
            const actual =
              s.heights[Math.round(y * 4) * (s.nx + 1) + Math.round(x * 4)];
            expect(actual).toBeCloseTo(
              Math.max(0, Math.min(10, sample(x, y))),
              4,
            );
          }
      }
    },
  );
});
