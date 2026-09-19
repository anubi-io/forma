import "fake-indexeddb/auto";
import { IDBObjectStore } from "fake-indexeddb";
import { describe, expect, it, vi, afterEach } from "vitest";
import fixture from "./fixtures/slot.forma.json";
import {
  createWorkspaceStore,
  DEFAULT_VIEW,
  restoreView,
  validProject,
  type WorkspaceProject,
  type WorkspaceView,
} from "../src/workspaceStorage";

const project = { ...fixture, demo: false } as WorkspaceProject;
const view: WorkspaceView = {
  tab: "tools",
  setupVisible: false,
  resolution: 2400,
  fraction: 0.37,
  speed: 5,
  showPath: true,
  showTool: true,
  mode: "front",
  camera: { position: [100, 80, -40], target: [12, 8, 3], zoom: 1.5 },
};
let serial = 0;
const name = () => `workspace-test-${++serial}`;
afterEach(() => vi.restoreAllMocks());

describe("local workspace persistence", () => {
  it("round-trips custom XYZ origins and separate work zeros", async () => {
    const db = name();
    const custom: WorkspaceProject = {
      ...project,
      stock: {
        ...project.stock,
        origin: "custom",
        originX: -12.5,
        originY: 23,
        zOrigin: "custom",
        originZ: 17.5,
        workOffsets: { 55: [25, -8, 2], 59.3: [0, 20, 0] },
      },
    };
    expect(validProject(custom)).toBe(true);
    await createWorkspaceStore(db).save(custom, view);
    expect((await createWorkspaceStore(db).load())?.project.stock).toEqual(
      custom.stock,
    );
    expect(validProject(JSON.parse(JSON.stringify(custom)))).toBe(true);
    for (const change of [
      { originX: undefined },
      { originY: "12" },
      { originZ: NaN },
      { workOffsets: { 55: [0, 1] } },
      { workOffsets: { 54: [1, 2, 3] } },
    ])
      expect(
        validProject({ ...custom, stock: { ...custom.stock, ...change } }),
      ).toBe(false);
  });
  it("accepts old backups and corner presets without custom fields", () => {
    expect(validProject(project)).toBe(true);
    for (const origin of [
      "corner",
      "center",
      "front-right",
      "back-left",
      "back-right",
    ])
      expect(
        validProject({ ...project, stock: { ...project.stock, origin } }),
      ).toBe(true);
  });
  it("restores both programs and rejects malformed flip settings", async () => {
    const store = createWorkspaceStore(name());
    const bottom = {
      code: "T7 M6\nG1 X5",
      filename: "bottom.nc",
      firstSide: "bottom" as const,
      flipAxis: "y" as const,
    };
    const twoSided = { ...project, bottom };
    expect(validProject(twoSided)).toBe(true);
    for (const change of [
      { flipAxis: "z" },
      { firstSide: "left" },
      { code: "" },
    ])
      expect(
        validProject({ ...twoSided, bottom: { ...bottom, ...change } }),
      ).toBe(false);
    await store.save(twoSided, view);
    expect((await store.load())?.project.bottom).toEqual(bottom);
  });
  it("starts empty and restores the project and complete view in a new session", async () => {
    const db = name();
    const store = createWorkspaceStore(db);
    expect(await store.load()).toBeUndefined();
    await store.save(project, view);
    expect(await createWorkspaceStore(db).load()).toEqual({ project, view });
  });

  it("stores large G-code beyond localStorage capacity without rewriting it on playback", async () => {
    const store = createWorkspaceStore(name());
    const large = { ...project, code: "G1 X10 Y20\n".repeat(600000) };
    const writes = vi.spyOn(IDBObjectStore.prototype, "put");
    await store.save(large, view);
    await store.save(large, { ...view, fraction: 0.5 });
    expect(
      writes.mock.calls.filter(([, key]) => key === "project"),
    ).toHaveLength(1);
    expect((await store.load())?.project.code).toBe(large.code);
    expect((await store.load())?.view.fraction).toBe(0.5);
  });

  it("keeps rapid import/reset changes ordered and project/view atomic", async () => {
    const store = createWorkspaceStore(name());
    await store.save(project, view);
    const imported = { ...project, code: "T1 M6\nG1 X42", assignments: {} };
    await Promise.all([
      store.save(imported, { ...view, fraction: 0 }),
      store.save(project, { ...view, fraction: 1 }),
    ]);
    expect(await store.load()).toEqual({
      project,
      view: { ...view, fraction: 1 },
    });
  });

  it("reports storage failure, preserves the previous save and allows a retry", async () => {
    const store = createWorkspaceStore(name());
    await store.save(project, view);
    const changed = { ...project, filename: "changed.nc" };
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw new DOMException("Storage full", "QuotaExceededError");
    });
    await expect(store.save(changed, view)).rejects.toThrow("Storage full");
    expect((await store.load())?.project.filename).toBe(project.filename);
    await store.save(changed, view);
    expect((await store.load())?.project.filename).toBe("changed.nc");
  });

  it("does not mix different tabs' projects and display settings", async () => {
    const db = name();
    const first = createWorkspaceStore(db);
    const second = createWorkspaceStore(db);
    await first.save(project, view);
    await second.save(
      { ...project, code: "T99 M6", assignments: {} },
      DEFAULT_VIEW,
    );
    await first.save(project, { ...view, fraction: 0.2 });
    expect(await createWorkspaceStore(db).load()).toEqual({
      project,
      view: { ...view, fraction: 0.2 },
    });
  });

  it("rejects corrupt project data without overwriting it", async () => {
    const store = createWorkspaceStore(name());
    await store.save(
      { ...project, version: 99 } as unknown as WorkspaceProject,
      view,
    );
    await expect(store.load()).rejects.toThrow("invalid");
    expect(
      validProject({
        ...project,
        assignments: { 7: { ...project.assignments[7], diameter: NaN } },
      }),
    ).toBe(false);
    expect(validProject({ ...project, assignments: [] })).toBe(false);
  });

  it("recovers invalid view settings while retaining the usable project", () => {
    expect(
      restoreView({
        resolution: Infinity,
        fraction: -1,
        speed: 0,
        mode: "bad",
        camera: { position: [NaN, 0, 0] },
      }),
    ).toEqual(DEFAULT_VIEW);
    expect(restoreView(view)).toEqual(view);
  });
});
