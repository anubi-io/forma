import {
  DataTexture,
  FloatType,
  RGBAFormat,
  NearestFilter,
  StorageBufferAttribute,
  ReadbackBuffer,
  Vector3,
  Vector4,
  type ComputeNode,
  type StorageTexture,
  type WebGPURenderer,
} from "three/webgpu";
import {
  instanceIndex,
  storage,
  storageTexture,
  texture,
  uniform,
  wgsl,
  wgslFn,
} from "three/tsl";
import { surfaceTexture, type GpuSurface } from "./gpu";
import { THREAD_TEXTURE_WIDTH, type PreparedThreads } from "./prepareThreads";
import {
  THREAD_DISTANCE,
  THREAD_ATLAS_STRIDE,
  THREAD_FIELD,
  THREAD_PACK,
  THREAD_PACK_VALUE,
  threadFieldShader,
  THREAD_SWEEP,
  THREAD_VOLUME,
} from "./gpuThreadKernels";
import { REDUCE } from "./gpuKernels";
import { TRIANGLE_WGSL } from "../scene/surfaceShaders";
import type { Surface } from "../types";

export interface ThreadGpuSurface {
  field: StorageTexture;
  pages: DataTexture;
  step: number;
  capacity: number;
  flipped: boolean;
  axis: "x" | "y";
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
}

/** Adds localized volumetric subtraction to either the single- or two-face GPU engine. */
export class GpuThreadSimulator {
  readonly threads: ThreadGpuSurface;
  private attributes: StorageBufferAttribute[] = [];
  private nodes: ComputeNode[] = [];
  private values: StorageBufferAttribute;
  private tiles;
  private range = uniform(new Vector4(), "uvec4");
  private info;
  private sweep;
  private pack;
  private volumes = new Map<GpuSurface, ComputeNode>();
  private sums: StorageBufferAttribute;
  private result = new StorageBufferAttribute(64, 1);
  private readback = new ReadbackBuffer(256);
  private reduce;
  private processed = 0;
  private initialized = false;
  private fieldDirty = false;
  private disposed = false;
  private pending?: Promise<Surface | undefined>;

