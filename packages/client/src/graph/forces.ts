import type { VerticalCentroid, ForceNode } from "./types";

type Ring = "core" | "inner" | "mid" | "outer" | "distributed" | "periphery";

const RING_RADIUS: Record<Ring, number> = {
  core: 0,
  inner: 350,
  mid: 650,
  outer: 950,
  distributed: 750,
  periphery: 1100,
};

const RING_STIFFNESS: Record<Ring, number> = {
  core: 0.15,
  inner: 0.1,
  mid: 0.08,
  outer: 0.06,
  distributed: 0.05,
  periphery: 0.03,
};

interface VerticalDef {
  vertical: string;
  ring: Ring;
  angle: number;
}

const VERTICAL_DEFS: VerticalDef[] = [
  { vertical: "foundation_models", ring: "core", angle: 0 },
  { vertical: "inference", ring: "inner", angle: 0 },
  { vertical: "training", ring: "inner", angle: 72 },
  { vertical: "agents", ring: "inner", angle: 144 },
  { vertical: "code_generation", ring: "inner", angle: 216 },
  { vertical: "multimodal", ring: "inner", angle: 288 },
  { vertical: "safety_alignment", ring: "mid", angle: 0 },
  { vertical: "evaluation", ring: "mid", angle: 60 },
  { vertical: "developer_tooling", ring: "mid", angle: 120 },
  { vertical: "enterprise_platforms", ring: "mid", angle: 180 },
  { vertical: "data_infrastructure", ring: "mid", angle: 240 },
  { vertical: "open_source", ring: "mid", angle: 300 },
  { vertical: "hardware", ring: "outer", angle: 0 },
  { vertical: "consumer_products", ring: "outer", angle: 51 },
  { vertical: "creative_tools", ring: "outer", angle: 103 },
  { vertical: "search_retrieval", ring: "outer", angle: 154 },
  { vertical: "robotics", ring: "outer", angle: 206 },
  { vertical: "healthcare", ring: "outer", angle: 257 },
  { vertical: "finance", ring: "outer", angle: 309 },
  { vertical: "research", ring: "distributed", angle: 0 },
  { vertical: "governance_policy", ring: "periphery", angle: 180 },
];

export function generateCentroids(): VerticalCentroid[] {
  return VERTICAL_DEFS.map((def) => {
    const radius = RING_RADIUS[def.ring];
    const angleRad = (def.angle * Math.PI) / 180;
    return {
      vertical: def.vertical,
      x: radius * Math.cos(angleRad),
      y: radius * Math.sin(angleRad),
      z: 0,
      stiffness: RING_STIFFNESS[def.ring],
    };
  });
}

const centroidMap = new Map<string, VerticalCentroid>();
for (const c of generateCentroids()) {
  centroidMap.set(c.vertical, c);
}

export function verticalClusterForce(alpha: number) {
  return (nodes: ForceNode[]) => {
    for (const node of nodes) {
      const centroid = centroidMap.get(node.vertical);
      if (!centroid) continue;

      const dx = (centroid.x - (node.x ?? 0)) * centroid.stiffness * alpha;
      const dy = (centroid.y - (node.y ?? 0)) * centroid.stiffness * alpha;
      const dz = (centroid.z - (node.z ?? 0)) * centroid.stiffness * alpha;

      node.vx = (node.vx ?? 0) + dx;
      node.vy = (node.vy ?? 0) + dy;
      node.vz = (node.vz ?? 0) + dz;
    }
  };
}
