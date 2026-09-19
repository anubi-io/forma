import { describe, expect, it } from "vitest";
import catalog from "../src/data/makera.json";
import {
  compareTools,
  matchesToolGroup,
  matchesToolSearch,
  toolCategory,
  TOOL_FAMILIES,
} from "../src/data/toolLibrary";
import type { Tool } from "../src/types";

const tools = catalog.tools as Tool[];
const find = (id: string) => tools.find((tool) => tool.id.startsWith(id))!;

describe("Makera tool library", () => {
  it("preserves chamfer shanks and the published 0.1mm tip across all variants", () => {
    const chamfers = tools.filter((tool) =>
      matchesToolGroup(tool, "engraving-chamfer"),
    );
    expect(chamfers.map((tool) => tool.shank)).toEqual([3.175, 4, 6]);
    for (const tool of chamfers) {
      expect(tool).toMatchObject({
        kind: "v",
        angle: 90,
        tip: 0.1,
        diameter: tool.shank,
      });
      // Overall length is not cutting length.
      expect(tool.length).toBeUndefined();
    }
  });

  it("uses cutting dimensions independently from shank dimensions", () => {
    expect(
      find("spiral-o-single-flute-bit-for-metal-1-8-shank-1mm-"),
    ).toMatchObject({
      kind: "flat",
      diameter: 1,
      length: 3,
      shank: 3.175,
    });
    expect(find("two-flute-ball-nose-bit-1-8-shank-1.5mm-")).toMatchObject({
      kind: "ball",
      diameter: 1.5,
      length: 8,
      shank: 3.175,
    });
    expect(
      find("single-flute-engraving-bit-for-metal-1-8-shank-60"),
    ).toMatchObject({
      kind: "v",
      diameter: 3.175,
      angle: 60,
      tip: 0.1,
      shank: 3.175,
    });
    expect(find("two-flute-engraving-bit-6mm-shank-20-0.3")).toMatchObject({
      kind: "v",
      diameter: 6,
      angle: 20,
      tip: 0.3,
      shank: 6,
    });
    expect(find("uv-solder")).toMatchObject({
      kind: "unsupported",
      diameter: 0.3,
      tip: 0.3,
      shank: 3.175,
    });
    expect(find("thread-milling-bit-1-8-shank-M5")).toMatchObject({
      kind: "thread",
      diameter: 4,
      length: 15,
      shank: 3.175,
      pitch: 0.8,
      angle: 60,
    });
  });

  it("keeps all catalog geometries valid without treating special profiles as flat cutters", () => {
    for (const tool of tools) {
      expect(tool.shank).toBeGreaterThan(0);
      expect(tool.diameter).toBeGreaterThan(0);
      if (tool.length !== undefined) expect(tool.length).toBeGreaterThan(0);
      if (tool.kind === "v") {
        expect(tool.angle).toBeGreaterThan(0);
        expect(tool.angle).toBeLessThan(180);
        expect(tool.tip).toBeGreaterThanOrEqual(0);
        expect(tool.tip).toBeLessThanOrEqual(tool.diameter);
      }
      if (/Drill|Ball Nose Engraving|Solder Mask/.test(tool.name))
        expect(tool.kind).toBe("unsupported");
      if (tool.kind === "thread") {
        expect(tool.pitch).toBeGreaterThan(0);
        expect(tool.neck).toBeGreaterThan(0);
        expect(tool.neck).toBeLessThan(tool.diameter);
      }
    }
  });

  it("separates actual product families from simulation support", () => {
    expect(toolCategory(find("tin-coating-drill"))).toMatchObject({
      family: "drill",
    });
    expect(toolCategory(find("two-flute-ball-nose-engraving"))).toMatchObject({
      family: "ball",
      group: "ball-engraving",
    });
    expect(toolCategory(find("uv-solder"))).toMatchObject({
      family: "engraving",
      group: "engraving-solder",
    });
    expect(toolCategory(find("thread-milling"))).toMatchObject({
      family: "special",
      group: "special-thread",
    });
    expect(toolCategory(find("tin-coating-corn"))).toMatchObject({
      family: "flat",
      group: "flat-corn",
    });
  });

  it("places every catalog entry in exactly one family and subgroup", () => {
    const listed = TOOL_FAMILIES.flatMap((family) =>
      tools.filter((tool) => matchesToolGroup(tool, family.id)),
    );
    expect(listed).toHaveLength(tools.length);
    expect(new Set(listed.map((tool) => tool.id)).size).toBe(tools.length);
    for (const tool of listed) {
      const category = toolCategory(tool);
      expect(
        TOOL_FAMILIES.some((family) => family.id === category.family),
      ).toBe(true);
      expect(matchesToolGroup(tool, category.group)).toBe(true);
    }
  });

  it("keeps reference family order and sorts dimensions numerically", () => {
    const sorted = [...tools].sort(compareTools);
    const families = [
      ...new Set(sorted.map((tool) => toolCategory(tool).family)),
    ];
    expect(families).toEqual(["flat", "engraving", "ball", "drill", "special"]);
    const drills = sorted.filter((tool) => matchesToolGroup(tool, "drill"));
    expect(drills.map((tool) => tool.diameter)).toEqual(
      drills.map((tool) => tool.diameter).sort((a, b) => a - b),
    );
    expect(drills[0].diameter).toBe(0.2);
    const diameterSorted = [...tools].sort((a, b) =>
      compareTools(a, b, "diameter"),
    );
    expect(diameterSorted.map((tool) => tool.diameter)).toEqual(
      tools.map((tool) => tool.diameter).sort((a, b) => a - b),
    );
  });

  it("searches group labels, dimensions and decimal commas together", () => {
    const tool = find("spiral-o-single-flute-bit-for-metal-1-8-shank");
    expect(matchesToolSearch(tool, "Flat End Metal 3,175")).toBe(true);
    expect(matchesToolSearch(tool, "Ball Nose")).toBe(false);
    expect(matchesToolGroup(tool, "flat-metal")).toBe(true);
    expect(matchesToolGroup(tool, "engraving-metal")).toBe(false);
    expect(matchesToolSearch(tool, "  ")).toBe(true);
  });
});
