export interface PartGrid {
  nx: number;
  ny: number;
  heights: Float32Array;
  lower?: Float32Array;
}
export interface DetectedParts extends PartGrid {
  labels: Float32Array;
  count: number;
}

// Positive-thickness vertices connect along the actual surface triangles:
// a-b-c and b-d-c. Zero-thickness contacts do not hold two solids together.
export function detectParts(grid: PartGrid): DetectedParts {
  const { nx, ny, heights, lower } = grid;
  const width = nx + 1;
  const labels = new Float32Array(heights.length);
  const queue = new Uint32Array(heights.length);
  let count = 0;
  const solid = (i: number) => heights[i] - (lower?.[i] ?? 0) > 0.000001;
  for (let seed = 0; seed < heights.length; seed++) {
    if (labels[seed] || !solid(seed)) continue;
    count++;
    let head = 0,
      tail = 1;
    queue[0] = seed;
    labels[seed] = count;
    const visit = (i: number) => {
      if (!labels[i] && solid(i)) {
        labels[i] = count;
        queue[tail++] = i;
      }
    };
    while (head < tail) {
      const i = queue[head++],
        x = i % width,
        y = Math.floor(i / width);
      if (x > 0) visit(i - 1);
      if (x < nx) visit(i + 1);
      if (y > 0) visit(i - width);
      if (y < ny) visit(i + width);
      if (x < nx && y > 0) visit(i - width + 1);
      if (x > 0 && y < ny) visit(i + width - 1);
    }
  }
  return { ...grid, labels, count };
}

export function isolatePart(parts: DetectedParts, id: number): PartGrid {
  // Preserve collapsed boundary vertices, including the opposite machined face.
  const heights = parts.heights.map((h, i) =>
    parts.labels[i] === id ? h : (parts.lower?.[i] ?? 0),
  );
  return { nx: parts.nx, ny: parts.ny, heights, lower: parts.lower };
}
