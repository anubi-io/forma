import { describe, expect, it } from "vitest";
import studio from "./fixtures/makera-studio.nc?raw";
import { lexLine } from "../src/engine/lex";
import { parseProgram } from "../src/engine/parse";
import { STRIDE } from "../src/types";

describe("native NC lexer", () => {
  it("reads compact words, spaced values, nested comments and lowercase", () => {
    expect(
      lexLine("\ufeffn12 g 01 x -2.5y+.3 (outer (inner); text) z4 ; #[]="),
    ).toEqual([
      ["N", 12],
      ["G", 1],
      ["X", -2.5],
      ["Y", 0.3],
      ["Z", 4],
    ]);
  });
  it("ignores metadata, thumbnails and program delimiters", () => {
    expect(lexLine(";@MKR|TOOL|number=1|name=工具 # []")).toEqual([]);
    expect(lexLine("% (program) ; end")).toEqual([]);
  });
  it("checks every checksum against the original case and whitespace", () => {
    const raw = "N12 g1 x2 ";
    let checksum = 0;
    for (const char of raw) checksum ^= char.charCodeAt(0);
    expect(lexLine(`${raw}*${checksum}`)).toEqual([
      ["N", 12],
      ["G", 1],
      ["X", 2],
    ]);
    expect(() => lexLine(`${raw}*0`)).toThrow("checksum");
    // This original-case block has a valid checksum of zero.
    expect(lexLine("N14 G1 X1 F2*0")).toEqual([
      ["N", 14],
      ["G", 1],
      ["X", 1],
      ["F", 2],
    ]);
  });
  it.each([
    "G1 X1.2.3",
    "G1 XNaN",
    "G1 X+",
    "(unfinished",
    "G1 )",
    "%wait",
    "G1 X[1+2]",
    "#1=2",
    "G1 X1\0Y2",
  ])("rejects malformed or executable input: %s", (line) => {
    expect(() => lexLine(line)).toThrow();
  });
});

describe("Makera NC compatibility", () => {
  it("imports Studio metadata and a final G28 without inventing home travel", () => {
    const p = parseProgram(studio);
    expect(p.tools).toEqual([1]);
    expect(p.moves.length / STRIDE).toBe(5);
    expect(Array.from(p.moves.slice(-7, -4))).toEqual([30, 10, 15]);
    expect(p.warnings.join()).toContain("G28 clearance travel excluded");
    expect(p.toolChanges).toHaveLength(1);
  });
  it("supports program numbers and ignores line-number-only blocks", () => {
    expect(parseProgram("%\nO123\nN1\nG1 X10\nM02\n%").distance).toBe(10);
  });
  it("requires all unknown axes to be restored before cutting after G28", () => {
    expect(() => parseProgram("G1 X5\nG28\nG1 X10")).toThrow(
      "position after G28",
    );
    expect(() => parseProgram("G1 X5\nG28\nG0 X10 Y0\nG1 Z-1")).toThrow(
      "position after G28",
    );
    const p = parseProgram("G1 X5\nG28\nG90 G0 X10 Y10 Z5\nG1 Z-1");
    expect(p.distance).toBe(11);
    expect(Array.from(p.moves.slice(10, 16))).toEqual([10, 10, 5, 10, 10, -1]);
  });
  it.each([
    "G28.3 X0",
    "G53 G1 Z0",
    "G81 X0 Y0 Z-5",
    "M321",
    "G1 A90",
    "G43 H1",
    "G1 X1 X2",
  ])("keeps unsupported controller behavior explicit: %s", (code) => {
    expect(() => parseProgram(`G1 X5\n${code}`)).toThrow(/Line 2:/);
  });
  it("does not reuse a cancelled motion mode", () => {
    expect(() => parseProgram("G1 X5\nG80\nX10")).toThrow("after G80");
    expect(parseProgram("G1 X5\nG80\nG0 X10").distance).toBe(10);
  });
});

