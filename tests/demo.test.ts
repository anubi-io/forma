import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { demoCode, DEMO_STOCK, DEMO_TOOLS } from "../src/data/demo";
import { parseProgram } from "../src/engine/parse";
import { Simulator } from "../src/engine/simulate";

it("preserves the original tidal relief surface after adding shallow passes", () => {
  const surface = new Simulator(
    parseProgram(demoCode()),
    DEMO_STOCK,
    DEMO_TOOLS,
    600,
  ).seek(1);
  // SHA-256 of the original demo's full Float32 height grid at resolution 600,
  // captured before layering. Includes the relief, pockets, holes and engraving.
  expect(
    createHash("sha256")
      .update(new Uint8Array(surface.heights.buffer))
      .digest("hex"),
  ).toBe("f6983d262c5a816900d0061d75c1d5cb6a8bb0c9b5e90b51a17f797200515739");
});
