import { CaretRight, CircleNotch, Plus } from "@phosphor-icons/react";
import type { ImportState } from "../useWorkspaceFiles";
interface Props {
  demo: boolean;
  importState: ImportState | null;
  onImport: () => void;
}
export default function ProjectBar({ demo, importState, onImport }: Props) {
  return (
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
          onClick={onImport}
          disabled={!!importState}
        >
          {importState?.kind === "top" || importState?.kind === "project" ? (
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
  );
}
