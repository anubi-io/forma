import {
  STRIDE,
  type Program,
  type Stock,
  type Assignments,
  type Surface,
} from "../types";
import { simulationGrid } from "./prepare";

export class Simulator {
  readonly heights: Float32Array;
  readonly nx: number;
  readonly ny: number;
  processed = 0;
  private checks = 0;
  private warnings = new Set<string>();
  private removed = 0;
  private checkpoints = new Map<
    number,
    {
      heights: Float32Array;
      removed: number;
      checks: number;
      warnings: string[];
    }
  >();
  private readonly checkpointStride: number;
  private readonly initialWarnings: string[];
  constructor(
    readonly program: Program,
    readonly stock: Stock,
    readonly tools: Assignments,
    resolution: number,
  ) {
    const grid = simulationGrid(stock, tools, program.tools, resolution);
    this.nx = grid.nx;
    this.ny = grid.ny;
    this.heights = new Float32Array((this.nx + 1) * (this.ny + 1)).fill(
      stock.z,
    );
    this.initialWarnings = [
      ...grid.warnings,
      ...program.tools
        .filter((id) => tools[id]?.kind === "thread")
        .map(
          (id) =>
            `T${id}: thread material removal requires WebGPU. CPU preview shows the tool and path only; removed volume excludes threading.`,
        ),
    ];
    this.warnings = new Set(this.initialWarnings);
    const slots = Math.min(
      4,
      Math.floor((64 * 1024 * 1024) / this.heights.byteLength),
    );
    this.checkpointStride = Math.max(
      1,
      Math.ceil(program.moves.length / STRIDE / (slots + 1)),
    );
  }
  seek(fraction: number): Surface {
    const start = performance.now(),
      count = this.program.moves.length / STRIDE;
    if (!Number.isFinite(fraction))
      throw new Error("Invalid playback position.");
    const target = Math.min(count, Math.max(0, Math.round(count * fraction)));
    if (target < this.processed) {
      const key = [...this.checkpoints.keys()]
        .filter((key) => key <= target)
        .sort((a, b) => b - a)[0];
      const saved = this.checkpoints.get(key);
      if (saved) {
        this.heights.set(saved.heights);
        this.processed = key;
        this.removed = saved.removed;
        this.checks = saved.checks;
        this.warnings = new Set(saved.warnings);
      } else {
        this.heights.fill(this.stock.z);
        this.processed = 0;
        this.checks = 0;
        this.removed = 0;
        this.warnings = new Set(this.initialWarnings);
      }
    }
    const { stock: s, nx, ny } = this,
      sx = s.x / nx,
      sy = s.y / ny;
    const ox = s.origin === "center" ? s.x / 2 : 0,
      oy = s.origin === "center" ? s.y / 2 : 0,
      oz = s.zOrigin === "top" ? s.z : 0;
    const m = this.program.moves;
    for (let segment = this.processed; segment < target; segment++) {
      if (
        segment > 0 &&
        segment % this.checkpointStride === 0 &&
        !this.checkpoints.has(segment)
      ) {
        this.checkpoints.set(segment, {
          heights: this.heights.slice(),
          removed: this.removed,
          checks: this.checks,
          warnings: [...this.warnings],
        });
      }
      const i = segment * STRIDE;
      const ax = m[i] + ox,
        ay = m[i + 1] + oy,
        az = m[i + 2] + oz,
        bx = m[i + 3] + ox,
        by = m[i + 4] + oy,
        bz = m[i + 5] + oz;
      if (m[i + 7]) {
        if (
          Math.min(az, bz) < s.z - 0.01 &&
          (Math.hypot(bx - ax, by - ay) > 0.001 || bz < az)
        )
          this.warnings.add(
            "Rapid move below the top surface: check the toolpath. Rapids do not remove material.",
          );
        continue;
      }
      if (Math.min(az, bz) >= s.z) continue;
      const tool = this.tools[m[i + 6]],
        r = tool.diameter / 2;
      if (tool.kind === "unsupported" || tool.kind === "thread") continue;
      if (Math.min(az, bz) < 0)
        this.warnings.add("The toolpath extends below the stock bottom.");
      if (
        Math.min(ax, bx) - r < 0 ||
        Math.max(ax, bx) + r > s.x ||
        Math.min(ay, by) - r < 0 ||
        Math.max(ay, by) + r > s.y
      )
        this.warnings.add(
          "Part of the cutter extends beyond the stock XY bounds.",
        );
      if (tool.length && s.z - Math.min(az, bz) > tool.length)
        this.warnings.add(
          `T${m[i + 6]}: depth exceeds the specified cutting length.`,
        );
      const dx = bx - ax,
        dy = by - ay,
        dz = bz - az,
        l2 = dx * dx + dy * dy,
        lowerBound = Math.max(0, Math.min(az, bz)),
        tipRadius = (tool.tip ?? 0) / 2,
        coneSlope =
          tool.kind === "v" ? 1 / Math.tan((tool.angle! * Math.PI) / 360) : 0;
      const minY = Math.max(0, Math.ceil((Math.min(ay, by) - r) / sy)),
        maxY = Math.min(ny, Math.floor((Math.max(ay, by) + r) / sy));
      for (let y = minY; y <= maxY; y++) {
        const py = y * sy;
        let t1 = 0,
          t2 = 1;
        if (Math.abs(dy) > 1e-12) {
          const a = (py - r - ay) / dy,
            b = (py + r - ay) / dy;
          t1 = Math.max(0, Math.min(a, b));
          t2 = Math.min(1, Math.max(a, b));
          if (t1 > t2) continue;
        }
        const minX = Math.max(
            0,
            Math.ceil((Math.min(ax + dx * t1, ax + dx * t2) - r) / sx),
          ),
          maxX = Math.min(
            nx,
            Math.floor((Math.max(ax + dx * t1, ax + dx * t2) + r) / sx),
          );
        for (let x = minX; x <= maxX; x++) {
          const index = y * (nx + 1) + x;
          const oldHeight = this.heights[index];
          // The swept tool cannot cut below the lower endpoint of its tip.
          if (oldHeight <= lowerBound) continue;
          if (++this.checks > 150_000_000)
            throw new Error(
              "Computation budget exceeded. Reduce quality or split the program.",
            );
          const px = x * sx,
            ux = px - ax,
            uy = py - ay;
          const t0 = l2 > 1e-16 ? (ux * dx + uy * dy) / l2 : 0;
          const perp2 =
            l2 > 1e-16 ? (ux * dy - uy * dx) ** 2 / l2 : ux * ux + uy * uy;
          if (perp2 > r * r) continue;
          const half = l2 > 1e-16 ? Math.sqrt((r * r - perp2) / l2) : Infinity;
          const lo = Math.max(0, t0 - half),
            hi = Math.min(1, t0 + half);
          if (lo > hi) continue;
          let t = dz < 0 ? hi : lo;
          if (tool.kind === "ball" && l2 > 1e-16)
            t = Math.max(
              lo,
              Math.min(
                hi,
                t0 -
                  (dz * Math.sqrt(r * r - perp2)) /
                    Math.sqrt(l2 * (l2 + dz * dz)),
              ),
            );
          if (tool.kind === "v" && l2 > 1e-16) {
            // Exact minimum of Z(t) + slope * max(0, radius(t) - tipRadius).
            // Steep ramps reach their minimum at an endpoint. Otherwise solve
            // the cone derivative, then move to the downhill edge of a flat tip.
            const slope2 = coneSlope * coneSlope * l2;
            if (dz * dz < slope2) {
              t = t0 - dz * Math.sqrt(perp2 / (l2 * (slope2 - dz * dz)));
              if (perp2 < tipRadius * tipRadius) {
                const tipHalf = Math.sqrt((tipRadius * tipRadius - perp2) / l2);
                t =
                  dz < 0
                    ? Math.max(t, t0 + tipHalf)
                    : dz > 0
                      ? Math.min(t, t0 - tipHalf)
                      : t0;
              }
              t = Math.max(lo, Math.min(hi, t));
            }
          }
          let height = az + dz * t;
          if (tool.kind !== "flat") {
            const d2 = (ux - dx * t) ** 2 + (uy - dy * t) ** 2;
            height +=
              tool.kind === "ball"
                ? r - Math.sqrt(Math.max(0, r * r - d2))
                : Math.max(0, Math.sqrt(d2) - tipRadius) * coneSlope;
          }
          const h = Math.fround(Math.max(0, height));
          if (h < oldHeight) {
            this.heights[index] = h;
            this.removed +=
              (oldHeight - h) *
              (x === 0 || x === nx ? 0.5 : 1) *
              (y === 0 || y === ny ? 0.5 : 1) *
              sx *
              sy;
          }
        }
      }
    }
    this.processed = target;
    return {
      heights: this.heights.slice(),
      nx,
      ny,
      removed: this.removed,
      elapsed: performance.now() - start,
      processed: target,
      count,
      warnings: [...this.warnings],
    };
  }
}
