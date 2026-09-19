import {
  WebGPURenderer,
  WebGPUBackend,
  Scene,
  Mesh,
  BoxGeometry,
  PerspectiveCamera,
  RenderTarget,
  StorageBufferAttribute,
  Vector4,
} from "three/webgpu";
import {
  instanceIndex,
  storage,
  texture,
  uniform,
  wgsl,
  wgslFn,
} from "three/tsl";
import { threadFieldShader } from "../../src/engine/gpuThreadKernels";
import { GpuSimulator } from "../../src/engine/gpu";
import { GpuSequenceSimulator } from "../../src/engine/gpuSequence";
import { sequenceProgram, operationProgram } from "../../src/engine/sequence";
import { GpuThreadSimulator } from "../../src/engine/gpuThreads";
import { prepareThreads } from "../../src/engine/prepareThreads";
import { prepareSimulation } from "../../src/engine/prepare";
import { parseProgram } from "../../src/engine/parse";
import { threadProfile } from "../../src/engine/threadProfile";
import { createSurfaceMaterial } from "../../src/scene/RaycastWorkpiece";
import { MATERIALS } from "../../src/data/materials";
import type { Stock, Tool } from "../../src/types";
import fixture from "../fixtures/thread-m5.forma.json";
import type { Assignments, Surface } from "../../src/types";

export async function threadHelixChecks() {
  const renderer = new WebGPURenderer();
  await renderer.init();
  renderer.setSize(360, 300);
  const stock = fixture.stock as Stock,
    tools = fixture.assignments as Assignments;
  const program = parseProgram(fixture.code);
  const prepared = prepareThreads(program, stock, tools, 3200)!;
  const base = new GpuSimulator(
    renderer,
    prepareSimulation(program, stock, tools, 240),
  );
  const gpu = new GpuThreadSimulator(renderer, base, prepared);
  const renderMs: number[] = [];
  const render = async (surface: Surface, threads: boolean) => {
    const scene = new Scene();
    const geometry = new BoxGeometry(1, 1, 1)
      .scale(1, 1, -1)
      .translate(0.5, 0.5, 0.5);
    const mat = createSurfaceMaterial(
      surface.gpu!.heights,
      surface.gpu!.tiles,
      stock,
      surface.nx,
      surface.ny,
      MATERIALS[0],
      true,
      surface.gpu!.lower,
      threads ? surface.gpu!.threads : undefined,
    );
    const mesh = new Mesh(geometry, mat);
    mesh.frustumCulled = false;
    scene.add(mesh);
    const camera = new PerspectiveCamera(40, 360 / 300, 0.01, 100);
    camera.position.set(3, 15, 5);
    camera.lookAt(0, 3, 0);
    const target = new RenderTarget(360, 300);
    renderer.setRenderTarget(target);
    await renderer.renderAsync(scene, camera);
    await renderer.readRenderTargetPixelsAsync(target, 0, 0, 1, 1);
    // Exclude shader compilation; fence each frame with the same small readback.
    if (threads) {
      const start = performance.now();
      for (let frame = 0; frame < 8; frame++) {
        await renderer.renderAsync(scene, camera);
        await renderer.readRenderTargetPixelsAsync(target, 0, 0, 1, 1);
      }
      renderMs.push((performance.now() - start) / 8);
    }
    const pixels = new Uint8Array(
      await renderer.readRenderTargetPixelsAsync(target, 0, 0, 360, 300),
    );
    renderer.setRenderTarget(null);
    target.dispose();
    geometry.dispose();
    mat.dispose();
    return pixels;
  };
  let changedPixels = 0,
    addedVolume = 0,
    step = 0;
  const flippedVolumes: number[] = [];
  try {
    const surface = (await gpu.seek(1))!;
    const baseSurface = (await base.seek(1))!;
    addedVolume = surface.removed - baseSurface.removed;
    step = prepared.step;
    const before = await render(surface, false),
      after = await render(surface, true);
    for (let i = 0; i < before.length; i += 4)
      if (
        Math.abs(before[i] - after[i]) +
          Math.abs(before[i + 1] - after[i + 1]) +
          Math.abs(before[i + 2] - after[i + 2]) >
        15
      )
        changedPixels++;
  } finally {
    gpu.dispose();
  }
  // The same first-face helix remains after a flip with no second-face cuts.
  // Run both orders and axes, and compile the dual-surface masked renderer.
  for (const axis of ["x", "y"] as const)
    for (const firstSide of ["top", "bottom"] as const) {
      const idle = parseProgram("T1 M6\nG0 X0 Y0 Z2\nG0 X1");
      const p = sequenceProgram(
        firstSide === "top" ? program : idle,
        firstSide === "top" ? idle : program,
        firstSide,
      );
      const seq = {
        faces: p.operations!.map((op) =>
          prepareSimulation(operationProgram(p, op), stock, tools, 240),
        ),
        operations: p.operations!,
        flipAxis: axis,
      };
      const engine = new GpuThreadSimulator(
        renderer,
        new GpuSequenceSimulator(renderer, seq),
        prepareThreads(p, stock, tools, 1600, axis)!,
      );
      try {
        const surface = (await engine.seek(1))!;
        flippedVolumes.push(surface.removed);
        await render(surface, true);
        const empty = (await engine.seek(0))!;
        if (empty.removed !== 0)
          throw new Error("Flip rewind retained material removal");
        if (!(await engine.seek(1))!.gpu!.threads!.flipped)
          throw new Error("Missing flipped field");
      } finally {
        engine.dispose();
      }
    }
  // A later larger bore must erase the entire thread and count overlap once.
  const erase = parseProgram(fixture.code + "\nT3 M6\nG0 X6 Y6 Z2\nG1 Z-7");
  const eraseTools = {
    ...tools,
    3: { id: "erase", name: "Erase", kind: "flat" as const, diameter: 6 },
  };
  const eraseBase = new GpuSimulator(
    renderer,
    prepareSimulation(erase, stock, eraseTools, 240),
  );
  const eraser = new GpuThreadSimulator(
    renderer,
    eraseBase,
    prepareThreads(erase, stock, eraseTools, 1600)!,
  );
  let overlapError = 0;
  try {
    const surface = (await eraser.seek(1))!;
    overlapError = Math.abs(
      surface.removed - (await eraseBase.seek(1))!.removed,
    );
  } finally {
    eraser.dispose();
  }
  const storageAfterDispose = renderer.info.memory.storageAttributes;
  await renderer.dispose();
  return {
    changedPixels,
    addedVolume,
    flippedVolumes,
    overlapError,
    step,
    storageAfterDispose,
    renderMs,
  };
}

