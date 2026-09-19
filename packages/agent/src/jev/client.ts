/**
 * Minimal client for TypeSafe System One (Jev) — a decision model.
 *
 * One POST answers N typed questions about a single `state`. Jev classifies,
 * it never generates text, so there is no prompt to parse and nothing to
 * hallucinate. Wire format: https://docs.typesafe.ai/api.md
 */

import { sleep } from "../abort.js";

/**
 * The one destination raw feed content and the API key may reach — a compiled-in
 * constant, not configuration. Raw `raw_items` content is the request payload, so
 * a caller-supplied endpoint would be an exfiltration channel rather than a knob;
 * there is no override, validated or otherwise. Tests inject `fetchImpl`.
 */
const SYSTEM_ONE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const DEFAULT_MODEL = "jev-latest";
const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_TIMEOUT_MS = 30_000;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 20_000;
/** Truncate upstream error bodies so a large HTML error page can't flood logs. */
const MAX_ERROR_BODY_CHARS = 2000;
/** Hard stop on the transfer itself, so a huge body is never fully downloaded. */
const MAX_ERROR_BODY_BYTES = 8 * 1024;

// ── Question types ──────────────────────────────────────────────────────

/** Yes/no. Answer is a probability in [0, 1] that the answer is "yes". */
export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
}

/** Pick one option from a named set. `criteria` maps option → description. */
export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string | null>;
}

/** Position on an ordered rubric. `criteria` is the level descriptions, low → high. */
export interface ScoreQuestion {
  type: "score";
  instructions: string;
  criteria: string[];
}

export type JevQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

// ── Answer types ────────────────────────────────────────────────────────

export interface NoulAnswer {
  type: "noul";
  /** Probability in [0, 1] that the answer is "yes". */
  noul: number;
  confidence?: number;
}

export interface ChoiceAnswer {
  type: "choice";
  /** The highest-probability option key from the question's `criteria`. */
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface ScoreAnswer {
  type: "score";
  /** Probability-weighted position on the rubric: 0 … criteria.length - 1. */
  score: number;
  probabilities: Record<string, number>;
  legend?: Record<string, string>;
  confidence: number;
}

export type JevAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface SystemOneResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage?: { input_tokens: number; output_tokens: number };
}

export class JevApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "JevApiError";
  }
}

export interface JevClientOptions {
  apiKey?: string;
  model?: string;
  maxRetries?: number;
  timeoutMs?: number;
  /** Injected for tests; defaults to global fetch. There is deliberately no
   * endpoint option — see SYSTEM_ONE_ENDPOINT. */
  fetchImpl?: typeof fetch;
}

function jitteredBackoffMs(attempt: number): number {
  const ceiling = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  // Full jitter — spreads retries from concurrent callers across the window.
  return Math.random() * ceiling;
}

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_BACKOFF_MS);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, Math.min(date - Date.now(), MAX_BACKOFF_MS));
  return null;
}

