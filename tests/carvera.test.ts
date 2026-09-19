import { describe, expect, it } from "vitest";
import { parseProgram } from "../src/engine/parse";
import { Simulator } from "../src/engine/simulate";
import { analyzeProgram } from "../src/engine/analyze";
import { STRIDE, type Program } from "../src/types";
import toolChange from "./fixtures/carvera-tool-change.nc?raw";

const moves = (p: Program) =>
  Array.from({ length: p.moves.length / STRIDE }, (_, i) =>
    Array.from(p.moves.slice(i * STRIDE, (i + 1) * STRIDE)),
  );
const header = "G21 G90\nT1 M6\nS12000 M3\n";

describe("Carvera feed and spindle overrides", () => {
  it("accepts the reported header without inventing a spindle setting", () => {
    const p = parseProgram(
      "M220 S100 (FEED 100%)\nM223 S100 (RPM 100%)\nG1 X10 F600",
    );
    expect(p.seconds).toBe(1);
    expect(p.motionStates).toEqual([
      { moveIndex: 0, spindle: "unknown", rpm: null, feedExplicit: true },
    ]);
  });
  it("applies modal percentages without compounding or replacing F/S", () => {
    const p = parseProgram(
      header +
        "G1 X10 F600\nM220 S50\nM223 S150\nX20\nM220 S50\nM223 S150\nX30\nS8000\nF1200\nX40\nM220 S100\nM223 S100\nX50",
    );
    expect(moves(p).map((m) => m[9])).toEqual([1, 2, 2, 1, 0.5]);
    expect(p.motionStates?.map((s) => [s.moveIndex, s.rpm])).toEqual([
      [0, 12000],
      [1, 18000],
      [3, 12000],
      [4, 8000],
    ]);
  });
  it("scales rapids and inch feeds, and leaves queries unchanged", () => {
    const p = parseProgram(
      "G20\nM220 S50\nM223 S125\nM220\nM223\nS8000 M3\nG0 X1\nG1 X2 F60",
    );
    expect(p.moves[9]).toBeCloseTo((25.4 / 1500) * 60);
    expect(p.moves[19]).toBeCloseTo(2);
    expect(p.motionStates?.[0].rpm).toBe(10000);
  });
  it("scales every arc segment without changing geometry", () => {
    const original = parseProgram(header + "G0 X10\nG3 X0 Y10 I-10 J0 F600");
    const scaled = parseProgram(
      header + "M220 S200\nG0 X10\nG3 X0 Y10 I-10 J0 F600",
    );
    expect(scaled.distance).toBe(original.distance);
    expect(scaled.seconds).toBeCloseTo(original.seconds / 2);
  });
  it.each([
    [0, 10, 10],
    [-1, 10, 10],
    [500, 500, 300],
    [2000, 1000, 300],
  ])("matches firmware clamps for S%s", (s, feed, rpm) => {
    const p = parseProgram(header + `M220 S${s}\nM223 S${s}\nG1 X10 F600`);
    expect(p.seconds).toBeCloseTo(100 / feed);
    expect(p.motionStates?.[0].rpm).toBe((12000 * rpm) / 100);
    expect(p.warnings.join()).toContain("clamped");
  });
  it("resets overrides for each imported program", () => {
    parseProgram("M220 S50\nM223 S50\nG1 X10");
    const p = parseProgram(header + "G1 X10 F600");
    expect(p.seconds).toBe(1);
    expect(p.motionStates?.[0].rpm).toBe(12000);
  });
});