describe("three-axis arc geometry", () => {
  it.each([
    ["G17", "X10", "X0 Y10", "I-10 J0", [0, 10, 0], 0, 1],
    ["G18", "Z10", "Z0 X10", "K-10 I0", [10, 0, 0], 2, 0],
    ["G19", "Y10", "Y0 Z10", "J-10 K0", [0, 0, 10], 1, 2],
  ] as const)(
    "tessellates right-handed CCW quarter circle in %s",
    (plane, start, end, center, endpoint, u, v) => {
      const p = parseProgram(`G0 ${start}\n${plane} G3 ${end} ${center} F600`);
      expect(Array.from(p.moves.slice(-7, -4))).toEqual(endpoint);
      expect(p.distance).toBeCloseTo(10 + 5 * Math.PI, 1);
      expect(p.moves[STRIDE + 3 + u]).toBeLessThan(10);
      expect(p.moves[STRIDE + 3 + v]).toBeGreaterThan(0);
      expect(p.moves[STRIDE + 3 + v]).toBeLessThan(2);
    },
  );
  it("tessellates a G18 clockwise helix without reversing the plane", () => {
    const p = parseProgram("G0 Z10\nG18 G2 Z0 X-10 Y4 K-10 I0");
    expect(p.distance).toBeCloseTo(10 + Math.hypot(5 * Math.PI, 4), 1);
    expect(Array.from(p.moves.slice(-7, -4))).toEqual([-10, 4, 0]);
    expect(p.moves[STRIDE + 3]).toBeLessThan(0);
  });
  it("handles absolute arc centers and switches back to offsets", () => {
    const p = parseProgram(
      "G0 X20 Y10\nG90.1 G3 X10 Y20 I10 J10\nG91.1 G3 X0 Y10 I0 J-10",
    );
    expect(p.distance).toBeCloseTo(Math.hypot(20, 10) + 10 * Math.PI, 1);
  });
  it("supports R arcs in G19", () => {
    const p = parseProgram("G0 Y10\nG19 G3 Y0 Z10 R10");
    expect(p.distance).toBeCloseTo(10 + 5 * Math.PI, 1);
  });
});

describe("tool-change event stream", () => {
  it("records initial, consecutive, reused and final M6 without requiring movement", () => {
    const p = parseProgram(
      "T1 M6\nG1 X10 F600\nT2\nG1 X20\nM6\nT3 M6\nT1 M6\nG1 X30\nT0 M6\nM30",
    );
    expect(p.toolChanges).toEqual([
      { tool: 1, previousTool: 0, line: 1, moveIndex: 0, seconds: 0 },
      { tool: 2, previousTool: 1, line: 5, moveIndex: 2, seconds: 2 },
      { tool: 3, previousTool: 2, line: 6, moveIndex: 2, seconds: 2 },
      { tool: 1, previousTool: 3, line: 7, moveIndex: 2, seconds: 2 },
      { tool: 0, previousTool: 1, line: 9, moveIndex: 3, seconds: 3 },
    ]);
    expect(p.tools).toEqual([1]);
  });
  it("does not report a preselection as a tool change", () => {
    const p = parseProgram("T1 M6\nG1 X10\nT2\nG1 X20");
    expect(p.toolChanges).toHaveLength(1);
    expect(p.tools).toEqual([1]);
  });
  it("marks an initial T-only tool as implicit without duplicating a later M6", () => {
    const p = parseProgram("T8\nG1 X10\nT9\nX20");
    expect(p.toolChanges).toEqual([
      {
        tool: 8,
        previousTool: 0,
        line: 1,
        moveIndex: 0,
        seconds: 0,
        implicit: true,
      },
    ]);
    expect(parseProgram("T8\nM6\nG1 X10").toolChanges).toEqual([
      { tool: 8, previousTool: 0, line: 2, moveIndex: 0, seconds: 0 },
    ]);
  });
});
