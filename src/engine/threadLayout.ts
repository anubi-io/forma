export const THREAD_TILE = 8;
export const THREAD_TEXTURE_WIDTH = 2048;
// 10³ nodes: 8³ core plus a one-node halo on both sides; two sign bounds.
export const THREAD_ATLAS_STRIDE = 1008;
// Include the atlas's final partial row in the 64 MiB field budget.
export const MAX_THREAD_TILES = Math.floor(
  (64 * 1024 * 1024 - THREAD_TEXTURE_WIDTH * 4) /
    ((THREAD_TILE ** 3 + THREAD_ATLAS_STRIDE) * 4),
);
