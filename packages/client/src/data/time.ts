/* time + url formatting shared by the feed and the chat transcript.
 * all copy is lowercase terminal voice. */

const ONE_DAY_MS = 86_400_000;

export function relativeTime(timestamp: string): string {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return "unknown";

  const ms = Date.now() - parsed;
  if (ms < 0) return "just now";

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export const BUCKET_ORDER = ["today", "yesterday", "this week", "this month", "older"] as const;

export type DateBucket = (typeof BUCKET_ORDER)[number];

export function dateBucket(timestamp: string): DateBucket {
  const ts = Date.parse(timestamp);
  if (Number.isNaN(ts)) return "older";

  const todayStart = new Date().setHours(0, 0, 0, 0);
  if (ts >= todayStart) return "today";
  if (ts >= todayStart - ONE_DAY_MS) return "yesterday";

  const age = Date.now() - ts;
  if (age < 7 * ONE_DAY_MS) return "this week";
  if (age < 30 * ONE_DAY_MS) return "this month";
  return "older";
}

/** hostname + a clipped path — enough to see where a link goes before clicking. */
export function truncateUrl(url: string, maxPathLength = 24): string {
  try {
    const { hostname, pathname } = new URL(url);
    const path =
      pathname.length > maxPathLength ? `${pathname.slice(0, maxPathLength)}…` : pathname;
    return hostname.replace(/^www\./, "") + (path === "/" ? "" : path);
  } catch {
    return url.slice(0, 40);
  }
}

/** Only http(s) links are ever rendered as anchors — api rows are untrusted input. */
export function isSafeHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
