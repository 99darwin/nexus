/**
 * Frustum culling: skip rendering nodes outside the camera's view.
 */
import * as THREE from "three";

const _frustum = new THREE.Frustum();
const _projScreenMatrix = new THREE.Matrix4();
const _point = new THREE.Vector3();

/**
 * Create a frustum from a camera for visibility testing.
 */
export function updateFrustum(camera: THREE.Camera): THREE.Frustum {
  _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_projScreenMatrix);
  return _frustum;
}

/**
 * Test if a point (node position) is within the camera frustum.
 */
export function isPointVisible(
  frustum: THREE.Frustum,
  x: number,
  y: number,
  z: number,
  margin: number = 50,
): boolean {
  _point.set(x, y, z);
  // Expand check slightly to avoid pop-in at edges
  for (const plane of frustum.planes) {
    if (plane.distanceToPoint(_point) < -margin) return false;
  }
  return true;
}

/**
 * Filter a list of node positions and return indices of visible nodes.
 */
export function getVisibleNodeIndices(
  camera: THREE.Camera,
  positions: Float32Array,
  margin: number = 50,
): number[] {
  const frustum = updateFrustum(camera);
  const visible: number[] = [];
  const count = positions.length / 3;

  for (let i = 0; i < count; i++) {
    const idx = i * 3;
    if (isPointVisible(frustum, positions[idx], positions[idx + 1], positions[idx + 2], margin)) {
      visible.push(i);
    }
  }

  return visible;
}
