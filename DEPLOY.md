# Deploying Nexus — Railway + Vercel

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Railway                                                │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ Neo4j    │  │ Postgres │  │  Redis   │              │
│  │ (Docker) │  │(template)│  │(template)│              │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       │              │             │                    │
│       └──────────┬───┘─────────────┘                    │
│                  │                                      │
│            ┌─────┴─────┐                                │
│            │  Fastify   │ ← CORS: CLIENT_ORIGIN         │
│            │    API     │                                │
│            └─────┬─────┘                                │
│                  │ :3001                                 │
└──────────────────┼──────────────────────────────────────┘
                   │ https://nexus-api.up.railway.app
                   │
┌──────────────────┼──────────────────────────────────────┐
│  Vercel          │                                      │
│            ┌─────┴─────┐                                │
│            │   Vite    │  VITE_API_URL → Railway API    │
│            │   SPA     │                                │
│            └───────────┘                                │
│            https://nexus.vercel.app                     │
└─────────────────────────────────────────────────────────┘
```

The client is a static Vite SPA. At build time, `VITE_API_URL` is baked in so the client calls the Railway API directly — no proxy or rewrites needed.

---

## 1. Railway: Databases

### PostgreSQL

1. In your Railway project, click **+ New** → **Database** → **PostgreSQL**
2. Railway provisions it automatically with connection credentials
3. Note the service variables — you'll reference them from the API service:
   - `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`

### Redis

1. Click **+ New** → **Database** → **Redis**
2. Note the `REDIS_URL` variable (e.g. `redis://default:...@...railway.app:6379`)

### Neo4j

1. Click **+ New** → **Database** → **Neo4j**
2. Railway provisions it with a persistent volume and exposes these variables:
   - `NEO4J_AUTH` — defaults to `none` (auth disabled). This is safe because Neo4j is only reachable via Railway's private network.
   - `PORT` — internal Bolt port
   - `RAILWAY_PRIVATE_DOMAIN` — internal hostname for service-to-service communication
   - `RAILWAY_TCP_PROXY_DOMAIN` / `RAILWAY_TCP_PROXY_PORT` — for external access (schema init, seeding)
3. **Leave `NEO4J_AUTH=none`** — don't change it. The API code detects this and connects without credentials. If you later want auth, set it to `neo4j/your-password` format and the API will parse it automatically.

---

## 2. Railway: API

1. Click **+ New** → **GitHub Repo** → select this repository
2. Set the **Dockerfile path** to `packages/api/Dockerfile`
3. Set the **Build context** to `/` (repo root — the Dockerfile needs `pnpm-workspace.yaml` and both `packages/shared` and `packages/api`)
4. Add environment variables, referencing other Railway services with `${{ service.variable }}` syntax:

```
NODE_ENV=production

# Neo4j — reference variables from Railway's managed Neo4j service
NEO4J_URI=bolt://${{ neo4j.RAILWAY_PRIVATE_DOMAIN }}:${{ neo4j.PORT }}
NEO4J_AUTH=${{ neo4j.NEO4J_AUTH }}

# PostgreSQL — reference Railway's managed Postgres variables
POSTGRES_HOST=${{ Postgres.PGHOST }}
POSTGRES_PORT=${{ Postgres.PGPORT }}
POSTGRES_DB=${{ Postgres.PGDATABASE }}
POSTGRES_USER=${{ Postgres.PGUSER }}
POSTGRES_PASSWORD=${{ Postgres.PGPASSWORD }}

# Redis — reference Railway's managed Redis URL
REDIS_URL=${{ Redis.REDIS_URL }}

# CORS — set after Vercel deploys (step 5)
CLIENT_ORIGIN=https://your-app.vercel.app

# API server
API_PORT=3001
API_HOST=0.0.0.0
```

5. Under **Settings** → **Networking**, expose port `3001` and generate a public domain (e.g. `nexus-api.up.railway.app`)
6. Deploy and verify health: `curl https://nexus-api.up.railway.app/health`

---

## 3. Database Initialization

Once the databases and API are running, initialize schemas and seed data. Use Railway's CLI or the shell built into the dashboard.

### Install Railway CLI (if needed)

```bash
npm i -g @railway/cli
railway login
railway link  # link to your project
```

### Run schema migrations

Connect to PostgreSQL and run the schema:

```bash
# Option A: pipe to Railway's Postgres
railway run --service Postgres -- psql -f scripts/postgres-schema.sql

# Option B: use the connection string from Railway dashboard
psql "$POSTGRES_CONNECTION_STRING" -f scripts/postgres-schema.sql
```

Initialize the Neo4j schema (indexes + full-text search). Open the **Neo4j Browser**:

1. Go to your Neo4j service in Railway → **Settings** → **Networking**
2. Expose port **7474** and generate a public domain
3. Open the generated URL in your browser
4. Since `NEO4J_AUTH=none`, select **No authentication** in the login screen

Run each statement one at a time:

```cypher
CREATE CONSTRAINT entity_id_unique IF NOT EXISTS
FOR (n:Entity) REQUIRE n.id IS UNIQUE;

CREATE INDEX entity_type IF NOT EXISTS FOR (n:Entity) ON (n.type);
CREATE INDEX entity_vertical IF NOT EXISTS FOR (n:Entity) ON (n.vertical);
CREATE INDEX entity_status IF NOT EXISTS FOR (n:Entity) ON (n.status);
CREATE INDEX entity_significance IF NOT EXISTS FOR (n:Entity) ON (n.significance);
CREATE INDEX entity_updated_at IF NOT EXISTS FOR (n:Entity) ON (n.updated_at);

CREATE FULLTEXT INDEX entity_search IF NOT EXISTS
FOR (n:Entity) ON EACH [n.name, n.summary];
```

