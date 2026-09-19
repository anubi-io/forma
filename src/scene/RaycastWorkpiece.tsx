import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import {
  BackSide,
  BoxGeometry,
  Color,
  DataTexture,
  FloatType,
  Mesh,
  MeshBasicNodeMaterial,
  NearestFilter,
  RedFormat,
  RGBAFormat,
  Vector3,
  Vector4,
  WebGPUBackend,
  type Texture,
  type TextureNode,
  type WebGPURenderer,
} from "three/webgpu";
import {
  Discard,
  Fn,
  If,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  dot,
  float,
  glsl,
  glslFn,
  mat3,
  max,
  mix,
  normalize,
  positionLocal,
  positionWorld,
  texture,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
  wgsl,
  wgslFn,
} from "three/tsl";
import { TILE_SIZE, tileStatistics } from "../engine/prepare";
import type { Stock, Surface } from "../types";
import { MATERIALS } from "../data/materials";
import {
  TRACE_GLSL,
  TRACE_WGSL,
  TRIANGLE_GLSL,
  TRIANGLE_WGSL,
} from "./surfaceShaders";
import { DUAL_TRACE_GLSL, DUAL_TRACE_WGSL } from "./dualSurfaceShaders";
import {
  TRACE_THREADS,
  withThreadMask,
} from "./threadSurfaceShaders";
import type { ThreadGpuSurface } from "../engine/gpuThreads";
import { threadFieldShader } from "../engine/gpuThreadKernels";
import { useParts } from "./useParts";
import { pickPart } from "./partPicking";
import { stockAppearance } from "./stockAppearance";

