import {
  STRIDE,
  type Assignments,
  type FlipAxis,
  type Program,
  type Stock,
} from "../types";
import { threadProfile } from "./threadProfile";
import {
  MAX_THREAD_TILES,
  THREAD_TILE,
  THREAD_TEXTURE_WIDTH,
} from "./threadLayout";

export { THREAD_TILE, THREAD_TEXTURE_WIDTH } from "./threadLayout";
export interface PreparedThreads {
  step: number;
  stock: Stock;
  axis: FlipAxis;
  flipAt: number;
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
  cuts: Float32Array;
  /** xyz tile coordinates, with the atlas tile index in w. */
  tiles: Float32Array;
  pages: Float32Array;
  /** Bounded direct-address page table, including origin/dimensions headers. */
  lookup?: Float32Array;
  offsets: Uint32Array;
  /** Per-brick half-open ranges of consecutive cut indices, packed [first, end]. */
  ranges: Uint32Array;
}

// Identical integer hash in WGSL; capacities are powers of two.
export function threadHash(x: number, y: number, z: number, capacity: number) {
  return (
    ((Math.imul(x, 73856093) ^
      Math.imul(y, 19349663) ^
      Math.imul(z, 83492791)) >>>
      0) &
    (capacity - 1)
  );
}

/** Build only a coarse spatial index in the worker. Cutting and volume stay on GPU. */
export function prepareThreads(
  program: Program,
  stock: Stock,
  tools: Assignments,
  resolution: number,
  axis: FlipAxis = "y",
): PreparedThreads | undefined {
  const cutters = program.tools
    .map((id) => tools[id])
    .filter((t) => t?.kind === "thread");
  if (!cutters.length) return;
  cutters.forEach(threadProfile);
  const subdivisions =
    resolution >= 5600
      ? 14
      : resolution >= 3200
        ? 10
        : resolution >= 1600
          ? 8
          : 6;
  const step = Math.max(
    0.005,
    Math.min(...cutters.map((t) => t.pitch!)) / subdivisions,
  );
  const span = step * THREAD_TILE;
  const flipAt = program.operations?.[0].end ?? Infinity;
  const ox = stock.origin === "center" ? stock.x / 2 : 0;
  const oy = stock.origin === "center" ? stock.y / 2 : 0;
  const oz = stock.zOrigin === "top" ? stock.z : 0;
  const entries = new Map<string, { xyz: number[]; ranges: number[] }>();
  const cuts: number[] = [];
  let rangeCount = 0;
  for (let i = 0; i < program.moves.length; i += STRIDE) {
    const m = program.moves;
    const tool = tools[m[i + 6]];
    if (m[i + 7] || tool?.kind !== "thread") continue;
    const profile = threadProfile(tool);
    const a = [m[i] + ox, m[i + 1] + oy, m[i + 2] + oz + profile.halfHeight];
    const b = [
      m[i + 3] + ox,
      m[i + 4] + oy,
      m[i + 5] + oz + profile.halfHeight,
    ];
    if (i / STRIDE >= flipAt)
      for (const p of [a, b]) {
        p[axis === "y" ? 0 : 1] =
          (axis === "y" ? stock.x : stock.y) - p[axis === "y" ? 0 : 1];
        p[2] = stock.z - p[2];
      }
    const extents = [stock.x, stock.y, stock.z];
    const radii = [profile.radius, profile.radius, profile.halfHeight];
    // Clip in double precision before float32 packing, including the tooth and
    // interpolation halo. Off-stock travel must not destroy fine thread detail.
    const delta = b.map((v, k) => v - a[k]);
    let enter = 0,
      leave = 1;
    for (let k = 0; k < 3; k++) {
      const padding = radii[k] + 2 * step;
      if (delta[k] === 0) {
        if (a[k] < -padding || a[k] > extents[k] + padding) leave = -1;
      } else {
        const from = (-padding - a[k]) / delta[k];
        const to = (extents[k] + padding - a[k]) / delta[k];
        enter = Math.max(enter, Math.min(from, to));
        leave = Math.min(leave, Math.max(from, to));
      }
    }
    if (enter > leave) continue;
    for (let k = 0; k < 3; k++) {
      b[k] = a[k] + delta[k] * leave;
      a[k] += delta[k] * enter;
    }
    const low = a.map((v, k) => Math.min(v, b[k]) - radii[k] - 2 * step);
    const high = a.map((v, k) => Math.max(v, b[k]) + radii[k] + 2 * step);
    if (low.some((v, k) => v > extents[k]) || high.some((v) => v < 0)) continue;
    // Bound before iterating: malformed distant paths cannot create huge loops.
    const first = low.map((v) => Math.max(0, Math.floor(v / span)));
    const last = high.map((v, k) =>
      Math.min(Math.ceil(extents[k] / span) - 1, Math.floor(v / span)),
    );
    const cells = last.reduce((n, v, k) => n * (v - first[k] + 1), 1);
    if (cells > MAX_THREAD_TILES)
      throw new Error(
        "Thread volume exceeds the GPU budget. Reduce quality or split the program.",
      );
    const cut = cuts.length / 12;
    cuts.push(
      ...a,
      profile.radius,
      b[0] - a[0],
      b[1] - a[1],
      b[2] - a[2],
      profile.neckRadius,
      profile.slope,
      profile.halfHeight,
      i / STRIDE,
      0,
    );
    for (let z = first[2]; z <= last[2]; z++)
      for (let y = first[1]; y <= last[1]; y++)
        for (let x = first[0]; x <= last[0]; x++) {
          const key = `${x},${y},${z}`;
          let entry = entries.get(key);
          if (!entry) {
            entry = { xyz: [x, y, z], ranges: [] };
            entries.set(key, entry);
            if (entries.size > MAX_THREAD_TILES)
              throw new Error(
                "Thread volume exceeds the 64 MiB GPU field budget. Reduce quality or split the program.",
              );
          }
          // Dense helices revisit the same brick for hundreds of consecutive
          // segments. Store one range without discarding or merging any cuts.
          const runs = entry.ranges;
          if (runs.length && runs[runs.length - 1] === cut) {
            runs[runs.length - 1] = cut + 1;
          } else {
            runs.push(cut, cut + 1);
            // Preserve the original 8 MB index budget, now measured in actual
            // stored words rather than expanded movement/brick references.
            if (++rangeCount * 2 > 2_000_000)
              throw new Error(
                "Thread spatial index exceeds its 8 MB memory budget. Reduce quality.",
              );
          }
        }
  }
  if (!entries.size) return;
  const tiles = new Float32Array(entries.size * 4);
  const offsets = new Uint32Array(entries.size + 1);
  const ranges = new Uint32Array(rangeCount * 2);
  let capacity = 1;
  while (capacity < entries.size * 2) capacity *= 2;
  const pages = new Float32Array(
    Math.max(THREAD_TEXTURE_WIDTH, capacity) * 4,
  ).fill(-1);
  let index = 0,
    cursor = 0;
  const boundsMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const boundsMax: [number, number, number] = [0, 0, 0];
  for (const entry of entries.values()) {
    for (let k = 0; k < 3; k++) {
      boundsMin[k] = Math.min(boundsMin[k], entry.xyz[k] * span);
      boundsMax[k] = Math.min(
        [stock.x, stock.y, stock.z][k],
        Math.max(boundsMax[k], (entry.xyz[k] + 1) * span),
      );
    }
    tiles.set([...entry.xyz, index], index * 4);
    let slot = threadHash(
      entry.xyz[0],
      entry.xyz[1],
      entry.xyz[2],
      pages.length / 4,
    );
    while (pages[slot * 4 + 3] >= 0) slot = (slot + 1) & (pages.length / 4 - 1);
    pages.set([...entry.xyz, index], slot * 4);
    offsets[index] = cursor / 2;
    ranges.set(entry.ranges, cursor);
    cursor += entry.ranges.length;
    index++;
  }
  offsets[index] = cursor / 2;
  const origin = boundsMin.map((v) => Math.round(v / span));
  const dimensions = [0, 0, 0];
  for (let i = 0; i < tiles.length; i += 4)
    for (let k = 0; k < 3; k++)
      dimensions[k] = Math.max(dimensions[k], tiles[i + k] - origin[k] + 1);
  const pageCount = dimensions.reduce((a, b) => a * b, 1);
  // Widely separated holes keep the sparse hash; compact machining regions
  // use constant-time lookup without fragment-shader collision loops.
  let lookup: Float32Array | undefined;
  if (pageCount + 2 <= 262144) {
    lookup = new Float32Array(
      Math.ceil((pageCount + 2) / THREAD_TEXTURE_WIDTH) *
        THREAD_TEXTURE_WIDTH *
        4,
    ).fill(-1);
    lookup.set([...origin, -1, ...dimensions, -1]);
    for (let i = 0; i < tiles.length; i += 4) {
      const id =
        2 +
        tiles[i] -
        origin[0] +
        dimensions[0] *
          (tiles[i + 1] -
            origin[1] +
            dimensions[1] * (tiles[i + 2] - origin[2]));
      lookup[id * 4 + 3] = i / 4;
    }
  }
  return {
    step,
    stock,
    axis,
    flipAt,
    boundsMin,
    boundsMax,
    cuts: new Float32Array(cuts),
    tiles,
    pages,
    lookup,
    offsets,
    ranges,
  };
}