async function checkThreadAtlas(
  renderer: WebGPURenderer,
  gpu: GpuThreadSimulator,
  field: Float32Array,
) {
  const { tiles, step } = gpu.prepared;
  const pages = new Map<string, number>();
  const positions: number[] = [];
  for (let i = 0; i < tiles.length; i += 4) {
    pages.set(`${tiles[i]},${tiles[i + 1]},${tiles[i + 2]}`, i / 4);
    // Interpolation across every face and stock boundary, not only voxel centres.
    for (const delta of [-0.25, 0.25, 7.25, 7.75])
      positions.push(
        (tiles[i] * 8 + delta + 0.5) * step,
        (tiles[i + 1] * 8 + delta + 0.5) * step,
        (tiles[i + 2] * 8 + delta + 0.5) * step,
        0,
      );
  }
  const input = new StorageBufferAttribute(new Float32Array(positions), 4);
  const output = new StorageBufferAttribute(positions.length / 4, 1);
  const sample = wgslFn(
    `fn sampleAtlas(id:u32, count:u32, field:texture_2d<f32>, pages:texture_2d<f32>, info:vec4f,
    points:ptr<storage,array<vec4f>,read>, result:ptr<storage,array<f32>,read_write>) -> void {
    if(id<count) {result[id]=threadField(field,pages,points[id].xyz,info);}
  }`,
    [wgsl(threadFieldShader(gpu.threads.capacity === 0))],
  )({
    id: instanceIndex,
    count: uniform(output.count, "uint"),
    field: texture(gpu.threads.field).convert("texture"),
    pages: texture(gpu.threads.pages).convert("texture"),
    info: uniform(new Vector4(step, gpu.threads.capacity, 0, 0)),
    points: storage(input, "vec4", input.count).toReadOnly(),
    result: storage(output, "float", output.count),
  }).compute(output.count);
  let maxError = 0;
  try {
    await renderer.computeAsync(sample);
    const actual = new Float32Array(await renderer.getArrayBufferAsync(output));
    const read = (x: number, y: number, z: number) => {
      if (Math.min(x, y, z) < 0) return step * 4;
      const page = pages.get(
        `${Math.floor(x / 8)},${Math.floor(y / 8)},${Math.floor(z / 8)}`,
      );
      return page === undefined
        ? step * 4
        : field[page * 512 + (x % 8) + (y % 8) * 8 + (z % 8) * 64];
    };
    for (let i = 0; i < actual.length; i++) {
      const uv = positions
        .slice(i * 4, i * 4 + 3)
        .map((v) => Math.fround(v) / step - 0.5);
      const cell = uv.map(Math.floor),
        f = uv.map((v, k) => v - cell[k]);
      let expected = 0;
      for (let z = 0; z < 2; z++)
        for (let y = 0; y < 2; y++)
          for (let x = 0; x < 2; x++)
            expected +=
              read(cell[0] + x, cell[1] + y, cell[2] + z) *
              (x ? f[0] : 1 - f[0]) *
              (y ? f[1] : 1 - f[1]) *
              (z ? f[2] : 1 - f[2]);
      const page = pages.get(
        cell.map((v) => Math.floor(Math.max(0, v) / 8)).join(","),
      );
      if (page !== undefined)
        maxError = Math.max(maxError, Math.abs(expected - actual[i]));
      else if (expected < 0 || actual[i] < 0)
        throw new Error("Missing brick borders a zero crossing");
    }
  } finally {
    sample.dispose();
    const backend = renderer.backend as unknown as {
      destroyAttribute(a: StorageBufferAttribute): void;
    };
    for (const a of [input, output]) {
      backend.destroyAttribute(a);
      renderer.info.destroyAttribute(a);
    }
  }
  return maxError;
}

