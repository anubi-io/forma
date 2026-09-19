import type { ImportResult } from "./importWorker";

// Decode/decompress away from the UI thread so loading feedback stays responsive.
export function readImport(bytes: Uint8Array, name: string) {
  return new Promise<Exclude<ImportResult, { type: "error" }>>(
    (resolve, reject) => {
      const worker = new Worker(new URL("./importWorker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = ({ data }: MessageEvent<ImportResult>) => {
        worker.terminate();
        if (data.type === "error") reject(new Error(data.message));
        else resolve(data);
      };
      worker.onerror = () => {
        worker.terminate();
        reject(
          new Error("Unable to read the file. Please try importing it again."),
        );
      };
      worker.postMessage({ bytes, name }, [bytes.buffer]);
    },
  );
}
