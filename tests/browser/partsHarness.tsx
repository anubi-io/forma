import { createRoot } from "react-dom/client";
import { useState, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { Mesh, WebGPURenderer } from "three/webgpu";
import { OrbitControls } from "@react-three/drei";
import RaycastWorkpiece from "../../src/scene/RaycastWorkpiece";
import { GpuSimulator } from "../../src/engine/gpu";
import { GpuSequenceSimulator } from "../../src/engine/gpuSequence";
import { GpuThreadSimulator } from "../../src/engine/gpuThreads";
import { prepareThreads } from "../../src/engine/prepareThreads";
import {
  SequenceSimulator,
  sequenceProgram,
  operationProgram,
} from "../../src/engine/sequence";
import { prepareSimulation } from "../../src/engine/prepare";
import { parseProgram } from "../../src/engine/parse";
import { Simulator } from "../../src/engine/simulate";
import type { Surface } from "../../src/types";
const stock = {
  x: 40,
  y: 20,
  z: 4,
  origin: "corner" as const,
  zOrigin: "top" as const,
};
const dual = new URLSearchParams(location.search).has("dual");
const threads = new URLSearchParams(location.search).has("threads");
const face = parseProgram(
  `T1 M6\nG0 X20 Y-3 Z2\nG1 Z${dual ? -2.2 : -5}\nG1 Y23 F500` +
    (threads ? "\nT2 M6\nG0 X8 Y6 Z-0.9\nG1 X12\nG0 X28 Y6\nG1 X32" : ""),
);
const program = dual ? sequenceProgram(face, face, "top") : face;
const tools = {
  1: { id: "flat", name: "flat", kind: "flat" as const, diameter: 3 },
  2: {
    id: "thread",
    name: "thread",
    kind: "thread" as const,
    diameter: 4,
    neck: 1,
    pitch: 0.8,
    angle: 60,
  },
};
const cpu = dual
  ? new SequenceSimulator(program, stock, tools, 160, "y")
  : new Simulator(program, stock, tools, 160);
const initial = cpu.seek(1);
const renderers = new WeakMap<EventTarget, Promise<never>>();
function createRenderer(props: { canvas: EventTarget }) {
  const existing = renderers.get(props.canvas);
  if (existing) return existing;
  const ready = (async () => {
    const renderer = new WebGPURenderer({
      canvas: props.canvas as HTMLCanvasElement,
      forceWebGL: new URLSearchParams(location.search).has("cpu"),
    });
    await renderer.init();
    return renderer as never;
  })();
  renderers.set(props.canvas, ready);
  return ready;
}
declare global {
  interface Window {
    partsRenderer: WebGPURenderer;
    partsMaterial: () => number | undefined;
    partsReady: boolean;
  }
}
function App() {
  const [surface, setSurface] = useState<Surface>(initial);
  const [renderer, setRenderer] = useState<WebGPURenderer>();
  const [interactive, setInteractive] = useState(true);
  useEffect(() => {
    if (!renderer || new URLSearchParams(location.search).has("cpu")) return;
    const base = dual
      ? new GpuSequenceSimulator(renderer, {
          faces: program.operations!.map((op) =>
            prepareSimulation(operationProgram(program, op), stock, tools, 160),
          ),
          operations: program.operations!,
          flipAxis: "y",
        })
      : new GpuSimulator(
          renderer,
          prepareSimulation(program, stock, tools, 160),
        );
    const engine = threads
      ? new GpuThreadSimulator(
          renderer,
          base,
          prepareThreads(program, stock, tools, 1600)!,
        )
      : base;
    let cancelled = false;
    void engine.seek(1).then((s) => {
      if (s && !cancelled) {
        setSurface(s);
        window.partsReady = true;
      }
    });
    return () => {
      cancelled = true;
      engine.dispose();
    };
  }, [renderer]);
  return (
    <>
      <button
        style={{ position: "absolute", top: 610 }}
        onClick={() => setInteractive((v) => !v)}
      >
        Toggle playback
      </button>
      <Canvas
        frameloop="demand"
        camera={{ position: [0, 80, 0.001], fov: 36 }}
        gl={createRenderer}
        onCreated={({ gl, camera, scene }) => {
          camera.lookAt(0, 0, 0);
          window.partsRenderer = gl as unknown as WebGPURenderer;
          window.partsMaterial = () => {
            const mesh = scene.children.find((child) => child instanceof Mesh);
            return mesh && !Array.isArray(mesh.material)
              ? mesh.material.id
              : undefined;
          };
          setRenderer(gl as unknown as WebGPURenderer);
        }}
      >
        <color attach="background" args={["#fafafa"]} />
        <RaycastWorkpiece
          stock={stock}
          surface={surface}
          material="aluminum"
          interactive={interactive}
        />
        <OrbitControls enableDamping={false} />
      </Canvas>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
