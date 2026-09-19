import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { RawItem } from "@nexus/shared";
import { JevApiError, JevClient } from "../jev/client.js";
import {
  buildExcerpt,
  classifyItem,
  enrichItems,
  significanceFromScore,
  EXCERPT_MAX_CHARS,
} from "../jev/enrich.js";

// Jev is NEVER called for real in tests — every request goes through this mock.
const mockFetch = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function answers(overrides: Record<string, unknown> = {}) {
  return {
    model: "jev-latest",
    answers: {
      is_ai_relevant: { type: "noul", noul: 0.95 },
      vertical: {
        type: "choice",
        choice: "foundation_models",
        probabilities: { foundation_models: 0.9 },
        confidence: 0.9,
      },
      event_type: {
        type: "choice",
        choice: "release",
        probabilities: { release: 0.8 },
        confidence: 0.8,
      },
      significance: {
        type: "score",
        score: 3,
        probabilities: { "3": 0.7 },
        legend: { "3": "major" },
        confidence: 0.7,
      },
      ...overrides,
    },
    usage: { input_tokens: 100, output_tokens: 20 },
  };
}

function makeItem(overrides: Partial<RawItem> = {}): RawItem {
  return {
    source: "rss",
    source_url: "https://example.com/a",
    title: "Acme ships a new frontier model",
    content: "Acme announced its newest model today.",
    published_at: "2026-09-01T00:00:00.000Z",
    raw_metadata: {},
    ...overrides,
  };
}

function makePool(rowCount = 1) {
  return {
    query: vi.fn(async (_sql: string, _params: unknown[]) => ({ rowCount, rows: [] })),
  };
}

function makeClient() {
  return new JevClient({
    apiKey: "test-key",
    fetchImpl: mockFetch as unknown as typeof fetch,
    maxRetries: 4,
  });
}

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("JevClient construction", () => {
  it("throws when TYPESAFE_API_KEY is unset", () => {
    const original = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    expect(() => new JevClient()).toThrow(/TYPESAFE_API_KEY/);
    if (original !== undefined) process.env.TYPESAFE_API_KEY = original;
  });
});

describe("classifyItem", () => {
  it("asks all four questions in a single call", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(answers()));

    const row = await classifyItem(makeItem(), makeClient());

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init.headers.Authorization).toBe("Bearer test-key");

    const body = JSON.parse(init.body);
    expect(body.model).toBe("jev-latest");
    expect(Object.keys(body.questions).sort()).toEqual([
      "event_type",
      "is_ai_relevant",
      "significance",
      "vertical",
    ]);
    expect(body.questions.is_ai_relevant.type).toBe("noul");
    expect(body.questions.vertical.type).toBe("choice");
    expect(body.questions.significance.type).toBe("score");
    // 21 verticals + "none"
    expect(Object.keys(body.questions.vertical.criteria)).toHaveLength(22);
    expect(body.questions.vertical.criteria).toHaveProperty("none");
    expect(body.questions.event_type.criteria).toHaveProperty("other");

    expect(row).toMatchObject({
      url: "https://example.com/a",
      vertical: "foundation_models",
      event_type: "release",
      significance: 0.8,
    });
  });

  it("drops the item when relevance is below 0.6", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(answers({ is_ai_relevant: { type: "noul", noul: 0.59 } })),
    );

    const pool = makePool();
    const stats = await enrichItems([makeItem()], {
      client: makeClient(),
      pool,
      callDelayMs: 0,
    });

    expect(stats.droppedIrrelevant).toBe(1);
    expect(stats.inserted).toBe(0);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("keeps the item exactly at the 0.6 threshold", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(answers({ is_ai_relevant: { type: "noul", noul: 0.6 } })),
    );
    expect(await classifyItem(makeItem(), makeClient())).not.toBeNull();
  });

  it("maps none/other choices to null columns", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(
        answers({
          vertical: { type: "choice", choice: "none", probabilities: {}, confidence: 0.5 },
          event_type: { type: "choice", choice: "other", probabilities: {}, confidence: 0.5 },
        }),
      ),
    );

    const row = await classifyItem(makeItem(), makeClient());
    expect(row?.vertical).toBeNull();
    expect(row?.event_type).toBeNull();
  });

  it("truncates the excerpt at 280 chars and nulls empty content", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(answers()));

    const long = "x".repeat(500);
    const row = await classifyItem(makeItem({ content: long }), makeClient());
    expect(row?.excerpt).toHaveLength(EXCERPT_MAX_CHARS);

    expect(buildExcerpt("   ")).toBeNull();
    expect(buildExcerpt("")).toBeNull();
  });

  it("returns null when the relevance answer is missing", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ model: "jev-latest", answers: { vertical: { type: "choice", choice: "x" } } }),
    );
    expect(await classifyItem(makeItem(), makeClient())).toBeNull();
  });
});

