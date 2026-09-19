import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useThree } from "@react-three/fiber";
import {
  OrbitControls,
  GizmoHelper,
  GizmoViewcube,
  useGizmoContext,
} from "@react-three/drei";
import { alignCamera } from "./cameraAlignment";
import { sceneOrigin } from "../engine/coordinates";
import { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import { WebGPURenderer, WebGPUBackend } from "three/webgpu";
import {
  STRIDE,
  type Stock,
  type Surface,
  type Program,
  type Assignments,
} from "../types";
import { playbackState } from "../engine/playback";
import { operationAt } from "../engine/sequence";
import type { CameraPose } from "../workspaceStorage";
import type { GpuRuntime } from "../engine/gpu";
import { gpuResolutionLimit } from "../engine/quality";
import RaycastWorkpiece from "./RaycastWorkpiece";
import { toolpathGeometry } from "./toolpath";
import { threadProfile } from "../engine/threadProfile";
import type { Tool } from "../types";

type Props = {
  stock: Stock;
  surface?: Surface;
  material: string;
  program?: Program;
  fraction: number;
  tools: Assignments;
  showPath: boolean;
  showTool: boolean;
  interactive?: boolean;
  view: { mode: string; id: number };
  cameraPose?: CameraPose;
  onCameraChange: (pose: CameraPose) => void;
  onRuntime: (runtime: GpuRuntime | null) => void;
};
function Paths({
  program,
  stock,
  fraction,
}: Pick<Props, "program" | "stock" | "fraction">) {
  const geometry = useMemo(
    () => toolpathGeometry(program, stock),
    [program, stock],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  useLayoutEffect(() => {
    if (program) {
      const count = program.moves.length / STRIDE;
      const progress = Math.max(0, Math.min(count, fraction * count));
      const processed = Math.floor(progress);
      const op = operationAt(program, processed);
      const start = op?.start ?? 0;
      geometry.setDrawRange(
        start * 2,
        Math.max(0, Math.ceil(progress) - start) * 2,
      );
      if (progress > processed && processed < count) {
        const positions = geometry.getAttribute(
          "position",
        ) as THREE.BufferAttribute;
        const vertex = processed * 2 + 1;
        const end = [
          positions.getX(vertex),
          positions.getY(vertex),
          positions.getZ(vertex),
        ];
        const part = progress - processed;
        positions.setXYZ(
          vertex,
          positions.getX(vertex - 1) +
            (end[0] - positions.getX(vertex - 1)) * part,
          positions.getY(vertex - 1) +
            (end[1] - positions.getY(vertex - 1)) * part,
          positions.getZ(vertex - 1) +
            (end[2] - positions.getZ(vertex - 1)) * part,
        );
        positions.needsUpdate = true;
        positions.addUpdateRange(vertex * 3, 3);
        return () => {
          positions.setXYZ(vertex, end[0], end[1], end[2]);
          positions.needsUpdate = true;
          positions.addUpdateRange(vertex * 3, 3);
        };
      }
    }
  }, [fraction, program, geometry]);
  return (
    <lineSegments geometry={geometry} renderOrder={10}>
      <lineBasicMaterial
        vertexColors
        transparent
        opacity={0.85}
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </lineSegments>
  );
}
function ThreadCutter({ tool, length }: { tool: Tool; length: number }) {
  const points = useMemo(() => {
    const p = threadProfile(tool);
    return [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(p.neckRadius, 0),
      new THREE.Vector2(p.radius, p.halfHeight),
      new THREE.Vector2(p.neckRadius, p.height),
      new THREE.Vector2(p.neckRadius, Math.max(p.height, length - 1)),
      new THREE.Vector2(
        (tool.shank ?? tool.diameter) / 2,
        Math.max(p.height, length),
      ),
    ];
  }, [tool, length]);
  return (
    <mesh>
      <latheGeometry args={[points, 48]} />
      <meshStandardMaterial color="#bcc4cc" metalness={0.7} roughness={0.3} />
    </mesh>
  );
}
function Cutter({
  program,
  stock,
  surface,
  tools,
  fraction,
}: Pick<Props, "program" | "stock" | "surface" | "tools" | "fraction">) {
  if (!program || !surface) return null;
  const cursor = playbackState(
      program,
      (fraction * program.moves.length) / STRIDE,
    ),
    t = tools[cursor.tool];
  if (!t) return null;
  const r = t.diameter / 2;
  const [ox, oz, oy] = sceneOrigin(stock);
  const p: [number, number, number] = [
    cursor.position[0] + ox,
    cursor.position[2] + oz,
    -cursor.position[1] + oy,
  ];
  const coneHeight =
    t?.kind === "v"
      ? Math.max(
          0.01,
          (r - (t.tip ?? 0) / 2) / Math.tan(((t.angle ?? 60) * Math.PI) / 360),
        )
      : 0;
  const length = t?.kind === "v" ? coneHeight : Math.max(r, t?.length ?? 14);
  return (
    <group position={p}>
      <mesh position={[0, length + 7, 0]}>
        <cylinderGeometry
          args={[
            (t.shank ?? t.diameter) / 2,
            (t.shank ?? t.diameter) / 2,
            14,
            20,
          ]}
        />
        <meshStandardMaterial
          color="#464a50"
          metalness={0.7}
          roughness={0.32}
        />
      </mesh>
      {t.kind === "thread" ? (
        <ThreadCutter tool={t} length={length} />
      ) : t?.kind === "ball" ? (
        <>
          <mesh position={[0, r, 0]}>
            <sphereGeometry
              args={[r, 20, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]}
            />
            <meshStandardMaterial
              color="#bcc4cc"
              metalness={0.7}
              roughness={0.3}
            />
          </mesh>
          <mesh position={[0, r + (length - r) / 2, 0]}>
            <cylinderGeometry args={[r, r, length - r, 16]} />
            <meshStandardMaterial
              color="#bcc4cc"
              metalness={0.7}
              roughness={0.3}
            />
          </mesh>
        </>
      ) : t?.kind === "v" ? (
        <mesh position={[0, length / 2, 0]}>
          <cylinderGeometry args={[r, (t.tip ?? 0) / 2, length, 20]} />
          <meshStandardMaterial
            color="#bcc4cc"
            metalness={0.7}
            roughness={0.3}
          />
        </mesh>
      ) : (
        <mesh position={[0, length / 2, 0]}>
          <cylinderGeometry args={[r, r, length, 20]} />
          <meshStandardMaterial
            color="#bcc4cc"
            metalness={0.7}
            roughness={0.3}
          />
        </mesh>
      )}
    </group>
  );
}
function AlignedViewcube({
  onDirection,
}: {
  onDirection: (direction: THREE.Vector3) => void;
}) {
  const { tweenCamera } = useGizmoContext();
  return (
    <GizmoViewcube
      color="#ffffff"
      hoverColor="#cbdcf4"
      textColor="#25282d"
      strokeColor="#73777e"
      font="600 30px Geist, Arial, sans-serif"
      onClick={(event) => {
        event.stopPropagation();
        // Edge and corner hitboxes store their direction in their local position.
        const direction =
          event.object.position.lengthSq() > 0
            ? event.object.position.clone()
            : event.face!.normal.clone();
        onDirection(direction);
        tweenCamera(direction);
        return null;
      }}
    />
  );
}
function Scene(props: Props) {
  const [isolated, setIsolated] = useState(false);
  const controls = useRef<OrbitControlsImpl>(null),
    { camera, invalidate, size: canvasSize } = useThree();
  const size = Math.max(props.stock.x, props.stock.y, props.stock.z * 2);
  const gizmoDirection = useRef<THREE.Vector3 | null>(null);
  const gizmoSave = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const saveCamera = () => {
    if (!controls.current) return;
    props.onCameraChange({
      position: camera.position.toArray() as [number, number, number],
      target: controls.current.target.toArray() as [number, number, number],
      zoom: camera.zoom,
    });
  };
  const finishGizmo = () => {
    if (gizmoDirection.current && controls.current) {
      alignCamera(camera, controls.current.target, gizmoDirection.current);
      gizmoDirection.current = null;
      controls.current.update();
      invalidate();
    }
    saveCamera();
  };
  useEffect(() => () => clearTimeout(gizmoSave.current), []);
  const cubeEdges = useMemo(() => {
    const box = new THREE.BoxGeometry(60, 60, 60);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    return edges;
  }, []);
  useEffect(() => () => cubeEdges.dispose(), [cubeEdges]);
  const poseRef = useRef(props.cameraPose);
  poseRef.current = props.cameraPose;
  useEffect(() => {
    const target = new THREE.Vector3(0, props.stock.z / 3, 0),
      distance =
        size *
        1.7 *
        Math.max(1, canvasSize.height / Math.max(1, canvasSize.width));
    if (props.view.mode === "top") camera.position.set(0, distance, 0.001);
    else if (props.view.mode === "front")
      camera.position.set(0, target.y, distance);
    else camera.position.set(distance * 0.72, distance * 1.01, distance * 0.89);
    const pose = poseRef.current;
    if (pose) {
      camera.position.fromArray(pose.position);
      target.fromArray(pose.target);
      camera.zoom = pose.zoom;
    } else camera.zoom = props.view.mode === "iso" ? 1.2 : 1;
    camera.near = 0.1;
    camera.far = Math.max(10000, size * 30);
    camera.updateProjectionMatrix();
    controls.current?.target.copy(target);
    camera.lookAt(target);
    controls.current?.update();
    invalidate();
  }, [
    props.view,
    size,
    props.stock.z,
    camera,
    invalidate,
    canvasSize.width,
    canvasSize.height,
  ]);
  return (
    <>
      <color attach="background" args={["#fafafa"]} />
      <ambientLight intensity={1.7} />
      <hemisphereLight args={["#ffffff", "#bcc0c5", 2]} />
      <directionalLight
        position={[size * 0.3, size * 2, size]}
        intensity={3}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-size}
        shadow-camera-right={size}
        shadow-camera-top={size}
        shadow-camera-bottom={-size}
        shadow-camera-far={size * 5}
        shadow-bias={-0.001}
      />
      <directionalLight position={[-size, size / 2, -size]} intensity={1.1} />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.4, 0]}
        receiveShadow
      >
        <planeGeometry args={[size * 8, size * 8]} />
        <shadowMaterial opacity={0.12} />
      </mesh>
      <gridHelper
        args={[
          Math.ceil((size * 4) / 10) * 10,
          Math.ceil((size * 4) / 10),
          "#d8dadd",
          "#e8e9eb",
        ]}
        position={[0, -0.45, 0]}
      />
      <RaycastWorkpiece
        stock={props.stock}
        surface={props.surface}
        material={props.material}
        interactive={props.interactive}
        onIsolationChange={setIsolated}
      />
      {props.showPath && !isolated && <Paths {...props} />}
      {props.showTool && !isolated && <Cutter {...props} />}
      <OrbitControls
        ref={controls}
        makeDefault
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.PAN,
          RIGHT: THREE.MOUSE.PAN,
        }}
        enableDamping={false}
        minDistance={2}
        maxDistance={size * 10}
        onStart={() => {
          clearTimeout(gizmoSave.current);
          gizmoDirection.current = null;
        }}
        onEnd={saveCamera}
      />
      <GizmoHelper
        alignment="bottom-left"
        margin={[88, 88]}
        onUpdate={() => {
          controls.current?.update();
          clearTimeout(gizmoSave.current);
          gizmoSave.current = setTimeout(finishGizmo, 160);
        }}
      >
        <group scale={1.2}>
          <AlignedViewcube
            onDirection={(direction) => {
              gizmoDirection.current = direction;
              clearTimeout(gizmoSave.current);
              gizmoSave.current = setTimeout(finishGizmo, 160);
            }}
          />
          <lineSegments geometry={cubeEdges} raycast={() => {}}>
            <lineBasicMaterial color="#73777e" toneMapped={false} />
          </lineSegments>
        </group>
      </GizmoHelper>
    </>
  );
}
export default memo(function Viewport(props: Props) {
  const [forceWebGL, setForceWebGL] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const onRuntime = useRef(props.onRuntime);
  onRuntime.current = props.onRuntime;
  // R3F can call the async factory again before its first configure finishes.
  // Share initialization per canvas so competing renderers cannot resize the
  // same framebuffer while retaining different depth attachments.
  const rendererSessions = useRef(
    new WeakMap<EventTarget, Promise<THREE.WebGLRenderer>>(),
  );
  const createRenderer = useCallback(
    (parameters: { canvas: EventTarget }) => {
      const existing = rendererSessions.current.get(parameters.canvas);
      if (existing) return existing;
      const task = (async () => {
        const renderer = new WebGPURenderer({
          canvas: parameters.canvas as HTMLCanvasElement,
          antialias: true,
          forceWebGL,
        });
        await renderer.init();
        // Drei's view cube reads the legacy WebGL capability facade.
        Object.assign(renderer, {
          capabilities: { getMaxAnisotropy: () => renderer.getMaxAnisotropy() },
        });
        return renderer as unknown as THREE.WebGLRenderer;
      })();
      rendererSessions.current.set(parameters.canvas, task);
      return task;
    },
    [forceWebGL],
  );
  const rendererReady = useCallback(({ gl }: { gl: THREE.WebGLRenderer }) => {
    const renderer = gl as unknown as WebGPURenderer;
    renderer.onDeviceLost = () => {
      if (!mounted.current) return;
      onRuntime.current(null);
      setForceWebGL(true);
    };
    if (mounted.current) {
      if (renderer.backend instanceof WebGPUBackend) {
        onRuntime.current({
          renderer,
          maxResolution: gpuResolutionLimit(
            (renderer.backend as unknown as { device: GPUDevice }).device
              .limits,
          ),
          fail: () => {
            if (mounted.current) onRuntime.current(null);
          },
        });
      } else onRuntime.current(null);
    }
  }, []);
  return (
    <Canvas
      key={forceWebGL ? "webgl" : "auto"}
      shadows={{ type: THREE.PCFShadowMap }}
      frameloop="demand"
      dpr={[1, 1.5]}
      camera={{ fov: 36, position: [160, 180, 210] }}
      gl={createRenderer}
      onCreated={rendererReady}
      fallback={
        <div className="canvas-fallback">
          WebGL is unavailable. Try a browser with hardware acceleration.
        </div>
      }
    >
      <Scene {...props} />
    </Canvas>
  );
});
