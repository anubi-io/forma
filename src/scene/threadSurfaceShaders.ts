import { THREAD_ATLAS_STRIDE, THREAD_FIELD } from "../engine/gpuThreadKernels";

export { THREAD_FIELD };

/** Add the volumetric void test to every possible heightfield intersection.
 * Rejected front triangles must not hide a later surface behind a threaded hole. */
export function withThreadMask(source: string) {
  const removed = (p: string) =>
    `threadRemoved(threadFieldTexture, threadPages, ${p}, stock, threadInfo)`;
  return source
    .replace(
      "world: vec3f)",
      "world: vec3f, threadFieldTexture: texture_2d<f32>, threadPages: texture_2d<f32>, threadInfo: vec4f)",
    )
    .replace("var hit = entry >=", `var hit = !${removed("pos")} && entry >=`)
    .replace(
      "plane <= tileEnd + epsilon)",
      `plane <= tileEnd + epsilon && !${removed("o + d * plane")})`,
    )
    .replace(
      /\{ candidate = (r[1-4]); \}/g,
      (_, r: string) =>
        `{ if (!${removed(`o + d * ${r}.w`)}) { candidate = ${r}; } }`,
    )
    .replace("if (end < 0.0 ||", `if (${removed("exit")} || end < 0.0 ||`);
}

export const TRACE_THREADS = /* wgsl */ `
fn traceThreads(heights:texture_2d<f32>, lower:texture_2d<f32>, dual:u32,
 field:texture_2d<f32>, pages:texture_2d<f32>, info:vec4f, grid:vec4f, stock:vec3f,
 boundsMin:vec3f, boundsMax:vec3f,
 camera:vec3f, world:vec3f, base:mat3x3f) -> mat3x3f {
  let worldOrigin=vec3f(camera.x+stock.x*0.5,stock.y*0.5-camera.z,camera.y);
  let worldTarget=vec3f(world.x+stock.x*0.5,stock.y*0.5-world.z,world.y);
  let o=threadCoordinates(worldOrigin,stock,info);
  let d=normalize(threadCoordinates(worldTarget,stock,info)-o);
  let safe=select(select(vec3f(-1e-20),vec3f(1e-20),d>=vec3f(0.0)),d,abs(d)>vec3f(1e-20));
  let inv=1.0/safe;
  let near=min((boundsMin-o)*inv,(boundsMax-o)*inv);let far=max((boundsMin-o)*inv,(boundsMax-o)*inv);
  var t=max(0.0,max(near.x,max(near.y,near.z)));
  var end=min(far.x,min(far.y,far.z));
  if(base[2].x>0.5) {end=min(end,distance(camera,base[0]));}
  if(end<t) {return base;}
  let eps=info.x*0.001;
  let span=info.x*8.0;
  let positive=select(vec3f(0.0),vec3f(1.0),d>=vec3f(0.0));
  var previous=threadField(field,pages,o+d*t,info);
  // Missing bricks skip eight cells at a time. Populated bricks sample at half
  // a cell and refine zero crossings; trilinear fields avoid voxel stair steps.
  let maxIterations=i32(ceil((stock.x+stock.y+stock.z)/info.x*2.0))+8;
  for(var iteration=0;iteration<maxIterations;iteration++) {
    if(t>=end) {break;}
    let p=o+d*(t+eps);
    // Bricks bound interpolation cells, whose origin is half a voxel in.
    let tile=vec3i(floor((p-vec3f(info.x*0.5))/span));
    var advance=info.x*0.5;
    let page=threadPage(pages,tile,u32(info.y));
    if(page<0) {
      let boundary=(vec3f(tile)+positive)*span+vec3f(info.x*0.5);
      let next=(boundary-p)*inv;
      advance=max(advance,min(next.x,min(next.y,next.z))-info.x);
    } else {
      let lo=threadTexel(field,page*${THREAD_ATLAS_STRIDE}+1000);
      let hi=threadTexel(field,page*${THREAD_ATLAS_STRIDE}+1001);
      // A trilinear field cannot cross zero if all 10³ corner samples agree.
      // Skip both solid and removed interiors without treating this implicit
      // cutter field as a Euclidean signed distance (it is not one).
      if(lo>=0.0 || hi<0.0) {
        let boundary=(vec3f(tile)+positive)*span+vec3f(info.x*0.5);
        let next=(boundary-p)*inv;
        advance=max(advance,min(next.x,min(next.y,next.z)));
      }
    }
    let nextT=min(end,t+advance);
    let value=threadField(field,pages,o+d*nextT,info);
    if((previous<0.0)!=(value<0.0)) {
      var lo=t;var hi=nextT;
      for(var refine=0;refine<7;refine++) {
        let mid=(lo+hi)*0.5;
        let v=threadField(field,pages,o+d*mid,info);
        if((v<0.0)==(previous<0.0)) {lo=mid;} else {hi=mid;}
      }
      let at=(lo+hi)*0.5;let q=o+d*at;
      let setupPoint=threadCoordinates(q,stock,info);
      let top=surfaceHeight(heights,setupPoint.xy,stock.xy/grid.xy,vec2i(grid.xy));
      var bottom=0.0;
      if(dual==1u) {bottom=surfaceHeight(lower,setupPoint.xy,stock.xy/grid.xy,vec2i(grid.xy));}
      if(setupPoint.z>bottom+eps && setupPoint.z<top-eps) {
        let h=info.x*0.5;
        var n=-normalize(vec3f(
          threadField(field,pages,q+vec3f(h,0.0,0.0),info)-threadField(field,pages,q-vec3f(h,0.0,0.0),info),
          threadField(field,pages,q+vec3f(0.0,h,0.0),info)-threadField(field,pages,q-vec3f(0.0,h,0.0),info),
          threadField(field,pages,q+vec3f(0.0,0.0,h),info)-threadField(field,pages,q-vec3f(0.0,0.0,h),info)));
        if(info.z>0.5) {n.z=-n.z;if(info.w>0.5){n.x=-n.x;}else{n.y=-n.y;}}
        return mat3x3f(vec3f(setupPoint.x-stock.x*0.5,setupPoint.z,stock.y*0.5-setupPoint.y),vec3f(n.x,n.z,-n.y),vec3f(1.0,0.0,0.0));
      }
    }
    t=nextT;previous=value;
  }
  return base;
}`;
