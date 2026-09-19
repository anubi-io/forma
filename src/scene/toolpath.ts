import * as THREE from "three";
import { STRIDE, type Program, type Stock } from "../types";

export function toolpathGeometry(program: Program | undefined, stock: Stock) {
  const geometry = new THREE.BufferGeometry();
  if (!program) return geometry;
  const count = program.moves.length / STRIDE;
  // Keep every segment: stride sampling leaves gaps in finely tessellated paths.
  // Allocate packed buffers directly to avoid large temporary JS arrays.
  const positions = new Float32Array(count * 6);
  const colors = new Float32Array(count * 6);
  const x = stock.origin === "center" ? 0 : -stock.x / 2;
  const y = stock.origin === "center" ? 0 : stock.y / 2;
  const z = stock.zOrigin === "top" ? stock.z : 0;
  for (let n = 0; n < count; n++) {
    const i = n * STRIDE;
    const rapid = program.moves[i + 7] === 1;
    for (let j = 0; j < 2; j++) {
      const source = i + j * 3;
      const target = n * 6 + j * 3;
      positions[target] = program.moves[source] + x;
      positions[target + 1] = program.moves[source + 2] + z;
      positions[target + 2] = -program.moves[source + 1] + y;
      colors[target] = rapid ? 0.28 : 0.025;
      colors[target + 1] = rapid ? 0.34 : 0.18;
      colors[target + 2] = rapid ? 0.42 : 0.8;
    }
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}
