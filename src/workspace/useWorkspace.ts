import { useMemo, useState } from "react";
import type { BottomSetup, Stock } from "../types";
import { DEFAULT_VIEW, type WorkspaceSnapshot } from "../workspaceStorage";
import { operationAt } from "../engine/sequence";
import { presetResolution } from "../engine/quality";
import type { GpuRuntime } from "../engine/gpu";
import { useSimulation } from "../useSimulation";
import { useAnalysis } from "../useAnalysis";
import { useWorkspaceProject } from "./useWorkspaceProject";
import { useWorkspaceView } from "./useWorkspaceView";
import { useWorkspaceFiles } from "./useWorkspaceFiles";
import { useWorkspacePlayback } from "./useWorkspacePlayback";
import { useWorkspaceAutosave } from "./useWorkspacePersistence";

/** Connect workspace state to the simulation without coupling panels to workers. */
export function useWorkspace(
  initial?: WorkspaceSnapshot,
  restoreError?: string,
) {
  // Refresh the retired built-in example, while preserving imported workspaces.
  const refreshDemo =
    initial?.project.demo && initial.project.filename === "desk-tray.nc";
  const projectState = useWorkspaceProject(
    refreshDemo ? undefined : initial?.project,
  );
  const display = useWorkspaceView(
    refreshDemo ? DEFAULT_VIEW : (initial?.view ?? DEFAULT_VIEW),
  );
  const { project } = projectState;
  const { code, stock, assignments, material, bottom, filename } = project;
  const autosaveError = useWorkspaceAutosave(
    project,
    display.persistedView,
    restoreError,
  );
  const files = useWorkspaceFiles(projectState, display);
  const [gpuRuntime, setGpuRuntime] = useState<GpuRuntime | null>();
  const simulation = useSimulation(
    code,
    stock,
    assignments,
    presetResolution(display.resolution, gpuRuntime?.maxResolution),
    display.fraction,
    gpuRuntime,
    bottom,
    display.threadsEnabled,
  );
  const { program, surface, error, busy } = simulation;
  const analysis = useAnalysis(
    program,
    stock,
    assignments,
    material,
    bottom?.flipAxis ?? "y",
  );
  const playback = useWorkspacePlayback(program, error, display);

  // Seeking updates an already visible surface in the background. Only show
  // loading feedback while importing or preparing a surface from scratch.
  const loadingTitle =
    files.importState?.title ??
    (busy && !surface && !error
      ? !program
        ? bottom
          ? "Reading TOP + BOTTOM toolpaths…"
          : "Reading TOP toolpath…"
        : gpuRuntime === undefined
          ? "Starting 3D environment…"
          : bottom
            ? "Preparing TOP + BOTTOM simulation…"
            : "Preparing simulation…"
      : "");
  const blockingLoad = !!files.importState || (busy && !surface && !error);
  const playbackDisabled = !!error || blockingLoad || !program;
  const toolNumbers = useMemo(
    () =>
      program
        ? [
            ...new Set([
              ...program.tools,
              ...program.toolChanges.map((change) => change.tool),
              ...Object.keys(assignments).map(Number),
            ]),
          ].sort((a, b) => a - b)
        : Object.keys(assignments).map(Number),
    [program, assignments],
  );
  const missing = (program?.tools ?? toolNumbers).filter(
    (n) => !assignments[n],
  );
  const warnings = [
    ...new Set([...(program?.warnings ?? []), ...(surface?.warnings ?? [])]),
  ];
  const activeOperation = program
    ? operationAt(program, display.fraction * playback.count)
    : undefined;
  const activeSide = activeOperation?.side ?? "top";
  const activeCode = activeSide === "bottom" && bottom ? bottom.code : code;
  const activeFilename =
    activeSide === "bottom" && bottom ? bottom.filename : filename;

  const updateStock = (next: Stock) => {
    display.setPlaying(false);
    projectState.setStock(next);
  };
  const updateStockDimension = (key: "x" | "y" | "z", value: number) => {
    display.setPlaying(false);
    projectState.setStock((current) => ({ ...current, [key]: value }));
  };
  const changeOrder = (firstSide: BottomSetup["firstSide"]) => {
    if (!bottom) return;
    display.setPlaying(false);
    display.setFraction(0);
    projectState.setBottom({ ...bottom, firstSide });
  };
  const changeFlipAxis = (flipAxis: BottomSetup["flipAxis"]) => {
    if (!bottom) return;
    display.setPlaying(false);
    projectState.setBottom({ ...bottom, flipAxis });
  };
  const seekAnalysisMove = (move: number) => {
    const op = program?.operations?.find(
      (item) => move >= item.start && move < item.end,
    );
    // At a setup boundary, stay on the flagged face instead of switching to
    // the next file before its first movement.
    playback.seek(
      (op && op.end < playback.count && move + 1 === op.end ? move : move + 1) /
        playback.count,
    );
    display.setShowPath(true);
    display.setShowTool(true);
  };

  return {
    projectState,
    display,
    files,
    simulation,
    analysis,
    playback,
    autosaveError,
    gpuRuntime,
    setGpuRuntime,
    loadingTitle,
    blockingLoad,
    playbackDisabled,
    toolNumbers,
    missing,
    warnings,
    activeOperation,
    activeSide,
    activeCode,
    activeFilename,
    updateStock,
    updateStockDimension,
    changeOrder,
    changeFlipAxis,
    seekAnalysisMove,
  };
}
