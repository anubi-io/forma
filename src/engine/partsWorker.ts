import {
  detectParts,
  isolatePart,
  type DetectedParts,
  type PartGrid,
} from "./parts";
let parts: DetectedParts;
self.onmessage = ({ data }: MessageEvent<PartGrid | { selected: number }>) => {
  if ("selected" in data) {
    const result = isolatePart(parts, data.selected);
    self.postMessage(
      { ...result, selected: data.selected },
      { transfer: [result.heights.buffer] },
    );
  } else {
    parts = detectParts(data);
    if (parts.count < 2) {
      self.postMessage({ count: parts.count });
      return;
    }
    // The worker keeps the snapshot for subsequent isolation requests.
    self.postMessage(parts);
  }
};
