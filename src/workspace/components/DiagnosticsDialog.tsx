import { Info } from "@phosphor-icons/react";
import Modal from "../../components/Modal";
interface Props {
  error: string;
  warnings: string[];
  onClose: () => void;
}
export default function DiagnosticsDialog({ error, warnings, onClose }: Props) {
  return (
    <Modal title="Program diagnostics" onClose={onClose}>
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
          The preview does not check collisions with the spindle, fixtures or
          machine. Times are estimates.
        </p>
      </div>
    </Modal>
  );
}
