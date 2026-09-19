import {
  BoxGeometry,
  Color,
  DataTexture,
  FloatType,
  Mesh,
  NearestFilter,
  PerspectiveCamera,
  RedFormat,
  RenderTarget,
  RGBAFormat,
  Scene,
  WebGPURenderer,
} from "three/webgpu";
import { MATERIALS } from "../../src/data/materials";
import { tileStatistics } from "../../src/engine/prepare";
import { createSurfaceMaterial } from "../../src/scene/RaycastWorkpiece";
import type { Stock } from "../../src/types";

const cpu = new URLSearchParams(location.search).has("cpu");
const renderer = new WebGPURenderer({ forceWebGL: cpu, antialias: true });
await renderer.init();
renderer.setSize(720, 520);
document.body.appendChild(renderer.domElement);
const stock: Stock = { x: 120, y: 90, z: 18, origin: "corner", zOrigin: "top" };
const nx = 360,
  ny = 270;
const heights = new Float32Array((nx + 1) * (ny + 1)).fill(stock.z);
for (let y = 0; y <= ny; y++)
  for (let x = 0; x <= nx; x++) {
    const px = (x / nx) * stock.x,
      py = (y / ny) * stock.y;
    const pocket = Math.hypot(
      Math.max(Math.abs(px - 60) - 20, 0),
      Math.max(Math.abs(py - 45) - 12, 0),
    );
    let height = pocket < 7 ? 7 + Math.max(0, pocket - 5) * 5.5 : stock.z;
    for (const cx of [15, 105])
      for (const cy of [15, 75])
        if (Math.hypot(px - cx, py - cy) < 4) height = 0;
    heights[y * (nx + 1) + x] = height;
  }
const heightTexture = new DataTexture(
  heights,
  nx + 1,
  ny + 1,
  RedFormat,
  FloatType,
);
const tileTexture = new DataTexture(
  tileStatistics(heights, { nx, ny }),
  Math.ceil((nx + 1) / 16),
  Math.ceil((ny + 1) / 16),
  RGBAFormat,
  FloatType,
);
for (const texture of [heightTexture, tileTexture]) {
  texture.minFilter = texture.magFilter = NearestFilter;
  texture.needsUpdate = true;
}
const materials = MATERIALS.map((definition) =>
  createSurfaceMaterial(
    heightTexture,
    tileTexture,
    stock,
    nx,
    ny,
    definition,
    !cpu,
  ),
);
const scene = new Scene();
const mesh = new Mesh(
  new BoxGeometry().scale(1, 1, -1).translate(0.5, 0.5, 0.5),
  materials[0],
);
mesh.frustumCulled = false;
scene.add(mesh);
const camera = new PerspectiveCamera(36, 720 / 520, 0.1, 2000);
const positions = {
  iso: [145, 165, 190],
  top: [0, 280, 0.001],
  end: [240, 65, 60],
} as const;
function setView(view: keyof typeof positions) {
  const [x, y, z] = positions[view];
  camera.position.set(x, y, z);
  camera.lookAt(0, 8, 0);
}

async function materialChecks() {
  const target = new RenderTarget(256, 192);
  const result: {
    id: string;
    view: string;
    mean: number[];
    coverage: number;
    silhouetteMatches: boolean;
  }[] = [];
  renderer.setClearColor(0, 0);
  scene.background = null;
  renderer.setRenderTarget(target);
  try {
    for (const view of ["iso", "top", "end"] as const) {
      setView(view);
      let reference: Uint8Array | undefined;
      for (let i = 0; i < materials.length; i++) {
        mesh.material = materials[i];
        await renderer.renderAsync(scene, camera);
        const pixels = await renderer.readRenderTargetPixelsAsync(
          target,
          0,
          0,
          256,
          192,
        );
        const mask = new Uint8Array(256 * 192);
        const sum = [0, 0, 0];
        let coverage = 0;
        for (let p = 0; p < mask.length; p++) {
          mask[p] = pixels[p * 4 + 3] > 0 ? 1 : 0;
          if (!mask[p]) continue;
          coverage++;
          for (let c = 0; c < 3; c++) sum[c] += pixels[p * 4 + c];
        }
        reference ??= mask;
        result.push({
          id: MATERIALS[i].id,
          view,
          coverage,
          silhouetteMatches: mask.every((v, p) => v === reference![p]),
          mean: sum.map((s) => s / coverage),
        });
      }
    }
  } finally {
    renderer.setRenderTarget(null);
    target.dispose();
  }
  return result;
}

async function gallery(view: keyof typeof positions = "iso") {
  setView(view);
  scene.background = new Color("#f4f4f4");
  document.querySelector("#gallery")?.remove();
  const grid = document.createElement("div");
  grid.id = "gallery";
  grid.style.cssText =
    "display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#dcdcdc;font:15px system-ui;";
  for (let i = 0; i < materials.length; i++) {
    mesh.material = materials[i];
    await renderer.renderAsync(scene, camera);
    const card = document.createElement("div");
    card.style.cssText =
      "background:#f4f4f4;padding-bottom:18px;text-align:center";
    const image = document.createElement("img");
    image.src = renderer.domElement.toDataURL();
    image.style.cssText = "display:block;width:100%";
    await image.decode();
    card.append(image, document.createTextNode(MATERIALS[i].name));
    grid.appendChild(card);
  }
  renderer.domElement.style.display = "none";
  document.body.appendChild(grid);
}

declare global {
  interface Window {
    materialChecks: typeof materialChecks;
    materialGallery: typeof gallery;
    materialsReady: boolean;
  }
}
window.materialChecks = materialChecks;
window.materialGallery = gallery;
window.materialsReady = true;
