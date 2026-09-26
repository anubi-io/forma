import catalog from "./makera.json";
import type { Assignments, Tool } from "../types";

/** Only exact legacy catalog entries can gain a verified cutter profile.
 * MKS/custom tools need their own pitch/angle; a name alone is insufficient. */
export function upgradeCatalogThreads(assignments: Assignments): Assignments {
  return Object.fromEntries(
    Object.entries(assignments).map(([id, tool]) => {
      if (tool.kind === "v" && tool.length === undefined) {
        const entry = (catalog.tools as Tool[]).find(
          (t) =>
            t.id === tool.id &&
            t.kind === "v" &&
            t.diameter === tool.diameter &&
            t.shank === tool.shank &&
            t.angle === tool.angle &&
            t.tip === tool.tip &&
            t.length !== undefined,
        );
        if (entry)
          return [id, { ...tool, length: entry.length, note: entry.note }];
      }
      const entry =
        tool.kind === "unsupported"
          ? (catalog.tools as Tool[]).find(
              (t) =>
                t.id === tool.id &&
                (t.kind === "thread" ||
                  (t.kind === "ball" && t.taperAngle !== undefined)) &&
                t.diameter === tool.diameter &&
                t.shank === tool.shank &&
                t.length === tool.length,
            )
          : undefined;
      return [
        id,
        entry
          ? {
              ...tool,
              kind: entry.kind,
              angle: entry.angle,
              taperAngle: entry.taperAngle,
              pitch: entry.pitch,
              neck: entry.neck,
              note: entry.note,
            }
          : tool,
      ];
    }),
  );
}
