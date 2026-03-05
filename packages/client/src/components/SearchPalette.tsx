import { useEffect, useRef, useState } from "react";
import type { ForceNode } from "../graph/types";
import { useSearch } from "../hooks/useSearch";
import { nodeColor } from "../graph/visual-encoding";
import { theme } from "../theme";

interface SearchPaletteProps {
  nodes: ForceNode[];
  onSelect: (nodeId: string) => void;
  onClose: () => void;
  fullscreen?: boolean;
}

export function SearchPalette({ nodes, onSelect, onClose, fullscreen }: SearchPaletteProps) {
  const { query, results, search, clear } = useSearch(nodes);
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selectedIndex]) {
      onSelect(results[selectedIndex].item.id);
      clear();
      onClose();
    }
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={fullscreen ? fullscreenPaletteStyle : paletteStyle} onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => search(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search nodes..."
          style={inputStyle}
        />
        <div style={resultsStyle}>
          {results.map((result, i) => (
            <div
              key={result.item.id}
              style={{
                ...resultItemStyle,
                backgroundColor: i === selectedIndex ? theme.bg.surfaceActive : "transparent",
              }}
              onClick={() => {
                onSelect(result.item.id);
                clear();
                onClose();
              }}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span
                style={{
                  ...dotStyle,
                  backgroundColor: nodeColor(result.item.vertical),
                }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{result.item.name}</div>
                <div style={{ fontSize: 12, opacity: 0.6 }}>
                  {result.item.type} &middot; {result.item.vertical.replace(/_/g, " ")}
                </div>
              </div>
              <div style={{ fontSize: 12, opacity: 0.4 }}>
                {(result.item.significance * 100).toFixed(0)}%
              </div>
            </div>
          ))}
          {query && results.length === 0 && (
            <div style={{ padding: 16, textAlign: "center", opacity: 0.5 }}>No results found</div>
          )}
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(0,0,0,0.7)",
  display: "flex",
  justifyContent: "center",
  paddingTop: "15vh",
  zIndex: 1000,
};

const paletteStyle: React.CSSProperties = {
  width: 500,
  maxHeight: "60vh",
  backgroundColor: theme.bg.panel,
  backdropFilter: theme.glass.blur,
  WebkitBackdropFilter: theme.glass.blur,
  borderRadius: 12,
  border: `1px solid ${theme.border.subtle}`,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "14px 16px",
  fontSize: 16,
  backgroundColor: "transparent",
  border: "none",
  borderBottom: `1px solid ${theme.border.subtle}`,
  color: theme.text.primary,
  outline: "none",
  fontFamily: theme.font.mono,
};

const resultsStyle: React.CSSProperties = {
  overflowY: "auto",
  maxHeight: "50vh",
};

const resultItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 16px",
  cursor: "pointer",
  transition: "background 0.1s",
};

const dotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "50%",
  flexShrink: 0,
};

const fullscreenPaletteStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  backgroundColor: theme.bg.panel,
  backdropFilter: theme.glass.blur,
  WebkitBackdropFilter: theme.glass.blur,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
};
