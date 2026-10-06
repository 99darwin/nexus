/**
 * POST /mcp — public, read-only Model Context Protocol endpoint.
 *
 * Streamable HTTP in stateless mode: every request builds a fresh server and
 * transport, so there is no session state to leak, pin, or exhaust. Responses
 * are plain JSON (no SSE stream) because every tool is a single bounded query.
 *
 * Same contract as the rest of the public API: extractive only. Tools return
 * real `feed_items` rows through the exact validation path GET /api/feed uses
 * (parseFeedQuery); there is no generative model and no Jev call here, so an
 * agent can't spend upstream credits on our behalf.
 */

import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { VERTICALS, EVENT_TYPES, type FeedItem } from "@nexus/shared";
import { getPool } from "../db/postgres.js";
import { queryFeed, queryFeedMeta } from "../db/feed-queries.js";
import { insertMcpCall, type McpCall } from "../db/mcp-calls.js";
import { parseFeedQuery, BadRequestError, type FeedQuerystring } from "./feed.js";

const SERVER_NAME = "nexus";
const SERVER_VERSION = "0.1.0";
const SITE_URL = "https://nexus.carapace.bot";

/** Lower than /api/feed's 100 — an agent's context window is the scarce resource. */
const DEFAULT_TOOL_LIMIT = 20;
const MAX_TOOL_LIMIT = 50;

/** Cap on logged client-supplied strings, so clientInfo can't flood the logs. */
const MAX_LOGGED_FIELD_LENGTH = 64;

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const INSTRUCTIONS =
  "Nexus is a deduplicated, classified feed of AI industry news (launches, funding, " +
  "model releases, papers, acquisitions) aggregated from arXiv, Hacker News, GitHub, " +
  "RSS, and X. Every item carries a vertical, an event_type, and a significance score " +
  "(0.2-1.0). Use search_news for topical questions, get_latest_news to browse or " +
  "page through recent items, and get_feed_stats to see what's covered. All results " +
  `are real indexed rows with source URLs; cite them. Human UI: ${SITE_URL}`;

const verticalValues = VERTICALS.map((meta) => meta.vertical) as [string, ...string[]];
const eventTypeValues = EVENT_TYPES as [string, ...string[]];

const filterShape = {
  vertical: z.enum(verticalValues).optional().describe("Restrict to one AI vertical."),
  event_type: z.enum(eventTypeValues).optional().describe("Restrict to one event type."),
  source: z
    .string()
    .max(64)
    .optional()
    .describe("Restrict to one source, e.g. 'arxiv', 'hackernews', 'github'."),
  since: z
    .string()
    .optional()
    .describe("ISO 8601 date or timestamp; only items published at or after it."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_TOOL_LIMIT)
    .optional()
    .describe(`Max items to return (default ${DEFAULT_TOOL_LIMIT}).`),
};

type FilterArgs = {
  vertical?: string;
  event_type?: string;
  source?: string;
  since?: string;
  limit?: number;
  q?: string;
  cursor?: string;
};

/** Agent-facing shape: drops the internal id, keeps everything citeable. */
function toAgentItem(item: FeedItem) {
  return {
    title: item.title,
    url: item.url,
    source: item.source,
    published_at: item.published_at,
    excerpt: item.excerpt,
    vertical: item.vertical,
    event_type: item.event_type,
    significance: item.significance,
  };
}

function jsonResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

type ToolResult = ReturnType<typeof jsonResult> | ReturnType<typeof errorResult>;

/**
 * McpServer catches every handler throw and returns `error.message` to the
 * caller — for a DB fault that is a connection string or role name, exactly
 * what app.ts's error handler hides on the REST surface. So every handler
 * runs through here: validation messages go back so the agent can correct
 * the call, anything else is logged and returned opaque.
 */
async function guarded(
  log: FastifyBaseLogger,
  run: () => Promise<ToolResult>,
): Promise<ToolResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof BadRequestError) return errorResult(error.message);
    log.error({ err: error }, "mcp tool failed");
    return errorResult("internal error");
  }
}

