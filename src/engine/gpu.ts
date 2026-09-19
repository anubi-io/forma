import {
  StorageBufferAttribute,
  StorageTexture,
  FloatType,
  RedFormat,
  RGBAFormat,
  NearestFilter,
  ReadbackBuffer,
  Vector4,
  type WebGPURenderer,
  type ComputeNode,
} from "three/webgpu";
import {
  instanceIndex,
  storage,
  storageTexture,
  texture,
  uniform,
  wgslFn,
  wgsl,
} from "three/tsl";
import { BATCH_SIZE, type PreparedSimulation } from "./prepare";
import {
  CUT_HEIGHT,
  SWEEP,
  RESET,
  RESTORE,
  STATISTICS,
  REDUCE,
} from "./gpuKernels";
import type { Surface } from "../types";

export interface GpuSurface {
  threads?: import("./gpuThreads").ThreadGpuSurface;
  heights: StorageTexture;
  tiles: StorageTexture;
  lower?: StorageTexture;
}
export interface GpuRuntime {
  renderer: WebGPURenderer;
  maxResolution: number;
  fail: (reason: string) => void;
}

export function surfaceTexture(width: number, height: number, rgba = false) {
  const t = new StorageTexture(width, height);
  t.type = FloatType;
  t.format = rgba ? RGBAFormat : RedFormat;
  t.minFilter = t.magFilter = NearestFilter;
  t.generateMipmaps = false;
  return t;
}

export class GpuSimulator {
  readonly gpu: GpuSurface;
  readonly heightAttribute: StorageBufferAttribute;
  private nodes: ComputeNode[] = [];
  private snapshots = new Map<
    number,
    { texture: StorageTexture; restore: ComputeNode }
  >();
  private range = uniform(new Vector4(), "uvec4");
  private dims;
  private scale;
  private heightNode;
  private output;
  private sweep: ComputeNode;
  private reset: ComputeNode;
  private statistics: ComputeNode;
  private reduce: ComputeNode;
  private result = new StorageBufferAttribute(64, 1);
  private readback = new ReadbackBuffer(64 * 4);
  private checkpointStride: number;
  private disposed = false;
  private processed = 0;
  private initialized = false;
  private attributes: StorageBufferAttribute[] = [];
  private pending?: Promise<Surface | undefined>;

  constructor(
    private renderer: WebGPURenderer,
    readonly prepared: PreparedSimulation,
  ) {
    const p = prepared;
    const size = (p.nx + 1) * (p.ny + 1);
    this.gpu = {
      heights: surfaceTexture(p.nx + 1, p.ny + 1),
      tiles: surfaceTexture(p.tilesX, p.tilesY, true),
    };
    this.dims = uniform(new Vector4(p.nx + 1, p.ny + 1, p.tilesX, 16), "uvec4");
    this.scale = uniform(new Vector4(p.sx, p.sy, p.stock.z, p.sx * p.sy));
    this.heightAttribute = new StorageBufferAttribute(size, 1);
    this.attributes.push(this.heightAttribute, this.result);
    this.heightNode = storage(this.heightAttribute, "float", size);
    this.output = storageTexture(this.gpu.heights);
    const read = (array: Float32Array | Uint32Array, components = 1) => {
      const attribute = new StorageBufferAttribute(array, components);
      this.attributes.push(attribute);
      return storage(
        attribute,
        components === 4
          ? "vec4"
          : array instanceof Uint32Array
            ? "uint"
            : "float",
        array.length / components,
      ).toReadOnly();
    };
    const args = {
      id: instanceIndex,
      dims: this.dims,
      scale: this.scale,
      heights: this.heightNode,
      output: this.output,
    };
    this.reset = wgslFn(RESET)(args).compute(size);
    this.sweep = wgslFn(SWEEP, [wgsl(CUT_HEIGHT)])({
      ...args,
      range: this.range,
      cuts: read(p.cuts, 4),
      offsets: read(p.offsets),
      indices: read(p.indices),
      batchList: read(p.batchTiles),
    }).compute(p.tilesX * p.tilesY * 256, [256]);
    const sums = new StorageBufferAttribute(p.tilesX * p.tilesY, 1);
    this.attributes.push(sums);
    this.statistics = wgslFn(STATISTICS)({
      tile: instanceIndex,
      dims: this.dims,
      scale: this.scale,
      heights: storage(this.heightAttribute, "float", size).toReadOnly(),
      sums: storage(sums, "float", sums.count),
      output: storageTexture(this.gpu.tiles),
    }).compute(sums.count);
    this.reduce = wgslFn(REDUCE)({
      id: instanceIndex,
      count: uniform(sums.count, "uint"),
      sums: storage(sums, "float", sums.count).toReadOnly(),
      result: storage(this.result, "float", 64),
    }).compute(64);
    this.nodes.push(this.reset, this.sweep, this.statistics, this.reduce);
    const slots = Math.min(6, Math.floor((96 * 1024 * 1024) / (size * 4)));
    // Checkpoints fall on batch boundaries and are deterministic across seek patterns.
    this.checkpointStride = Math.max(
      BATCH_SIZE,
      Math.ceil(p.count / (slots + 1) / BATCH_SIZE) * BATCH_SIZE,
    );
  }