describe("insert path", () => {
  it("inserts with ON CONFLICT (url) DO NOTHING", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(answers()));
    const pool = makePool(1);

    const stats = await enrichItems([makeItem()], {
      client: makeClient(),
      pool,
      callDelayMs: 0,
    });

    expect(stats.inserted).toBe(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain("INSERT INTO feed_items");
    expect(sql).toContain("ON CONFLICT (url) DO NOTHING");
    expect(params[1]).toBe("https://example.com/a");
  });

  it("counts a conflicting url as enriched but not inserted", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(answers()));
    const pool = makePool(0); // ON CONFLICT DO NOTHING → rowCount 0

    const stats = await enrichItems([makeItem()], {
      client: makeClient(),
      pool,
      callDelayMs: 0,
    });

    expect(stats.enriched).toBe(1);
    expect(stats.inserted).toBe(0);
    expect(stats.failed).toBe(0);
  });
});

describe("retry behaviour", () => {
  it("retries a 429 and then succeeds", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, 429))
      .mockResolvedValueOnce(jsonResponse(answers()));

    const row = await classifyItem(makeItem(), makeClient());

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(row).not.toBeNull();
  });

  it("retries a 529 and then succeeds", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: "overloaded" }, 529))
      .mockResolvedValueOnce(jsonResponse(answers()));

    expect(await classifyItem(makeItem(), makeClient())).not.toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws on 401 without retrying", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: "bad key" }, 401));

    await expect(classifyItem(makeItem(), makeClient())).rejects.toThrow(JevApiError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws on 422 with the validation body and does not retry", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ detail: "criteria must have 2 levels" }, 422));

    const err = await classifyItem(makeItem(), makeClient()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JevApiError);
    expect((err as JevApiError).status).toBe(422);
    // The body carries the detail; the message deliberately does not, because
    // callers log err.message and a 422 body echoes the request back.
    expect((err as JevApiError).body).toMatch(/criteria must have 2/);
    expect((err as JevApiError).message).not.toMatch(/criteria must have 2/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("redacts the api key if an error body echoes it back", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ detail: "bad header: Bearer test-key" }, 422),
    );

    const err = (await classifyItem(makeItem(), makeClient()).catch(
      (e: unknown) => e,
    )) as JevApiError;
    expect(err.body).not.toContain("test-key");
    expect(err.body).toContain("[REDACTED]");
  });

  it("drops the item when relevance is NaN or Infinity", async () => {
    // typeof NaN === "number" and NaN < 0.6 is false, so a naive guard keeps
    // the item. JSON.parse("1e999") is Infinity, so this is reachable upstream.
    for (const bad of [NaN, Infinity, -Infinity]) {
      mockFetch.mockResolvedValue(
        jsonResponse(answers({ is_ai_relevant: { type: "noul", noul: bad } })),
      );
      const pool = makePool();
      expect(await classifyItem(makeItem(), makeClient())).toBeNull();
      expect(pool.query).not.toHaveBeenCalled();
    }
  });

  it("drops the item when relevance is out of the [0,1] range", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(answers({ is_ai_relevant: { type: "noul", noul: 42 } })),
    );
    expect(await classifyItem(makeItem(), makeClient())).toBeNull();
  });

  it("never leaks the api key in a thrown error", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: "bad key" }, 401));

    // Guard the guard: assert the key really was sent, so this test cannot
    // pass vacuously if the Authorization header ever stops being attached.
    await classifyItem(makeItem(), makeClient()).catch(() => {});
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe("Bearer test-key");
    mockFetch.mockClear();

    await expect(classifyItem(makeItem(), makeClient())).rejects.toSatisfy(
      (err: Error) => !JSON.stringify({ m: err.message, s: err.stack }).includes("test-key"),
    );
  });

  it("records a failure and continues to the next item", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ error: "bad key" }, 401))
      .mockResolvedValueOnce(jsonResponse(answers()));

    const pool = makePool();
    const stats = await enrichItems(
      [makeItem({ source_url: "https://example.com/a" }), makeItem({ source_url: "https://example.com/b" })],
      { client: makeClient(), pool, callDelayMs: 0 },
    );

    expect(stats.failed).toBe(1);
    expect(stats.inserted).toBe(1);
  });
});

