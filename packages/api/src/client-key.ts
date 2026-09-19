/**
 * Rate-limit identity derived from a client address.
 *
 * A single IPv6 allocation is routinely a /64 — 18 quintillion addresses the
 * same host can rotate through freely. Keying a limiter on the full address
 * therefore buys nothing against an IPv6 client: it rotates, evades every
 * window, and incidentally fills any bounded state map. Collapsing to the /64
 * prefix makes the identity as expensive to rotate as an IPv4 address is.
 *
 * Shared by the global @fastify/rate-limit keyGenerator and the tighter
 * per-IP window in routes/chat.ts — they must agree, or the cheaper limiter
 * becomes the way around the stricter one.
 */

const IPV6_GROUPS = 8;

/** Groups covered by a /64 prefix: 4 groups x 16 bits. */
const PREFIX_GROUPS = 4;

/** Dotted spelling of an IPv4-mapped address, e.g. `::ffff:203.0.113.7`. */
const IPV4_MAPPED_PATTERN = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/** Group index and value marking the mapped prefix `::ffff:`. */
const MAPPED_MARKER_INDEX = 5;
const MAPPED_MARKER_VALUE = 0xffff;
const GROUP_BITS = 16;
const OCTET_MASK = 0xff;

/**
 * Unwraps the hexadecimal spelling of an IPv4-mapped address
 * (`::ffff:cb00:7107` is `::ffff:203.0.113.7`), or null if this is a native
 * IPv6 address.
 *
 * Both spellings must produce the same key. Left alone, the hex form would
 * split one client's identity across two spellings *and* land in the `::/64`
 * bucket, sharing a rate limit with unrelated native IPv6 traffic — either a
 * limiter bypass or a way to throttle a stranger.
 */
function mappedIpv4(groups: string[]): string | null {
  if (groups.length !== IPV6_GROUPS) return null;

  const values = groups.map((group) => (group === "" ? 0 : Number.parseInt(group, 16)));
  if (values.some((value) => !Number.isInteger(value))) return null;
  if (values.slice(0, MAPPED_MARKER_INDEX).some((value) => value !== 0)) return null;
  if (values[MAPPED_MARKER_INDEX] !== MAPPED_MARKER_VALUE) return null;

  const [high, low] = values.slice(MAPPED_MARKER_INDEX + 1);
  return [high >>> 8, high & OCTET_MASK, low >>> 8, low & OCTET_MASK].join(".");
}

/**
 * Expands `::` so the prefix can be read positionally. The result is a
 * grouping key, not a canonical address — it only has to be stable and
 * collision-free across distinct prefixes.
 */
function expandGroups(ip: string): string[] {
  if (!ip.includes("::")) return ip.split(":");

  const [head, tail] = ip.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const missing = Math.max(IPV6_GROUPS - headGroups.length - tailGroups.length, 0);

  return [...headGroups, ...Array<string>(missing).fill("0"), ...tailGroups];
}

/**
 * IPv4 addresses pass through unchanged; IPv6 collapses to its /64 prefix.
 */
export function clientKey(rawIp: string): string {
  // Drop any zone index (`fe80::1%eth0`) before parsing.
  const ip = rawIp.split("%")[0];
  if (!ip.includes(":")) return ip;

  const dotted = IPV4_MAPPED_PATTERN.exec(ip);
  if (dotted) return dotted[1];

  const groups = expandGroups(ip);

  const mapped = mappedIpv4(groups);
  if (mapped) return mapped;

  const prefix = groups
    .slice(0, PREFIX_GROUPS)
    .map((group) => (group === "" ? "0" : group.toLowerCase().replace(/^0+(?=.)/, "")));

  while (prefix.length < PREFIX_GROUPS) prefix.push("0");

  return `${prefix.join(":")}::/64`;
}
