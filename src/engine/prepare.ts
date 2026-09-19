import { STRIDE, type Assignments, type Program, type Stock } from "../types";
import { MAX_RESOLUTION, MAX_GPU_RESOLUTION } from "./quality";
import { validThread } from "./threadProfile";
import { stockOrigin } from "./coordinates";
import type { PreparedThreads } from "./prepareThreads";

export const TILE_SIZE = 16;
export const BATCH_SIZE = 512;
export const CUT_STRIDE = 12;
// All storage bindings remain below WebGPU's portable 128 MiB limit.
const MAX_REFERENCES = 16_000_000;

export interface Grid {
  nx: number;
  ny: number;
  tilesX: number;
  tilesY: number;
  sx: number;
  sy: number;
}
export interface PreparedSimulation extends Grid {
  threads?: PreparedThreads;
  stock: Stock;
  count: number;
  cuts: Float32Array;
  offsets: Uint32Array;
  indices: Uint32Array;
  batchOffsets: Uint32Array;
  batchTiles: Uint32Array;
  warnings: { at: number; message: string }[];
}

export function simulationGrid(
  stock: Stock,
  tools: Assignments,
  ids: number[],
  resolution: number,
  maximum = MAX_RESOLUTION,
) {
  stockOrigin(stock);
  if (
    ![stock.x, stock.y, stock.z].every(
      (v) => Number.isFinite(v) && v > 0 && v <= 2000,
    )
  )
    throw new Error("Valid stock dimensions: 0.1–2000 mm.");
  if (!Number.isFinite(resolution))
    throw new Error("Invalid surface resolution.");
  const n = Math.max(32, Math.min(maximum, Math.round(resolution)));
  const longest = Math.max(stock.x, stock.y);
  const nx = Math.max(2, Math.round((n * stock.x) / longest));
  const ny = Math.max(2, Math.round((n * stock.y) / longest));
  const warnings: string[] = [];
  for (const id of ids) {
    const t = tools[id];
    if (!t) throw new Error(`Assign a tool to T${id} to simulate.`);
    if (!Number.isFinite(t.diameter) || t.diameter <= 0 || t.diameter > 100)
      throw new Error(`T${id}: invalid diameter (0.01–100 mm).`);
    if (
      t.kind === "v" &&
      (!Number.isFinite(t.angle) ||
        t.angle! <= 0 ||
        t.angle! >= 180 ||
        !Number.isFinite(t.tip) ||
        t.tip! < 0 ||
        t.tip! > t.diameter)
    )
      throw new Error(`T${id}: invalid angle or tip diameter.`);
    if (t.kind === "unsupported")
      warnings.push(
        `T${id}: special profile, toolpath preview only. Material removal is not simulated for this tool; removed volume excludes this operation.`,
      );
    if (t.kind === "thread" && !validThread(t))
      throw new Error(
        `T${id}: invalid thread cutter pitch, angle or neck diameter.`,
      );
    if (t.diameter < (2 * longest) / n)
      warnings.push(
        `T${id}: diameter is close to the grid spacing. Increase quality for fine detail.`,
      );
  }
  return {
    nx,
    ny,
    sx: stock.x / nx,
    sy: stock.y / ny,
    tilesX: Math.ceil((nx + 1) / TILE_SIZE),
    tilesY: Math.ceil((ny + 1) / TILE_SIZE),
    warnings,
  };
}

/** Conservative scan conversion of a swept capsule into sample tiles. */
function visitTiles(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: number,
  grid: Grid,
  visit: (tile: number) => void,
) {
  const { sx, sy, tilesX, tilesY } = grid;
  const dx = bx - ax,
    dy = by - ay;
  const tw = sx * TILE_SIZE,
    th = sy * TILE_SIZE;
  const first = Math.max(0, Math.floor((Math.min(ay, by) - r) / th));
  const last = Math.min(tilesY - 1, Math.floor((Math.max(ay, by) + r) / th));
  for (let y = first; y <= last; y++) {
    let lo = 0,
      hi = 1;
    if (Math.abs(dy) > 1e-12) {
      const a = (y * th - r - ay) / dy;
      const b = ((y + 1) * th + r - ay) / dy;
      lo = Math.max(0, Math.min(a, b));
      hi = Math.min(1, Math.max(a, b));
      if (lo > hi) continue;
    }
    const min = Math.max(
      0,
      Math.floor((Math.min(ax + dx * lo, ax + dx * hi) - r) / tw),
    );
    const max = Math.min(
      tilesX - 1,
      Math.floor((Math.max(ax + dx * lo, ax + dx * hi) + r) / tw),
    );
    for (let x = min; x <= max; x++) visit(y * tilesX + x);
  }
}

