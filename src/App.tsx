import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  ArrowCounterClockwise,
  ArrowDown,
  ArrowSquareOut,
  ArrowsOut,
  CaretRight,
  Check,
  CircleNotch,
  Cube,
  Cylinder,
  DownloadSimple,
  FileCode,
  Info,
  Stack,
  SidebarSimple,
  Pause,
  Play,
  Plus,
  Ruler,
  SkipBack,
  SkipForward,
  UploadSimple,
  Warning,
  X,
} from "@phosphor-icons/react";
import catalog from "./data/makera.json";
import { MATERIALS } from "./data/materials";
import {
  demoCode,
  DEMO_FILENAME,
  DEMO_MATERIAL,
  DEMO_STOCK,
  DEMO_TOOLS,
} from "./data/demo";
import {
  STRIDE,
  type Assignments,
  type Stock,
  type Tool,
  type BottomSetup,
} from "./types";
import { operationAt } from "./engine/sequence";
import { useSimulation } from "./useSimulation";
import { useAnalysis } from "./useAnalysis";
import OptimizationPanel from "./components/OptimizationPanel";
import type { GpuRuntime } from "./engine/gpu";
import ToolLibrary from "./components/ToolLibrary";
import PlaybackTimeline from "./components/PlaybackTimeline";
import {
  advancePlayback,
  groupToolChanges,
  playbackState,
  playbackTimes,
} from "./engine/playback";
import { readImport } from "./engine/importFile";
import okokokLogo from "./assets/okokok-logo.svg";
import {
  SIMULATION_QUALITIES,
  DEFAULT_QUALITY,
  MAX_THREAD_QUALITY,
  presetResolution,
} from "./engine/quality";
import {
  createWorkspaceStore,
  DEFAULT_VIEW,
  type WorkspaceSnapshot,
  type WorkspaceProject,
  type CameraPose,
} from "./workspaceStorage";
const workspaceStore = createWorkspaceStore();
const Viewport = lazy(() => import("./scene/Viewport"));
const LIBRARY = catalog.tools as Tool[];
const DEFAULT_TOOLS = DEMO_TOOLS;
const kindNames = {
  flat: "Flat end mill",
  ball: "Ball nose",
  v: "V-bit",
  unsupported: "Special profile",
  thread: "Thread mill",
};
const fmt = (n: number, d = 1) =>
  n.toLocaleString("en-US", { maximumFractionDigits: d });
