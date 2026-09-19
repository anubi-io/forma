import {
  STRIDE,
  type Assignments,
  type FlipAxis,
  type MachiningSide,
  type MotionState,
  type Program,
  type Stock,
  type Tool,
} from "../types";
import { MATERIALS } from "../data/materials";
import { analysisSweep } from "./analysisSweep";
import { entryMotion } from "./analysisEntry";
import { analyzeEfficiency } from "./analysisEfficiency";
import { flippedIndex } from "./sequence";

export type FindingKind =
  | "repeated-reentry"
  | "repeated-path"
  | "empty-pass"
  | "rapid-contact"
  | "below-stock"
  | "outside-stock"
  | "cutting-length"
  | "steep-entry"
  | "deep-engagement"
  | "high-feed"
  | "spindle-off"
  | "spindle-unknown"
  | "missing-rpm"
  | "missing-feed";
export type Severity = "danger" | "warning" | "opportunity";
export interface FindingLocation {
  moveIndex: number;
  endMoveIndex: number;
  line: number;
  endLine: number;
  /** Evidence and seek target belong to this occurrence, never another one. */
  focusMoveIndex: number;
  focusLine: number;
  detail: string;
  seconds: number;
  /** Time in affected passes; deliberately excluded from recoverable savings. */
  durationSeconds?: number;
  spans: number;
}
export interface AnalysisFinding {
  id: string;
  kind: FindingKind;
  severity: Severity;
  title: string;
  detail: string;
  suggestion: string;
  side: MachiningSide;
  tool: number;
  occurrences: number;
  locations: FindingLocation[];
  seconds: number;
  durationSeconds?: number;
}
export interface AnalysisReport {
  findings: AnalysisFinding[];
  /** Union of flagged optimization segments, not a guaranteed time saving. */
  optimizableSeconds: number;
  savingsSeconds: number;
  repeatedSeconds: number;
  emptySeconds: number;
  totalSeconds: number;
  cuttingSeconds: number;
  gridSpacing: number;
  analyzedMoves: number;
  contactCheckedMoves: number;
  totalMoves: number;
  limitations: string[];
  complete: boolean;
  profile: AnalysisProfile;
}
export interface AnalysisProfile {
  material: string;
  rampAngle: number;
  engagementRatio: number;
  plungeFeedPerDiameter: number;
  feedPerRevRatio: number;
}
/** Review triggers, NOT manufacturer feeds/speeds or machine safety limits.
 * Ramp/plunge rationale: https://www.harveyperformance.com/in-the-loupe/ramping-success/
 * Material-specific review defaults below are application heuristics. */
