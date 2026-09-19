import {
  Cylinder,
  FileCode,
  SidebarSimple,
  Stack,
} from "@phosphor-icons/react";
import type { GpuRuntime } from "../../engine/gpu";
import type { MachiningSide, Surface } from "../../types";
import {
  SIMULATION_QUALITIES,
  MAX_THREAD_QUALITY,
  presetResolution,
} from "../../engine/quality";
import type { WorkspaceViewState } from "../useWorkspaceView";
import Tip from "../../components/Tip";
import { fmt } from "../format";
interface Props {
  display: Pick<
    WorkspaceViewState,
    | "setupVisible"
    | "setSetupVisible"
    | "showPath"
    | "setShowPath"
    | "showTool"
    | "setShowTool"
    | "resolution"
    | "setResolution"
    | "threadsEnabled"
    | "setThreadsEnabled"
    | "setPlaying"
  >;
  activeSide: MachiningSide;
  activeFilename: string;
  demo: boolean;
  gpuRuntime?: GpuRuntime | null;
  surface?: Surface;
}
export default function ViewerToolbar({
  display,
  activeSide,
  activeFilename,
  demo,
  gpuRuntime,
  surface,
}: Props) {
  const {
    setupVisible,
    setSetupVisible,
    showPath,
    setShowPath,
    showTool,
    setShowTool,
    resolution,
    setResolution,
    threadsEnabled,
    setThreadsEnabled,
    setPlaying,
  } = display;
  return (
    <div className="viewer-toolbar">
      <button
        className="icon-button setup-toggle"
        aria-label={setupVisible ? "Hide setup panel" : "Show setup panel"}
        title={setupVisible ? "Hide setup panel" : "Show setup panel"}
        aria-expanded={setupVisible}
        aria-controls="machining-setup"
        onClick={() => setSetupVisible(!setupVisible)}
      >
        <SidebarSimple size={18} />
      </button>
      <div className="file-label">
        <FileCode size={17} />
        <span className={`side-badge ${activeSide}`}>
          {activeSide.toUpperCase()}
        </span>
        <span>{activeFilename}</span>
        {demo && <span className="badge">Demo</span>}
      </div>
      <div className="viewer-toolbar-actions">
        <button
          className={`text-toggle ${showPath ? "on" : ""}`}
          aria-label="Show toolpath"
          onClick={() => setShowPath(!showPath)}
          aria-pressed={showPath}
        >
          <Stack size={15} />
          <span>Toolpath</span>
        </button>
        <button
          className={`text-toggle ${showTool ? "on" : ""}`}
          aria-label="Show cutter"
          onClick={() => setShowTool(!showTool)}
          aria-pressed={showTool}
        >
          <Cylinder size={15} />
          <span>Cutter</span>
        </button>
        <span className="toolbar-divider" />
        <Tip
          label={`${gpuRuntime ? "WebGPU" : "CPU"} · ${fmt(surface ? Math.max(surface.nx, surface.ny) : presetResolution(resolution, gpuRuntime?.maxResolution), 0)} cells on the longest axis. ${gpuRuntime ? "Quality adapts automatically for complex programs." : "Higher quality resolves finer details."}`}
        >
          <select
            aria-label="Simulation quality"
            value={resolution}
            onChange={(e) => {
              setPlaying(false);
              setResolution(+e.target.value);
            }}
          >
            {SIMULATION_QUALITIES.map(({ value, label }) => (
              <option
                key={value}
                value={value}
                disabled={threadsEnabled && value > MAX_THREAD_QUALITY}
                title={`${fmt(presetResolution(value, gpuRuntime?.maxResolution), 0)} cells`}
              >
                {label}
              </option>
            ))}
          </select>
        </Tip>
        <Tip
          label={
            gpuRuntime
              ? "Model threads in the workpiece. Limits quality to Detailed; off at startup."
              : "Thread modeling requires WebGPU."
          }
        >
          <button
            className={`text-toggle ${threadsEnabled ? "on" : ""}`}
            aria-label="Model threads"
            aria-pressed={threadsEnabled}
            disabled={!gpuRuntime}
            onClick={() => {
              setPlaying(false);
              if (!threadsEnabled)
                setResolution((value) => Math.min(value, MAX_THREAD_QUALITY));
              setThreadsEnabled(!threadsEnabled);
            }}
          >
            Threads
          </button>
        </Tip>
      </div>
    </div>
  );
}
