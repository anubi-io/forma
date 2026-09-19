import type { Node } from "three/webgpu";
import {
  Fn,
  cross,
  dot,
  exp,
  float,
  floor,
  fract,
  fwidth,
  max,
  mix,
  normalize,
  pow,
  sin,
  smoothstep,
  vec2,
  vec3,
} from "three/tsl";

// Uneven, long scratches, rather than a periodic sine-wave pattern.
const scratchNoise = Fn(([uv]: [Node<"vec2">]) => {
  const cell = floor(uv).toVar();
  const f = fract(uv).toVar();
  const blend = f.mul(f).mul(float(3).sub(f.mul(2)));
  const hash = (offset: Node<"vec2">) =>
    fract(sin(dot(cell.add(offset), vec2(127.1, 311.7))).mul(43758.5453));
  return mix(
    mix(hash(vec2(0, 0)), hash(vec2(1, 0)), blend.x),
    mix(hash(vec2(0, 1)), hash(vec2(1, 1)), blend.x),
    blend.y,
  )
    .sub(0.5)
    .mul(2);
});

/** Brushed conductor shading at the actual ray hit, on both rendering backends. */
export function brushedAluminum(
  point: Node<"vec3">,
  normal: Node<"vec3">,
  view: Node<"vec3">,
  base: Node<"vec3">,
  size: number,
) {
  const endFace = normal.x.abs().greaterThan(0.9);
  const axis = endFace.select(vec3(0, 0, 1), vec3(1, 0, 0));
  const tangent = normalize(axis.sub(normal.mul(dot(axis, normal)))).toVar();
  const across = normalize(cross(normal, tangent)).toVar();
  // Fixed stock coordinates keep the grain attached to the cut, including walls.
  const coordinate = normal.y.abs().greaterThan(0.65).select(point.z, point.y);
  const along = endFace.select(point.z, point.x);
  const footprint = fwidth(coordinate).toVar();
  const scratch = (frequency: number, length: number) =>
    scratchNoise(vec2(along.mul(length), coordinate.mul(frequency))).mul(
      float(1).sub(smoothstep(0.35, 1.3, footprint.mul(frequency))),
    );
  const grain = scratch(1.6, 0.025)
    .mul(0.45)
    .add(scratch(5.5, 0.06).mul(0.35))
    .add(scratch(23, 0.13).mul(0.2))
    .toVar();
  const n = normalize(normal.add(across.mul(grain.mul(0.065)))).toVar();
  const nv = max(dot(n, view), 0.001);
  const fresnel = mix(base, vec3(1), pow(float(1).sub(nv), 5));
  const reflected = n.mul(dot(n, view).mul(2)).sub(view).toVar();

  // Broad studio panels reflected in the metal. Finite positions make highlights
  // sweep across large flat faces as the camera moves, instead of a flat grey fill.
  const panel = (position: Node<"vec3">, width: number, strength: number) => {
    const light = normalize(position.mul(size).sub(point));
    const half = normalize(light.add(view));
    const nh = max(dot(n, half), 0.001);
    const slope = pow(dot(half, tangent).div(width), 2).add(
      pow(dot(half, across).div(0.6), 2),
    );
    return exp(slope.negate().div(nh.mul(nh)))
      .mul(smoothstep(0, 0.2, dot(n, light)))
      .mul(strength);
  };
  const key = panel(vec3(-0.65, 1.15, -0.7), 0.18, 0.95);
  const fill = panel(vec3(0.85, 0.75, 0.45), 0.24, 0.65);
  const overhead = panel(vec3(0, 1.8, 0), 0.3, 0.35);
  // Dark and light environment bands provide the contrast that identifies metal.
  const environment = smoothstep(-0.5, 0.9, reflected.y).mul(0.23).add(0.12);
  const reflection = environment.add(key).add(fill).add(overhead);
  return fresnel.mul(reflection).mul(grain.mul(0.3).add(1));
}
