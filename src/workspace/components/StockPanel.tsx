import { Check, Cube, Info } from "@phosphor-icons/react";
import type { Stock, WorkSystem } from "../../types";
import { MATERIALS } from "../../data/materials";
import NumberField from "../../components/NumberField";
import StockOriginControls from "../../components/StockOriginControls";
import Tip from "../../components/Tip";
interface Props {
  stock: Stock;
  material: string;
  workSystems?: WorkSystem[];
  onStockChange: (stock: Stock) => void;
  onDimensionChange: (key: "x" | "y" | "z", value: number) => void;
  setMaterial: (material: string) => void;
}
export default function StockPanel({
  stock,
  material,
  workSystems,
  onStockChange,
  onDimensionChange,
  setMaterial,
}: Props) {
  return (
    <>
      <section className="panel-section">
        <div className="section-title">
          <h3>Stock dimensions</h3>
          <span>mm</span>
        </div>
        <div className="stock-diagram" aria-label="Rectangular XYZ stock">
          <Cube size={90} weight="thin" />
          <span className="dimension-x">X · {stock.x}</span>
          <span className="dimension-y">Y · {stock.y}</span>
          <span className="dimension-z">Z · {stock.z}</span>
        </div>
        <div className="dimensions">
          <NumberField
            label="Width X"
            value={stock.x}
            onChange={(v) => onDimensionChange("x", v)}
          />
          <NumberField
            label="Depth Y"
            value={stock.y}
            onChange={(v) => onDimensionChange("y", v)}
          />
          <NumberField
            label="Height Z"
            value={stock.z}
            onChange={(v) => onDimensionChange("z", v)}
          />
        </div>
      </section>
      <section className="panel-section">
        <div className="section-title">
          <h3>Material</h3>
          <span>8 presets</span>
        </div>
        <div className="materials">
          {MATERIALS.map((m) => (
            <button
              key={m.id}
              className={`material ${material === m.id ? "selected" : ""}`}
              onClick={() => setMaterial(m.id)}
              aria-pressed={material === m.id}
            >
              <span
                className={`swatch ${m.grain ? "wood" : ""}`}
                style={{ backgroundColor: m.color }}
              />
              {m.name}
              {material === m.id && <Check size={13} />}
            </button>
          ))}
        </div>
      </section>
      <section className="panel-section">
        <div className="section-title">
          <h3>Workpiece origin</h3>
          <Tip label="G-code coordinates are relative to this origin.">
            <Info size={14} tabIndex={0} />
          </Tip>
        </div>
        <StockOriginControls
          stock={stock}
          workSystems={workSystems}
          onChange={onStockChange}
        />
      </section>
    </>
  );
}
