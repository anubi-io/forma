import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SimulationRequest,
  SimulationResponse,
} from "../src/engine/worker";
import type { Stock, Tool } from "../src/types";

const stock: Stock = {
  x: 40,
  y: 40,
  z: 10,
  origin: "corner",
  zOrigin: "top",
};
const flat: Tool = {
  id: "flat",
  name: "Flat",
  kind: "flat",
  diameter: 4,
};
const code = "T1 M6\nG0 X10 Y20 Z5\nG1 Z-2\nG1 X30";

describe("simulation worker lifecycle", () => {
  const scope = {
    postMessage: vi.fn(),
    onmessage: undefined as
      ((event: MessageEvent<SimulationRequest>) => void) | undefined,
  };
  let parse: ReturnType<typeof vi.spyOn>;
  const send = (data: SimulationRequest) =>
    scope.onmessage!({ data } as MessageEvent<SimulationRequest>);
  const replies = () =>
    scope.postMessage.mock.calls.map(
      ([message]) => message as SimulationResponse,
    );
  const configure = (revision: number, overrides = {}) =>
    send({
      type: "configure",
      revision,
      stock,
      tools: { 1: flat },
      resolution: 80,
      fraction: 1,
      ...overrides,
    });

  beforeEach(async () => {
    vi.resetModules();
    scope.postMessage.mockReset();
    vi.stubGlobal("self", scope);
    parse = vi.spyOn(await import("../src/engine/parse"), "parseProgram");
    await import("../src/engine/worker");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("parses and publishes the path once across stock/tool/quality changes", () => {
    send({ type: "load", code });
    configure(1);
    configure(2, { stock: { ...stock, z: 12 }, resolution: 160 });
    configure(3, { tools: { 1: { ...flat, diameter: 2 } } });
    expect(parse).toHaveBeenCalledTimes(1);
    expect(
      replies().filter((message) => message.type === "program"),
    ).toHaveLength(1);
    const surfaces = replies().filter((message) => message.type === "surface");
    expect(surfaces.map((message) => message.revision)).toEqual([1, 2, 3]);
    expect(surfaces[1].surface.nx).toBe(160);
    expect(surfaces[1].surface.heights[0]).toBe(12);
    expect(surfaces[2].surface.removed).toBeLessThan(
      surfaces[0].surface.removed,
    );
  });
  it("prepares both faces for WebGPU and retains a cumulative CPU fallback", () => {
    send({
      type: "load",
      code: code + "\nM30",
      bottom: { code, filename: "bottom.nc", firstSide: "top", flipAxis: "x" },
    });
    configure(1, { gpu: true });
    const prepared = replies().find((r) => r.type === "preparedSequence");
    expect(
      prepared?.type === "preparedSequence" &&
        prepared.prepared.faces.map((p) => p.count),
    ).toEqual([3, 3]);
    expect(replies().some((r) => r.type === "surface")).toBe(false);
    configure(2, { gpu: false });
    const message = replies().find((r) => r.type === "surface");
    if (message?.type !== "surface")
      throw new Error("Missing two-sided result");
    expect(message.surface.lowerHeights).toHaveLength(
      message.surface.heights.length,
    );
    expect(message.surface.count).toBe(6);
    const endVolume = message.surface.removed;
    send({ type: "seek", revision: 2, fraction: 0 });
    const start = replies().at(-1);
    expect(start?.type === "surface" && start.surface.removed).toBe(0);
    expect(endVolume).toBeGreaterThan(0);
  });

  it("identifies bottom parse errors and never reuses the previous program", () => {
    send({ type: "load", code });
    configure(1);
    send({
      type: "load",
      code,
      bottom: {
        code: "G81 X10",
        filename: "bad.nc",
        firstSide: "top",
        flipAxis: "x",
      },
    });
    const error = replies().at(-1);
    expect(error?.type === "error" && error.message).toContain("BOTTOM:");
    scope.postMessage.mockClear();
    configure(2);
    expect(replies().map((r) => r.type)).toEqual(["error"]);
  });

  it("reuses the configured simulator and ignores stale seek requests", () => {
    send({ type: "load", code });
    configure(2, { fraction: 0 });
    scope.postMessage.mockClear();
    send({ type: "seek", revision: 1, fraction: 1 });
    expect(replies()).toEqual([]);
    send({ type: "seek", revision: 2, fraction: 1 });
    const message = replies()[0];
    expect(message.type).toBe("surface");
    if (message.type !== "surface") throw new Error("Missing surface");
    expect(message.surface.removed).toBeGreaterThan(0);
    expect(scope.postMessage.mock.calls[0][1]).toEqual({
      transfer: [message.surface.heights.buffer, message.surface.tiles!.buffer],
    });
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("invalidates the previous simulator after a configuration error and recovers", () => {
    send({ type: "load", code });
    configure(1);
    configure(2, { tools: {} });
    expect(replies().at(-1)).toMatchObject({ type: "error", revision: 2 });
    scope.postMessage.mockClear();
    send({ type: "seek", revision: 2, fraction: 1 });
    expect(replies()).toEqual([]);
    configure(3);
    expect(replies().at(-1)).toMatchObject({ type: "surface", revision: 3 });
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("compiles GPU work without a CPU surface and can fall back without reparsing", () => {
    send({ type: "load", code });
    configure(1, { gpu: true });
    const message = replies().at(-1)!;
    expect(message.type).toBe("prepared");
    if (message.type !== "prepared")
      throw new Error("Missing compiled GPU work");
    const p = message.prepared;
    expect(scope.postMessage.mock.calls.at(-1)![1]).toEqual({
      transfer: [
        p.cuts.buffer,
        p.offsets.buffer,
        p.indices.buffer,
        p.batchOffsets.buffer,
        p.batchTiles.buffer,
      ],
    });
    configure(2, { gpu: false });
    expect(replies().at(-1)).toMatchObject({
      type: "surface",
      revision: 2,
      surface: { backend: "cpu" },
    });
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("keeps the parser error on reconfiguration without exposing an old program", () => {
    send({ type: "load", code });
    configure(1);
    send({ type: "load", code: "G1 XNaN" });
    const failure = replies().at(-1);
    expect(failure).toMatchObject({ type: "error" });
    configure(2);
    expect(replies().at(-1)).toEqual({ ...failure, revision: 2 });
    scope.postMessage.mockClear();
    send({ type: "seek", revision: 2, fraction: 1 });
    expect(replies()).toEqual([]);
  });
});
