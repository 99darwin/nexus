import type { ForceNode, ForceLink, GraphData } from "./types";

// Papers are high-volume/low-signal — need higher significance to render individually
const PAPER_THRESHOLD = 0.5;
const DEFAULT_THRESHOLD = 0.3;

function shouldCluster(node: ForceNode): boolean {
  const threshold = node.type === "paper" ? PAPER_THRESHOLD : DEFAULT_THRESHOLD;
  return node.significance < threshold;
}

export function clusterGraphData(data: GraphData): GraphData {
  const individual: ForceNode[] = [];
  const grouped = new Map<string, ForceNode[]>();

  for (const node of data.nodes) {
    if (!shouldCluster(node)) {
      individual.push(node);
    } else {
      const arr = grouped.get(node.vertical) ?? [];
      arr.push(node);
      grouped.set(node.vertical, arr);
    }
  }

  const clusters: ForceNode[] = [];

  for (const [vertical, nodes] of grouped) {
    // Render individually if too few to cluster
    if (nodes.length <= 2) {
      individual.push(...nodes);
      continue;
    }

    clusters.push({
      id: `cluster/${vertical}`,
      name: `${vertical.replace(/_/g, " ")} (${nodes.length})`,
      type: "cluster",
      vertical,
      significance: Math.max(...nodes.map((n) => n.significance)),
      status: "active",
      summary: "",
      updated_at: "",
      discovered_at: "",
      events: [],
      isCluster: true,
      clusterCount: nodes.length,
      clusterNodeIds: nodes.map((n) => n.id),
    });
  }

  // Map clustered node IDs → their cluster bubble ID
  const nodeToCluster = new Map<string, string>();
  for (const c of clusters) {
    for (const id of c.clusterNodeIds!) {
      nodeToCluster.set(id, c.id);
    }
  }

  const allNodes = [...individual, ...clusters];
  const allNodeIds = new Set(allNodes.map((n) => n.id));

  // Remap edges, dedupe, drop self-loops and dangling refs
  const seenEdges = new Set<string>();
  const links: ForceLink[] = [];

  for (const link of data.links) {
    const sid = typeof link.source === "string" ? link.source : link.source.id;
    const tid = typeof link.target === "string" ? link.target : link.target.id;
    const newSid = nodeToCluster.get(sid) ?? sid;
    const newTid = nodeToCluster.get(tid) ?? tid;

    if (newSid === newTid) continue;
    if (!allNodeIds.has(newSid) || !allNodeIds.has(newTid)) continue;

    const edgeKey = [newSid, newTid].sort().join("\u2192");
    if (seenEdges.has(edgeKey)) continue;
    seenEdges.add(edgeKey);

    links.push({ ...link, source: newSid, target: newTid });
  }

  return { nodes: allNodes, links };
}
