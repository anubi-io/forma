import type { Tool } from "../types";

export function validThread(tool: Tool) {
  return (
    Number.isFinite(tool.pitch) &&
    tool.pitch! >= 0.05 &&
    tool.pitch! <= 10 &&
    Number.isFinite(tool.angle) &&
    tool.angle! > 0 &&
    tool.angle! < 180 &&
    Number.isFinite(tool.neck) &&
    tool.neck! > 0 &&
    tool.neck! < tool.diameter
  );
}

/** Ideal single-form tooth, with its bottom at the programmed tool tip.
 * The helix pitch/hand comes from the path, never from the tool's name. */
export function threadProfile(tool: Tool) {
  if (!validThread(tool))
    throw new Error("Invalid thread cutter pitch, angle or neck diameter.");
  const radius = tool.diameter / 2;
  const neckRadius = tool.neck! / 2;
  const slope = Math.tan((tool.angle! * Math.PI) / 360);
  const halfHeight = (radius - neckRadius) * slope;
  return { radius, neckRadius, slope, halfHeight, height: 2 * halfHeight };
}

export function idealThreadNeck(diameter: number, pitch: number) {
  return Math.max(diameter * 0.2, diameter - 1.226869 * pitch);
}