export function analysisProfile(material: string): AnalysisProfile {
  const info = MATERIALS.find((item) => item.id === material);
  const category = info?.category;
  const values =
    category === "Metal"
      ? [5, material === "brass" ? 0.4 : 0.5, 80, 0.1]
      : category === "Polymer"
        ? [8, 0.75, 120, 0.18]
        : category === "Composite"
          ? [12, 1.25, 220, 0.3]
          : [10, 1, 180, 0.25];
  return {
    material: info?.name ?? "Unknown material",
    rampAngle: values[0],
    engagementRatio: values[1],
    plungeFeedPerDiameter: values[2],
    feedPerRevRatio: values[3],
  };
}
const RULES: Record<FindingKind, [Severity, string, string]> = {
  "repeated-reentry": [
    "opportunity",
    "Repeated Z returns",
    "Review ramping and retracts in CAM.",
  ],
  "repeated-path": [
    "opportunity",
    "Repeated cutting path",
    "Review duplicate or spring passes in CAM. Keep passes needed for finish or deflection compensation.",
  ],
  "empty-pass": [
    "opportunity",
    "Pass removes no material",
    "Review this whole pass in CAM: it runs through previously cleared space or outside the stock. Preserve required linking moves.",
  ],
  "rapid-contact": [
    "danger",
    "Rapid enters remaining material",
    "Check clearance height, work zero and the approach. The cutter envelope overlaps material during G0.",
  ],
  "below-stock": [
    "danger",
    "Cut below stock bottom",
    "Check Z zero and through-cut allowance against the spoilboard and fixture.",
  ],
  "outside-stock": [
    "warning",
    "Cutter crosses stock edges",
    "Check XY origin and stock dimensions. Lead-ins and outside profiles can intentionally cross an edge.",
  ],
  "cutting-length": [
    "danger",
    "Cut exceeds flute length",
    "Check the cutter's usable length, reach and holder clearance.",
  ],
  "steep-entry": [
    "warning",
    "Aggressive material entry",
    "Review plunge feed or use a gentler ramp/helical entry. Confirm the tool can centre-cut.",
  ],
  "deep-engagement": [
    "warning",
    "High engagement in fresh material",
    "Review stepdown and radial engagement for this material, tool and machine.",
  ],
  "high-feed": [
    "warning",
    "High feed per revolution",
    "Check feed and RPM against the tool manufacturer's data. Flute count is unknown; this is not chip load per tooth.",
  ],
  "spindle-off": [
    "danger",
    "Cut with spindle stopped",
    "Check M3/M4, M5 and S before entering the stock.",
  ],
  "spindle-unknown": [
    "warning",
    "Spindle state not declared",
    "No M3/M4 precedes this cut. Check whether the controller starts the spindle outside this file.",
  ],
  "missing-rpm": [
    "warning",
    "Spindle speed not declared",
    "Set or verify S in the machine setup. Feed per revolution cannot be checked without RPM.",
  ],
  "missing-feed": [
    "warning",
    "Cutting feed not declared",
    "Set F before cutting. Preview timing currently uses the parser's fallback of 600 mm/min.",
  ],
};
const EPS = 0.002;
const fmt = (n: number, digits = 2) => Number(n.toFixed(digits)).toString();
const supported = (t: Tool) =>
  t.kind === "flat" || t.kind === "ball" || t.kind === "v";
const validTool = (t: Tool) =>
  Number.isFinite(t.diameter) &&
  t.diameter > 0 &&
  t.diameter <= 100 &&
  (t.kind !== "v" ||
    (Number.isFinite(t.angle) &&
      t.angle! > 0 &&
      t.angle! < 180 &&
      Number.isFinite(t.tip) &&
      t.tip! >= 0 &&
      t.tip! <= t.diameter));

/** Whole-program analysis on a bounded, independent 2.5D stock model.
 * Feed links above stock, vertical approaches/retracts and G0 never earn savings.
 * Empty passes must remove nothing over their entire feed run, so ordinary links
 * inside a productive operation are not mistaken for removable machining. */
