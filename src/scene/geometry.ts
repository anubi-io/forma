import * as THREE from "three";
import type { Stock, Surface } from "../types";

// Fixed topology and reusable GPU buffers: scrubbing changes heights without reallocating the mesh.
export function stockGeometry(stock: Stock, surface?: Surface) {
  const nx = surface?.nx ?? 1,
    ny = surface?.ny ?? 1,
    n = (nx + 1) * (ny + 1);
  const edge: number[] = [];
  for (let x = 0; x <= nx; x++) edge.push(x);
  for (let y = 1; y <= ny; y++) edge.push(y * (nx + 1) + nx);
  for (let x = nx - 1; x >= 0; x--) edge.push(ny * (nx + 1) + x);
  for (let y = ny - 1; y >= 1; y--) edge.push(y * (nx + 1));
  const vertices = new Float32Array((n * 2 + edge.length * 4) * 3),
    uv = new Float32Array((vertices.length / 3) * 2);
  const indices = new Uint32Array(nx * ny * 12 + edge.length * 6);
  for (let y = 0; y <= ny; y++)
    for (let x = 0; x <= nx; x++) {
      const i = y * (nx + 1) + x;
      for (const offset of [0, n]) {
        vertices[(i + offset) * 3] = (x / nx) * stock.x - stock.x / 2;
        vertices[(i + offset) * 3 + 2] = stock.y / 2 - (y / ny) * stock.y;
        uv[(i + offset) * 2] = x / nx;
        uv[(i + offset) * 2 + 1] = y / ny;
      }
    }
  let cursor = nx * ny * 12;
  for (let j = 0; j < edge.length; j++) {
    const a = edge[j],
      b = edge[(j + 1) % edge.length],
      base = n * 2 + j * 4;
    for (let k = 0; k < 4; k++) {
      const id = k % 2 === 0 ? a : b;
      vertices[(base + k) * 3] = vertices[id * 3];
      vertices[(base + k) * 3 + 2] = vertices[id * 3 + 2];
      uv[(base + k) * 2] = (vertices[id * 3] + stock.x / 2) / stock.x;
    }
    indices.set(
      [base, base + 2, base + 1, base + 1, base + 2, base + 3],
      cursor,
    );
    cursor += 6;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.BufferAttribute(vertices, 3).setUsage(THREE.DynamicDrawUsage),
  );
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(
    new THREE.BufferAttribute(indices, 1).setUsage(THREE.DynamicDrawUsage),
  );
  g.userData = { nx, ny, n, edge };
  updateStockGeometry(g, stock, surface);
  return g;
}
export function updateStockGeometry(
  g: THREE.BufferGeometry,
  stock: Stock,
  surface?: Surface,
) {
  const { nx, ny, n, edge } = g.userData as {
    nx: number;
    ny: number;
    n: number;
    edge: number[];
  };
  const position = g.getAttribute("position"),
    indices = g.index!,
    uv = g.getAttribute("uv");
  const heights = surface?.heights;
  const h = (i: number) => heights?.[i] ?? stock.z;
  const low = (i: number) => surface?.lowerHeights?.[i] ?? 0;
  const thickness = (i: number) => h(i) - low(i);
  for (let i = 0; i < n; i++) {
    position.setY(i, h(i));
    position.setY(i + n, low(i));
  }
  let cursor = 0;
  const array = indices.array as Uint32Array;
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      const a = y * (nx + 1) + x,
        b = a + 1,
        c = a + nx + 1,
        d = c + 1;
      const first = thickness(a) + thickness(b) + thickness(c) > 0.00001,
        second = thickness(b) + thickness(c) + thickness(d) > 0.00001;
      array[cursor++] = a;
      array[cursor++] = first ? b : a;
      array[cursor++] = first ? c : a;
      array[cursor++] = b;
      array[cursor++] = second ? d : b;
      array[cursor++] = second ? c : b;
      array[cursor++] = n + a;
      array[cursor++] = n + (first ? c : a);
      array[cursor++] = n + (first ? b : a);
      array[cursor++] = n + b;
      array[cursor++] = n + (second ? c : b);
      array[cursor++] = n + (second ? d : b);
    }
  for (let j = 0; j < edge.length; j++) {
    const base = n * 2 + j * 4,
      a = edge[j],
      b = edge[(j + 1) % edge.length];
    position.setY(base, h(a));
    position.setY(base + 1, h(b));
    position.setY(base + 2, low(a));
    position.setY(base + 3, low(b));
    uv.setY(base, (h(a) / stock.z) * 0.18);
    uv.setY(base + 1, (h(b) / stock.z) * 0.18);
  }
  position.needsUpdate = true;
  indices.needsUpdate = true;
  uv.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
}