  seek(
    fraction: number,
    cancelled = () => false,
    measureVolume = true,
  ): Promise<Surface | undefined> {
    if (this.disposed) return Promise.resolve(undefined);
    if (this.pending) throw new Error("GPU seeks must be serialized.");
    const task = this.seekInternal(fraction, cancelled, measureVolume).finally(
      () => {
        this.pending = undefined;
        if (this.disposed) this.release();
      },
    );
    this.pending = task;
    return task;
  }

  private async seekInternal(
    fraction: number,
    cancelled: () => boolean,
    measureVolume: boolean,
  ): Promise<Surface | undefined> {
    if (!Number.isFinite(fraction))
      throw new Error("Invalid playback position.");
    const start = performance.now();
    const p = this.prepared;
    const target = Math.max(
      0,
      Math.min(p.count, Math.round(fraction * p.count)),
    );
    const stopped = () => this.disposed || cancelled();
    if (!this.initialized) {
      await this.renderer.compileComputeAsync(this.nodes);
      if (stopped()) return;
      this.renderer.compute(this.reset);
      this.initialized = true;
    }
    if (target < this.processed) {
      const checkpoint = [...this.snapshots.keys()]
        .filter((k) => k <= target)
        .sort((a, b) => b - a)[0];
      const snapshot = this.snapshots.get(checkpoint);
      this.renderer.compute(snapshot?.restore ?? this.reset);
      this.processed = snapshot ? checkpoint : 0;
    }
    let yielded = performance.now();
    while (this.processed < target) {
      if (stopped()) return;
      const batch = Math.floor(this.processed / BATCH_SIZE);
      const end = Math.min(target, (batch + 1) * BATCH_SIZE);
      const activeOffset = p.batchOffsets[batch];
      const activeCount = p.batchOffsets[batch + 1] - activeOffset;
      if (activeCount) {
        this.range.value.set(this.processed, end, activeOffset, activeCount);
        // Numeric counts let Three split dispatches into two dimensions when
        // high-resolution surfaces exceed 65,535 workgroups.
        this.renderer.compute(this.sweep, activeCount * 256);
      }
      this.processed = end;
      if (
        end < p.count &&
        end % this.checkpointStride === 0 &&
        !this.snapshots.has(end)
      ) {
        const saved = surfaceTexture(p.nx + 1, p.ny + 1);
        this.renderer.copyTextureToTexture(this.gpu.heights, saved);
        const restore = wgslFn(RESTORE)({
          id: instanceIndex,
          dims: this.dims,
          source: texture(saved),
          heights: this.heightNode,
          output: this.output,
        }).compute((p.nx + 1) * (p.ny + 1));
        this.snapshots.set(end, { texture: saved, restore });
        this.nodes.push(restore);
        // Pay pipeline compilation during preparation, never on the first rewind.
        await this.renderer.compileComputeAsync(restore);
      }
      // Yield between bounded dispatches so rapid seeks/configuration changes can cancel work.
      if (performance.now() - yielded > 8) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        yielded = performance.now();
      }
    }
    if (stopped()) return;
    this.renderer.compute(
      measureVolume ? [this.statistics, this.reduce] : this.statistics,
    );
    let removed = 0;
    // A multi-face session performs one reduction after combining the faces.
    // Avoid synchronizing and downloading a redundant volume for each face.
    if (measureVolume) {
      await this.renderer.getArrayBufferAsync(this.result, this.readback);
      try {
        if (stopped()) return;
        for (const value of new Float32Array(this.readback.buffer!))
          removed += value;
      } finally {
        this.readback.release();
      }
    }
    if (!Number.isFinite(removed))
      throw new Error("The GPU returned an invalid surface.");
    return {
      heights: new Float32Array(0),
      gpu: this.gpu,
      nx: p.nx,
      ny: p.ny,
      removed,
      elapsed: performance.now() - start,
      processed: target,
      count: p.count,
      backend: "webgpu",
      warnings: p.warnings.filter((w) => w.at <= target).map((w) => w.message),
    };
  }

  /** Explicit readback for numeric regression tests and exports; never used by playback. */
  async readHeights() {
    return new Float32Array(
      await this.renderer.getArrayBufferAsync(this.heightAttribute),
    );
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (!this.pending) this.release();
  }

  private release() {
    for (const node of this.nodes) node.dispose();
    for (const snapshot of this.snapshots.values()) snapshot.texture.dispose();
    this.gpu.heights.dispose();
    this.gpu.tiles.dispose();
    this.readback.dispose();
    this.snapshots.clear();
    // Compute-only attributes have no geometry owner. Backend destruction is
    // isolated here because Three currently exposes no attribute disposal method.
    const backend = this.renderer.backend as unknown as {
      get(attribute: StorageBufferAttribute): { buffer?: unknown };
      destroyAttribute(attribute: StorageBufferAttribute): void;
    };
    for (const attribute of this.attributes) {
      if (backend.get(attribute).buffer) {
        backend.destroyAttribute(attribute);
        this.renderer.info.destroyAttribute(attribute);
      }
    }
    this.attributes.length = 0;
    this.nodes.length = 0;
  }
}
