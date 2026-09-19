import type { Assignments, Stock, BottomSetup } from "./types";
import { MATERIALS } from "./data/materials";
import { SIMULATION_QUALITIES, DEFAULT_QUALITY } from "./engine/quality";
import { validThread } from "./engine/threadProfile";
import { upgradeCatalogThreads } from "./data/upgradeTools";
import { validStockOrigin } from "./engine/coordinates";

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
}
export interface WorkspaceProject {
  version: 1;
  code: string;
  filename: string;
  stock: Stock;
  material: string;
  assignments: Assignments;
  demo: boolean;
  setupSource?: string;
  bottom?: BottomSetup;
}
export interface WorkspaceView {
  tab: string;
  setupVisible: boolean;
  resolution: number;
  fraction: number;
  speed: number;
  showPath: boolean;
  showTool: boolean;
  mode: string;
  camera?: CameraPose;
}
export interface WorkspaceSnapshot {
  project: WorkspaceProject;
  view: WorkspaceView;
}

const record = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const inRange = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

export function validProject(p: unknown): p is WorkspaceProject {
  if (
    !record(p) ||
    p.version !== 1 ||
    typeof p.code !== "string" ||
    (p.bottom !== undefined &&
      (!record(p.bottom) ||
        typeof p.bottom.code !== "string" ||
        !p.bottom.code.trim() ||
        typeof p.bottom.filename !== "string" ||
        !["x", "y"].includes(p.bottom.flipAxis) ||
        !["top", "bottom"].includes(p.bottom.firstSide))) ||
    (p.setupSource !== undefined && typeof p.setupSource !== "string") ||
    !record(p.stock) ||
    !["x", "y", "z"].every((k) => inRange(p.stock[k], 0.1, 2000)) ||
    !validStockOrigin(p.stock as Stock) ||
    !MATERIALS.some((m) => m.id === p.material) ||
    !record(p.assignments)
  )
    return false;
  return Object.entries(p.assignments).every(
    ([n, t]) =>
      /^\d+$/.test(n) &&
      record(t) &&
      typeof t.name === "string" &&
      ["flat", "ball", "v", "thread", "unsupported"].includes(t.kind) &&
      (t.kind !== "thread" || validThread(t as import("./types").Tool)) &&
      inRange(t.diameter, Number.MIN_VALUE, 100) &&
      (t.length === undefined || inRange(t.length, Number.MIN_VALUE, 2000)) &&
      (t.shank === undefined || inRange(t.shank, Number.MIN_VALUE, 100)) &&
      (t.kind !== "v" ||
        (inRange(t.angle, Number.MIN_VALUE, 180) &&
          t.angle < 180 &&
          inRange(t.tip, 0, t.diameter))),
  );
}

export const DEFAULT_VIEW: WorkspaceView = {
  tab: "stock",
  setupVisible: true,
  resolution: DEFAULT_QUALITY,
  fraction: 1,
  speed: 1,
  showPath: true,
  showTool: true,
  mode: "iso",
};

export function restoreView(value: unknown): WorkspaceView {
  const v = record(value) ? value : {};
  const tuple = (a: unknown) =>
    Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
  const camera =
    record(v.camera) &&
    tuple(v.camera.position) &&
    tuple(v.camera.target) &&
    inRange(v.camera.zoom, 0.001, 1000)
      ? (v.camera as CameraPose)
      : undefined;
  return {
    tab: ["stock", "tools", "code"].includes(v.tab) ? v.tab : DEFAULT_VIEW.tab,
    setupVisible: typeof v.setupVisible === "boolean" ? v.setupVisible : true,
    resolution: SIMULATION_QUALITIES.some((q) => q.value === v.resolution)
      ? v.resolution
      : DEFAULT_QUALITY,
    fraction: inRange(v.fraction, 0, 1) ? v.fraction : 1,
    speed: [1, 2, 5, 10].includes(v.speed) ? v.speed : 1,
    showPath:
      typeof v.showPath === "boolean" ? v.showPath : DEFAULT_VIEW.showPath,
    showTool:
      typeof v.showTool === "boolean" ? v.showTool : DEFAULT_VIEW.showTool,
    mode: ["iso", "top", "front"].includes(v.mode) ? v.mode : "iso",
    camera,
  };
}

// Separate records keep large G-code out of camera/playback updates. Each save
// is one atomic transaction, started immediately (no debounce lost on reload).
export function createWorkspaceStore(name = "forma-workspace") {
  let connection: Promise<IDBDatabase> | undefined;
  let savedProject: WorkspaceProject | undefined;
  let savedProjectId: string | undefined;
  let pending = Promise.resolve();
  const open = () =>
    (connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("workspace");
      request.onerror = () => {
        connection = undefined;
        reject(request.error);
      };
      request.onblocked = () =>
        reject(new Error("Local storage is blocked by another tab."));
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          connection = undefined;
        };
        resolve(db);
      };
    }));
  return {
    async load(): Promise<WorkspaceSnapshot | undefined> {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("workspace", "readonly");
        const project = tx.objectStore("workspace").get("project");
        const view = tx.objectStore("workspace").get("view");
        tx.onabort = () => reject(tx.error);
        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => {
          if (project.result === undefined) {
            resolve(undefined);
            return;
          }
          if (!validProject(project.result)) {
            reject(new Error("The saved workspace is invalid."));
            return;
          }
          resolve({
            project: {
              ...project.result,
              assignments: upgradeCatalogThreads(project.result.assignments),
              filename:
                typeof project.result.filename === "string"
                  ? project.result.filename
                  : "project.nc",
              demo: project.result.demo === true,
            },
            view: restoreView(view.result),
          });
        };
      });
    },
    save(project: WorkspaceProject, view: WorkspaceView): Promise<void> {
      pending = pending
        .catch(() => {})
        .then(async () => {
          const db = await open();
          return new Promise<void>((resolve, reject) => {
            const tx = db.transaction("workspace", "readwrite");
            const projectId =
              savedProject === project && savedProjectId
                ? savedProjectId
                : crypto.randomUUID();
            tx.onabort = () => reject(tx.error);
            tx.onerror = () => reject(tx.error);
            tx.oncomplete = () => {
              savedProject = project;
              savedProjectId = projectId;
              resolve();
            };
            const store = tx.objectStore("workspace");
            // Another tab may have saved a different project since our last
            // write. Never combine its G-code with this tab's view/settings.
            const currentId = store.get("projectId");
            currentId.onsuccess = () => {
              try {
                if (currentId.result !== projectId) {
                  store.put(project, "project");
                  store.put(projectId, "projectId");
                }
                store.put(view, "view");
              } catch (error) {
                tx.abort();
                reject(error);
              }
            };
          });
        });
      return pending;
    },
  };
}
