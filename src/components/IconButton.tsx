import type { ReactNode } from "react";
import Tip from "./Tip";
export default function IconButton({
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
