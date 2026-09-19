import {
  STRIDE,
  type Assignments,
  type MachiningSide,
  type Program,
  type Stock,
} from "../types";
import type { AnalysisFinding } from "./analyze";
import { stockOrigin } from "./coordinates";

/** Diagnose expensive milling patterns from programmed motion. Time spent is
 * evidence, not recoverable time: no faster feed or replacement CAM is assumed. */
export function analyzeEfficiency(
  program: Program,
  stock: Stock,
  tools: Assignments,
): AnalysisFinding[] {
  const m = program.moves,
    count = m.length / STRIDE;
  const top = stock.z - stockOrigin(stock)[2];
  const groups = new Map<string, AnalysisFinding>();
  const operations = program.operations ?? [
    { side: "top" as const, start: 0, end: count },
  ];
  let operation = 0;
  let run:
    | {
        start: number;
        end: number;
        tool: number;
        side: MachiningSide;
        seconds: number;
        returns: number;
        focus: number;
        xy: number;
        z: number;
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
        minZ: number;
      }
    | undefined;
  function finish() {
    if (!run) return;
    const r = run;
    run = undefined;
    const diameter = tools[r.tool].diameter;
    const depth = top - r.minZ;
    // Local milling with repeated returns to the stock surface. Ordinary
    // approaches, rapids, drill pecks and contour lifts between features do
    // not meet these tests. Deliberate chip-clearing cycles remain reviewable.
    if (
      r.returns < 8 ||
      r.seconds < 30 ||
      depth < 0.1 * diameter ||
      r.z < depth * 20 ||
      r.xy < diameter * 2 ||
      Math.max(r.maxX - r.minX, r.maxY - r.minY) > diameter * 4
    )
      return;
    const id = `repeated-reentry:${r.side}:${r.tool}`;
    const detail = `${r.returns} feed returns to the stock surface within this milling pass. ${Math.round(r.z)} mm of accumulated Z travel for ${Number(depth.toFixed(2))} mm of depth. Check ramping, retracts and linking in CAM; chip-clearing cycles may be intentional.`;
    let finding = groups.get(id);
    if (!finding) {
      finding = {
        id,
        kind: "repeated-reentry",
        severity: "opportunity",
        title: "Repeated Z returns",
        detail,
        suggestion:
          "Time potentially optimizable in these passes. Overlapping findings count once in the total; actual savings depend on the revised CAM strategy.",
        side: r.side,
        tool: r.tool,
        occurrences: 0,
        locations: [],
        seconds: 0,
        durationSeconds: 0,
      };
      groups.set(id, finding);
    }
    finding.occurrences++;
    finding.durationSeconds! += r.seconds;
    finding.locations.push({
      moveIndex: r.start,
      endMoveIndex: r.end,
      line: m[r.start * STRIDE + 8],
      endLine: m[r.end * STRIDE + 8],
      focusMoveIndex: r.focus,
      focusLine: m[r.focus * STRIDE + 8],
      detail,
      seconds: 0,
      durationSeconds: r.seconds,
      spans: 1,
    });
  }
  let change = 0;
  for (let segment = 0; segment < count; segment++) {
    while (
      operation + 1 < operations.length &&
      segment >= operations[operation].end
    ) {
      finish();
      operation++;
    }
    while (
      change < program.toolChanges.length &&
      program.toolChanges[change].moveIndex <= segment
    ) {
      finish();
      change++;
    }
    const i = segment * STRIDE,
      tool = m[i + 6],
      cutter = tools[tool];
    if (m[i + 7] || (run && run.tool !== tool)) finish();
    if (
      m[i + 7] ||
      !cutter ||
      !Number.isFinite(cutter.diameter) ||
      cutter.diameter <= 0 ||
      (cutter.kind !== "flat" && cutter.kind !== "ball")
    )
      continue;
    if (!run)
      run = {
        start: segment,
        end: segment,
        tool,
        side: operations[operation].side,
        seconds: 0,
        returns: 0,
        focus: segment,
        xy: 0,
        z: 0,
        minX: m[i],
        maxX: m[i],
        minY: m[i + 1],
        maxY: m[i + 1],
        minZ: m[i + 2],
      };
    run.end = segment;
    run.seconds += m[i + 9];
    run.xy += Math.hypot(m[i + 3] - m[i], m[i + 4] - m[i + 1]);
    run.z += Math.abs(m[i + 5] - m[i + 2]);
    run.minX = Math.min(run.minX, m[i + 3]);
    run.maxX = Math.max(run.maxX, m[i + 3]);
    run.minY = Math.min(run.minY, m[i + 4]);
    run.maxY = Math.max(run.maxY, m[i + 4]);
    run.minZ = Math.min(run.minZ, m[i + 5]);
    if (
      m[i + 2] < top - Math.max(0.05, cutter.diameter * 0.1) &&
      m[i + 5] >= top - 0.002
    ) {
      if (run.returns === 0) run.focus = segment;
      run.returns++;
    }
  }
  finish();
  return [...groups.values()];
}