async function runFeedQuery(args: FilterArgs): Promise<ToolResult> {
  const raw: FeedQuerystring = {
    q: args.q,
    cursor: args.cursor,
    vertical: args.vertical,
    event_type: args.event_type,
    source: args.source,
    since: args.since,
    limit: String(args.limit ?? DEFAULT_TOOL_LIMIT),
  };
  const { items, nextCursor } = await queryFeed(getPool(), parseFeedQuery(raw));
  return jsonResult({ items: items.map(toAgentItem), next_cursor: nextCursor });
}

export function buildMcpServer(log: FastifyBaseLogger): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "search_news",
    {
      title: "Search AI news",
      description:
        "Full-text search over indexed AI news. Supports quoted phrases, OR, and -exclusion. " +
        "Results are ranked by relevance blended with recency; not paginated.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .max(200)
          .describe("Search terms, e.g. 'open-weight reasoning model'."),
        ...filterShape,
      },
      annotations: READ_ONLY,
    },
    async ({ query, ...filters }) => guarded(log, () => runFeedQuery({ ...filters, q: query })),
  );

  server.registerTool(
    "get_latest_news",
    {
      title: "Latest AI news",
      description:
        "Most recent AI news items, newest first, with optional filters. " +
        "Pass the returned next_cursor back as `cursor` to fetch older items.",
      inputSchema: {
        ...filterShape,
        cursor: z.string().max(100).optional().describe("next_cursor from a previous call."),
      },
      annotations: READ_ONLY,
    },
    async (args) => guarded(log, () => runFeedQuery(args)),
  );

  server.registerTool(
    "get_feed_stats",
    {
      title: "Feed coverage stats",
      description:
        "Total item count plus counts per vertical and per event_type. " +
        "Use to discover valid filter values and where coverage is dense.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => guarded(log, async () => jsonResult(await queryFeedMeta(getPool()))),
  );

  return server;
}

function truncate(value: unknown): string | undefined {
  return typeof value === "string" ? value.slice(0, MAX_LOGGED_FIELD_LENGTH) : undefined;
}

/**
 * Best-effort usage telemetry: which method, which tool, which client — into
 * the log and the mcp_calls table. Nothing user-identifying, and every field
 * is client-supplied, so each is truncated. Notifications are skipped; they
 * carry no intent. The insert is fire-and-forget: a telemetry failure must
 * never fail or delay the agent's request.
 */
function recordMcpCall(request: FastifyRequest): void {
  const body = request.body as
    | {
        method?: unknown;
        params?: { name?: unknown; clientInfo?: { name?: unknown; version?: unknown } };
      }
    | undefined;
  const method = truncate(body?.method);
  if (!method || method.startsWith("notifications/")) return;

  const call: McpCall = {
    method,
    tool: method === "tools/call" ? truncate(body?.params?.name) : undefined,
    clientName: method === "initialize" ? truncate(body?.params?.clientInfo?.name) : undefined,
    clientVersion:
      method === "initialize" ? truncate(body?.params?.clientInfo?.version) : undefined,
  };

  request.log.info({ mcp: call }, "mcp request");
  insertMcpCall(getPool(), call).catch((error: unknown) => {
    request.log.warn({ err: error }, "mcp_calls insert failed");
  });
}

export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  app.post("/mcp", async (request, reply) => {
    // The transport accepts JSON-RPC batches of up to 100 messages and runs
    // them concurrently, while the rate limiter counts one request — a 100x
    // amplifier on full-table COUNT(*)s. MCP clients don't need batching.
    if (Array.isArray(request.body)) {
      return reply.code(400).send({ error: "JSON-RPC batches are not supported" });
    }
    recordMcpCall(request);

    const server = buildMcpServer(request.log);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    // The transport writes the raw response itself, so headers set through
    // reply.header() — CORS, the hardening hook, rate-limit — would never be
    // flushed. Carry them onto the raw response before Fastify stands back.
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) reply.raw.setHeader(name, value);
    }
    reply.hijack();
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (error) {
      // After hijack Fastify only logs a rejection; without this the socket
      // would hang open with no response.
      request.log.error({ err: error }, "mcp transport failed");
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { "content-type": "application/json" });
      }
      reply.raw.end(JSON.stringify({ error: "internal error" }));
    }
  });

  // Stateless: no server-initiated stream to open, no session to delete.
  const methodNotAllowed = async (_request: FastifyRequest, reply: FastifyReply) =>
    reply.code(405).header("Allow", "POST").send({ error: "method not allowed" });
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);
}
