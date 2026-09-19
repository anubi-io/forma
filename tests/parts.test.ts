import { describe, it, expect } from "vitest";
import { Ray, Vector3 } from "three";
import { detectParts, isolatePart } from "../src/engine/parts";
import { pickPart } from "../src/scene/partPicking";
const stock = {
  x: 10,
  y: 6,
  z: 3,
  origin: "corner" as const,
  zOrigin: "top" as const,
};
function split(dual = false) {
  const heights = new Float32Array(77).fill(3);
  const lower = dual ? new Float32Array(77).fill(1) : undefined;
  for (let y = 0; y <= 6; y++)
    for (let x = 4; x <= 6; x++) heights[y * 11 + x] = lower?.[y * 11 + x] ?? 0;
  return { nx: 10, ny: 6, heights, lower };
}
describe("detached material", () => {
  it("detects through cuts and preserves a thin bridge", () => {
    const grid = split();
    expect(detectParts(grid).count).toBe(2);
    for (let x = 4; x <= 6; x++) grid.heights[3 * 11 + x] = 0.0001;
    expect(detectParts(grid).count).toBe(1);
  });
  it("uses the rendered diagonal, not eight-neighbor connectivity", () => {
    expect(
      detectParts({ nx: 1, ny: 1, heights: new Float32Array([1, 0, 0, 1]) })
        .count,
    ).toBe(2);
    expect(
      detectParts({ nx: 1, ny: 1, heights: new Float32Array([0, 1, 1, 0]) })
        .count,
    ).toBe(1);
  });
  it("handles empty stock and intact stock", () => {
    expect(
      detectParts({ nx: 1, ny: 1, heights: new Float32Array(4) }).count,
    ).toBe(0);
    expect(
      detectParts({ nx: 1, ny: 1, heights: new Float32Array(4).fill(3) }).count,
    ).toBe(1);
  });
  for (const dual of [false, true])
    it(`picks tops, bottoms and walls while ignoring holes and hidden parts (dual=${dual})`, () => {
      const parts = detectParts(split(dual));
      const ray = (
        x: number,
        y: number,
        z: number,
        dx: number,
        dy: number,
        dz: number,
      ) => new Ray(new Vector3(x, y, z), new Vector3(dx, dy, dz).normalize());
      expect(pickPart(ray(-3, 10, 0, 0, -1, 0), stock, parts)?.id).toBe(1);
      expect(pickPart(ray(3, 10, 0, 0, -1, 0), stock, parts)?.id).toBe(2);
      expect(pickPart(ray(0, 10, 0, 0, -1, 0), stock, parts)).toBeNull();
      expect(pickPart(ray(-3, -10, 0, 0, 1, 0), stock, parts)?.id).toBe(1);
      expect(pickPart(ray(-10, 2, 0, 1, 0, 0), stock, parts)?.id).toBe(1);
      expect(pickPart(ray(-10, 2, 0, 1, 0, 0), stock, parts, 2)?.id).toBe(2);
      expect(pickPart(ray(-3, 10, 0, 0, -1, 0), stock, parts, 2)).toBeNull();
      const isolated = isolatePart(parts, 2);
      expect(isolated.heights[0]).toBe(dual ? 1 : 0);
      expect(isolated.heights[10]).toBe(3);
      expect(parts.heights[0]).toBe(3);
    });
});
