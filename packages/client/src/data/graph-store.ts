import { useState, useCallback, useMemo } from "react";
import type { GraphData, ForceNode } from "../graph/types";

export interface GraphStore {
  data: GraphData;
  filteredData: GraphData;
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  comparisonNodeIds: Set<string>;
  activeVerticals: Set<string> | null;
  activeEventTypes: Set<string> | null;
  timeRange: { from: Date | null; to: Date | null };
  setData: (data: GraphData) => void;
  selectNode: (id: string | null) => void;
  setHoveredNode: (id: string | null) => void;
  toggleComparison: (id: string) => void;
  clearComparison: () => void;
  toggleVertical: (vertical: string, multi: boolean) => void;
  clearVerticalFilter: () => void;
  toggleEventType: (type: string) => void;
  clearAllFilters: () => void;
  setTimeRange: (from: Date | null, to: Date | null) => void;
  addNode: (node: ForceNode) => void;
  updateNode: (id: string, updates: Partial<ForceNode>) => void;
}

export function useGraphStore(initialData?: GraphData): GraphStore {
  const [data, setData] = useState<GraphData>(initialData ?? { nodes: [], links: [] });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeIdState] = useState<string | null>(null);
  const [comparisonNodeIds, setComparisonNodeIds] = useState<Set<string>>(new Set());
  const [activeVerticals, setActiveVerticals] = useState<Set<string> | null>(null);
  const [activeEventTypes, setActiveEventTypes] = useState<Set<string> | null>(null);
  const [timeRange, setTimeRangeState] = useState<{ from: Date | null; to: Date | null }>({
    from: null,
    to: null,
  });

  const selectNode = useCallback((id: string | null) => {
    setSelectedNodeId(id);
  }, []);

  const setHoveredNode = useCallback((id: string | null) => {
    setHoveredNodeIdState(id);
  }, []);

  const toggleComparison = useCallback((id: string) => {
    setComparisonNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 4) {
        next.add(id);
      }
      return next;
    });
  }, []);

  const clearComparison = useCallback(() => {
    setComparisonNodeIds(new Set());
  }, []);

  const toggleVertical = useCallback((vertical: string, multi: boolean) => {
    setActiveVerticals((prev) => {
      if (!multi) {
        // Single click: if already the sole active, clear filter
        if (prev && prev.size === 1 && prev.has(vertical)) return null;
        return new Set([vertical]);
      }
      // Multi-select: toggle within existing set
      const next = new Set(prev ?? []);
      if (next.has(vertical)) {
        next.delete(vertical);
        return next.size === 0 ? null : next;
      }
      next.add(vertical);
      return next;
    });
  }, []);

  const clearVerticalFilter = useCallback(() => {
    setActiveVerticals(null);
  }, []);

  const toggleEventType = useCallback((type: string) => {
    setActiveEventTypes((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(type)) {
        next.delete(type);
        return next.size === 0 ? null : next;
      }
      next.add(type);
      return next;
    });
  }, []);

  const clearAllFilters = useCallback(() => {
    setActiveVerticals(null);
    setActiveEventTypes(null);
  }, []);

  const setTimeRange = useCallback((from: Date | null, to: Date | null) => {
    setTimeRangeState({ from, to });
  }, []);

  const addNode = useCallback((node: ForceNode) => {
    setData((prev) => ({
      ...prev,
      nodes: [...prev.nodes.filter((n) => n.id !== node.id), node],
    }));
  }, []);

  const updateNode = useCallback((id: string, updates: Partial<ForceNode>) => {
    setData((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === id ? { ...n, ...updates } : n)),
    }));
  }, []);

  const filteredData = useMemo(() => {
    let nodes = data.nodes;
    let links = data.links;

    // Vertical filter
    if (activeVerticals) {
      nodes = nodes.filter((node) => activeVerticals.has(node.vertical));
    }

    // Event type filter — keep nodes that have at least one matching event
    if (activeEventTypes) {
      nodes = nodes.filter((node) => node.events.some((e) => activeEventTypes.has(e.event_type)));
    }

    // Time filter — include nodes that have at least one event in range
    if (timeRange.from || timeRange.to) {
      nodes = nodes.filter((node) => {
        return node.events.some((e) => {
          const ts = new Date(e.timestamp);
          if (timeRange.from && ts < timeRange.from) return false;
          if (timeRange.to && ts > timeRange.to) return false;
          return true;
        });
      });
    }

    // Re-filter links if nodes were filtered
    if (nodes !== data.nodes) {
      const nodeIds = new Set(nodes.map((n) => n.id));
      links = data.links.filter((link) => {
        const sourceId = typeof link.source === "string" ? link.source : link.source.id;
        const targetId = typeof link.target === "string" ? link.target : link.target.id;
        return nodeIds.has(sourceId) && nodeIds.has(targetId);
      });
    }

    return { nodes, links };
  }, [data, activeVerticals, activeEventTypes, timeRange]);

  return {
    data,
    filteredData,
    selectedNodeId,
    hoveredNodeId,
    comparisonNodeIds,
    activeVerticals,
    activeEventTypes,
    timeRange,
    setData,
    selectNode,
    setHoveredNode,
    toggleComparison,
    clearComparison,
    toggleVertical,
    clearVerticalFilter,
    toggleEventType,
    clearAllFilters,
    setTimeRange,
    addNode,
    updateNode,
  };
}
