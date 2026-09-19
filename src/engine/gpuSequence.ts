import {
  StorageBufferAttribute,
  ReadbackBuffer,
  Vector4,
  type ComputeNode,
  type WebGPURenderer,
} from "three/webgpu";
import {
  instanceIndex,
  storage,
  storageTexture,
  texture,
  uniform,
  wgslFn,
} from "three/tsl";
import { GpuSimulator, surfaceTexture, type GpuSurface } from "./gpu";
import { REDUCE } from "./gpuKernels";
import type { PreparedSequence } from "./sequence";
import type { Surface } from "../types";

// Each invocation owns a 16x16 tile. Rotation, intersection of the two faces,
// lower-surface output and volume integration all remain on the GPU.
const COMBINE = /* wgsl */ `
fn combineFaces(tile: u32, dims: vec4u, scale: vec4f, faceIndex: u32,
  first: ptr<storage, array<f32>, read>, second: ptr<storage, array<f32>, read>,
  sums: ptr<storage, array<f32>, read_write>, lower: texture_storage_2d<r32float, write>) -> void {
  let origin = vec2u((tile % dims.z) * 16u, (tile / dims.z) * 16u);
  var sum = 0.0;
  for (var y = 0u; y < 16u; y++) {
    for (var x = 0u; x < 16u; x++) {
      let xy = origin + vec2u(x, y);
      if (xy.x >= dims.x || xy.y >= dims.y) { continue; }
      let i = xy.y * dims.x + xy.x;
      let flipped = select(vec2u(xy.x, dims.y - 1u - xy.y), vec2u(dims.x - 1u - xy.x, xy.y), dims.w == 1u);
      let j = flipped.y * dims.x + flipped.x;
      let high = select(first[i], second[i], faceIndex == 1u);
      let opposite = select(second[j], first[j], faceIndex == 1u);
      let low = min(high, clamp(scale.z - opposite, 0.0, scale.z));
      textureStore(lower, vec2i(xy), vec4f(low, 0.0, 0.0, 0.0));
      let wx = select(1.0, 0.5, xy.x == 0u || xy.x + 1u == dims.x);
      let wy = select(1.0, 0.5, xy.y == 0u || xy.y + 1u == dims.y);
      sum += (scale.z - high + low) * wx * wy;
    }
  }
  sums[tile] = sum * scale.w;
}`;

export class GpuSequenceSimulator {
  private engines: GpuSimulator[];
  private lower;
  private surfaces: GpuSurface[];
  private active = uniform(0, "uint");
  private sums: StorageBufferAttribute;
  private result = new StorageBufferAttribute(64, 1);
  private readback = new ReadbackBuffer(256);
  private nodes: ComputeNode[];
  private pending?: Promise<Surface | undefined>;
  private initialized = false;
  private disposed = false;

  constructor(
    private renderer: WebGPURenderer,
    readonly prepared: PreparedSequence,
  ) {
    const p = prepared.faces[0];
    this.engines = prepared.faces.map(
      (face) => new GpuSimulator(renderer, face),
    );
    this.lower = surfaceTexture(p.nx + 1, p.ny + 1);
    this.surfaces = this.engines.map((engine) => ({
      ...engine.gpu,
      lower: this.lower,
    }));
    this.sums = new StorageBufferAttribute(p.tilesX * p.tilesY, 1);
    const size = (p.nx + 1) * (p.ny + 1);
    const combine = wgslFn(COMBINE)({
      tile: instanceIndex,
      dims: uniform(
        new Vector4(
          p.nx + 1,
          p.ny + 1,
          p.tilesX,
          prepared.flipAxis === "y" ? 1 : 0,
        ),
        "uvec4",
      ),
      scale: uniform(new Vector4(p.sx, p.sy, p.stock.z, p.sx * p.sy)),
      faceIndex: this.active,
      first: storage(
        this.engines[0].heightAttribute,
        "float",
        size,
      ).toReadOnly(),
      second: storage(
        this.engines[1].heightAttribute,
        "float",
        size,
      ).toReadOnly(),
      sums: storage(this.sums, "float", this.sums.count),
      lower: storageTexture(this.lower),
    }).compute(this.sums.count);
    const reduce = wgslFn(REDUCE)({
      id: instanceIndex,
      count: uniform(this.sums.count, "uint"),
      sums: storage(this.sums, "float", this.sums.count).toReadOnly(),
      result: storage(this.result, "float", 64),
    }).compute(64);
    this.nodes = [combine, reduce];
  }

