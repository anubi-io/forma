import {
  WebGPURenderer,
  WebGPUBackend,
  BoxGeometry,
  DataTexture,
  FloatType,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  PerspectiveCamera,
  RedFormat,
  RGBAFormat,
  RenderTarget,
  Scene,
  DoubleSide,
} from "three/webgpu";
import { GpuSimulator } from "../../src/engine/gpu";
import { Simulator } from "../../src/engine/simulate";
import { GpuSequenceSimulator } from "../../src/engine/gpuSequence";
import {
  sequenceProgram,
  operationProgram,
  SequenceSimulator,
} from "../../src/engine/sequence";
import {
  prepareSimulation,
  tileStatistics,
  TILE_SIZE,
} from "../../src/engine/prepare";
import { createSurfaceMaterial } from "../../src/scene/RaycastWorkpiece";
import { stockGeometry } from "../../src/scene/geometry";
import { MATERIALS } from "../../src/data/materials";
import { parseProgram } from "../../src/engine/parse";
import { demoCode, DEMO_STOCK, DEMO_TOOLS } from "../../src/data/demo";
import { type Assignments, type Stock } from "../../src/types";
import {
  threadChecks,
  threadHelixChecks,
  threadRangeChecks,
} from "./threadHarness";
export { threadChecks, threadHelixChecks, threadRangeChecks };

export async function compare(
  code: string,
  stock: Stock,
  tools: Assignments,
  resolution: number,
  positions = [1, 0, 0.47, 0.21, 1],
) {
  const renderer = new WebGPURenderer();
  await renderer.init();
  if (!(renderer.backend instanceof WebGPUBackend))
    throw new Error("GPU regression requires an actual WebGPU backend.");
  const program = parseProgram(code);
  const started = performance.now();
  const prepared = prepareSimulation(program, stock, tools, resolution);
  const preparedMs = performance.now() - started;
  const gpu = new GpuSimulator(renderer, prepared);
  const cpu = new Simulator(program, stock, tools, resolution);
  const results = [];
  try {
    for (const position of positions) {
      const expected = cpu.seek(position);
      const actual = await gpu.seek(position);
      if (!actual) throw new Error("Unexpected cancellation");
      const heights = await gpu.readHeights();
      let maxError = 0,
        different = 0,
        squaredError = 0;
      for (let i = 0; i < heights.length; i++) {
        const difference = Math.abs(heights[i] - expected.heights[i]);
        maxError = Math.max(maxError, difference);
        squaredError += difference * difference;
        if (difference > 0.001) different++;
      }
      results.push({
        position,
        maxError,
        different,
        rmse: Math.sqrt(squaredError / heights.length),
        volumeError: Math.abs(actual.removed - expected.removed),
        volume: actual.removed,
        gpuMs: actual.elapsed,
        cpuMs: expected.elapsed,
        processed: actual.processed,
        count: actual.count,
      });
    }
    return {
      preparedMs,
      samples: (prepared.nx + 1) * (prepared.ny + 1),
      results,
    };
  } finally {
    gpu.dispose();
    await renderer.dispose();
  }
}

export function demo(resolution: number) {
  return compare(
    demoCode(),
    DEMO_STOCK,
    DEMO_TOOLS,
    resolution,
    [1, 0.8, 0.65, 0.7, 1, 0, 0.47, 0.21, 1],
  );
}

