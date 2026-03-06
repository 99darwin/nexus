import { useMemo } from "react";
import type { ForceNode, ForceLink } from "../graph/types";
import { nodeColor } from "../graph/visual-encoding";
import { theme } from "../theme";

interface NodePanelProps {
  node: ForceNode;
  edges: ForceLink[];
  allNodes: ForceNode[];
  allLinks?: ForceLink[];
  onClose: () => void;
  onNavigate: (nodeId: string) => void;
  fullscreen?: boolean;
}

export function NodePanel({ node, edges, allNodes, allLinks, onClose, onNavigate, fullscreen }: NodePanelProps) {
  const nodeMap = new Map(allNodes.map((n) => [n.id, n]));

  const groupedEdges = edges.reduce(
    (acc, edge) => {
      const rel = edge.relationship;
      if (!acc[rel]) acc[rel] = [];
      acc[rel].push(edge);
      return acc;
    },
    {} as Record<string, ForceLink[]>,
  );

  return (
    <div style={fullscreen ? fullscreenPanelStyle : panelStyle}>
      <div style={headerStyle}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, color: theme.text.heading }}>{node.name}</h2>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <span style={{ ...badgeStyle, backgroundColor: nodeColor(node.vertical) }}>
              {node.vertical.replace(/_/g, " ")}
            </span>
            <span style={{ ...badgeStyle, backgroundColor: theme.bg.badge }}>{node.type}</span>
            <span style={{ ...badgeStyle, backgroundColor: statusColor(node.status) }}>
              {node.status}
            </span>
          </div>
        </div>
        <button onClick={onClose} style={closeButtonStyle}>
          &times;
        </button>
      </div>

      <div style={bodyStyle}>
        <div style={significanceBarContainer}>
          <div style={{ fontSize: 12, opacity: 0.6 }}>Significance</div>
          <div style={significanceBarBg}>
            <div
              style={{
                ...significanceBarFill,
                width: `${node.significance * 100}%`,
              }}
            />
          </div>
          <div style={{ fontSize: 12 }}>{(node.significance * 100).toFixed(0)}%</div>
        </div>

        <p style={{ fontSize: 14, lineHeight: 1.5, opacity: 0.85 }}>{node.summary}</p>

        {node.events.length > 0 && (
          <div>
            <h3 style={sectionTitle}>Events</h3>
            {node.events
              .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
              .map((event, i) => (
                <div key={i} style={eventStyle}>
                  <div style={{ fontSize: 11, opacity: 0.5 }}>
                    {new Date(event.timestamp).toLocaleDateString()} &middot; {event.event_type}
                  </div>
                  <div style={{ fontSize: 13 }}>
                    {event.source_url ? (
                      <a
                        href={event.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={sourceLinkStyle}
                      >
                        {event.summary}
                      </a>
                    ) : (
                      event.summary
                    )}
                  </div>
                </div>
              ))}
          </div>
        )}

        {Object.keys(groupedEdges).length > 0 && (
          <div>
            <h3 style={sectionTitle}>Relationships</h3>
            {Object.entries(groupedEdges).map(([rel, relEdges]) => (
              <div key={rel} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 4 }}>
                  {rel.replace(/_/g, " ")}
                </div>
                {relEdges.map((edge, i) => {
                  const sourceId =
                    typeof edge.source === "string" ? edge.source : edge.source.id;
                  const targetId =
                    typeof edge.target === "string" ? edge.target : edge.target.id;
                  const otherId = sourceId === node.id ? targetId : sourceId;
                  const otherNode = nodeMap.get(otherId);
                  return (
                    <div
                      key={i}
                      style={relNodeStyle}
                      onClick={() => onNavigate(otherId)}
                    >
                      <span
                        style={{
                          ...dotStyle,
                          backgroundColor: otherNode
                            ? nodeColor(otherNode.vertical)
                            : "#666",
                        }}
                      />
                      {otherNode?.name ?? otherId}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        <RelatedEvents node={node} edges={edges} nodeMap={nodeMap} onNavigate={onNavigate} />
      </div>
    </div>
  );
}

function RelatedEvents({
  node,
  edges,
  nodeMap,
  onNavigate,
}: {
  node: ForceNode;
  edges: ForceLink[];
  nodeMap: Map<string, ForceNode>;
  onNavigate: (id: string) => void;
}) {
  const neighborEvents = useMemo(() => {
    const neighborIds = new Set<string>();
    for (const edge of edges) {
      const sid = typeof edge.source === "string" ? edge.source : edge.source.id;
      const tid = typeof edge.target === "string" ? edge.target : edge.target.id;
      const otherId = sid === node.id ? tid : sid;
      neighborIds.add(otherId);
    }

    const events: { node: ForceNode; event: ForceNode["events"][number]; ts: number }[] = [];
    for (const nid of neighborIds) {
      const n = nodeMap.get(nid);
      if (!n) continue;
      for (const ev of n.events) {
        events.push({ node: n, event: ev, ts: new Date(ev.timestamp).getTime() });
      }
    }
    return events.sort((a, b) => b.ts - a.ts).slice(0, 10);
  }, [node.id, edges, nodeMap]);

  if (neighborEvents.length === 0) return null;

  return (
    <div>
      <h3 style={sectionTitle}>Related Events</h3>
      {neighborEvents.map((item, i) => (
        <div
          key={i}
          style={{ ...eventStyle, cursor: "pointer" }}
          onClick={() => onNavigate(item.node.id)}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, opacity: 0.5 }}>
            <span
              style={{
                ...dotStyle,
                backgroundColor: nodeColor(item.node.vertical),
              }}
            />
            <span>{item.node.name}</span>
            <span>&middot;</span>
            <span>{item.event.event_type}</span>
            <span style={{ marginLeft: "auto" }}>
              {new Date(item.event.timestamp).toLocaleDateString()}
            </span>
          </div>
          <div style={{ fontSize: 13 }}>
            {item.event.source_url ? (
              <a
                href={item.event.source_url}
                target="_blank"
                rel="noopener noreferrer"
                style={sourceLinkStyle}
                onClick={(e) => e.stopPropagation()}
              >
                {item.event.summary}
              </a>
            ) : (
              item.event.summary
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function statusColor(status: string): string {
  return theme.status[status as keyof typeof theme.status] ?? theme.status.default;
}

const panelStyle: React.CSSProperties = {
  position: "fixed",
  right: 0,
  top: 0,
  bottom: 0,
  width: 380,
  backgroundColor: theme.bg.panel,
  backdropFilter: theme.glass.blur,
  WebkitBackdropFilter: theme.glass.blur,
  borderLeft: `1px solid ${theme.border.subtle}`,
  display: "flex",
  flexDirection: "column",
  zIndex: 100,
  overflowY: "auto",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  padding: 20,
  borderBottom: `1px solid ${theme.border.subtle}`,
};

const closeButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: theme.text.secondary,
  fontSize: 24,
  cursor: "pointer",
  padding: 0,
  lineHeight: 1,
};

const bodyStyle: React.CSSProperties = {
  padding: 20,
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

const badgeStyle: React.CSSProperties = {
  fontSize: 11,
  padding: "2px 8px",
  borderRadius: 4,
  fontWeight: 500,
  textTransform: "capitalize",
};

const sectionTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 1,
  color: theme.text.secondary,
  margin: "16px 0 8px",
};

const eventStyle: React.CSSProperties = {
  padding: "8px 0",
  borderBottom: `1px solid ${theme.border.subtle}`,
};

const relNodeStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "4px 8px",
  cursor: "pointer",
  borderRadius: 4,
  fontSize: 13,
};

const dotStyle: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: "50%",
  flexShrink: 0,
};

const significanceBarContainer: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const significanceBarBg: React.CSSProperties = {
  flex: 1,
  height: 6,
  backgroundColor: theme.bg.badge,
  borderRadius: 3,
  overflow: "hidden",
};

const significanceBarFill: React.CSSProperties = {
  height: "100%",
  backgroundColor: theme.accent.primary,
  borderRadius: 3,
  transition: "width 0.3s",
};

const sourceLinkStyle: React.CSSProperties = {
  color: theme.accent.primary,
  textDecoration: "none",
  borderBottom: `1px solid transparent`,
  transition: "border-color 0.2s",
};

const fullscreenPanelStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: theme.bg.panel,
  backdropFilter: theme.glass.blur,
  WebkitBackdropFilter: theme.glass.blur,
  display: "flex",
  flexDirection: "column",
  zIndex: 100,
  overflowY: "auto",
};
