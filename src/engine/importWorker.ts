import { decodeNc } from "./decode";
import { importMakeraSetup } from "./makeraProject";
import { validProject, type WorkspaceProject } from "../workspaceStorage";
import { upgradeCatalogThreads } from "../data/upgradeTools";

export type ImportResult =
  | { type: "setup"; setup: ReturnType<typeof importMakeraSetup> }
  | { type: "project"; project: WorkspaceProject }
  | { type: "code"; code: string }
  | { type: "error"; message: string };

self.onmessage = ({
  data,
}: MessageEvent<{ bytes: Uint8Array; name: string }>) => {
  try {
    const name = data.name.toLowerCase();
    let result: ImportResult;
    if (name.endsWith(".mks")) {
      result = { type: "setup", setup: importMakeraSetup(data.bytes) };
    } else {
      const code = decodeNc(data.bytes);
      if (name.endsWith(".json")) {
        const project: unknown = JSON.parse(code);
        if (!validProject(project)) throw new Error("Invalid project file.");
        result = {
          type: "project",
          project: {
            ...project,
            assignments: upgradeCatalogThreads(project.assignments),
          },
        };
      } else {
        if (!code.trim() || code.includes("\u0000"))
          throw new Error("Select a non-empty G-code text file.");
        result = { type: "code", code };
      }
    }
    self.postMessage(result);
  } catch (error) {
    self.postMessage({
      type: "error",
      message:
        error instanceof Error ? error.message : "Unable to read the file.",
    } satisfies ImportResult);
  }
};
