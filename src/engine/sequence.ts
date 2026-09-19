import {
  STRIDE,
  type Program,
  type MachiningSide,
  type FlipAxis,
  type Stock,
  type Assignments,
  type Surface,
} from "../types";
import { Simulator } from "./simulate";
import type { PreparedSimulation } from "./prepare";

export interface PreparedSequence {
  threads?: import("./prepareThreads").PreparedThreads;
  faces: PreparedSimulation[];
  operations: NonNullable<Program["operations"]>;
  flipAxis: FlipAxis;
}

/** Keep each file's modal state and source line numbers independent. */
export function sequenceProgram(
  top: Program,
  bottom: Program,
  firstSide: MachiningSide,
): Program {
  const ordered = firstSide === "top" ? [top, bottom] : [bottom, top];
  const moves = new Float64Array(top.moves.length + bottom.moves.length);
  const operations: NonNullable<Program["operations"]> = [];
  const toolChanges: Program["toolChanges"] = [];
  const motionStates: NonNullable<Program["motionStates"]> = [];
  let start = 0,
    seconds = 0;
  ordered.forEach((p, index) => {
    moves.set(p.moves, start * STRIDE);
    const states = p.motionStates ?? [
      {
        moveIndex: 0,
        spindle: "unknown" as const,
        rpm: null,
        feedExplicit: false,
      },
    ];
    for (const state of states)
      motionStates.push({ ...state, moveIndex: state.moveIndex + start });
    const end = start + p.moves.length / STRIDE;
    const side =
      index === 0 ? firstSide : firstSide === "top" ? "bottom" : "top";
    operations.push({
      side,
      start,
      end,
      lines: p.lines,
      toolChangeStart: toolChanges.length,
      toolChangeEnd: toolChanges.length + p.toolChanges.length,
      tools: p.tools,
    });
    toolChanges.push(
      ...p.toolChanges.map((c) => ({
        ...c,
        moveIndex: c.moveIndex + start,
        seconds: c.seconds + seconds,
      })),
    );
    start = end;
    seconds += p.seconds;
  });
  return {
    moves,
    operations,
    toolChanges,
    motionStates,
    workSystems: [
      ...new Set([
        ...(top.workSystems ?? [54]),
        ...(bottom.workSystems ?? [54]),
      ]),
    ],
    tools: [...new Set([...top.tools, ...bottom.tools])],
    lines: top.lines + bottom.lines,
    seconds,
    distance: top.distance + bottom.distance,
    warnings: [
      ...top.warnings.map((w) => `TOP: ${w}`),
      ...bottom.warnings.map((w) => `BOTTOM: ${w}`),
    ],
  };
}

export function operationAt(program: Program, processed: number) {
  return (
    program.operations?.find((op) => processed < op.end) ??
    program.operations?.at(-1)
  );
}

// Program objects are immutable. Avoid re-slicing modal metadata on every
// playback frame, especially files that change spindle speed on many blocks.
const operationCache = new WeakMap<
  Program,
  WeakMap<NonNullable<Program["operations"]>[number], Program>
>();
export function operationProgram(
  program: Program,
  op: NonNullable<Program["operations"]>[number],
): Program {
  let cache = operationCache.get(program);
  if (!cache) {
    cache = new WeakMap();
    operationCache.set(program, cache);
  }
  const previous = cache.get(op);
  if (previous) return previous;
  const result: Program = {
    ...program,
    operations: undefined,
    moves: program.moves.subarray(op.start * STRIDE, op.end * STRIDE),
    lines: op.lines,
    tools: op.tools,
    motionStates: program.motionStates
      ?.filter(
        (state) => state.moveIndex >= op.start && state.moveIndex < op.end,
      )
      .map((state) => ({ ...state, moveIndex: state.moveIndex - op.start })),
    toolChanges: program.toolChanges
      .slice(op.toolChangeStart, op.toolChangeEnd)
      .map((c) => ({ ...c, moveIndex: c.moveIndex - op.start })),
  };
  cache.set(op, result);
  return result;
}

/** A 180° stock rotation: X reverses Y; Y reverses X. */
export function flippedIndex(
  x: number,
  y: number,
  nx: number,
  ny: number,
  axis: FlipAxis,
) {
  return (axis === "x" ? ny - y : y) * (nx + 1) + (axis === "y" ? nx - x : x);
}

/** Remaining material is the intersection of the two independently swept faces.
 * This preserves the first setup at every seek and avoids counting overlap twice. */
export class SequenceSimulator {
  private engines: Simulator[];
  constructor(
    readonly program: Program,
    readonly stock: Stock,
    tools: Assignments,
    resolution: number,
    readonly axis: FlipAxis,
  ) {
    this.engines = program.operations!.map(
      (op) =>
        new Simulator(operationProgram(program, op), stock, tools, resolution),
    );
  }
  seek(fraction: number): Surface {
    if (!Number.isFinite(fraction))
      throw new Error("Invalid playback position.");
    const begin = performance.now();
    const count = this.program.moves.length / STRIDE;
    const processed = Math.max(
      0,
      Math.min(count, Math.round(fraction * count)),
    );
    const ops = this.program.operations!;
    const surfaces = this.engines.map((engine, i) =>
      engine.seek(
        Math.max(
          0,
          Math.min(
            1,
            (processed - ops[i].start) / (ops[i].end - ops[i].start || 1),
          ),
        ),
      ),
    );
    const active = operationAt(this.program, processed)!;
    const face = surfaces[ops.indexOf(active)];
    const opposite = surfaces[1 - ops.indexOf(active)];
    const { nx, ny } = face;
    const heights = face.heights;
    const lowerHeights = new Float32Array(heights.length);
    let removed = 0;
    for (let y = 0; y <= ny; y++)
      for (let x = 0; x <= nx; x++) {
        const i = y * (nx + 1) + x;
        const lower = stockClamp(
          this.stock.z -
            opposite.heights[flippedIndex(x, y, nx, ny, this.axis)],
          this.stock.z,
        );
        // Collapse fully removed columns; they have no triangles or volume.
        lowerHeights[i] = Math.min(heights[i], lower);
        removed +=
          ((((this.stock.z - (heights[i] - lowerHeights[i])) *
            (x === 0 || x === nx ? 0.5 : 1) *
            (y === 0 || y === ny ? 0.5 : 1) *
            this.stock.x) /
            nx) *
            this.stock.y) /
          ny;
      }
    return {
      heights,
      lowerHeights,
      nx,
      ny,
      removed,
      elapsed: performance.now() - begin,
      processed,
      count,
      warnings: surfaces.flatMap((s, i) =>
        s.warnings.map((w) => `${ops[i].side.toUpperCase()}: ${w}`),
      ),
    };
  }
}
const stockClamp = (n: number, z: number) => Math.max(0, Math.min(z, n));