/** Cross the WebGPU 65,535-workgroup boundary with an analytically known cut. */
export async function maximumGrid() {
  const renderer = new WebGPURenderer();
  await renderer.init();
  const stock: Stock = {
    x: 40,
    y: 40,
    z: 10,
    origin: "corner",
    zOrigin: "top",
  };
  const prepared = prepareSimulation(
    parseProgram("T1 M6\nG0 X20 Y20 Z5\nG1 Z-2"),
    stock,
    { 1: { id: "face", name: "Face mill", kind: "flat", diameter: 100 } },
    5600,
  );
  const gpu = new GpuSimulator(renderer, prepared);
  try {
    const results = [];
    const samples = (prepared.nx + 1) * (prepared.ny + 1);
    for (const fraction of [1, 0, 1]) {
      const result = await gpu.seek(fraction);
      const heights = [];
      for (const index of [
        0,
        5600,
        Math.floor(samples / 2),
        samples - 5601,
        samples - 1,
      ]) {
        heights.push(
          new Float32Array(
            await renderer.getArrayBufferAsync(
              gpu.heightAttribute,
              null,
              index * 4,
              4,
            ),
          )[0],
        );
      }
      results.push({
        removed: result!.removed,
        heights,
        elapsed: result!.elapsed,
      });
    }
    return { samples, workgroups: prepared.batchTiles.length, results };
  } finally {
    gpu.dispose();
    await renderer.dispose();
  }
}

/** Compare visibility to a conventional mesh, including bottom and through-holes. */
export async function renderChecks(
  forceWebGL = false,
  samples = 0,
  dual = false,
) {
  const renderer = new WebGPURenderer({ forceWebGL });
  await renderer.init();
  renderer.setSize(256, 256);
  renderer.setClearColor(0, 0);
  const target = new RenderTarget(256, 256, { samples });
  const scene = new Scene();
  const camera = new PerspectiveCamera(36, 1, 0.1, 10000);
  const stock: Stock = {
    x: 120,
    y: 90,
    z: 18,
    origin: "corner",
    zOrigin: "top",
  };
  const result = [];
  const resources: { dispose(): void }[] = [target];
  try {
    for (const shape of ["flat", "hole", "pocket"] as const) {
      const nx = shape === "flat" && !dual ? 2400 : 128,
        ny = shape === "flat" && !dual ? 1800 : 96;
      const heights = new Float32Array((nx + 1) * (ny + 1)).fill(stock.z);
      if (shape !== "flat")
        for (let y = 0; y <= ny; y++)
          for (let x = 0; x <= nx; x++) {
            if (Math.hypot(x / nx - 0.5, y / ny - 0.5) < 0.2)
              heights[y * (nx + 1) + x] = shape === "hole" ? 0 : 8;
          }
      const tx = Math.ceil((nx + 1) / TILE_SIZE),
        ty = Math.ceil((ny + 1) / TILE_SIZE);
      const lowerHeights = dual
        ? heights.map((h, i) =>
            Math.min(
              h,
              4 +
                (Math.hypot(
                  (i % (nx + 1)) / nx - 0.4,
                  Math.floor(i / (nx + 1)) / ny - 0.5,
                ) < 0.18
                  ? 6
                  : 0),
            ),
          )
        : undefined;
      const lowerTexture = lowerHeights
        ? new DataTexture(lowerHeights, nx + 1, ny + 1, RedFormat, FloatType)
        : undefined;
      if (lowerTexture) {
        lowerTexture.minFilter = lowerTexture.magFilter = NearestFilter;
        lowerTexture.needsUpdate = true;
        resources.push(lowerTexture);
      }
      const heightTexture = new DataTexture(
        heights,
        nx + 1,
        ny + 1,
        RedFormat,
        FloatType,
      );
      const tileTexture = new DataTexture(
        tileStatistics(heights, { nx, ny }),
        tx,
        ty,
        RGBAFormat,
        FloatType,
      );
      for (const t of [heightTexture, tileTexture]) {
        t.minFilter = t.magFilter = NearestFilter;
        t.needsUpdate = true;
      }
      const material = createSurfaceMaterial(
        heightTexture,
        tileTexture,
        stock,
        nx,
        ny,
        MATERIALS[3],
        !forceWebGL,
        lowerTexture,
      );
      const bounds = new BoxGeometry().scale(1, 1, -1).translate(0.5, 0.5, 0.5);
      const proxy = new Mesh(bounds, material);
      proxy.frustumCulled = false;
      const referenceGeometry =
        shape === "flat" && !dual
          ? new BoxGeometry(stock.x, stock.z, stock.y).translate(
              0,
              stock.z / 2,
              0,
            )
          : stockGeometry(stock, {
              nx,
              ny,
              heights,
              lowerHeights,
              removed: 0,
              elapsed: 0,
              count: 0,
              processed: 0,
              warnings: [],
            });
      const referenceMaterial = new MeshBasicMaterial({
        color: "white",
        side: DoubleSide,
      });
      const reference = new Mesh(referenceGeometry, referenceMaterial);
      resources.push(
        heightTexture,
        tileTexture,
        material,
        bounds,
        referenceGeometry,
        referenceMaterial,
      );
      const occluderGeometry = new BoxGeometry(100, 0.5, 70).translate(
        0,
        12,
        0,
      );
      const occluderMaterial = new MeshBasicMaterial({ color: "#00ff00" });
      const occluder = new Mesh(occluderGeometry, occluderMaterial);
      if (shape === "pocket") scene.add(occluder);
      resources.push(occluderGeometry, occluderMaterial);
      for (const [view, position] of Object.entries({
        iso: [160, 180, 210],
        top: [0, 280, 0.001],
        bottom: [0, -280, 0.001],
        front: [0, 12, 280],
      })) {
        camera.position.set(...(position as [number, number, number]));
        camera.lookAt(0, stock.z / 3, 0);
        renderer.setRenderTarget(target);
        scene.add(reference);
        renderer.render(scene, camera);
        const expected = await renderer.readRenderTargetPixelsAsync(
          target,
          0,
          0,
          256,
          256,
        );
        scene.remove(reference);
        scene.add(proxy);
        renderer.render(scene, camera);
        const actual = await renderer.readRenderTargetPixelsAsync(
          target,
          0,
          0,
          256,
          256,
        );
        scene.remove(proxy);
        let missing = 0,
          extra = 0,
          covered = 0,
          depthMismatch = 0;
        const isGreen = (pixels: ArrayLike<number>, i: number) =>
          pixels[i - 3] < 10 && pixels[i - 2] > 100 && pixels[i - 1] < 10;
        for (let i = 3; i < actual.length; i += 4) {
          if (expected[i] > 250) {
            covered++;
            if (actual[i] < 250) missing++;
          }
          if (expected[i] === 0 && actual[i] > 0) extra++;
          if (shape === "pocket") {
            const expectedGreen = isGreen(expected, i),
              actualGreen = isGreen(actual, i);
            // WebGL has no per-sample shader interpolation. Ignore the one-pixel
            // antialiasing edge while requiring exact interior depth ordering.
            if (
              expectedGreen !== actualGreen &&
              (!samples ||
                [-1028, -1024, -1020, -4, 4, 1020, 1024, 1028].every(
                  (offset) => isGreen(expected, i + offset) === expectedGreen,
                ))
            )
              depthMismatch++;
          }
        }
        result.push({ shape, view, missing, extra, covered, depthMismatch });
      }
      scene.remove(occluder);
    }
    return result;
  } finally {
    renderer.setRenderTarget(null);
    for (const r of resources) r.dispose();
    await renderer.dispose();
  }
}

