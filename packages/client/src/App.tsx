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

export function App() {
  const store = useGraphStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const isMobile = useMediaQuery("(max-width: 768px)");

  useEffect(() => {
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#ff6b6b" }}>
        Failed to load graph data: {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#888" }}>
        Loading graph...
      </div>
    );
  }

  return (
    <div style={rootStyle}>
      {/* Main split: feed left, graph right */}
      <div style={splitContainer}>
        {/* Activity Feed — left panel */}
        {!isMobile && (
          <div style={{ width: FEED_WIDTH, flexShrink: 0, height: "100%" }}>
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
            />
          </div>
        )}

        {/* 3D Force Graph — fills remaining space */}
        <div style={{ flex: 1, position: "relative", height: "100%" }}>
          <ForceGraph
            data={store.filteredData}
            onNodeClick={handleNodeClick}
            focusNodeId={focusNodeId}
            highlightNodeIds={store.comparisonNodeIds.size >= 2 ? store.comparisonNodeIds : undefined}
            hoveredNodeId={store.hoveredNodeId}
          />

          {/* Search hint — overlaid on graph area */}
          <div style={searchHintStyle} onClick={() => setShowSearch(true)}>
            <span style={{ opacity: 0.5 }}>Search</span>
            <kbd style={kbdStyle}>{"\u2318"}K</kbd>
          </div>

          {/* Node/edge count */}
          <div style={statsStyle}>
            {store.filteredData.nodes.length} nodes &middot;{" "}
            {store.filteredData.links.length} edges
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
        onChange={(date) => store.setTimeRange(null, date)}
      />

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