describe("Carvera clearance and machine travel", () => {
  it("preserves material removal across clearance without adding a connecting cut", () => {
    const begin = header + "G0 X5 Y5 Z5\nG1 Z-1 F600\nX15\nG0 Z5\n";
    const end = "G0 X5 Y15\nZ5\nG1 Z-1\nX15";
    const stock = {
      x: 20,
      y: 20,
      z: 5,
      origin: "corner" as const,
      zOrigin: "top" as const,
    };
    const tools = {
      1: {
        id: "flat",
        name: "Flat",
        kind: "flat" as const,
        diameter: 2,
        length: 10,
      },
    };
    const direct = new Simulator(
      parseProgram(begin + end),
      stock,
      tools,
      80,
    ).seek(1);
    const program = parseProgram(begin + "G28\nM220 S100\nM223 S100\n" + end);
    const cleared = new Simulator(program, stock, tools, 80).seek(1);
    expect(cleared.heights).toEqual(direct.heights);
    expect(cleared.removed).toBe(direct.removed);
    expect(
      analyzeProgram(program, stock, tools, "walnut").findings.map(
        (f) => f.kind,
      ),
    ).not.toContain("rapid-contact");
  });
  it("imports the reported tool-change sequence and preserves its next cut", () => {
    const p = parseProgram(toolChange);
    expect(p.tools).toEqual([1, 2]);
    expect(p.toolChanges.map((c) => c.tool)).toEqual([1, 2]);
    const next = moves(p).filter((m) => m[6] === 2);
    expect(next[0].slice(0, 8)).toEqual([
      1.2894, 0.5253, 20, 1.2894, 0.5253, 10, 2, 1,
    ]);
    expect(next.find((m) => m[7] === 0)?.slice(0, 6)).toEqual([
      1.2894, 0.5253, 1.2773, 1.2894, 0.5253, 1.2752,
    ]);
    expect(next.every((m) => m[0] === 1.2894 && m[1] === 0.5253)).toBe(true);
    expect(p.motionStates?.at(-1)).toMatchObject({ spindle: "cw", rpm: 14000 });
    const beforeChange = moves(p).filter((m) => m[6] === 1);
    expect(p.toolChanges[1].moveIndex).toBe(beforeChange.length);
    expect(p.toolChanges[1].seconds).toBeCloseTo(
      beforeChange.reduce((s, m) => s + m[9], 0),
    );
  });
  it.each(["G0 X10 Y20\nZ5", "G0 Z5\nX10\nY20", "G0 X10 Y20 Z5"])(
    "restores XYZ across absolute rapid blocks: %s",
    (restore) => {
      const p = parseProgram(`G1 X5 F600\nG28\n${restore}\nG1 Z-1`);
      expect(moves(p).map((m) => m.slice(0, 6))).toEqual([
        [0, 0, 0, 5, 0, 0],
        [10, 20, 5, 10, 20, -1],
      ]);
      expect(p.seconds).toBeCloseTo(1.1);
    },
  );
  it.each([
    "G1 X10 Y20 Z5",
    "G0 X10 Y20\nG1 Z-1",
    "G91 G0 X10 Y20 Z5",
    "G0 X10 Y20\nG2 X20 I5",
  ])(
    "does not invent cutting geometry while an axis is unknown: %s",
    (restore) => {
      expect(() => parseProgram(`G1 X5\nG28\n${restore}`)).toThrow(
        "position after G28",
      );
    },
  );
  it("permits a program to end during a partial non-cutting return", () => {
    expect(parseProgram("G1 X5\nG28\nG0 X20 Y30\nM30").distance).toBe(5);
  });
  it("uses Carvera clearance semantics for G28 axis words", () => {
    const p = parseProgram("G1 X5\nG91 G28 Z0\nG90 G0 X10 Y20\nZ5\nG1 Z-1");
    expect(p.distance).toBe(11);
    expect(moves(p).at(-1)?.slice(0, 6)).toEqual([10, 20, 5, 10, 20, -1]);
  });
  it("invalidates previous recovery on each new G28", () => {
    expect(() =>
      parseProgram("G1 X5\nG28\nG0 X10 Y20\nG28\nG0 Z5\nG1 Z-1"),
    ).toThrow("unknown for X, Y");
  });
  it("handles G53 per axis and keeps it nonmodal", () => {
    const p = parseProgram("G0 X10 Y20 Z5\nG53 G0 Z-2\nG0 Z10\nG1 Z-1 F600");
    expect(moves(p).at(-1)?.slice(0, 6)).toEqual([10, 20, 10, 10, 20, -1]);
    expect(moves(p)).toHaveLength(2);
    expect(() => parseProgram("G1 X5\nG53 G0 Z-2\nG1 X10")).toThrow(
      "position after G53",
    );
  });
  it("handles controller home-button travel followed by split work rapids", () => {
    const p = parseProgram(
      "G1 X5\nG53 G0 Z-2\nG53 X-2 Y-2\nG0 X10 Y20\nZ5\nG1 Z-1",
    );
    expect(p.distance).toBe(11);
  });
  it("tracks selected axes for G28.2 and preserves motion mode across G28", () => {
    const p = parseProgram("G0 X10 Y20 Z5\nG28.2 Z0\nZ8\nG1 Z-1");
    expect(moves(p).at(-1)?.slice(0, 6)).toEqual([10, 20, 8, 10, 20, -1]);
    expect(() => parseProgram("G1 X5\nG28\nX10 Y20 Z5")).toThrow(
      "position after G28",
    );
  });
});

