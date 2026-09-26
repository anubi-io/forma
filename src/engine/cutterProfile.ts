import type { Tool } from "../types";

export const taperedBall = (t: Tool) =>
  t.kind === "ball" && t.taperAngle !== undefined;
export const validTaper = (t: Tool) =>
  !taperedBall(t) ||
  (Number.isFinite(t.taperAngle) &&
    t.taperAngle! > 0 &&
    t.taperAngle! < 180 &&
    Number.isFinite(t.shank) &&
    t.shank! >= t.diameter &&
    t.shank! <= 100 &&
    Number.isFinite(t.length) &&
    t.length! >= t.diameter / 2 &&
    t.length! <= 2000);

export function taperProfile(t: Tool) {
  const a = (t.taperAngle! * Math.PI) / 360;
  const radius = t.diameter / 2;
  return {
    radius,
    slope: 1 / Math.tan(a),
    join: radius * Math.cos(a),
    offset: radius * (1 / Math.sin(a) - 1),
  };
}

/** Radius of material contact at a depth measured from the physical tip. */
export function contactRadius(t: Tool, depth: number): number {
  if (depth <= 0) return 0;
  if (taperedBall(t)) {
    const p = taperProfile(t);
    const h = Math.min(depth, t.length!);
    return Math.min(
      t.shank! / 2,
      h < p.radius * (1 - Math.sin((t.taperAngle! * Math.PI) / 360))
        ? Math.sqrt(Math.max(0, 2 * p.radius * h - h * h))
        : (h + p.offset) / p.slope,
    );
  }
  const r = t.diameter / 2;
  if (t.kind === "v")
    return Math.min(
      r,
      (t.tip ?? 0) / 2 + depth * Math.tan((t.angle! * Math.PI) / 360),
    );
  if (t.kind === "ball" && depth < r)
    return Math.sqrt(2 * r * depth - depth * depth);
  return r;
}

export const cutterRadius = (t: Tool) =>
  taperedBall(t) ? contactRadius(t, t.length!) : t.diameter / 2;
export const detailDiameter = (t: Tool) =>
  t.kind === "v" ? Math.max(0.01, t.tip ?? 0) : t.diameter;