function dataTexture(
  data: Float32Array,
  width: number,
  height: number,
  rgba = false,
) {
  const t = new DataTexture(
    data,
    width,
    height,
    rgba ? RGBAFormat : RedFormat,
    FloatType,
  );
  t.minFilter = t.magFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export function createSurfaceMaterial(
  heights: Texture | TextureNode<"vec4">,
  tiles: Texture | TextureNode<"vec4">,
  stock: Stock,
  nx: number,
  ny: number,
  definition: (typeof MATERIALS)[number],
  gpu: boolean,
  lower?: Texture | TextureNode<"vec4">,
  threads?: ThreadGpuSurface,
  parts?: { labels: Texture; hovered: ReturnType<typeof uniform<"float">> },
) {
  const tx = Math.ceil((nx + 1) / TILE_SIZE);
  const grid = uniform(new Vector4(nx, ny, tx, TILE_SIZE));
  const dimensions = uniform(new Vector3(stock.x, stock.y, stock.z));
  const material = new MeshBasicNodeMaterial();
  material.side = BackSide;
  material.positionNode = vec3(
    positionLocal.x.sub(0.5).mul(stock.x),
    positionLocal.y.mul(stock.z),
    float(0.5).sub(positionLocal.z).mul(stock.y),
  );
  const threadInfo = threads
    ? uniform(
        new Vector4(
          threads.step,
          threads.capacity,
          threads.flipped ? 1 : 0,
          threads.axis === "y" ? 1 : 0,
        ),
      )
    : undefined;
  const shaderIncludes = [
    wgsl(TRIANGLE_WGSL),
    ...(threads ? [wgsl(threadFieldShader(threads.capacity === 0))] : []),
  ];
  const trace = gpu
    ? wgslFn(
        threads
          ? withThreadMask(lower ? DUAL_TRACE_WGSL : TRACE_WGSL)
          : lower
            ? DUAL_TRACE_WGSL
            : TRACE_WGSL,
        shaderIncludes,
      )
    : glslFn(lower ? DUAL_TRACE_GLSL : TRACE_GLSL, [glsl(TRIANGLE_GLSL)]);
  // The single proxy bounds the entire stock; tile traversal happens in the
  // fragment shader, so rasterization never exposes internal tile boundaries.
  const rayPoint = varying(positionWorld, "surfaceRayPoint").setInterpolation(
    "perspective",
    gpu ? "sample" : "centroid",
  );
  const baseHit = (
    trace({
      heights: texture(heights).convert("texture"),
      ...(lower ? { lower: texture(lower).convert("texture") } : {}),
      tiles: texture(tiles).convert("texture"),
      grid,
      stock: dimensions,
      camera: cameraPosition,
      world: rayPoint,
      ...(threads
        ? {
            threadFieldTexture: texture(threads.field).convert("texture"),
            threadPages: texture(threads.pages).convert("texture"),
            threadInfo,
          }
        : {}),
    }) as ReturnType<typeof mat3>
  ).toVar("baseSurfaceHit");
  const hit = threads
    ? (
        wgslFn(
          TRACE_THREADS,
          shaderIncludes,
        )({
          heights: texture(heights).convert("texture"),
          lower: texture(lower ?? heights).convert("texture"),
          dual: uniform(lower ? 1 : 0, "uint"),
          field: texture(threads.field).convert("texture"),
          pages: texture(threads.pages).convert("texture"),
          info: threadInfo!,
          grid,
          stock: dimensions,
          camera: cameraPosition,
          world: rayPoint,
          base: baseHit,
          boundsMin: uniform(new Vector3(...threads.boundsMin)),
          boundsMax: uniform(new Vector3(...threads.boundsMax)),
        }) as ReturnType<typeof mat3>
      ).toVar("threadSurfaceHit")
    : baseHit;
  const point = hit.mul(vec3(1, 0, 0));
  const normal = hit.mul(vec3(0, 1, 0));
  const valid = hit.mul(vec3(0, 0, 1)).x;
  material.colorNode = Fn(() => {
    If(valid.lessThan(0.5), () => {
      Discard();
    });
    const key = normalize(vec3(0.35, 1, 0.55));
    const fill = normalize(vec3(-0.7, 0.35, -0.5));
    const diffuse = max(dot(normal, key), 0)
      .mul(0.62)
      .add(max(dot(normal, fill), 0).mul(0.2))
      .add(0.42);
    const view = normalize(cameraPosition.sub(point));
    const base = uniform(new Color(definition.color));
    const shaded = stockAppearance(point, normal, view, base.rgb, definition, stock);
    if (parts) {
      const xy = vec2(
        point.x
          .add(stock.x / 2)
          .div(stock.x)
          .mul(nx),
        float(stock.y / 2)
          .sub(point.z)
          .div(stock.y)
          .mul(ny),
      );
      const cell = clamp(xy.floor(), vec2(0), vec2(nx - 1, ny - 1));
      const uv = xy.sub(cell);
      const sample = (x: number, y: number) =>
        texture(
          parts.labels,
          cell
            .add(vec2(x, y))
            .add(0.5)
            .div(vec2(nx + 1, ny + 1)),
        ).r;
      const id = max(
        max(sample(1, 0), sample(0, 1)),
        uv.x.add(uv.y).lessThanEqual(1).select(sample(0, 0), sample(1, 1)),
      );
      return mix(
        shaded,
        vec3(0.2, 0.53, 0.95).mul(diffuse),
        id
          .equal(parts.hovered)
          .and(parts.hovered.greaterThan(0))
          .select(0.45, 0),
      );
    }
    return shaded;
  })();
  material.depthNode = Fn(() => {
    const clip = cameraProjectionMatrix
      .mul(cameraViewMatrix)
      .mul(vec4(point, 1));
    const depth = clip.z.div(clip.w);
    return clamp(gpu ? depth : depth.mul(0.5).add(0.5), 0, 1);
  })();
  return material;
}
export default function RaycastWorkpiece({
  stock,
  surface,
  material: materialId,
  interactive = true,
  onIsolationChange,
}: {
  stock: Stock;
  surface?: Surface;
  material: string;
  interactive?: boolean;
  onIsolationChange?: (isolated: boolean) => void;
}) {
  const interaction = useParts(surface, interactive);
  const sourceSurface = surface;
  // Isolation replaces only the base height maps. Keep subtracting the same
  // thread volume, clipped against the isolated component's remaining stock.
  const threads = sourceSurface?.gpu?.threads;
  surface = interaction.isolated ?? surface;
  const hovered = useMemo(() => uniform(0), []);
  const down = useRef<{ x: number; y: number; id: number } | undefined>(
    undefined,
  );
  const parts =
    interaction.parts && interaction.parts.count > 1
      ? interaction.parts
      : undefined;
  const labelTexture = useMemo(
    () =>
      parts ? dataTexture(parts.labels, parts.nx + 1, parts.ny + 1) : undefined,
    [parts],
  );
  const canvas = useThree((s) => s.gl.domElement);
  const events = useThree((s) => s.events);
  useEffect(() => () => labelTexture?.dispose(), [labelTexture]);
  useEffect(() => {
    hovered.value = 0;
    canvas.style.cursor = "";
    down.current = undefined;
    return () => {
      canvas.style.cursor = "";
    };
  }, [sourceSurface, interactive, canvas, hovered]);
  useEffect(() => {
    onIsolationChange?.(!!interaction.selected);
  }, [interaction.selected, onIsolationChange]);
  const renderer = useThree((s) => s.gl) as unknown as WebGPURenderer;
  const invalidate = useThree((s) => s.invalidate);
  const nx = surface?.nx ?? 1,
    ny = surface?.ny ?? 1;
  const tx = Math.ceil((nx + 1) / TILE_SIZE),
    ty = Math.ceil((ny + 1) / TILE_SIZE);
  const definition = MATERIALS.find((m) => m.id === materialId) ?? MATERIALS[0];
  const dual = !!surface?.lowerHeights;
  const cpuTextures = useMemo(() => {
    if (surface?.gpu) return null;
    const heights = surface?.heights ?? new Float32Array(4).fill(stock.z);
    return {
      heights: dataTexture(heights, nx + 1, ny + 1),
      lower: dual
        ? dataTexture(surface!.lowerHeights!, nx + 1, ny + 1)
        : undefined,
      tiles: dataTexture(
        surface?.tiles ?? tileStatistics(heights, { nx, ny }),
        tx,
        ty,
        true,
      ),
    };
  }, [surface?.gpu, nx, ny, stock.z, tx, ty, dual]);
  useLayoutEffect(() => {
    if (!cpuTextures || !surface) return;
    cpuTextures.heights.image.data = surface.heights;
    if (cpuTextures.lower && surface.lowerHeights) {
      cpuTextures.lower.image.data = surface.lowerHeights;
      cpuTextures.lower.needsUpdate = true;
    }
    cpuTextures.tiles.image.data =
      surface.tiles ?? tileStatistics(surface.heights, surface);
    cpuTextures.heights.needsUpdate = cpuTextures.tiles.needsUpdate = true;
  }, [cpuTextures, surface]);
  const textures = surface?.gpu ?? cpuTextures!;
  const gpu = renderer.backend instanceof WebGPUBackend;
  const hasLower = !!textures.lower;
  // Isolation only replaces texture bindings; keep the compiled shader alive.
  const bindings = useMemo(
    () => ({
      heights: texture(textures.heights),
      tiles: texture(textures.tiles),
      lower: hasLower ? texture(textures.lower!) : undefined,
    }),
    [hasLower],
  );
  useLayoutEffect(() => {
    bindings.heights.value = textures.heights;
    bindings.tiles.value = textures.tiles;
    if (bindings.lower && textures.lower) bindings.lower.value = textures.lower;
  }, [bindings, textures.heights, textures.tiles, textures.lower]);
  const material = useMemo(
    () =>
      createSurfaceMaterial(
        bindings.heights,
        bindings.tiles,
        stock,
        nx,
        ny,
        definition,
        gpu,
        bindings.lower,
        threads,
        labelTexture ? { labels: labelTexture, hovered } : undefined,
      ),
    [
      bindings,
      stock,
      nx,
      ny,
      definition,
      gpu,
      threads?.field,
      threads?.pages,
      threads?.flipped,
      labelTexture,
      hovered,
    ],
  );
  const geometry = useMemo(
    () => new BoxGeometry(1, 1, 1).scale(1, 1, -1).translate(0.5, 0.5, 0.5),
    [],
  );
  const mesh = useMemo(() => {
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.raycast = (raycaster, hits) => {
      if (!parts) return;
      const hit = pickPart(raycaster.ray, stock, parts, interaction.selected);
      if (
        hit &&
        hit.distance >= raycaster.near &&
        hit.distance <= raycaster.far
      )
        hits.push({
          distance: hit.distance,
          point: hit.point,
          object: mesh,
          faceIndex: hit.id,
        });
    };
    return mesh;
  }, [geometry, material, parts, stock, interaction.selected]);
  useEffect(() => {
    invalidate();
  }, [surface, invalidate]);
  useEffect(
    () => () => {
      cpuTextures?.heights.dispose();
      cpuTextures?.lower?.dispose();
      cpuTextures?.tiles.dispose();
    },
    [cpuTextures],
  );
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => {
    events.update?.();
    invalidate();
  }, [parts, interaction.selected, events, invalidate]);
  const setHover = (id: number) => {
    canvas.style.cursor = id ? "pointer" : "";
    if (hovered.value !== id) {
      hovered.value = id;
      invalidate();
    }
  };
  const clearHover = () => setHover(0);
  const move = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (
      down.current &&
      Math.hypot(
        event.clientX - down.current.x,
        event.clientY - down.current.y,
      ) > 4
    )
      down.current = undefined;
    setHover(event.buttons ? 0 : (event.faceIndex ?? 0));
  };
  return (
    <primitive
      object={mesh}
      onPointerMove={move}
      onPointerOut={() => {
        down.current = undefined;
        clearHover();
      }}
      onPointerDown={(event: ThreeEvent<PointerEvent>) => {
        if (event.button === 0)
          down.current = {
            x: event.clientX,
            y: event.clientY,
            id: event.faceIndex ?? 0,
          };
      }}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        const start = down.current;
        down.current = undefined;
        if (
          event.button !== 0 ||
          !start ||
          start.id !== event.faceIndex ||
          event.delta > 4 ||
          Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4
        )
          return;
        event.stopPropagation();
        interaction.toggle(start.id);
        clearHover();
      }}
    />
  );
}
