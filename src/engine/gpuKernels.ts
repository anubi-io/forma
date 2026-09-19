// WGSL functions are injected by Three's public node API; no backend internals.
export const CUT_HEIGHT = /* wgsl */ `
fn cutHeight(p: vec2f, a: vec4f, d: vec4f, profile: vec4f, old: f32) -> f32 {
  if (old <= profile.z) { return old; }
  let u = p - a.xy;
  let l2 = dot(d.xy, d.xy);
  var t0 = 0.0;
  var perp2 = dot(u, u);
  var lo = 0.0;
  var hi = 1.0;
  if (l2 > 1e-16) {
    t0 = dot(u, d.xy) / l2;
    // Cross product avoids catastrophic cancellation along long, thin strokes.
    let cross2 = u.x * d.y - u.y * d.x;
    perp2 = cross2 * cross2 / l2;
  }
  let r2 = a.w * a.w;
  if (perp2 > r2) { return old; }
  if (l2 > 1e-16) {
    let halfSpan = sqrt(max(0.0, (r2 - perp2) / l2));
    lo = max(0.0, t0 - halfSpan);
    hi = min(1.0, t0 + halfSpan);
  }
  if (lo > hi) { return old; }
  var t = select(lo, hi, d.z < 0.0);
  if (d.w == 1.0 && l2 > 1e-16) {
    t = clamp(t0 - d.z * sqrt(max(0.0, r2 - perp2)) / sqrt(l2 * (l2 + d.z * d.z)), lo, hi);
  }
  if (d.w == 2.0 && l2 > 1e-16) {
    let slope2 = profile.y * profile.y * l2;
    if (d.z * d.z < slope2) {
      t = t0 - d.z * sqrt(perp2 / (l2 * (slope2 - d.z * d.z)));
      if (perp2 < profile.x * profile.x) {
        let tipHalf = sqrt((profile.x * profile.x - perp2) / l2);
        if (d.z < 0.0) { t = max(t, t0 + tipHalf); }
        else if (d.z > 0.0) { t = min(t, t0 - tipHalf); }
        else { t = t0; }
      }
      t = clamp(t, lo, hi);
    }
  }
  let radial = u - d.xy * t;
  let d2 = dot(radial, radial);
  var h = a.z + d.z * t;
  if (d.w == 1.0) { h += a.w - sqrt(max(0.0, r2 - d2)); }
  if (d.w == 2.0) { h += max(0.0, sqrt(d2) - profile.x) * profile.y; }
  return min(old, max(0.0, h));
}`;

export const SWEEP = /* wgsl */ `
fn sweep(id: u32, dims: vec4u, scale: vec4f, range: vec4u,
  cuts: ptr<storage, array<vec4f>, read>, offsets: ptr<storage, array<u32>, read>,
  indices: ptr<storage, array<u32>, read>, batchList: ptr<storage, array<u32>, read>,
  heights: ptr<storage, array<f32>, read_write>, output: texture_storage_2d<r32float, write>) -> void {
  let local = id % 256u;
  let group = id / 256u;
  if (group >= range.w) { return; }
  let tile = batchList[range.z + group];
  let xy = vec2u((tile % dims.z) * 16u + local % 16u, (tile / dims.z) * 16u + local / 16u);
  if (xy.x >= dims.x || xy.y >= dims.y) { return; }
  let at = xy.y * dims.x + xy.x;
  var h = heights[at];
  var low = offsets[tile];
  var high = offsets[tile + 1u];
  let end = high;
  // Binary search skips the entire prefix of an already simulated toolpath.
  while (low < high) {
    let mid = (low + high) / 2u;
    if (indices[mid] < range.x) { low = mid + 1u; } else { high = mid; }
  }
  for (var j = low; j < end; j++) {
    let segment = indices[j];
    if (segment >= range.y || h <= 0.0) { break; }
    let k = segment * 3u;
    h = cutHeight(vec2f(xy) * scale.xy, cuts[k], cuts[k + 1u], cuts[k + 2u], h);
  }
  heights[at] = h;
  textureStore(output, vec2i(xy), vec4f(h, 0.0, 0.0, 0.0));
}`;

export const RESET = /* wgsl */ `
fn resetSurface(id: u32, dims: vec4u, scale: vec4f,
  heights: ptr<storage, array<f32>, read_write>, output: texture_storage_2d<r32float, write>) -> void {
  if (id >= dims.x * dims.y) { return; }
  heights[id] = scale.z;
  textureStore(output, vec2i(i32(id % dims.x), i32(id / dims.x)), vec4f(scale.z, 0.0, 0.0, 0.0));
}`;

export const RESTORE = /* wgsl */ `
fn restoreSurface(id: u32, dims: vec4u, source: texture_2d<f32>,
  heights: ptr<storage, array<f32>, read_write>, output: texture_storage_2d<r32float, write>) -> void {
  if (id >= dims.x * dims.y) { return; }
  let xy = vec2i(i32(id % dims.x), i32(id / dims.x));
  let h = textureLoad(source, xy, 0).r;
  heights[id] = h;
  textureStore(output, xy, vec4f(h, 0.0, 0.0, 0.0));
}`;

export const STATISTICS = /* wgsl */ `
fn summarizeTile(tile: u32, dims: vec4u, scale: vec4f,
  heights: ptr<storage, array<f32>, read>, sums: ptr<storage, array<f32>, read_write>,
  output: texture_storage_2d<rgba32float, write>) -> void {
  let origin = vec2u((tile % dims.z) * 16u, (tile / dims.z) * 16u);
  var minH = scale.z;
  var maxH = 0.0;
  var sum = 0.0;
  // The extra row/column bounds the rendered cells, while each volume sample
  // belongs to exactly one tile. Edge weights preserve trapezoidal integration.
  for (var y = 0u; y <= 16u; y++) {
    for (var x = 0u; x <= 16u; x++) {
      let xy = origin + vec2u(x, y);
      if (xy.x >= dims.x || xy.y >= dims.y) { continue; }
      let h = heights[xy.y * dims.x + xy.x];
      minH = min(minH, h); maxH = max(maxH, h);
      if (x < 16u && y < 16u) {
        let wx = select(1.0, 0.5, xy.x == 0u || xy.x + 1u == dims.x);
        let wy = select(1.0, 0.5, xy.y == 0u || xy.y + 1u == dims.y);
        sum += max(0.0, scale.z - h) * wx * wy;
      }
    }
  }
  sums[tile] = sum * scale.w;
  textureStore(output, vec2i(i32(tile % dims.z), i32(tile / dims.z)), vec4f(minH, maxH, 0.0, 0.0));
}`;

export const REDUCE = /* wgsl */ `
fn reduceVolume(id: u32, count: u32, sums: ptr<storage, array<f32>, read>, result: ptr<storage, array<f32>, read_write>) -> void {
  var sum = 0.0;
  // A two-stage reduction avoids a contended floating point atomic and keeps
  // the final CPU readback to 256 bytes irrespective of surface resolution.
  for (var i = id; i < count; i += 64u) { sum += sums[i]; }
  result[id] = sum;
}`;
