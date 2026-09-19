import { CircleNotch, Plus, X } from "@phosphor-icons/react";
import type { BottomSetup, MachiningSide } from "../../types";
import type { ImportState } from "../useWorkspaceFiles";
interface Props {
  filename: string;
  bottom?: BottomSetup;
  activeSide: MachiningSide;
  importState: ImportState | null;
  onRemove: () => void;
  onImport: () => void;
  onOrderChange: (side: BottomSetup["firstSide"]) => void;
  onFlipAxisChange: (axis: BottomSetup["flipAxis"]) => void;
}
export default function OperationsPanel({
  filename,
  bottom,
  activeSide,
  importState,
  onRemove,
  onImport,
  onOrderChange,
  onFlipAxisChange,
}: Props) {
  return (
    <section
      className="panel-section operation-setup"
      aria-label="Machining operations"
    >
      <div className="section-title">
        <h3>Operations</h3>
        <span>{bottom ? "2 sides" : "1 side"}</span>
      </div>
      <div className={`operation-file ${activeSide === "top" ? "active" : ""}`}>
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
              onClick={onRemove}
            >
              <X size={14} />
            </button>
          </div>
          <label className="operation-setting">
            Sequence
            <select
              aria-label="Operation order"
              value={bottom.firstSide}
              onChange={(e) =>
                onOrderChange(e.target.value as BottomSetup["firstSide"])
              }
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
              onChange={(e) =>
                onFlipAxisChange(e.target.value as BottomSetup["flipAxis"])
              }
            >
              <option value="x">X axis · 180°</option>
              <option value="y">Y axis · 180°</option>
            </select>
          </label>

          <button
            className="button small full"
            onClick={onImport}
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
          onClick={onImport}
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
  );
}
