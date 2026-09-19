import type { Tool } from "../types";

/** Continuous swept envelope, using the same flat/ball/V geometry as Simulator.
 * Infinity means the sample is outside the cutter. No stepping along the path. */
export function analysisSweep(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  tool: Tool,
) {
  const dx = bx - ax,
    dy = by - ay,
    dz = bz - az;
  const l2 = dx * dx + dy * dy;
  const r = tool.diameter / 2,
    r2 = r * r;
  const tipRadius = (tool.tip ?? 0) / 2;
  const slope =
    tool.kind === "v" ? 1 / Math.tan((tool.angle! * Math.PI) / 360) : 0;
  return (px: number, py: number) => {
    const ux = px - ax,
      uy = py - ay;
    const t0 = l2 > 1e-16 ? (ux * dx + uy * dy) / l2 : 0;
    const perp2 =
      l2 > 1e-16 ? (ux * dy - uy * dx) ** 2 / l2 : ux * ux + uy * uy;
    if (perp2 > r2) return Infinity;
    const half = l2 > 1e-16 ? Math.sqrt((r2 - perp2) / l2) : Infinity;
    const lo = Math.max(0, t0 - half),
      hi = Math.min(1, t0 + half);
    if (lo > hi) return Infinity;
    let t = dz < 0 ? hi : lo;
    if (tool.kind === "ball" && l2 > 1e-16)
      t = Math.max(
        lo,
        Math.min(
          hi,
          t0 - (dz * Math.sqrt(r2 - perp2)) / Math.sqrt(l2 * (l2 + dz * dz)),
        ),
      );
    if (tool.kind === "v" && l2 > 1e-16) {
      const slope2 = slope * slope * l2;
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
          ? r - Math.sqrt(Math.max(0, r2 - d2))
          : Math.max(0, Math.sqrt(d2) - tipRadius) * slope;
    }
    return height;
  };
}
