/* vertical color/label table — salvaged from the deleted graph/visual-encoding.ts.
 * Mirrors the `VerticalMeta` shape exported by @nexus/shared ({vertical,label,color})
 * without taking a package dependency: the client ships standalone to Vercel and
 * the palette here is the muted variant tuned for the light screen, not the
 * saturated graph palette. */

export interface VerticalMeta {
  vertical: string;
  label: string;
  color: string;
}

export const VERTICALS: readonly VerticalMeta[] = [
  { vertical: "foundation_models", label: "foundation models", color: "#8a3540" },
  { vertical: "inference", label: "inference", color: "#9a7650" },
  { vertical: "training", label: "training", color: "#8a5545" },
  { vertical: "agents", label: "agents", color: "#2a7068" },
  { vertical: "code_generation", label: "code generation", color: "#3a8a82" },
  { vertical: "multimodal", label: "multimodal", color: "#7048a0" },
  { vertical: "safety_alignment", label: "safety & alignment", color: "#8a4040" },
  { vertical: "evaluation", label: "evaluation", color: "#9a5a20" },
  { vertical: "developer_tooling", label: "developer tooling", color: "#1a7a90" },
  { vertical: "enterprise_platforms", label: "enterprise platforms", color: "#6048a0" },
  { vertical: "data_infrastructure", label: "data infrastructure", color: "#1a8070" },
  { vertical: "open_source", label: "open source", color: "#2a7a45" },
  { vertical: "hardware", label: "hardware", color: "#4a50a0" },
  { vertical: "consumer_products", label: "consumer products", color: "#9a4070" },
  { vertical: "creative_tools", label: "creative tools", color: "#8a40a0" },
  { vertical: "search_retrieval", label: "search & retrieval", color: "#1a70a0" },
  { vertical: "robotics", label: "robotics", color: "#5a8020" },
  { vertical: "healthcare", label: "healthcare", color: "#1a7a58" },
  { vertical: "finance", label: "finance", color: "#9a7020" },
  { vertical: "research", label: "research", color: "#3a68a0" },
  { vertical: "governance_policy", label: "governance & policy", color: "#585550" },
];

const FALLBACK_COLOR = "#645f58"; // --ink-dim

export const VERTICAL_COLORS: Record<string, string> = Object.fromEntries(
  VERTICALS.map((v) => [v.vertical, v.color]),
);

const VERTICAL_LABELS: Record<string, string> = Object.fromEntries(
  VERTICALS.map((v) => [v.vertical, v.label]),
);

// `vertical` arrives from the api and is attacker-influenceable, so every
// lookup is own-property guarded — a plain index would return Object.prototype
// members for keys like "__proto__" or "toString".
export function nodeColor(vertical: string | null | undefined): string {
  if (typeof vertical !== "string" || !Object.hasOwn(VERTICAL_COLORS, vertical))
    return FALLBACK_COLOR;
  return VERTICAL_COLORS[vertical];
}

// the typeof check is belt-and-braces over `isFeedItem`: these two are the only
// api-fed string operations left, so they stay defensive on their own terms.
export function verticalLabel(vertical: string | null | undefined): string {
  if (typeof vertical !== "string" || vertical === "") return "unclassified";
  if (!Object.hasOwn(VERTICAL_LABELS, vertical)) return vertical.replace(/_/g, " ");
  return VERTICAL_LABELS[vertical];
}
