/**
 * Public feed endpoints.
 *
 * GET /api/feed       — keyset-paginated reverse-chron feed with facet filters
 * GET /api/feed/meta  — facet counts, drives the client's filter chips
 *
 * Every query parameter is validated before it reaches SQL; anything
 * malformed is a 400 rather than a silently-coerced default, so a client
 * bug surfaces instead of quietly returning the wrong page.
 */

import type { FastifyInstance } from "fastify";
import { VERTICALS, EVENT_TYPES, type Vertical, type EventType } from "@nexus/shared";
import { getPool } from "../db/postgres.js";
import { queryFeed, queryFeedMeta, type FeedCursor } from "../db/feed-queries.js";

const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;
const MAX_SOURCE_LENGTH = 64;
const MAX_QUERY_LENGTH = 200;

const VERTICAL_VALUES = new Set<string>(VERTICALS.map((meta) => meta.vertical));
const EVENT_TYPE_VALUES = new Set<string>(EVENT_TYPES);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Date.parse is far more permissive than Postgres: it accepts "0", "2026",
 * and assorted locale strings that then blow up on the ::timestamptz cast,
 * turning a bad query parameter into a 500. Require a real ISO 8601 date
 * first. Six fractional digits are allowed because cursors carry Postgres's
 * microsecond precision — see CURSOR_KEY_COLUMN in db/feed-queries.ts.
 */
