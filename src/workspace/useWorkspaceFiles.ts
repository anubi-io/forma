import { useRef, useState } from "react";
import {
  demoCode,
  DEMO_STOCK,
  DEMO_MATERIAL,
  DEMO_FILENAME,
  DEMO_TOOLS,
} from "../data/demo";
import { DEFAULT_QUALITY } from "../engine/quality";
import { readImport } from "../engine/importFile";
import { download } from "./download";
import type { WorkspaceProjectState } from "./useWorkspaceProject";
import type { WorkspaceViewState } from "./useWorkspaceView";
export interface ImportState {
  kind: "top" | "bottom" | "mks" | "project";
  title: string;
  filename: string;
}
type ViewActions = Pick<
  WorkspaceViewState,
  | "setPlaying"
  | "setFraction"
  | "setResolution"
  | "changeView"
  | "setTab"
  | "setSetupVisible"
>;
export function useWorkspaceFiles(
  projectState: WorkspaceProjectState,
  viewActions: ViewActions,
) {
  const {
    project,
    setCode,
    setBottom,
    setStock,
    setMaterial,
    setAssignments,
    setFilename,
    setDemo,
    setSetupSource,
  } = projectState;
  const {
    code,
    bottom,
    stock,
    material,
    assignments,
    filename,
    demo,
    setupSource,
  } = project;
  const {
    setPlaying,
    setFraction,
    setResolution,
    changeView,
    setTab,
    setSetupVisible,
  } = viewActions;
  const [setupPrompt, setSetupPrompt] = useState(false);
  const [showSetupNotice, setShowSetupNotice] = useState(false);
  const [fileError, setFileError] = useState("");
  const [saved, setSaved] = useState(false);
  const [importState, setImportState] = useState<ImportState | null>(null);
  const importRevision = useRef(0);
  const cancelImport = () => {
    importRevision.current++;
    setImportState(null);
  };
  const closeSetup = () => {
    cancelImport();
    setSetupPrompt(false);
    setFileError("");
  };

  const loadDemo = () => {
    cancelImport();
    setCode(demoCode());
    setBottom(undefined);
    setStock(DEMO_STOCK);
    setMaterial(DEMO_MATERIAL);
    setAssignments(DEMO_TOOLS);
    setFilename(DEMO_FILENAME);
    setResolution(DEFAULT_QUALITY);
    changeView("iso");
    setDemo(true);
    setFraction(1);
    setPlaying(false);
    setFileError("");
    setSetupSource("");
    setSetupPrompt(false);
  };
  async function importFile(file?: File) {
    if (!file) return;
    const revision = ++importRevision.current;
    setImportState(null);
    setFileError("");
    setPlaying(false);
    const limit = file.name.toLowerCase().endsWith(".json") ? 55 : 25;
    if (file.size > limit * 1024 * 1024) {
      setFileError(
        `The file limit is ${limit} MB. Split the program into smaller operations.`,
      );
      return;
    }
    const kind = file.name.toLowerCase().endsWith(".mks")
      ? "mks"
      : file.name.toLowerCase().endsWith(".json")
        ? "project"
        : "top";
    setImportState({
      kind,
      title:
        kind === "mks"
          ? "Reading Makera Studio project…"
          : kind === "project"
            ? "Reading saved project…"
            : "Reading TOP G-code…",
      filename: file.name,
    });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (revision !== importRevision.current) return;
      if (kind === "mks" && (demo || !code.trim()))
        throw new Error(
          "Import the G-code first, then add its Makera Studio project.",
        );
      setImportState({
        kind,
        title:
          kind === "mks"
            ? "Importing stock and tools…"
            : kind === "project"
              ? "Restoring project setup…"
              : "Decoding TOP G-code…",
        filename: file.name,
      });
      const result = await readImport(bytes, file.name);
      if (revision !== importRevision.current) return;
      if (result.type === "setup") {
        const setup = result.setup;
        setAssignments(setup.assignments);
        setStock((current) => ({ ...current, ...setup.dimensions }));
        if (setup.material) setMaterial(setup.material);
        setSetupSource(file.name);
        setShowSetupNotice(true);
        setSetupPrompt(false);
        setTab("stock");
        setSetupVisible(true);
        changeView("iso");
        setFraction(1);
        return;
      }
      if (result.type === "project") {
        const p = result.project;
        setCode(p.code);
        setBottom(p.bottom);
        setStock(p.stock);
        setMaterial(p.material);
        setAssignments(p.assignments);
        setSetupSource(p.setupSource ?? "");
        setShowSetupNotice(false);
        setSetupPrompt(false);
        setFilename(typeof p.filename === "string" ? p.filename : "project.nc");
      } else {
        setCode(result.code);
        setBottom(undefined);
        setFilename(file.name);
        setAssignments({});
        setSetupPrompt(true);
        setSetupSource("");
        setTab("tools");
        setSetupVisible(true);
      }
      setDemo(false);
      setFraction(1);
    } catch (e) {
      if (revision === importRevision.current)
        setFileError(
          e instanceof Error ? e.message : "Unable to read the file.",
        );
    } finally {
      if (revision === importRevision.current) setImportState(null);
    }
  }
  async function importBottom(file?: File) {
    if (!file) return;
    const revision = ++importRevision.current;
    setPlaying(false);
    setFileError("");
    setImportState({
      kind: "bottom",
      title: "Reading BOTTOM G-code…",
      filename: file.name,
    });
    try {
      if (file.size > 25 * 1024 * 1024)
        throw new Error("The file limit is 25 MB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (revision !== importRevision.current) return;
      setImportState({
        kind: "bottom",
        title: "Decoding BOTTOM G-code…",
        filename: file.name,
      });
      const result = await readImport(bytes, "bottom.nc");
      if (revision !== importRevision.current) return;
      if (result.type !== "code") throw new Error("Select a G-code text file.");
      setBottom((current) => ({
        code: result.code,
        filename: file.name,
        flipAxis: current?.flipAxis ?? "y",
        firstSide: current?.firstSide ?? "top",
      }));
      setFraction(0);
      setSetupVisible(true);
      setDemo(false);
    } catch (error) {
      if (revision === importRevision.current)
        setFileError(
          error instanceof Error ? error.message : "Unable to read the file.",
        );
    } finally {
      if (revision === importRevision.current) setImportState(null);
    }
  }
  const save = () => {
    download(
      `${filename.replace(/\.[^.]+$/, "")}.forma.json`,
      JSON.stringify(
        {
          version: 1,
          filename,
          stock,
          material,
          assignments,
          code,
          setupSource,
          bottom,
        },
        null,
        2,
      ),
    );
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  };

  const removeBottom = () => {
    cancelImport();
    setPlaying(false);
    setBottom(undefined);
    setFraction(0);
  };
  return {
    importState,
    fileError,
    setFileError,
    saved,
    setupPrompt,
    setSetupPrompt,
    showSetupNotice,
    setShowSetupNotice,
    closeSetup,
    loadDemo,
    importFile,
    importBottom,
    removeBottom,
    save,
  };
}
