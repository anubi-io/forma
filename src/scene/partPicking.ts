import { Box3, Ray, Vector3 } from "three";
import type { Stock } from "../types";
import type { DetectedParts } from "../engine/parts";

/** Traverse only the XY cells crossed by the ray; never build a dense mesh. */
export function pickPart(
  ray: Ray,
  stock: Stock,
  parts: DetectedParts,
  selected = 0,
): { id: number; point: Vector3; distance: number } | null {
  const { nx, ny, heights, lower, labels } = parts;
  const box = new Box3(
    new Vector3(-stock.x / 2, 0, -stock.y / 2),
    new Vector3(stock.x / 2, stock.z, stock.y / 2),
  );
  const start = ray.intersectBox(box, new Vector3());
  if (!start) return null;
  const sx = stock.x / nx,
    sy = stock.y / ny;
  const ox = ray.origin.x + stock.x / 2,
    oy = stock.y / 2 - ray.origin.z;
  const dx = ray.direction.x,
    dy = -ray.direction.z;
  let t = box.containsPoint(ray.origin) ? 0 : start.distanceTo(ray.origin);
  const epsilon = 1e-7;
  let x = Math.max(
    0,
    Math.min(nx - 1, Math.floor((ox + dx * (t + epsilon)) / sx)),
  );
  let y = Math.max(
    0,
    Math.min(ny - 1, Math.floor((oy + dy * (t + epsilon)) / sy)),
  );
  const vertex = (i: number, bottom: boolean) =>
    new Vector3(
      (i % (nx + 1)) * sx - stock.x / 2,
      bottom || (selected && labels[i] !== selected)
        ? (lower?.[i] ?? 0)
        : heights[i],
      stock.y / 2 - Math.floor(i / (nx + 1)) * sy,
    );
  const point = new Vector3();
  for (let step = 0; step < nx + ny + 2; step++) {
    if (x < 0 || x >= nx || y < 0 || y >= ny) break;
    const nextX =
      Math.abs(dx) < 1e-15 ? Infinity : ((x + (dx > 0 ? 1 : 0)) * sx - ox) / dx;
    const nextY =
      Math.abs(dy) < 1e-15 ? Infinity : ((y + (dy > 0 ? 1 : 0)) * sy - oy) / dy;
    const end = Math.min(nextX, nextY);
    const a = y * (nx + 1) + x,
      b = a + 1,
      c = a + nx + 1,
      d = c + 1;
    let best: { id: number; point: Vector3; distance: number } | null = null;
    const accept = (hit: Vector3) => {
      const u = Math.max(0, Math.min(1, (hit.x + stock.x / 2) / sx - x));
      const v = Math.max(0, Math.min(1, (stock.y / 2 - hit.z) / sy - y));
      const ids = u + v <= 1 ? [a, b, c] : [d, c, b];
      const weights =
        u + v <= 1 ? [1 - u - v, u, v] : [u + v - 1, 1 - u, 1 - v];
      const id = Math.max(...ids.map((i) => labels[i]));
      const high = ids.reduce((sum, i, k) => sum + heights[i] * weights[k], 0);
      const low = ids.reduce(
        (sum, i, k) => sum + (lower?.[i] ?? 0) * weights[k],
        0,
      );
      const distance = hit.distanceTo(ray.origin);
      if (
        id &&
        (!selected || id === selected) &&
        high - low > 1e-6 &&
        hit.y >= low - 1e-6 &&
        hit.y <= high + 1e-6 &&
        distance >= t - 1e-6 &&
        distance <= end + 1e-6 &&
        (!best || distance < best.distance)
      )
        best = { id, point: hit.clone(), distance };
    };
    if (step === 0 && !box.containsPoint(ray.origin)) accept(start);
    for (const bottom of [false, true])
      for (const ids of [
        [a, b, c],
        [b, d, c],
      ]) {
        const hit = ray.intersectTriangle(
          vertex(ids[0], bottom),
          vertex(ids[1], bottom),
          vertex(ids[2], bottom),
          false,
          point,
        );
        if (hit) accept(hit);
      }
    // Outer stock walls; machined walls belong to the height triangles above.
    if (
      (nextX === end && ((x === 0 && dx < 0) || (x === nx - 1 && dx > 0))) ||
      (nextY === end && ((y === 0 && dy < 0) || (y === ny - 1 && dy > 0)))
    ) {
      if (Number.isFinite(end)) accept(ray.at(end, point));
    }
    if (best) return best;
    if (!Number.isFinite(end)) break;
    if (nextX <= nextY) x += dx > 0 ? 1 : -1;
    if (nextY <= nextX) y += dy > 0 ? 1 : -1;
    t = end;
  }
  return null;
}
