import { WORK_SYSTEMS, type Stock, type WorkOffsets } from "../types";

export const MAX_ORIGIN = 1_000_000;
const finiteOffset = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Math.abs(value) <= MAX_ORIGIN;

export function validWorkOffsets(value: unknown): value is WorkOffsets {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([key, offset]) =>
        WORK_SYSTEMS.slice(1).some((system) => String(system) === key) &&
        Array.isArray(offset) &&
        offset.length === 3 &&
        [0, 1, 2].every((axis) => finiteOffset(offset[axis])),
    )
  );
}

export function validStockOrigin(
  stock: Pick<
    Stock,
    "origin" | "zOrigin" | "originX" | "originY" | "originZ" | "workOffsets"
  >,
): boolean {
  return (
    [
      "corner",
      "front-right",
      "back-left",
      "back-right",
      "center",
      "custom",
    ].includes(stock.origin) &&
    ["top", "bottom", "custom"].includes(stock.zOrigin) &&
    [stock.originX, stock.originY, stock.originZ].every(
      (v) => v === undefined || finiteOffset(v),
    ) &&
    (stock.origin !== "custom" ||
      (finiteOffset(stock.originX) && finiteOffset(stock.originY))) &&
    (stock.zOrigin !== "custom" || finiteOffset(stock.originZ)) &&
    (stock.workOffsets === undefined || validWorkOffsets(stock.workOffsets))
  );
}

/** Work coordinates → stock coordinates: add this zero point to each XYZ. */
export function stockOrigin(stock: Stock): [number, number, number] {
  if (!validStockOrigin(stock))
    throw new Error("Invalid workpiece origin or work offsets.");
  const x =
    stock.origin === "custom"
      ? stock.originX!
      : stock.origin === "center"
        ? stock.x / 2
        : stock.origin === "front-right" || stock.origin === "back-right"
          ? stock.x
          : 0;
  const y =
    stock.origin === "custom"
      ? stock.originY!
      : stock.origin === "center"
        ? stock.y / 2
        : stock.origin === "back-left" || stock.origin === "back-right"
          ? stock.y
          : 0;
  const z =
    stock.zOrigin === "custom"
      ? stock.originZ!
      : stock.zOrigin === "top"
        ? stock.z
        : 0;
  return [x, y, z];
}

/** Scene axes are X, Z, −Y, centered horizontally on the stock. */
export function sceneOrigin(stock: Stock): [number, number, number] {
  const [x, y, z] = stockOrigin(stock);
  return [x - stock.x / 2, z, stock.y / 2 - y];
}
