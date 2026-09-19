import { Check, X } from "@phosphor-icons/react";
import type { Stock } from "../../types";
interface Props {
  setupSource: string;
  stock: Stock;
  onDismiss: () => void;
}
export default function SetupImportNotice({
  setupSource,
  stock,
  onDismiss,
}: Props) {
  return (
    <div className="setup-import-status" role="status">
      <Check size={16} />
      <span>
        Stock and tools imported from <strong>{setupSource}</strong> · {stock.x}{" "}
        × {stock.y} × {stock.z} mm. XY and Z origins kept: check them in Stock.
      </span>
      <button
        className="icon-button"
        aria-label="Dismiss import notice"
        onClick={onDismiss}
      >
        <X size={16} />
      </button>
    </div>
  );
}
