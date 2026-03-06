import { useMemo } from "react";
import type { ForceNode, ForceLink } from "../graph/types";
import { VERTICAL_COLORS } from "../graph/visual-encoding";
import { theme } from "../theme";

interface ComparisonPanelProps {
  selectedNodes: ForceNode[];
  allLinks: ForceLink[];
  allNodes: ForceNode[];
  onClose: () => void;
  onNavigate: (id: string) => void;
}

interface EdgeInfo {
  relationship: string;
  targetId: string;
  targetName: string;
  confidence: number;
}

function getLinkNodeId(end: string | ForceNode): string {
  return typeof end === "string" ? end : end.id;
}

export function ComparisonPanel({
  selectedNodes,
  allLinks,
  allNodes,
  onClose,
  onNavigate,
}: ComparisonPanelProps) {
  const nodeMap = useMemo(() => new Map(allNodes.map((n) => [n.id, n])), [allNodes]);

  const analysis = useMemo(() => {
    const selectedIds = new Set(selectedNodes.map((n) => n.id));

    // Collect edges per node
    const edgesByNode = new Map<string, EdgeInfo[]>();
    for (const id of selectedIds) {
      edgesByNode.set(id, []);
    }

    for (const link of allLinks) {
      const sourceId = getLinkNodeId(link.source);
      const targetId = getLinkNodeId(link.target);

      if (selectedIds.has(sourceId)) {
        const targetNode = nodeMap.get(targetId);
        edgesByNode.get(sourceId)?.push({
          relationship: link.relationship,
          targetId,
          targetName: targetNode?.name ?? targetId,
          confidence: link.confidence,
        });
      }
      if (selectedIds.has(targetId)) {
        const sourceNode = nodeMap.get(sourceId);
        edgesByNode.get(targetId)?.push({
          relationship: link.relationship,
          targetId: sourceId,
          targetName: sourceNode?.name ?? sourceId,
          confidence: link.confidence,
        });
      }
    }

    // Find shared connections (same target node from multiple selected)
    const targetToNodes = new Map<string, string[]>();
    for (const [nodeId, edges] of edgesByNode) {
      for (const edge of edges) {
        if (selectedIds.has(edge.targetId)) continue;
        const existing = targetToNodes.get(edge.targetId) ?? [];
        if (!existing.includes(nodeId)) existing.push(nodeId);
        targetToNodes.set(edge.targetId, existing);
      }
    }

    const sharedTargets = new Map<string, string[]>();
    const uniqueEdgesByNode = new Map<string, EdgeInfo[]>();

    for (const id of selectedIds) {
      uniqueEdgesByNode.set(id, []);
    }

    for (const [targetId, fromNodes] of targetToNodes) {
      if (fromNodes.length > 1) {
        sharedTargets.set(targetId, fromNodes);
      } else {
        const nodeEdges = edgesByNode.get(fromNodes[0]) ?? [];
        const relevant = nodeEdges.filter((e) => e.targetId === targetId);
        uniqueEdgesByNode.get(fromNodes[0])?.push(...relevant);
      }
    }

    // Direct relationships between selected nodes
    const directLinks: Array<{
      source: string;
      target: string;
      relationship: string;
      confidence: number;
    }> = [];
    for (const link of allLinks) {
      const sourceId = getLinkNodeId(link.source);
      const targetId = getLinkNodeId(link.target);
      if (selectedIds.has(sourceId) && selectedIds.has(targetId)) {
        directLinks.push({
          source: sourceId,
          target: targetId,
          relationship: link.relationship,
          confidence: link.confidence,
        });
      }
    }

    return { edgesByNode, sharedTargets, uniqueEdgesByNode, directLinks };
  }, [selectedNodes, allLinks, nodeMap]);

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>
          Comparing {selectedNodes.length} Entities
        </span>
        <button style={closeBtnStyle} onClick={onClose}>
          &times;
        </button>
      </div>

      <div style={bodyStyle}>
        {/* Selected entities */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Selected</div>
          {selectedNodes.map((node) => (
            <div key={node.id} style={entityRowStyle}>
              <div
                style={{ ...dotStyle, backgroundColor: VERTICAL_COLORS[node.vertical] ?? "#888" }}
              />
              <span style={{ fontSize: 12 }}>{node.name}</span>
              <span style={badgeStyle}>{node.type}</span>
            </div>
          ))}
        </div>

        {/* Direct relationships */}
        {analysis.directLinks.length > 0 && (
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>Direct Relationships</div>
            {analysis.directLinks.map((link, i) => {
              const source = selectedNodes.find((n) => n.id === link.source);
              const target = selectedNodes.find((n) => n.id === link.target);
              return (
                <div key={i} style={edgeRowStyle}>
                  <span style={{ fontSize: 11 }}>{source?.name}</span>
                  <span style={relBadgeStyle}>{link.relationship.replace(/_/g, " ")}</span>
                  <span style={{ fontSize: 11 }}>{target?.name}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Shared connections */}
        {analysis.sharedTargets.size > 0 && (
          <div style={sectionStyle}>
            <div style={{ ...sectionTitleStyle, color: theme.accent.amber }}>
              Shared Connections ({analysis.sharedTargets.size})
            </div>
            {Array.from(analysis.sharedTargets.entries()).map(([targetId, fromNodes]) => {
              const target = nodeMap.get(targetId);
              return (
                <div
                  key={targetId}
                  style={{ ...entityRowStyle, cursor: "pointer" }}
                  onClick={() => onNavigate(targetId)}
                >
                  <div
                    style={{
                      ...dotStyle,
                      backgroundColor: target
                        ? (VERTICAL_COLORS[target.vertical] ?? "#888")
                        : "#888",
                    }}
                  />
                  <span style={{ fontSize: 12 }}>{target?.name ?? targetId}</span>
                  <span style={{ fontSize: 10, opacity: 0.5 }}>
                    via {fromNodes.length} selected
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Unique edges per node */}
        {selectedNodes.map((node) => {
          const unique = analysis.uniqueEdgesByNode.get(node.id) ?? [];
          if (unique.length === 0) return null;
          return (
            <div key={node.id} style={sectionStyle}>
              <div style={sectionTitleStyle}>
                Unique to {node.name} ({unique.length})
              </div>
              {unique.slice(0, 10).map((edge, i) => (
                <div
                  key={i}
                  style={{ ...edgeRowStyle, cursor: "pointer" }}
                  onClick={() => onNavigate(edge.targetId)}
                >
                  <span style={relBadgeStyle}>{edge.relationship.replace(/_/g, " ")}</span>
                  <span style={{ fontSize: 11 }}>{edge.targetName}</span>
                </div>
              ))}
              {unique.length > 10 && (
                <div style={{ fontSize: 10, opacity: 0.4, padding: "2px 0" }}>
                  +{unique.length - 10} more
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  bottom: 48,
  width: 360,
  backgroundColor: theme.bg.panel,
  backdropFilter: theme.glass.blur,
  WebkitBackdropFilter: theme.glass.blur,
  borderLeft: `1px solid ${theme.border.subtle}`,
  display: "flex",
  flexDirection: "column",
  zIndex: 60,
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px 16px",
  borderBottom: `1px solid ${theme.border.subtle}`,
};

const closeBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: theme.text.secondary,
  fontSize: 18,
  cursor: "pointer",
  padding: "2px 6px",
};

const bodyStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "8px 0",
};

const sectionStyle: React.CSSProperties = {
  padding: "8px 16px",
  borderBottom: `1px solid ${theme.border.subtle}`,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 1,
  opacity: 0.6,
  marginBottom: 6,
};

const entityRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "3px 0",
};

const edgeRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "2px 0",
};

const dotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "50%",
  flexShrink: 0,
};

const badgeStyle: React.CSSProperties = {
  fontSize: 9,
  padding: "1px 6px",
  borderRadius: 3,
  backgroundColor: theme.bg.badge,
  marginLeft: "auto",
};

const relBadgeStyle: React.CSSProperties = {
  fontSize: 9,
  padding: "1px 6px",
  borderRadius: 3,
  backgroundColor: theme.accent.primarySubtle,
  color: "#99f6e4",
  whiteSpace: "nowrap",
};
