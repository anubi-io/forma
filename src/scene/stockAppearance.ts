import type { Node } from "three/webgpu";
import {
  Fn,
  clamp,
  dot,
  exp,
  float,
  floor,
  fract,
  fwidth,
  length,
  max,
  mix,
  normalize,
  pow,
  sin,
  smoothstep,
  vec2,
  vec3,
} from "three/tsl";
import type { MATERIALS } from "../data/materials";
import type { Stock } from "../types";
import { brushedAluminum } from "./brushedAluminum";

type Vec3 = Node<"vec3">;
type MaterialDefinition = (typeof MATERIALS)[number];

// A solid texture evaluated at the ray hit: newly exposed cuts reveal the same
// internal structure, without UV seams or stretching over the proxy geometry.
const solidNoise = Fn(([p]: [Vec3]) => {
  const cell = floor(p).toVar();
  const f = fract(p).toVar();
  const t = f
    .mul(f)
    .mul(float(3).sub(f.mul(2)))
    .toVar();
  const hash = (x: number, y: number, z: number) =>
    fract(
      sin(dot(cell.add(vec3(x, y, z)), vec3(127.1, 311.7, 74.7))).mul(
        43758.5453,
      ),
    );
  return mix(
    mix(
      mix(hash(0, 0, 0), hash(1, 0, 0), t.x),
      mix(hash(0, 1, 0), hash(1, 1, 0), t.x),
      t.y,
    ),
    mix(
      mix(hash(0, 0, 1), hash(1, 0, 1), t.x),
      mix(hash(0, 1, 1), hash(1, 1, 1), t.x),
      t.y,
    ),
    t.z,
  )
    .sub(0.5)
    .mul(2);
});

function filteredNoise(p: Vec3) {
  const footprint = fwidth(p);
  const fade = float(1).sub(
    smoothstep(0.4, 1.5, max(max(footprint.x, footprint.y), footprint.z)),
  );
  return solidNoise(p).mul(fade);
}

function diffuseLight(normal: Vec3) {
  return max(dot(normal, normalize(vec3(-0.3, 1, 0.65))), 0)
    .mul(0.58)
    .add(max(dot(normal, normalize(vec3(0.8, 0.4, -0.5))), 0).mul(0.17))
    .add(0.27);
}

// A finite studio light gives planar stock a moving reflection instead of a
// uniform specular value. Dielectrics keep white reflections; brass tints them.
function studioReflection(
  point: Vec3,
  normal: Vec3,
  view: Vec3,
  size: number,
  width: number,
) {
  const panel = (position: Vec3, spread: number, strength: number) => {
    const light = normalize(position.mul(size).sub(point));
    const half = normalize(light.add(view));
    const nh = clamp(dot(normal, half), 0.001, 1);
    const slope = float(1)
      .sub(nh.mul(nh))
      .div(nh.mul(nh).mul(spread * spread));
    return exp(slope.negate())
      .mul(smoothstep(0, 0.2, dot(normal, light)))
      .mul(strength);
  };
  const reflected = normal.mul(dot(normal, view).mul(2)).sub(view);
  return panel(vec3(-0.65, 1.15, -0.7), width, 1)
    .add(panel(vec3(0.85, 0.75, 0.45), width * 1.3, 0.7))
    .add(panel(vec3(0, 1.8, 0), width * 1.6, 0.3))
    .add(smoothstep(-0.4, 0.9, reflected.y).mul(0.18).add(0.1));
}

function dielectric(
  base: Vec3,
  point: Vec3,
  normal: Vec3,
  view: Vec3,
  size: number,
  roughness: number,
  sheen: number,
) {
  const grazing = pow(float(1).sub(clamp(dot(normal, view), 0, 1)), 5);
  const fresnel = grazing.mul(0.65).add(0.035);
  const reflection = studioReflection(
    point,
    normal,
    view,
    size,
    0.07 + roughness * 0.34,
  );
  return base
    .mul(diffuseLight(normal))
    .mul(float(1).sub(fresnel))
    .add(vec3(reflection.mul(fresnel).mul(sheen)));
}