/** Clip in double precision before converting to float32. Very distant moves
 * must not lose sub-millimetre detail while crossing the stock. The rectangle
 * includes the complete cutter radius, so discarded portions cannot cut it. */
function clippedInterval(
  ax: number,
  ay: number,
  dx: number,
  dy: number,
  r: number,
  stock: Stock,
) {
  let lo = 0,
    hi = 1;
  for (const [a, d, extent] of [
    [ax, dx, stock.x],
    [ay, dy, stock.y],
  ]) {
    if (d === 0) {
      if (a < -r || a > extent + r) return;
    } else {
      const first = (-r - a) / d,
        last = (extent + r - a) / d;
      lo = Math.max(lo, Math.min(first, last));
      hi = Math.min(hi, Math.max(first, last));
      if (lo > hi) return;
    }
  }
  return [lo, hi];
}

/** Built in the parser worker. CSR lists are ordered by original move index. */
export function prepareSimulation(
  program: Program,
  stock: Stock,
  tools: Assignments,
  resolution: number,
): PreparedSimulation {
  let { warnings: setupWarnings, ...grid } = simulationGrid(
    stock,
    tools,
    program.tools,
    resolution,
    MAX_GPU_RESOLUTION,
  );
  const count = program.moves.length / STRIDE;
  const cuts = new Float32Array(Math.max(1, count) * CUT_STRIDE);
  const warnings: PreparedSimulation["warnings"] = [];
  const seen = new Set<string>();
  const warn = (at: number, message: string) => {
    if (!seen.has(message)) {
      seen.add(message);
      warnings.push({ at, message });
    }
  };
  const [ox, oy, oz] = stockOrigin(stock);
  const m = program.moves;
  for (let segment = 0; segment < count; segment++) {
    const i = segment * STRIDE,
      k = segment * CUT_STRIDE;
    const ax = m[i] + ox,
      ay = m[i + 1] + oy,
      az = m[i + 2] + oz;
    const bx = m[i + 3] + ox,
      by = m[i + 4] + oy,
      bz = m[i + 5] + oz;
    if (m[i + 7]) {
      if (
        Math.min(az, bz) < stock.z - 0.01 &&
        (Math.hypot(bx - ax, by - ay) > 0.001 || bz < az)
      )
        warn(
          segment + 1,
          "Rapid move below the top surface: check the toolpath. Rapids do not remove material.",
        );
      continue;
    }
    if (Math.min(az, bz) >= stock.z) continue;
    const tool = tools[m[i + 6]],
      r = tool.diameter / 2;
    if (tool.kind === "unsupported" || tool.kind === "thread") continue;
    if (Math.min(az, bz) < 0)
      warn(segment + 1, "The toolpath extends below the stock bottom.");
    if (
      Math.min(ax, bx) - r < 0 ||
      Math.max(ax, bx) + r > stock.x ||
      Math.min(ay, by) - r < 0 ||
      Math.max(ay, by) + r > stock.y
    )
      warn(
        segment + 1,
        "Part of the cutter extends beyond the stock XY bounds.",
      );
    if (tool.length && stock.z - Math.min(az, bz) > tool.length)
      warn(
        segment + 1,
        `T${m[i + 6]}: depth exceeds the specified cutting length.`,
      );
    const epsilon = Math.max(stock.x, stock.y) * 2e-7;
    const interval = clippedInterval(
      ax,
      ay,
      bx - ax,
      by - ay,
      r + epsilon,
      stock,
    );
    if (!interval) continue;
    const [lo, hi] = interval;
    const x = ax + (bx - ax) * lo,
      y = ay + (by - ay) * lo,
      z = az + (bz - az) * lo;
    const dx = (bx - ax) * (hi - lo),
      dy = (by - ay) * (hi - lo),
      dz = (bz - az) * (hi - lo);
    if (Math.min(z, z + dz) >= stock.z) continue;
    cuts.set(
      [
        x,
        y,
        z,
        r,
        dx,
        dy,
        dz,
        tool.kind === "ball" ? 1 : tool.kind === "v" ? 2 : 0,
        (tool.tip ?? 0) / 2,
        tool.kind === "v" ? 1 / Math.tan((tool.angle! * Math.PI) / 360) : 0,
        Math.max(0, Math.min(z, z + dz)),
        1,
      ],
      k,
    );
  }
  // Keep all cuts and timeline indices. Only the surface sampling changes when
  // a dense path needs more index memory than the portable GPU budget permits.
  // Count before allocating the large buffers, and reuse the clipped cuts on retries.
  let counts: Uint32Array;
  let references: number;
  for (;;) {
    counts = new Uint32Array(grid.tilesX * grid.tilesY);
    references = 0;
    for (let segment = 0; segment < count; segment++) {
      const k = segment * CUT_STRIDE;
      if (!cuts[k + 11]) continue;
      visitTiles(
        cuts[k],
        cuts[k + 1],
        cuts[k] + cuts[k + 4],
        cuts[k + 1] + cuts[k + 5],
        cuts[k + 3] + Math.max(stock.x, stock.y) * 2e-7,
        grid,
        (tile) => {
          counts[tile]++;
          references++;
        },
      );
      if (references > MAX_REFERENCES) break;
    }
    if (references <= MAX_REFERENCES) break;
    const current = Math.max(grid.nx, grid.ny);
    // At 32 cells there are at most nine tiles, so every parser-supported
    // program (up to one million moves) fits even if every cut covers the stock.
    if (current <= 32)
      throw new Error("The program exceeds the supported simulation size.");
    ({ warnings: setupWarnings, ...grid } = simulationGrid(
      stock,
      tools,
      program.tools,
      Math.max(32, Math.floor(current * 0.75)),
      MAX_GPU_RESOLUTION,
    ));
  }
  const tileCount = grid.tilesX * grid.tilesY;
  const offsets = new Uint32Array(tileCount + 1);
  for (let i = 0; i < tileCount; i++) offsets[i + 1] = offsets[i] + counts[i];
  const indices = new Uint32Array(Math.max(1, references));
  const cursors = offsets.slice(0, tileCount);
  for (let segment = 0; segment < count; segment++) {
    const k = segment * CUT_STRIDE;
    if (!cuts[k + 11]) continue;
    // Both passes use identical clipped coordinates and conservative padding.
    visitTiles(
      cuts[k],
      cuts[k + 1],
      cuts[k] + cuts[k + 4],
      cuts[k + 1] + cuts[k + 5],
      cuts[k + 3] + Math.max(stock.x, stock.y) * 2e-7,
      grid,
      (tile) => {
        indices[cursors[tile]++] = segment;
      },
    );
  }
  const batches = Math.ceil(count / BATCH_SIZE);
  const batchCounts = new Uint32Array(batches);
  for (let tile = 0; tile < tileCount; tile++) {
    let previous = -1;
    for (let j = offsets[tile]; j < offsets[tile + 1]; j++) {
      const batch = Math.floor(indices[j] / BATCH_SIZE);
      if (batch !== previous) {
        batchCounts[batch]++;
        previous = batch;
      }
    }
  }
  const batchOffsets = new Uint32Array(batches + 1);
  for (let i = 0; i < batches; i++)
    batchOffsets[i + 1] = batchOffsets[i] + batchCounts[i];
  const batchTiles = new Uint32Array(Math.max(1, batchOffsets[batches]));
  const next = batchOffsets.slice();
  for (let tile = 0; tile < tileCount; tile++) {
    let previous = -1;
    for (let j = offsets[tile]; j < offsets[tile + 1]; j++) {
      const batch = Math.floor(indices[j] / BATCH_SIZE);
      if (batch !== previous) {
        batchTiles[next[batch]++] = tile;
        previous = batch;
      }
    }
  }
  return {
    ...grid,
    stock,
    count,
    cuts,
    offsets,
    indices,
    batchOffsets,
    batchTiles,
    warnings: [
      ...setupWarnings.map((message) => ({ at: 0, message })),
      ...warnings,
    ],
  };
}

export function tileStatistics(
  heights: Float32Array,
  grid: Pick<Grid, "nx" | "ny">,
) {
  const { nx, ny } = grid;
  const tx = Math.ceil((nx + 1) / TILE_SIZE),
    ty = Math.ceil((ny + 1) / TILE_SIZE);
  const result = new Float32Array(tx * ty * 4);
  for (let y = 0; y < ty; y++)
    for (let x = 0; x < tx; x++) {
      let min = Infinity,
        max = 0;
      for (let j = y * TILE_SIZE; j <= Math.min(ny, (y + 1) * TILE_SIZE); j++)
        for (
          let i = x * TILE_SIZE;
          i <= Math.min(nx, (x + 1) * TILE_SIZE);
          i++
        ) {
          const h = heights[j * (nx + 1) + i];
          min = Math.min(min, h);
          max = Math.max(max, h);
        }
      result[(y * tx + x) * 4] = min;
      result[(y * tx + x) * 4 + 1] = max;
    }
  return result;
}
