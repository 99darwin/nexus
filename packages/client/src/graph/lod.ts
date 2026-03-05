/**
 * Level-of-detail system for node rendering.
 * Reduces geometry complexity for distant nodes and switches to point sprites
 * beyond a distance threshold.
 */

export interface LODConfig {
  /** Distance threshold to switch from sphere to point sprite */
  spriteThreshold: number;
  /** Sphere segment count at closest distance */
  maxSegments: number;
  /** Sphere segment count at medium distance */
  midSegments: number;
  /** Minimum sphere segment count before switching to sprite */
  minSegments: number;
}

const DEFAULT_CONFIG: LODConfig = {
  spriteThreshold: 600,
  maxSegments: 16,
  midSegments: 8,
  minSegments: 4,
};

export function getNodeResolution(
  distanceFromCamera: number,
  config: LODConfig = DEFAULT_CONFIG,
): number {
  if (distanceFromCamera > config.spriteThreshold) return 0; // Use sprite
  if (distanceFromCamera > config.spriteThreshold * 0.6) return config.minSegments;
  if (distanceFromCamera > config.spriteThreshold * 0.3) return config.midSegments;
  return config.maxSegments;
}

export function shouldUseSprite(
  distanceFromCamera: number,
  config: LODConfig = DEFAULT_CONFIG,
): boolean {
  return distanceFromCamera > config.spriteThreshold;
}

/**
 * For mobile devices, use reduced geometry across the board.
 */
export function getMobileConfig(): LODConfig {
  return {
    spriteThreshold: 400,
    maxSegments: 8,
    midSegments: 4,
    minSegments: 3,
  };
}