describe("significanceFromScore", () => {
  it("maps rubric levels 0-4 onto 0.2-1.0", () => {
    expect(significanceFromScore(0)).toBe(0.2);
    expect(significanceFromScore(1)).toBe(0.4);
    expect(significanceFromScore(2)).toBe(0.6);
    expect(significanceFromScore(3)).toBe(0.8);
    expect(significanceFromScore(4)).toBe(1.0);
  });

  it("rounds fractional scores and clamps out-of-range values", () => {
    expect(significanceFromScore(1.4)).toBe(0.4);
    expect(significanceFromScore(1.6)).toBe(0.6);
    expect(significanceFromScore(-5)).toBe(0.2);
    expect(significanceFromScore(99)).toBe(1.0);
    expect(significanceFromScore(NaN)).toBe(0.2);
  });
});

describe("Jev destination pinning and transport-error hygiene", () => {
  it("sends to the compiled-in endpoint, which is not configurable", async () => {
    // raw_items content is the request payload, so the destination is an
    // exfiltration channel rather than a config knob. A validated override was
    // still an override; there is now no option to pass at all.
    mockFetch.mockResolvedValueOnce(jsonResponse(answers()));

    // Anything a caller tries to smuggle in is inert — the type has no such
    // field, and the implementation never reads one.
    const sneaky = {
      apiKey: "test-key",
      fetchImpl: mockFetch as unknown as typeof fetch,
      baseUrl: "https://evil.example",
      endpoint: "https://evil.example",
      url: "https://evil.example",
    } as unknown as ConstructorParameters<typeof JevClient>[0];

    await classifyItem(makeItem(), new JevClient(sneaky));

    expect(mockFetch.mock.calls[0][0]).toBe("https://api.typesafe.ai/v1/systemone");
  });

  it("refuses to follow redirects, so a 307 cannot replay the POST elsewhere", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(answers()));
    await classifyItem(makeItem(), makeClient());
    expect(mockFetch.mock.calls[0][1].redirect).toBe("error");
  });

  it("redacts the api key out of a transport exception's message and stack", async () => {
    // A fetch wrapper, proxy, or interceptor that interpolates request headers
    // into its error puts the key into both message and stack — and the
    // enrichment caller logs err.message.
    mockFetch.mockRejectedValue(new Error("connect failed: Authorization: Bearer test-key"));

    // maxRetries: 0 — an always-rejecting mock otherwise burns four backoffs and
    // races the 5s default timeout.
    const client = new JevClient({
      apiKey: "test-key",
      fetchImpl: mockFetch as unknown as typeof fetch,
      maxRetries: 0,
    });
    const err = (await classifyItem(makeItem(), client).catch((e: unknown) => e)) as Error;
    const serialized = JSON.stringify({ m: err.message, s: err.stack, str: String(err) });
    expect(serialized).not.toContain("test-key");
    // The message is a static constant; the redacted original lives on .detail,
    // which no caller logs.
    expect((err as Error & { detail?: string }).detail).toContain("[REDACTED]");
  });

  it("redacts encoded representations of the key from an error body", async () => {
    const encoded = Buffer.from("test-key", "utf8").toString("base64");
    mockFetch.mockResolvedValue(jsonResponse({ detail: `echo ${encoded}` }, 422));

    const err = (await classifyItem(makeItem(), makeClient()).catch(
      (e: unknown) => e,
    )) as JevApiError;
    expect(err.body).not.toContain(encoded);
    expect(err.body).toContain("[REDACTED]");
  });
});

