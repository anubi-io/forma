import { useMemo, useState } from "react";
import type { WorkspaceView, CameraPose } from "../workspaceStorage";
export function useWorkspaceView(initialView: WorkspaceView) {
  const [tab, setTab] = useState(initialView.tab);
  const [setupVisible, setSetupVisible] = useState(initialView.setupVisible);
  const [resolution, setResolution] = useState(initialView.resolution);
  const [fraction, setFraction] = useState(initialView.fraction);
  const [speed, setSpeed] = useState(initialView.speed);
  const [showPath, setShowPath] = useState(initialView.showPath);
  const [showTool, setShowTool] = useState(initialView.showTool);
  const [view, setView] = useState({ mode: initialView.mode, id: 0 });
  const [cameraPose, setCameraPose] = useState<CameraPose | undefined>(
    initialView.camera,
  );
  // These flags deliberately start disabled, even when restoring a workspace.
  const [threadsEnabled, setThreadsEnabled] = useState(false);
  const [playing, setPlaying] = useState(false);

  const persistedView = useMemo(
    () => ({
      tab,
      setupVisible,
      resolution,
      fraction,
      speed,
      showPath,
      showTool,
      mode: view.mode,
      camera: cameraPose,
    }),
    [
      tab,
      setupVisible,
      resolution,
      fraction,
      speed,
      showPath,
      showTool,
      view.mode,
      cameraPose,
    ],
  );

  const changeView = (mode: string) => {
    setCameraPose(undefined);
    setView((v) => ({ mode, id: v.id + 1 }));
  };

  return {
    tab,
    setTab,
    setupVisible,
    setSetupVisible,
    resolution,
    setResolution,
    threadsEnabled,
    setThreadsEnabled,
    fraction,
    setFraction,
    playing,
    setPlaying,
    speed,
    setSpeed,
    showPath,
    setShowPath,
    showTool,
    setShowTool,
    view,
    changeView,
    cameraPose,
    setCameraPose,
    persistedView,
  };
}
export type WorkspaceViewState = ReturnType<typeof useWorkspaceView>;
