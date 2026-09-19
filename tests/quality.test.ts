import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUALITY,
  MAX_GPU_RESOLUTION,
  SIMULATION_QUALITIES,
  gpuResolutionLimit,
  presetResolution,
} from "../src/engine/quality";
import { prepareSimulation, simulationGrid } from "../src/engine/prepare";
import { parseProgram } from "../src/engine/parse";
import { DEFAULT_VIEW, restoreView } from "../src/workspaceStorage";
import { DEFAULT_STOCK } from "../src/types";

describe("backend-aware quality", () => {
  const portableLimits = {
    maxTextureDimension2D: 8192,
    maxStorageBufferBindingSize: 128 * 1024 * 1024,
    maxBufferSize: 256 * 1024 * 1024,
  };

  it("keeps saved preset identities and CPU resolutions while increasing GPU detail", () => {
    expect(SIMULATION_QUALITIES.map((q) => presetResolution(q.value))).toEqual([
      160, 320, 600, 2400,
    ]);
    expect(
      SIMULATION_QUALITIES.map((q) => presetResolution(q.value, 5600)),
    ).toEqual([800, 1600, 3200, 5600]);
    expect(DEFAULT_QUALITY).toBe(600);
    expect(DEFAULT_VIEW.resolution).toBe(600);
    expect(restoreView({}).resolution).toBe(600);
    expect(restoreView({ resolution: 320 }).resolution).toBe(320);
    expect(presetResolution(999)).toBe(600);
  });

  it("fits the entire square heightfield in both texture and storage limits", () => {
    const limit = gpuResolutionLimit(portableLimits);
    expect(limit).toBe(5600);
    expect((limit + 1) ** 2 * 4).toBeLessThanOrEqual(
      portableLimits.maxStorageBufferBindingSize,
    );
    expect(
      gpuResolutionLimit({ ...portableLimits, maxTextureDimension2D: 4096 }),
    ).toBe(4095);
    for (const key of [
      "maxBufferSize",
      "maxStorageBufferBindingSize",
    ] as const) {
      const smaller = { ...portableLimits, [key]: 16 * 1024 * 1024 };
      const limited = gpuResolutionLimit(smaller);
      expect((limited + 1) ** 2 * 4).toBeLessThanOrEqual(smaller[key]);
      expect((limited + 2) ** 2 * 4).toBeGreaterThan(smaller[key]);
      expect(presetResolution(2400, limited)).toBe(limited);
    }
  });

  it("compiles the full GPU grid without raising the CPU cap", () => {
    const prepared = prepareSimulation(
      parseProgram("G0 X1 Y1 Z5"),
      DEFAULT_STOCK,
      {},
      MAX_GPU_RESOLUTION,
    );
    expect([prepared.nx, prepared.ny]).toEqual([5600, 4200]);
    const cpu = simulationGrid(DEFAULT_STOCK, {}, [], MAX_GPU_RESOLUTION);
    expect([cpu.nx, cpu.ny]).toEqual([2400, 1800]);
  });
});