describe("Jev error hygiene — closure-review regressions", () => {
  function streamingResponse(text: string, status: number, chunkBytes?: number) {
    const bytes = new TextEncoder().encode(text);
    let offset = 0;
    let cancelled = false;
    const size = chunkBytes ?? bytes.byteLength;
    return {
      ok: false,
      status,
      cancelled: () => cancelled,
      headers: { get: () => null },
      body: {
        getReader() {
          return {
            async read() {
              if (cancelled || offset >= bytes.byteLength) return { done: true, value: undefined };
              const slice = bytes.subarray(offset, offset + size);
              offset += size;
              return { done: false, value: slice };
            },
            async cancel() {
              cancelled = true;
            },
          };
        },
      },
    };
  }

  it("uses a static transport-error message, not the original text", async () => {
    // Best-effort redaction of a wrapper's message is not enough: it may embed
    // the request in an encoding the redactor does not recognize.
    mockFetch.mockRejectedValue(new Error("POST failed; headers={Authorization: Bearer test-key}"));

    const client = new JevClient({
      apiKey: "test-key",
      fetchImpl: mockFetch as unknown as typeof fetch,
      maxRetries: 0,
    });
    const err = (await classifyItem(makeItem(), client).catch((e: unknown) => e)) as Error;

    expect(err.message).toBe("Jev: request failed (TransportError)");
    expect(err.message).not.toContain("POST failed");
    expect(JSON.stringify({ m: err.message, s: err.stack })).not.toContain("test-key");
  });

  it("redacts a percent-encoded key regardless of hex case", async () => {
    // encodeURIComponent("a/b") is "a%2Fb"; an echo may use "%2f".
    const key = "a/b";
    mockFetch.mockResolvedValue({
      ok: false,
      status: 422,
      headers: { get: () => null },
      text: async () => JSON.stringify({ detail: "sent a%2fb upstream" }),
    });

    const client = new JevClient({
      apiKey: key,
      fetchImpl: mockFetch as unknown as typeof fetch,
      maxRetries: 0,
    });
    const err = (await classifyItem(makeItem(), client).catch((e: unknown) => e)) as JevApiError;

    expect(err.body).not.toContain("a%2fb");
    expect(err.body).toContain("[REDACTED]");
  });

  it("redacts a \\uXXXX-escaped key", async () => {
    // Built rather than written literally: a source-level "t..." is decoded
    // by the TS lexer, which is exactly how the previous version of this test
    // ended up asserting on a plain "test-key" and passing vacuously.
    const BACKSLASH = String.fromCharCode(92);
    const escapedKey = [..."test-key"]
      .map((c) => BACKSLASH + "u" + c.charCodeAt(0).toString(16).padStart(4, "0"))
      .join("");

    // Guard the guard: the payload must not already contain the plain key.
    expect(escapedKey).not.toContain("test-key");
    expect(escapedKey.startsWith(BACKSLASH + "u0074")).toBe(true);

    mockFetch.mockResolvedValue({
      ok: false,
      status: 422,
      headers: { get: () => null },
      text: async () => `{"detail":"echo ${escapedKey}"}`,
    });

    const client = new JevClient({
      apiKey: "test-key",
      fetchImpl: mockFetch as unknown as typeof fetch,
      maxRetries: 0,
    });
    const err = (await classifyItem(makeItem(), client).catch((e: unknown) => e)) as JevApiError;

    expect(err.body).not.toContain(escapedKey);
    expect(err.body).not.toContain("test-key");
    expect(err.body).toContain("[REDACTED]");
  });

  it("redacts a double-encoded key that one normalization pass would miss", async () => {
    // "%25XX" decodes to "%XX" — still an escape. A single-pass normalizer
    // hands back a string that still hides the key, and the redactor then sees
    // nothing to redact.
    const key = "a/b";
    mockFetch.mockResolvedValue({
      ok: false,
      status: 422,
      headers: { get: () => null },
      text: async () => JSON.stringify({ detail: "sent a%252Fb upstream" }),
    });

    const client = new JevClient({
      apiKey: key,
      fetchImpl: mockFetch as unknown as typeof fetch,
      maxRetries: 0,
    });
    const err = (await classifyItem(makeItem(), client).catch((e: unknown) => e)) as JevApiError;

    expect(err.body).not.toContain("a%252Fb");
    expect(err.body).toContain("[REDACTED]");
  });

  it("redacts a base64 echo of the key at every byte alignment", async () => {
    // Base64 encodes 3 bytes at a time, so a key embedded at an offset that is
    // not a multiple of 3 produces entirely different characters. Encoding the
    // key alone catches only the aligned case — the other two alignments are
    // what an echoed request body or a basic-auth header actually look like.
    const key = "test-key-abcdefghijklmnop";

    for (const prefix of ["", "x", "xy"]) {
      const blob = Buffer.from(prefix + key, "utf8").toString("base64");
      // Guard the guard: the plain key must not be visible in the payload.
      expect(blob).not.toContain(key);

      mockFetch.mockResolvedValue({
        ok: false,
        status: 422,
        headers: { get: () => null },
        text: async () => JSON.stringify({ detail: `echo ${blob}` }),
      });

      const client = new JevClient({
        apiKey: key,
        fetchImpl: mockFetch as unknown as typeof fetch,
        maxRetries: 0,
      });
      const err = (await classifyItem(makeItem(), client).catch((e: unknown) => e)) as JevApiError;

      expect(err.body, `alignment "${prefix}" leaked`).toContain("[REDACTED]");
      // The interior run carrying the key's bytes is gone; only the
      // alignment-contaminated edge characters may remain.
      expect(err.body).not.toContain(blob);
    }
  });

  it("redacts a base64url echo, where +/ became -_", async () => {
    // The key must be one whose base64 actually CONTAINS "+" or "/", or the
    // base64url spelling is byte-identical to the standard one and this test
    // passes without the base64url variant existing at all.
    const key = "sk-live-~~~?>>>zzz-abcdefghijkl";
    const standard = Buffer.from(key, "utf8").toString("base64");
    expect(standard).toMatch(/[+/]/);

    const blob = standard.replace(/\+/g, "-").replace(/\//g, "_");
    expect(blob).not.toBe(standard);

    mockFetch.mockResolvedValue({
      ok: false,
      status: 422,
      headers: { get: () => null },
      text: async () => JSON.stringify({ detail: `echo ${blob}` }),
    });

    const client = new JevClient({
      apiKey: key,
      fetchImpl: mockFetch as unknown as typeof fetch,
      maxRetries: 0,
    });
    const err = (await classifyItem(makeItem(), client).catch((e: unknown) => e)) as JevApiError;

    expect(err.body).toContain("[REDACTED]");
    expect(err.body).not.toContain(blob);
  });

  it("stops the transfer instead of decoding an oversized chunk whole", async () => {
    // A single 2MB chunk must not be decoded in full just to be sliced after.
    const huge = "A".repeat(2 * 1024 * 1024);
    const response = streamingResponse(huge, 500);
    mockFetch.mockResolvedValue(response);

    const client = new JevClient({
      apiKey: "test-key",
      fetchImpl: mockFetch as unknown as typeof fetch,
      maxRetries: 0,
    });
    const err = (await classifyItem(makeItem(), client).catch((e: unknown) => e)) as JevApiError;

    expect(err.body!.length).toBeLessThanOrEqual(8 * 1024);
    expect(response.cancelled()).toBe(true);
  });

  it("skips the read entirely when content-length declares an oversized body", async () => {
    const getReader = vi.fn();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: (h: string) => (h === "content-length" ? "99999999" : null) },
      body: { getReader },
    });

    const client = new JevClient({
      apiKey: "test-key",
      fetchImpl: mockFetch as unknown as typeof fetch,
      maxRetries: 0,
    });
    const err = (await classifyItem(makeItem(), client).catch((e: unknown) => e)) as JevApiError;

    expect(err.body).toMatch(/too large/);
    expect(getReader).not.toHaveBeenCalled();
  });

  it("redacts a malformed 200 body's parse error", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => {
        throw new Error("Unexpected token in JSON: Bearer test-key");
      },
    });

    const err = (await classifyItem(makeItem(), makeClient()).catch(
      (e: unknown) => e,
    )) as JevApiError;
    // Static message: Node quotes a prefix of the malformed body in its parse
    // error, and the enrichment caller logs `.message`.
    expect(err.message).toBe("Jev: malformed response body (see .body)");
    expect(err.message).not.toContain("test-key");
    expect(err.body).not.toContain("test-key");
    expect(err.body).toContain("[REDACTED]");
  });

  it("keeps malformed-body parse text out of the logged message entirely", async () => {
    // A parse error that quotes feed content, not just the key: the message must
    // carry none of it, because redaction only targets credentials.
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => {
        throw new Error('Unexpected token < in JSON at position 0: "<leaked feed content>"');
      },
    });

    const err = (await classifyItem(makeItem(), makeClient()).catch(
      (e: unknown) => e,
    )) as JevApiError;
    expect(err.message).not.toContain("leaked feed content");
    expect(JSON.stringify({ m: err.message, s: err.stack })).not.toContain("leaked feed content");
  });
});

