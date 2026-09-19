// 8³ simulation bricks; the render atlas adds a one-node halo (10³)
// and two sign bounds. One page lookup now serves all eight interpolation taps.
import { THREAD_ATLAS_STRIDE } from "./threadLayout";
export { THREAD_ATLAS_STRIDE } from "./threadLayout";
const THREAD_DIRECT_PAGE = /* wgsl */ `
fn threadPage(pages: texture_2d<f32>, tile: vec3i, capacity: u32) -> i32 {
    let cell=tile-vec3i(textureLoad(pages,vec2i(0,0),0).xyz);
    let dims=vec3i(textureLoad(pages,vec2i(1,0),0).xyz);
    if(any(cell<vec3i(0)) || any(cell>=dims)) {return -1;}
    let id=2+cell.x+dims.x*(cell.y+dims.y*cell.z);
    return i32(textureLoad(pages,vec2i(id%2048,id/2048),0).w);
}`;
const THREAD_HASH_PAGE = /* wgsl */ `
fn threadPage(pages: texture_2d<f32>, tile: vec3i, capacity: u32) -> i32 {
  if (any(tile < vec3i(0))) { return -1; }
  var slot = ((u32(tile.x)*73856093u) ^ (u32(tile.y)*19349663u) ^ (u32(tile.z)*83492791u)) & (capacity-1u);
  for (var i=0u; i<capacity; i++) {
    let page = textureLoad(pages, vec2i(i32(slot%2048u), i32(slot/2048u)), 0);
    if (page.w < 0.0) { return -1; }
    if (all(vec3i(page.xyz)==tile)) { return i32(page.w); }
    slot=(slot+1u)&(capacity-1u);
  }
  return -1;
}`;
export const THREAD_FIELD =
  THREAD_HASH_PAGE +
  /* wgsl */ `
fn threadTexel(field: texture_2d<f32>, id: i32) -> f32 {
  return textureLoad(field,vec2i(id%2048,id/2048),0).r;
}
fn threadCoordinates(p: vec3f, stock: vec3f, info: vec4f) -> vec3f {
  var q=p;
  if (info.z>0.5) {
    q.z=stock.z-q.z;
    if(info.w>0.5) { q.x=stock.x-q.x; } else { q.y=stock.y-q.y; }
  }
  return q;
}
fn threadField(field: texture_2d<f32>, pages: texture_2d<f32>, p: vec3f, info: vec4f) -> f32 {
  let uv=p/info.x-vec3f(0.5); let cell=vec3i(floor(uv)); let f=fract(uv);
  if(any(cell<vec3i(-1))) {return info.x*4.0;}
  let tile=max(cell,vec3i(0))/8;
  let page=threadPage(pages,tile,u32(info.y));
  // prepareThreads reserves two samples of padding around every cutter.
  // Consequently no zero crossing can border an unallocated brick.
  if(page<0) {return info.x*4.0;}
  let local=cell-tile*8+vec3i(1);
  let id=page*${THREAD_ATLAS_STRIDE}+local.x+local.y*10+local.z*100;
  let a=mix(threadTexel(field,id),threadTexel(field,id+1),f.x);
  let b=mix(threadTexel(field,id+10),threadTexel(field,id+11),f.x);
  let c=mix(threadTexel(field,id+100),threadTexel(field,id+101),f.x);
  let e=mix(threadTexel(field,id+110),threadTexel(field,id+111),f.x);
  return mix(mix(a,b,f.y),mix(c,e,f.y),f.z);
}
fn threadRemoved(field: texture_2d<f32>, pages: texture_2d<f32>, p: vec3f, stock: vec3f, info: vec4f) -> bool {
  return threadField(field,pages,threadCoordinates(p,stock,info),info)<0.0;
}`;

/** Specialize the page lookup at compile time; do not retain the hash collision
 * loop in every interpolated tap when the table is directly addressable. */
