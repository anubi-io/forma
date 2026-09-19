import { Camera, Vector3 } from "three";

/** Finish a cube transition on its exact axis, preserving the orbit target. */
export function alignCamera(camera: Camera, target: Vector3, direction: Vector3) {
  const radius = camera.position.distanceTo(target);
  camera.position.copy(direction).normalize().multiplyScalar(radius).add(target);
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
}
