import { describe, expect, it } from "vitest";
import { parseProgram } from "../src/engine/parse";
import {
  advancePlayback,
  playbackState,
  playbackTimes,
} from "../src/engine/playback";
import { sequenceProgram } from "../src/engine/sequence";
import { STRIDE } from "../src/types";

describe("machine-time playback", () => {
  const program = parseProgram("G1 X10 F60\nG1 X30 F120\nG0 X80");
  const times = playbackTimes(program);

  it("uses programmed feeds and rapid duration instead of segment count", () => {
    expect([...times]).toEqual([0, 10, 20, 21]);
    expect(advancePlayback(times, 0, 10, 1)).toBeCloseTo(1 / 3);
    expect(advancePlayback(times, 0, 20, 1)).toBeCloseTo(2 / 3);
    expect(advancePlayback(times, 0, 21, 1)).toBe(1);
  });

  it.each([1, 2, 5, 10])("scales elapsed time by %sx", (speed) => {
    expect(advancePlayback(times, 0, 10 / speed, speed)).toBeCloseTo(1 / 3);
    expect(advancePlayback(times, 0, 21 / speed, speed)).toBe(1);
  });

  it("preserves progress across ticks, seeks and speed changes", () => {
    const first = advancePlayback(times, 0, 2.7, 1);
    const next = advancePlayback(times, first, 3.3, 1);
    expect(next).toBeCloseTo(advancePlayback(times, 0, 6, 1));
    expect(advancePlayback(times, next, 2, 2)).toBeCloseTo(1 / 3);
    expect(advancePlayback(times, 0.5, 5, 1)).toBeCloseTo(2 / 3);
    expect(advancePlayback(times, 0, 100, 1)).toBe(1);
  });

  it("includes both operations in a two-sided program", () => {
    const combined = playbackTimes(sequenceProgram(program, program, "bottom"));
    expect(advancePlayback(combined, 0, 21, 1)).toBeCloseTo(0.5);
    expect(advancePlayback(combined, 0, 42, 1)).toBe(1);
  });
});

describe("tool-change scrubbing", () => {
  it("interpolates rapid and cutting motion without anticipating tool changes", () => {
    const program = parseProgram("T1 M6\nG0 X10 Y20 Z30\nT2 M6\nG1 X20 F60");
    expect(playbackState(program, 0.25)).toMatchObject({
      tool: 1,
      line: 2,
      position: [2.5, 5, 7.5],
    });
    expect(playbackState(program, 0.75)).toMatchObject({
      tool: 1,
      position: [7.5, 15, 22.5],
    });
    expect(playbackState(program, 1)).toMatchObject({
      tool: 2,
      position: [10, 20, 30],
    });
    expect(playbackState(program, 1.5)).toMatchObject({
      tool: 2,
      line: 4,
      position: [15, 20, 30],
    });
    expect(playbackState(program, 2)).toMatchObject({ position: [20, 20, 30] });
    expect(playbackState(program, 0.25).position).toEqual([2.5, 5, 7.5]);
  });

  it("interpolates within each setup without travelling between unrelated origins", () => {
    const top = parseProgram("T1 M6\nG1 X10 F60");
    const bottom = parseProgram("T2 M6\nG1 Y20 F60");
    const program = sequenceProgram(top, bottom, "top");
    expect(playbackState(program, 0.5).position).toEqual([5, 0, 0]);
    expect(playbackState(program, 1)).toMatchObject({
      tool: 2,
      position: [0, 0, 0],
    });
    expect(playbackState(program, 1.5)).toMatchObject({
      tool: 2,
      position: [0, 10, 0],
    });
  });
  it("switches at the M6 boundary before the next movement, including reverse seeks", () => {
    const program = parseProgram("T1 M6\nG0 Z5\nG1 X10\nT2 M6\nG1 X20");
    expect(playbackState(program, 2)).toMatchObject({
      tool: 2,
      line: 4,
      position: [10, 0, 5],
    });
    expect(playbackState(program, 3)).toMatchObject({ tool: 2, line: 5 });
    expect(playbackState(program, 1)).toMatchObject({ tool: 1, line: 2 });
    expect(playbackState(program, 0)).toMatchObject({
      tool: 1,
      line: 1,
      position: [0, 0, 0],
    });
  });

  it("preserves consecutive and final changes without fabricating motion", () => {
    const program = parseProgram(
      "T1 M6\nG1 X10\nT2 M6\nT3 M6\nG1 X20\nT4 M6\nM30",
    );
    expect(program.moves.length / STRIDE).toBe(2);
    expect(
      program.toolChanges.map((event) => [event.tool, event.moveIndex]),
    ).toEqual([
      [1, 0],
      [2, 1],
      [3, 1],
      [4, 2],
    ]);
    expect(playbackState(program, 1)).toMatchObject({
      tool: 3,
      line: 4,
      changeIndex: 2,
    });
    expect(playbackState(program, 2)).toMatchObject({
      tool: 4,
      line: 6,
      changeIndex: 3,
    });
  });

  it("keeps preselection separate from the active tool", () => {
    const program = parseProgram("T1 M6\nG1 X10\nT2\nG1 X20\nM6\nG1 X30");
    expect(playbackState(program, 1).tool).toBe(1);
    expect(playbackState(program, 2).tool).toBe(2);
    expect(program.toolChanges).toHaveLength(2);
  });
});