  seek(
    fraction: number,
    cancelled = () => false,
  ): Promise<Surface | undefined> {
    if (this.disposed) return Promise.resolve(undefined);
    if (this.pending) throw new Error("GPU seeks must be serialized.");
    this.pending = this.seekInternal(fraction, cancelled).finally(() => {
      this.pending = undefined;
      if (this.disposed) this.release();
    });
    return this.pending;
  }

  private async seekInternal(fraction: number, cancelled: () => boolean) {
    if (!Number.isFinite(fraction))
      throw new Error("Invalid playback position.");
    const start = performance.now();
    const ops = this.prepared.operations;
    const count = ops.at(-1)!.end;
    const processed = Math.max(
      0,
      Math.min(count, Math.round(fraction * count)),
    );
    const stopped = () => this.disposed || cancelled();
    const surfaces: Surface[] = [];
    for (let i = 0; i < this.engines.length; i++) {
      if (stopped()) return;
      const op = ops[i];
      const result = await this.engines[i].seek(
        Math.max(0, Math.min(1, (processed - op.start) / (op.end - op.start))),
        stopped,
        false,
      );
      if (!result || stopped()) return;
      surfaces.push(result);
    }
    if (!this.initialized) {
      await this.renderer.compileComputeAsync(this.nodes);
      if (stopped()) return;
      this.initialized = true;
    }
    const active = processed < ops[0].end ? 0 : 1;
    this.active.value = active;
    this.renderer.compute(this.nodes);
    let removed = 0;
    await this.renderer.getArrayBufferAsync(this.result, this.readback);
    try {
      if (stopped()) return;
      for (const value of new Float32Array(this.readback.buffer!))
        removed += value;
    } finally {
      this.readback.release();
    }
    if (!Number.isFinite(removed))
      throw new Error("The GPU returned an invalid surface.");
    return {
      ...surfaces[active],
      gpu: this.surfaces[active],
      removed,
      elapsed: performance.now() - start,
      processed,
      count,
      warnings: surfaces.flatMap((s, i) =>
        s.warnings.map((w) => `${ops[i].side.toUpperCase()}: ${w}`),
      ),
    };
  }

  /** Explicit readback for regression tests only; playback never downloads grids. */
  async readBounds() {
    const p = this.prepared.faces[0];
    const size = (p.nx + 1) * (p.ny + 1);
    const attribute = new StorageBufferAttribute(size, 1);
    const read =
      wgslFn(`fn readLower(id: u32, width: u32, count: u32, source: texture_2d<f32>, values: ptr<storage, array<f32>, read_write>) -> void {
      if (id < count) { values[id] = textureLoad(source, vec2i(i32(id % width), i32(id / width)), 0).r; }
    }`)({
        id: instanceIndex,
        width: uniform(p.nx + 1, "uint"),
        count: uniform(size, "uint"),
        source: texture(this.lower),
        values: storage(attribute, "float", size),
      }).compute(size);
    try {
      await this.renderer.computeAsync(read);
      const lower = new Float32Array(
        await this.renderer.getArrayBufferAsync(attribute),
      );
      const heights = await this.engines[this.active.value].readHeights();
      return { heights, lower };
    } finally {
      read.dispose();
      this.destroyAttribute(attribute);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (!this.pending) this.release();
  }
  private destroyAttribute(attribute: StorageBufferAttribute) {
    const backend = this.renderer.backend as unknown as {
      get(a: StorageBufferAttribute): { buffer?: unknown };
      destroyAttribute(a: StorageBufferAttribute): void;
    };
    if (backend.get(attribute).buffer) {
      backend.destroyAttribute(attribute);
      this.renderer.info.destroyAttribute(attribute);
    }
  }
  private release() {
    for (const engine of this.engines) engine.dispose();
    for (const node of this.nodes) node.dispose();
    this.nodes = [];
    this.lower.dispose();
    this.readback.dispose();
    this.destroyAttribute(this.sums);
    this.destroyAttribute(this.result);
  }
}