describe("Carvera accessory and tool commands", () => {
  // Independently enumerated from Controller.py, facing generator, bundled NC
  // examples, and the corresponding firmware handlers. XYZ/F/S ownership matters.
  it.each([
    "M106 S50",
    "M107",
    "M322",
    "M322.2",
    "M324",
    "M325 S50",
    "M331",
    "M332",
    "M331.3",
    "M332.3",
    "M333",
    "M334",
    "M335",
    "M336",
    "M337 R20 U40 B60",
    "M370",
    "M400",
    "M470 S12",
    "M471",
    "M472",
    "M485",
    "M485.1",
    "M485.2",
    "M490",
    "M490.1",
    "M490.2",
    "M490.3",
    "M490.4",
    "M491.2 H.1 P-25",
    "M492",
    "M492.1",
    "M492.2",
    "M492.3",
    "M493.4",
    "M493.6 S2",
    "M494",
    "M494.1",
    "M494.2",
    "M600",
    "M801 S75",
    "M802",
    "M811 S40",
    "M812",
    "M821",
    "M822",
    "M831",
    "M832",
    "M841",
    "M842",
    "M851 S100",
    "M852",
    "M117 Ready",
    "M118 Starting G1 X999 S1",
    "M118.1 P#5023",
    "echo 测试 X999 S1",
  ])("accepts %s without changing cutting state or geometry", (command) => {
    const p = parseProgram(header + `G1 X10 F600\n${command}\nX20`);
    expect(p.distance).toBe(20);
    expect(p.seconds).toBe(2);
    expect(p.motionStates).toEqual([
      { moveIndex: 0, spindle: "cw", rpm: 12000, feedExplicit: true },
    ]);
    expect(p.tools).toEqual([1]);
    expect(moves(p)).toHaveLength(2);
  });
  it("keeps calibration and collet parameters out of motion/RPM state", () => {
    const p = parseProgram(
      header +
        "G0 X10 Y20 Z5\nM6 T2 S1 C1 R2 X-5 Y3 Z1\nG0 Z8\nM3\nG1 Z-1 F600",
    );
    expect(moves(p)).toHaveLength(2);
    expect(moves(p).at(-1)?.slice(0, 7)).toEqual([10, 20, 8, 10, 20, -1, 2]);
    expect(p.motionStates?.at(-1)?.rpm).toBe(12000);
  });
  it.each(["M491 X-5 Y3 Z1 R2", "M491.1 H.05"])(
    "excludes %s travel and restores Z independently",
    (command) => {
      const p = parseProgram(
        header + `G0 X10 Y20 Z5\n${command}\nG0 Z8\nM3\nG1 Z-1 F600`,
      );
      expect(moves(p).at(-1)?.slice(0, 6)).toEqual([10, 20, 8, 10, 20, -1]);
      expect(moves(p)).toHaveLength(2);
      expect(() => parseProgram(header + `G1 X5\n${command}\nG1 X10`)).toThrow(
        "position after M491",
      );
    },
  );
  it("supports tool-number assignment, preselection and tool unloading", () => {
    const p = parseProgram(
      header + "G1 X10\nM493.5 T2\nX20\nM493.2 T3\nX30\nM6 T-1\nG0 Z5",
    );
    expect(p.tools).toEqual([1, 3]);
    expect(p.toolChanges.map((t) => t.tool)).toEqual([1, 3, -1]);
    expect(() => parseProgram("M6 T-1\nG1 X5")).toThrow("no tool loaded");
  });
  it.each(["M496", "M496.1", "M496.3", "M496.4", "M496.6 X-2 Y-2"])(
    "excludes %s positioning and recovers work coordinates",
    (command) => {
      expect(
        parseProgram(`G1 X5\n${command}\nG0 X10 Y20\nZ5\nG1 Z-1`).distance,
      ).toBe(11);
    },
  );
  it.each([
    ["M496.2", 0, 0],
    ["M496.5 X10 Y20", 10, 20],
  ] as const)("retains known XY after %s", (command, x, y) => {
    const p = parseProgram(`G1 X5\n${command}\nG0 Z5\nG1 Z-1`);
    expect(moves(p).at(-1)?.slice(0, 6)).toEqual([x, y, 5, x, y, -1]);
  });
  it.each([
    "M220 S50 X100",
    "M223 S50 F10",
    "M851 S50 Z-10",
    "M6 T1 C2",
    "M6 T1 S12000",
    "M6 T1 R0",
    "M491 F100",
    "M493.2",
    "M496.5 X1",
    "M496.6 X1 Y2 A0",
    "G0 M491 X1",
    "M220 M223 S50",
    "M3 M851 S50",
    "M851.1 S50",
    "G1 C1",
  ])("rejects malformed/ambiguous command parameters: %s", (command) => {
    expect(() => parseProgram(`G1 X5\n${command}`)).toThrow("Line 2:");
  });
});

