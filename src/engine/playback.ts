import { STRIDE, type Program } from "../types";
import { operationAt, operationProgram } from "./sequence";

/** Cumulative machine-motion seconds at each segment boundary. */
export function playbackTimes(program: Program): Float64Array {
  const count = program.moves.length / STRIDE;
  const times = new Float64Array(count + 1);
  for (let i = 0; i < count; i++)
    times[i + 1] = times[i] + program.moves[i * STRIDE + 9];
  return times;
}

/** Advance a segment-based seek position using actual elapsed wall time. */
export function advancePlayback(
  times: Float64Array,
  fraction: number,
  elapsedSeconds: number,
  speed: number,
): number {
  const count = times.length - 1;
  if (!count || fraction >= 1) return 1;
  const position = Math.max(0, fraction) * count;
  const index = Math.min(count - 1, Math.floor(position));
  const seconds =
    times[index] +
    (times[index + 1] - times[index]) * (position - index) +
    Math.max(0, elapsedSeconds) * speed;
  if (seconds >= times[count]) return 1;
  let low = 0,
    high = count;
  while (low + 1 < high) {
    const mid = (low + high) >>> 1;
    if (times[mid] <= seconds) low = mid;
    else high = mid;
  }
  return (low + (seconds - times[low]) / (times[low + 1] - times[low])) / count;
}

export function groupToolChanges(changes: Program["toolChanges"]) {
  const groups: {
    moveIndex: number;
    lastIndex: number;
    changes: Program["toolChanges"];
  }[] = [];
  changes.forEach((change, index) => {
    const last = groups.at(-1);
    if (last?.moveIndex === change.moveIndex) {
      last.changes.push(change);
      last.lastIndex = index;
    } else
      groups.push({
        moveIndex: change.moveIndex,
        lastIndex: index,
        changes: [change],
      });
  });
  return groups;
}

/** Fractional segment positions interpolate motion; integer boundaries retain tool changes. */
export function playbackState(
  program: Program,
  processed: number,
): { tool: number; line: number; changeIndex: number; position: number[] } {
  const op = operationAt(program, processed);
  if (op) {
    const state = playbackState(
      operationProgram(program, op),
      processed - op.start,
    );
    return {
      ...state,
      changeIndex: state.changeIndex + op.toolChangeStart,
    };
  }
  const count = program.moves.length / STRIDE;
  const progress = Math.max(0, Math.min(count, processed));
  const completed = Math.floor(progress);
  const part = progress - completed;
  const move = Math.max(0, completed - 1) * STRIDE;
  const changes = program.toolChanges;
  let low = 0,
    high = changes.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (changes[mid].moveIndex <= completed) low = mid + 1;
    else high = mid;
  }
  const change = changes[low - 1];
  return {
    tool: change?.tool ?? program.moves[move + 6] ?? 0,
    line:
      part > 0
        ? program.moves[completed * STRIDE + 8]
        : Math.max(completed ? program.moves[move + 8] : 0, change?.line ?? 0),
    changeIndex: low - 1,
    position:
      part > 0
        ? [0, 1, 2].map((axis) => {
            const start = program.moves[completed * STRIDE + axis];
            return (
              start +
              (program.moves[completed * STRIDE + axis + 3] - start) * part
            );
          })
        : completed
          ? [
              program.moves[move + 3],
              program.moves[move + 4],
              program.moves[move + 5],
            ]
          : [program.moves[0], program.moves[1], program.moves[2]],
  };
}