export class JevClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: JevClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY;
    // Fail fast at construction — a missing key is a deploy error, not a runtime one.
    if (!apiKey) throw new Error("TYPESAFE_API_KEY is required");

    this.apiKey = apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  /**
   * Ask Jev every question in one round trip.
   *
   * `signal` cancels the request and the retry schedule. Enrichment runs one
   * call per item behind a process-wide lock, so an uncancellable 30s timeout
   * times four retries is time the whole pipeline spends waiting.
   */
  async systemOne(
    state: unknown,
    questions: Record<string, JevQuestion>,
    signal?: AbortSignal,
  ): Promise<SystemOneResponse> {
    const body = JSON.stringify({ state, model: this.model, questions });

    let lastError: Error | null = null;
    // Call-local: a module-scoped value would leak between concurrent requests.
    let retryAfterMs: number | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      signal?.throwIfAborted();
      if (attempt > 0) await sleep(retryAfterMs ?? jitteredBackoffMs(attempt - 1), signal);

      let response: Response;
      try {
        // Per-attempt timeout, plus the caller's signal. `AbortSignal.timeout`
        // is recreated each attempt so every retry gets a full budget.
        const perAttempt = AbortSignal.timeout(this.timeoutMs);
        response = await this.fetchImpl(SYSTEM_ONE_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body,
          // Never follow a redirect: a 307/308 replays this POST — feed content
          // and all — against whatever origin the response names.
          redirect: "error",
          signal: signal ? AbortSignal.any([signal, perAttempt]) : perAttempt,
        });
      } catch (err) {
        // A cancelled call is not a flaky one: retrying would issue up to four
        // more requests for a cycle that has already been abandoned. Rethrow
        // the caller's own reason so `enrichItems` can tell abort from failure.
        if (signal?.aborted) throw signal.reason as Error;

        // Network/timeout failure — retryable, but never propagate the original
        // error object: a fetch wrapper, proxy, or injected fetchImpl can embed
        // the request headers in its message or stack, and the enrichment
        // caller logs `err.message`.
        lastError = sanitizeTransportError(err, this.apiKey);
        retryAfterMs = null;
        continue;
      }

      if (response.ok) {
        try {
          return (await response.json()) as SystemOneResponse;
        } catch (err) {
          // A malformed 200 body is the upstream's problem, not a retryable
          // transport fault. The message is a static constant: Node's JSON parse
          // errors quote a prefix of the offending body, and the enrichment
          // caller logs `.message` — so the parse text goes on `.body`, which
          // nothing logs, behind the same redaction as every other error path.
          throw new JevApiError(
            "Jev: malformed response body (see .body)",
            response.status,
            redactSecrets(err instanceof Error ? err.message : String(err), this.apiKey),
          );
        }
      }

      const { status } = response;

      // 401 is terminal: retrying a bad key only burns quota.
      if (status === 401) throw new JevApiError("Jev: missing or invalid API key", status);

      if (status === 422) {
        // Body stays on `.body` rather than in `.message`: callers log messages,
        // and a validation body echoes back the request (feed content, headers).
        const detail = await readBodySafely(response, this.apiKey);
        throw new JevApiError("Jev: request failed validation (see .body)", status, detail);
      }

      if (status === 429 || status === 529) {
        retryAfterMs = parseRetryAfterMs(response.headers?.get("retry-after") ?? null);
        lastError = new JevApiError(
          status === 429 ? "Jev: rate limited" : "Jev: service overloaded",
          status,
        );
        // Release the socket. An undrained body keeps the connection occupied,
        // so under sustained rate limiting these accumulate instead of being
        // reused by the retry we are about to make.
        await response.body?.cancel().catch(() => {});
        continue;
      }

      // Any other non-2xx is terminal — the request itself is the problem.
      const detail = await readBodySafely(response, this.apiKey);
      throw new JevApiError(`Jev: request failed with ${status} (see .body)`, status, detail);
    }

    throw lastError ?? new Error(`Jev: request failed after ${this.maxRetries} retries`);
  }
}

/**
 * Read a bounded prefix of an error body.
 *
 * The cap is enforced on DOWNLOADED BYTES before decoding, so an oversized
 * chunk is truncated rather than decoded whole. Control characters are
 * stripped so a body cannot forge log lines, and the API key is redacted in
 * case the upstream echoes the Authorization header back.
 *
 * Caveat: when the response exposes no readable stream (a mock, or a
 * non-streaming polyfill) the transfer has already completed by the time
 * text() resolves, so only the STORED string is bounded there. Content-Length
 * is checked first to skip the read entirely when the upstream declares an
 * oversized body, but a chunked response without that header cannot be metered
 * on that path.
 */
async function readBodySafely(response: Response, apiKey: string): Promise<string> {
  try {
    const declared = Number(response.headers?.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_ERROR_BODY_BYTES) {
      return `<error body too large: ${declared} bytes>`;
    }

    let text: string;
    const reader = response.body?.getReader();

    if (!reader) {
      text = (await response.text()).slice(0, MAX_ERROR_BODY_CHARS);
    } else {
      const decoder = new TextDecoder();
      text = "";
      let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        const remaining = MAX_ERROR_BODY_BYTES - bytes;
        if (value.byteLength >= remaining) {
          // Decode only what fits: a single 50 MB chunk must not be decoded in
          // full just to be sliced afterwards.
          text += decoder.decode(value.subarray(0, Math.max(remaining, 0)));
          await reader.cancel().catch(() => {});
          break;
        }

        bytes += value.byteLength;
        text += decoder.decode(value, { stream: true });
        if (text.length >= MAX_ERROR_BODY_CHARS) {
          await reader.cancel().catch(() => {});
          break;
        }
      }
      text = text.slice(0, MAX_ERROR_BODY_CHARS);
    }

    return redactSecrets(text, apiKey);
  } catch {
    return "<unreadable body>";
  }
}

/** Decode `%XX` escapes so `%2f` and `%2F` both collapse onto the literal key. */
function tryPercentDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    // A stray `%` makes the whole string undecodable; decode each valid escape.
    return text.replace(/%[0-9a-fA-F]{2}/g, (m) => {
      try {
        return decodeURIComponent(m);
      } catch {
        return m;
      }
    });
  }
}

