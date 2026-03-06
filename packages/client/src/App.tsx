import { useState, useEffect, useCallback, useMemo } from "react";
import { ForceGraph } from "./graph/ForceGraph";
import { loadSeedData } from "./data/load-seed-data";
import { loadGraphData } from "./data/load-graph-data";
import { useGraphStore } from "./data/graph-store";
import { SearchPalette } from "./components/SearchPalette";
import { NodePanel } from "./components/NodePanel";
import { TemporalSlider } from "./components/TemporalSlider";
import { ComparisonPanel } from "./components/ComparisonPanel";
import { ActivityFeed } from "./components/ActivityFeed";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { theme } from "./theme";
import type { ForceNode } from "./graph/types";

const FEED_WIDTH = 380;
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

export function App() {
  const store = useGraphStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [showMobileFeed, setShowMobileFeed] = useState(true);
  const isMobile = useMediaQuery("(max-width: 768px)");

  // Load data + auto-refresh every 5 minutes
  useEffect(() => {
    const fetchData = () => {
      loadGraphData()
        .then((data) => {
          store.setData(data);
          setLoading(false);
        })
        .catch((err) => {
          console.warn("API fetch failed, falling back to seed data:", err.message);
          loadSeedData()
            .then((data) => {
              store.setData(data);
              setLoading(false);
            })
            .catch((seedErr) => {
              setError(seedErr.message);
              setLoading(false);
            });
        });
    };

    fetchData();
    const interval = setInterval(fetchData, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowSearch((prev) => !prev);
      }
      if (e.key === "Escape") {
        store.selectNode(null);
        store.clearComparison();
        setShowSearch(false);
        setShowMobileFeed(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [store]);

  const handleNodeClick = useCallback(
    (node: ForceNode, event?: MouseEvent) => {
      if (event?.shiftKey) {
        store.toggleComparison(node.id);
      } else {
        store.selectNode(node.id);
        setFocusNodeId(node.id);
      }
    },
    [store],
  );

  const handleSearchSelect = useCallback(
    (nodeId: string) => {
      setFocusNodeId(nodeId);
      store.selectNode(nodeId);
    },
    [store],
  );

  const handleFeedSelect = useCallback(
    (nodeId: string) => {
      setFocusNodeId(nodeId);
      store.selectNode(nodeId);
    },
    [store],
  );

  const handleBucketSelect = useCallback(
    (from: Date | null, to: Date | null) => {
      store.setTimeRange(from, to);
    },
    [store],
  );

  const handleTimeChange = useCallback(
    (from: Date | null, to: Date | null) => {
      store.setTimeRange(from, to);
    },
    [store],
  );

  // Derive active bucket name from store.timeRange for highlighting sync
  const activeBucketName = useMemo(() => {
    const { from, to } = store.timeRange;
    if (!from && !to) return null;

    const ONE_DAY = 86400000;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // "Today": from = todayStart, to = null
    if (from && !to && Math.abs(from.getTime() - todayStart.getTime()) < 1000) return "Today";
    // "Yesterday": from = yesterdayStart, to = todayStart
    const yesterdayStart = new Date(todayStart.getTime() - ONE_DAY);
    if (
      from &&
      to &&
      Math.abs(from.getTime() - yesterdayStart.getTime()) < 1000 &&
      Math.abs(to.getTime() - todayStart.getTime()) < 1000
    )
      return "Yesterday";
    // "This Week": from = 7d ago, to = null
    if (from && !to && Math.abs(from.getTime() - (Date.now() - 7 * ONE_DAY)) < 2000)
      return "This Week";
    // "This Month": from = 30d ago, to = null
    if (from && !to && Math.abs(from.getTime() - (Date.now() - 30 * ONE_DAY)) < 2000)
      return "This Month";
    // "Older": from = null, to = 30d ago
    if (!from && to && Math.abs(to.getTime() - (Date.now() - 30 * ONE_DAY)) < 2000) return "Older";

    return null;
  }, [store.timeRange]);

  const selectedNode = useMemo(() => {
    if (!store.selectedNodeId) return null;
    return store.filteredData.nodes.find((n) => n.id === store.selectedNodeId) ?? null;
  }, [store.selectedNodeId, store.filteredData.nodes]);

  const selectedEdges = useMemo(() => {
    if (!store.selectedNodeId) return [];
    return store.filteredData.links.filter((link) => {
      const sourceId = typeof link.source === "string" ? link.source : link.source.id;
      const targetId = typeof link.target === "string" ? link.target : link.target.id;
      return sourceId === store.selectedNodeId || targetId === store.selectedNodeId;
    });
  }, [store.selectedNodeId, store.filteredData.links]);

  const comparisonNodes = useMemo(() => {
    if (store.comparisonNodeIds.size < 2) return [];
    return store.filteredData.nodes.filter((n) => store.comparisonNodeIds.has(n.id));
  }, [store.comparisonNodeIds, store.filteredData.nodes]);

  const dateRange = useMemo(() => {
    const dates = store.data.nodes.map((n) => new Date(n.discovered_at).getTime());
    return {
      min: new Date(Math.min(...dates, Date.now() - 365 * 24 * 60 * 60 * 1000)),
      max: new Date(),
    };
  }, [store.data.nodes]);

  const showComparison = comparisonNodes.length >= 2;

  if (error) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          color: "#ff6b6b",
        }}
      >
        Failed to load graph data: {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          color: "#888",
        }}
      >
        Loading graph...
      </div>
    );
  }

  const feedElement = (
    <ActivityFeed
      nodes={store.filteredData.nodes}
      links={store.filteredData.links}
      activeVerticals={store.activeVerticals}
      activeEventTypes={store.activeEventTypes}
      onHoverNode={store.setHoveredNode}
      onSelectNode={handleFeedSelect}
      onVerticalToggle={store.toggleVertical}
      onEventTypeToggle={store.toggleEventType}
      onClearFilters={store.clearAllFilters}
      highlightedNodeId={store.selectedNodeId}
      onBucketSelect={handleBucketSelect}
      activeBucketName={activeBucketName}
    />
  );

  return (
    <div style={rootStyle}>
      {/* Main split: feed left, graph right */}
      <div style={splitContainer}>
        {/* Activity Feed — left panel (desktop) */}
        {!isMobile && (
          <div style={{ width: FEED_WIDTH, flexShrink: 0, height: "100%" }}>{feedElement}</div>
        )}

        {/* 3D Force Graph — fills remaining space */}
        <div style={{ flex: 1, position: "relative", height: "100%" }}>
          <ForceGraph
            data={store.filteredData}
            onNodeClick={handleNodeClick}
            focusNodeId={focusNodeId}
            highlightNodeIds={
              store.comparisonNodeIds.size >= 2 ? store.comparisonNodeIds : undefined
            }
            hoveredNodeId={store.hoveredNodeId}
          />

          {/* Search hint — overlaid on graph area */}
          <div style={searchHintStyle} onClick={() => setShowSearch(true)}>
            <span style={{ opacity: 0.5 }}>Search</span>
            <kbd style={kbdStyle}>{"\u2318"}K</kbd>
          </div>

          {/* Node/edge count */}
          <div style={statsStyle}>
            {store.filteredData.nodes.length} nodes &middot; {store.filteredData.links.length} edges
            {store.comparisonNodeIds.size > 0 && (
              <span style={{ marginLeft: 8, color: theme.accent.amber }}>
                {store.comparisonNodeIds.size} comparing
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Temporal Slider — spans full width at bottom */}
      <TemporalSlider
        minDate={dateRange.min}
        maxDate={dateRange.max}
        value={store.timeRange.to}
        from={store.timeRange.from}
        onChange={handleTimeChange}
      />

      {/* Mobile feed toggle button */}
      {isMobile && (
        <button
          onClick={() => setShowMobileFeed((prev) => !prev)}
          style={mobileFeedToggle}
          aria-label="Toggle activity feed"
        >
          {showMobileFeed ? "\u2715" : "\u2261"}
        </button>
      )}

      {/* Mobile feed overlay */}
      {isMobile && showMobileFeed && (
        <div style={mobileFeedOverlay}>
          <div style={mobileFeedBackdrop} onClick={() => setShowMobileFeed(false)} />
          <div style={mobileFeedDrawer}>{feedElement}</div>
        </div>
      )}

      {/* Overlays */}
      {showSearch && (
        <SearchPalette
          nodes={store.data.nodes}
          onSelect={handleSearchSelect}
          onClose={() => setShowSearch(false)}
          fullscreen={isMobile}
        />
      )}

      {selectedNode && !showComparison && (
        <NodePanel
          node={selectedNode}
          edges={selectedEdges}
          allNodes={store.filteredData.nodes}
          allLinks={store.filteredData.links}
          onClose={() => store.selectNode(null)}
          onNavigate={(id) => {
            setFocusNodeId(id);
            store.selectNode(id);
          }}
          fullscreen={isMobile}
        />
      )}

      {showComparison && (
        <ComparisonPanel
          selectedNodes={comparisonNodes}
          allLinks={store.filteredData.links}
          allNodes={store.filteredData.nodes}
          onClose={() => store.clearComparison()}
          onNavigate={(id) => {
            setFocusNodeId(id);
            store.selectNode(id);
          }}
        />
      )}
    </div>
  );
}

const rootStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100vh",
  overflow: "hidden",
};

const splitContainer: React.CSSProperties = {
  display: "flex",
  flex: 1,
  overflow: "hidden",
};

const searchHintStyle: React.CSSProperties = {
  position: "absolute",
  top: 16,
  left: "50%",
  transform: "translateX(-50%)",
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 14px",
  backgroundColor: theme.bg.surface,
  borderRadius: 8,
  border: `1px solid ${theme.border.subtle}`,
  cursor: "pointer",
  fontSize: 13,
  zIndex: 50,
};

const kbdStyle: React.CSSProperties = {
  padding: "1px 6px",
  backgroundColor: theme.bg.surface,
  borderRadius: 4,
  fontSize: 11,
};

const statsStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 8,
  left: 16,
  fontSize: 12,
  opacity: 0.4,
  zIndex: 50,
};

const mobileFeedToggle: React.CSSProperties = {
  position: "fixed",
  bottom: 64,
  right: 16,
  width: 44,
  height: 44,
  borderRadius: "50%",
  backgroundColor: theme.accent.primary,
  color: "#000",
  border: "none",
  fontSize: 20,
  fontWeight: 700,
  cursor: "pointer",
  zIndex: 100,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
};

const mobileFeedOverlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 90,
  display: "flex",
  flexDirection: "column",
  justifyContent: "flex-end",
};

const mobileFeedBackdrop: React.CSSProperties = {
  flex: 1,
  minHeight: "30%",
  backgroundColor: "rgba(0,0,0,0.4)",
};

const mobileFeedDrawer: React.CSSProperties = {
  height: "70%",
  backgroundColor: theme.bg.panelSolid,
  borderTop: `1px solid ${theme.border.subtle}`,
  borderRadius: "16px 16px 0 0",
  overflow: "hidden",
};
