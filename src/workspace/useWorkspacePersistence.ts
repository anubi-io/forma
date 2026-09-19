import { useEffect, useLayoutEffect, useState } from "react";
import type {
  WorkspaceSnapshot,
  WorkspaceProject,
  WorkspaceView,
} from "../workspaceStorage";
import { workspaceStore } from "./workspaceStore";
export function useWorkspaceRestore() {
  const [loaded, setLoaded] = useState<{
    snapshot?: WorkspaceSnapshot;
    error?: string;
  }>();
  useEffect(() => {
    let active = true;
    workspaceStore.load().then(
      (snapshot) => {
        if (active) setLoaded({ snapshot });
      },
      () => {
        if (active)
          setLoaded({
            error:
              "Could not restore local workspace. Autosave is disabled for this session; use Save project to keep your work.",
          });
      },
    );
    return () => {
      active = false;
    };
  }, []);

  return loaded;
}
export function useWorkspaceAutosave(
  project: WorkspaceProject,
  persistedView: WorkspaceView,
  restoreError?: string,
) {
  const [autosaveError, setAutosaveError] = useState(restoreError ?? "");
  useLayoutEffect(() => {
    if (restoreError) return;
    let active = true;
    workspaceStore.save(project, persistedView).then(
      () => {
        if (active) setAutosaveError("");
      },
      () => {
        if (active)
          setAutosaveError(
            "Could not autosave locally. Use Save project before refreshing or closing this page.",
          );
      },
    );
    return () => {
      active = false;
    };
  }, [project, persistedView, restoreError]);

  return autosaveError;
}
