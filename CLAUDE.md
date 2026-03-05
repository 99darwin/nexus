This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

  ## Project Overview

  **Nexus** — A real-time 3D knowledge graph mapping the AI ecosystem. Two subsystems:
  1. **Agent pipeline** — ingests/classifies/structures AI events into a graph DB using Claude API (Haiku triage → Sonnet extraction → Opus recalibration)
  2. **3D visualization client** — spatial exploration with temporal navigation using 3d-force-graph + Three.js

  ## Architecture

  Sources → BullMQ/Redis Queue → Agent (Claude API) → Mutation Engine → Neo4j → Fastify API → 3d-force-graph Client
                                                                          ↓
                                                                    PostgreSQL (audit, raw content)

  Four layers: Ingestion → Processing (LLM) → Storage (Neo4j + PostgreSQL) → Presentation (3d-force-graph)

  ## Monorepo Structure

  packages/
    shared/    — TypeScript interfaces, enums, constants, validation (imported by all packages)
    agent/     — Ingestion adapters + LLM processing pipeline (3-stage: triage/extract/recalibrate)
    api/       — Fastify REST + WebSocket server
    client/    — 3d-force-graph visualization (Vite + React)
  scripts/
    seed.ts    — Bootstrap 50 curated nodes
    backfill.ts — Historical data crawl (2023–2026)

  TypeScript end-to-end. pnpm workspaces.

  ## Build & Dev Commands

  ```bash
  pnpm install                    # install all dependencies
  pnpm -r build                   # build all packages
  pnpm --filter <package> dev     # dev server for a specific package (e.g. client, api)
  pnpm --filter <package> test    # run tests for a specific package
  pnpm --filter <package> test -- --grep "pattern"  # run a single test by name
  docker compose up               # start Neo4j + Redis + PostgreSQL + API + Client

  Key Data Model (packages/shared)

  - GraphNode: id (deterministic slug like anthropic/claude-4), type (model|product|company|paper|person|framework|dataset|benchmark|standard|initiative), vertical (21 spatial cluster categories), significance (0.0–1.0), events[]
  - GraphEdge: source_id, target_id, relationship (built_on|competes_with|forked_from|integrates_with|acquired_by|funded_by|authored_by|benchmarked_on|succeeded_by|part_of|inspired_by|partners_with), confidence (0.0–1.0)
  - AgentOutput: mutations[] (upsert_node|upsert_edge|update_status|update_significance) + analysis string

  All shared types live in packages/shared/src/types.ts.

  Agent Pipeline (packages/agent)

  - Stage 1 (Triage): Haiku — binary relevance filter on batches of 10–20 RawItems
  - Stage 2 (Extraction): Sonnet — entity/relationship extraction emitting AgentOutput JSON. System prompt loaded from ai-topology-agent-prompt.md
  - Stage 3 (Recalibration): Opus weekly — significance score recalibration across full graph
  - Mutation engine: idempotent upserts to Neo4j, last-write-wins conflict resolution, contradictory mutations rejected, all mutations audit-logged to PostgreSQL
  - Source adapters implement SourceAdapter interface (poll(): Promise<RawItem[]>)

  Visualization (packages/client)

  - 21 verticals arranged as spatial cluster attractors in concentric rings (core/inner/mid/outer/distributed/periphery)
  - Visual encoding: node size=significance, color=vertical, opacity=recency, glow=24h activity, edge thickness=confidence
  - Force layout with per-ring stiffness: core=0.3, inner=0.2, mid=0.15, outer=0.1
  - Key features (priority order): camera controls, node detail panel, Cmd-K search (fuse.js), temporal slider, vertical focus sidebar, comparison mode

  API (packages/api)

  - Fastify with @fastify/websocket for real-time mutation streaming (/api/live)
  - Public read access, API key auth for writes
  - Key endpoints: /api/graph, /api/nodes, /api/nodes/:id/neighborhood, /api/edges, /api/verticals, /api/timeline, /api/search

  Tech Stack

  - Graph DB: Neo4j (Cypher queries)
  - Metadata DB: PostgreSQL (audit logs, raw content, job queue)
  - Queue: BullMQ on Redis
  - API: Fastify
  - Client: Vite + React + 3d-force-graph + Three.js
  - Search: fuse.js (client), pg_trgm (server)
  - Agent: @anthropic-ai/sdk with Haiku/Sonnet/Opus routing
  - Deploy: Docker Compose → GCP Cloud Run

  Important Conventions

  - Node IDs are deterministic slugs: company/product format (e.g., anthropic/claude-4, openai/gpt-4o)
  - Mutation engine must be idempotent — upsert_node merges events, upsert_edge matches on (source_id, target_id, relationship)
  - Low-confidence extractions (< 0.5) go to human review queue
  - Orphan nodes (0 edges) should not have significance > 0.5
  - The succeeded_by edge chain must be maintained when new model versions release

  ---

  The file covers:
  - **Architecture overview** with the 4-layer pipeline diagram
  - **Monorepo layout** with package responsibilities
  - **Build/dev commands** for pnpm workspaces and Docker
  - **Data model summary** — the three core types and where they live
  - **Agent pipeline** — the 3-stage LLM routing and mutation engine rules
  - **Visualization** — spatial layout, visual encoding, feature priority
  - **API** — key endpoints and auth model
  - **Tech stack** — all major dependencies
  - **Conventions** — the non-obvious rules (ID format, idempotency, confidence thresholds, succeeded_by chains)
