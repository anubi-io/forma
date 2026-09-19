import type { Assignments, FlipAxis, Program, Stock } from "../types";
import { analyzeProgram, type AnalysisReport } from "./analyze";

export interface AnalysisRequest {
  program: Program;
  stock: Stock;
  tools: Assignments;
  material: string;
  flipAxis: FlipAxis;
}
export type AnalysisResponse =
  | { report: AnalysisReport }
  | { error: string }
  | { processed: number; total: number };
self.onmessage = ({ data }: MessageEvent<AnalysisRequest>) => {
  try {
    self.postMessage({
      report: analyzeProgram(
        data.program,
        data.stock,
        data.tools,
        data.material,
        data.flipAxis,
        {
          onProgress: (processed, total) =>
            self.postMessage({ processed, total } satisfies AnalysisResponse),
        },
      ),
    } satisfies AnalysisResponse);
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error
          ? error.message
          : "Unable to analyze this program.",
    } satisfies AnalysisResponse);
  }
};
