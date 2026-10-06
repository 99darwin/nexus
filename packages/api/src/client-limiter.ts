/**
 * Per-client windowed rate limiting with strikes and escalating bans.
 *
 * Each client is counted against every configured window at once (e.g. 30
 * per minute AND 300 per hour AND 2,000 per day). Exhausting any window is a
 * strike and a timeout until that window resets; `maxStrikes` strikes inside
 * `strikeDecayMs` is a ban. Bans escalate through `banDurationsMs` (the last
 * entry repeats) and the escalation level is forgiven after
 * `escalationDecayMs` without a breach.
 *
 * In-memory and therefore per-instance: two API replicas mean two sets of
 * windows. Fine at this scale — the global @fastify/rate-limit plugin is the
 * outer net and this is the targeted inner one. Bans long enough to matter
 * across a restart are persisted by the caller (see `onBan`).
 *
 * Keys are `request.clientKey` (see edge-proxy.ts) — never a raw header.
 */

export interface LimitWindow {
  windowMs: number;
  maxRequests: number;
}

export interface ClientLimiterConfig {
  windows: readonly LimitWindow[];
  maxStrikes: number;
  /** Ban length per escalation level; the last entry repeats. */
  banDurationsMs: readonly number[];
  /** Clean interval after which accumulated strikes are forgiven. */
  strikeDecayMs: number;
  /** Clean interval after which the ban escalation level resets. */
  escalationDecayMs: number;
  /** Cap on tracked clients; defaults to DEFAULT_MAX_TRACKED. */
  maxTracked?: number;
  /** Called when a client is banned, e.g. to persist long bans. */
  onBan?: (key: string, durationMs: number) => void;
}

export interface ClientLimiter {
  /** Counts one request. Returns ms before the client may retry, or 0 to proceed. */
  check(key: string): number;
  /** Test-only: drop all state. */
  reset(): void;
}

interface WindowState {
  start: number;
  count: number;
}

interface ClientState {
  windows: WindowState[];
  strikes: number;
  /** Bans served at the current escalation level. */
  banLevel: number;
  bannedUntil: number;
  /** Set when a window is exhausted. Enforces the retry time we advertise. */
  limitedUntil: number;
  /** When a window was last exhausted, for strike and escalation decay. */
  lastBreachAt: number;
}

/**
 * Cap on tracked clients. Without it, a client rotating identities grows the
 * map without bound — a cheap memory-exhaustion vector.
 */
const DEFAULT_MAX_TRACKED = 10_000;

/** Floor between full sweeps, so a flood of new identities can't force an O(n) scan per request. */
const PRUNE_INTERVAL_MS = 1_000;

/** Upper bound on entries examined looking for an evictable victim. */
const EVICTION_SCAN_LIMIT = 64;

export function createClientLimiter(config: ClientLimiterConfig): ClientLimiter {
  if (config.windows.length === 0) throw new Error("client limiter needs at least one window");
  if (config.banDurationsMs.length === 0) throw new Error("client limiter needs a ban duration");

  const maxTracked = config.maxTracked ?? DEFAULT_MAX_TRACKED;
  const longestWindowMs = Math.max(...config.windows.map((window) => window.windowMs));
  const states = new Map<string, ClientState>();
  let lastPruneAt = 0;

  /** No live ban or limit, every window stale, nothing left to forgive. */
  function isExpired(state: ClientState, now: number): boolean {
    return (
      state.bannedUntil <= now &&
      state.limitedUntil <= now &&
      now - Math.min(...state.windows.map((window) => window.start)) > longestWindowMs &&
      (state.banLevel === 0 || now - state.lastBreachAt > config.escalationDecayMs)
    );
  }

  /**
   * Makes room for one new client. Returns false when every tracked entry is
   * still live, in which case the caller is turned away rather than letting
   * the map grow or evicting someone's active ban.
   */
  function ensureCapacity(now: number): boolean {
    if (states.size < maxTracked) return true;

    // Full sweep, rate-limited so a flood of new identities can't force one per request.
    if (now - lastPruneAt >= PRUNE_INTERVAL_MS) {
      lastPruneAt = now;
      for (const [key, state] of states) {
        if (isExpired(state, now)) states.delete(key);
      }
      if (states.size < maxTracked) return true;
    }

    // Bounded scan for a victim not serving a ban or a limit, oldest first.
    // Snapshot the keys so we are not mutating the map under its own iterator.
    const candidates: string[] = [];
    for (const key of states.keys()) {
      candidates.push(key);
      if (candidates.length >= EVICTION_SCAN_LIMIT) break;
    }

    for (const key of candidates) {
      const state = states.get(key);
      if (!state) continue;
      if (state.bannedUntil <= now && state.limitedUntil <= now) {
        states.delete(key);
        return true;
      }
      // Live entry. Rotate it to the tail, keeping its state intact, so the
      // next scan starts past it. Without this a band of banned entries parked
      // at the head would permanently block admission for everyone else.
      states.delete(key);
      states.set(key, state);
    }
    return false;
  }

  function newState(now: number): ClientState {
    return {
      windows: config.windows.map(() => ({ start: now, count: 0 })),
      strikes: 0,
      banLevel: 0,
      bannedUntil: 0,
      limitedUntil: 0,
      lastBreachAt: 0,
    };
  }

  function ban(key: string, state: ClientState, now: number): number {
    const levels = config.banDurationsMs;
    const durationMs = levels[Math.min(state.banLevel, levels.length - 1)];
    state.banLevel += 1;
    state.strikes = 0;
    state.bannedUntil = now + durationMs;
    config.onBan?.(key, durationMs);
    return durationMs;
  }

  function check(key: string): number {
    const now = Date.now();
    let state = states.get(key);
    if (!state) {
      if (!ensureCapacity(now)) return config.windows[0].windowMs;
      state = newState(now);
      states.set(key, state);
    }

    if (state.bannedUntil > now) return state.bannedUntil - now;
    // The timeout we already told this client to wait out. Without this the
    // advertised retry time is a lie and the limit is trivially outrun.
    if (state.limitedUntil > now) return state.limitedUntil - now;

    // Forgive stale strikes and escalation before this request can add to them.
    const sinceBreach = now - state.lastBreachAt;
    if (state.strikes > 0 && sinceBreach > config.strikeDecayMs) state.strikes = 0;
    if (state.banLevel > 0 && sinceBreach > config.escalationDecayMs) state.banLevel = 0;

    let retryAfterMs = 0;
    config.windows.forEach((limit, index) => {
      const window = state.windows[index];
      // >= so a client told to retry at the window edge gets a fresh window then.
      if (now - window.start >= limit.windowMs) {
        window.start = now;
        window.count = 0;
      }
      window.count += 1;
      if (window.count > limit.maxRequests) {
        retryAfterMs = Math.max(retryAfterMs, window.start + limit.windowMs - now);
      }
    });
    if (retryAfterMs === 0) return 0;

    state.strikes += 1;
    state.lastBreachAt = now;
    if (state.strikes >= config.maxStrikes) return ban(key, state, now);
    state.limitedUntil = now + retryAfterMs;
    return retryAfterMs;
  }

  return {
    check,
    reset() {
      states.clear();
      lastPruneAt = 0;
    },
  };
}
