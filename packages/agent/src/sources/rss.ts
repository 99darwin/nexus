import { lookup as dnsLookup } from "node:dns/promises";
import type { RawItem } from "./types.js";
import { BaseAdapter } from "./base-adapter.js";
import { discardBody, readBoundedText } from "./http.js";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const MAX_RSS_BYTES = 10 * 1024 * 1024; // 10 MB
const FETCH_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;
/** Per-feed cap so one firehose can't crowd out the other feeds in a poll. */
const MAX_ITEMS_PER_FEED = 25;

// Field caps — untrusted feed content lands in Postgres, so bound it here.
// Generous enough for a full-text `content:encoded` post, so legitimate long
// entries are not dropped, but still a hard bound on per-entry parse work.
const MAX_ENTRY_CHARS = 256 * 1024;
const MAX_TITLE_CHARS = 512;
const MAX_CONTENT_CHARS = 10_000;
const MAX_URL_CHARS = 2048;

export interface RssFeed {
  /** Slug written to RawItem.source — drives the feed's source filter. */
  source: string;
  url: string;
}

/**
 * Company blogs and AI-desk news feeds. Each entry becomes its own
 * `RawItem.source`, so the feed UI can filter by publication.
 */
export const RSS_FEEDS: RssFeed[] = [
  { source: "openai", url: "https://openai.com/news/rss.xml" },
  { source: "anthropic", url: "https://www.anthropic.com/news/rss.xml" },
  { source: "deepmind", url: "https://deepmind.google/blog/rss.xml" },
  { source: "huggingface", url: "https://huggingface.co/blog/feed.xml" },
  { source: "techcrunch_ai", url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
  {
    source: "theverge_ai",
    url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
  },
  { source: "simonwillison", url: "https://simonwillison.net/atom/everything/" },
];

// ── URL / host safety ───────────────────────────────────────────────────

const PRIVATE_HOST_NAMES = [/^localhost$/i, /\.local$/i, /\.internal$/i];

/** Private / loopback / link-local IPv4 ranges, as [network, prefix-bits]. */
const PRIVATE_IPV4_RANGES: Array<[number, number]> = [
  [0x00000000, 8], // 0.0.0.0/8 "this network"
  [0x0a000000, 8], // 10/8
  [0x7f000000, 8], // 127/8 loopback
  [0xa9fe0000, 16], // 169.254/16 link-local — cloud metadata lives at 169.254.169.254
  [0xac100000, 12], // 172.16/12
  [0xc0a80000, 16], // 192.168/16
  [0x64400000, 10], // 100.64/10 CGNAT
];

/**
 * Parse an IPv4 literal the way `inet_aton` does — decimal, octal, hex, and
 * the short forms. `http://2130706433/` and `http://0177.0.0.1/` and
 * `http://127.1/` all reach loopback, so a dotted-decimal string match alone
 * is not a usable SSRF control.
 */
function parseIpv4(host: string): number | null {
  const parts = host.split(".");
  if (parts.length < 1 || parts.length > 4) return null;

  const nums: number[] = [];
  for (const part of parts) {
    let value: number;
    if (/^0[xX][0-9a-fA-F]{1,8}$/.test(part)) value = parseInt(part.slice(2), 16);
    else if (/^0[0-7]{1,11}$/.test(part)) value = parseInt(part, 8);
    else if (/^(0|[1-9]\d{0,9})$/.test(part)) value = parseInt(part, 10);
    else return null;
    if (!Number.isSafeInteger(value) || value < 0) return null;
    nums.push(value);
  }

  // inet_aton: the final part absorbs all remaining low-order bytes.
  const last = nums[nums.length - 1]!;
  const leading = nums.slice(0, -1);
  if (leading.some((n) => n > 255)) return null;
  if (last >= 2 ** (8 * (4 - leading.length))) return null;

  let result = last;
  leading.forEach((n, i) => {
    result += n * 2 ** (8 * (3 - i));
  });
  return result >>> 0;
}

function isPrivateIpv4(addr: number): boolean {
  return PRIVATE_IPV4_RANGES.some(
    ([network, bits]) => (addr >>> (32 - bits)) === (network >>> (32 - bits)),
  );
}

/**
 * Expand an IPv6 literal into its eight 16-bit groups.
 *
 * Classifying IPv6 by string spelling does not work: `::ffff:7f00:1`,
 * `::ffff:127.0.0.1` and `0:0:0:0:0:ffff:7f00:1` are the SAME address, and a
 * regex anchored on one spelling silently admits the others. Everything below
 * is decided on the parsed numbers instead.
 */
function parseIpv6(host: string): number[] | null {
  let text = host;

  // A trailing dotted quad (::ffff:127.0.0.1) becomes two more groups. The
  // dot is required: without it the last hex group of an ordinary address
  // ("::ffff:7f00:1", "2600::1") would be eaten as if it were IPv4.
  const tail = /^(.*:)(\d{1,3}(?:\.\d{1,3}){1,3})$/.exec(text);
  if (tail) {
    const v4 = parseIpv4(tail[2]!);
    if (v4 === null) return null;
    const hi = (v4 >>> 16).toString(16);
    const lo = (v4 & 0xffff).toString(16);
    text = `${tail[1]}${hi}:${lo}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;

  const toGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const g of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  const head = toGroups(halves[0] ?? "");
  const rest = halves.length === 2 ? toGroups(halves[1] ?? "") : null;
  if (head === null) return null;

  if (halves.length === 1) return head.length === 8 ? head : null;
  if (rest === null) return null;
  const fill = 8 - head.length - rest.length;
  if (fill < 1) return null; // "::" must stand for at least one zero group
  return [...head, ...Array<number>(fill).fill(0), ...rest];
}

/** Reject hosts that resolve inside the deployment network. */
export function isPublicHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host.length === 0) return false;
  if (PRIVATE_HOST_NAMES.some((p) => p.test(host))) return false;

  if (host.includes(":")) {
    const groups = parseIpv6(host);
    // An IPv6-looking host we cannot parse is not one we should trust.
    if (groups === null) return false;

    // ::  (unspecified) and ::1 (loopback)
    const allZeroButLast = groups.slice(0, 7).every((g) => g === 0);
    if (allZeroButLast && (groups[7] === 0 || groups[7] === 1)) return false;

    // ::ffff:a.b.c.d — v4-mapped, in any spelling. Judge the embedded v4.
    if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
      const embedded = ((groups[6]! << 16) | groups[7]!) >>> 0;
      return !isPrivateIpv4(embedded);
    }
    // 64:ff9b::/96 — NAT64, also carries a v4 destination in the last 32 bits.
    if (groups[0] === 0x64 && groups[1] === 0xff9b && groups[2] === 0) {
      const embedded = ((groups[6]! << 16) | groups[7]!) >>> 0;
      return !isPrivateIpv4(embedded);
    }
    // 64:ff9b:1::/48 — the local-use NAT64 prefix (RFC 8215). Its embedded v4
    // sits at a position that depends on the operator's prefix length, so there
    // is no single field to validate. Reject the whole block: nothing legitimate
    // in a feed list is addressed through a site's own NAT64 translator.
    if (groups[0] === 0x64 && groups[1] === 0xff9b) return false;

    if ((groups[0]! & 0xfe00) === 0xfc00) return false; // fc00::/7 unique-local
    if ((groups[0]! & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
    return true;
  }

  const addr = parseIpv4(host);
  if (addr !== null) return !isPrivateIpv4(addr);

  return true; // a regular DNS name
}

/** Subset of `dns.promises.lookup` used here; injectable for tests. */
export type LookupFn = (
  hostname: string,
  options: { all: true },
) => Promise<Array<{ address: string; family: number }>>;

/**
 * Reject a hostname that resolves to a non-public address.
 *
 * `isPublicHost` alone only recognizes literal IPs and a few suffixes, so
 * `http://127.0.0.1.nip.io/` — and any attacker-controlled DNS name with an
 * A record pointing at loopback, RFC1918 space, or 169.254.169.254 — sails
 * through it. Redirect targets are attacker-chosen even though the configured
 * feed list is not, so every hop is resolved before it is fetched.
 *
 * EVERY resolved address must be public: a name with one public and one
 * private A record would otherwise be a coin flip at connect time.
 *
 * Residual TOCTOU: the name is re-resolved by fetch when the socket opens, so
 * a DNS entry with a ~0 TTL can return a public address here and a private one
 * microseconds later (classic DNS rebinding). Closing that gap entirely means
 * pinning the vetted IP into the connection — a custom agent/dispatcher rather
 * than global fetch. This check removes the trivial "just point a name at
 * 127.0.0.1" attack; it does not claim to stop an active rebinder.
 */
async function assertPublicHostname(hostname: string, lookupImpl: LookupFn): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, "");

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookupImpl(host, { all: true });
  } catch {
    throw new Error("host did not resolve");
  }

  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new Error("host resolved to no addresses");
  }

  for (const entry of addresses) {
    // family 6 addresses arrive bare (no brackets); isPublicHost handles both,
    // including ::ffff: v4-mapped forms.
    if (!isPublicHost(entry.address)) {
      throw new Error("host resolves to a non-public address");
    }
  }
}

