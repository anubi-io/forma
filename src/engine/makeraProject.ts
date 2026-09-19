import { unzipSync } from "fflate";
import type { Assignments, Stock, Tool } from "../types";
import { idealThreadNeck, validThread } from "./threadProfile";

const LIMIT = 25 * 1024 * 1024;
const METADATA_LIMIT = 4 * 1024 * 1024;
const record = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const positive = (v: unknown, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max;

/** Read only project metadata; never expand the potentially large binary scene. */
export function importMakeraSetup(bytes: Uint8Array): {
  assignments: Assignments;
  dimensions: Pick<Stock, "x" | "y" | "z">;
  material?: string;
} {
  if (bytes.length > LIMIT) throw new Error("The file limit is 25 MB.");
  let metadata: Uint8Array | undefined;
  let found = false;
  try {
    const files = unzipSync(bytes, {
      filter: (entry) => {
        if (entry.name !== "makera.prj") return false;
        if (found) throw new Error("Duplicate project metadata.");
        found = true;
        if (entry.originalSize > METADATA_LIMIT)
          throw new Error("Makera project metadata exceeds the 4 MB limit.");
        return true;
      },
    });
    metadata = files["makera.prj"];
  } catch (e) {
    throw new Error(
      `Cannot read Makera project: ${e instanceof Error ? e.message : "invalid ZIP"}`,
    );
  }
  if (!metadata) throw new Error("This .mks file has no makera.prj metadata.");
  let root: unknown;
  try {
    root = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(metadata),
    );
  } catch {
    throw new Error("Invalid Makera project metadata.");
  }
  if (
    !record(root) ||
    !record(root.project) ||
    !record(root.project.lstCoordinate)
  )
    throw new Error("Unsupported Makera project structure.");
  // Only millimetre projects and type codes verified against a real export.
  if (root.project.emUnit !== 0)
    throw new Error(
      "Only millimetre Makera projects are supported. Save the project in mm.",
    );
  const stock = root.project.stStockInfo;
  if (root.project.b4DType === true || !record(stock) || stock.StockShape !== 1)
    throw new Error("Only rectangular 3-axis Makera stock is supported.");
  if (
    ![stock.length, stock.width, stock.height].every(
      (v) => positive(v, 2000) && v >= 0.1,
    )
  )
    throw new Error("Invalid Makera stock dimensions (expected 0.1–2000 mm).");
  const dimensions = { x: stock.length, y: stock.width, z: stock.height };
  const assignments: Assignments = {};
  for (const coordinate of Object.values(root.project.lstCoordinate)) {
    if (!record(coordinate) || !Array.isArray(coordinate.path))
      throw new Error("Invalid Makera operation list.");
    for (const operation of coordinate.path) {
      if (!record(operation) || !Array.isArray(operation.tools))
        throw new Error("Invalid Makera operation tools.");
      for (const raw of operation.tools) {
        if (
          !record(raw) ||
          !Number.isSafeInteger(raw.toolNumber) ||
          raw.toolNumber < 0 ||
          typeof raw.toolName !== "string" ||
          !raw.toolName.trim() ||
          !positive(raw.diameter, 100)
        )
          throw new Error(
            "Invalid tool number, name or diameter in Makera project.",
          );
        const tool: Tool = {
          id: `mks-${raw.toolNumber}`,
          name: raw.toolName,
          kind:
            raw.toolType === 1 && raw.cornerRadius === 0
              ? "flat"
              : "unsupported",
          diameter: raw.diameter,
        };
        if (positive(raw.fluteLength, 2000)) tool.length = raw.fluteLength;
        if (positive(raw.handleDiameter, 100)) tool.shank = raw.handleDiameter;
        if (
          raw.toolType === 2 &&
          positive(raw.angle, 180) &&
          raw.angle < 180 &&
          typeof raw.tipDiameter === "number" &&
          Number.isFinite(raw.tipDiameter) &&
          raw.tipDiameter >= 0 &&
          raw.tipDiameter <= raw.diameter
        ) {
          tool.kind = "v";
          tool.angle = raw.angle;
          tool.tip = raw.tipDiameter;
        }
        if (raw.toolType === 6) {
          tool.pitch = raw.pitch;
          tool.angle = raw.threadAngle;
          tool.neck = positive(raw.neckDiameter, 100)
            ? raw.neckDiameter
            : positive(raw.pitch, 10)
              ? idealThreadNeck(tool.diameter, raw.pitch)
              : undefined;
          if (validThread(tool)) tool.kind = "thread";
          else {
            delete tool.pitch;
            delete tool.angle;
            delete tool.neck;
          }
        }
        tool.note =
          tool.kind === "thread"
            ? "Imported thread angle and pitch. Idealized single-form tooth; neck is estimated when not supplied by Makera."
            : tool.kind === "unsupported"
              ? "Imported from Makera Studio. Special or unverified profile: toolpath only."
              : "Imported from Makera Studio project dimensions.";
        const previous = assignments[raw.toolNumber];
        if (
          previous &&
          [
            "kind",
            "diameter",
            "length",
            "shank",
            "angle",
            "tip",
            "pitch",
            "neck",
          ].some(
            (key) => previous[key as keyof Tool] !== tool[key as keyof Tool],
          )
        )
          throw new Error(
            `T${raw.toolNumber} has conflicting geometries in this project. Assign distinct tool numbers in Makera Studio.`,
          );
        assignments[raw.toolNumber] = tool;
      }
    }
  }
  if (!Object.keys(assignments).length)
    throw new Error("No operation tools found in this Makera project.");
  const materialName = record(stock.material)
    ? stock.material.name
    : stock.material;
  const material =
    typeof materialName === "string" && /alumin(?:um|ium)/i.test(materialName)
      ? "aluminum"
      : undefined;
  return { assignments, dimensions, material };
}

export function importMakeraTools(bytes: Uint8Array): Assignments {
  return importMakeraSetup(bytes).assignments;
}
