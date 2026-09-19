import { lexLine, type Word } from "./lex";
import { CARVERA_COMMANDS, unsupportedCarveraCommand } from "./carvera";
import { validWorkOffsets } from "./coordinates";
import {
  STRIDE,
  WORK_SYSTEMS,
  type Program,
  type ToolChange,
  type MotionState,
  type WorkSystem,
  type WorkOffsets,
} from "../types";

const MAX_MOVES = 1_000_000;
const AXES = ["X", "Y", "Z"];
const SUPPORTED_G = new Set([
  0,
  1,
  2,
  3,
  4,
  10,
  17,
  18,
  19,
  20,
  21,
  28,
  28.1,
  28.2,
  28.6,
  40,
  49,
  53,
  ...WORK_SYSTEMS,
  80,
  90,
  90.1,
  91,
  91.1,
  92.1,
  92.2,
  94,
  98,
  99,
]);
export function parseProgram(
  text: string,
  options: { workOffsets?: WorkOffsets } = {},
): Program {
  if (
    options.workOffsets !== undefined &&
    !validWorkOffsets(options.workOffsets)
  )
    throw new Error(
      "Invalid work offsets: use XYZ in millimeters relative to G54.",
    );
  let data = new Float64Array(4096 * STRIDE),
    size = 0;
  const used = new Set<number>(),
    warnings = new Set<string>();
  const toolChanges: ToolChange[] = [];
  const motionStates: MotionState[] = [];
  const workSystems = new Set<WorkSystem>();
  let spindle: MotionState["spindle"] = "unknown";
  let rpm: number | null = null;
  let feedOverride = 1,
    spindleOverride = 1;
  let feedExplicit = false;
  const positionKnown = [true, true, true];
  let positionReason = "machine travel";
  let workSystem: WorkSystem = 54;
  let workMotionStarted = false;
  let workOffset: [number, number, number] | undefined = [0, 0, 0];
  let p = [0, 0, 0],
    absolute = true,
    arcAbsolute = false,
    plane = 17,
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
  function currentOffset(): [number, number, number] {
    return (
      workOffset ??
      fail(
        `G${workSystem} needs an XYZ offset relative to G54. Add it under Stock → Work offsets.`,
      )
    );
  }
  const add = (q: number[], rapid: boolean) => {
    const d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    if (!d) return;
    if (size / STRIDE >= MAX_MOVES)
      fail("1 million segment limit reached. Split the program.");
    if (!rapid && tool === -1)
      fail(
        "cutting move with no tool loaded (T-1). Select a tool with T/M6 first.",
      );
    // Carvera's M220 scales the planner's time base for feed moves and rapids.
    const dt = (d / ((rapid ? 3000 : feed) * feedOverride)) * 60;
    const effectiveRpm = rpm === null ? null : rpm * spindleOverride;
    const previous = motionStates.at(-1);
    if (
      !previous ||
      previous.spindle !== spindle ||
      previous.rpm !== effectiveRpm ||
      previous.feedExplicit !== feedExplicit
    ) {
      motionStates.push({
        moveIndex: size / STRIDE,
        spindle,
        rpm: effectiveRpm,
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
    // The bundled controller diagnostics use echo as a console message.
    // Other shell commands remain invalid NC input.
    if (/^\s*echo(?:\s|$)/i.test(raw)) {
      warnings.add("Controller messages are excluded from the preview.");
      continue;
    }
    let words: Word[];
    try {
      words = lexLine(raw);
    } catch (error) {
      fail(error instanceof Error ? error.message : "unsupported syntax.");
    }
    if (!words.length) continue;
    const v: Record<string, number> = {};
    const gCodes: number[] = [],
      mCodes: number[] = [];
    for (const [letter, value] of words) {
      if (letter === "G") gCodes.push(value);
      if (letter === "M") mCodes.push(value);
    }
    const specialCodes = mCodes.filter((value) => CARVERA_COMMANDS.has(value));
    if (specialCodes.length > 1)
      fail(
        "multiple controller commands in one block are ambiguous; put each command on its own line.",
      );
    const controllerCode = specialCodes[0];
    const controller = CARVERA_COMMANDS.get(controllerCode);
    let change = false,
      stop = false,
      dwell = false,
      home = false,
      machineMove = false;
    for (const [letter, value] of words) {
      if (letter === "G" && !SUPPORTED_G.has(value))
        fail(
          unsupportedCarveraCommand(letter, value) ??
            `G${value} is not supported. Use explicit 3-axis toolpaths (no cycles or compensation).`,
        );
      if (
        letter === "M" &&
        !CARVERA_COMMANDS.has(value) &&
        ![0, 1, 2, 3, 4, 5, 7, 8, 9, 30].includes(value)
      )
        fail(
          unsupportedCarveraCommand(letter, value) ??
            `M${value} is not supported.`,
        );
      if (letter === "M") {
        if (value === 3) spindle = "cw";
        if (value === 4) spindle = "ccw";
        if (value === 5) spindle = "off";
        if (value === 6 || value === 493.2) change = true;
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
        if (value === 28 || value === 28.2) home = true;
        if (value === 53) machineMove = true;
        if (WORK_SYSTEMS.includes(value as WorkSystem)) {
          if (
            options.workOffsets === undefined &&
            workMotionStarted &&
            value !== workSystem
          )
            fail(
              `G${value} changes the work coordinate system after motion; the relative work offsets are not available in this file. Enable separate work offsets under Stock → Work offsets and enter the zeros relative to G54.`,
            );
          workSystem = value as WorkSystem;
          workOffset =
            options.workOffsets === undefined || workSystem === 54
              ? [0, 0, 0]
              : options.workOffsets[workSystem];
          warnings.add(
            options.workOffsets === undefined
              ? `G${value}: coordinates use the configured workpiece coordinate system.`
              : `G${value}: using the configured offset relative to G54.`,
          );
        }
      }
      if (letter !== "G" && letter !== "M" && letter in v)
        fail(`duplicate word ${letter} in the same block.`);
      v[letter] = value;
    }
    const setup = gCodes.includes(10);
    const storedHome = gCodes.includes(28.1);
    const homeStatus = gCodes.includes(28.6);
    const resetOffset = gCodes.includes(92.1) || gCodes.includes(92.2);
    const nonMotion =
      controller ||
      dwell ||
      setup ||
      home ||
      storedHome ||
      homeStatus ||
      resetOffset;
    if (nonMotion && gCodes.some((g) => g <= 3 || g === 53))
      fail(
        "controller/setup commands and explicit motion must be in separate blocks.",
      );
    if (
      Number(!!controller) +
        Number(dwell) +
        Number(setup) +
        Number(home) +
        Number(storedHome) +
        Number(homeStatus) +
        Number(resetOffset) >
      1
    )
      fail(
        "multiple parameter-owning commands in one block; put each command on its own line.",
      );
    if (controller && mCodes.some((m) => [3, 4, 5].includes(m)))
      fail("spindle and controller commands must be in separate blocks.");
    const parameters = controller
      ? controller.parameters
      : dwell
        ? "PS"
        : setup
          ? "LPRXYZ"
          : home
            ? "XYZ"
            : storedHome
              ? "XY"
              : homeStatus || resetOffset
                ? ""
                : "TXYZIJKRFS";
    for (const letter of Object.keys(v)) {
      if ("GMNO".includes(letter) || parameters.includes(letter)) continue;
      if ("ABCUVW".includes(letter))
        fail(
          "rotary or auxiliary axes are not supported: 3-axis simulation only.",
        );
      fail(`unsupported word ${letter} in this block.`);
    }
    if ("T" in v) {
      if (v.T < -1 || !Number.isInteger(v.T)) fail("invalid tool number.");
      // M493.5 sets the next tool; it must not activate an implicit first tool.
      selected = v.T;
      if (!initialized && controllerCode !== 493.5) initialToolLine = lineCount;
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
    if (controller) {
      if (controllerCode === 493.2 && !("T" in v))
        fail("M493.2 requires a T number.");
      if (
        (controllerCode === 6 || controller.effect === "calibrate") &&
        "R" in v &&
        (!Number.isInteger(v.R) || v.R < 1)
      )
        fail("tool calibration repeat count R must be a positive integer.");
      if (controllerCode === 6 && "C" in v && v.C !== 0 && v.C !== 1)
        fail("M6 calibration flag C must be 0 or 1.");
      if (
        controllerCode === 6 &&
        "S" in v &&
        (!Number.isInteger(v.S) || v.S < 0 || v.S > 5)
      )
        fail("M6 collet selection S must be an integer from 0 to 5.");
      if (
        (controller.effect === "feed" || controller.effect === "rpm") &&
        "S" in v
      ) {
        const maximum = controller.effect === "feed" ? 1000 : 300;
        const percentage = Math.min(maximum, Math.max(10, v.S));
        if (percentage !== v.S)
          warnings.add(
            `M${controllerCode}: override clamped to ${percentage}% (Carvera range 10–${maximum}%).`,
          );
        if (controller.effect === "feed") feedOverride = percentage / 100;
        else spindleOverride = percentage / 100;
      }
      if (
        controller.effect === "calibrate" ||
        (controllerCode === 6 &&
          (v.C === 1 ||
            (v.C !== 0 && ("X" in v || "Y" in v || "Z" in v || "R" in v))))
      ) {
        // Calibration returns to the prior XY at machine clearance Z.
        positionKnown[2] = false;
        positionReason = `M${controllerCode}`;
        spindle = "off";
        warnings.add(
          `M${controllerCode}: tool calibration travel and time are excluded; calibrated tool-tip coordinates are assumed.`,
        );
      }
      if (controller.effect === "position") {
        if (
          (controllerCode === 496.5 || controllerCode === 496.6) &&
          !("X" in v && "Y" in v)
        )
          fail(`M${controllerCode} requires both X and Y.`);
        positionKnown.fill(false);
        if (controllerCode === 496.2 || controllerCode === 496.5) {
          const offset = currentOffset();
          p[0] = offset[0] + (controllerCode === 496.2 ? 0 : v.X * scale);
          p[1] = offset[1] + (controllerCode === 496.2 ? 0 : v.Y * scale);
          positionKnown[0] = positionKnown[1] = true;
        }
        positionReason = `M${controllerCode}`;
        warnings.add(
          `M${controllerCode}: controller positioning excluded from toolpath and timing.`,
        );
      }
      if (controller.effect === "pause")
        warnings.add(
          "Controller/operator pauses are excluded from time estimates.",
        );
      if (controller.effect === "accessory")
        warnings.add(
          "Controller accessories, messages and hardware checks are accepted without simulating their physical effects or time.",
        );
      if (stop) break;
      continue;
    }
    if ("F" in v) {
      feedExplicit = true;
      feed = v.F * scale;
      if (feed <= 0) fail("feed rate F must be positive.");
    }
    if ("S" in v && !dwell) {
      if (v.S < 0) fail("spindle speed S cannot be negative.");
      rpm = v.S;
    }
    if (dwell) {
      if ((v.P ?? 0) < 0 || (v.S ?? 0) < 0)
        fail("G4 dwell duration cannot be negative.");
      warnings.add("G4 pauses are excluded from time estimates.");
      if (stop) break;
      continue;
    }
    if (setup) {
      if (workMotionStarted)
        fail(
          "G10 changes work offsets after motion. Set offsets before motion; runtime offset changes are not supported.",
        );
      if (
        ![2, 20].includes(v.L) ||
        !Number.isInteger(v.P) ||
        v.P < 0 ||
        v.P > 9
      )
        fail("G10 requires L2 or L20 and a work system P0–P9.");
      if (v.P !== 0 && WORK_SYSTEMS[v.P - 1] !== workSystem)
        fail("G10 must configure the selected work coordinate system.");
      if ("R" in v && v.R !== 0)
        fail("G10 work coordinate rotation is not supported.");
      warnings.add(
        "G10: initial work offset setup is accepted; preview coordinates use the configured stock origin. Machine offsets are not simulated.",
      );
      if (stop) break;
      continue;
    }
    if (storedHome || homeStatus) {
      warnings.add(
        "G28 park-position storage/status does not change the preview path.",
      );
      if (stop) break;
      continue;
    }
    if (resetOffset) {
      if (stop) break;
      continue;
    }
    const coords = "X" in v || "Y" in v || "Z" in v;
    const arc = motion === 2 || motion === 3;
    if (home) {
      // Carvera G28 goes to configurable clearance, irrespective of XYZ words.
      // Neither that position nor the work offset is available in an NC file.
      warnings.add(
        `G${gCodes.includes(28.2) ? "28.2 homing" : "28 clearance travel"} excluded from toolpath and timing (machine/work offset unavailable).`,
      );
      for (let i = 0; i < 3; i++)
        if (!gCodes.includes(28.2) || !coords || AXES[i] in v)
          positionKnown[i] = false;
      positionReason = gCodes.includes(28.2) ? "G28.2" : "G28";
      if (stop) break;
      continue;
    }
    if (machineMove) {
      if (
        motion !== 0 ||
        !absolute ||
        "I" in v ||
        "J" in v ||
        "K" in v ||
        "R" in v
      )
        fail(
          "G53 requires an absolute G0 rapid; machine-coordinate cutting cannot be placed in the workpiece without machine offsets.",
        );
      for (let i = 0; i < 3; i++) if (AXES[i] in v) positionKnown[i] = false;
      if (coords) positionReason = "G53";
      warnings.add(
        "G53 machine-coordinate travel excluded from toolpath and timing (machine/work offset unavailable).",
      );
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
      workMotionStarted = true;
      workSystems.add(workSystem);
      const offset = currentOffset();
      const q = p.map((n, i) =>
        AXES[i] in v ? v[AXES[i]] * scale + (absolute ? offset[i] : n) : n,
      );
      if (!positionKnown.every(Boolean)) {
        if (!(motion === 0 && absolute))
          fail(
            `position after ${positionReason} is unknown for ${AXES.filter((_, i) => !positionKnown[i]).join(", ")}: restore those axes with absolute G0 moves (one or more lines) before cutting or incremental motion.`,
          );
        for (let i = 0; i < 3; i++) if (AXES[i] in v) positionKnown[i] = true;
        p = q;
        warnings.add(
          `Rapid repositioning after ${positionReason} excluded from toolpath and timing until work coordinates are restored.`,
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
        let cx = (arcAbsolute ? offset[u] : p[u]) + (v[cu] ?? 0) * scale,
          cy = (arcAbsolute ? offset[w] : p[w]) + (v[cw] ?? 0) * scale;
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
    workSystems: [...workSystems],
    tools: [...used].sort((a, b) => a - b),
    toolChanges,
    motionStates,
    lines: lineCount,
    warnings: [...warnings],
    distance,
    seconds,
  };
}
