import { useEffect, useState } from "react";

export default function NumberField({
  label,
  value,
  onChange,
  min = 0.1,
  max = 2000,
  step = 0.1,
  unit = "mm",
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const valid =
    Number.isFinite(Number(draft)) &&
    Number(draft) >= min &&
    Number(draft) <= max &&
    draft.trim() !== "";
  return (
    <label className="number-field">
      <span>{label}</span>
      <div>
        <input
          type="number"
          value={draft}
          min={min}
          max={max}
          step={step}
          aria-invalid={!valid}
          onChange={(e) => {
            setDraft(e.target.value);
            const n = Number(e.target.value);
            if (
              e.target.value !== "" &&
              Number.isFinite(n) &&
              n >= min &&
              n <= max
            )
              onChange(n);
          }}
          onBlur={() => {
            if (!valid) setDraft(String(value));
          }}
        />
        <span>{unit}</span>
      </div>
    </label>
  );
}