export function threadFieldShader(direct: boolean) {
  if (!direct) return THREAD_FIELD;
  return THREAD_FIELD.replace(THREAD_HASH_PAGE, THREAD_DIRECT_PAGE);
}

export const THREAD_DISTANCE = /* wgsl */ `
// Exact lower envelope of a truncated cone swept along a line segment.
fn threadCone(u: vec2f, d: vec3f, neck: f32, slope: f32, lo: f32, hi: f32, t0: f32, perp2: f32) -> f32 {
  let l2=dot(d.xy,d.xy);
  var t=select(lo,hi,d.z<0.0);
  let slope2=slope*slope*l2;
  if(l2>1e-16 && d.z*d.z<slope2) {
    t=t0-d.z*sqrt(max(0.0,perp2/(l2*(slope2-d.z*d.z))));
    if(perp2<neck*neck) {
      let half=sqrt((neck*neck-perp2)/l2);
      if(d.z<0.0) {t=max(t,t0+half);} else if(d.z>0.0) {t=min(t,t0-half);} else {t=t0;}
    }
    t=clamp(t,lo,hi);
  }
  return d.z*t+max(0.0,length(u-d.xy*t)-neck)*slope;
}
fn threadDistance(p: vec3f,a: vec4f,d: vec4f,profile: vec4f) -> f32 {
  let u=p.xy-a.xy; let l2=dot(d.xy,d.xy);
  var t0=0.0; var perp2=dot(u,u); var lo=0.0; var hi=1.0;
  if(l2>1e-16) {
    t0=dot(u,d.xy)/l2;
    let cross=u.x*d.y-u.y*d.x; perp2=cross*cross/l2;
  }
  let closest=clamp(t0,0.0,1.0);
  let radial=length(u-d.xy*closest)-a.w;
  if(radial>0.0) {return radial;}
  if(l2>1e-16) {
    let half=sqrt(max(0.0,(a.w*a.w-perp2)/l2));
    lo=max(0.0,t0-half);hi=min(1.0,t0+half);
  }
  let low=a.z-profile.y+threadCone(u,d.xyz,d.w,profile.x,lo,hi,t0,perp2);
  let high=a.z+profile.y-threadCone(u,vec3f(d.xy,-d.z),d.w,profile.x,lo,hi,t0,perp2);
  return max(radial,max(low-p.z,p.z-high));
}`;

export const THREAD_SWEEP = /* wgsl */ `
fn sweepThreads(id:u32, count:u32, step:f32, range:vec4u,
 tiles:ptr<storage,array<vec4f>,read>, offsets:ptr<storage,array<u32>,read>, ranges:ptr<storage,array<u32>,read>,
 cuts:ptr<storage,array<vec4f>,read>, values:ptr<storage,array<f32>,read_write>) -> void {
  if(id>=count) {return;}
  let tile=id/512u; let local=id%512u;
  let xyz=vec3f(vec3u(local%8u,(local/8u)%8u,local/64u))+tiles[tile].xyz*8.0;
  let p=(xyz+vec3f(0.5))*step;
  var value=values[id];
  if(range.z==1u) {value=step*4.0;}
  var low=offsets[tile];var high=offsets[tile+1u];let end=high;
  while(low<high) {
    let mid=(low+high)/2u;
    let last=ranges[mid*2u+1u]-1u;
    if(u32(cuts[last*3u+2u].z)<range.x) {low=mid+1u;} else {high=mid;}
  }
  if(range.z==0u) {
    if(low==end) {return;}
    if(u32(cuts[ranges[low*2u]*3u+2u].z)>=range.y) {return;}
  }
  for(var j=low;j<end;j++) {
    var first=ranges[j*2u];let finish=ranges[j*2u+1u];
    if(u32(cuts[first*3u+2u].z)>=range.y) {break;}
    // Seek directly within a long run; never rescan its already-applied prefix.
    var upper=finish;
    while(first<upper) {
      let mid=(first+upper)/2u;
      if(u32(cuts[mid*3u+2u].z)<range.x) {first=mid+1u;} else {upper=mid;}
    }
    for(var cut=first;cut<finish;cut++) {
      let k=cut*3u;
      if(u32(cuts[k+2u].z)>=range.y) {break;}
      value=min(value,threadDistance(p,cuts[k],cuts[k+1u],cuts[k+2u]));
    }
  }
  values[id]=value;
}`;

