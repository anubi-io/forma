import { expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { OrbitControls } from "three-stdlib";
import { alignCamera } from "../src/scene/cameraAlignment";

it.each([
  ["front", 0, 0, 1],
  ["right", 1, 0, 0],
  ["left", -1, 0, 0],
  ["back", 0, 0, -1],
] as const)("finishes %s exactly aligned even after OrbitControls updates", (_, x, y, z) => {
  const camera = new PerspectiveCamera();
  const controls = new OrbitControls(camera);
  controls.target.set(12, 6, -8);
  camera.position.set(123, 91, 178);
  camera.up.set(0.003, 1, 0.002).normalize();
  const radius = camera.position.distanceTo(controls.target);
  const direction = new Vector3(x, y, z);
  alignCamera(camera, controls.target, direction);
  controls.update();
  expect(camera.position.distanceTo(controls.target)).toBeCloseTo(radius, 10);
  expect(camera.position.clone().sub(controls.target).normalize().distanceTo(direction)).toBeLessThan(1e-12);
  expect(camera.getWorldDirection(new Vector3()).distanceTo(direction.clone().negate())).toBeLessThan(1e-12);
});
