import { STRIDE, type Program } from "../types";

/** NC rounding creates zero-XY / 0.01 mm Z steps inside gentle ramps. Evaluate
 * direction and axial speed over a cutter-sized neighbourhood, not that step.
 * Deliberate plunges and retracts form boundaries and retain their own feed. */
export function entryMotion(
  program: Program,
  segment: number,
  diameter: number,
  start: number,
  end: number,
) {
  const m = program.moves,
    i = segment * STRIDE;
  const noise = Math.max(0.03, diameter * 0.02);
  const localXY = Math.hypot(m[i + 3] - m[i], m[i + 4] - m[i + 1]);
  const localDrop = m[i + 2] - m[i + 5];
  if (localXY < 1e-6 && localDrop > noise)
    return {
      angle: 90,
      axialFeed: (localDrop / m[i + 9]) * 60,
      drop: localDrop,
      first: segment,
      last: segment,
      travel: 0,
    };
  let first = segment,
    last = segment;
  let travel = localXY,
    seconds = m[i + 9];
  const reach = diameter / 2;
  for (const direction of [-1, 1]) {
    let span = localXY / 2;
    for (
      let next = segment + direction;
      next >= start && next < end && span < reach;
      next += direction
    ) {
      const j = next * STRIDE;
      const xy = Math.hypot(m[j + 3] - m[j], m[j + 4] - m[j + 1]);
      const dz = m[j + 5] - m[j + 2];
      if (
        m[j + 7] ||
        m[j + 6] !== m[i + 6] ||
        dz > noise ||
        (xy < 1e-6 && Math.abs(dz) > noise)
      )
        break;
      span += Math.hypot(xy, dz);
      travel += xy;
      seconds += m[j + 9];
      if (direction < 0) first = next;
      else last = next;
    }
  }
  const drop = Math.max(0, m[first * STRIDE + 2] - m[last * STRIDE + 5]);
  return {
    angle: (Math.atan2(drop, travel) * 180) / Math.PI,
    axialFeed: seconds > 0 ? (drop / seconds) * 60 : 0,
    drop,
    first,
    last,
    travel,
  };
}
