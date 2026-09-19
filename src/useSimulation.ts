import { useEffect, useRef, useState } from "react";
import type {
  Assignments,
  Program,
  Stock,
  Surface,
  BottomSetup,
} from "./types";
import { STRIDE } from "./types";
import type { SimulationRequest, SimulationResponse } from "./engine/worker";
import type { GpuRuntime, GpuSimulator } from "./engine/gpu";

interface Session {
  worker: Worker;
  revision: number;
  ready: boolean;
  waiting: boolean;
  fatal: boolean;
  sent: number;
  gpu?: Pick<GpuSimulator, "seek" | "dispose">;
  runtime?: GpuRuntime | null;
}

export function useSimulation(
  code: string,
  stock: Stock,
  tools: Assignments,
  resolution: number,
  fraction: number,
  runtime?: GpuRuntime | null,
  bottom?: BottomSetup,
  threadsEnabled = false,
) {
  const [program, setProgram] = useState<Program>();
  const [surface, setSurface] = useState<Surface>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const session = useRef<Session | null>(null);
  // The cutter interpolates every frame, while stock simulation processes only
  // completed segments. Avoid repeatedly dispatching the same stock position.
  const count = program ? program.moves.length / STRIDE : 0;
  const stockFraction = count
    ? Math.floor(Math.max(0, Math.min(1, fraction)) * count) / count
    : fraction;
  const latest = useRef(stockFraction);
  latest.current = stockFraction;
  const run = useRef<() => void>(() => {});

  useEffect(() => {
    setProgram(undefined);
    setSurface(undefined);
    setBusy(true);
    setError("");
    const worker = new Worker(new URL("./engine/worker.ts", import.meta.url), {
      type: "module",
    });
    const current: Session = {
      worker,
      revision: 0,
      ready: false,
      waiting: true,
      fatal: false,
      sent: latest.current,
    };
    session.current = current;
    const sendSeek = () => {
      if (session.current !== current || current.fatal) return;
      current.sent = latest.current;
      current.waiting = true;
      setBusy(true);
      if (current.gpu) {
        const engine = current.gpu;
        const revision = current.revision;
        const valid = () =>
          session.current === current &&
          current.revision === revision &&
          current.gpu === engine;
        void (async () => {
          try {
            while (valid()) {
              const requested = latest.current;
              current.sent = requested;
              const result = await engine.seek(
                requested,
                () => !valid() || latest.current !== requested,
              );
              if (!valid()) return;
              if (result) setSurface(result);
              if (result && requested === latest.current) {
                current.waiting = false;
                current.ready = true;
                setBusy(false);
                return;
              }
            }
          } catch (cause) {
            if (!valid()) return;
            const reason =
              cause instanceof Error ? cause.message : String(cause);
            console.warn(
              "GPU simulation unavailable; continuing on CPU:",
              reason,
            );
            current.runtime?.fail(reason);
          }
        })();
      } else {
        worker.postMessage({
          type: "seek",
          revision: current.revision,
          fraction: current.sent,
        } satisfies SimulationRequest);
      }
    };
    run.current = sendSeek;
    worker.onmessage = async ({ data }: MessageEvent<SimulationResponse>) => {
      if (session.current !== current) return;
      if (data.type === "program") {
        setProgram(data.program);
        return;
      }
      if (data.revision !== undefined && data.revision !== current.revision)
        return;
      if (data.type === "prepared" || data.type === "preparedSequence") {
        const revision = current.revision;
        try {
          const { GpuSimulator } = await import("./engine/gpu");
          const { GpuSequenceSimulator } = await import("./engine/gpuSequence");
          if (
            session.current !== current ||
            current.revision !== revision ||
            !current.runtime
          )
            return;
          current.gpu =
            data.type === "preparedSequence"
              ? new GpuSequenceSimulator(
                  current.runtime.renderer,
                  data.prepared,
                )
              : new GpuSimulator(current.runtime.renderer, data.prepared);
          if (data.prepared.threads) {
            const { GpuThreadSimulator } = await import("./engine/gpuThreads");
            if (session.current !== current || current.revision !== revision)
              return;
            current.gpu = new GpuThreadSimulator(
              current.runtime.renderer,
              current.gpu,
              data.prepared.threads,
            );
          }
          current.ready = true;
          sendSeek();
        } catch (cause) {
          if (session.current === current && current.revision === revision)
            current.runtime?.fail(
              cause instanceof Error ? cause.message : String(cause),
            );
        }
      } else if (data.type === "surface") {
        setSurface(data.surface);
        current.waiting = false;
        current.ready = true;
        setBusy(false);
        if (latest.current !== current.sent) sendSeek();
      } else {
        setError(data.message);
        current.waiting = false;
        current.ready = false;
        setBusy(false);
      }
    };
    worker.onerror = () => {
      if (session.current !== current) return;
      current.fatal = true;
      current.waiting = false;
      current.ready = false;
      setError(
        "Simulation engine error. Reload the page or import another program.",
      );
      setBusy(false);
    };
    worker.postMessage({
      type: "load",
      code,
      bottom,
      workOffsets: stock.workOffsets,
    } satisfies SimulationRequest);
    return () => {
      worker.terminate();
      current.gpu?.dispose();
      if (session.current === current) session.current = null;
    };
  }, [code, bottom, stock.workOffsets]);

  useEffect(() => {
    const current = session.current;
    if (!current || current.fatal) return;
    const revision = ++current.revision;
    current.gpu?.dispose();
    current.gpu = undefined;
    current.runtime = runtime;
    current.ready = false;
    current.waiting = true;
    setBusy(true);
    setError("");
    setSurface(undefined);
    // Parsing can run while the renderer negotiates the device. Configuration
    // waits for that result, so no CPU simulation is thrown away on startup.
    if (runtime === undefined) return;
    const timer = setTimeout(() => {
      if (current.fatal) return;
      current.sent = latest.current;
      current.worker.postMessage({
        type: "configure",
        revision,
        stock,
        tools,
        resolution,
        fraction: current.sent,
        gpu: !!runtime,
        threadsEnabled,
      } satisfies SimulationRequest);
    }, 100);
    return () => clearTimeout(timer);
  }, [code, bottom, stock, tools, resolution, runtime, threadsEnabled]);

  useEffect(() => {
    const current = session.current;
    if (current?.ready && !current.waiting && current.sent !== stockFraction)
      run.current();
  }, [stockFraction]);
  return { program, surface, error, busy };
}
