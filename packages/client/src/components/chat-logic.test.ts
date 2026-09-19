import { describe, expect, it } from "vitest";
import type { ChatResult, FeedItem } from "../data/feed-types";
import {
  ChatSession,
  MAX_LOG_LINES,
  linesForItem,
  linesForResult,
  pruneLines,
  rateLimitText,
} from "./chat-logic";

function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: "openai/gpt-5",
    title: "openai ships gpt-5",
    url: "https://example.com/gpt-5",
    source: "techcrunch",
    published_at: new Date().toISOString(),
    excerpt: null,
    vertical: "foundation_models",
    event_type: "release",
    significance: 0.9,
    ...overrides,
  };
}

const NO_FACETS = { vertical: null, event_type: null, timeframe: null };

/** Resolves only when the test says so — lets us observe the in-flight state. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("linesForResult", () => {
  it("renders a refusal as a single dim line", () => {
    const lines = linesForResult({ kind: "refusal", refusal: "i only search indexed ai news" });
    expect(lines).toEqual([{ kind: "dim", text: "i only search indexed ai news" }]);
  });

  it("falls back to canned copy when the refusal string is empty", () => {
    const lines = linesForResult({ kind: "refusal", refusal: "" });
    expect(lines).toHaveLength(1);
    expect(lines[0].kind).toBe("dim");
    expect(lines[0].text).toContain("i only search indexed ai news");
  });

  it("renders items as a count header plus three-line blocks", () => {
    const result: ChatResult = {
      kind: "items",
      items: [item(), item({ id: "anthropic/claude", title: "anthropic ships claude" })],
      interpreted: NO_FACETS,
    };
    const lines = linesForResult(result);

    expect(lines[0]).toEqual({ kind: "dim", text: "2 items" });
    expect(lines.slice(1).map((line) => line.kind)).toEqual([
      "title",
      "meta",
      "link",
      "title",
      "meta",
      "link",
    ]);
    expect(lines[1].text).toBe("openai ships gpt-5");
    expect(lines[3].href).toBe("https://example.com/gpt-5");
  });

  it("drops the link line for a non-http url", () => {
    const lines = linesForItem(item({ url: "javascript:alert(1)" }));
    expect(lines.map((line) => line.kind)).toEqual(["title", "meta"]);
  });

  it("reports an empty result set", () => {
    const lines = linesForResult({ kind: "items", items: [], interpreted: NO_FACETS });
    expect(lines).toEqual([{ kind: "dim", text: "no matches in the index." }]);
  });

  it("converts a rate limit window to whole minutes", () => {
    expect(rateLimitText(60_000)).toBe("rate limited — try again in 1 minute");
    expect(rateLimitText(150_000)).toBe("rate limited — try again in 3 minutes");
    expect(linesForResult({ kind: "rate_limited", retryAfterMs: 60_000 })[0].kind).toBe("dim");
  });
});

describe("pruneLines", () => {
  it("caps the transcript at MAX_LOG_LINES, keeping the newest", () => {
    const lines = Array.from({ length: MAX_LOG_LINES + 25 }, (_, i) => ({
      id: i,
      kind: "dim" as const,
      text: `line ${i}`,
    }));
    const pruned = pruneLines(lines);
    expect(pruned).toHaveLength(MAX_LOG_LINES);
    expect(pruned[pruned.length - 1].text).toBe(`line ${MAX_LOG_LINES + 24}`);
  });
});

describe("ChatSession", () => {
  it("blocks a double submit while a reply is in flight", async () => {
    const gate = deferred<ChatResult>();
    let posts = 0;
    const session = new ChatSession({
      post: () => {
        posts += 1;
        return gate.promise;
      },
      onChange: () => {},
      reducedMotion: true,
    });

    expect(session.submit("funding rounds this week")).toBe(true);
    expect(session.isAwaiting).toBe(true);

    // the reentrancy guard — second submit is rejected and never hits the api
    expect(session.submit("new model releases")).toBe(false);
    expect(posts).toBe(1);

    gate.resolve({ kind: "items", items: [item()], interpreted: NO_FACETS });
    await gate.promise;
    await Promise.resolve();

    expect(session.isAwaiting).toBe(false);
    expect(session.submit("acquisitions this month")).toBe(true);
    expect(posts).toBe(2);
  });

  it("rejects an empty submit", () => {
    const session = new ChatSession({
      post: async () => ({ kind: "error" }) as ChatResult,
      onChange: () => {},
      reducedMotion: true,
    });
    expect(session.submit("   ")).toBe(false);
  });

  it("echoes the prompt and appends the response block", async () => {
    const session = new ChatSession({
      post: async () => ({ kind: "refusal", refusal: "not indexed" }) as ChatResult,
      onChange: () => {},
      reducedMotion: true,
      greeting: [],
    });

    session.submit("weather in tokyo");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const lines = session.getSnapshot().lines;
    expect(lines[0]).toMatchObject({ kind: "user", text: "> weather in tokyo" });
    expect(lines[1]).toMatchObject({ kind: "dim", text: "not indexed" });
  });

  it("flushes a pending staggered reveal when a new prompt arrives", async () => {
    let call = 0;
    const session = new ChatSession({
      post: async () =>
        ({
          kind: "items",
          items: [item({ id: `item-${++call}` })],
          interpreted: NO_FACETS,
        }) as ChatResult,
      onChange: () => {},
      lineDelayMs: 1000, // long enough that nothing reveals on its own
      greeting: [],
    });

    session.submit("first");
    await new Promise((resolve) => setTimeout(resolve, 0));
    // only the echo is on screen; the block is still scheduled
    expect(session.getSnapshot().lines).toHaveLength(1);

    session.submit("second");
    const texts = session.getSnapshot().lines.map((line) => line.text);
    // the first block landed in full, before the second echo
    expect(texts[texts.length - 1]).toBe("> second");
    expect(texts).toContain("openai ships gpt-5");

    session.dispose();
  });
});
