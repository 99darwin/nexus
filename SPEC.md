# Nexus — AI Ecosystem Topology Graph

A real-time, explorable 3D knowledge graph mapping the AI ecosystem. Two subsystems: an autonomous agent that ingests/classifies/structures AI events into a graph DB, and a 3D visualization client for spatial exploration with temporal navigation.

## Architecture

```
Sources → Ingestion Queue (BullMQ/Redis) → Agent (Claude API) → Graph Mutations → Neo4j → Fastify API → 3d-force-graph Client
                                                                                    ↓
                                                                              PostgreSQL (audit, raw content, users)
```

Four layers, loosely coupled via event streams:

1. **Ingestion** — polls/scrapes sources, normalizes into unified format
2. **Processing** — LLM agent extracts entities + relationships, emits graph mutations
3. **Storage** — Neo4j (graph) + PostgreSQL (metadata, audit, queue)
4. **Presentation** — 3d-force-graph (Three.js) web client with REST/WebSocket API

## Monorepo Structure

```
nexus/
├── packages/
│   ├── shared/          # TypeScript interfaces, enums, constants, validation
│   ├── agent/           # Ingestion + LLM processing pipeline
│   ├── api/             # Fastify REST + WebSocket server
│   └── client/          # 3d-force-graph visualization (Vite + React)
├── scripts/
│   ├── seed.ts          # Bootstrap 50 curated nodes
│   └── backfill.ts      # Historical data crawl (2023–2026)
├── docker-compose.yml   # Neo4j + Redis + PostgreSQL + API + Client
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

TypeScript end-to-end. pnpm workspaces.

---

## Data Model

### Node Interface

```typescript
// packages/shared/src/types.ts

export type NodeType =
  | 'model' | 'product' | 'company' | 'paper' | 'person'
  | 'framework' | 'dataset' | 'benchmark' | 'standard' | 'initiative';

export type NodeStatus =
  | 'announced' | 'alpha' | 'beta' | 'ga'
  | 'deprecated' | 'acquired' | 'shutdown';

export type Vertical =
  | 'foundation_models' | 'inference' | 'training' | 'agents'
  | 'code_generation' | 'multimodal' | 'safety_alignment' | 'evaluation'
  | 'developer_tooling' | 'enterprise_platforms' | 'data_infrastructure'
  | 'open_source' | 'hardware' | 'consumer_products' | 'creative_tools'
  | 'search_retrieval' | 'robotics' | 'healthcare' | 'finance'
  | 'research' | 'governance_policy';

export interface NodeEvent {
  timestamp: string;          // ISO 8601
  event_type: string;         // 'launch' | 'funding' | 'release' | 'acquisition' | 'paper' | 'update' | 'shutdown'
  summary: string;
  source_url: string;
}

export interface GraphNode {
  id: string;                 // deterministic slug: "anthropic/claude-4", "openai/gpt-4o"
  type: NodeType;
  name: string;
  vertical: Vertical;
  verticals_secondary: Vertical[];
  status: NodeStatus;
  discovered_at: string;      // ISO 8601
  updated_at: string;         // ISO 8601
  events: NodeEvent[];
  significance: number;       // 0.0–1.0
  summary: string;            // 1–2 sentences
  metadata: Record<string, unknown>;
}
```

### Edge Interface

```typescript
export type RelationshipType =
  | 'built_on' | 'competes_with' | 'forked_from' | 'integrates_with'
  | 'acquired_by' | 'funded_by' | 'authored_by' | 'benchmarked_on'
  | 'succeeded_by' | 'part_of' | 'inspired_by' | 'partners_with';

export interface GraphEdge {
  source_id: string;
  target_id: string;
  relationship: RelationshipType;
  discovered_at: string;      // ISO 8601
  confidence: number;         // 0.0–1.0
  evidence: string;           // justification + source URL
}
```

### Agent Mutation Format

This is the structured output the LLM agent emits. The mutation engine consumes this.

```typescript
export type MutationOp =
  | { op: 'upsert_node'; node: GraphNode }
  | { op: 'upsert_edge'; edge: GraphEdge }
  | { op: 'update_status'; id: string; status: NodeStatus; event: NodeEvent }
  | { op: 'update_significance'; id: string; significance: number };