export async function threadChecks(direct = true) {
  const renderer = new WebGPURenderer();
  await renderer.init();
  if (!(renderer.backend instanceof WebGPUBackend))
    throw new Error("Expected WebGPU");
  renderer.setSize(320, 240);
  const stock: Stock = { x: 12, y: 12, z: 6, origin: "corner", zOrigin: "top" };
  const tool: Tool = {
    id: "thread",
    name: "Thread",
    kind: "thread",
    diameter: 2,
    neck: 1,
    pitch: 0.8,
    angle: 60,
    length: 8,
  };
  const code =
    "T1 M6\nG0 X5 Y6 Z-4\nG1 X7 Y6 Z-2\nG1 X5 Y7 Z-3\nG0 Z3\nG0 X0 Y0 Z-6\nG1 X1 Z-5.8\nG0 Z3";
  const program = parseProgram(code);
  const prepared = prepareThreads(program, stock, { 1: tool }, 1600)!;
  if (!direct) prepared.lookup = undefined;
  const base = new GpuSimulator(
    renderer,
    prepareSimulation(program, stock, { 1: tool }, 96),
  );
  const gpu = new GpuThreadSimulator(renderer, base, prepared);
  const profile = threadProfile(tool);
  let mismatches = 0,
    checked = 0;
  const volumes: number[] = [];
  let renderedPixels = 0;
  let atlasError = 0;
  try {
    await gpu.seek(1, () => true);
    for (const fraction of [1, 0, 0.5, 0.2, 1]) {
      const surface = await gpu.seek(fraction);
      if (!surface) throw new Error("Missing thread surface");
      volumes.push(surface.removed);
      const field = await gpu.readField();
      atlasError = Math.max(
        atlasError,
        await checkThreadAtlas(renderer, gpu, field),
      );
      if (fraction !== 1) continue;
      // Independent densely sampled swept solid, away from a small boundary tolerance.
      for (let id = 0; id < field.length; id += 97) {
        const tile = Math.floor(id / 512),
          local = id % 512;
        const x =
          (prepared.tiles[tile * 4] * 8 + (local % 8) + 0.5) * prepared.step;
        const y =
          (prepared.tiles[tile * 4 + 1] * 8 +
            (Math.floor(local / 8) % 8) +
            0.5) *
          prepared.step;
        const z =
          (prepared.tiles[tile * 4 + 2] * 8 + Math.floor(local / 64) + 0.5) *
          prepared.step;
        let distance = Infinity;
        for (let k = 0; k < prepared.cuts.length; k += 12)
          for (let j = 0; j <= 400; j++) {
            const t = j / 400;
            const radial = Math.hypot(
              x - prepared.cuts[k] - prepared.cuts[k + 4] * t,
              y - prepared.cuts[k + 1] - prepared.cuts[k + 5] * t,
            );
            const centre = prepared.cuts[k + 2] + prepared.cuts[k + 6] * t;
            const half =
              profile.halfHeight -
              Math.max(0, radial - profile.neckRadius) * profile.slope;
            distance = Math.min(
              distance,
              Math.max(radial - profile.radius, Math.abs(z - centre) - half),
            );
          }
        if (Math.abs(distance) > 0.015) {
          checked++;
          if (distance < 0 !== field[id] < 0) mismatches++;
        }
      }
      const scene = new Scene();
      const geometry = new BoxGeometry(1, 1, 1)
        .scale(1, 1, -1)
        .translate(0.5, 0.5, 0.5);
      const mat = createSurfaceMaterial(
        surface.gpu!.heights,
        surface.gpu!.tiles,
        stock,
        surface.nx,
        surface.ny,
        MATERIALS[0],
        true,
        undefined,
        surface.gpu!.threads,
      );
      const mesh = new Mesh(geometry, mat);
      mesh.frustumCulled = false;
      scene.add(mesh);
      const camera = new PerspectiveCamera(45, 320 / 240, 0.01, 100);
      camera.position.set(12, 16, 14);
      camera.lookAt(0, 3, 0);
      const target = new RenderTarget(320, 240);
      renderer.setRenderTarget(target);
      await renderer.renderAsync(scene, camera);
      const pixels = await renderer.readRenderTargetPixelsAsync(
        target,
        0,
        0,
        320,
        240,
      );
      renderedPixels = Array.from(pixels).filter(
        (v, i) => i % 4 !== 3 && v > 0,
      ).length;
      renderer.setRenderTarget(null);
      target.dispose();
      geometry.dispose();
      mat.dispose();
    }
  } finally {
    gpu.dispose();
  }
  const storageAfterDispose = renderer.info.memory.storageAttributes;
  await renderer.dispose();
  return {
    mismatches,
    checked,
    volumes,
    renderedPixels,
    storageAfterDispose,
    atlasError,
  };
}