// Run once after the seek's cutting batches, never per rendered frame. Halos
// come from the final neighbouring values, so they cannot lag behind a cut.
export const THREAD_PACK_VALUE = /* wgsl */ `
fn threadValue(values:ptr<storage,array<f32>,read>, pages:texture_2d<f32>, cell:vec3i, info:vec4f) -> f32 {
  if(any(cell<vec3i(0))) {return info.x*4.0;}
  let page=threadPage(pages,cell/8,u32(info.y));
  if(page<0) {return info.x*4.0;}
  let local=cell%8;
  return values[u32(page*512+local.x+local.y*8+local.z*64)];
}`;
export const THREAD_PACK = /* wgsl */ `
fn packThreads(id:u32, count:u32, info:vec4f, pages:texture_2d<f32>,
 tiles:ptr<storage,array<vec4f>,read>, values:ptr<storage,array<f32>,read>,
 output:texture_storage_2d<r32float,write>) -> void {
  if(id>=count) {return;}
  let tile=id/${THREAD_ATLAS_STRIDE}u;let local=id%${THREAD_ATLAS_STRIDE}u;
  let origin=vec3i(tiles[tile].xyz)*8;
  if(local<1000u) {
    let xyz=vec3i(i32(local%10u),i32((local/10u)%10u),i32(local/100u));
    let value=threadValue(values,pages,origin+xyz-vec3i(1),info);
    textureStore(output,vec2i(i32(id%2048u),i32(id/2048u)),vec4f(value));
  } else if(local==1000u) {
    var lo=info.x*4.0;var hi=-info.x*4.0;
    for(var i=0u;i<1000u;i++) {
      let xyz=vec3i(i32(i%10u),i32((i/10u)%10u),i32(i/100u));
      let value=threadValue(values,pages,origin+xyz-vec3i(1),info);
      lo=min(lo,value);hi=max(hi,value);
    }
    textureStore(output,vec2i(i32(id%2048u),i32(id/2048u)),vec4f(lo));
    textureStore(output,vec2i(i32((id+1u)%2048u),i32((id+1u)/2048u)),vec4f(hi));
  }
}`;

export const THREAD_VOLUME = /* wgsl */ `
fn threadVolume(tile:u32, step:f32, stock:vec3f, info:vec4f, grid:vec4f,
 heights:texture_2d<f32>, lower:texture_2d<f32>, dual:u32,
 tiles:ptr<storage,array<vec4f>,read>, values:ptr<storage,array<f32>,read>, sums:ptr<storage,array<f32>,read_write>) -> void {
  var sum=0.0;
  for(var local=0u;local<512u;local++) {
    if(values[tile*512u+local]>=0.0) {continue;}
    let xyz=(tiles[tile].xyz*8.0+vec3f(vec3u(local%8u,(local/8u)%8u,local/64u)))*step;
    let size=clamp(stock-xyz,vec3f(0.0),vec3f(step));
    if(any(size<=vec3f(0.0))) {continue;}
    let p=threadCoordinates(xyz+size*0.5,stock,info);
    let top=surfaceHeight(heights,p.xy,stock.xy/grid.xy,vec2i(grid.xy));
    var bottom=0.0;
    if(dual==1u) {bottom=surfaceHeight(lower,p.xy,stock.xy/grid.xy,vec2i(grid.xy));}
    sum+=size.x*size.y*max(0.0,min(top,p.z+size.z*0.5)-max(bottom,p.z-size.z*0.5));
  }
  sums[tile]=sum;
}`;