export interface AgentOutput {
  mutations: MutationOp[];
  analysis: string;           // natural language summary of what changed
}
```

---

## Taxonomy — Vertical Cluster Positions

Verticals are spatial cluster attractors in the force layout. Each has a fixed centroid that nodes gravitate toward.

| Vertical | Scope | Ring |
|---|---|---|
| `foundation_models` | Frontier/base models (LLMs, VLMs) | Core center |
| `inference` | Serving, optimization, quantization, runtimes | Inner |
| `training` | Pre-training, fine-tuning, RLHF infra | Inner |
| `agents` | Autonomous agents, orchestration, tool use | Inner |
| `code_generation` | AI-assisted dev tools | Inner |
| `multimodal` | Vision, audio, video, cross-modal | Inner |
| `safety_alignment` | Alignment, red-teaming, guardrails | Mid |
| `evaluation` | Benchmarks, evals, testing frameworks | Mid |
| `developer_tooling` | SDKs, frameworks, observability | Mid |
| `enterprise_platforms` | B2B AI platforms, MLOps, deployment | Mid |
| `data_infrastructure` | Datasets, labeling, synthetic data, pipelines | Mid |
| `open_source` | Open-weight models, community projects | Mid |
| `hardware` | Chips, accelerators, compute infrastructure | Outer |
| `consumer_products` | Consumer-facing AI apps and features | Outer |
| `creative_tools` | Image/video/music/3D generation | Outer |
| `search_retrieval` | RAG, search, knowledge management | Outer |
| `robotics` | Embodied AI, manipulation, locomotion | Outer |
| `healthcare` | Medical AI, biotech, drug discovery | Outer |
| `finance` | Trading, risk, fintech AI | Outer |
| `research` | Papers, breakthroughs, novel architectures | Distributed |
| `governance_policy` | Regulation, standards, policy initiatives | Periphery |

---

## Ingestion Sources

Priority order. Implement P0 first, expand incrementally.

| Source | Method | Frequency | Priority |
|---|---|---|---|
| ArXiv (cs.AI, cs.CL, cs.LG) | RSS + API | Every 30 min | P0 |
| GitHub Trending (ML/AI) | Scrape + API | Every 60 min | P0 |
| HackerNews (front page + AI keywords) | Algolia API | Every 15 min | P0 |
| Twitter/X (curated list + keyword stream) | API v2 filtered stream | Real-time | P0 |
| TechCrunch, The Verge, Ars Technica | RSS | Every 30 min | P1 |
| Product Hunt (AI category) | API | Every 60 min | P1 |
| Company blogs (top 50 AI cos) | RSS + scrape | Every 60 min | P1 |
| Crunchbase (funding events) | API | Every 6 hours | P2 |
| Semantic Scholar | API | Every 6 hours | P2 |

Each source adapter must implement:

```typescript
// packages/agent/src/sources/types.ts

export interface RawItem {
  source: string;             // e.g. 'hackernews', 'arxiv', 'github'
  source_url: string;
  title: string;
  content: string;            // body text, abstract, README, etc.
  published_at: string;       // ISO 8601
  raw_metadata: Record<string, unknown>;
}

export interface SourceAdapter {
  name: string;
  priority: 'P0' | 'P1' | 'P2';
  poll(): Promise<RawItem[]>;
}
```

---

## Agent Pipeline

Three-stage pipeline with model routing for cost efficiency.

### Stage 1: Triage (Haiku)

Input: batch of `RawItem[]` (10–20 items).
Task: binary relevance filter — is this about the AI ecosystem?
Output: filtered `RawItem[]` with irrelevant items discarded.
Estimated cost: $0.50–$1.00/day.

### Stage 2: Extraction (Sonnet)

Input: filtered `RawItem[]`.
Task: entity extraction, relationship identification, classification, significance scoring.
Output: `AgentOutput` (structured JSON with mutations).
Estimated cost: $1.00–$3.00/day.

The full agent system prompt is in `ai-topology-agent-prompt.md` (companion file). It defines the ontology, taxonomy, extraction rules, output schema, and operational constraints. Load it as the system prompt for Stage 2 calls.

### Stage 3: Significance Recalibration (Opus, weekly)

Input: full graph summary (node count per vertical, edge distribution, top entities).
Task: recalibrate significance scores based on accumulated activity, edge count, and ecosystem shifts. Flag taxonomy changes.
Estimated cost: $0.50–$1.00/week amortized.

### Mutation Engine

Consumes `AgentOutput`, applies to Neo4j. Must be idempotent.

- `upsert_node`: match on `id`. If exists, merge events, update `updated_at`, update mutable fields. If new, create.
- `upsert_edge`: match on `(source_id, target_id, relationship)`. Update confidence/evidence if exists.
- Conflict resolution: last-write-wins with timestamp comparison.
- All mutations logged to PostgreSQL audit table with full before/after snapshots.
- Contradictory mutations (e.g., `status: 'ga'` and `status: 'shutdown'` in same batch) are rejected and logged.

---

## Visualization Specification

### Visual Encoding

| Visual Property | Maps To | Range |
|---|---|---|
| Node size (sphere radius) | `significance` | 4px (0.1) → 40px (1.0), logarithmic scale |
| Node color | `vertical` | Unique hue per vertical, perceptually uniform (d3-scale-chromatic) |
| Node opacity | recency (`updated_at`) | 1.0 (today) → 0.3 (90+ days stale) |
| Node glow/pulse | event in last 24h | Animated pulse ring via shader |
| Edge thickness | `confidence` | 1px (0.3) → 4px (1.0) |
| Edge color | `relationship` type | Warm = competitive, cool = collaborative, neutral = structural |
| Edge style | `relationship` type | Solid = strong (built_on, part_of), dashed = weak (inspired_by, competes_with) |
| Spatial position | `vertical` | Force-directed with vertical centroid attractors |
| Z-depth (2.5D mode) | `discovered_at` | Newer forward, older recedes |

### Force Layout Configuration

```typescript
// packages/client/src/forces.ts