// ── Cancellation ────────────────────────────────────────────────────────

describe("abort propagation", () => {
  it("stops calling Jev once the cycle is cancelled", async () => {
    // The per-item catch in `enrichItems` is right for a bad response — one
    // hostile feed item must not stall the poll. It is wrong for an abort:
    // swallowing that keeps calling Jev for a cycle nobody is waiting for, and
    // stops the cycle from ever settling.
    const controller = new AbortController();
    const items = [1, 2, 3, 4, 5].map((n) =>
      makeItem({ source_url: `https://example.com/${n}`, title: `Story ${n}` }),
    );

    mockFetch.mockImplementation(async () => {
      controller.abort(new Error("shutting down"));
      return jsonResponse(answers());
    });

    await expect(
      enrichItems(items, {
        client: makeClient(),
        pool: makePool(),
        callDelayMs: 0,
        signal: controller.signal,
      }),
    ).rejects.toThrow("shutting down");

    // One call ran and aborted mid-flight; nothing after it.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("makes no request at all when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("shutting down"));

    await expect(
      enrichItems([makeItem()], {
        client: makeClient(),
        pool: makePool(),
        callDelayMs: 0,
        signal: controller.signal,
      }),
    ).rejects.toThrow("shutting down");

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not retry a cancelled request", async () => {
    // A cancelled call is not a flaky one. Retrying would issue up to four more
    // requests for a cycle that has already been abandoned, and delay settlement
    // by the whole backoff schedule.
    const controller = new AbortController();
    mockFetch.mockImplementation(async () => {
      controller.abort(new Error("shutting down"));
      throw new Error("The operation was aborted");
    });

    await expect(classifyItem(makeItem(), makeClient(), controller.signal)).rejects.toThrow(
      "shutting down",
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
