import { Warning, X } from "@phosphor-icons/react";
interface Props {
  error: string;
  fileError: string;
  missing: number[];
  onConfigure: (number: number) => void;
  onDismiss: () => void;
}
export default function SimulationError({
  error,
  fileError,
  missing,
  onConfigure,
  onDismiss,
}: Props) {
  return (
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
            onClick={() => onConfigure(missing[0])}
          >
            Configure T{missing[0]}
          </button>
        )}
      </div>
      {fileError && (
        <button
          className="icon-button"
          aria-label="Dismiss error"
          onClick={onDismiss}
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
