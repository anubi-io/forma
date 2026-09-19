import { useRef, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { UploadSimple, Warning } from "@phosphor-icons/react";
import type { WorkspaceSnapshot } from "../workspaceStorage";
import ToolLibrary from "../components/ToolLibrary";
import OptimizationPanel from "../components/OptimizationPanel";
import { useWorkspace } from "./useWorkspace";
import WorkspaceHeader from "./components/WorkspaceHeader";
import ProjectBar from "./components/ProjectBar";
import WorkspaceFileInputs from "./components/WorkspaceFileInputs";
import SetupImportNotice from "./components/SetupImportNotice";
import SetupDialog from "./components/SetupDialog";
import SetupSidebar from "./components/SetupSidebar";
import OperationsPanel from "./components/OperationsPanel";
import StockPanel from "./components/StockPanel";
import ToolsPanel from "./components/ToolsPanel";
import CodePanel from "./components/CodePanel";
import ViewerToolbar from "./components/ViewerToolbar";
import SimulationViewport from "./components/SimulationViewport";
import SimulationError from "./components/SimulationError";
import PlaybackPanel from "./components/PlaybackPanel";
import SimulationMetrics from "./components/SimulationMetrics";
import WorkspaceStatus from "./components/WorkspaceStatus";
import DiagnosticsDialog from "./components/DiagnosticsDialog";
import HelpDialog from "./components/HelpDialog";

interface Props {
  initial?: WorkspaceSnapshot;
  restoreError?: string;
}

export default function Workspace({ initial, restoreError }: Props) {
  const {
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
  } = useWorkspace(initial, restoreError);
  const { project, setMaterial, setAssignments } = projectState;
  const {
    stock,
    material,
    code,
    filename,
    demo,
    assignments,
    bottom,
    setupSource,
  } = project;
  const { program, surface, error, busy } = simulation;
  const [toolModal, setToolModal] = useState<number | null>(null);
  const [help, setHelp] = useState(false);
  const [diagnostics, setDiagnostics] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const bottomInput = useRef<HTMLInputElement>(null);
  const mksInput = useRef<HTMLInputElement>(null);

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
          void files.importFile(e.dataTransfer.files[0]);
        }}
      >
        <WorkspaceHeader
          saved={files.saved}
          save={files.save}
          onHelp={() => setHelp(true)}
        />
        {autosaveError && (
          <div className="autosave-warning" role="alert">
            <Warning size={16} />
            {autosaveError}
          </div>
        )}
        <ProjectBar
          demo={demo}
          importState={files.importState}
          onImport={() => fileInput.current?.click()}
        />
        <WorkspaceFileInputs
          fileInput={fileInput}
          bottomInput={bottomInput}
          mksInput={mksInput}
          importFile={files.importFile}
          importBottom={files.importBottom}
        />
        {setupSource && files.showSetupNotice && (
          <SetupImportNotice
            setupSource={setupSource}
            stock={stock}
            onDismiss={() => files.setShowSetupNotice(false)}
          />
        )}
        {files.setupPrompt && (
          <SetupDialog
            filename={filename}
            fileError={files.fileError}
            importState={files.importState}
            closeSetup={files.closeSetup}
            onImport={() => mksInput.current?.click()}
            onManualSetup={() => {
              files.closeSetup();
              display.setTab("stock");
              display.setSetupVisible(true);
            }}
          />
        )}
        <main
          className={`workspace ${display.setupVisible ? "" : "setup-hidden"}`}
        >
          <SetupSidebar
            tab={display.tab}
            setTab={display.setTab}
            missingCount={missing.length}
            loadDemo={files.loadDemo}
            onHelp={() => setHelp(true)}
            operations={
              <OperationsPanel
                filename={filename}
                bottom={bottom}
                activeSide={activeSide}
                importState={files.importState}
                onImport={() => bottomInput.current?.click()}
                onRemove={files.removeBottom}
                onOrderChange={changeOrder}
                onFlipAxisChange={changeFlipAxis}
              />
            }
          >
            {display.tab === "stock" && (
              <StockPanel
                stock={stock}
                material={material}
                workSystems={program?.workSystems}
                onStockChange={updateStock}
                onDimensionChange={updateStockDimension}
                setMaterial={setMaterial}
              />
            )}
            {display.tab === "tools" && (
              <ToolsPanel
                assignments={assignments}
                toolNumbers={toolNumbers}
                program={program}
                demo={demo}
                code={code}
                setToolModal={setToolModal}
                onSetup={() => {
                  files.setFileError("");
                  files.setSetupPrompt(true);
                }}
              />
            )}
            {display.tab === "code" && (
              <CodePanel
                activeSide={activeSide}
                activeFilename={activeFilename}
                activeCode={activeCode}
                activeOperation={activeOperation}
                program={program}
                currentLine={playback.currentLine}
              />
            )}
          </SetupSidebar>
          <section className="main-panel">
            <ViewerToolbar
              display={display}
              activeSide={activeSide}
              activeFilename={activeFilename}
              demo={demo}
              gpuRuntime={gpuRuntime}
              surface={surface}
            />
            <SimulationViewport
              viewport={{
                onRuntime: setGpuRuntime,
                stock,
                surface,
                material,
                program,
                fraction: display.fraction,
                tools: assignments,
                showPath: display.showPath,
                showTool: display.showTool,
                interactive: !display.playing && !busy,
                view: display.view,
                cameraPose: display.cameraPose,
                onCameraChange: display.setCameraPose,
              }}
              filename={filename}
              bottom={bottom}
              activeSide={activeSide}
              loadingTitle={loadingTitle}
              blockingLoad={blockingLoad}
              importState={files.importState}
              error={error}
              changeView={display.changeView}
              errorBanner={
                !files.importState &&
                (error || files.fileError) && (
                  <SimulationError
                    error={error}
                    fileError={files.fileError}
                    missing={missing}
                    onDismiss={() => files.setFileError("")}
                    onConfigure={(number) => {
                      display.setTab("tools");
                      display.setSetupVisible(true);
                      setToolModal(number);
                    }}
                  />
                )
              }
            >
              <OptimizationPanel
                analysis={analysis}
                material={material}
                onMaterialChange={setMaterial}
                canSeek={!playbackDisabled}
                programError={error}
                onSeek={seekAnalysisMove}
              />
            </SimulationViewport>
            <PlaybackPanel
              program={program}
              surface={surface}
              assignments={assignments}
              bottom={bottom}
              activeSide={activeSide}
              activeOperation={activeOperation}
              blockingLoad={blockingLoad}
              playbackDisabled={playbackDisabled}
              playback={playback}
            />
            <SimulationMetrics
              program={program}
              surface={surface}
              stock={stock}
            />
          </section>
        </main>
        <WorkspaceStatus
          loadingTitle={loadingTitle}
          surface={surface}
          warnings={warnings}
          count={playback.count}
          onDiagnostics={() => setDiagnostics(true)}
        />
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
          <DiagnosticsDialog
            error={error}
            warnings={warnings}
            onClose={() => setDiagnostics(false)}
          />
        )}
        {help && <HelpDialog onClose={() => setHelp(false)} />}
      </div>
    </Tooltip.Provider>
  );
}
