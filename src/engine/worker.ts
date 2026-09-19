import type {
  Assignments,
  Program,
  Stock,
  Surface,
  BottomSetup,
  WorkOffsets,
} from "../types";
import {
  sequenceProgram,
  SequenceSimulator,
  operationProgram,
  type PreparedSequence,
} from "./sequence";
import { parseProgram } from "./parse";
import { Simulator } from "./simulate";
import { prepareThreads, type PreparedThreads } from "./prepareThreads";
import {
  prepareSimulation,
  tileStatistics,
  type PreparedSimulation,
} from "./prepare";

export type SimulationRequest =
  | {
      type: "load";
      code: string;
      bottom?: BottomSetup;
      workOffsets?: WorkOffsets;
    }
  | {
      type: "configure";
      revision: number;
      stock: Stock;
      tools: Assignments;
      resolution: number;
      fraction: number;
      gpu?: boolean;
      threadsEnabled?: boolean;
    }
  | { type: "seek"; revision: number; fraction: number };

export type SimulationResponse =
  | { type: "program"; program: Program }
  | { type: "surface"; revision: number; surface: Surface }
  | { type: "prepared"; revision: number; prepared: PreparedSimulation }
  | { type: "preparedSequence"; revision: number; prepared: PreparedSequence }
  | { type: "error"; revision?: number; message: string };

let program: Program | undefined,
  simulator: Simulator | SequenceSimulator | undefined,
  bottom: BottomSetup | undefined,
  revision = 0,
  loadError = "Load a program before simulating.";

const threadBuffers = (p?: PreparedThreads) =>
  p
    ? [
        p.cuts.buffer,
        p.tiles.buffer,
        p.pages.buffer,
        ...(p.lookup ? [p.lookup.buffer] : []),
        p.offsets.buffer,
        p.ranges.buffer,
      ]
    : [];

self.onmessage = ({ data }: MessageEvent<SimulationRequest>) => {
  try {
    if (data.type === "load") {
      // Drop both references before parsing: invalid input must never leave a
      // previous program available for subsequent configuration or seek calls.
      program = undefined;
      simulator = undefined;
      bottom = data.bottom;
      try {
        program = parseProgram(data.code, { workOffsets: data.workOffsets });
        if (bottom) {
          let bottomProgram: Program;
          try {
            bottomProgram = parseProgram(bottom.code, {
              workOffsets: data.workOffsets,
            });
          } catch (error) {
            throw new Error(
              `BOTTOM: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          program = sequenceProgram(program, bottomProgram, bottom.firstSide);
        }
      } catch (error) {
        program = undefined;
        loadError = error instanceof Error ? error.message : String(error);
        throw error;
      }
      self.postMessage({
        type: "program",
        program,
      } satisfies SimulationResponse);
      return;
    }
    if (data.type === "configure") {
      revision = data.revision;
      simulator = undefined;
      if (!program) throw new Error(loadError);
      if (data.gpu && bottom) {
        const operations = program.operations!;
        let faces = operations.map((op) =>
          prepareSimulation(
            operationProgram(program!, op),
            data.stock,
            data.tools,
            data.resolution,
          ),
        );
        // Combining opposite faces requires identical sample coordinates.
        // If either side adapts to a dense path, bring both to a shared grid.
        while (
          faces.some((p) => p.nx !== faces[0].nx || p.ny !== faces[0].ny)
        ) {
          const resolution = Math.min(
            ...faces.map((p) => Math.max(p.nx, p.ny)),
          );
          faces = faces.map((p, i) =>
            Math.max(p.nx, p.ny) === resolution
              ? p
              : prepareSimulation(
                  operationProgram(program!, operations[i]),
                  data.stock,
                  data.tools,
                  resolution,
                ),
          );
        }
        const threads = data.threadsEnabled
          ? prepareThreads(
              program,
              data.stock,
              data.tools,
              data.resolution,
              bottom.flipAxis,
            )
          : undefined;
        self.postMessage(
          {
            type: "preparedSequence",
            revision,
            prepared: {
              faces,
              operations,
              flipAxis: bottom.flipAxis,
              threads,
            },
          } satisfies SimulationResponse,
          {
            transfer: [
              ...faces.flatMap((p) => [
                p.cuts.buffer,
                p.offsets.buffer,
                p.indices.buffer,
                p.batchOffsets.buffer,
                p.batchTiles.buffer,
              ]),
              ...threadBuffers(threads),
            ],
          },
        );
        return;
      }
      if (data.gpu) {
        const prepared = prepareSimulation(
          program,
          data.stock,
          data.tools,
          data.resolution,
        );
        prepared.threads = data.threadsEnabled
          ? prepareThreads(program, data.stock, data.tools, data.resolution)
          : undefined;
        self.postMessage(
          { type: "prepared", revision, prepared } satisfies SimulationResponse,
          {
            transfer: [
              prepared.cuts.buffer,
              prepared.offsets.buffer,
              prepared.indices.buffer,
              prepared.batchOffsets.buffer,
              prepared.batchTiles.buffer,
              ...threadBuffers(prepared.threads),
            ],
          },
        );
        return;
      }
      simulator = bottom
        ? new SequenceSimulator(
            program,
            data.stock,
            data.tools,
            data.resolution,
            bottom.flipAxis,
          )
        : new Simulator(program, data.stock, data.tools, data.resolution);
    }
    if (!simulator || data.revision !== revision) return;
    const surface = simulator.seek(data.fraction);
    surface.tiles = tileStatistics(surface.heights, surface);
    surface.backend = "cpu";
    self.postMessage(
      { type: "surface", revision, surface } satisfies SimulationResponse,
      {
        transfer: [
          surface.heights.buffer,
          surface.tiles.buffer,
          ...(surface.lowerHeights ? [surface.lowerHeights.buffer] : []),
        ],
      },
    );
  } catch (error) {
    simulator = undefined;
    self.postMessage({
      type: "error",
      ...(data.type === "load" ? {} : { revision: data.revision }),
      message: error instanceof Error ? error.message : String(error),
    } satisfies SimulationResponse);
  }
};
