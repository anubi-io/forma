export const SIMULATION_QUALITIES = [
  { value: 160, gpuResolution: 800, label: "Draft" },
  { value: 320, gpuResolution: 1600, label: "Balanced" },
  { value: 600, gpuResolution: 3200, label: "Detailed" },
  { value: 2400, gpuResolution: 5600, label: "Ultra-detailed" },
] as const;

// Preset values remain stable in saved workspaces across device/backend changes.
export const DEFAULT_QUALITY = 600;
export const MAX_THREAD_QUALITY = 600;
export const MAX_RESOLUTION = 2400;
// (5600 + 1)² float32 samples fit in the portable 128 MiB storage binding.
export const MAX_GPU_RESOLUTION = 5600;

export function gpuResolutionLimit(
  limits: Pick<
    GPUSupportedLimits,
    "maxTextureDimension2D" | "maxStorageBufferBindingSize" | "maxBufferSize"
  >,
) {
  return Math.max(
    0,
    Math.min(
      MAX_GPU_RESOLUTION,
      limits.maxTextureDimension2D - 1,
      Math.floor(
        Math.sqrt(
          Math.min(limits.maxBufferSize, limits.maxStorageBufferBindingSize) /
            4,
        ),
      ) - 1,
    ),
  );
}

export function presetResolution(value: number, gpuLimit?: number) {
  const preset =
    SIMULATION_QUALITIES.find((q) => q.value === value) ??
    SIMULATION_QUALITIES[2];
  return gpuLimit ? Math.min(preset.gpuResolution, gpuLimit) : preset.value;
}