/** Compare compressed runs with an explicit singleton index at partial seeks.
 * Separate visits produce gaps; each long visit crosses several GPU batches. */
export async function threadRangeChecks() {
  const renderer = new WebGPURenderer();
  await renderer.init();
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
  const lines = ["T1 M6"];
  for (const [x, y, z] of [
    [3, 3, -4],
    [9, 9, -3],
    [3, 3, -2],
  ]) {
    lines.push(`G0 X${x} Y${y} Z${z}`);
    for (let i = 0; i < 600; i++)
      lines.push(`G1 X${x + (i % 2) * 0.01} Z${z + i * 0.0005}`);
  }
  const program = parseProgram(lines.join("\n"));
  const prepared = prepareThreads(program, stock, { 1: tool }, 1600)!;
  const singles: number[] = [];
  const offsets = new Uint32Array(prepared.offsets.length);
  for (let tile = 0; tile < offsets.length - 1; tile++) {
    offsets[tile] = singles.length / 2;
    for (let j = prepared.offsets[tile]; j < prepared.offsets[tile + 1]; j++)
      for (
        let cut = prepared.ranges[j * 2];
        cut < prepared.ranges[j * 2 + 1];
        cut++
      )
        singles.push(cut, cut + 1);
  }
  offsets[offsets.length - 1] = singles.length / 2;
  const explicit = { ...prepared, offsets, ranges: new Uint32Array(singles) };
  const engines = [prepared, explicit].map(
    (p) =>
      new GpuThreadSimulator(
        renderer,
        new GpuSimulator(
          renderer,
          prepareSimulation(program, stock, { 1: tool }, 64),
        ),
        p,
      ),
  );
  let maxError = 0,
    volumeError = 0;
  try {
    for (const fraction of [1, 0.17, 0.55, 0.87, 0, 1]) {
      const a = (await engines[0].seek(fraction))!;
      const b = (await engines[1].seek(fraction))!;
      volumeError = Math.max(volumeError, Math.abs(a.removed - b.removed));
      const fa = await engines[0].readField(),
        fb = await engines[1].readField();
      for (let i = 0; i < fa.length; i++)
        maxError = Math.max(maxError, Math.abs(fa[i] - fb[i]));
    }
  } finally {
    engines.forEach((e) => e.dispose());
  }
  const storageAfterDispose = renderer.info.memory.storageAttributes;
  await renderer.dispose();
  return {
    maxError,
    volumeError,
    storageAfterDispose,
    compressedBytes: prepared.ranges.byteLength,
    explicitBytes: explicit.ranges.byteLength,
  };
}