/**
 * Parse an untrusted URL, allowing only public http(s) origins.
 * Blocks `javascript:` / `data:` links from reaching the database, and
 * blocks redirects aimed at internal addresses.
 *
 * This is the syntactic half of the check — it cannot see where a DNS name
 * points. Anything about to be FETCHED must also pass `assertPublicHostname`.
 */
export function safeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_CHARS) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password) return null;
  if (!isPublicHost(parsed.hostname)) return null;

  return parsed.href;
}

/**
 * Feed-list-driven adapter covering RSS 2.0 (`<item>`) and Atom (`<entry>`).
 *
 * Parsing is a linear `indexOf` scan rather than backtracking regexes: feed
 * XML is untrusted, and a lazy-quantifier regex over unmatched opening tags
 * is quadratic, which would stall the single-threaded poll loop.
 */
export class RssAdapter extends BaseAdapter {
  name = "rss";
  priority = "P1" as const;

  private readonly feeds: RssFeed[];
  private readonly lookupImpl: LookupFn;

  constructor(feeds: RssFeed[] = RSS_FEEDS, options: { lookupImpl?: LookupFn } = {}) {
    super({ pollIntervalMs: SIX_HOURS_MS, rateLimitMs: 3000 });
    this.feeds = feeds;
    this.lookupImpl = options.lookupImpl ?? (dnsLookup as unknown as LookupFn);
  }

