import catalog from "./makera.json";
import { DEFAULT_STOCK, type Assignments, type Tool } from "../types";

export const DEMO_FILENAME = "tidal-relief.nc";
export const DEMO_MATERIAL = "brass";
export const DEMO_STOCK = DEFAULT_STOCK;
const library = catalog.tools as Tool[];
export const DEMO_TOOLS: Assignments = {
  1: library.find(
    (t) => t.kind === "flat" && t.diameter === 3.175 && t.length === 25,
  )!,
  2: library.find(
    (t) => t.kind === "ball" && t.diameter === 3.175 && t.length === 22,
  )!,
  3: library.find(
    (t) =>
      t.kind === "v" && t.angle === 30 && t.tip === 0.2 && t.shank === 3.175,
  )!,
};

const cx = 44,
  cy = 51,
  radius = 28;
/** A pair of curved ridges, in tool-tip Z relative to the top of the stock. */
function relief(x: number, y: number) {
  const u = (x - cx) * 0.94 + (y - cy) * 0.342;
  const v = -(x - cx) * 0.342 + (y - cy) * 0.94;
  const ridge =
    9.6 * Math.exp(-((u / 24) ** 4) - ((v + 5 * Math.sin(u / 11)) / 4.2) ** 2);
  const shoulder =
    5.3 * Math.exp(-(((u + 7) / 17) ** 4) - ((v - 12) / 4.1) ** 2);
  const ripples =
    1.1 * Math.cos(u * 0.32 + v * 0.18) * Math.exp(-(((v + 13) / 6) ** 2));
  const edge = Math.max(
    0,
    Math.min(1, (radius - Math.hypot(x - cx, y - cy)) / 4),
  );
  return -11.5 + (ridge + shoulder + ripples) * edge;
}

let cached: string | undefined;
/** Repeat each cutter path at raised Z levels before its final pass. Raised
 * copies stay inside the final cut envelope, preserving every visible feature.
 * A 1 mm stepdown keeps fresh engagement below 0.4 × the 3.175 mm cutter. */
function layeredPasses(lines: string[]) {
  const result: string[] = [];
  const seen = new Set<string>();
  let tool = 1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("T")) tool = Number(line.match(/^T(\d+)/)![1]);
    if (tool > 2 || !line.startsWith("G1 Z")) {
      result.push(line);
      continue;
    }
    const first = i;
    while (i + 1 < lines.length && !lines[i + 1].startsWith("G0")) i++;
    const path = lines.slice(first, i + 1);
    const depths = path.flatMap((block) =>
      [...block.matchAll(/Z(-?[\d.]+)/g)].map((match) => Number(match[1])),
    );
    const passes = Math.ceil(-Math.min(...depths));
    let started = false;
    for (let level = passes - 1; level >= 0; level--) {
      const raised = path.map((block) =>
        block.replace(
          /Z(-?[\d.]+)/g,
          (_, z) => `Z${(Number(z) + level).toFixed(3)}`,
        ),
      );
      const key = [tool, lines[first - 1], ...raised].join("\n");
      if (seen.has(key)) continue;
      seen.add(key);
      if (started) result.push("G0 Z5", lines[first - 1]);
      result.push(...raised);
      started = true;
    }
  }
  return result;
}

