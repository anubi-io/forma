// Ray traversal of the solid interval between two machined faces.
export const DUAL_TRACE_WGSL = /* wgsl */ `
fn traceSurface(heights: texture_2d<f32>, lower: texture_2d<f32>, tiles: texture_2d<f32>, grid: vec4f, stock: vec3f, camera: vec3f, world: vec3f) -> mat3x3f {
  let miss = mat3x3f(vec3f(0.0), vec3f(0.0), vec3f(0.0));
  let cells = vec2i(grid.xy); let step = stock.xy / grid.xy;
  let epsilon = max(max(stock.x, stock.y), stock.z) * 0.000002;
  let o = vec3f(camera.x + stock.x * 0.5, stock.y * 0.5 - camera.z, camera.y);
  let point = vec3f(world.x + stock.x * 0.5, stock.y * 0.5 - world.z, world.y);
  let d = normalize(point - o);
  let inv = vec3f(1.0) / select(select(vec3f(-1e-20), vec3f(1e-20), d >= vec3f(0.0)), d, abs(d) > vec3f(1e-20));
  let t0 = -o * inv; let t1 = (stock - o) * inv;
  let near3 = min(t0, t1); let far3 = max(t0, t1);
  let entry = max(near3.x, max(near3.y, near3.z));
  let end = min(far3.x, min(far3.y, far3.z));
  var t = max(entry, 0.0);
  if (end + epsilon < t) { return miss; }
  var normal = vec3f(0.0, 0.0, -sign(d.z));
  if (near3.x >= near3.y && near3.x >= near3.z) { normal = vec3f(-sign(d.x), 0.0, 0.0); }
  else if (near3.y >= near3.z) { normal = vec3f(0.0, -sign(d.y), 0.0); }
  let pos = o + d * t;
  let entryH = surfaceHeight(heights, pos.xy, step, cells);
  var hit = entry >= 0.0 && entryH - surfaceHeight(lower, pos.xy, step, cells) > 0.000001 && pos.z <= entryH + epsilon && pos.z >= surfaceHeight(lower, pos.xy, step, cells) - epsilon;
  if (!hit) {
    let direction = vec2i(select(-1, 1, d.x >= 0.0), select(-1, 1, d.y >= 0.0));
    let positive = select(vec2f(0.0), vec2f(1.0), direction > vec2i(0));
    let tileCount = (cells + vec2i(15)) / 16;
    var tile = clamp(vec2i(floor((pos.xy + d.xy * epsilon) / (step * 16.0))), vec2i(0), tileCount - vec2i(1));
    var tileEntry = t;
    // Bound traversal by this surface's grid, including the larger GPU presets.
    for (var tileIteration = 0; tileIteration < tileCount.x + tileCount.y + 2; tileIteration++) {
      if (any(tile < vec2i(0)) || any(tile >= tileCount)) { break; }
      let start = tile * 16; let finish = min(start + vec2i(16), cells);
      let tileBoundary = min((vec2f(tile) + positive) * 16.0 * step, stock.xy);
      let nextTile = (tileBoundary - o.xy) * inv.xy;
      let tileEnd = min(end, min(nextTile.x, nextTile.y));
      let bounds = textureLoad(tiles, tile, 0).rg;
      let lowZ = min(o.z + d.z * tileEntry, o.z + d.z * tileEnd);
      if (bounds.y > 0.000001 && lowZ <= bounds.y + epsilon) {
        {
          let local = o.xy + d.xy * tileEntry;
          var cell = clamp(vec2i(floor((local + d.xy * epsilon) / step)), start, finish - vec2i(1));
          for (var iteration = 0; iteration < 36; iteration++) {
            if (any(cell < start) || any(cell >= finish)) { break; }
            let xy = vec2f(cell) * step;
            let a = vec3f(xy, textureLoad(heights, cell, 0).r);
            let b = vec3f(xy + vec2f(step.x, 0.0), textureLoad(heights, cell + vec2i(1, 0), 0).r);
            let c = vec3f(xy + vec2f(0.0, step.y), textureLoad(heights, cell + vec2i(0, 1), 0).r);
            let e = vec3f(xy + step, textureLoad(heights, cell + vec2i(1), 0).r);
            let r1 = intersectTriangle(o, d, a, b, c); let r2 = intersectTriangle(o, d, b, e, c);
            var candidate = vec4f(0.0, 0.0, 1.0, 1e30);
            if (a.z+b.z+c.z > 0.000001 && surfaceHeight(heights, (o+d*r1.w).xy, step, cells) - surfaceHeight(lower, (o+d*r1.w).xy, step, cells) > 0.000001 && r1.w >= max(0.0, tileEntry-epsilon) && r1.w <= tileEnd+epsilon) { candidate = r1; }
            if (b.z+e.z+c.z > 0.000001 && surfaceHeight(heights, (o+d*r2.w).xy, step, cells) - surfaceHeight(lower, (o+d*r2.w).xy, step, cells) > 0.000001 && r2.w >= max(0.0, tileEntry-epsilon) && r2.w <= tileEnd+epsilon && r2.w < candidate.w) { candidate = r2; }
            let la = vec3f(a.xy, textureLoad(lower, cell, 0).r);
            let lb = vec3f(b.xy, textureLoad(lower, cell + vec2i(1, 0), 0).r);
            let lc = vec3f(c.xy, textureLoad(lower, cell + vec2i(0, 1), 0).r);
            let le = vec3f(e.xy, textureLoad(lower, cell + vec2i(1), 0).r);
            let r3 = intersectTriangle(o, d, la, lc, lb); let r4 = intersectTriangle(o, d, lb, lc, le);
            if (r3.w >= max(0.0, tileEntry-epsilon) && r3.w <= tileEnd+epsilon && r3.w < candidate.w && surfaceHeight(heights, (o+d*r3.w).xy, step, cells) - surfaceHeight(lower, (o+d*r3.w).xy, step, cells) > 0.000001) { candidate = r3; }
            if (r4.w >= max(0.0, tileEntry-epsilon) && r4.w <= tileEnd+epsilon && r4.w < candidate.w && surfaceHeight(heights, (o+d*r4.w).xy, step, cells) - surfaceHeight(lower, (o+d*r4.w).xy, step, cells) > 0.000001) { candidate = r4; }
            if (candidate.w < 1e29) { t = candidate.w; normal = candidate.xyz; hit = true; break; }
            let next = ((vec2f(cell) + positive) * step - o.xy) * inv.xy;
            if (min(next.x, next.y) > tileEnd + epsilon) { break; }
            if (next.x <= next.y) { cell.x += direction.x; }
            if (next.y <= next.x) { cell.y += direction.y; }
          }
        }
      }
      if (hit || tileEnd >= end - epsilon) { break; }
      if (nextTile.x <= nextTile.y) { tile.x += direction.x; }
      if (nextTile.y <= nextTile.x) { tile.y += direction.y; }
      tileEntry = tileEnd;
    }
  }
  if (!hit) {
    let exit = o + d * end;
    let exitH = surfaceHeight(heights, exit.xy, step, cells);
    if (end < 0.0 || exitH - surfaceHeight(lower, exit.xy, step, cells) <= 0.000001 || exit.z > exitH + epsilon || exit.z < surfaceHeight(lower, exit.xy, step, cells) - epsilon) { return miss; }
    t = end; normal = vec3f(0.0, 0.0, sign(d.z));
    if (far3.x <= far3.y && far3.x <= far3.z) { normal = vec3f(sign(d.x), 0.0, 0.0); }
    else if (far3.y <= far3.z) { normal = vec3f(0.0, sign(d.y), 0.0); }
  }
  let p = o + d * t;
  return mat3x3f(vec3f(p.x-stock.x*0.5, p.z, stock.y*0.5-p.y), vec3f(normal.x, normal.z, -normal.y), vec3f(1.0,0.0,0.0));
}`;