  protected async fetchItems(signal?: AbortSignal): Promise<RawItem[]> {
    const items: RawItem[] = [];

    for (const feed of this.feeds) {
      signal?.throwIfAborted();
      try {
        const xml = await this.fetchFeed(feed.url, signal);
        items.push(...this.parseFeed(xml, feed.source));
      } catch (err) {
        // One dead feed must not fail the whole poll — but an abort is not a
        // dead feed. Swallowing it here would walk the rest of the feed list
        // after the cycle was cancelled.
        if (signal?.aborted) throw signal.reason as Error;
        console.warn(`[rss:${feed.source}] ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const deduped = this.dedupeByUrl(items);
    console.log(`[rss] feeds=${this.feeds.length} items=${items.length} unique=${deduped.length}`);
    return deduped;
  }

  /** Fetch with manual redirect handling so no hop can target an internal host. */
  private async fetchFeed(url: string, signal?: AbortSignal): Promise<string> {
    let current = safeUrl(url);
    if (!current) throw new Error("feed url rejected");

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      signal?.throwIfAborted();
      // Resolve before every hop, not just the first: the configured feed list
      // is trusted, but a redirect target is whatever the upstream says.
      await assertPublicHostname(new URL(current).hostname, this.lookupImpl);
      // `dns.lookup` takes no signal, so a stalled resolver can sit here well
      // past the cycle deadline. Recheck before opening a socket, so a cancelled
      // cycle cannot start a fetch after it was told to stop.
      signal?.throwIfAborted();

      // Per-request timeout AND the cycle's signal: the first bounds one slow
      // hop, the second lets shutdown or the cycle deadline cancel the chain.
      const perRequest = AbortSignal.timeout(FETCH_TIMEOUT_MS);
      const response = await fetch(current, {
        redirect: "manual",
        headers: {
          Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
        },
        signal: signal ? AbortSignal.any([signal, perRequest]) : perRequest,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers?.get("location");
        // Release the socket before the next hop. An abandoned body lets the
        // server keep streaming into a connection nobody will read, across
        // every redirect in the chain.
        await discardBody(response);
        if (!location) throw new Error(`redirect without location (${response.status})`);
        const next = safeUrl(new URL(location, current).href);
        if (!next) throw new Error("redirect target rejected");
        current = next;
        continue;
      }

      if (!response.ok) {
        await discardBody(response);
        throw new Error(`fetch failed: ${response.status}`);
      }
      return await this.readBody(response);
    }

    throw new Error(`too many redirects (>${MAX_REDIRECTS})`);
  }

  /** Stream with a size limit — Content-Length is absent under chunked encoding. */
  private async readBody(response: Response): Promise<string> {
    if (!response.body) throw new Error("no response body");
    return await readBoundedText(response, { maxBytes: MAX_RSS_BYTES, label: "rss response" });
  }

  /**
   * Linear scan over `<item>` / `<entry>` elements. Stops as soon as
   * MAX_ITEMS_PER_FEED entries are accepted, so a huge feed is never
   * fully materialized.
   */
  private parseFeed(xml: string, source: string): RawItem[] {
    const items: RawItem[] = [];
    let pos = 0;

    while (items.length < MAX_ITEMS_PER_FEED) {
      const open = this.findEntryOpen(xml, pos);
      if (!open) break;

      const closeTag = `</${open.tag}>`;
      const end = xml.indexOf(closeTag, open.contentStart);
      if (end === -1) break; // malformed tail — stop rather than rescan
      pos = end + closeTag.length;

      // Oversized entry: skip the body, keep scanning the rest of the feed.
      if (end - open.contentStart > MAX_ENTRY_CHARS) continue;

      const entryXml = xml.slice(open.contentStart, end);
      const item = this.parseEntry(entryXml, source);
      if (item) items.push(item);
    }

    return items;
  }

  /** Next `<item ...>` or `<entry ...>` open tag at or after `from`. */
  private findEntryOpen(
    xml: string,
    from: number,
  ): { tag: "item" | "entry"; contentStart: number } | null {
    let cursor = from;
    // Memoized search positions. `indexOf` results only move forward, so a hit
    // that is still ahead of the cursor stays valid. Without this, a feed of
    // `<itemx>` filler re-searches for `<entry` all the way to end-of-input on
    // every iteration — quadratic in the feed size, and a 10 MB body would
    // stall the single-threaded poll loop. NOT_SEARCHED forces the first probe;
    // ABSENT is sticky, so a missing tag is searched for exactly once.
    const NOT_SEARCHED = -2;
    const ABSENT = -1;
    let itemAt = NOT_SEARCHED;
    let entryAt = NOT_SEARCHED;

    for (;;) {
      if (itemAt !== ABSENT && itemAt < cursor) itemAt = xml.indexOf("<item", cursor);
      if (entryAt !== ABSENT && entryAt < cursor) entryAt = xml.indexOf("<entry", cursor);
      if (itemAt === -1 && entryAt === -1) return null;

      const useItem = itemAt !== -1 && (entryAt === -1 || itemAt < entryAt);
      const at = useItem ? itemAt : entryAt;
      const tag = useItem ? "item" : "entry";
      const after = xml[at + tag.length + 1];

      // Must be `<item>` or `<item ...>`, not `<items>` / `<entryfoo>`.
      if (after === ">" || after === " " || after === "\t" || after === "\n" || after === "\r") {
        const gt = xml.indexOf(">", at);
        if (gt === -1) return null;
        // Self-closing `<entry/>` carries no content.
        if (xml[gt - 1] !== "/") return { tag, contentStart: gt + 1 };
        cursor = gt + 1;
        continue;
      }

      cursor = at + tag.length + 1;
    }
  }

  private parseEntry(entryXml: string, source: string): RawItem | null {
    const title = this.extractTag(entryXml, "title");
    const rawLink = this.extractLink(entryXml);
    if (!title || !rawLink) return null;

    // Rejects javascript:/data: and internal hosts before they reach Postgres.
    const link = safeUrl(this.cleanHtml(rawLink));
    if (!link) return null;

    const cleanTitle = this.cleanHtml(title).slice(0, MAX_TITLE_CHARS);
    if (cleanTitle.length === 0) return null;

    const description =
      this.extractTag(entryXml, "content:encoded") ??
      this.extractTag(entryXml, "summary") ??
      this.extractTag(entryXml, "description") ??
      this.extractTag(entryXml, "content");

    const published =
      this.extractTag(entryXml, "pubDate") ??
      this.extractTag(entryXml, "published") ??
      this.extractTag(entryXml, "dc:date") ??
      this.extractTag(entryXml, "updated");

    return {
      source,
      source_url: link,
      title: cleanTitle,
      content: this.cleanHtml(description ?? "").slice(0, MAX_CONTENT_CHARS),
      published_at: this.safeParseDate(published),
      raw_metadata: { feed_source: source },
    };
  }

  /** RSS puts the URL in element text; Atom puts it in an `href` attribute. */
  private extractLink(xml: string): string | null {
    // Walk `<link …>` tags one at a time and match attributes inside a single
    // bounded tag slice. Running `<link[^>]*\srel=…[^>]*\shref=…` over the whole
    // entry lets the two `[^>]*` sections backtrack against each other across a
    // 256 KiB body when the `href` never arrives — polynomial, and repeatable
    // 25 times per feed.
    let fallbackHref: string | null = null;
    let i = xml.indexOf("<link");

    while (i !== -1) {
      const gt = xml.indexOf(">", i);
      if (gt === -1) break; // unterminated tag — nothing further is parseable
      const tag = xml.slice(i, gt + 1);
      const href = /\shref=["']([^"']+)["']/i.exec(tag)?.[1];
      if (href) {
        // Atom's canonical permalink. Attribute order is not significant here,
        // unlike in the regex this replaced.
        if (/\srel=["']alternate["']/i.test(tag)) return href;
        fallbackHref ??= href;
      }
      i = xml.indexOf("<link", gt + 1);
    }

    const text = this.extractTag(xml, "link");
    if (text && /^https?:\/\//i.test(text.trim())) return text;

    if (fallbackHref) return fallbackHref;

    const guid = this.extractTag(xml, "guid");
    if (guid && /^https?:\/\//i.test(guid.trim())) return guid;

    return null;
  }

  /**
   * First text content of `<tag>`, via linear scanning. A regex with a lazy
   * quantifier would rescan from every unmatched opening tag.
   */
  private extractTag(xml: string, tag: string): string | null {
    const open = `<${tag}`;
    let i = xml.indexOf(open);

    while (i !== -1) {
      const after = xml[i + open.length];
      if (after === ">" || after === " " || after === "\t" || after === "\n" || after === "\r") {
        const gt = xml.indexOf(">", i);
        if (gt === -1) return null;
        if (xml[gt - 1] === "/") {
          i = xml.indexOf(open, gt + 1); // self-closing, no text
          continue;
        }
        const close = xml.indexOf(`</${tag}`, gt + 1);
        if (close === -1) return null;
        return xml.slice(gt + 1, close).trim();
      }
      i = xml.indexOf(open, i + open.length);
    }

    return null;
  }

  private safeParseDate(dateStr: string | null): string {
    if (!dateStr) return new Date().toISOString();
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }

  /**
   * Reduce markup to plain text. Entities are decoded BEFORE tags are
   * stripped, so `&lt;img onerror=…&gt;` is removed rather than stored as
   * literal, XSS-shaped text for a downstream renderer to mishandle.
   *
   * Decode-and-strip repeats up to MAX_DECODE_PASSES, because one pass leaves
   * double-encoded markup (`&amp;lt;img onerror=…&amp;gt;`) sitting in the
   * database as `&lt;img …&gt;` — which re-materializes into a live tag the
   * moment anything downstream decodes entities again.
   *
   * Two deliberate tradeoffs, both chosen over the alternative:
   * - It is bounded, not a true fixpoint. Five or more encoding layers survive.
   *   Unbounded iteration would hand an attacker O(n) passes over a 256 KiB
   *   entry, so the work cap wins over total coverage.
   * - Text that legitimately discusses entities loses fidelity: an author
   *   writing `&amp;amp;lt;b&amp;amp;gt;` to show readers what `<b>` looks like ends up
   *   with that example stripped. Mangling a rare instructional snippet beats
   *   storing live markup.
   */
  private cleanHtml(text: string): string {
    let out = text.replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "");

    for (let pass = 0; pass < MAX_DECODE_PASSES; pass++) {
      const next = stripTags(decodeEntities(out));
      if (next === out) break; // nothing left to unwrap
      out = next;
    }

    return (
      out
        // Strip control characters — they enable log forging downstream.
        // Newlines and tabs go too: a newline is what actually forges a log
        // line, and \s+ collapses legitimate ones anyway.
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    );
  }
}

/** Passes of decode-then-strip. Two clears double encoding; the third confirms. */
const MAX_DECODE_PASSES = 3;

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d{1,7});/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripTags(text: string): string {
  return (
    text
      // Anchor the strip to a real tag name. A bare `<[^>]*>` would also eat
      // prose like "x < y and y > z" — common in CDATA'd posts, which is
      // exactly the literal text CDATA exists to protect.
      .replace(/<\/?[a-zA-Z][^>]*>/g, " ")
      .replace(/<![^>]*>/g, " ")
  ); // comments, doctypes
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  // Lone surrogates throw in fromCodePoint.
  if (code >= 0xd800 && code <= 0xdfff) return "";
  return String.fromCodePoint(code);
}
