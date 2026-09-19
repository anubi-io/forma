import { useMemo, useState } from "react";
import {
  demoCode,
  DEMO_STOCK,
  DEMO_MATERIAL,
  DEMO_FILENAME,
  DEMO_TOOLS,
} from "../data/demo";
import type { Assignments, Stock, BottomSetup } from "../types";
import type { WorkspaceProject } from "../workspaceStorage";
export function useWorkspaceProject(initialProject?: WorkspaceProject) {
  const [stock, setStock] = useState<Stock>(
    initialProject?.stock ?? DEMO_STOCK,
  );
  const [material, setMaterial] = useState(
    initialProject?.material ?? DEMO_MATERIAL,
  );
  const [code, setCode] = useState(() => initialProject?.code ?? demoCode());
  const [filename, setFilename] = useState(
    initialProject?.filename ?? DEMO_FILENAME,
  );
  const [demo, setDemo] = useState(initialProject?.demo ?? true);
  const [assignments, setAssignments] = useState<Assignments>(
    initialProject?.assignments ?? DEMO_TOOLS,
  );

  const [setupSource, setSetupSource] = useState(
    initialProject?.setupSource ?? "",
  );
  const [bottom, setBottom] = useState<BottomSetup | undefined>(
    initialProject?.bottom,
  );

  // The store uses object identity to avoid rewriting G-code on every seek.
  const project = useMemo<WorkspaceProject>(
    () => ({
      version: 1,
      code,
      filename,
      stock,
      material,
      assignments,
      demo,
      setupSource,
      bottom,
    }),
    [code, filename, stock, material, assignments, demo, setupSource, bottom],
  );

  return {
    project,
    setStock,
    setMaterial,
    setCode,
    setFilename,
    setDemo,
    setAssignments,
    setSetupSource,
    setBottom,
  };
}
export type WorkspaceProjectState = ReturnType<typeof useWorkspaceProject>;
