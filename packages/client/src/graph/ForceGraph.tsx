import { useEffect, useRef, useCallback, useMemo } from "react";
import ForceGraph3D from "3d-force-graph";
import * as THREE from "three";
import type { GraphData, ForceNode } from "./types";
import { verticalClusterForce } from "./forces";
import { nodeSize, nodeColor, edgeWidth, edgeColor } from "./visual-encoding";

interface ForceGraphProps {
  data: GraphData;
  onNodeClick?: (node: ForceNode, event?: MouseEvent) => void;
  focusNodeId?: string | null;
  highlightNodeIds?: Set<string>;
  hoveredNodeId?: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GraphInstance = any;

export function ForceGraph({ data, onNodeClick, focusNodeId, highlightNodeIds, hoveredNodeId }: ForceGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<GraphInstance>(null);
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;

  const highlightRef = useRef(highlightNodeIds);
  highlightRef.current = highlightNodeIds;

  const hoveredRef = useRef(hoveredNodeId);
  hoveredRef.current = hoveredNodeId;

  // Build neighbor lookup for hover dimming
  const neighborsOf = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const link of data.links) {
      const sid = typeof link.source === "string" ? link.source : link.source.id;
      const tid = typeof link.target === "string" ? link.target : link.target.id;
      if (!map.has(sid)) map.set(sid, new Set());
      if (!map.has(tid)) map.set(tid, new Set());
      map.get(sid)!.add(tid);
      map.get(tid)!.add(sid);
    }
    return map;
  }, [data.links]);

  const neighborsRef = useRef(neighborsOf);
  neighborsRef.current = neighborsOf;

  const handleResize = useCallback(() => {
    if (graphRef.current && containerRef.current) {
      graphRef.current.width(containerRef.current.clientWidth);
      graphRef.current.height(containerRef.current.clientHeight);
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const graph = (ForceGraph3D as any)()(containerRef.current)
      .graphData(data)
      .nodeId("id")
      .nodeLabel((node: ForceNode) => `${node.name} (${node.type})`)
      .nodeThreeObject((node: ForceNode) => {
        const hl = highlightRef.current;
        const isHighlighted = hl && hl.size >= 2 && hl.has(node.id);
        const isDimmedByComparison = hl && hl.size >= 2 && !hl.has(node.id);

        // Hover dimming: hovered node = full, neighbors = 70%, others = 10%
        const hId = hoveredRef.current;
        const neighbors = neighborsRef.current;
        let hoverOpacity = 1;
        if (hId) {
          if (node.id === hId) {
            hoverOpacity = 1;
          } else if (neighbors.get(hId)?.has(node.id)) {
            hoverOpacity = 0.7;
          } else {
            hoverOpacity = 0.1;
          }
        }

        const color = isHighlighted ? "#d4a520" : nodeColor(node.vertical);
        const size = nodeSize(node.significance);
        const opacity = isDimmedByComparison ? 0.08 : Math.min(0.8, hoverOpacity);

        const geometry = new THREE.SphereGeometry(size / 2, 16, 12);
        const material = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity,
        });
        const sphere = new THREE.Mesh(geometry, material);

        // Add sprite glow for significant nodes (billboard, visible from all angles)
        if (node.significance >= 0.5 && !isDimmedByComparison && hoverOpacity > 0.5) {
          const canvas = document.createElement("canvas");
          canvas.width = 64;
          canvas.height = 64;
          const ctx = canvas.getContext("2d")!;
          const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
          gradient.addColorStop(0, color);
          gradient.addColorStop(0.4, color + "66");
          gradient.addColorStop(1, color + "00");
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, 64, 64);

          const texture = new THREE.CanvasTexture(canvas);
          const spriteMat = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            opacity: 0.2 * opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const sprite = new THREE.Sprite(spriteMat);
          const glowScale = size * 4;
          sprite.scale.set(glowScale, glowScale, 1);
          sphere.add(sprite);
        }

        return sphere;
      })
      .linkSource("source")
      .linkTarget("target")
      .linkWidth((link: { confidence: number }) => edgeWidth(link.confidence))
      .linkColor((link: { relationship: string }) => edgeColor(link.relationship))
      .linkOpacity(0.2)
      .linkVisibility(() => true)
      .linkDirectionalParticles(0)
      .backgroundColor("rgba(0,0,0,0)")
      .showNavInfo(false)
      .warmupTicks(120)
      .cooldownTime(5000)
      .onNodeClick((node: ForceNode, event: MouseEvent) => {
        onNodeClickRef.current?.(node, event);
        if (!event.shiftKey) {
          const distance = 300;
          const distRatio = 1 + distance / Math.hypot(node.x ?? 0, node.y ?? 0, node.z ?? 0);
          graph.cameraPosition(
            {
              x: (node.x ?? 0) * distRatio,
              y: (node.y ?? 0) * distRatio,
              z: (node.z ?? 0) * distRatio,
            },
            node,
            1000,
          );
        }
      });

    // Custom cluster force
    graph.d3Force("cluster", (alpha: number) => {
      verticalClusterForce(alpha)(data.nodes);
    });

    // Tune forces for spread-out layout
    graph.d3Force("charge")?.strength(-350).distanceMax(600);
    graph.d3Force("link")?.distance(100).strength(0.3);

    // Add slight center gravity to prevent infinite drift
    graph.d3Force("center")?.strength(0.02);

    // Camera pulled back to see the whole graph
    graph.cameraPosition({ x: 0, y: 0, z: 1800 });

    graphRef.current = graph;

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      graph._destructor();
    };
  }, [data, handleResize]);

  // Refresh visual encoding when highlights or hover changes
  useEffect(() => {
    if (!graphRef.current) return;
    graphRef.current.nodeThreeObject(graphRef.current.nodeThreeObject());
  }, [highlightNodeIds, hoveredNodeId]);

  // Focus on a specific node when focusNodeId changes
  useEffect(() => {
    if (!focusNodeId || !graphRef.current) return;
    const node = data.nodes.find((n) => n.id === focusNodeId);
    if (!node) return;

    const distance = 300;
    const distRatio = 1 + distance / Math.hypot(node.x ?? 0, node.y ?? 0, node.z ?? 0);
    graphRef.current.cameraPosition(
      {
        x: (node.x ?? 0) * distRatio,
        y: (node.y ?? 0) * distRatio,
        z: (node.z ?? 0) * distRatio,
      },
      node,
      1000,
    );
  }, [focusNodeId, data.nodes]);

  return (
    <div style={gridBackgroundStyle}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

const gridBackgroundStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  backgroundImage: "radial-gradient(rgba(94,234,212,0.035) 1px, transparent 1px)",
  backgroundSize: "24px 24px",
};
