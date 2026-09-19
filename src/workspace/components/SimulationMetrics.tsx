import { Info } from "@phosphor-icons/react";
import type { Program, Stock, Surface } from "../../types";
import Tip from "../../components/Tip";
import { fmt, time } from "../format";
interface Props {
  program?: Program;
  surface?: Surface;
  stock: Stock;
}
export default function SimulationMetrics({ program, surface, stock }: Props) {
  return (
    <div className="metrics">
      <div>
        <span>Material removed</span>
        <strong>
          {surface ? fmt(surface.removed / 1000, 2) : "—"} <small>cm³</small>
        </strong>
      </div>
      <div>
        <span>Total toolpath</span>
        <strong>
          {program ? fmt(program.distance / 1000, 2) : "—"} <small>m</small>
        </strong>
      </div>
      <div>
        <span>
          Estimated time{" "}
          <Tip label="Uses F feed rates and 3000 mm/min rapids; excludes acceleration, pauses and tool changes.">
            <Info size={12} tabIndex={0} />
          </Tip>
        </span>
        <strong>
          {program ? time(program.seconds) : "—"} <small>min:s</small>
        </strong>
      </div>
      <div>
        <span>Grid spacing</span>
        <strong>
          {surface
            ? fmt(Math.max(stock.x / surface.nx, stock.y / surface.ny), 3)
            : "—"}{" "}
          <small>mm</small>
          {surface?.gpu?.threads && (
            <small> · thread {fmt(surface.gpu.threads.step, 3)} mm</small>
          )}
        </strong>
      </div>
    </div>
  );
}