export async function lifecycle() {
  const renderer = new WebGPURenderer();
  await renderer.init();
  const program = parseProgram(
    "T1 M6\nG0 X5 Y5 Z1\n" +
      Array.from(
        { length: 2048 },
        (_, i) => `G1 X${5 + (i % 90)} Y${5 + (i % 70)} Z${-1 - i / 512}`,
      ).join("\n"),
  );
  const stock: Stock = {
    x: 120,
    y: 90,
    z: 18,
    origin: "corner",
    zOrigin: "top",
  };
  const tools: Assignments = {
    1: { id: "ball", name: "Ball", kind: "ball", diameter: 3.175 },
  };
  const prepared = prepareSimulation(program, stock, tools, 160);
  const gpu = new GpuSimulator(renderer, prepared);
  try {
    let calls = 0;
    const cancelled = await gpu.seek(1, () => ++calls > 3);
    const errors = [];
    for (const fraction of [0.83, 0.11, 1]) {
      await gpu.seek(fraction);
      const heights = await gpu.readHeights();
      const expected = new Simulator(program, stock, tools, 160).seek(fraction);
      let error = 0;
      for (let i = 0; i < heights.length; i++)
        error = Math.max(error, Math.abs(heights[i] - expected.heights[i]));
      errors.push(error);
    }
    gpu.dispose();
    const storageAfterDispose = renderer.info.memory.storageAttributes;
    const pending = new GpuSimulator(renderer, prepared);
    const task = pending.seek(1);
    pending.dispose();
    const disposedResult = await task;
    return {
      cancelled: cancelled === undefined,
      errors,
      storageAfterDispose,
      disposedResult: disposedResult === undefined,
      storageAfterPending: renderer.info.memory.storageAttributes,
    };
  } finally {
    gpu.dispose();
    await renderer.dispose();
  }
}