  constructor(
    private renderer: WebGPURenderer,
    private base: {
      seek(
        fraction: number,
        cancelled?: () => boolean,
      ): Promise<Surface | undefined>;
      dispose(): void;
    },
    readonly prepared: PreparedThreads,
  ) {
    const p = prepared,
      count = (p.tiles.length / 4) * 512;
    const pages = new DataTexture(
      p.lookup ?? p.pages,
      THREAD_TEXTURE_WIDTH,
      (p.lookup ?? p.pages).length / 4 / THREAD_TEXTURE_WIDTH,
      RGBAFormat,
      FloatType,
    );
    pages.minFilter = pages.magFilter = NearestFilter;
    pages.generateMipmaps = false;
    pages.needsUpdate = true;
    this.threads = {
      field: surfaceTexture(
        THREAD_TEXTURE_WIDTH,
        Math.ceil(
          ((p.tiles.length / 4) * THREAD_ATLAS_STRIDE) / THREAD_TEXTURE_WIDTH,
        ),
      ),
      pages,
      step: p.step,
      capacity: p.lookup ? 0 : p.pages.length / 4,
      flipped: false,
      axis: p.axis,
      boundsMin: p.boundsMin,
      boundsMax: p.boundsMax,
    };
    this.info = uniform(
      new Vector4(p.step, this.threads.capacity, 0, p.axis === "y" ? 1 : 0),
    );
    const read = (array: Float32Array | Uint32Array, components = 1) => {
      const attribute = new StorageBufferAttribute(array, components);
      this.attributes.push(attribute);
      return storage(
        attribute,
        components === 4 ? "vec4" : "uint",
        array.length / components,
      ).toReadOnly();
    };
    this.values = new StorageBufferAttribute(count, 1);
    this.sums = new StorageBufferAttribute(p.tiles.length / 4, 1);
    this.attributes.push(this.values, this.sums, this.result);
    this.tiles = read(p.tiles, 4);
    this.sweep = wgslFn(THREAD_SWEEP, [wgsl(THREAD_DISTANCE)])({
      id: instanceIndex,
      count: uniform(count, "uint"),
      step: uniform(p.step),
      range: this.range,
      tiles: this.tiles,
      offsets: read(p.offsets),
      ranges: read(p.ranges),
      cuts: read(p.cuts, 4),
      values: storage(this.values, "float", count),
    }).compute(count);
    const atlasCount = (p.tiles.length / 4) * THREAD_ATLAS_STRIDE;
    this.pack = wgslFn(THREAD_PACK, [
      wgsl(threadFieldShader(!!p.lookup)),
      wgsl(THREAD_PACK_VALUE),
    ])({
      id: instanceIndex,
      count: uniform(atlasCount, "uint"),
      info: this.info,
      pages: texture(pages).convert("texture"),
      tiles: this.tiles,
      values: storage(this.values, "float", count).toReadOnly(),
      output: storageTexture(this.threads.field),
    }).compute(atlasCount);
    this.reduce = wgslFn(REDUCE)({
      id: instanceIndex,
      count: uniform(this.sums.count, "uint"),
      sums: storage(this.sums, "float", this.sums.count).toReadOnly(),
      result: storage(this.result, "float", 64),
    }).compute(64);
    this.nodes.push(this.sweep, this.pack, this.reduce);
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
    const start = performance.now();
    const stopped = () => this.disposed || cancelled();
    const surface = await this.base.seek(fraction, stopped);
    if (!surface?.gpu || stopped()) return;
    const target = surface.processed;
    const reset = !this.initialized || target < this.processed;
    if (reset) this.processed = 0;
    if (!this.initialized) {
      await this.renderer.compileComputeAsync(this.nodes);
      if (stopped()) return;
    }
    // Reset must also run for a seek to zero. Skip non-threading spans of the
    // timeline instead of dispatching the volume for every ordinary mill move.
    if (reset) {
      this.range.value.set(0, 0, 1, 0);
      this.renderer.compute(this.sweep);
      this.fieldDirty = true;
      this.initialized = true;
    }
    const cuts = this.prepared.cuts,
      cutCount = cuts.length / 12;
    let next = 0,
      high = cutCount;
    while (next < high) {
      const mid = (next + high) >>> 1;
      if (cuts[mid * 12 + 10] < this.processed) next = mid + 1;
      else high = mid;
    }
    while (this.processed < target) {
      if (stopped()) return;
      if (next === cutCount || cuts[next * 12 + 10] >= target) {
        this.processed = target;
        break;
      }
      next = Math.min(cutCount, next + 256);
      const end = Math.min(target, cuts[(next - 1) * 12 + 10] + 1);
      this.range.value.set(this.processed, end, 0, 0);
      this.renderer.compute(this.sweep);
      this.processed = end;
      this.fieldDirty = true;
      if (end < target)
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    this.threads.flipped = target >= this.prepared.flipAt;
    this.info.value.z = this.threads.flipped ? 1 : 0;
    // A cancelled seek may already have submitted cutting batches. Keep the
    // dirty state until a later seek publishes their atlas, even with no new cuts.
    if (this.fieldDirty) {
      this.renderer.compute(this.pack);
      this.fieldDirty = false;
    }
    let volume = this.volumes.get(surface.gpu);
    if (!volume) {
      volume = wgslFn(THREAD_VOLUME, [wgsl(THREAD_FIELD), wgsl(TRIANGLE_WGSL)])(
        {
          tile: instanceIndex,
          step: uniform(this.prepared.step),
          stock: uniform(
            new Vector3(
              this.prepared.stock.x,
              this.prepared.stock.y,
              this.prepared.stock.z,
            ),
          ),
          info: this.info,
          grid: uniform(new Vector4(surface.nx, surface.ny, 0, 0)),
          heights: texture(surface.gpu.heights),
          lower: texture(surface.gpu.lower ?? surface.gpu.heights),
          dual: uniform(surface.gpu.lower ? 1 : 0, "uint"),
          tiles: this.tiles,
          values: storage(this.values, "float", this.values.count).toReadOnly(),
          sums: storage(this.sums, "float", this.sums.count),
        },
      ).compute(this.sums.count);
      this.nodes.push(volume);
      this.volumes.set(surface.gpu, volume);
      await this.renderer.compileComputeAsync(volume);
      if (stopped()) return;
    }
    this.renderer.compute([volume, this.reduce]);
    let removed = 0;
    await this.renderer.getArrayBufferAsync(this.result, this.readback);
    try {
      if (stopped()) return;
      for (const v of new Float32Array(this.readback.buffer!)) removed += v;
    } finally {
      this.readback.release();
    }
    if (!Number.isFinite(removed))
      throw new Error("The GPU returned an invalid thread volume.");
    return {
      ...surface,
      gpu: { ...surface.gpu, threads: { ...this.threads } },
      removed: surface.removed + removed,
      elapsed: performance.now() - start,
      warnings: [
        ...surface.warnings,
        `Thread preview: idealized single-form tooth, ${this.prepared.step.toFixed(3)} mm local GPU grid.`,
      ],
    };
  }
  /** Test-only readback; normal playback downloads 256 bytes of volume. */
  async readField() {
    return new Float32Array(
      await this.renderer.getArrayBufferAsync(this.values),
    );
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (!this.pending) this.release();
  }
  private release() {
    this.base.dispose();
    for (const n of this.nodes) n.dispose();
    this.nodes = [];
    this.threads.field.dispose();
    this.threads.pages.dispose();
    this.readback.dispose();
    const backend = this.renderer.backend as unknown as {
      get(a: StorageBufferAttribute): { buffer?: unknown };
      destroyAttribute(a: StorageBufferAttribute): void;
    };
    for (const a of this.attributes)
      if (backend.get(a).buffer) {
        backend.destroyAttribute(a);
        this.renderer.info.destroyAttribute(a);
      }
    this.attributes = [];
  }
}
