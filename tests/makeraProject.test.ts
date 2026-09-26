import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { Simulator } from "../src/engine/simulate";
import { parseProgram } from "../src/engine/parse";
import {
  importMakeraTools,
  importMakeraSetup,
} from "../src/engine/makeraProject";

const flat = {
  toolNumber: 1,
  toolName: "Flat",
  toolType: 1,
  diameter: 3.175,
  fluteLength: 12,
  handleDiameter: 3.175,
  cornerRadius: 0,
};
const archive = (tools: unknown[], extra = {}) =>
  zipSync({
    "makera.prj": strToU8(
      JSON.stringify({
        project: {
          emUnit: 0,
          stStockInfo: {
            StockShape: 1,
            length: 200,
            width: 150,
            height: 5,
            material: { name: "Aluminum Alloys" },
          },
          lstCoordinate: { "0": { path: tools.map((t) => ({ tools: [t] })) } },
          ...extra,
        },
      }),
    ),
    "makera.bin": new Uint8Array(30 * 1024 * 1024),
  });

describe("Makera Studio tool mapping", () => {
  it.each([15, 30])(
    "imports engraving type 3 with half-angle %s and cuts with the saved tip",
    (halfAngle) => {
      const tools = importMakeraTools(
        archive([
          {
            ...flat,
            toolName: "Engraving(Metal)",
            toolType: 3,
            angle: 0,
            halfAngle,
            tipDiameter: 0.2,
            fluteLength: 2.6,
          },
        ]),
      );
      expect(tools[1]).toMatchObject({
        kind: "v",
        diameter: 3.175,
        angle: halfAngle * 2,
        tip: 0.2,
        length: 2.6,
      });
      const surface = new Simulator(
        parseProgram("T1 M6\nG0 X20 Y20 Z5\nG1 Z-1"),
        { x: 40, y: 40, z: 10, origin: "corner", zOrigin: "top" },
        tools,
        160,
      ).seek(1);
      expect(surface.heights[80 * 161 + 80]).toBeCloseTo(9, 6);
      expect(surface.heights[80 * 161 + 81]).toBeCloseTo(
        9 + 0.15 / Math.tan((halfAngle * Math.PI) / 180),
        5,
      );
      expect(surface.warnings.join()).not.toMatch(/special profile/);
    },
  );
  it.each([
    { halfAngle: undefined },
    { halfAngle: 0 },
    { halfAngle: 90 },
    { halfAngle: "15" },
    { tipDiameter: -0.1 },
    { tipDiameter: 4 },
  ])("keeps invalid engraving geometry unsupported: %j", (change) => {
    expect(
      importMakeraTools(
        archive([
          {
            ...flat,
            toolType: 3,
            angle: 30,
            halfAngle: 15,
            tipDiameter: 0.2,
            ...change,
          },
        ]),
      )[1].kind,
    ).toBe("unsupported");
  });
  it("imports stock axes and known material with tools", () => {
    expect(importMakeraSetup(archive([flat]))).toMatchObject({
      dimensions: { x: 200, y: 150, z: 5 },
      material: "aluminum",
      assignments: { 1: { kind: "flat" } },
    });
  });
  it.each([
    { StockShape: 2, length: 200, width: 150, height: 5 },
    { StockShape: 1, length: 200, width: 150, height: 0 },
    { StockShape: 1, length: "200", width: 150, height: 5 },
  ])("rejects unsupported or invalid stock atomically", (stock) => {
    expect(() =>
      importMakeraSetup(archive([flat], { stStockInfo: stock })),
    ).toThrow(/stock/);
  });
  it("extracts metadata without expanding the large scene and uses saved T numbers", () => {
    const result = importMakeraTools(
      archive([
        flat,
        { ...flat, feedrate: 800 },
        { ...flat, toolNumber: 4 },
        {
          ...flat,
          toolNumber: 2,
          toolName: "Thread M5",
          toolType: 6,
          diameter: 4,
          fluteLength: 16,
        },
        { ...flat, toolNumber: 3, toolType: 2, angle: 90, tipDiameter: 0.1 },
        { ...flat, toolNumber: 6, toolType: 2, angle: 90, tipDiameter: 0.1 },
      ]),
    );
    expect(Object.keys(result)).toEqual(["1", "2", "3", "4", "6"]);
    expect(result[1]).toMatchObject({
      kind: "flat",
      diameter: 3.175,
      length: 12,
    });
    expect(result[2]).toMatchObject({ kind: "unsupported", diameter: 4 });
    expect(result[3]).toMatchObject({ kind: "v", angle: 90, tip: 0.1 });
  });
  it("rejects ambiguous numbers across operations", () => {
    expect(() =>
      importMakeraTools(archive([flat, { ...flat, diameter: 6 }])),
    ).toThrow(/T1.*conflicting/);
  });
  it("imports verified thread parameters and rejects conflicting pitches", () => {
    const thread = {
      ...flat,
      toolType: 6,
      diameter: 4,
      threadAngle: 60,
      pitch: 1.5,
    };
    const imported = importMakeraTools(archive([thread]))[1];
    expect(imported).toMatchObject({
      kind: "thread",
      pitch: 1.5,
      angle: 60,
      diameter: 4,
    });
    expect(imported.neck).toBeGreaterThan(0);
    expect(imported.neck).toBeLessThan(4);
    expect(() =>
      importMakeraTools(archive([thread, { ...thread, pitch: 0.8 }])),
    ).toThrow(/conflicting/);
    for (const change of [
      { pitch: 0 },
      { pitch: NaN },
      { threadAngle: 0 },
      { neckDiameter: 5 },
    ])
      expect(
        importMakeraTools(archive([{ ...thread, ...change }]))[1].kind,
      ).toBe("unsupported");
  });
  it.each([-1, 1.5, "1"])("rejects invalid T numbers %s", (toolNumber) => {
    expect(() => importMakeraTools(archive([{ ...flat, toolNumber }]))).toThrow(
      /Invalid tool/,
    );
  });
  it("does not infer unsupported profiles from names", () => {
    expect(
      importMakeraTools(archive([{ ...flat, toolType: 999 }]))[1].kind,
    ).toBe("unsupported");
    expect(
      importMakeraTools(archive([{ ...flat, cornerRadius: 0.5 }]))[1].kind,
    ).toBe("unsupported");
  });
  it("rejects missing, malformed, oversized and empty metadata", () => {
    expect(() => importMakeraTools(new Uint8Array([1, 2, 3]))).toThrow(
      /Cannot read/,
    );
    expect(() => importMakeraTools(zipSync({ other: strToU8("{}") }))).toThrow(
      /no makera.prj/,
    );
    expect(() =>
      importMakeraTools(zipSync({ "makera.prj": strToU8("{") })),
    ).toThrow(/Invalid/);
    expect(() =>
      importMakeraTools(
        zipSync({ "makera.prj": new Uint8Array(4 * 1024 * 1024 + 1) }),
      ),
    ).toThrow(/4 MB/);
    expect(() => importMakeraTools(archive([]))).toThrow(/No operation tools/);
    expect(() => importMakeraTools(archive([flat], { emUnit: 1 }))).toThrow(
      /millimetre/,
    );
  });
});
