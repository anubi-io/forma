import { useEffect, useMemo, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import {
  StorageBufferAttribute,
  type Texture,
  type WebGPURenderer,
} from "three/webgpu";
import { instanceIndex, storage, texture, uniform, wgslFn } from "three/tsl";
import type { Surface } from "../types";
import type { DetectedParts, PartGrid } from "../engine/parts";

async function readTexture(
  renderer: WebGPURenderer,
  source: Texture,
  width: number,
  height: number,
) {
  const count = width * height;
  const values = new StorageBufferAttribute(count, 1);
  const node =
    wgslFn(`fn readPartGrid(id: u32, width: u32, count: u32, source: texture_2d<f32>, values: ptr<storage, array<f32>, read_write>) -> void {
    if (id < count) { values[id] = textureLoad(source, vec2i(i32(id % width), i32(id / width)), 0).r; }
  }`)({
      id: instanceIndex,
      width: uniform(width, "uint"),
      count: uniform(count, "uint"),
      source: texture(source),
      values: storage(values, "float", count),
    }).compute(count);
  try {
    await renderer.computeAsync(node);
    return new Float32Array(await renderer.getArrayBufferAsync(values));
  } finally {
    node.dispose();
    const backend = renderer.backend as unknown as {
      get(a: StorageBufferAttribute): { buffer?: unknown };
      destroyAttribute(a: StorageBufferAttribute): void;
    };
    if (backend.get(values).buffer) {
      backend.destroyAttribute(values);
      renderer.info.destroyAttribute(values);
    }
  }
}

export function useParts(surface: Surface | undefined, enabled: boolean) {
  const renderer = useThree((s) => s.gl) as unknown as WebGPURenderer;
  const [result, setResult] = useState<{
    surface: Surface;
    parts: DetectedParts;
  }>();
  const [selection, setSelection] = useState<{
    surface: Surface;
    id: number;
    grid: PartGrid;
  }>();
  const worker = useRef<Worker | null>(null);
  const requested = useRef(0);
  useEffect(() => {
    setResult(undefined);
    setSelection(undefined);
    requested.current = 0;
    // Subtracting thread volumes cannot reconnect components already separated
    // by the height maps. Preserve those groups with Threads enabled. Further
    // splits caused exclusively by a volumetric undercut are not resolved here.
    if (!surface || !enabled) return;
    let cancelled = false;
    let activeWorker: Worker | undefined;
    const timer = setTimeout(() => {
      void (async () => {
        const heights = surface.gpu
          ? await readTexture(
              renderer,
              surface.gpu.heights,
              surface.nx + 1,
              surface.ny + 1,
            )
          : surface.heights;
        if (cancelled) return;
        const lower = surface.gpu?.lower
          ? await readTexture(
              renderer,
              surface.gpu.lower,
              surface.nx + 1,
              surface.ny + 1,
            )
          : surface.lowerHeights;
        if (cancelled) return;
        activeWorker = new Worker(
          new URL("../engine/partsWorker.ts", import.meta.url),
          { type: "module" },
        );
        worker.current = activeWorker;
        activeWorker.onmessage = ({
          data,
        }: MessageEvent<
          DetectedParts | (PartGrid & { selected: number }) | { count: number }
        >) => {
          if (cancelled) return;
          if ("labels" in data) setResult({ surface, parts: data });
          else if ("selected" in data && data.selected === requested.current)
            setSelection({ surface, id: data.selected, grid: data });
          else if ("count" in data) {
            activeWorker?.terminate();
            if (worker.current === activeWorker) worker.current = null;
          }
        };
        activeWorker.onerror = () => {
          if (!cancelled) {
            setResult(undefined);
            setSelection(undefined);
          }
        };
        activeWorker.postMessage({
          nx: surface.nx,
          ny: surface.ny,
          heights,
          lower,
        });
      })().catch((error) => {
        if (!cancelled) console.warn("Part detection unavailable", error);
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      activeWorker?.terminate();
      if (worker.current === activeWorker) worker.current = null;
    };
  }, [surface, enabled, renderer]);
  const parts =
    enabled && result?.surface === surface ? result?.parts : undefined;
  const selected =
    parts && selection?.surface === surface ? selection : undefined;
  const isolated = useMemo(
    () =>
      selected && surface
        ? {
            ...surface,
            gpu: undefined,
            heights: selected.grid.heights,
            lowerHeights: selected.grid.lower,
            tiles: undefined,
          }
        : undefined,
    [selected, surface],
  );
  const toggle = (id: number) => {
    if (selected || requested.current) {
      requested.current = 0;
      setSelection(undefined);
    } else if (parts && parts.count > 1 && id) {
      requested.current = id;
      worker.current?.postMessage({ selected: id });
    }
  };
  return { parts, isolated, selected: selected?.id ?? 0, toggle };
}
