import { useMemo, useState, useRef, useEffect } from "react";
import type { ForceNode } from "../graph/types";
import { nodeColor } from "../graph/visual-encoding";
import { theme } from "../theme";

interface FilterBarProps {
  nodes: ForceNode[];
  activeEventTypes: Set<string> | null;
  activeVerticals: Set<string> | null;
  onEventTypeToggle: (type: string) => void;
  onVerticalToggle: (vertical: string, multi: boolean) => void;
  onClearFilters: () => void;
}

const EVENT_TYPES: { type: string; icon: string; label: string }[] = [
  { type: "launch", icon: "\u{1F680}", label: "Launch" },
  { type: "update", icon: "\u{1F504}", label: "Update" },
  { type: "paper", icon: "\u{1F4C4}", label: "Paper" },
  { type: "funding", icon: "\u{1F4B0}", label: "Funding" },
  { type: "acquisition", icon: "\u{1F3E2}", label: "Acquisition" },
];

const VERTICAL_META: Record<string, string> = {
  foundation_models: "Foundation Models",
  inference: "Inference",
  training: "Training",
  agents: "Agents",
  code_generation: "Code Generation",
  multimodal: "Multimodal",
  safety_alignment: "Safety & Alignment",
  evaluation: "Evaluation",
  developer_tooling: "Developer Tooling",
  enterprise_platforms: "Enterprise Platforms",
  data_infrastructure: "Data Infrastructure",
  open_source: "Open Source",
  hardware: "Hardware",
  consumer_products: "Consumer Products",
  creative_tools: "Creative Tools",
  search_retrieval: "Search & Retrieval",
  robotics: "Robotics",
  healthcare: "Healthcare",
  finance: "Finance",
  research: "Research",
  governance_policy: "Governance & Policy",
};

export function FilterBar({
  nodes,
  activeEventTypes,
  activeVerticals,
  onEventTypeToggle,
  onVerticalToggle,
  onClearFilters,
}: FilterBarProps) {
  const [showVerticalDropdown, setShowVerticalDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const eventTypeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of nodes) {
      for (const event of node.events) {
        counts.set(event.event_type, (counts.get(event.event_type) ?? 0) + 1);
      }
    }
    return counts;
  }, [nodes]);

  const verticalCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of nodes) {
      counts.set(node.vertical, (counts.get(node.vertical) ?? 0) + 1);
    }
    return counts;
  }, [nodes]);

  const hasFilters = activeEventTypes !== null || activeVerticals !== null;

  useEffect(() => {
    if (!showVerticalDropdown) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowVerticalDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showVerticalDropdown]);

  return (
    <div style={barStyle}>
      <div style={chipsRow}>
        {EVENT_TYPES.map(({ type, icon, label }) => {
          const count = eventTypeCounts.get(type) ?? 0;
          const isActive = activeEventTypes?.has(type) ?? false;
          return (
            <button
              key={type}
              style={{
                ...chipStyle,
                backgroundColor: isActive ? theme.bg.surfaceActive : theme.bg.surface,
                borderColor: isActive ? theme.border.chipActive : theme.border.subtle,
              }}
              onClick={() => onEventTypeToggle(type)}
            >
              <span>{icon}</span>
              <span>{label}</span>
              {count > 0 && <span style={countBadge}>{count}</span>}
            </button>
          );
        })}

        <div ref={dropdownRef} style={{ position: "relative" }}>
          <button
            style={{
              ...chipStyle,
              backgroundColor: activeVerticals ? theme.bg.surfaceActive : theme.bg.surface,
              borderColor: activeVerticals ? theme.border.chipActive : theme.border.subtle,
            }}
            onClick={() => setShowVerticalDropdown((p) => !p)}
          >
            <span>Verticals</span>
            <span style={{ fontSize: 8 }}>{showVerticalDropdown ? "\u25B2" : "\u25BC"}</span>
            {activeVerticals && <span style={countBadge}>{activeVerticals.size}</span>}
          </button>

          {showVerticalDropdown && (
            <div style={dropdownStyle}>
              {Object.entries(VERTICAL_META).map(([key, label]) => {
                const count = verticalCounts.get(key) ?? 0;
                if (count === 0) return null;
                const isActive = !activeVerticals || activeVerticals.has(key);
                return (
                  <div
                    key={key}
                    style={{
                      ...dropdownItemStyle,
                      opacity: isActive ? 1 : 0.4,
                    }}
                    onClick={(e) => {
                      onVerticalToggle(key, e.shiftKey || e.ctrlKey || e.metaKey);
                    }}
                  >
                    <span style={{ ...colorDot, backgroundColor: nodeColor(key) }} />
                    <span style={{ flex: 1 }}>{label}</span>
                    <span style={{ fontSize: 10, opacity: 0.5 }}>{count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {hasFilters && (
          <button style={{ ...chipStyle, ...clearChipStyle }} onClick={onClearFilters}>
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}

const barStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderBottom: `1px solid ${theme.border.subtle}`,
};

const chipsRow: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  alignItems: "center",
};

const chipStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: "4px 10px",
  borderRadius: 14,
  border: `1px solid ${theme.border.default}`,
  backgroundColor: theme.bg.surface,
  color: theme.text.primary,
  fontSize: 11,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const clearChipStyle: React.CSSProperties = {
  borderColor: "rgba(196,80,80,0.3)",
  color: theme.accent.red,
};

const countBadge: React.CSSProperties = {
  fontSize: 9,
  backgroundColor: theme.bg.badgeCount,
  padding: "1px 5px",
  borderRadius: 8,
  marginLeft: 2,
};

const dropdownStyle: React.CSSProperties = {
  position: "absolute",
  top: "100%",
  left: 0,
  marginTop: 4,
  width: 220,
  maxHeight: 320,
  overflowY: "auto",
  backgroundColor: theme.bg.panelSolid,
  border: `1px solid ${theme.border.default}`,
  borderRadius: 8,
  padding: "4px 0",
  zIndex: 200,
};

const dropdownItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 12px",
  cursor: "pointer",
  fontSize: 12,
};

const colorDot: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "50%",
  flexShrink: 0,
};
