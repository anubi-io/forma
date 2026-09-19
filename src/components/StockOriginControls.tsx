import { useState } from "react";
import {
  WORK_SYSTEMS,
  type Stock,
  type WorkSystem,
  type WorkOffsets,
} from "../types";
import { MAX_ORIGIN, stockOrigin } from "../engine/coordinates";
import NumberField from "./NumberField";

const xyNames: Record<Stock["origin"], string> = {
  corner: "Front-left corner",
  "front-right": "Front-right corner",
  "back-left": "Back-left corner",
  "back-right": "Back-right corner",
  center: "Stock center",
  custom: "Custom",
};

export default function StockOriginControls({
  stock,
  workSystems,
  onChange,
}: {
  stock: Stock;
  workSystems?: WorkSystem[];
  onChange: (stock: Stock) => void;
}) {
  const [systemToAdd, setSystemToAdd] = useState<WorkSystem>(55);
  const [ox, oy, oz] = stockOrigin(stock);
  const update = (patch: Partial<Stock>) => onChange({ ...stock, ...patch });
  const setOffsets = (workOffsets: WorkOffsets | undefined) =>
    update({ workOffsets });
  const available = WORK_SYSTEMS.slice(1).filter(
    (n) => !stock.workOffsets?.[n],
  );
  const nextSystem = available.includes(systemToAdd)
    ? systemToAdd
    : available[0];
  return (
    <>
      <p className="setup-help">
        Place X0 Y0 and Z0 where you set work zero in your CAM and on the
        machine. All distances here are in mm.
      </p>
      <label className="field-label">
        XY plane
        <select
          aria-label="XY plane"
          value={stock.origin}
          onChange={(e) => {
            const origin = e.target.value as Stock["origin"];
            update(
              origin === "custom"
                ? {
                    origin,
                    originX: stock.originX ?? ox,
                    originY: stock.originY ?? oy,
                  }
                : { origin },
            );
          }}
        >
          {Object.entries(xyNames).map(([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {stock.origin === "custom" && (
        <>
          <div className="origin-fields">
            <NumberField
              label="X from left edge"
              value={ox}
              min={-MAX_ORIGIN}
              max={MAX_ORIGIN}
              onChange={(originX) => update({ originX })}
            />
            <NumberField
              label="Y from front edge"
              value={oy}
              min={-MAX_ORIGIN}
              max={MAX_ORIGIN}
              onChange={(originY) => update({ originY })}
            />
          </div>
          <p className="setup-help">
            Positive X goes right; positive Y goes toward the back. Zero can be
            outside the stock.
          </p>
        </>
      )}
      <label className="field-label">
        Z zero
        <select
          aria-label="Z zero"
          value={stock.zOrigin}
          onChange={(e) => {
            const zOrigin = e.target.value as Stock["zOrigin"];
            update(
              zOrigin === "custom"
                ? { zOrigin, originZ: stock.originZ ?? oz }
                : { zOrigin },
            );
          }}
        >
          <option value="top">Top surface</option>
          <option value="bottom">Stock bottom</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      {stock.zOrigin === "custom" && (
        <>
          <NumberField
            label="Z above stock bottom"
            value={oz}
            min={-MAX_ORIGIN}
            max={MAX_ORIGIN}
            onChange={(originZ) => update({ originZ })}
          />
          <p className="setup-help">
            0 is the bottom; {stock.z} mm is the top surface. Positive Z goes
            up.
          </p>
        </>
      )}
      <div className="origin-note">
        <span className="origin-dot" />
        <span>
          {stock.workOffsets
            ? "G54 reference"
            : (workSystems?.length ? workSystems : [54])
                .map((n) => `G${n}`)
                .join(" / ")}{" "}
          · {xyNames[stock.origin]} ·{" "}
          {stock.zOrigin === "top"
            ? "Z0 at top"
            : stock.zOrigin === "bottom"
              ? "Z0 at bottom"
              : `Z0 at ${oz} mm`}
        </span>
      </div>
      <details className="work-offsets">
        <summary>
          Work offsets <span>Advanced</span>
        </summary>
        <label className="field-label">
          Work coordinate setup
          <select
            aria-label="Work coordinate setup"
            value={stock.workOffsets === undefined ? "single" : "separate"}
            onChange={(e) =>
              setOffsets(e.target.value === "single" ? undefined : {})
            }
          >
            <option value="single">Single work zero (default)</option>
            <option value="separate">Separate work zeros</option>
          </select>
        </label>
        {stock.workOffsets === undefined ? (
          <p className="setup-help">
            A file using only G54, G55, or another work system uses the origin
            above. Choose separate zeros if your file switches between them.
          </p>
        ) : (
          <>
            <p className="setup-help">
              The origin above is G54. Enter each other zero’s X, Y and Z as it
              would read in G54, in mm. These distances must match the zeros
              saved on your machine.
            </p>
            {WORK_SYSTEMS.slice(1)
              .filter((n) => stock.workOffsets?.[n])
              .map((n) => (
                <fieldset className="work-offset-row" key={n}>
                  <legend>G{n}</legend>
                  <div className="origin-fields offset-fields">
                    {(["X", "Y", "Z"] as const).map((axis, i) => (
                      <NumberField
                        key={axis}
                        label={`G${n} ${axis}`}
                        value={stock.workOffsets![n]![i]}
                        min={-MAX_ORIGIN}
                        max={MAX_ORIGIN}
                        onChange={(value) => {
                          const xyz = [...stock.workOffsets![n]!] as [
                            number,
                            number,
                            number,
                          ];
                          xyz[i] = value;
                          setOffsets({ ...stock.workOffsets, [n]: xyz });
                        }}
                      />
                    ))}
                  </div>
                  <button
                    className="button small"
                    aria-label={`Remove G${n} offset`}
                    onClick={() => {
                      const remaining = { ...stock.workOffsets };
                      delete remaining[n];
                      setOffsets(remaining);
                    }}
                  >
                    Remove
                  </button>
                </fieldset>
              ))}
            {available.length > 0 && (
              <div className="add-work-offset">
                <select
                  aria-label="Work system to add"
                  value={nextSystem}
                  onChange={(e) =>
                    setSystemToAdd(Number(e.target.value) as WorkSystem)
                  }
                >
                  {available.map((n) => (
                    <option key={n} value={n}>
                      G{n}
                    </option>
                  ))}
                </select>
                <button
                  className="button small"
                  onClick={() =>
                    setOffsets({
                      ...stock.workOffsets,
                      [nextSystem]: [0, 0, 0],
                    })
                  }
                >
                  Add offset
                </button>
              </div>
            )}
          </>
        )}
      </details>
    </>
  );
}