Object.assign(window, {
  gpuHarness: {
    compare,
    demo,
    maximumGrid,
    renderChecks,
    lifecycle,
    sequenceChecks,
    threadChecks,
    threadHelixChecks,
    threadRangeChecks,
  },
});

export async function sequenceChecks() {
  const renderer = new WebGPURenderer();
  await renderer.init();
  if (!(renderer.backend instanceof WebGPUBackend))
    throw new Error("Expected actual WebGPU");
  const results = [];
  try {
    for (const axis of ["x", "y"] as const)
      for (const firstSide of ["top", "bottom"] as const)
        for (const kind of ["flat", "ball", "v"] as const) {
          const stock: Stock = {
            x: 40,
            y: 30,
            z: 10,
            origin: "center",
            zOrigin: "bottom",
          };
          const tools: Assignments = {
            1: { id: kind, name: kind, kind, diameter: 4, angle: 60, tip: 0.2 },
          };
          const top = parseProgram(
            "T1 M6\nG0 X-12 Y-8 Z12\nG1 Z7\nG1 X12 Y8 Z3\nG0 Z12\nM30",
          );
          const bottom = parseProgram(
            "T1 M6\nG0 X-12 Y-8 Z12\nG1 Z5\n" +
              Array.from(
                { length: 1050 },
                (_, i) =>
                  `G1 X${-12 + (i % 24)} Y${-8 + (i % 16)} Z${4 - (i % 5)}`,
              ).join("\n"),
          );
          const program = sequenceProgram(top, bottom, firstSide);
          const prepared = {
            faces: program.operations!.map((op) =>
              prepareSimulation(
                operationProgram(program, op),
                stock,
                tools,
                128,
              ),
            ),
            operations: program.operations!,
            flipAxis: axis,
          };
          const gpu = new GpuSequenceSimulator(renderer, prepared);
          const cpu = new SequenceSimulator(program, stock, tools, 128, axis);
          try {
            let calls = 0;
            const cancelled = await gpu.seek(1, () => ++calls > 3);
            if (cancelled) throw new Error("Expected cancelled seek");
            let maxError = 0,
              volumeError = 0;
            for (const fraction of [
              0,
              program.operations![0].end / (program.moves.length / 10),
              0.9,
              0.25,
              1,
              0.05,
              1,
            ]) {
              const expected = cpu.seek(fraction);
              const actual = await gpu.seek(fraction);
              const bounds = await gpu.readBounds();
              for (let i = 0; i < bounds.heights.length; i++)
                maxError = Math.max(
                  maxError,
                  Math.abs(bounds.heights[i] - expected.heights[i]),
                  Math.abs(bounds.lower[i] - expected.lowerHeights![i]),
                );
              volumeError = Math.max(
                volumeError,
                Math.abs(actual!.removed - expected.removed),
              );
              if (actual!.backend !== "webgpu" || actual!.heights.length !== 0)
                throw new Error("Unexpected CPU surface");
            }
            results.push({ axis, firstSide, kind, maxError, volumeError });
          } finally {
            gpu.dispose();
          }
        }
    return {
      results,
      storageAfterDispose: renderer.info.memory.storageAttributes,
    };
  } finally {
    await renderer.dispose();
  }
}