/** Decode `\uXXXX` escapes, the form a JSON-encoded echo of the key arrives in. */
function decodeUnicodeEscapes(text: string): string {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

/** Max normalization rounds. Bounds the work a hostile body can force. */
const MAX_NORMALIZE_ROUNDS = 3;

/**
 * Decode escapes repeatedly until the text stops changing.
 *
 * One pass is not enough: `%25XX` decodes to `%XX`, which is still an escape,
 * and `\\u005c\\u0075` reconstructs a `\u` prefix. A body that double-encodes
 * the key defeats a single-pass normalizer entirely.
 */
function normalizeEscapes(text: string): string {
  let out = text;
  for (let round = 0; round < MAX_NORMALIZE_ROUNDS; round++) {
    const next = decodeUnicodeEscapes(tryPercentDecode(out));
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * Every base64 spelling of the key that can appear inside a larger blob.
 *
 * Base64 encodes 3 bytes at a time, so a key embedded at a byte offset that is
 * not a multiple of 3 produces entirely different characters. Encoding the key
 * alone catches only the aligned case. Prefixing 1 and 2 filler bytes and
 * trimming the characters those fillers contaminate yields the interior run for
 * each alignment — plus the base64url alphabet, which `-`/`_` substitution makes
 * a distinct string.
 */
function base64Variants(apiKey: string): string[] {
  const variants = new Set<string>();
  for (let pad = 0; pad < 3; pad++) {
    const prefixed = Buffer.concat([Buffer.alloc(pad), Buffer.from(apiKey, "utf8")]);
    const encoded = prefixed.toString("base64").replace(/=+$/, "");
    // Each filler byte contaminates the leading characters; drop the affected
    // head, and the tail whose final group is short.
    const head = pad === 0 ? 0 : pad === 1 ? 2 : 3;
    const core = encoded.slice(head, encoded.length - 1);
    if (core.length >= 8) {
      variants.add(core);
      variants.add(core.replace(/\+/g, "-").replace(/\//g, "_"));
    }
  }
  return [...variants];
}

/**
 * Redact every recoverable form of the key.
 *
 * Enumerating encodings is a losing game (`A%2f` vs `A%2F` vs `A/`),
 * so the text is normalized first — percent- and unicode-escapes decoded
 * repeatedly — and the normalized form is what gets stored when it reveals the
 * key. `.body` is an enumerable public property, so it must be safe to
 * serialize even though no caller logs it today.
 */
function redactSecrets(text: string, apiKey: string): string {
  let out = text;

  if (apiKey.length > 0) {
    const normalized = normalizeEscapes(out);
    // Keep the normalized form only when it exposes a key the raw text hid —
    // otherwise the stored body should stay as the upstream sent it.
    if (normalized !== out && normalized.includes(apiKey)) out = normalized;

    for (const variant of [apiKey, ...base64Variants(apiKey)]) {
      out = out.split(variant).join("[REDACTED]");
    }
  }

  // Backstop for any encoding the normalization above misses: whatever follows
  // a Bearer scheme in an echoed header is a credential by definition.
  out = out.replace(/(bearer\s+)\S+/gi, "$1[REDACTED]");
  // Strip control characters INCLUDING newlines — a newline is what actually
  // forges a log line.
  // eslint-disable-next-line no-control-regex
  return out.replace(/[\u0000-\u001f\u007f]/g, " ");
}

/**
 * Replace a transport exception with a fresh Error carrying a STATIC message.
 *
 * Best-effort redaction of the original text was not enough: a wrapper or
 * proxy can interpolate the request into `message` or `stack` in an encoding
 * the redactor does not recognize. Only the error's class name — a library
 * constant, never request-derived — survives into the message. The redacted
 * original is attached as `.detail`, which no caller logs.
 */
function sanitizeTransportError(err: unknown, apiKey: string): Error & { detail?: string } {
  const raw = err instanceof Error ? err : new Error(String(err));
  const kind = TRANSPORT_ERROR_NAMES.has(raw.name) ? raw.name : "TransportError";
  const safe: Error & { detail?: string } = new Error(`Jev: request failed (${kind})`);
  safe.name = "JevTransportError";
  safe.detail = redactSecrets(raw.message, apiKey);
  return safe;
}

/** Runtime-defined error names, safe to echo because none is request-derived. */
const TRANSPORT_ERROR_NAMES = new Set([
  "AbortError",
  "TimeoutError",
  "TypeError",
  "SyntaxError",
]);
