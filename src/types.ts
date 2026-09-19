export type ToolKind = "flat" | "ball" | "v" | "thread" | "unsupported";
export interface Tool {
  id: string;
  name: string;
  kind: ToolKind;
  diameter: number;
  length?: number;
  angle?: number;
  tip?: number;
  shank?: number;
  /** Single-form thread cutter: nominal pitch sizes the idealized tooth. */
  pitch?: number;
  neck?: number;
  source?: string;
  note?: string;
}
export interface Stock {
  x: number;
  y: number;
  z: number;
  origin:
    "corner" | "front-right" | "back-left" | "back-right" | "center" | "custom";
  zOrigin: "top" | "bottom" | "custom";
  /** Location of work zero in mm from the stock's front-left bottom corner. */
  originX?: number;
  originY?: number;
  originZ?: number;
  /** Optional separate work zeros, in mm relative to G54. G54 remains [0,0,0]. */
  workOffsets?: WorkOffsets;
}
export const WORK_SYSTEMS = [54, 55, 56, 57, 58, 59, 59.1, 59.2, 59.3] as const;
export type WorkSystem = (typeof WORK_SYSTEMS)[number];
export type WorkOffsets = Partial<Record<WorkSystem, [number, number, number]>>;
export interface Program {
  /** Work systems used by this program, for setup labels. */
  workSystems?: WorkSystem[];
  /** Modal cutting state, recorded only when it changes, indexed by segment. */
  motionStates?: MotionState[];
  operations?: Operation[];
  moves: Float64Array;
  tools: number[];
  toolChanges: ToolChange[];
  lines: number;
  warnings: string[];
  distance: number;
  seconds: number;
}
export interface MotionState {
  moveIndex: number;
  spindle: "unknown" | "cw" | "ccw" | "off";
  rpm: number | null;
  feedExplicit: boolean;
}
export type MachiningSide = "top" | "bottom";
export type FlipAxis = "x" | "y";
export interface BottomSetup {
  code: string;
  filename: string;
  flipAxis: FlipAxis;
  firstSide: MachiningSide;
}
export interface Operation {
  side: MachiningSide;
  start: number;
  end: number;
  lines: number;
  toolChangeStart: number;
  toolChangeEnd: number;
  tools: number[];
}
export interface ToolChange {
  tool: number;
  previousTool: number;
  line: number;
  /** Number of completed packed segments before the tool change. */
  moveIndex: number;
  seconds: number;
  /** Initial tool selection in a program that omits M6. */
  implicit?: boolean;
}
// Packed move: from XYZ, to XYZ, tool number, rapid flag, source line, seconds.
export const STRIDE = 10;
export interface Surface {
  heights: Float32Array;
  /** Lower boundary in the active setup's coordinates. */
  lowerHeights?: Float32Array;
  tiles?: Float32Array;
  gpu?: import("./engine/gpu").GpuSurface;
  backend?: "webgpu" | "cpu";
  nx: number;
  ny: number;
  removed: number;
  elapsed: number;
  processed: number;
  count: number;
  warnings: string[];
}
export type Assignments = Record<number, Tool>;
export const DEFAULT_STOCK: Stock = {
  x: 120,
  y: 90,
  z: 18,
  origin: "corner",
  zOrigin: "top",
};
