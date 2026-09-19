import { CircleNotch } from "@phosphor-icons/react";
export default function LoadingStatus({
  title,
  detail,
}: {
  title: string;
  detail?: string;
}) {
  return (
    <div
      className="loading-status"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <CircleNotch className="spin" size={22} aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        {detail && <small>{detail}</small>}
      </div>
    </div>
  );
}