function woodColor(
  point: Vec3,
  normal: Vec3,
  base: Vec3,
  id: "walnut" | "oak" | "birch",
) {
  const walnut = id === "walnut",
    oak = id === "oak";
  const warp = solidNoise(point.mul(vec3(0.025, 0.035, 0.035))).toVar();
  const broad = solidNoise(point.mul(vec3(0.009, 0.035, 0.05))).toVar();
  // Growth cylinders run along stock X, with the pith below the block. Their
  // intersection with top/side/end faces creates grain and end-grain rings.
  const radius = length(
    vec2(
      point.z.add(warp.mul(3)).add(sin(point.x.mul(0.022)).mul(7)),
      point.y.add(30).add(broad.mul(7)).mul(0.85),
    ),
  );
  const ringPosition = radius
    .mul(oak ? 0.34 : walnut ? 0.26 : 0.55)
    .add(warp.mul(0.8))
    .add(solidNoise(point.mul(0.09)).mul(0.26))
    .toVar();
  const phase = fract(ringPosition);
  const ringVisibility = float(1).sub(
    smoothstep(0.2, 0.75, fwidth(ringPosition)),
  );
  const latewood = mix(
    float(0.22),
    smoothstep(0.58, 0.78, phase).mul(float(1).sub(smoothstep(0.88, 1, phase))),
    ringVisibility,
  );
  const fibers = filteredNoise(point.mul(vec3(0.035, 1.4, 1.4))).toVar();
  const pores = smoothstep(
    0.3,
    0.7,
    filteredNoise(point.mul(vec3(0.22, 4, 4))),
  );
  const contrast = walnut ? 0.21 : oak ? 0.18 : 0.055;
  const variation = float(1)
    .add(broad.mul(walnut ? 0.3 : 0.12))
    .sub(latewood.mul(contrast))
    .add(fibers.mul(oak ? 0.17 : walnut ? 0.12 : 0.055))
    .sub(pores.mul(oak ? 0.24 : 0.08));
  // Open end grain absorbs more light, particularly in ring-porous oak.
  const endGrain = normal.x.abs().mul(oak ? 0.14 : 0.08);
  return base.mul(variation.sub(endGrain));
}

export function stockAppearance(
  point: Vec3,
  normal: Vec3,
  view: Vec3,
  base: Vec3,
  definition: MaterialDefinition,
  stock: Stock,
) {
  const size = Math.max(stock.x, stock.y, stock.z);
  const id = definition.id;
  if (id === "aluminum")
    return brushedAluminum(point, normal, view, base, size);
  if (id === "walnut" || id === "oak" || id === "birch") {
    return dielectric(
      woodColor(point, normal, base, id),
      point,
      normal,
      view,
      size,
      definition.roughness,
      0.35,
    );
  }
  if (id === "mdf") {
    const fiber = filteredNoise(point.mul(vec3(2.2, 3.4, 2.2))).toVar();
    const flecks = filteredNoise(point.mul(0.8)).toVar();
    // The pressed outer skin is smoother than the exposed fibreboard core.
    const skin = float(1).sub(
      smoothstep(0.03, 0.2, point.y.sub(stock.z).abs()),
    );
    const texture = fiber
      .mul(0.19)
      .add(flecks.mul(0.12))
      .mul(mix(1, 0.45, skin));
    return base
      .mul(texture.add(1).mul(mix(0.93, 1, skin)))
      .mul(diffuseLight(normal));
  }
  if (id === "brass") {
    const polish = filteredNoise(point.mul(vec3(0.045, 2.4, 2.4))).mul(0.055);
    const reflection = studioReflection(
      point,
      normal,
      view,
      size,
      definition.roughness * 0.7,
    );
    const fresnel = pow(float(1).sub(clamp(dot(normal, view), 0, 1)), 5);
    return mix(base, vec3(1), fresnel)
      .mul(reflection.mul(1.15))
      .mul(polish.add(1));
  }
  // Delrin is a dense satin black; white acrylic is opaque with a harder gloss.
  const microtexture = filteredNoise(point.mul(7)).mul(
    id === "delrin" ? 0.025 : 0.005,
  );
  return dielectric(
    base.mul(microtexture.add(1)),
    point,
    normal,
    view,
    size,
    definition.roughness,
    id === "delrin" ? 1.25 : 4,
  );
}
