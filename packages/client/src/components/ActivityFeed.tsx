import { useMemo, useRef, useEffect } from "react";
import type { ForceNode, ForceLink } from "../graph/types";
import { FilterBar } from "./FilterBar";
import { HotCards } from "./HotCards";
import { FeedItem } from "./FeedItem";
import { theme } from "../theme";

interface ActivityFeedProps {
  nodes: ForceNode[];
  links: ForceLink[];
  activeVerticals: Set<string> | null;
  activeEventTypes: Set<string> | null;
  onHoverNode: (id: string | null) => void;
  onSelectNode: (id: string) => void;
  onVerticalToggle: (vertical: string, multi: boolean) => void;
  onEventTypeToggle: (type: string) => void;
  onClearFilters: () => void;
  highlightedNodeId: string | null;
}

interface FlatEvent {
  node: ForceNode;
  event: ForceNode["events"][number];
  ts: number;
}

function dateBucket(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const ONE_DAY = 86400000;
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const yesterdayStart = todayStart - ONE_DAY;

  if (ts >= todayStart) return "Today";
  if (ts >= yesterdayStart) return "Yesterday";
  if (diff < 7 * ONE_DAY) return "This Week";
  if (diff < 30 * ONE_DAY) return "This Month";
  return "Older";
}

const BUCKET_ORDER = ["Today", "Yesterday", "This Week", "This Month", "Older"];

export function ActivityFeed({
  nodes,
  links,
  activeVerticals,
  activeEventTypes,
  onHoverNode,
  onSelectNode,
  onVerticalToggle,
  onEventTypeToggle,
  onClearFilters,
  highlightedNodeId,
}: ActivityFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Flatten all events from all nodes, sorted by timestamp
  const groupedEvents = useMemo(() => {
    const flat: FlatEvent[] = [];
    for (const node of nodes) {
      for (const event of node.events) {
        // If event type filter is active, skip non-matching events
        if (activeEventTypes && !activeEventTypes.has(event.event_type)) continue;
        flat.push({ node, event, ts: new Date(event.timestamp).getTime() });
      }
    }
    flat.sort((a, b) => b.ts - a.ts);

    const groups = new Map<string, FlatEvent[]>();
    for (const item of flat) {
      const bucket = dateBucket(item.ts);
      const arr = groups.get(bucket);
      if (arr) {
        arr.push(item);
      } else {
        groups.set(bucket, [item]);
      }
    }
    return groups;
  }, [nodes, activeEventTypes]);

  // Auto-scroll to highlighted node's events when graph click sets highlightedNodeId
  useEffect(() => {
    if (!highlightedNodeId || !scrollRef.current) return;
    const el = scrollRef.current.querySelector(`[data-node-id="${highlightedNodeId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightedNodeId]);

  return (
    <div style={feedContainer}>
      <FilterBar
        nodes={nodes}
        activeEventTypes={activeEventTypes}
        activeVerticals={activeVerticals}
        onEventTypeToggle={onEventTypeToggle}
        onVerticalToggle={onVerticalToggle}
        onClearFilters={onClearFilters}
      />

      <HotCards
        nodes={nodes}
        highlightedNodeId={highlightedNodeId}
        onHover={onHoverNode}
        onClick={onSelectNode}
      />

      <div ref={scrollRef} style={eventListStyle}>
        {BUCKET_ORDER.map((bucket) => {
          const events = groupedEvents.get(bucket);
          if (!events || events.length === 0) return null;
          return (
            <div key={bucket}>
              <div style={bucketLabel}>{bucket}</div>
              {events.map((item, i) => (
                <FeedItem
                  key={`${item.node.id}-${item.event.timestamp}-${i}`}
                  node={item.node}
                  event={item.event}
                  isHighlighted={highlightedNodeId === item.node.id}
                  onHover={onHoverNode}
                  onClick={onSelectNode}
                />
              ))}
            </div>
          );
        })}
        {groupedEvents.size === 0 && (
          <div style={emptyState}>No events match current filters</div>
        )}
      </div>
    </div>
  );
}

const feedContainer: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  backgroundColor: theme.bg.panel,
  backdropFilter: theme.glass.blur,
  WebkitBackdropFilter: theme.glass.blur,
  borderRight: `1px solid ${theme.border.subtle}`,
  overflow: "hidden",
};

const eventListStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  overflowX: "hidden",
};

const bucketLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 1.5,
  opacity: 0.35,
  padding: "12px 14px 4px",
  position: "sticky",
  top: 0,
  backgroundColor: theme.bg.panel,
  zIndex: 1,
};

const emptyState: React.CSSProperties = {
  padding: 24,
  textAlign: "center",
  fontSize: 13,
  opacity: 0.4,
};
