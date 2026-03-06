/**
 * WebGL instanced rendering utilities for large node counts (>5k).
 * Uses THREE.InstancedMesh for dramatically fewer draw calls.
 */
import * as THREE from "three";

const INSTANCE_THRESHOLD = 5000;

export interface InstancedNodeData {
  mesh: THREE.InstancedMesh;
  colorArray: Float32Array;
}

/**
 * Create an instanced mesh for rendering many spheres efficiently.
 */
export function createInstancedNodes(
  count: number,
  baseRadius: number = 1,
  segments: number = 8,
): InstancedNodeData {
  const geometry = new THREE.SphereGeometry(baseRadius, segments, segments);
  const material = new THREE.MeshPhongMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const colorArray = new Float32Array(count * 3);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(colorArray, 3);

  return { mesh, colorArray };
}

/**
 * Update instance transforms from node position data.
 */
export function updateInstanceTransforms(
  mesh: THREE.InstancedMesh,
  positions: Float32Array,
  sizes: Float32Array,
): void {
  const matrix = new THREE.Matrix4();
  const count = positions.length / 3;

  for (let i = 0; i < count; i++) {
    const idx = i * 3;
    matrix.makeTranslation(positions[idx], positions[idx + 1], positions[idx + 2]);
    matrix.scale(new THREE.Vector3(sizes[i], sizes[i], sizes[i]));
    mesh.setMatrixAt(i, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

/**
 * Update instance colors from a color array.
 */
export function updateInstanceColors(mesh: THREE.InstancedMesh, colors: Float32Array): void {
  if (!mesh.instanceColor) return;
  const attr = mesh.instanceColor as THREE.InstancedBufferAttribute;
  attr.array = colors;
  attr.needsUpdate = true;
}

/**
 * Check if we should use instanced rendering.
 */
export function shouldUseInstancing(nodeCount: number): boolean {
  return nodeCount >= INSTANCE_THRESHOLD;
}
