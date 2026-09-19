import catalog from "./makera.json";
import type { Assignments, Tool } from "../types";

/** Only exact legacy catalog entries can gain a verified thread profile.
 * MKS/custom tools need their own pitch/angle; a name alone is insufficient. */
export function upgradeCatalogThreads(assignments: Assignments): Assignments {
  return Object.fromEntries(
    Object.entries(assignments).map(([id, tool]) => {
      const entry =
        tool.kind === "unsupported"
          ? (catalog.tools as Tool[]).find(
              (t) =>
                t.id === tool.id &&
                t.kind === "thread" &&
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
              pitch: entry.pitch,
              neck: entry.neck,
              note: entry.note,
            }
          : tool,
      ];
    }),
  );
}
