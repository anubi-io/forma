import { CircleNotch, UploadSimple } from "@phosphor-icons/react";
import Modal from "../../components/Modal";
import LoadingStatus from "../../components/LoadingStatus";
import type { ImportState } from "../useWorkspaceFiles";
interface Props {
  filename: string;
  fileError: string;
  importState: ImportState | null;
  closeSetup: () => void;
  onManualSetup: () => void;
  onImport: () => void;
}
export default function SetupDialog({
  filename,
  fileError,
  importState,
  closeSetup,
  onManualSetup,
  onImport,
}: Props) {
  return (
    <Modal title="Set up this G-code" onClose={closeSetup}>
      <div className="help-content">
        <h3>{filename}</h3>
        <p>
          Have the matching Makera Studio project? Import its .mks to set stock
          dimensions and assign tools automatically.
        </p>
        <p>
          Choose the project used to export this G-code. Your current XY and Z
          origins will be kept; review them in Stock after importing.
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
        <button className="button" onClick={onManualSetup}>
          Set up manually
        </button>
        <button
          className="button primary"
          onClick={onImport}
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
  );
}
