import { useState, useCallback, useMemo } from "react";
import { theme } from "../theme";

interface TemporalSliderProps {
  minDate: Date;
  maxDate: Date;
  value: Date | null;
  onChange: (date: Date | null) => void;
}

const PRESETS = [
  { label: "24h", days: 1 },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "1y", days: 365 },
  { label: "All", days: 0 },
] as const;

export function TemporalSlider({ minDate, maxDate, value, onChange }: TemporalSliderProps) {
  const [isPlaying, setIsPlaying] = useState(false);

  const minTime = minDate.getTime();
  const maxTime = maxDate.getTime();
  const currentTime = value ? value.getTime() : maxTime;

  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const time = parseInt(e.target.value, 10);
      if (time >= maxTime) {
        onChange(null); // Show all
      } else {
        onChange(new Date(time));
      }
    },
    [maxTime, onChange],
  );

  const handlePreset = useCallback(
    (days: number) => {
      if (days === 0) {
        onChange(null);
      } else {
        onChange(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
      }
    },
    [onChange],
  );

  const dateLabel = useMemo(() => {
    if (!value) return "All time";
    return value.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }, [value]);

  return (
    <div style={containerStyle}>
      <div style={controlsStyle}>
        <div style={presetsStyle}>
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => handlePreset(preset.days)}
              style={{
                ...presetButtonStyle,
                backgroundColor:
                  !value && preset.days === 0
                    ? theme.accent.primaryMuted
                    : theme.bg.surface,
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 12, opacity: 0.7, minWidth: 120, textAlign: "right" }}>
          {dateLabel}
        </span>
      </div>
      <input
        type="range"
        min={minTime}
        max={maxTime}
        value={currentTime}
        onChange={handleSliderChange}
        style={sliderStyle}
      />
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 0,
  left: 0,
  right: 0,
  padding: "8px 20px 12px",
  backgroundColor: theme.bg.panel,
  backdropFilter: theme.glass.blur,
  WebkitBackdropFilter: theme.glass.blur,
  borderTop: `1px solid ${theme.border.subtle}`,
  zIndex: 50,
};

const controlsStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 4,
};

const presetsStyle: React.CSSProperties = {
  display: "flex",
  gap: 4,
};

const presetButtonStyle: React.CSSProperties = {
  padding: "3px 10px",
  fontSize: 11,
  border: "none",
  borderRadius: 4,
  color: theme.text.primary,
  cursor: "pointer",
};

const sliderStyle: React.CSSProperties = {
  width: "100%",
  height: 4,
  WebkitAppearance: "none",
  appearance: "none",
  background: "rgba(255,255,255,0.08)",
  borderRadius: 2,
  outline: "none",
  cursor: "pointer",
};
