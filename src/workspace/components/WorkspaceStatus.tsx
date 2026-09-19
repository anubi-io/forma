import { Check, CircleNotch, Warning } from "@phosphor-icons/react";
import type { Surface } from "../../types";
import { fmt } from "../format";
interface Props {
  loadingTitle: string;
  surface?: Surface;
  warnings: string[];
  count: number;
  onDiagnostics: () => void;
}
export default function WorkspaceStatus({
  loadingTitle,
  surface,
  warnings,
  count,
  onDiagnostics,
}: Props) {
  return (
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
          onClick={onDiagnostics}
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
  );
}
