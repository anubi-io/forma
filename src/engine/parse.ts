import { lexLine, type Word } from "./lex";
import {
  STRIDE,
  type Program,
  type ToolChange,
  type MotionState,
} from "../types";

const MAX_MOVES = 1_000_000;
const SUPPORTED_G = new Set([
  0, 1, 2, 3, 4, 17, 18, 19, 20, 21, 28, 40, 49, 54, 80, 90, 90.1, 91, 91.1, 94,
]);
export function parseProgram(text: string): Program {
  let data = new Float64Array(4096 * STRIDE),
    size = 0;
  const used = new Set<number>(),
    warnings = new Set<string>();
  const toolChanges: ToolChange[] = [];
  const motionStates: MotionState[] = [];
  let spindle: MotionState["spindle"] = "unknown";
  let rpm: number | null = null;
  let feedExplicit = false;
  let p = [0, 0, 0],
    absolute = true,
    arcAbsolute = false,
    plane = 17,
    positionKnown = true,
    scale = 1,
    motion = 0,
    feed = 600,
    selected = 0,
    tool = 0;
  let distance = 0,
    seconds = 0,
    lineCount = 0,
    initialized = false,
    initialToolLine = 0;
  function fail(message: string): never {
    throw new Error(`Line ${lineCount}: ${message}`);
  }
  const add = (q: number[], rapid: boolean) => {
    const d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    if (!d) return;
    if (size / STRIDE >= MAX_MOVES)
      fail("1 million segment limit reached. Split the program.");
    const dt = (d / (rapid ? 3000 : feed)) * 60;
    const previous = motionStates.at(-1);
    if (
      !previous ||
      previous.spindle !== spindle ||
      previous.rpm !== rpm ||
      previous.feedExplicit !== feedExplicit
    ) {
      motionStates.push({
        moveIndex: size / STRIDE,
        spindle,
        rpm,
        feedExplicit,
      });
    }
    if (size + STRIDE > data.length) {
      const next = new Float64Array(
        Math.min(data.length * 2, MAX_MOVES * STRIDE),
      );
      next.set(data);
      data = next;
    }
    data[size++] = p[0];
    data[size++] = p[1];
    data[size++] = p[2];
    data[size++] = q[0];
    data[size++] = q[1];
    data[size++] = q[2];
    data[size++] = tool;
    data[size++] = rapid ? 1 : 0;
    data[size++] = lineCount;
    data[size++] = dt;
    distance += d;
    seconds += dt;
    if (!rapid) used.add(tool);
    p = q;
  };
  // Iterate slices so large programs do not allocate an array for every source line.
  for (let start = 0; start <= text.length;) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;
    const raw = text.slice(start, end);
    start = end + 1;
    lineCount++;
    let words: Word[];
    try {
      words = lexLine(raw);
    } catch (error) {
      fail(error instanceof Error ? error.message : "unsupported syntax.");
    }
    if (!words.length) continue;
    const v: Record<string, number> = {};
    let change = false,
      stop = false,
      dwell = false,
      home = false;
    for (const [letter, value] of words) {
      if ("ABCUVW".includes(letter))
        fail(
          "rotary or auxiliary axes are not supported: 3-axis simulation only.",
        );
      if (!"GMTXYZIJKRFSNPHO".includes(letter))
        fail(`unsupported word ${letter}.`);
      if (letter === "G" && !SUPPORTED_G.has(value))
        fail(
          `G${value} is not supported. Use G54 without additional offsets and explicit toolpaths (no cycles or compensation).`,
        );
      if (letter === "M" && ![0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 30].includes(value))
        fail(`M${value} is not supported.`);
      if (letter === "M") {
        if (value === 3) spindle = "cw";
        if (value === 4) spindle = "ccw";
        if (value === 5) spindle = "off";
        if (value === 6) change = true;
        if (value === 2 || value === 30) stop = true;
      }
      if (letter === "G") {
        if (value === 20) scale = 25.4;
        if (value === 21) scale = 1;
        if (value === 90) absolute = true;
        if (value === 91) absolute = false;
        if (value === 90.1) arcAbsolute = true;
        if (value === 91.1) arcAbsolute = false;
        if (value === 17 || value === 18 || value === 19) plane = value;
        if (value <= 3) motion = value;
        if (value === 80) motion = -1;
        if (value === 4) dwell = true;
        if (value === 28) home = true;
        if (value === 54)
          warnings.add(
            "G54: coordinates use the configured workpiece coordinate system.",
          );
      }
      if (letter !== "G" && letter !== "M" && letter in v)
        fail(`duplicate word ${letter} in the same block.`);
      v[letter] = value;
    }
    if ("T" in v) {
      if (v.T < 0 || !Number.isInteger(v.T)) fail("invalid tool number.");
      selected = v.T;
      if (!initialized) initialToolLine = lineCount;
    }
    if (change) {
      toolChanges.push({
        tool: selected,
        previousTool: tool,
        line: lineCount,
        moveIndex: size / STRIDE,
        seconds,
      });
      tool = selected;
      initialized = true;
    }
    if ("F" in v) {
      feedExplicit = true;
      feed = v.F * scale;
      if (feed <= 0) fail("feed rate F must be positive.");
    }
    if ("S" in v) {
      if (v.S < 0) fail("spindle speed S cannot be negative.");
      rpm = v.S;
    }
    if (dwell) {
      warnings.add("G4 pauses are excluded from time estimates.");
      if (stop) break;
      continue;
    }
    if ("P" in v || "H" in v)
      fail("P/H parameters are not supported in this block.");
    const coords = "X" in v || "Y" in v || "Z" in v;
    const arc = motion === 2 || motion === 3;
    if (home) {
      // The machine's home position and work offset are not part of an NC file.
      // Never reinterpret the controller's G28 move as a cut in work coordinates.
      if (coords)
        fail(
          "G28 with intermediate axes is not supported: machine home position is unavailable.",
        );
      warnings.add(
        `Line ${lineCount}: G28 homing excluded from toolpath and timing (home position unavailable).`,
      );
      positionKnown = false;
      if (stop) break;
      continue;
    }
    if (coords || (arc && ("I" in v || "J" in v || "K" in v || "R" in v))) {
      if (motion < 0) fail("movement without G0/G1/G2/G3 after G80.");
      if (!initialized && initialToolLine) {
        toolChanges.push({
          tool: selected,
          previousTool: tool,
          line: initialToolLine,
          moveIndex: size / STRIDE,
          seconds,
          implicit: true,
        });
        tool = selected;
      }
      initialized = true;
      const q = p.map((n, i) =>
        ["X", "Y", "Z"][i] in v
          ? v[["X", "Y", "Z"][i]] * scale + (absolute ? 0 : n)
          : n,
      );
      if (!positionKnown) {
        if (!(motion === 0 && absolute && "X" in v && "Y" in v && "Z" in v))
          fail(
            "position after G28 is unknown: use G90 G0 with explicit X, Y and Z before resuming.",
          );
        p = q;
        positionKnown = true;
        warnings.add(
          `Line ${lineCount}: rapid repositioning after G28 excluded from timing.`,
        );
        if (stop) break;
        continue;
      }
      if (arc) {
        // Right-handed planes: XY, ZX, YZ (G18 must use Z,X to preserve CW/CCW).
        const [u, w, h] =
          plane === 17 ? [0, 1, 2] : plane === 18 ? [2, 0, 1] : [1, 2, 0];
        const centerWords = ["I", "J", "K"],
          cu = centerWords[u],
          cw = centerWords[w];
        if (centerWords[h] in v && v[centerWords[h]] !== 0)
          fail("arc center is outside the selected plane.");
        if (arcAbsolute && !("R" in v) && !(cu in v && cw in v))
          fail(`G90.1 requires explicit ${cu} and ${cw} for the arc center.`);
        let cx = (arcAbsolute ? 0 : p[u]) + (v[cu] ?? 0) * scale,
          cy = (arcAbsolute ? 0 : p[w]) + (v[cw] ?? 0) * scale;
        const clockwise = motion === 2;
        const sweepFor = (x: number, y: number) => {
          const a = Math.atan2(p[w] - y, p[u] - x),
            b = Math.atan2(q[w] - y, q[u] - x);
          let s = b - a;
          if (clockwise) {
            if (s >= -1e-10) s -= Math.PI * 2;
          } else if (s <= 1e-10) s += Math.PI * 2;
          return { a, s };
        };
        if ("R" in v) {
          if ("I" in v || "J" in v || "K" in v)
            fail("ambiguous arc: R combined with I/J/K.");
          const radius = Math.abs(v.R * scale),
            dx = q[u] - p[u],
            dy = q[w] - p[w],
            chord = Math.hypot(dx, dy);
          if (chord < 1e-9 || chord > 2 * radius + 1e-7)
            fail("invalid radius R for the arc endpoints.");
          const h = Math.sqrt(
            Math.max(0, radius * radius - (chord * chord) / 4),
          );
          cx = (p[u] + q[u]) / 2 - (dy / chord) * h;
          cy = (p[w] + q[w]) / 2 + (dx / chord) * h;
          if (Math.abs(sweepFor(cx, cy).s) > Math.PI + 1e-8 !== v.R < 0) {
            cx = (p[u] + q[u]) / 2 + (dy / chord) * h;
            cy = (p[w] + q[w]) / 2 - (dx / chord) * h;
          }
        } else if (!(cu in v || cw in v)) fail(`arc missing ${cu}/${cw} or R.`);
        const radius = Math.hypot(p[u] - cx, p[w] - cy);
        if (
          radius < 1e-8 ||
          Math.abs(Math.hypot(q[u] - cx, q[w] - cy) - radius) >
            Math.max(0.02, radius * 0.001)
        )
          fail("arc endpoints do not have the same radius.");
        const { a, s } = sweepFor(cx, cy),
          start = [...p];
        const maxAngle =
          2 * Math.acos(Math.max(-1, 1 - Math.min(0.02, radius) / radius));
        const steps = Math.max(
          2,
          Math.ceil(Math.abs(s) / Math.min(0.1, maxAngle)),
        );
        if (steps > 100000) fail("arc is too large.");
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          if (i === steps) add(q, false);
          else {
            const point = [0, 0, 0];
            point[u] = cx + radius * Math.cos(a + s * t);
            point[w] = cy + radius * Math.sin(a + s * t);
            point[h] = start[h] + (q[h] - start[h]) * t;
            add(point, false);
          }
        }
      } else add(q, motion === 0);
    }
    if (stop) break;
  }
  if (!size) throw new Error("No moves found in the file.");
  if (used.has(0))
    warnings.add("Moves without an explicit T number: assign a tool to T0.");
  return {
    moves: data.slice(0, size),
    tools: [...used].sort((a, b) => a - b),
    toolChanges,
    motionStates,
    lines: lineCount,
    warnings: [...warnings],
    distance,
    seconds,
  };
}