const ISO_8601_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** A time component with no trailing Z/offset — JS would read it as server-local. */
const MISSING_ZONE_PATTERN = /[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?$/;

/**
 * A bare date. Needs the same explicit UTC anchoring as a zone-less timestamp:
 * handed to Postgres as-is it is resolved in the *session* timezone, so the
 * same cursor would mean different instants on differently-configured servers.
 */
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Postgres timestamptz starts at year 0001; JS happily builds year 0000. */
const MIN_YEAR = 1;

/** Trailing UTC offset, if the timestamp carries one. */
const ZONE_OFFSET_PATTERN = /([+-])(\d{2}):?(\d{2})$/;

/**
 * Postgres rejects a timezone_hour outside -15..15, but JavaScript accepts
 * anything up to +/-23:59 — so an offset in that gap parses cleanly here and
 * then throws on the ::timestamptz cast, turning a bad parameter into a 500.
 */
const MAX_OFFSET_HOURS = 15;

/**
 * True when y-m-d names a day that exists.
 *
 * The regex above only checks shape, and `new Date()` silently rolls an
 * impossible date forward — Feb 29 in a common year becomes Mar 1 — which
 * would quietly change what the caller asked for.
 */
function isRealDate(year: number, month: number, day: number): boolean {
  if (year < MIN_YEAR || month < 1 || month > 12 || day < 1) return false;
  // Day 0 of the next month is the last day of this one.
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export interface FeedQuerystring {
  cursor?: string;
  limit?: string;
  vertical?: string;
  event_type?: string;
  source?: string;
  since?: string;
  q?: string;
}

class BadRequestError extends Error {}

/**
 * Fastify hands back an array when a parameter is repeated (`?q=a&q=b`), even
 * though the typed querystring says string. Reject that shape before any
 * string method runs on it.
 */
function single(raw: unknown, field: string): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") throw new BadRequestError(`${field} must be a single value`);
  return raw;
}

/**
 * Validates a strict ISO 8601 timestamp and pins it to UTC.
 *
 * Returns the input with an explicit zone, preserving whatever sub-second
 * precision it carried. A zone-less timestamp is read as UTC, not as the
 * server's local time, so the same request means the same thing on every
 * deployment.
 */
function validateTimestamp(raw: string, field: string): string {
  if (!ISO_8601_PATTERN.test(raw) || Number.isNaN(Date.parse(raw))) {
    throw new BadRequestError(`${field} must be an ISO 8601 timestamp`);
  }

  const [year, month, day] = raw.slice(0, 10).split("-").map(Number);
  if (!isRealDate(year, month, day)) {
    throw new BadRequestError(`${field} must be a real calendar date`);
  }

  const offset = ZONE_OFFSET_PATTERN.exec(raw);
  if (offset) {
    const hours = Number(offset[2]);
    const minutes = Number(offset[3]);
    if (minutes > 59 || hours > MAX_OFFSET_HOURS || (hours === MAX_OFFSET_HOURS && minutes > 0)) {
      throw new BadRequestError(`${field} has an out-of-range UTC offset`);
    }
  }

  const zoned = DATE_ONLY_PATTERN.test(raw)
    ? `${raw}T00:00:00Z`
    : MISSING_ZONE_PATTERN.test(raw)
      ? `${raw.replace(" ", "T")}Z`
      : raw;

  // A UTC offset can push an in-range date back across the year-1 boundary
  // (`0001-01-01T00:00+05:00`), which Postgres rejects.
  const iso = new Date(zoned).toISOString();
  if (!/^\d{4}-/.test(iso) || Number(iso.slice(0, 4)) < MIN_YEAR) {
    throw new BadRequestError(`${field} is out of range`);
  }
  return zoned;
}

/**
 * Canonical millisecond-precision UTC form, so Postgres sees exactly one
 * shape for filter parameters. Not used for cursors: `new Date()` truncates
 * to milliseconds and a cursor needs every microsecond it was given.
 */
function toIsoTimestamp(raw: string, field: string): string {
  return new Date(validateTimestamp(raw, field)).toISOString();
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  if (!/^\d+$/.test(raw)) throw new BadRequestError("limit must be an integer");
  const limit = parseInt(raw, 10);
  if (limit < MIN_LIMIT || limit > MAX_LIMIT) {
    throw new BadRequestError(`limit must be between ${MIN_LIMIT} and ${MAX_LIMIT}`);
  }
  return limit;
}

/** Cursor wire format: `<published_at ISO>,<uuid>` — the last row of the previous page. */
function parseCursor(raw: string | undefined): FeedCursor | undefined {
  if (raw === undefined) return undefined;

  const separator = raw.lastIndexOf(",");
  if (separator === -1) throw new BadRequestError("cursor must be '<published_at>,<id>'");

  const publishedAt = raw.slice(0, separator).trim();
  const id = raw.slice(separator + 1).trim();

  if (!UUID_PATTERN.test(id)) throw new BadRequestError("cursor id must be a uuid");

  // Passed through at full precision — see validateTimestamp.
  return { publishedAt: validateTimestamp(publishedAt, "cursor timestamp"), id };
}

function parseTimestamp(raw: string | undefined, field: string): string | undefined {
  if (raw === undefined) return undefined;
  return toIsoTimestamp(raw, field);
}

function parseVertical(raw: string | undefined): Vertical | undefined {
  if (raw === undefined) return undefined;
  if (!VERTICAL_VALUES.has(raw)) throw new BadRequestError("unknown vertical");
  return raw as Vertical;
}

function parseEventType(raw: string | undefined): EventType | undefined {
  if (raw === undefined) return undefined;
  if (!EVENT_TYPE_VALUES.has(raw)) throw new BadRequestError("unknown event_type");
  return raw as EventType;
}

function parseSource(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const source = raw.trim();
  if (!source || source.length > MAX_SOURCE_LENGTH) {
    throw new BadRequestError("source must be 1-64 characters");
  }
  return source;
}

function parseSearchTerm(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const q = raw.trim();
  if (!q) return undefined;
  if (q.length > MAX_QUERY_LENGTH) {
    throw new BadRequestError(`q must be at most ${MAX_QUERY_LENGTH} characters`);
  }
  return q;
}

export async function feedRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: FeedQuerystring }>("/api/feed", async (request, reply) => {
    let limit: number;
    let cursor: FeedCursor | undefined;
    let vertical: Vertical | undefined;
    let eventType: EventType | undefined;
    let source: string | undefined;
    let since: string | undefined;
    let q: string | undefined;

    try {
      limit = parseLimit(single(request.query.limit, "limit"));
      cursor = parseCursor(single(request.query.cursor, "cursor"));
      vertical = parseVertical(single(request.query.vertical, "vertical"));
      eventType = parseEventType(single(request.query.event_type, "event_type"));
      source = parseSource(single(request.query.source, "source"));
      since = parseTimestamp(single(request.query.since, "since"), "since");
      q = parseSearchTerm(single(request.query.q, "q"));

      if (q && cursor) {
        // Relevance ordering has no stable keyset — refuse rather than
        // silently returning a page the caller didn't ask for.
        throw new BadRequestError("cursor pagination is not supported together with q");
      }
    } catch (error) {
      if (error instanceof BadRequestError) {
        reply.code(400).send({ error: error.message });
        return;
      }
      throw error;
    }

    const { items, nextCursor } = await queryFeed(getPool(), {
      limit,
      cursor,
      vertical,
      eventType,
      source,
      since,
      q,
    });

    return { items, next_cursor: nextCursor };
  });

  app.get("/api/feed/meta", async () => queryFeedMeta(getPool()));
}