> **Tip:** The Neo4j Browser only runs one statement at a time. Paste each `CREATE` statement separately, or enable multi-statement mode in the browser settings (`:config { enableMultiStatementMode: true }`).

### Seed data (optional)

Populate Neo4j with the 50 curated starter nodes. The seed script uses the Node.js `neo4j-driver`, so connect via the TCP proxy:

```bash
# Get RAILWAY_TCP_PROXY_DOMAIN and RAILWAY_TCP_PROXY_PORT from Railway's Neo4j service variables
export NEO4J_URI=bolt://<RAILWAY_TCP_PROXY_DOMAIN>:<RAILWAY_TCP_PROXY_PORT>
export NEO4J_AUTH=none

pnpm seed
```

---

## 4. Vercel: Client

1. Import this repository on [vercel.com/new](https://vercel.com/new)
2. Configure the project:
   - **Root Directory**: `packages/client`
   - **Framework Preset**: Vite
   - **Build Command**: `cd ../.. && pnpm install && pnpm --filter @nexus/shared build && pnpm --filter @nexus/client build`
   - **Output Directory**: `dist`
   - **Install Command**: (leave empty — handled in build command)
3. Add environment variable:
   ```
   VITE_API_URL = https://nexus-api.up.railway.app
   ```
   This gets baked into the client bundle at build time via:
   ```ts
   // packages/client/src/data/api-client.ts
   const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
   ```
4. Deploy

---

## 5. CORS Configuration

After Vercel deploys and you have the production URL:

1. Go to Railway → API service → **Variables**
2. Set `CLIENT_ORIGIN` to your Vercel URL (e.g. `https://nexus.vercel.app`)
3. Redeploy the API service

The API reads this in `packages/api/src/index.ts`:
```ts
origin: process.env.CLIENT_ORIGIN ?? "*"
```

> **Note:** Until you set `CLIENT_ORIGIN`, the API accepts requests from any origin (`*`). Lock it down once you have the production URL.

---

## 6. Verify

```bash
# 1. API health check
curl https://nexus-api.up.railway.app/health

# 2. Graph data (should return nodes if you ran seed)
curl https://nexus-api.up.railway.app/api/graph

# 3. Open the client
open https://your-app.vercel.app
```

Check:
- The 3D graph renders with nodes and edges
- Node click opens detail panel
- Cmd-K search returns results
- No CORS errors in browser console

---

## 7. Optional: Agent Pipeline

The agent pipeline (`packages/agent`) ingests live data from sources (HackerNews, arXiv, GitHub, Twitter/X) and processes them through the 3-stage LLM pipeline.

### Run as a Railway service

1. Create a new service from the same repo
2. Set the start command: `node packages/agent/dist/index.js`
3. Add environment variables:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   NEO4J_URI=bolt://${{ neo4j.RAILWAY_PRIVATE_DOMAIN }}:${{ neo4j.PORT }}
   NEO4J_AUTH=${{ neo4j.NEO4J_AUTH }}
   POSTGRES_HOST=${{ Postgres.PGHOST }}
   POSTGRES_PORT=${{ Postgres.PGPORT }}
   POSTGRES_DB=${{ Postgres.PGDATABASE }}
   POSTGRES_USER=${{ Postgres.PGUSER }}
   POSTGRES_PASSWORD=${{ Postgres.PGPASSWORD }}
   REDIS_URL=${{ Redis.REDIS_URL }}
   X_BEARER_TOKEN=your-twitter-bearer-token  # optional
   ```
4. The agent polls sources on intervals (HackerNews: 15m, arXiv: 30m, GitHub: 1h) and pushes mutations to Neo4j

### Run a one-off backfill

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export NEO4J_URI=bolt://<RAILWAY_TCP_PROXY_DOMAIN>:<RAILWAY_TCP_PROXY_PORT>
export NEO4J_AUTH=none
pnpm backfill
```

---

## 8. Optional: Custom Domain

### Vercel (client)

1. Go to Vercel → Project → **Settings** → **Domains**
2. Add your domain (e.g. `nexus.yourdomain.com`)
3. Update DNS per Vercel's instructions (CNAME to `cname.vercel-dns.com`)
4. Update `CLIENT_ORIGIN` on Railway to match the new domain

### Railway (API)

1. Go to Railway → API service → **Settings** → **Networking** → **Custom Domain**
2. Add your domain (e.g. `api.nexus.yourdomain.com`)
3. Update DNS per Railway's instructions
4. Update `VITE_API_URL` on Vercel to the new API domain and redeploy

---

## Environment Variable Reference

| Variable | Where | Required | Default |
|---|---|---|---|
| `NEO4J_URI` | Railway API | Yes | `bolt://localhost:7687` |
| `NEO4J_AUTH` | Railway API | Yes | `none` (Railway default) or `neo4j/password` |
| `POSTGRES_HOST` | Railway API | Yes | `localhost` |
| `POSTGRES_PORT` | Railway API | Yes | `5432` |
| `POSTGRES_DB` | Railway API | Yes | `nexus` |
| `POSTGRES_USER` | Railway API | Yes | `nexus` |
| `POSTGRES_PASSWORD` | Railway API | Yes | `nexus-dev-password` |
| `REDIS_URL` | Railway API | Yes | `redis://localhost:6379` |
| `CLIENT_ORIGIN` | Railway API | Recommended | `*` (any origin) |
| `API_PORT` | Railway API | No | `3001` |
| `API_HOST` | Railway API | No | `0.0.0.0` |
| `VITE_API_URL` | Vercel Client | Yes (build-time) | `http://localhost:3001` |
| `ANTHROPIC_API_KEY` | Railway Agent | For agent only | — |
| `X_BEARER_TOKEN` | Railway Agent | For Twitter source | — |