const time = (n: number) =>
  `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
function LoadingStatus({ title, detail }: { title: string; detail?: string }) {
  return (
    <div
      className="loading-status"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <CircleNotch className="spin" size={22} aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        {detail && <small>{detail}</small>}
      </div>
    </div>
  );
}
function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" sideOffset={6}>
          {label}
          <Tooltip.Arrow />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
function IconButton({
  label,
  children,
  onClick,
  active = false,
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <Tip label={label}>
      <button
        className={`icon-button ${active ? "active" : ""}`}
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        disabled={disabled}
      >
        {children}
      </button>
    </Tip>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "modal wide" : "modal"}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function NumberField({
  label,
  value,
  onChange,
  min = 0.1,
  max = 2000,
  step = 0.1,
  unit = "mm",
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const valid =
    Number.isFinite(Number(draft)) &&
    Number(draft) >= min &&
    Number(draft) <= max &&
    draft.trim() !== "";
  return (
    <label className="number-field">
      <span>{label}</span>
      <div>
        <input
          type="number"
          value={draft}
          min={min}
          max={max}
          step={step}
          aria-invalid={!valid}
          onChange={(e) => {
            setDraft(e.target.value);
            const n = Number(e.target.value);
            if (
              e.target.value !== "" &&
              Number.isFinite(n) &&
              n >= min &&
              n <= max
            )
              onChange(n);
          }}
          onBlur={() => {
            if (!valid) setDraft(String(value));
          }}
        />
        <span>{unit}</span>
      </div>
    </label>
  );
}
function download(name: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
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
  if (!loaded)
    return (
      <div className="workspace-loading">
        <LoadingStatus
          title="Restoring workspace…"
          detail="Loading your saved project and view settings."
        />
      </div>
    );
  return <Workspace initial={loaded.snapshot} restoreError={loaded.error} />;
}

function Workspace({
  initial,
  restoreError,
}: {
  initial?: WorkspaceSnapshot;
  restoreError?: string;
}) {
  // Refresh the retired built-in example, while preserving imported workspaces.
  const refreshDemo =
    initial?.project.demo && initial.project.filename === "desk-tray.nc";
  const initialProject = refreshDemo ? undefined : initial?.project;
  const initialView = refreshDemo
    ? DEFAULT_VIEW
    : (initial?.view ?? DEFAULT_VIEW);
  const [stock, setStock] = useState<Stock>(
      initialProject?.stock ?? DEMO_STOCK,
    ),
    [material, setMaterial] = useState(
      initialProject?.material ?? DEMO_MATERIAL,
    ),
    [code, setCode] = useState(() => initialProject?.code ?? demoCode()),
    [filename, setFilename] = useState(
      initialProject?.filename ?? DEMO_FILENAME,
    ),
    [demo, setDemo] = useState(initialProject?.demo ?? true),
    [assignments, setAssignments] = useState<Assignments>(
      initialProject?.assignments ?? DEFAULT_TOOLS,
    );
  const [tab, setTab] = useState(initialView.tab),
    [setupVisible, setSetupVisible] = useState(initialView.setupVisible),
    [resolution, setResolution] = useState(initialView.resolution),
    [threadsEnabled, setThreadsEnabled] = useState(false),
    [fraction, setFraction] = useState(initialView.fraction),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(initialView.speed),
    [showPath, setShowPath] = useState(initialView.showPath),
    [showTool, setShowTool] = useState(initialView.showTool),
    [view, setView] = useState({ mode: initialView.mode, id: 0 }),
    [cameraPose, setCameraPose] = useState<CameraPose | undefined>(
      initialView.camera,
    );
  const [autosaveError, setAutosaveError] = useState(restoreError ?? "");
  const [setupSource, setSetupSource] = useState(
    initialProject?.setupSource ?? "",
  );
  const [showSetupNotice, setShowSetupNotice] = useState(false);
  const [bottom, setBottom] = useState<BottomSetup | undefined>(
    initialProject?.bottom,
  );
  const bottomInput = useRef<HTMLInputElement>(null);
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
  const [setupPrompt, setSetupPrompt] = useState(false);
  const mksInput = useRef<HTMLInputElement>(null);
  const closeSetup = () => {
    importRevision.current++;
    setImportState(null);
    setSetupPrompt(false);
    setFileError("");
  };
  const [toolModal, setToolModal] = useState<number | null>(null),
    [help, setHelp] = useState(false),
    [diagnostics, setDiagnostics] = useState(false),
    [fileError, setFileError] = useState(""),
    [drag, setDrag] = useState(false),
    [saved, setSaved] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null),
    viewer = useRef<HTMLDivElement>(null),
    importRevision = useRef(0);
  const [importState, setImportState] = useState<{
    kind: "top" | "bottom" | "mks" | "project";
    title: string;
    filename: string;
  } | null>(null);
  const [gpuRuntime, setGpuRuntime] = useState<GpuRuntime | null>();
  const { program, surface, error, busy } = useSimulation(
    code,
    stock,
    assignments,
    presetResolution(resolution, gpuRuntime?.maxResolution),
    fraction,
    gpuRuntime,
    bottom,
    threadsEnabled,
  );
  // Seeking updates an already visible surface in the background. Only show
  // loading feedback while importing or preparing a surface from scratch.
  const loadingTitle =
    importState?.title ??
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
  const analysis = useAnalysis(
    program,
    stock,
    assignments,
    material,
    bottom?.flipAxis ?? "y",
  );
  const blockingLoad = !!importState || (busy && !surface && !error);
  const playbackDisabled = !!error || blockingLoad || !program;
  const materialInfo = MATERIALS.find((m) => m.id === material) ?? MATERIALS[0];
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
  const toolChangeGroups = useMemo(
    () => groupToolChanges(program?.toolChanges ?? []),
    [program],
  );
  const warnings = [
    ...new Set([...(program?.warnings ?? []), ...(surface?.warnings ?? [])]),
  ];
  const count = program ? program.moves.length / STRIDE : 0,
    actual = surface?.count ? surface.processed / surface.count : 0;
  const cursor = program
    ? playbackState(program, fraction * count)
    : undefined;
  const currentLine = cursor?.line ?? 0;
  const activeOperation = program
    ? operationAt(program, fraction * count)
    : undefined;
  const activeSide = activeOperation?.side ?? "top";
  const activeCode = activeSide === "bottom" && bottom ? bottom.code : code;
  const activeFilename =
    activeSide === "bottom" && bottom ? bottom.filename : filename;
  const activeTool = cursor ? assignments[cursor.tool] : undefined;
  const seek = (next: number) => {
    setPlaying(false);
    setFraction(Math.max(0, Math.min(1, next)));
  };
  const missing = (program?.tools ?? toolNumbers).filter(
    (n) => !assignments[n],
  );
  useEffect(() => {
    if (error) setPlaying(false);
  }, [error]);
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
  }, [playing, speed, motionTimes]);
  const changeView = (mode: string) => {
    setCameraPose(undefined);
    setView((v) => ({ mode, id: v.id + 1 }));
  };
  const updateStock = (key: keyof Stock, value: number | string) => {
    setPlaying(false);
    setStock((s) => ({ ...s, [key]: value }));
  };
  const loadDemo = () => {
    importRevision.current++;
    setImportState(null);
    setCode(demoCode());
    setBottom(undefined);
    setStock(DEMO_STOCK);
    setMaterial(DEMO_MATERIAL);
    setAssignments(DEFAULT_TOOLS);
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
  return (
    <Tooltip.Provider delayDuration={250}>
      <div
        className="app"
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node))
            setDrag(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void importFile(e.dataTransfer.files[0]);
        }}
      >
        <header className="app-header">
          <a className="brand" href="/" aria-label="Forma home">
            <img
              className="brand-logo"
              src="/logo.svg"
              width="32"
              height="32"
              alt=""
            />
            <span>
              forma<span className="brand-period">.</span>
            </span>
          </a>
          <span className="header-divider">/</span>
          <div className="header-project header-attribution">
            <span>Community tool by</span>
            <a
              className="attribution-link okokok-link"
              href="https://okokok.design/"
              target="_blank"
              rel="noreferrer"
              aria-label="OKOKOK design"
            >
              <img className="okokok-logo" src={okokokLogo} alt="" />
            </a>
            <span className="attribution-separator" aria-hidden="true">
              -
            </span>
            <span>an</span>
            <a
              className="attribution-link anubi-link"
              href="https://anubi.io/"
              target="_blank"
              rel="noreferrer"
            >
              Anubi.io
            </a>
            <span>brand</span>
          </div>
          <div className="header-actions">
            <span className="local-label">
              <span />
              Everything stays on your device
            </span>
            <button className="button ghost" onClick={() => setHelp(true)}>
              <Info size={16} />
              Help
            </button>
            <button className="button" onClick={save}>
              {saved ? <Check size={15} /> : <DownloadSimple size={15} />}
              <span>{saved ? "Project saved" : "Save project"}</span>
            </button>
          </div>
        </header>
        {autosaveError && (
          <div className="autosave-warning" role="alert">
            <Warning size={16} />
            {autosaveError}
          </div>
        )}
        <div className="project-bar">
          <div>
            <div className="project-eyebrow">
              LOCAL WORKSPACE <CaretRight size={11} /> PROJECT{" "}
              {demo ? "DEMO" : "IMPORTED"}
            </div>
            <h1>
              Machining workspace<span>.</span>
            </h1>
          </div>
          <div className="operation-import-actions">
            <button
              className="button primary"
              onClick={() => fileInput.current?.click()}
              disabled={!!importState}
            >
              {importState?.kind === "top" ||
              importState?.kind === "project" ? (
                <CircleNotch className="spin" size={16} />
              ) : (
                <Plus size={16} />
              )}
              {importState?.kind === "top" || importState?.kind === "project"
                ? "Importing…"
                : "Import TOP / project"}
            </button>
          </div>
        </div>
        <input
          ref={bottomInput}
          type="file"
          className="sr-only"
          aria-label="Upload BOTTOM G-code"
          accept=".nc,.gcode,.gco,.tap,.txt,.cnc,.ngc,.gc,.ncc"
          onChange={(e) => {
            void importBottom(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <input
          ref={fileInput}
          type="file"
          className="sr-only"
          aria-label="Upload G-code or project"
          accept=".nc,.gcode,.gco,.tap,.txt,.cnc,.ngc,.gc,.ncc,.json"
          onChange={(e) => {
            void importFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <input
          ref={mksInput}
          type="file"
          className="sr-only"
          aria-label="Upload matching Makera Studio project"
          accept=".mks"
          onChange={(e) => {
            void importFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {setupSource && showSetupNotice && (
          <div className="setup-import-status" role="status">
            <Check size={16} />
            <span>
              Stock and tools imported from <strong>{setupSource}</strong> ·{" "}
              {stock.x} × {stock.y} × {stock.z} mm. XY and Z origins kept: check
              them in Stock.
            </span>
            <button
              className="icon-button"
              aria-label="Dismiss import notice"
              onClick={() => setShowSetupNotice(false)}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {setupPrompt && (
          <Modal title="Set up this G-code" onClose={closeSetup}>
            <div className="help-content">
              <h3>{filename}</h3>
              <p>
                Have the matching Makera Studio project? Import its .mks to set
                stock dimensions and assign tools automatically.
              </p>
              <p>
                Choose the project used to export this G-code. Your current XY
                and Z origins will be kept; review them in Stock after
                importing.
              </p>
              {fileError && (
                <p className="diagnostic-error" role="alert">
                  {fileError}
                </p>
              )}
              {importState && (
                <LoadingStatus
                  title={importState.title}
                  detail={importState.filename}
                />
              )}
            </div>
            <div className="modal-foot">
              <button
                className="button"
                onClick={() => {
                  closeSetup();
                  setTab("stock");
                  setSetupVisible(true);
                }}
              >
                Set up manually
              </button>
              <button
                className="button primary"
                onClick={() => mksInput.current?.click()}
                disabled={!!importState}
              >
                {importState?.kind === "mks" ? (
                  <CircleNotch className="spin" size={16} />
                ) : (
                  <UploadSimple size={16} />
                )}
                {importState?.kind === "mks"
                  ? "Importing .mks…"
                  : "Import matching .mks"}
              </button>
            </div>
          </Modal>
        )}
        <main className={`workspace ${setupVisible ? "" : "setup-hidden"}`}>
          <aside className="sidebar" id="machining-setup">
            <div className="sidebar-title">
              <h2>Machining setup</h2>
              <span className="badge">3 axes</span>
            </div>
            <div
              className="sidebar-tabs"
              role="tablist"
              aria-label="Configuration"
            >
              <button
                role="tab"
                aria-selected={tab === "stock"}
                onClick={() => setTab("stock")}
              >
                <Cube size={15} />
                Stock
              </button>
              <button
                role="tab"
                aria-selected={tab === "tools"}
                onClick={() => setTab("tools")}
              >
                <Cylinder size={15} />
                Tools
                {missing.length > 0 && (
                  <span className="tab-count">{missing.length}</span>
                )}
              </button>
              <button
                role="tab"
                aria-selected={tab === "code"}
                onClick={() => setTab("code")}
              >
                <FileCode size={15} />
                G-code
              </button>
            </div>
            <div className="sidebar-content" role="tabpanel">
              <section
                className="panel-section operation-setup"
                aria-label="Machining operations"
              >
                <div className="section-title">
                  <h3>Operations</h3>
                  <span>{bottom ? "2 sides" : "1 side"}</span>
                </div>
                <div
                  className={`operation-file ${activeSide === "top" ? "active" : ""}`}
                >
                  <b>TOP</b>
                  <span title={filename}>{filename}</span>
                </div>
                {bottom ? (
                  <>
                    <div
                      className={`operation-file bottom ${activeSide === "bottom" ? "active" : ""}`}
                    >
                      <b>BOTTOM</b>
                      <span title={bottom.filename}>{bottom.filename}</span>
                      <button
                        className="icon-button"
                        aria-label="Remove BOTTOM operation"
                        onClick={() => {
                          importRevision.current++;
                          setImportState(null);
                          setPlaying(false);
                          setBottom(undefined);
                          setFraction(0);
                        }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <label className="operation-setting">
                      Sequence
                      <select
                        aria-label="Operation order"
                        value={bottom.firstSide}
                        onChange={(e) => {
                          setPlaying(false);
                          setFraction(0);
                          setBottom({
                            ...bottom,
                            firstSide: e.target
                              .value as BottomSetup["firstSide"],
                          });
                        }}
                      >
                        <option value="top">TOP → BOTTOM</option>
                        <option value="bottom">BOTTOM → TOP</option>
                      </select>
                    </label>
                    <label className="operation-setting">
                      Flip stock around
                      <select
                        aria-label="Stock flip axis"
                        value={bottom.flipAxis}
                        onChange={(e) => {
                          setPlaying(false);
                          setBottom({
                            ...bottom,
                            flipAxis: e.target.value as BottomSetup["flipAxis"],
                          });
                        }}
                      >
                        <option value="x">X axis · 180°</option>
                        <option value="y">Y axis · 180°</option>
                      </select>
                    </label>

                    <button
                      className="button small full"
                      onClick={() => bottomInput.current?.click()}
                      disabled={!!importState}
                    >
                      {importState?.kind === "bottom" && (
                        <CircleNotch className="spin" size={14} />
                      )}
                      {importState?.kind === "bottom"
                        ? "Loading BOTTOM…"
                        : "Replace BOTTOM G-code"}
                    </button>
                  </>
                ) : (
                  <button
                    className="button small full"
                    onClick={() => bottomInput.current?.click()}
                    disabled={!!importState}
                  >
                    {importState?.kind === "bottom" ? (
                      <CircleNotch className="spin" size={14} />
                    ) : (
                      <Plus size={14} />
                    )}
                    {importState?.kind === "bottom"
                      ? "Loading BOTTOM…"
                      : "Add BOTTOM G-code"}
                  </button>
                )}
              </section>
              {tab === "stock" && (
                <>
                  <section className="panel-section">
                    <div className="section-title">
                      <h3>Stock dimensions</h3>
                      <span>mm</span>
                    </div>
                    <div
                      className="stock-diagram"
                      aria-label="Rectangular XYZ stock"
                    >
                      <Cube size={90} weight="thin" />
                      <span className="dimension-x">X · {stock.x}</span>
                      <span className="dimension-y">Y · {stock.y}</span>
                      <span className="dimension-z">Z · {stock.z}</span>
                    </div>
                    <div className="dimensions">
                      <NumberField
                        label="Width X"
                        value={stock.x}
                        onChange={(v) => updateStock("x", v)}
                      />
                      <NumberField
                        label="Depth Y"
                        value={stock.y}
                        onChange={(v) => updateStock("y", v)}
                      />
                      <NumberField
                        label="Height Z"
                        value={stock.z}
                        onChange={(v) => updateStock("z", v)}
                      />
                    </div>
                  </section>
                  <section className="panel-section">
                    <div className="section-title">
                      <h3>Material</h3>
                      <span>8 presets</span>
                    </div>
                    <div className="materials">
                      {MATERIALS.map((m) => (
                        <button
                          key={m.id}
                          className={`material ${material === m.id ? "selected" : ""}`}
                          onClick={() => setMaterial(m.id)}
                          aria-pressed={material === m.id}
                        >
                          <span
                            className={`swatch ${m.grain ? "wood" : ""}`}
                            style={{ backgroundColor: m.color }}
                          />
                          {m.name}
                          {material === m.id && <Check size={13} />}
                        </button>
                      ))}
                    </div>
                  </section>
                  <section className="panel-section">
                    <div className="section-title">
                      <h3>Workpiece origin</h3>
                      <Tip label="G-code coordinates are relative to this origin.">
                        <Info size={14} tabIndex={0} />
                      </Tip>
                    </div>
                    <label className="field-label">
                      XY plane
                      <select
                        value={stock.origin}
                        onChange={(e) => updateStock("origin", e.target.value)}
                      >
                        <option value="corner">Front-left corner</option>
                        <option value="center">Stock center</option>
                      </select>
                    </label>
                    <label className="field-label">
                      Z zero
                      <select
                        value={stock.zOrigin}
                        onChange={(e) => updateStock("zOrigin", e.target.value)}
                      >
                        <option value="top">Top surface</option>
                        <option value="bottom">Stock bottom</option>
                      </select>
                    </label>
                    <div className="origin-note">
                      <span className="origin-dot" />
                      G54 ·{" "}
                      {stock.origin === "corner"
                        ? "X0 Y0 at corner"
                        : "X0 Y0 at center"}{" "}
                      ·{" "}
                      {stock.zOrigin === "top"
                        ? "cut toward Z−"
                        : "cut from positive Z"}
                    </div>
                  </section>
                </>
              )}
              {tab === "tools" && (
                <>
                  <section className="panel-section">
                    <div className="section-title">
                      <h3>Program tools</h3>
                      <span>
                        {toolNumbers.length}{" "}
                        {toolNumbers.length === 1 ? "tool" : "tools"}
                      </span>
                    </div>

                    {!demo && code.trim() && (
                      <button
                        className="button small"
                        onClick={() => {
                          setFileError("");
                          setSetupPrompt(true);
                        }}
                      >
                        Import stock &amp; tools from .mks
                      </button>
                    )}
                    <div className="assigned-tools">
                      {toolNumbers.map((n) => {
                        const t = assignments[n];
                        return (
                          <button
                            className={`assigned-tool ${!t ? "unassigned" : ""}`}
                            key={n}
                            onClick={() => setToolModal(n)}
                          >
                            <span className="tool-number">T{n}</span>
                            <div>
                              <strong>
                                {t
                                  ? `${kindNames[t.kind]} · Ø ${t.diameter}`
                                  : "Assign a tool"}
                              </strong>
                              <small>
                                {t
                                  ? t.name.split(" · ")[0]
                                  : program?.tools.includes(n)
                                    ? "Required for simulation"
                                    : "No cutting moves · optional"}
                              </small>
                            </div>
                            <CaretRight size={14} />
                          </button>
                        );
                      })}
                    </div>
                  </section>
                  <section className="panel-section">
                    <div className="library-promo">
                      <Cylinder size={22} />
                      <h3>Makera library</h3>
                      <p>{LIBRARY.length} tools</p>
                      <button
                        className="button"
                        onClick={() => setToolModal(toolNumbers[0] ?? 1)}
                      >
                        Browse library <ArrowSquareOut size={14} />
                      </button>
                    </div>
                  </section>
                </>
              )}
              {tab === "code" && (
                <>
                  <section className="panel-section">
                    <div className="section-title">
                      <h3>{activeSide.toUpperCase()} program</h3>
                      <FileCode size={15} />
                    </div>
                    <div className="file-detail">
                      <strong>{activeFilename}</strong>
                      <small>
                        {fmt(new Blob([activeCode]).size / 1024)} KB ·{" "}
                        {activeOperation?.lines ??
                          program?.lines ??
                          activeCode.split("\n").length}{" "}
                        lines
                      </small>
                    </div>
                    <button
                      className="button full"
                      onClick={() =>
                        download(activeFilename, activeCode, "text/plain")
                      }
                    >
                      <DownloadSimple size={15} />
                      Download G-code
                    </button>
                  </section>
                  <div className="code-caption">
                    First 200 lines · current line {currentLine}
                  </div>
                  <div className="code-preview">
                    {activeCode
                      .split("\n")
                      .slice(0, 200)
                      .map((line, i) => (
                        <div
                          className={i + 1 === currentLine ? "current" : ""}
                          key={i}
                        >
                          <span>{i + 1}</span>
                          <code>{line || " "}</code>
                        </div>
                      ))}
                  </div>
                </>
              )}
            </div>
            <div className="sidebar-bottom">
              <button onClick={loadDemo}>
                <ArrowCounterClockwise size={14} />
                Reload example
              </button>
              <button
                aria-label="About the simulation"
                onClick={() => setHelp(true)}
              >
                <Info size={16} />
              </button>
            </div>
          </aside>
          <section className="main-panel">
            <div className="viewer-toolbar">
              <button
                className="icon-button setup-toggle"
                aria-label={
                  setupVisible ? "Hide setup panel" : "Show setup panel"
                }
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
                  label={`${gpuRuntime ? "WebGPU" : "CPU"} · ${fmt(presetResolution(resolution, gpuRuntime?.maxResolution), 0)} cells on the longest axis. Higher quality resolves finer details.`}
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
                        setResolution((value) =>
                          Math.min(value, MAX_THREAD_QUALITY),
                        );
                      setThreadsEnabled(!threadsEnabled);
                    }}
                  >
                    Threads
                  </button>
                </Tip>
              </div>
            </div>
            <div className="viewport" ref={viewer} aria-busy={!!loadingTitle}>
              <Suspense fallback={null}>
                <Viewport
                  onRuntime={setGpuRuntime}
                  stock={stock}
                  surface={surface}
                  material={material}
                  program={program}
                  fraction={fraction}
                  tools={assignments}
                  showPath={showPath}
                  showTool={showTool}
                  interactive={!playing && !busy}
                  view={view}
                  cameraPose={cameraPose}
                  onCameraChange={setCameraPose}
                />
              </Suspense>
              {blockingLoad && loadingTitle && (
                <div className="preview-loading">
                  <LoadingStatus
                    title={loadingTitle}
                    detail={
                      importState?.filename ??
                      (bottom ? `${filename} + ${bottom.filename}` : filename)
                    }
                  />
                </div>
              )}
              {bottom && (
                <div
                  className={`viewport-side-label ${activeSide}`}
                  aria-label={`Current machining side: ${activeSide.toUpperCase()}`}
                >
                  {activeSide.toUpperCase()}
                </div>
              )}
              <div className="viewport-label">
                <span
                  className={`state-dot ${loadingTitle ? "working" : error ? "error" : ""}`}
                />
                {loadingTitle
                  ? loadingTitle
                  : error
                    ? "Setup required"
                    : fraction < 1
                      ? "Partial simulation"
                      : "Machining complete"}
                <span className="viewport-label-sub">
                  {materialInfo.name} · {stock.x} × {stock.y} × {stock.z} mm
                </span>
              </div>
              <div className="view-controls">
                <IconButton
                  label="Isometric view"
                  onClick={() => changeView("iso")}
                  active={view.mode === "iso"}
                >
                  <Cube size={17} />
                </IconButton>
                <IconButton
                  label="Top view"
                  onClick={() => changeView("top")}
                  active={view.mode === "top"}
                >
                  <ArrowDown size={17} />
                </IconButton>
                <IconButton
                  label="Front view"
                  onClick={() => changeView("front")}
                  active={view.mode === "front"}
                >
                  <Ruler size={17} />
                </IconButton>
                <span />
                <IconButton
                  label="Fit workpiece"
                  onClick={() => changeView("iso")}
                >
                  <ArrowsOut size={17} />
                </IconButton>
              </div>
              {!importState && (error || fileError) && (
                <div className="error-banner" role="alert">
                  <Warning size={19} />
                  <div>
                    <strong>
                      {fileError
                        ? "Import failed"
                        : missing.length
                          ? "Assign tools to continue"
                          : "Cannot simulate this program"}
                    </strong>
                    <p>{fileError || error}</p>
                    {missing.length > 0 && (
                      <button
                        className="button small"
                        onClick={() => {
                          setTab("tools");
                          setSetupVisible(true);
                          setToolModal(missing[0]);
                        }}
                      >
                        Configure T{missing[0]}
                      </button>
                    )}
                  </div>
                  {fileError && (
                    <button
                      className="icon-button"
                      aria-label="Dismiss error"
                      onClick={() => setFileError("")}
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              )}
              <div className="viewport-hint">
                Drag to rotate<span>·</span>Scroll to zoom<span>·</span>
                Right-drag to pan
              </div>
              <OptimizationPanel
                analysis={analysis}
                material={material}
                onMaterialChange={setMaterial}
                canSeek={!playbackDisabled}
                programError={error}
                onSeek={(move) => {
                  const op = program?.operations?.find(
                    (item) => move >= item.start && move < item.end,
                  );
                  // At a setup boundary, stay on the flagged face instead of
                  // switching to the next file before its first movement.
                  seek(
                    (op && op.end < count && move + 1 === op.end
                      ? move
                      : move + 1) / count,
                  );
                  setShowPath(true);
                  setShowTool(true);
                }}
              />
              <div className="scale-label">
                <span />
                10 mm grid
              </div>
            </div>
            <div className="playback">
              <div className="playback-top">
                <div className="playback-title">
                  <span>{bottom ? "TOP + BOTTOM" : "TOP simulation"}</span>
                  <span className="badge">
                    {blockingLoad
                      ? "Preparing…"
                      : `${Math.round(actual * 100)}%`}
                  </span>
                </div>
                <span className="playback-line">
                  {activeSide.toUpperCase()} · Line <b>{currentLine}</b> /{" "}
                  {activeOperation?.lines ?? program?.lines ?? "…"}
                </span>
              </div>
              <div className="playback-controls">
                <IconButton
                  label="Back to start"
                  onClick={() => {
                    setPlaying(false);
                    setFraction(0);
                  }}
                  disabled={playbackDisabled}
                >
                  <SkipBack size={17} weight="fill" />
                </IconButton>
                <button
                  className="play-button"
                  aria-label={playing ? "Pause" : "Play simulation"}
                  disabled={playbackDisabled || !surface}
                  onClick={() => {
                    if (fraction >= 1) setFraction(0);
                    setPlaying(!playing);
                  }}
                >
                  {playing ? (
                    <Pause size={16} weight="fill" />
                  ) : (
                    <Play size={16} weight="fill" />
                  )}
                </button>
                <IconButton
                  label="Go to end"
                  onClick={() => {
                    setPlaying(false);
                    setFraction(1);
                  }}
                  disabled={playbackDisabled}
                >
                  <SkipForward size={17} weight="fill" />
                </IconButton>
                <PlaybackTimeline
                  program={program}
                  assignments={assignments}
                  fraction={fraction}
                  disabled={playbackDisabled}
                  onSeek={seek}
                />
                <select
                  aria-label="Playback speed"
                  title="Relative to estimated machine motion time: programmed feed, rapids at 3000 mm/min; excludes acceleration, pauses and tool changes."
                  value={speed}
                  onChange={(e) => setSpeed(+e.target.value)}
                >
                  <option value={1}>1×</option>
                  <option value={2}>2×</option>
                  <option value={5}>5×</option>
                  <option value={10}>10×</option>
                </select>
              </div>
              <div className="playback-tool">
                <span className="active-tool-label">
                  <Cylinder size={14} />
                  <strong>{cursor ? `T${cursor.tool}` : "—"}</strong>
                  <span>
                    {activeTool?.name ??
                      (cursor ? "Tool not assigned" : "No tool")}
                  </span>
                </span>
                {!!program?.toolChanges.length && (
                  <select
                    aria-label="Jump to tool change"
                    value={cursor?.changeIndex ?? -1}
                    disabled={playbackDisabled}
                    onChange={(e) => {
                      const change = program.toolChanges[+e.target.value];
                      if (change) seek(change.moveIndex / count);
                    }}
                  >
                    <option value={-1} disabled>
                      Tool changes
                    </option>
                    {toolChangeGroups.map((group) => (
                      <option key={group.moveIndex} value={group.lastIndex}>
                        {group.changes
                          .map((change) => `T${change.tool}`)
                          .join(" → ")}{" "}
                        ·{" "}
                        {program.operations
                          ? operationAt(
                              program,
                              group.moveIndex,
                            )?.side.toUpperCase()
                          : "TOP"}{" "}
                        · line {group.changes.at(-1)!.line}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
            <div className="metrics">
              <div>
                <span>Material removed</span>
                <strong>
                  {surface ? fmt(surface.removed / 1000, 2) : "—"}{" "}
                  <small>cm³</small>
                </strong>
              </div>
              <div>
                <span>Total toolpath</span>
                <strong>
                  {program ? fmt(program.distance / 1000, 2) : "—"}{" "}
                  <small>m</small>
                </strong>
              </div>
              <div>
                <span>
                  Estimated time{" "}
                  <Tip label="Uses F feed rates and 3000 mm/min rapids; excludes acceleration, pauses and tool changes.">
                    <Info size={12} tabIndex={0} />
                  </Tip>
                </span>
                <strong>
                  {program ? time(program.seconds) : "—"} <small>min:s</small>
                </strong>
              </div>
              <div>
                <span>Grid spacing</span>
                <strong>
                  {surface
                    ? fmt(
                        Math.max(stock.x / surface.nx, stock.y / surface.ny),
                        3,
                      )
                    : "—"}{" "}
                  <small>mm</small>
                  {surface?.gpu?.threads && (
                    <small>
                      {" "}
                      · thread {fmt(surface.gpu.threads.step, 3)} mm
                    </small>
                  )}
                </strong>
              </div>
            </div>
          </section>
        </main>
        <footer className="statusbar">
          <div>
            {loadingTitle ? (
              <CircleNotch className="spin" size={13} aria-hidden="true" />
            ) : (
              <span className="state-dot" />
            )}
            {loadingTitle || "Local engine"}
            <span className="status-separator" />
            <span>
              {surface?.backend === "webgpu"
                ? "WebGPU · GPU accelerated"
                : "CPU · Web Worker"}
            </span>
          </div>
          <div>
            <button
              className={warnings.length ? "warning-link" : ""}
              onClick={() => setDiagnostics(true)}
            >
              {warnings.length ? <Warning size={13} /> : <Check size={13} />}{" "}
              {warnings.length
                ? `${warnings.length} ${warnings.length === 1 ? "note" : "notes"} to review`
                : "Diagnostics"}
            </button>
            <span className="status-separator" />
            <span>{fmt(count, 0)} segments</span>
            <span className="status-separator" />
            <span>
              {surface
                ? `${fmt(surface.elapsed, 0)} ms · last calculation`
                : "Waiting"}
            </span>
          </div>
        </footer>
        {drag && (
          <div className="drop-overlay">
            <UploadSimple size={40} />
            <h2>Drop your program here</h2>
            <p>G-code · 25 MB per file / .forma.json project · 55 MB</p>
          </div>
        )}
        {toolModal !== null && (
          <ToolLibrary
            number={toolModal}
            current={assignments[toolModal]}
            onClose={() => setToolModal(null)}
            onSelect={(tool) => {
              setAssignments((a) => ({ ...a, [toolModal]: tool }));
              setToolModal(null);
            }}
          />
        )}
        {diagnostics && (
          <Modal
            title="Program diagnostics"
            onClose={() => setDiagnostics(false)}
          >
            <div className="help-content">
              {error && <p className="diagnostic-error">{error}</p>}
              {warnings.length ? (
                warnings.map((w) => (
                  <p className="diagnostic" key={w}>
                    <Info size={16} />
                    {w}
                  </p>
                ))
              ) : (
                <p>No notes reported by the parser.</p>
              )}
              <p className="muted">
                The preview does not check collisions with the spindle, fixtures
                or machine. Times are estimates.
              </p>
            </div>
          </Modal>
        )}
        {help && (
          <Modal
            title="From G-code to finished part"
            onClose={() => setHelp(false)}
          >
            <div className="help-content">
              <h3>1. Define the stock</h3>
              <p>
                Set dimensions in mm, material and XY/Z origins to match your
                CAM setup. Material textures are approximate.
              </p>
              <h3>2. Import and assign tools</h3>
              <p>
                Upload a file from Makera Studio, including compressed files, or
                another CAM application. Match each T number to a Makera or
                custom tool. The catalog does not automatically assign machine
                tool numbers.
              </p>
              <p>
                After importing G-code, choose its matching Makera Studio .mks
                to import stock dimensions and tools, or choose manual setup.
                Each new G-code starts a new setup. Origins remain editable in
                Stock; special or unverified tool profiles use toolpath-only
                mode.
              </p>
              <h3>3. Explore the machining process</h3>
              <p>
                Rotate the part, show the toolpath and scrub through the
                simulation. Click a T marker on the timeline to jump to a tool
                change. Quality controls grid resolution; arcs use a maximum
                chord error of 0.02 mm. Final detail depends on grid spacing.
              </p>
              <h3>Compatibility</h3>
              <p>
                Supports G0/G1, G2/G3 in G17/G18/G19 planes with I/J/K or R,
                G20/G21, G90/G91, G90.1/G91.1, G54 and T/M6. G28 homing without
                axis coordinates is excluded from toolpaths and timing, with a
                diagnostic note. Unsupported codes stop the simulation and
                report the line number.
              </p>
              <p>
                Add a BOTTOM G-code to machine both faces in sequence. Choose
                the order and a 180° flip around the stock centre on X or Y.
                Stock origins are re-established on each face; T numbers share
                the same tool assignments. Both operations and their overlap are
                preserved through playback. Both faces use WebGPU when
                available. Thread mills with pitch, angle and neck dimensions
                also cut a local 3D volume on WebGPU, using an idealized
                single-form tooth. CPU mode shows their tool and path only.
                Other undercuts, turning, rotary axes, canned cycles, multiple
                offsets and tool compensation are unsupported. Does not check
                collisions with fixtures or tool holders.
              </p>
              <h3>Local projects</h3>
              <p>
                Your workspace is saved automatically in this browser, including
                tools, stock, display settings and playback position. Refreshing
                restores it with playback paused. Clearing site data removes the
                local copy.
              </p>
              <p>
                “Save project” downloads stock, tools and G-code in a JSON file.
                Import it to resume your work. No program is sent to a server.
              </p>
              <div className="help-links">
                <a
                  href="https://www.makera.com/collections/cnc-bits"
                  target="_blank"
                  rel="noreferrer"
                >
                  Makera catalog <ArrowSquareOut size={14} />
                </a>
                <a
                  href="https://github.com/MakeraInc/CarveraController"
                  target="_blank"
                  rel="noreferrer"
                >
                  Makera controller <ArrowSquareOut size={14} />
                </a>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </Tooltip.Provider>
  );
}
