import { useEffect, useMemo } from "react";
import { STRIDE, type Program } from "../types";
import {
  advancePlayback,
  groupToolChanges,
  playbackState,
  playbackTimes,
} from "../engine/playback";
import type { WorkspaceViewState } from "./useWorkspaceView";
type Controls = Pick<
  WorkspaceViewState,
  "fraction" | "playing" | "speed" | "setFraction" | "setPlaying" | "setSpeed"
>;
export function useWorkspacePlayback(
  program: Program | undefined,
  error: string,
  controls: Controls,
) {
  const { fraction, playing, speed, setFraction, setPlaying } = controls;
  const toolChangeGroups = useMemo(
    () => groupToolChanges(program?.toolChanges ?? []),
    [program],
  );

  const count = program ? program.moves.length / STRIDE : 0;
  const cursor = program ? playbackState(program, fraction * count) : undefined;
  const currentLine = cursor?.line ?? 0;
  const seek = (next: number) => {
    setPlaying(false);
    setFraction(Math.max(0, Math.min(1, next)));
  };

  useEffect(() => {
    if (error) setPlaying(false);
  }, [error, setPlaying]);
  const motionTimes = useMemo(
    () => (program ? playbackTimes(program) : null),
    [program],
  );
  useEffect(() => {
    if (!playing || !motionTimes) return;
    let previous = performance.now();
    let frame = 0;
    const tick = () => {
      const now = performance.now();
      const elapsedSeconds = (now - previous) / 1000;
      previous = now;
      setFraction((v) => {
        const next = advancePlayback(motionTimes, v, elapsedSeconds, speed);
        if (next === 1) setPlaying(false);
        return next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, motionTimes, setFraction, setPlaying]);

  return {
    fraction,
    playing,
    speed,
    setFraction,
    setPlaying,
    setSpeed: controls.setSpeed,
    count,
    cursor,
    currentLine,
    toolChangeGroups,
    seek,
  };
}
export type WorkspacePlayback = ReturnType<typeof useWorkspacePlayback>;
