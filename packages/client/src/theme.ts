export const theme = {
  bg: {
    primary: "#0a0b10",
    panel: "rgba(10, 12, 20, 0.82)",
    panelSolid: "#0e1018",
    surface: "rgba(255, 255, 255, 0.04)",
    surfaceHover: "rgba(255, 255, 255, 0.06)",
    surfaceActive: "rgba(255, 255, 255, 0.08)",
    badge: "rgba(255, 255, 255, 0.06)",
    badgeCount: "rgba(255, 255, 255, 0.08)",
  },
  text: {
    primary: "#a0a0b0",
    secondary: "#6a6a7a",
    heading: "#c0c0cc",
    muted: "#555566",
  },
  accent: {
    primary: "#5eead4", // teal-400
    primaryMuted: "rgba(94, 234, 212, 0.2)",
    primarySubtle: "rgba(94, 234, 212, 0.12)",
    amber: "#fbbf24",
    red: "#c45050",
    green: "#3a9a6e",
  },
  status: {
    ga: "#3a9a6e",
    beta: "#c49630",
    alpha: "#4a7ab5",
    announced: "#7050a8",
    deprecated: "#b54545",
    shutdown: "#555566",
    acquired: "#b04a7a",
    default: "#505060",
  },
  border: {
    subtle: "rgba(255, 255, 255, 0.06)",
    default: "rgba(255, 255, 255, 0.1)",
    active: "rgba(255, 255, 255, 0.2)",
    chipActive: "rgba(255, 255, 255, 0.18)",
  },
  glass: {
    blur: "blur(16px)",
  },
  font: {
    mono: "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', monospace",
  },
} as const;
