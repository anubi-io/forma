import { lazy, Suspense, type ComponentProps, type ReactNode } from "react";
import { ArrowDown, ArrowsOut, Cube, Ruler } from "@phosphor-icons/react";
import { MATERIALS } from "../../data/materials";
import type { BottomSetup, MachiningSide } from "../../types";
import type { ImportState } from "../useWorkspaceFiles";
import LoadingStatus from "../../components/LoadingStatus";
import IconButton from "../../components/IconButton";
const Viewport = lazy(() => import("../../scene/Viewport"));
interface Props {
  viewport: ComponentProps<typeof Viewport>;
  filename: string;
  bottom?: BottomSetup;
  activeSide: MachiningSide;
  loadingTitle: string;
  blockingLoad: boolean;
  importState: ImportState | null;
  error: string;
  changeView: (mode: string) => void;
  errorBanner: ReactNode;
  children: ReactNode;
}
export default function SimulationViewport({
  viewport,
  filename,
  bottom,
  activeSide,
  loadingTitle,
  blockingLoad,
  importState,
  error,
  changeView,
  errorBanner,
  children,
}: Props) {
  const { stock, material, fraction, view } = viewport;
  const materialInfo = MATERIALS.find((m) => m.id === material) ?? MATERIALS[0];
  return (
    <div className="viewport" aria-busy={!!loadingTitle}>
      <Suspense fallback={null}>
        <Viewport {...viewport} />
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
        <IconButton label="Fit workpiece" onClick={() => changeView("iso")}>
          <ArrowsOut size={17} />
        </IconButton>
      </div>
      {errorBanner}
      <div className="viewport-hint">
        Drag to rotate<span>·</span>Scroll to zoom<span>·</span>
        Right-drag to pan
      </div>
      {children}
      <div className="scale-label">
        <span />
        10 mm grid
      </div>
    </div>
  );
}