export function analyzeProgram(
  program: Program,
  stock: Stock,
  tools: Assignments,
  material: string,
  flipAxis: FlipAxis = "y",
  options: {
    maxEvaluations?: number;
    maxResolution?: number;
    onProgress?: (processed: number, total: number) => void;
  } = {},
): AnalysisReport {
  if (
    ![stock.x, stock.y, stock.z].every(
      (n) => Number.isFinite(n) && n > 0 && n <= 2000,
    )
  )
    throw new Error("Set valid stock dimensions before analysis.");
  const profile = analysisProfile(material);
  const limitations = new Set<string>();
  for (const id of program.tools) {
    if (!tools[id] || !validTool(tools[id]))
      limitations.add(
        `T${id}: assign a valid cutter to analyze material contact and repeated passes.`,
      );
  }
  const usedTools = program.tools
    .map((id) => tools[id])
    .filter((t) => t && validTool(t));
  const diameter = usedTools.reduce((min, t) => Math.min(min, t.diameter), 6);
  const longest = Math.max(stock.x, stock.y);
  const resolution = Math.min(
    options.maxResolution ?? 600,
    Math.max(160, Math.ceil((longest * 8) / diameter)),
  );
  const nx = Math.max(2, Math.ceil((resolution * stock.x) / longest));
  const ny = Math.max(2, Math.ceil((resolution * stock.y) / longest));
  const sx = stock.x / nx,
    sy = stock.y / ny,
    spacing = Math.max(sx, sy);
  let upper = new Float64Array((nx + 1) * (ny + 1)).fill(stock.z);
  let lower = new Float64Array(upper.length);
  // Unsupported profiles affect only the columns they can touch. Their
  // uncertainty must never disable checks for the rest of either program.
  let uncertain = new Uint8Array(upper.length);
  const previousUpper = new Float64Array(upper.length);
  const updatedAt = new Int32Array(upper.length).fill(-1);
  const ox = stock.origin === "center" ? stock.x / 2 : 0;
  const oy = stock.origin === "center" ? stock.y / 2 : 0;
  const oz = stock.zOrigin === "top" ? stock.z : 0;
  const m = program.moves,
    count = m.length / STRIDE;
  const ops = program.operations ?? [
    { side: "top" as const, start: 0, end: count },
  ];
  let opIndex = 0,
    side = ops[0].side;
  const groups = new Map<
    string,
    AnalysisFinding & {
      lastMove: number;
      score: number;
      pass: number;
      locationScore: number;
    }
  >();
  const seen = new Set<string>();
  let evaluations = 0,
    analyzedMoves = 0,
    modelAvailable = true;
  let repeatedSeconds = 0,
    emptySeconds = 0,
    cuttingSeconds = 0;
  let candidates: number[] = [],
    runCut = false,
    runUncertain = false;
  const saved = new Uint8Array(count);
  let state: MotionState = {
    moveIndex: 0,
    spindle: "unknown",
    rpm: null,
    feedExplicit: false,
  };
  let stateIndex = 0;
  let previousTool = -1,
    changeIndex = 0;
  let pass = 0;
  const maxEvaluations = options.maxEvaluations ?? Infinity;
  let progressTime = performance.now();
  options.onProgress?.(0, count);
  const removedByMove = new Float64Array(count + 1);
  const uncertainByMove = new Uint32Array(count + 1);
  const entries: {
    segment: number;
    pass: number;
    side: MachiningSide;
    depth: number;
    start: number;
    end: number;
  }[] = [];

  function add(
    kind: FindingKind,
    segment: number,
    detail: string,
    score = 0,
    seconds = 0,
  ) {
    const tool = m[segment * STRIDE + 6],
      line = m[segment * STRIDE + 8];
    const id = `${kind}:${side}:${tool}`;
    let finding = groups.get(id);
    if (!finding) {
      if (groups.size >= 256) {
        limitations.add(
          "The report reached 256 groups. Split the program to inspect additional findings.",
        );
        return;
      }
      const [severity, title, suggestion] = RULES[kind];
      finding = {
        id,
        kind,
        severity,
        title,
        suggestion,
        detail,
        tool,
        side,
        occurrences: 0,
        locations: [],
        seconds: 0,
        lastMove: -2,
        score,
        pass: -1,
        locationScore: -Infinity,
      };
      groups.set(id, finding);
    }
    if (score > finding.score) {
      finding.detail = detail;
      finding.score = score;
    }
    const previous = finding.locations.at(-1);
    if (previous && finding.pass === pass) {
      previous.endMoveIndex = segment;
      previous.endLine = line;
      previous.seconds += seconds;
      if (finding.lastMove !== segment - 1) previous.spans++;
      if (score > finding.locationScore) {
        previous.detail = detail;
        previous.focusMoveIndex = segment;
        previous.focusLine = line;
        finding.locationScore = score;
      }
    } else {
      finding.occurrences++;
      finding.locations.push({
        moveIndex: segment,
        endMoveIndex: segment,
        line,
        endLine: line,
        focusMoveIndex: segment,
        focusLine: line,
        detail,
        seconds,
        spans: 1,
      });
      finding.locationScore = score;
    }
    finding.pass = pass;
    finding.lastMove = segment;
    finding.seconds += seconds;
  }
  function finishRun() {
    const usefulLength = candidates.reduce((length, segment) => {
      const i = segment * STRIDE;
      return length + Math.hypot(m[i + 3] - m[i], m[i + 4] - m[i + 1]);
    }, 0);
    // Ignore sub-millimetre NC rounding wiggles, not meaningful empty operations.
    if (!runCut && !runUncertain && usefulLength >= Math.min(1, diameter / 2)) {
      for (const segment of candidates) {
        if (saved[segment]) continue;
        const seconds = m[segment * STRIDE + 9];
        add(
          "empty-pass",
          segment,
          `No new stock removal detected over this feed pass (analysis grid ${fmt(spacing, 3)} mm).`,
          0,
          seconds,
        );
        emptySeconds += seconds;
        saved[segment] = 1;
      }
    }
    candidates = [];
    runCut = false;
    runUncertain = false;
  }
  for (let segment = 0; segment < count; segment++) {
    if (segment % 2048 === 0 && performance.now() - progressTime > 80) {
      options.onProgress?.(segment, count);
      progressTime = performance.now();
    }
    if (opIndex + 1 < ops.length && segment >= ops[opIndex].end) {
      finishRun();
      opIndex++;
      pass++;
      side = ops[opIndex].side;
      seen.clear();
      const nextUpper = new Float64Array(upper.length),
        nextLower = new Float64Array(lower.length);
      const nextUncertain = new Uint8Array(uncertain.length);
      for (let y = 0; y <= ny; y++)
        for (let x = 0; x <= nx; x++) {
          const i = y * (nx + 1) + x,
            j = flippedIndex(x, y, nx, ny, flipAxis);
          nextUpper[i] = stock.z - lower[j];
          nextLower[i] = stock.z - upper[j];
          nextUncertain[i] = uncertain[j];
        }
      upper = nextUpper;
      lower = nextLower;
      uncertain = nextUncertain;
    }
    while (
      stateIndex < (program.motionStates?.length ?? 0) &&
      program.motionStates![stateIndex].moveIndex <= segment
    )
      state = program.motionStates![stateIndex++];
    while (
      changeIndex < program.toolChanges.length &&
      program.toolChanges[changeIndex].moveIndex <= segment
    ) {
      finishRun();
      changeIndex++;
      pass++;
    }
    const i = segment * STRIDE,
      id = m[i + 6],
      rapid = !!m[i + 7];
    const ax = m[i] + ox,
      ay = m[i + 1] + oy,
      az = m[i + 2] + oz;
    const bx = m[i + 3] + ox,
      by = m[i + 4] + oy,
      bz = m[i + 5] + oz;
    const dx = bx - ax,
      dy = by - ay,
      dz = bz - az;
    const xy = Math.hypot(dx, dy),
      distance = Math.hypot(xy, dz);
    const minZ = Math.min(az, bz),
      dt = m[i + 9];
    if (
      rapid ||
      id !== previousTool ||
      (xy < EPS && dz > Math.max(0.05, (tools[id]?.diameter ?? 1) * 0.02)) ||
      minZ >= stock.z - EPS
    )
      finishRun();
    if (rapid || id !== previousTool) pass++;
    previousTool = id;
    if (minZ >= stock.z - EPS) continue;
    const assigned = tools[id];
    const valid = !!assigned && validTool(assigned);
    const t = valid
      ? assigned
      : {
          kind: "unsupported" as const,
          diameter: 100,
          id: "unknown",
          name: "Unknown tool",
        };
    if (!valid) {
      limitations.add(
        `T${id}: assign a valid cutter to analyze material contact and repeated passes.`,
      );
    }
    const r = t.diameter / 2;
    const depth = stock.z - minZ;
    const effectiveDiameter =
      t.kind === "v"
        ? Math.min(
            t.diameter,
            (t.tip ?? 0) + 2 * depth * Math.tan((t.angle! * Math.PI) / 360),
          )
        : t.kind === "ball" && depth < r
          ? 2 * Math.sqrt(Math.max(0, 2 * r * depth - depth * depth))
          : t.diameter;
    const edgeRadius = effectiveDiameter / 2;
    // Clip the segment to the Z slab before XY bounds checks: an above-stock
    // approach outside the blank is not itself an out-of-bounds cut.
    let from = 0,
      to = 1;
    if (az > stock.z) from = (stock.z - az) / dz;
    if (bz > stock.z) to = (stock.z - az) / dz;
    const x1 = ax + dx * from,
      x2 = ax + dx * to;
    const y1 = ay + dy * from,
      y2 = ay + dy * to;
    const extent = Math.max(
      edgeRadius - Math.min(x1, x2),
      Math.max(x1, x2) + edgeRadius - stock.x,
      edgeRadius - Math.min(y1, y2),
      Math.max(y1, y2) + edgeRadius - stock.y,
    );
    if (!rapid && minZ < -EPS)
      add(
        "below-stock",
        segment,
        `Tip reaches ${fmt(-minZ)} mm below the stock bottom.`,
        -minZ,
      );
    if (valid && !rapid && extent > EPS && xy > EPS)
      add(
        "outside-stock",
        segment,
        `Cutter envelope extends up to ${fmt(extent)} mm beyond the XY stock bounds.`,
        extent,
      );
    if (!supported(t)) {
      if (valid)
        limitations.add(
          `T${id}: ${t.kind === "thread" ? "thread" : "special"} profile. Contact checks are limited only where this cutter may have removed stock.`,
        );
    }
    const resolved = effectiveDiameter >= spacing * 4;
    if (!resolved)
      limitations.add(
        "Some cutting features are finer than the analysis grid. Empty-pass and engagement checks are omitted for those moves.",
      );
    let key = "",
      repeated = false;
    const candidate =
      supported(t) &&
      !rapid &&
      xy > EPS &&
      Math.max(az, bz) < stock.z - EPS &&
      dz <= xy;
    if (candidate) {
      // Micrometre rounding only accommodates opposite-direction arc arithmetic.
      const a = [ax, ay, az].map((n) => n.toFixed(6)).join(",");
      const b = [bx, by, bz].map((n) => n.toFixed(6)).join(",");
      key = `${t.kind}/${t.diameter}/${t.angle ?? 0}/${t.tip ?? 0}/${a < b ? `${a}/${b}` : `${b}/${a}`}`;
      repeated = seen.has(key);
    }
    let freshDepth = 0,
      samples = 0,
      footprint = 0;
    let unknownContact = false;
    if (modelAvailable && !repeated) {
      const sample = analysisSweep(
        ax,
        ay,
        az,
        bx,
        by,
        bz,
        supported(t) ? t : { ...t, kind: "flat" },
      );
      const minY = Math.max(0, Math.ceil((Math.min(ay, by) - r) / sy));
      const maxY = Math.min(ny, Math.floor((Math.max(ay, by) + r) / sy));
      raster: for (let y = minY; y <= maxY; y++) {
        const py = y * sy;
        let lo = 0,
          hi = 1;
        if (Math.abs(dy) > 1e-12) {
          const a = (py - r - ay) / dy,
            b = (py + r - ay) / dy;
          lo = Math.max(0, Math.min(a, b));
          hi = Math.min(1, Math.max(a, b));
          if (lo > hi) continue;
        }
        const minX = Math.max(
          0,
          Math.ceil((Math.min(ax + dx * lo, ax + dx * hi) - r) / sx),
        );
        const maxX = Math.min(
          nx,
          Math.floor((Math.max(ax + dx * lo, ax + dx * hi) + r) / sx),
        );
        for (let x = minX; x <= maxX; x++) {
          if (++evaluations > maxEvaluations) {
            modelAvailable = false;
            limitations.add(
              "Material-analysis budget reached. Remaining bounds and exact-repeat checks continue; stock-contact coverage is partial.",
            );
            break raster;
          }
          const height = sample(x * sx, py);
          if (height >= stock.z - EPS) continue;
          footprint++;
          const index = y * (nx + 1) + x;
          const before = upper[index],
            after = Math.max(lower[index], height, 0);
          if (!supported(t)) {
            if (!rapid && before - after > EPS) uncertain[index] = 1;
            continue;
          }
          if (before - after > EPS) {
            if (uncertain[index]) unknownContact = true;
            else {
              freshDepth = Math.max(freshDepth, before - after);
              samples++;
              // A single raster point on a thin residual wall overstates its
              // volume. Entry warnings require surrounding solid stock too.
              // Read every neighbour from before this move, regardless of scan order.
              let solidHeight = before;
              for (let yy = y - 1; yy <= y + 1; yy++)
                for (let xx = x - 1; xx <= x + 1; xx++) {
                  if (xx < 0 || xx > nx || yy < 0 || yy > ny) {
                    solidHeight = 0;
                    continue;
                  }
                  const neighbor = yy * (nx + 1) + xx;
                  solidHeight = Math.min(
                    solidHeight,
                    uncertain[neighbor]
                      ? 0
                      : updatedAt[neighbor] === segment
                        ? previousUpper[neighbor]
                        : upper[neighbor],
                  );
                }
              if (!rapid && state.spindle !== "off" && state.rpm !== 0)
                removedByMove[segment + 1] +=
                  Math.max(0, solidHeight - after) * sx * sy;
            }
          }
          if (!rapid && state.spindle !== "off" && state.rpm !== 0) {
            previousUpper[index] = before;
            updatedAt[index] = segment;
            upper[index] = Math.min(before, after);
          }
        }
      }
      if (modelAvailable) analyzedMoves++;
    }
    if (!supported(t)) {
      runUncertain = true;
      continue;
    }
    if (
      unknownContact ||
      !resolved ||
      !modelAvailable ||
      state.spindle === "off" ||
      state.rpm === 0
    )
      uncertainByMove[segment + 1] = 1;
    if (repeated) footprint = 1;
    const off = state.spindle === "off" || state.rpm === 0;
    if (!rapid) {
      if (freshDepth > EPS) runCut = true;
      if (
        !modelAvailable ||
        !resolved ||
        unknownContact ||
        off ||
        (footprint === 0 && extent <= EPS)
      )
        runUncertain = true;
      if (candidate && resolved) candidates.push(segment);
      if (candidate && repeated && !off) {
        add(
          "repeated-path",
          segment,
          "Same cutter geometry follows an earlier XYZ segment at the same depth, including reverse-direction repeats.",
          0,
          dt,
        );
        repeatedSeconds += dt;
        saved[segment] = 1;
      }
      if (key && !off) {
        if (seen.size < 250_000) seen.add(key);
        else
          limitations.add(
            "Exact-repeat index reached its size limit. Additional unique paths are not indexed.",
          );
      }
    }
    if (!modelAvailable || unknownContact || freshDepth <= EPS || samples === 0)
      continue;
    if (rapid) {
      add(
        "rapid-contact",
        segment,
        `G0 overlaps up to ${fmt(freshDepth)} mm of remaining material.`,
        freshDepth,
      );
      continue;
    }
    cuttingSeconds += dt;
    if (off)
      add(
        "spindle-off",
        segment,
        state.rpm === 0
          ? "S0 is active during material contact."
          : "M5 is active during material contact.",
      );
    else if (state.spindle === "unknown")
      add(
        "spindle-unknown",
        segment,
        "Material contact occurs before an explicit spindle-start command.",
      );
    if (state.rpm === null)
      add(
        "missing-rpm",
        segment,
        "No spindle speed S is available for this cut.",
      );
    if (!state.feedExplicit)
      add(
        "missing-feed",
        segment,
        "No explicit F precedes this material contact; estimated time may be inaccurate.",
      );
    if (t.length && freshDepth > t.length + EPS)
      add(
        "cutting-length",
        segment,
        `Fresh-material engagement reaches ${fmt(freshDepth)} mm; specified cutting length is ${fmt(t.length)} mm.`,
        freshDepth,
      );
    if (!resolved) continue;
    if (freshDepth > t.diameter * profile.engagementRatio + EPS)
      add(
        "deep-engagement",
        segment,
        `${fmt(freshDepth)} mm of fresh material (${fmt(freshDepth / t.diameter)}× diameter), above the ${profile.engagementRatio}× review threshold for ${profile.material}.`,
        freshDepth,
      );
    const feed = dt > 0 ? (distance / dt) * 60 : 0;
    if (!off && dz < -EPS && freshDepth >= Math.max(0.05, t.diameter * 0.05))
      entries.push({
        segment,
        pass,
        side,
        depth: freshDepth,
        start: ops[opIndex].start,
        end: ops[opIndex].end,
      });
    if (
      state.rpm &&
      !off &&
      feed / state.rpm > profile.feedPerRevRatio * t.diameter
    )
      add(
        "high-feed",
        segment,
        `${fmt(feed / state.rpm, 3)} mm/rev at ${fmt(feed, 0)} mm/min and ${fmt(state.rpm, 0)} RPM; review threshold ${fmt(profile.feedPerRevRatio * t.diameter, 3)} mm/rev for ${profile.material}.`,
        feed / state.rpm,
      );
  }
  finishRun();
  // Use actual removed volume over the same neighbourhood as the smoothed
  // trajectory. A grazing sample / residual wall sliver is not a full plunge.
  for (let i = 1; i <= count; i++) {
    removedByMove[i] += removedByMove[i - 1];
    uncertainByMove[i] += uncertainByMove[i - 1];
  }
  for (const entry of entries) {
    const t = tools[m[entry.segment * STRIDE + 6]];
    const motion = entryMotion(
      program,
      entry.segment,
      t.diameter,
      entry.start,
      entry.end,
    );
    if (uncertainByMove[motion.last + 1] !== uncertainByMove[motion.first])
      continue;
    const volume = removedByMove[motion.last + 1] - removedByMove[motion.first];
    const area = Math.PI * (t.diameter / 2) ** 2 + t.diameter * motion.travel;
    if (volume / area < Math.max(0.025, t.diameter * 0.02)) continue;
    if (motion.drop < Math.max(0.05, t.diameter * 0.05)) continue;
    // Most of a descent can be through an already open pocket. Judge only
    // substantial stock engagement; nominal Z speed alone is not cutting load.
    const engagement = Math.min(1, volume / (area * motion.drop));
    if (
      (motion.angle < 89 &&
        motion.angle > profile.rampAngle &&
        engagement > 0.5) ||
      motion.axialFeed * engagement > profile.plungeFeedPerDiameter * t.diameter
    ) {
      pass = entry.pass;
      side = entry.side;
      add(
        "steep-entry",
        entry.segment,
        `${motion.angle < 89 ? `${fmt(motion.angle, 1)}° ramp` : "Plunge"} · ${fmt(motion.axialFeed, 0)} mm/min vertically · ${fmt(engagement * 100, 0)}% fresh-stock engagement.`,
        motion.angle + motion.axialFeed / 1000,
      );
    }
  }
  const ranks: Record<Severity, number> = {
    danger: 0,
    warning: 1,
    opportunity: 2,
  };
  const efficiencyFindings = analyzeEfficiency(program, stock, tools);
  // Exact/empty segments can already lie inside an expensive re-entry pass.
  // Count the union by packed move index, never sum overlapping finding times.
  const optimizable = saved.slice();
  for (const finding of efficiencyFindings)
    for (const location of finding.locations)
      optimizable.fill(1, location.moveIndex, location.endMoveIndex + 1);
  let optimizableSeconds = 0;
  for (let segment = 0; segment < count; segment++)
    if (optimizable[segment] && !m[segment * STRIDE + 7])
      optimizableSeconds += m[segment * STRIDE + 9];
  const findings = [...groups.values()]
    .map(
      ({
        lastMove: _last,
        score: _score,
        pass: _pass,
        locationScore: _locationScore,
        ...finding
      }) => finding,
    )
    .concat(efficiencyFindings)
    .sort(
      (a, b) =>
        ranks[a.severity] - ranks[b.severity] ||
        (b.durationSeconds ?? b.seconds) - (a.durationSeconds ?? a.seconds) ||
        a.locations[0].moveIndex - b.locations[0].moveIndex,
    );
  options.onProgress?.(count, count);
  return {
    findings,
    optimizableSeconds,
    repeatedSeconds,
    emptySeconds,
    savingsSeconds: repeatedSeconds + emptySeconds,
    totalSeconds: program.seconds,
    cuttingSeconds,
    gridSpacing: spacing,
    analyzedMoves: count,
    contactCheckedMoves: analyzedMoves,
    totalMoves: count,
    limitations: [...limitations],
    complete: limitations.size === 0,
    profile,
  };
}
