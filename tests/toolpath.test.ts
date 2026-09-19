import { expect, it } from "vitest";
import { toolpathGeometry } from "../src/scene/toolpath";
import { DEFAULT_STOCK, STRIDE, type Program } from "../src/types";

it("keeps a continuous toolpath beyond the former 120,000-segment limit", () => {
  const count = 120003;
  const moves = new Float64Array(count * STRIDE);
  for (let n = 0; n < count; n++) {
    moves.set([n / 1024, 5, -2, (n + 1) / 1024, 5, -2, 1, 0, n, 0], n * STRIDE);
  }
  const program: Program = {
    moves,
    tools: [1],
    toolChanges: [],
    lines: count,
    warnings: [],
    distance: count / 1024,
    seconds: 0,
  };
  const geometry = toolpathGeometry(program, DEFAULT_STOCK);
  const positions = geometry.getAttribute("position");
  expect(positions.count).toBe(count * 2);
  for (let n = 1; n < count; n++) {
    expect(positions.getX(n * 2)).toBe(positions.getX(n * 2 - 1));
  }
  expect(positions.getX(0)).toBe(-DEFAULT_STOCK.x / 2);
  expect(positions.getY(0)).toBe(DEFAULT_STOCK.z - 2);
  expect(positions.getZ(0)).toBe(DEFAULT_STOCK.y / 2 - 5);
  expect(positions.getX(count * 2 - 1)).toBe(
    count / 1024 - DEFAULT_STOCK.x / 2,
  );
  geometry.dispose();
});
