import { useCallback } from "react";
import type { ForceNode } from "../graph/types";
import { nodeColor } from "../graph/visual-encoding";
import { theme } from "../theme";

interface FeedItemProps {
  node: ForceNode;
  event: ForceNode["events"][number];
  isHighlighted: boolean;
  onHover: (id: string | null) => void;
  onClick: (id: string) => void;
}

const EVENT_ICONS: Record<string, string> = {
  launch: "\u{1F680}",
  update: "\u{1F504}",
  paper: "\u{1F4C4}",
  funding: "\u{1F4B0}",
  acquisition: "\u{1F3E2}",
};

function relativeTime(timestamp: string): string {
  const ms = Date.now() - new Date(timestamp).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function truncateUrl(url: string): string {
  try {
    const { hostname, pathname } = new URL(url);
    const path = pathname.length > 20 ? pathname.slice(0, 20) + "\u2026" : pathname;
    return hostname.replace("www.", "") + path;
  } catch {
    return url.slice(0, 40);
  }
}

export function FeedItem({ node, event, isHighlighted, onHover, onClick }: FeedItemProps) {
  const handleMouseEnter = useCallback(() => onHover(node.id), [onHover, node.id]);
  const handleMouseLeave = useCallback(() => onHover(null), [onHover]);
  const handleClick = useCallback(() => onClick(node.id), [onClick, node.id]);

  const icon = EVENT_ICONS[event.event_type] ?? "\u{1F4CB}";

  return (
    <div
      data-node-id={node.id}
      style={{
        ...itemStyle,
        backgroundColor: isHighlighted ? theme.bg.surfaceHover : "transparent",
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      <div style={iconCol}>{icon}</div>
      <div style={contentCol}>
        <div style={titleRow}>
          <span style={{ ...verticalDot, backgroundColor: nodeColor(node.vertical) }} />
          <span style={nodeName}>{node.name}</span>
          <span style={eventType}>{event.event_type}</span>
          <span style={timestamp}>{relativeTime(event.timestamp)}</span>
        </div>
        <div style={summaryStyle}>{event.summary}</div>
        <div style={metaRow}>
          {event.source_url && (
            <a
              href={event.source_url}
              target="_blank"
              rel="noopener noreferrer"
              style={sourceLink}
              onClick={(e) => e.stopPropagation()}
            >
              {truncateUrl(event.source_url)}
            </a>
          )}
          <div style={sigBarBg}>
            <div style={{ ...sigBarFill, width: `${node.significance * 100}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

const itemStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  padding: "10px 14px",
  cursor: "pointer",
  borderBottom: `1px solid ${theme.border.subtle}`,
  transition: "background-color 0.1s",
};

const iconCol: React.CSSProperties = {
  fontSize: 16,
  flexShrink: 0,
  paddingTop: 2,
};

const contentCol: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const titleRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  marginBottom: 3,
};

const verticalDot: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: "50%",
  flexShrink: 0,
};

const nodeName: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 13,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const eventType: React.CSSProperties = {
  fontSize: 10,
  padding: "1px 6px",
  borderRadius: 4,
  backgroundColor: theme.bg.badge,
  color: theme.text.secondary,
  flexShrink: 0,
};

const timestamp: React.CSSProperties = {
  fontSize: 10,
  opacity: 0.4,
  marginLeft: "auto",
  flexShrink: 0,
};

const summaryStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.4,
  opacity: 0.75,
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

const metaRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginTop: 4,
};

const sourceLink: React.CSSProperties = {
  fontSize: 10,
  color: theme.accent.primary,
  textDecoration: "none",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: 180,
};

const sigBarBg: React.CSSProperties = {
  flex: 1,
  height: 3,
  backgroundColor: theme.bg.badge,
  borderRadius: 2,
  overflow: "hidden",
};

const sigBarFill: React.CSSProperties = {
  height: "100%",
  backgroundColor: theme.accent.primary,
  borderRadius: 2,
};
