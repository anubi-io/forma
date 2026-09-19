import { useEffect, useMemo, useState } from "react";
import type { Assignments, FlipAxis, Program, Stock } from "./types";
import type { AnalysisReport } from "./engine/analyze";
import type {
  AnalysisRequest,
  AnalysisResponse,
} from "./engine/analysisWorker";

export interface AnalysisState {
  status: "waiting" | "analyzing" | "ready" | "error";
  report?: AnalysisReport;
  error?: string;
  progress?: number;
}
export function useAnalysis(
  program: Program | undefined,
  stock: Stock,
  tools: Assignments,
  material: string,
  flipAxis: FlipAxis,
): AnalysisState {
  const input = useMemo(
    () => ({ program, stock, tools, material, flipAxis }),
    [program, stock, tools, material, flipAxis],
  );
  const [result, setResult] = useState<{
    input: typeof input;
    state: AnalysisState;
  }>();
  useEffect(() => {
    if (!program) return;
    let worker: Worker | undefined;
    let active = true;
    const publish = (state: AnalysisState) => {
      if (active) setResult({ input, state });
    };
    // Reconfiguration cancels both pending and in-flight work. Analysis is not
    // tied to playback, render quality or GPU availability.
    const timer = setTimeout(() => {
      try {
        worker = new Worker(
          new URL("./engine/analysisWorker.ts", import.meta.url),
          { type: "module" },
        );
        worker.onmessage = ({ data }: MessageEvent<AnalysisResponse>) => {
          if ("processed" in data) {
            publish({
              status: "analyzing",
              progress: data.processed / (data.total || 1),
            });
            return;
          }
          publish(
            "report" in data
              ? { status: "ready", report: data.report }
              : { status: "error", error: data.error },
          );
          worker?.terminate();
        };
        worker.onerror = () => {
          publish({
            status: "error",
            error: "Analysis could not finish. Reload the program to retry.",
          });
          worker?.terminate();
        };
        worker.postMessage({ ...input, program } satisfies AnalysisRequest);
      } catch (error) {
        publish({
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : "Unable to start analysis.",
        });
      }
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
      worker?.terminate();
    };
  }, [input, program]);
  if (!program) return { status: "waiting" };
  // Never display a previous setup's green result while a new one is pending.
  return result?.input === input ? result.state : { status: "analyzing" };
}
