import { useMemo, useCallback } from "react";
import type { ForceNode } from "../graph/types";
import { nodeColor } from "../graph/visual-encoding";
import { theme } from "../theme";

interface HotCardsProps {
  nodes: ForceNode[];
  highlightedNodeId: string | null;
  onHover: (id: string | null) => void;
  onClick: (id: string) => void;
}

export function HotCards({ nodes, highlightedNodeId, onHover, onClick }: HotCardsProps) {
  const hotNodes = useMemo(() => {
    return nodes
      .filter((n) => n.events.length > 0)
      .sort((a, b) => b.significance - a.significance)
      .slice(0, 5);
  }, [nodes]);

  if (hotNodes.length === 0) return null;

  return (
    <div style={sectionStyle}>
      <div style={sectionLabel}>What's Hot</div>
      <div style={scrollContainer}>
        {hotNodes.map((node) => (
          <HotCard
            key={node.id}
            node={node}
            isHighlighted={highlightedNodeId === node.id}
            onHover={onHover}
            onClick={onClick}
          />
        ))}
      </div>
    </div>
  );
}

function HotCard({
  node,
  isHighlighted,
  onHover,
  onClick,
}: {
  node: ForceNode;
  isHighlighted: boolean;
  onHover: (id: string | null) => void;
  onClick: (id: string) => void;
}) {
  const handleMouseEnter = useCallback(() => onHover(node.id), [onHover, node.id]);
  const handleMouseLeave = useCallback(() => onHover(null), [onHover]);
  const handleClick = useCallback(() => onClick(node.id), [onClick, node.id]);

  const latestEvent = node.events.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  )[0];

  return (
    <div
      style={{
        ...cardStyle,
        borderColor: isHighlighted ? theme.border.active : theme.border.subtle,
        backgroundColor: isHighlighted ? theme.bg.surfaceActive : theme.bg.surface,
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{ ...colorDot, backgroundColor: nodeColor(node.vertical) }} />
        <span style={cardName}>{node.name}</span>
      </div>
      <div style={cardType}>{node.type}</div>
      {latestEvent && <div style={cardSummary}>{latestEvent.summary}</div>}
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  padding: "10px 14px 6px",
  borderBottom: `1px solid ${theme.border.subtle}`,
};

const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 1.5,
  opacity: 0.4,
  marginBottom: 8,
};

const scrollContainer: React.CSSProperties = {
  display: "flex",
  gap: 8,
  overflowX: "auto",
  paddingBottom: 8,
};

const cardStyle: React.CSSProperties = {
  flexShrink: 0,
  width: 140,
  padding: "8px 10px",
  borderRadius: 8,
  border: `1px solid ${theme.border.subtle}`,
  cursor: "pointer",
  transition: "border-color 0.15s, background-color 0.15s",
};

const colorDot: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: "50%",
  flexShrink: 0,
};

const cardName: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const cardType: React.CSSProperties = {
  fontSize: 10,
  opacity: 0.4,
  textTransform: "capitalize",
  marginBottom: 4,
};

const cardSummary: React.CSSProperties = {
  fontSize: 10,
  lineHeight: 1.3,
  opacity: 0.6,
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};