/** Every visible feature comes from CNC moves: roughing, ball finishing and engraving. */
export function demoCode() {
  if (cached) return cached;
  const lines = [
    "(FORMA - Tidal relief machining study)",
    "(120 x 90 x 18 mm - front-left XY origin - Z zero on stock top)",
    "(T1 pockets and through-cuts / T2 sculpted relief / T3 fine engraving)",
    "G21 G17 G90 G94 G54",
    "T1 M6",
    "S12000 M3",
    "G0 Z5",
  ];
  const n = (v: number) => v.toFixed(3);
  const move = (x: number, y: number, z: number) =>
    `X${n(x)} Y${n(y)} Z${n(z)}`;
  const start = (x: number, y: number, z: number, feed = 300) => {
    lines.push("G0 Z5", `G0 X${n(x)} Y${n(y)}`, `G1 Z${n(z)} F${feed}`);
  };
  const circle = (x: number, y: number, r: number, z: number) => {
    start(x + r, y, z);
    lines.push(`G3 X${n(x + r)} Y${n(y)} I${n(-r)} J0 F900`, "G0 Z5");
  };

  lines.push("(01 - Circular frame and relief roughing)");
  for (const z of [-1.5, -3]) for (const r of [29.5, 31]) circle(cx, cy, r, z);
  // Leave stock around the ridges for the ball nose. Sample the cutter's
  // footprint with a 0.6 mm finishing allowance before accepting a rough pass.
  const roughable = (x: number, y: number, z: number) => {
    if (Math.hypot(x - cx, y - cy) > radius - 2) return false;
    for (let k = 0; k < 12; k++) {
      const a = (k * Math.PI) / 6;
      if (relief(x + Math.cos(a) * 1.8, y + Math.sin(a) * 1.8) + 0.6 > z)
        return false;
    }
    return relief(x, y) + 0.6 <= z;
  };
  for (const z of [-3, -6, -9])
    for (let y = cy - radius + 2; y <= cy + radius - 2; y += 2.2) {
      let from: number | undefined;
      for (let x = cx - radius + 2; x <= cx + radius - 1; x += 0.7) {
        if (roughable(x, y, z)) {
          from ??= x;
        } else if (from !== undefined) {
          if (x - 0.7 > from) {
            start(from, y, z);
            lines.push(`G1 X${n(x - 0.7)} F1100`, "G0 Z5");
          }
          from = undefined;
        }
      }
    }

  lines.push("(02 - Concentric precision pocket)");
  for (const [z, outer] of [
    [-2, 12.5],
    [-4, 8.5],
    [-6, 5],
    [-8, 2],
  ]) {
    start(97, 57, z);
    lines.push("G0 Z5");
    for (let r = 1.1; r < outer; r += 1.8) circle(97, 57, r, z);
    circle(97, 57, outer, z);
  }

  lines.push("(03 - Capsule through-slot and counterbored mounting holes)");
  for (const z of [-3, -6, -9, -12, -15, -18]) {
    start(88, 30, z);
    lines.push("G1 X106 F800", "G0 Z5");
    for (const r of [1.2, 2.1]) {
      start(88, 30 - r, z);
      lines.push(
        `G1 X106 F800`,
        `G3 X106 Y${n(30 + r)} I0 J${n(r)}`,
        "G1 X88",
        `G3 X88 Y${n(30 - r)} I0 J${n(-r)}`,
        "G0 Z5",
      );
    }
  }
  for (const [x, y] of [
    [8, 8],
    [112, 8],
    [8, 82],
    [112, 82],
  ]) {
    circle(x, y, 1.4, -1.2);
    for (const z of [-3, -6, -9, -12, -15, -18]) {
      start(x, y, z);
      lines.push("G0 Z5");
    }
  }

  lines.push(
    "(04 - Continuous ball-nose finishing of the tidal relief)",
    "T2 M6",
  );
  let row = 0;
  for (let y = cy - radius + 0.2; y < cy + radius; y += 0.35, row++) {
    const half = Math.sqrt(radius * radius - (y - cy) ** 2);
    const segments = Math.max(1, Math.ceil((half * 2) / 0.75));
    for (let i = 0; i <= segments; i++) {
      const x =
        cx - half + half * 2 * (row % 2 ? 1 - i / segments : i / segments);
      const z = relief(x, y);
      if (i === 0) start(x, y, z);
      else lines.push(`G1 ${move(x, y, z)} F950`);
    }
    lines.push("G0 Z5");
  }

  lines.push("(05 - Fine contour traces, dial, lettering and scale)", "T3 M6");
  for (const offset of [-13, 0, 12]) {
    let begun = false;
    for (let x = cx - 25; x <= cx + 25; x += 0.65) {
      const y = cy + offset + 3 * Math.sin((x - cx) / 10);
      if (Math.hypot(x - cx, y - cy) > radius - 3) continue;
      const z = relief(x, y) - 0.5;
      if (!begun) {
        start(x, y, z, 220);
        begun = true;
      } else lines.push(`G1 ${move(x, y, z)} F650`);
    }
    lines.push("G0 Z5");
  }
  circle(97, 57, 18.2, -0.65);
  for (let i = 0; i < 24; i++) {
    const a = (i * Math.PI) / 12,
      inner = i % 6 === 0 ? 15.1 : 16.3;
    start(97 + Math.cos(a) * inner, 57 + Math.sin(a) * inner, -1, 220);
    lines.push(
      `G1 X${n(97 + Math.cos(a) * 17.5)} Y${n(57 + Math.sin(a) * 17.5)} F650`,
      "G0 Z5",
    );
  }
  const letters: Record<string, number[][][]> = {
    F: [
      [
        [0, 0],
        [0, 7],
        [5, 7],
      ],
      [
        [0, 3.5],
        [4, 3.5],
      ],
    ],
    O: [
      [
        [1, 0],
        [0, 1],
        [0, 6],
        [1, 7],
        [4, 7],
        [5, 6],
        [5, 1],
        [4, 0],
        [1, 0],
      ],
    ],
    R: [
      [
        [0, 0],
        [0, 7],
        [4, 7],
        [5, 6],
        [5, 4.5],
        [4, 3.5],
        [0, 3.5],
      ],
      [
        [2.5, 3.5],
        [5, 0],
      ],
    ],
    M: [
      [
        [0, 0],
        [0, 7],
        [2.5, 3.5],
        [5, 7],
        [5, 0],
      ],
    ],
    A: [
      [
        [0, 0],
        [2.5, 7],
        [5, 0],
      ],
      [
        [1.1, 3],
        [3.9, 3],
      ],
    ],
  };
  [..."FORMA"].forEach((letter, i) => {
    for (const stroke of letters[letter]) {
      stroke.forEach(([x, y], j) => {
        if (!j) start(22 + i * 8 + x, 9 + y, -1.35, 220);
        else lines.push(`G1 X${n(22 + i * 8 + x)} Y${n(9 + y)} F650`);
      });
      lines.push("G0 Z5");
    }
  });
  for (let i = 0; i <= 12; i++) {
    start(83 + i * 2, 14, -0.8, 220);
    lines.push(`G1 Y${i % 3 === 0 ? 18 : 16} F650`, "G0 Z5");
  }
  lines.push("G0 Z10", "M5", "M30");
  cached = layeredPasses(lines).join("\n");
  return cached;
}
