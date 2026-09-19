import { NODE_TYPES, NODE_STATUSES, EVENT_TYPES, VERTICALS as VERTICAL_META } from "./constants.js";
import type { Vertical } from "./types.js";

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

// Derived from constants.ts so the two never drift apart.
const VERTICALS: readonly Vertical[] = VERTICAL_META.map((v) => v.vertical);

const ALLOWED_URL_PROTOCOLS = new Set(["http:", "https:"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isValidFloat01(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 1;
}

const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

function isISOTimestamp(value: unknown): boolean {
  if (typeof value !== "string" || !ISO_TIMESTAMP_RE.test(value)) return false;
  const d = new Date(value);
  if (isNaN(d.getTime())) return false;
  // Reject impossible calendar dates (Feb 30 rolls over in V8 instead of
  // returning Invalid Date) by re-parsing the date fields in UTC and
  // checking they come back unchanged.
  const [y, m, day] = value.slice(0, 10).split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, day));
  return (
    probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === day
  );
}

function isHttpUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  try {
    return ALLOWED_URL_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function validateGraphNode(node: unknown): ValidationResult {
  const errors: string[] = [];
  if (!node || typeof node !== "object")
    return { isValid: false, errors: ["Node must be an object"] };
  const n = node as Record<string, unknown>;

  if (!isNonEmptyString(n.id)) errors.push("id must be a non-empty string");
  if (!isNonEmptyString(n.name)) errors.push("name must be a non-empty string");
  if (!isNonEmptyString(n.summary)) errors.push("summary must be a non-empty string");
  if (!NODE_TYPES.includes(n.type as never))
    errors.push(`type must be one of: ${NODE_TYPES.join(", ")}`);
  if (!VERTICALS.includes(n.vertical as never))
    errors.push(`vertical must be one of: ${VERTICALS.join(", ")}`);
  if (!NODE_STATUSES.includes(n.status as never))
    errors.push(`status must be one of: ${NODE_STATUSES.join(", ")}`);
  if (!isValidFloat01(n.significance)) errors.push("significance must be a number between 0 and 1");
  if (!isISOTimestamp(n.discovered_at)) errors.push("discovered_at must be a valid ISO timestamp");
  if (!isISOTimestamp(n.updated_at)) errors.push("updated_at must be a valid ISO timestamp");

  if (!Array.isArray(n.verticals_secondary)) {
    errors.push("verticals_secondary must be an array");
  } else {
    for (const v of n.verticals_secondary) {
      if (!VERTICALS.includes(v as never)) errors.push(`invalid secondary vertical: ${v}`);
    }
  }

  if (!Array.isArray(n.events)) {
    errors.push("events must be an array");
  } else {
    for (let i = 0; i < n.events.length; i++) {
      const raw = n.events[i];
      if (!raw || typeof raw !== "object") {
        errors.push(`events[${i}] must be an object`);
        continue;
      }
      const e = raw as Record<string, unknown>;
      if (!isISOTimestamp(e.timestamp)) errors.push(`events[${i}].timestamp must be valid ISO`);
      if (!EVENT_TYPES.includes(e.event_type as never))
        errors.push(`events[${i}].event_type invalid`);
      if (!isNonEmptyString(e.summary))
        errors.push(`events[${i}].summary must be non-empty string`);
      if (!isHttpUrl(e.source_url))
        errors.push(`events[${i}].source_url must be a non-empty http(s) URL`);
    }
  }

  return { isValid: errors.length === 0, errors };
}

export function validateFeedItem(item: unknown): ValidationResult {
  const errors: string[] = [];
  if (!item || typeof item !== "object")
    return { isValid: false, errors: ["FeedItem must be an object"] };
  const f = item as Record<string, unknown>;

  if (!isNonEmptyString(f.id)) errors.push("id must be a non-empty string");
  if (!isNonEmptyString(f.title)) errors.push("title must be a non-empty string");
  if (!isHttpUrl(f.url)) errors.push("url must be a non-empty http(s) URL");
  if (!isNonEmptyString(f.source)) errors.push("source must be a non-empty string");
  if (!isISOTimestamp(f.published_at)) errors.push("published_at must be a valid ISO timestamp");

  if (f.excerpt !== null && typeof f.excerpt !== "string")
    errors.push("excerpt must be a string or null");

  if (f.vertical !== null && !VERTICALS.includes(f.vertical as never))
    errors.push(`vertical must be null or one of: ${VERTICALS.join(", ")}`);

  if (f.event_type !== null && !EVENT_TYPES.includes(f.event_type as never))
    errors.push(`event_type must be null or one of: ${EVENT_TYPES.join(", ")}`);

  if (f.significance !== null && !isValidFloat01(f.significance))
    errors.push("significance must be null or a number between 0 and 1");

  return { isValid: errors.length === 0, errors };
}
