/**
 * One-shot archival script: dumps the entire Neo4j graph (all Entity nodes +
 * all RELATES_TO edges) to `archive/graph-export.json`.
 *
 * Run once before the Neo4j instance is decommissioned (see
 * scripts/backfill-feed.ts for the companion script that flattens this data
 * into the new `feed_items` Postgres table).
 *
 * Required env: NEO4J_URI (defaults to bolt://localhost:7687) and either
 * NEO4J_AUTH ("none" or "user/password") or NEO4J_USER + NEO4J_PASSWORD.
 *
 * Usage: tsx scripts/export-graph.ts
 */
import neo4j, { type Driver, type ManagedTransaction } from "neo4j-driver";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, "..", "archive", "graph-export.json");

// Page size for the SKIP/LIMIT sweep over all nodes. Keeps a single query
// from blowing up memory/transaction size if the graph is large.
const NODE_PAGE_SIZE = 500;

// ── Result shapes (subset of the Neo4j Entity/RELATES_TO properties this script reads) ──

interface NodeEventResult {
  timestamp: string;
  event_type: string;
  summary: string;
  source_url: string;
}

interface NodeResult {
  id: string;
  type: string;
  name: string;
  vertical: string;
  verticals_secondary: string[];
  status: string;
  discovered_at: string;
  updated_at: string;
  significance: number;
  summary: string;
  events: NodeEventResult[];
  metadata: Record<string, unknown>;
}

interface EdgeResult {
  source_id: string;
  target_id: string;
  relationship: string;
  discovered_at: string;
  confidence: number;
  evidence: string;
}

// ── Connection setup ──

function createDriver(): Driver {
  const uri = process.env.NEO4J_URI ?? "bolt://localhost:7687";
  const neo4jAuth = process.env.NEO4J_AUTH;

  let auth;
  if (neo4jAuth === "none" || neo4jAuth === "") {
    auth = undefined;
  } else if (neo4jAuth && neo4jAuth.includes("/")) {
    const [user, ...rest] = neo4jAuth.split("/");
    auth = neo4j.auth.basic(user, rest.join("/"));
  } else {
    const user = process.env.NEO4J_USER ?? "neo4j";
    const password = process.env.NEO4J_PASSWORD;
    if (!password) {
      throw new Error(
        "Missing Neo4j credentials: set NEO4J_AUTH (e.g. 'neo4j/password' or 'none') " +
          "or NEO4J_USER + NEO4J_PASSWORD before running export-graph.ts.",
      );
    }
    auth = neo4j.auth.basic(user, password);
  }

  console.log(`[export-graph] connecting to ${redactUri(uri)}`);
  return neo4j.driver(uri, auth);
}

// Strips any embedded userinfo (bolt://user:pass@host) before logging a URI.
function redactUri(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return "<unparseable NEO4J_URI>";
  }
}

function safeParse(value: unknown, fallback: unknown): unknown {
  if (typeof value !== "string") return value ?? fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseNode(raw: Record<string, unknown>): NodeResult {
  return {
    ...raw,
    events: safeParse(raw.events, []),
    metadata: safeParse(raw.metadata, {}),
    verticals_secondary: raw.verticals_secondary ?? [],
  } as NodeResult;
}

// ── Queries ──

async function fetchAllNodes(tx: ManagedTransaction): Promise<NodeResult[]> {
  const nodes: NodeResult[] = [];
  let offset = 0;

  for (;;) {
    const result = await tx.run(
      `MATCH (n:Entity)
       RETURN properties(n) as props
       ORDER BY n.id
       SKIP $offset LIMIT $limit`,
      { offset: neo4j.int(offset), limit: neo4j.int(NODE_PAGE_SIZE) },
    );

    const page = result.records.map((r) => parseNode(r.get("props")));
    nodes.push(...page);

    if (page.length < NODE_PAGE_SIZE) break;
    offset += NODE_PAGE_SIZE;
  }

  return nodes;
}

async function fetchAllEdges(tx: ManagedTransaction): Promise<EdgeResult[]> {
  const result = await tx.run(
    `MATCH (a:Entity)-[r:RELATES_TO]->(b:Entity)
     RETURN a.id as source_id, b.id as target_id,
            r.relationship as relationship, r.discovered_at as discovered_at,
            r.confidence as confidence, r.evidence as evidence`,
  );

  return result.records.map((r) => ({
    source_id: r.get("source_id") as string,
    target_id: r.get("target_id") as string,
    relationship: r.get("relationship") as string,
    discovered_at: r.get("discovered_at") as string,
    confidence: r.get("confidence") as number,
    evidence: r.get("evidence") as string,
  }));
}

// ── Main ──

async function main(): Promise<void> {
  const driver = createDriver();
  const session = driver.session();

  try {
    await driver.verifyConnectivity();

    // Single read transaction so nodes and edges reflect one consistent
    // snapshot even if the source graph is still being ingested.
    const { nodes, edges } = await session.executeRead(async (tx) => {
      console.log("[export-graph] fetching nodes...");
      const txNodes = await fetchAllNodes(tx);
      console.log(`[export-graph] fetched ${txNodes.length} nodes`);

      console.log("[export-graph] fetching edges...");
      const txEdges = await fetchAllEdges(tx);
      console.log(`[export-graph] fetched ${txEdges.length} edges`);

      return { nodes: txNodes, edges: txEdges };
    });

    const output = {
      exported_at: new Date().toISOString(),
      node_count: nodes.length,
      edge_count: edges.length,
      nodes,
      edges,
    };

    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

    console.log(
      `[export-graph] wrote ${nodes.length} nodes and ${edges.length} edges to ${OUTPUT_PATH}`,
    );
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch((err: unknown) => {
  const includeStack = process.env.DEBUG === "1";
  const message =
    err instanceof Error ? (includeStack ? (err.stack ?? err.message) : err.message) : String(err);
  console.error(`[export-graph] failed: ${message}`);
  process.exit(1);
});