export const DUAL_TRACE_GLSL = /* glsl */ `
mat3 traceSurface(sampler2D heights, sampler2D lower, sampler2D tiles, vec4 grid, vec3 stock, vec3 camera, vec3 world) {
  mat3 miss = mat3(0.);
  ivec2 cells = ivec2(grid.xy); vec2 step = stock.xy / grid.xy;
  float epsilon = max(max(stock.x,stock.y),stock.z)*0.000002;
  vec3 o = vec3(camera.x+stock.x*.5,stock.y*.5-camera.z,camera.y);
  vec3 point = vec3(world.x+stock.x*.5,stock.y*.5-world.z,world.y);
  vec3 d = normalize(point-o);
  vec3 safeD = mix(mix(vec3(-1e-20),vec3(1e-20),greaterThanEqual(d,vec3(0.))),d,greaterThan(abs(d),vec3(1e-20)));
  vec3 inv = 1./safeD;
  vec3 t0=-o*inv, t1=(stock-o)*inv;
  vec3 near3=min(t0,t1), far3=max(t0,t1);
  float entry=max(near3.x,max(near3.y,near3.z)), end=min(far3.x,min(far3.y,far3.z));
  float t=max(entry,0.); if(end+epsilon<t) return miss;
  vec3 normal=vec3(0.,0.,-sign(d.z));
  if(near3.x>=near3.y && near3.x>=near3.z) normal=vec3(-sign(d.x),0.,0.);
  else if(near3.y>=near3.z) normal=vec3(0.,-sign(d.y),0.);
  vec3 pos=o+d*t;
  float entryH=surfaceHeight(heights,pos.xy,step,cells);
  bool hit=entry>=0. && entryH-surfaceHeight(lower,pos.xy,step,cells)>0.000001 && pos.z<=entryH+epsilon && pos.z>=surfaceHeight(lower,pos.xy,step,cells)-epsilon;
  if(!hit) {
    ivec2 direction=ivec2(d.x>=0. ? 1:-1,d.y>=0. ? 1:-1);
    vec2 positive=vec2(direction.x>0 ? 1.:0.,direction.y>0 ? 1.:0.);
    ivec2 tileCount=(cells+ivec2(15))/16;
    ivec2 tile=clamp(ivec2(floor((pos.xy+d.xy*epsilon)/(step*16.))),ivec2(0),tileCount-ivec2(1));
    float tileEntry=t;
    for(int tileIteration=0;tileIteration<tileCount.x+tileCount.y+2;tileIteration++) {
      if(any(lessThan(tile,ivec2(0))) || any(greaterThanEqual(tile,tileCount))) break;
      ivec2 start=tile*16, finish=min(start+ivec2(16),cells);
      vec2 tileBoundary=min((vec2(tile)+positive)*16.*step,stock.xy);
      vec2 nextTile=(tileBoundary-o.xy)*inv.xy;
      float tileEnd=min(end,min(nextTile.x,nextTile.y));
      vec2 bounds=texelFetch(tiles,tile,0).rg;
      float lowZ=min(o.z+d.z*tileEntry,o.z+d.z*tileEnd);
      if(bounds.y>0.000001 && lowZ<=bounds.y+epsilon) {
        {
          vec2 local=o.xy+d.xy*tileEntry;
          ivec2 cell=clamp(ivec2(floor((local+d.xy*epsilon)/step)),start,finish-ivec2(1));
          for(int iteration=0;iteration<36;iteration++) {
            if(any(lessThan(cell,start)) || any(greaterThanEqual(cell,finish))) break;
            vec2 xy=vec2(cell)*step;
            vec3 a=vec3(xy,texelFetch(heights,cell,0).r);
            vec3 b=vec3(xy+vec2(step.x,0.),texelFetch(heights,cell+ivec2(1,0),0).r);
            vec3 c=vec3(xy+vec2(0.,step.y),texelFetch(heights,cell+ivec2(0,1),0).r);
            vec3 e=vec3(xy+step,texelFetch(heights,cell+ivec2(1),0).r);
            vec4 r1=intersectTriangle(o,d,a,b,c),r2=intersectTriangle(o,d,b,e,c);
            vec4 candidate=vec4(0.,0.,1.,1e30);
            if(a.z+b.z+c.z>0.000001 && surfaceHeight(heights,(o+d*r1.w).xy,step,cells)-surfaceHeight(lower,(o+d*r1.w).xy,step,cells)>0.000001 && r1.w>=max(0.,tileEntry-epsilon) && r1.w<=tileEnd+epsilon) candidate=r1;
            if(b.z+e.z+c.z>0.000001 && surfaceHeight(heights,(o+d*r2.w).xy,step,cells)-surfaceHeight(lower,(o+d*r2.w).xy,step,cells)>0.000001 && r2.w>=max(0.,tileEntry-epsilon) && r2.w<=tileEnd+epsilon && r2.w<candidate.w) candidate=r2;
            vec3 la=vec3(a.xy,texelFetch(lower,cell,0).r), lb=vec3(b.xy,texelFetch(lower,cell+ivec2(1,0),0).r);
            vec3 lc=vec3(c.xy,texelFetch(lower,cell+ivec2(0,1),0).r), le=vec3(e.xy,texelFetch(lower,cell+ivec2(1),0).r);
            vec4 r3=intersectTriangle(o,d,la,lc,lb),r4=intersectTriangle(o,d,lb,lc,le);
            if(r3.w>=max(0.,tileEntry-epsilon) && r3.w<=tileEnd+epsilon && r3.w<candidate.w && surfaceHeight(heights,(o+d*r3.w).xy,step,cells)-surfaceHeight(lower,(o+d*r3.w).xy,step,cells)>0.000001) candidate=r3;
            if(r4.w>=max(0.,tileEntry-epsilon) && r4.w<=tileEnd+epsilon && r4.w<candidate.w && surfaceHeight(heights,(o+d*r4.w).xy,step,cells)-surfaceHeight(lower,(o+d*r4.w).xy,step,cells)>0.000001) candidate=r4;
            if(candidate.w<1e29) { t=candidate.w;normal=candidate.xyz;hit=true;break; }
            vec2 next=((vec2(cell)+positive)*step-o.xy)*inv.xy;
            if(min(next.x,next.y)>tileEnd+epsilon) break;
            if(next.x<=next.y) cell.x+=direction.x;
            if(next.y<=next.x) cell.y+=direction.y;
          }
        }
      }
      if(hit || tileEnd>=end-epsilon) break;
      if(nextTile.x<=nextTile.y) tile.x+=direction.x;
      if(nextTile.y<=nextTile.x) tile.y+=direction.y;
      tileEntry=tileEnd;
    }
  }
  if(!hit) {
    vec3 exit=o+d*end;
    float exitH=surfaceHeight(heights,exit.xy,step,cells);
    if(end<0. || exitH-surfaceHeight(lower,exit.xy,step,cells)<=0.000001 || exit.z>exitH+epsilon || exit.z<surfaceHeight(lower,exit.xy,step,cells)-epsilon) return miss;
    t=end;normal=vec3(0.,0.,sign(d.z));
    if(far3.x<=far3.y && far3.x<=far3.z) normal=vec3(sign(d.x),0.,0.);
    else if(far3.y<=far3.z) normal=vec3(0.,sign(d.y),0.);
  }
  vec3 p=o+d*t;
  return mat3(vec3(p.x-stock.x*.5,p.z,stock.y*.5-p.y),vec3(normal.x,normal.z,-normal.y),vec3(1.,0.,0.));
}`;