describe("Carvera coordinate setup and unsupported physical operations", () => {
  it.each([54, 55, 56, 57, 58, 59, 59.1, 59.2, 59.3])(
    "accepts one initial work system G%s",
    (wcs) => {
      const p = parseProgram(`G${wcs}\nG1 X10 F600`);
      expect(p.distance).toBe(10);
      expect(p.warnings.join()).toContain(`G${wcs}`);
      expect(() => parseProgram(`G1 X5\nG${wcs === 54 ? 55 : wcs}`)).toThrow(
        "relative work offsets",
      );
    },
  );
  it.each(["G10 L2 P0 Z-50", "G10 L20 P1 X0 Y0 Z0", "G10 L2 P1 R0"])(
    "accepts initial %s without using its XYZ as motion",
    (setup) => {
      const p = parseProgram(`${setup}\nG0 X10 Y20 Z5\nG1 Z-1`);
      expect(moves(p)[0].slice(0, 6)).toEqual([0, 0, 0, 10, 20, 5]);
      expect(p.warnings.join()).toContain("G10");
    },
  );
  it.each(["G10 L2 P0 Z-50", "G10 L20 P0 Z0"])(
    "rejects offset changes after motion: %s",
    (setup) => {
      expect(() => parseProgram(`G1 X5\n${setup}`)).toThrow(
        "offsets after motion",
      );
    },
  );
  it.each([
    "G10 L2 P0 R90",
    "G10 L1 P0 Z0",
    "G10 L2 P2 Z0",
    "G10 L2 P-1 Z0",
    "G10 L2 Z0",
    "G28.6 X100",
    "G92.1 X100",
  ])("rejects setup that cannot be placed: %s", (setup) => {
    expect(() => parseProgram(`${setup}\nG1 X5`)).toThrow("Line 1:");
  });
  it.each(["G28.1", "G28.1 X-5 Y-3", "G28.6", "G92.1", "G92.2", "G98", "G99"])(
    "does not turn %s into a movement",
    (command) => {
      expect(parseProgram(`G1 X5\n${command}\nX10`).distance).toBe(10);
    },
  );
  it.each(["M321", "M321.2", "M323"])(
    "explains why %s cannot be treated as milling",
    (command) => {
      expect(() => parseProgram(`${command}\nG1 X5`)).toThrow(
        "laser operation",
      );
    },
  );
  it.each([
    "G38.2 Z-10 F100",
    "M460.1 D4",
    "M460.2",
    "M460.3",
    "M461 X5 Y5",
    "M462 X5 Y5",
    "M463 X5 Y5",
    "M464 X5 Y5",
    "M465 X5",
    "M465.1",
    "M466 Z-10 F100",
    "M469.1",
    "M469.2",
    "M469.5",
    "M469.6",
    "M495 X0 Y0",
    "M495.3 H10 D3",
  ])(
    "reports missing probe results for %s before interpreting parameters as axes",
    (command) => {
      expect(() => parseProgram(`${command}\nG1 X5`)).toThrow(
        /measured|probing/,
      );
    },
  );
  it.each([
    "G5 X1",
    "G30.1",
    "G92.4 A0 S0",
    "G81 X0 Y0 Z-1",
    "G1 A90",
    "M493.3 Z1",
    "M999",
    "config-set sd foo bar",
    "#105=1",
    "G1Z-58145e87f0c3f3ee8848c97fcdec1f620.300F300.0",
  ])("keeps unsupported operations explicit: %s", (command) => {
    expect(() => parseProgram(`${command}\nG1 X5`)).toThrow("Line 1:");
  });
});
