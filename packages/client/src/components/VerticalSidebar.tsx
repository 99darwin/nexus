import { useMemo, useCallback, useState, useEffect } from "react";
import type { ForceNode } from "../graph/types";
import { theme } from "../theme";

interface VerticalInfo {
  vertical: string;
  label: string;
  color: string;
  count: number;
  hasRecentActivity: boolean;
}

interface VerticalSidebarProps {
  nodes: ForceNode[];
  activeVerticals: Set<string> | null;
  onVerticalToggle: (vertical: string, multi: boolean) => void;
  onClearFilter: () => void;
  width?: number;
  onWidthChange?: (width: number) => void;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

const VERTICAL_META: Record<string, { label: string; color: string }> = {
  foundation_models: { label: "Foundation Models", color: "#e63946" },
  inference: { label: "Inference", color: "#f4a261" },
  training: { label: "Training", color: "#e76f51" },
  agents: { label: "Agents", color: "#2a9d8f" },
  code_generation: { label: "Code Generation", color: "#264653" },
  multimodal: { label: "Multimodal", color: "#a855f7" },
  safety_alignment: { label: "Safety & Alignment", color: "#ef4444" },
  evaluation: { label: "Evaluation", color: "#f97316" },
  developer_tooling: { label: "Developer Tooling", color: "#06b6d4" },
  enterprise_platforms: { label: "Enterprise Platforms", color: "#8b5cf6" },
  data_infrastructure: { label: "Data Infrastructure", color: "#14b8a6" },
  open_source: { label: "Open Source", color: "#22c55e" },
  hardware: { label: "Hardware", color: "#6366f1" },
  consumer_products: { label: "Consumer Products", color: "#ec4899" },
  creative_tools: { label: "Creative Tools", color: "#d946ef" },
  search_retrieval: { label: "Search & Retrieval", color: "#0ea5e9" },
  robotics: { label: "Robotics", color: "#84cc16" },
  healthcare: { label: "Healthcare", color: "#10b981" },
  finance: { label: "Finance", color: "#f59e0b" },
  research: { label: "Research", color: "#3b82f6" },
  governance_policy: { label: "Governance & Policy", color: "#78716c" },
};

const VERTICAL_ORDER = Object.keys(VERTICAL_META);

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const COLLAPSED_WIDTH = 32;

export function VerticalSidebar({
  nodes,
  activeVerticals,
  onVerticalToggle,
  onClearFilter,
  width: controlledWidth,
  onWidthChange,
  collapsed: controlledCollapsed,
  onCollapsedChange,
}: VerticalSidebarProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const collapsed = controlledCollapsed ?? internalCollapsed;
  const setCollapsed = onCollapsedChange ?? setInternalCollapsed;
  const [internalWidth, setInternalWidth] = useState(200);
  const [isResizing, setIsResizing] = useState(false);

  const width = controlledWidth ?? internalWidth;
  const setWidth = onWidthChange ?? setInternalWidth;

  const verticals = useMemo(() => {
    const counts = new Map<string, number>();
    const recentActivity = new Set<string>();
    const now = Date.now();

    for (const node of nodes) {
      counts.set(node.vertical, (counts.get(node.vertical) ?? 0) + 1);
      if (now - new Date(node.updated_at).getTime() < ONE_DAY_MS) {
        recentActivity.add(node.vertical);
      }
    }

    return VERTICAL_ORDER.filter((v) => counts.has(v)).map(
      (vertical): VerticalInfo => ({
        vertical,
        label: VERTICAL_META[vertical].label,
        color: VERTICAL_META[vertical].color,
        count: counts.get(vertical) ?? 0,
        hasRecentActivity: recentActivity.has(vertical),
      }),
    );
  }, [nodes]);

  const handleClick = useCallback(
    (vertical: string, e: React.MouseEvent) => {
      onVerticalToggle(vertical, e.shiftKey || e.ctrlKey || e.metaKey);
    },
    [onVerticalToggle],
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = Math.max(150, Math.min(500, e.clientX));
      setWidth(newWidth);
    },
    [isResizing],
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    } else {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  if (collapsed) {
    return (
      <div style={collapsedStyle}>
        <button style={toggleBtnStyle} onClick={() => setCollapsed(false)} title="Show verticals">
          &#9654;
        </button>
        {verticals.map((v) => (
          <div
            key={v.vertical}
            style={{
              ...iconDotStyle,
              backgroundColor: v.color,
              opacity: !activeVerticals || activeVerticals.has(v.vertical) ? 1 : 0.2,
            }}
            title={`${v.label} (${v.count})`}
            onClick={(e) => handleClick(v.vertical, e)}
          />
        ))}
      </div>
    );
  }

  return (
    <div style={{ ...containerStyle, width }}>
      <div style={headerStyle}>
        <span
          style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}
        >
          Verticals
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          {activeVerticals && (
            <button style={clearBtnStyle} onClick={onClearFilter}>
              Clear
            </button>
          )}
          <button style={toggleBtnStyle} onClick={() => setCollapsed(true)} title="Collapse">
            &#9664;
          </button>
        </div>
      </div>
      <div style={listStyle}>
        {verticals.map((v) => {
          const isActive = !activeVerticals || activeVerticals.has(v.vertical);
          return (
            <div
              key={v.vertical}
              style={{
                ...rowStyle,
                opacity: isActive ? 1 : 0.3,
                backgroundColor:
                  isActive && activeVerticals ? "rgba(255,255,255,0.05)" : "transparent",
              }}
              onClick={(e) => handleClick(v.vertical, e)}
            >
              <div style={{ ...colorDotStyle, backgroundColor: v.color }} />
              <span style={labelStyle}>{v.label}</span>
              <span style={countStyle}>{v.count}</span>
              {v.hasRecentActivity && <div style={activityDotStyle} />}
            </div>
          );
        })}
      </div>
      <div style={hintStyle}>Shift+click to multi-select</div>
      <div style={resizeHandleStyle} onMouseDown={handleMouseDown} />
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  bottom: 48,
  width: 200,
  backgroundColor: theme.bg.panel,
  backdropFilter: theme.glass.blur,
  WebkitBackdropFilter: theme.glass.blur,
  borderRight: `1px solid ${theme.border.subtle}`,
  display: "flex",
  flexDirection: "column",
  zIndex: 40,
  overflow: "hidden",
};

const collapsedStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  bottom: 48,
  width: 32,
  backgroundColor: theme.bg.panel,
  backdropFilter: theme.glass.blur,
  WebkitBackdropFilter: theme.glass.blur,
  borderRight: `1px solid ${theme.border.subtle}`,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 4,
  paddingTop: 8,
  zIndex: 40,
  overflowY: "auto",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 12px",
  borderBottom: `1px solid ${theme.border.subtle}`,
};

const listStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "4px 0",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "5px 12px",
  cursor: "pointer",
  transition: "opacity 0.15s",
};

const colorDotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "50%",
  flexShrink: 0,
};

const iconDotStyle: React.CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: "50%",
  cursor: "pointer",
  flexShrink: 0,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  flex: 1,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const countStyle: React.CSSProperties = {
  fontSize: 10,
  opacity: 0.5,
  flexShrink: 0,
};

const activityDotStyle: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: "50%",
  backgroundColor: theme.accent.green,
  flexShrink: 0,
};

const clearBtnStyle: React.CSSProperties = {
  padding: "2px 8px",
  fontSize: 10,
  border: `1px solid ${theme.border.default}`,
  borderRadius: 4,
  backgroundColor: "transparent",
  color: theme.text.primary,
  cursor: "pointer",
};

const toggleBtnStyle: React.CSSProperties = {
  padding: "2px 6px",
  fontSize: 10,
  border: "none",
  backgroundColor: "transparent",
  color: "#888",
  cursor: "pointer",
};

const hintStyle: React.CSSProperties = {
  padding: "6px 12px",
  fontSize: 10,
  opacity: 0.3,
  borderTop: "1px solid rgba(255,255,255,0.05)",
};

const resizeHandleStyle: React.CSSProperties = {
  position: "absolute",
  top: 0,
  right: 0,
  bottom: 0,
  width: 4,
  cursor: "col-resize",
  backgroundColor: "transparent",
  transition: "background-color 0.15s",
};