// Each vertical has a centroid in 3D space arranged in concentric rings.
// Custom force function pulls nodes toward their vertical's centroid.
// Stiffness per ring: core=0.3, inner=0.2, mid=0.15, outer=0.1 (tighter core, looser periphery).
// Collision avoidance: node radius + 5px padding.
// Edge bundling: optional, enable for >5k edges to reduce visual clutter.

export interface VerticalCentroid {
  vertical: Vertical;
  x: number;
  y: number;
  z: number;
  stiffness: number;
}
```

### Navigation & Interaction

Implement these in order of priority:

1. **Camera controls** — orbit (click-drag rotate, scroll zoom, right-drag pan). Double-click node → focus/zoom. Escape → reset to overview. WASD+QE keyboard nav. Pinch-zoom on mobile/touch.

2. **Node detail panel** — click node → slide-out panel: name, type badge, status badge, significance score, summary, event timeline (chronological), connected edges grouped by relationship type, source URL links. Also render a mini force-graph of the node's immediate neighborhood (1-degree).

3. **Search (Cmd-K / Ctrl-K)** — fuzzy search via fuse.js across node names, summaries, metadata. Results list with match highlights. Click result → camera focuses on that node in the graph.

4. **Temporal slider** — timeline scrubber at bottom of viewport. Filters graph to show only nodes/edges that existed at selected datetime. Preset zoom buttons: 24h, 7d, 30d, 90d, 1y, all. Playback mode: animate graph evolution over time.

5. **Vertical focus sidebar** — panel listing all verticals with node counts. Click vertical → camera zooms to that cluster, all other verticals dim to 10% opacity. Multi-select supported to view cross-vertical relationships.

6. **Comparison mode** — select 2–4 nodes → side-by-side panel showing shared and unique relationships. Highlight shared edges in the graph.

---

## API Specification

### REST Endpoints (Fastify)

| Endpoint | Method | Description |
|---|---|---|
| `/api/graph` | GET | Full graph export (paginated). `?since=` for incremental sync. |
| `/api/nodes` | GET | List nodes. Filters: `vertical`, `type`, `status`, `significance_min`, `since`, `search`. |
| `/api/nodes/:id` | GET | Single node with full event history and edges. |
| `/api/nodes/:id/neighborhood` | GET | Node + N-degree neighborhood subgraph. `?depth=` (default 1). |
| `/api/edges` | GET | List edges. Filters: `relationship`, `source_vertical`, `target_vertical`, `since`. |
| `/api/verticals` | GET | Vertical metadata: node count, avg significance, top entities, recent activity. |
| `/api/timeline` | GET | Aggregated timeline: events per day/hour grouped by vertical. Powers the temporal slider. |
| `/api/search` | GET | Fuzzy search across nodes. Returns ranked results with match highlights. |
| `/api/live` | WebSocket | Real-time mutation stream. Client subscribes; server pushes upserted nodes/edges. |

### Auth

- Public read access (no auth required for GET endpoints).
- API keys for write access (admin panel, agent mutations).
- Rate limiting: 100 req/min anonymous, 1000 req/min authenticated.

---

## Tech Stack

| Component | Technology | Notes |
|---|---|---|
| Language | TypeScript (end-to-end) | Shared interfaces in `packages/shared` |
| Graph DB | Neo4j Community (or Aura Free) | Cypher queries, PageRank, community detection |
| Metadata DB | PostgreSQL | Audit logs, raw content, user data, job queue |
| API | Fastify | Schema validation, WebSocket via `@fastify/websocket` |
| 3D viz | 3d-force-graph + Three.js | WebGL, handles 10k+ nodes |
| 2.5D fallback | d3-force with z-axis | Lower-end device fallback, z = time |
| Client-side search | fuse.js | Fuzzy instant search |
| Server-side search | pg_trgm | Full-text trigram search |
| Agent runtime | Node.js + @anthropic-ai/sdk | Haiku/Sonnet/Opus routing |
| Job queue | BullMQ (Redis) | Retry, rate limiting, priority lanes |
| Deployment | Docker Compose → GCP Cloud Run | Neo4j, Redis, PostgreSQL, API, Client |
| CI/CD | GitHub Actions | Separate pipelines per package |

---

## Build Plan — Phased for Parallel Worktrees

Each phase has tasks that can run on separate Claude Code worktrees simultaneously. Merge incrementally.

### Phase 0: Bootstrap (Day 1)

| Task | Worktree | Acceptance Criteria |
|---|---|---|
| Project scaffolding | `main` | Monorepo builds. `pnpm install` succeeds. Shared types importable from all packages. tsconfig paths resolved. |
| Neo4j schema + seed | `db-setup` | Docker Compose starts Neo4j. Constraints + indexes created. 50 curated seed nodes across ≥10 verticals with ≥80 edges. Cypher queries return expected results. |
| Agent prompt + runner | `agent-core` | TypeScript runner accepts `RawItem[]`, calls Claude API with system prompt, parses `AgentOutput` JSON, validates against shared types. Unit tests with mocked API responses. |
| 3d-force-graph PoC | `viz-poc` | Renders seed data as force-directed graph. Camera orbit works. Nodes sized by significance. Nodes colored by vertical. Cluster force pulls nodes toward vertical centroids. |

### Phase 1: Data Pipeline (Days 2–4)

| Task | Worktree | Acceptance Criteria |
|---|---|---|
| Ingestion framework | `ingest` | Pluggable `SourceAdapter` interface. HN, ArXiv, GitHub adapters implemented. BullMQ queue with retry + rate limiting. Dedup by `source_url`. |
| Agent triage layer | `agent-triage` | Haiku-based binary relevance filter. Processes batch of 20 items in single call. Rejects ≥50% of general HN front page items. Latency <2s per batch. |
| Agent extraction | `agent-extract` | Sonnet-based extraction. Batch 10–20 items. Outputs valid `AgentOutput`. Validation against shared types. Error handling for malformed LLM responses. |
| Mutation engine | `mutations` | Idempotent upserts to Neo4j. Event append (not overwrite). Audit log to PostgreSQL. Rejects contradictory mutations. Integration test: feed 100 mutations, verify graph state. |
| Backfill script | `backfill` | Seeds historical data: major model releases, key companies, landmark papers from 2023–2026. Target: 500+ nodes, 1500+ edges after backfill. |

### Phase 2: Visualization (Days 3–6)

| Task | Worktree | Acceptance Criteria |
|---|---|---|
| API layer | `api` | All REST endpoints from API spec functional. Fastify schema validation. WebSocket push on mutation. Pagination with cursor. Response times <100ms for filtered queries on 10k nodes. |
| Force layout | `viz-forces` | Custom vertical centroid attractor force. Collision avoidance. Configurable stiffness per ring. Stable layout within 3s for 2k nodes. No overlapping clusters. |
| Visual encoding | `viz-style` | All visual mappings from spec implemented. Shader-based glow for 24h-active nodes. Perceptually uniform palette (≥21 distinguishable colors). Edge style differentiation visible at default zoom. |
| Temporal slider | `viz-timeline` | Range input filters graph by datetime. Preset zoom buttons (24h/7d/30d/90d/1y/all). Playback animation. Smooth transitions (nodes fade in/out, don't pop). |
| Node detail panel | `viz-panel` | Slide-out on node click. All fields rendered. Event timeline chronological. Neighborhood mini-graph. Deep link: `/node/:id` URL loads graph focused on that node. |
| Search | `viz-search` | Cmd-K opens palette. Fuzzy results as-you-type. Click result → camera animates to node. Highlights matching node with ring effect. |

### Phase 3: Polish & Ship (Days 5–7)

| Task | Worktree | Acceptance Criteria |
|---|---|---|
| Vertical sidebar | `viz-sidebar` | Lists all verticals with node counts + activity indicators. Click → zoom + dim. Multi-select. Responsive collapse to icon bar on narrow viewports. |
| Comparison mode | `viz-compare` | Multi-select (shift-click or checkbox). Side-by-side panel. Shared edges highlighted in gold. Unique edges dimmed. Works for 2–4 nodes. |
| Mobile responsive | `mobile` | Touch: pinch zoom, tap focus, swipe panel. Sidebar → bottom sheet. Node detail → full-screen modal. Minimum 30fps on iPhone 14. |
| Performance | `perf` | LOD rendering (reduce geometry at distance). Frustum culling. WebGL instancing for >5k nodes. Force sim in Web Worker. Target: 60fps at 2k nodes, 30fps at 10k. |
| Deployment | `deploy` | Docker Compose: all services healthy. `docker compose up` from clean state works. Health check endpoints. Environment config via `.env`. README with setup instructions. |
| Monitoring | `ops` | Agent failure alerts (Slack/email webhook). Data freshness dashboard (time since last successful mutation). Graph anomaly detection (node count delta > 2σ from rolling average). |

---

## Agent Maintenance — Steady State Operations

After build, the graph is maintained by scheduled agent runs, not Claude Code.

| Operation | Frequency | Model | Est. Cost/Day |
|---|---|---|---|
| Source polling + triage | Every 15–60 min | Haiku | $0.50–$1.00 |
| Entity extraction + classification | Per triage batch | Sonnet | $1.00–$3.00 |
| Significance recalibration | Weekly | Opus | $0.50–$1.00 (amortized) |
| Orphan node cleanup | Daily | Programmatic (no LLM) | $0 |
| Stale entity flagging (>90d no events) | Daily | Programmatic + Haiku | $0.10 |
| Vertical taxonomy review | Monthly | Opus | $0.20 (amortized) |

**Total: ~$2–$5/day at steady state.**

### Quality Control

- Low-confidence extractions (confidence < 0.5) → flagged for human review in moderation queue.
- Significance heuristic validation: orphan nodes (0 edges) should not have significance > 0.5.
- Contradictory mutations rejected and logged.
- Duplicate detection: fuzzy match on `name` within same `type` before creating new nodes.

### Admin Panel (Minimal)

Lightweight web UI (can be a route in the client app) for:
- Reviewing flagged items (approve/reject/edit)
- Manual node reclassification
- Merge duplicate entities
- Adjust significance overrides
- View audit log

All manual edits use the same mutation engine and audit trail as agent mutations.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Agent hallucination (false entities/relationships) | High — erodes trust | Confidence thresholds, human review queue, anomaly detection on mutation rate |
| Source API rate limits / ToS changes | Medium — data gaps | Multi-source redundancy, graceful degradation, cached fallbacks |
| Graph too large for client rendering | High — UX breaks | LOD, server-side subgraph extraction, virtual rendering (only visible nodes) |
| Taxonomy drift | Medium — layout degrades | Monthly Opus review, manual override, start with fewer verticals and split as clusters grow |
| Duplicate entities | Medium — cluttered graph | Fuzzy dedup in agent, merge tool in admin, alias registry on nodes |
| Inference cost spikes | Low | Haiku triage gate, batch sizing, cost monitoring with circuit breaker |

---

## Open Questions

1. Public from day one or invite-only beta?
2. Public GraphQL API for third-party consumers? (Phase 3 decision)
3. Significance scores visible to users or only used for visual encoding?
4. Entities spanning multiple types (OpenAI = company + research lab) — allow multi-type or pick primary?
5. Taxonomy evolution cadence — too fast = spatial instability, too slow = stale clusters.
6. Run inside Carapace TEE for dogfooding narrative?
7. Monetization angle (pro tier, API, enterprise white-label)?
8. Embedding model for semantic search — local (e.g., gte-small) vs API? Latency vs cost tradeoff.

---

## References

- 3d-force-graph: https://github.com/vasturiano/3d-force-graph
- Neo4j Graph Data Science: https://neo4j.com/docs/graph-data-science/
- d3-force: https://d3js.org/d3-force
- d3-scale-chromatic: https://d3js.org/d3-scale-chromatic
- BullMQ: https://docs.bullmq.io/
- Anthropic SDK: https://docs.anthropic.com/
- fuse.js: https://www.fusejs.io/
- Fastify: https://fastify.dev/

## Companion Files

- `ai-topology-agent-prompt.md` — Full agent system prompt with ontology, taxonomy, extraction rules, output schema, maintenance routines. Load as system prompt for Stage 2 (extraction) calls.
