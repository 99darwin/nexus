import type { ForceLink, ForceNode } from "./types";

export interface ComparisonHighlight {
  sharedEdgeIndices: Set<number>;
  dimmedEdgeIndices: Set<number>;
}

function getLinkNodeId(end: string | ForceNode): string {
  return typeof end === "string" ? end : end.id;
}

export function computeComparisonHighlights(
  selectedIds: Set<string>,
  links: ForceLink[],
): ComparisonHighlight {
  const sharedEdgeIndices = new Set<number>();
  const dimmedEdgeIndices = new Set<number>();

  if (selectedIds.size < 2) return { sharedEdgeIndices, dimmedEdgeIndices };

  // Edges touching selected nodes, grouped by target
  const targetToEdges = new Map<string, number[]>();

  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const sourceId = getLinkNodeId(link.source);
    const targetId = getLinkNodeId(link.target);

    const sourceSelected = selectedIds.has(sourceId);
    const targetSelected = selectedIds.has(targetId);

    if (!sourceSelected && !targetSelected) {
      dimmedEdgeIndices.add(i);
      continue;
    }

    // Direct link between two selected nodes → shared
    if (sourceSelected && targetSelected) {
      sharedEdgeIndices.add(i);
      continue;
    }

    // Edge from selected to non-selected
    const nonSelectedEnd = sourceSelected ? targetId : sourceId;
    const existing = targetToEdges.get(nonSelectedEnd) ?? [];
    existing.push(i);
    targetToEdges.set(nonSelectedEnd, existing);
  }

  // Non-selected targets connected to multiple selected nodes → shared
  for (const [, edgeIndices] of targetToEdges) {
    const connectedSelected = new Set<string>();
    for (const idx of edgeIndices) {
      const link = links[idx];
      const sourceId = getLinkNodeId(link.source);
      const targetId = getLinkNodeId(link.target);
      if (selectedIds.has(sourceId)) connectedSelected.add(sourceId);
      if (selectedIds.has(targetId)) connectedSelected.add(targetId);
    }

    if (connectedSelected.size > 1) {
      for (const idx of edgeIndices) sharedEdgeIndices.add(idx);
    }
  }

  return { sharedEdgeIndices, dimmedEdgeIndices };
}
